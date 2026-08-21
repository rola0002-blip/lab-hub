use std::fs;
use std::path::Path;

fn main() {
    assert_versions_in_sync();
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

/// Version-sync guard (single source of truth): the repo-root
/// `package.json` version, this crate's `Cargo.toml` version, and
/// `tauri.conf.json`'s version must all be EQUAL. Enforced at build time
/// so it is impossible to forget — a bump that misses any of the three
/// files fails the desktop build with this message. See desktop/README.md.
fn assert_versions_in_sync() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let manifest_dir = Path::new(&manifest_dir);
    let cargo_version = std::env::var("CARGO_PKG_VERSION").expect("cargo sets CARGO_PKG_VERSION");

    let repo_root = manifest_dir
        .ancestors()
        .nth(2)
        .expect("desktop/src-tauri sits two levels below the repo root");
    // Re-run when any of the three sources changes so a mismatch is caught
    // on the very next build, not only on a clean one.
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("Cargo.toml").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("tauri.conf.json").display()
    );

    let web_version = read_json_string_field(&repo_root.join("package.json"), "version")
        .expect("read version from root package.json");
    let tauri_conf_version =
        read_json_string_field(&manifest_dir.join("tauri.conf.json"), "version")
            .expect("read version from tauri.conf.json");

    let mismatches: Vec<String> = [
        ("package.json", web_version.as_str()),
        ("tauri.conf.json", tauri_conf_version.as_str()),
    ]
    .iter()
    .filter(|(_, v)| *v != cargo_version)
    .map(|(f, v)| format!("  {f}: {v}"))
    .collect();
    if !mismatches.is_empty() {
        panic!(
            "version mismatch — package.json, desktop/src-tauri/Cargo.toml and \
             desktop/src-tauri/tauri.conf.json must all carry the same version:\n  \
             Cargo.toml: {cargo_version}\n{}\nbump all three together (the \
             release flow starts from package.json).",
            mismatches.join("\n")
        );
    }
}

/// Reads `"<field>": "..."` from a JSON file via serde_json.
fn read_json_string_field(path: &Path, field: &str) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get(field)?.as_str().map(str::to_owned)
}
