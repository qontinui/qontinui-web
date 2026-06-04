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

REPO = "qontinui-web"
DEFAULT_COORD_URL = "https://coord.qontinui.io"
OBSERVE_PATH = "/coord/test-coverage/observe"
RESULTS_PATH = "/coord/test-results/ingest"

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
        files = {row["id"]: row["path"] for row in con.execute("SELECT id, path FROM file")}
        contexts = {
            row["id"]: row["context"] for row in con.execute("SELECT id, context FROM context")
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
            for row in con.execute("SELECT file_id, context_id, numbits FROM line_bits"):
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


def post_json(url: str, payload: dict, *, timeout: float = 30.0) -> None:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = resp.getcode()
        info(f"POST {url} -> {status}")
        if status >= 300:
            raise urllib.error.HTTPError(url, status, "non-2xx", resp.headers, None)


def post_observations(coord_url: str, observations: list[dict]) -> None:
    if not observations:
        info("no observations to post")
        return
    post_json(coord_url.rstrip("/") + OBSERVE_PATH, {"observations": observations})


def post_junit(coord_url: str, junit_path: str, head_sha: str) -> None:
    if not os.path.exists(junit_path):
        warn(f"junit file not found: {junit_path}; skipping results ingest")
        return
    with open(junit_path, encoding="utf-8") as fh:
        raw = fh.read()
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
        post_junit(coord_url, args.junit_xml, head_sha)
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
            (1, "/home/runner/work/qontinui-web/qontinui-web/backend/app/services/foo.py"),
            (2, "app/api/bar.py"),  # backend-relative shape
            (3, "/home/runner/work/qontinui-web/qontinui-web/backend/tests/test_foo.py"),
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
        assert got == expected, f"normalize({nodeid!r}) = {got!r}, expected {expected!r}"

    assert strip_phase_suffix("a::b|run") == "a::b"
    assert strip_phase_suffix("a::b|setup") == "a::b"
    assert strip_phase_suffix("a::b|teardown") == "a::b"
    assert strip_phase_suffix("a::b") == "a::b"

    assert (
        normalize_file_path("/x/backend/app/services/foo.py") == "backend/app/services/foo.py"
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
    assert method["files_touched"] == ["backend/app/services/foo.py"], method["files_touched"]

    param = by_id["tests.test_param::test_p[1-2-3]"]
    assert param["files_touched"] == ["backend/app/api/bar.py"], param["files_touched"]

    # 3. Shape invariants on every observation.
    required = {"repo", "head_sha", "test_id", "files_touched", "lines_covered", "coverage_kind"}
    for o in obs:
        assert required.issubset(o), f"missing keys in {o}"
        assert o["files_touched"], "files_touched must be non-empty"
        assert all(p.startswith("backend/app/") for p in o["files_touched"])

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
        default="junit-results.xml",
        help="path to the JUnit XML to POST to the results ingest",
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
