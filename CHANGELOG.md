# Changelog

All notable changes to COLOSSUS (the self-hosted LabHub platform) are documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Internet-facing deployment: COLOSSUS served over HTTPS by a Cloudflare Tunnel (`cloudflared`, pinned tag) on a Mac Studio under Colima (SP7).
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
- COLOSSUS workspace redesign: semantic design-token theming (light/dark), ten accent presets, grouped sidebar, command palette, and a gated accessibility baseline (SP3).
- Project management: issues and projects with a fractional-index board, statuses, labels, comments, and activity, guarded by a single issue-policy choke point (SP4).
- Read-only calendar sync (per-user `.ics` feed, per-booking downloads, Google/Outlook quick-add), the COLOSSUS Bot posting lab activity to `#lab-updates`, booking-policy exposure for recurring bookings, and a workspace-wide Files document library (SP5).
