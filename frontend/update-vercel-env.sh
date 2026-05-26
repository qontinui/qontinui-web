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

echo "Current configuration:"
echo "  NEXT_PUBLIC_API_URL: $BACKEND_URL"
echo ""

# Note: vercel env add will prompt if the variable already exists
# You can use vercel env rm to remove it first, or use the Vercel dashboard

echo "Step 1: Removing old environment variables (if they exist)..."
vercel env rm NEXT_PUBLIC_API_URL production --yes 2>/dev/null || echo "  (NEXT_PUBLIC_API_URL not found, will create new)"

echo ""
echo "Step 2: Adding new environment variables..."
echo "$BACKEND_URL" | vercel env add NEXT_PUBLIC_API_URL production

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
