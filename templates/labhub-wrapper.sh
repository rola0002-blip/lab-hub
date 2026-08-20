#!/usr/bin/env bash
# labhub — manage a LabHub dist install (this directory).
# Subcommands: update | backup | down | logs | status
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose -p labhub -f "$DIR/docker-compose.dist.yml")

# Tunnel profile only when a token is set in .env (cloudflared crash-loops on an empty one).
PROFILES=(--profile prod)
if grep -q '^TUNNEL_TOKEN=..*' "$DIR/.env" 2>/dev/null; then
  PROFILES+=(--profile tunnel)
fi

health() {
  local port
  port="$(grep -E '^APP_PORT=' "$DIR/.env" | cut -d= -f2)"
  port="${port:-3000}"
  curl -fsS "http://127.0.0.1:${port}/api/health"
}

case "${1:-}" in
  update)
    "${COMPOSE[@]}" pull app
    "${COMPOSE[@]}" "${PROFILES[@]}" up -d --remove-orphans
    for _ in $(seq 1 60); do
      if health >/dev/null 2>&1; then echo "Healthy:"; health; exit 0; fi
      sleep 2
    done
    echo "ERROR: health check failed after update — inspect: $0 logs" >&2
    exit 1
    ;;
  backup)
    mkdir -p "$DIR/backups"
    stamp="$(date +%Y%m%d-%H%M%S)"
    "${COMPOSE[@]}" exec -T db pg_dump -U labhub labhub | gzip > "$DIR/backups/labhub-$stamp.sql.gz"
    docker run --rm -v labhub_uploads:/data:ro -v "$DIR/backups:/backup" \
      alpine tar czf "/backup/uploads-$stamp.tar.gz" -C /data .
    echo "Wrote backups/labhub-$stamp.sql.gz and backups/uploads-$stamp.tar.gz"
    ;;
  down)
    "${COMPOSE[@]}" "${PROFILES[@]}" down
    ;;
  logs)
    "${COMPOSE[@]}" logs -f app
    ;;
  status)
    "${COMPOSE[@]}" ps
    health || true
    ;;
  *)
    echo "usage: labhub {update|backup|down|logs|status}" >&2
    exit 2
    ;;
esac
