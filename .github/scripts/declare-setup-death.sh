#!/usr/bin/env bash
# Declare that a job died in a SETUP step and that its red is therefore not a
# verdict on the PR (plan 2026-11-11-web-setup-step-deaths-declare-not-a-verdict,
# Phases 1-2, 4).
#
# WHY. coord's repair classifier decides whether a red PR is its own fault from
# WHERE each failed check is red. A tool-download outage (the Poetry installer,
# Trivy, a sibling clone, apt) reds a check that is green on main, so coord
# calls it `intrinsic` and spends a fixer on a red no code change can clear.
# coord reads one property to tell the two apart: a check-run annotation whose
# TITLE contains the byte-exact, case-sensitive phrase
# `(not a verdict on this PR)` (qontinui-coord `is_no_verdict_annotation`).
# This script writes that title, and ONLY when the job's own step outcomes
# prove the red came from a setup step. A scan or test step that failed never
# gets the phrase: that red IS a verdict.
#
# WHO RUNS IT. The LAST step of every carrier job, named `Declare a setup
# death`, with `if: failure()`, `working-directory: ${{ github.workspace }}`
# (the job's default `./backend` does not exist when the checkout failed) and
# `timeout-minutes: 3`. backend/tests/test_declare_setup_death.py derives the
# carrier set from every workflow `run:` that invokes this file and pins each
# job's rows against a literal table.
#
# WHICH COPY RUNS. The step runs the copy in the working tree, which is the
# PR's merge commit, with ONE exception: migration-reversal.yml's `tested`
# job. Its `Qualify the PR's migration and switch to the base tree` step runs
# `git checkout --quiet --detach "$BASE_TIP"` (the base branch's tip), so:
#   * a setup death BEFORE that switch (`Self-hosted: host provisioned`,
#     `Set up Python`) runs the merge commit's copy, as everywhere else;
#   * a setup death AFTER it (`Free disk space`, the sibling clone,
#     `Install postgresql-client`) runs the BASE tip's copy. A base that has
#     no copy fails closed: the step prints that the script is absent and
#     declares nothing.
# Either copy reads the PR's diff from GITHUB_SHA, never HEAD (see the guard
# below), and takes its rows and pattern from the PR's own workflow.
#
# INPUTS (environment only):
#   DECLARE_JOB         the check-run name, as GitHub serves it.
#   SETUP_STEPS         one row per setup step, in job order:
#                         <step name>|${{ steps.<id>.outcome }}|${{ steps.<id>.conclusion }}
#                       (the row format of the infrastructure explainer's
#                       APT_STEP_OUTCOMES). A setup step is a tool download or
#                       install that reads none of the PR's files.
#   VERDICT_STEPS       the same rows for the job's scan/test steps. A row whose
#                       step has a status-function `if:` (`always()`,
#                       `!cancelled()`, `failure()`) carries a leading `!`:
#                         !<step name>|<outcome>|<conclusion>
#   HARNESS_PATHS_RE    an ERE over repo-relative paths: the job's own workflow
#                       file, `^\.github/actions/` and this script.
#   GITHUB_EVENT_NAME, GITHUB_WORKSPACE, GITHUB_SHA   (set by Actions)
#   DECLARE_FETCH_BOUND_SECS  TEST LEVER, may only LOWER the 60 s bound on the
#                       first-parent fetch (an empty, malformed or larger value
#                       is 60).
#
# THE DECISION, in this order:
#   1. A malformed input is UNKNOWN: an empty DECLARE_JOB, an empty row list,
#      a row that does not parse, or a row whose outcome or conclusion is empty
#      or not one of success|failure|cancelled|skipped. A renamed or deleted
#      step id renders EMPTY, so an empty value is an absence of DATA, never
#      an observation of health (the explainer's `apt_rows_seen` rule).
#      UNKNOWN withholds the declaration, with a notice.
#   2. If a VERDICT row concluded `failure`, there is no declaration: that red
#      is a verdict. A `!` row counts only when no SETUP row concluded
#      `failure`; after a setup death its failure is the cascade (style-gate's
#      `assert` step exits 1 on CAPTURE-UNAVAILABLE under STYLE_GATE_ENFORCE=1).
#      The plan's wording is "no SETUP row BEFORE it"; the two are equal. A
#      setup step keeps the implicit `success()` `if:` (the wiring test pins
#      that), so a VERDICT step that concluded `failure` skips every setup
#      step after it, and any setup row that also concluded `failure` must
#      have run before it.
#   3. If no SETUP row concluded `failure`, there is no declaration. It is the
#      CONCLUSION that counts, so a `continue-on-error` soft failure (outcome
#      `failure`, conclusion `success`) never declares.
#   4. Otherwise the harness-diff guard decides: `false` declares; `true` and
#      UNKNOWN withhold, with a notice.
#   5. A declaration prints exactly one `::error` line whose title is
#      `<DECLARE_JOB> SETUP FAILED (not a verdict on this PR)` and whose
#      message names the first failed setup step in row order.
#   Rules 2 and 3 print one plain log line naming the decision.
#
# THE HARNESS-DIFF GUARD (mirrors qontinui-coord ci.yml's
# `COORD_CI_HARNESS_CODE_TOUCHED`, and fails closed the same way). A PR that
# edits a setup step, a local action or this script can cause the very setup
# death it would then excuse, so such a PR is never declared. It reads `true`
# when `git diff --no-renames --name-only <first parent> <merge commit>`
# lists a path matching HARNESS_PATHS_RE, `false` when it lists none, and
# UNKNOWN on any other event than `pull_request`, on a GITHUB_SHA that is not
# a two-parent merge commit, on a first parent it cannot fetch within the
# bound, on a failed diff and on an invalid pattern.
#   * The merge commit is GITHUB_SHA, not HEAD: on `pull_request` it names the
#     merge commit actions/checkout checked out, and a later step may move
#     HEAD (migration-reversal.yml's `tested` job detaches it at the base tip).
#   * Its parents are read from the raw commit object, because a depth-1
#     checkout grafts them away (`rev-parse <merge>^1` fails there).
#   * The first parent is fetched by sha, anonymously: qontinui-web is public.
#
# TIME BOUNDS. The fetch is `timeout -k 5 60`, the diff `timeout -k 5 30`; a
# timeout reads UNKNOWN and withholds. The invoking step's 3-minute bound sits
# above both, so a hang can neither hold a runner nor flip the check.
#
# TITLE ESCAPING. DECLARE_JOB is escaped as a workflow-command property value
# (`%` `\r` `\n` `:` `,`) so a job name with a comma or colon cannot cut the
# title before the phrase; every name in a message is escaped as data. Every
# title and step name is data: quoted expansions, `grep -E --`, never `eval`.
# Plain log lines carry a fixed prefix, so none can start with `::` and be
# parsed as a workflow command.
#
# RESERVED PHRASES. No title written here contains any of three phrases, each
# kept out for its own reason (qontinui-coord: `no_verdict_marker_for_title`
# in main_baseline_no_verdict.rs, and the author nudge in
# stuck_author_nudge.rs). A setup death must map to the `no_verdict` marker
# and be quoted to the author by its own title.
#   * `OUT OF MEMORY (not a verdict on this PR)` maps a title to the
#     `out_of_memory` marker instead.
#   * `killed IN THE BUILD` maps a title to `build_killed` (which skips the
#     main-baseline write), but only BESIDE one of the other two phrases;
#     alone it still maps to `no_verdict`. It is kept out so that no wording
#     can make that pair.
#   * `TIMED OUT (not a verdict on this PR)` alone still maps to `no_verdict`,
#     but it switches the author nudge to its step-timeout sentence (the suite
#     "did NOT complete"), which is false of a setup step that died.
#
# EXIT. 0 on every path, malformed input included: a reporter never decides a
# job's colour. `set -u` without `-e`, so a reporter always reaches its verdict
# line, and an EXIT trap holds the status at 0 even if something aborts.
set -uo pipefail
trap 'exit 0' EXIT

readonly LOG_PREFIX='declare-setup-death:'
readonly FETCH_BOUND_MAX=60
readonly DIFF_BOUND=30

# --- output helpers -----------------------------------------------------------

# Workflow-command DATA escaping (the message after `::`).
escape_data() {
  local s="$1"
  s="${s//\%/%25}"
  s="${s//$'\r'/%0D}"
  s="${s//$'\n'/%0A}"
  printf '%s' "$s"
}

# Workflow-command PROPERTY escaping (a `title=` value).
escape_property() {
  local s
  s="$(escape_data "$1")"
  s="${s//:/%3A}"
  s="${s//,/%2C}"
  printf '%s' "$s"
}

# One plain log line. CR/LF become spaces and the fixed prefix leads, so the
# line can never be read as a workflow command.
log_decision() {
  local s="$1"
  s="${s//$'\r'/ }"
  s="${s//$'\n'/ }"
  printf '%s %s\n' "$LOG_PREFIX" "$s"
}

withhold() {
  printf '::notice title=Setup-death declaration withheld::%s\n' "$(escape_data "$1")"
}

join_names() {
  # join_names <name>...  ->  "a, b, c", or "none"
  if [ "$#" -eq 0 ]; then
    printf 'none'
    return
  fi
  local out="$1"
  shift
  local name
  for name in "$@"; do
    out="${out}, ${name}"
  done
  printf '%s' "$out"
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# --- row parsing --------------------------------------------------------------

# Parsed rows, one index per row across both lists.
ROW_KIND=()        # setup | verdict
ROW_MARK=()        # "!" or ""
ROW_NAME=()
ROW_OUTCOME=()
ROW_CONCLUSION=()
PARSE_ERROR=""

# Keep the FIRST parse error: it names the row a reader should fix first.
parse_error() {
  [ -n "$PARSE_ERROR" ] || PARSE_ERROR="$1"
}

is_step_value() {
  case "$1" in
    success | failure | cancelled | skipped) return 0 ;;
    *) return 1 ;;
  esac
}

# parse_rows <kind> <text>: append every non-blank line of <text>. The name is
# everything before the LAST two `|`, so a `|` inside a step name survives.
parse_rows() {
  local kind="$1" text="$2"
  local line rest name outcome conclusion mark seen=0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//$'\r'/}"
    line="$(trim "$line")"
    [ -z "$line" ] && continue
    seen=$((seen + 1))
    case "$line" in
      *'|'*'|'*) ;;
      *)
        parse_error "$kind row '${line}' is not <step name>|<outcome>|<conclusion>"
        continue
        ;;
    esac
    conclusion="$(trim "${line##*|}")"
    rest="${line%|*}"
    outcome="$(trim "${rest##*|}")"
    name="$(trim "${rest%|*}")"
    mark=""
    if [ "${name:0:1}" = "!" ]; then
      mark="!"
      name="$(trim "${name:1}")"
    fi
    if [ -z "$name" ]; then
      parse_error "a $kind row names no step"
      continue
    fi
    if [ "$kind" = setup ] && [ -n "$mark" ]; then
      parse_error "setup row '${name}' carries the verdict-only '!' mark"
      continue
    fi
    if [ -z "$outcome" ] || [ -z "$conclusion" ]; then
      parse_error "$kind row '${name}' rendered an empty outcome or conclusion (a renamed or deleted step id renders empty), so its result is UNKNOWN"
      continue
    fi
    if ! is_step_value "$outcome" || ! is_step_value "$conclusion"; then
      parse_error "$kind row '${name}' carries outcome '${outcome}' and conclusion '${conclusion}', which are not step results"
      continue
    fi
    ROW_KIND+=("$kind")
    ROW_MARK+=("$mark")
    ROW_NAME+=("$name")
    ROW_OUTCOME+=("$outcome")
    ROW_CONCLUSION+=("$conclusion")
  done <<< "$text"
  if [ "$seen" -eq 0 ]; then
    parse_error "the ${kind} row list is empty, so whether a ${kind} step failed is UNKNOWN"
  fi
}

# --- the harness-diff guard ----------------------------------------------------

GUARD="UNKNOWN"
GUARD_REASON=""

is_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ || "$1" =~ ^[0-9a-f]{64}$ ]]
}

fetch_bound() {
  local raw="${DECLARE_FETCH_BOUND_SECS:-}"
  if [[ "$raw" =~ ^[0-9]{1,3}$ ]] && [ "$((10#$raw))" -ge 1 ] && [ "$((10#$raw))" -le "$FETCH_BOUND_MAX" ]; then
    printf '%s' "$((10#$raw))"
  else
    printf '%s' "$FETCH_BOUND_MAX"
  fi
}

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
  local raw
  if ! raw="$(git -C "$ws" cat-file -p "$merge" 2> /dev/null)"; then
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
  if ! git -C "$ws" cat-file -e "${first}^{commit}" 2> /dev/null; then
    local bound rc
    bound="$(fetch_bound)"
    timeout -k 5 "$bound" git -C "$ws" fetch --no-tags --depth=1 origin "$first" > /dev/null 2>&1
    rc=$?
    if ! git -C "$ws" cat-file -e "${first}^{commit}" 2> /dev/null; then
      GUARD_REASON="the merge commit's first parent ${first} could not be fetched (git fetch exited ${rc}; 124 or 137 is the ${bound}s bound)"
      return
    fi
  fi
  local changed rc
  changed="$(timeout -k 5 "$DIFF_BOUND" git -C "$ws" diff -z --no-renames --name-only "$first" "$merge" 2> /dev/null | tr '\0' '\n')"
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
      GUARD_REASON="this PR's diff touches this job's own harness ('$(sed -n 1p <<< "$matched")'), so it can have caused the setup death it would excuse"
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

# --- the decision -------------------------------------------------------------

main() {
  local job="${DECLARE_JOB:-}"
  if [ -z "$(trim "$job")" ]; then
    withhold "DECLARE_JOB is empty, so there is no check name to declare against."
    return
  fi

  parse_rows setup "${SETUP_STEPS:-}"
  parse_rows verdict "${VERDICT_STEPS:-}"
  # Rule 1.
  if [ -n "$PARSE_ERROR" ]; then
    withhold "${PARSE_ERROR}. A row that did not render is an absence of data, not a pass."
    return
  fi

  local -a setup_failed=() verdict_failed=() cascade_failed=() passed=() skipped=() interrupted=()
  local i
  for i in "${!ROW_NAME[@]}"; do
    if [ "${ROW_KIND[$i]}" = setup ] && [ "${ROW_CONCLUSION[$i]}" = failure ]; then
      setup_failed+=("${ROW_NAME[$i]}")
    fi
  done
  for i in "${!ROW_NAME[@]}"; do
    [ "${ROW_KIND[$i]}" = verdict ] || continue
    case "${ROW_CONCLUSION[$i]}" in
      failure)
        if [ -n "${ROW_MARK[$i]}" ] && [ "${#setup_failed[@]}" -gt 0 ]; then
          cascade_failed+=("${ROW_NAME[$i]}")
        else
          verdict_failed+=("${ROW_NAME[$i]}")
        fi
        ;;
      success) passed+=("${ROW_NAME[$i]}") ;;
      skipped) skipped+=("${ROW_NAME[$i]}") ;;
      cancelled) interrupted+=("${ROW_NAME[$i]}") ;;
    esac
  done

  # Rule 2.
  if [ "${#verdict_failed[@]}" -gt 0 ]; then
    log_decision "no declaration: scan/test step(s) '$(join_names "${verdict_failed[@]}")' concluded failure, so this red is a verdict on the change."
    return
  fi
  # Rule 3.
  if [ "${#setup_failed[@]}" -eq 0 ]; then
    log_decision "no declaration: no setup step concluded failure (a continue-on-error soft failure concludes success), so this red is not a setup death."
    return
  fi

  # Rule 4.
  compute_guard
  if [ "$GUARD" != "false" ]; then
    withhold "Setup step '${setup_failed[0]}' failed, but the harness-diff guard read ${GUARD}: ${GUARD_REASON}. This red is left to read as a verdict on this change."
    return
  fi

  # Rule 5.
  local title lead lists message
  title="${job} SETUP FAILED (not a verdict on this PR)"
  case "$title" in
    *'TIMED OUT (not a verdict on this PR)'* | *'OUT OF MEMORY (not a verdict on this PR)'* | *'killed IN THE BUILD'*)
      withhold "DECLARE_JOB would put a reserved phrase (TIMED OUT, OUT OF MEMORY or killed IN THE BUILD) into the title, and coord would read a setup death as a timeout or a capacity kill."
      return
      ;;
  esac
  lead="step '${setup_failed[0]}' failed, and no scan/test step in this job concluded failure"
  if [ "${#cascade_failed[@]}" -gt 0 ]; then
    lead="${lead} before it; step(s) '$(join_names "${cascade_failed[@]}")' failed after it, as its cascade"
  fi
  lists="passed: $(join_names "${passed[@]}"); did not run: $(join_names "${skipped[@]}")"
  if [ "${#interrupted[@]}" -gt 0 ]; then
    lists="${lists}; interrupted: $(join_names "${interrupted[@]}")"
  fi
  message="${lead} (${lists}). Re-run the job. Failed setup step(s): $(join_names "${setup_failed[@]}")."
  printf '::error title=%s::%s\n' "$(escape_property "$title")" "$(escape_data "$message")"
}

main
exit 0
