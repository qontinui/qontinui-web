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
#                       file, `^\.github/actions/`, this script and its
#                       guard helper, harness-diff-guard.sh.
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
#      message names the first failed setup step in row order and asks for
#      ONE re-run. coord re-runs a declared head once and reads a second
#      declared red on that head as `not_a_verdict_rerun_spent`, never as
#      another re-run (qontinui-coord repair_cause.rs `flake_arm_declared`).
#      A setup step that fails the same way twice is a broken setup, not an
#      outage (migration-reversal.yml `tested`'s `Install postgresql-client`
#      on a codename PGDG does not serve, say), and the message says so.
#   Rules 2 and 3 print one plain log line naming the decision.
#
# THE HARNESS-DIFF GUARD is `harness_guard_compute` in
# .github/scripts/harness-diff-guard.sh, whose header holds the algorithm
# (it mirrors qontinui-coord ci.yml's `COORD_CI_HARNESS_CODE_TOUCHED`, and
# fails closed the same way). A PR that edits a setup step, a local action,
# this script or the helper can cause the very setup death it would then
# excuse, so such a PR is never declared. The helper is sourced from THIS
# script's directory, so the base tip's copy of this script (migration-
# reversal.yml's `tested` job, above) runs with the base tip's helper. A
# helper that is absent or does not load reads UNKNOWN and withholds. A
# carrier's own checkout is not a partial clone (it sets no
# `sparse-checkout` and no `filter`, which the wiring test pins), so the
# helper's GIT_NO_LAZY_FETCH is a backstop here.
#
# TIME BOUNDS. This script passes the helper its bounds: every git call is
# bounded, the fetch by `timeout -k 5 60`, each `cat-file` read and the diff
# by `timeout -k 5 30`. A timeout reads UNKNOWN and withholds. The calls run
# one after another, so their bounds can add up past the invoking step's
# 3-minute `timeout-minutes`; that bound then stops the script before its
# verdict line, which declares nothing either. A hang can neither hold a
# runner nor flip the check.
#
# TITLE ESCAPING. DECLARE_JOB is escaped as a workflow-command property value
# (`%` `\r` `\n` `:` `,`) so a job name with a comma or colon cannot cut the
# title before the phrase; every name in a message is escaped as data. Every
# title and step name is data: quoted expansions, `grep -E --`, never `eval`.
#
# PLAIN LOG LINES (rules 2 and 3) quote step names, which are data, and the
# Actions runner reads a workflow command in two forms (actions/runner
# `ActionCommand`): a line that starts with `::` once its leading whitespace
# is trimmed (`TryParseV2`), and the legacy form, two `#` and a `[`, found at
# ANY column (`TryParse`, an `IndexOf`) and read up to the next `]`. The fixed
# prefix rules out only the first. So `log_decision` also breaks every legacy
# prefix into `# #[`, as backend/tests/setup_death_git.py `defang` does, and a
# step name holding one reaches the log as plain text. An `::error` or
# `::notice` line needs no such break: the runner tries `TryParseV2` first, and
# once that has read the line as a command the legacy form is never tried, so
# its message is data.
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
# The legacy workflow-command prefix, spelled in two parts so that no line of
# this file holds it (a test that fails over this file's text prints it), and
# what a plain log line carries in its place.
readonly LEGACY_PREFIX='#''#['
readonly LEGACY_BROKEN='# #['
readonly FETCH_BOUND_MAX=60
# Every other git call: the `cat-file` reads and the diff.
readonly GIT_BOUND=30

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

# One plain log line. CR/LF become spaces and the fixed prefix leads, so no
# line of it starts with `::`; every legacy prefix becomes `# #[`, so no
# column of it opens the legacy form either (PLAIN LOG LINES in the header).
# The replacement is unquoted and holds no `&` or `\`, which bash 5.2's
# patsub_replacement would read, so every bash version inserts it as is.
log_decision() {
  local s="$1"
  s="${s//$'\r'/ }"
  s="${s//$'\n'/ }"
  s="${s//"$LEGACY_PREFIX"/$LEGACY_BROKEN}"
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
# Beside THIS copy of the script, never through GITHUB_WORKSPACE: each copy
# runs with the helper from its own tree.
GUARD_HELPER="$(dirname -- "${BASH_SOURCE[0]}")/harness-diff-guard.sh"
readonly GUARD_HELPER
GUARD_HELPER_LOADED=0
# shellcheck source=SCRIPTDIR/harness-diff-guard.sh
if source "$GUARD_HELPER" 2> /dev/null; then
  GUARD_HELPER_LOADED=1
fi

# run_guard: the helper's verdict, or UNKNOWN when it did not load. It never
# calls an undefined function: under `set -u` without `-e` that is `command
# not found` and a GUARD nobody computed.
run_guard() {
  if [ "$GUARD_HELPER_LOADED" = 1 ] && declare -F harness_guard_compute > /dev/null; then
    harness_guard_compute "$FETCH_BOUND_MAX" "$GIT_BOUND" "${DECLARE_FETCH_BOUND_SECS:-}"
  else
    GUARD="UNKNOWN"
    GUARD_REASON="the harness-diff guard helper ${GUARD_HELPER} is absent or did not load, so this PR's diff is unread"
  fi
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
  run_guard
  if [ "$GUARD" != "false" ]; then
    withhold "Setup step '${setup_failed[0]}' failed, but the harness-diff guard read ${GUARD}: ${GUARD_REASON}. This red is left to read as a verdict on this change."
    return
  fi

  # Rule 5.
  local title lead lists message
  title="${job} SETUP FAILED (not a verdict on this PR)"
  case "$title" in
    *'TIMED OUT (not a verdict on this PR)'* | *'OUT OF MEMORY (not a verdict on this PR)'* | *'killed IN THE BUILD'*)
      withhold "DECLARE_JOB would put a reserved phrase (TIMED OUT, OUT OF MEMORY or killed IN THE BUILD) into the title, which no setup-death title may carry (RESERVED PHRASES in this script's header says why)."
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
  message="${lead} (${lists}). Re-run the job once; if the same setup step fails again, the setup itself is broken and needs a fix. Failed setup step(s): $(join_names "${setup_failed[@]}")."
  printf '::error title=%s::%s\n' "$(escape_property "$title")" "$(escape_data "$message")"
}

main
exit 0
