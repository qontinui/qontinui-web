#!/bin/bash
# Fix Docker Desktop WSL integration and start development environment

set -e

echo "🔧 Docker Desktop WSL Integration Fix & Dev Environment Setup"
echo "=============================================================="
echo ""

# Check if Docker is accessible
if docker ps &> /dev/null; then
    echo "✅ Docker is accessible"
else
    echo "❌ Docker is not accessible"
    echo ""
    echo "To fix Docker Desktop WSL integration:"
    echo "1. Open Docker Desktop"
    echo "2. Go to Settings → Resources → WSL Integration"
    echo "3. Toggle OFF Debian integration"
    echo "4. Toggle ON Debian integration"
    echo "5. Click 'Apply & Restart'"
    echo ""
    echo "Or simply restart Docker Desktop completely:"
    echo "- Right-click Docker Desktop icon → Quit"
    echo "- Wait 10 seconds"
    echo "- Start Docker Desktop again"
    echo ""
    exit 1
fi

echo ""
echo "🚀 Starting Development Environment"
echo "===================================="
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Stop any existing containers
echo "Cleaning up any existing containers..."
docker compose down 2>/dev/null || true

# Start development services
echo ""
echo "Starting development services (PostgreSQL, Redis, MinIO)..."
docker compose up -d

# Wait for services
echo ""
echo "Waiting for services to be healthy..."
sleep 10

# Check health
echo ""
docker compose ps

# Check PostgreSQL specifically
echo ""
echo "Testing PostgreSQL connection..."
if docker compose exec -T postgres pg_isready -U qontinui &> /dev/null; then
    echo "✅ PostgreSQL is ready"
else
    echo "⚠️  PostgreSQL is starting (may take a few more seconds)"
fi

echo ""
echo "✅ Development environment is ready!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Services running:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PostgreSQL:    localhost:5432"
echo "  Redis:         localhost:6379"
echo "  MinIO API:     localhost:9000"
echo "  MinIO Console: http://localhost:9001"
echo "                 (minioadmin / minioadmin)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Start Backend (in new terminal):"
echo "   cd backend"
echo "   python run_server.py"
echo ""
echo "2. Start Frontend (in new terminal):"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "3. Access the application:"
echo "   http://localhost:3000"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
