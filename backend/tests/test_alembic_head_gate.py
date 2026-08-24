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

import notify_forked_open_prs as notifier  # noqa: E402
from _alembic_graph import (  # noqa: E402
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
    # Nothing can be asserted to have landed — that is the whole point — but
    # the heads are still carried, so a renderer cannot end up printing
    # "landed head(s) (none), unlanded head(s) (none)" two lines under a line
    # saying the chain has 2 heads.
    assert remediation.landed_heads == ()
    assert remediation.unlanded_heads == scan.heads


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


# ---------------------------------------------------------------------------
# the notifier's retry policy — the NEGATIVE path
#
# A retry that replays a POST is worse than no retry: GitHub can 502 after the
# write commits, so the replay posts a SECOND marker comment — the exact
# duplicate the upsert and the workflow's `concurrency:` group exist to
# prevent. These pin the discrimination rather than the happy path.
# ---------------------------------------------------------------------------


def test_writes_that_create_are_never_replayed() -> None:
    assert "POST" not in notifier.IDEMPOTENT_METHODS


@pytest.mark.parametrize("method", ["GET", "PATCH"])
def test_reads_and_in_place_updates_are_replayable(method: str) -> None:
    assert method in notifier.IDEMPOTENT_METHODS


def test_a_permissions_403_is_not_retried() -> None:
    """`Resource not accessible by integration` is an answer, not a blip."""
    assert notifier._is_retryable(403, {}) is False


@pytest.mark.parametrize(
    "headers",
    [{"retry-after": "60"}, {"x-ratelimit-remaining": "0"}],
)
def test_a_rate_limit_403_is_retried(headers: dict[str, str]) -> None:
    assert notifier._is_retryable(403, headers) is True


def test_server_errors_are_retried_and_client_errors_are_not() -> None:
    assert all(notifier._is_retryable(code, {}) for code in (429, 500, 502, 503, 504))
    assert not any(notifier._is_retryable(code, {}) for code in (400, 404, 409, 422))


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
    assert "h1" in text and "one-token fix" in text
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
# retry: the delay must be the one the server asked for
# ---------------------------------------------------------------------------


def test_a_rate_limit_403_is_recognised_from_the_body_without_headers() -> None:
    """A secondary-rate-limit 403 with neither header is a documented shape;
    classifying it as a permissions failure hard-fails a sweep that only
    needed to wait."""
    assert notifier._is_retryable(403, {}, b"You have exceeded a secondary rate limit")


def test_a_permissions_403_stays_refused_even_with_a_retry_after_header() -> None:
    assert not notifier._is_retryable(
        403, {"retry-after": "60"}, b"Resource not accessible by integration"
    )


def test_the_asked_for_delay_is_honoured_not_the_fixed_ladder() -> None:
    """A 2s/4s ladder against a 60s rate limit burns 6s and fails identically."""
    assert notifier._retry_delay(1, {"retry-after": "60"}) == 60.0


def test_an_unusably_long_delay_gives_up_instead_of_sleeping() -> None:
    assert notifier._retry_delay(1, {"retry-after": "3600"}) is None


def test_an_unparseable_retry_after_falls_back_to_the_ladder() -> None:
    """An HTTP-date must not be silently read as zero."""
    assert (
        notifier._retry_delay(1, {"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"})
        == 2.0
    )


def test_the_default_ladder_still_backs_off() -> None:
    assert notifier._retry_delay(1, {}) == 2.0
    assert notifier._retry_delay(2, {}) == 4.0


def test_delete_is_not_replayable() -> None:
    """Idempotent by EFFECT, not by observed STATUS: a committed-then-502'd
    DELETE answers 404 on replay, and 404 is not retryable, so the run would
    report a failure for a delete that succeeded."""
    assert "DELETE" not in notifier.IDEMPOTENT_METHODS
