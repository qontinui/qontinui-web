"""Shape and walk tests for the ``prcheckruns_base_sha_01`` revision.

Phase 1b of plan
``2026-09-05-a-red-pr-is-classified-before-coord-looks-at-behind-so-a-stale-base-is-never-refreshed``
adds ``coord.pr_check_runs.base_sha`` and rebuilds ``coord.pr_check_runs_latest``
so the new column is visible through the view coord's rollup reader uses.

What can go wrong that a green ``upgrade`` does not show
========================================================

* **The column exists and the view does not carry it.** PostgreSQL freezes a
  ``SELECT *`` projection at view-creation time, so an ``ADD COLUMN`` alone
  leaves the view without ``base_sha`` and the rollup reader ``42703``s at
  query time — the trap ``prcheckruns_headbranch_02_latest_view`` closed for
  ``head_branch``. Asserted through ``information_schema.columns`` on the VIEW.
* **The rebuild changes the tiebreak.** The revision re-executes
  ``prcheckruns_latest_03``'s SELECT verbatim; a retyped ORDER BY that lost the
  conclusive-first term would silently re-open the cancelled-corpse bug. The
  module constant is compared byte-for-byte against the one
  ``prcheckruns_latest_03_conclusive_first.py`` defines, and the served row is
  asserted on seeded data (a newer ``cancelled`` must NOT outrank an older
  ``success``).
* **Downgrade leaves residue or narrows nothing.** ``CREATE OR REPLACE VIEW``
  cannot remove a column, so the downgrade drops and re-creates the view. The
  walk asserts the view's projection after downgrade is exactly the
  pre-revision one, that the column is gone from the table, and that the
  tiebreak still holds on the restored view.
* **The DROP lands in the upgrade path.** The ``coord-column-drop-guard`` gate
  scans the module minus ``downgrade()`` for ``coord.*`` drops. A refactor that
  hoisted the ``DROP COLUMN`` into a module constant would either trip the gate
  or, worse, make a revision that drops a shared column on the way UP. Pinned
  by AST: every ``DROP`` string literal lives inside ``downgrade()``.

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is
reachable. CI provisions one at the default ``localhost:5432``.
"""

from __future__ import annotations

import ast
import re
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST equal
# the revision's own `down_revision` — the first test below enforces it,
# because a stale pin rewinds too far and replays unrelated non-idempotent
# revisions, surfacing as someone else's `DuplicateTable`.
_REVISION_ID = "prcheckruns_base_sha_01"
_PARENT_REVISION_ID = "coord_agent_questions_audience_backfill"
_REVISION_FILENAME = "prcheckruns_base_sha_01_base_sha_column.py"

# The revision whose view text this one re-executes. Its constant is the ONE
# author of the conclusive-first SELECT; this test compares against it rather
# than holding a third copy.
_VIEW_AUTHOR_FILENAME = "prcheckruns_latest_03_conclusive_first.py"

_TABLE = "pr_check_runs"
_VIEW = "pr_check_runs_latest"
_QUALIFIED_COLUMN = "coord.pr_check_runs.base_sha"

# The view's projection before this revision: the base table's columns in
# attnum order as `coordinator_phase_6_agent_coordination_hardening` created
# them, plus `head_branch` appended by `prcheckruns_headbranch_01`.
_PRE_REVISION_VIEW_COLUMNS = (
    "repo",
    "head_sha",
    "check_id",
    "name",
    "status",
    "conclusion",
    "started_at",
    "completed_at",
    "details_url",
    "updated_at",
    "head_branch",
)

_REPO = "qontinui/probe"
_HEAD = "0123456789abcdef0123456789abcdef01234567"
_T0 = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _versions_dir():
    return backend_root() / "alembic" / "versions"


def _revision_source() -> str:
    return (_versions_dir() / _REVISION_FILENAME).read_text(encoding="utf-8")


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` names the revision's real parent."""
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_view_text_is_prcheckruns_latest_03s_verbatim() -> None:
    """One SELECT, owned by the revision that defined the tiebreak.

    The upgrade changes the view's projection by RE-EXPANSION of ``*``, not by
    editing the SELECT, and the downgrade restores the previous definition by
    executing the same text. Both properties hold only while this constant is
    byte-identical to the one in ``prcheckruns_latest_03``.
    """
    under_test = load_revision_module(
        _versions_dir() / _REVISION_FILENAME, "_prcheckruns_base_sha_01_under_test"
    )
    author = load_revision_module(
        _versions_dir() / _VIEW_AUTHOR_FILENAME, "_prcheckruns_latest_03_author"
    )
    assert (
        under_test._LATEST_VIEW_CONCLUSIVE_FIRST == author._LATEST_VIEW_CONCLUSIVE_FIRST
    ), (
        "the view text drifted from prcheckruns_latest_03; the downgrade would restore something else"
    )


def test_every_drop_lives_inside_downgrade() -> None:
    """The ``coord-column-drop-guard`` scans everything BUT ``downgrade()``.

    A ``DROP`` string anywhere else in the module is either a gate violation or
    a revision that drops a shared ``coord.*`` surface on the way up. Neither is
    this revision's contract, so the location is pinned, not assumed.
    """
    tree = ast.parse(_revision_source())
    downgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "downgrade"
    )
    downgrade_range = range(downgrade.lineno, downgrade.end_lineno + 1)  # type: ignore[arg-type]
    drops_outside: list[int] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        if re.search(r"\bDROP\b", node.value) is None:
            continue
        # The module docstring is prose and may say "drop"; a string literal
        # elsewhere is executable SQL.
        if node.lineno == 1:
            continue
        if node.lineno not in downgrade_range:
            drops_outside.append(node.lineno)
    assert not drops_outside, (
        f"DROP string literal(s) outside downgrade() at line(s) {drops_outside}: "
        "the upgrade path must drop nothing"
    )


# ---------------------------------------------------------------------------
# Walks — need the test Postgres.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def _view_columns(engine: Engine) -> tuple[str, ...]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :view
                 ORDER BY ordinal_position
                """
            ),
            {"view": _VIEW},
        ).fetchall()
    return tuple(r[0] for r in rows)


def _seed_cancelled_corpse_over_older_success(engine: Engine) -> None:
    """A newer ``cancelled`` attempt and an older ``success`` for one name."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_check_runs
                    (repo, head_sha, check_id, name, status, conclusion, started_at)
                VALUES
                    (:repo, :head, 2, 'Backend CI', 'completed', 'cancelled', :t1),
                    (:repo, :head, 1, 'Backend CI', 'completed', 'success',   :t0)
                """
            ),
            {"repo": _REPO, "head": _HEAD, "t0": _T0, "t1": _T0 + timedelta(hours=1)},
        )


def _served(engine: Engine) -> tuple:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT check_id, conclusion
                  FROM coord.pr_check_runs_latest
                 WHERE repo = :repo AND head_sha = :head
                """
            ),
            {"repo": _REPO, "head": _HEAD},
        ).fetchall()
    assert len(row) == 1, f"the view served {len(row)} rows for one (repo, head, name)"
    return tuple(row[0])


def test_column_comment_and_view_projection_after_upgrade(_admin_url: str) -> None:
    """The column is nullable TEXT, commented from the revision's own text, and
    VISIBLE through the view — appended last, every prior column in place."""
    with ephemeral_database(_admin_url, "prcheckruns_base_sha_01_up") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert column_info(engine, _TABLE, "base_sha") == ("text", "YES", None), (
            "base_sha must be TEXT NULL with no default — NULL is the UNKNOWN "
            "readers fail closed on"
        )
        assert column_comment(engine, _TABLE, "base_sha") == comment_body_from_source(
            _revision_source(), _QUALIFIED_COLUMN
        )
        assert _view_columns(engine) == (*_PRE_REVISION_VIEW_COLUMNS, "base_sha"), (
            "the view must re-expand `*` over base_sha, appended LAST so CREATE OR "
            "REPLACE is legal and every existing reader's positional projection "
            "is unchanged"
        )

        _seed_cancelled_corpse_over_older_success(engine)
        assert _served(engine) == (1, "success"), (
            "the rebuilt view lost prcheckruns_latest_03's conclusive-first "
            "tiebreak: a newer cancelled attempt outranked an older success"
        )
        with engine.connect() as conn:
            base = conn.execute(
                text("SELECT base_sha FROM coord.pr_check_runs_latest WHERE repo = :r"),
                {"r": _REPO},
            ).scalar_one()
        assert base is None, "rows written without a base must read NULL, never a tip"


def test_up_down_up_restores_the_previous_view_exactly(_admin_url: str) -> None:
    """Downgrade narrows the view to the pre-revision projection, drops the
    column, keeps the tiebreak and the rows; re-upgrade brings it all back."""
    with ephemeral_database(_admin_url, "prcheckruns_base_sha_01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_cancelled_corpse_over_older_success(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, "base_sha") is None, (
            "downgrade() left base_sha on coord.pr_check_runs"
        )
        assert _view_columns(engine) == _PRE_REVISION_VIEW_COLUMNS, (
            "downgrade() did not restore prcheckruns_latest_03's projection exactly"
        )
        assert _served(engine) == (1, "success"), (
            "the restored view lost the conclusive-first tiebreak"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _view_columns(engine) == (*_PRE_REVISION_VIEW_COLUMNS, "base_sha")
        assert _served(engine) == (1, "success")


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """``ADD COLUMN IF NOT EXISTS`` + ``CREATE OR REPLACE VIEW`` — re-running
    ``upgrade()`` over an already-migrated schema is a no-op, not an error."""
    with ephemeral_database(_admin_url, "prcheckruns_base_sha_01_id") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, "base_sha") == ("text", "YES", None)
        assert _view_columns(engine) == (*_PRE_REVISION_VIEW_COLUMNS, "base_sha")
