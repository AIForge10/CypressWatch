#!/usr/bin/env bash
# Run the whole backend from this laptop and publish it over HTTPS with a Cloudflare quick tunnel.
# Use this until the Vultr server is up (deploy/README.md). Ctrl+C stops everything it started.
#
#   scripts/demo_stack.sh            # API on 8010 (started if not running), scheduler, Tiger sync, tunnel
#   PORT=8000 scripts/demo_stack.sh  # different local API port
#
# Needs: the cypresswatch conda env active, backend/api/.env pointing at Tiger Cloud, and cloudflared
# (brew install cloudflared, or the signed binary from github.com/cloudflare/cloudflared/releases).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8010}
LOGS="$ROOT/backend/workers/data/live/logs"
CLOUDFLARED=$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")
[[ -x $CLOUDFLARED ]] || { echo "cloudflared not found (brew install cloudflared)"; exit 1; }
mkdir -p "$LOGS"
PIDS=()
cleanup() { echo; echo "stopping..."; kill "${PIDS[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

start() {  # name, dir, command...
  local name=$1 dir=$2; shift 2
  (cd "$ROOT/$dir" && PYTHONUNBUFFERED=1 exec "$@") > "$LOGS/$name.log" 2>&1 &
  PIDS+=($!); echo "  $name (log: backend/workers/data/live/logs/$name.log)"
}

echo "Starting CypressWatch backend:"
if curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "  api already running on :$PORT"
else
  start api backend/api uvicorn app.main:app --port "$PORT"
fi
pgrep -f cypress_workers.scheduler.scheduler >/dev/null && echo "  scheduler already running" \
  || start scheduler backend/workers python -m cypress_workers.scheduler.scheduler
pgrep -f "cypress_db.sync" >/dev/null && echo "  sync already running" \
  || start sync backend/db python -m cypress_db.sync
start tunnel . "$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:$PORT"

URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOGS/tunnel.log" | head -1 || true)
  [[ -n $URL ]] && break; sleep 1
done
[[ -n $URL ]] || { echo "tunnel did not start; see $LOGS/tunnel.log"; exit 1; }
echo; echo "Waiting for $URL to resolve (new names take up to a minute)..."
for _ in $(seq 1 40); do curl -sf -m 5 "$URL/health" >/dev/null && break; sleep 3; done
cat <<EOF

Public API: $URL   (docs: $URL/docs, live feed: ${URL/https/wss}/api/ws)
  Crew app (M2):  VITE_API_URL=$URL  and  VITE_USE_MOCKS=false, then redeploy the crew app
  Supervisor:     keep http://localhost:$PORT (faster), or use the public URL on another machine
This URL changes every time the tunnel restarts. Keep this window open; Ctrl+C stops everything.
EOF
wait
