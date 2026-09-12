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

import importlib.util
import re
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


def test_cli_selects_one_shard_and_writes_it(tmp_path):
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
    assert "ZERO pytest node ids" in capsys.readouterr().err


def test_cli_fails_when_a_shard_would_be_empty(tmp_path, capsys):
    rc = splitter.main(
        ["--nodeids", _write(tmp_path, _REAL_SHAPE), "--shards", "5", "--shard", "5"]
    )
    assert rc == 3
    assert "selected no test files" in capsys.readouterr().err


@pytest.mark.parametrize("shard", ["0", "7"])
def test_cli_rejects_an_out_of_range_shard(tmp_path, shard, capsys):
    rc = splitter.main(
        ["--nodeids", _write(tmp_path, _REAL_SHAPE), "--shards", "6", "--shard", shard]
    )
    assert rc == 1
    assert "--shard must be in" in capsys.readouterr().err


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
