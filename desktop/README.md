# LabHub Desktop

Tauri 2 shell around the LabHub web app: chrome rail + one content webview
per configured lab server (see `docs/desktop.md` for the architecture).

- **Version sync (build-enforced):** root `package.json`,
  `desktop/src-tauri/Cargo.toml`, and `desktop/src-tauri/tauri.conf.json`
  must carry the SAME version. `build.rs` asserts it at build time and
  fails with a list of mismatches — bump all three together.
- **macOS floor is 14.0** (Sonoma): per-webview session isolation uses
  `data_store_identifier`, which WKWebView only exposes on 14+.
- **Windows:** the bootstrapper downloads WebView2 on first run when the
  target machine has no suitable runtime — no manual install step.
- Gates: `cargo fmt --check && cargo clippy --all-targets -- -D warnings
  && cargo test` and `cargo run --example smoke` (headless regression run).
- **Bundling locally:** `bundle.createUpdaterArtifacts` is on, so a plain
  `tauri build` fails without `TAURI_SIGNING_PRIVATE_KEY`. For an unsigned
  local bundle run `npx --yes @tauri-apps/cli build --config
  '{"bundle":{"createUpdaterArtifacts":false}}'` (what CI's desktop-check
  smoke does); CI release builds sign with the repo secret.
- The macOS updater installs `.app.tar.gz` (not dmg) — the release
  workflow's manifest darwin keys point at `LabHub.app.tar.gz`.
