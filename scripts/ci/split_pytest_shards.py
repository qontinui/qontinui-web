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

Output contract
---------------

The ``::error::`` text is for people and is free to change. What a program -- or
a test -- reads is the ONE verdict line every run prints LAST on stderr::

    shard-split: verdict=truncated mode=count files=3 nodeids=5 min_files=10 min_nodeids=1 exit=4

Space-separated ``key=value`` tokens; no value contains whitespace; ``verdict``
comes first and ``exit`` (the process exit code) last. ``verdict`` is one of
``VERDICTS`` and :func:`parse_verdict` is the one reader. It exists because
pinning the prose broke a substring test four times across the review of the PR
that introduced this script. The only exits with no verdict line are argparse's
own: a usage error (exit 2, which ``no_nodeids`` shares -- so read the line, not
the code) and ``--help`` (exit 0). A ``--nodeids`` file that cannot be read, or
an ``--out`` that cannot be written, is ``io_error`` rather than a traceback.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from collections import Counter
from typing import TextIO

# A pytest `--collect-only -q` line is a node id: a path, then optionally
# `::`-separated class/function parts, then optionally a `[param]` suffix.
# Anchored on a `.py` path so the trailing count summary ("4129 tests collected
# in 31.52s"), warning preambles, blank lines and error banners cannot match.
_NODEID = re.compile(r"^(?P<path>[^\s:\[\]]+\.py)(?:::|$)")

#: The prefix of the one machine-readable line every run of `main` prints last.
VERDICT_PREFIX = "shard-split:"

#: The closed verdict vocabulary. A new exit path adds its verdict HERE; the
#: test module pins that every member is reachable from `main`.
VERDICTS = frozenset(
    {"ok", "bad_args", "io_error", "no_nodeids", "truncated", "empty_shard"}
)

#: Keys `format_verdict` places itself, and therefore refuses as caller fields.
_RESERVED_KEYS = frozenset({"verdict", "exit"})

#: An exit code as `format_verdict` spells it: a canonical ASCII integer, so no
#: `-0`, no `007`. `str.isdigit` is not this -- it accepts Unicode digits (`²`).
_EXIT_CODE = re.compile(r"0|-?[1-9][0-9]*")


def is_verdict_line(line: str) -> bool:
    """Whether `line` CLAIMS to be a verdict line -- well-formed or not.

    The writer, the reader and the tests all use this one rule, so a line that
    looks like a verdict can never be skipped by one and parsed by another.
    """
    return line.strip().startswith(VERDICT_PREFIX)


def format_verdict(verdict: str, exit_code: int, /, **fields: object) -> str:
    """The verdict line: ``shard-split: verdict=<v> key=value ... exit=<code>``.

    Refuses anything `parse_verdict` would reject, so the writer can never emit
    a line its own reader refuses. The two leading parameters are positional-only
    so that a caller field named ``verdict`` reaches the reserved-key check
    instead of colliding with the parameter.
    """
    if verdict not in VERDICTS:
        raise ValueError(f"unknown verdict {verdict!r}")
    reserved = sorted(_RESERVED_KEYS & fields.keys())
    if reserved:
        raise ValueError(f"verdict fields may not be named {reserved}")
    # `type() is int` rather than isinstance: `True` would render `exit=True`.
    if type(exit_code) is not int:
        raise ValueError(f"exit_code must be an int, got {exit_code!r}")
    tokens = [f"verdict={verdict}"]
    for key, value in fields.items():
        text = str(value)
        if (
            not key
            or not text
            or "=" in key + text
            or any(ch.isspace() for ch in key + text)
        ):
            raise ValueError(f"verdict field {key}={text!r} is not a bare token")
        tokens.append(f"{key}={text}")
    tokens.append(f"exit={exit_code}")
    return f"{VERDICT_PREFIX} {' '.join(tokens)}"


def parse_verdict(text: str) -> dict[str, str] | None:
    """The fields of the LAST verdict line in `text`, or None when there is none.

    A malformed line raises rather than yielding a partial reading: a reader
    that guesses is the prose-matching this line exists to replace. EVERY line
    `is_verdict_line` claims is held to the whole contract, not only the last
    one -- exactly the text `format_verdict` writes: the prefix at column 0,
    tokens separated by single spaces with nothing leading or trailing, bare
    ``key=value`` tokens with no repeated key, ``verdict`` first and in
    `VERDICTS`, ``exit`` last and a canonical ASCII integer.
    """
    parsed = [
        _parse_verdict_line(line) for line in text.splitlines() if is_verdict_line(line)
    ]
    return parsed[-1] if parsed else None


def _parse_verdict_line(line: str) -> dict[str, str]:
    body = line[len(VERDICT_PREFIX) :]
    if (
        not line.startswith(VERDICT_PREFIX)
        or not body.strip()
        or body != " " + " ".join(body.split())
    ):
        raise ValueError(f"malformed verdict line {line!r}")
    fields: dict[str, str] = {}
    for token in body.split():
        key, sep, value = token.partition("=")
        if not sep or not key or not value or "=" in value or key in fields:
            raise ValueError(f"malformed verdict token {token!r} in {line!r}")
        fields[key] = value
    keys = list(fields)
    if (
        keys[0] != "verdict"
        or keys[-1] != "exit"
        or fields["verdict"] not in VERDICTS
        or not _EXIT_CODE.fullmatch(fields["exit"])
    ):
        raise ValueError(f"verdict line breaks the output contract: {line!r}")
    return fields


def _stderr() -> TextIO:
    """`sys.stderr`, or a discarding sink when stderr is closed.

    `print(file=None)` silently writes to STDOUT -- and without `--out`, stdout
    is the shard's file list. A closed stderr would otherwise put the prose and
    the verdict line into the selection a caller hands to pytest.
    """
    return sys.stderr if sys.stderr is not None else io.StringIO()


def _finish(exit_code: int, verdict: str, **fields: object) -> int:
    """Print the verdict line to stderr and hand back `exit_code` for `main`."""
    print(format_verdict(verdict, exit_code, **fields), file=_stderr())
    return exit_code


def _read_stdin() -> str:
    """All of stdin, decoded with the file branch's ``errors="replace"``.

    A strict locale decode raises UnicodeDecodeError on one stray byte. Reads
    bytes through ``.buffer`` when the stream has one, and falls back to the
    text stream when it has none (an in-process ``io.StringIO``). A closed
    stdin is ``None``, reported as the OSError it is rather than an
    AttributeError.
    """
    stream = sys.stdin
    if stream is None:
        raise OSError("stdin is closed")
    raw = getattr(stream, "buffer", None)
    if raw is None:
        return stream.read()
    return raw.read().decode("utf-8", errors="replace")


def _abandon_stdout() -> None:
    """Close a stdout whose write already failed, so shutdown cannot retry it.

    The unwritten bytes stay buffered. Left open, the interpreter's exit-time
    flush fails a second time, replaces this run's exit code with 120 and
    prints ``Exception ignored ...`` AFTER the verdict line -- measured against
    ``/dev/full``. Closing it makes the shutdown flush a no-op.
    """
    if sys.stdout is None:
        return
    try:
        sys.stdout.close()
    except (OSError, ValueError):
        pass


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
    parser.add_argument("--shards", type=int, help="total shard count")
    parser.add_argument("--shard", type=int, help="this shard, 1-based (1..shards)")
    parser.add_argument("--out", help="write the selected files here (default: stdout)")
    parser.add_argument(
        "--min-files",
        type=int,
        default=0,
        help=(
            "fail (exit 4) unless at least this many DISTINCT test files appear "
            "in the collection; pass the on-disk `test_*.py` count to reject a "
            "truncated collection"
        ),
    )
    parser.add_argument(
        "--min-nodeids",
        type=int,
        default=0,
        help=(
            "fail (exit 4) unless at least this many NODE IDS appear in the "
            "collection. Counting files alone is not enough: dropping the 53 "
            "heaviest files leaves 173 of 231 files (a 3/4 file floor passes) "
            "while losing 62%% of the tests"
        ),
    )
    parser.add_argument(
        "--count-only",
        action="store_true",
        help=(
            "report the collected counts and apply the floors, then exit "
            "without selecting a shard; requires a positive --min-files"
        ),
    )
    args = parser.parse_args(argv)
    mode = "count" if args.count_only else "select"

    # `--count-only` exists for ONE caller, the workflow's collect step, and its
    # entire job is to apply a floor. Permitting a zero floor there would let the
    # gate pass vacuously if the caller ever computed one badly -- which is
    # exactly what a `find | wc -l` that fails open does. A library default of 0
    # (no floor) is fine; getting it by accident in the checking mode is not.
    if args.count_only and args.min_files < 1:
        print(
            "::error::--count-only requires a positive --min-files: its only "
            f"purpose is to APPLY a floor, and {args.min_files} means no floor "
            "at all. If the caller derives the floor, validate the derived value "
            "before passing it.",
            file=_stderr(),
        )
        return _finish(1, "bad_args", mode=mode, reason="min_files_not_positive")

    # The SAME rule for the second floor, because the argument for the first
    # applies verbatim to it and it is fed by the same derivation class. Left
    # unvalidated, `--min-nodeids 0` was silently accepted in checking mode while
    # `--min-files 0` was refused -- and the node-id floor is the one that covers
    # the truncation shape the file floor cannot see.
    if args.count_only and args.min_nodeids < 1:
        print(
            "::error::--count-only requires a positive --min-nodeids: it is the "
            f"floor that catches a collection which keeps most FILES and loses "
            f"most TESTS, and {args.min_nodeids} means no such floor at all.",
            file=_stderr(),
        )
        return _finish(1, "bad_args", mode=mode, reason="min_nodeids_not_positive")

    if not args.count_only:
        if args.shards is None or args.shard is None:
            print(
                "::error::--shards and --shard are required unless --count-only "
                "is given",
                file=_stderr(),
            )
            return _finish(1, "bad_args", mode=mode, reason="shard_args_missing")
        if args.shards < 1:
            print(f"::error::--shards must be >= 1, got {args.shards}", file=_stderr())
            return _finish(1, "bad_args", mode=mode, reason="shards_not_positive")
        if not 1 <= args.shard <= args.shards:
            print(
                f"::error::--shard must be in 1..{args.shards}, got {args.shard}",
                file=_stderr(),
            )
            return _finish(1, "bad_args", mode=mode, reason="shard_out_of_range")

    try:
        if args.nodeids == "-":
            text = _read_stdin()
        else:
            with open(args.nodeids, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
    # ValueError covers a strict text stream's UnicodeDecodeError and an
    # embedded NUL in the path, both of which were tracebacks with no verdict.
    except (OSError, ValueError) as exc:
        print(f"::error::cannot read --nodeids {args.nodeids!r}: {exc}", file=_stderr())
        return _finish(1, "io_error", mode=mode, stage="read")

    nodeids = parse_nodeids(text)
    if not nodeids:
        print(
            "::error::parsed ZERO pytest node ids from the collection output. "
            "Refusing to emit an empty selection: pytest would then collect the "
            "whole tests/ directory, so every shard would run the entire suite. "
            "Check that `pytest --collect-only -q` succeeded and that its output "
            "was captured, and that pytest ran at NEGATIVE verbosity (node ids "
            "print only there; pytest.ini addopts carrying -v cancel a lone -q, "
            "which is what `-o addopts=` in the workflow exists to prevent).",
            file=_stderr(),
        )
        return _finish(2, "no_nodeids", mode=mode, nodeids=0)

    weights = file_weights(nodeids)

    # The TRUNCATION check, and it lives here rather than in the calling shell
    # for two measured reasons. A second copy of the node-id rule in bash
    # disagreed with this module's own regex (it accepted `:`/`[`/`]` in a path
    # and over-counted), and a bash numeric test on an empty variable fails OPEN
    # without tripping `-e` — a tripwire that fails open is not a tripwire. One
    # parser, one rule, and the comparison happens where the value cannot be an
    # empty string.
    #
    # The caller passes the on-disk `test_*.py` count, not a constant: a
    # hardcoded node-id floor is decoration, because a handful of large files
    # clears any plausible number while the collection is missing most of the
    # suite.
    # TWO floors, because they catch different truncation shapes and the file
    # count alone is materially loose: dropping the 53 heaviest collectable files
    # keeps 173 of 231 files -- passing a 3/4 FILE floor -- while losing 2263 of
    # 3601 test functions, 62% of the suite. A conftest import error under one
    # heavy subtree presents most FILES and loses most TESTS, which is precisely
    # that shape, so the node-id floor is what closes it.
    if len(weights) < args.min_files or len(nodeids) < args.min_nodeids:
        print(
            f"::error::collection is TRUNCATED: {len(weights)} distinct test "
            f"files (floor {args.min_files}) and {len(nodeids)} node ids (floor "
            f"{args.min_nodeids}). This is the one shape sharding cannot survive silently - "
            "a truncated collection shards cleanly and every shard goes green "
            "while covering only part of the suite. Three causes, in order of "
            "likelihood: the collection really was cut short (read the "
            "collection output above); a conftest `collect_ignore` / "
            "`norecursedirs` entry now excludes more files than the caller's "
            "floor allows for (backend/tests/conftest.py excludes "
            "`integration`); or a `test_*.py` file collected ZERO tests, i.e. a "
            "dead test module.",
            file=_stderr(),
        )
        files_short = len(weights) < args.min_files
        nodeids_short = len(nodeids) < args.min_nodeids
        if files_short and nodeids_short:
            missed = "both"
        else:
            missed = "files" if files_short else "nodeids"
        return _finish(
            4,
            "truncated",
            mode=mode,
            missed=missed,
            files=len(weights),
            nodeids=len(nodeids),
            min_files=args.min_files,
            min_nodeids=args.min_nodeids,
        )

    if args.count_only:
        print(
            f"collection OK: {len(weights)} test files (floor {args.min_files}), "
            f"{len(nodeids)} node ids (floor {args.min_nodeids})",
            file=_stderr(),
        )
        return _finish(
            0,
            "ok",
            mode=mode,
            files=len(weights),
            nodeids=len(nodeids),
            min_files=args.min_files,
            min_nodeids=args.min_nodeids,
        )

    selected = assign(weights, args.shards)[args.shard - 1]

    if not selected:
        print(
            f"::error::shard {args.shard}/{args.shards} selected no test files out "
            f"of {len(weights)} collected files ({len(nodeids)} tests). With more "
            "files than shards this cannot happen, so the collection or the split "
            "is wrong. Refusing to run an empty shard.",
            file=_stderr(),
        )
        return _finish(
            3,
            "empty_shard",
            mode=mode,
            shards=args.shards,
            shard=args.shard,
            files=len(weights),
            nodeids=len(nodeids),
        )

    body = "\n".join(selected) + "\n"
    target = repr(args.out) if args.out else "stdout"
    try:
        if args.out:
            with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(body)
        else:
            if sys.stdout is None:
                raise OSError("stdout is closed")
            sys.stdout.write(body)
            # write() only fills a buffer. Without this flush a full or closed
            # stdout fails at interpreter shutdown -- AFTER an `ok exit=0`
            # verdict line, which would then be neither last nor true.
            sys.stdout.flush()
    # ValueError covers UnicodeEncodeError, a closed stdout and a NUL in --out.
    except (OSError, ValueError) as exc:
        if not args.out:
            _abandon_stdout()
        print(
            f"::error::cannot write shard {args.shard}/{args.shards}'s selection "
            f"to {target}: {exc}",
            file=_stderr(),
        )
        return _finish(
            1,
            "io_error",
            mode=mode,
            stage="write",
            shards=args.shards,
            shard=args.shard,
        )

    total = sum(weights.values())
    mine = sum(weights[p] for p in selected)
    print(
        f"shard {args.shard}/{args.shards}: {len(selected)} of {len(weights)} files, "
        f"{mine} of {total} collected tests",
        file=_stderr(),
    )
    return _finish(
        0,
        "ok",
        mode=mode,
        shards=args.shards,
        shard=args.shard,
        files=len(weights),
        nodeids=len(nodeids),
        selected_files=len(selected),
        selected_tests=mine,
    )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
