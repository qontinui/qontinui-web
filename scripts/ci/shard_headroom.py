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
    non-zero.
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
with a runner assigned -- a budget timeout concludes ``cancelled`` (run
36548570438 shard 6 ran 09:20:52 -> 10:06:11 and must read ``over_margin``). A
shard cancelled at its timeout measures slightly OVER the budget, so a ``pct``
just above 100 is expected, not a bug. Any other conclusion (``failure``,
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
from datetime import datetime
from typing import Any

# The margin as an integer percentage, so the compare below is exact:
# `45 * 0.70` is 31.499999999999996 in binary floating point, which would turn a
# shard of exactly 31.5 min over the margin. `max_min * 100 > budget_min * 70`
# has no such rounding at the boundary.
MARGIN_PCT = 70
MAX_SKEW = 2.0
DEFAULT_EXPECTED_SHARDS = 6
API_ROOT = "https://api.github.com"
PER_PAGE = 100
MAX_PAGES = 10

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


def parse_budget(base: str | None, override: str | None) -> float:
    """The effective budget in minutes. A non-empty override wins."""
    raw = override.strip() if override and override.strip() else (base or "").strip()
    source = "HEADROOM_BUDGET_OVERRIDE" if override and override.strip() else "JOB_TIMEOUT_MINUTES"
    if not raw:
        raise MeasurementError(f"{source} is empty; no budget to measure against")
    try:
        value = float(raw)
    except ValueError as exc:
        raise MeasurementError(f"{source}={raw!r} is not a number") from exc
    if not value > 0 or value != value or value == float("inf"):
        raise MeasurementError(f"{source}={raw!r} is not a positive finite number")
    return value


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


def shard_durations(jobs: list[dict[str, Any]], expected_shards: int) -> dict[int, float]:
    """Minutes per shard number, from the run's job rows.

    Raises ``MeasurementError`` for anything that makes the measurement
    untrustworthy: a malformed timestamp, a duplicate shard row, a measured
    shard whose conclusion is neither ``success`` nor ``cancelled``, or a shard
    with no measured row (never picked up by a runner, or absent).
    """
    measured: dict[int, float] = {}
    seen: dict[int, str] = {}
    unmeasured: dict[int, str] = {}
    for job in jobs:
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
        measured[shard] = (completed - started).total_seconds() / 60.0

    missing = sorted(set(range(1, expected_shards + 1)) - set(measured))
    if missing:
        details = [unmeasured.get(s, f"shard {s} has no row") for s in missing]
        raise MeasurementError(
            f"measured {len(measured)} of {expected_shards} shards; " + "; ".join(details)
        )
    return measured


def evaluate(
    jobs: list[dict[str, Any]],
    budget_min: float,
    expected_shards: int = DEFAULT_EXPECTED_SHARDS,
) -> Result:
    """Pure verdict over a list of GitHub job dicts."""
    try:
        durations = shard_durations(jobs, expected_shards)
    except MeasurementError as exc:
        return Result("unknown", str(exc), budget_min=budget_min)

    slowest_shard = max(durations, key=lambda s: durations[s])
    max_min = durations[slowest_shard]
    min_min = min(durations.values())
    base = Result("ok", "", budget_min, max_min, min_min, slowest_shard)
    pct, skew = base.pct, base.skew
    assert pct is not None and skew is not None

    # Exact compare on minutes; pct and skew are for display only.
    if max_min * 100 > budget_min * MARGIN_PCT:
        verdict, reason = (
            "over_margin",
            f"shard {slowest_shard} took {max_min:.1f} min, {pct:.1f}% of the "
            f"{budget_min:g}-minute budget (margin {MARGIN_PCT:g}%)",
        )
    elif max_min > min_min * MAX_SKEW:
        verdict, reason = (
            "skewed",
            f"slowest/fastest shard = {max_min:.1f}/{min_min:.1f} min = {skew:.2f}x "
            f"(limit {MAX_SKEW:g}x); the shard deal is unbalanced",
        )
    else:
        verdict, reason = (
            "ok",
            f"slowest shard {slowest_shard} at {pct:.1f}% of budget, skew {skew:.2f}x",
        )
    return Result(verdict, reason, budget_min, max_min, min_min, slowest_shard)


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
        return Result("unknown", str(exc), budget_min=budget)
    return evaluate(jobs, budget, args.expected_shards)


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
