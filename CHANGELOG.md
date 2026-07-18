# Changelog

All notable changes to LabHub (the self-hosted lab platform) are documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.5] - 2026-07-18

### Added
- My issues is now the landing screen: signing in, accepting an invite, and the root redirect all arrive on your personal task list (`/issues/me`) instead of the dashboard, which stays in the sidebar and fully reachable.
- Overdue and due-today dates are colour-coded on issue list rows and board cards — a red "Overdue" or amber "Today" chip, bucketed by the org-timezone day so a due-today issue never reads as overdue and completed work is never flagged. Board cards, which previously hid due dates, now show them.
- The LabHub Bot now direct-messages an issue's assignee once when its due day has fully passed, re-arming if the due date is later changed.
- Issue lists gain a "Due" quick filter ("Due this week" / "Overdue") and a one-click "Clear filters" that appears only when a filter is active and clears just the filter bar's own parameters, preserving any other query key.
- Quick capture pre-fills the assignee: opening the composer with `c`, the ⌘K "Create issue" action, or create-from-chat sets you as the assignee (still editable to anyone or unassigned); the "New issue" buttons leave it unset.
- New issues default to the Todo status in the composer, with Backlog still selectable; the storage-level default is unchanged.
- The `c` quick-capture shortcut now opens the composer from any page, not only the issues and projects views, while still ignoring keypresses inside text fields, selects, and open dialogs.

### Fixed
- Chat reaction, edit, and delete failures now surface a toast instead of failing silently, and a failed action no longer leaves the message row's buttons stuck disabled.
- Every notification row in the bell tray is now clickable and navigates to its target — direct messages, mentions, channel adds, and booking notifications, not just issue notifications (those rows were previously inert).
- Issue list, board, and detail views now refetch after an SSE reconnect, so an issue change broadcast during a network blip is no longer missed and the view can no longer stay stale.
- The global `c` shortcut no longer opens the composer while a native `<select>` (such as a filter dropdown) has focus.

## [0.9.4] - 2026-07-18

### Removed
- Issue labels can no longer be added or assigned from the interface: the create-issue composer's label picker, the issue-detail Labels editor, and the list/board "Any label" filter are gone. The `Label`/`IssueLabel` models, their migrations, and the service layer are untouched — this removes the label entry points only, so existing label data is preserved and old `?label=` links still filter gracefully.

### Fixed
- The inline issue status and priority menus on list rows and board cards no longer clip off-screen at narrow (phone) widths. The shared `Menu` now auto-flips horizontally to the side with available room, mirroring its existing vertical flip, so left-anchored triggers stay fully within the viewport while menus that already fit are unchanged.
- The mobile navigation drawer now closes automatically on navigation — whether the route changes or the current tab is re-tapped — instead of remaining open over the new page, and no longer leaves the app content stuck `inert` (an accessibility trap).
- Closing the mobile navigation drawer now returns focus to the hamburger toggle instead of dropping it to `<body>`. Reordering the `inert` and focus-trap cleanups so the app content is interactive before focus is restored fixes the focus loss on every close path (Esc, backdrop, route change, and nav-link tap).

## [0.9.3] - 2026-07-18

### Changed
- Issue identifiers now render and announce with the `LAB-` prefix (for example `LAB-42`) instead of `COL-`, completing the LabHub rebrand across issue pages, chat autolinks, search excerpts, and bot announcements. `formatIdentifier` remains the single source of truth, so every server-side render and notification emits the canonical `LAB-` form.
- The legacy `COL-<n>` identifier is kept as a read-only alias: existing references (including archived bot posts) still parse and resolve to the same issue and re-render as `LAB-<n>`. Stored issue numbers and the `issue_number_seq` sequence are unchanged — this is a display/parse change only, with no database migration.

## [0.9.2] - 2026-07-17

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
