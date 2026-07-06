#!/usr/bin/env bash
# One-command backup: database dump + uploads archive into ./backups/
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y-%m-%d-%H%M)
mkdir -p backups
docker compose exec -T db pg_dump -U labhub labhub | gzip > "backups/labhub-${STAMP}.sql.gz"
docker compose cp app:/data/uploads "backups/uploads-${STAMP}" 2>/dev/null && tar -czf "backups/uploads-${STAMP}.tar.gz" -C backups "uploads-${STAMP}" && rm -rf "backups/uploads-${STAMP}" || echo "note: app container not running or no uploads yet — database dumped only"
echo "Backup written to backups/labhub-${STAMP}.sql.gz"
