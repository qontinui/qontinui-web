"""Regression tests for the alembic sibling-head gate's graph + advice.

Plan ``2026-08-24-web-alembic-heads-pr-strands-989-1048``. The gate itself
(``scripts/ci/count_alembic_heads.py``) has been correct and blocking since
2026-05-08; what stranded qontinui-web #989 for 9.7 days and #1048 for 2.2
days was the **advice**, which recommended ``alembic merge`` — permanent
bookkeeping — for a case whose actual fix was a one-token ``down_revision``
edit. These tests pin the properties that make the advice right:

1. The head computation is unchanged (a revision is a head iff nothing names
   it as a parent), including the branch-merge tuple form.
2. When one head has landed and one has not, the remedy is ``repoint`` and
   the target is the LANDED head.
3. The file to edit is the shallowest UNLANDED revision on the forked chain,
   **not** the head. #989 is the worked example: its heads were
   ``coord_polread_01`` and ``devenv_10``, and the fix was in ``devenv_09``.
4. When every head has landed, the remedy IS ``alembic merge`` — the one
   case it is correct for.
5. An unreadable baseline is ``unknown``, never "nothing has landed". That
   inversion would turn "I could not check" into confident wrong advice.

The gate's own two lanes are exercised end to end at the bottom: exit 0 on a
single head, exit 1 on a fork, exit 2 on a scan that proved nothing.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

from _alembic_graph import (  # noqa: E402
    fork_root,
    plan_remediation,
    scan_sources,
)

COUNTER = SCRIPTS_CI / "count_alembic_heads.py"


def _revision(rev: str, down: str | None) -> str:
    """The modern annotated revision-header form the repo actually uses."""
    rendered = "None" if down is None else f'"{down}"'
    return (
        f'"""{rev}\n\nRevision ID: {rev}\nRevises: {down or ""}\n"""\n\n'
        f'revision: str = "{rev}"\n'
        f"down_revision: str | Sequence[str] | None = {rendered}\n"
    )


def _tree(*pairs: tuple[str, str | None]) -> dict[Path, str]:
    return {Path(f"{rev}.py"): _revision(rev, down) for rev, down in pairs}


# ---------------------------------------------------------------------------
# 1. head computation
# ---------------------------------------------------------------------------


def test_single_chain_has_one_head() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "b")))
    assert scan.heads == ("c",)
    assert len(scan.revisions) == 3


def test_two_children_of_one_parent_is_two_heads() -> None:
    # Exactly #1048's shape: `cmpaxis_01` and `coord_pr_author_nudges_02`
    # both declared `coord_obs_idx_01` as parent.
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    assert scan.heads == ("b", "c")


def test_legacy_unannotated_form_still_parses() -> None:
    sources = {
        Path("a.py"): 'revision = "a"\ndown_revision = None\n',
        Path("b.py"): 'revision = "b"\ndown_revision = "a"\n',
    }
    assert scan_sources(sources).heads == ("b",)


def test_merge_revision_tuple_names_both_parents() -> None:
    sources = {
        **_tree(("a", None), ("b", "a"), ("c", "a")),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    assert scan_sources(sources).heads == ("m",)


def test_a_file_without_a_revision_assignment_is_counted_but_not_parsed() -> None:
    sources = {**_tree(("a", None)), Path("__init__.py"): "# not a revision\n"}
    scan = scan_sources(sources)
    assert scan.file_count == 2
    assert len(scan.revisions) == 1


# ---------------------------------------------------------------------------
# 2-3. the remedy, and WHICH file it names
# ---------------------------------------------------------------------------


def test_one_landed_one_unlanded_head_yields_a_repoint_onto_the_landed_one() -> None:
    scan = scan_sources(_tree(("a", None), ("landed", "a"), ("mine", "a")))
    remediation = plan_remediation(scan, landed={"a", "landed"})
    assert remediation.kind == "repoint"
    assert remediation.target == "landed"
    assert [rev for rev, _ in remediation.edits] == ["mine"]


def test_the_edit_names_the_fork_root_not_the_head() -> None:
    """#989's shape — two stacked unlanded revisions, one token to change."""
    scan = scan_sources(
        _tree(
            ("a", None), ("landed", "a"), ("devenv_09", "a"), ("devenv_10", "devenv_09")
        )
    )
    remediation = plan_remediation(scan, landed={"a", "landed"})
    assert remediation.kind == "repoint"
    assert remediation.target == "landed"
    # devenv_10 travels along unchanged; touching it would be the wrong fix.
    assert [rev for rev, _ in remediation.edits] == ["devenv_09"]


def test_fork_root_stops_at_the_first_landed_parent() -> None:
    revisions = {"c": '"b"', "b": '"a"', "a": "None"}
    assert fork_root("c", revisions, landed={"a"}) == "b"
    assert fork_root("c", revisions, landed={"a", "b"}) == "c"


def test_fork_root_does_not_loop_on_a_cycle() -> None:
    revisions = {"x": '"y"', "y": '"x"'}
    assert fork_root("x", revisions, landed=set()) in {"x", "y"}


# ---------------------------------------------------------------------------
# 4. the one case `alembic merge` IS right for
# ---------------------------------------------------------------------------


def test_all_heads_landed_is_the_merge_case() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    remediation = plan_remediation(scan, landed={"a", "b", "c"})
    assert remediation.kind == "merge"
    assert remediation.target is None


def test_no_single_landed_head_refuses_to_invent_an_order() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    remediation = plan_remediation(scan, landed={"a"})
    assert remediation.kind == "chain"
    assert remediation.target is None


# ---------------------------------------------------------------------------
# 5. UNKNOWN is not "nothing landed"
# ---------------------------------------------------------------------------


def test_unreadable_baseline_is_unknown_not_empty() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    remediation = plan_remediation(scan, landed=None)
    assert remediation.kind == "unknown"
    assert remediation.target is None
    assert remediation.landed_heads == () and remediation.unlanded_heads == ()


# ---------------------------------------------------------------------------
# the gate script's exit codes, end to end
# ---------------------------------------------------------------------------


def _run(versions_dir: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(COUNTER), "--versions-dir", str(versions_dir), *extra],
        capture_output=True,
        text=True,
        check=False,
    )


def _write(dir_: Path, *pairs: tuple[str, str | None]) -> Path:
    dir_.mkdir(parents=True, exist_ok=True)
    for rev, down in pairs:
        (dir_ / f"{rev}.py").write_text(_revision(rev, down), encoding="utf-8")
    return dir_


def test_gate_exits_zero_on_a_single_head(tmp_path: Path) -> None:
    result = _run(_write(tmp_path / "v", ("a", None), ("b", "a")), "--baseline-ref", "")
    assert result.returncode == 0, result.stderr
    assert "HEAD_COUNT=1" in result.stdout


def test_gate_exits_one_on_a_fork(tmp_path: Path) -> None:
    result = _run(
        _write(tmp_path / "v", ("a", None), ("b", "a"), ("c", "a")),
        "--baseline-ref",
        "",
    )
    assert result.returncode == 1
    assert "HEAD_COUNT=2" in result.stdout


def test_report_only_downgrades_a_fork_but_still_reports_it(tmp_path: Path) -> None:
    result = _run(
        _write(tmp_path / "v", ("a", None), ("b", "a"), ("c", "a")),
        "--baseline-ref",
        "",
        "--report-only",
    )
    assert result.returncode == 0
    assert "HEAD_COUNT=2" in result.stdout


def test_gate_exits_two_on_an_empty_dir(tmp_path: Path) -> None:
    empty = tmp_path / "v"
    empty.mkdir()
    result = _run(empty, "--baseline-ref", "")
    assert result.returncode == 2, result.stderr
    assert "scanned NOTHING" in result.stderr


def test_gate_exits_two_on_files_that_parse_to_no_revisions(tmp_path: Path) -> None:
    versions = tmp_path / "v"
    versions.mkdir()
    (versions / "not_a_revision.py").write_text("x = 1\n", encoding="utf-8")
    result = _run(versions, "--baseline-ref", "")
    assert result.returncode == 2, result.stderr


def test_gate_exits_two_on_a_cycle(tmp_path: Path) -> None:
    result = _run(_write(tmp_path / "v", ("x", "y"), ("y", "x")), "--baseline-ref", "")
    assert result.returncode == 2
    assert "ZERO heads" in result.stderr


def test_a_fork_with_an_unreadable_baseline_says_so_and_does_not_recommend_merge(
    tmp_path: Path,
) -> None:
    result = _run(
        _write(tmp_path / "v", ("a", None), ("b", "a"), ("c", "a")),
        "--baseline-ref",
        "refs/no/such/ref",
    )
    assert result.returncode == 1
    assert "UNKNOWN" in result.stderr
    assert "alembic merge" in result.stderr  # only as the thing NOT to reach for
    assert "Do NOT reach for `alembic merge`" in result.stderr


@pytest.mark.parametrize("flag", ["--versions-dir", "--baseline-ref"])
def test_the_new_flags_exist(flag: str) -> None:
    """A lane invoking these must not silently fall back to defaults."""
    result = subprocess.run(
        [sys.executable, str(COUNTER), "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert flag in result.stdout


def test_the_real_repo_chain_has_exactly_one_head() -> None:
    """The gate's own subject. If this fails, main is forked — fix that."""
    result = subprocess.run(
        [sys.executable, str(COUNTER)],
        capture_output=True,
        text=True,
        check=False,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "HEAD_COUNT=1" in result.stdout
