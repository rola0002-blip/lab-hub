//! Tauri commands over the managed `Mutex<AppConfig>` state.
//!
//! Every mutating command (a) releases the config mutex, (b) emits
//! `servers-changed` so the chrome rail re-renders, and (c) calls
//! `webviews::sync` so webviews match the persisted config. The mutex is
//! never held across an `.await` (see `add_server`) nor across `sync`
//! (which locks the config itself).

use crate::config::{normalize_url, AppConfig, ServerConfig};
use crate::servers::{check_health, default_name, server_id};
use crate::webviews;
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, State};

fn lock<'a>(state: &'a State<'_, Mutex<AppConfig>>) -> Result<MutexGuard<'a, AppConfig>, String> {
    state
        .lock()
        .map_err(|_| "Config state poisoned".to_string())
}

fn after_mutation(app: &AppHandle, webview_diff: bool) -> Result<(), String> {
    if let Err(e) = app.emit("servers-changed", ()) {
        log::warn!("emit servers-changed failed: {e}");
    }
    if webview_diff {
        webviews::sync(app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_servers(state: State<'_, Mutex<AppConfig>>) -> Vec<ServerConfig> {
    lock(&state)
        .map(|config| config.servers.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn add_server(
    app: AppHandle,
    url: String,
    state: State<'_, Mutex<AppConfig>>,
) -> Result<ServerConfig, String> {
    let normalized = normalize_url(&url)?;
    let id = server_id(&normalized);
    {
        let config = lock(&state)?;
        if config.servers.iter().any(|s| s.id == id) {
            return Err("Already added".into());
        }
    }
    // Health check runs with the mutex released so a slow/unreachable host
    // cannot block every other config command.
    let health = check_health(&normalized).await?;
    let server = ServerConfig {
        id,
        name: default_name(&normalized, &health),
        url: normalized,
    };
    {
        let mut config = lock(&state)?;
        config.servers.push(server.clone());
        // A freshly added server becomes the active one: the user just
        // asked for it, so show it immediately.
        config.active_server = Some(server.id.clone());
        config.save(&app)?;
    }
    after_mutation(&app, true)?;
    Ok(server)
}

#[tauri::command]
pub fn remove_server(
    app: AppHandle,
    state: State<'_, Mutex<AppConfig>>,
    id: String,
) -> Result<(), String> {
    {
        let mut config = lock(&state)?;
        let had_active = config.active_server.as_deref() == Some(id.as_str());
        config.servers.retain(|s| s.id != id);
        if had_active {
            // Fall back to the first remaining server instead of leaving an
            // empty content area while servers still exist.
            config.active_server = config.servers.first().map(|s| s.id.clone());
        }
        config.save(&app)?;
    }
    after_mutation(&app, true)
}

#[tauri::command]
pub fn set_active(
    app: AppHandle,
    state: State<'_, Mutex<AppConfig>>,
    id: String,
) -> Result<(), String> {
    {
        let mut config = lock(&state)?;
        if !config.servers.iter().any(|s| s.id == id) {
            return Err(format!("Unknown server: {id}"));
        }
        config.active_server = Some(id);
        config.save(&app)?;
    }
    after_mutation(&app, true)
}

#[tauri::command]
pub fn get_app_config(state: State<'_, Mutex<AppConfig>>) -> AppConfig {
    lock(&state)
        .map(|config| config.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_close_to_tray(
    app: AppHandle,
    state: State<'_, Mutex<AppConfig>>,
    v: bool,
) -> Result<(), String> {
    {
        let mut config = lock(&state)?;
        config.close_to_tray = v;
        config.save(&app)?;
    }
    after_mutation(&app, false)
}

/// Remote-page -> desktop notification bridge (Task 6 implements the real
/// notification; stubbed here so the remote capability and chrome/remote
/// wiring can ship and be smoke-tested independently).
#[tauri::command]
pub fn desktop_notify(title: String, body: Option<String>) -> Result<(), String> {
    log::info!("desktop_notify (stub): title={title:?} body={body:?}");
    Ok(())
}
