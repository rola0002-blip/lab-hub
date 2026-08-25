<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# LabHub repo guide

Public open-source repo (MIT) at `rola0002-blip/lab-hub`. Distribution and desktop-app context lives in `CLAUDE.md` (local-only; the SP10 flip stripped it from public history — kept out via `.gitignore`, never commit it) and `docs/desktop.md` / `docs/ops/distribution.md` (public).

## Layout beyond src/

- `desktop/` — Tauri 2 desktop shell (macOS universal + Windows). Rust crate `desktop/src-tauri` (multiwebview: local chrome rail + one remote webview per lab server), static rail UI `desktop/ui` (no framework). Version-sync is build-enforced against root `package.json` (`build.rs` asserts). CI: `desktop-check.yml` (fmt/clippy/cargo test/bundle, macOS + Windows), `desktop-release.yml` (v* tags → dmg + app.tar.gz + NSIS exe + `latest.json`).
- `.github/workflows/` — `ci.yml` (web: lint/contrast/coverage/e2e vs a Postgres service; e2e runs a PRODUCTION build via `E2E_WEB_SERVER=build`, not `next dev`), `release.yml` (multi-arch GHCR image + GitHub Release), `installer-smoke.yml` (runs `install.sh` on clean amd64/arm64 runners — dispatch manually after each release; GITHUB_TOKEN events don't chain), `desktop-*.yml`.
- `install.sh` + `docker-compose.dist.yml` + `templates/labhub-wrapper.sh` — the curl-able one-line installer strangers use. POSIX-sh safe (must run under dash on Ubuntu 22.04). `docker-compose.image.yml` is the maintainer's dogfood override.
- `scripts/release.mjs` bumps `package.json`, `desktop/src-tauri/Cargo.toml`, `tauri.conf.json`, and `Cargo.lock` TOGETHER — never bump one without the others (build.rs fails otherwise).

## Rules that bite

- Never push to a remote without Roland's explicit instruction (the release flow tags locally and prints the push command).
- Never commit: `.env*`, `CLAUDE.md`, `docs/superpowers/**`, `docs/handoffs/**` (internal narratives stay private; pre-flip history archive lives under `~/Documents/Systems/`).
- Tauri updater signing key: `~/Documents/Systems/labhub-desktop-updater-key/` (also GH secrets `TAURI_SIGNING_PRIVATE_KEY*`). Losing it breaks all future desktop auto-updates.
- e2e specs: no hardcoded screenshot paths; sent-message assertions scope to the chat log (`getByLabel('Messages')`/`logMsg`) — unscoped `getByText` matches the composer draft during the optimistic-send window and flakes on slow runners; `waitForHydration` (e2e/helpers) gates post-navigation synthesized events.

