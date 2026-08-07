"""Behaviour test for the ``coord_alerts_pagedidx_01`` partial index.

The revision creates one index::

    CREATE INDEX CONCURRENTLY idx_alerts_paged
    ON coord.alerts (paged_at) WHERE paged_at IS NOT NULL

It closes the web half of Phase 3, whose coord half (the
``WHERE paged_at IS NOT NULL`` hoist plus a ``cached_swr`` memo) is already
live in production. ``migration-reversal.yml`` would only confirm the statement
executes against an empty database. The contract is that **the planner chooses
this index for the exact ``COUNTS_SQL`` coord now issues**, so that is what is
pinned here.

What is asserted
================

1. The index exists after upgrade and is **``indisvalid``** — a killed
   ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS`` would
   skip on re-run, so existence alone would green a dead index.
2. Its recorded predicate is the intended one.
3. **The planner chooses it for the real ``COUNTS_SQL``**, quoted verbatim from
   ``qontinui-coord`` ``origin/main`` ``4f49f973``. If coord's outer ``WHERE``
   and this predicate ever diverge, the index stops being chosen silently — the
   same implication-proof failure mode the sibling flake-heal index has.
4. **The three buckets classify correctly**, over a fixture carrying a
   delivered row, an undeliverable row, an unattributed row (paged but with no
   ``pageout`` marker at all), and an unpaged row. The plan makes this
   classification a Phase 3 gate item because it is load-bearing: every bucket
   is a POSITIVE match, so an unmarked row must land in ``unattributed`` and
   never be defaulted into ``delivered``. The unpaged row must be excluded
   entirely — that is what the new outer predicate, and hence this index, is
   selecting on.
5. **Sensitivity: the complementary query does NOT get the index.** A
   ``paged_at IS NULL`` read must fall back to a sequential scan. Without this,
   assertion 3 would still pass against an index that covered the whole table,
   and the test would not be measuring the partial predicate at all.
6. Downgrade removes it; rows survive.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
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

_REVISION_ID = "coord_alerts_pagedidx_01"
_PARENT_REVISION_ID = "coord_alerts_flakeidx_01"

_INDEX_NAME = "idx_alerts_paged"

# alert_pageout_metrics::COUNTS_SQL, verbatim from qontinui-coord origin/main
# 4f49f973. Quoted in full rather than simplified: the point of the test is
# that THIS statement rides the index, and a paraphrase could ride it while the
# real one did not.
_COUNTS_SQL = """
    SELECT
        count(*) FILTER (
            WHERE paged_at IS NOT NULL
              AND detail -> 'pageout' ->> 'state' = 'delivered'
        )::bigint AS delivered,
        count(*) FILTER (
            WHERE paged_at IS NOT NULL
              AND detail -> 'pageout' ->> 'state' = 'undeliverable'
        )::bigint AS undeliverable,
        count(*) FILTER (
            WHERE paged_at IS NOT NULL
              AND detail -> 'pageout' ->> 'state' IS DISTINCT FROM 'delivered'
              AND detail -> 'pageout' ->> 'state' IS DISTINCT FROM 'undeliverable'
        )::bigint AS unattributed
    FROM coord.alerts
    WHERE paged_at IS NOT NULL
"""

# The complementary predicate: the partial index cannot serve it.
_COMPLEMENT_SQL = "SELECT count(*) FROM coord.alerts WHERE paged_at IS NULL"

# (alert_key, paged, detail JSON) for the four classification cases.
_SEED_ROWS = [
    ("pageout-delivered", True, '{"pageout": {"state": "delivered"}}'),
    ("pageout-undeliverable", True, '{"pageout": {"state": "undeliverable"}}'),
    # Paged, but the marker is absent entirely — a stamp from a build predating
    # the marker, which must be reported as UNATTRIBUTED, never as delivered.
    ("pageout-unmarked", True, '{"repo": "qontinui/qontinui-coord"}'),
    # Never paged — excluded by the outer predicate, and by the index.
    ("never-paged", False, '{"pageout": {"state": "delivered"}}'),
]


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


def _index_predicate(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    """
                    SELECT pg_get_expr(i.indpred, i.indrelid)
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :idx
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar()
            or ""
        )


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is tiny, so a seq scan would win on cost regardless of index
    quality. ``enable_seqscan = off`` removes the cost question and leaves the
    one being asked: CAN the planner use this index for this predicate? If the
    partial predicate does not cover the query, no penalty makes it usable and
    the plan still shows a Seq Scan — which is how case 5 discriminates.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine) -> None:
    """Seed the four classification cases.

    ``CAST(:d AS jsonb)`` rather than ``:d::jsonb``: SQLAlchemy's ``text()``
    parses ``:name`` bind parameters itself and mis-parses a ``::`` cast that
    immediately follows one, emitting a stray ``:`` that Postgres rejects.
    """
    with engine.begin() as conn:
        for key, paged, detail in _SEED_ROWS:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, detail, paged_at)
                    VALUES
                        (:key, 'critical', 'pr_merge_stuck', :key,
                         CAST(:d AS jsonb),
                         CASE WHEN :paged THEN now() ELSE NULL END)
                    """
                ),
                {"key": key, "d": detail, "paged": paged},
            )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_alerts_pagedidx_01_index_serves_the_pageout_counts() -> None:
    """Build the index, prove COUNTS_SQL rides it and classifies correctly."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_alerts_pagedidx_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision — the index must not exist yet.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )

        # ----------------------------------------------------------------
        # 2. Apply — exists, and is VALID (not a half-built CONCURRENTLY).
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )

        predicate = _index_predicate(engine)
        assert "paged_at" in predicate and "NOT NULL" in predicate, (
            f"unexpected index predicate: {predicate!r}"
        )

        _seed(engine)

        # ----------------------------------------------------------------
        # 3. The real COUNTS_SQL rides the index.
        # ----------------------------------------------------------------
        plan = _plan_for(engine, _COUNTS_SQL)
        assert _INDEX_NAME in plan, (
            f"coord's shipped COUNTS_SQL must ride the new index; got:\n{plan}"
        )

        # ----------------------------------------------------------------
        # 4. The three buckets classify correctly, and the unpaged row is
        #    excluded. Every bucket is a POSITIVE match — an unmarked but
        #    paged row belongs in `unattributed`, never in `delivered`.
        # ----------------------------------------------------------------
        with engine.connect() as conn:
            delivered, undeliverable, unattributed = conn.execute(
                text(_COUNTS_SQL)
            ).one()

        assert delivered == 1, "only the explicitly-delivered row counts as delivered"
        assert undeliverable == 1
        assert unattributed == 1, (
            "a paged row with no pageout marker must be reported as "
            "unattributed, not defaulted into delivered"
        )
        assert delivered + undeliverable + unattributed == 3, (
            "the never-paged row must be excluded by the outer predicate, "
            "even though its detail says 'delivered'"
        )

        # ----------------------------------------------------------------
        # 5. Sensitivity — the complementary predicate cannot use a partial
        #    index built on `paged_at IS NOT NULL`. If this fails, the index
        #    is not actually partial and assertion 3 proves nothing.
        # ----------------------------------------------------------------
        complement_plan = _plan_for(engine, _COMPLEMENT_SQL)
        assert _INDEX_NAME not in complement_plan, (
            "a `paged_at IS NULL` read must NOT match this partial index:\n"
            + complement_plan
        )

        # ----------------------------------------------------------------
        # 6. Downgrade removes it; the table and its rows survive.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.alerts")
            ).scalar() == len(_SEED_ROWS), (
                "downgrade drops the index only — rows are untouched"
            )
