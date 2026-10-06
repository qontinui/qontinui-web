"""Behaviour test for the ``coord_alerts_resolvedidx_01`` partial index.

The revision creates one index::

    CREATE INDEX CONCURRENTLY idx_alerts_resolved_at
    ON coord.alerts (resolved_at) WHERE resolved_at IS NOT NULL

for coord's Phase 6 decide query ``ops_decide_zero_touch_share_30d``, whose
episode set is the alerts RESOLVED in a trailing 30-day window.
``migration-reversal.yml`` would only confirm the statement executes; the
contract is that **the window read gets ``resolved_at`` as a bounding index
condition on this index**, so that is what is pinned.

Deterministic by construction (the ``coord_alerts_firstseen_01`` flake is why):
the probe is the ungrouped ``count(*)`` shape coord issues, autovacuum is
disabled on the table for the seeded span so no plan races the visibility map,
every ``ANALYZE`` is committed before a plan is read, and the expected count is
computed from the seed geometry rather than from a second query.

What is asserted
================

1. At the parent revision nothing named ``idx_alerts_resolved_at`` exists and
   the window read has NO index condition on ``resolved_at`` — no index keys
   it. The sensitivity half: assertion 3 measures this revision, not a
   pre-existing index.
2. After upgrade the index exists, is **``indisvalid``** (a killed
   ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS`` would
   skip on re-run), keys ``(resolved_at)``, and carries the
   ``resolved_at IS NOT NULL`` predicate.
3. **The window read rides it** with ``resolved_at`` as its index condition,
   and counts exactly the resolved in-window seed rows.
4. **It still does after ``VACUUM ANALYZE`` sets the visibility map.**
5. Sensitivity of the predicate: the open-alert read (``resolved_at IS NULL``)
   cannot use it.
6. Idempotency: ``stamp`` back to the parent and ``upgrade`` again leaves the
   same valid index untouched.
7. Downgrade removes it; rows survive.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

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

_REVISION_ID = "coord_alerts_resolvedidx_01"
_PARENT_REVISION_ID = "coord_alerts_firstseen_01"

_INDEX_NAME = "idx_alerts_resolved_at"

# The decide query's episode bound, ungrouped as coord issues it.
_WINDOW_SQL = """
    SELECT count(*) FROM coord.alerts
     WHERE resolved_at >= now() - interval '30 days'
"""

# The complement: open alerts. The partial predicate excludes every one.
_OPEN_SQL = "SELECT count(*) FROM coord.alerts WHERE resolved_at IS NULL"

# Seed geometry: rows g = 1.._SEED_ROWS. g % 3 = 0 stays OPEN (resolved_at
# NULL); the rest resolved at seed-now() - (g % 60) days. Offsets 0..29 are in
# the window (offset 30 sits at the seed's now() - 30 days, before the query's
# later now() - 30 days). Per 60 consecutive g: 30 in-window offsets, of which
# the 10 divisible by 3 are open — 20 resolved in-window rows per 60.
_SEED_ROWS = 3000
_OPEN_ROWS = 1000
_RESOLVED_IN_WINDOW_ROWS = 1000


def _index_row(engine: Engine) -> tuple[bool, str | None, str]:
    """``(indisvalid, predicate, indexdef)`` for the index."""
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


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is small, so a seq scan would win on cost regardless.
    ``enable_seqscan = off`` leaves the question being asked: can the planner
    put ``resolved_at`` in an index condition for this read at all?
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _has_resolved_index_cond(plan: str) -> bool:
    return any(
        "Index Cond" in line and "resolved_at" in line for line in plan.splitlines()
    )


def _scalar(engine: Engine, sql: str) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text(sql)).scalar_one())


def _analyze(engine: Engine, vacuum: bool = False) -> None:
    """Committed (auto-commit) ANALYZE, optionally with VACUUM."""
    stmt = "VACUUM ANALYZE coord.alerts" if vacuum else "ANALYZE coord.alerts"
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text(stmt))


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_alerts_resolvedidx_01_index_serves_the_resolved_window() -> None:
    """Add the resolved_at partial index and prove the window read rides it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_alerts_resolvedidx_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)

        # Autovacuum off BEFORE seeding, so it cannot set the visibility map
        # between two plans below; case 4 sets it on purpose.
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE coord.alerts SET (autovacuum_enabled = false)")
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, resolved_at)
                    SELECT 'k-' || g, 'warning',
                           (ARRAY['pr_merge_stuck', 'red_main', 'stale_wip'])[1 + g % 3],
                           'seed',
                           CASE WHEN g % 3 = 0 THEN NULL
                                ELSE now() - (g % 60) * interval '1 day' END
                      FROM generate_series(1, :n) AS g
                    """
                ),
                {"n": _SEED_ROWS},
            )
        _analyze(engine)
        assert _scalar(engine, _OPEN_SQL) == _OPEN_ROWS
        assert _scalar(engine, _WINDOW_SQL) == _RESOLVED_IN_WINDOW_ROWS

        # 1. Sensitivity — at the parent no index keys resolved_at.
        parent_plan = _plan_for(engine, _WINDOW_SQL)
        assert _INDEX_NAME not in parent_plan, parent_plan
        assert not _has_resolved_index_cond(parent_plan), parent_plan

        # 2. Apply — index exists, VALID, keyed (resolved_at), partial.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, predicate, indexdef = _index_row(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )
        assert predicate == "(resolved_at IS NOT NULL)", predicate
        assert "(resolved_at) WHERE" in indexdef, indexdef

        # 3. The window read rides it and counts exactly the seed's rows.
        _analyze(engine)
        plan = _plan_for(engine, _WINDOW_SQL)
        assert _INDEX_NAME in plan, f"the window read must ride the index:\n{plan}"
        assert _has_resolved_index_cond(plan), plan
        assert _scalar(engine, _WINDOW_SQL) == _RESOLVED_IN_WINDOW_ROWS

        # 4. Set the visibility map on purpose and re-plan.
        _analyze(engine, vacuum=True)
        assert (
            _scalar(
                engine,
                "SELECT relallvisible FROM pg_class "
                "WHERE oid = 'coord.alerts'::regclass",
            )
            > 0
        ), "VACUUM must have set the map"
        vm_plan = _plan_for(engine, _WINDOW_SQL)
        assert _INDEX_NAME in vm_plan, vm_plan
        assert _has_resolved_index_cond(vm_plan), vm_plan
        assert _scalar(engine, _WINDOW_SQL) == _RESOLVED_IN_WINDOW_ROWS

        # 5. The open-alert complement cannot use the partial index.
        open_plan = _plan_for(engine, _OPEN_SQL)
        assert _INDEX_NAME not in open_plan, open_plan

        # 6. Idempotency — re-running over its own schema is a no-op.
        oid_sql = f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid"
        oid_before = _scalar(engine, oid_sql)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _scalar(engine, oid_sql) == oid_before and _index_row(engine)[0]

        # Seeded span over: restore the table's autovacuum setting.
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE coord.alerts RESET (autovacuum_enabled)"))

        # 7. Downgrade removes it; rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _scalar(engine, "SELECT count(*) FROM coord.alerts") == _SEED_ROWS
