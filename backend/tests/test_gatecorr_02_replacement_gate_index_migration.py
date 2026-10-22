"""Behaviour test for ``gatecorr_02_replacement_gate_index``.

The revision adds::

    CREATE INDEX CONCURRENTLY idx_gate_corrections_tenant_replacement
    ON coord.gate_corrections (tenant_id, replacement_gate_id)
    WHERE replacement_gate_id IS NOT NULL

for coord's lineage loader (``gates::load_correction_entries``). The contract
is that **the replacement leg of coord's OR read gets an index condition on
this index**, so that is what is pinned, against coord's exact query shape.

What is asserted
================

1. At the parent the index does not exist and the replacement-only read has
   no index condition on ``replacement_gate_id`` (sensitivity).
2. After upgrade the index exists, is ``indisvalid``, keys
   ``(tenant_id, replacement_gate_id)`` and carries the NOT NULL predicate.
3. Coord's two-leg OR read uses it, and returns the rows from BOTH ends.
4. Idempotency: ``stamp`` back and ``upgrade`` again leaves the same index.
5. Downgrade removes it; rows survive.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:<port>``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "gatecorr_02_replacement_gate_index"
_PARENT_REVISION_ID = "spawnledger_01_spawn_requests"
_INDEX_NAME = "idx_gate_corrections_tenant_replacement"

_TENANT = uuid.UUID("00000000-0000-0000-0000-00000000a001")
_SEED_ROWS = 3000

# coord's loader, verbatim in shape (`gates::load_correction_entries`).
_COORD_SQL = """
    SELECT correction_id, gate_id, relation, replacement_gate_id
      FROM coord.gate_corrections
     WHERE tenant_id = :tenant
       AND (gate_id = ANY(:ids) OR replacement_gate_id = ANY(:ids))
"""

_REPLACEMENT_ONLY_SQL = """
    SELECT count(*) FROM coord.gate_corrections
     WHERE tenant_id = :tenant AND replacement_gate_id = ANY(:ids)
"""


def _plan_for(engine: Engine, sql: str, params: dict) -> str:
    """EXPLAIN with sequential scans penalised (the fixture is small)."""
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _has_replacement_index_cond(plan: str) -> bool:
    return any(
        "Index Cond" in line and "replacement_gate_id" in line
        for line in plan.splitlines()
    )


def _index_row(engine: Engine) -> tuple[bool, str | None, str]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, pg_get_expr(i.indpred, i.indrelid),
                       pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return bool(row[0]), row[1], str(row[2])


def _scalar(engine: Engine, sql: str, params: dict | None = None) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text(sql), params or {}).scalar_one())


def _analyze(engine: Engine) -> None:
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("ANALYZE coord.gate_corrections"))


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_gatecorr_02_index_serves_the_lineage_read() -> None:
    """Add the replacement-end index and prove coord's OR read rides it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "gatecorr_02_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)

        # Seed: every 3rd row names a replacement (lineage / replaced
        # corrections); the rest are bare `mispredicated` corrections.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.gate_corrections
                        (gate_id, tenant_id, relation, reason, replacement_gate_id)
                    SELECT gen_random_uuid(), :tenant,
                           CASE WHEN g % 3 = 0 THEN 'repointed_from'
                                ELSE 'mispredicated' END,
                           'seed ' || g,
                           CASE WHEN g % 3 = 0 THEN gen_random_uuid() END
                      FROM generate_series(1, :n) AS g
                    """
                ),
                {"tenant": _TENANT, "n": _SEED_ROWS},
            )
            src, clone = uuid.uuid4(), uuid.uuid4()
            conn.execute(
                text(
                    """
                    INSERT INTO coord.gate_corrections
                        (gate_id, tenant_id, relation, reason, replacement_gate_id)
                    VALUES (:src, :tenant, 'reopened_from', 'probe', :clone)
                    """
                ),
                {"src": src, "tenant": _TENANT, "clone": clone},
            )
        _analyze(engine)
        params = {"tenant": _TENANT, "ids": [clone]}

        # 1. Sensitivity — at the parent nothing keys replacement_gate_id.
        parent_plan = _plan_for(engine, _REPLACEMENT_ONLY_SQL, params)
        assert _INDEX_NAME not in parent_plan, parent_plan
        assert not _has_replacement_index_cond(parent_plan), parent_plan

        # 2. Apply — index exists, VALID, keyed, partial.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, predicate, indexdef = _index_row(engine)
        assert valid, "a killed CONCURRENTLY build leaves an INVALID index"
        assert predicate == "(replacement_gate_id IS NOT NULL)", predicate
        assert "(tenant_id, replacement_gate_id) WHERE" in indexdef, indexdef

        # 3. coord's OR read rides it, and the clone sees its source row.
        _analyze(engine)
        plan = _plan_for(engine, _COORD_SQL, params)
        assert _INDEX_NAME in plan, f"the lineage read must ride the index:\n{plan}"
        assert _has_replacement_index_cond(plan), plan
        with engine.connect() as conn:
            rows = conn.execute(text(_COORD_SQL), params).all()
        assert [(r.gate_id, r.replacement_gate_id) for r in rows] == [(src, clone)]

        # 4. Idempotency — re-running over its own schema is a no-op.
        oid_sql = f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid"
        oid_before = _scalar(engine, oid_sql)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _scalar(engine, oid_sql) == oid_before and _index_row(engine)[0]

        # 5. Downgrade removes it; rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert (
            _scalar(engine, "SELECT count(*) FROM coord.gate_corrections")
            == _SEED_ROWS + 1
        )
