"""Schema + round-trip test for the ``coord_agent_questions_recommendation`` revision.

Phase 3 (qontinui-web half) of plan
``2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen``
adds two nullable TEXT columns to ``coord.agent_questions``. What is asserted,
because none of it is visible from a passing ``upgrade``:

1. The pinned parent equals the revision's own ``down_revision``, so this test
   rewinds exactly one edge and never replays an unrelated revision.
2. The column NAMES and TYPES are coord's interface: coord reads both columns
   BY NAME (``try_get("recommendation")``), outside its positional ``COLS``
   projection, so a renamed or retyped column breaks it while the ordinal
   cannot. ``ADD COLUMN IF NOT EXISTS`` is type-blind, so both are read back
   from the catalogue.
3. Both columns are nullable with NO default. NULL is the honest value for
   every historic row (no recommendation was ever recorded); a default would
   fabricate one and make ``shape_share`` lie.
4. Re-running ``upgrade()`` is a no-op (the idempotency guards hold), and
   down -> up leaves no residue.
5. ``upgrade()`` keeps a shape coord's migration classifier admits, so the PR
   is not held on an escalate path: one static literal per ``op.execute``, no
   ``RESET`` (the classifier fails every one closed; env.py's
   ``on_version_apply`` hook restores ``lock_timeout`` instead), and nothing
   but the ``SET LOCAL lock_timeout`` bound and the guarded ``ADD COLUMN``s.
   Structural, so it runs without a database.

Substrate for the database-backed test comes from ``_alembic_harness``: an
ephemeral database inside the test Postgres, skipped when none is reachable
(``QONTINUI_TEST_PG`` points it at a non-default host:port). A skip proves
nothing.
"""

from __future__ import annotations

import re
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_agent_questions_recommendation"
_PARENT_REVISION_ID = "presentation_scope_01"
_REVISION_FILENAME = "coord_agent_questions_recommendation.py"

_TABLE = "agent_questions"
_COLUMNS = ("recommendation", "if_overturned")


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_module() -> ModuleType:
    return load_revision_module(
        _revision_path(), "_rev_coord_agent_questions_recommendation"
    )


def test_pinned_parent_is_the_revisions_down_revision() -> None:
    """A stale pin would rewind too far and replay unrelated revisions."""
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_upgrade_path_is_a_shape_coords_migration_classifier_admits() -> None:
    """coord lands a migration PR without an escalate-path hold only when its
    classifier (qontinui-coord ``crates/coord/src/pr_merge/migration_classifier.rs``)
    proves the UPGRADE path additive. It fails every ``RESET`` closed, and both
    earlier generations of this revision ended ``upgrade()`` with ``RESET
    lock_timeout``. The statement list below is the one that classifier, run at
    qontinui-coord ``d2ac748e0``, answers ``AutoSafe`` for.
    """
    statements: list[str] = []
    for call in upgrade_execute_calls(_revision_path()):
        assert call.sql is not None, (
            "every upgrade op.execute must take ONE static string literal: "
            "coord's migration classifier rejects anything dynamic"
        )
        statements.append(" ".join(call.sql.split()).upper())
    resets = [s for s in statements if re.match(r"RESET\b", s)]
    assert not resets, (
        f"upgrade() must not run {resets}: coord's migration classifier fails "
        "every RESET closed, and env.py's on_version_apply hook already restores "
        "lock_timeout after each step"
    )
    assert statements == [
        "SET LOCAL LOCK_TIMEOUT = '3S'",
        "ALTER TABLE COORD.AGENT_QUESTIONS"
        " ADD COLUMN IF NOT EXISTS RECOMMENDATION TEXT,"
        " ADD COLUMN IF NOT EXISTS IF_OVERTURNED TEXT",
    ], statements


def _assert_columns(engine: Engine, *, present: bool) -> None:
    for column in _COLUMNS:
        info = column_info(engine, _TABLE, column)
        if not present:
            assert info is None, f"coord.{_TABLE}.{column} exists: {info}"
            continue
        assert info is not None, f"coord.{_TABLE}.{column} is missing"
        data_type, is_nullable, column_default = info
        assert data_type == "text", f"{column}: type {data_type}"
        assert is_nullable == "YES", f"{column} must be nullable"
        assert column_default is None, f"{column} must carry no default"


@pytest.mark.skipif(
    not can_connect(admin_database_url()), reason="test Postgres not reachable"
)
def test_upgrade_adds_nullable_text_columns_and_round_trips() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "aq_rec") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_columns(engine, present=False)

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)

        # Idempotency: alembic will not re-run a revision it has recorded, so
        # the stamp is rewound and the revision applied again over the columns.
        run_alembic(root, db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns(engine, present=False)

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)
