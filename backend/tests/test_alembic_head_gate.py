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
6. A DUPLICATE revision id is recorded rather than silently collapsed, and it
   FAILS the gate. ``Scan.revisions`` is keyed by revision id, so the second
   file to declare one overwrites the first and a node vanishes from the
   graph; on 2026-09-12 that made the gate answer ``HEAD_COUNT=1``, exit 0,
   for a tree carrying two files named ``coord_test_results_idx_01``
   (qontinui-web #1316) — green on the exact condition it exists to catch.
   ``file_count`` cannot detect it and ``file_count == len(revisions)`` is the
   WRONG predicate, because a legitimate non-revision file makes
   ``file_count`` exceed the revision count with nothing amiss; only
   ``parsed_count`` may be compared.

The gate's own two lanes are exercised end to end at the bottom: exit 0 on a
single head, exit 1 on a fork, exit 2 on a scan that proved nothing —
including a duplicate revision id, which collapses the graph and makes any
head count meaningless.
"""

from __future__ import annotations

import ast
import io
import subprocess
import sys
import types
import urllib.error
from pathlib import Path

import pytest
import yaml

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
    invoking_files,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

import notify_forked_open_prs as notifier  # noqa: E402
from _alembic_graph import (  # noqa: E402
    duplicate_groups,
    fork_root,
    plan_remediation,
    safe_id,
    scan_sources,
)
from count_alembic_heads import render_remediation  # noqa: E402

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
# 6. a duplicate revision id collapses the graph — and must be visible
# ---------------------------------------------------------------------------


def test_a_duplicate_revision_id_is_recorded_rather_than_silently_collapsed() -> None:
    """Two files, one id. The graph keeps one node; the scan must say so."""
    sources = {
        **_tree(("a", None), ("b", "a")),
        Path("b_again.py"): _revision("b", "a"),
    }
    scan = scan_sources(sources)
    assert scan.parsed_count == 3
    assert len(scan.revisions) == 2  # one node was overwritten
    assert [rev for rev, _, _ in scan.duplicates] == ["b"]
    _, first, second = scan.duplicates[0]
    assert {first.name, second.name} == {"b.py", "b_again.py"}


def test_a_clean_tree_reports_no_duplicates() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "b")))
    assert scan.duplicates == ()
    assert scan.parsed_count == len(scan.revisions) == 3


def test_an_unparseable_file_is_not_a_duplicate() -> None:
    """Why the predicate is ``parsed_count``, not ``file_count``.

    ``file_count == len(revisions)`` is the tempting check and it is WRONG: a
    legitimate non-revision file in the directory makes ``file_count`` exceed
    the revision count with nothing amiss, so that comparison would fail a
    healthy tree. This pins the distinction so the cheaper-looking predicate
    cannot be substituted later.
    """
    sources = {**_tree(("a", None)), Path("__init__.py"): "# not a revision\n"}
    scan = scan_sources(sources)
    assert scan.file_count == 2
    assert scan.parsed_count == 1
    assert scan.duplicates == ()


def test_a_duplicate_makes_the_head_set_stop_describing_the_tree() -> None:
    """The collapse does not merely lose a node — it makes the head set wrong.

    Two files declare ``b``: one with parent ``a``, one as a root
    (``down_revision = None``). On disk that is two roots; the surviving node
    keeps whichever parent was read last. ``a`` is still not reported as a
    head, because ``parents`` retains the ``a`` edge contributed by the file
    that was overwritten — so the reported head set describes neither the tree
    on disk nor the tree in the graph.
    """
    sources = {
        **_tree(("a", None), ("b", "a")),
        Path("b_dup.py"): _revision("b", None),
    }
    scan = scan_sources(sources)
    assert len(scan.revisions) == 2
    assert scan.duplicates != ()
    assert scan.heads == ("b",)


def test_duplicate_groups_collapses_a_triple_into_one_entry() -> None:
    """``Scan.duplicates`` records one entry per OVERWRITE, so three files
    sharing an id give two pairwise entries that read as two unrelated
    collisions. ``duplicate_groups`` is what the human-facing messages use, so
    the count is of distinct ids and every file appears once."""
    sources = {
        **_tree(("a", None), ("b", "a")),
        Path("b2.py"): _revision("b", "a"),
        Path("b3.py"): _revision("b", "a"),
    }
    scan = scan_sources(sources)
    assert len(scan.duplicates) == 2  # pairwise: (b,b2) and (b2,b3)
    groups = duplicate_groups(scan)
    assert list(groups) == ["b"]  # but ONE duplicated id
    assert [p.name for p in groups["b"]] == ["b.py", "b2.py", "b3.py"]


def test_simulate_drops_a_renamed_files_old_path() -> None:
    """A PR that RENAMES a revision file while keeping its id is not a duplicate.

    GitHub reports a rename as one entry carrying ``previous_filename``. If the
    simulation overlays the new path without removing the old one, ``main``'s
    copy survives beside it, both declare the same revision id, and the sweep
    would report a duplicate against a tree that does not exist anywhere. The
    PR gate cannot see this (the real checkout has only the new file), so the
    simulated tree is the only place it could appear.
    """
    versions = notifier.REPO_ROOT / "backend/alembic/versions"
    main_sources = {
        versions / "a.py": _revision("a", None),
        versions / "b_old.py": _revision("b", "a"),
    }
    touched = [
        {
            "filename": "backend/alembic/versions/b_new.py",
            "status": "renamed",
            "previous_filename": "backend/alembic/versions/b_old.py",
        }
    ]
    original = notifier.blob_at
    notifier.blob_at = lambda repo, path, ref, token: _revision("b", "a")
    try:
        sources = notifier.simulate(
            main_sources, "o/r", {"head": {"sha": "deadbeef"}}, touched, "t"
        )
    finally:
        notifier.blob_at = original
    assert sorted(p.name for p in sources) == ["a.py", "b_new.py"]
    assert scan_sources(sources).duplicates == ()


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


def test_fork_root_returns_none_on_a_cycle() -> None:
    revisions = {"x": '"y"', "y": '"x"'}
    assert fork_root("x", revisions, landed=set()) is None


def test_fork_root_returns_none_for_a_merge_revision() -> None:
    """Naming a merge revision as the edit site is DESTRUCTIVE advice.

    Its `down_revision` is a tuple. Telling the author to write a scalar there
    drops both merge parents, which takes a 2-head chain to 3 — the gate would
    go from red to redder while the comment read like a complete fix.
    """
    revisions = {"m": '("b", "c")', "b": '"a"', "c": '"a"', "a": "None"}
    assert fork_root("m", revisions, landed={"a"}) is None


def test_fork_root_returns_a_chain_root() -> None:
    """`down_revision = None` IS a legitimate re-point site, unlike a merge."""
    assert fork_root("r", {"r": "None"}, landed=set()) == "r"


def test_a_merge_revision_head_degrades_to_chain_not_a_repoint() -> None:
    sources = {
        **_tree(("a", None), ("landed", "a"), ("b", "a"), ("c", "a")),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    scan = scan_sources(sources)
    assert scan.heads == ("landed", "m")
    remediation = plan_remediation(scan, landed={"a", "landed"})
    # NOT "repoint" — see test_fork_root_returns_none_for_a_merge_revision.
    # And NOT "chain" either: there IS one landed head, so a message saying
    # "no single landed head to re-point onto" would contradict itself.
    assert remediation.kind == "blocked"
    assert remediation.edits == ()
    assert remediation.target == "landed"
    assert remediation.blocked == (("m", "merge_revision", "m"),)


def test_one_unresolvable_chain_degrades_the_whole_answer() -> None:
    """A partial re-point reads like a complete fix and leaves the chain forked."""
    sources = {
        **_tree(("a", None), ("landed", "a"), ("ok", "a"), ("b", "a"), ("c", "a")),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    remediation = plan_remediation(scan_sources(sources), landed={"a", "landed"})
    assert remediation.kind == "blocked"


# ---------------------------------------------------------------------------
# rendering safety — these ids reach a bot-authored comment on someone's PR
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("coord_polread_01", "coord_polread_01"),
        (
            "devenv_10_unique_active_coord_device",
            "devenv_10_unique_active_coord_device",
        ),
        ("a` @org/team `b", "aorgteamb"),
        # `-` survives (harmless inside a code span); `<`, `>`, `!`, space do not.
        ("x<!-- -->y", "x----y"),
        ("a\nb", "ab"),
    ],
)
def test_safe_id_strips_everything_that_could_escape_a_code_span(
    raw: str, expected: str
) -> None:
    assert safe_id(raw) == expected


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
    assert remediation.edits == ()
    # What it must NOT assert about the head split is pinned by
    # test_the_unknown_arm_asserts_nothing_about_what_landed below.


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


def _write_duplicate(tmp_path: Path) -> Path:
    """A tree where two files declare one revision id."""
    versions = _write(tmp_path / "v", ("a", None), ("b", "a"))
    (versions / "b_again.py").write_text(_revision("b", "a"), encoding="utf-8")
    return versions


def test_gate_exits_two_on_a_duplicate_revision_id(tmp_path: Path) -> None:
    result = _run(_write_duplicate(tmp_path), "--baseline-ref", "")
    assert result.returncode == 2, result.stdout + result.stderr
    assert "DUPLICATE revision id" in result.stderr
    # Both files must be named: the author cannot see which one was swallowed.
    assert "b.py" in result.stderr
    assert "b_again.py" in result.stderr
    # `alembic merge` appears only as the thing NOT to reach for — there is no
    # fork to merge, just two revisions wearing one name.
    assert "Do NOT reach for `alembic merge`" in result.stderr


def test_report_only_does_not_downgrade_a_duplicate_revision_id(
    tmp_path: Path,
) -> None:
    """``--report-only`` downgrades a FORK, because the informational lane must
    reach its comment step. It must not downgrade this: a duplicate says the
    head computation proved nothing, which is the vacuous arm, not a verdict
    the lane can report and move past."""
    result = _run(_write_duplicate(tmp_path), "--baseline-ref", "", "--report-only")
    assert result.returncode == 2, result.stdout + result.stderr
    assert "DUPLICATE revision id" in result.stderr


def test_gate_names_every_file_when_three_share_one_id(tmp_path: Path) -> None:
    """One duplicated id, not two collisions, and all three files listed."""
    versions = _write(tmp_path / "v", ("a", None), ("b", "a"))
    for extra in ("b2.py", "b3.py"):
        (versions / extra).write_text(_revision("b", "a"), encoding="utf-8")
    result = _run(versions, "--baseline-ref", "")
    assert result.returncode == 2, result.stdout + result.stderr
    assert "1 DUPLICATE revision id(s)" in result.stderr
    assert "declared by 3 files" in result.stderr
    for name in ("b.py", "b2.py", "b3.py"):
        assert name in result.stderr


def test_the_duplicate_that_made_this_gate_green_now_fails(tmp_path: Path) -> None:
    """The measured 2026-09-12 shape, as a regression.

    qontinui-web #1316 added a second file declaring ``coord_test_results_idx_01``
    — ``main``'s own head — off the same parent. The gate reported 551 files
    scanned, **550** parsed, ``HEAD_COUNT=1``, exit 0: a pass earned by losing
    a node rather than by a clean chain.
    """
    versions = _write(
        tmp_path / "v",
        ("plan_library_05", None),
        ("coord_test_results_idx_01", "plan_library_05"),
    )
    (versions / "coord_test_results_idx_01_repo_observed_at.py").write_text(
        _revision("coord_test_results_idx_01", "plan_library_05"), encoding="utf-8"
    )
    result = _run(versions, "--baseline-ref", "")
    assert result.returncode == 2, result.stdout + result.stderr
    assert "NOT A VERDICT" in result.stderr
    assert "coord_test_results_idx_01" in result.stderr


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
    """The gate's own subject. If this fails, main is forked — fix that.

    DELIBERATELY duplicates the required `alembic-heads-pr` check inside the
    backend test job. That is redundancy on purpose, not an oversight: the two
    run at different times against different trees (this one against whatever
    the test job checked out), and a chain that is forked should be loud in
    both places rather than only in the one someone might re-run.
    """
    result = subprocess.run(
        [sys.executable, str(COUNTER)],
        capture_output=True,
        text=True,
        check=False,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "HEAD_COUNT=1" in result.stdout


def test_blocked_is_not_chain_and_says_append_not_replace() -> None:
    """The two must render differently; conflating them produced wrong advice."""
    sources = {
        **_tree(("a", None), ("landed", "a"), ("b", "a"), ("c", "a")),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    scan = scan_sources(sources)
    text = render_remediation(
        plan_remediation(scan, landed={"a", "landed"}), "origin/main", scan.heads
    )
    assert "no single landed head" not in text.lower()
    assert "APPEND" in text
    assert "`landed` is the landed head" in text


def test_chain_still_says_there_is_no_landed_head_to_use() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    text = render_remediation(
        plan_remediation(scan, landed={"a"}), "origin/main", scan.heads
    )
    assert "No single landed head to re-point onto" in text


def test_a_cycle_inside_one_fork_is_blocked_with_its_own_reason() -> None:
    # `z` is the head; walking down from it enters an x<->y cycle. (A cycle
    # on its own has no head at all — the gate exits 2 on that — so it only
    # reaches the remediation path when something outside points into it.)
    sources = {
        **_tree(("a", None), ("landed", "a")),
        Path("z.py"): 'revision: str = "z"\ndown_revision = "x"\n',
        Path("x.py"): 'revision: str = "x"\ndown_revision = "y"\n',
        Path("y.py"): 'revision: str = "y"\ndown_revision = "x"\n',
    }
    scan = scan_sources(sources)
    assert scan.heads == ("landed", "z")
    remediation = plan_remediation(scan, landed={"a", "landed"})
    assert remediation.kind == "blocked"
    assert [reason for _, reason, _ in remediation.blocked] == ["cycle"]


def test_the_pr_file_filter_matches_what_the_gate_scans() -> None:
    """A looser filter tells authors a green required check is red."""
    prefix = f"{notifier.VERSIONS_DIR}/"
    assert notifier._in_versions_dir(f"{prefix}rev.py")
    assert not notifier._in_versions_dir(f"{prefix}sub/rev.py")
    assert not notifier._in_versions_dir(f"{prefix}README.md")
    assert not notifier._in_versions_dir("backend/alembic/env.py")


# ---------------------------------------------------------------------------
# ENUMERATE THE CLASSIFIER'S ARMS.
#
# The merge-revision/cycle detection was first shipped INSIDE
# `if len(landed_heads) == 1`, so it covered one arm of three: with 0 or >=2
# landed heads a merge revision fell through to `chain`, whose text says
# "each one's `down_revision` naming the previous" — the scalar write that
# takes a 2-head chain to 3. These parametrise the landed-head count so a
# fix placed inside a branch cannot pass again.
# ---------------------------------------------------------------------------


def _merge_revision_tree(landed_head_count: int) -> tuple[object, set[str]]:
    """A tree containing a merge revision, with N of its heads landed."""
    pairs: list[tuple[str, str | None]] = [("a", None), ("b", "a"), ("c", "a")]
    landed = {"a"}
    for i in range(landed_head_count):
        pairs.append((f"L{i}", "a"))
        landed.add(f"L{i}")
    sources = {
        **_tree(*pairs),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    return scan_sources(sources), landed


@pytest.mark.parametrize("landed_head_count", [0, 1, 2, 3])
def test_a_merge_revision_is_blocked_at_every_landed_head_count(
    landed_head_count: int,
) -> None:
    scan, landed = _merge_revision_tree(landed_head_count)
    remediation = plan_remediation(scan, landed)
    assert remediation.kind == "blocked", (
        f"{landed_head_count} landed head(s) fell through to "
        f"{remediation.kind!r} — destructive advice"
    )
    assert [reason for _, reason, _ in remediation.blocked] == ["merge_revision"]


@pytest.mark.parametrize("landed_head_count", [0, 1, 2, 3])
def test_the_chain_text_is_never_shown_for_a_merge_revision(
    landed_head_count: int,
) -> None:
    """`chain`'s advice is a SCALAR write; it must never reach a tuple."""
    scan, landed = _merge_revision_tree(landed_head_count)
    text = render_remediation(plan_remediation(scan, landed), "origin/main", scan.heads)
    assert "naming the previous" not in text
    assert "APPEND" in text


def test_the_blocked_message_names_the_merge_revision_not_the_head() -> None:
    """`top`'s own `down_revision` is a scalar; editing it is the wrong fix."""
    sources = {
        **_tree(("a", None), ("landed", "a"), ("b", "a"), ("c", "a")),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
        Path("top.py"): 'revision: str = "top"\ndown_revision = "m"\n',
    }
    scan = scan_sources(sources)
    remediation = plan_remediation(scan, landed={"a", "landed"})
    assert remediation.blocked == (("top", "merge_revision", "m"),)
    text = render_remediation(remediation, "origin/main", scan.heads)
    assert "the block is `m`" in text


def test_the_mixed_case_reports_BOTH_halves() -> None:
    """One resolvable chain + one blocked one. Naming only the blocked half
    made the author converge in two rounds instead of one."""
    sources = {
        **_tree(
            ("a", None),
            ("landed", "a"),
            ("h1", "a"),
            ("h2", "h1"),
            ("b", "a"),
            ("c", "a"),
        ),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    scan = scan_sources(sources)
    remediation = plan_remediation(scan, landed={"a", "landed"})
    assert remediation.kind == "blocked"
    assert remediation.target == "landed"
    assert [rev for rev, _ in remediation.edits] == ["h1"]
    text = render_remediation(remediation, "origin/main", scan.heads)
    assert "h1" in text and "plain re-point" in text
    assert "APPEND" in text
    comment = notifier.render_comment(scan.heads, remediation, "deadbeefcafe")
    assert "h1" in comment and "APPEND" in comment


def test_rendering_never_raises_on_a_path_outside_the_repo() -> None:
    """`Path.relative_to` RAISES rather than falling back; an unguarded call
    turns a formatting detail into an aborted sweep."""
    scan = scan_sources(_tree(("a", None), ("landed", "a"), ("mine", "a")))
    remediation = plan_remediation(scan, landed={"a", "landed"})
    # `_tree` produces bare relative paths, i.e. NOT under REPO_ROOT.
    assert notifier.render_comment(scan.heads, remediation, "cafebabe1234")
    assert render_remediation(remediation, "origin/main", scan.heads)


# ---------------------------------------------------------------------------
# There is no retry layer any more — descoped after four of six review
# blockers on this file lived in it. These pin its ABSENCE, because the
# tempting "just add a retry" edit is what produced a permanent duplicate
# comment last time.
# ---------------------------------------------------------------------------


def test_one_http_failure_produces_exactly_one_attempt() -> None:
    """THE pin: behavioural, so it survives a rename.

    The name list below guards six exact strings; this guards the property
    those strings used to break. A re-added retry under ANY name — including
    `_should_retry` / `_backoff_seconds` — fails here, because a second
    `urlopen` call is a second POST, and a POST that GitHub 502s AFTER
    committing is how a duplicate marker comment gets created that nothing in
    this repo can ever remove.
    """
    calls: list[str] = []

    def exploding_urlopen(request, timeout=None):
        calls.append(request.get_method())
        raise urllib.error.HTTPError(
            request.full_url, 502, "Bad Gateway", {}, io.BytesIO(b"boom")
        )

    original = notifier.urllib.request.urlopen
    notifier.urllib.request.urlopen = exploding_urlopen
    try:
        for method in ("GET", "POST", "PATCH"):
            calls.clear()
            with pytest.raises(notifier.ApiError):
                notifier._request(
                    "https://example.invalid/x",
                    "t",
                    method=method,
                    body=None if method == "GET" else {"body": "b"},
                )
            assert len(calls) == 1, (
                f"{method} was attempted {len(calls)} times — a retry layer is "
                "back. See the module docstring: a replayed POST creates a "
                "permanent duplicate comment."
            )
    finally:
        notifier.urllib.request.urlopen = original


def test_the_retry_probe_itself_can_fail() -> None:
    """Positive control for the test above.

    An absence guard that cannot fail is worse than none. This proves the
    probe detects a second attempt, so a green result there means something.
    """
    calls: list[int] = []

    def flaky(request, timeout=None):
        calls.append(1)
        raise urllib.error.HTTPError(
            request.full_url, 502, "Bad Gateway", {}, io.BytesIO(b"boom")
        )

    def retrying_request(url, token, **kwargs):
        for _ in range(3):  # a hypothetical re-added retry layer
            try:
                return flaky(types.SimpleNamespace(full_url=url), None)
            except urllib.error.HTTPError:
                continue
        raise notifier.ApiError("gave up")

    with pytest.raises(notifier.ApiError):
        retrying_request("https://example.invalid/x", "t")
    assert len(calls) == 3, "the probe would not have noticed a retry"


def test_there_is_no_retry_layer() -> None:
    """Secondary, name-based pin. Cheap, and NOT sufficient on its own.

    It cannot tell "correctly absent" from "never existed", and a re-added
    layer under different names passes it. That is what
    `test_one_http_failure_produces_exactly_one_attempt` is for. Kept because
    it names the exact symbols and the reason, which a behavioural failure
    message cannot.
    """
    for gone in (
        "_is_retryable",
        "_retry_delay",
        "_post_comment",
        "RETRYABLE_STATUS",
        "IDEMPOTENT_METHODS",
        "MAX_HONOURED_DELAY_SECONDS",
    ):
        assert not hasattr(notifier, gone), (
            f"{gone} is back. A re-POST can duplicate a marker comment, and a "
            "read-back cannot fix it — see the module docstring."
        )


def test_all_marker_comments_are_found_not_just_the_first() -> None:
    """A first-match-only lookup ORPHANS a duplicate: every later run edits
    #1 and nothing can ever see, update or remove #2."""
    captured: list[dict] = [
        {"id": 1, "body": notifier.MARKER + "\nfirst"},
        {"id": 2, "body": "unrelated"},
        {"id": 3, "body": notifier.MARKER + "\nsecond"},
    ]
    original = notifier._paginate
    notifier._paginate = lambda url, token: captured
    try:
        found = notifier.find_marker_comments("o/r", 1, "t")
    finally:
        notifier._paginate = original
    assert [c["id"] for c in found] == [1, 3]


def test_a_duplicate_notice_is_reported_not_silently_edited_around() -> None:
    failures: list[str] = []
    notifier._report_duplicates(7, [{"id": 1}, {"id": 2}], failures)
    assert len(failures) == 1 and "#7" in failures[0] and "2" in failures[0]
    failures.clear()
    notifier._report_duplicates(7, [{"id": 1}], failures)
    assert failures == []


# ---------------------------------------------------------------------------
# the fork roots must not be dropped just because no single head landed
# ---------------------------------------------------------------------------


def _mixed_two_landed_heads():
    sources = {
        **_tree(
            ("a", None),
            ("L1", "a"),
            ("L2", "a"),
            ("r1", "a"),
            ("r2", "r1"),
            ("b", "a"),
            ("c", "a"),
        ),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    return scan_sources(sources), {"a", "L1", "L2"}


def test_the_fork_roots_survive_when_there_is_no_single_landed_head() -> None:
    scan, landed = _mixed_two_landed_heads()
    remediation = plan_remediation(scan, landed)
    assert remediation.target is None
    assert [rev for rev, _ in remediation.edits] == ["r1"]


def test_both_renderers_name_the_roots_when_there_is_no_single_target() -> None:
    scan, landed = _mixed_two_landed_heads()
    remediation = plan_remediation(scan, landed)
    text = render_remediation(remediation, "origin/main", scan.heads)
    comment = notifier.render_comment(scan.heads, remediation, "cafebabe1234")
    assert "r1" in text, "the gate computed the root and then withheld it"
    assert "r1" in comment, "the comment computed the root and then withheld it"


def test_plain_chain_also_names_its_roots() -> None:
    scan = scan_sources(_tree(("a", None), ("p", "a"), ("q", "a")))
    remediation = plan_remediation(scan, landed={"a"})
    assert remediation.kind == "chain"
    assert {rev for rev, _ in remediation.edits} == {"p", "q"}
    assert "p" in render_remediation(remediation, "origin/main", scan.heads)


# ---------------------------------------------------------------------------
# UNKNOWN must not become a claim
# ---------------------------------------------------------------------------


def test_the_unknown_arm_asserts_nothing_about_what_landed() -> None:
    """Putting every head in `unlanded_heads` reads as a definite "none of
    these landed" — the exact inversion `revisions_at_ref` warns about."""
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    remediation = plan_remediation(scan, landed=None)
    assert remediation.kind == "unknown"
    assert remediation.landed_heads == ()
    assert remediation.unlanded_heads == ()


def test_the_unknown_comment_says_unknown_and_not_a_head_split() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    comment = notifier.render_comment(
        scan.heads, plan_remediation(scan, landed=None), "cafebabe1234"
    )
    assert "unknown" in comment.lower()
    assert "landed head(s)" not in comment


# ---------------------------------------------------------------------------
# the search must not drop a signal it was handed
# ---------------------------------------------------------------------------


def test_both_partial_signals_are_reported_not_just_the_first() -> None:
    page = {
        "total_count": 250,
        "incomplete_results": True,
        "items": [{"number": i} for i in range(100)],
    }
    original = notifier._request
    notifier._request = lambda url, token, **kw: (page, {})
    try:
        found, partial = notifier.prs_carrying_a_notice("o/r", "t")
    finally:
        notifier._request = original
    assert len(found) == 100
    assert "250 PRs carry" in partial
    assert "incomplete" in partial


def test_a_clean_search_reports_no_partial_reason() -> None:
    page = {"total_count": 2, "incomplete_results": False, "items": [{"number": 4}]}
    original = notifier._request
    notifier._request = lambda url, token, **kw: (page, {})
    try:
        _, partial = notifier.prs_carrying_a_notice("o/r", "t")
    finally:
        notifier._request = original
    # total_count(2) > len(items)(1) IS a truncation and must be reported.
    assert "2 PRs carry" in partial


def test_repo_relative_never_raises_and_has_one_home() -> None:
    from _gate_lib import repo_relative

    assert repo_relative(None, "fallback") == "fallback"
    assert repo_relative(Path("/definitely/not/in/the/repo")) == (
        "/definitely/not/in/the/repo"
    )
    assert notifier._pretty_path("rev", None) == "rev"


def test_the_gate_unknown_arm_is_pinned_too() -> None:
    """Mirror of `test_the_unknown_comment_says_unknown_and_not_a_head_split`.

    Only the notifier side was pinned, so the gate's unknown arm could be
    regressed to the `landed head(s): (none)` header — the exact falsehood —
    with every test still green.
    """
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    text = render_remediation(
        plan_remediation(scan, landed=None), "origin/main", scan.heads
    )
    assert "UNKNOWN" in text
    assert "landed head(s)" not in text
    assert "(none)" not in text


def test_a_human_quoting_the_notice_is_not_counted_as_a_marker() -> None:
    """GitHub's "Quote reply" copies the raw HTML comment, so `MARKER in body`
    matches a human reply — which under an all-matches lookup raises a
    spurious "delete the extras" failure and reddens the job."""
    ours = {"id": 1, "body": notifier.MARKER + "\n### fork notice"}
    quoted = {"id": 2, "body": "> " + notifier.MARKER + "\n> quoting you\n\nfix?"}
    assert notifier._is_our_comment(ours)
    assert not notifier._is_our_comment(quoted)
    assert not notifier._is_our_comment({"id": 3, "body": None})
    assert not notifier._is_our_comment({"id": 4})

    original = notifier._paginate
    notifier._paginate = lambda url, token: [ours, quoted]
    try:
        found = notifier.find_marker_comments("o/r", 1, "t")
    finally:
        notifier._paginate = original
    assert [c["id"] for c in found] == [1]
    failures: list[str] = []
    notifier._report_duplicates(1, found, failures)
    assert failures == []


# ---------------------------------------------------------------------------
# THE LANE ROSTER — who actually invokes this gate.
#
# Everything above tests what the gate COMPUTES. These two test how many places
# run it, which is the property that made `a208240e2` invisible: a fourth
# invocation of the sibling ruff gate was added while three separate places in
# the tree went on saying there were three, and nothing failed for 90 commits.
#
# `count_alembic_heads.py` genuinely has four lanes, and each exists for its own
# reason:
#
#   * .github/workflows/alembic-graph-pr.yml, step "Count alembic heads" — the
#     PR gate; a forked chain FAILS the check.
#   * .qontinui/ci.toml, step `alembic-single-head` — the runner-as-CI-node
#     lane, invoking this same script rather than mirroring a command string,
#     so the two cannot drift.
#   * .pre-commit-config.yaml, hook `alembic-single-head` — the shift-left
#     lane. Convenience, not the guard: all three forks on record (#1048, #989,
#     `066c2e6c`) were post-authoring races that a pre-commit count exits 0 on.
#     What it buys is that its message names the exact `down_revision` token to
#     adopt, which was the entire fix in 3 of 3 cases.
#   * .github/workflows/alembic-graph-check.yml, step "Count heads" — the
#     post-merge companion, informational by construction. It passes
#     `--report-only` so a forked chain does not abort the step before the
#     comment is posted, which is why the roster below has four entries and the
#     script's exit codes have a downgrade arm.
#
# The roster is asserted BY POSITION (a YAML `run:`/`entry:` value, a TOML
# `command = [...]` element) rather than by #1208's "a tracked non-comment line
# naming the script" rule — and THIS gate is precisely why that rule could not
# be reused. Four tracked, non-comment lines name `count_alembic_heads.py` and
# invoke nothing: the docstring sentence in
# backend/alembic/versions/grantorig_01_operator_roles_grant_origin.py, and the
# three remediation string literals in scripts/ci/notify_forked_open_prs.py.
# All four are .py lines with no leading `#`. The position rule rejects them
# with no exclusion list — including this very file, which names the script
# throughout.
# ---------------------------------------------------------------------------

_SCRIPT_REF = "scripts/ci/count_alembic_heads.py"

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/alembic-graph-check.yml",
        ".github/workflows/alembic-graph-pr.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate.

    This file already imports `render_remediation` from the gate, so an
    `__doc__` read would cost nothing here — but the sibling roster modules
    import nothing at all, and the roster tests should read the same way in all
    four. Parsing is also the read that cannot run anything: these gates are
    argv-only programs, and `ast` never executes a line of one.
    """
    return ast.get_docstring(ast.parse(COUNTER.read_text(encoding="utf-8")))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    The gate opens by naming its four lanes and what each one is for — the
    `--report-only` distinction above all. That prose is what a reader trusts
    instead of grepping, so a lane added without touching it leaves the script
    describing a shape the repo no longer has.
    """
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)


# ---------------------------------------------------------------------------
# 21. a finding about a PR is not a failure of the sweep
#
# 2026-09-13: `alembic graph check` was red on `main` for two consecutive
# runs. `main`'s own chain was fine both times (`HEAD_COUNT=1`, 553
# revisions, head `remote_create_01`) — the red came from the open-PR sweep,
# which found that PR #1316's SIMULATED tree duplicated `coord_test_results
# _idx_01`, a revision id that had landed on `main` at 16:41 while #1316 was
# still open. Duplicate detection had landed 3h43m later (94d578e2/cfcf4d20)
# and routed that verdict into `failures`, whose only exit is EXIT_VACUOUS.
#
# So a defect wholly contained in ONE unmerged PR reddened `main`'s lane, and
# no commit to `main` could clear it: the offending file was never in `main`.
# ---------------------------------------------------------------------------


def test_a_duplicate_in_a_simulated_tree_is_reported_as_a_finding() -> None:
    sources = {
        **_tree(("a", None), ("b", "a")),
        Path("b_from_the_pr.py"): _revision("b", "a"),
    }
    defect = notifier.content_defect(1316, scan_sources(sources))
    assert defect is not None
    assert "DUPLICATE" in defect
    assert "#1316" in defect
    # The id, and BOTH colliding files: this annotation is the only signal the
    # un-adviseable arm emits, so it has to be actionable without a local run.
    assert "b (b.py, b_from_the_pr.py)" in defect
    # And its own remedy. The shared trailer cannot carry this — `findings`
    # also holds marker-comment findings, which `alembic-heads-pr` says
    # nothing about — so a message that loses it becomes unactionable.
    assert "alembic-heads-pr" in defect


def test_a_zero_head_cycle_is_reported_as_a_finding() -> None:
    """A cycle has no head, so the fork text would be wrong — but the sweep
    still reached a verdict about it."""
    sources = _tree(("a", "b"), ("b", "a"))
    scan = scan_sources(sources)
    assert scan.heads == ()
    defect = notifier.content_defect(99, scan)
    assert defect is not None
    assert "ZERO heads" in defect
    assert "alembic-heads-pr" in defect  # its own remedy, not the trailer's


def test_a_clean_simulated_tree_has_no_defect() -> None:
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "b")))
    assert notifier.content_defect(1, scan) is None


def test_a_fork_is_not_a_content_defect() -> None:
    """Two heads is the thing this script EXISTS to report, over a comment on
    the PR. It must not be swallowed by the un-adviseable arm."""
    scan = scan_sources(_tree(("a", None), ("b", "a"), ("c", "a")))
    assert len(scan.heads) == 2
    assert notifier.content_defect(1, scan) is None


def test_a_finding_alone_does_not_redden_the_sweep() -> None:
    """The regression, pinned. A PR the sweep read successfully and declined
    to advise is a verdict, not an incomplete run."""
    assert notifier.sweep_exit_code([], ["#1316: simulated tree has DUPLICATE"]) == 0


def test_a_failure_still_reddens_the_sweep() -> None:
    """The other half: a PR the sweep could not read proves nothing, and that
    must never read as a clean sweep."""
    assert (
        notifier.sweep_exit_code(["#17: could not list files: 502"], [])
        == notifier.EXIT_VACUOUS
    )


def test_a_failure_wins_over_a_finding() -> None:
    assert (
        notifier.sweep_exit_code(["#17: could not comment: 502"], ["#1316: DUPLICATE"])
        == notifier.EXIT_VACUOUS
    )


def test_the_counter_still_blocks_the_tree_this_lane_now_tolerates(
    tmp_path: Path,
) -> None:
    """Staying green in the sweep is only safe because the PR's OWN required
    gate is red on the same tree.

    The invariant has four links. This test asserts two — `count_alembic_heads
    .py` REFUSES the exact tree the sweep now merely REPORTS, and
    `alembic-graph-pr.yml` really invokes that script (via the lane roster,
    which parses the workflow's `run:` slots rather than trusting prose). The
    third, that the workflow is not narrowed so it skips the PRs this lane
    tolerates, is asserted by its sibling `test_the_pr_lane_is_not_narrowed`.
    The fourth — that the check is REQUIRED and protection is strict — is a
    GitHub setting no test here can observe; it is named in the module
    docstring as the premise it is.

    If this test ever FAILS, the tolerance added to the sweep has become a
    hole and must be reverted with it.
    """
    scan = scan_sources(
        {
            **_tree(("a", None), ("b", "a")),
            Path("b_again.py"): _revision("b", "a"),
        }
    )
    # The sweep reports it and stays green ...
    defect = notifier.content_defect(1316, scan)
    assert defect is not None
    assert notifier.sweep_exit_code([], [defect]) == 0
    # ... precisely because the blocking gate does not.
    result = _run(_write_duplicate(tmp_path), "--baseline-ref", "")
    assert result.returncode == 2, result.stdout + result.stderr
    assert "DUPLICATE revision id" in result.stderr

    # The lane tolerates TWO trees, so both legs need the counter behind them.
    cycle = _run(_write(tmp_path / "cyc", ("x", "y"), ("y", "x")), "--baseline-ref", "")
    assert cycle.returncode == 2, cycle.stdout + cycle.stderr
    assert "ZERO heads" in cycle.stderr

    # And the lane that runs the counter is the PR lane, established from the
    # workflow file rather than from this docstring.
    assert ".github/workflows/alembic-graph-pr.yml" in {
        str(f) for f in invoking_files("scripts/ci/count_alembic_heads.py")
    }


def test_duplicates_are_classified_before_the_zero_head_cycle() -> None:
    """The ordering in `content_defect` is load-bearing, not cosmetic.

    A tree can be BOTH: `main` has `a->None`, `b->a`; the PR adds a second
    file declaring `a` with `down_revision = "b"`. The collapse leaves
    `{a: "b", b: "a"}` with every node parented, so the head set is empty —
    while the real three-file tree contains no cycle at all. Reporting
    "ZERO heads (a cycle)" there is a claim about a tree that does not exist,
    so duplicates must win. `count_alembic_heads.py` orders the same way.
    """
    scan = scan_sources(
        {
            **_tree(("a", None), ("b", "a")),
            Path("a_from_the_pr.py"): _revision("a", "b"),
        }
    )
    assert scan.duplicates != ()
    assert scan.heads == ()  # both arms are live on this one tree
    defect = notifier.content_defect(7, scan)
    assert defect is not None
    assert "DUPLICATE" in defect
    assert "cycle" not in defect


# ---------------------------------------------------------------------------
# 22. `main()`-level exit code — the routing, not the classifier
#
# Everything in section 21 tests `content_defect` and `sweep_exit_code` in
# isolation, and an independent review proved that is not enough: mutating
# `findings.append(defect)` back to `failures.append(defect)` in `main()` —
# the exact regression — left all of those green. The classification is only
# half the behaviour; which list `main()` puts it in is the other half, and
# these are the tests that fail on that mutation.
# ---------------------------------------------------------------------------


def _drive_main(
    monkeypatch: pytest.MonkeyPatch,
    simulated: dict[Path, str],
    *,
    files_raises: Exception | None = None,
    comments: list[dict] | None = None,
    posted: list[str] | None = None,
    test_sources: dict[Path, str] | Exception | None = None,
    pin_calls: list[int] | None = None,
    extra_files: int = 0,
) -> tuple[int, str]:
    """Run `notifier.main()` over ONE fake open PR with every call faked.

    `main` reaches the network in five places and the versions dir in two.
    All seven are replaced, so this exercises the real control flow —
    including the `failures` / `findings` routing under test — without a
    token, a socket, or the repo's own 553 revisions.
    """
    main_sources = _tree(("a", None), ("b", "a"))
    main_scan = scan_sources(main_sources)
    assert len(main_scan.heads) == 1 and not main_scan.duplicates  # sane baseline

    def _files(*_a: object, **_k: object) -> list[dict]:
        if files_raises is not None:
            raise files_raises
        return [{"filename": f"{notifier.VERSIONS_DIR}/from_the_pr.py"}] + [
            {"filename": f"docs/padding_{index}.md"} for index in range(extra_files)
        ]

    monkeypatch.setattr(notifier, "scan_dir", lambda _d: main_scan)
    monkeypatch.setattr(notifier, "read_dir_sources", lambda _d: main_sources)
    monkeypatch.setattr(notifier, "open_prs", lambda *_a: [{"number": 1316}])
    monkeypatch.setattr(notifier, "prs_carrying_a_notice", lambda *_a: (set(), ""))
    monkeypatch.setattr(notifier, "pr_files", _files)
    monkeypatch.setattr(notifier, "simulate", lambda *_a, **_k: simulated)

    def _test_sources(*_a: object, **_k: object) -> dict[Path, str]:
        if pin_calls is not None:
            pin_calls.append(1)
        if isinstance(test_sources, Exception):
            raise test_sources
        return test_sources or {}

    monkeypatch.setattr(notifier, "pr_test_sources", _test_sources)
    monkeypatch.setattr(notifier, "find_marker_comments", lambda *_a: comments or [])

    def _write(_repo: object, _n: object, body: str, *_a: object, **_k: object) -> str:
        # Recording, not just stubbed: "left untouched" is a promise about
        # this call NOT happening, and a `lambda` that swallows it makes the
        # promise uncheckable.
        if posted is not None:
            posted.append(body)
        return "posted"

    monkeypatch.setattr(notifier, "write_comment", _write)
    monkeypatch.setenv("GITHUB_TOKEN", "fake")
    monkeypatch.setattr(sys, "argv", ["notify_forked_open_prs.py", "--repo", "o/r"])

    captured = io.StringIO()
    monkeypatch.setattr(sys, "stderr", captured)
    return notifier.main(), captured.getvalue()


def test_main_stays_green_when_one_prs_tree_is_un_adviseable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """THE regression, at the level that actually produced it.

    This is the 2026-09-13 shape: `main` is single-headed and clean, and one
    open PR re-declares an id that has already landed. The sweep must report
    it and exit 0 — the duplicate is in the PR's tree, not in `main`, so a
    red here is a red no commit to `main` could clear.
    """
    simulated = {
        **_tree(("a", None), ("b", "a")),
        Path("b_from_the_pr.py"): _revision("b", "a"),
    }
    posted: list[str] = []
    code, stderr = _drive_main(
        monkeypatch,
        simulated,
        # ONE existing notice, which matters: a duplicate COLLAPSES to a
        # single head, so without the arm's `continue` this PR reaches the
        # "single head — ok" branch and that notice gets cleared. The notice
        # has to exist for the fall-through to be observable at all.
        comments=[{"id": 11, "body": "x"}],
        posted=posted,
    )
    assert code == 0
    # "left untouched" is a promise about this list. Dropping the `continue`
    # under the arm's TODO posts RESOLVED_BODY here — telling the author
    # their fork is resolved on a collapsed tree whose `alembic-heads-pr` is
    # red. Nothing else in the suite catches that.
    assert posted == []
    # Green, but never silent — and the annotation carries its own remedy,
    # since the shared trailer is now class-agnostic.
    assert "DUPLICATE" in stderr
    assert "#1316" in stderr
    assert "b_from_the_pr.py" in stderr
    assert "alembic-heads-pr" in stderr


def test_main_stays_green_when_a_prs_chain_is_a_cycle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other tolerated tree, routed the same way."""
    posted: list[str] = []
    code, stderr = _drive_main(
        monkeypatch, _tree(("x", "y"), ("y", "x")), posted=posted
    )
    assert code == 0
    assert "ZERO heads" in stderr
    # Same promise: posting the fork text over a 0-head chain is the
    # wrong-advice defect `content_defect`'s own docstring names.
    assert posted == []


def test_main_reddens_when_a_pr_could_not_be_swept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The half that must NOT have moved: a PR the sweep could not read
    proves nothing, so the run is INCOMPLETE and still exits 2."""
    code, stderr = _drive_main(
        monkeypatch,
        _tree(("a", None), ("b", "a")),
        files_raises=notifier.ApiError("502 Bad Gateway"),
    )
    assert code == notifier.EXIT_VACUOUS
    assert "could not list files" in stderr
    assert "INCOMPLETE" in stderr


def test_main_stays_green_on_a_plain_fork(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A fork is what this script exists to find, and finding one has always
    been exit 0. Pinned here so the finding/failure split cannot drag it."""
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    code, _ = _drive_main(monkeypatch, simulated)
    assert code == 0


def test_main_stays_green_when_a_pr_carries_two_marker_comments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`_report_duplicates` is a finding too, and its routing needs pinning
    at `main()` level for the same reason the content defects did.

    A second marker comment is a defect in the PR's comment thread. The sweep
    listed the comments, maintained the first and carried on — it proved
    plenty, and no commit to `main` can delete a comment on someone's PR. So
    it is reported and the lane stays green.
    """
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    code, stderr = _drive_main(
        monkeypatch,
        simulated,
        comments=[{"id": 11, "body": "x"}, {"id": 22, "body": "y"}],
    )
    assert code == 0
    assert "2 fork-notice comments exist" in stderr
    assert "Delete the extras" in stderr


def test_a_marker_comment_finding_is_not_told_to_check_the_head_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The trailer must not hand one finding class the other's remedy.

    `alembic-heads-pr` counts revision heads; it has no opinion whatever
    about duplicate bot comments, and nothing blocks a PR for carrying two.
    A run whose only finding is a second marker comment must therefore not
    mention that gate anywhere, and must not claim the PR was left
    un-adviseable — the line above it says the notice was maintained.
    """
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    code, stderr = _drive_main(
        monkeypatch,
        simulated,
        comments=[{"id": 11, "body": "x"}, {"id": 22, "body": "y"}],
    )
    assert code == 0
    assert "alembic-heads-pr" not in stderr
    assert "could not be advised" not in stderr


def test_the_un_adviseable_count_counts_only_un_adviseable_trees(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The summary counter is about trees, not about the findings list.

    A PR that is merely forked and carrying an extra marker comment produces
    a finding but nothing was left untouched, so the count must be 0. Reading
    `len(findings)` there reported one PR under a label that did not apply
    to it.
    """
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buf)
    _drive_main(
        monkeypatch,
        simulated,
        comments=[{"id": 11, "body": "x"}, {"id": 22, "body": "y"}],
    )
    assert "0 left untouched as un-adviseable." in buf.getvalue()


def test_an_un_adviseable_tree_still_increments_that_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other side of the counter, so it cannot be pinned to a constant."""
    simulated = {
        **_tree(("a", None), ("b", "a")),
        Path("b_from_the_pr.py"): _revision("b", "a"),
    }
    buf = io.StringIO()
    monkeypatch.setattr(sys, "stdout", buf)
    _drive_main(monkeypatch, simulated)
    assert "1 left untouched as un-adviseable." in buf.getvalue()


def test_the_pr_lane_is_not_narrowed() -> None:
    """The load-bearing link, asserted instead of described.

    The whole safety case for the sweep tolerating an un-adviseable tree is
    that `alembic-graph-pr.yml` runs the counter on EVERY PR this sweep can
    reach. TWO deliberate absences carry that, and until now both lived only
    as comments in that workflow: no `paths:` filter, and `main` still in the
    branch list. Narrowing either one silently reopens the hole this change
    tolerates, with nothing failing — hence the name, which is about
    narrowing in general rather than about the filter alone.
    """
    workflow = yaml.safe_load(
        (REPO_ROOT / ".github/workflows/alembic-graph-pr.yml").read_text(
            encoding="utf-8"
        )
    )
    # `on` is parsed by PyYAML 1.1 rules as the boolean True, not the string.
    triggers = workflow.get("on", workflow.get(True))
    assert "paths" not in triggers["pull_request"]
    assert "paths-ignore" not in triggers["pull_request"]
    # And it must still run on PRs against `main` at all. Dropping `main`
    # from this list reopens the hole more completely than a paths filter
    # would: the sweep enumerates only base=main PRs, so every PR it can
    # tolerate would be one the counter never ran on.
    assert "main" in triggers["pull_request"]["branches"]


# ---------------------------------------------------------------------------
# A re-point is THREE sites, not one token
#
# Plan `2026-09-05-alembic-fork-remediation-is-pairwise-the-population-is-n`
# §8.2 / §8.4 item 5. Advice naming only `down_revision` turned a red head count
# into a red test suite on #1216: the revision's migration test pins
# `_PARENT_REVISION_ID`, and several such tests assert it equals
# `down_revision`. The pin fixtures below are the three assertion shapes found
# on web `main` — the declaration line is the same in all three, which is
# exactly why one matcher serves them.
# ---------------------------------------------------------------------------

import count_alembic_heads as counter  # noqa: E402
from _alembic_graph import (  # noqa: E402
    find_computed_parent_pins,
    find_parent_pins,
    plan_repoint_sites,
    repoint_sites,
)

#: ``shape -> (file template, the pin line as written)``. The three assertion
#: bodies are the ones on web ``main``; the PIN LINE varies too, because a
#: fixture set whose pin line is identical in every entry passes against a
#: matcher that only knows that one spelling.
_PIN_SHAPES = {
    # Assertion as in test_parkwuslug_01; pin annotated and single-quoted.
    "regex_group": (
        "import re\n\n"
        '_REVISION_ID = "@REV@"\n'
        "@PIN@\n\n\n"
        "def test_parent_pin_is_the_real_parent(source: str) -> None:\n"
        "    match = _DOWN_RE.search(source)\n"
        '    assert match.group("parent") == _PARENT_REVISION_ID\n',
        "_PARENT_REVISION_ID: str = '@PARENT@'",
    ),
    # Assertion as in test_fleet_res_tel_05; pin carries a trailing comment.
    "module_attribute": (
        '_REVISION_ID = "@REV@"\n'
        "@PIN@\n\n\n"
        "def test_parent_pin_is_the_real_parent(module) -> None:\n"
        "    assert module.down_revision == _PARENT_REVISION_ID\n",
        '_PARENT_REVISION_ID = "@PARENT@"  # MUST equal down_revision',
    ),
    # Assertion as in test_pdtier_01 / _02; the plain form most files use.
    "literal_in_source": (
        '_REVISION_ID = "@REV@"\n'
        "@PIN@\n\n\n"
        "def test_parent_pin_is_the_real_parent(source: str) -> None:\n"
        "    assert (\n"
        "        f'down_revision: str | Sequence[str] | None = "
        '"{_PARENT_REVISION_ID}"\' in source\n'
        "    )\n",
        '_PARENT_REVISION_ID = "@PARENT@"',
    ),
    # Both constants as class attributes — indented.
    "indented": (
        "class TestPins:\n"
        '    _REVISION_ID = "@REV@"\n'
        "@PIN@\n\n"
        "    def test_pin(self, module) -> None:\n"
        "        assert module.down_revision == self._PARENT_REVISION_ID\n",
        '    _PARENT_REVISION_ID = "@PARENT@"',
    ),
    # A file checked out with CRLF line ends.
    "crlf": (
        '_REVISION_ID = "@REV@"\r\n'
        "@PIN@\r\n\r\n"
        "def test_pin(module) -> None:\r\n"
        "    assert module.down_revision == _PARENT_REVISION_ID\r\n",
        '_PARENT_REVISION_ID = "@PARENT@"',
    ),
}


def _pin_line(shape: str, parent: str) -> str:
    return _PIN_SHAPES[shape][1].replace("@PARENT@", parent)


def _pin_file(shape: str, rev: str, parent: str) -> str:
    template = _PIN_SHAPES[shape][0]
    return template.replace("@PIN@", _pin_line(shape, parent)).replace("@REV@", rev)


def _forked_scan():
    """`landed` and `mine` both claim `a`; `landed` is on the baseline."""
    sources = _tree(("a", None), ("landed", "a"), ("mine", "a"))
    scan = scan_sources(sources)
    remediation = plan_remediation(scan, landed={"a", "landed"})
    assert remediation.kind == "repoint" and remediation.target == "landed"
    return sources, scan, remediation


@pytest.mark.parametrize("shape", sorted(_PIN_SHAPES))
def test_a_pin_of_every_shape_is_found_and_rewritten(shape: str) -> None:
    pin_path = Path("backend/tests/test_mine_migration.py")
    found = find_parent_pins(
        {pin_path: _pin_file(shape, "mine", "a")}, "mine", "a", "landed"
    )
    assert len(found) == 1
    assert found[0].path == pin_path
    # The line as written — quote style, annotation, indentation, comment —
    # with ONLY the literal changed. No `\r` survives from a CRLF file.
    assert found[0].before == _pin_line(shape, "a")
    assert found[0].after == _pin_line(shape, "landed")
    assert "\r" not in found[0].before + found[0].after
    assert (
        found[0].lineno
        == _pin_file(shape, "mine", "a").splitlines().index(_pin_line(shape, "a")) + 1
    )


@pytest.mark.parametrize("shape", sorted(_PIN_SHAPES))
def test_both_renderers_carry_the_pin_rewrite_for_every_shape(shape: str) -> None:
    sources, scan, remediation = _forked_scan()
    pin_path = Path("backend/tests/test_mine_migration.py")
    sites = plan_repoint_sites(
        scan, remediation, sources, {pin_path: _pin_file(shape, "mine", "a")}
    )
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="the tests"
    )
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="the tests"
    )
    for rendered in (text, comment):
        # All three sites, each with its exact before -> after line.
        assert 'down_revision: str | Sequence[str] | None = "a"' in rendered
        assert 'down_revision: str | Sequence[str] | None = "landed"' in rendered
        assert "Revises: a" in rendered
        assert "Revises: landed" in rendered
        assert _pin_line(shape, "a").strip() in rendered
        assert _pin_line(shape, "landed").strip() in rendered
        assert "test_mine_migration.py" in rendered
        assert "no `_PARENT_REVISION_ID` pin found" not in rendered
        # The defect this block exists for: never "one token" again.
        assert "one token" not in rendered.lower()
        assert "one-token" not in rendered.lower()


def test_no_pin_says_so_explicitly_in_both_renderers() -> None:
    sources, scan, remediation = _forked_scan()
    sites = plan_repoint_sites(scan, remediation, sources, {})
    assert sites["mine"].pins == ()
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="the tests"
    )
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="the tests"
    )
    expected_tail = "— if its test pins the parent under another name, update it too"
    assert f"no `_PARENT_REVISION_ID` pin found for mine {expected_tail}" in text
    assert f"no `_PARENT_REVISION_ID` pin found for `mine` {expected_tail}" in comment
    for rendered in (text, comment):
        assert "Revises: landed" in rendered  # the other two sites still named


def test_a_pin_search_that_did_not_run_is_unknown_not_none_found() -> None:
    """`pin_scope=None` — nobody searched — must not read as "no pin"."""
    sources, scan, remediation = _forked_scan()
    sites = plan_repoint_sites(scan, remediation, sources, {})
    text = render_remediation(remediation, "origin/main", scan.heads, sites=sites)
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites
    )
    for rendered in (text, comment):
        assert "UNKNOWN" in rendered
        assert "pin found" not in rendered
    # And with no sites at all, the three sites are still named.
    bare = render_remediation(remediation, "origin/main", scan.heads)
    assert "_PARENT_REVISION_ID" in bare and "Revises:" in bare and "UNKNOWN" in bare


def test_a_pin_naming_a_different_parent_is_not_listed() -> None:
    test_sources = {
        Path("backend/tests/test_mine_migration.py"): _pin_file(
            "module_attribute", "mine", "somewhere_else"
        )
    }
    # Not listed as a REWRITE — rewriting it would assert a parent this graph
    # never showed it had...
    assert find_parent_pins(test_sources, "mine", "a", "landed") == ()
    sources, scan, remediation = _forked_scan()
    sites = plan_repoint_sites(scan, remediation, sources, test_sources)
    assert sites["mine"].pins == ()
    assert [(p.lineno, p.value) for p in sites["mine"].mismatched_pins] == [
        (2, "somewhere_else")
    ]
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="the tests"
    )
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="the tests"
    )
    # ...but NAMED: "no pin found" would be false, there IS one and it is wrong.
    # The location goes through `repo_relative`, which resolves against the
    # working directory — so compare against that, not a hand-typed prefix.
    location = notifier.repo_relative(Path("backend/tests/test_mine_migration.py"))
    assert (
        f'`_PARENT_REVISION_ID` in {location}:2 names "somewhere_else", not "a"'
        " — check it" in text
    )
    assert 'names "somewhere_else", not "a" — check it' in comment
    for rendered in (text, comment):
        assert "pin found" not in rendered
        assert '_PARENT_REVISION_ID = "landed"' not in rendered
    # The notifier also names it INSIDE its code block, as a comment line.
    assert f"# 3. the test pin — {location}:2 — names another parent: check it" in (
        comment
    )
    assert f"# {_pin_line('module_attribute', 'somewhere_else')}" in comment

    # One file holding BOTH a pin naming the old parent and one naming something
    # else: each is reported exactly once, in its own bucket — never twice.
    both_path = Path("backend/tests/test_mine_both_migration.py")
    both = {
        both_path: (
            '_REVISION_ID = "mine"\n'
            '_PARENT_REVISION_ID = "a"\n'
            '_PARENT_REVISION_ID = "somewhere_else"\n'
        )
    }
    both_sites = plan_repoint_sites(scan, remediation, sources, both)
    assert [(p.lineno, p.before) for p in both_sites["mine"].pins] == [
        (2, '_PARENT_REVISION_ID = "a"')
    ]
    assert [(p.lineno, p.value) for p in both_sites["mine"].mismatched_pins] == [
        (3, "somewhere_else")
    ]
    both_text = render_remediation(
        remediation, "origin/main", scan.heads, sites=both_sites, pin_scope="the tests"
    )
    both_comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=both_sites, pin_scope="x"
    )
    for rendered in (both_text, both_comment):
        assert rendered.count('_PARENT_REVISION_ID = "a"') == 1
        assert rendered.count('names "somewhere_else"') == 1
        assert 'names "a"' not in rendered


def test_a_pin_in_another_revisions_test_is_not_listed() -> None:
    """Same old parent, different `_REVISION_ID`: not this re-point's file."""
    test_sources = {
        Path("backend/tests/test_other_migration.py"): _pin_file(
            "regex_group", "other", "a"
        )
    }
    assert find_parent_pins(test_sources, "mine", "a", "landed") == ()


def test_a_chain_root_has_no_pin_to_match() -> None:
    """`down_revision = None` — no string pin can name it."""
    test_sources = {Path("t.py"): _pin_file("regex_group", "r", "None")}
    assert find_parent_pins(test_sources, "r", None, "landed") == ()


def test_the_sites_quote_the_authors_own_lines() -> None:
    """A legacy unannotated file keeps its own left-hand side; a missing
    `Revises:` line is reported as absent, not invented."""
    source = 'revision = "mine"\ndown_revision = "a"\n'
    scan = scan_sources({Path("mine.py"): source, **_tree(("a", None))})
    sites = repoint_sites(scan, "mine", "landed", source, {})
    assert sites.old_parent == "a"
    assert sites.down_revision == ('down_revision = "a"', 'down_revision = "landed"')
    assert sites.revises is None
    comment_lines = notifier._site_block(
        "mine", Path("mine.py"), "landed", sites, "the tests"
    )
    assert any("has no Revises: line" in line for line in comment_lines)
    # The counter says the same thing, and does not invent a before-line.
    counter_lines = counter._site_lines(
        "mine", Path("mine.py"), "landed", sites, "the tests"
    )
    assert any("has no `Revises:` line" in line for line in counter_lines)
    assert not any("Revises: landed" in line for line in counter_lines)
    # A single-quoted parent keeps its single quotes.
    single = "revision = 'mine'\ndown_revision = 'a'\n"
    scan = scan_sources({Path("mine.py"): single, **_tree(("a", None))})
    assert repoint_sites(scan, "mine", "landed", single, {}).down_revision == (
        "down_revision = 'a'",
        "down_revision = 'landed'",
    )


def test_the_counter_main_names_the_pin_it_found_on_disk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """The local-tree wiring end to end: exit code unchanged, pin named."""
    versions = _write(tmp_path / "v", ("a", None), ("landed", "a"), ("mine", "a"))
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    pin = tests_dir / "test_mine_migration.py"
    pin.write_text(_pin_file("literal_in_source", "mine", "a"), encoding="utf-8")
    monkeypatch.setattr(counter, "TESTS_ROOT", tests_dir)
    monkeypatch.setattr(counter, "revisions_at_ref", lambda *_a: {"a", "landed"})
    monkeypatch.setattr(
        sys, "argv", ["count_alembic_heads.py", "--versions-dir", str(versions)]
    )
    assert counter.main() == counter.EXIT_VIOLATION  # still 1 on a fork
    stderr = capsys.readouterr().err
    assert "test_mine_migration.py" in stderr
    assert 'before: _PARENT_REVISION_ID = "a"' in stderr
    assert 'after:  _PARENT_REVISION_ID = "landed"' in stderr
    assert "before: Revises: a" in stderr


def test_the_counter_main_says_unknown_when_the_tests_dir_is_absent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    versions = _write(tmp_path / "v", ("a", None), ("landed", "a"), ("mine", "a"))
    monkeypatch.setattr(counter, "TESTS_ROOT", tmp_path / "no_such_dir")
    monkeypatch.setattr(counter, "revisions_at_ref", lambda *_a: {"a", "landed"})
    monkeypatch.setattr(
        sys, "argv", ["count_alembic_heads.py", "--versions-dir", str(versions)]
    )
    assert counter.main() == counter.EXIT_VIOLATION
    stderr = capsys.readouterr().err
    assert "UNKNOWN" in stderr
    assert "pin found" not in stderr


def test_the_sweep_posts_the_pin_rewrite_from_the_prs_own_test_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`_drive_main`'s baseline is `a -> b`; the PR adds `c` off `a`."""
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    posted: list[str] = []
    code, _ = _drive_main(
        monkeypatch,
        simulated,
        posted=posted,
        test_sources={
            Path("backend/tests/test_c_migration.py"): _pin_file(
                "regex_group", "c", "a"
            )
        },
    )
    assert code == 0
    assert len(posted) == 1
    assert f"- {_pin_line('regex_group', 'a')}" in posted[0]
    assert f"+ {_pin_line('regex_group', 'b')}" in posted[0]
    assert "test_c_migration.py" in posted[0]


def test_an_unreadable_pr_test_listing_is_a_finding_and_an_unknown_notice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exit code unchanged (a finding, not a failure); the notice says UNKNOWN."""
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    posted: list[str] = []
    code, stderr = _drive_main(
        monkeypatch,
        simulated,
        posted=posted,
        test_sources=notifier.ApiError("502 Bad Gateway"),
    )
    assert code == 0
    assert "pin search is UNKNOWN" in stderr
    assert len(posted) == 1
    assert "UNKNOWN" in posted[0]
    assert "pin found" not in posted[0]


def test_the_advice_never_claims_coord_will_repoint() -> None:
    """Coord's arming is UNKNOWN (plan §8.5 Phase 0); the text must not promise it."""
    sources, scan, remediation = _forked_scan()
    sites = plan_repoint_sites(scan, remediation, sources, {})
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="x"
    )
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="x"
    )
    for rendered in (comment, text):
        assert "coord will" not in rendered.lower()
        assert "automatically" not in rendered.lower()


# ---------------------------------------------------------------------------
# Review round 2: what the matcher must NOT match, and when it must not run
# ---------------------------------------------------------------------------

_MERGE_M = 'revision: str = "m"\ndown_revision = ("c", "d")\n'


@pytest.mark.parametrize(
    ("label", "simulated"),
    [
        ("single_head", _tree(("a", None), ("b", "a"))),
        ("merge", _tree(("a", None), ("b", None))),
        ("chain", _tree(("a", None), ("b", "a"), ("p", "b"), ("q", "b"))),
        (
            "blocked_without_edits",
            {
                **_tree(("a", None), ("b", "a"), ("c", "a"), ("d", "a")),
                Path("m.py"): _MERGE_M,
            },
        ),
    ],
)
def test_the_pin_search_does_not_run_without_a_revision_to_repoint(
    monkeypatch: pytest.MonkeyPatch, label: str, simulated: dict[Path, str]
) -> None:
    """No `edits` means nothing to re-point: no fetch, and no UNKNOWN finding."""
    if label == "blocked_without_edits":
        remediation = plan_remediation(scan_sources(simulated), {"a", "b"})
        assert remediation.kind == "blocked"
        assert remediation.target == "b" and remediation.edits == ()
    pin_calls: list[int] = []
    code, stderr = _drive_main(monkeypatch, simulated, pin_calls=pin_calls)
    assert code == 0
    assert pin_calls == []
    assert "pin search is UNKNOWN" not in stderr


def test_the_pin_search_does_run_for_a_plain_fork(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The positive control for the test above — otherwise it proves nothing."""
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    pin_calls: list[int] = []
    _drive_main(monkeypatch, simulated, pin_calls=pin_calls)
    assert pin_calls == [1]


def test_only_the_pin_naming_the_old_parent_is_listed_among_two() -> None:
    source = (
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n'
        '_PARENT_REVISION_ID = "zzz"  # a second, unrelated pin\n'
    )
    found = find_parent_pins({Path("t.py"): source}, "mine", "a", "landed")
    assert [(p.lineno, p.after) for p in found] == [
        (2, '_PARENT_REVISION_ID = "landed"')
    ]


def test_an_annotation_cannot_borrow_the_next_lines_value() -> None:
    """`[^=]*` spanned the newline: `_PARENT_REVISION_ID: str` + `_X = "a"`."""
    parent_trap = (
        '_REVISION_ID = "mine"\n_PARENT_REVISION_ID: str\n_SOMETHING_ELSE = "a"\n'
    )
    assert find_parent_pins({Path("t.py"): parent_trap}, "mine", "a", "x") == ()
    assert find_computed_parent_pins({Path("t.py"): parent_trap}, "mine") == ()
    revision_trap = '_REVISION_ID: str\n_OTHER = "mine"\n_PARENT_REVISION_ID = "a"\n'
    assert find_parent_pins({Path("t.py"): revision_trap}, "mine", "a", "x") == ()


def test_a_docstring_quoting_another_revisions_lines_does_not_qualify() -> None:
    source = (
        '"""Copied from the mine test, for contrast:\n'
        "\n"
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n'
        '"""\n'
        "\n"
        '_REVISION_ID = "other"\n'
        '_PARENT_REVISION_ID = "a"\n'
    )
    sources = {Path("backend/tests/test_other_migration.py"): source}
    assert find_parent_pins(sources, "mine", "a", "landed") == ()
    # ...while the file's REAL declaration still works, at its real line.
    assert [p.lineno for p in find_parent_pins(sources, "other", "a", "x")] == [8]


def test_a_computed_pin_is_named_for_a_human_not_reported_absent() -> None:
    sources, scan, remediation = _forked_scan()
    test_sources = {
        Path("backend/tests/test_mine_migration.py"): (
            '_REVISION_ID = "mine"\n_PARENT_REVISION_ID = _parent_revision_id()\n'
        )
    }
    sites = plan_repoint_sites(scan, remediation, sources, test_sources)
    assert sites["mine"].pins == ()
    assert [c.lineno for c in sites["mine"].computed_pins] == [2]
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="the tests"
    )
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="the tests"
    )
    for rendered in (text, comment):
        assert (
            "a `_PARENT_REVISION_ID` is computed, not literal — check it by hand"
            in rendered
        )
        assert "pin found" not in rendered
        assert "_parent_revision_id()" in rendered


def test_the_blocked_arm_of_both_renderers_carries_the_three_sites() -> None:
    sources = {
        **_tree(
            ("a", None),
            ("landed", "a"),
            ("h1", "a"),
            ("h2", "h1"),
            ("b", "a"),
            ("c", "a"),
        ),
        Path("m.py"): 'revision: str = "m"\ndown_revision = ("b", "c")\n',
    }
    scan = scan_sources(sources)
    remediation = plan_remediation(scan, landed={"a", "landed"})
    assert remediation.kind == "blocked"
    assert [rev for rev, _ in remediation.edits] == ["h1"]
    pin_path = Path("backend/tests/test_h1_migration.py")
    sites = plan_repoint_sites(
        scan, remediation, sources, {pin_path: _pin_file("module_attribute", "h1", "a")}
    )
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="the tests"
    )
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="the tests"
    )
    for rendered in (text, comment):
        assert "APPEND" in rendered
        assert "Revises: landed" in rendered
        assert _pin_line("module_attribute", "a") in rendered
        assert _pin_line("module_attribute", "landed") in rendered
        assert "test_h1_migration.py" in rendered


def test_a_down_revision_comment_survives_the_rewrite_and_cr_does_not() -> None:
    source = (
        '"""mine\r\n\r\nRevises: a\r\n"""\r\n'
        'revision: str = "mine"\r\n'
        'down_revision: str | None = "a"  # forked off a\r\n'
    )
    scan = scan_sources({Path("mine.py"): source, **_tree(("a", None))})
    sites = repoint_sites(scan, "mine", "landed", source, {})
    assert sites.down_revision == (
        'down_revision: str | None = "a"  # forked off a',
        'down_revision: str | None = "landed"  # forked off a',
    )
    assert sites.revises == ("Revises: a", "Revises: landed")


def test_a_chain_roots_none_is_replaced_and_its_comment_kept() -> None:
    source = 'revision = "r"\ndown_revision = None  # the first of its chain\n'
    scan = scan_sources({Path("r.py"): source})
    sites = repoint_sites(scan, "r", "landed", source, {})
    assert sites.down_revision[1] == (
        'down_revision = "landed"  # the first of its chain'
    )


def test_only_test_files_that_could_hold_a_pin_are_downloaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = [
        {
            "filename": "backend/tests/test_added_no_pin.py",
            "status": "added",
            "patch": "@@ +1 @@\n+def test_x(): pass\n",
        },
        {
            "filename": "backend/tests/test_added_pin.py",
            "status": "added",
            "patch": '@@ +1 @@\n+_PARENT_REVISION_ID = "a"\n',
        },
        {
            "filename": "backend/tests/test_modified.py",
            "status": "modified",
            "patch": "@@ -9 +9 @@\n-x\n+y\n",
        },
        {"filename": "backend/tests/test_added_big.py", "status": "added"},
        {"filename": "backend/tests/test_removed.py", "status": "removed"},
        {"filename": "backend/app/not_a_test.py", "status": "added", "patch": ""},
        {"filename": f"{notifier.VERSIONS_DIR}/rev.py", "status": "added"},
    ]
    fetched: list[str] = []

    def _blob(_repo: str, path: str, _ref: str, _token: str) -> str:
        fetched.append(path)
        return "x"

    def _no_second_listing(*_a: object, **_k: object) -> list[dict]:
        raise AssertionError("pr_test_sources must reuse the listing it was given")

    monkeypatch.setattr(notifier, "blob_at", _blob)
    monkeypatch.setattr(notifier, "_paginate", _no_second_listing)
    sources = notifier.pr_test_sources(
        "o/r", {"number": 1, "head": {"sha": "deadbeef"}}, files, "t"
    )
    assert sorted(fetched) == [
        "backend/tests/test_added_big.py",
        "backend/tests/test_added_pin.py",
        "backend/tests/test_modified.py",
    ]
    assert len(sources) == 3
    assert notifier.pr_version_files(files) == [files[-1]]


# ---------------------------------------------------------------------------
# Review round 3: masking must read strings the way Python does
# ---------------------------------------------------------------------------

_TRIPLE = '"' * 3

_MASKING_TRAPS = {
    # `'"""'` is a real idiom: test_pdann_01 splits a source on it.
    "triple_quote_in_a_single_quoted_literal": (
        f"_SPLIT = '{_TRIPLE}'\n"
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n'
        "\n\n"
        "def test_x() -> None:\n"
        f"    {_TRIPLE}Docstring — with a non-ASCII dash.{_TRIPLE}\n",
        3,
    ),
    "triple_quote_in_a_comment": (
        f"# see the {_TRIPLE} block below\n"
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n'
        "\n\n"
        "def test_x() -> None:\n"
        f"    {_TRIPLE}Docstring.{_TRIPLE}\n",
        3,
    ),
    "escaped_triple_quote_inside_a_docstring": (
        f"{_TRIPLE}Module doc with an escaped \\{_TRIPLE} inside it.\n"
        f"{_TRIPLE}\n"
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n'
        "\n\n"
        "def test_x() -> None:\n"
        f"    {_TRIPLE}Docstring.{_TRIPLE}\n",
        4,
    ),
    # A triple-quoted f-string quoting another revision's lines. On 3.12+ the
    # tokenizer splits it into FSTRING_START .. FSTRING_END, not one STRING.
    "fstring_docstring_quoting_another_revision": (
        '_WHO = "x"\n'
        f"_NOTE = f{_TRIPLE}Borrowed from the {{_WHO}} test:\n"
        '_REVISION_ID = "x"\n'
        '_PARENT_REVISION_ID = "a"\n'
        f"{_TRIPLE}\n"
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n',
        7,
    ),
    # A single-quoted string continued across lines with backslashes: not
    # triple-quoted, but multi-line, and it quotes a declaration.
    "backslash_continued_single_quoted_string": (
        "_NOTE = 'quoted: \\\n"
        '_REVISION_ID = "x" \\\n'
        "end'\n"
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n',
        5,
    ),
}


@pytest.mark.parametrize("trap", sorted(_MASKING_TRAPS))
def test_a_stray_triple_quote_does_not_blank_the_real_declaration(trap: str) -> None:
    source, pin_line = _MASKING_TRAPS[trap]
    compile(source, trap, "exec")  # the fixture is real Python, not a guess
    found = find_parent_pins({Path("t.py"): source}, "mine", "a", "landed")
    assert [(p.lineno, p.after) for p in found] == [
        (pin_line, '_PARENT_REVISION_ID = "landed"')
    ]


def test_masking_falls_back_when_the_file_does_not_tokenize() -> None:
    """A half-written file still masks its docstring rather than qualifying it."""
    source = (
        '_REVISION_ID = "other"\n'
        '_PARENT_REVISION_ID = "a"\n'
        f"{_TRIPLE}\n"
        '_REVISION_ID = "mine"\n'
        f"{_TRIPLE}\n"
        "broken = (\n"
    )
    assert find_parent_pins({Path("t.py"): source}, "mine", "a", "x") == ()
    assert [
        p.lineno for p in find_parent_pins({Path("t.py"): source}, "other", "a", "x")
    ] == [2]


@pytest.mark.parametrize("kind", ["timeout", "reset", "incomplete_read"])
def test_a_failed_body_read_is_an_api_error_not_a_crash(kind: str) -> None:
    """`urlopen` returned; the READ failed. That must reach `except ApiError`."""
    import http.client

    raised = {
        "timeout": TimeoutError("The read operation timed out"),
        "reset": ConnectionResetError("Connection reset by peer"),
        "incomplete_read": http.client.IncompleteRead(b"partial", 100),
    }[kind]

    class _Response:
        headers: dict[str, str] = {}

        def __enter__(self) -> _Response:
            return self

        def __exit__(self, *_exc: object) -> None:
            return None

        def read(self) -> bytes:
            raise raised

    original = notifier.urllib.request.urlopen
    notifier.urllib.request.urlopen = lambda request, timeout=None: _Response()
    try:
        with pytest.raises(notifier.ApiError, match=type(raised).__name__):
            notifier._request("https://example.invalid/x", "t")
    finally:
        notifier.urllib.request.urlopen = original


def _counter_fork(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
    pairs: tuple[tuple[str, str | None], ...],
    landed: set[str],
    extra: dict[str, str] | None = None,
) -> tuple[int, str, list[Path]]:
    """Run the counter's `main()` in-process, recording every pin-search read."""
    versions = _write(tmp_path / "v", *pairs)
    for name, text in (extra or {}).items():
        (versions / name).write_text(text, encoding="utf-8")
    reads: list[Path] = []

    def _record(tests_dir: Path, *_rest: object) -> dict[Path, str]:
        reads.append(tests_dir)
        return {}

    monkeypatch.setattr(counter, "read_test_sources", _record)
    monkeypatch.setattr(counter, "revisions_at_ref", lambda *_a: landed)
    monkeypatch.setattr(
        sys, "argv", ["count_alembic_heads.py", "--versions-dir", str(versions)]
    )
    code = counter.main()
    return code, capsys.readouterr().err, reads


@pytest.mark.parametrize(
    ("label", "pairs", "landed", "extra", "kind"),
    [
        (
            "blocked_without_edits",
            (("a", None), ("landed", "a"), ("c", "a"), ("d", "a")),
            {"a", "landed"},
            {"m.py": 'revision: str = "m"\ndown_revision = ("c", "d")\n'},
            "blocked",
        ),
        ("chain", (("a", None), ("p", "a"), ("q", "a")), {"a"}, None, "chain"),
    ],
)
def test_the_counter_does_not_search_for_pins_without_a_revision_to_repoint(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
    label: str,
    pairs: tuple[tuple[str, str | None], ...],
    landed: set[str],
    extra: dict[str, str] | None,
    kind: str,
) -> None:
    versions_sources = {Path(f"{rev}.py"): _revision(rev, down) for rev, down in pairs}
    for name, text in (extra or {}).items():
        versions_sources[Path(name)] = text
    remediation = plan_remediation(scan_sources(versions_sources), landed)
    assert remediation.kind == kind
    if kind == "blocked":
        assert remediation.target == "landed" and remediation.edits == ()
    code, stderr, reads = _counter_fork(
        tmp_path, monkeypatch, capsys, pairs, landed, extra
    )
    assert code == counter.EXIT_VIOLATION  # the verdict does not move
    assert reads == [], f"{label}: searched for pins with nothing to re-point"
    assert "UNKNOWN" not in stderr
    assert "pin found" not in stderr
    assert "_PARENT_REVISION_ID = " not in stderr
    assert "computed, not literal" not in stderr


def test_the_counter_does_search_for_pins_on_a_plain_fork(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """Positive control for the test above."""
    _, stderr, reads = _counter_fork(
        tmp_path,
        monkeypatch,
        capsys,
        (("a", None), ("landed", "a"), ("mine", "a")),
        {"a", "landed"},
    )
    assert reads == [counter.TESTS_ROOT]
    assert "no `_PARENT_REVISION_ID` pin found for mine" in stderr


def test_the_sweep_says_no_pin_found_when_its_search_ran_and_found_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`test_sources={}` — searched, nothing there — is NOT an UNKNOWN."""
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    posted: list[str] = []
    code, stderr = _drive_main(monkeypatch, simulated, posted=posted, test_sources={})
    assert code == 0
    assert len(posted) == 1
    assert "no `_PARENT_REVISION_ID` pin found for `c`" in posted[0]
    assert "UNKNOWN" not in posted[0]
    assert "pin search is UNKNOWN" not in stderr


def test_a_capped_file_listing_makes_the_pin_search_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """At GitHub's 3000-file cap the pin's file may simply not be listed."""
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    posted: list[str] = []
    pin_calls: list[int] = []
    code, _ = _drive_main(
        monkeypatch,
        simulated,
        posted=posted,
        pin_calls=pin_calls,
        # EXACTLY the cap in total (one revision file + CAP - 1 padding):
        # GitHub never returns more, so `>=` is the boundary under test, and a
        # 3001-file listing would let `>` pass too.
        extra_files=notifier.PR_FILES_LISTING_CAP - 1,
    )
    assert code == 0  # wording only; the exit code does not move
    assert pin_calls == []  # nothing fetched from a listing we cannot trust
    assert len(posted) == 1
    assert "UNKNOWN" in posted[0]
    assert "pin found" not in posted[0]


# ---------------------------------------------------------------------------
# Review round 4: the tokenizer can fail in ways no narrow `except` names
# ---------------------------------------------------------------------------

#: Measured on stock CPython 3.12.14 and 3.13.5: `tokenize.generate_tokens`
#: raises SystemError on exactly this text — a space, a stray `}`, a newline, a
#: NUL. Near-misses do NOT: `"' }\n\x00"` (a leading quote) and `"}\n\x00"` both
#: raise TokenError. The sweep test also forces SystemError through a
#: monkeypatch, so it fails on the narrow `except` on every Python version.
_TOKENIZER_CRASH = " }\n\x00"


def _regex_mask(source: str) -> str:
    """What the documented regex fallback produces, for comparison."""
    import re

    import _alembic_graph as graph

    return graph.TRIPLE_QUOTED_RE.sub(
        lambda m: re.sub(r"[^\n]", " ", m.group(0)), source.replace("\r", " ")
    )


@pytest.mark.parametrize(
    "raised",
    [
        SystemError("returned a result with an exception set"),
        IndentationError("unindent does not match any outer indentation level"),
        SyntaxError("invalid syntax"),
        "TokenError",
    ],
    ids=["SystemError", "IndentationError", "SyntaxError", "TokenError"],
)
def test_any_tokenizer_failure_falls_back_to_the_regex(
    monkeypatch: pytest.MonkeyPatch, raised: object
) -> None:
    import tokenize

    import _alembic_graph as graph

    error = (
        tokenize.TokenError("EOF in multi-line statement")
        if raised == "TokenError"
        else raised
    )
    # A fixture on which the two paths DISAGREE, so "the fallback ran" is
    # observable: tokenize reads `'\"\"\"'` as one string, the regex opens a
    # mask there and blanks the real declaration.
    source = _MASKING_TRAPS["triple_quote_in_a_single_quoted_literal"][0]
    assert graph._mask_triple_quoted(source) != _regex_mask(source)

    def _explode(*_a: object, **_k: object) -> object:
        raise error  # type: ignore[misc]

    monkeypatch.setattr(graph.tokenize, "generate_tokens", _explode)
    assert graph._mask_triple_quoted(source) == _regex_mask(source)
    # ...which is the regex's documented misread, and no exception.
    assert find_parent_pins({Path("t.py"): source}, "mine", "a", "x") == ()


def test_the_measured_tokenizer_crash_input_does_not_raise() -> None:
    import _alembic_graph as graph

    masked = graph._mask_triple_quoted(_TOKENIZER_CRASH)
    assert len(masked) == len(_TOKENIZER_CRASH)
    assert masked.count("\n") == _TOKENIZER_CRASH.count("\n")


def test_one_untokenizable_test_file_does_not_stop_the_sweep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The 3.12 end-to-end crash: exit 1, zero comments. Now: exit 0, notice posted.

    The real crash text is used, AND the tokenizer is forced to raise
    SystemError on it — so the test fails on the narrow `except` on every
    Python, not only on the versions where the text itself crashes.
    """
    import _alembic_graph as graph

    real_spans = graph._string_spans

    def _crash_on_nul(text: str) -> list[tuple[int, int]]:
        if "\x00" in text:
            raise SystemError("returned a result with an exception set")
        return real_spans(text)

    monkeypatch.setattr(graph, "_string_spans", _crash_on_nul)
    simulated = {**_tree(("a", None), ("b", "a")), Path("c.py"): _revision("c", "a")}
    posted: list[str] = []
    code, _ = _drive_main(
        monkeypatch,
        simulated,
        posted=posted,
        test_sources={
            Path("backend/tests/test_broken.py"): _TOKENIZER_CRASH,
            Path("backend/tests/test_c_migration.py"): _pin_file(
                "literal_in_source", "c", "a"
            ),
        },
    )
    assert code == 0
    assert len(posted) == 1
    assert '+ _PARENT_REVISION_ID = "b"' in posted[0]


def test_masked_offsets_are_characters_not_bytes() -> None:
    """Non-ASCII BEFORE a masked string on the same line shifts a byte offset."""
    import _alembic_graph as graph

    source = (
        'EM = "— —"; NOTE = """quoted:\n'
        '_REVISION_ID = "x"\n'
        '"""\n'
        '_REVISION_ID = "mine"\n'
        '_PARENT_REVISION_ID = "a"\n'
    )
    compile(source, "offsets", "exec")
    first_line = graph._mask_triple_quoted(source).split("\n")[0]
    assert first_line == 'EM = "— —"; NOTE = ' + " " * len('"""quoted:')
    assert find_parent_pins({Path("t.py"): source}, "x", "a", "y") == ()
    assert [
        p.lineno for p in find_parent_pins({Path("t.py"): source}, "mine", "a", "y")
    ] == [5]


def test_no_masking_trap_qualifies_the_revision_it_only_quotes() -> None:
    """Every trap that quotes `_REVISION_ID = "x"` inside a string must not
    make that file a pin source for `x`."""
    for trap, (source, _) in _MASKING_TRAPS.items():
        test_sources = {Path("t.py"): source}
        assert find_parent_pins(test_sources, "x", "a", "y") == (), trap
        assert find_computed_parent_pins(test_sources, "x") == (), trap


def test_a_mismatched_value_is_sanitised_before_it_reaches_prose() -> None:
    """The value comes from a PR author's file and lands in a bot's comment."""
    sources, scan, remediation = _forked_scan()
    evil = "evil` @org/team"
    test_sources = {
        Path("backend/tests/test_mine_migration.py"): (
            f'_REVISION_ID = "mine"\n_PARENT_REVISION_ID = "{evil}"\n'
        )
    }
    sites = plan_repoint_sites(scan, remediation, sources, test_sources)
    assert [p.value for p in sites["mine"].mismatched_pins] == [evil]
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="x"
    )
    # Odd segments of a split on the fence marker are code; even ones are prose,
    # where a backtick closes a span and an @mention fires.
    prose = "".join(comment.split("```")[0::2])
    assert "@org/team" not in prose
    assert "evil`" not in prose
    assert 'names "evilorgteam"' in prose


def test_a_non_literal_down_revision_is_not_described_as_a_root() -> None:
    pin = {
        Path("backend/tests/test_mine_migration.py"): (
            '_REVISION_ID = "mine"\n_PARENT_REVISION_ID = "a"\n'
        )
    }

    def _render(source: str):
        scan = scan_sources({Path("mine.py"): source})
        sites = repoint_sites(scan, "mine", "landed", source, pin)
        text = "\n".join(
            counter._site_lines("mine", Path("mine.py"), "landed", sites, "the tests")
        )
        comment = "\n".join(
            notifier._site_block("mine", Path("mine.py"), "landed", sites, "the tests")
        )
        return sites, text, comment

    sites, text, comment = _render('revision = "mine"\ndown_revision = PARENT\n')
    assert sites.old_parent is None and sites.parent_unparsed
    for rendered in (text, comment):
        assert (
            "no parent literal parsed from `down_revision` — check it by hand"
            in rendered
        )
        assert "not None" not in rendered

    root, root_text, root_comment = _render(
        'revision = "mine"\ndown_revision = None  # first of its chain\n'
    )
    assert root.old_parent is None and not root.parent_unparsed
    for rendered in (root_text, root_comment):
        assert 'names "a", not None — check it' in rendered
        assert "no parent literal parsed" not in rendered


def test_a_pin_already_naming_the_target_says_so() -> None:
    sources, scan, remediation = _forked_scan()
    test_sources = {
        Path("backend/tests/test_mine_migration.py"): (
            '_REVISION_ID = "mine"\n_PARENT_REVISION_ID = "landed"\n'
        )
    }
    sites = plan_repoint_sites(scan, remediation, sources, test_sources)
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="the tests"
    )
    comment = notifier.render_comment(
        scan.heads, remediation, "cafebabe1234", sites=sites, pin_scope="the tests"
    )
    for rendered in (text, comment):
        assert 'already names the target "landed" — nothing to change there' in (
            rendered
        )
        assert 'names "landed", not' not in rendered


def test_an_unreadable_test_file_makes_the_counter_pin_search_unknown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """Skipping an unreadable file used to end in "no pin found" — about a
    search that never saw the file the pin could be in."""
    import _alembic_graph as graph

    versions = _write(tmp_path / "v", ("a", None), ("landed", "a"), ("mine", "a"))
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_other.py").write_text(
        '_REVISION_ID = "other"\n_PARENT_REVISION_ID = "a"\n', encoding="utf-8"
    )
    locked = tests_dir / "test_locked.py"
    locked.write_text("# made unreadable below\n", encoding="utf-8")
    real_read_text = Path.read_text

    def _read_text(self: Path, *args: object, **kwargs: object) -> str:
        if self.name == "test_locked.py":
            raise PermissionError(13, "Permission denied", str(self))
        return real_read_text(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Path, "read_text", _read_text)
    unreadable: list[Path] = []
    assert graph.read_test_sources(tests_dir, unreadable) is not None
    assert unreadable == [locked]

    monkeypatch.setattr(counter, "TESTS_ROOT", tests_dir)
    monkeypatch.setattr(counter, "revisions_at_ref", lambda *_a: {"a", "landed"})
    monkeypatch.setattr(
        sys, "argv", ["count_alembic_heads.py", "--versions-dir", str(versions)]
    )
    assert counter.main() == counter.EXIT_VIOLATION  # the verdict does not move
    stderr = capsys.readouterr().err
    assert "test_locked.py" in stderr
    assert "UNKNOWN" in stderr
    assert "pin found" not in stderr


@pytest.mark.parametrize(
    ("label", "rhs"),
    [
        ("triple_quoted_on_one_line", f"{_TRIPLE}a{_TRIPLE}"),
        ("raw_triple_quoted_on_one_line", f"r{_TRIPLE}a{_TRIPLE}"),
        ("fstring_on_one_line", 'f"{_BASE}"'),
        ("raw_string", 'r"a"'),
        # Implicit concatenation: valid Python, value "ab". The plain `"a"`
        # half matched on the MASKED line, so it used to land in the rewrite
        # (or mismatched) bucket AND in computed.
        ("implicit_concatenation", f'"a" {_TRIPLE}b{_TRIPLE}'),
        ("implicit_concatenation_mismatched", f'"z" {_TRIPLE}b{_TRIPLE}'),
        ("implicit_concatenation_multi_line", f'"a" {_TRIPLE}b\n{_TRIPLE}'),
    ],
)
def test_a_pin_whose_value_is_itself_a_string_is_never_silently_dropped(
    label: str, rhs: str
) -> None:
    """Masking blanks a triple-quoted string even when it IS the pin's value.

    Judging the blanked right-hand side put `_PARENT_REVISION_ID = \"\"\"a\"\"\"`
    in no bucket at all, so the advice said "no pin found" about a file with a
    pin. Every such value must surface as a pin a human checks — in EXACTLY one
    bucket, so it is never both rewritten and flagged.
    """
    from _alembic_graph import find_mismatched_parent_pins

    source = f'_BASE = "a"\n_REVISION_ID = "mine"\n_PARENT_REVISION_ID = {rhs}\n'
    compile(source, label, "exec")
    test_sources = {Path("backend/tests/test_mine_migration.py"): source}
    literal = find_parent_pins(test_sources, "mine", "a", "x")
    mismatched = find_mismatched_parent_pins(test_sources, "mine", "a")
    computed = find_computed_parent_pins(test_sources, "mine")
    assert len(literal) + len(mismatched) + len(computed) == 1, (
        literal,
        mismatched,
        computed,
    )
    assert [(c.lineno, c.line) for c in computed] == [
        (3, f"_PARENT_REVISION_ID = {rhs}".split("\n")[0])
    ]

    sources, scan, remediation = _forked_scan()
    sites = plan_repoint_sites(scan, remediation, sources, test_sources)
    text = render_remediation(
        remediation, "origin/main", scan.heads, sites=sites, pin_scope="the tests"
    )
    assert "computed, not literal — check it by hand" in text
    assert "pin found" not in text


def _lock_one_test_file(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    """Make `Path.read_text` raise PermissionError for one file name only."""
    real_read_text = Path.read_text

    def _read_text(self: Path, *args: object, **kwargs: object) -> str:
        if self.name == name:
            raise PermissionError(13, "Permission denied", str(self))
        return real_read_text(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Path, "read_text", _read_text)


def test_a_partial_pin_search_that_found_a_pin_still_says_it_was_incomplete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    """Listing the pins it DID find, with no word about the file it could not
    read, made a partial search read as the whole answer."""
    versions = _write(tmp_path / "v", ("a", None), ("landed", "a"), ("mine", "a"))
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_mine_migration.py").write_text(
        _pin_file("literal_in_source", "mine", "a"), encoding="utf-8"
    )
    (tests_dir / "test_locked.py").write_text("# unreadable\n", encoding="utf-8")
    _lock_one_test_file(monkeypatch, "test_locked.py")
    monkeypatch.setattr(counter, "TESTS_ROOT", tests_dir)
    monkeypatch.setattr(counter, "revisions_at_ref", lambda *_a: {"a", "landed"})
    monkeypatch.setattr(
        sys, "argv", ["count_alembic_heads.py", "--versions-dir", str(versions)]
    )
    assert counter.main() == counter.EXIT_VIOLATION  # the verdict does not move
    stderr = capsys.readouterr().err
    # Only the part AFTER the remedy's own header, so the earlier err() line
    # naming the unreadable file cannot satisfy these on its own.
    site_block = stderr.split("A re-point is THREE edits")[1]
    assert 'after:  _PARENT_REVISION_ID = "landed"' in site_block
    assert "(pin search incomplete: could not read " in site_block
    assert "test_locked.py)" in site_block

    # And directly: the note appears only when the search was NOT complete.
    sources, scan, remediation = _forked_scan()
    sites = plan_repoint_sites(
        scan,
        remediation,
        sources,
        {Path("t.py"): _pin_file("literal_in_source", "mine", "a")},
    )["mine"]
    partial = counter._site_lines(
        "mine", Path("mine.py"), "landed", sites, None, (Path("locked.py"),)
    )
    complete = counter._site_lines("mine", Path("mine.py"), "landed", sites, "x")
    assert any("(pin search incomplete: could not read" in line for line in partial)
    assert not any("pin search incomplete" in line for line in complete)


def test_a_non_file_named_like_a_test_is_skipped_not_unreadable(
    tmp_path: Path,
) -> None:
    """A directory or dangling symlink named `*.py` must not make EVERY run's
    pin search UNKNOWN."""
    import _alembic_graph as graph

    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    real = tests_dir / "test_mine_migration.py"
    real.write_text(_pin_file("literal_in_source", "mine", "a"), encoding="utf-8")
    (tests_dir / "a_directory.py").mkdir()
    (tests_dir / "dangling.py").symlink_to(tmp_path / "does_not_exist.py")
    unreadable: list[Path] = []
    found = graph.read_test_sources(tests_dir, unreadable)
    assert unreadable == []
    assert found is not None and list(found) == [real]
