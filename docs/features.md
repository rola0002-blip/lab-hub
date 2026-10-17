# LabHub — feature notes

Deep-dive notes on each subsystem, moved from the README so the landing page
stays scannable. Sections below are the historical per-spec narratives.

## Messaging

Built-in team chat. Channels (public or private) and direct messages, threaded
replies, `@mentions` (and `@channel`), emoji reactions, and 25 MB file
attachments — dragging files onto the message pane and pasting screenshots
both attach, from anywhere in the pane (focus on a message row included).
Images sent in chat render inline and open full-size in a viewer when clicked.
Zip archives attach in every browser, Chrome included (whose file picker
labels them `application/x-zip-compressed`). Members and admins can pin
messages; a "Pinned (n)" button in
the conversation header lists them with deep links to each one, and guests
see the list but cannot pin. Conversations can be favorited — a star that
floats them to the top of their section in the sidebar. The composer grows
with your message up to 200 px, then scrolls inside. Channels can be muted
or left straight from the conversation list, any chat or Files page opens in
its own window, and a stray file drop inside chat never navigates the tab
away. Signing in returns you to the conversation you last had open.
Full-text search spans every conversation
you belong to. Delivery is realtime over one Server-Sent-Events stream per
tab (no WebSockets), fanned out with Postgres `LISTEN`/`NOTIFY`. Chat
notifications (Slack-like, 2026-09): every message in an unmuted
conversation alerts the moment it lands — in-app chime plus desktop toast
while a member is at a keyboard, and Web Push to every subscribed device
once the member has been idle for 2 minutes (an open tab or the desktop
app in the tray no longer silences the phone). A direct @mention in a
muted conversation still lands in the bell and still pushes to an idle
member; in-app it does not chime or pop out. Bot posts never alert. Since v0.32 there is no burst
throttle: two qualifying messages a moment apart both alert, and the
realtime SSE stream is the single sound source for messages. Since v0.35
every other bell notification alerts the same way — booking requests,
decisions and reminders, issue assignments, mentions and comments,
training requests, feedback, channel invites — from its bell row: the
in-app popup and chime fire when the row lands (diffed against a
watermark, so each row alerts once; at most three per refresh, and rows
older than 15 minutes only update the badge), and an idle member gets a
Web Push with the same title, text, link and per-type tag (one push per
notification type per minute). A LabHub Bot DM that carries a notification
alerts once, through that notification — bot messages themselves never
alert. Browser tabs can also raise a native OS
popup per incoming message through the `Notification` constructor; an
installed PWA (iOS 16.4+, Android) raises the same popup through the
service worker's `registration.showNotification()` — the only surface
those platforms allow. The semantics are identical either way: the setup
wizard's "Browser popups" step grants the permission (with a sample
popup), a "Notification popups" switch on the profile page opts this one
browser out without touching the phone, and each popup is tagged per
conversation (or per notification type) so a burst replaces the last popup
instead of stacking. The popup is silent — the chime is the sound — and
clicking or tapping it opens the conversation or the notification's page.
The desktop shell is unchanged: its
native toast carries the OS sound while the in-page chime stays silent,
so every alert makes exactly one sound. Push is squashed server-side to
one buzz per conversation per minute and collapsed client-side by the
service-worker tag, and subscriptions self-heal: the service worker
resubscribes on `pushsubscriptionchange`, and each app launch re-posts
rotated endpoints and re-mints granted-but-missing subscriptions (iOS
revokes push silently), so phone alerts survive OS-side churn without
re-running the wizard. Members enable phone push via the bell's "Set up
notifications" wizard, which ends with a real test ping; the admin
settings page shows who has push enabled.
A 60-minute unread-chat digest email follows (at most one per hour;
mentions, DMs, and thread replies — never bot messages).
Membership is the single authorization rule: you only ever read, search, or
receive events for conversations you are a member of.

## Design system & theming

The UI is driven entirely by semantic design tokens defined in
`src/app/globals.css`: static scales (type, spacing, radius, the teal ramp,
motion curves) in `@theme`, then semantic roles — `bg-canvas`, `bg-surface`,
`text-default`/`-muted`/`-subtle`, `border-*`, `accent`, `ring-focus`,
`sidebar-*` — resolved twice, once for light (`:root`) and once for dark
(`:root[data-theme="dark"]`). Components never hardcode gray/black/white; they use
these tokens, so both themes come for free.

**Light / dark.** The active theme is the `data-theme` attribute on `<html>`. A
tiny pre-paint boot script (the sole sanctioned `dangerouslySetInnerHTML`) reads
`localStorage.theme` — or the OS preference — before first paint, so there is no
flash. The header/​profile toggle writes `data-theme` + `localStorage`, and
persists the choice to `User.themePreference` so it follows you across devices.

**Accent presets.** Ten accents (teal is the default) live in `src/lib/accents.ts`
as `{ slug, name, light, dark }`. The active slug is the `data-accent` attribute on
`<html>`; `globals.css` repaints the accent-role tokens (`--accent`, `-hover`,
`-active`, `-subtle`, `-on`, `--ring-focus`, `--border-focus`, `--text-link`,
`--text-accent`, `--bg-selected`) for that slug in the current theme. It persists
via `localStorage.accent` + `User.accentPreference`. The teal-slate sidebar rail
(`--sidebar-*`) is **never** accent-themed.

**Profile.** Each user has a profile at `/profile` (reached from the top-bar avatar
menu, outside the primary nav): photo upload, display name, title, timezone, and an
Appearance section with the theme toggle + accent picker.

**Accessibility.** Landmark regions (nav / search / main / thread) with F6 cycling,
an SSE live region for new messages, roving-focus message navigation, a
focus-trapped responsive nav drawer, and reduced-motion support. Two gates guard
it: `npm run contrast` (`scripts/check-contrast.mjs`) statically checks WCAG
contrast for the semantic token pairs, the six issue-status glyphs, and all 10
accents in both themes, and the `e2e/a11y.spec.ts` axe-core sweep asserts zero
serious/critical violations on every core surface — including the issues list,
board, project, issue-detail, and create-issue surfaces — in both themes.

**Project management (SP4).** The issue tracker (`/issues`, `/projects`) adds its own
tokens and conventions on top of the design system:

- **Status palette.** Six theme-split status tokens —
  `--status-backlog`/`-todo`/`-in-progress`/`-in-review`/`-done`/`-canceled` — live in
  `globals.css` §3c (`:root` light + `[data-theme="dark"]`), lightened on the dark
  canvas so each small non-text glyph clears the 3:1 UI-component bar on its own
  surface. They are **not** accent-themed. `features/issues/status.ts` maps each
  `IssueStatus` to its token (`STATUS_TOKEN`), and the fixed label palette
  (`LABEL_PALETTE`) reuses them. `scripts/check-contrast.mjs` gates all twelve
  (6 × 2 themes) against the canvas.
- **Identifier.** Issues render as `LAB-<n>`: the `LAB-` prefix is a single
  workspace-brand constant in `features/issues/identifier.ts` (`ISSUE_PREFIX`), never
  per-project. The same word-bounded scanner resolves `LAB-<n>` references in chat
  messages and issue bodies into linked, status-dotted pills (struck through when the
  target is Done/Canceled). The pre-rebrand `COL-` prefix (`LEGACY_ISSUE_PREFIX`) is
  still recognised **read-only** by the parser/scanner so archived `COL-n` posts and
  stale links resolve to the same issue — but everything newly rendered or announced
  uses `LAB-`.
- **Realtime routing.** Issue events (`issue`, `issue_move`, `issue_comment`) broadcast
  to **all** signed-in users — the tracker is workspace-wide, unlike chat, whose every
  read/write/search/SSE event is gated by `ConversationMember` membership. Issue views
  never add a membership filter.
- **Migrations stay hand-written & additive.** `Issue.number` is assigned from a
  Postgres sequence (`issue_number_seq`) and `Issue.search` is a generated `tsvector`
  column — neither is expressible through `prisma migrate dev`, so SP4 schema changes
  are hand-written, additive migrations (`prisma migrate deploy` only). `Issue.rank`
  is a fractional index stored `COLLATE "C"` for deterministic byte-ordering;
  `features/issues/rank.ts` computes between-ranks and rebalances a column when keys
  get too long.
- **Drag-and-drop.** `@dnd-kit` is confined to the board (`board-view.tsx`); its
  `KeyboardSensor` makes every move keyboard-only (grip → Space to lift, arrows to
  move, Space to drop), and a per-card status Menu is the non-DnD fallback.

v0.16 rounds out the tracker: milestones — a dated strip under the project
description, completed by hand, with the count on the project card — per-project
labels (names unique within their scope, global labels shared), pinned-project
chips on My issues, and attachments on project updates. Since v0.36 the pinned
projects also sit in the sidebar under Projects, in pin order, each linking
straight to its project page.

## Equipment booking

Per-instrument booking policies — advance window, maximum duration,
certification gating, approval (none / guests / everyone), recurring
bookings, and maintenance windows — with overlap safety enforced by a
Postgres exclusion constraint (`booking_no_overlap`); everything is
stored UTC and rendered in the lab's timezone. Confirmed bookings can be
logged on and off to record actual usage against booked time, and each
instrument's full history exports to Excel. A reminder (bell, LabHub Bot
DM, email, and a phone push when idle) arrives 15 minutes before a
confirmed slot — the moment log-on opens. Equipment managers and admins
see live pending counts on the Approvals and Certifications nav rows
(booking requests, with a recurring series counted once, and training
requests they can decide); a count clears when the request is decided.

**Daily access windows (v0.32).** Each instrument names the hours it is
bookable, in the lab's timezone: the admin equipment form carries
"Bookable from" / "Bookable until" selects in half-hour steps plus a
"24 hours" checkbox, and a fresh instrument defaults to the full day. The
schedule grid renders exactly that window of half-hour rows, the booking
dialog's time selects step through it, and a slot straying outside is
blocked with the window named ("This instrument is bookable
07:00–23:00 — overnight or 24-hour runs need the window set to 24
hours"); equipment managers are exempt, as they are from the advance and
duration caps. With a 24-hour window a booking may cross midnight: the
grid opens to the full day, an overnight run's start-day slice reaches
midnight while its tail renders on its end day, and the row labels wrap
past 24:00. Bookings stored outside a since-narrowed window (legacy rows
from the fixed 07:00–23:00 band era) are never invisible — the rendered
band auto-expands to include every visible booking.

## Calendar sync & the LabHub Bot

Read-only calendar integration: subscribe to a private per-user iCalendar feed of
your bookings (`/api/calendar/<token>.ics`, unauthenticated by opaque token,
regenerable from `/profile`), download a single booking as `.ics`
(`/api/bookings/<id>/ics`, session-gated to owner / equipment manager / admin), or
add one to Google or Outlook with a quick-add link. No OAuth, no two-way sync, no
`.ics` email attachments. The LabHub Bot — the sole `isSystem` account, which
cannot sign in — posts lab activity (new projects and issues, and completions) to
the seeded `#lab-updates` channel that every member auto-joins, and DMs you about
your own bookings and due-soon issues. Bot DMs for events you are already notified
about arrive silent, preserving the one-bell rule, and no bot message pops out on
its own — the paired bell notification is the one alert. Recurring bookings now follow the
same per-instrument approval policy as single bookings.

## Files — shared document library

A workspace-wide document library at `/files`: one level of folders, drag-and-drop
uploads of office files (images, PDF, Office, txt/csv, zip) up to 100 MB, and
full-text filename search (also surfaced in ⌘K). Every signed-in user — including
guests — can browse, search, and download; members and admins upload and
create folders; a file is renamed, moved, or deleted by its uploader or an
admin, and a folder by
its creator or an admin (only when empty). PDFs and images open inline in a new tab,
office files download (with the original, possibly non-ASCII, filename preserved).
Each new upload is announced by the LabHub Bot in `#lab-updates`.
Storage reuses the existing uploads volume and backup — no new services.

**Versioning (v0.32).** A file row's ⋯ menu gains "Upload new version…"
(same type and 100 MB caps as a fresh upload), which appends to a
strictly linear history — restoring an old version also appends, so
nothing is ever rewound and every earlier version stays restorable.
"History" opens a drawer listing the versions newest-first with uploader
and org-time date, and each version's bytes download through the same
uploads gate as the current file. Rows past v1 wear a `v3`-style chip,
the bot announces each update crediting the acting uploader (an admin
versioning someone else's file is named, not the original uploader), and
deleting a file removes every version's bytes — the confirmation names
the count. Existing files were backfilled with a v1 snapshot of their
current bytes.

**Sorting and export.** The listing's columns — name, folder, size, uploader,
created — sort the table with a tri-state click: ascending, descending, then
back to the default newest-first order (the sort is client-side and ephemeral,
never persisted). The name column resizes too: on fine-pointer devices a drag
handle beside the Name header widens it — the width is remembered per browser
(localStorage), a double-click resets it, and the listing scrolls horizontally
only while widened. Truncated names show a tooltip with the full name. Ticking
rows arms an `Export (n)` button that downloads the
selection as a zip whose entries keep their folder structure (`folder/name.ext`,
duplicates deduplicated with a ` (2)` suffix); any signed-in role can export,
each file ships its current version only, and one export is capped at 100
files or 1 GB.

## RA acknowledgments

A compliance record at `/ra` (nav row "RA", in the Workspace section): members
and guests log that they have read risk assessments — name locked from their
signed-in account, matric number typed in once, and the RAs ticked from a
checkbox list of the Files folder named exactly `RA` (the folder convention
that marks a file as a risk assessment); one submit records them all. One
acknowledgment per person per document. Admins see
everyone's records and export them as an Excel workbook
(`/api/ra/acknowledgments/export` — frozen header, a filter on every column,
rows sorted by name then RA, times as real dates in the lab's timezone); a
record outlives its document, keeping a snapshot of the name rather than a
link, so deleting the file never erases the acknowledgment.

## Certifications & training requests

The certification matrix at `/certifications` decides who may book what:
equipment managers and admins grant and revoke per instrument, every
grant appends a training record to the ledger beneath the matrix (who
was trained, by whom, on what date; revocations are kept with who
annulled them and why), and the matrix feeds the booking policy's
`certification_required` gate.

**Training requests (v0.32).** An uncertified member asks for training
right where the certification rule bites: a "Request training" button on
the instrument's own page and its catalogue card, and inside the booking
dialog when certification is exactly what blocks the slot — with an
optional note, and one open request per person per instrument (guests
cannot ask; they talk to a manager). The instrument's managers hear about
it through a bell row and a silent bot DM, and only they decide it under
Certifications → Requests; admins step in only for an instrument with no
managers (a banned or guest manager does not count). The matrix itself
stays open to admins. Grant flows through the
same certification grant as the matrix — trainer and training date
default to the deciding manager and today (org timezone) and land in the
training ledger — while a decline requires a reason. The requester hears
the decision through bell and bot DM either way.

## Web Push (optional)

Push is disabled until you supply a VAPID key pair. Generate one once:

```
npx web-push generate-vapid-keys
```

Paste the printed `Public Key` and `Private Key` into `.env` as
`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, then restart the app. Leave both
blank to keep push disabled (the same way blank SMTP keeps email queued). Users
still opt in per browser from the chat UI after keys are set.

## Slack import

Migrate an existing Slack workspace into LabHub messaging. The importer is
idempotent — re-running the same export inserts nothing new — and additive, so
it never touches your existing LabHub data.

1. In Slack: **Admin → Settings & administration → Workspace settings → Import/Export Data → Export** and download the export ZIP.
2. Run the importer against the ZIP (or an already-extracted directory):
   ```
   npm run import:slack -- /path/to/export.zip
   ```
3. Verify the printed counts against the export: channels, messages inserted,
   and the reconciliation line (`inserted + skipped + dropped = plan total`,
   with `dropped` = 0).

Public channels always import; private channels import only if your Slack export
tier includes them (with `members[]`); DMs are not part of a standard export.
For the full freeze → export → verify → announce → rollback procedure, see
[slack-cutover.md](slack-cutover.md).

## Beta release & Windows-server deployment (SP6)

LabHub versions with SemVer from `package.json` (single source of truth), a
Keep-a-Changelog `CHANGELOG.md`, and `npm run release -- patch|minor|major`, which bumps
the version, rolls `[Unreleased]` into a dated section, commits, and creates an annotated
tag — and **never pushes** (it prints the exact `git push origin main --follow-tags` for
you to run after review). The running version shows in **Settings → About** and the sidebar
footer, and at `GET /api/health` (`{ ok, version }`, unauthenticated) — the probe the update
script uses to confirm a patch landed.

The multi-week beta runs on an unused Windows laptop as an always-on LAN server over plain
HTTP; see `docs/ops/windows-server.md` (provisioning) and `docs/ops/ops-card.md` (day-to-day
operation). Operators use `scripts\windows\{init-env,backup,update,rollback}.ps1`; the Mac
stays the development + release-cutting machine. Onboarding needs no SMTP — the People page
offers copyable invite links, and Settings shows an email-delivery indicator when SMTP is
unconfigured. PWA install + Web Push are dormant on plain HTTP and light up unchanged the
day an HTTPS ingress is added. The install UX ships in-app: an "Install app"
row in the bell tray (native sheet on Android, an Add-to-Home-Screen guide on
iOS), a cached offline shell served by the service worker, and (Android) a
launcher unread badge mirroring the tab-title count. Foreground message
pop-outs work inside the installed app (iOS 16.4+, Android), raised via
the service worker — the only surface those platforms allow.
