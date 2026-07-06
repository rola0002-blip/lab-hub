# LabHub

Self-hosted lab platform: equipment booking with per-instrument policies,
certification gating, approvals, recurring bookings, and maintenance windows.
Messaging and project management arrive in later releases on this same foundation.

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

## Tests

- `npm run test:unit` — pure logic (policy engine, recurrence, chips, templates)
- `npm run test:int` — services + API against real Postgres (`labhub_test`)
- `npm run test:e2e` — Playwright journeys
- `npm run coverage` — ≥85% gate on src/lib + src/features (unit + integration)
