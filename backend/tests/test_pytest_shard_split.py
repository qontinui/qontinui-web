"""The pytest shard splitter, and the workflow wiring that consumes it.

``scripts/ci/split_pytest_shards.py`` is the single home of the rule that turns
one pytest collection into N balanced, disjoint shards. This module pins three
separate things, and the third is the one with teeth:

1. **The lane roster** — which files invoke the gate script (via
   ``tests/gate_lane_roster``, the same position-based rule its five siblings
   use).
2. **The pure function** — completeness, disjointness and determinism of the
   assignment, plus the fail-loud arms. These are the properties that make a
   sharded gate equivalent to the unsharded one.
3. **The workflow wiring** — that ``backend-ci.yml``'s matrix length EQUALS the
   ``--shards`` value the step passes. Nothing else in the repo can catch a
   drift there, and the failure is silent in the worst way: a 6-entry matrix
   passing ``--shards 5`` runs five sixths of the suite and reports green,
   because every shard that DID run passed. A gate that quietly stops covering
   a sixth of its subject is exactly the "vacuous green" this repo has paid for
   before (see ``test_ci_timeout_marker.py``'s carrier census, which exists for
   the same class of miss).

Why the pure function is tested from SYNTHETIC collect output rather than from
a real ``pytest --collect-only`` run: the parser's contract is "accept a node
id line, ignore everything else pytest prints", and synthetic input is the only
way to drive the arms that matter (a warnings preamble, an ERROR banner, the
trailing count summary, and the empty collection). It does mean these tests pin
the parser's contract and cannot themselves prove pytest emits that shape — the
first CI run is what confirms that, and the splitter's fail-loud exit is what
makes a mismatch a red step rather than a narrowed gate.
"""

from __future__ import annotations

import ast
import importlib.util
import io
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_REF = "scripts/ci/split_pytest_shards.py"
SCRIPT_PATH = REPO_ROOT / SCRIPT_REF
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "backend-ci.yml"

#: The ONE lane that invokes the splitter. `.qontinui/ci.toml` is deliberately
#: absent: that manifest's own header records that backend-ci's `test` job
#: cannot run on the runner-as-CI-node lane at all (it provisions no database).
DECLARED_LANES = frozenset({".github/workflows/backend-ci.yml"})

SELECT_STEP_NAME = "Select this shard's test files"
COLLECT_STEP_NAME = "Collect the test suite"


def _load_splitter():
    spec = importlib.util.spec_from_file_location("split_pytest_shards", SCRIPT_PATH)
    assert spec and spec.loader, f"cannot load {SCRIPT_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


splitter = _load_splitter()


# --- the lane roster -------------------------------------------------------


def test_lane_roster_matches_the_tree():
    assert_lane_roster(SCRIPT_REF, DECLARED_LANES)


def test_docstring_names_every_lane():
    assert_docstring_names_every_lane(splitter.__doc__, SCRIPT_REF, DECLARED_LANES)


# --- the parser ------------------------------------------------------------

_REAL_SHAPE = """\
============================= test session starts =============================
platform linux -- Python 3.12.3, pytest-9.0.0, pluggy-1.5.0
rootdir: /home/runner/work/qontinui-web/qontinui-web/backend
configfile: pytest.ini
plugins: cov-6.0.0, asyncio-1.2.0, xdist-3.6.0
collecting ...
tests/test_alpha.py::test_one
tests/test_alpha.py::test_two[a]
tests/test_alpha.py::test_two[b]
tests/sub/test_beta.py::TestGroup::test_three
tests/test_gamma.py::test_four

4129 tests collected in 31.52s
"""


def test_parser_keeps_only_nodeid_lines():
    ids = splitter.parse_nodeids(_REAL_SHAPE)
    assert ids == [
        "tests/test_alpha.py::test_one",
        "tests/test_alpha.py::test_two[a]",
        "tests/test_alpha.py::test_two[b]",
        "tests/sub/test_beta.py::TestGroup::test_three",
        "tests/test_gamma.py::test_four",
    ]


@pytest.mark.parametrize(
    "noise",
    [
        "4129 tests collected in 31.52s",
        "=========================== warnings summary ===========================",
        "ERROR tests/test_alpha.py - ImportError: boom",
        "!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!",
        "",
        "   ",
        "no_extension_here",
        "rootdir: /home/runner/work",
    ],
)
def test_parser_rejects_everything_that_is_not_a_nodeid(noise):
    assert splitter.parse_nodeids(noise) == []


def test_weights_count_parametrized_cases_not_functions():
    weights = splitter.file_weights(splitter.parse_nodeids(_REAL_SHAPE))
    # test_two is ONE function and TWO collected tests; the weight is 3, not 2.
    assert weights == {
        "tests/test_alpha.py": 3,
        "tests/sub/test_beta.py": 1,
        "tests/test_gamma.py": 1,
    }


# --- the assignment --------------------------------------------------------


def _corpus(n_files: int = 37) -> dict[str, int]:
    """A deliberately skewed corpus: a few very heavy files, a long tail."""
    weights = {}
    for i in range(n_files):
        weights[f"tests/test_{i:03d}.py"] = 200 if i < 3 else (1 + (i * 7) % 23)
    return weights


@pytest.mark.parametrize("shards", [1, 2, 3, 4, 6, 8])
def test_assignment_is_complete_and_disjoint(shards):
    weights = _corpus()
    bins = splitter.assign(weights, shards)

    assert len(bins) == shards
    flat = [path for b in bins for path in b]
    assert sorted(flat) == sorted(weights), "every collected file must be assigned"
    assert len(flat) == len(set(flat)), "no file may appear in two shards"


def test_assignment_is_independent_of_input_order():
    weights = _corpus()
    shuffled = dict(reversed(list(weights.items())))
    assert splitter.assign(weights, 6) == splitter.assign(shuffled, 6)


def test_assignment_is_stable_across_repeated_runs():
    weights = _corpus()
    assert splitter.assign(weights, 6) == splitter.assign(weights, 6)


def test_assignment_balances_a_skewed_corpus():
    weights = _corpus()
    shards = 6
    bins = splitter.assign(weights, shards)
    loads = [sum(weights[p] for p in b) for b in bins]
    ideal = sum(weights.values()) / shards
    # LPT on a corpus whose heaviest file is ~200 against an ideal of ~130
    # cannot beat that file; the bound is what keeps the worst shard sane.
    assert max(loads) <= ideal * 1.75, f"loads {loads} vs ideal {ideal}"


def test_assign_refuses_a_nonsense_shard_count():
    with pytest.raises(ValueError):
        splitter.assign({"tests/test_a.py": 1}, 0)


# --- the CLI's failure arms ------------------------------------------------


def _write(tmp_path: Path, text: str) -> str:
    path = tmp_path / "nodeids.txt"
    path.write_text(text, encoding="utf-8")
    return str(path)


def _verdict(capsys, rc: int, verdict: str, **expected: object) -> dict[str, str]:
    """The run's machine-readable verdict line, checked against `rc` and `expected`.

    Tests read THIS line, never the ``::error::`` prose: pinning prose broke a
    substring test four times across the review of the PR that introduced the
    splitter, and the prose is meant for people and free to change.
    """
    err = capsys.readouterr().err
    fields = splitter.parse_verdict(err)
    assert fields is not None, f"no verdict line on stderr:\n{err}"
    assert fields["verdict"] == verdict, fields
    assert fields["exit"] == str(rc), fields
    for key, value in expected.items():
        assert fields.get(key) == str(value), f"{key}: {fields}"
    return fields


def test_cli_selects_one_shard_and_writes_it(tmp_path, capsys):
    out = tmp_path / "shard.txt"
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--shards",
            "2",
            "--shard",
            "1",
            "--out",
            str(out),
        ]
    )
    assert rc == 0
    selected = out.read_text(encoding="utf-8").split()
    assert selected, "a shard of a 3-file corpus must not be empty"
    assert all(p.endswith(".py") for p in selected)
    _verdict(
        capsys,
        0,
        "ok",
        mode="select",
        shards=2,
        shard=1,
        files=3,
        nodeids=5,
        selected_files=len(selected),
    )


def test_cli_shards_partition_the_corpus(tmp_path):
    nodeids = _write(tmp_path, _REAL_SHAPE)
    seen: list[str] = []
    for shard in (1, 2, 3):
        out = tmp_path / f"s{shard}.txt"
        rc = splitter.main(
            [
                "--nodeids",
                nodeids,
                "--shards",
                "3",
                "--shard",
                str(shard),
                "--out",
                str(out),
            ]
        )
        assert rc == 0
        seen.extend(out.read_text(encoding="utf-8").split())
    assert sorted(seen) == [
        "tests/sub/test_beta.py",
        "tests/test_alpha.py",
        "tests/test_gamma.py",
    ]


def test_cli_fails_loudly_on_an_empty_collection(tmp_path, capsys):
    """The arm that stops a whole-suite blowup.

    An empty selection handed to pytest makes it collect `tests/` entirely, so
    every shard would run the full suite — or, with a narrowed invocation,
    silently run nothing. Exit non-zero instead.
    """
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, "no nodeids here\n"),
            "--shards",
            "4",
            "--shard",
            "1",
        ]
    )
    assert rc == 2
    _verdict(capsys, 2, "no_nodeids", nodeids=0)


def test_cli_fails_when_a_shard_would_be_empty(tmp_path, capsys):
    rc = splitter.main(
        ["--nodeids", _write(tmp_path, _REAL_SHAPE), "--shards", "5", "--shard", "5"]
    )
    assert rc == 3
    _verdict(capsys, 3, "empty_shard", shards=5, shard=5, files=3)


@pytest.mark.parametrize("shard", ["0", "7"])
def test_cli_rejects_an_out_of_range_shard(tmp_path, shard, capsys):
    rc = splitter.main(
        ["--nodeids", _write(tmp_path, _REAL_SHAPE), "--shards", "6", "--shard", shard]
    )
    assert rc == 1
    _verdict(capsys, 1, "bad_args", reason="shard_out_of_range")


def test_cli_requires_shard_args_unless_counting(tmp_path, capsys):
    rc = splitter.main(["--nodeids", _write(tmp_path, _REAL_SHAPE)])
    assert rc == 1
    _verdict(capsys, 1, "bad_args", reason="shard_args_missing")


# --- the verdict line ------------------------------------------------------
#
# Every run of `main` ends with ONE machine-readable line on stderr. These pin
# its framing and that every exit path produces it; the tests above pin its
# content per arm.

_NO_NODEIDS = "no nodeids here\n"
_OK_SELECT = ["--shards", "2", "--shard", "1"]

#: One row per exit path of `main`: (collect output, or None for an unreadable
#: --nodeids path; extra argv, where `{tmp}` is the test's tmp dir; exit code;
#: verdict; fields the verdict line must carry). The reachable vocabulary is
#: derived from THIS table and nothing else.
_EVERY_EXIT = [
    (_REAL_SHAPE, _OK_SELECT, 0, "ok", {"mode": "select"}),
    (
        _REAL_SHAPE,
        ["--count-only", "--min-files", "3", "--min-nodeids", "5"],
        0,
        "ok",
        {"mode": "count"},
    ),
    (
        _REAL_SHAPE,
        ["--count-only", "--min-files", "0"],
        1,
        "bad_args",
        {"reason": "min_files_not_positive"},
    ),
    (
        _REAL_SHAPE,
        ["--count-only", "--min-files", "3", "--min-nodeids", "0"],
        1,
        "bad_args",
        {"reason": "min_nodeids_not_positive"},
    ),
    (_REAL_SHAPE, [], 1, "bad_args", {"reason": "shard_args_missing"}),
    (
        _REAL_SHAPE,
        ["--shards", "0", "--shard", "1"],
        1,
        "bad_args",
        {"reason": "shards_not_positive"},
    ),
    (
        _REAL_SHAPE,
        ["--shards", "6", "--shard", "7"],
        1,
        "bad_args",
        {"reason": "shard_out_of_range"},
    ),
    (None, _OK_SELECT, 1, "io_error", {"stage": "read"}),
    (
        _REAL_SHAPE,
        [*_OK_SELECT, "--out", "{tmp}/no/such/dir/shard.txt"],
        1,
        "io_error",
        {"stage": "write", "shard": "1"},
    ),
    (_NO_NODEIDS, _OK_SELECT, 2, "no_nodeids", {"nodeids": "0"}),
    (_REAL_SHAPE, ["--shards", "5", "--shard", "5"], 3, "empty_shard", {}),
    (
        _REAL_SHAPE,
        ["--count-only", "--min-files", "10", "--min-nodeids", "1"],
        4,
        "truncated",
        {"missed": "files"},
    ),
]


@pytest.mark.parametrize(("text", "extra", "rc", "verdict", "fields"), _EVERY_EXIT)
def test_every_exit_path_ends_with_exactly_one_verdict_line(
    tmp_path, capsys, text, extra, rc, verdict, fields
):
    nodeids = str(tmp_path / "absent.txt") if text is None else _write(tmp_path, text)
    argv = [arg.replace("{tmp}", str(tmp_path)) for arg in extra]
    assert splitter.main(["--nodeids", nodeids, *argv]) == rc

    lines = capsys.readouterr().err.splitlines()
    verdict_lines = [ln for ln in lines if splitter.is_verdict_line(ln)]
    assert len(verdict_lines) == 1, lines
    assert lines[-1] == verdict_lines[0], "the verdict line must be the LAST line"
    parsed = splitter.parse_verdict(lines[-1])
    assert parsed is not None
    assert (parsed["verdict"], parsed["exit"]) == (verdict, str(rc))
    for key, value in fields.items():
        assert parsed.get(key) == value, f"{key}: {parsed}"


def test_every_verdict_in_the_vocabulary_is_reachable():
    """A verdict nothing emits is dead vocabulary; one missing here is untested."""
    assert {row[3] for row in _EVERY_EXIT} == splitter.VERDICTS


def test_help_renders():
    """`--help` must print, not raise: a bare `%` in help text crashes argparse."""
    with pytest.raises(SystemExit) as excinfo:
        splitter.main(["--help"])
    assert excinfo.value.code == 0


def _finish_call_sites() -> list[tuple[str, frozenset[str], dict[str, object]]]:
    """Each `_finish(...)` call in the script: (verdict, field names, literals).

    Every site is distinguishable by these three: the verdict literal, the set
    of keyword names it passes, and the values of those keywords that are
    literals (`reason=`, `stage=`, `nodeids=0`).
    """
    tree = ast.parse(SCRIPT_PATH.read_text(encoding="utf-8"))
    sites = []
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_finish"
        ):
            continue
        verdict = node.args[1]
        assert isinstance(verdict, ast.Constant), f"line {node.lineno}: verdict"
        keys = frozenset(kw.arg for kw in node.keywords if kw.arg)
        literals = {
            kw.arg: kw.value.value
            for kw in node.keywords
            if kw.arg and isinstance(kw.value, ast.Constant)
        }
        sites.append((verdict.value, keys, literals))
    return sites


def test_the_table_maps_one_to_one_onto_the_finish_call_sites(tmp_path, capsys):
    """Every exit path has exactly one row, and every row exercises a different one.

    Neither a count nor row uniqueness proves that: a near-duplicate row (one
    extra field) could replace a deleted row and pass both. So each row is RUN,
    its verdict line is matched against the call sites read from the source,
    and the rows must hit every site exactly once.
    """
    sites = _finish_call_sites()
    hit_by_row = []
    for index, (text, extra, _, _, _) in enumerate(_EVERY_EXIT):
        row_dir = tmp_path / f"row{index}"
        row_dir.mkdir()
        nodeids = str(row_dir / "absent.txt") if text is None else _write(row_dir, text)
        argv = [arg.replace("{tmp}", str(row_dir)) for arg in extra]
        splitter.main(["--nodeids", nodeids, *argv])
        parsed = splitter.parse_verdict(capsys.readouterr().err)
        assert parsed is not None, f"row {index} printed no verdict line"
        produced = set(parsed) - {"verdict", "exit"}
        hits = [
            site
            for site, (verdict, keys, literals) in enumerate(sites)
            if verdict == parsed["verdict"]
            and keys == produced
            and all(str(value) == parsed.get(key) for key, value in literals.items())
        ]
        assert len(hits) == 1, f"row {index} ({parsed}) matches call sites {hits}"
        hit_by_row.append(hits[0])
    assert sorted(hit_by_row) == list(range(len(sites))), (
        f"rows hit call sites {sorted(hit_by_row)} of {len(sites)}; every "
        "`_finish` call needs exactly one row"
    )


def test_every_return_in_main_goes_through_finish():
    """A bare `return N` in `main` would exit with no verdict line, untested."""
    tree = ast.parse(SCRIPT_PATH.read_text(encoding="utf-8"))
    main = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "main"
    )
    returns = [node for node in ast.walk(main) if isinstance(node, ast.Return)]
    assert returns, "`main` has no return statements at all"
    for node in returns:
        call = node.value
        assert (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id == "_finish"
        ), f"`main` line {node.lineno} returns without `_finish`"
    # `sys.exit(n)` / `raise SystemExit` exit without a verdict line too, and
    # falling off the end of `main` returns None.
    for node in ast.walk(main):
        if isinstance(node, ast.Raise):
            assert "SystemExit" not in ast.unparse(node), (
                f"`main` line {node.lineno} raises SystemExit"
            )
        if isinstance(node, ast.Call):
            # `parser.error(...)` is the idiomatic argparse way to add a check
            # after parse_args, and exits 2 with no verdict line; so does
            # `parser.exit(...)`. Matched on the parser object only, so a
            # `log.error(...)` is not mistaken for an exit.
            name = ast.unparse(node.func)
            exits = name in {
                "sys.exit",
                "exit",
                "quit",
                "os._exit",
                "parser.error",
                "parser.exit",
            }
            assert not exits, (
                f"`main` line {node.lineno} exits via `{name}` without `_finish`"
            )
    assert isinstance(main.body[-1], ast.Return), "`main` can fall off its end"
    # The name match above is escaped by importing an exit under another name.
    aliased = [
        f"line {node.lineno}: from {node.module} import {alias.name}"
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
        if (node.module, alias.name) in {("sys", "exit"), ("os", "_exit")}
    ]
    assert not aliased, f"an exit imported by name escapes this guard: {aliased}"


def test_an_in_process_text_stdin_without_a_buffer_still_works(monkeypatch, capsys):
    """`io.StringIO` has no `.buffer`; reading stdin must not assume one."""
    monkeypatch.setattr(sys, "stdin", io.StringIO(_REAL_SHAPE))
    rc = splitter.main(
        ["--nodeids", "-", "--count-only", "--min-files", "3", "--min-nodeids", "5"]
    )
    assert rc == 0
    _verdict(capsys, 0, "ok", files=3, nodeids=5)


def test_a_closed_stdin_is_io_error(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", None)
    rc = splitter.main(["--nodeids", "-", *_OK_SELECT])
    assert rc == 1
    _verdict(capsys, 1, "io_error", stage="read")


def test_a_nul_byte_in_nodeids_is_io_error(capsys):
    rc = splitter.main(["--nodeids", "bad\0path", *_OK_SELECT])
    assert rc == 1
    _verdict(capsys, 1, "io_error", stage="read")


def test_a_nul_byte_in_out_is_io_error(tmp_path, capsys):
    nodeids = _write(tmp_path, _REAL_SHAPE)
    rc = splitter.main(["--nodeids", nodeids, *_OK_SELECT, "--out", "bad\0path"])
    assert rc == 1
    _verdict(capsys, 1, "io_error", stage="write")


def test_a_closed_stdout_is_io_error(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdout", None)
    rc = splitter.main(["--nodeids", _write(tmp_path, _REAL_SHAPE), *_OK_SELECT])
    monkeypatch.undo()
    assert rc == 1
    _verdict(capsys, 1, "io_error", stage="write")


def test_the_docstring_example_is_what_the_script_writes(tmp_path, capsys):
    """The Output contract's sample line is what a new reader codes against."""
    example = next(
        line.strip()
        for line in (splitter.__doc__ or "").splitlines()
        if line.strip().startswith(splitter.VERDICT_PREFIX)
    )
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--count-only",
            "--min-files",
            "10",
            "--min-nodeids",
            "1",
        ]
    )
    assert rc == 4
    assert capsys.readouterr().err.splitlines()[-1] == example


def test_no_print_in_the_script_targets_sys_stderr_directly():
    """Only `_stderr()` may reach stderr, and every `print` must name a target.

    `sys.stderr` is None when stderr is closed: `print(file=None)` then writes
    to STDOUT -- the shard's file list when `--out` is not given -- and
    `sys.stderr.write(...)` raises AttributeError with no verdict line. A `print`
    with no `file=` writes to stdout outright. The closed-stderr tests run only
    two paths; this covers every call site, however it is spelled.
    """
    tree = ast.parse(SCRIPT_PATH.read_text(encoding="utf-8"))
    helper = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "_stderr"
    )
    inside_helper = {id(node) for node in ast.walk(helper)}
    offenders = []
    for node in ast.walk(tree):
        if id(node) in inside_helper:
            continue
        if isinstance(node, ast.Attribute) and ast.unparse(node) == "sys.stderr":
            offenders.append(f"line {node.lineno}: sys.stderr")
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "print"
            and not any(kw.arg == "file" for kw in node.keywords)
        ):
            offenders.append(f"line {node.lineno}: print without file=")
        if (
            isinstance(node, ast.ImportFrom)
            and node.module == "sys"
            and any(alias.name == "stderr" for alias in node.names)
        ):
            offenders.append(f"line {node.lineno}: from sys import stderr")
    assert not offenders, f"stderr access bypasses `_stderr()`: {offenders}"


def test_a_closed_stderr_on_an_error_path_writes_nothing_to_stdout(
    tmp_path, monkeypatch, capsys
):
    nodeids = _write(tmp_path, _REAL_SHAPE)
    monkeypatch.setattr(sys, "stderr", None)
    rc = splitter.main(["--nodeids", nodeids, "--shards", "0", "--shard", "1"])
    monkeypatch.undo()
    assert rc == 1
    assert capsys.readouterr().out == ""


def test_a_closed_stderr_never_leaks_into_the_selection(tmp_path, monkeypatch, capsys):
    """`print(file=None)` writes to STDOUT -- which here is the list pytest runs."""
    nodeids = _write(tmp_path, _REAL_SHAPE)
    monkeypatch.setattr(sys, "stderr", None)
    rc = splitter.main(["--nodeids", nodeids, "--shards", "1", "--shard", "1"])
    monkeypatch.undo()
    assert rc == 0
    assert capsys.readouterr().out.splitlines() == [
        "tests/sub/test_beta.py",
        "tests/test_alpha.py",
        "tests/test_gamma.py",
    ]


def test_stdin_with_a_non_utf8_byte_still_ends_in_a_verdict(monkeypatch, capsys):
    raw = b"tests/test_\xff.py::test_one\ntests/test_b.py::test_two\n"
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(raw), "utf-8"))
    rc = splitter.main(
        ["--nodeids", "-", "--count-only", "--min-files", "2", "--min-nodeids", "2"]
    )
    assert rc == 0
    _verdict(capsys, 0, "ok", files=2, nodeids=2)


class _FullStdout(io.StringIO):
    """A stdout whose buffered write only fails when flushed, once."""

    armed = True

    def flush(self):
        if self.armed:
            self.armed = False
            raise OSError(28, "No space left on device")


def test_a_failed_stdout_flush_is_io_error_not_ok(tmp_path, monkeypatch, capsys):
    """Without an explicit flush the failure lands at shutdown, after `ok exit=0`."""
    monkeypatch.setattr(sys, "stdout", _FullStdout())
    rc = splitter.main(["--nodeids", _write(tmp_path, _REAL_SHAPE), *_OK_SELECT])
    assert rc == 1
    _verdict(capsys, 1, "io_error", stage="write")


@pytest.mark.skipif(not Path("/dev/full").exists(), reason="needs /dev/full")
def test_a_full_stdout_exits_1_with_the_verdict_last_for_real(tmp_path):
    """The in-process test above cannot see interpreter shutdown; this one can.

    Measured before `_abandon_stdout`: the run printed `io_error exit=1`, then
    the exit-time flush of the still-buffered bytes failed again, turned the
    exit code into 120 and printed `Exception ignored ...` AFTER the verdict.
    """
    nodeids = _write(tmp_path, _REAL_SHAPE)
    with open("/dev/full", "w", encoding="utf-8") as full:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--nodeids", nodeids, *_OK_SELECT],
            stdout=full,
            stderr=subprocess.PIPE,
            text=True,
        )
    assert proc.returncode == 1, proc.stderr
    lines = proc.stderr.splitlines()
    assert lines and splitter.is_verdict_line(lines[-1]), proc.stderr
    parsed = splitter.parse_verdict(lines[-1])
    assert parsed is not None
    assert (parsed["verdict"], parsed["stage"]) == ("io_error", "write")


def test_parse_verdict_reads_the_last_verdict_line_among_prose():
    text = (
        "::error::a human-facing explanation that may change at will\n"
        "shard-split: verdict=truncated files=1 exit=4\n"
        "shard-split: verdict=ok mode=count files=3 exit=0\n"
        "trailing prose\n"
    )
    assert splitter.parse_verdict(text) == {
        "verdict": "ok",
        "mode": "count",
        "files": "3",
        "exit": "0",
    }


def test_parse_verdict_is_none_when_there_is_no_verdict_line():
    assert splitter.parse_verdict("collection OK: 3 test files\n") is None


@pytest.mark.parametrize(
    "line",
    [
        "shard-split: verdict=ok files exit=0",  # token without `=`
        "shard-split: verdict=ok files=1 files=2 exit=0",  # duplicate key
        "shard-split: verdict=maybe exit=0",  # verdict outside the vocabulary
        "shard-split: verdict=ok files=1",  # no exit code
        "shard-split: exit=0 verdict=ok",  # verdict not first, exit not last
        "shard-split: verdict=ok exit=abc",  # non-integer exit
        "shard-split: verdict=ok k=a=b exit=0",  # `=` inside a value
        "shard-split: verdict=ok k= exit=0",  # empty value
        "shard-split:",  # prefix with nothing after it
        "shard-split:verdict=ok exit=0",  # no space after the prefix
        "shard-split: verdict=ok exit=--5",  # not an integer
        "shard-split: verdict=ok exit=²",  # a Unicode digit, not an ASCII one
        "shard-split: verdict=ok exit=-0",  # not the canonical spelling of 0
        "shard-split: verdict=ok exit=007",  # leading zeros
        "shard-split:  verdict=ok   exit=0",  # runs of spaces
        "shard-split: verdict=ok\texit=0",  # a tab between tokens
        "shard-split: verdict=ok exit=0  ",  # trailing whitespace
        "  shard-split: verdict=ok exit=0",  # indented: claimed, not canonical
        # A malformed EARLIER line must not be skipped for a good last one.
        "shard-split: garbage\nshard-split: verdict=ok exit=0",
    ],
)
def test_parse_verdict_refuses_a_malformed_line(line):
    with pytest.raises(ValueError):
        splitter.parse_verdict(line)


@pytest.mark.parametrize(
    "fields",
    [
        {"reason": "two words"},  # whitespace in a value
        {"reason": "a=b"},  # `=` in a value
        {"reason": ""},  # empty value
        {"exit": "3"},  # reserved key: would emit `exit` twice
        {"verdict": "ok"},  # reserved key: would emit `verdict` twice
        {"": "1"},  # empty key
    ],
)
def test_format_verdict_refuses_what_parse_verdict_would_reject(fields):
    with pytest.raises(ValueError):
        splitter.format_verdict("bad_args", 1, **fields)


@pytest.mark.parametrize("exit_code", ["abc", True, 1.0])
def test_format_verdict_refuses_a_non_int_exit_code(exit_code):
    with pytest.raises(ValueError):
        splitter.format_verdict("ok", exit_code)


def test_format_and_parse_round_trip():
    line = splitter.format_verdict("truncated", 4, mode="count", missed="both")
    assert splitter.parse_verdict(line) == {
        "verdict": "truncated",
        "mode": "count",
        "missed": "both",
        "exit": "4",
    }


# --- the truncation floor --------------------------------------------------
#
# A truncated collection is the ONE shape the split cannot survive silently: it
# shards cleanly and every shard goes green while covering part of the suite.
# The floor is therefore checked where the node ids are already parsed, and it
# is the caller's on-disk file count rather than a constant.


def test_count_only_accepts_a_complete_collection(tmp_path, capsys):
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--count-only",
            "--min-files",
            "3",
            "--min-nodeids",
            "5",
        ]
    )
    assert rc == 0
    _verdict(
        capsys, 0, "ok", mode="count", files=3, nodeids=5, min_files=3, min_nodeids=5
    )


def test_count_only_refuses_a_zero_floor(tmp_path, capsys):
    """The checking mode must not be satisfiable by a floor of nothing.

    Its one caller derives the floor in shell, and a derived value can arrive as
    0 (a pipeline reports the exit status of its LAST command, so
    `find … | wc -l` succeeds even when `find` failed). A zero floor there is a
    gate that passes vacuously, so the mode refuses it outright rather than
    trusting every caller to validate.
    """
    rc = splitter.main(
        ["--nodeids", _write(tmp_path, _REAL_SHAPE), "--count-only", "--min-files", "0"]
    )
    assert rc == 1
    _verdict(capsys, 1, "bad_args", mode="count", reason="min_files_not_positive")


def test_count_only_refuses_a_zero_node_id_floor(tmp_path, capsys):
    """The second floor gets the same validation as the first.

    It was accepted silently at 0 and at -99 while `--min-files 0` was refused --
    an asymmetry in the commit that added it. The node-id floor is the one that
    catches a collection keeping most FILES while losing most TESTS, so an
    accidental zero there is the more expensive of the two.
    """
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--count-only",
            "--min-files",
            "3",
            "--min-nodeids",
            "0",
        ]
    )
    assert rc == 1
    _verdict(capsys, 1, "bad_args", mode="count", reason="min_nodeids_not_positive")


def test_count_only_rejects_a_node_id_shortfall(tmp_path, capsys):
    """The FILE floor alone is loose; the node-id floor is what closes it.

    Measured on the real tree: dropping the 53 heaviest collectable files keeps
    173 of 231 files — passing a 3/4 file floor — while losing 62% of the test
    functions. So a collection can satisfy the file floor and still be gutted.
    """
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--count-only",
            "--min-files",
            "3",
            "--min-nodeids",
            "99",
        ]
    )
    assert rc == 4
    _verdict(
        capsys,
        4,
        "truncated",
        missed="nodeids",
        files=3,
        nodeids=5,
        min_files=3,
        min_nodeids=99,
    )


def test_a_truncated_verdict_names_both_floors_when_both_are_missed(tmp_path, capsys):
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--count-only",
            "--min-files",
            "10",
            "--min-nodeids",
            "99",
        ]
    )
    assert rc == 4
    _verdict(capsys, 4, "truncated", missed="both")


def test_count_only_rejects_a_truncated_collection(tmp_path, capsys):
    """The floor's whole purpose: fewer files present than the tree has."""
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--count-only",
            "--min-files",
            "10",
            "--min-nodeids",
            "1",
        ]
    )
    assert rc == 4
    # `missed` names which floor failed; both counts and floors ride along.
    _verdict(
        capsys,
        4,
        "truncated",
        missed="files",
        files=3,
        nodeids=5,
        min_files=10,
        min_nodeids=1,
    )


def test_the_floor_also_guards_a_real_shard_selection(tmp_path, capsys):
    """Not only the --count-only pass: a short collection must never be sharded."""
    rc = splitter.main(
        [
            "--nodeids",
            _write(tmp_path, _REAL_SHAPE),
            "--shards",
            "2",
            "--shard",
            "1",
            "--min-files",
            "10",
        ]
    )
    assert rc == 4
    _verdict(capsys, 4, "truncated", mode="select", missed="files", min_files=10)


def test_the_floors_are_off_by_default_on_the_selection_path(tmp_path):
    """Absent floors, the splitter must not invent one of its own.

    This is the LIBRARY default and it applies to the selection path. The
    checking mode is deliberately stricter — see
    `test_count_only_refuses_a_zero_floor`.
    """
    rc = splitter.main(
        ["--nodeids", _write(tmp_path, _REAL_SHAPE), "--shards", "2", "--shard", "1"]
    )
    assert rc == 0


def test_the_collect_step_checks_the_floor_through_the_splitter():
    """The step must not grow a second copy of the node-id rule again.

    Two copies disagreed (the bash one accepted `:`/`[`/`]` in a path and
    over-counted), and `$(grep -c … || true)` fed an empty string into a numeric
    test, which fails OPEN. So the pins are: the step calls the splitter's
    counting mode, derives the floor from the tree, and carries no hardcoded
    numeric floor of its own.
    """
    run = _step(_shard_job(), COLLECT_STEP_NAME)["run"]
    assert "--count-only" in run, "the collect step must check the collection"
    assert "--min-files" in run, "the collect step must pass a truncation floor"
    assert "find tests -name 'test_*.py'" in run, (
        "the floor must be DERIVED from the on-disk test files, not hardcoded"
    )
    assert "expected_files * 3 / 4" in run, (
        "the floor must stay a FRACTION of the on-disk count: conftest sets "
        "collect_ignore (5 of 231 files today), so an exact floor reds a correct "
        "collection, and hardcoding the ignore list here is the drift this "
        "replaced"
    )
    assert "--min-nodeids" in run, (
        "a FILE floor alone is loose: 173 of 231 files can remain while 62% of "
        "the tests are gone, so the node-id floor must be passed too"
    )
    # Three ARMS, pinned individually. `find … | wc -l` reports wc's exit status,
    # so a failed find yields 0 and an unvalidated floor disarms itself; and a
    # non-numeric value makes `[ x -lt 100 ]` print an error and PROCEED. Pinning
    # the whole condition as one string broke the moment an arm was added, which
    # is the substring-pin lesson this file has now learned four times.
    for arm, why in (
        ('[ -z "${expected_files}" ]', "an empty value must be UNKNOWN"),
        ('[ -n "${expected_files//[0-9]/}" ]', "a non-numeric value must be UNKNOWN"),
        ("-lt 100", "an implausibly small count must be UNKNOWN"),
    ):
        assert arm in run, f"the derived floor must be validated: {why} ({arm})"
    # The two NEGATIVE pins run against comment-stripped text. The step's prose
    # deliberately explains why the bash grep and the constant floor were
    # removed, and a naive substring check matches that explanation and fails on
    # a correct step -- which it did, on the first run of this very test. What is
    # being pinned is what the step RUNS, not what it says about its own history.
    code = "\n".join(
        line for line in run.splitlines() if not line.strip().startswith("#")
    )
    assert "-lt 500" not in code, (
        "a hardcoded node-id floor is what this replaced; 32 of 231 files clear "
        "500, so it passed a 7x-truncated collection"
    )
    assert "grep -c" not in code, (
        "the node-id rule must have exactly one implementation, in the splitter"
    )


# --- the workflow wiring ---------------------------------------------------


def _workflow() -> dict:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(doc, dict), f"{WORKFLOW} did not parse as a mapping"
    return doc


def _shard_job() -> dict:
    job = _workflow()["jobs"]["test"]
    assert isinstance(job, dict), "backend-ci.yml has no `test` job"
    return job


def _step(job: dict, name: str) -> dict:
    for step in job.get("steps") or []:
        if step.get("name") == name:
            return step
    raise AssertionError(f"the `test` job has no step named {name!r}")


def _collect_flags() -> list[str]:
    """The flags the workflow's OWN collect step passes — derived, not restated.

    Deriving them is the whole point: a test that hardcoded the flags would keep
    passing when the workflow's flags changed, which is exactly the drift that
    broke the first CI run of this change.
    """
    run = _step(_shard_job(), COLLECT_STEP_NAME)["run"]
    match = re.search(r"pytest\s+tests/\s+([^\n>]*)", run)
    assert match, f"no `pytest tests/` invocation in the {COLLECT_STEP_NAME!r} step"
    return [tok for tok in match.group(1).split() if tok != "\\"]


def test_the_workflows_own_collect_flags_emit_parseable_nodeids(tmp_path):
    """Pins the collect output SHAPE against this repo's REAL pytest.ini.

    This is the test that would have caught the first CI run's failure, and it
    is worth spelling out why the synthetic fixtures above could not. `-q` does
    not SET quiet, it DECREMENTS verbosity; `pytest.ini`'s `addopts` carry `-v`,
    so a lone `-q` lands on verbosity 0 — and at verbosity 0 `--collect-only`
    prints the indented `<Module ...>` / `<Function ...>` tree, in which no line
    matches a node id. Measured on the first run: 5157 output lines, ZERO node
    ids, all six shards red before a single test executed.

    So this test runs pytest FOR REAL, with the flags taken out of the workflow
    step and against a copy of this repo's own pytest.ini. It fails on the
    broken flag set and passes on the fixed one, and because the flags are
    derived rather than restated it also catches a future `addopts` edit that
    re-breaks the collection.
    """
    (tmp_path / "pytest.ini").write_text(
        (REPO_ROOT / "backend" / "pytest.ini").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_probe.py").write_text(
        "import pytest\n"
        "\n"
        "\n"
        "def test_one():\n"
        "    pass\n"
        "\n"
        "\n"
        "@pytest.mark.parametrize('x', [1, 2])\n"
        "def test_two(x):\n"
        "    pass\n",
        encoding="utf-8",
    )

    flags = _collect_flags()
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", *flags],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    nodeids = splitter.parse_nodeids(proc.stdout)

    assert nodeids, (
        "the workflow's own collect flags produced NO parseable node ids against "
        f"backend/pytest.ini.\nflags: {flags}\nexit: {proc.returncode}\n"
        f"stdout:\n{proc.stdout[:2000]}\nstderr:\n{proc.stderr[:1000]}"
    )
    # 3 collected tests: test_one, plus test_two[1] and test_two[2].
    assert len(nodeids) == 3, f"expected 3 node ids, got {nodeids}"


def test_the_matrix_length_equals_the_shard_count_the_step_passes():
    """The invariant nothing else can catch.

    `strategy.matrix.shard` decides how many jobs run; `--shards N` decides how
    the suite is divided. If they disagree the lane is silently partial: with a
    6-entry matrix and `--shards 5`, shard 6 exits 3 (loud) — but with a
    5-entry matrix and `--shards 6`, a sixth of the suite is simply never run
    and every job reports green.
    """
    job = _shard_job()
    matrix = job["strategy"]["matrix"]["shard"]
    assert isinstance(matrix, list) and matrix, (
        "the shard matrix must be a non-empty list"
    )
    assert matrix == list(range(1, len(matrix) + 1)), (
        f"the shard matrix must be 1..N with no gaps, got {matrix}"
    )

    run = _step(job, SELECT_STEP_NAME)["run"]
    declared = re.findall(r"--shards\s+(\d+)", run)
    assert declared, f"the {SELECT_STEP_NAME!r} step passes no --shards value"
    assert {int(d) for d in declared} == {len(matrix)}, (
        f"the shard matrix has {len(matrix)} entries but the step passes "
        f"--shards {declared}; a mismatch runs only part of the suite and "
        "still reports green"
    )
    assert "${{ matrix.shard }}" in run, (
        f"the {SELECT_STEP_NAME!r} step must pass this job's own matrix value as "
        "--shard, or every shard runs the same slice"
    )


def test_the_shard_job_never_falls_back_to_the_whole_directory():
    """`pytest tests/` in the sharded job would defeat the split entirely."""
    job = _shard_job()
    for step in job.get("steps") or []:
        run = str(step.get("run") or "")
        if "poetry run pytest" not in run:
            continue
        if step.get("name") == COLLECT_STEP_NAME:
            continue  # collection is SUPPOSED to walk the whole directory
        assert "pytest tests/" not in run, (
            f"step {step.get('name')!r} runs the whole tests/ directory; the "
            "sharded job must run only its selected file list"
        )


def test_the_run_tests_check_name_survives_as_an_aggregator():
    """`Run Tests` must keep existing as a check on every head.

    coord waits on every check run it has seen on a head, and anything keyed on
    that context (a future required-check entry, a human reading the PR) breaks
    if the name simply disappears when the work moves into a matrix. The shard
    jobs carry their own names; one aggregator keeps `Run Tests`.
    """
    jobs = _workflow()["jobs"]
    aggregators = [
        (jid, job)
        for jid, job in jobs.items()
        if isinstance(job, dict) and job.get("name") == "Run Tests"
    ]
    assert len(aggregators) == 1, (
        f"expected exactly one job named 'Run Tests', found {[j for j, _ in aggregators]}"
    )
    jid, job = aggregators[0]
    assert jid != "test", (
        "the aggregator must be a separate job from the sharded `test` matrix"
    )
    needs = job.get("needs")
    needs = [needs] if isinstance(needs, str) else list(needs or [])
    assert "test" in needs, f"job {jid!r} must `needs: test`, got {needs!r}"
    assert "always()" in str(job.get("if", "")), (
        f"job {jid!r} must run with if: always(), or a failed shard skips the "
        "aggregator and the check goes missing instead of red"
    )


def test_the_shard_job_names_itself_per_shard():
    name = _shard_job().get("name", "")
    assert "${{ matrix.shard }}" in name, (
        f"the sharded job's name must include its matrix value, got {name!r}"
    )
