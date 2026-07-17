# LabHub Operator Card (macOS / Colima — tunnel)

Run from the repo root. All commands are bash. The stack is served over HTTPS via the
Cloudflare tunnel; every server compose call uses **`--profile prod --profile tunnel`**.

| Action | Command |
|---|---|
| **Update** (newest tag) | `./scripts/macos/update.sh` |
| **Update** (specific) | `./scripts/macos/update.sh vX.Y.Z` |
| **Roll back** | `./scripts/macos/rollback.sh vX.Y.Z` |
| **Back up** (also nightly 03:00) | `./scripts/backup.sh` |
| **Check health** | `curl http://localhost:3000/api/health` |
| **View logs** | `docker compose --profile prod --profile tunnel logs -f app` |
| **Bring stack up** | `./scripts/macos/stack-up.sh` (or `docker compose --profile prod --profile tunnel up -d`) |

> **Tags must match `package.json`.** A release tag = `v` + the `package.json` version. Cut
> releases with `npm run release` only — a hand-made tag whose name disagrees makes `update.sh`
> report FAILED on a healthy stack (the health-gate compares the tag to `/api/health`'s version).

> **`APP_URL` is exact + loopback-only binds.** `APP_URL` must equal the public Cloudflare
> hostname exactly (`https://labhub.<domain>`, no port/slash). `APP_PORT=3000` is the on-box
> health-poll port only; the host publishes nothing off-box (ingress is the outbound tunnel).

## Restore (catastrophe only — data corruption, NOT a version rollback)
Version rollbacks are data-safe (additive-only migrations). Dumps are self-cleaning
(`pg_dump --clean --if-exists`) — pipe one straight into the populated DB:
```bash
docker compose --profile prod --profile tunnel stop app
gunzip -c backups/labhub-<stamp>.sql.gz | docker compose exec -T db psql -U labhub labhub
# uploads (if needed) — the archive's top-level entry is the stamped dir uploads-<stamp>/,
# so copy from that path (NOT /tmp/uploads/):
tar -xzf backups/uploads-<stamp>.tar.gz -C /tmp && docker compose cp /tmp/uploads-<stamp>/. app:/data/uploads
# docker compose cp writes into the volume as uid 0; fix ownership once so the non-root app
# (uid 1000 node) can serve the files. Adapt the volume name — it is <compose-project>_uploads
# (e.g. labhub_uploads when cloned to $HOME/labhub); docker volume ls | grep uploads:
docker run --rm -u 0 -v labhub_uploads:/data/uploads busybox chown -R 1000:1000 /data/uploads
docker compose --profile prod --profile tunnel up -d app
```

## Onboarding without email
SMTP is off, so invitation emails only queue. On **People**, create an invite and use **Copy
link** to share the accept URL directly. **Resending rotates the token** and invalidates the
previously copied link.

---

## Legacy (Windows LAN beta — superseded by macOS/tunnel)
The SP6 Windows-laptop LAN beta (plain HTTP) is retired. Its commands are retained here for
reference only; the current deployment is the macOS/Colima tunnel above. See
`docs/ops/windows-server.md` (legacy).

| Action | Command |
|---|---|
| Update (newest / specific) | `.\scripts\windows\update.ps1` / `.\scripts\windows\update.ps1 -Tag vX.Y.Z` |
| Roll back | `.\scripts\windows\rollback.ps1 -Tag vX.Y.Z` |
| Back up | `.\scripts\windows\backup.ps1` |
| Health | `Invoke-RestMethod http://<host>/api/health` |
| Logs | `docker compose --profile prod logs -f app` |

Windows restore (PowerShell, self-cleaning dump into the db container) is preserved in
`docs/ops/windows-server.md`.
