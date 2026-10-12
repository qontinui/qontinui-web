"""Schema contract test for the ``gate_arming_01`` revision.

``gate_arming_01_gate_arming_instants`` creates ``coord.gate_arming_instants``
as pure schema — Phase 1 of plan
``2026-09-23-phase-gate-armed-at-is-a-compiled-guess-at-its-own-deploy-time``.
The seed row is the separate revision ``gate_arming_02`` (data DML, operator
override). The consumer is coord (Phase 2), which web never reads, so the
contract can only be pinned here.

What ``migration-reversal.yml`` cannot see, and this file pins:

1. **The revision is pure, guarded DDL** — one static ``CREATE TABLE IF NOT
   EXISTS`` and no data DML, so coord's migration classifier admits it on the
   auto-safe path. Asserted from what ``upgrade()`` actually executes.
2. **``gate_key`` is the primary key** — the conflict target of the
   ``INSERT ... ON CONFLICT (gate_key) DO NOTHING`` self-stamp coord uses for
   gate keys introduced after this plan (never for the seeded
   ``phase_coverage_promotion`` key, which coord reads read-only per the
   plan's Design).
3. **``armed_at`` is ``timestamptz`` NOT NULL with a ``now()`` default** — the
   default that self-stamp relies on.
4. **The table is born empty** — no instant is invented by the schema.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "gate_arming_01"
_REVISION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "gate_arming_01_gate_arming_instants.py"
)

# Read the parent off the revision itself: coord re-points down_revision at
# land time, so a pinned literal here would go stale on main.
_PARENT_REVISION_ID = load_revision_module(
    _REVISION_PATH, "gate_arming_01_parent_probe"
).down_revision


def test_revision_source_is_pure_guarded_ddl() -> None:
    """No database: upgrade() runs exactly one static, guarded CREATE TABLE."""
    module = load_revision_module(_REVISION_PATH, "gate_arming_01_under_test")
    assert module.revision == _REVISION_ID
    assert isinstance(module.down_revision, str) and module.down_revision

    calls = upgrade_execute_calls(_REVISION_PATH)
    assert len(calls) == 1, calls
    assert calls[0].sql is not None, "op.execute arg must be a static literal"
    ddl = " ".join(calls[0].sql.split())
    assert ddl.startswith("CREATE TABLE IF NOT EXISTS coord.gate_arming_instants"), ddl
    for dml in ("INSERT", "UPDATE", "DELETE"):
        assert dml not in ddl.upper(), ddl


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_gate_arming_instants_schema_roundtrip() -> None:
    """upgrade → assert shape, empty → self-stamp default → downgrade → up."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "gate_arming_01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert table_exists(engine, "coord", "gate_arming_instants")
        assert scalar(engine, "SELECT count(*) FROM coord.gate_arming_instants") == 0

        key_info = column_info(engine, "gate_arming_instants", "gate_key")
        assert key_info is not None and key_info[0] == "text", key_info
        armed_info = column_info(engine, "gate_arming_instants", "armed_at")
        assert armed_info is not None, armed_info
        assert armed_info[0] == "timestamp with time zone", armed_info
        assert armed_info[1] == "NO", armed_info
        assert armed_info[2] == "now()", armed_info

        pk_cols = scalar(
            engine,
            """
            SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
              FROM pg_index i
              JOIN pg_attribute a
                ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
             WHERE i.indrelid = 'coord.gate_arming_instants'::regclass
               AND i.indisprimary
            """,
        )
        assert pk_cols == "gate_key", pk_cols

        # A future key's self-stamp takes the now() default, and a second
        # stamp on the same key is a no-op (the PK is the conflict target).
        stamp = (
            "INSERT INTO coord.gate_arming_instants (gate_key) "
            "VALUES ('some_future_gate') ON CONFLICT (gate_key) DO NOTHING"
        )
        with engine.begin() as conn:
            conn.exec_driver_sql(stamp)
        first = scalar(
            engine,
            "SELECT armed_at FROM coord.gate_arming_instants "
            "WHERE gate_key = 'some_future_gate'",
        )
        assert first is not None
        with engine.begin() as conn:
            conn.exec_driver_sql(stamp)
        assert (
            scalar(
                engine,
                "SELECT armed_at FROM coord.gate_arming_instants "
                "WHERE gate_key = 'some_future_gate'",
            )
            == first
        )

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", "gate_arming_instants")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", "gate_arming_instants")
