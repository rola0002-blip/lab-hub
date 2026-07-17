#!/usr/bin/env bash
# stack-up.sh — boot wrapper for the com.colossus.stack LaunchAgent (SP7 §8.5). Sets the PATH
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

# Memory-floor guard (F8). The in-VM production build (prisma generate + next build on top of
# BuildKit + Postgres) needs headroom; a silently-recreated 2 GiB default VM OOM-kills the build
# and surfaces as a cryptic "UPDATE FAILED". Warn (never block boot) if the RUNNING VM is below
# the floor, so an under-sized VM is visible in the launchd log instead of a mystery failure.
# Best-effort parse — never fatal (jq may be absent; colima's JSON shape varies across versions).
MEM_FLOOR_GIB=12
mem_bytes="$(colima list --json 2>/dev/null | sed -n 's/.*"memory":\([0-9][0-9]*\).*/\1/p' | head -1)" || mem_bytes=""
if [ -n "$mem_bytes" ]; then
  mem_gib=$(( mem_bytes / 1073741824 ))
  if [ "$mem_gib" -lt "$MEM_FLOOR_GIB" ]; then
    echo "WARNING: Colima VM has ${mem_gib} GiB (< ${MEM_FLOOR_GIB} GiB floor) — the in-VM prod build may OOM." >&2
    echo "  Recreate sized: colima stop && colima start --memory ${MEM_FLOOR_GIB} --cpu 4" >&2
  fi
fi

docker compose --profile prod --profile tunnel up -d
