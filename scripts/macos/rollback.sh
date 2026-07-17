#!/usr/bin/env bash
# rollback.sh <vX.Y.Z> — return the tunnel host to a prior version. Checks out the tag,
# rebuilds the prod+tunnel stack, and health-gates on that version. Because migrations are
# ADDITIVE ONLY (no down-migrations), rolling CODE back is data-safe: columns a newer tag
# added simply persist unused — nothing is un-applied. A DB *restore* is for data catastrophe
# only (docs/ops/ops-card.md), NOT a version rollback. All compose calls use both profiles.
set -euo pipefail
cd "$(dirname "$0")/../.."
TIMEOUT="${TIMEOUT:-180}"

tag="${1:-}"
[ -n "$tag" ] || { echo 'usage: scripts/macos/rollback.sh <vX.Y.Z>' >&2; exit 2; }

if ! docker version >/dev/null 2>&1; then
  echo 'Docker is not reachable — start Colima (`colima start`) and retry.' >&2
  exit 1
fi

expect="${tag#v}"
echo "Rolling back to $tag (version $expect) ..."
# Best-effort fetch: rollback runs DURING an incident, and $tag is by construction a
# previously-deployed tag already present locally. A fetch failure (GitHub/DNS/Cloudflare down,
# expired read-only PAT, transient blip) must NOT abort recovery under `set -e` — `git checkout`
# below is the authority and still fails loudly/safely if the tag is genuinely absent locally.
git fetch --tags --force || echo 'warning: tag fetch failed; using local tags.' >&2
git checkout "$tag"
# Capture the compose outcome so a failed build/start falls through to the guidance block
# instead of aborting under `set -e` (mirrors rollback.ps1's $LASTEXITCODE check).
built=1
docker compose --profile prod --profile tunnel up -d --build || built=0

if [ "$built" = 1 ]; then
  app_port="$(sed -n 's/^APP_PORT=\([0-9][0-9]*\).*/\1/p' .env 2>/dev/null | head -1)" || app_port=""
  app_port="${app_port:-3000}"
  url="http://localhost:${app_port}/api/health"
  deadline=$(( $(date +%s) + TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    # `|| ver=""` keeps a not-yet-ready endpoint from tripping `set -e` mid-loop.
    ver="$(curl -fsS "$url" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')" || ver=""
    if [ "$ver" = "$expect" ]; then
      echo "SUCCESS — rolled back to $tag ($expect is live)."
      exit 0
    fi
    sleep 3
  done
  echo "Rolled back code to $tag but health never confirmed $expect within ${TIMEOUT}s — check:" >&2
else
  echo "Rollback build/start for $tag returned non-zero — check:" >&2
fi
echo "  docker compose --profile prod --profile tunnel logs -f app" >&2
exit 1
