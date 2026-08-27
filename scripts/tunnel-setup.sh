#!/usr/bin/env bash
# One-time setup for the permanent dev tunnel.
#
# Quick tunnels (cloudflared tunnel --url) hand out a new random hostname on
# every start, and every new hostname means another Shopify app version just
# to change a URL. A named tunnel keeps one hostname forever.
#
# Prerequisite: cloudflared tunnel login  (authorises the haddi.me zone once)
set -euo pipefail

TUNNEL_NAME="${TUNNEL_NAME:-priceintel}"
HOSTNAME="${TUNNEL_HOSTNAME:-pv.haddi.me}"
LOCAL_PORT="${PORT:-3000}"

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "No Cloudflare certificate found. Run: cloudflared tunnel login" >&2
  exit 1
fi

if ! cloudflared tunnel list | grep -q "\b$TUNNEL_NAME\b"; then
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID=$(cloudflared tunnel list --output json | python3 -c \
  "import sys,json;print(next(t['id'] for t in json.load(sys.stdin) if t['name']=='$TUNNEL_NAME'))")

cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$HOSTNAME"

cat > "$HOME/.cloudflared/$TUNNEL_NAME.yml" <<YAML
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$LOCAL_PORT
  - service: http_status:404
YAML

echo
echo "Done. https://$HOSTNAME now points at localhost:$LOCAL_PORT whenever the tunnel runs."
echo "Start it with:  pnpm tunnel"
