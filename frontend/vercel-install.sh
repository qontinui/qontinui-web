#!/bin/bash
set -e

# Vercel Install Script
# ---------------------
# Clones and builds sibling repos that are referenced as file: dependencies
# in package.json. On Vercel, only qontinui-web is cloned, so we need to
# fetch the other packages before npm install can resolve them.
#
# This script runs from the frontend/ directory (Vercel root directory).
# package.json uses paths like file:../../repo-name, so repos are placed
# two directories up from frontend/.

echo "=== Vercel Install: Cloning sibling dependencies ==="

# Save the starting directory (frontend/)
FRONTEND_DIR="$(pwd)"
echo "Frontend dir: $FRONTEND_DIR"

# Resolve the parent directory where sibling repos should live.
# frontend/package.json uses file:../../X, so repos go at ../../
PARENT_DIR="$(cd ../.. && pwd)"
echo "Sibling repos target: $PARENT_DIR"

# 1. Clone all required sibling repos (shallow, single branch for speed)
echo ""
echo "--- Cloning repositories ---"

git clone --depth 1 --branch main \
  https://github.com/qontinui/qontinui-schemas.git \
  "$PARENT_DIR/qontinui-schemas" && echo "Cloned qontinui-schemas"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-navigation.git \
  "$PARENT_DIR/qontinui-navigation" && echo "Cloned qontinui-navigation"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-workflow-utils.git \
  "$PARENT_DIR/qontinui-workflow-utils" && echo "Cloned qontinui-workflow-utils"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-workflow-ui.git \
  "$PARENT_DIR/qontinui-workflow-ui" && echo "Cloned qontinui-workflow-ui"

# 2. Build in dependency order:
#    shared-types (no file: deps) → navigation (no file: deps)
#    → workflow-utils (depends on shared-types)
#    → workflow-ui (depends on shared-types + workflow-utils)

echo ""
echo "--- Building @qontinui/shared-types ---"
cd "$PARENT_DIR/qontinui-schemas/ts"
npm install --ignore-scripts
npm run build

echo ""
echo "--- Building qontinui-navigation ---"
cd "$PARENT_DIR/qontinui-navigation"
npm install --ignore-scripts
npm run build

echo ""
echo "--- Building @qontinui/workflow-utils ---"
cd "$PARENT_DIR/qontinui-workflow-utils"
npm install
npm run build

echo ""
echo "--- Building @qontinui/workflow-ui ---"
cd "$PARENT_DIR/qontinui-workflow-ui"
npm install
npm run build

# 3. Return to frontend/ and run npm install
echo ""
echo "--- Installing frontend dependencies ---"
cd "$FRONTEND_DIR"
npm install

echo ""
echo "=== Vercel Install: Complete ==="
