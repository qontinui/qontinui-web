#!/usr/bin/env bash
# Format EXACTLY the backend Python files a PR changed — the `command` a
# `kind = "format"` `[[repair]]` in .qontinui/ci.toml names (plan
# 2026-09-24-coord-deterministic-ci-repair-lane §3 recipe 2).
#
# Usage — coord-repair.yml runs it from the PR-head checkout (work/) as the
# default branch's copy, `../trusted/.github/scripts/<this>`; it acts on its
# CWD's git toplevel, never on the tree it was read from:
#   COORD_REPAIR_CHANGED_FILES=<file> bash .github/scripts/repair-fmt.sh
#
#   COORD_REPAIR_CHANGED_FILES  newline-separated repo-relative paths the PR
#                               changed (coord-repair-run.py writes it)
#
# What it runs, on the changed `backend/**/*.py` files only, from backend/ so
# backend/pyproject.toml's [tool.ruff] is the config exactly as for CI's
# `Run ruff (linting)` / `Run ruff format (formatting)` steps in
# .github/workflows/backend-ci.yml:
#   1. ruff check --fix --select I001   (import order — the only lint the
#                                        recipe may fix; F401 is deliberately
#                                        NOT included: removing an "unused"
#                                        import can drop a side effect)
#   2. ruff format
# Import sorting first, then the formatter, which is the order ruff documents.
# Both with --force-exclude, so a file the repo excludes from formatting (e.g.
# the vendored plan_status/classifier.py) is skipped even when it is named
# explicitly — exactly as CI's `ruff format --check .` skips it.
#
# `ruff` must be on PATH at the version backend/poetry.lock resolves;
# coord-repair.yml installs that version before running this.
#
# The frontend is NOT covered: frontend-ci.yml has no `prettier --check` step
# (its `Lint` step is `npm run lint`), so there is no failing format step for a
# prettier repair to clear.
#
# Exit: 0 done (or nothing to format), ruff's own code if it failed, 2 a usage
# refusal.
set -euo pipefail

die() { printf 'repair-fmt: %s\n' "$*" >&2; exit 2; }

: "${COORD_REPAIR_CHANGED_FILES:?COORD_REPAIR_CHANGED_FILES must name the changed-files list}"
[[ -f "$COORD_REPAIR_CHANGED_FILES" ]] || die "changed-files list not found: $COORD_REPAIR_CHANGED_FILES"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git work tree"
cd "$(git rev-parse --show-toplevel)"
command -v ruff >/dev/null 2>&1 || die "ruff is not on PATH"

declare -a files=()
while IFS= read -r f || [[ -n "$f" ]]; do
  [[ "$f" == backend/*.py ]] || continue
  [[ -f "$f" ]] || continue          # deleted by the PR
  # Relative to backend/, prefixed `./` so a path can never read as an option.
  files+=("./${f#backend/}")
done < "$COORD_REPAIR_CHANGED_FILES"

if [[ ${#files[@]} -eq 0 ]]; then
  echo "repair-fmt: no changed backend/**/*.py files; nothing to format"
  exit 0
fi

echo "repair-fmt: $(ruff --version) on ${#files[@]} changed backend file(s)"
cd backend
rc=0
ruff check --force-exclude --fix --select I001 "${files[@]}" || rc=$?
ruff format --force-exclude "${files[@]}" || rc=$?
exit "$rc"
