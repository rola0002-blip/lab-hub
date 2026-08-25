#!/usr/bin/env bash
# stack-up.sh — boot wrapper for the com.labhub.stack LaunchAgent (SP7 §8.5). Sets the PATH
# (Apple-Silicon Homebrew is not on launchd's default PATH), starts Colima idempotently
# (reusing the profile provisioned at setup), waits for the Docker engine, then brings the
# full prod+tunnel stack up. A wrapper (not an inline plist one-liner) keeps the
# Colima-before-compose ordering + repo cd robust and reviewable.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.."

# Idempotent: `colima start` reuses the existing VM/profile if already running.
colima start 2>&1 || true

# Wait (up to ~60s) for the Docker engine to be reachable before composing.
for _ in $(seq 1 30); do
  docker version >/dev/null 2>&1 && break
  sleep 2
done

# Memory-floor guard (F8, kept as a general resource check). Since SP10 the stack runs
# the PUBLISHED image (docker-compose.image.yml) — no in-VM production build — but a
# starved VM still hurts Postgres + Next at lab scale; warn (never block boot).
# Best-effort parse — never fatal (jq may be absent; colima's JSON shape varies across versions).
MEM_FLOOR_GIB=12
mem_bytes="$(colima list --json 2>/dev/null | sed -n 's/.*"memory":\([0-9][0-9]*\).*/\1/p' | head -1)" || mem_bytes=""
if [ -n "$mem_bytes" ]; then
  mem_gib=$(( mem_bytes / 1073741824 ))
  if [ "$mem_gib" -lt "$MEM_FLOOR_GIB" ]; then
    echo "WARNING: Colima VM has ${mem_gib} GiB (< ${MEM_FLOOR_GIB} GiB floor) — the stack may struggle." >&2
    echo "  Recreate sized: colima stop && colima start --memory ${MEM_FLOOR_GIB} --cpu 4" >&2
  fi
fi

# SP10 posture: run the published GHCR image (fast, no local build). LABHUB_VERSION
# comes from .env when present (set at dogfood migration), else latest. --pull always
# picks up new releases on boot; on pull failure the local image still boots.
LABHUB_VERSION="$(sed -n 's/^LABHUB_VERSION=//p' .env 2>/dev/null | tail -1)"
export LABHUB_VERSION="${LABHUB_VERSION:-latest}"
docker compose -f docker-compose.yml -f docker-compose.image.yml \
  --profile prod --profile tunnel up -d --pull always
