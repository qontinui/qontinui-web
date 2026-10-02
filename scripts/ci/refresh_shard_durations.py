#!/usr/bin/env python3
"""Build ``backend/tests/shard-durations.json`` from measured test timings.

``split_pytest_shards.py`` deals the backend suite into shards by MEASURED
SECONDS per test file, read from ``backend/tests/shard-durations.json``. This
script is the one producer of that file's content. It reads either

* the ``junit-results.xml`` files every ``Run Tests`` shard writes (the default
  mode; each shard uploads its own as ``junit-results-shard-N``), or
* ``--from-logs``: GitHub Actions job logs of those same shards, which is how
  the first seed was built before the junit artifacts existed.

and writes ``{"tests/<file>.py": <seconds>}`` with sorted keys and seconds
rounded to 0.1, so two refreshes over near-identical timings produce a small,
reviewable diff rather than churn in every line.

ONE lane invokes it:

* ``.github/workflows/backend-ci.yml``, job ``shard-durations-proposal`` — on
  the nightly ``schedule`` run only, it downloads the six
  ``junit-results-shard-*`` artifacts, runs this script, and uploads the result
  as ``shard-durations-proposed.json``. A refresh is then a download and a
  reviewed commit; nothing writes the committed file automatically.

How a proposal is compared with the committed map (``--compare``)
-----------------------------------------------------------------

``--compare backend/tests/shard-durations.json`` prints, after the proposal is
written, how far the committed map has drifted from it, ending with ONE
machine-readable line::

    shard-durations-compare: committed=307 proposed=312 new=6 dropped=1 committed_s=5650.3 proposed_s=5841.0 moved=14

``new`` is files the proposal measured that the committed map does not list
(each is dealt by class median today); ``dropped`` is committed keys the
proposal has no timing for (a deleted or renamed test file, or a shard missing
from a partial proposal); ``moved`` is files listed in both whose seconds
differ by more than ``MOVED_FACTOR``x either way. Both totals are over
the rendered (0.1 s) values. It is a REPORT: a committed map that cannot be
read prints ``committed=unreadable`` and the run still succeeds, because the
proposal is the product and the comparison only says whether committing it is
worth a PR.

How a log is turned into seconds (``--from-logs``)
--------------------------------------------------

Every Actions log line carries an ISO-8601 timestamp, and the gating pytest run
is verbose (``-v``), so each finished test prints one line
``tests/<file>.py::<test> PASSED``. The gap between two consecutive result lines
is attributed to the test that ENDED it: that is the wall time pytest spent
setting it up, running it and tearing it down. The FIRST result line of a run
has no earlier result line to measure from, so its test gets nothing: that is a
necessity of parsing a log, not a policy -- the only earlier anchor, pytest's
``collected N items`` line, is followed by session start-up that is not that
test's own time. (The junit path below deliberately does NOT mirror this drop.)
The ``collected`` line also delimits runs, so a log holding two pytest runs
never bridges a gap across them.

A result line is a line whose content starts with ``tests/<path>.py::`` and
contains a whitespace-preceded status word (``PASSED``, ``FAILED``,
``SKIPPED``, ``ERROR``, ``XFAIL``, ``XPASS``). The status need not END the line:
captured output can be glued to it (``SKIPPEDgres; skipping ...`` is on main),
and parametrize ids can contain spaces.

Both the per-job log (``gh api .../actions/jobs/<id>/logs``: ``<ts> <text>``)
and the whole-run log (``gh run view --log``: ``<job>\\t<step>\\t<ts> <text>``)
are accepted; in the second form each job is tracked separately, keyed on its
first tab-separated field, so interleaved jobs never share a gap.

How a junit testcase is mapped to a file
----------------------------------------

Junit times are used exactly as reported. pytest's ``time`` is the default
``junit_duration_report=total`` -- setup + call + teardown -- so each
document's FIRST testcase also carries the autouse session fixture
``booted_app`` (``backend/tests/conftest.py``), and its last testcase the
matching teardown. That is accepted: under ``TESTING=1`` the boot is inert and
small, while every per-edge correction tried mis-measures what it touches. A
migration file's heavy DB test often runs LAST after near-zero static siblings,
and a module-scoped fixture lands on a file's first test, so capping an edge
test at its file's median cut a 66.5 s test to 0.03 s -- re-creating the very
skew this map exists to remove.

pytest's default ``xunit2`` junit omits the ``file`` attribute, leaving only a
dotted ``classname`` (``tests.api.test_x.TestGroup``). With ``--root`` (the
backend directory) the longest dotted prefix that names an existing
``<root>/<prefix>.py`` wins. Without a root, or when nothing exists, trailing
parts that start with an upper-case letter (pytest's ``Test*`` classes) are
dropped and the rest is the module. A ``file`` attribute, when present, is used
as-is.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

#: A timestamped Actions log line: optional `<job>\t<step>\t` prefix, then the
#: ISO timestamp, one space, and the line's own text.
_LOG_LINE = re.compile(
    r"^(?:(?P<job>[^\t]*)\t[^\t]*\t)?"
    r"\ufeff?(?P<ts>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) (?P<text>.*)$"
)

#: A pytest -v result line (the text after the timestamp).
_RESULT = re.compile(
    r"^(?P<path>tests/[^\s:\[\]]+\.py)::\S.*?\s"
    r"(?:PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)"
)

#: pytest's "collected N items" line: the start of one run.
_COLLECTED = re.compile(r"collected \d+ items?")


def _epoch(ts: str) -> float:
    """Seconds since the epoch for an Actions timestamp (7 fractional digits)."""
    base, _, frac = ts.rstrip("Z").partition(".")
    whole = datetime.fromisoformat(base + "+00:00").timestamp()
    return whole + (float("0." + frac) if frac else 0.0)


def log_durations(lines: Iterable[str]) -> dict[str, float]:
    """Seconds per test file, attributed from pytest -v result-line timestamps.

    See the module docstring for the rule. Returns unrounded sums.
    """
    totals: defaultdict[str, float] = defaultdict(float)
    # Per job key: the timestamp of the previous result line in the current
    # pytest run, or None before the first result of a run.
    previous: dict[str, float | None] = {}
    for raw in lines:
        match = _LOG_LINE.match(raw.rstrip("\r\n"))
        if match is None:
            continue
        key = match.group("job") or ""
        text = match.group("text")
        if _COLLECTED.search(text):
            previous[key] = None
            continue
        result = _RESULT.match(text)
        if result is None:
            continue
        now = _epoch(match.group("ts"))
        before = previous.get(key)
        if before is not None and now >= before:
            totals[result.group("path")] += now - before
        previous[key] = now
    return dict(totals)


def _module_path(classname: str, root: Path | None) -> str | None:
    parts = [p for p in classname.split(".") if p]
    if not parts:
        return None
    if root is not None:
        for end in range(len(parts), 0, -1):
            candidate = "/".join(parts[:end]) + ".py"
            if (root / candidate).is_file():
                return candidate
    while len(parts) > 1 and parts[-1][:1].isupper():
        parts.pop()
    return "/".join(parts) + ".py"


def junit_durations(xml_text: str, root: Path | None = None) -> dict[str, float]:
    """Seconds per test file from one junit XML document (unrounded sums).

    Every testcase's ``time`` is used as reported; see the module docstring for
    why the session fixture's share on the edge testcases is not removed.
    """
    totals: defaultdict[str, float] = defaultdict(float)
    tree = ET.fromstring(xml_text)
    for case in tree.iter("testcase"):
        try:
            seconds = float(case.get("time", "0") or 0)
        except ValueError:
            continue
        path = case.get("file") or _module_path(case.get("classname", ""), root)
        if not path or not seconds >= 0:
            continue
        totals[path.replace("\\", "/")] += seconds
    return dict(totals)


def merge(parts: Iterable[dict[str, float]]) -> dict[str, float]:
    """Sum per-file seconds across inputs (one shard per input, normally)."""
    totals: defaultdict[str, float] = defaultdict(float)
    for part in parts:
        for path, seconds in part.items():
            totals[path] += seconds
    return dict(totals)


def render(durations: dict[str, float]) -> str:
    """The committed JSON form: sorted keys, seconds rounded to 0.1."""
    rounded = {path: round(durations[path], 1) for path in sorted(durations)}
    return json.dumps(rounded, indent=2, sort_keys=True) + "\n"


#: A file whose seconds changed by more than this factor either way counts as
#: ``moved`` in ``--compare``. Hosted-runner noise alone is ~2-3x on migration
#: tests within one nightly, so a smaller factor would flag every refresh.
MOVED_FACTOR = 3.0

#: The prefix of the one machine-readable line ``--compare`` prints last.
COMPARE_PREFIX = "shard-durations-compare:"


@dataclass(frozen=True)
class Comparison:
    """How a committed map differs from a proposal; see the module docstring."""

    new: list[str]
    dropped: list[str]
    moved: list[str]
    committed_s: float
    proposed_s: float


def compare(committed: dict[str, float], proposed: dict[str, float]) -> Comparison:
    """How `committed` differs from `proposed`."""
    both = set(committed) & set(proposed)
    return Comparison(
        new=sorted(set(proposed) - set(committed)),
        dropped=sorted(set(committed) - set(proposed)),
        moved=sorted(
            path
            for path in both
            if max(committed[path], proposed[path])
            > MOVED_FACTOR * max(min(committed[path], proposed[path]), 0.1)
        ),
        committed_s=round(sum(committed.values()), 1),
        proposed_s=round(sum(proposed.values()), 1),
    )


def load_committed(path: str) -> dict[str, float] | None:
    """The committed map at `path`, or None when it is not a seconds map."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or not all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in raw.values()
    ):
        return None
    return {str(k): float(v) for k, v in raw.items()}


def report_comparison(path: str, proposed: dict[str, float]) -> str:
    """Print the ``--compare`` report to stderr and return its verdict line."""
    committed = load_committed(path)
    if committed is None:
        print(
            f"::warning::cannot read {path} as a durations map; nothing to compare",
            file=sys.stderr,
        )
        line = f"{COMPARE_PREFIX} committed=unreadable proposed={len(proposed)}"
        print(line, file=sys.stderr)
        return line
    diff = compare(committed, proposed)
    for paths, label in (
        (diff.new, "measured but not in the committed map"),
        (diff.dropped, "in the committed map but not measured"),
        (diff.moved, f"seconds moved more than {MOVED_FACTOR:g}x"),
    ):
        if paths:
            shown = ", ".join(paths[:10]) + (" ..." if len(paths) > 10 else "")
            print(f"{len(paths)} file(s) {label}: {shown}", file=sys.stderr)
    line = (
        f"{COMPARE_PREFIX} committed={len(committed)} proposed={len(proposed)} "
        f"new={len(diff.new)} dropped={len(diff.dropped)} "
        f"committed_s={diff.committed_s} proposed_s={diff.proposed_s} "
        f"moved={len(diff.moved)}"
    )
    print(line, file=sys.stderr)
    return line


def _inputs(paths: list[str], suffixes: tuple[str, ...]) -> list[Path]:
    """Files named directly, plus matching files under any directory named."""
    found: list[Path] = []
    for name in paths:
        path = Path(name)
        if path.is_dir():
            found.extend(
                sorted(
                    p for p in path.rglob("*") if p.is_file() and p.suffix in suffixes
                )
            )
        else:
            found.append(path)
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "inputs",
        nargs="+",
        help="junit XML files (or --from-logs log files); a directory is searched",
    )
    parser.add_argument(
        "--from-logs",
        action="store_true",
        help="read GitHub Actions job logs instead of junit XML",
    )
    parser.add_argument(
        "--root",
        help="the backend directory, to map junit classnames onto real files",
    )
    parser.add_argument("--out", required=True, help="where to write the JSON")
    parser.add_argument(
        "--compare",
        help="the committed durations map; report how far it has drifted from "
        "the proposal (never fails the run)",
    )
    args = parser.parse_args(argv)

    suffixes = (".log", ".txt") if args.from_logs else (".xml",)
    files = _inputs(args.inputs, suffixes)
    root = Path(args.root) if args.root else None
    parts: list[dict[str, float]] = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            parts.append(
                log_durations(text.splitlines())
                if args.from_logs
                else junit_durations(text, root)
            )
        except (OSError, ET.ParseError) as exc:
            print(f"::error::cannot read {path}: {exc}", file=sys.stderr)
            return 1

    durations = merge(parts)
    if not durations:
        # An empty map would silently put every shard back on count weights, so
        # it is refused rather than written.
        print(
            f"::error::no test timings found in {len(files)} input file(s); "
            "refusing to write an empty durations file",
            file=sys.stderr,
        )
        return 1

    Path(args.out).write_text(render(durations), encoding="utf-8")
    print(
        f"wrote {args.out}: {len(durations)} test files, "
        f"{sum(durations.values()):.1f} s total, from {len(files)} input file(s)",
        file=sys.stderr,
    )
    if args.compare:
        # Compared as rendered, so the totals match the file a refresh commits.
        report_comparison(args.compare, json.loads(render(durations)))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
