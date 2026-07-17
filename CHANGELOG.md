# Changelog

All notable changes to LabHub (the self-hosted lab platform) are documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The workspace brand and display name are now LabHub throughout: the app UI and setup wizard, the PWA manifest and page metadata, the outgoing email templates and `SMTP_FROM` defaults, the ICS calendar feeds, and the bot ("COLOSSUS Bot" -> "LabHub Bot", applied by an additive, guarded, re-runnable migration).
- Internal identifiers are deliberately unchanged: the `colossus-bot` and `colossus-lab-updates` database ids, the bot's `bot@colossus.local` address, and the `colossus:*` localStorage keys. They are primary keys seeded by a sealed migration; renaming them would orphan the bot, its channel and every message it has posted.
- macOS ops naming follows the brand: launchd labels `com.colossus.*` -> `com.labhub.*` (plist filenames included), the clone path is `$HOME/labhub`, and the docs example hostname is `labhub.<domain>`. Runbooks, README and CLAUDE.md updated to match.
- The retired Windows-laptop runbook keeps its original `C:\colossus` paths and `colossus-lab` hostname as a historical record, so a restore matches the machine as it was actually built.

## [0.9.1] - 2026-07-17

### Added
- Internet-facing deployment: LabHub served over HTTPS by a Cloudflare Tunnel (`cloudflared`, pinned tag) on a Mac Studio under Colima (SP7).
- macOS operator tooling: `scripts/macos/{init-env,update,rollback,stack-up}.sh` and two launchd agents (boot stack-up + nightly 03:00 backup); macOS-first ops runbook and operator card.
- Web Push / PWA activated under HTTPS: the compose passthrough now delivers minted VAPID keys to the container.

### Changed
- Host binds are loopback-only (`127.0.0.1`); ingress is exclusively the outbound tunnel (nothing is published off-box).
- Auth rate limiting is genuinely per-client behind the tunnel via `AUTH_TRUSTED_IP_HEADER` (`cf-connecting-ip`); `AUTH_RATE_LIMIT_MAX` returns to the code default of 10.
- The database host publish is parameterized as `127.0.0.1:${DB_PORT:-5432}:5432` so a shared host can move it off a busy 5432.

### Security
- Security headers via `next.config.ts`: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a report-only CSP; explicit `nosniff` on the uploads route.
- Container runs as the non-root `node` user with a `HEALTHCHECK` gating the tunnel.
- Optional `SETUP_TOKEN` gate protects first-admin provisioning so an un-invited party cannot seize workspace admin over the public tunnel during setup.
- Web Push subscription endpoints are validated against a push-service allowlist (rejects http/loopback/private/arbitrary hosts), closing a member-triggerable SSRF sink.

## [0.9.0-beta] - 2026-07-14

### Added
- Equipment booking with per-instrument approval policies, certification gating, approvals, recurring bookings, and maintenance windows (SP1).
- Team messaging: public/private channels and DMs, threaded replies, @mentions and @channel, emoji reactions, file attachments, full-text search, realtime over SSE + Postgres LISTEN/NOTIFY, and opt-in Web Push (SP2).
- LabHub workspace redesign: semantic design-token theming (light/dark), ten accent presets, grouped sidebar, command palette, and a gated accessibility baseline (SP3).
- Project management: issues and projects with a fractional-index board, statuses, labels, comments, and activity, guarded by a single issue-policy choke point (SP4).
- Read-only calendar sync (per-user `.ics` feed, per-booking downloads, Google/Outlook quick-add), the LabHub Bot posting lab activity to `#lab-updates`, booking-policy exposure for recurring bookings, and a workspace-wide Files document library (SP5).
