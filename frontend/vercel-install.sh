#!/bin/bash
set -e

# Vercel Install Script
# ---------------------
# Clones sibling repos that are referenced as file: dependencies in
# package.json. On Vercel, only qontinui-web is cloned, so we need to
# fetch the other packages before npm install can resolve them.
#
# The dist/ directories are committed to each repo, so no build step
# is needed — just clone and install.
#
# This script runs from the frontend/ directory (Vercel root directory).
# package.json uses paths like file:../../repo-name.

echo "=== Vercel Install: Cloning sibling dependencies ==="

FRONTEND_DIR="$(pwd)"
echo "Frontend dir: $FRONTEND_DIR"

# Resolve the parent directory where sibling repos should live.
# frontend/package.json uses file:../../X, so repos go at ../../
PARENT_DIR="$(cd ../.. && pwd)"
echo "Sibling repos target: $PARENT_DIR"

# Clone all required sibling repos (shallow, single branch for speed)
echo ""
echo "--- Cloning repositories ---"

git clone --depth 1 --branch main \
  https://github.com/qontinui/qontinui-schemas.git \
  "$PARENT_DIR/qontinui-schemas" && echo "OK: qontinui-schemas"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-navigation.git \
  "$PARENT_DIR/qontinui-navigation" && echo "OK: qontinui-navigation"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-workflow-utils.git \
  "$PARENT_DIR/qontinui-workflow-utils" && echo "OK: qontinui-workflow-utils"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-workflow-ui.git \
  "$PARENT_DIR/qontinui-workflow-ui" && echo "OK: qontinui-workflow-ui"

# Install frontend dependencies (file: deps now resolve to cloned repos)
echo ""
echo "--- Installing frontend dependencies ---"
cd "$FRONTEND_DIR"
npm install

echo ""
echo "=== Vercel Install: Complete ==="
