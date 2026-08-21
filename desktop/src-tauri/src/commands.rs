//! Tauri commands over the managed `Mutex<AppConfig>` state.
//!
//! The mutex is never held across an `.await` (see `add_server`), and no
//! command creates webviews, so the Windows async-command deadlock warning
//! does not apply here.

use crate::config::{normalize_url, AppConfig, ServerConfig};
use crate::servers::{check_health, default_name, server_id};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, State};

fn lock<'a>(state: &'a State<'_, Mutex<AppConfig>>) -> Result<MutexGuard<'a, AppConfig>, String> {
    state
        .lock()
        .map_err(|_| "Config state poisoned".to_string())
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
    let mut config = lock(&state)?;
    config.servers.push(server.clone());
    config.save(&app)?;
    Ok(server)
}

#[tauri::command]
pub fn remove_server(
    app: AppHandle,
    state: State<'_, Mutex<AppConfig>>,
    id: String,
) -> Result<(), String> {
    let mut config = lock(&state)?;
    config.servers.retain(|s| s.id != id);
    if config.active_server.as_deref() == Some(id.as_str()) {
        config.active_server = None;
    }
    config.save(&app)
}

#[tauri::command]
pub fn set_active(
    app: AppHandle,
    state: State<'_, Mutex<AppConfig>>,
    id: String,
) -> Result<(), String> {
    let mut config = lock(&state)?;
    if !config.servers.iter().any(|s| s.id == id) {
        return Err(format!("Unknown server: {id}"));
    }
    config.active_server = Some(id);
    config.save(&app)
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
    let mut config = lock(&state)?;
    config.close_to_tray = v;
    config.save(&app)
}
