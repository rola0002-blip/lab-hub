# Changelog

All notable changes to LabHub (the self-hosted lab platform) are documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Creating or relabelling an issue with a label id that no longer exists — or with the same id twice — now returns a clear validation error instead of an unhandled 500, matching how a missing assignee or project already behaves.
- Project updates now read in one stable, total order everywhere they appear — the project card, the project header, and the update feed — so two updates posted in the same millisecond can no longer name three different "latest" rows on a single page load. The detail page's feed is also bounded to the newest 50 updates, so its payload no longer grows with a project's entire update history.

### Changed
- Internal deduplication, with no behaviour change: the started-status set and the per-issue "last touched" derivation are now shared between the issue list and the weekly update-prompt job, so the Stalled chip and the prompt digest's untouched count cannot drift apart; the "needs attention" predicate is shared between `/projects?attention=1` and the dashboard, so their counts always agree; and chat's token renderer moved into its own module, which drops the emoji picker out of the project and issue route bundles.

## [0.10.1] - 2026-08-01

### Fixed
- Row menus on Files and My bookings no longer open as an unclickable sliver: a file row's ⋯ menu and an upcoming booking's "Add to calendar" menu now open at their full height with every option clickable. Both listings clipped their contents, and the row popover is positioned inside the list rather than portaled out of it, so on a short list — one or two rows, the common case — the menu was capped to a few pixels and clicks fell through to the page behind it. The defect got worse the shorter the list, which is how it went unnoticed.
- Removing the clip is visually inert on Files, whose rows carry no fill of their own; on My bookings the first- and last-row corner rounding is now applied explicitly, so the row hover fill still follows the list's rounded corners. Both pages gain an end-to-end guard that clicks a menu option at its real on-screen position, so a re-introduced clip fails the suite instead of shipping.

## [0.10.0] - 2026-07-28

### Added
- Weekly project updates: every project page gains an Updates section and a "Post update" composer. Pick a health call — On track, At risk, or Off track — and write the one-liner that says what actually moved. Updates are permanent and reverse-chronological, render `@mentions` and `LAB-<n>` references the same way chat does, and each one is announced to `#lab-updates` by the LabHub Bot.
- Project health is now visible everywhere a project is: a chip carrying a distinct glyph *and* the word (never colour alone) on project cards, the project header, and the dashboard. A project that has been silent for three weeks derives a "No update" state automatically — silence is displayed, never stored.
- "Post as project update" on any chat message's ⋯ menu: the message is quoted into the composer with its author's attribution, and the resulting update carries a backlink chip ("From a message in #channel"). The chip links back only for people still in that conversation and stays unlinked for everyone else, so capturing a message never widens who can read it.
- `/projects` is now a review screen, ordered worst-first — off track, then at risk, then unowned, then silent, then on track — with "updated N days ago", the open-overdue count, and progress on every card. Completed and cancelled projects move into their own section below. A Health filter and a "Needs attention" checkbox round-trip through the URL, and an unknown value degrades to no filter rather than erroring.
- A stalled signal on issues: an issue that is In progress or In review with no activity or comment for 14 days shows a muted "Stalled" chip on its list row and board card, and the filter bar gains an Activity → "Stalled only" quick filter that composes with every other filter. Staleness is derived from real activity and comments, so a drag-reorder or a board rebalance never clears it and a new comment always does.
- A weekly update prompt: a background job runs on the organisation's chosen day and hour — new settings under Settings → Organisation, defaulting to Tuesday 16:00 in the org timezone — and sends one direct message per active project, once per prompt window, unless that project's prompts are snoozed. It goes to the project lead, or to the people with open work in the project, or to the admins if there is no one else, and carries a short digest of what closed, what is overdue, and what has stalled. The prompt is latched per project per window, so a restart never double-pings. Each project's menu gains "Skip the next prompt", "Pause updates for 4 weeks", and "Resume update prompts".
- The dashboard is rebuilt as "Lab today": five fixed sections in a fixed order — My issues, Today in the lab, Projects needing attention, Latest in #lab-updates, Recent files — above the existing approvals banner, so it is a stable place to look rather than a layout that reshuffles as content appears. The attention section's four counts always agree with what `/projects?attention=1` lists, and the `#lab-updates` digest renders only for channel members and shows only real posts, never join or add event lines.

### Fixed
- The unscoped file listing now spans every folder instead of silently returning only root-level files, which also fixes the dashboard's "Recent files" section and the default folder offered by the Files Move dialog.
- Assigning an issue to a person who no longer exists, filing it against a deleted project, or naming a missing project lead now returns a clear message instead of an unhandled 500 — including the empty-string ids a stale form can submit. Guests stay assignable and can still be stored as a project lead.

### Changed
- Project health glyphs use four new `--health-*` tokens, defined for both themes and gated by `npm run contrast` at the 3:1 non-text bar. They tint glyphs only, are never accent-themed, and never carry meaning on their own.
- Removed the unused `canManageProjects` permission helper; `assertCanMutate` is now the single project-mutation gate.
- One hand-written, additive database migration (`20260727000000_sp8_progress_loop`) adds the project-health enum, the project-update table, the per-project prompt latch and snooze columns, two project indexes, and the organisation's update-prompt day and hour. Nothing is renamed or dropped, so rolling back to the previous release stays data-safe.

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
