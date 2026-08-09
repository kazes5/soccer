#!/usr/bin/env bash
# Undoes exactly what start-manual-tests.sh did: stops the two dev servers
# it launched, and stops Postgres/Redis only if this session was the one
# that started them (left untouched if they were already running before).
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/scripts/.manual-test-state"
cd "$ROOT_DIR"

stop_process_group() {
  local pid_file="$1"
  local label="$2"

  if [ ! -f "$pid_file" ]; then
    echo "==> No record of $label running — skipping."
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if kill -0 "$pid" 2>/dev/null; then
    echo "==> Stopping $label (pid $pid)..."
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
  else
    echo "==> $label already stopped (stale pid file) — skipping."
  fi

  rm -f "$pid_file"
}

stop_process_group "$STATE_DIR/api.pid" "API dev server"
stop_process_group "$STATE_DIR/web.pid" "web dev server"

if [ -f "$STATE_DIR/docker-was-running" ]; then
  echo "==> Postgres/Redis were already running before the test session — leaving them up."
  rm -f "$STATE_DIR/docker-was-running"
elif [ -n "$(docker compose ps --status running --services 2>/dev/null)" ]; then
  echo "==> Stopping Postgres/Redis (pnpm docker:down)..."
  pnpm docker:down
fi

cat <<EOF

Stopped. Processes and (if this script started them) Docker services are
back to how they were before start-manual-tests.sh ran.

Note: this does not touch the database itself — any teams, users, or other
data you created while clicking through the UI are still there for next
time. Logs from this session remain in $STATE_DIR/logs.
EOF
