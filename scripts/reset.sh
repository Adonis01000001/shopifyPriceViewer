#!/usr/bin/env bash
# Wipe every account and everything hanging off it, ready for a clean test.
#
#   pnpm reset          asks first
#   pnpm reset --yes    does not
#
# Keeps the tables and the migrations. Only cron_runs survives the truncate,
# and that is the scheduler's own bookkeeping rather than anyone's data.
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

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set, and .env did not supply one." >&2
  exit 1
fi

DB_LABEL="${DATABASE_URL##*/}"
USERS=$(psql "$DATABASE_URL" -tAc "select count(*) from users" 2>/dev/null || echo "?")

if [ "${1:-}" != "--yes" ]; then
  echo "This deletes every account and all their data in '$DB_LABEL' ($USERS account(s))."
  printf "Type 'reset' to continue: "
  read -r reply
  [ "$reply" = "reset" ] || { echo "Nothing was changed."; exit 1; }
fi

# A reset throws away however long the last pipeline run took. Keep a copy
# first so it is undoable, and overwrite it each time rather than piling up.
if command -v pg_dump >/dev/null 2>&1; then
  mkdir -p .demo-snapshots
  pg_dump --format=custom --file=".demo-snapshots/before-reset.dump" "$DATABASE_URL"
fi

psql "$DATABASE_URL" -q -c "TRUNCATE users CASCADE;"

echo
echo "Done. The database is empty."
echo "The previous contents were kept: pnpm demo:load before-reset"
echo
echo "The Shopify side is untouched: if the app is still installed on your"
echo "store, connecting again will not ask you to approve permissions a"
echo "second time. To test the full install flow, remove the app from"
echo "Shopify admin first (Settings, Apps, the ... menu)."
echo
echo "Next:  pnpm start   then open your tunnel address and sign up."
