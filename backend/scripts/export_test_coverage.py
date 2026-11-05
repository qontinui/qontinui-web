#!/usr/bin/env python3
"""Export per-test -> touched-file coverage from a coverage.py SQLite db to coord.

This is a CI *producer* for coord's per-test coverage map. It reads the
`.coverage` SQLite database that `pytest --cov=app --cov-context=test` leaves
behind, turns each test's dynamic context into one observation of
`(test_id, files_touched)`, and POSTs the batch to coord's existing ingest
route. It also POSTs the JUnit XML (per-test results) to coord's results-ingest
route so downstream joins have both the coverage map and the pass/fail outcome
keyed by the SAME test_id.

Design constraints (see plan 2026-06-04-ci-per-test-coverage-producer-plan):
  * Best-effort: any network/parse failure prints a warning and exits 0 — the
    producer must NEVER fail the CI lane it rides on.
  * stdlib only (sqlite3 / json / urllib / xml) — no extra CI deps.
  * Cadence is push-to-main only (enforced by the workflow `if:` guard, not
    here); this script just emits whatever db it's pointed at.

Sharded producer (one db, several JUnit files):
  `.github/workflows/backend-coverage-producer.yml` runs the suite as a matrix
  of shards. Each shard writes its OWN coverage data file and JUnit file; the
  downstream export job `coverage combine`s the data files into ONE `.coverage`
  db (dynamic contexts survive the combine, so per-test attribution is intact)
  and passes every shard's JUnit file here as a repeated `--junit-xml`. Those
  are merged into ONE `<testsuites>` document and POSTed ONCE, so coord sees
  exactly the single results batch per head it always did. If any of several
  JUnit files is missing or unparseable the results POST is SKIPPED rather
  than sent partial: a partial results batch presented as the whole run is
  the one thing this producer must never publish. (The workflow refuses to
  reach this script at all unless every shard delivered both files; this is
  the script's own second guard.)

test_id alignment (LOAD-BEARING — downstream joins coverage<->results on it):
  coverage.py contexts (with --cov-context=test) look like a pytest nodeid plus
  a `|run` / `|setup` / `|teardown` suffix, e.g.
      tests/test_mod.py::TestSub::test_sub|run
      tests/test_param.py::test_add_param[1-2-3]|run
  coord derives a test_id from JUnit XML as `{classname}::{name}` (or just
  `{name}` when classname is empty). pytest's JUnit writer emits
      classname = dotted module path (+ any enclosing classes), e.g.
                  "tests.test_mod" or "tests.test_mod.TestSub"
      name      = the test function (with any [param] id), e.g.
                  "test_sub" or "test_add_param[1-2-3]"
  so the SAME test renders as
      tests.test_mod.TestSub::test_sub
      tests.test_param::test_add_param[1-2-3]
  `nodeid_to_junit_test_id()` below converts a coverage context's nodeid into
  exactly that composite, so the coverage observation's test_id is textually
  identical to what coord's JUnit ingest computes. Verified locally against real
  coverage.py 7.14 + pytest 9.0 output (plain, class-nested, and parametrized
  tests) — see the script's --self-test.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

REPO = "qontinui-web"
DEFAULT_COORD_URL = "https://coord.qontinui.io"
OBSERVE_PATH = "/coord/test-coverage/observe"
RESULTS_PATH = "/coord/test-results/ingest"
DEFAULT_JUNIT_XML = "junit-results.xml"

# coverage.py appends these to a nodeid when --cov-context=test is used; they
# denote which phase of the test ran the line. We attribute all phases to the
# one test, so strip the suffix.
CONTEXT_PHASE_SUFFIXES = ("|run", "|setup", "|teardown")


def warn(msg: str) -> None:
    print(f"[export_test_coverage] WARNING: {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(f"[export_test_coverage] {msg}")


def strip_phase_suffix(context: str) -> str:
    """Drop coverage.py's |run / |setup / |teardown phase suffix."""
    for suffix in CONTEXT_PHASE_SUFFIXES:
        if context.endswith(suffix):
            return context[: -len(suffix)]
    return context


def nodeid_to_junit_test_id(nodeid: str) -> str:
    """Convert a pytest nodeid to coord's `{classname}::{name}` JUnit form.

    nodeid grammar: ``<relpath>.py::[Class::...]<func>[<param>]``
      tests/test_mod.py::test_add               -> tests.test_mod::test_add
      tests/test_mod.py::TestSub::test_sub      -> tests.test_mod.TestSub::test_sub
      tests/test_param.py::test_p[1-2-3]        -> tests.test_param::test_p[1-2-3]
    The JUnit classname pytest emits is the dotted module path joined with any
    enclosing class names; the JUnit name is the final test (param id included).
    """
    parts = nodeid.split("::")
    file_part = parts[0]
    # file relpath -> dotted module: drop a trailing .py, normalize separators.
    module = file_part
    if module.endswith(".py"):
        module = module[:-3]
    module = module.replace("\\", "/").replace("/", ".")

    if len(parts) == 1:
        # No test name (degenerate); use the module as both halves' base.
        return module

    test_name = parts[-1]
    class_parts = parts[1:-1]  # enclosing classes, if any
    classname = ".".join([module, *class_parts]) if class_parts else module
    return f"{classname}::{test_name}"


def normalize_file_path(path: str) -> str | None:
    """Normalize a coverage.py file path to a repo-root-relative forward-slash path.

    The .coverage db stores either an absolute path or a backend-cwd-relative
    path (coverage runs with cwd=backend). We want repo-root-relative, i.e.
    ``backend/app/...``. Only app-source files are kept; test files and
    out-of-tree paths are dropped (a test 'touching' itself is not signal).
    """
    p = path.replace("\\", "/")

    # Absolute path: keep the tail starting at the first 'backend/' segment if
    # present, else at an 'app/' segment.
    marker = "/backend/"
    idx = p.find(marker)
    if idx != -1:
        rel = p[idx + 1 :]  # drop leading slash -> "backend/..."
    elif p.startswith("backend/"):
        rel = p
    elif p.startswith("app/"):
        rel = "backend/" + p
    elif "/app/" in p:
        # Absolute path without a backend segment but with an app dir.
        rel = "backend/" + p[p.find("/app/") + 1 :]
    else:
        # Unknown shape; keep a normalized relative form but flag by returning
        # None so we don't emit noise paths.
        return None

    # Only attribute application source, not the tests themselves.
    if not rel.startswith("backend/app/"):
        return None
    return rel


def extract_observations(coverage_db: str, head_sha: str) -> list[dict]:
    """Read a coverage.py SQLite db, return one observation per test.

    Handles both line storage (`line_bits`) and branch storage (`arc`): a file
    is 'touched' by a context if that context has a non-empty bitmap in
    line_bits OR any arc rows for the file.
    """
    con = sqlite3.connect(coverage_db)
    con.row_factory = sqlite3.Row
    try:
        files = {
            row["id"]: row["path"] for row in con.execute("SELECT id, path FROM file")
        }
        contexts = {
            row["id"]: row["context"]
            for row in con.execute("SELECT id, context FROM context")
        }

        # (context_id -> set(file_id)) from whichever storage is present.
        ctx_files: dict[int, set[int]] = {}

        def _table_exists(name: str) -> bool:
            return (
                con.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
                ).fetchone()
                is not None
            )

        if _table_exists("line_bits"):
            for row in con.execute(
                "SELECT file_id, context_id, numbits FROM line_bits"
            ):
                numbits = row["numbits"]
                if numbits and any(numbits):
                    ctx_files.setdefault(row["context_id"], set()).add(row["file_id"])

        if _table_exists("arc"):
            for row in con.execute("SELECT DISTINCT file_id, context_id FROM arc"):
                ctx_files.setdefault(row["context_id"], set()).add(row["file_id"])
    finally:
        con.close()

    observations: list[dict] = []
    for ctx_id, file_ids in ctx_files.items():
        raw_context = contexts.get(ctx_id, "")
        nodeid = strip_phase_suffix(raw_context).strip()
        if not nodeid:
            # The empty global context (id 1) and any unattributed coverage.
            continue
        test_id = nodeid_to_junit_test_id(nodeid)

        touched = sorted(
            {
                norm
                for fid in file_ids
                if (norm := normalize_file_path(files.get(fid, ""))) is not None
            }
        )
        if not touched:
            continue

        observations.append(
            {
                "repo": REPO,
                "head_sha": head_sha,
                "test_id": test_id,
                "files_touched": touched,
                # coverage.py contexts attribute lines, not line counts per test;
                # we don't have a per-test covered-line tally here, so null.
                "lines_covered": None,
                "coverage_kind": "line",
            }
        )

    observations.sort(key=lambda o: o["test_id"])
    return observations


def _log_response_body(url: str, status: int, body: str) -> None:
    """Print the response body (truncated) and warn on partial/unparseable persists.

    Visibility is the point: a silently-empty or partially-persisted batch hid for
    half a day because we only logged the status code. The observe route returns
    ``{"accepted": N, "persisted": M, "failed": ...}`` and the results ingest
    returns a similar JSON body; surface it on EVERY POST, and shout when
    ``persisted < accepted`` or the body can't be parsed.
    """
    snippet = body if len(body) <= 300 else body[:300] + "...(truncated)"
    info(f"POST {url} -> {status} body={snippet}")
    try:
        parsed = json.loads(body) if body.strip() else {}
    except (ValueError, TypeError):
        warn(
            f"POST {url} -> {status}: response body is not valid JSON (see body above)"
        )
        return
    if isinstance(parsed, dict) and "accepted" in parsed and "persisted" in parsed:
        accepted = parsed.get("accepted")
        persisted = parsed.get("persisted")
        failed = parsed.get("failed")
        # An explicit numeric guard rather than try/except TypeError: same
        # behaviour and the same two messages, but the None case is visible to
        # the reader and to the type checker instead of being caught at runtime.
        if not isinstance(persisted, (int, float)) or not isinstance(
            accepted, (int, float)
        ):
            warn(f"POST {url}: non-numeric accepted/persisted in body (see body above)")
        elif persisted < accepted:
            warn(
                f"POST {url}: persisted ({persisted}) < accepted ({accepted}) "
                f"-- batch partially dropped"
                + (f", failed={failed}" if failed is not None else "")
            )


def post_json(url: str, payload: dict, *, timeout: float = 30.0) -> None:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = resp.getcode()
        try:
            body = resp.read().decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001 - body read must not mask the POST
            body = ""
            warn(f"POST {url} -> {status}: failed to read response body: {exc!r}")
        _log_response_body(url, status, body)
        if status >= 300:
            raise urllib.error.HTTPError(url, status, "non-2xx", resp.headers, None)


def post_observations(coord_url: str, observations: list[dict]) -> None:
    if not observations:
        info("no observations to post")
        return
    post_json(coord_url.rstrip("/") + OBSERVE_PATH, {"observations": observations})


def _int_attr(el: ET.Element, name: str) -> int:
    try:
        return int(float(el.get(name, "0") or "0"))
    except ValueError:
        return 0


def merge_junit_xml(paths: list[str]) -> str | None:
    """Return ONE JUnit document covering every file in ``paths``, or None.

    One path is returned VERBATIM (byte-for-byte what pytest wrote), so the
    unsharded call is unchanged. Several paths are merged: every
    ``<testsuite>`` -- whether the file's root is ``<testsuites>`` (what pytest
    writes) or a bare ``<testsuite>`` -- becomes a child of a new
    ``<testsuites>`` root, whose ``tests``/``failures``/``errors``/``skipped``
    are the sums over its children.

    None means "do not POST": no path given, any path missing, or any document
    unparseable. With several files a hole is not skipped over, because a
    results batch missing one shard would be published as if it were the run.
    """
    if not paths:
        warn("no junit file given; skipping results ingest")
        return None
    raws: list[tuple[str, str]] = []
    for path in paths:
        if not os.path.exists(path):
            warn(f"junit file not found: {path}; skipping results ingest")
            return None
        with open(path, encoding="utf-8") as fh:
            raws.append((path, fh.read()))
    if len(raws) == 1:
        return raws[0][1]

    merged = ET.Element("testsuites", {"name": "pytest tests"})
    for path, raw in raws:
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as exc:
            warn(
                f"junit file {path} is not parseable XML ({exc}); skipping results ingest"
            )
            return None
        if root.tag == "testsuites":
            suites = list(root)
        elif root.tag == "testsuite":
            suites = [root]
        else:
            warn(
                f"junit file {path} has root <{root.tag}>, not a testsuite; skipping results ingest"
            )
            return None
        for suite in suites:
            merged.append(suite)
    for attr in ("tests", "failures", "errors", "skipped"):
        merged.set(attr, str(sum(_int_attr(s, attr) for s in merged)))
    return '<?xml version="1.0" encoding="utf-8"?>' + ET.tostring(
        merged, encoding="unicode"
    )


def post_junit(coord_url: str, junit_paths: list[str], head_sha: str) -> None:
    raw = merge_junit_xml(junit_paths)
    if raw is None:
        return
    if len(junit_paths) > 1:
        info(f"merged {len(junit_paths)} junit files into one results batch")
    post_json(
        coord_url.rstrip("/") + RESULTS_PATH,
        {
            "repo": REPO,
            "head_sha": head_sha,
            "source": "ci",
            "format": "junit_xml",
            "raw": raw,
        },
    )


def run_export(args: argparse.Namespace) -> int:
    head_sha = os.environ.get("GITHUB_SHA", "")
    coord_url = os.environ.get("COORD_HTTP_URL", DEFAULT_COORD_URL)

    if not head_sha:
        warn("GITHUB_SHA not set; cannot key observations — exiting 0 (best-effort)")
        return 0

    try:
        observations = extract_observations(args.coverage_db, head_sha)
    except Exception as exc:  # noqa: BLE001 - best-effort producer
        warn(f"failed to extract coverage from {args.coverage_db}: {exc!r} — exiting 0")
        return 0

    info(f"extracted {len(observations)} per-test observations from {args.coverage_db}")

    if args.print_batch:
        print(json.dumps({"observations": observations}, indent=2))

    # Both POSTs are independent best-effort; a failure in one must not skip the
    # other and must not fail the lane.
    try:
        post_observations(coord_url, observations)
    except Exception as exc:  # noqa: BLE001
        warn(f"coverage observe POST failed: {exc!r} — continuing (best-effort)")

    try:
        post_junit(coord_url, args.junit_xml or [DEFAULT_JUNIT_XML], head_sha)
    except Exception as exc:  # noqa: BLE001
        warn(f"junit results POST failed: {exc!r} — continuing (best-effort)")

    return 0


# --------------------------------------------------------------------------- #
# Self-test: build a synthetic .coverage db with the exact schema this script  #
# reads, run extraction, and assert the output shape + test_id normalization.  #
# --------------------------------------------------------------------------- #
def build_synthetic_db(path: str) -> None:
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE coverage_schema (version integer);
        INSERT INTO coverage_schema (version) VALUES (7);
        CREATE TABLE file (id integer primary key, path text);
        CREATE TABLE context (id integer primary key, context text);
        CREATE TABLE line_bits (file_id integer, context_id integer, numbits blob);
        CREATE TABLE arc (file_id integer, context_id integer, fromno integer, tono integer);
        """
    )
    # Two app files + one test file (the test file must be dropped from output).
    con.executemany(
        "INSERT INTO file (id, path) VALUES (?, ?)",
        [
            (
                1,
                "/home/runner/work/qontinui-web/qontinui-web/backend/app/services/foo.py",
            ),
            (2, "app/api/bar.py"),  # backend-relative shape
            (
                3,
                "/home/runner/work/qontinui-web/qontinui-web/backend/tests/test_foo.py",
            ),
        ],
    )
    con.executemany(
        "INSERT INTO context (id, context) VALUES (?, ?)",
        [
            (1, ""),  # global context — must be dropped
            (2, "tests/test_foo.py::test_add|run"),
            (3, "tests/test_foo.py::TestBar::test_method|run"),
            (4, "tests/test_param.py::test_p[1-2-3]|run"),
        ],
    )
    # Line coverage: byte 0x02 has a bit set (truthy). Empty bitmap (0x00) for a
    # row that must be treated as 'not covered'.
    con.executemany(
        "INSERT INTO line_bits (file_id, context_id, numbits) VALUES (?, ?, ?)",
        [
            (1, 2, b"\x02"),  # test_add covers app/services/foo.py (line storage)
            (3, 2, b"\x02"),  # ...and the test file itself -> must be dropped
            (1, 1, b"\x02"),  # global context -> dropped
            (2, 4, b"\x00"),  # empty bitmap -> NOT touched via line_bits
        ],
    )
    # Branch coverage for the class-nested test (arc storage path) + the
    # parametrized test (so it has SOME coverage despite the empty line bitmap).
    con.executemany(
        "INSERT INTO arc (file_id, context_id, fromno, tono) VALUES (?, ?, ?, ?)",
        [
            (1, 3, 1, 2),  # TestBar::test_method touches app/services/foo.py
            (2, 4, 3, 4),  # parametrized test touches app/api/bar.py via arc
        ],
    )
    con.commit()
    con.close()


def self_test() -> int:
    import tempfile

    # 1. Pure-function checks for the test_id normalizer.
    cases = {
        "tests/test_mod.py::test_add": "tests.test_mod::test_add",
        "tests/test_mod.py::TestSub::test_sub": "tests.test_mod.TestSub::test_sub",
        "tests/test_param.py::test_p[1-2-3]": "tests.test_param::test_p[1-2-3]",
        "backend/tests/a/test_x.py::Cls::Sub::t": "backend.tests.a.test_x.Cls.Sub::t",
    }
    for nodeid, expected in cases.items():
        got = nodeid_to_junit_test_id(nodeid)
        assert got == expected, (
            f"normalize({nodeid!r}) = {got!r}, expected {expected!r}"
        )

    assert strip_phase_suffix("a::b|run") == "a::b"
    assert strip_phase_suffix("a::b|setup") == "a::b"
    assert strip_phase_suffix("a::b|teardown") == "a::b"
    assert strip_phase_suffix("a::b") == "a::b"

    assert (
        normalize_file_path("/x/backend/app/services/foo.py")
        == "backend/app/services/foo.py"
    )
    assert normalize_file_path("app/api/bar.py") == "backend/app/api/bar.py"
    assert normalize_file_path("backend/app/x.py") == "backend/app/x.py"
    assert normalize_file_path("/x/backend/tests/test_foo.py") is None  # tests dropped
    assert normalize_file_path("/unrelated/lib.py") is None

    # 2. End-to-end extraction over a synthetic db.
    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, ".coverage")
        build_synthetic_db(db_path)
        obs = extract_observations(db_path, head_sha="deadbeef")

    by_id = {o["test_id"]: o for o in obs}
    assert set(by_id) == {
        "tests.test_foo::test_add",
        "tests.test_foo.TestBar::test_method",
        "tests.test_param::test_p[1-2-3]",
    }, f"unexpected test ids: {sorted(by_id)}"

    add = by_id["tests.test_foo::test_add"]
    assert add["files_touched"] == ["backend/app/services/foo.py"], add["files_touched"]
    assert add["repo"] == "qontinui-web"
    assert add["head_sha"] == "deadbeef"
    assert add["coverage_kind"] == "line"
    assert add["lines_covered"] is None

    method = by_id["tests.test_foo.TestBar::test_method"]
    assert method["files_touched"] == ["backend/app/services/foo.py"], method[
        "files_touched"
    ]

    param = by_id["tests.test_param::test_p[1-2-3]"]
    assert param["files_touched"] == ["backend/app/api/bar.py"], param["files_touched"]

    # 3. Shape invariants on every observation.
    required = {
        "repo",
        "head_sha",
        "test_id",
        "files_touched",
        "lines_covered",
        "coverage_kind",
    }
    for o in obs:
        assert required.issubset(o), f"missing keys in {o}"
        assert o["files_touched"], "files_touched must be non-empty"
        assert all(p.startswith("backend/app/") for p in o["files_touched"])

    # 4. JUnit merge: several shards -> one document, and never a partial one.
    with tempfile.TemporaryDirectory() as tmp:
        wrapped = os.path.join(tmp, "a.xml")
        bare = os.path.join(tmp, "b.xml")
        broken = os.path.join(tmp, "c.xml")
        with open(wrapped, "w", encoding="utf-8") as fh:
            fh.write(
                '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">'
                '<testsuite name="pytest" tests="2" failures="1" errors="0" skipped="0">'
                '<testcase classname="tests.test_a" name="test_x"/>'
                '<testcase classname="tests.test_a" name="test_y"><failure message="m"/></testcase>'
                "</testsuite></testsuites>"
            )
        with open(bare, "w", encoding="utf-8") as fh:
            fh.write(
                '<testsuite name="pytest" tests="1" failures="0" errors="0" skipped="1">'
                '<testcase classname="tests.test_b.TestB" name="test_z[1]"><skipped/></testcase>'
                "</testsuite>"
            )
        with open(broken, "w", encoding="utf-8") as fh:
            fh.write("<testsuite><testcase")

        with open(wrapped, encoding="utf-8") as fh:
            assert merge_junit_xml([wrapped]) == fh.read(), "one file must be verbatim"

        merged = merge_junit_xml([wrapped, bare])
        assert merged is not None
        root = ET.fromstring(merged)
        assert root.tag == "testsuites"
        names = [
            f"{tc.get('classname')}::{tc.get('name')}" for tc in root.iter("testcase")
        ]
        assert names == [
            "tests.test_a::test_x",
            "tests.test_a::test_y",
            "tests.test_b.TestB::test_z[1]",
        ], names
        assert (root.get("tests"), root.get("failures"), root.get("skipped")) == (
            "3",
            "1",
            "1",
        ), root.attrib

        # A hole in a multi-shard set is never skipped over.
        assert merge_junit_xml([wrapped, os.path.join(tmp, "missing.xml")]) is None
        assert merge_junit_xml([wrapped, broken]) is None
        assert merge_junit_xml([]) is None

    print("SELF-TEST PASSED:", json.dumps({"observations": obs}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--coverage-db",
        default=".coverage",
        help="path to the coverage.py SQLite db (default: .coverage in cwd)",
    )
    parser.add_argument(
        "--junit-xml",
        action="append",
        default=None,
        help=(
            "path to a JUnit XML to POST to the results ingest; repeat it once "
            "per shard and the files are merged into ONE batch (default: "
            f"{DEFAULT_JUNIT_XML})"
        ),
    )
    parser.add_argument(
        "--print-batch",
        action="store_true",
        help="print the observations batch JSON before posting (debugging)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="run the built-in self-test against a synthetic db and exit",
    )
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    return run_export(args)


if __name__ == "__main__":
    sys.exit(main())
