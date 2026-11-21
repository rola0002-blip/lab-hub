#!/usr/bin/env bash
# update.sh [<vX.Y.Z>] — the one-command patch for the macOS/Colima tunnel host. Backs up
# first, checks out the target tag (newest v* by default), builds it as the image
# ghcr.io/rola0002-blip/lab-hub:<tag> and starts it through docker-compose.image.yml — the
# image the boot path (stack-up.sh) runs; the container re-runs `prisma migrate deploy` at
# start — then polls /api/health until the served version equals the tag. Only then does it
# pin LABHUB_VERSION=<tag> in .env (the next boot starts the same version) and remove the
# older local LabHub images, except the one it replaced (rollback.sh reuses that one).
# Prints the exact rollback + logs commands on any failure. NEVER pushes; only ever pulls
# tags. All compose calls use --profile prod --profile tunnel. The checkout stays detached
# at the tag (on a development checkout, run `git switch main` afterwards).
set -euo pipefail
cd "$(dirname "$0")/../.."
# Before the checkout in step 5: a tag older than deploy-lib.sh has no copy of it.
# shellcheck source=scripts/macos/deploy-lib.sh
. scripts/macos/deploy-lib.sh
TIMEOUT="${TIMEOUT:-180}"

# 1. Preflight — a tag given as the argument must be a release tag (checked before the
#    backup), and Colima/Docker must be reachable.
if [ -n "${1:-}" ] && ! valid_tag "$1"; then
  echo "Not a release tag: $1 (expected vX.Y.Z)." >&2
  exit 1
fi
if ! docker version >/dev/null 2>&1; then
  echo 'Docker is not reachable — start Colima (`colima start`) and retry.' >&2
  exit 1
fi

# 2. Record what runs now: the rollback target, and the one old image that step 7 keeps.
#    /api/health is the truth; when the stack is down, the git marker is the fallback and
#    step 7 removes no images (the version that ran is unknown).
app_port="$(sed -n 's/^APP_PORT=\([0-9][0-9]*\).*/\1/p' .env 2>/dev/null | head -1)" || app_port=""
app_port="${app_port:-3000}"
url="http://localhost:${app_port}/api/health"
running="$(curl -fsS --max-time 5 "$url" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')" || running=""
prev_running=0
if [ -n "$running" ] && valid_tag "v$running"; then
  prev="v$running"
  prev_running=1
else
  prev="$(git tag --points-at HEAD | head -1)"
  [ -n "$prev" ] || prev="$(git rev-parse --short HEAD)"
fi
echo "Current version marker: $prev"

# 3. Back up first — no patch without a fresh backup.
if ! ./scripts/backup.sh; then
  echo 'Backup failed — aborting update (no patch without a fresh backup).' >&2
  exit 1
fi

# 4. Fetch tags; resolve the target (arg, else newest by version sort). Best-effort fetch (F9
#    symmetry): a network/PAT blip must not abort under `set -e` — the checkout below still fails
#    loudly if the resolved tag is genuinely absent locally, and the backup (step 3) already ran.
git fetch --tags --force || echo 'warning: tag fetch failed; using local tags.' >&2
tag="${1:-}"
[ -n "$tag" ] || tag="$(git tag --list 'v*' --sort=-v:refname | head -1)"
[ -n "$tag" ] || { echo 'No v* tags found to deploy.' >&2; exit 1; }
valid_tag "$tag" || { echo "Not a release tag: $tag (expected vX.Y.Z)." >&2; exit 1; }
expect="${tag#v}"
echo "Deploying $tag (version $expect)"

# 5. Check out the tag (detached), build it as $LABHUB_IMAGE:$tag, and start it. Capture the
#    outcome instead of letting `set -e` abort here: cloudflared's `service_healthy` gate
#    makes `up -d` BLOCK until the app is healthy and return NON-ZERO if it never becomes
#    healthy, so a build/start error MUST fall through to the guidance block below (spec
#    §8.2 step 8) — exactly as update.ps1 branches on $built rather than relying on errexit.
#    .env still pins the old version here; step 7 writes the new one.
git checkout "$tag"
built=0
if build_image "$tag" && start_image "$tag"; then built=1; fi

# 6. Health-gate (only if the build/start succeeded) — poll the loopback /api/health until
#    version == tag (leading v stripped). The `|| ver=""` guard keeps a not-yet-ready
#    endpoint (a refused/non-2xx `curl -fsS`, non-zero under pipefail) from tripping
#    `set -e` mid-loop: a failed probe is a normal "keep waiting", not a fatal error.
if [ "$built" = 1 ]; then
  deadline=$(( $(date +%s) + TIMEOUT ))
  echo "Polling $url for version $expect ..."
  while [ "$(date +%s)" -lt "$deadline" ]; do
    ver="$(curl -fsS "$url" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')" || ver=""
    if [ "$ver" = "$expect" ]; then
      # 7. Pin the tag for the boot path, then remove the older images (best effort).
      if ! pin_version "$tag"; then
        echo "UPDATE INCOMPLETE — $tag is live, but .env could not be written. Set" >&2
        echo "  LABHUB_VERSION=$tag in .env by hand, or the next boot starts the old pin." >&2
        exit 1
      fi
      if [ "$prev_running" = 1 ]; then prune_images "$tag" "$prev" || true; fi
      warn_old_boot "$tag"
      echo "SUCCESS — LabHub $tag is live (health reports $expect); .env pins LABHUB_VERSION=$tag."
      exit 0
    fi
    if [ -n "$ver" ]; then echo "  serving $ver, waiting for $expect ..."; else echo "  health endpoint not up yet ..."; fi
    sleep 3
  done
  echo "UPDATE FAILED for $tag (health never reported $expect within ${TIMEOUT}s)." >&2
else
  echo "UPDATE FAILED for $tag (docker compose build/start returned non-zero)." >&2
fi

# 8. Failure → precise recovery guidance (reached on build/start failure OR health timeout).
#    .env is unchanged, so a reboot starts the version it pinned before this run.
echo "Roll back to the previous version:" >&2
if valid_tag "$prev"; then
  echo "  ./scripts/macos/rollback.sh $prev" >&2
else
  echo "  ./scripts/macos/rollback.sh <previous vX.Y.Z>   (the running version was unknown: $prev)" >&2
fi
echo "Inspect logs:" >&2
echo "  docker compose --profile prod --profile tunnel logs -f app" >&2
exit 1
