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
# A mirror hiccup must NEVER fail the backup (the primary in ./backups already succeeded), but we
# must NEVER claim a mirror success that did not happen (DR honesty — the backup you discover is
# empty when you finally need it). Capture each copy result and report per-artifact; a failure
# goes to stderr as a WARNING. Prune the mirror to keep-last-14 too, so the second disk can't fill
# and then silently reject every future copy while still printing success.
if [ -n "${BACKUP_MIRROR_PATH:-}" ]; then
  if [ -d "$BACKUP_MIRROR_PATH" ]; then
    if cp -f "backups/labhub-${STAMP}.sql.gz" "$BACKUP_MIRROR_PATH"/ 2>/dev/null; then
      echo "Mirrored backups/labhub-${STAMP}.sql.gz to $BACKUP_MIRROR_PATH"
    else
      echo "WARNING: mirror copy of labhub-${STAMP}.sql.gz to $BACKUP_MIRROR_PATH FAILED" >&2
    fi
    if [ -f "backups/uploads-${STAMP}.tar.gz" ]; then
      if cp -f "backups/uploads-${STAMP}.tar.gz" "$BACKUP_MIRROR_PATH"/ 2>/dev/null; then
        echo "Mirrored backups/uploads-${STAMP}.tar.gz to $BACKUP_MIRROR_PATH"
      else
        echo "WARNING: mirror copy of uploads-${STAMP}.tar.gz to $BACKUP_MIRROR_PATH FAILED" >&2
      fi
    fi
    # Retention on the mirror (keep newest 14 of each class), mirroring the ./backups policy above.
    for pat in "labhub-*.sql.gz" "uploads-*.tar.gz"; do
      # shellcheck disable=SC2012
      ls -1t "$BACKUP_MIRROR_PATH"/$pat 2>/dev/null | tail -n +15 | while IFS= read -r f; do rm -f "$f"; done || true
    done
  else
    echo "WARNING: BACKUP_MIRROR_PATH '$BACKUP_MIRROR_PATH' not found — mirror skipped (no second copy made)." >&2
  fi
fi

echo "Backup written to backups/labhub-${STAMP}.sql.gz"
