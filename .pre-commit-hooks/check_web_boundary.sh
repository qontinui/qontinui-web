#!/usr/bin/env bash
# web/backend ↔ qontinui boundary lint — local pre-commit mirror of
# .github/workflows/web-boundary-lint.yml.
#
# Enforces the architectural boundary documented in memo
# `proj_arch_web_runner_websocket_boundary`: the qontinui-web backend
# must not import from the `qontinui` namespace. Communicate via the
# WebSocket bridge (runner_command_ws) or use `qontinui-schemas` for
# shared Pydantic types.
#
# Invoked by pre-commit with the changed-file list as positional args.

set -uo pipefail

# Match real Python `from qontinui[.X] import …` / `import qontinui[.X]`
# statements only — not prose like "from qontinui-runner's exporter".
PATTERN='(^|[^a-zA-Z0-9_-])(from|import)[[:space:]]+qontinui([[:space:].]|$)'

hits="$(grep -nE "$PATTERN" "$@" 2>/dev/null \
    | grep -vE 'qontinui[-_]schemas' \
    | grep -v 'backend/app/api/embeddings.py:' \
    || true)"

if [ -n "$hits" ]; then
    echo "ERROR: web/backend imports from qontinui — boundary violation." >&2
    echo "See memo proj_arch_web_runner_websocket_boundary + plan-2026-05-17-web-runner-ws-bridge-plan-b." >&2
    echo "$hits" >&2
    exit 1
fi
exit 0
