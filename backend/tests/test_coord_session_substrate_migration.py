"""Alembic idempotency test for the ``coord_session_substrate`` revision.

Verifies the Phase 0 substrate of
``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-22-coord-native-session-coordination.md``
roundtrips cleanly: upgrade → downgrade → upgrade leaves the same
``information_schema`` shape for the four new tables it adds.

The ephemeral-DB substrate (and the reasons for it — ``conftest.py`` builds its
schema from the SQLAlchemy models rather than the revision chain, so alembic
needs a clean database) now lives in ``_alembic_harness``, shared with
``test_coord_plan_pr_citations_3a_backfill_migration``.

This test is the canonical guard for the coord-native-session-coordination
Phase 0 substrate. Future Phase 1 revisions that depend on these tables
should NOT need separate roundtrip tests — alembic's existing chain is
the structural verification. A revision whose contract is DATA rather than
schema shape does need its own test; see the 3a backfill test for that shape.
"""

from __future__ import annotations

import pytest

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

# The revision under test.
_REVISION_ID = "coord_session_substrate"
_PARENT_REVISION_ID = "pr_merge_10_rollout_state"

# Tables this revision creates. Used to assert presence/absence on each
# pass of the upgrade → downgrade → upgrade loop.
_CREATED_TABLES = [
    ("coord", "tenant_policies"),
    ("coord", "sessions"),
    ("coord", "session_events"),
    ("coord", "session_output"),
]

# Indexes this revision creates. Verified on the second upgrade to
# confirm the down → up roundtrip recreated them. Names are exactly as
# they appear in the migration (no schema prefix in pg_indexes.indexname).
_CREATED_INDEXES = [
    "coord_sessions_tenant_state_idx",
    "coord_sessions_device_idx",
    "coord_sessions_parent_idx",
    "coord_session_events_kind_idx",
]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_session_substrate_idempotent_roundtrip() -> None:
    """upgrade → downgrade → upgrade leaves the schema in the same shape.

    Creates an ephemeral DB inside the running Postgres service, points
    alembic at it, walks the full chain, then drops the DB. The
    assertions cover:

    * After ``upgrade head``: all four tables + indexes present.
    * After ``downgrade -1``: the four tables gone (rest of the chain
      stays put — we don't downgrade further).
    * After ``upgrade head`` again: all four tables + indexes
      re-created identically.

    No data assertion (no rows are seeded by tests) — schema shape is
    the contract.
    """
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_session_substrate_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. First upgrade — full alembic chain up to coord_session_substrate.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        for schema, table in _CREATED_TABLES:
            assert table_exists(engine, schema, table), (
                f"After first upgrade, {schema}.{table} should exist"
            )
        for idx in _CREATED_INDEXES:
            assert index_exists(engine, idx), (
                f"After first upgrade, index coord.{idx} should exist"
            )

        # ----------------------------------------------------------------
        # 2. Downgrade exactly one step — should land at the parent.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        for schema, table in _CREATED_TABLES:
            assert not table_exists(engine, schema, table), (
                f"After downgrade -1, {schema}.{table} should NOT exist"
            )

        # ----------------------------------------------------------------
        # 3. Re-upgrade — schema returns to the post-upgrade shape.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        for schema, table in _CREATED_TABLES:
            assert table_exists(engine, schema, table), (
                f"After second upgrade, {schema}.{table} should exist"
            )
        for idx in _CREATED_INDEXES:
            assert index_exists(engine, idx), (
                f"After second upgrade, index coord.{idx} should exist again"
            )
