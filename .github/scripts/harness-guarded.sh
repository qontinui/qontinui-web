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
# THE GUARD is the algorithm proposed as `compute_guard` in
# `.github/scripts/declare-setup-death.sh` by qontinui-web#2283 (open as of
# 2026-11-17; fold the two into one helper once it lands), which mirrors qontinui-coord ci.yml's
# `COORD_CI_HARNESS_CODE_TOUCHED` and fails closed the same way. It reads
# `true` when `git diff --no-renames --name-only <first parent> <merge commit>`
# lists a path matching HARNESS_PATHS_RE, `false` when it lists none, and
# UNKNOWN on any event other than `pull_request`, an empty or invalid pattern,
# a GITHUB_SHA that is not a two-parent merge commit, a first parent it cannot
# fetch within the bound, and a failed diff.
#   * The merge commit is GITHUB_SHA, not HEAD.
#   * Its parents are read from the raw commit object (a depth-1 checkout
#     grafts them away).
#   * Every git call runs with GIT_NO_LAZY_FETCH=1 and GIT_TERMINAL_PROMPT=0,
#     and is time-bounded: the first-parent fetch by 20 s, every other call by
#     10 s (each plus a 5 s kill grace, about 85 s worst case in all). A
#     timeout reads UNKNOWN. The bounds are tighter than #2283's because the
#     guard runs BEFORE the fetch, inside the same step timeout, and a guard
#     that ate the fetch's time would turn a real outage into a phrase-less
#     red; the step's timeout-minutes budgets both.
# The guard runs the PR's own copy of this script, so it stops accidental
# harness breakage from being excused, not a PR that deliberately removes it;
# that PR is a workflow edit every workflow-file guard sees.
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

is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ || "$1" =~ ^[0-9a-f]{64}$ ]]
}

fetch_bound() {
  local raw="${HARNESS_GUARD_FETCH_BOUND_SECS:-}"
  if [[ "$raw" =~ ^[0-9]{1,3}$ ]] && [ "$((10#$raw))" -ge 1 ] && [ "$((10#$raw))" -le "$FETCH_BOUND_MAX" ]; then
    printf '%s' "$((10#$raw))"
  else
    printf '%s' "$FETCH_BOUND_MAX"
  fi
}

has_commit() {
  timeout -k 5 "$GIT_BOUND" git -C "$1" cat-file -e "${2}^{commit}" 2> /dev/null
}

GUARD="UNKNOWN"
GUARD_REASON=""

compute_guard() {
  GUARD="UNKNOWN"
  local event="${GITHUB_EVENT_NAME:-}"
  if [ "$event" != "pull_request" ]; then
    GUARD_REASON="the event is '${event:-unset}', not pull_request, so there is no PR diff to read"
    return
  fi
  local re="${HARNESS_PATHS_RE:-}"
  if [ -z "$re" ]; then
    GUARD_REASON="HARNESS_PATHS_RE is empty, so there is no harness to compare the diff against"
    return
  fi
  # grep exits 1 on a valid pattern that matches nothing, 2 on an invalid one.
  local probe=0
  grep -E -- "$re" < /dev/null > /dev/null 2>&1 || probe=$?
  if [ "$probe" -ne 1 ]; then
    GUARD_REASON="HARNESS_PATHS_RE is not a valid extended regular expression"
    return
  fi
  local ws="${GITHUB_WORKSPACE:-}"
  if [ -z "$ws" ] || [ ! -d "$ws" ]; then
    GUARD_REASON="GITHUB_WORKSPACE ('${ws}') is not a directory, so the checkout cannot be read"
    return
  fi
  local merge="${GITHUB_SHA:-}"
  if ! is_sha "$merge"; then
    GUARD_REASON="GITHUB_SHA ('${merge}') is not a commit id"
    return
  fi
  export GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0
  local raw
  if ! raw="$(timeout -k 5 "$GIT_BOUND" git -C "$ws" cat-file -p "$merge" 2> /dev/null)"; then
    GUARD_REASON="the merge commit ${merge} is not readable in this checkout"
    return
  fi
  # Header lines only: a `parent ` line in the commit MESSAGE is not a parent.
  local parents count first
  parents="$(sed -n '/^$/q; s/^parent //p' <<< "$raw")"
  count="$(grep -c . <<< "$parents")"
  if [ "$count" != "2" ]; then
    GUARD_REASON="${merge} has ${count} parent(s), not the two of a pull_request merge commit"
    return
  fi
  first="$(sed -n 1p <<< "$parents")"
  if ! is_sha "$first"; then
    GUARD_REASON="the merge commit's first parent ('${first}') is not a commit id"
    return
  fi
  if ! has_commit "$ws" "$first"; then
    local bound rc
    bound="$(fetch_bound)"
    timeout -k 5 "$bound" git -C "$ws" fetch --no-tags --depth=1 origin "$first" > /dev/null 2>&1
    rc=$?
    if ! has_commit "$ws" "$first"; then
      GUARD_REASON="the merge commit's first parent ${first} could not be fetched (git fetch exited ${rc}; 124 or 137 is the ${bound}s bound)"
      return
    fi
  fi
  local changed rc
  changed="$(timeout -k 5 "$GIT_BOUND" git -C "$ws" diff -z --no-renames --name-only "$first" "$merge" 2> /dev/null | tr '\0' '\n')"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    GUARD_REASON="git diff ${first} ${merge} exited ${rc}, so this PR's diff is unread"
    return
  fi
  if [ -z "$changed" ]; then
    GUARD="false"
    GUARD_REASON="this PR's diff against its base is empty"
    return
  fi
  local matched n
  n="$(grep -c . <<< "$changed")"
  matched="$(grep -E -- "$re" <<< "$changed")"
  rc=$?
  case "$rc" in
    0)
      GUARD="true"
      GUARD_REASON="this PR's diff touches this job's own harness ('$(sed -n 1p <<< "$matched")'), so it can have caused the failure it would excuse"
      ;;
    1)
      GUARD="false"
      GUARD_REASON="none of the ${n} paths in this PR's diff is this job's harness"
      ;;
    *)
      GUARD_REASON="matching the diff against HARNESS_PATHS_RE failed (grep exited ${rc})"
      ;;
  esac
}

compute_guard

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
