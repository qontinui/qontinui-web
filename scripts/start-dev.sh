#!/bin/bash
# Start development environment

set -e

echo "🚀 Starting Development Environment"
echo "===================================="

# Start dev services (Redis, the S3 object store)
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
echo "  - Object store (S3 API, versitygw): localhost:9000 (qontinui_dev_s3 / qontinui_dev_s3_secret unless S3_ACCESS_KEY / S3_SECRET_KEY are set)"
echo ""
echo "Next steps:"
echo "  1. cd backend && python run_server.py"
echo "  2. cd frontend && npm run dev"
echo ""
