#!/bin/bash
# Stop development environment

set -e

echo "🛑 Stopping Development Environment"
echo "===================================="

docker compose -f docker-compose.yml down

echo ""
echo "✅ Development services stopped"
echo ""
echo "To remove all data (destructive):"
echo "  docker compose -f docker-compose.yml down -v"
echo ""
