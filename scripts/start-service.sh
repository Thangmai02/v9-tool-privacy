#!/bin/sh
set -eu

case "${1:-api}" in
  api) entry=dist/apps/server/src/index.js ;;
  worker) entry=dist/apps/server/src/worker.js ;;
  *) echo "Usage: sh scripts/start-service.sh [api|worker]" >&2; exit 2 ;;
esac

# Both services can start together. The migration holds a PostgreSQL advisory
# transaction lock, so only one process changes the schema at a time.
node dist/apps/server/src/migrate.js
exec node "$entry"
