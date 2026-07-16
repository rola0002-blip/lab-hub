#!/usr/bin/env bash
# update.sh [<vX.Y.Z>] — the one-command patch for the macOS/Colima tunnel host. Backs up
# first, checks out the target tag (newest v* by default), rebuilds the prod+tunnel stack
# (the container re-runs `prisma migrate deploy` at start), then polls /api/health until the
# served version equals the tag. Prints the exact rollback + logs commands on any failure.
# NEVER pushes; only ever pulls tags. All compose calls use --profile prod --profile tunnel.
set -euo pipefail
cd "$(dirname "$0")/../.."
TIMEOUT="${TIMEOUT:-180}"

# 1. Preflight — Colima/Docker reachable?
if ! docker version >/dev/null 2>&1; then
  echo 'Docker is not reachable — start Colima (`colima start`) and retry.' >&2
  exit 1
fi

# 2. Record the current version marker for the rollback hint.
prev="$(git tag --points-at HEAD | head -1)"
[ -n "$prev" ] || prev="$(git rev-parse --short HEAD)"
echo "Current version marker: $prev"

# 3. Back up first — no patch without a fresh backup.
if ! ./scripts/backup.sh; then
  echo 'Backup failed — aborting update (no patch without a fresh backup).' >&2
  exit 1
fi

# 4. Fetch tags; resolve the target (arg, else newest by version sort).
git fetch --tags --force
tag="${1:-}"
[ -n "$tag" ] || tag="$(git tag --list 'v*' --sort=-v:refname | head -1)"
[ -n "$tag" ] || { echo 'No v* tags found to deploy.' >&2; exit 1; }
expect="${tag#v}"
echo "Deploying $tag (version $expect)"

# 5. Check out the tag (detached) + rebuild. Capture the compose outcome instead of letting
#    `set -e` abort here: cloudflared's `service_healthy` gate makes `up -d` BLOCK until the
#    app is healthy and return NON-ZERO if the image fails to build or never becomes healthy,
#    so the build/start-error path MUST fall through to the guidance block below (spec §8.2
#    step 8) — exactly as update.ps1 branches on $built rather than relying on errexit.
git checkout "$tag"
built=1
docker compose --profile prod --profile tunnel up -d --build || built=0

# 6. Health-gate (only if the build/start succeeded) — poll the loopback /api/health until
#    version == tag (leading v stripped). The `|| ver=""` / `|| app_port=""` guards keep a
#    not-yet-ready endpoint (a refused/non-2xx `curl -fsS`, non-zero under pipefail) from
#    tripping `set -e` mid-loop: a failed probe is a normal "keep waiting", not a fatal error.
if [ "$built" = 1 ]; then
  app_port="$(sed -n 's/^APP_PORT=\([0-9][0-9]*\).*/\1/p' .env 2>/dev/null | head -1)" || app_port=""
  app_port="${app_port:-3000}"
  url="http://localhost:${app_port}/api/health"
  deadline=$(( $(date +%s) + TIMEOUT ))
  echo "Polling $url for version $expect ..."
  while [ "$(date +%s)" -lt "$deadline" ]; do
    ver="$(curl -fsS "$url" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')" || ver=""
    if [ "$ver" = "$expect" ]; then
      echo "SUCCESS — COLOSSUS $tag is live (health reports $expect)."
      exit 0
    fi
    if [ -n "$ver" ]; then echo "  serving $ver, waiting for $expect ..."; else echo "  health endpoint not up yet ..."; fi
    sleep 3
  done
  echo "UPDATE FAILED for $tag (health never reported $expect within ${TIMEOUT}s)." >&2
else
  echo "UPDATE FAILED for $tag (docker compose build/start returned non-zero)." >&2
fi

# 7. Failure → precise recovery guidance (reached on build/start failure OR health timeout).
echo "Roll back to the previous version:" >&2
echo "  ./scripts/macos/rollback.sh $prev" >&2
echo "Inspect logs:" >&2
echo "  docker compose --profile prod --profile tunnel logs -f app" >&2
exit 1
