#!/usr/bin/env bash
# One-command backup: self-cleaning database dump + uploads archive into ./backups/.
# Keeps the last 14 of each class; optionally mirrors new artifacts to BACKUP_MIRROR_PATH
# (a second LOCAL disk, e.g. an external SSD mount). No cloud mirror (SP7 §8.4).
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y-%m-%d-%H%M)
mkdir -p backups

# --- DB dump (self-cleaning) → gzip ---
# --clean --if-exists drops each object before recreating it, so a catastrophe restore can
# pipe straight into a populated DB (docs/ops/ops-card.md). On macOS the `exec -T … | gzip`
# pipe is a RAW BYTE stream — the shell never string-decodes it — so emoji / CJK / accented
# names round-trip byte-identically (no PowerShell 5.1 OEM/ANSI dance needed; §13 verifies).
docker compose exec -T db pg_dump --clean --if-exists -U labhub labhub | gzip > "backups/labhub-${STAMP}.sql.gz"

# --- Uploads archive (tolerate app down / no uploads yet) ---
docker compose cp app:/data/uploads "backups/uploads-${STAMP}" 2>/dev/null \
  && tar -czf "backups/uploads-${STAMP}.tar.gz" -C backups "uploads-${STAMP}" \
  && rm -rf "backups/uploads-${STAMP}" \
  || echo "note: app container not running or no uploads yet — database dumped only"

# --- Retention: keep the newest 14 of each class ---
# ls -t sorts newest-first; tail -n +15 selects the 15th onward; delete those. The || true
# neutralises a no-match `ls` failure under pipefail. Stamps carry no spaces, so word-split is safe.
for pat in "labhub-*.sql.gz" "uploads-*.tar.gz"; do
  # shellcheck disable=SC2012
  ls -1t backups/$pat 2>/dev/null | tail -n +15 | while IFS= read -r f; do rm -f "$f"; done || true
done

# --- Optional local-disk mirror ---
if [ -n "${BACKUP_MIRROR_PATH:-}" ]; then
  if [ -d "$BACKUP_MIRROR_PATH" ]; then
    cp -f "backups/labhub-${STAMP}.sql.gz" "$BACKUP_MIRROR_PATH"/ 2>/dev/null || true
    if [ -f "backups/uploads-${STAMP}.tar.gz" ]; then
      cp -f "backups/uploads-${STAMP}.tar.gz" "$BACKUP_MIRROR_PATH"/ 2>/dev/null || true
    fi
    echo "Mirrored backup(s) to $BACKUP_MIRROR_PATH"
  else
    echo "note: BACKUP_MIRROR_PATH '$BACKUP_MIRROR_PATH' not found — skipped mirror."
  fi
fi

echo "Backup written to backups/labhub-${STAMP}.sql.gz"
