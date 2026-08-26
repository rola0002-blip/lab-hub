//! Tray icon + menu, and the close-to-tray decision.
//!
//! The tray icon itself is created by Tauri at startup from the
//! `app.trayIcon` section of `tauri.conf.json` (auto id "main", bundled
//! app icon, tooltip "LabHub"; tray-icon resizes it to 18 pt on macOS).
//! [`init`] attaches the menu and event handlers to that icon, and
//! [`refresh`] rebuilds the menu — it is called from
//! `commands::after_mutation`, the same place `servers-changed` is
//! emitted, so add/remove keep the tray's server list in sync.
//!
//! Menu structure (v1), labels mirrored 1:1 by [`build_menu_items`]:
//!
//! ```text
//! <server name>        one item per configured server
//! <server name>        click -> set active + show/focus main window
//! ───────────
//! Add server…          emits `tray://add-server` (reveals the auto-hidden rail)
//! Check for Updates    emits `tray://check-updates` (Task 8 listens)
//! ───────────
//! Show LabHub          show + focus main window
//! Quit LabHub          app.exit(0)
//! ```
//!
//! With no servers, a disabled "(No servers)" placeholder keeps the
//! shape stable.
//!
//! Left-click: macOS shows this menu (menu-on-left-click default); on
//! Windows, menu-on-left-click is disabled at [`init`] and the click
//! instead shows + focuses the main window (the Windows tray
//! convention) via the [`TrayIconEvent`] handler.
//!
//! Close-to-tray: the main window's `CloseRequested` handler (see
//! `lib.rs::handle_window_event`) consults [`close_stays_in_tray`] —
//! when close-to-tray is on, the close is prevented and the window is
//! hidden instead; hidden windows keep receiving title events, so
//! badge/notification paths are unaffected (macOS acceptable).

use std::sync::Mutex;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

#[cfg(not(target_os = "macos"))]
use tauri::tray::{MouseButton, MouseButtonState};

use crate::config::AppConfig;
use crate::webviews;

/// Tray id Tauri assigns the config-declared icon (`app.trayIcon`
/// defaults its id to "main").
pub const TRAY_ID: &str = "main";

/// Menu item ids — stable across refreshes; handlers dispatch on these.
pub const CHECK_UPDATES_ID: &str = "check_updates";
pub const ADD_SERVER_ID: &str = "add_server";
pub const SHOW_ID: &str = "show";
pub const QUIT_ID: &str = "quit";
/// Prefix of per-server item ids; the remainder is the server id (a
/// hyphenated UUID, so the split is unambiguous).
pub const SERVER_ITEM_PREFIX: &str = "server:";

/// Event emitted when the tray "Check for Updates" item is clicked; the
/// updater (updater.rs) listens and runs an interactive check.
pub const CHECK_UPDATES_EVENT: &str = "tray://check-updates";

/// Event emitted when the tray "Add server…" item is clicked; webviews'
/// bootstrap listener reveals the (possibly hidden) rail (the CHECK_UPDATES pattern).
pub const ADD_SERVER_EVENT: &str = "tray://add-server";

/// Pure close decision shared with `lib.rs::handle_window_event`: only
/// the main window with close-to-tray enabled hides on close; every
/// other window (or the flag off) closes normally.
pub fn close_stays_in_tray(label: &str, close_to_tray: bool) -> bool {
    close_to_tray && label == webviews::WINDOW_LABEL
}

/// Server id -> tray menu item id.
fn server_item_id(server_id: &str) -> String {
    format!("{SERVER_ITEM_PREFIX}{server_id}")
}

/// Labels of the items the tray menu is built from, in order — the
/// pure half of [`refresh`], unit-testable and smoke-assertable:
/// one entry per server (or a "(No servers)" placeholder), then the
/// four fixed items.
pub fn build_menu_items(config: &AppConfig) -> Vec<String> {
    let mut labels: Vec<String> = config.servers.iter().map(|s| s.name.clone()).collect();
    if labels.is_empty() {
        labels.push("(No servers)".into());
    }
    labels.push("Add server…".into());
    labels.push("Check for Updates".into());
    labels.push("Show LabHub".into());
    labels.push("Quit LabHub".into());
    labels
}

/// Builds the tray menu from config, mirroring [`build_menu_items`]
/// (ids for dispatch, labels for display, placeholder disabled).
fn build_menu(app: &AppHandle, config: &AppConfig) -> Result<Menu<Wry>, tauri::Error> {
    let menu = Menu::new(app)?;
    if config.servers.is_empty() {
        menu.append(&MenuItem::with_id(
            app,
            "no_servers",
            "(No servers)",
            false,
            None::<&str>,
        )?)?;
    } else {
        for server in &config.servers {
            menu.append(&MenuItem::with_id(
                app,
                server_item_id(&server.id),
                &server.name,
                true,
                None::<&str>,
            )?)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        ADD_SERVER_ID,
        "Add server…",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        CHECK_UPDATES_ID,
        "Check for Updates",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        SHOW_ID,
        "Show LabHub",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        QUIT_ID,
        "Quit LabHub",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// Attaches menu/tray event handlers to the config-declared tray icon
/// and builds the first menu. Called once from `bootstrap`.
pub fn init(app: &AppHandle) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or_else(|| {
        format!("tray icon '{TRAY_ID}' missing (check tauri.conf.json app.trayIcon)")
    })?;
    tray.on_menu_event(on_menu_event);
    tray.on_tray_icon_event(on_tray_icon_event);
    // Windows convention: left click activates the window (handled in
    // on_tray_icon_event); the menu stays on right click. macOS keeps
    // the default menu-on-left-click.
    #[cfg(windows)]
    tray.set_show_menu_on_left_click(false)
        .map_err(|e| format!("disable menu-on-left-click: {e}"))?;
    refresh(app);
    log::info!("tray ready: icon '{TRAY_ID}', menu + handlers attached");
    Ok(())
}

/// Rebuilds the tray menu from the current config. Idempotent, never
/// panics (missing tray / poisoned state log a warning and return), so
/// `commands::after_mutation` can call it unconditionally.
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        log::warn!("tray refresh skipped: icon '{TRAY_ID}' not found");
        return;
    };
    let Ok(config) = app.state::<Mutex<AppConfig>>().lock().map(|g| g.clone()) else {
        log::warn!("tray refresh skipped: config state poisoned");
        return;
    };
    let labels = build_menu_items(&config);
    match build_menu(app, &config).and_then(|menu| tray.set_menu(Some(menu))) {
        Ok(()) => log::info!("tray menu refreshed: {}", labels.join(" | ")),
        Err(e) => log::warn!("tray menu refresh failed: {e}"),
    }
}

/// Shows + focuses the main window. show-then-focus matters when the
/// window is hidden (close-to-tray): a hidden window has no focus to
/// claim, so focus alone would not reveal it.
pub fn show_main(app: &AppHandle) {
    match app.get_window(webviews::WINDOW_LABEL) {
        Some(window) => {
            if let Err(e) = window.show() {
                log::warn!("show main window failed: {e}");
            }
            if let Err(e) = window.set_focus() {
                log::warn!("focus main window failed: {e}");
            }
            log::info!("main window shown + focused");
        }
        None => log::warn!("show main window: '{}' not found", webviews::WINDOW_LABEL),
    }
}

/// Tray menu dispatch. Runs on the main thread; `set_menu` inside
/// (`refresh` via `set_active`) executes inline there, no deadlock.
fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        CHECK_UPDATES_ID => {
            log::info!("tray check-updates clicked (emitting {CHECK_UPDATES_EVENT})");
            if let Err(e) = app.emit(CHECK_UPDATES_EVENT, ()) {
                log::warn!("emit {CHECK_UPDATES_EVENT} failed: {e}");
            }
        }
        ADD_SERVER_ID => {
            log::info!("tray add-server clicked (emitting {ADD_SERVER_EVENT})");
            if let Err(e) = app.emit(ADD_SERVER_EVENT, ()) {
                log::warn!("emit {ADD_SERVER_EVENT} failed: {e}");
            }
        }
        SHOW_ID => show_main(app),
        QUIT_ID => {
            log::info!("tray quit clicked: exiting");
            app.exit(0);
        }
        id => {
            if let Some(server_id) = id.strip_prefix(SERVER_ITEM_PREFIX) {
                match crate::commands::set_active(app.clone(), app.state(), server_id.to_string()) {
                    Ok(()) => log::info!("tray: switched to server {server_id}"),
                    Err(e) => log::warn!("tray: switch to server {server_id} failed: {e}"),
                }
                show_main(app);
            }
        }
    }
}

/// Tray icon clicks. macOS: the menu already opened on click — nothing
/// to do. Other desktops: left click shows + focuses the window.
fn on_tray_icon_event(tray: &TrayIcon<Wry>, event: TrayIconEvent) {
    #[cfg(not(target_os = "macos"))]
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main(tray.app_handle());
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (tray, event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServerConfig;

    fn server_cfg(id: &str, name: &str) -> ServerConfig {
        ServerConfig {
            id: id.to_string(),
            name: name.to_string(),
            url: format!("https://{id}.example.org"),
        }
    }

    // --- close_stays_in_tray ---

    #[test]
    fn close_stays_in_tray_only_for_main_window_with_flag_on() {
        assert!(close_stays_in_tray("main", true));
    }

    #[test]
    fn close_proceeds_when_flag_off() {
        assert!(!close_stays_in_tray("main", false));
    }

    #[test]
    fn close_proceeds_for_other_windows_even_with_flag_on() {
        assert!(!close_stays_in_tray("settings", true));
        assert!(!close_stays_in_tray("", true));
    }

    // --- build_menu_items ---

    #[test]
    fn menu_items_with_no_servers_use_placeholder_plus_fixed_tail() {
        let labels = build_menu_items(&AppConfig::default());
        assert_eq!(
            labels,
            vec![
                "(No servers)".to_string(),
                "Add server…".into(),
                "Check for Updates".into(),
                "Show LabHub".into(),
                "Quit LabHub".into(),
            ]
        );
    }

    #[test]
    fn menu_items_list_every_server_then_fixed_tail() {
        let config = AppConfig {
            servers: vec![server_cfg("a", "Tay Labs"), server_cfg("b", "Beta Lab")],
            active_server: Some("b".into()),
            close_to_tray: false,
        };
        let labels = build_menu_items(&config);
        assert_eq!(labels.len(), 6, "2 servers + 4 fixed items");
        assert_eq!(labels[0], "Tay Labs");
        assert_eq!(labels[1], "Beta Lab");
        assert_eq!(labels[2], "Add server…");
        assert_eq!(labels[3], "Check for Updates");
        assert_eq!(labels[4], "Show LabHub");
        assert_eq!(labels[5], "Quit LabHub");
    }

    #[test]
    fn menu_item_count_is_servers_plus_four() {
        let config = AppConfig {
            servers: vec![server_cfg("a", "A")],
            ..AppConfig::default()
        };
        assert_eq!(build_menu_items(&config).len(), 5);
    }

    #[test]
    fn menu_uses_server_names_not_urls_or_ids() {
        let config = AppConfig {
            servers: vec![server_cfg("9af15b3d-6f1d-5e3f-8bdc-7a2e5a1c0d11", "LabHub")],
            ..AppConfig::default()
        };
        assert_eq!(build_menu_items(&config)[0], "LabHub");
    }

    // --- item id scheme ---

    #[test]
    fn server_item_id_roundtrips_through_prefix() {
        let id = "9af15b3d-6f1d-5e3f-8bdc-7a2e5a1c0d11";
        let item_id = server_item_id(id);
        assert_eq!(item_id.strip_prefix(SERVER_ITEM_PREFIX), Some(id));
    }

    #[test]
    fn fixed_ids_never_carry_the_server_prefix() {
        // The dispatcher routes on the prefix; fixed ids must not be
        // mistaken for server items.
        for id in [CHECK_UPDATES_ID, ADD_SERVER_ID, SHOW_ID, QUIT_ID] {
            assert!(!id.starts_with(SERVER_ITEM_PREFIX));
        }
    }
}
