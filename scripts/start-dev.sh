#!/bin/bash
# Start development environment

set -e

echo "🚀 Starting Development Environment"
echo "===================================="

# Start dev services (Redis, the S3 object store)
echo ""
echo "Starting development services..."
# The object store replaced MinIO; the retired containers are orphans that
# still hold port 9000. Remove them by name (-v: anonymous volumes only, the
# named minio_data volume is kept), then prune any other orphans.
for retired in qontinui-minio qontinui-minio-client; do
    if [ "$(docker ps -aq --filter "name=^${retired}$")" ]; then
        docker rm -fv "$retired" >/dev/null && echo "Removed retired container $retired"
    fi
done
docker compose -f docker-compose.yml up -d --remove-orphans

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
