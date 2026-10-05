#!/usr/bin/env bash
# Regenerate the two committed OpenAPI snapshots — the `command` (and, with
# --check, the `check`) of a `kind = "regen"` `[[repair]]` in .qontinui/ci.toml
# (plan 2026-09-24-coord-deterministic-ci-repair-lane §3 recipe 3).
#
# Usage (from the repo root, with `poetry install` done in backend/):
#   bash .github/scripts/regen-openapi.sh           # rewrite both snapshots
#   bash .github/scripts/regen-openapi.sh --check   # exit 1 if a rewrite changes either
#
# A script rather than an argv in the declaration because the regeneration is
# TWO processes (the app is built at import time, so the default and the
# `--base` spec cannot share one interpreter) — the same two commands, with the
# same environment, as the `Check OpenAPI snapshot is up to date` step of
# .github/workflows/backend-ci.yml. Keep the two in step.
#
# --check is that step's verdict made usable on a PATCHED tree: CI compares the
# regeneration against HEAD with `git diff --exit-code`, which a repair's
# verifier cannot do (the repair IS a diff against HEAD). So it compares the
# regeneration against the files as they stand before it runs.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

SNAPSHOTS=(
  frontend/src/lib/api-client/openapi-schema.json
  frontend/src/lib/api-client/openapi-schema.base.json
)

mode="${1:-}"
case "$mode" in
  "" | --check) ;;
  *) printf 'regen-openapi: unknown argument %s (want --check or nothing)\n' "$mode" >&2; exit 2 ;;
esac

digest() { sha256sum "${SNAPSHOTS[@]}" 2>/dev/null || true; }
before="$(digest)"

# The environment backend-ci.yml's step sets, so the app imports cleanly
# offline. No DB or Redis is contacted (export_openapi.py's docstring).
export DATABASE_URL="postgresql://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test"
export ENVIRONMENT=development
export SECRET_KEY="test-secret-key-for-testing-only-minimum-32-characters-long"
export TESTING=1
export REDIS_ENABLED=false

(
  cd backend
  poetry run python scripts/export_openapi.py
  poetry run python scripts/export_openapi.py --base
)

if [[ "$mode" == "--check" ]]; then
  after="$(digest)"
  if [[ "$before" != "$after" ]]; then
    echo "regen-openapi: the snapshots are not what the exporter produces for this tree" >&2
    exit 1
  fi
  echo "regen-openapi: snapshots are current"
fi
