#!/usr/bin/env bash
#
# Does a scaffolded app actually BUILD AND START?
#
# This exists because `tsc --noEmit` and the unit tests both passed on a project
# that could not run. Three whole classes of failure are invisible to them:
#
#   1. tsconfig options legal under --noEmit and illegal on emit (TS5096).
#      `nest build` catches these; `tsc --noEmit` never will, by definition.
#   2. Nest dependency-injection wiring — a controller whose service is not a
#      provider, a service whose module is not imported. All compile fine.
#   3. Constructors that throw when an optional tool is unconfigured, taking the
#      whole process down over a missing key.
#
# The API and the WORKER are separate Nest applications with separate graphs, so
# both are started. A module registered only in app.module leaves the worker
# broken, and nothing else notices.
#
# Usage: scripts/boot.sh [feature...]      (needs docker)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"
WORK="$(mktemp -d)"
PG=si-boot-pg
REDIS=si-boot-redis
cleanup() { docker rm -f "$PG" "$REDIS" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "→ scaffolding"
SI_TEMPLATE_DIR="$ROOT/templates" node "$ROOT/packages/si/dist/index.js" \
  new "$WORK/app" -f sisaas -b boot -p mono --payments none --workflows none -y >/dev/null

if [ "$#" -gt 0 ]; then
  echo "→ adding: $*"
  (cd "$WORK/app" && node "$ROOT/packages/si/dist/index.js" add "$@" >/dev/null)
fi

echo "→ building (nest build, not tsc --noEmit — that is the whole point)"
(cd "$WORK/app" && pnpm --filter '*/server' exec nest build >/dev/null 2>&1) \
  || (cd "$WORK/app/apps/server" && npx nest build)

echo "→ starting postgres and redis"
docker run -d --name "$PG" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=boot -p 55490:5432 postgres:17-alpine >/dev/null
docker run -d --name "$REDIS" -p 56390:6379 redis:7-alpine >/dev/null
until docker exec "$PG" psql -U postgres -d boot -c 'select 1' >/dev/null 2>&1; do sleep 1; done
sleep 2
docker exec -i "$PG" psql -U postgres -d boot -q < "$WORK/app/infra/postgres/initdb/01-init.sql" >/dev/null 2>&1
for f in "$WORK/app/apps/server/drizzle/"*.sql; do
  sed 's/--> statement-breakpoint//' "$f" | docker exec -i "$PG" psql -U postgres -d boot -v ON_ERROR_STOP=1 -q >/dev/null
done

cd "$WORK/app/apps/server"
cp .env.example .env
sed -i "s|^#\?\s*DATABASE_URL=.*|DATABASE_URL=postgres://boot_app:boot_app_dev_pwd@localhost:55490/boot|" .env
sed -i "s|^#\?\s*ADMIN_DATABASE_URL=.*|ADMIN_DATABASE_URL=postgres://boot_admin:boot_admin_dev_pwd@localhost:55490/boot|" .env
sed -i "s|^#\?\s*MIGRATION_DATABASE_URL=.*|MIGRATION_DATABASE_URL=postgres://boot_owner:boot_owner_dev_pwd@localhost:55490/boot|" .env
sed -i "s|^#\?\s*REDIS_URL=.*|REDIS_URL=redis://localhost:56390|" .env

fail=0
for proc in main worker.main; do
  log="$WORK/$proc.log"
  node "dist/src/$proc.js" >"$log" 2>&1 &
  pid=$!
  for _ in $(seq 1 40); do
    grep -qE "successfully started|Worker started|ERROR \[ExceptionHandler\]" "$log" 2>/dev/null && break
    sleep 1
  done
  kill "$pid" >/dev/null 2>&1 || true
  if grep -qE "successfully started|Worker started" "$log"; then
    echo "  ok   $proc"
  else
    echo "  FAIL $proc"
    grep -E "ERROR|Error:" "$log" | head -3
    fail=1
  fi
done

[ "$fail" -eq 0 ] || { echo "boot test FAILED"; exit 1; }
echo "API and worker both start"
