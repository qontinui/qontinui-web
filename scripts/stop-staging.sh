#!/bin/bash
# Stop staging environment

set -e

echo "🛑 Stopping Staging Environment"
echo "================================"

docker compose -f docker-compose.staging.yml down

echo ""
echo "✅ Staging services stopped"
echo ""
echo "To remove all data (destructive):"
echo "  docker compose -f docker-compose.staging.yml down -v"
echo ""
