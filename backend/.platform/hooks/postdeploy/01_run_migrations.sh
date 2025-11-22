#!/bin/bash
# Post-deployment hook to run database migrations
# This script runs after the application is deployed but before traffic is routed to it

set -e  # Exit on error

echo "Running database migrations..."

# Navigate to application directory
cd /var/app/current

# Activate virtual environment
source /var/app/venv/*/bin/activate

# Run migrations
echo "Applying Alembic migrations..."
alembic upgrade head

echo "Database migrations completed successfully"

# Log migration status
echo "Current migration version:"
alembic current
