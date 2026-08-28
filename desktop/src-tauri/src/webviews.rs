//! Chrome rail + per-server content webview lifecycle.
//!
//! Window "main" hosts a fixed [`RAIL_WIDTH`]-logical-px local chrome rail
//! (webview "chrome") plus one remote content webview per configured server
//! (webview "srv-<server-id>"); switching servers toggles visibility only,
//! so sessions and scroll positions survive. Since wave 9 the rail AUTO-HIDES
//! at exactly one configured server (effective width 0 — see [`rail_visible`]);
//! the tray's "Add server…" item re-reveals it via [`reveal_rail`]. Bounds are
//! managed manually (no `auto_resize`): [`relayout`] re-applies them on every
//! `WindowEvent::Resized` so the rail stays at its effective width — with
//! `auto_resize` each webview keeps *proportional* size instead (spike S1
//! quirk, docs/handoffs/2026-08-21-sp11-spike.md).

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl,
    Window, WindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

use crate::badges;
use crate::config::{AppConfig, ServerConfig};
use crate::notify;
use crate::servers::same_origin;
#[cfg(target_os = "macos")]
use crate::servers::store_key;

pub const WINDOW_LABEL: &str = "main";
pub const CHROME_LABEL: &str = "chrome";
pub const RAIL_WIDTH: f64 = 240.0;

/// Injected into every content webview before any page script runs: the
/// desktop-notify shim that replaces `window.Notification` (see
/// `desktop/ui/notify-shim.js` for the app-usage contract it satisfies).
/// Bundled at compile time so a UI-only edit cannot ship without a shell
/// rebuild that re-runs the gates.
pub const NOTIFY_SHIM: &str = include_str!("../../ui/notify-shim.js");

/// Live content webviews: server_id -> webview label. The active server is
/// deliberately *not* stored here — it is always read from the managed
/// `AppConfig` so webview state can never disagree with persisted config.
#[derive(Default)]
pub struct WebviewManager {
    webviews: Mutex<HashMap<String, String>>,
    rail_revealed: std::sync::atomic::AtomicBool,
}

fn label_for(server_id: &str) -> String {
    format!("srv-{server_id}")
}

fn logical_inner(window: &Window) -> (f64, f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = window.inner_size().unwrap_or_default();
    (size.width as f64 / scale, size.height as f64 / scale)
}

/// Creates the main window (bare — no config-declared webview) with the
/// chrome rail child, then materializes content webviews from config.
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let window = WindowBuilder::new(app, WINDOW_LABEL)
        .title("LabHub")
        .inner_size(1200.0, 800.0)
        .min_inner_size(640.0, 420.0)
        .build()
        .map_err(|e| format!("create main window: {e}"))?;
    let (_, h) = logical_inner(&window);
    window
        .add_child(
            WebviewBuilder::new(CHROME_LABEL, WebviewUrl::App("index.html".into())),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(RAIL_WIDTH, h),
        )
        .map_err(|e| format!("add chrome webview: {e}"))?;
    log::info!("chrome rail ready: {RAIL_WIDTH:.0}x{h:.0} logical, fixed width");
    sync(app)
}

/// Applies config -> webviews diff: create added servers' webviews, close
/// removed ones, switch visibility to the active server, then relayout.
/// Called after every config mutation (see `commands.rs`); every command
/// must have released the config mutex before calling this.
pub fn sync(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_window(WINDOW_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    let config = {
        let state = app.state::<Mutex<AppConfig>>();
        let guard = state
            .lock()
            .map_err(|_| "Config state poisoned".to_string())?;
        guard.clone()
    };
    let manager = app.state::<WebviewManager>();
    let mut map = manager
        .webviews
        .lock()
        .map_err(|_| "WebviewManager poisoned".to_string())?;

    // Close webviews whose server was removed.
    let stale: Vec<String> = map
        .keys()
        .filter(|id| !config.servers.iter().any(|s| s.id == **id))
        .cloned()
        .collect();
    for id in stale {
        let label = map.remove(&id).expect("key checked above");
        // Forget the removed server's unread badge and recompute the dock
        // total (entry clear + recompute on remove-server).
        badges::clear_server_unread(app, &id);
        match app.get_webview(&label) {
            Some(wv) => {
                wv.close()
                    .map_err(|e| format!("close webview {label}: {e}"))?;
                log::info!("closed content webview {label}");
            }
            None => log::warn!("webview {label} vanished before close"),
        }
    }

    // Create webviews for newly added servers.
    for server in &config.servers {
        if map.contains_key(&server.id) {
            continue;
        }
        let wv = create_content_webview(app, &window, server)?;
        log::info!("created content webview {} for {}", wv.label(), server.url);
        map.insert(server.id.clone(), wv.label().to_string());
    }

    // Visibility: only the active server is shown. resolve_active self-heals
    // a None/unknown active_server to the first server (visibility only —
    // the persisted config is left alone; the next explicit selection or
    // add_server rewrites it).
    let active = resolve_active(&config);
    for server in &config.servers {
        let Some(label) = map.get(&server.id) else {
            continue;
        };
        let Some(wv) = app.get_webview(label) else {
            continue;
        };
        let is_active = active.as_deref() == Some(server.id.as_str());
        if is_active {
            wv.show().map_err(|e| format!("show {label}: {e}"))?;
        } else {
            wv.hide().map_err(|e| format!("hide {label}: {e}"))?;
        }
    }
    // Rail auto-hide: a mutation re-derives visibility from the server count —
    // a tray-revealed rail (no mutation yet) hides again once one happens.
    let visible = rail_visible(config.servers.len(), false);
    manager
        .rail_revealed
        .store(visible, std::sync::atomic::Ordering::Relaxed);
    if let Some(chrome) = app.get_webview(CHROME_LABEL) {
        let r = if visible {
            chrome.show()
        } else {
            chrome.hide()
        };
        if let Err(e) = r {
            log::warn!("rail show/hide failed: {e}");
        }
    }
    drop(map);
    relayout(&window);
    Ok(())
}

/// Re-applies chrome + content bounds. Called on every window resize so
/// the rail stays fixed-width (see module docs). The rail's EFFECTIVE width is
/// zero while auto-hidden (exactly one server, not tray-revealed) — one layout
/// function covers both states, no special-casing at the show/hide sites.
pub fn relayout(window: &Window) {
    let app = window.app_handle();
    let Some(manager) = app.try_state::<WebviewManager>() else {
        return;
    };
    let server_count = app
        .try_state::<Mutex<AppConfig>>()
        .and_then(|state| state.lock().ok().map(|c| c.servers.len()))
        .unwrap_or(0);
    let revealed = manager
        .rail_revealed
        .load(std::sync::atomic::Ordering::Relaxed);
    let rail = if rail_visible(server_count, revealed) {
        RAIL_WIDTH
    } else {
        0.0
    };
    let Ok(map) = manager.webviews.lock() else {
        return;
    };
    let (w, h) = logical_inner(window);
    let mut labels: Vec<String> = map.values().cloned().collect();
    drop(map);
    labels.push(CHROME_LABEL.to_string());
    for label in labels {
        let Some(wv) = app.get_webview(&label) else {
            continue;
        };
        let bounds = if label == CHROME_LABEL {
            (LogicalPosition::new(0.0, 0.0), LogicalSize::new(rail, h))
        } else {
            (
                LogicalPosition::new(rail, 0.0),
                LogicalSize::new((w - rail).max(0.0), h),
            )
        };
        if let Err(e) = wv
            .set_position(bounds.0)
            .and_then(|()| wv.set_size(bounds.1))
        {
            log::warn!("relayout {label} failed: {e}");
        }
    }
}

/// Tray "Add server…" (wave 9): temporarily reveal the hidden rail and focus
/// it so the always-present "+ Add server" form is reachable. Cleared by the
/// next config mutation (sync) — a cancelled reveal persists until then; an
/// accepted quirk (documented in the spec), never blocking.
pub fn reveal_rail(app: &AppHandle) {
    let Some(window) = app.get_window(WINDOW_LABEL) else {
        return;
    };
    if let Some(manager) = app.try_state::<WebviewManager>() {
        manager
            .rail_revealed
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    if let Some(chrome) = app.get_webview(CHROME_LABEL) {
        if let Err(e) = chrome.show() {
            log::warn!("reveal rail (show) failed: {e}");
        }
        if let Err(e) = chrome.set_focus() {
            log::warn!("reveal rail (focus) failed: {e}");
        }
    }
    relayout(&window);
}

/// Smoke seam (wave 9): the current rail reveal/visibility flag, so the
/// smoke bin can assert the auto-hidden state headlessly (Webview has no
/// is_visible accessor). `#[doc(hidden)]` like `note_title`.
#[doc(hidden)]
pub fn is_rail_revealed(app: &AppHandle) -> bool {
    app.try_state::<WebviewManager>()
        .map(|m| m.rail_revealed.load(std::sync::atomic::Ordering::Relaxed))
        .unwrap_or(false)
}

fn create_content_webview(
    app: &AppHandle,
    window: &Window,
    server: &ServerConfig,
) -> Result<Webview, String> {
    let label = label_for(&server.id);
    let url: Url = server
        .url
        .parse()
        .map_err(|e| format!("invalid server url {}: {e}", server.url))?;
    let (w, h) = logical_inner(window);
    let nav_server = url.clone();
    let nav_label = label.clone();
    let opener_app = app.clone();

    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .initialization_script(NOTIFY_SHIM)
        .on_navigation(move |nav| {
            let allowed = navigation_allowed(&nav_server, nav);
            if !allowed {
                log::warn!(
                    "blocked navigation in {nav_label}: {nav} (server {} allows only its own origin or an https upgrade of it)",
                    nav_server
                );
            }
            allowed
        })
        .on_new_window(move |url, _features| {
            // Never open an embedded window; external targets go to the
            // system browser via the opener plugin.
            if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
                match opener_app.opener().open_url(url.as_str(), None::<&str>) {
                    Ok(()) => log::info!("opened {url} in system browser"),
                    Err(e) => log::warn!("open {url} in system browser failed: {e}"),
                }
            } else {
                log::warn!("denied new-window request for non-http scheme: {url}");
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(|wv, title| {
            log::info!("document title [{}]: {title}", wv.label());
            // Push-driven badges: parse the title and update per-server
            // badge state + events + dock badge. Content webview labels are
            // always "srv-<server-id>" (label_for).
            if let Some(server_id) = wv.label().strip_prefix("srv-") {
                note_title(wv.app_handle(), server_id, &title);
            }
        })
        .on_page_load(|wv, payload| {
            log::info!("page load [{}] {:?} {}", wv.label(), payload.event(), payload.url());
        })
        .on_download(|wv, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    // wry already seeded <Downloads>/<suggested-filename> on both
                    // platforms (macOS deduped; Windows from WebView2's
                    // ResultFilePath) — accept as-is, never rewrite.
                    log::info!("download [{}] {} -> {}", wv.label(), url, destination.display());
                }
                DownloadEvent::Finished { url, path, success } => {
                    if !success {
                        log::warn!("download [{}] {} failed", wv.label(), url);
                    } else if let Some(p) = path {
                        log::info!("download [{}] {} saved", wv.label(), p.display());
                        notify::show_toast(wv.app_handle(), "Download complete", &download_done_body(&p));
                    }
                }
                _ => (),
            }
            true
        });

    // Session isolation. macOS WKWebView has no per-webview data directory,
    // so a UUID-derived non-persistent-unique data store key is used
    // instead (spike S2); other desktop platforms use a real directory.
    #[cfg(target_os = "macos")]
    {
        builder = builder.data_store_identifier(store_key(&server.id));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app data dir: {e}"))?
            .join("servers")
            .join(&server.id);
        std::fs::create_dir_all(&dir).map_err(|e| format!("create {dir:?}: {e}"))?;
        builder = builder.data_directory(dir);
    }

    window
        .add_child(
            builder,
            LogicalPosition::new(RAIL_WIDTH, 0.0),
            LogicalSize::new((w - RAIL_WIDTH).max(0.0), h),
        )
        .map_err(|e| format!("add content webview {label}: {e}"))
}

/// Push-driven unread-badge seam: parse a content webview's document title
/// and update badge state, `server-badge://<id>` events, and the dock
/// badge. Called by the real `on_document_title_changed` handler above AND
/// by the smoke bin (badge data must come from pushed title events — never
/// polling evals, whose callbacks may not fire on hidden webviews, the
/// Task 4 quirk — so this fn is the single entry point both callers share).
#[doc(hidden)]
pub fn note_title(app: &AppHandle, server_id: &str, title: &str) {
    match badges::unread_from_title(title) {
        Some(n) => badges::set_server_unread(app, server_id, n),
        None => badges::clear_server_unread(app, server_id),
    }
}

/// Navigation guard for content webviews: allow the server's own origin
/// (scheme+host+port), an http→https upgrade of it, `about:blank` (wry's
/// initial document), and tauri-internal endpoints; block everything else
/// (OAuth popup farms, phishing redirects, ...). External opens still
/// reach the user via the new-window handler / normal links targeting
/// `_blank`.
fn navigation_allowed(server: &Url, nav: &Url) -> bool {
    if nav.as_str() == "about:blank" {
        return true;
    }
    if nav.scheme() == "tauri" {
        return true;
    }
    if nav.host_str() == Some("ipc.localhost") {
        return true;
    }
    same_origin(server, nav) || is_scheme_upgrade(server, nav)
}

/// http→https upgrade of the SAME host+port: a server configured over
/// plain http commonly 301s its first visit to the https form (TLS-
/// terminating proxy), and blocking that would strand the webview on an
/// error page. Only the upgrade direction is allowed — https→http is
/// always a downgrade — and the host and explicit port must be unchanged,
/// so an "upgrade" cannot smuggle the navigation to a different endpoint.
/// Implicit ports (`http://h` → `https://h`) upgrade too: no explicit port
/// is stated on either side, only the scheme default differs.
fn is_scheme_upgrade(server: &Url, nav: &Url) -> bool {
    server.scheme() == "http"
        && nav.scheme() == "https"
        && server.host_str() == nav.host_str()
        && server.port() == nav.port()
}

/// Rail auto-hide (wave 9 D1): the rail is HIDDEN when exactly one server is
/// configured (nothing to switch), visible at zero (it is the only add-server
/// UI) and at two+ (it is the switcher). `revealed` is the tray "Add server…"
/// escape hatch while hidden — pure so the matrix is unit-testable.
pub fn rail_visible(server_count: usize, revealed: bool) -> bool {
    server_count != 1 || revealed
}

/// Download-completion toast body: `Saved <file> to <dir>`, name bounded so a
/// hostile filename cannot balloon the toast (notify.rs truncates at 200 chars
/// anyway — this keeps the useful prefix). Pure so it is unit-testable.
#[doc(hidden)]
pub fn download_done_body(path: &std::path::Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let dir = path
        .parent()
        .map(|p| p.display().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "your downloads folder".to_string());
    let mut name: String = name.chars().collect();
    if name.chars().count() > 80 {
        let bounded: String = name.chars().take(80).collect();
        name = format!("{bounded}…");
    }
    format!("Saved {name} to {dir}")
}

/// Which server's webview should be VISIBLE: the configured active server
/// when it still exists, else the first server. Pure so the fallback is
/// unit-testable; `sync` uses it so a stale/missing `active_server`
/// (hand-edited config, legacy file) can never leave every content webview
/// hidden behind a blank content area.
fn resolve_active(config: &AppConfig) -> Option<String> {
    match config.active_server.as_deref() {
        Some(id) if config.servers.iter().any(|s| s.id == id) => Some(id.to_string()),
        _ => config.servers.first().map(|s| s.id.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    /// The injected init script is the real shim (compile-time bundle of
    /// desktop/ui/notify-shim.js), not a leftover placeholder.
    #[test]
    fn notify_shim_is_the_real_script() {
        assert!(
            NOTIFY_SHIM.contains("desktop_notify"),
            "shim must invoke desktop_notify"
        );
        assert!(!NOTIFY_SHIM.contains("PLACEHOLDER"));
        assert!(
            NOTIFY_SHIM.contains("'granted'"),
            "shim must report permission granted"
        );
        assert!(
            NOTIFY_SHIM.contains("__TAURI__"),
            "shim must guard on the Tauri global"
        );
    }

    #[test]
    fn allows_same_origin_and_default_port_equivalents() {
        let server = url("https://labhub.taylabs.org");
        assert!(navigation_allowed(
            &server,
            &url("https://labhub.taylabs.org/sign-in")
        ));
        assert!(navigation_allowed(
            &server,
            &url("https://labhub.taylabs.org:443/x")
        ));
    }

    #[test]
    fn blocks_cross_origin_and_non_http() {
        let server = url("https://labhub.taylabs.org");
        assert!(!navigation_allowed(
            &server,
            &url("https://evil.example.org")
        ));
        assert!(!navigation_allowed(
            &server,
            &url("https://labhub.taylabs.org.evil.org")
        ));
        assert!(!navigation_allowed(
            &server,
            &url("http://labhub.taylabs.org")
        ));
        assert!(!navigation_allowed(
            &server,
            &url("https://labhub.taylabs.org:8443")
        ));
        assert!(!navigation_allowed(&server, &url("file:///etc/passwd")));
    }

    #[test]
    fn allows_blank_and_tauri_internal() {
        let server = url("https://labhub.taylabs.org");
        assert!(navigation_allowed(&server, &url("about:blank")));
        assert!(navigation_allowed(
            &server,
            &url("tauri://localhost/index.html")
        ));
        assert!(navigation_allowed(
            &server,
            &url("http://ipc.localhost/callback")
        ));
    }

    #[test]
    fn non_default_ports_must_match() {
        let server = url("http://localhost:8080");
        assert!(navigation_allowed(
            &server,
            &url("http://localhost:8080/app")
        ));
        assert!(!navigation_allowed(
            &server,
            &url("http://localhost:9090/app")
        ));
    }

    // --- http→https scheme upgrade ---

    #[test]
    fn scheme_upgrade_same_host_is_allowed() {
        let server = url("http://lab.example.com");
        assert!(navigation_allowed(
            &server,
            &url("https://lab.example.com/sign-in")
        ));
        // Explicit ports upgrade only to the SAME port.
        let server = url("http://localhost:8080");
        assert!(navigation_allowed(
            &server,
            &url("https://localhost:8080/app")
        ));
    }

    #[test]
    fn scheme_downgrade_https_to_http_is_blocked() {
        let server = url("https://lab.example.com");
        assert!(!navigation_allowed(
            &server,
            &url("http://lab.example.com/app")
        ));
    }

    #[test]
    fn plain_http_cross_host_stays_blocked() {
        let server = url("http://a.example.org");
        assert!(!navigation_allowed(
            &server,
            &url("http://b.example.org/app")
        ));
    }

    #[test]
    fn upgrade_to_a_different_host_is_blocked() {
        let server = url("http://a.example.org");
        assert!(!navigation_allowed(
            &server,
            &url("https://b.example.org/app")
        ));
        // Host suffix tricks are different hosts, upgrade or not.
        assert!(!navigation_allowed(
            &server,
            &url("https://a.example.org.evil.org/app")
        ));
    }

    #[test]
    fn upgrade_cannot_change_the_explicit_port() {
        let server = url("http://localhost:8080");
        assert!(!navigation_allowed(
            &server,
            &url("https://localhost:9090/app")
        ));
        // ... nor silently drop an explicit port for the scheme default.
        assert!(!navigation_allowed(&server, &url("https://localhost/app")));
    }

    // --- resolve_active (visibility self-heal) ---

    fn server_cfg(id: &str) -> crate::config::ServerConfig {
        crate::config::ServerConfig {
            id: id.to_string(),
            name: id.to_string(),
            url: format!("https://{id}.example.org"),
        }
    }

    #[test]
    fn resolve_active_prefers_a_valid_configured_active_server() {
        let config = AppConfig {
            servers: vec![server_cfg("a"), server_cfg("b")],
            active_server: Some("b".into()),
            close_to_tray: false,
        };
        assert_eq!(resolve_active(&config).as_deref(), Some("b"));
    }

    #[test]
    fn resolve_active_falls_back_to_first_when_none() {
        let config = AppConfig {
            servers: vec![server_cfg("a"), server_cfg("b")],
            active_server: None,
            close_to_tray: false,
        };
        assert_eq!(resolve_active(&config).as_deref(), Some("a"));
    }

    #[test]
    fn resolve_active_falls_back_to_first_when_stale() {
        // active_server pointing at a since-removed server id must not
        // leave every webview hidden (blank content area).
        let config = AppConfig {
            servers: vec![server_cfg("a"), server_cfg("b")],
            active_server: Some("gone".into()),
            close_to_tray: false,
        };
        assert_eq!(resolve_active(&config).as_deref(), Some("a"));
    }

    #[test]
    fn resolve_active_is_none_with_no_servers() {
        assert_eq!(resolve_active(&AppConfig::default()), None);
    }

    // --- rail auto-hide (wave 9) ---

    #[test]
    fn rail_hides_exactly_at_one_server() {
        assert!(rail_visible(0, false));
        assert!(!rail_visible(1, false));
        assert!(rail_visible(2, false));
    }

    #[test]
    fn tray_reveal_shows_the_hidden_rail() {
        assert!(rail_visible(1, true));
    }

    // --- downloads (wave 10) ---

    #[test]
    fn download_done_body_names_file_and_dir() {
        let body = download_done_body(std::path::Path::new(
            "/Users/roland/Downloads/ra-acknowledgments.csv",
        ));
        assert_eq!(
            body,
            "Saved ra-acknowledgments.csv to /Users/roland/Downloads"
        );
    }

    #[test]
    fn download_done_body_survives_missing_metadata() {
        assert!(download_done_body(std::path::Path::new("")).starts_with("Saved "));
        assert!(download_done_body(std::path::Path::new("/only-dir/")).starts_with("Saved "));
    }

    #[test]
    fn download_done_body_bounds_a_hostile_filename() {
        let long = std::path::Path::new("/tmp/").join("x".repeat(300));
        let body = download_done_body(&long);
        assert!(
            body.chars().count() <= 100,
            "bounded body, got {}",
            body.chars().count()
        );
        // The ellipsis terminates the truncated NAME mid-body (`Saved <name>…
        // to <dir>`), so assert presence, not a body-final position.
        assert!(body.contains('…'));
    }
}
