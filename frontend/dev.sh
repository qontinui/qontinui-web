#!/bin/bash

# Frontend Development Script
# Clears cache and starts the development server

set -e

echo "🧹 Clearing Next.js cache..."
rm -rf .next

# Clear node_modules cache if it exists
if [ -d "node_modules/.cache" ]; then
    echo "🧹 Clearing node_modules cache..."
    rm -rf node_modules/.cache
fi

echo "🚀 Starting development server..."
npm run dev
