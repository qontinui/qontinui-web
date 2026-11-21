#!/usr/bin/env bash
# harness-guarded.sh <command> [args...] — run a CI command whose failure output
# may claim "(not a verdict on this PR)", and withhold that claim when the PR
# touches the command's own harness (plan
# 2026-11-17-gitleaks-not-a-verdict-title-has-no-harness-diff-guard).
#
# WHY. coord's repair classifier reads a check-run annotation whose TITLE holds
# the byte-exact phrase `(not a verdict on this PR)` as "this red is not the
# PR's fault" and re-runs it instead of routing it to a fixer (qontinui-coord
# `is_no_verdict_annotation`). `.github/scripts/fetch-gitleaks.sh` prints that
# phrase on every fetch failure. But a PR that edits the fetch script, the
# workflow that runs it, or the step's inputs can CAUSE that failure, and must
# not be excused for it. fetch-gitleaks.sh is a byte-identical copy of the
# canonical qontinui-coord script and may not be edited here alone, so the
# guard sits at the call site instead.
#
# WHAT IT DOES. Computes the harness-diff guard, then runs the command with its
# stdout and stderr merged into one stream:
#   * guard `false`  -> every line passes through unchanged;
#   * guard `true` or UNKNOWN -> one `::notice` names why, and every
#     `(not a verdict on this PR)` in the stream is rewritten to
#     `(counted as a verdict - <why>)`, so the red stands as a verdict.
# The command's exit status is this script's exit status (75 stays 75).
#
# THE GUARD is `harness_guard_compute` in .github/scripts/harness-diff-guard.sh,
# the helper declare-setup-death.sh sources too, and its header holds the
# algorithm: the first-parent diff of the merge commit GITHUB_SHA against
# HARNESS_PATHS_RE reads `true`, `false` or UNKNOWN, and fails closed. The
# helper is sourced from THIS script's directory. A helper that is absent or
# does not load reads UNKNOWN: the claim is withheld, and the command still
# runs with its own exit status.
#   * This caller's bounds: the first-parent fetch by 20 s, every other git
#     call by 10 s (each plus a 5 s kill grace, about 85 s worst case in all).
#     They are tighter than the declarer's because the guard runs BEFORE the
#     fetch, inside the same step timeout, and a guard that ate the fetch's
#     time would turn a real outage into a phrase-less red; the step's
#     timeout-minutes budgets both.
# The guard runs the PR's own copy of this script and the helper, so it stops
# accidental harness breakage from being excused, not a PR that deliberately
# removes it; that PR is a workflow edit every workflow-file guard sees.
#
# INPUTS (environment): HARNESS_PATHS_RE (an ERE over repo-relative paths),
#   GITHUB_EVENT_NAME, GITHUB_WORKSPACE, GITHUB_SHA (set by Actions).
#   HARNESS_GUARD_FETCH_BOUND_SECS: TEST LEVER, may only LOWER the 20 s bound.
#
# The replacement text carries no `,` or `:`, so rewriting a title property
# cannot cut it, and it never contains the phrase.
set -uo pipefail

readonly PHRASE='(not a verdict on this PR)'
readonly FETCH_BOUND_MAX=20
readonly GIT_BOUND=10

if [ "$#" -eq 0 ]; then
  echo "harness-guarded.sh: no command given" >&2
  exit 2
fi

escape_data() {
  local s="$1"
  s="${s//\%/%25}"
  s="${s//$'\r'/%0D}"
  s="${s//$'\n'/%0A}"
  printf '%s' "$s"
}

GUARD="UNKNOWN"
GUARD_REASON=""
# Beside THIS copy of the script, never through GITHUB_WORKSPACE: each copy
# runs with the helper from its own tree. The path is not symlink-resolved, so
# a caller run through a symlink finds no helper and reads UNKNOWN (fail-closed;
# every workflow runs `bash .github/scripts/<script>` directly).
GUARD_HELPER="$(dirname -- "${BASH_SOURCE[0]}")/harness-diff-guard.sh"
readonly GUARD_HELPER
GUARD_HELPER_LOADED=0
# shellcheck source=SCRIPTDIR/harness-diff-guard.sh
if source "$GUARD_HELPER" 2> /dev/null; then
  GUARD_HELPER_LOADED=1
fi

# Never call an undefined function: under `set -u` without `-e` that is
# `command not found` and a GUARD nobody computed.
if [ "$GUARD_HELPER_LOADED" = 1 ] && declare -F harness_guard_compute > /dev/null; then
  harness_guard_compute "$FETCH_BOUND_MAX" "$GIT_BOUND" "${HARNESS_GUARD_FETCH_BOUND_SECS:-}"
else
  GUARD_REASON="the harness-diff guard helper ${GUARD_HELPER} is absent or did not load, so this PR's diff is unread"
fi

if [ "$GUARD" = "false" ]; then
  "$@" 2>&1
  exit $?
fi

if [ "$GUARD" = "true" ]; then
  replacement='(counted as a verdict - this PR changes the harness of this step)'
else
  replacement='(counted as a verdict - the harness diff of this PR is unread)'
fi
printf '::notice title=Not-a-verdict claim withheld::%s\n' \
  "$(escape_data "The harness-diff guard read ${GUARD}: ${GUARD_REASON}. A failure of this step is therefore left to read as a verdict on this change.")"

"$@" 2>&1 | while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "${line//"$PHRASE"/$replacement}"
done
exit "${PIPESTATUS[0]}"
