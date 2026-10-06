"""Schema + round-trip test for the ``coord_agent_questions_recommendation`` revision.

Phase 3 (qontinui-web half) of plan
``2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen``
adds two nullable TEXT columns to ``coord.agent_questions``. What is asserted,
because none of it is visible from a passing ``upgrade``:

1. The pinned parent equals the revision's own ``down_revision``, so this test
   rewinds exactly one edge and never replays an unrelated revision.
2. The column NAMES and TYPES are an interface to coord's positional decode,
   and ``ADD COLUMN IF NOT EXISTS`` is type-blind — so both are read back from
   the catalogue.
3. Both columns are nullable with NO default. NULL is the honest value for
   every historic row (no recommendation was ever recorded); a default would
   fabricate one and make ``shape_share`` lie.
4. Re-running ``upgrade()`` is a no-op (the idempotency guards hold), and
   down -> up leaves no residue.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it
at a non-default host:port). A skip proves nothing.
"""

from __future__ import annotations

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
)

_REVISION_ID = "coord_agent_questions_recommendation"
_PARENT_REVISION_ID = "coordtouch_02_operator_touch_closes"
_REVISION_FILENAME = "coord_agent_questions_recommendation.py"

_TABLE = "agent_questions"
_COLUMNS = ("recommendation", "if_overturned")


def _revision_module() -> ModuleType:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    return load_revision_module(path, "_rev_coord_agent_questions_recommendation")


def test_pinned_parent_is_the_revisions_down_revision() -> None:
    """A stale pin would rewind too far and replay unrelated revisions."""
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


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
