#!/usr/bin/env bash
# Save and restore the whole database, so a demo can be re-recorded without
# waiting for another pipeline run or spending more searches.
#
#   pnpm demo:save [name]     snapshot the database    (default: demo)
#   pnpm demo:load [name]     put it back
#   pnpm demo:list            what has been saved
#
# Snapshots live in .demo-snapshots/ and are ignored by git.
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

DIR=".demo-snapshots"
ACTION="${1:-}"
NAME="${2:-demo}"
FILE="$DIR/$NAME.dump"

mkdir -p "$DIR"

case "$ACTION" in
  save)
    pg_dump --format=custom --file="$FILE" "$DATABASE_URL"
    COUNT=$(psql "$DATABASE_URL" -tAc "select count(*) from products" 2>/dev/null || echo "?")
    RECS=$(psql "$DATABASE_URL" -tAc "select count(*) from recommendations" 2>/dev/null || echo "?")
    echo "Saved '$NAME' — $COUNT products, $RECS recommendations."
    echo "Put it back any time with:  pnpm demo:load $NAME"
    ;;

  load)
    if [ ! -f "$FILE" ]; then
      echo "No snapshot called '$NAME'. Try: pnpm demo:list" >&2
      exit 1
    fi
    if lsof -nP -iTCP:"${PORT:-3000}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "The app is running. Stop it first — restoring under a live server" >&2
      echo "leaves it holding rows that no longer exist." >&2
      exit 1
    fi
    pg_restore --clean --if-exists --no-owner --no-privileges \
      --dbname="$DATABASE_URL" "$FILE" 2>&1 | grep -v "^pg_restore: warning" || true
    COUNT=$(psql "$DATABASE_URL" -tAc "select count(*) from products" 2>/dev/null || echo "?")
    echo "Restored '$NAME' — $COUNT products. Start with: pnpm start"
    ;;

  list)
    if [ -z "$(ls -A "$DIR" 2>/dev/null)" ]; then
      echo "No snapshots yet. Make one with: pnpm demo:save"
      exit 0
    fi
    for f in "$DIR"/*.dump; do
      printf "  %-20s %6s  %s\n" \
        "$(basename "$f" .dump)" \
        "$(du -h "$f" | cut -f1)" \
        "$(date -r "$f" '+%d %b %H:%M')"
    done
    ;;

  *)
    echo "Usage: pnpm demo:save [name] | pnpm demo:load [name] | pnpm demo:list" >&2
    exit 1
    ;;
esac
