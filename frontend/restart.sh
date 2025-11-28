#!/bin/bash

# Restart frontend script
# Kills process on port 3001, clears Next.js cache, and starts dev server

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

# Start dev server
echo "🚀 Starting dev server..."
npm run dev
