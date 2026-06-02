#!/bin/bash
# Update Vercel environment variables for production

set -e

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "Installing Vercel CLI..."
    npm install -g vercel
fi

echo "=== Updating Vercel Environment Variables ==="
echo ""

# Main backend URL
BACKEND_URL="https://api.qontinui.io"

# UI Bridge command relay opt-in (build-time NEXT_PUBLIC flag).
# The co-pilot's CommandRelayListener + consent modal only mount when this is
# === "1" at `next build` time (frontend/src/lib/ui-bridge/provider.tsx:97:
#   process.env.NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS === "1"). NEXT_PUBLIC_* is
# INLINED by Vercel at its build step, so it MUST exist as a Production
# Environment Variable on the Vercel project — there is no in-repo Dockerfile or
# GitHub Actions `next build` for the frontend (it auto-deploys via Vercel's Git
# integration; see vercel.json + .github/workflows/verify-frontend-deploy.yml).
# Without this, prod ships with remote-commands OFF and the relay returns
# NO_BROWSER_CONNECTED for a consented prod tab.
UI_BRIDGE_REMOTE_COMMANDS="1"

echo "Current configuration:"
echo "  NEXT_PUBLIC_API_URL: $BACKEND_URL"
echo "  NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS: $UI_BRIDGE_REMOTE_COMMANDS"
echo ""

# Note: vercel env add will prompt if the variable already exists
# You can use vercel env rm to remove it first, or use the Vercel dashboard

echo "Step 1: Removing old environment variables (if they exist)..."
vercel env rm NEXT_PUBLIC_API_URL production --yes 2>/dev/null || echo "  (NEXT_PUBLIC_API_URL not found, will create new)"
vercel env rm NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS production --yes 2>/dev/null || echo "  (NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS not found, will create new)"

echo ""
echo "Step 2: Adding new environment variables..."
echo "$BACKEND_URL" | vercel env add NEXT_PUBLIC_API_URL production
echo "$UI_BRIDGE_REMOTE_COMMANDS" | vercel env add NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS production

echo ""
echo "✓ Environment variables updated successfully!"
echo ""
echo "Step 3: Redeploying to production..."
vercel --prod

echo ""
echo "=== Done! ==="
echo "Your frontend should now connect to: $BACKEND_URL"
echo ""
echo "Backend API: $BACKEND_URL"
