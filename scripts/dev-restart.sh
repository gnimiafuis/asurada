#!/usr/bin/env bash
# Cleanly restart the api dev server in the background (detached, logged).
# Kills the full previous tree first (no zombie watchers), then starts fresh.
#
# Usage: pnpm dev:restart

set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="/tmp/asurada-api.log"

"$DIR/scripts/dev-kill.sh"

echo "Starting api dev server (nohup, log: $LOG)…"
nohup pnpm --filter @asurada/api dev > "$LOG" 2>&1 &
echo "  launcher pid: $!"

# Wait for health
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    echo "✓ up — http://localhost:3000 (health ok)"
    exit 0
  fi
  sleep 0.5
done
echo "⚠ server did not become healthy in 10s — check $LOG"
exit 1
