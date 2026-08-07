# Changelog

All notable changes to LabHub (the self-hosted lab platform) are documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.14.0] - 2026-08-07

### Added
- Booking equipment from a phone, end to end. Below tablet width the equipment schedule becomes one full-width day column with touch-sized half-hour rows and its own day bar — ‹ Tue 12 Aug › — which steps through the week a day at a time and carries on into the next or previous week when you step off either end. Tap an empty slot and a one-hour draft block appears; drag the handle at its top or bottom edge to set the start or end time, drag the block itself to move it, then press Book. The usual booking dialog opens with that range already filled in. Closing the dialog keeps the draft, so you can adjust it and try again; a booking that goes through clears it. On a desktop the seven-day week grid and its mouse drag are exactly as they were.
- A **New booking** button on every equipment page, at every width. It opens the booking dialog on the next free half hour, so making a reservation no longer requires a drag at all: it is the first way to book with only a keyboard or a screen reader, and the dependable fallback on touch.
- The booking dialog is now one editable form, whichever way you reached it. Date, start and end are yours to change — half-hour steps between 07:00 and 23:00, as the schedule has always used — an end at or before the start is not offerable, and the duration and the instant-or-approval verdict update as you edit. A drag or a draft block simply arrives with the range pre-filled.
- Bookings on the schedule are tappable, on every device. They were decoration; now each one is a real button that opens its details — who booked it, the time, and its status — with **Cancel booking** where you could already cancel it: your own future booking, or anyone's if you manage that instrument, behind a confirmation. Maintenance windows open read-only. Every block is keyboard-focusable, so the week's bookings can be read without a mouse at all.

### Changed
- A mobile pass over the whole app. Issue rows fold to two lines below tablet width (priority, status, identifier and title on the first, assignee and the stalled chip on the second), with labels, project and due date left to the wider layout. The certifications matrix freezes its person column and its header row, so you always know which person and which instrument a checkbox belongs to, and each checkbox now sits in a proper tap target; the matrix scrolls within its own bounded pane, on desktop as well as on a phone. The day view across all instruments freezes its time gutter for the same reason. People rows, invite rows and the approvals decision rows wrap onto a second line instead of squeezing — and the approvals rejection box, which had only its placeholder to go on, now carries a real label for screen readers. The file listing's folder rail becomes a horizontal chip strip below desktop width (renaming and deleting a folder stay on the wide rail), and the text actions on People, My bookings and Files — Copy link, Resend, Revoke, Cancel, Cancel series, the file name itself — are all big enough to hit with a thumb and all show a focus ring, which several of them never did.
- Form fields render at 16px on touch devices. Below that size iOS Safari zooms the page in whenever you focus a field and does not zoom back out; the size bump is the standard cure. Controls the design already sets larger — the issue title, for one — keep their own size, and pinch zoom is never disabled anywhere.
- The equipment page stacks its policy panel below the schedule on a phone rather than squeezing the schedule beside it, and the week Prev/Next controls give way to the day bar at that width.
- The app now declares the viewport it wants and pads its fixed chrome for device safe areas, so on a notched phone the header clears the status bar and the page bottom clears the home indicator. Nothing moves in an ordinary browser window, where those insets are zero. The sign-in screen sizes itself to the visible viewport instead of the largest one, so the card is no longer parked under the browser's own chrome.

### Fixed
- Drag-and-drop now works by touch. The grips on issue board cards and on project cards were unreachable on a touchscreen — the browser claimed the gesture as a scroll before the card ever moved. The board grip is also large enough to hit reliably now. Keyboard reordering and mouse feel are unchanged, and the per-card Move menu remains the no-dragging path.
- The chat pane is the right height, and the composer stays above the on-screen keyboard. Its height allowance was a flat guess that over-subtracted at every width; it is now the actual chrome above and below it, plus the safe-area insets, and on a phone the pane resizes to what the keyboard leaves rather than sitting under it.
- The dashboard no longer scrolls sideways at phone width: a long project name in the "needs attention" row was stretching the whole page.

## [0.13.0] - 2026-08-06

### Added
- Feedback from inside the app. "Give feedback" sits at the foot of the sidebar and in the ⌘K palette on every page: say whether it is a bug or an idea, describe it, optionally attach a screenshot, and send. The page you were on, the app version and your browser are recorded with it — listed on the form before you send, so nothing goes along invisibly. Everyone can send feedback, guests included; unlike filing an issue, it needs no permission and no triage vocabulary.
- A review queue on the new Feedback page. Admins see every report newest-first, filter it by status and by bug-versus-idea, and move an item through New → Reviewed → Planned → Done → Declined from the chip on the row. Everyone else — members and guests — sees the same page with their own submissions only, and never receives anyone else's. New items land under the New filter, so triaging one clears it from view.
- Notifications close the loop. Admins are alerted when feedback arrives; the person who sent it is alerted when it is decided — Planned, Done or Declined — and the alert opens the Feedback page with the new status showing. Marking something Reviewed is bookkeeping and stays silent, and no feedback is ever announced in `#lab-updates` or emailed.
- You can delete your own report while it is still New — a correction path, since feedback cannot be edited. Once review has started the item is part of the record and only an admin can remove it. Deleting also removes the attached screenshot from disk.

### Fixed
- Amber status chips are readable again, everywhere they appear. The ink on the light-theme warning chip sat just under the AA contrast bar for text against its own fill (4.43:1); it is now the same hue one step darker, at 4.76:1. The chip is the "New" marker on the feedback queue, and the same repair carries to the pending-approval chips on a booking, the bookings list and the dashboard, and to the certification chips on the approvals page.

### Security
- Feedback screenshots are session-gated. The image bytes are served only to a signed-in session and always with `private, no-store`, so a shared or proxy cache can never retain one and a leaked link is worthless to a signed-out reader. A report can only ever reference a file uploaded as a screenshot — an attachment from chat, an issue or the file library cannot be attached to one.

## [0.12.0] - 2026-08-06

### Added
- Projects can be arranged by hand. `/projects` is now the lab's shelf: drag a card by its grip, move it with the keyboard alone (focus the grip, space to lift, arrows to move, space to drop, escape to cancel), or use the per-card Move menu — Move to front, earlier, later, or to end — which is the reliable path on touch and needs no dragging at all. The arrangement is one shared lab-wide order, not a per-person view: what you arrange is what everyone sees. Every control names its project ("Reorder Memristor array", "Move Memristor array"), and the drag announcements read as names and positions rather than raw ids.
- Guests see the same arrangement, read-only — no grip, no Move menu, and a forged move request is refused. The controls are also hidden whenever a Health or "Needs attention" filter is active, because dropping a card between two neighbours you cannot see would put it somewhere you did not choose.

### Changed
- The `/projects` review grid no longer re-sorts itself worst-first on every render; it renders in the manual arrangement. Health is untouched everywhere else — chips, glyphs, the `?health=` and `?attention=1` filters, and the weekly update prompts all behave exactly as before, and the dashboard's "Projects needing attention" section keeps the worst-first ordering, which is where the review instrument now lives (superseding the grid half of SP8's worst-first decision, by product decision).
- Project dropdowns follow the arrangement instead of newest-first: the create-issue composer, the issue filter bar, the issue-detail Project property, and the project-update composer all list projects in the same order as the grid, so a dropdown can never contradict the shelf.
- A newly created project lands at the front of the arrangement rather than being sorted in by date — the place you look first for work you just set up. Completed and cancelled projects keep their own newest-first section below the grid and are unaffected by arranging.
- The starting arrangement is newest first — the order the project dropdowns and the closed section already used. Because the grid itself was previously ordered worst-first by health, the first render after the upgrade will not match the last one before it: everyone's grid reshuffles once, before anybody has arranged anything. That is the intended baseline to arrange from, and it settles the moment you do.
- One hand-written, additive database migration (`20260805000000_project_manual_order`) adds `Project.rank`, a base-62 fractional index stored `COLLATE "C"` with its own index. Existing projects are backfilled into that newest-first baseline, every statement is guarded so the migration is re-runnable, and nothing is renamed or dropped — rolling back to the previous release stays data-safe. The column carries a database-level default (`'zz'`, the end of the arrangement) that the app itself never uses, purely so that a rollback to a pre-0.12 build can still create projects instead of failing on a column it does not know about.

## [0.11.0] - 2026-08-04

### Added
- Issues can be deleted, by whoever filed them or by any admin. The confirmation names what goes: the issue, how many comments it has, its full activity history, and how many attachments — when it has any. Deletion is permanent and silent: the comments, the activity history and the attachment files all go, the files are unlinked from disk, and nothing is posted to `#lab-updates`. The identifier is never reissued, so an old `LAB-n` link is always a clean 404 and never a different issue, and historical `#lab-updates` mentions of it stay readable as plain text instead of turning into broken links.
- A back button in the top bar, plus `⌘[` / `Ctrl+[`. It appears only when there is somewhere in the app to go back to, so it can never drop you out of an installed PWA or off the end of a notification link, and it stays out of the way on a page you arrived at directly.
- The Project property on an issue now links to that project, for every role including guests; changing the project is a separate control beside it.

### Fixed
- The sidebar Chat badge is now live: opening a conversation clears it immediately, with no page reload, and its value always equals the sum of the rail's own per-conversation counts. A muted conversation no longer contributes to it, so a muted noisy channel can't leave a permanent count you have no way to clear.
- Filing an issue, uploading a file, creating or editing a project, or posting a project update no longer makes your own Chat badge tick up. If you were already behind in `#lab-updates`, nothing changes — the announcement joins the pile you have yet to read, rather than quietly marking other people's messages read.

## [0.10.2] - 2026-08-02

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
