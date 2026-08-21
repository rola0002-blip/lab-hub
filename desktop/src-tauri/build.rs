fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_servers",
            "add_server",
            "remove_server",
            "set_active",
            "get_app_config",
            "set_close_to_tray",
            "desktop_notify",
        ]),
    ))
    .expect("failed to run tauri-build");
}
