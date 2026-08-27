#!/usr/bin/env bash
# Bring the whole thing up with one command: the public tunnel and the app,
# in one terminal. Ctrl-C stops both.
set -euo pipefail

cd "$(dirname "$0")/.."
# .env fills the gaps; anything already exported wins, so you can point a
# command at another database or port without editing the file.
if [ -f .env ]; then
  _PRESET_DATABASE_URL="${DATABASE_URL:-}"
  _PRESET_PORT="${PORT:-}"
  set -a && . ./.env && set +a
  [ -n "$_PRESET_DATABASE_URL" ] && DATABASE_URL="$_PRESET_DATABASE_URL"
  [ -n "$_PRESET_PORT" ] && PORT="$_PRESET_PORT"
fi

PORT="${PORT:-3000}"
TUNNEL_NAME="${TUNNEL_NAME:-priceintel}"
TUNNEL_CONFIG="$HOME/.cloudflared/$TUNNEL_NAME.yml"

cleanup() {
  trap - INT TERM EXIT
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already listening on port $PORT. Stop it first." >&2
  exit 1
fi

if [ -f "$TUNNEL_CONFIG" ]; then
  echo "→ tunnel  $(grep -m1 'hostname:' "$TUNNEL_CONFIG" | awk '{print $3}')"
  cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL_NAME" \
    > /tmp/priceintel-tunnel.log 2>&1 &
  TUNNEL_PID=$!
else
  echo "→ tunnel  not set up — running on localhost only."
  echo "          Shopify cannot reach you. Run: pnpm tunnel:setup"
fi

echo "→ app     http://localhost:$PORT"
echo
pnpm dev &
APP_PID=$!

# If the tunnel dies the app keeps serving localhost quite happily, and the
# public address starts returning 502 with nothing on screen to say so. Notice
# it and stop, rather than letting a demo run against a dead URL.
if [ -n "${TUNNEL_PID:-}" ]; then
  (
    while kill -0 "$APP_PID" 2>/dev/null; do
      if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        echo
        echo "The tunnel stopped. The public address is down until you restart." >&2
        echo "Log: /tmp/priceintel-tunnel.log" >&2
        kill "$APP_PID" 2>/dev/null
        exit 0
      fi
      sleep 5
    done
  ) &
fi

wait "$APP_PID"
