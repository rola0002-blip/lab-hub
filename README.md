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
when you have no tab open — opt-in, and silenced per conversation by mute.
Membership is the single authorization rule: you only ever read, search, or
receive events for conversations you are a member of.

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
- `npm run test:e2e` — Playwright journeys
- `npm run coverage` — ≥85% gate on src/lib + src/features (unit + integration)
