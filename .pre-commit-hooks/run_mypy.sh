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

# Never let poetry block on the OS keyring. Poetry probes the keyring
# ("Checking keyring availability") before `poetry install`, and on a
# headless Linux box whose D-Bus session bus exists but has no unlocked
# Secret Service collection that probe blocks FOREVER waiting on an unlock
# prompt nobody can answer — measured on merytshost 2026-09-23: `poetry
# install` sat at the probe for 300s (killed by timeout), and completed in
# 7s with the null backend. This project resolves only from public PyPI (no
# [[tool.poetry.source]]), so no credential ever comes from the keyring.
# An explicit caller setting is respected.
export PYTHON_KEYRING_BACKEND="${PYTHON_KEYRING_BACKEND:-keyring.backends.null.Keyring}"

# Bound provisioning so a future hang fails loudly instead of wedging the
# commit. Only GNU coreutils `timeout` is used: on Windows the first
# `timeout` on PATH can be C:\Windows\System32\timeout.exe (a pause command
# that rejects `timeout N cmd`), and stock macOS has none — both answer
# `--version` with a failure, and there the install runs unbounded.
PROVISION_TIMEOUT="${QONTINUI_MYPY_PROVISION_TIMEOUT_SECS:-900}"
bounded() {
  if timeout --version >/dev/null 2>&1; then
    timeout "$PROVISION_TIMEOUT" "$@"
  else
    "$@"
  fi
}

if ! poetry run python -c "import mypy, qontinui_schemas.generated" >/dev/null 2>&1; then
  echo "[mypy-hook] poetry env for this checkout is missing/unprovisioned —" >&2
  echo "[mypy-hook] provisioning once (fresh worktrees hit this)..." >&2
  # Pin the venv to Python 3.12: CI runs 3.12, mypy's python_version=3.12,
  # and a default-3.13 venv fails to build pyarrow 17 (no cp313 wheel).
  # Best-effort — if 3.12 isn't installed, fall through and let poetry pick.
  poetry env use 3.12 1>&2 || \
    echo "[mypy-hook] WARNING: python 3.12 not found; using poetry default (CI uses 3.12)" >&2
  rc=0
  bounded poetry install --no-interaction --no-ansi 1>&2 || rc=$?
  if [ "$rc" -eq 124 ]; then
    echo "[mypy-hook] ERROR: poetry install exceeded ${PROVISION_TIMEOUT}s and was killed." >&2
    echo "[mypy-hook] Re-run by hand with -vv to see where it stalls:" >&2
    echo "[mypy-hook]   (cd backend && poetry install -vv)" >&2
    exit 1
  elif [ "$rc" -ne 0 ]; then
    exit "$rc"
  fi
fi

exec poetry run mypy .
