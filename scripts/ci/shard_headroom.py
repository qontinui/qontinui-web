#!/usr/bin/env python3
"""Fail when a backend ``Run Tests`` shard nears its job budget, or the shards skew.

``backend-ci.yml`` runs the backend suite as a six-way matrix of
``Run Tests (shard N/6)`` jobs, each bounded by the ``test`` job's
``timeout-minutes``. This script reads THIS run's shard jobs back from the
GitHub API, measures each shard's wall time (``completed_at - started_at``),
and prints exactly one machine-readable line::

    shard-headroom: max_min=29.9 min_min=9.6 budget_min=45 pct=66.4 skew=3.11 verdict=skewed

ONE lane invokes it:

* ``.github/workflows/backend-ci.yml``, job ``shard-headroom``, step
  "Measure Run Tests shard headroom" — nightly (``schedule``) and on
  ``workflow_dispatch`` only, never on a PR.

Verdicts, in precedence order
-----------------------------

``unknown``
    The measurement could not be made: the API read failed, a shard has no
    measurable row, a timestamp is missing or unparseable, or the budget is not
    a positive number. **Exits non-zero.** An alarm that cannot see its subject
    must never read as a pass — that is how a silent-empty read becomes a
    standing "all clear".
``over_margin``
    The slowest shard exceeded ``MARGIN_PCT`` (70%) of the budget — the
    dossier's own margin. Exits non-zero.
``skewed``
    slowest / fastest > ``MAX_SKEW`` (2.0): the deal is unbalanced, which on a
    duration-balanced split means the durations file has gone stale. Exits
    non-zero. The reason names the remedy: commit this same run's
    ``shard-durations-proposed`` artifact (job ``Propose shard durations``) as
    ``backend/tests/shard-durations.json``.

An ``over_margin`` whose shards are NOT skewed says so in its reason: a
balanced deal near the budget means the suite has outgrown six shards, and the
lever is the matrix length (with ``--shards``, pinned equal to it), never the
budget.
``ok``
    Exits 0.

Which rows count
----------------

The read uses ``filter=latest``, which returns ONE row per job, for the run's
latest attempt only; a re-run attempt replaces rather than adds rows. Two rows
naming the same shard therefore cannot happen on a well-formed read, and are
refused as ``unknown`` rather than resolved by guessing which one is real.

A shard row is MEASURED only when a runner actually executed it: a non-zero
``runner_id``, a non-empty ``steps`` list, a ``started_at`` and a
``completed_at`` strictly after it. A job cancelled while still QUEUED does NOT
get a null ``started_at`` -- GitHub stamps ``started_at = created_at`` and a
``completed_at`` at the cancel, a POSITIVE gap of pure queue time (run
36515758971: all six shards ``conclusion=cancelled``, ``runner_id=0``,
``steps=[]``, 03:07:41 -> 03:11:17). Timing such a row would report queue time
as test time, so it is unmeasured -- and a shard with no measured row makes the
verdict ``unknown``: the shard is missing, not fast.

A measured row counts only with ``conclusion`` ``success``, or ``cancelled``
after running at least ``JOB_TIMEOUT_MINUTES - 2`` minutes -- a budget timeout
concludes ``cancelled`` (run 36548570438 shard 6 ran 09:20:52 -> 10:06:11 and
must read ``over_margin``). That floor is always the REAL job budget, never the
override, so a dispatch with a low override still recognises a real timeout. A
shorter ``cancelled`` is a manual or external cancel mid-shard: ``unknown``,
naming the shard and its duration. A shard cancelled at its timeout measures
slightly OVER the budget, so a ``pct`` just above 100 is expected, not a bug.
Its time is only a LOWER BOUND, so a counted timeout forces ``over_margin``
whatever the budget -- and ``HEADROOM_BUDGET_OVERRIDE`` may only LOWER the
budget (it exists to push the alarm red); an override above
``JOB_TIMEOUT_MINUTES`` is ``unknown``, as is ``JOB_TIMEOUT_MINUTES <= 2``
(the timeout floor would be meaningless). Any other conclusion (``failure``,
``skipped``, ...) means the shard's time does not describe a full pass over its
files, so the verdict is ``unknown``, naming the shard and conclusion.

Budget
------

``JOB_TIMEOUT_MINUTES`` (the ``test`` job's ``timeout-minutes``, hand-copied
into the ``shard-headroom`` job's env and pinned equal by
``backend/tests/test_shard_headroom.py``). ``HEADROOM_BUDGET_OVERRIDE``, when
non-empty, replaces it for this computation only — a test lever: set below the
measured slowest shard it must turn the job red with ``verdict=over_margin``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from fractions import Fraction
from typing import Any

# Every verdict compare is done in exact rational arithmetic: shard durations
# are `Fraction` seconds and budgets are `Fraction` minutes, parsed from their
# decimal text. No binary float ever reaches a boundary: both float forms --
# a `budget * 0.70` threshold and `max_min * 100 > budget_min * 70` over float
# minutes -- misfire at exactly 70% for some ordinary integer budgets (7 min
# with a 4.9-min shard reads over the margin under the latter; how many budgets
# misfire depends on how the float expression is spelled, which is the point).
# `pct` and `skew` on `Result` are floats for DISPLAY only.
MARGIN_PCT = 70
MAX_SKEW = 2
# A `cancelled` row counts only when it ran at least this close to the REAL job
# budget -- the same 2-minute slack backend-ci.yml's timeout marker uses
# (`budget_floor = JOB_TIMEOUT_MINUTES - 2`). Anything shorter was cancelled by
# someone, not by the budget, and describes no full pass over the shard.
TIMEOUT_SLACK_MIN = 2
# A counted timeout-cancel is a LOWER BOUND on the shard's time, not a
# measurement: the shard would have run longer. A shard that hit its REAL budget
# is over the margin by definition, so it forces `over_margin` whatever the
# (possibly overridden) budget says.
DEFAULT_EXPECTED_SHARDS = 6
API_ROOT = "https://api.github.com"
PER_PAGE = 100
MAX_PAGES = 10

#: The committed durations map the shard deal reads, and the nightly artifact
#: that proposes its replacement -- named in a `skewed` reason as the remedy.
DURATIONS_REF = "backend/tests/shard-durations.json"
PROPOSAL_ARTIFACT = "shard-durations-proposed"

SHARD_NAME = re.compile(r"^Run Tests \(shard (\d+)/(\d+)\)$")

VERDICTS = ("ok", "over_margin", "skewed", "unknown")


class MeasurementError(Exception):
    """The measurement could not be made; the verdict is ``unknown``."""


@dataclass(frozen=True)
class Result:
    verdict: str
    reason: str
    budget_min: float | None = None
    max_min: float | None = None
    min_min: float | None = None
    slowest_shard: int | None = None

    @property
    def pct(self) -> float | None:
        if self.max_min is None or not self.budget_min:
            return None
        return self.max_min / self.budget_min * 100.0

    @property
    def skew(self) -> float | None:
        if self.max_min is None or not self.min_min:
            return None
        return self.max_min / self.min_min

    @property
    def exit_code(self) -> int:
        return {"ok": 0, "over_margin": 1, "skewed": 1}.get(self.verdict, 2)


def _fmt(value: float | None, digits: int) -> str:
    if value is None:
        return "na"
    text = f"{value:.{digits}f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def format_line(result: Result) -> str:
    """The one machine-readable line. ``na`` stands for a value not measured."""
    return (
        f"shard-headroom: max_min={_fmt(result.max_min, 1)} "
        f"min_min={_fmt(result.min_min, 1)} "
        f"budget_min={_fmt(result.budget_min, 2)} "
        f"pct={_fmt(result.pct, 1)} skew={_fmt(result.skew, 2)} "
        f"verdict={result.verdict}"
    )


def parse_minutes(raw: str | None, source: str) -> Fraction:
    """A positive, finite number of minutes, parsed EXACTLY from its decimal text."""
    text = (raw or "").strip()
    if not text:
        raise MeasurementError(f"{source} is empty; no budget to measure against")
    try:
        value = Fraction(text)
    except (ValueError, ZeroDivisionError) as exc:
        raise MeasurementError(f"{source}={text!r} is not a finite number") from exc
    if value <= 0:
        raise MeasurementError(f"{source}={text!r} is not a positive number")
    return value


def parse_budget(base: str | None, override: str | None) -> Fraction:
    """The effective budget in minutes. A non-empty override wins."""
    if override and override.strip():
        return parse_minutes(override, "HEADROOM_BUDGET_OVERRIDE")
    return parse_minutes(base, "JOB_TIMEOUT_MINUTES")


def _seconds(delta: timedelta) -> Fraction:
    return Fraction(delta.days * 86400 + delta.seconds) + Fraction(delta.microseconds, 1_000_000)


def _minutes(seconds: Fraction) -> float:
    """Display only."""
    return float(seconds / 60)


def _parse_ts(value: Any, job_name: str, field: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise MeasurementError(f"{job_name!r}: {field}={value!r} is not a timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise MeasurementError(f"{job_name!r}: {field}={value!r} is unparseable") from exc
    if parsed.tzinfo is None:
        raise MeasurementError(f"{job_name!r}: {field}={value!r} carries no timezone")
    return parsed


def _is_measured(job: dict[str, Any], started: datetime | None, completed: datetime | None) -> bool:
    """Did a runner actually execute this row? See the module docstring."""
    runner_id = job.get("runner_id")
    steps = job.get("steps")
    if not isinstance(runner_id, int) or isinstance(runner_id, bool) or runner_id <= 0:
        return False
    if not isinstance(steps, list) or not steps:
        return False
    if started is None or completed is None:
        return False
    return completed > started


def shard_durations(
    jobs: list[dict[str, Any]],
    expected_shards: int,
    job_timeout_min: Fraction,
) -> tuple[dict[int, Fraction], set[int]]:
    """Exact seconds per shard number, and the shards that hit their timeout.

    The second element names the shards counted from a timeout-cancel: their
    seconds are a lower bound, not a measurement.

    Raises ``MeasurementError`` for anything that makes the measurement
    untrustworthy: a malformed timestamp, a duplicate shard row, a measured
    shard whose conclusion is neither ``success`` nor a ``cancelled`` at the
    timeout floor (``job_timeout_min - TIMEOUT_SLACK_MIN``), or a shard with no
    measured row (never picked up by a runner, or absent).
    """
    timeout_floor_s = (job_timeout_min - TIMEOUT_SLACK_MIN) * 60
    if expected_shards < 1:
        raise MeasurementError(f"expected_shards={expected_shards} is not a shard count")
    if job_timeout_min <= TIMEOUT_SLACK_MIN:
        raise MeasurementError(
            f"JOB_TIMEOUT_MINUTES={float(job_timeout_min):g} is not above the "
            f"{TIMEOUT_SLACK_MIN}-min timeout slack; the timeout floor would be meaningless"
        )
    measured: dict[int, Fraction] = {}
    timed_out: set[int] = set()
    seen: dict[int, str] = {}
    unmeasured: dict[int, str] = {}
    for index, job in enumerate(jobs):
        if not isinstance(job, dict):
            raise MeasurementError(f"job entry {index} is {type(job).__name__}, not an object")
        name = job.get("name")
        if not isinstance(name, str):
            continue
        match = SHARD_NAME.match(name)
        if not match:
            continue
        shard, total = int(match.group(1)), int(match.group(2))
        if total != expected_shards:
            raise MeasurementError(
                f"{name!r} names {total} shards but {expected_shards} are expected; "
                "the matrix and this alarm disagree"
            )
        if not 1 <= shard <= expected_shards:
            raise MeasurementError(f"{name!r} is outside 1..{expected_shards}")
        if shard in seen:
            raise MeasurementError(
                f"two rows name shard {shard}; filter=latest yields one row per job, "
                "so this read is malformed"
            )
        seen[shard] = name
        started = _parse_ts(job.get("started_at"), name, "started_at")
        completed = _parse_ts(job.get("completed_at"), name, "completed_at")
        conclusion = job.get("conclusion")
        if started is not None and completed is None:
            raise MeasurementError(
                f"{name!r} started but has no completed_at (status={job.get('status')!r})"
            )
        if not _is_measured(job, started, completed):
            unmeasured[shard] = (
                f"shard {shard} was never executed by a runner "
                f"(conclusion={conclusion!r}, runner_id={job.get('runner_id')!r}, "
                f"steps={len(job.get('steps') or [])})"
            )
            continue
        if conclusion not in ("success", "cancelled"):
            raise MeasurementError(
                f"shard {shard} concluded {conclusion!r}; only 'success' or a runner-side "
                "'cancelled' (a budget timeout) is a measurable pass"
            )
        assert started is not None and completed is not None
        seconds = _seconds(completed - started)
        if conclusion == "cancelled" and seconds < timeout_floor_s:
            raise MeasurementError(
                f"shard {shard} was cancelled after {_minutes(seconds):.1f} min, short of "
                f"the {float(job_timeout_min - TIMEOUT_SLACK_MIN):g}-min timeout floor "
                f"(JOB_TIMEOUT_MINUTES {float(job_timeout_min):g} - {TIMEOUT_SLACK_MIN}): "
                "an external or manual cancel, not a budget timeout, so its time "
                "describes no full pass"
            )
        if conclusion == "cancelled":
            timed_out.add(shard)
        measured[shard] = seconds

    missing = sorted(set(range(1, expected_shards + 1)) - set(measured))
    if missing:
        details = [unmeasured.get(s, f"shard {s} has no row") for s in missing]
        raise MeasurementError(
            f"measured {len(measured)} of {expected_shards} shards; " + "; ".join(details)
        )
    return measured, timed_out


def evaluate(
    jobs: list[dict[str, Any]],
    budget_min: Fraction | int,
    expected_shards: int = DEFAULT_EXPECTED_SHARDS,
    *,
    job_timeout_min: Fraction | int | None = None,
) -> Result:
    """Pure verdict over a list of GitHub job dicts.

    ``budget_min`` is what the margin is measured against (the override when
    one is set). ``job_timeout_min`` is the REAL job budget, used only for the
    cancelled-at-timeout floor; it defaults to ``budget_min``.
    """
    budget = Fraction(budget_min)
    job_timeout = Fraction(job_timeout_min) if job_timeout_min is not None else budget
    try:
        if budget > job_timeout:
            raise MeasurementError(
                f"budget {float(budget):g} min exceeds JOB_TIMEOUT_MINUTES "
                f"{float(job_timeout):g}; HEADROOM_BUDGET_OVERRIDE may only lower the "
                "budget (it exists to push the alarm red)"
            )
        durations, timed_out = shard_durations(jobs, expected_shards, job_timeout)
    except MeasurementError as exc:
        return Result("unknown", str(exc), budget_min=float(budget))

    slowest_shard = max(durations, key=lambda s: durations[s])
    max_s = durations[slowest_shard]
    min_s = min(durations.values())
    result = Result(
        "ok", "", float(budget), _minutes(max_s), _minutes(min_s), slowest_shard
    )
    pct, skew = result.pct, result.skew
    assert pct is not None and skew is not None

    # Exact rational compares; pct and skew are for display only.
    if timed_out:
        shards = ", ".join(map(str, sorted(timed_out)))
        verdict, reason = (
            "over_margin",
            f"shard(s) {shards} hit the real {float(job_timeout):g}-minute job budget "
            "and were cancelled; that time is a lower bound, so the margin is exceeded "
            "by definition",
        )
    elif max_s * 100 > budget * 60 * MARGIN_PCT:
        reason = (
            f"shard {slowest_shard} took {_minutes(max_s):.1f} min, {pct:.1f}% of the "
            f"{float(budget):g}-minute budget (margin {MARGIN_PCT}%)"
        )
        if max_s <= min_s * MAX_SKEW:
            reason += (
                f"; the shards are balanced (skew {skew:.2f}x), so the suite has "
                "outgrown the matrix -- raise the `test` job's matrix length and "
                "--shards together, not the budget"
            )
        verdict = "over_margin"
    elif max_s > min_s * MAX_SKEW:
        verdict, reason = (
            "skewed",
            f"slowest/fastest shard = {_minutes(max_s):.1f}/{_minutes(min_s):.1f} min = "
            f"{skew:.2f}x (limit {MAX_SKEW}x); the shard deal is unbalanced -- "
            f"refresh {DURATIONS_REF} from this run's `{PROPOSAL_ARTIFACT}` artifact",
        )
    else:
        verdict, reason = (
            "ok",
            f"slowest shard {slowest_shard} at {pct:.1f}% of budget, skew {skew:.2f}x",
        )
    return Result(
        verdict, reason, float(budget), _minutes(max_s), _minutes(min_s), slowest_shard
    )


def fetch_jobs(repo: str, run_id: str, token: str, api_root: str = API_ROOT) -> list[dict[str, Any]]:
    """Every latest-attempt job row of one run. Raises ``MeasurementError`` on any failure."""
    if not repo or not run_id or not token:
        raise MeasurementError("GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_TOKEN are all required")
    jobs: list[dict[str, Any]] = []
    for page in range(1, MAX_PAGES + 1):
        url = (
            f"{api_root}/repos/{repo}/actions/runs/{run_id}/jobs"
            f"?filter=latest&per_page={PER_PAGE}&page={page}"
        )
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {token}",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "qontinui-web-shard-headroom",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 -- fixed https host
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise MeasurementError(f"GET {url} failed: {exc}") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
            raise MeasurementError(f"GET {url} returned no 'jobs' list")
        page_jobs = payload["jobs"]
        jobs.extend(page_jobs)
        total = payload.get("total_count")
        if not page_jobs or (isinstance(total, int) and len(jobs) >= total):
            return jobs
    raise MeasurementError(f"more than {MAX_PAGES * PER_PAGE} job rows; refusing to guess")


def run(args: argparse.Namespace, env: dict[str, str]) -> Result:
    try:
        # The real budget is parsed even when an override is set: the
        # cancelled-at-timeout floor is always measured against it.
        job_timeout = parse_minutes(env.get("JOB_TIMEOUT_MINUTES"), "JOB_TIMEOUT_MINUTES")
        budget = parse_budget(env.get("JOB_TIMEOUT_MINUTES"), env.get("HEADROOM_BUDGET_OVERRIDE"))
    except MeasurementError as exc:
        return Result("unknown", str(exc))
    try:
        if args.jobs_json:
            with open(args.jobs_json, encoding="utf-8") as handle:
                payload = json.load(handle)
            jobs = payload.get("jobs") if isinstance(payload, dict) else payload
            if not isinstance(jobs, list):
                raise MeasurementError(f"{args.jobs_json} holds no job list")
        else:
            jobs = fetch_jobs(
                env.get("GITHUB_REPOSITORY", ""),
                env.get("GITHUB_RUN_ID", ""),
                env.get("GITHUB_TOKEN", ""),
                env.get("GITHUB_API_URL") or API_ROOT,
            )
    except (MeasurementError, OSError, ValueError) as exc:
        return Result("unknown", str(exc), budget_min=float(budget))
    return evaluate(jobs, budget, args.expected_shards, job_timeout_min=job_timeout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--expected-shards",
        type=int,
        default=DEFAULT_EXPECTED_SHARDS,
        help="matrix length of the test job (default %(default)s)",
    )
    parser.add_argument(
        "--jobs-json",
        help="read job rows from this file (the API's response body, or a bare list) instead of the API",
    )
    args = parser.parse_args(argv)
    result = run(args, dict(os.environ))
    print(result.reason, file=sys.stderr)
    print(format_line(result), flush=True)
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
