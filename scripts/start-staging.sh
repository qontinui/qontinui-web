#!/bin/bash
# Start staging environment

set -e

echo "🎭 Starting Staging Environment"
echo "================================"

# Check if .env.staging.local exists
if [ ! -f "backend/.env.staging.local" ]; then
    echo "⚠️  Warning: backend/.env.staging.local not found"
    echo "   Using default values from docker-compose.staging.yml"
fi

# Start staging services (all-in-one)
echo ""
echo "Starting staging services..."
docker compose -f docker-compose.staging.yml up -d --build

# Wait for services to be healthy
echo ""
echo "Waiting for services to be ready..."
sleep 10

# Check service health
docker compose -f docker-compose.staging.yml ps

echo ""
echo "✅ Local staging environment started!"
echo ""
echo "⚠️  Note: This is LOCAL staging. For production-like testing,"
echo "   consider using production at qontinui.io"
echo ""
echo "Services running:"
echo "  - PostgreSQL: localhost:5434"
echo "  - Redis: localhost:6381"
echo "  - MinIO API: localhost:9004"
echo "  - MinIO Console: http://localhost:9005 (minioadmin/minioadmin_staging)"
echo "  - Backend API: http://localhost:8002"
echo ""
echo "Frontend staging mode:"
echo "  cd frontend && npm run dev -- --port 3002"
echo ""
echo "View logs:"
echo "  docker compose -f docker-compose.staging.yml logs -f backend-staging"
echo ""
