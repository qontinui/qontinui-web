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

# The judge query's selection: a kind-less trailing window on first_seen_at.
_WINDOW_SQL = """
    SELECT kind, count(*) FROM coord.alerts
     WHERE first_seen_at >= now() - interval '30 days'
     GROUP BY kind
"""


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
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, first_seen_at)
                    SELECT 'k-' || g, 'warning',
                           (ARRAY['pr_merge_stuck', 'red_main', 'stale_wip'])[1 + g % 3],
                           'seed', now() - (g % 60) * interval '1 day'
                      FROM generate_series(1, 3000) AS g
                    """
                )
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
        with engine.connect() as conn:
            in_window = sum(int(r[1]) for r in conn.execute(text(_WINDOW_SQL)).all())
            expected = int(
                conn.execute(
                    text(
                        "SELECT count(*) FROM coord.alerts "
                        "WHERE first_seen_at >= now() - interval '30 days'"
                    )
                ).scalar_one()
            )
        assert in_window == expected and 0 < in_window < _alert_count(engine)

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

        # 5. Downgrade removes it; rows survive.
        rows_before = _alert_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _alert_count(engine) == rows_before, "downgrade must not delete alerts"
