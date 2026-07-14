# COLOSSUS Operator Card (Windows laptop)

Run from the repo root (`C:\colossus`). All commands are PowerShell.

| Action | Command |
|---|---|
| **Update** (newest tag) | `.\scripts\windows\update.ps1` |
| **Update** (specific) | `.\scripts\windows\update.ps1 -Tag vX.Y.Z` |
| **Roll back** | `.\scripts\windows\rollback.ps1 -Tag vX.Y.Z` |
| **Back up** (also nightly) | `.\scripts\windows\backup.ps1` |
| **Check health** | `Invoke-RestMethod http://<host>/api/health` (or open in a browser) |
| **View logs** | `docker compose --profile prod logs -f app` |

> **Tags must match `package.json`.** A release tag = `v` + the `package.json` version. Cut
> releases with `npm run release` only — a hand-made tag whose name disagrees (e.g. `v0.9.1`
> on a build that reports `0.9.0-beta`) makes `update.ps1` report **FAILED** on a stack that
> actually deployed fine, because the health-gate compares the tag to `/api/health`'s version.

> **`APP_URL` ↔ `APP_PORT`.** If `.env` has `APP_PORT=80`, `APP_URL` must be port-less
> (`http://<host>/`); any other port must appear in **both**. A mismatch points every
> invitation, ICS feed, and email link at a dead address.

## Restore (catastrophe only — data corruption, NOT a version rollback)
Version rollbacks are data-safe (additive-only migrations); a DB restore is only for a
genuine data catastrophe. Dumps are **self-cleaning** (`pg_dump --clean --if-exists`):
piping one into the still-populated DB drops and recreates every object. (Dumps taken
**before** the self-cleaning change need a manual
`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` in psql first.) From the repo root:
```powershell
# 1. Stop the app (keep the db running).
docker compose --profile prod stop app
# 2. Restore the chosen DB dump into Postgres. Copy the .sql INTO the db container and run
#    psql -f THERE, so the UTF-8 dump never transits PowerShell's string/ANSI pipeline
#    (Get-Content + a native-process pipe mojibake non-ASCII rows on Windows PowerShell 5.1).
Expand-Archive .\backups\labhub-<stamp>.sql.zip -DestinationPath .\backups\_restore -Force
docker compose --profile prod cp .\backups\_restore\labhub-<stamp>.sql db:/tmp/restore.sql
docker compose --profile prod exec -T db psql -U labhub -d labhub -f /tmp/restore.sql
docker compose --profile prod exec -T db rm -f /tmp/restore.sql
Remove-Item .\backups\_restore -Recurse -Force
# 3. (If needed) restore uploads into the volume.
Expand-Archive .\backups\uploads-<stamp>.zip -DestinationPath .\backups\_uploads -Force
docker compose --profile prod cp .\backups\_uploads\. app:/data/uploads
Remove-Item .\backups\_uploads -Recurse -Force
# 4. Bring the app back.
docker compose --profile prod up -d app
```

## Onboarding without email
SMTP is off during the beta, so invitation emails only queue. On **People**, create an
invite and use **Copy link** to share the accept URL directly. **Resending rotates the
token** and invalidates the previously copied link.
