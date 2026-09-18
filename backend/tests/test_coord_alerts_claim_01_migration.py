"""Behaviour test for the ``coord_alerts_claim_01`` revision.

The revision adds three nullable lease columns to ``coord.alerts``
(``claimed_by``, ``claimed_at``, ``claim_expires_at``) and one partial index::

    CREATE INDEX CONCURRENTLY idx_alerts_claim_expiry
    ON coord.alerts (claim_expires_at)
    WHERE resolved_at IS NULL AND claimed_by IS NOT NULL

What is asserted
================

1. Nothing exists at the parent revision.
2. After upgrade the three columns exist, are NULLable, have no default, and
   carry the declared types — an existing row reads as unclaimed (all NULL).
3. The index exists and is **``indisvalid``** (a killed CONCURRENTLY build
   leaves an INVALID index that ``IF NOT EXISTS`` would skip on re-run), and
   its recorded predicate names both conjuncts.
4. **The live-lease read rides the index** — the shape coord's queue issues to
   separate live leases from lapsed ones.
5. **Sensitivity:** an unclaimed-alert read (``claimed_by IS NULL``) cannot
   use it, so assertion 4 is measuring the partial predicate, not a full index.
6. **Idempotency:** with the schema already applied, ``alembic stamp`` back to
   the parent and ``upgrade`` again succeeds and leaves a valid index.
7. **A failed CONCURRENTLY build is repaired, not kept:** an INVALID index of
   the same name (manufactured by a genuinely failing ``CREATE UNIQUE INDEX
   CONCURRENTLY`` — no catalog poking, no superuser) is dropped and rebuilt
   by a re-run, instead of being skipped by ``IF NOT EXISTS``.
8. Downgrade removes the index and the columns; rows survive. A second
   upgrade re-applies cleanly after the downgrade.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_alerts_claim_01"
_PARENT_REVISION_ID = "coord_overlap_detections"

_INDEX_NAME = "idx_alerts_claim_expiry"

_COLUMNS = {
    "claimed_by": "text",
    "claimed_at": "timestamp with time zone",
    "claim_expires_at": "timestamp with time zone",
}

# The live-lease read: open alerts whose lease has not lapsed.
_LIVE_LEASE_SQL = """
    SELECT id FROM coord.alerts
     WHERE resolved_at IS NULL
       AND claimed_by IS NOT NULL
       AND claim_expires_at > now()
"""

# The complement: unclaimed open alerts. The partial index cannot serve it.
_UNCLAIMED_SQL = """
    SELECT id FROM coord.alerts
     WHERE resolved_at IS NULL AND claimed_by IS NULL
"""


def _index_row(engine: Engine) -> tuple[bool, str]:
    """``(indisvalid, predicate)`` for the index."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return bool(row[0]), str(row[1] or "")


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is small, so a seq scan would win on cost regardless.
    ``enable_seqscan = off`` leaves the question being asked: does the planner
    choose this index for this predicate over the table's other open-alert
    partials? A predicate the partial index does not cover never plans on it.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


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
def test_coord_alerts_claim_01_adds_lease_columns_and_partial_index() -> None:
    """Add the lease columns + index, prove the live-lease read rides it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_alerts_claim_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — nothing yet. Seed a pre-existing open alert so
        #    the upgrade is exercised against a non-empty table.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for column in _COLUMNS:
            assert column_info(engine, "alerts", column) is None, (
                f"coord.alerts.{column} must be added by this revision"
            )
        assert not index_exists(engine, _INDEX_NAME)

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts (alert_key, severity, kind, summary)
                    VALUES ('pre-existing', 'warning', 'pr_merge_stuck', 'pre')
                    """
                )
            )

        # 2. Apply — columns are nullable, default-less, correctly typed, and
        #    the pre-existing row reads as unclaimed.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for column, data_type in _COLUMNS.items():
            info = column_info(engine, "alerts", column)
            assert info is not None, f"coord.alerts.{column} missing after upgrade"
            assert info == (data_type, "YES", None), (
                f"coord.alerts.{column}: expected nullable {data_type} with no "
                f"default, got {info!r}"
            )
        with engine.connect() as conn:
            pre = conn.execute(
                text(
                    """
                    SELECT claimed_by, claimed_at, claim_expires_at
                      FROM coord.alerts WHERE alert_key = 'pre-existing'
                    """
                )
            ).one()
        assert tuple(pre) == (None, None, None), "existing rows must read unclaimed"

        # 3. The index exists, is VALID, and carries the intended predicate.
        assert index_exists(engine, _INDEX_NAME)
        valid, predicate = _index_row(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )
        assert "resolved_at IS NULL" in predicate, predicate
        assert "claimed_by IS NOT NULL" in predicate, predicate

        # Seed: a live lease, a lapsed lease, an unclaimed open alert, and a
        # resolved alert that still carries a lease (outside the predicate).
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary,
                         claimed_by, claimed_at, claim_expires_at, resolved_at)
                    VALUES
                        ('live', 'critical', 'pr_merge_stuck', 'live',
                         'agent-a', now(), now() + interval '2 hours', NULL),
                        ('lapsed', 'critical', 'pr_merge_stuck', 'lapsed',
                         'agent-b', now() - interval '3 hours',
                         now() - interval '1 hour', NULL),
                        ('unclaimed', 'critical', 'pr_merge_stuck', 'unclaimed',
                         NULL, NULL, NULL, NULL),
                        ('resolved-claimed', 'critical', 'pr_merge_stuck', 'rc',
                         'agent-c', now(), now() + interval '2 hours', now())
                    """
                )
            )
            # The production shape: open alerts are overwhelmingly UNCLAIMED
            # (27,604 open, none claimed, when the plan was written). Without
            # that bulk, every open-alert partial on this table is the same
            # size as the new one and the planner picks between them on a
            # coin-flip of cost — measured: it chose idx_alerts_active_severity.
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts (alert_key, severity, kind, summary)
                    SELECT 'bulk-unclaimed-' || g, 'warning', 'pr_merge_stuck', 'bulk'
                      FROM generate_series(1, 2000) AS g
                    """
                )
            )
            conn.execute(text("ANALYZE coord.alerts"))

        # 4. The live-lease read rides the index and returns only the live one.
        plan = _plan_for(engine, _LIVE_LEASE_SQL)
        assert _INDEX_NAME in plan, f"the live-lease read must ride the index:\n{plan}"
        with engine.connect() as conn:
            live_keys = {
                r[0]
                for r in conn.execute(
                    text(
                        "SELECT alert_key FROM coord.alerts WHERE id IN ("
                        + _LIVE_LEASE_SQL
                        + ")"
                    )
                )
            }
        assert live_keys == {"live"}, (
            "an expired lease must read as unclaimed and a resolved alert is "
            f"never a live lease; got {live_keys!r}"
        )

        # 5. Sensitivity — the unclaimed read cannot use the partial index.
        complement_plan = _plan_for(engine, _UNCLAIMED_SQL)
        assert _INDEX_NAME not in complement_plan, (
            "a `claimed_by IS NULL` read must NOT match this partial index:\n"
            + complement_plan
        )

        # 6. Idempotency — re-running the revision over its own schema.
        with engine.connect() as conn:
            oid_before = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "a re-run must leave a VALID index"
        with engine.connect() as conn:
            oid_after = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        assert oid_after == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # 7. A failed CONCURRENTLY build is repaired. Replace the index with a
        #    same-named UNIQUE build over `kind`: the 'live' and 'lapsed' rows
        #    are both claimed, open and share a kind, so the build fails and
        #    leaves an INVALID index under our name.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("DROP INDEX CONCURRENTLY coord.idx_alerts_claim_expiry"))
            with pytest.raises(IntegrityError):
                conn.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX CONCURRENTLY idx_alerts_claim_expiry
                        ON coord.alerts (kind)
                        WHERE resolved_at IS NULL AND claimed_by IS NOT NULL
                        """
                    )
                )
        assert index_exists(engine, _INDEX_NAME)
        assert not _index_row(engine)[0], "fixture must leave an INVALID index"

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        valid, predicate = _index_row(engine)
        assert valid, "the re-run must drop the INVALID index and rebuild it"
        with engine.connect() as conn:
            indexdef = str(
                conn.execute(
                    text("SELECT pg_get_indexdef(CAST(:i AS regclass))"),
                    {"i": "coord." + _INDEX_NAME},
                ).scalar_one()
            )
        assert "UNIQUE" not in indexdef and "(claim_expires_at)" in indexdef, (
            f"the rebuilt index must be the revision's own, got {indexdef!r}"
        )

        # 8. Downgrade removes index + columns; rows survive. Re-upgrade works.
        rows_before = _alert_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        for column in _COLUMNS:
            assert column_info(engine, "alerts", column) is None, (
                f"downgrade must drop coord.alerts.{column}"
            )
        assert _alert_count(engine) == rows_before, "downgrade must not delete alerts"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_row(engine)[0], "re-applied index must be VALID"
