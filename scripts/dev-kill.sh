#!/usr/bin/env bash
# Kill ALL asurada api dev processes — the FULL tree, not just the port holder.
#
# Why this exists: killing only `lsof -ti:3000` kills the node child but
# orphans the pnpm → tsx watch parents, which sleep forever as zombies and
# can respawn/hold references. And nohup-detached trees can't be reached
# by Ctrl+C in any terminal. This kills every layer, scoped to THIS project
# only (matches "asurada" paths in argv — VS Code's tsserver etc. are safe:
# their command lines never match these patterns).
#
# Usage: pnpm dev:kill

set -u

echo "Killing asurada api dev tree (watchers, wrappers, node child)…"

# 1. tsx watch parents — argv: .../asurada/apps/api/node_modules/.bin/../tsx/dist/cli.mjs watch
pkill -9 -f "asurada/apps/api.*tsx/dist/cli" 2>/dev/null && echo "  ✓ killed tsx watcher(s)" || echo "  – no tsx watchers"

# 2. node server children — argv contains .../asurada/node_modules/.pnpm/tsx@*/.../preflight.cjs … src/index.ts
pkill -9 -f "asurada/node_modules/\.pnpm/tsx@" 2>/dev/null && echo "  ✓ killed node server(s)" || echo "  – no node servers"

# 3. pnpm/turbo wrappers still hanging around (they exit on child death, but be thorough)
pkill -9 -f "turbo.*dev" 2>/dev/null && echo "  ✓ killed turbo wrapper(s)" || echo "  – no turbo wrappers"

# 4. Anything still holding the port
LEFT=$(lsof -ti:3000 2>/dev/null || true)
if [ -n "$LEFT" ]; then
  echo "$LEFT" | xargs kill -9 2>/dev/null && echo "  ✓ freed port 3000" || true
else
  echo "  – port 3000 already free"
fi

sleep 1
if lsof -ti:3000 >/dev/null 2>&1; then
  echo "⚠ port 3000 STILL held — investigate: lsof -i:3000 -P -n"
  exit 1
fi
echo "Clean. Port 3000 free, no asurada dev processes remain."
