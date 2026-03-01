#!/bin/bash
set -e

# Vercel Install Script
# ---------------------
# Clones sibling repos into the repo root (one level up from frontend/)
# and patches package.json file: paths to match.
#
# Local dev uses file:../../X (two levels up) because frontend/ is inside
# the repo which is inside the parent dir with sibling repos.
# On Vercel, we clone repos to ../ (repo root) and patch paths to file:../X.

echo "=== Vercel Install: Setting up sibling dependencies ==="

FRONTEND_DIR="$(pwd)"
REPO_ROOT="$(cd .. && pwd)"

echo "Frontend dir: $FRONTEND_DIR"
echo "Repo root: $REPO_ROOT"

# Clone sibling repos into the repo root
echo ""
echo "--- Cloning repositories to repo root ---"

cd "$REPO_ROOT"

git clone --depth 1 --branch main \
  https://github.com/qontinui/qontinui-schemas.git && echo "OK: qontinui-schemas"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-navigation.git && echo "OK: qontinui-navigation"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-workflow-utils.git && echo "OK: qontinui-workflow-utils"

git clone --depth 1 --branch master \
  https://github.com/qontinui/qontinui-workflow-ui.git && echo "OK: qontinui-workflow-ui"

# Patch package.json: change file:../../X to file:../X
# (repos are now one level up from frontend/, not two)
echo ""
echo "--- Patching package.json file: paths ---"
cd "$FRONTEND_DIR"
sed -i 's|file:../../|file:../|g' package.json
echo "Patched: file:../../ -> file:../"

# Install dependencies
echo ""
echo "--- Installing frontend dependencies ---"
npm install

echo ""
echo "=== Vercel Install: Complete ==="
