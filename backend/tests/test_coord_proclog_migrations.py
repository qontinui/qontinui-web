"""Shape test for the ``coord_proclog_01`` .. ``coord_proclog_05`` revisions.

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics`` lands
every table and source index the process twin reads, in one chain of five
revisions. What this pins is the CONTRACT coord's projector and workers
(Phases 2-9) depend on:

1. **Source shapes coord's migration_classifier admits** — every upgrade
   ``op.execute`` is one static literal; the table revisions build no index
   CONCURRENTLY, and every CONCURRENTLY build in ``coord_proclog_05`` sits inside
   an ``autocommit_block`` and is ``IF NOT EXISTS``.
2. **The chain is linear and pinned** — each revision's one-line
   ``down_revision`` is the one before it, and the first sits on the head it
   was authored against.
3. **No index names ``coord.gates.evaluated_at``** — the 10 s sweep rewrites
   it on every open gate, and an index on it would make each write non-HOT.
4. **Absent at the parent; present, VALID and idempotent after** — a ``stamp``
   back to the parent and a re-upgrade converge on the same catalog state.
5. **The idempotency keys behave on real rows** — a fleet-scope event
   (``tenant_id NULL``) dedupes under ``NULLS NOT DISTINCT``; a link
   re-observation upserts one row; the categorical CHECKs refuse
   out-of-vocabulary values; E2O rows cascade with their event.
6. **Downgrade removes exactly what upgrade added**, and re-upgrade restores it.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    upgrade_execute_calls,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot change what this test walks. The first test enforces that
# `_PARENT_REVISION_ID` equals coord_proclog_01's own `down_revision`.
_PARENT_REVISION_ID = "coord_agent_worktrees_client_allocation_id_01"
_REVISIONS = [
    ("coord_proclog_01", "coord_proclog_01_process_log.py"),
    ("coord_proclog_02", "coord_proclog_02_flow_snapshots.py"),
    ("coord_proclog_03", "coord_proclog_03_conformance_verdicts.py"),
    ("coord_proclog_04", "coord_proclog_04_forecasts.py"),
    ("coord_proclog_05", "coord_proclog_05_source_stamp_indexes.py"),
]
_HEAD_REVISION_ID = _REVISIONS[-1][0]

_TABLES = {
    "process_events",
    "process_event_objects",
    "process_object_links",
    "process_log_watermarks",
    "process_flow_snapshots",
    "process_conformance_verdicts",
    "process_forecasts",
}
_STAMP_INDEX_COUNT = 36  # plus ix_proclog_gates_terminal_unarchived


def _source(filename: str) -> str:
    return (backend_root() / "alembic" / "versions" / filename).read_text(
        encoding="utf-8"
    )


@pytest.mark.parametrize("position", range(len(_REVISIONS)))
def test_the_chain_is_linear_and_each_parent_is_on_one_line(position: int) -> None:
    revision_id, filename = _REVISIONS[position]
    parent = _PARENT_REVISION_ID if position == 0 else _REVISIONS[position - 1][0]
    source = _source(filename)
    declared = declared_parent_revision_id(source, filename)
    assert declared == parent, (
        f"{filename} declares down_revision={declared!r}; expected {parent!r}. "
        "Re-point the chain and this test together."
    )
    assert re.search(
        r'^revision[^=\n]*=\s*"' + re.escape(revision_id) + r'"\s*$',
        source,
        re.MULTILINE,
    ), f"{filename} must declare revision={revision_id!r}"
    one_line = re.search(
        r'^down_revision[^=\n]*=\s*"' + re.escape(parent) + r'"',
        source,
        re.MULTILINE,
    )
    assert one_line is not None, (
        "down_revision must be assigned its string literal on ONE line — "
        "coord's line-scoped alembic-graph parser reads only that line"
    )


@pytest.mark.parametrize(("revision_id", "filename"), _REVISIONS)
def test_upgrade_statements_are_static_and_concurrently_is_in_autocommit(
    revision_id: str, filename: str
) -> None:
    calls = upgrade_execute_calls(backend_root() / "alembic" / "versions" / filename)
    assert calls, f"{revision_id}: upgrade() must issue its DDL through op.execute"
    for call in calls:
        assert call.sql is not None, (
            "every upgrade op.execute must take ONE static string literal — "
            "coord's migration_classifier rejects anything dynamic"
        )
    concurrent = [c for c in calls if "CONCURRENTLY" in (c.sql or "").upper()]
    if revision_id == _HEAD_REVISION_ID:
        assert len(concurrent) == len(calls) == _STAMP_INDEX_COUNT + 1
        for call in concurrent:
            assert call.in_autocommit_block, (
                "CREATE INDEX CONCURRENTLY outside autocommit_block fails at runtime"
            )
            assert "IF NOT EXISTS" in (call.sql or "").upper()
    else:
        assert not concurrent, f"{revision_id} builds indexes on NEW tables only"


def test_no_index_names_gates_evaluated_at() -> None:
    for _, filename in _REVISIONS:
        for call in upgrade_execute_calls(
            backend_root() / "alembic" / "versions" / filename
        ):
            sql = " ".join((call.sql or "").split())
            if "ON coord.gates " in sql:
                assert "evaluated_at" not in sql, (
                    "an index naming coord.gates.evaluated_at makes every 10 s "
                    f"sweep write non-HOT: {sql}"
                )


def _tables(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT table_name FROM information_schema.tables
                 WHERE table_schema = 'coord' AND table_name LIKE 'process%'
                """
            )
        ).all()
    return {r[0] for r in rows}


def _proclog_indexes(engine: Engine) -> dict[str, bool]:
    """``{index name: indisvalid}`` for every index on a process_* table or
    named ``ix_proclog_*``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname, i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_class t ON t.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord'
                   AND (c.relname LIKE 'ix_proclog_%'
                        OR t.relname LIKE 'process_%')
                """
            )
        ).all()
    return {r[0]: bool(r[1]) for r in rows}


def _assert_present(engine: Engine) -> dict[str, bool]:
    assert _tables(engine) == _TABLES
    indexes = _proclog_indexes(engine)
    invalid = sorted(name for name, valid in indexes.items() if not valid)
    assert not invalid, f"INVALID indexes (a failed CONCURRENTLY build): {invalid}"
    stamp = [n for n in indexes if n.startswith("ix_proclog_")]
    assert len(stamp) == _STAMP_INDEX_COUNT + 1, sorted(stamp)
    return indexes


def _assert_absent(engine: Engine) -> None:
    assert _tables(engine) == set()
    assert not [n for n in _proclog_indexes(engine) if n.startswith("ix_proclog_")]


_INSERT_EVENT = text(
    """
    INSERT INTO coord.process_events
        (tenant_id, activity, occurred_at, source, source_key,
         evidence_tier, time_basis)
    VALUES (:tenant_id, 'train.occupancy_hourly', now(), 'scheduler_ticks',
            :source_key, :tier, 'event')
    ON CONFLICT (tenant_id, source, source_key) DO NOTHING
    RETURNING event_id
    """
)


def _assert_key_behaviour(engine: Engine) -> None:
    with engine.connect() as conn:
        outer = conn.begin()
        try:
            fleet = {
                "tenant_id": None,
                "source_key": "2026-10-12T00",
                "tier": "derived",
            }
            first = conn.execute(_INSERT_EVENT, fleet).scalar_one_or_none()
            assert first is not None
            # A fleet-scope replay dedupes: NULL tenant compares NOT DISTINCT.
            assert conn.execute(_INSERT_EVENT, fleet).scalar_one_or_none() is None
            # The same source key under a tenant is a different event.
            tenant = {**fleet, "tenant_id": uuid.uuid4()}
            assert conn.execute(_INSERT_EVENT, tenant).scalar_one_or_none()

            # E2O rows cascade with their event.
            conn.execute(
                text(
                    """
                    INSERT INTO coord.process_event_objects
                        (event_id, tenant_id, object_type, object_id, qualifier,
                         occurred_at)
                    VALUES (:event_id, NULL, 'train', 'train', 'subject', now())
                    """
                ),
                {"event_id": first},
            )
            conn.execute(
                text("DELETE FROM coord.process_events WHERE event_id = :e"),
                {"e": first},
            )
            assert (
                conn.execute(
                    text("SELECT count(*) FROM coord.process_event_objects")
                ).scalar_one()
                == 0
            )

            # A link re-observation moves last_observed_at, not the row count.
            upsert = text(
                """
                INSERT INTO coord.process_object_links
                    (tenant_id, from_type, from_id, to_type, to_id, qualifier,
                     resolution, source)
                VALUES (NULL, 'pr', 'o/r#1', 'work_unit', 'w', 'implements',
                        'resolved', 'work_unit_pr_citations')
                ON CONFLICT (tenant_id, from_type, from_id, to_type, to_id,
                             qualifier, source)
                DO UPDATE SET last_observed_at = now()
                """
            )
            conn.execute(upsert)
            conn.execute(upsert)
            assert (
                conn.execute(
                    text("SELECT count(*) FROM coord.process_object_links")
                ).scalar_one()
                == 1
            )

            # Closed categorical vocabularies refuse anything else.
            refused = [
                (_INSERT_EVENT, {**fleet, "source_key": "x", "tier": "0.9"}),
                (
                    text(
                        """
                        INSERT INTO coord.process_conformance_verdicts
                            (tenant_id, constraint_id, case_type, case_id, verdict)
                        VALUES (gen_random_uuid(), 'c', 'session', '1', 'maybe')
                        """
                    ),
                    {},
                ),
                (
                    text(
                        """
                        INSERT INTO coord.process_forecasts
                            (tenant_id, question, object_type, object_id,
                             issued_at, horizon_secs, p)
                        VALUES (gen_random_uuid(), 'land_within_t', 'proposal',
                                '1', now(), 3600, 1.5)
                        """
                    ),
                    {},
                ),
            ]
            for statement, params in refused:
                savepoint = conn.begin_nested()
                with pytest.raises(IntegrityError) as excinfo:
                    conn.execute(statement, params)
                savepoint.rollback()
                assert getattr(excinfo.value.orig, "pgcode", None) == "23514"
        finally:
            outer.rollback()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the process-log tables "
        "and source-stamp indexes were NOT verified — only the revision source. "
        "This skip is not a pass. CI provisions a postgres service; locally, "
        "point DATABASE_URL at a reachable instance."
    ),
)
def test_coord_proclog_chain_round_trip() -> None:
    """Walk parent → head → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_proclog") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        run_alembic(root, url, "upgrade", _HEAD_REVISION_ID)
        indexes = _assert_present(engine)
        _assert_key_behaviour(engine)

        # Re-run over its own output: `stamp` rewinds only the version marker.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _HEAD_REVISION_ID)
        assert _assert_present(engine) == indexes

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        run_alembic(root, url, "upgrade", _HEAD_REVISION_ID)
        assert _assert_present(engine) == indexes
