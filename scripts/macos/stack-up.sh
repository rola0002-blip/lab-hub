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

docker compose --profile prod --profile tunnel up -d
