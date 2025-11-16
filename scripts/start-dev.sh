#!/bin/bash
# Start development environment

set -e

echo "🚀 Starting Development Environment"
echo "===================================="

# Start dev services (PostgreSQL, Redis, MinIO)
echo ""
echo "Starting development services..."
docker compose -f docker-compose.yml up -d

# Wait for services to be healthy
echo ""
echo "Waiting for services to be ready..."
sleep 5

# Check service health
docker compose -f docker-compose.yml ps

echo ""
echo "✅ Development services started!"
echo ""
echo "Services running:"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
echo "  - MinIO API: localhost:9000"
echo "  - MinIO Console: http://localhost:9001 (minioadmin/minioadmin)"
echo ""
echo "Next steps:"
echo "  1. cd backend && python run_server.py"
echo "  2. cd frontend && npm run dev"
echo ""
