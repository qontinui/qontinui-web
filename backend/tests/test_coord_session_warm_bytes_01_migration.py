"""Data-semantics test for the ``coord_session_warm_bytes_01`` revision.

Phase 1 of plan
``qontinui-dev-notes/plans/2026-10-30-coord-session-output-per-session-warm-sum-scans-the-session-on-every-chunk.md``
creates ``coord.session_warm_bytes`` and seeds it from the per-session SUM it
replaces. Sibling of ``test_coord_tenant_warm_bytes_01_migration.py``; the
published upsert shapes are pinned there and are not re-tested here.

``migration-reversal.yml`` runs against an EMPTY database, where the backfill
inserts nothing — so the data contract below is invisible to it.

Cases covered
=============

1. **Backfill arithmetic, keyed by SESSION** — two sessions of one tenant, so a
   tenant-keyed grouping would produce one row instead of two.
2. **A session with NO output rows gets NO row** — absence, not a zero.
3. **FK ``ON DELETE CASCADE``** — deleting a session removes its counter row,
   which is what keeps the counter right through coord's session prune with no
   coord code.
4. **A re-run re-seats a drifted counter** (``DO UPDATE``, not ``DO NOTHING``).
5. **A re-run repairs a NEGATIVE counter** — backfill before the CHECK guard.
6. **Downgrade / re-upgrade** — the seed is re-derivable.

Guards needing no database (never skip) pin the parent revision, the backfill
running OUTSIDE the DDL transaction, and the backfill-before-CHECK order.

⚠️ A skip proves nothing — set ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is
not the instance accepting the test credentials.
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
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

# `_PARENT_REVISION_ID` MUST stay equal to the revision's own `down_revision`
# (enforced below); re-point both together when the chain is re-forked.
_REVISION_ID = "coord_session_warm_bytes_01"
_PARENT_REVISION_ID = "journey_04_explorations_stop_detail_any_stop"
_REVISION_FILENAME = "coord_session_warm_bytes_01_counter_table.py"

_CHECK_NAME = "session_warm_bytes_bytes_nonnegative"

_S1_CHUNKS = (10, 20, 30)
_S2_CHUNKS = (5, 100)
_EXPECT_S1 = sum(_S1_CHUNKS)  # 60
_EXPECT_S2 = sum(_S2_CHUNKS)  # 105

_DRIFTED = 999_999


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_path():
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """A stale pin rewinds too far and replays unrelated non-idempotent revisions."""
    source = _revision_path().read_text(encoding="utf-8")
    declared = declared_parent_revision_id(source, _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this "
        f"test pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. Re-point both."
    )


def test_the_backfill_runs_outside_the_ddl_transaction_and_before_the_check() -> None:
    """The two orderings the revision's correctness rests on.

    * The CREATE TABLE (whose inline FK takes SHARE ROW EXCLUSIVE on
      coord.sessions) must run in the batch transaction, and the backfill
      INSIDE the autocommit block — otherwise env.py's single transaction holds
      that lock across the whole session_output scan, blocking every session
      registration and heartbeat.
    * The backfill must precede the ADD CONSTRAINT guard, or a re-run against a
      NEGATIVE counter aborts on validation before it repairs anything.
    """
    calls = upgrade_execute_calls(_revision_path())
    assert all(c.sql is not None for c in calls), "every op.execute is one literal"

    def index_of(fragment: str) -> int:
        hits = [i for i, c in enumerate(calls) if fragment in (c.sql or "")]
        assert len(hits) == 1, (
            f"expected exactly one op.execute containing {fragment!r}"
        )
        return hits[0]

    create = index_of("CREATE TABLE IF NOT EXISTS coord.session_warm_bytes")
    backfill = index_of("INSERT INTO coord.session_warm_bytes")
    add_check = index_of(f"ADD CONSTRAINT {_CHECK_NAME}")

    assert not calls[create].in_autocommit_block, "the DDL belongs in the batch txn"
    assert calls[backfill].in_autocommit_block, (
        "the backfill must run inside op.get_context().autocommit_block(), after "
        "the DDL transaction (and its coord.sessions lock) has committed"
    )
    assert calls[add_check].in_autocommit_block
    assert create < backfill < add_check


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 (or "
        "bring up a backend Postgres) before running this test."
    ),
)


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Seed one tenant with three sessions at the PARENT revision."""
    tenant = uuid.uuid4()
    device_id = uuid.uuid4()
    sessions = {"s1": uuid.uuid4(), "s2": uuid.uuid4(), "s3": uuid.uuid4()}

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:tenant_id, :slug, 'session warm bytes test tenant')"
            ),
            {"tenant_id": tenant, "slug": f"sesswarm-{tenant.hex[:12]}"},
        )
        conn.execute(
            text(
                "INSERT INTO coord.devices (device_id, tenant_id, name, hostname) "
                "VALUES (:device_id, :tenant_id, 'sess-warm-device', 'sess-warm-host')"
            ),
            {"device_id": device_id, "tenant_id": tenant},
        )
        for session_id in sessions.values():
            conn.execute(
                text(
                    """
                    INSERT INTO coord.sessions
                        (id, tenant_id, device_id, session_kind, intent)
                    VALUES (:id, :tenant_id, :device_id, 'agentic',
                            CAST('{}' AS jsonb))
                    """
                ),
                {"id": session_id, "tenant_id": tenant, "device_id": device_id},
            )

        def chunk(session_id: uuid.UUID, offset: int, size: int) -> None:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.session_output
                        (session_id, chunk_offset, payload, compressed_size)
                    VALUES (:session_id, :chunk_offset, :payload, :size)
                    """
                ),
                {
                    "session_id": session_id,
                    "chunk_offset": offset,
                    "payload": b"x",
                    "size": size,
                },
            )

        for offset, size in enumerate(_S1_CHUNKS):
            chunk(sessions["s1"], offset, size)
        for offset, size in enumerate(_S2_CHUNKS):
            chunk(sessions["s2"], offset, size)
        # s3 gets NO chunks at all.

    return sessions


def _counter(engine: Engine, session_id: uuid.UUID) -> int | None:
    with engine.connect() as conn:
        value = conn.execute(
            text("SELECT bytes FROM coord.session_warm_bytes WHERE session_id = :s"),
            {"s": session_id},
        ).scalar()
    return None if value is None else int(value)


def _check_exists(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS(
                        SELECT 1
                          FROM pg_constraint c
                          JOIN pg_class t ON t.oid = c.conrelid
                          JOIN pg_namespace n ON n.oid = t.relnamespace
                         WHERE n.nspname = 'coord'
                           AND t.relname = 'session_warm_bytes'
                           AND c.conname = :name
                    )
                    """
                ),
                {"name": _CHECK_NAME},
            ).scalar()
        )


@_PG_SKIP
def test_coord_session_warm_bytes_01_backfills_cascades_and_downgrades() -> None:
    """Seed the parent revision, apply the counter table, assert the seed."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_sess_warm_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", "session_warm_bytes")
        sessions = _seed(engine)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", "session_warm_bytes")
        assert _check_exists(engine)

        # -- 1. backfill arithmetic, per session --------------------------
        assert _counter(engine, sessions["s1"]) == _EXPECT_S1
        assert _counter(engine, sessions["s2"]) == _EXPECT_S2

        # -- 2. no output rows -> NO row, not a zero ----------------------
        assert _counter(engine, sessions["s3"]) is None

        # -- 4. a re-run re-seats a drifted counter -----------------------
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.session_warm_bytes SET bytes = :wrong "
                    "WHERE session_id = :s"
                ),
                {"wrong": _DRIFTED, "s": sessions["s1"]},
            )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _counter(engine, sessions["s1"]) == _EXPECT_S1

        # -- 5. a re-run repairs a NEGATIVE counter -----------------------
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"ALTER TABLE coord.session_warm_bytes DROP CONSTRAINT {_CHECK_NAME}"
                )
            )
            conn.execute(
                text(
                    "UPDATE coord.session_warm_bytes SET bytes = -12345 "
                    "WHERE session_id = :s"
                ),
                {"s": sessions["s2"]},
            )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _counter(engine, sessions["s2"]) == _EXPECT_S2
        assert _check_exists(engine), "the guard re-attaches the CHECK after repair"

        # -- 3. FK ON DELETE CASCADE --------------------------------------
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.session_output WHERE session_id = :s"),
                {"s": sessions["s2"]},
            )
            conn.execute(
                text("DELETE FROM coord.sessions WHERE id = :s"),
                {"s": sessions["s2"]},
            )
        assert _counter(engine, sessions["s2"]) is None, (
            "deleting a session must cascade its counter row away"
        )

        # -- 6. downgrade / re-upgrade ------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", "session_warm_bytes")
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _counter(engine, sessions["s1"]) == _EXPECT_S1
        assert _counter(engine, sessions["s3"]) is None
