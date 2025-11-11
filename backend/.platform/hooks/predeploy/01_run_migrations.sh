#!/bin/bash
set -e

echo "Running database migrations..."

# Navigate to application directory
cd /var/app/staging

# Activate virtual environment
source /var/app/venv/*/bin/activate

# Run Alembic migrations
alembic upgrade head

echo "Database migrations completed successfully"
