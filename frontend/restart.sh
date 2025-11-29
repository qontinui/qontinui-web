#!/bin/bash

# Restart frontend script
# Kills process on port 3001, clears Next.js cache, and starts dev server
#
# Options:
#   --reset    Also open /dev/reset to clear browser state (cookies, localStorage, etc.)
#   --no-open  Don't open browser automatically

OPEN_RESET=false
OPEN_BROWSER=true

for arg in "$@"; do
    case $arg in
        --reset)
            OPEN_RESET=true
            ;;
        --no-open)
            OPEN_BROWSER=false
            ;;
    esac
done

echo "🔄 Restarting frontend..."

# Kill process on port 3001
echo "🛑 Killing process on port 3001..."

# Method 1: fuser (most reliable on Linux/WSL)
if command -v fuser &> /dev/null; then
    fuser -k 3001/tcp 2>/dev/null && echo "   Killed process using fuser" || echo "   No process found (fuser)"
# Method 2: lsof
elif command -v lsof &> /dev/null; then
    PID=$(lsof -t -i:3001 2>/dev/null)
    if [ -n "$PID" ]; then
        kill -9 $PID 2>/dev/null
        echo "   Killed process $PID"
    else
        echo "   No process found on port 3001"
    fi
else
    # Method 3: ss + grep (common on modern Linux)
    PID=$(ss -tlnp 2>/dev/null | grep ':3001' | grep -oP 'pid=\K[0-9]+' | head -1)
    if [ -n "$PID" ]; then
        kill -9 $PID 2>/dev/null
        echo "   Killed process $PID"
    else
        echo "   No process found on port 3001"
    fi
fi

# Wait a moment for port to be released
sleep 1

# Clear Next.js cache
echo "🗑️  Clearing Next.js cache..."
rm -rf .next
echo "   Done"

# Clear node_modules cache
if [ -d "node_modules/.cache" ]; then
    echo "🗑️  Clearing node_modules cache..."
    rm -rf node_modules/.cache
    echo "   Done"
fi

# Clear dev-debug logs
if [ -d ".dev-debug" ]; then
    echo "🗑️  Clearing dev-debug logs..."
    rm -rf .dev-debug
    echo "   Done"
fi

# Browser state reminder (only if not using --reset)
if [ "$OPEN_RESET" = false ]; then
    echo ""
    echo "💡 If you're experiencing auth/timeout issues:"
    echo "   • Run: ./restart.sh --reset"
    echo "   • Or visit: http://localhost:3001/dev/reset"
    echo ""
fi

# Start dev server in background if we need to open browser
if [ "$OPEN_BROWSER" = true ]; then
    echo "🚀 Starting dev server in background..."
    npm run dev &
    DEV_PID=$!

    # Wait for server to be ready
    echo "⏳ Waiting for server to be ready..."
    for i in {1..30}; do
        if curl -s http://localhost:3001 > /dev/null 2>&1; then
            echo "   Server ready!"
            break
        fi
        sleep 1
    done

    # Open browser
    if [ "$OPEN_RESET" = true ]; then
        URL="http://localhost:3001/dev/reset"
        echo "🧹 Opening browser to clear state: $URL"
    else
        URL="http://localhost:3001/dashboard"
        echo "🌐 Opening browser: $URL"
    fi

    # Try different methods to open browser (WSL compatible)
    # Add timestamp to force new navigation (prevents browser from just refreshing existing tab)
    URL_WITH_TS="${URL}?t=$(date +%s)"

    if command -v wslview &> /dev/null; then
        # WSL with wslu installed (preferred - handles URLs correctly)
        wslview "$URL_WITH_TS" 2>/dev/null
    elif command -v cmd.exe &> /dev/null; then
        # WSL - use powershell for reliable URL handling
        powershell.exe -Command "Start-Process '$URL_WITH_TS'" 2>/dev/null
    elif command -v xdg-open &> /dev/null; then
        # Linux
        xdg-open "$URL_WITH_TS" 2>/dev/null
    elif command -v open &> /dev/null; then
        # macOS
        open "$URL_WITH_TS" 2>/dev/null
    else
        echo "   Could not open browser automatically. Please visit: $URL"
    fi

    # Bring dev server to foreground
    echo ""
    echo "📋 Dev server running (PID: $DEV_PID)"
    echo "   Press Ctrl+C to stop"
    echo ""
    wait $DEV_PID
else
    # Start dev server normally (foreground)
    echo "🚀 Starting dev server..."
    npm run dev
fi
