#!/usr/bin/env bash
# LabHub one-line installer.
#   curl -fsSL https://raw.githubusercontent.com/rola0002-blip/lab-hub/main/install.sh | sh
# Non-interactive: sh install.sh --url https://lab.example.edu --tunnel-token <tok>
# Idempotent: a re-run against an existing install prints the update hint and exits 0.
# Keep the health-wait/profiles logic in sync with templates/labhub-wrapper.sh.
set -eu
# pipefail is not POSIX-portable (dash < 0.5.12, Ubuntu 22.04); probe it in a subshell.
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

# Documented target of the published image; not otherwise referenced yet.
# shellcheck disable=SC2034
IMAGE_REPO="ghcr.io/rola0002-blip/lab-hub"
COMPOSE_URL="https://raw.githubusercontent.com/rola0002-blip/lab-hub/main/docker-compose.dist.yml"
WRAPPER_URL="https://raw.githubusercontent.com/rola0002-blip/lab-hub/main/templates/labhub-wrapper.sh"
LABHUB_DIR="${LABHUB_DIR:-$HOME/labhub}"
LABHUB_VERSION="${LABHUB_VERSION:-latest}"
APP_URL=""
TUNNEL_TOKEN=""
APP_PORT="${APP_PORT:-3000}"
FORCE=0

fail() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "==> $*"; }

usage() {
  cat >&2 <<'EOF'
usage: install.sh [--url <app-url>] [--tunnel-token <tok>] [--dir <path>]
                  [--version <x.y.z|latest>] [--port <n>] [--force]

  --url           Public app origin, e.g. https://lab.example.edu
                  (omit for interactive prompt; http://localhost:3000 = LAN-only)
  --tunnel-token  Cloudflare Tunnel connector token (optional; enables the
                  tunnel profile for public HTTPS access)
  --dir           Install directory (default: ~/labhub)
  --version       Image tag to pin (default: latest)
  --port          Loopback port for the app (default: 3000; must match --url port if nonstandard)
  DB_PORT (env)   Host loopback port for Postgres (default 5432) — set when
                  5432 is taken, e.g. DB_PORT=5433 sh install.sh ...
  --force         Overwrite an existing install's .env (backs it up first)
EOF
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) APP_URL="${2:?missing value}"; shift 2 ;;
    --tunnel-token) TUNNEL_TOKEN="${2:?missing value}"; shift 2 ;;
    --dir) LABHUB_DIR="${2:?missing value}"; shift 2 ;;
    --version) LABHUB_VERSION="${2:?missing value}"; shift 2 ;;
    --port) APP_PORT="${2:?missing value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

command -v docker >/dev/null 2>&1 \
  || fail "Docker is not installed. Install it from https://docs.docker.com/get-docker/ then re-run."
docker compose version >/dev/null 2>&1 \
  || fail "The 'docker compose' plugin is missing (Docker Compose v2). Update Docker Desktop or your engine package."
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v openssl >/dev/null 2>&1 || fail "openssl is required."

# --- Idempotent re-run -------------------------------------------------------
if [ -f "$LABHUB_DIR/.env" ] && [ "$FORCE" -ne 1 ]; then
  echo "LabHub is already installed in $LABHUB_DIR."
  echo "Update it with:  $LABHUB_DIR/labhub update"
  exit 0
fi

# --- App URL -----------------------------------------------------------------
if [ -z "$APP_URL" ]; then
  [ -t 0 ] || fail "--url is required when stdin is not a TTY (piped installs)."
  printf 'App URL (https://lab.example.edu, or http://localhost:3000 for LAN-only): ' >&2
  IFS= read -r APP_URL
fi
APP_URL="${APP_URL%/}"
case "$APP_URL" in
  https://*) : ;;
  http://*) echo "note: plain HTTP — PWA install and Web Push stay dormant until HTTPS (tunnel) is added." ;;
  *) fail "APP_URL must start with http:// or https:// (got '$APP_URL')." ;;
esac

# --- Port conflict -----------------------------------------------------------
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${APP_PORT}/"; then
  fail "Port ${APP_PORT} is already in use on this machine. Re-run with a free port:
  APP_PORT=<free-port> sh install.sh --url ... --port <free-port>"
fi

# Postgres host port (raw TCP — curl can't speak it; probe via alpine + host network).
DB_PROBE=0
if docker run --rm --network host alpine sh -c 'nc -z 127.0.0.1 "${DB_PORT:-5432}"' >/dev/null 2>&1; then
  DB_PROBE=1
fi
if [ "$DB_PROBE" -eq 1 ]; then
  fail "Port ${DB_PORT:-5432} is already in use (local Postgres?). Re-run with a free DB port:
  DB_PORT=<free-port> sh install.sh --url ... "
fi

# --- Files -------------------------------------------------------------------
mkdir -p "$LABHUB_DIR/backups"
if [ -f "$LABHUB_DIR/.env" ]; then  # --force path
  cp "$LABHUB_DIR/.env" "$LABHUB_DIR/.env.bak.$(date +%Y%m%d-%H%M%S)"
fi

# --- Secrets -----------------------------------------------------------------
note "Minting secrets (openssl) ..."
SECRET="$(openssl rand -hex 32)"
PGPASS="$(openssl rand -hex 24)"
SETUP_TOKEN="$(openssl rand -hex 32)"

note "Minting VAPID web-push keys (pulls node:22-alpine once) ..."
VAPID_OUT="$(docker run --rm node:22-alpine npx -y web-push generate-vapid-keys 2>/dev/null || true)"
VAPID_PUBLIC="$(printf '%s\n' "$VAPID_OUT" | awk '/Public Key:/ {f=1; next} f && NF {print; exit}')"
VAPID_PRIVATE="$(printf '%s\n' "$VAPID_OUT" | awk '/Private Key:/ {f=1; next} f && NF {print; exit}')"
[ -n "$VAPID_PUBLIC" ] && [ -n "$VAPID_PRIVATE" ] \
  || fail "could not mint VAPID keys (docker run node:22-alpine failed). Check 'docker run --rm hello-world' and re-run."

# --- Compose + wrapper -------------------------------------------------------
note "Fetching compose file and labhub helper ..."
curl -fsSL "$COMPOSE_URL" -o "$LABHUB_DIR/docker-compose.dist.yml"
curl -fsSL "$WRAPPER_URL" -o "$LABHUB_DIR/labhub"
chmod +x "$LABHUB_DIR/labhub"

# --- .env --------------------------------------------------------------------
(umask 077; cat > "$LABHUB_DIR/.env" <<EOF
# Generated by LabHub install.sh — do NOT commit or share this file.
LABHUB_VERSION=${LABHUB_VERSION}
POSTGRES_PASSWORD=${PGPASS}
DB_PORT=5432
APP_URL=${APP_URL}
APP_PORT=${APP_PORT}
BETTER_AUTH_SECRET=${SECRET}
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=LabHub <no-reply@localhost>
VAPID_PUBLIC_KEY=${VAPID_PUBLIC}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE}
AUTH_TRUSTED_IP_HEADER=cf-connecting-ip
AUTH_RATE_LIMIT_MAX=10
SETUP_TOKEN=${SETUP_TOKEN}
TUNNEL_TOKEN=${TUNNEL_TOKEN}
EOF
)
chmod 600 "$LABHUB_DIR/.env"

# --- Start -------------------------------------------------------------------
note "Starting LabHub ${LABHUB_VERSION} ..."
cd "$LABHUB_DIR"
PROFILES="--profile prod"
[ -n "$TUNNEL_TOKEN" ] && PROFILES="$PROFILES --profile tunnel"
# PROFILES is deliberately word-split
# shellcheck disable=SC2086
docker compose -p labhub -f docker-compose.dist.yml $PROFILES up -d

note "Waiting for the health endpoint (migrations run on first start; up to 2 min) ..."
HEALTHY=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then HEALTHY=1; break; fi
  printf '.'
  sleep 2
done
echo
if [ "$HEALTHY" -ne 1 ]; then
  echo "ERROR: LabHub did not become healthy in time." >&2
  echo "Inspect logs with:  docker compose -p labhub -f $LABHUB_DIR/docker-compose.dist.yml logs app" >&2
  echo "If the failure is a port bind error on 5432: edit DB_PORT in $LABHUB_DIR/.env to a free port and re-run $LABHUB_DIR/labhub update" >&2
  exit 1
fi

echo ""
echo "================ LabHub is up ================"
echo "  Open:        $APP_URL"
echo "               (the setup wizard configures your lab on first visit)"
echo "  SETUP_TOKEN: ${SETUP_TOKEN}"
echo "               (enter once in the wizard — it blocks strangers claiming"
echo "                admin while you set up; keep it private)"
echo "  Manage:      $LABHUB_DIR/labhub  {update|backup|down|logs|status}"
echo "               (add 'alias labhub=$LABHUB_DIR/labhub' to your shell rc)"
echo "==============================================="
