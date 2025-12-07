#!/bin/bash
# Post-deployment hook to run database migrations
# This script runs after the application is deployed but before traffic is routed to it

set -e  # Exit on error

echo "Running database migrations..."

# Navigate to application directory
cd /var/app/current

# Activate virtual environment
source /var/app/venv/*/bin/activate

# Get current database version
echo "Checking current database migration state..."
DB_VERSION=$(alembic current 2>&1 | grep -oE '[a-f0-9]{12}' | head -1 || echo "none")
echo "Database is at version: $DB_VERSION"

# Get head version from code
CODE_HEAD=$(alembic heads 2>&1 | grep -oE '[a-f0-9]{12}' | head -1 || echo "unknown")
echo "Code head version: $CODE_HEAD"

if [ "$DB_VERSION" = "$CODE_HEAD" ]; then
    echo "Database is already at head. No migrations needed."
else
    # Run migrations
    echo "Applying Alembic migrations..."
    if alembic upgrade head 2>&1; then
        echo "Database migrations completed successfully"
    else
        echo "WARNING: Migration failed. Checking if database state is acceptable..."
        # Re-check current version after failure
        NEW_VERSION=$(alembic current 2>&1 | grep -oE '[a-f0-9]{12}' | head -1 || echo "none")
        if [ "$NEW_VERSION" = "$CODE_HEAD" ]; then
            echo "Database is at expected head despite error. Continuing deployment."
        else
            echo "ERROR: Database migration failed and database is not at expected version."
            exit 1
        fi
    fi
fi

# Log migration status
echo "Final migration version:"
alembic current
