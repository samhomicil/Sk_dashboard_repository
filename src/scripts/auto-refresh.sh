#!/bin/bash
# Daily auto-refresh for SK Wellness Dashboard
# Called by the LaunchAgent at 7 AM every day.
# Logs to /tmp/sk-dashboard-refresh.log

DASHBOARD_DIR="/Users/sam/sk-dashboard"
PROXY_SCRIPT="/Users/sam/azure-sql-proxy.py"
LOG="/tmp/sk-dashboard-refresh.log"
NPX="/opt/homebrew/bin/npx"
PYTHON="/usr/bin/python3"

# Redirect all output to log file (append)
exec >> "$LOG" 2>&1
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$(date '+%Y-%m-%d %H:%M:%S')  Starting SK Dashboard refresh"

cd "$DASHBOARD_DIR"

# ── 1. Sigma data fetch ───────────────────────────────────────────
if grep -q "^SIGMA_CLIENT_ID=.\+" .env.local 2>/dev/null; then
    echo "→ Fetching Sigma data ..."
    "$PYTHON" src/scripts/sigma-fetch.py || echo "⚠️  Sigma fetch failed (using last cached data)"
else
    echo "→ Sigma credentials not configured — skipping Sigma fetch"
fi

# ── 2. Ensure Azure SQL proxy is responding ───────────────────────
proxy_alive() {
    curl -sf -o /dev/null --max-time 3 \
        -X POST http://127.0.0.1:5001/query \
        -H 'Content-Type: application/json' \
        -d '{"query":"SELECT 1"}' 2>/dev/null
}

PROXY_PID=""
if proxy_alive; then
    echo "→ Azure SQL proxy already running"
else
    echo "→ Starting Azure SQL proxy ..."
    "$PYTHON" "$PROXY_SCRIPT" &
    PROXY_PID=$!

    # Wait up to 15 seconds for Flask to be ready
    for i in $(seq 1 15); do
        sleep 1
        if proxy_alive; then
            echo "→ Proxy ready after ${i}s"
            break
        fi
    done

    if ! proxy_alive; then
        echo "❌ Proxy did not start in time — aborting refresh"
        kill "$PROXY_PID" 2>/dev/null || true
        exit 1
    fi
fi

# ── 3. Run the dashboard refresh ─────────────────────────────────
echo "→ Running npm refresh ..."
"$NPX" tsx src/scripts/refresh.ts

STATUS=$?

# ── 5. Stop proxy if we started it ───────────────────────────────
if [ -n "$PROXY_PID" ]; then
    kill "$PROXY_PID" 2>/dev/null || true
    echo "→ Proxy stopped"
fi

if [ "$STATUS" -eq 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S')  ✅  Refresh complete"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S')  ❌  Refresh failed (exit $STATUS)"
    exit "$STATUS"
fi
