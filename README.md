# LabHub

Self-hosted lab platform: equipment booking with per-instrument policies,
certification gating, approvals, recurring bookings, and maintenance windows.
Project management arrives in a later release on this same foundation.

## Messaging

Built-in team chat. Channels (public or private) and direct messages, threaded
replies, `@mentions` (and `@channel`), emoji reactions, and 25 MB file
attachments. Full-text search spans every conversation you belong to. Delivery
is realtime over one Server-Sent-Events stream per tab (no WebSockets), fanned
out with Postgres `LISTEN`/`NOTIFY`. Web Push notifies you of mentions and DMs
when you have no tab open — opt-in, and silenced per conversation by mute (except
direct @mentions).
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
- **Identifier.** Issues render as `COL-<n>`: the `COL-` prefix is a single
  workspace-brand constant in `features/issues/identifier.ts` (`ISSUE_PREFIX`), never
  per-project. The same word-bounded scanner resolves `COL-<n>` references in chat
  messages and issue bodies into linked, status-dotted pills (struck through when the
  target is Done/Canceled).
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

## Install (any org)

Requirements: Docker + Docker Compose. Optional: a Cloudflare Tunnel token for public access.

1. `git clone <this repo> && cd lab-hub`
2. `cp .env.example .env` — set `BETTER_AUTH_SECRET` (`openssl rand -hex 32`),
   `POSTGRES_PASSWORD`, `APP_URL`, and SMTP credentials (any provider).
   For public access set `TUNNEL_TOKEN` and your domain as `APP_URL`.
3. `docker compose --profile prod up -d --build`
   (add `--profile tunnel` for Cloudflare Tunnel)
   The app applies database migrations automatically on start.
4. Open the app → the setup wizard configures your organisation name, logo,
   accent colour, timezone, and the first admin account.
5. Invite people from the People page. Guests (e.g. FYP students,
   collaborators) only need an email address.

## Operations

- **Backup:** `./scripts/backup.sh` → `backups/` (database dump + uploads).
- **Restore:**
  ```
  gunzip -c backups/labhub-<stamp>.sql.gz | docker compose exec -T db psql -U labhub labhub
  ```
  Restore into a fresh database volume (or after `docker compose down -v`) and
  restart the app; to restore uploads, untar the uploads archive and
  `docker compose cp` the extracted folder to `app:/data/uploads`.
- **Upgrade:** `git pull && docker compose --profile prod up -d --build`
  (migrations apply automatically on start).
- **Dev:** `docker compose up -d db && npm install && npm run dev`

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
[docs/slack-cutover.md](docs/slack-cutover.md).

## Tests

- `npm run test:unit` — pure logic (policy engine, recurrence, chips, templates)
- `npm run test:int` — services + API against real Postgres (`labhub_test`)
- `npm run test:e2e` — Playwright journeys, incl. `e2e/a11y.spec.ts` (axe-core, both themes)
- `npm run coverage` — ≥85% gate on src/lib + src/features (unit + integration)
- `npm run contrast` — WCAG contrast gate over the token pairs + all 10 accents × both themes
