"""Behaviour test for the ``findings_triage_01`` triage-stamp revision.

The revision adds two nullable columns and one partial index to
``coord.findings``::

    ALTER TABLE coord.findings ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ NULL
    ALTER TABLE coord.findings ADD COLUMN IF NOT EXISTS triaged_by TEXT NULL
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_untriaged
        ON coord.findings (tenant_id, created_at) WHERE triaged_at IS NULL

Phase 0 of plan
``2026-09-17-findings-carry-a-triage-stamp-and-the-steward-reads-since-last-run``.
``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contract is that **the steward's ``triaged=false`` read
rides this index**, so that is what is pinned here.

What is asserted
================

1. Neither column nor the index exists at the parent revision.
2. After upgrade both columns exist, are nullable, and default to NULL.
3. The index exists and is **``indisvalid``** — a killed ``CONCURRENTLY`` build
   leaves an INVALID index that ``IF NOT EXISTS`` would skip on re-run, so
   existence alone would green a dead index.
4. Its recorded predicate is ``triaged_at IS NULL`` and its key is
   ``(tenant_id, created_at)``.
5. **The planner chooses it for the steward's read** — a per-tenant
   ``triaged_at IS NULL`` scan ordered by ``created_at``, AND for coord's
   shipped ``recent()`` WHERE clause with the Phase 1 arm appended (quoted
   verbatim from origin/main ``c2ba3267``).
6. **Sensitivity: the complementary read does NOT get the index.** A
   ``triaged_at IS NOT NULL`` read must not use the partial index (on this
   schema it falls to ``idx_findings_tenant_recent``, or a Seq Scan on one
   without it); without this, assertion 5 would pass against a non-partial
   index.
7. A mark (``UPDATE ... SET triaged_at = now()``) moves a row out of the
   ``triaged=false`` population and a re-read sees it gone; un-marking brings
   it back.
8. Downgrade removes all three objects; rows survive.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
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
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "findings_triage_01"
_PARENT_REVISION_ID = "blane_01"

_INDEX_NAME = "idx_findings_untriaged"

_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000f1d1")

# The steward's `triaged=false` read as the plan specifies it (Phase 1+): a
# per-tenant untriaged scan, newest first. This is a PARAPHRASE that pins the
# partial predicate, NOT coord's shipped SQL — see `_REAL_RECENT_SQL` below for
# that. The tenant is a fixed test UUID interpolated once, never user input.
_UNTRIAGED_SQL = (
    "SELECT finding_id FROM coord.findings "
    f"WHERE tenant_id = '{_TENANT}' AND triaged_at IS NULL "
    "ORDER BY created_at DESC"
)

# coord's `recent()` WHERE clause, quoted from qontinui-coord origin/main
# c2ba3267 `crates/coord/src/findings.rs:1115-1140`, with the Phase 1 arm
# `AND f.triaged_at IS NULL` appended and the binds fixed to the steward's
# shape (no resource_keys, no topic, no kind). Quoted in full rather than
# simplified, the sibling `test_coord_alerts_pagedidx_01_migration.py`
# convention: the point is that THIS statement rides the index, and a
# paraphrase could ride it while the real one did not. Note the
# `OR f.scope = 'fleet-infra'` disjunction defeats the leading `tenant_id`
# key, so the real shape rides the index as a scan over the whole partial
# index (the tenant/scope disjunction lands in a Filter, not an Index Cond);
# whether the planner picks a plain or a bitmap index scan varies with stats,
# and the assertion pins only that the index is chosen — the partial
# predicate is what earns it.
_REAL_RECENT_SQL = f"""
    SELECT finding_id FROM coord.findings f
     WHERE (f.tenant_id = '{_TENANT}' OR f.scope = 'fleet-infra')
       AND f.expires_at > now()
       AND NOT EXISTS (
             SELECT 1 FROM coord.findings s WHERE s.supersedes = f.finding_id
           )
       AND (
             f.resource_keys && '{{}}'::text[]
          OR (NULL::text IS NOT NULL AND f.topic = NULL::text)
          OR ('{{}}'::text[] = '{{}}'::text[] AND NULL::text IS NULL)
           )
       AND (NULL::text IS NULL OR f.kind = NULL::text)
       AND f.triaged_at IS NULL
     ORDER BY f.created_at DESC
     LIMIT 100
"""

# The complementary predicate: the partial index cannot serve it.
_TRIAGED_SQL = (
    "SELECT finding_id FROM coord.findings "
    f"WHERE tenant_id = '{_TENANT}' AND triaged_at IS NOT NULL "
    "ORDER BY created_at DESC"
)


def _index_is_valid(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :idx
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar()
        )


def _index_predicate_and_keys(engine: Engine) -> tuple[str, list[str]]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_expr(i.indpred, i.indrelid),
                       array_agg(a.attname ORDER BY k.ordinality)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
                       ON true
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                 WHERE c.relname = :idx
                 GROUP BY i.indpred, i.indrelid
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return str(row[0] or ""), list(row[1])


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is tiny, so a seq scan would win on cost regardless of index
    quality. ``enable_seqscan = off`` removes the cost question and leaves the
    one being asked: CAN the planner use this index for this predicate? If the
    partial predicate does not cover the query, no penalty makes it usable and
    the plan falls to another index or a Seq Scan — which is how assertion 6
    discriminates.

    One caveat on assertion 5: ``coord.findings`` already carries
    ``idx_findings_tenant_recent (tenant_id, expires_at)`` (revision
    ``coord_findings``), which also satisfies ``tenant_id = X``, so with seq
    scans penalised the planner chooses between two index paths on cost. The
    partial index wins on row estimate and on matching ``ORDER BY created_at``;
    if a future index on ``(tenant_id, created_at)`` is added, assertion 5
    becomes ambiguous and should be revisited.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine, n: int = 3) -> list[uuid.UUID]:
    ids = [uuid.uuid4() for _ in range(n)]
    with engine.begin() as conn:
        for i, fid in enumerate(ids):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.findings
                        (finding_id, tenant_id, kind, topic, title, body, expires_at)
                    VALUES
                        (:fid, :tenant, 'investigation', 'findings-steward',
                         :title, 'seed', now() + interval '14 days')
                    """
                ),
                {"fid": str(fid), "tenant": str(_TENANT), "title": f"seed {i}"},
            )
    return ids


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_findings_triage_01_stamp_columns_and_untriaged_index() -> None:
    """Build the columns + index, prove the steward's read rides it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "findings_triage_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — nothing this revision adds exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "findings", "triaged_at") is None
        assert column_info(engine, "findings", "triaged_by") is None
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )

        # 2. Apply — both columns, nullable, NULL by default.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for column, kind in (
            ("triaged_at", "timestamp with time zone"),
            ("triaged_by", "text"),
        ):
            info = column_info(engine, "findings", column)
            assert info is not None, f"{column} missing after upgrade"
            data_type, is_nullable, default = info
            assert is_nullable == "YES", f"{column} must be nullable"
            assert kind in data_type.lower(), info
            assert default is None, f"{column} must have no default: {default!r}"

        # 3. The index exists and is VALID.
        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )

        # 4. Predicate and key columns.
        predicate, keys = _index_predicate_and_keys(engine)
        assert "triaged_at" in predicate and "IS NULL" in predicate, (
            f"unexpected index predicate: {predicate!r}"
        )
        assert keys == ["tenant_id", "created_at"], keys

        ids = _seed(engine)
        with engine.connect() as conn:
            stamped = conn.execute(
                text(
                    "SELECT count(*) FROM coord.findings "
                    "WHERE triaged_at IS NOT NULL OR triaged_by IS NOT NULL"
                )
            ).scalar()
        assert stamped == 0, "a fresh row is never-consumed: both columns NULL"

        # 5. The steward's read rides the index — both the plan's paraphrase and
        #    coord's real `recent()` shape with the Phase 1 arm appended.
        plan = _plan_for(engine, _UNTRIAGED_SQL)
        assert _INDEX_NAME in plan, (
            f"the triaged=false read must ride the new index; got:\n{plan}"
        )
        real_plan = _plan_for(engine, _REAL_RECENT_SQL)
        assert _INDEX_NAME in real_plan, (
            "coord's shipped recent() WHERE + `triaged_at IS NULL` must ride the "
            f"new index; got:\n{real_plan}"
        )

        # 6. Sensitivity — the complementary read cannot use it.
        complement_plan = _plan_for(engine, _TRIAGED_SQL)
        assert _INDEX_NAME not in complement_plan, (
            "a `triaged_at IS NOT NULL` read must NOT match this partial index:\n"
            + complement_plan
        )

        # 7. A mark leaves the population; an un-mark re-enters it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.findings SET triaged_at = now(), "
                    "triaged_by = 'findings-steward:test' "
                    "WHERE finding_id = :fid AND triaged_at IS NULL"
                ),
                {"fid": str(ids[0])},
            )
        with engine.connect() as conn:
            remaining = {r[0] for r in conn.execute(text(_UNTRIAGED_SQL)).all()}
        assert remaining == set(ids[1:]), remaining
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.findings SET triaged_at = NULL, triaged_by = NULL "
                    "WHERE finding_id = :fid"
                ),
                {"fid": str(ids[0])},
            )
        with engine.connect() as conn:
            remaining = {r[0] for r in conn.execute(text(_UNTRIAGED_SQL)).all()}
        assert remaining == set(ids), remaining

        # 8. Downgrade removes all three objects; the rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert column_info(engine, "findings", "triaged_at") is None
        assert column_info(engine, "findings", "triaged_by") is None
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.findings")
            ).scalar() == len(ids), (
                "downgrade drops the stamp only — rows are untouched"
            )
