//! Persistent app configuration: server list, active server, tray behavior.
//!
//! URL normalization and serde logic are pure (no `AppHandle`) so they are
//! unit-testable without a running Tauri app; [`load`] / [`save`] are the
//! thin impure shell over `app_config_dir()/config.json`.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "config.json";

/// A registered LabHub server. `url` is always the normalized form (see
/// [`normalize_url`]) and `id` is derived from it (see `servers::server_id`),
/// so the pair stays stable across restarts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
}

/// Root config document. All fields default so older/partial files keep
/// deserializing as new fields are added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub servers: Vec<ServerConfig>,
    #[serde(default)]
    pub active_server: Option<String>,
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,
}

fn default_close_to_tray() -> bool {
    true
}

// Derived Default would hard-code close_to_tray = false; the shipped default
// is ON (2026-09 notifications design: quitting is the only way to lose
// desktop alerts). Explicit `close_to_tray: false` in an existing
// config.json still wins, so no install silently changes its saved choice.
impl Default for AppConfig {
    fn default() -> Self {
        Self {
            servers: Vec::new(),
            active_server: None,
            close_to_tray: true,
        }
    }
}

/// Normalizes a user-entered server URL to `scheme://host[:port]`.
///
/// - bare `host` / `host:port` input defaults to an `https://` prefix
/// - scheme must be http or https (input case-insensitive)
/// - host is lowercased; path, query, fragment, trailing slash and default
///   port are dropped
/// - idempotent: normalizing an already-normalized URL is a no-op
pub fn normalize_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Server URL is empty".into());
    }
    let candidate = if trimmed.contains("://") {
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") {
            trimmed.to_string()
        } else {
            return Err("Only http and https server URLs are supported".into());
        }
    } else {
        format!("https://{trimmed}")
    };
    let parsed = url::Url::parse(&candidate).map_err(|e| format!("Invalid server URL: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Only http and https server URLs are supported".into());
    }
    let Some(host) = parsed.host_str() else {
        return Err("Invalid server URL: missing host".into());
    };
    let port = parsed.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{scheme}://{host}{port}"))
}

/// Parses raw config text, falling back to defaults (with a warning) on
/// corrupt JSON instead of crashing.
pub fn parse_or_default(raw: &str) -> AppConfig {
    match serde_json::from_str(raw) {
        Ok(config) => config,
        Err(e) => {
            log::warn!("Corrupt LabHub config, using defaults: {e}");
            AppConfig::default()
        }
    }
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Cannot resolve config dir: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

/// Loads the config, defaulting (never crashing) on a missing or unreadable
/// file. A missing file is the normal first run and is not warned about.
pub fn load(app: &AppHandle) -> AppConfig {
    let path = match config_path(app) {
        Ok(path) => path,
        Err(e) => {
            log::warn!("{e}; using defaults");
            return AppConfig::default();
        }
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => parse_or_default(&raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => AppConfig::default(),
        Err(e) => {
            log::warn!("Cannot read config {path:?} ({e}); using defaults");
            AppConfig::default()
        }
    }
}

impl AppConfig {
    /// Atomic save: write a temp file next to the target, then rename over
    /// it, so a crash mid-write can never truncate the previous config.
    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = config_path(app)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create config dir: {e}"))?;
        }
        let raw = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Cannot serialize config: {e}"))?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, raw).map_err(|e| format!("Cannot write config: {e}"))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("Cannot save config: {e}"))?;
        Ok(())
    }
}
