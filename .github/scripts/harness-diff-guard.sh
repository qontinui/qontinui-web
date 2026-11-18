#!/usr/bin/env bash
# harness-diff-guard.sh — the first-parent harness-diff guard, SOURCED by every
# script that may write `(not a verdict on this PR)` (plan
# 2026-11-17-fold-the-two-harness-diff-guards-into-one-sourced-helper):
#   * .github/scripts/declare-setup-death.sh (a job's setup death), and
#   * .github/scripts/harness-guarded.sh (the gitleaks fetch's failure title).
# It is the ONE copy of the algorithm; a caller keeps only its own bounds.
# (scripts/ci/aggregate_setup_death.py ports it to Python for the aggregate
# jobs, held to it by its own drift test.)
#
# WHY. coord's repair classifier reads an annotation TITLE holding the
# byte-exact phrase `(not a verdict on this PR)` as "this red is not the PR's
# fault" (qontinui-coord `is_no_verdict_annotation`). A PR that edits a
# failing step's own harness (its workflow, a local action, the script that
# writes the phrase, this file) can CAUSE the failure it would then excuse, so
# such a PR is never excused.
#
# THE ALGORITHM mirrors qontinui-coord ci.yml's `COORD_CI_HARNESS_CODE_TOUCHED`
# and fails closed the same way. It reads `true` when
# `git diff --no-renames --name-only <first parent> <merge commit>` lists a
# path matching HARNESS_PATHS_RE, `false` when it lists none, and UNKNOWN on
# any event other than `pull_request`, an empty or invalid pattern, a
# GITHUB_SHA that is not a two-parent merge commit, a first parent it cannot
# fetch within the bound, a failed diff, and bound arguments that are not
# whole seconds (a caller bug must not read `false`).
#   * The merge commit is GITHUB_SHA, not HEAD: on `pull_request` it names the
#     merge commit actions/checkout checked out, and a later step may move
#     HEAD (migration-reversal.yml's `tested` job detaches it at the base tip).
#   * Its parents are read from the raw commit object, because a depth-1
#     checkout grafts them away (`rev-parse <merge>^1` fails there).
#   * The first parent is fetched by sha, anonymously: qontinui-web is public.
#   * Every git call runs with GIT_NO_LAZY_FETCH=1 and GIT_TERMINAL_PROMPT=0.
#     In a partial clone, a read of an absent object (the `cat-file -e` check
#     for the first parent, say) is otherwise a lazy fetch from the promisor
#     remote: one outside the fetch's bound, which can fill in a parent the
#     bounded fetch could not. git 2.45 added the variable; an older git
#     ignores it, and the read's own bound still holds.
#   * Every git call is time-bounded with `timeout -k 5`: the first-parent
#     fetch by the caller's fetch bound, every other call by its git bound. A
#     timeout reads UNKNOWN. Each caller states its own budget, because each
#     runs inside a different step timeout.
# A caller runs the PR's own copy of this file, so the guard stops accidental
# harness breakage from being excused, not a PR that deliberately removes it;
# that PR is a workflow edit every workflow-file guard sees. This file is in
# every HARNESS_PATHS_RE, so a PR that edits it is never excused either.
#
# INTERFACE. Sourced, never run. No `set` of its own (it inherits the caller's
# `set -uo pipefail`), and it reads no caller global: the bounds and the
# fetch lever arrive as arguments, the rest from the Actions environment.
#   harness_guard_compute <fetch_bound_max> <git_bound> <fetch_lever_value>
#       sets GUARD (true|false|UNKNOWN) and GUARD_REASON. The lever is a TEST
#       LEVER that may only LOWER the fetch bound (harness_guard_fetch_bound).
#   harness_guard_is_sha <value>
#   harness_guard_fetch_bound <raw> <max>   prints raw when it is 1..max, else max
#   harness_guard_has_commit <workspace> <sha> <git_bound>
# Environment read: GITHUB_EVENT_NAME, HARNESS_PATHS_RE, GITHUB_WORKSPACE,
# GITHUB_SHA. A caller whose `source` of this file fails, or after which
# `declare -F harness_guard_compute` is false, sets GUARD=UNKNOWN itself and
# never calls it.
#
# GUARD and GUARD_REASON are written for the caller to read, which shellcheck
# cannot see from here.
# shellcheck disable=SC2034

harness_guard_is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ || "$1" =~ ^[0-9a-f]{64}$ ]]
}

harness_guard_fetch_bound() {
  local raw="$1" max="$2"
  if [[ "$raw" =~ ^[0-9]{1,3}$ ]] && [ "$((10#$raw))" -ge 1 ] && [ "$((10#$raw))" -le "$max" ]; then
    printf '%s' "$((10#$raw))"
  else
    printf '%s' "$max"
  fi
}

# Is the commit in the local object store? Bounded, and on git 2.45 and later
# never a lazy fetch (harness_guard_compute exports GIT_NO_LAZY_FETCH).
harness_guard_has_commit() {
  timeout -k 5 "$3" git -C "$1" cat-file -e "${2}^{commit}" 2> /dev/null
}

harness_guard_compute() {
  GUARD="UNKNOWN"
  GUARD_REASON=""
  local fetch_max="${1:-}" git_bound="${2:-}" lever="${3:-}"
  if ! [[ "$fetch_max" =~ ^[1-9][0-9]{0,3}$ && "$git_bound" =~ ^[1-9][0-9]{0,3}$ ]]; then
    GUARD_REASON="the guard was called with bounds '${fetch_max}' and '${git_bound}', which are not whole seconds, so it read nothing"
    return
  fi
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
  if ! harness_guard_is_sha "$merge"; then
    GUARD_REASON="GITHUB_SHA ('${merge}') is not a commit id"
    return
  fi
  # No credential prompt can hold a call, and on git 2.45 and later no object
  # read becomes a lazy fetch (the header says why).
  export GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0
  local raw
  if ! raw="$(timeout -k 5 "$git_bound" git -C "$ws" cat-file -p "$merge" 2> /dev/null)"; then
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
  if ! harness_guard_is_sha "$first"; then
    GUARD_REASON="the merge commit's first parent ('${first}') is not a commit id"
    return
  fi
  if ! harness_guard_has_commit "$ws" "$first" "$git_bound"; then
    local bound rc
    bound="$(harness_guard_fetch_bound "$lever" "$fetch_max")"
    timeout -k 5 "$bound" git -C "$ws" fetch --no-tags --depth=1 origin "$first" > /dev/null 2>&1
    rc=$?
    if ! harness_guard_has_commit "$ws" "$first" "$git_bound"; then
      GUARD_REASON="the merge commit's first parent ${first} could not be fetched (git fetch exited ${rc}; 124 or 137 is the ${bound}s bound)"
      return
    fi
  fi
  local changed rc
  changed="$(timeout -k 5 "$git_bound" git -C "$ws" diff -z --no-renames --name-only "$first" "$merge" 2> /dev/null | tr '\0' '\n')"
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
