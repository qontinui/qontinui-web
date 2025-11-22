#!/bin/bash
# Test runner for file-based code execution tests

set -e

echo "============================================"
echo "File-Based Code Execution Test Suite"
echo "============================================"
echo ""

cd "$(dirname "$0")"

echo "Running unit tests..."
echo "--------------------------------------------"
poetry run pytest tests/test_file_execution_unit.py -v --tb=short --no-cov

echo ""
echo "============================================"
echo "Test Summary"
echo "============================================"
echo ""
echo "See tests/TEST_FILE_EXECUTION_SUMMARY.md for details"
echo ""
