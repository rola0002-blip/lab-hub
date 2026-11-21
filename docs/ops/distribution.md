# Distribution & install reference (SP10)

How strangers get LabHub: a published image + a one-line installer. How the
maintainer ships that image.

## The moving parts

| Piece | What it is |
|---|---|
| `ghcr.io/rola0002-blip/lab-hub:<tag>` | Multi-arch (amd64/arm64) image, built by `.github/workflows/release.yml` on `v*` tags |
| `install.sh` (repo root) | curl-able installer: mints secrets, writes `~/labhub/.env`, starts the stack |
| `docker-compose.dist.yml` | Standalone compose file (image-only, no checkout) fetched by the installer |
| `templates/labhub-wrapper.sh` | The `labhub` management script the installer drops next to the compose file |
| `.github/workflows/installer-smoke.yml` | Runs the real installer on clean amd64 + arm64 runners after every release |

## Installer options

```
sh install.sh [--url <app-url>] [--tunnel-token <tok>] [--dir <path>]
              [--version <x.y.z|latest>] [--port <n>] [--force]
```

Env knobs: `APP_PORT` (default 3000) and `DB_PORT` (default 5432) — set when
those loopback ports are taken, e.g. `DB_PORT=5433 sh install.sh --url ...`.
Both are written into the generated `.env`.

- Omit `--url` for an interactive prompt (TTY only). `http://localhost:3000` = LAN-only.
- `--tunnel-token` adds the `tunnel` compose profile (Cloudflare HTTPS).
- Re-runs are idempotent: an existing install prints the update hint, exit 0.
- `--force` re-mints `.env` (old one is kept as `.env.bak.<stamp>`).

## The `labhub` wrapper

`update` (pull + recreate + health-wait) · `backup` (pg_dump + uploads tar →
`backups/`) · `down` · `logs` · `status`.

### Restoring a backup

Database: restore into a FRESH database volume (or after `labhub down` +
`docker volume rm labhub_db-data`), then restart:

```
gunzip -c backups/labhub-<stamp>.sql.gz | docker compose -p labhub \
  -f ~/labhub/docker-compose.dist.yml exec -T db psql -U labhub labhub
```

Uploads: the tarball archives the volume root, so restore with:

```
docker run --rm -i -v labhub_uploads:/data alpine \
  sh -c 'cd /data && tar xzf -' < backups/uploads-<stamp>.tar.gz
```

## Maintainer: cutting a release

1. `npm run release -- patch|minor|major` — bumps version, changelog, tag (never pushes).
2. Push branch → PR → merge; then confirm the repo and the GHCR package are
   PUBLIC (see docs/ops/public-flip.md) — the installer and the smoke
   runners fetch anonymously, so the smoke can only go green post-flip.
3. `git push origin main --follow-tags` — `release.yml` publishes the
   multi-arch image (`vX.Y.Z` + `latest`) and creates the GitHub Release
   with the changelog section as notes.
4. **Desktop artifacts** — the same tag push also runs
   `desktop-release.yml`: it builds the universal macOS dmg + signed
   `.app.tar.gz` updater artifact and the Windows NSIS installer
   (+ `.sig` files), then uploads them plus the updater manifest
   `latest.json` (which embeds the signatures and the changelog notes)
   to the release — waiting up to 10 min for `release.yml` to create the
   release first, so the two workflows never race on `gh release create`.
5. `installer-smoke.yml` installs from scratch on clean runners and asserts
   `/api/health` — green smoke = release good. (If it was red from the
   pre-flip anonymity gap, re-run it via workflow_dispatch once public.)

## Maintainer: dogfooding the image (this repo's own deployment)

The boot LaunchAgent (`scripts/macos/stack-up.sh`) runs the image named by
`LABHUB_VERSION` in `.env`, with the existing `labhub_*` volumes (see
`docker-compose.image.yml`). Keep that pin equal to the version you deploy: a
stale pin boots the older release at the next restart.

A published release:

```
./scripts/backup.sh    # safety net first
sed -i '' 's/^LABHUB_VERSION=.*/LABHUB_VERSION=vX.Y.Z/' .env
docker compose -f docker-compose.yml -f docker-compose.image.yml \
  --profile prod --profile tunnel up -d --pull always
curl -fsS http://127.0.0.1:<APP_PORT>/api/health   # confirm X.Y.Z
```

Any release tag, published or only tagged locally — `update.sh` backs up,
builds the tag as `ghcr.io/rola0002-blip/lab-hub:vX.Y.Z`, starts it, waits for
`/api/health` to report the version, and only then sets `LABHUB_VERSION` in
`.env`. It also removes older local LabHub images, keeping the version it
replaced:

```
./scripts/macos/update.sh vX.Y.Z
git switch main    # update.sh leaves the checkout detached at the tag
```

At boot, `stack-up.sh` pulls the pinned tag; when the pull fails (tag not yet
published, or no network) it boots the local image of the same tag. Roll back
with `./scripts/macos/rollback.sh vX.Y.Z`: it starts the local image of that
tag (or builds it) and sets the pin the same way.

NOTE: a git checkout and a dist install both use compose project `labhub` —
never run both simultaneously on the same machine. On the dev/dogfood
machine, use the checkout + image override above rather than `install.sh`.

## Windows labs

Run the installer under WSL2 + Docker Desktop. The stack itself is identical.
