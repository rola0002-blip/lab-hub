pub mod badges;
pub mod commands;
pub mod config;
pub mod notify;
pub mod servers;
pub mod webviews;

use std::sync::Mutex;
use tauri::Manager;

/// Shared app bootstrap: load config, register managed state, create the
/// main window + chrome rail + content webviews. Used by `run` and the
/// `smoke` regression binary so both exercise identical wiring.
pub fn bootstrap(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = config::load(app.handle());
    app.manage(Mutex::new(config));
    app.manage(webviews::WebviewManager::default());
    app.manage(badges::BadgeState::default());
    app.manage(notify::NotifyState::default());
    webviews::setup(app.handle())?;
    Ok(())
}

/// Shared window-event hook: resize keeps the rail fixed-width, and a
/// freshly focused main window consumes a pending notification click
/// target (desktop toasts give no click callback — see `notify.rs`).
pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == webviews::WINDOW_LABEL {
        match event {
            tauri::WindowEvent::Resized(_) => webviews::relayout(window),
            tauri::WindowEvent::Focused(true) => notify::consume_pending_click(window.app_handle()),
            _ => {}
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
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
