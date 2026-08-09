#!/usr/bin/env bash
# Brings up everything needed to manually click through the web app:
# Postgres/Redis, a Prisma client regen, demo seed data, and both dev
# servers. Pair with stop-manual-tests.sh, which undoes exactly this.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/scripts/.manual-test-state"
LOG_DIR="$STATE_DIR/logs"
cd "$ROOT_DIR"

if [ -f "$STATE_DIR/api.pid" ] || [ -f "$STATE_DIR/web.pid" ]; then
  echo "A manual test session already looks active (found $STATE_DIR)."
  echo "Run scripts/stop-manual-tests.sh first, or remove $STATE_DIR if it's stale."
  exit 1
fi

for port in 3000 4000; do
  if lsof -ti:"$port" >/dev/null 2>&1; then
    echo "Port $port is already in use by something this script didn't start. Aborting."
    echo "Find it with: lsof -i:$port"
    exit 1
  fi
done

mkdir -p "$LOG_DIR"

echo "==> Checking Postgres/Redis..."
if [ -n "$(docker compose ps --status running --services 2>/dev/null)" ]; then
  echo "    Already running — leaving as-is."
  touch "$STATE_DIR/docker-was-running"
else
  echo "    Starting: pnpm docker:up"
  pnpm docker:up
fi

echo "==> Regenerating the Prisma client..."
pnpm db:generate >"$LOG_DIR/db-generate.log" 2>&1

echo "==> Seeding demo data (idempotent, safe to re-run)..."
pnpm db:seed >"$LOG_DIR/db-seed.log" 2>&1 ||
  echo "    Seed step failed — see $LOG_DIR/db-seed.log (continuing anyway)."

# `set -m` puts each backgrounded job in its own process group, so the stop
# script can kill the whole pnpm -> tsx/next -> node tree with one
# `kill -TERM -<pid>` instead of chasing child PIDs.
set -m

echo "==> Starting the API on http://localhost:4000 ..."
pnpm --filter @soccer/api start >"$LOG_DIR/api.log" 2>&1 &
echo $! >"$STATE_DIR/api.pid"

echo "==> Starting the web app on http://localhost:3000 ..."
pnpm --filter @soccer/web dev >"$LOG_DIR/web.log" 2>&1 &
echo $! >"$STATE_DIR/web.pid"

set +m

echo "==> Waiting for both to respond..."
api_status="000"
web_status="000"
for _ in $(seq 1 30); do
  api_status="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health || echo "000")"
  web_status="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ || echo "000")"
  if [ "$api_status" = "200" ] && [ "$web_status" = "200" ]; then
    break
  fi
  sleep 1
done

if [ "$api_status" != "200" ] || [ "$web_status" != "200" ]; then
  echo "Timed out waiting for a clean start (api=$api_status, web=$web_status)."
  echo "Check $LOG_DIR/api.log and $LOG_DIR/web.log, then run scripts/stop-manual-tests.sh."
  exit 1
fi

cat <<EOF

Ready for manual testing:
  Web:  http://localhost:3000
  API:  http://localhost:4000/health

Seeded demo team "U-12 Wildcats" — log in with any of these phones
(the OTP code is written to $LOG_DIR/api.log, not actually texted):
  Admin:  Dana Cohen   +15550000001
  Parent: Avi Levi     +15550000002
  Parent: Sarah Katz   +15550000003

Logs: $LOG_DIR/api.log , $LOG_DIR/web.log
When done: scripts/stop-manual-tests.sh
EOF
