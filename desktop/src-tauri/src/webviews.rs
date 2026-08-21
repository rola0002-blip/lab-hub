//! Chrome rail + per-server content webview lifecycle.
//!
//! Window "main" hosts a fixed [`RAIL_WIDTH`]-logical-px local chrome rail
//! (webview "chrome") plus one remote content webview per configured server
//! (webview "srv-<server-id>"); switching servers toggles visibility only,
//! so sessions and scroll positions survive. Bounds are managed manually
//! (no `auto_resize`): [`relayout`] re-applies them on every
//! `WindowEvent::Resized` so the rail stays exactly 240 px wide — with
//! `auto_resize` each webview keeps *proportional* size instead (spike S1
//! quirk, docs/handoffs/2026-08-21-sp11-spike.md).

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl,
    Window, WindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

use crate::badges;
use crate::config::{AppConfig, ServerConfig};
use crate::servers::{same_origin, store_key};

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

    // Visibility: only the active server is shown.
    for server in &config.servers {
        let Some(label) = map.get(&server.id) else {
            continue;
        };
        let Some(wv) = app.get_webview(label) else {
            continue;
        };
        let is_active = config.active_server.as_deref() == Some(server.id.as_str());
        if is_active {
            wv.show().map_err(|e| format!("show {label}: {e}"))?;
        } else {
            wv.hide().map_err(|e| format!("hide {label}: {e}"))?;
        }
    }
    drop(map);
    relayout(&window);
    Ok(())
}

/// Re-applies chrome + content bounds. Called on every window resize so
/// the rail stays fixed-width (see module docs).
pub fn relayout(window: &Window) {
    let app = window.app_handle();
    let Some(manager) = app.try_state::<WebviewManager>() else {
        return;
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
            (
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(RAIL_WIDTH, h),
            )
        } else {
            (
                LogicalPosition::new(RAIL_WIDTH, 0.0),
                LogicalSize::new((w - RAIL_WIDTH).max(0.0), h),
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

    #[allow(unused_mut)]
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .initialization_script(NOTIFY_SHIM)
        .on_navigation(move |nav| {
            let allowed = navigation_allowed(&nav_server, nav);
            if !allowed {
                log::warn!(
                    "blocked navigation in {nav_label}: {nav} (server {} allows only its own origin)",
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
/// (scheme+host+port), `about:blank` (wry's initial document), and
/// tauri-internal endpoints; block everything else (OAuth popup farms,
/// phishing redirects, ...). External opens still reach the user via the
/// new-window handler / normal links targeting `_blank`.
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
    same_origin(server, nav)
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
}
