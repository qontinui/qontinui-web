#!/usr/bin/env bash
# Deterministic mypy hook — fixes the fresh-worktree false-failure class.
#
# The previous entry (`bash -c 'cd backend && poetry run mypy .'`) was
# non-deterministic in a freshly created git worktree: poetry creates a NEW,
# EMPTY per-path virtualenv there, and `poetry run` then silently falls back
# to a system-PATH mypy whose package resolution is undefined. Historically a
# stale system-env copy of qontinui_schemas produced bogus
# `Module "qontinui_schemas.generated" has no attribute "TaskRun*"` errors
# (12 errors across app/models/task_run.py + app/services/task_run/schemas.py)
# that blocked EVERY commit in the worktree even though the live schemas
# source had the symbols all along (2026-06-03, hit landing web #398).
#
# Fix: probe that the project virtualenv actually provides mypy AND the
# editable qontinui_schemas path-dep; if not, provision it once with
# `poetry install` (one-time cost per fresh worktree, cached afterwards),
# then run mypy strictly in-env. Either the env is real (editable schemas →
# live source) or the hook fails loudly with the install error — never the
# silent stale-resolution mode.
set -euo pipefail
cd backend

if ! poetry run python -c "import mypy, qontinui_schemas.generated" >/dev/null 2>&1; then
  echo "[mypy-hook] poetry env for this checkout is missing/unprovisioned —" >&2
  echo "[mypy-hook] provisioning once (fresh worktrees hit this)..." >&2
  # Pin the venv to Python 3.12: CI runs 3.12, mypy's python_version=3.12,
  # and a default-3.13 venv fails to build pyarrow 17 (no cp313 wheel).
  # Best-effort — if 3.12 isn't installed, fall through and let poetry pick.
  poetry env use 3.12 1>&2 || \
    echo "[mypy-hook] WARNING: python 3.12 not found; using poetry default (CI uses 3.12)" >&2
  poetry install --no-interaction --no-ansi 1>&2
fi

exec poetry run mypy .
