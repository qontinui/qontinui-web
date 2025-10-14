#!/bin/bash

#
# Generate TypeScript API client from FastAPI OpenAPI schema
#
# This script:
# 1. Checks if backend is running
# 2. Generates TypeScript types and client from OpenAPI spec
# 3. Creates type-safe API functions
#
# Usage:
#   ./scripts/generate-api-client.sh
#
# Requirements:
#   - Backend running on http://localhost:8000
#   - @hey-api/openapi-ts installed (pnpm add -D @hey-api/openapi-ts)
#

set -e

BACKEND_URL="http://localhost:8000"
OPENAPI_URL="${BACKEND_URL}/openapi.json"
OUTPUT_DIR="./frontend/lib/api"

echo "🔧 Generating API client..."

# Check if backend is running
if ! curl -s "${BACKEND_URL}/docs" > /dev/null; then
    echo "❌ Error: Backend is not running at ${BACKEND_URL}"
    echo "Please start the backend first:"
    echo "  cd backend && uvicorn app.main:app --reload"
    exit 1
fi

echo "✓ Backend is running"

# Check if openapi-ts is installed
cd frontend
if ! pnpm list @hey-api/openapi-ts > /dev/null 2>&1; then
    echo "📦 Installing @hey-api/openapi-ts..."
    pnpm add -D @hey-api/openapi-ts @hey-api/client-fetch
fi

# Generate client
echo "📝 Generating TypeScript client from ${OPENAPI_URL}..."
pnpm exec openapi-ts \
    --input "${OPENAPI_URL}" \
    --output "${OUTPUT_DIR}" \
    --client fetch \
    --useOptions

echo "✅ API client generated successfully at ${OUTPUT_DIR}"
echo ""
echo "Usage example:"
echo "  import { UserService } from '@/lib/api'"
echo "  const users = await UserService.getUsers()"
echo ""
echo "To regenerate: ./scripts/generate-api-client.sh"
