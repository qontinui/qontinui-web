"""Behaviour test for the ``coord_alerts_firstseen_01`` index.

The revision creates one index::

    CREATE INDEX CONCURRENTLY idx_alerts_first_seen_at
    ON coord.alerts (first_seen_at)

for coord's Phase 6 judge query ``ops_judge_service_first_share_30d``, which
selects a trailing-30-day window of ``coord.alerts`` by ``first_seen_at``
across ALL kinds. ``migration-reversal.yml`` would only confirm the statement
executes; the contract is that **the window read gets ``first_seen_at`` as an
index condition**, so that is what is pinned.

What is asserted
================

1. Nothing named ``idx_alerts_first_seen_at`` exists at the parent revision,
   and there the window read's only index path is the ``(kind,
   first_seen_at)`` index — whose ``Index Cond`` on the NON-leading column
   bounds nothing (PostgreSQL 16 has no skip scan), so it walks every entry.
   This is the sensitivity half: it shows what the planner had before, so
   assertion 3 is measuring a change of index, not a pre-existing one.
2. After upgrade the index exists, is **``indisvalid``** (a killed
   ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS`` would
   skip on re-run), is non-partial, and keys ``(first_seen_at)``.
3. **The window read rides it** — chosen OVER the kind-leading index with
   both available, with ``first_seen_at`` as its (now leading, so bounding)
   index condition — and returns exactly the in-window rows.
3b. **It still does after ``VACUUM ANALYZE`` sets the visibility map**, the
   state in which an Index Only Scan on the kind-leading index becomes cheap.
   Autovacuum is disabled on the table for the seeded span so no plan above
   races it; this case sets the map deliberately instead, and the table's
   autovacuum setting is reset afterwards.
4. Idempotency: ``stamp`` back to the parent and ``upgrade`` again leaves the
   same valid index untouched.
5. Downgrade removes it; rows survive.

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

_REVISION_ID = "coord_alerts_firstseen_01"
_PARENT_REVISION_ID = "coord_alerts_onset_01"

_INDEX_NAME = "idx_alerts_first_seen_at"
# coord_iops_idx_01's (kind, first_seen_at): the parent revision's only path.
_KIND_INDEX_NAME = "idx_alerts_kind_first_seen_at"

# The judge query's shape: a kind-less trailing window on first_seen_at,
# aggregated WITHOUT grouping by kind (coord's ops_judge_service_first_share_30d
# filters by the range and counts). A `GROUP BY kind` variant is NOT this
# shape and is not a stable probe: once the visibility map is set, the planner
# serves it from an Index Only Scan on (kind, first_seen_at), which already
# carries `kind` in key order.
_WINDOW_SQL = """
    SELECT count(*) FROM coord.alerts
     WHERE first_seen_at >= now() - interval '30 days'
"""

# Seed geometry: 3000 rows, first_seen_at = now() - (g % 60) days. Offsets
# 0..29 are inside the window (offset 30 sits at the seed's now() - 30 days,
# which is before the query's later now() - 30 days), so 30 of every 60 rows.
_SEED_ROWS = 3000
_IN_WINDOW_ROWS = 1500


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
    put ``first_seen_at`` in an index condition for this range at all?
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _has_first_seen_index_cond(plan: str) -> bool:
    return any(
        "Index Cond" in line and "first_seen_at" in line for line in plan.splitlines()
    )


def _window_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text(_WINDOW_SQL)).scalar_one())


def _all_visible_pages(engine: Engine) -> int:
    """``pg_class.relallvisible`` for coord.alerts — pages the VM marks all-visible."""
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT relallvisible FROM pg_class WHERE oid = 'coord.alerts'::regclass"
                )
            ).scalar_one()
        )


def _alert_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text("SELECT count(*) FROM coord.alerts")).scalar_one())


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_alerts_firstseen_01_index_serves_the_trailing_window() -> None:
    """Add the first_seen_at index and prove the kind-less window read rides it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_alerts_firstseen_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)

        # Seed: 3 kinds spread over 60 days, so half the rows are in-window.
        # Autovacuum off first, so it cannot set the visibility map between
        # two plans below; 3b sets it on purpose.
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE coord.alerts SET (autovacuum_enabled = false)")
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, first_seen_at)
                    SELECT 'k-' || g, 'warning',
                           (ARRAY['pr_merge_stuck', 'red_main', 'stale_wip'])[1 + g % 3],
                           'seed', now() - (g % 60) * interval '1 day'
                      FROM generate_series(1, :n) AS g
                    """
                ),
                {"n": _SEED_ROWS},
            )
            conn.execute(text("ANALYZE coord.alerts"))

        # 1. Sensitivity — at the parent the only index path is the
        #    kind-leading one, whose first_seen_at condition bounds nothing.
        parent_plan = _plan_for(engine, _WINDOW_SQL)
        assert _KIND_INDEX_NAME in parent_plan, parent_plan
        assert _INDEX_NAME not in parent_plan, parent_plan

        # 2. Apply — index exists, VALID, non-partial, keyed (first_seen_at).
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, predicate, indexdef = _index_row(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )
        assert predicate is None, f"the index must not be partial: {predicate!r}"
        assert indexdef.endswith("(first_seen_at)"), indexdef

        # 3. The window read rides it, and counts only in-window rows.
        with engine.connect() as conn:
            conn.execute(text("ANALYZE coord.alerts"))
        plan = _plan_for(engine, _WINDOW_SQL)
        assert _INDEX_NAME in plan, f"the window read must ride the index:\n{plan}"
        assert _KIND_INDEX_NAME not in plan, (
            f"with both available the planner must prefer the bounded scan:\n{plan}"
        )
        assert _has_first_seen_index_cond(plan), plan
        assert _window_count(engine) == _IN_WINDOW_ROWS

        # 3b. Set the visibility map on purpose and re-plan: the bounded scan
        #     must still win over an Index Only Scan on (kind, first_seen_at).
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("VACUUM ANALYZE coord.alerts"))
        assert _all_visible_pages(engine) > 0, "VACUUM must have set the map"
        vm_plan = _plan_for(engine, _WINDOW_SQL)
        assert _INDEX_NAME in vm_plan, vm_plan
        assert _KIND_INDEX_NAME not in vm_plan, vm_plan
        assert _has_first_seen_index_cond(vm_plan), vm_plan
        assert _window_count(engine) == _IN_WINDOW_ROWS

        # 4. Idempotency — re-running over its own schema is a no-op.
        with engine.connect() as conn:
            oid_before = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        with engine.connect() as conn:
            oid_after = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        assert oid_after == oid_before and _index_row(engine)[0]

        # Seeded span over: restore the table's autovacuum setting.
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE coord.alerts RESET (autovacuum_enabled)"))

        # 5. Downgrade removes it; rows survive.
        rows_before = _alert_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _alert_count(engine) == rows_before, "downgrade must not delete alerts"
