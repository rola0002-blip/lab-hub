pub mod commands;
pub mod config;
pub mod servers;

use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config = config::load(app.handle());
            app.manage(Mutex::new(config));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::set_active,
            commands::get_app_config,
            commands::set_close_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
