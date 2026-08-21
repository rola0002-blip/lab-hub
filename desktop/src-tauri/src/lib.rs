pub mod commands;
pub mod config;
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
    webviews::setup(app.handle())?;
    Ok(())
}

/// Shared window-event hook (resize keeps the rail fixed-width).
pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == webviews::WINDOW_LABEL {
        if let tauri::WindowEvent::Resized(_) = event {
            webviews::relayout(window);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| bootstrap(app))
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::set_active,
            commands::get_app_config,
            commands::set_close_to_tray,
            commands::desktop_notify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
