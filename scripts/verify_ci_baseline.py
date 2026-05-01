#!/usr/bin/env python3
"""Pre-merge CI-baseline gate: same-failures-as-main → ship.

Phase 6 Item 6 of the multi-machine coordinator plan
(``D:/qontinui-root/tmp_coord_phase6_agent_coordination_hardening.md``
§Item 6).

Coord watches `workflow_run` webhook events on `main` and snapshots the
*current shape* of green-on-main into ``coord.ci_baselines`` per
``(repo, workflow_name)`` — passing jobs, failing jobs, and a
fingerprint of each failure's first error log line. PRs compare their
own failures to the baseline:

* same job names → ship (the failure is pre-existing infrastructure
  noise, not the PR's regression).
* new job failure or different fingerprint → block (the PR introduced
  it).

This script is the Python-side comparator. It pulls the baseline from
coord and the current PR's failures from a JSON file the caller
provides (typically captured from ``gh run view --json jobs``).

## What this script does

1. GET ``/coord/ci-baseline/<repo>/<workflow_name>`` from coord.
   * 404 → no baseline recorded yet → exit 0 (don't block).
2. Load the current run's job statuses from ``--current-jobs <file>``.
3. For each job that's a failure in the current run, look for the same
   job name in the baseline:
   * Baseline says "success" → new failure, BLOCK.
   * Baseline says "failure" with same fingerprint → MATCH (ignore).
   * Baseline says "failure" with different fingerprint → NEW failure
     mode, BLOCK.
   * No fingerprint on either side → fall back to status-only match
     (avoids blocking when fingerprinting wasn't possible).
4. Exit 0 if every current-failure matched a baseline-failure. Exit 1
   otherwise. Print a per-job diff to stdout/stderr.

## Input format (--current-jobs)

JSON list of objects::

    [
      {"name": "test (ubuntu-22.04, python-3.13)", "status": "success"},
      {"name": "lint",     "status": "failure", "fingerprint": "a1b2c3d4e5f6"},
      {"name": "security", "status": "failure"}
    ]

`status` is one of ``success | failure | neutral | cancelled |
timed_out | skipped | action_required | stale``. Anything other than
``success | neutral | skipped`` is treated as a failure for the diff.
`fingerprint` is optional; when absent, the comparator does
status-only matching (lower precision but still useful).

The shape mirrors the items inside ``failure_pattern.jobs`` from the
coord baseline so callers can normalize once and feed both sides
identically. ``gh run view <id> --json jobs`` produces a slightly
different shape; transform it with::

    gh run view "$RUN" --json jobs --jq '
      .jobs | map({name: .name, status: .conclusion})
    ' > current.json

## Usage

In CI for a PR's workflow run::

    gh run view "$GITHUB_RUN_ID" --json jobs \\
      --jq '.jobs | map({name: .name, status: .conclusion})' \\
      > current.json

    python scripts/verify_ci_baseline.py \\
        --repo qontinui/qontinui-web \\
        --workflow-name CI \\
        --current-jobs current.json \\
        --coord-url "${{ secrets.COORD_URL }}"

Exit codes::

    0  no baseline / current matches baseline → ship
    1  at least one new failure not in baseline → BLOCK
    2  coord unreachable / malformed input / config error
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PASSING_STATUSES = frozenset({"success", "neutral", "skipped"})


def is_failure(status: str | None) -> bool:
    """Return True if the status counts as a CI failure for diff purposes."""
    if status is None:
        return True  # NULL conclusion on a completed row = failure
    return status not in PASSING_STATUSES


def normalize_jobs(items: list[dict]) -> dict[str, dict]:
    """Index a job list by name → first-occurrence dict.

    Matrix builds emit the same job name multiple times with different
    matrix legs; the baseline stores them as separate array entries (an
    ``id`` disambiguates). For diff purposes we keep the *first*
    occurrence per name and record a flag so the caller can warn when
    multiple legs collapse — a status-only diff over matrix legs is
    imprecise, but it's the best we can do without coord-side row IDs.
    """
    out: dict[str, dict] = {}
    for item in items:
        name = item.get("name")
        if not isinstance(name, str):
            continue
        if name not in out:
            out[name] = item
    return out


def fetch_baseline(coord_url: str, repo: str, workflow_name: str) -> dict | None:
    """GET the coord baseline. Returns the response dict, or None on 404."""
    encoded_repo = urllib.parse.quote(repo, safe="")
    encoded_workflow = urllib.parse.quote(workflow_name, safe="")
    url = (
        f"{coord_url.rstrip('/')}/coord/ci-baseline/"
        f"{encoded_repo}/{encoded_workflow}"
    )
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise RuntimeError(
            f"coord returned HTTP {e.code} for {url}: "
            f"{e.read().decode('utf-8', 'replace')}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"coord unreachable at {url}: {e.reason}") from e
    except (TimeoutError, json.JSONDecodeError) as e:
        raise RuntimeError(f"coord call to {url} failed: {e}") from e


def diff_against_baseline(
    current_jobs: list[dict],
    baseline_jobs: list[dict],
) -> list[str]:
    """Return human-readable lines describing each *new* failure.

    Empty list means the current run's failures are all explainable by
    the baseline (or the current run had no failures at all). A
    non-empty list means the PR introduced something new and the gate
    must block.
    """
    baseline_by_name = normalize_jobs(baseline_jobs)
    new_failures: list[str] = []
    for job in current_jobs:
        name = job.get("name")
        if not isinstance(name, str):
            continue
        status = job.get("status")
        if not is_failure(status):
            continue
        baseline = baseline_by_name.get(name)
        if baseline is None:
            new_failures.append(
                f"job {name!r}: status={status!r} but no baseline entry "
                f"(this job didn't exist on green main, or it passed there)"
            )
            continue
        baseline_status = baseline.get("status")
        if not is_failure(baseline_status):
            new_failures.append(
                f"job {name!r}: status={status!r} but baseline expected "
                f"{baseline_status!r} on green main"
            )
            continue
        # Both sides are failures. Compare fingerprints when both have
        # them. If either side lacks a fingerprint, fall back to
        # status-only match — better than blocking spuriously.
        cur_fp = job.get("fingerprint")
        base_fp = baseline.get("fingerprint")
        if cur_fp and base_fp and cur_fp != base_fp:
            new_failures.append(
                f"job {name!r}: failed with fingerprint {cur_fp!r} but "
                f"baseline failure has different fingerprint {base_fp!r} "
                f"— different error mode"
            )
    return new_failures


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Compare a PR's CI failures against the green-on-main baseline",
    )
    parser.add_argument("--repo", required=True, help="Owner/name (e.g. qontinui/qontinui-web)")
    parser.add_argument("--workflow-name", required=True, help="Workflow display name")
    parser.add_argument(
        "--current-jobs",
        required=True,
        help="Path to a JSON file with the current run's jobs list",
    )
    parser.add_argument(
        "--coord-url",
        default=os.environ.get("COORD_URL", "http://localhost:9870"),
    )
    args = parser.parse_args(argv)

    try:
        current_text = Path(args.current_jobs).read_text(encoding="utf-8")
        current_jobs = json.loads(current_text)
    except (OSError, json.JSONDecodeError) as e:
        print(
            f"verify_ci_baseline: cannot read --current-jobs "
            f"{args.current_jobs!r}: {e}",
            file=sys.stderr,
        )
        return 2
    if not isinstance(current_jobs, list):
        print(
            f"verify_ci_baseline: --current-jobs must contain a JSON array, "
            f"got {type(current_jobs).__name__}",
            file=sys.stderr,
        )
        return 2

    try:
        baseline = fetch_baseline(args.coord_url, args.repo, args.workflow_name)
    except RuntimeError as e:
        print(f"verify_ci_baseline: {e}", file=sys.stderr)
        return 2

    if baseline is None:
        # No baseline yet — coord hasn't seen a green main run for this
        # workflow. Don't block. Print a note so CI logs are clear.
        print(
            f"verify_ci_baseline: no baseline recorded for "
            f"{args.repo}/{args.workflow_name} — skipping diff",
        )
        return 0

    baseline_jobs = baseline.get("failure_pattern", {}).get("jobs") or []
    if not isinstance(baseline_jobs, list):
        print(
            f"verify_ci_baseline: baseline.failure_pattern.jobs is not a list: "
            f"{type(baseline_jobs).__name__}",
            file=sys.stderr,
        )
        return 2

    new_failures = diff_against_baseline(current_jobs, baseline_jobs)
    if not new_failures:
        # Either the run had no failures, or every failure matched the
        # baseline. Either way, ship.
        current_failure_count = sum(
            1 for j in current_jobs if is_failure(j.get("status"))
        )
        if current_failure_count == 0:
            print(
                f"verify_ci_baseline: {args.repo}/{args.workflow_name} — "
                f"current run has no failures, ship"
            )
        else:
            print(
                f"verify_ci_baseline: {args.repo}/{args.workflow_name} — "
                f"all {current_failure_count} current failure(s) match the "
                f"baseline, ship"
            )
        return 0

    print(
        f"verify_ci_baseline: {args.repo}/{args.workflow_name} — "
        f"{len(new_failures)} new failure(s) not in baseline:",
        file=sys.stderr,
    )
    for line in new_failures:
        print(f"  - {line}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
