# LabHub Desktop (SP11)

Native shell (Tauri 2) for macOS + Windows around the LabHub web app.

## Architecture

One window, multiple webviews: a local chrome rail (server switcher, add/
remove servers, unread badges, close-to-tray toggle) plus one remote webview
per configured lab server — kept alive and shown/hidden to switch. Sessions
are isolated per server (macOS: WKWebsiteDataStore per server; Windows/
Linux: separate data directories). Realtime chat keeps working through the
same SSE stream the browser uses.

## Security model

Every configured server is UNTRUSTED remote content. The IPC surface granted
to lab pages is exactly two capabilities (see
`desktop/src-tauri/capabilities/labhub-remote.json`): `desktop_notify`
(rate-limited to 10 notifications / 10 s, title/body truncated to 200 chars)
and opening http/https URLs in the system browser. Navigations are pinned to
the server's own origin (http→https upgrades allowed); everything else opens
externally. No file system, no arbitrary commands, no event spoofing.

The one sanctioned write outside the session store: attachment downloads
(a navigation the webview cannot render, e.g. the `/ra` CSV export) are
accepted by an `on_download` handler and land in the user's Downloads folder
under the engine's suggested filename (deduplicated, never overwriting);
a silent shell notification confirms the save. The page never picks the
path.

## Auto-update

The app checks for updates in the background (30 s after launch); use the
tray's Check for Updates to download, install, and restart. The manifest
is `latest.json` on the latest GitHub Release. Artifacts are
minisign-signed; the public key is embedded in
`desktop/src-tauri/tauri.conf.json`. macOS updates ship as
`LabHub.app.tar.gz` (the .dmg is for humans); Windows as the NSIS
installer. The background check intentionally stops at "available" —
installing unattended would force-quit the app on Windows (the NSIS
installer restarts and exits the process), so acting on an update stays
user-initiated.

### Maintainer: updater signing key

The private key lives OUTSIDE the repo (owner's secure storage — see
`~/Documents/Systems/labhub-desktop-updater-key/` convention) and is set as
the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
Losing it permanently breaks auto-updates for every installed copy — to
rotate: generate a new keypair, update `pubkey` in tauri.conf.json, ship one
manually-installed release, then future releases auto-update again.

## Behavior notes

- Server ids are uuid-v5 of the normalized URL (frozen scheme — see
  `desktop/src-tauri/src/servers.rs`); re-adding a removed server restores
  its session (data is kept on removal by design).
- The rail auto-hides when exactly one server is configured (visible at zero
  and two or more). Hidden is zero-width: the single server's webview takes
  the full window.
- Tray "Add server…" reveals and focuses the hidden rail; the reveal is
  cleared by the next server add/remove/switch — a cancelled reveal persists
  until then. Tray order: servers → Add server… → Check for Updates →
  Show LabHub → Quit.
- Unread badges come from the web app's own tab-title encoding (`(n) LabHub`).
- Desktop version always equals the repo `package.json` version (build-time
  assertion in `desktop/src-tauri/build.rs`).
- Notifications: the web app fires them from its chime decision point (mute
  rules enforced there); the shell renders them natively. The web-push opt-in
  is hidden inside the shell.
- ⌘/Ctrl+1..9 switch servers while the rail has keyboard focus (v1
  limitation — content webviews keep their keys).
- Dev: `desktop/README.md`; regression harness `cargo run --example smoke`
  (macOS, live network).

## Release checklist (maintainer)

Tag `vX.Y.Z` push → `release.yml` (server image + GitHub Release) →
`desktop-release.yml` waits for the release, builds macOS universal + Windows
artifacts, uploads dmg / app.tar.gz / exe / latest.json → manually dispatch
`Installer smoke`. Verify the release page lists all artifacts.
