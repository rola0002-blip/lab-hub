pub mod badges;
pub mod commands;
pub mod config;
pub mod notify;
pub mod servers;
pub mod tray;
pub mod updater;
pub mod webviews;

use std::sync::Mutex;
use tauri::{Listener, Manager};

/// Shared app bootstrap: load config, register managed state, create the
/// main window + chrome rail + content webviews, attach the tray. Used by
/// `run` and the `smoke` regression binary so both exercise identical
/// wiring.
pub fn bootstrap(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = config::load(app.handle());
    app.manage(Mutex::new(config));
    app.manage(webviews::WebviewManager::default());
    app.manage(badges::BadgeState::default());
    app.manage(notify::NotifyState::default());
    webviews::setup(app.handle())?;
    tray::init(app.handle())?;
    // Tray "Add server…" (wave 9): reveal the (possibly auto-hidden) rail so
    // the always-present add form is reachable (the CHECK_UPDATES listener pattern).
    let reveal_app = app.handle().clone();
    app.listen(tray::ADD_SERVER_EVENT, move |_event| {
        tray::show_main(&reveal_app);
        crate::webviews::reveal_rail(&reveal_app);
    });
    updater::init(app.handle());
    Ok(())
}

/// Shared window-event hook:
/// - resize keeps the rail fixed-width
/// - a freshly focused main window consumes a pending notification click
///   target (desktop toasts give no click callback — see `notify.rs`)
/// - close either hides to the tray (close-to-tray on: the window is
///   merely hidden, so title events and badges keep flowing) or proceeds
///   — Tauri exits the app when the last window closes (RunEvent::
///   ExitRequested), and the window-state plugin saves on Exit.
pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == webviews::WINDOW_LABEL {
        match event {
            tauri::WindowEvent::Resized(_) => {
                // Fires for user resizes AND the window-state plugin's
                // restore on startup: relayout re-applies rail/content
                // bounds from the (possibly restored) inner size either
                // way, so no ordering fix is needed — this log makes the
                // restore -> relayout sequence visible.
                log::info!("main window resized: relayout (rail auto-hides at one server)");
                webviews::relayout(window);
            }
            tauri::WindowEvent::Focused(true) => notify::consume_pending_click(window.app_handle()),
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let close_to_tray = window
                    .app_handle()
                    .try_state::<Mutex<config::AppConfig>>()
                    .and_then(|state| state.lock().ok().map(|c| c.close_to_tray))
                    .unwrap_or(false);
                if tray::close_stays_in_tray(window.label(), close_to_tray) {
                    api.prevent_close();
                    if let Err(e) = window.hide() {
                        log::warn!("close-to-tray hide failed: {e}");
                    }
                    log::info!("close-to-tray: main window hidden (Show/Quit via tray)");
                } else {
                    log::info!(
                        "main window close: proceeding (app exits when the last window closes)"
                    );
                }
            }
            _ => {}
        }
    }
}

/// Window-state plugin as configured for LabHub: restores/saves size,
/// position and maximized state. VISIBLE is deliberately excluded —
/// quitting from the tray with the window hidden (close-to-tray) must
/// not restore hidden on next launch. Shared by `run` and the smoke
/// binary so both exercise identical wiring; must be registered BEFORE
/// `setup` window creation so its on_window_ready hook restores the
/// runtime-created "main" window by label.
pub fn window_state_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_window_state::Builder::new()
        .with_state_flags(
            tauri_plugin_window_state::StateFlags::SIZE
                | tauri_plugin_window_state::StateFlags::POSITION
                | tauri_plugin_window_state::StateFlags::MAXIMIZED,
        )
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(window_state_plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Auto-updater (Task 8): endpoints/pubkey live in
        // tauri.conf.json `plugins.updater`; all driving is Rust-side
        // (updater.rs) — no capability grants the JS API, so remote pages
        // cannot touch it. tauri-plugin-process is the JS-side relaunch
        // companion (also ungranted); the Rust flow uses core
        // AppHandle::request_restart.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Production logger: everything the shell already logs via `log::`
        // (nav-guard blocks, rate-limit drops, webview lifecycle) goes to
        // stderr plus a rotating file in the OS app-log dir (5 MB x 3
        // files). Debug in dev builds, info in release. Rust-side only —
        // no JS capability needed.
        .plugin(
            tauri_plugin_log::Builder::new()
                // Defaults are [Stdout, LogDir{None}]; clear so exactly the
                // two targets below are installed (no duplicate log file).
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stderr,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("labhub-desktop.log".into()),
                    },
                ))
                .max_file_size(5 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .setup(|app| bootstrap(app))
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::set_active,
            commands::get_app_config,
            commands::set_close_to_tray,
            notify::desktop_notify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
