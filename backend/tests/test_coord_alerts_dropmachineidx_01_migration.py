"""Behaviour test for ``coord_alerts_dropmachineidx_01`` — dropping ``idx_alerts_machine``.

The revision drops one never-scanned partial index::

    DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_machine

A drop is easy to green vacuously: ``DROP INDEX IF EXISTS`` on an index that was
never there succeeds and looks identical to a real drop. And the reverse
direction is where the actual hazard lives — the index is **partial**, so a
downgrade that recreates it without the ``WHERE device_id IS NOT NULL``
predicate would restore a larger, different index under the same name and no
name-based check would notice.

What is asserted
================

1. The index **exists at the parent revision** — otherwise the drop proves
   nothing, and every later assertion is vacuous.
2. Its pre-drop definition is the expected partial shape on ``device_id``.
3. After upgrade it is gone.
4. **The table and its rows survive** — a drop must not cascade to data.
5. **Downgrade restores a definitionally IDENTICAL index**, compared via
   ``pg_get_indexdef`` against the string captured in step 2 rather than by
   name. This is the assertion that catches a dropped predicate. The restored
   index is also asserted **``indisvalid``** — every other assertion here
   passes against a half-built INVALID index, so existence is not enough.
6. **Sensitivity: the restored index is genuinely partial.** Rows with a NULL
   ``device_id`` must not be indexed. Asserted by reading ``indpred`` and by
   confirming the planner will not use the index for an ``IS NULL`` read, so
   that assertion 5 cannot pass against a full-table index whose text merely
   happened to match.

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

_REVISION_ID = "coord_alerts_dropmachineidx_01"
_PARENT_REVISION_ID = "coord_pgss_ext_01"

_INDEX_NAME = "idx_alerts_machine"

# A read the partial index cannot serve: its predicate excludes NULL device_id.
_COMPLEMENT_SQL = "SELECT count(*) FROM coord.alerts WHERE device_id IS NULL"

# (alert_key, has_device) — two indexed rows, two excluded by the predicate.
_SEED_ROWS = [
    ("machine-a", True),
    ("machine-b", True),
    ("infra-no-device-1", False),
    ("infra-no-device-2", False),
]


def _index_def(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = :idx AND n.nspname = 'coord'
                """
            ),
            {"idx": _INDEX_NAME},
        ).scalar()


def _index_is_valid(engine: Engine) -> bool:
    """``indisvalid`` for the index — the check existence cannot make.

    A cancelled ``CREATE INDEX CONCURRENTLY`` leaves an INVALID index, and every
    other assertion here passes against one: ``pg_indexes`` lists it,
    ``pg_get_indexdef`` renders it identically, ``indpred`` is populated, and
    the "not in the plan" check passes *more* easily because an invalid index is
    never in any plan. So without this, a dead restore greens the whole test.
    """
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relname = :idx AND n.nspname = 'coord'
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
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relname = :idx AND n.nspname = 'coord'
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar()
            or ""
        )


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is tiny, so a seq scan wins on cost regardless of index quality.
    ``enable_seqscan = off`` removes the cost question and leaves the one being
    asked: CAN the planner use this index for this predicate?
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine) -> None:
    with engine.begin() as conn:
        for key, has_device in _SEED_ROWS:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, device_id)
                    VALUES
                        (:key, 'warning', 'stale_wip', :key,
                         CASE WHEN :has_device THEN gen_random_uuid() ELSE NULL END)
                    """
                ),
                {"key": key, "has_device": has_device},
            )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_alerts_dropmachineidx_01_drops_and_restores_identically() -> None:
    """Drop the index, keep the rows, and restore it byte-identically."""
    root = backend_root()

    with ephemeral_database(
        admin_database_url(), "coord_alerts_dropmachineidx_test"
    ) as (engine, url):
        # ----------------------------------------------------------------
        # 1. Parent revision — the index MUST be present, or the drop is
        #    vacuous and everything below proves nothing.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert index_exists(engine, _INDEX_NAME), (
            "the index must exist before this revision drops it — a "
            "DROP ... IF EXISTS against nothing would green vacuously"
        )

        # ----------------------------------------------------------------
        # 2. Capture the exact pre-drop definition. This string is the
        #    contract the downgrade has to reproduce.
        # ----------------------------------------------------------------
        before_def = _index_def(engine)
        assert before_def is not None
        assert "device_id" in before_def, (
            f"expected an index on device_id; got: {before_def}"
        )
        assert "WHERE" in before_def.upper(), (
            f"expected a PARTIAL index; got: {before_def}"
        )

        _seed(engine)

        # ----------------------------------------------------------------
        # 3. Apply — the index is gone.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)

        # ----------------------------------------------------------------
        # 4. The rows survive. Dropping an index must never touch data.
        # ----------------------------------------------------------------
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.alerts")
            ).scalar() == len(_SEED_ROWS), "the drop must not remove rows"

        # ----------------------------------------------------------------
        # 5. Downgrade restores a DEFINITIONALLY IDENTICAL index — compared
        #    by pg_get_indexdef, not by name. A downgrade that forgot the
        #    partial predicate would restore a different, larger index and
        #    still satisfy a name check.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "the restored index is INVALID — a cancelled CONCURRENTLY build "
            "leaves one that satisfies every other assertion below, so "
            "existence is not enough"
        )

        after_def = _index_def(engine)
        assert after_def == before_def, (
            "downgrade must recreate the index exactly as it was\n"
            f"before: {before_def}\n"
            f"after:  {after_def}"
        )

        # ----------------------------------------------------------------
        # 6. Sensitivity — the restored index really is partial. Without
        #    this, assertion 5 could pass against a full index whose text
        #    coincidentally matched.
        # ----------------------------------------------------------------
        predicate = _index_predicate(engine)
        assert "device_id" in predicate and "NOT NULL" in predicate, (
            f"restored index is not partial on device_id: {predicate!r}"
        )

        complement_plan = _plan_for(engine, _COMPLEMENT_SQL)
        assert _INDEX_NAME not in complement_plan, (
            "a `device_id IS NULL` read must NOT match a partial index built "
            "on `device_id IS NOT NULL`:\n" + complement_plan
        )
