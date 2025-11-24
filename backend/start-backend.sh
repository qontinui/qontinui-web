#!/bin/bash

# Start Qontinui Web Backend

echo "Starting Qontinui Web Backend..."

# Activate virtual environment
source venv/bin/activate

# Check if database migrations need to run
echo "Running database migrations..."
alembic upgrade head

# Start the backend server
echo "Starting FastAPI server on port 8000..."
python run.py
