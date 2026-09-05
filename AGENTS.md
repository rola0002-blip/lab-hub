<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# LabHub repo guide

Public open-source repo (MIT) at `rola0002-blip/lab-hub`. Self-hosted lab platform:
equipment booking (certification gating + training records, approvals, usage
logging), Slack-style chat (SSE realtime,
web push), issue tracker (`LAB-n`) + projects, shared Files library, RA acknowledgments,
feedback system — one Docker install per lab, plus a Tauri 2 desktop shell and an
installable PWA. Node 22+ required. Full maintainer doctrine lives in `CLAUDE.md`
(local-only; the SP10 flip stripped it from public history — kept out via `.gitignore`,
never commit it); public docs: `docs/features.md`, `docs/desktop.md`,
`docs/ops/distribution.md`.

## Layout

- `src/app/` — App Router pages (`(app)/` authed surfaces, `(auth)/`, `setup/` wizard)
  and `api/` (better-auth catch-all, chat, bookings, documents, issues, feedback, push,
  `uploads/[...path]` serving, `health`, `events` SSE, `activity`).
- `src/features/<domain>/` — ALL business logic lives in `service.ts` / `policy.ts` /
  pure client-safe modules (16 domains: booking, chat, issues, documents, feedback, ra,
  bot, calendar, certifications, equipment, invitations, maintenance, people, settings,
  admin, …). Pages and route handlers stay thin.
- `src/lib/` — cross-cutting: `auth.ts` (better-auth), `db.ts` (Prisma), `events.ts`
  (SSE + pg LISTEN/NOTIFY — no WebSockets anywhere), `uploads.ts`, `email/outbox.ts`
  (the ONLY sanctioned mail path), `chime.ts`/`push*.ts`/`activity.ts` (notification
  lane), `jobs.ts`, `time.ts`.
- `src/components/` — App UI incl. `chat/`, `issues/`, `booking/`, `ui/` primitives.
- `prisma/` — 34 models, 24 hand-written additive guarded migrations (re-runnable;
  IF NOT EXISTS / DO$$ guards; partials created BEFORE dropping what they replace).
- `tests/unit/` (no DB), `tests/integration/` (real Postgres via `TEST_DATABASE_URL`),
  `e2e/` (19 Playwright specs + `helpers.ts`).
- `desktop/` — Tauri 2 shell: Rust crate `src-tauri` (`webviews.rs` chrome rail + one
  remote webview per lab server, `notify.rs` toasts, `badges.rs` dock badge,
  `updater.rs`, `tray.rs`, `config.rs`, `servers.rs`, `commands.rs`), static rail UI
  `desktop/ui` (no framework, `notify-shim.js` replaces `window.Notification`).
  Version-sync against root `package.json` is build-enforced (`build.rs` asserts).
- `install.sh` + `docker-compose.dist.yml` + `templates/labhub-wrapper.sh` — the
  curl-able one-line installer (POSIX-sh safe, runs under dash). CI workflows: `ci.yml`
  (lint/contrast/coverage + e2e vs a Postgres service; e2e runs a PRODUCTION build via
  `E2E_WEB_SERVER=build`, not `next dev`), `release.yml` (multi-arch GHCR image +
  GitHub Release), `desktop-check.yml` (fmt/clippy/cargo test/bundle, macOS + Windows),
  `desktop-release.yml` (v* tags → dmg + signed app.tar.gz + NSIS exe + `latest.json`),
  `installer-smoke.yml` (install.sh on clean amd64/arm64 runners — dispatch manually
  after each release).

## Architecture invariants

- Roles: `admin` | `member` | `guest` (lowercase). One Organization row.
- Permission checks funnel through per-domain policy choke points (`*-policy.ts`,
  re-exporting `PolicyError`/`policyStatus`); guests are read-only on issues/projects.
- Chat authorization = `ConversationMember`; every chat read/write/search/SSE event
  checks membership. Chat uploads serve through `src/app/uploads/[...path]/route.ts`
  with a per-kind gate (chat = membership; documents/avatars/issues/feedback/
  project-updates = any session; unknown kinds stay PUBLIC until the route learns them).
- Booking overlap safety = Postgres exclusion constraint `booking_no_overlap`.
- Store UTC, render in org timezone (`src/lib/time.ts`).
- System rows are load-bearing: bot id `colossus-bot`, channel id `colossus-lab-updates`
  (seeded by migration; renaming orphans the bot, memberships, and every bot message).
  Issue identifiers render `LAB-n` (`identifier.ts`); `COL-` is a read-only legacy
  parse alias — never rendered.
- Realtime = SSE + pg LISTEN/NOTIFY. Never add a new `LabEvent` member without a
  completed circuit; the desktop shell derives unread badges from `(n)` document-title
  writes (`chat-title-badge.tsx` is the only title writer).
- Refresh = `revalidatePath` + `router.refresh()`. Email only via outbox. The bot is
  the only `isSystem` user: excluded from every human enumeration and from fan-out.
- Semantic design tokens only (`globals.css`, light + dark); WCAG contrast is a CI gate.

## Commands

- `npm run dev` (needs `docker compose up -d db`) · `npm run build` · `npm run lint`
- `npm run test:unit` · `TEST_DATABASE_URL=… npm run test:int` · `npm run coverage`
  (gate: ≥85% lines/functions, ≥80% branches on src/lib + src/features)
- `npm run contrast` (WCAG token + accent pairs) · `npx playwright test`
- `npm run import:slack -- <export.zip>` (idempotent, additive)
- `npm run release -- patch|minor|major` — bumps `package.json`,
  `desktop/src-tauri/Cargo.toml`, `tauri.conf.json`, and `Cargo.lock` TOGETHER, rolls
  the CHANGELOG `[Unreleased]` section, commits + tags; NEVER pushes.
- Desktop gates (from `desktop/src-tauri`): `cargo fmt --check` ·
  `cargo clippy --all-targets --locked -- -D warnings` · `cargo test --locked` ·
  regression harness `cargo run --example smoke` (macOS, live network).

## Testing doctrine

- Integration/e2e/coverage need `TEST_DATABASE_URL` pointed at the `labhub_test` DB.
- e2e: no hardcoded screenshot paths; sent-message assertions scope to the chat log
  (`getByLabel('Messages')`/`logMsg`) — unscoped `getByText` matches the composer
  draft during the optimistic-send window; `waitForHydration` (e2e/helpers) gates every
  post-navigation synthesized event; menus close per pick and by re-focusing a field,
  never a global Escape. A full e2e run WIPES the test DB (seed via `runWizard` /
  `seedSystem` in `e2e/helpers.ts`).

## Rules that bite

- Never push to a remote without Roland's explicit instruction (the release flow tags
  locally and prints the push command).
- Never commit: `.env*`, `CLAUDE.md`, `docs/superpowers/**`, `docs/handoffs/**`
  (internal narratives stay private; pre-flip history archive lives under
  `~/Documents/Systems/`).
- Tauri updater signing key: `~/Documents/Systems/labhub-desktop-updater-key/` (also GH
  secrets `TAURI_SIGNING_PRIVATE_KEY*`). Losing it breaks all future desktop
  auto-updates.
- Desktop shell: the content-webview builder must keep `disable_drag_drop_handler()`
  (Tauri's default drop interceptor consumes OS file drags before the web app's HTML5
  dropzones see them) and `.on_download` (accept-as-is; wry already seeds the
  destination). The updater STAGES releases — installing is a tray click; when desktop
  behavior "breaks", check the installed version before reading code.
- Hand-written migrations: additive + guarded, applied to BOTH `labhub` and
  `labhub_test`; if a migration file is edited post-apply, update
  `_prisma_migrations` checksums in both DBs.
