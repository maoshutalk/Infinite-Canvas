#!/bin/bash
#
# mac-stop.sh — stop the Infinite-Canvas dev server started by mac-start.sh.
#
# Usage:
#   bash mac-stop.sh                # stops on default port 3008
#   PORT=8188 bash mac-stop.sh      # override port via env
#
# Behavior:
#   1. Looks up the PIDs listening on $PORT via lsof.
#   2. Sends SIGTERM and waits up to 5s for graceful exit.
#   3. If the port is still bound, sends SIGKILL to remaining PIDs.

set -u

PORT="${PORT:-3008}"

PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"

if [ -z "$PIDS" ]; then
    echo "No process is listening on port $PORT."
    exit 0
fi

# Strip CR/blank lines just in case
PIDS="$(printf '%s\n' "$PIDS" | grep -E '^[0-9]+$' || true)"

if [ -z "$PIDS" ]; then
    echo "Could not parse PIDs from lsof (saw: $(printf '%s' "$PIDS" | tr '\n' ' '))."
    exit 1
fi

COUNT="$(printf '%s\n' "$PIDS" | wc -l | tr -d ' ')"
echo "Found $COUNT process(es) on port $PORT: $(echo "$PIDS" | tr '\n' ' ')"

# Graceful TERM
kill -TERM $PIDS 2>/dev/null || true

# Wait up to 5s for graceful shutdown
for _ in 1 2 3 4 5; do
    sleep 1
    if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "Server on port $PORT stopped."
        exit 0
    fi
done

# Force-kill stragglers
echo "Graceful shutdown timed out after 5s; sending SIGKILL"
REMAINING="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
REMAINING="$(printf '%s\n' "$REMAINING" | grep -E '^[0-9]+$' || true)"
[ -n "$REMAINING" ] && kill -KILL $REMAINING 2>/dev/null || true

# Final verification
sleep 1
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "ERROR: port $PORT still in use after SIGKILL. Run: lsof -nP -iTCP:$PORT"
    exit 1
fi

echo "Server on port $PORT stopped."
