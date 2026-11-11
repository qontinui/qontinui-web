#!/usr/bin/env python3
"""Declare an aggregate check's red not a verdict, only when every failed member did.

Plan 2026-11-11-web-setup-step-deaths-declare-not-a-verdict, Phases 3-4.

An AGGREGATE check is red only because its member jobs were: ``Run Tests`` is
red when a ``Run Tests (shard N/6)`` shard is. coord's repair classifier never
lets a declared check outvote an UNDECLARED own failure (qontinui-coord#3964
D3), so a shard that titled its setup death
``<shard> SETUP FAILED (not a verdict on this PR)`` still leaves the PR
``intrinsic`` while the red, undeclared aggregate sits beside it. This script
writes the aggregate's own title,

    <DECLARE_JOB> SETUP FAILED in every failed <MEMBER_NOUN> (not a verdict on this PR)

and ONLY when the members' own annotations say every failed member declared a
setup death: it reads exactly what coord reads (each member check run's
``annotations?per_page=50``), never a second derivation of the members' rule.

Three lanes invoke it, each as the step "Declare a setup death" after the
aggregate's verdict step, behind a ``Check out the declarer`` sparse checkout of
``scripts/ci`` (``continue-on-error``, so a green aggregate gains no failure
mode):

* ``.github/workflows/backend-ci.yml``, job ``test-gate`` (``Run Tests``),
  over the ``test`` matrix (members ``SHARD_NAME``, expected ``EXPECTED_SHARDS``).
* ``.github/workflows/e2e-tests.yml``, job ``test-summary`` (``Test Summary``),
  over ``backend-tests`` (``Backend E2E Tests (3.12)``).
* ``.github/workflows/migration-reversal.yml``, job ``gate``
  (``Migration Reversal Gate``), over ``reverse`` (``detect`` is the other
  need and must not be red; ``tested`` is not a need, so not a member).

Inputs (environment)
--------------------

``DECLARE_JOB``        the aggregate's check name.
``MEMBER_NEED``        the ``needs:`` key whose jobs are the members.
``NEEDS_JSON``         ``${{ toJSON(needs) }}``: every need's ``result``. The
                       member need must be ``failure`` and every OTHER need
                       ``success`` or ``skipped``, so a red that also comes from
                       a non-member (e2e's ``frontend-tests`` on a push, the
                       migration gate's ``detect``) is never laundered.
``MEMBER_NAME_RE``     the members' check names (``re.fullmatch``). Empty means
                       ``shard_headroom.SHARD_NAME``, the ``Run Tests`` shards.
``EXPECTED_MEMBERS``   how many member jobs the run attempt must list.
``MEMBER_NOUN``        the title's word for a member (default ``shard``).
``HARNESS_PATHS_RE``   a regular expression over repo-relative paths: this
                       aggregate's harness (rule 5).
``GITHUB_TOKEN`` (``actions: read`` for the jobs listing, ``checks: read`` for
annotations), ``GITHUB_REPOSITORY``, ``GITHUB_RUN_ID``, ``GITHUB_RUN_ATTEMPT``,
``GITHUB_API_URL``, and for rule 5 ``GITHUB_EVENT_NAME``, ``GITHUB_WORKSPACE``
and ``GITHUB_SHA``. ``DECLARE_FETCH_BOUND_SECS`` is a TEST LEVER that may only
LOWER the 60 s first-parent fetch bound (an empty, malformed or larger value
is 60).

The decision
------------

It declares only when ALL of these hold:

1. the member need concluded ``failure`` and no other need concluded anything
   but ``success`` or ``skipped``;
2. this run attempt's job listing (``shard_headroom.fetch_jobs`` with
   ``attempt=``) holds exactly ``EXPECTED_MEMBERS`` completed jobs whose names
   match the member pattern;
3. every member that is not ``success`` is ``failure`` -- a ``cancelled``,
   ``timed_out`` or ``skipped`` member is not a declaration;
4. each failed member's first page of 50 annotations carries a title
   containing ``SETUP FAILED (not a verdict on this PR)``. A member without
   one is re-read at most ``REREADS`` (3) times, ``REREAD_DELAY_S`` (10 s)
   apart, before it counts as undeclared, and the first member still
   undeclared ends the read;
5. the harness-diff guard reads ``false``: this PR's diff touches none of
   ``HARNESS_PATHS_RE``. ``true`` and UNKNOWN withhold. It is read last, so a
   red that rules 1-4 already settle costs no fetch.

Outputs: one line. A declaration is an ``::error`` whose title is above. A read
error, a malformed input, an exhausted time budget and a guard that does not
read ``false`` withhold: a ``::notice title=Setup-death declaration
withheld::`` with no phrase. A decision not to declare (rules 1, 3 and 4) is
one plain log line.

The harness-diff guard (rule 5)
-------------------------------

This script runs from the PR's OWN merge commit (the ``Check out the
declarer`` checkout), so a PR that edits it, the ``shard_headroom.py`` it
imports or the aggregate's workflow file would otherwise get the phrase from
its edited code. The guard is the per-job declarer's ``compute_guard``
(``.github/scripts/declare-setup-death.sh``), ported, and fails closed the
same way. Each aggregate's ``HARNESS_PATHS_RE`` is its members' per-job
harness -- its workflow file (theirs too), the ``.github/actions/`` tree and
the per-job declarer -- plus this script and ``shard_headroom.py``. The per-job
declarer wrote the member titles this script trusts, and when a PR edits
that declarer, the members' guard runs inside the edit while this one does
not.

It reads ``true`` when ``git diff -z --no-renames --name-only <first parent>
<merge commit>`` lists a path matching ``HARNESS_PATHS_RE``, ``false`` when it
lists none, and UNKNOWN on any event other than ``pull_request``, on a
``GITHUB_SHA`` that is not a two-parent merge commit, on a first parent it
cannot fetch within the bound, on a failed diff and on an unusable pattern.

* The merge commit is ``GITHUB_SHA``. Its parents are read from the commit
  object's HEADER (a ``parent`` line in its message is not one), because a
  depth-1 checkout grafts them away.
* The first parent is fetched by sha, anonymously (qontinui-web is public),
  under ``timeout -k 5 60``; every other git call runs under
  ``timeout -k 5 30``, and each bound is lowered to what is left of
  ``DEADLINE_S``. A timeout reads UNKNOWN.
* The ``scripts/ci`` sparse checkout is a ``blob:none`` partial clone. Every
  git call therefore runs with ``GIT_NO_LAZY_FETCH=1``, so no object read
  turns into an unbounded fetch from the promisor remote (git 2.44 and later;
  an older git ignores it, and ``timeout`` still bounds the call), and with
  ``GIT_TERMINAL_PROMPT=0``.

Time bounds: every REST read is bounded to ``READ_TIMEOUT_S`` (20 s) and the
whole run, the guard's git calls included, to ``DEADLINE_S`` (120 s), under
the invoking step's 3-minute ``timeout-minutes``; running out reads UNKNOWN.
The clock is re-read before EVERY read, each page of the jobs listing
included (``fetch_jobs``'s ``deadline``), so a read never starts with a bound
longer than what is left. At most 1 jobs read (more pages only past 100 jobs)
plus 4 annotation reads per failed member.

No title written here contains ``TIMED OUT (not a verdict on this PR)``,
``OUT OF MEMORY (not a verdict on this PR)`` or ``killed IN THE BUILD``: those
change coord's marker class, and a setup death must map to ``no_verdict``.

It exits 0 on every path: a reporter never decides the aggregate's colour.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from shard_headroom import (  # noqa: E402
    API_ROOT,
    SHARD_NAME,
    MeasurementError,
    fetch_jobs,
    get_json,
)

#: What a member's own declaration title must contain (the per-job declarer's
#: `<check> SETUP FAILED (not a verdict on this PR)`).
MEMBER_DECLARATION = "SETUP FAILED (not a verdict on this PR)"
MARKER_CHANGING = (
    "TIMED OUT (not a verdict on this PR)",
    "OUT OF MEMORY (not a verdict on this PR)",
    "killed IN THE BUILD",
)
WITHHELD_TITLE = "Setup-death declaration withheld"
LOG_PREFIX = "aggregate-setup-death:"
USER_AGENT = "qontinui-web-aggregate-setup-death"

REREADS = 3
REREAD_DELAY_S = 10
READ_TIMEOUT_S = 20
DEADLINE_S = 120
#: Exactly the page coord's reader fetches (`?per_page=50`, no pagination): a
#: declaration past it is one coord would not see either.
ANNOTATIONS_PER_PAGE = 50
NOUN = re.compile(r"[a-z][a-z ]{0,30}")

#: Rule 5's bounds, the per-job declarer's: the first-parent fetch under
#: `timeout -k 5 60`, every other git call under `timeout -k 5 30`, and each
#: lowered to what is left of DEADLINE_S.
FETCH_BOUND_S = 60
GIT_BOUND_S = 30
KILL_AFTER_S = 5
SHA = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_FETCH_LEVER = re.compile(r"[0-9]{1,3}")


class UnknownError(Exception):
    """The decision could not be made; the title is withheld."""


@dataclass(frozen=True)
class Outcome:
    kind: str  # "declare" | "decline" | "withhold"
    title: str = ""
    text: str = ""


def _escape_data(text: str) -> str:
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _escape_property(text: str) -> str:
    return _escape_data(text).replace(":", "%3A").replace(",", "%2C")


def render(outcome: Outcome) -> str:
    """The one line this script prints."""
    if outcome.kind == "declare":
        return f"::error title={_escape_property(outcome.title)}::{_escape_data(outcome.text)}"
    if outcome.kind == "withhold":
        return f"::notice title={WITHHELD_TITLE}::{_escape_data(outcome.text)}"
    # A plain line can never be read as a workflow command: fixed prefix, one line.
    return f"{LOG_PREFIX} {' '.join(outcome.text.split())}"


def _positive_int(env: Mapping[str, str], key: str) -> int:
    raw = (env.get(key) or "").strip()
    if not raw.isdigit() or int(raw) < 1:
        raise UnknownError(f"{key}={raw!r} is not a positive integer")
    return int(raw)


def _need_results(env: Mapping[str, str], member_need: str) -> dict[str, str]:
    try:
        needs = json.loads(env.get("NEEDS_JSON") or "")
    except ValueError as exc:
        raise UnknownError(f"NEEDS_JSON is not JSON ({exc})") from exc
    if not isinstance(needs, dict) or not needs:
        raise UnknownError("NEEDS_JSON is not a non-empty object of needs")
    results: dict[str, str] = {}
    for key, value in needs.items():
        result = value.get("result") if isinstance(value, dict) else None
        if not isinstance(result, str) or not result:
            raise UnknownError(f"need {key!r} carries no result in NEEDS_JSON")
        results[str(key)] = result
    if member_need not in results:
        raise UnknownError(
            f"MEMBER_NEED {member_need!r} is not one of the needs {sorted(results)}"
        )
    return results


def _member_pattern(env: Mapping[str, str]) -> re.Pattern[str]:
    raw = env.get("MEMBER_NAME_RE") or ""
    if not raw:
        return SHARD_NAME
    try:
        return re.compile(raw)
    except re.error as exc:
        raise UnknownError(f"MEMBER_NAME_RE={raw!r} does not compile ({exc})") from exc


def _titles(payload: Any, url_hint: str) -> list[str]:
    if not isinstance(payload, list):
        raise MeasurementError(f"{url_hint} returned no annotation list")
    titles = []
    for item in payload:
        if not isinstance(item, dict):
            raise MeasurementError(f"{url_hint} returned a non-object annotation")
        title = item.get("title")
        titles.append(title if isinstance(title, str) else "")
    return titles


class _Clock:
    """The run's wall-clock budget: everything must finish by ``deadline``."""

    def __init__(self, monotonic: Callable[[], float]):
        self.monotonic = monotonic
        #: A ``monotonic()`` instant, handed to ``fetch_jobs`` so that every
        #: page of the jobs listing re-reads the clock (not one bound for all).
        self.deadline = monotonic() + DEADLINE_S

    def left(self) -> float:
        return self.deadline - self.monotonic()

    def read_timeout(self) -> float:
        left = self.left()
        if left < 1:
            raise UnknownError(
                f"the {DEADLINE_S} s time budget ran out before the read finished"
            )
        return min(READ_TIMEOUT_S, left)


@dataclass(frozen=True)
class Guard:
    """The harness-diff guard's reading: ``true``, ``false`` or ``UNKNOWN``."""

    value: str
    reason: str


class _Git:
    """``timeout -k 5 <bound> git -C <workspace> ...``, inside the run's clock."""

    def __init__(self, env: Mapping[str, str], workspace: str, clock: _Clock):
        # No credential prompt can hang a call, and no object read becomes a
        # lazy fetch from the sparse checkout's promisor remote.
        self._env = {**env, "GIT_TERMINAL_PROMPT": "0", "GIT_NO_LAZY_FETCH": "1"}
        self._workspace = workspace
        self._clock = clock

    def bound(self, nominal: int, what: str) -> int:
        """Whole seconds for one call: ``nominal``, or what is left if that is less."""
        left = self._clock.left()
        if left < 1:
            raise UnknownError(f"the {DEADLINE_S} s time budget ran out before {what}")
        return min(nominal, int(left))

    def run(
        self, args: list[str], *, bound: int, capture: bool = True
    ) -> subprocess.CompletedProcess[bytes]:
        argv = ["timeout", "-k", str(KILL_AFTER_S), str(bound), "git"]
        argv += ["-C", self._workspace, *args]
        try:
            return subprocess.run(
                argv,
                env=self._env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                # A backstop only: `timeout` has killed the call before this.
                timeout=bound + 2 * KILL_AFTER_S,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise UnknownError(
                f"git {args[0]} could not run under `timeout` ({exc})"
            ) from exc

    def has_commit(self, sha: str) -> bool:
        proc = self.run(
            ["cat-file", "-e", f"{sha}^{{commit}}"],
            bound=self.bound(GIT_BOUND_S, "checking for a commit"),
            capture=False,
        )
        return proc.returncode == 0


def _fetch_bound(env: Mapping[str, str]) -> int:
    """``DECLARE_FETCH_BOUND_SECS`` may only LOWER the 60 s bound (a test lever)."""
    raw = env.get("DECLARE_FETCH_BOUND_SECS") or ""
    if _FETCH_LEVER.fullmatch(raw) and 1 <= int(raw) <= FETCH_BOUND_S:
        return int(raw)
    return FETCH_BOUND_S


def _changed_paths(env: Mapping[str, str], clock: _Clock) -> list[str]:
    """Every path the pull_request merge commit changes against its first parent.

    Raises ``UnknownError`` on every arm the per-job ``compute_guard`` reads
    UNKNOWN once its event and pattern are usable.
    """
    workspace = env.get("GITHUB_WORKSPACE") or ""
    if not workspace or not Path(workspace).is_dir():
        raise UnknownError(
            f"GITHUB_WORKSPACE ('{workspace}') is not a directory, so the checkout "
            "cannot be read"
        )
    merge = env.get("GITHUB_SHA") or ""
    if not SHA.fullmatch(merge):
        raise UnknownError(f"GITHUB_SHA ('{merge}') is not a commit id")
    git = _Git(env, workspace, clock)
    shown = git.run(
        ["cat-file", "-p", merge],
        bound=git.bound(GIT_BOUND_S, "reading the merge commit"),
    )
    if shown.returncode != 0:
        raise UnknownError(f"the merge commit {merge} is not readable in this checkout")
    # Header lines only: a `parent ` line in the commit MESSAGE is not a parent.
    header = shown.stdout.split(b"\n\n", 1)[0].decode("utf-8", "replace")
    parents = [
        line.removeprefix("parent ")
        for line in header.splitlines()
        if line.startswith("parent ")
    ]
    if len(parents) != 2:
        raise UnknownError(
            f"{merge} has {len(parents)} parent(s), not the two of a pull_request "
            "merge commit"
        )
    first = parents[0]
    if not SHA.fullmatch(first):
        raise UnknownError(
            f"the merge commit's first parent ('{first}') is not a commit id"
        )
    if not git.has_commit(first):
        bound = git.bound(_fetch_bound(env), "fetching the merge commit's first parent")
        fetch = git.run(
            ["fetch", "--no-tags", "--depth=1", "origin", first],
            bound=bound,
            capture=False,
        )
        if not git.has_commit(first):
            raise UnknownError(
                f"the merge commit's first parent {first} could not be fetched (git "
                f"fetch exited {fetch.returncode}; 124 or 137 is the {bound}s bound)"
            )
    diff = git.run(
        ["diff", "-z", "--no-renames", "--name-only", first, merge],
        bound=git.bound(GIT_BOUND_S, "reading this PR's diff"),
    )
    if diff.returncode != 0:
        raise UnknownError(
            f"git diff {first} {merge} exited {diff.returncode}, so this PR's diff "
            "is unread"
        )
    names = diff.stdout.decode("utf-8", "surrogateescape").split("\0")
    return [name for name in names if name]


def harness_guard(env: Mapping[str, str], clock: _Clock) -> Guard:
    """Rule 5: does this PR's diff touch the aggregate's harness?

    The per-job declarer's ``compute_guard``, in its order; see the module
    docstring.
    """
    event = env.get("GITHUB_EVENT_NAME") or ""
    if event != "pull_request":
        return Guard(
            "UNKNOWN",
            f"the event is '{event or 'unset'}', not pull_request, so there is no "
            "PR diff to read",
        )
    pattern = env.get("HARNESS_PATHS_RE") or ""
    if not pattern:
        return Guard(
            "UNKNOWN",
            "HARNESS_PATHS_RE is empty, so there is no harness to compare the diff "
            "against",
        )
    try:
        harness = re.compile(pattern)
    except re.error:
        return Guard("UNKNOWN", "HARNESS_PATHS_RE is not a valid regular expression")
    try:
        changed = _changed_paths(env, clock)
    except UnknownError as exc:
        return Guard("UNKNOWN", str(exc))
    if not changed:
        return Guard("false", "this PR's diff against its base is empty")
    touched = [path for path in changed if harness.search(path)]
    if touched:
        return Guard(
            "true",
            f"this PR's diff touches this aggregate's harness ('{touched[0]}'), so "
            "its own edit can have caused, or declared, the setup deaths this title "
            "would excuse",
        )
    return Guard(
        "false",
        f"none of the {len(changed)} paths in this PR's diff is this aggregate's "
        "harness",
    )


@dataclass(frozen=True)
class _Inputs:
    """The aggregate's inputs, read and checked in the order a problem is reported."""

    job: str
    member_need: str
    noun: str
    results: dict[str, str]
    expected: int
    pattern: re.Pattern[str]
    attempt: int
    repo: str
    run_id: str
    token: str
    api_root: str


class _NoDeclarationError(Exception):
    """A decision NOT to declare (rules 1, 3 and 4): the red may be a verdict."""


class _WithheldError(Exception):
    """Rules 1-4 held, but the harness-diff guard read ``true`` or UNKNOWN."""


def _read_inputs(env: Mapping[str, str]) -> _Inputs:
    """Every input, or ``UnknownError`` naming the first one that is unusable."""
    job = (env.get("DECLARE_JOB") or "").strip()
    if not job:
        raise UnknownError(
            "DECLARE_JOB is empty, so there is no check name to declare against"
        )
    member_need = (env.get("MEMBER_NEED") or "").strip()
    if not member_need:
        raise UnknownError("MEMBER_NEED is empty, so no need names the members")
    noun = env.get("MEMBER_NOUN") or "shard"
    if not NOUN.fullmatch(noun):
        raise UnknownError(f"MEMBER_NOUN={noun!r} is not a lowercase word")
    # Keyword arguments evaluate left to right: this IS the reporting order.
    return _Inputs(
        job=job,
        member_need=member_need,
        noun=noun,
        results=_need_results(env, member_need),
        expected=_positive_int(env, "EXPECTED_MEMBERS"),
        pattern=_member_pattern(env),
        attempt=_positive_int(env, "GITHUB_RUN_ATTEMPT"),
        repo=env.get("GITHUB_REPOSITORY") or "",
        run_id=env.get("GITHUB_RUN_ID") or "",
        token=env.get("GITHUB_TOKEN") or "",
        api_root=env.get("GITHUB_API_URL") or API_ROOT,
    )


def _rule1_only_the_members_failed(inputs: _Inputs) -> None:
    """Rule 1: the member need concluded ``failure`` and no other need is red."""
    result = inputs.results[inputs.member_need]
    if result != "failure":
        raise _NoDeclarationError(
            f"no declaration: {inputs.member_need} concluded {result!r}, "
            "not 'failure', so this red is not a set of setup deaths."
        )
    others = {
        k: v
        for k, v in inputs.results.items()
        if k != inputs.member_need and v not in ("success", "skipped")
    }
    if others:
        named = ", ".join(f"{k}={v}" for k, v in sorted(others.items()))
        raise _NoDeclarationError(
            f"no declaration: another need is red ({named}), so this red is not only its members'."
        )


def _rule2_member_jobs(inputs: _Inputs, clock: _Clock) -> list[dict[str, Any]]:
    """Rule 2: this run attempt lists exactly the expected members, all completed."""
    jobs = fetch_jobs(
        inputs.repo,
        inputs.run_id,
        inputs.token,
        inputs.api_root,
        attempt=inputs.attempt,
        timeout=clock.read_timeout(),
        deadline=clock.deadline,
        monotonic=clock.monotonic,
    )
    members = [
        j
        for j in jobs
        if isinstance(j, dict) and inputs.pattern.fullmatch(str(j.get("name", "")))
    ]
    if len(members) != inputs.expected:
        raise UnknownError(
            f"run {inputs.run_id} attempt {inputs.attempt} lists {len(members)} job(s) named like "
            f"{inputs.pattern.pattern!r}, not the {inputs.expected} expected"
        )
    unfinished = [str(m.get("name")) for m in members if m.get("status") != "completed"]
    if unfinished:
        raise UnknownError(
            f"member(s) {', '.join(sorted(unfinished))} have not completed"
        )
    return members


def _rule3_failed_members(
    inputs: _Inputs, members: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Rule 3: every member that is not ``success`` is ``failure``; those, by name."""
    other_conclusions = {
        str(m.get("name")): m.get("conclusion")
        for m in members
        if m.get("conclusion") not in ("success", "failure")
    }
    if other_conclusions:
        named = ", ".join(f"{k}={v}" for k, v in sorted(other_conclusions.items()))
        raise _NoDeclarationError(
            f"no declaration: member(s) {named} did not conclude success or failure, which is not a setup death."
        )
    failed = sorted(
        (m for m in members if m.get("conclusion") == "failure"),
        key=lambda m: str(m.get("name")),
    )
    if not failed:
        raise UnknownError(
            f"{inputs.member_need} concluded 'failure' but no member job did"
        )
    return failed


def _rule4_every_failed_member_declared(
    inputs: _Inputs,
    failed: list[dict[str, Any]],
    clock: _Clock,
    sleep: Callable[[float], None],
) -> None:
    """Rule 4: each failed member's own annotations declare its setup death.

    The first member still undeclared after ``REREADS`` re-reads ends the read.
    """
    for member in failed:
        _await_member_declaration(inputs, member, clock, sleep)


def _await_member_declaration(
    inputs: _Inputs,
    member: dict[str, Any],
    clock: _Clock,
    sleep: Callable[[float], None],
) -> None:
    """One failed member's first annotation page, re-read while it lags."""
    name = str(member.get("name"))
    check_run = member.get("id")
    if not isinstance(check_run, int) or isinstance(check_run, bool) or check_run <= 0:
        raise UnknownError(
            f"member {name!r} carries no job id to read annotations from"
        )
    url = (
        f"{inputs.api_root}/repos/{inputs.repo}/check-runs/{check_run}"
        f"/annotations?per_page={ANNOTATIONS_PER_PAGE}"
    )
    reads = 0
    while True:
        payload = get_json(
            url, inputs.token, timeout=clock.read_timeout(), user_agent=USER_AGENT
        )
        reads += 1
        if any(MEMBER_DECLARATION in t for t in _titles(payload, url)):
            return
        if reads > REREADS:
            raise _NoDeclarationError(
                f"no declaration: member {name!r} carries no setup-death declaration "
                f"after {reads} reads, so its red may be a verdict."
            )
        if clock.left() < REREAD_DELAY_S + 1:
            raise UnknownError(
                f"the {DEADLINE_S} s time budget ran out re-reading {name!r}"
            )
        sleep(REREAD_DELAY_S)


def _rule5_harness_untouched(
    inputs: _Inputs, env: Mapping[str, str], clock: _Clock
) -> None:
    """Rule 5: the harness-diff guard reads ``false``; ``true`` and UNKNOWN withhold."""
    guard = harness_guard(env, clock)
    if guard.value != "false":
        raise _WithheldError(
            f"every failed {inputs.noun} declared a setup death, but the harness-diff "
            f"guard read {guard.value}: {guard.reason}. This red is left to read as a "
            "verdict on this change."
        )


def _declaration(inputs: _Inputs, failed: list[dict[str, Any]]) -> Outcome:
    """The aggregate's title, once every rule has held."""
    names = ", ".join(str(m.get("name")) for m in failed)
    title = f"{inputs.job} SETUP FAILED in every failed {inputs.noun} (not a verdict on this PR)"
    if any(marker in title for marker in MARKER_CHANGING):
        return Outcome(
            "withhold",
            text="DECLARE_JOB would put a marker-changing phrase into the title.",
        )
    return Outcome(
        "declare",
        title=title,
        text=(
            f"{names} each declared a setup death; no member reached a verdict on this PR. "
            "Re-run the failed members."
        ),
    )


def decide(
    env: Mapping[str, str],
    *,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> Outcome:
    """The aggregate's verdict: the rules in the module docstring, in order.

    Each rule is one helper that returns what the next one needs, or raises:
    ``_NoDeclarationError`` is a decision not to declare; ``_WithheldError``,
    ``UnknownError`` and ``MeasurementError`` withhold the title with a notice.
    Every GitHub read goes through ``shard_headroom``.
    """
    clock = _Clock(monotonic)
    try:
        inputs = _read_inputs(env)
        _rule1_only_the_members_failed(inputs)
        members = _rule2_member_jobs(inputs, clock)
        failed = _rule3_failed_members(inputs, members)
        _rule4_every_failed_member_declared(inputs, failed, clock, sleep)
        _rule5_harness_untouched(inputs, env, clock)
    except _NoDeclarationError as exc:
        return Outcome("decline", text=str(exc))
    except _WithheldError as exc:
        return Outcome("withhold", text=str(exc))
    except UnknownError as exc:
        return Outcome(
            "withhold", text=f"{exc}. Nothing was declared for this aggregate."
        )
    except MeasurementError as exc:
        return Outcome(
            "withhold",
            text=f"a GitHub read failed: {exc}. Nothing was declared for this aggregate.",
        )
    return _declaration(inputs, failed)


def main() -> int:
    try:
        line = render(decide(os.environ))
    except Exception as exc:  # noqa: BLE001 -- a reporter never decides the colour
        line = render(
            Outcome(
                "withhold",
                text=f"the aggregate declarer crashed ({exc!r}); nothing was declared.",
            )
        )
    print(line, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
