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

How a log is turned into seconds (``--from-logs``)
--------------------------------------------------

Every Actions log line carries an ISO-8601 timestamp, and the gating pytest run
is verbose (``-v``), so each finished test prints one line
``tests/<file>.py::<test> PASSED``. The gap between two consecutive result lines
is attributed to the test that ENDED it: that is the wall time pytest spent
setting it up, running it and tearing it down. The gap before the FIRST result
line of a run is dropped rather than attributed: it is the session-scoped setup
(engine, ``create_all``), a per-shard constant that belongs to no file, and
charging it to whichever file happened to be first would inflate that one file
on every refresh. A run is delimited by pytest's ``collected N items`` line, so
a log holding two pytest runs never bridges a gap across them.

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
    """Seconds per test file from one junit XML document (unrounded sums)."""
    totals: defaultdict[str, float] = defaultdict(float)
    tree = ET.fromstring(xml_text)
    for case in tree.iter("testcase"):
        try:
            seconds = float(case.get("time", "0") or 0)
        except ValueError:
            continue
        path = case.get("file") or _module_path(case.get("classname", ""), root)
        if not path or seconds < 0:
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
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
