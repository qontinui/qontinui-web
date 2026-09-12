#!/usr/bin/env python3
"""Split a pytest collection into N balanced, disjoint shards — by test FILE.

``backend-ci.yml``'s ``Run Tests`` job runs the backend suite as a matrix of
shards. Each shard computes the SAME assignment from the SAME collection and
runs only the files assigned to it, so no shard needs data from any other job
and there is no collect-then-fan-out stage to serialize behind.

ONE lane invokes it:

* ``.github/workflows/backend-ci.yml``, step "Select this shard's test files" —
  the gating backend suite, once per matrix shard.

It is deliberately NOT in ``.qontinui/ci.toml``: that manifest's header records
that ``backend-ci.yml``'s ``test`` job cannot run on the runner-as-CI-node lane
at all, because that lane provisions no Postgres/Redis. A sharding helper for a
job that lane cannot run would be a lane that never executes.

Why files and not individual tests
----------------------------------

``backend/tests/conftest.py`` builds a **session-scoped** engine and calls
``Base.metadata.create_all`` / ``drop_all`` around the whole session, against
one hardcoded database name. A test file is therefore the smallest unit that
can be moved between processes without two processes sharing that lifecycle.
Splitting mid-file would put two halves of one module in two processes with two
independent ``create_all``/``drop_all`` cycles.

Balance
-------

Files are packed greedily: heaviest file first, each file into the lightest
bin so far. That is the classic LPT heuristic — on the real corpus (230 files,
~4100 collected tests) it lands within 0.1% of perfect at 4 and at 6 shards.
Weight is the collected-test count per file, so parametrized tests are counted
as the many tests they actually are, not as the one function they are written
as.

What this guarantees, and what it does not
------------------------------------------

GUARANTEED, and unit-tested directly: the union of all shards is exactly the
set of collected files (**complete**), no file appears in two shards
(**disjoint**), and the assignment depends only on the collected set — not on
input order, not on the shard being asked (**deterministic**).

NOT guaranteed: equal wall time. Test count is a proxy for duration; a file of
slow DB tests outweighs its count. The job's budget tripwire is the feedback
loop for that.

Failure posture
---------------

Every failure is LOUD, because the quiet versions are all worse than a red
step. Parsing no node ids at all exits non-zero rather than emitting an empty
file list — an empty list handed to ``pytest`` would make it collect the whole
directory, which is a 6x blowup at best and a silently narrowed gate at worst.
A shard that selects nothing is likewise an error: with N shards over more than
N files it cannot happen, so it means the collection or the split is wrong.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter

# A pytest `--collect-only -q` line is a node id: a path, then optionally
# `::`-separated class/function parts, then optionally a `[param]` suffix.
# Anchored on a `.py` path so the trailing count summary ("4129 tests collected
# in 31.52s"), warning preambles, blank lines and error banners cannot match.
_NODEID = re.compile(r"^(?P<path>[^\s:\[\]]+\.py)(?:::|$)")


def parse_nodeids(text: str) -> list[str]:
    """Every node id in `pytest --collect-only -q` output, in order.

    Only lines whose FIRST non-whitespace token is a `.py` path are node ids.
    Everything else pytest prints on that stream — the count summary, warnings
    summaries, `ERROR`/`ERRORS` banners, blank separators — is ignored rather
    than guessed at.
    """
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or not _NODEID.match(line):
            continue
        out.append(line)
    return out


def file_weights(nodeids: list[str]) -> dict[str, int]:
    """Collected-test count per test file, keyed by the node id's path part."""
    counts: Counter[str] = Counter()
    for nodeid in nodeids:
        match = _NODEID.match(nodeid)
        if match is None:  # pragma: no cover - parse_nodeids already filtered
            continue
        counts[match.group("path")] += 1
    return dict(counts)


def assign(weights: dict[str, int], shards: int) -> list[list[str]]:
    """Greedy LPT pack of weighted files into `shards` bins.

    Deterministic by construction: files are ordered by descending weight with
    the path as the tie-break, so the sequence does not depend on the input's
    order, and ties between equally-loaded bins always take the lowest index.
    Returns one sorted file list per shard, indexed 0-based.
    """
    if shards < 1:
        raise ValueError(f"shards must be >= 1, got {shards}")

    bins: list[list[str]] = [[] for _ in range(shards)]
    loads = [0] * shards

    for path, weight in sorted(weights.items(), key=lambda kv: (-kv[1], kv[0])):
        target = min(range(shards), key=lambda i: (loads[i], i))
        bins[target].append(path)
        loads[target] += weight

    return [sorted(b) for b in bins]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Select one shard's pytest test files from a collection.",
    )
    parser.add_argument(
        "--nodeids",
        required=True,
        help="file holding `pytest --collect-only -q` output, or - for stdin",
    )
    parser.add_argument("--shards", type=int, required=True, help="total shard count")
    parser.add_argument(
        "--shard", type=int, required=True, help="this shard, 1-based (1..shards)"
    )
    parser.add_argument("--out", help="write the selected files here (default: stdout)")
    args = parser.parse_args(argv)

    if args.shards < 1:
        print(f"::error::--shards must be >= 1, got {args.shards}", file=sys.stderr)
        return 1
    if not 1 <= args.shard <= args.shards:
        print(
            f"::error::--shard must be in 1..{args.shards}, got {args.shard}",
            file=sys.stderr,
        )
        return 1

    if args.nodeids == "-":
        text = sys.stdin.read()
    else:
        with open(args.nodeids, encoding="utf-8", errors="replace") as handle:
            text = handle.read()

    nodeids = parse_nodeids(text)
    if not nodeids:
        print(
            "::error::parsed ZERO pytest node ids from the collection output. "
            "Refusing to emit an empty selection: pytest would then collect the "
            "whole tests/ directory, so every shard would run the entire suite. "
            "Check that `pytest --collect-only -q` succeeded and that its output "
            "was captured.",
            file=sys.stderr,
        )
        return 2

    weights = file_weights(nodeids)
    selected = assign(weights, args.shards)[args.shard - 1]

    if not selected:
        print(
            f"::error::shard {args.shard}/{args.shards} selected no test files out "
            f"of {len(weights)} collected files ({len(nodeids)} tests). With more "
            "files than shards this cannot happen, so the collection or the split "
            "is wrong. Refusing to run an empty shard.",
            file=sys.stderr,
        )
        return 3

    total = sum(weights.values())
    mine = sum(weights[p] for p in selected)
    print(
        f"shard {args.shard}/{args.shards}: {len(selected)} of {len(weights)} files, "
        f"{mine} of {total} collected tests",
        file=sys.stderr,
    )

    body = "\n".join(selected) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(body)
    else:
        sys.stdout.write(body)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
