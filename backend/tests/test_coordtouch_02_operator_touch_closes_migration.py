"""Behaviour test for the ``coordtouch_02_operator_touch_closes`` close sidecar.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contracts worth pinning here are the ones coord's close
door (plan ``2026-10-05-operator-touch-close-path`` Phase 2a) and its
effective-resolution fold rely on, and every one is a way the operator-wait
record could be quietly wrong:

1. **Shape** — the column set is EXACTLY the contract the revision's docstring
   states (names, types, nullability, the two server defaults), so a drift
   between the migration and coord's Rust reader fails here rather than in
   production.
2. **At most one close per (touch, source)** — the UNIQUE index is ENFORCED,
   over exactly ``(touch_id, close_source)``, and is a valid
   ``ON CONFLICT (touch_id, close_source)`` arbiter. A second source is a
   second row (plan D2's fold needs both).
3. **The CHECK is on ``close_source`` only.** A closer outside the closed set
   is refused; a new ``resolution`` / ``close_actor_class`` word is NOT —
   those are validated in coord and decoded fail-open, as ``coordtouch_01``
   does for its own vocabulary columns.
4. **``by_actor`` is NOT NULL** — an unattributed close of an operator wait is
   the laundering the append-only design exists to prevent.
5. **The close cascades with its touch** and never outlives it.
6. **The revision is additive only**: ``ix_operator_touches_tenant_open``
   survives it byte-for-byte (its drop ships with the read-side switch, plan
   Phase 4 — a destructive statement here would make coord's land-time
   re-point refuse this revision, E6), as does the window index; the
   downgrade drops only the sidecar.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
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
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "coordtouch_02_operator_touch_closes"
_REVISION_FILENAME = "coordtouch_02_operator_touch_closes.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent. ``alembic-graph-pr.yml`` serialises alembic PRs by
    construction, so any revision that lands ahead of this one re-forks the
    chain and ``down_revision`` is re-pointed at the new head. A pinned constant
    would make this test upgrade to a revision that is no longer this one's
    parent, so the "clean database" it asserts against would be the wrong one.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_CLOSES = "operator_touch_closes"
_UNIQUE_INDEX = "uq_operator_touch_closes_touch_source"
_OPEN_INDEX = "ix_operator_touches_tenant_open"
# The window index D7's open read will be bounded by (plan Phase 4) — created by coordtouch_01 and
# must survive this revision.
_WINDOW_INDEX = "ix_operator_touches_tenant_emitted_at"

# The column contract, EXACTLY: name -> (data_type, is_nullable). Coord's close
# door and effective-resolution fold read these names; a change here is a
# cross-repo contract change and must be made deliberately, in the same diff
# as the revision docstring's "Column contract".
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "close_id": ("uuid", "NO"),
    "touch_id": ("uuid", "NO"),
    "resolution": ("text", "NO"),
    "close_source": ("text", "NO"),
    "close_actor_class": ("text", "YES"),
    "observed_wait_ms": ("bigint", "YES"),
    "closed_at": ("timestamp with time zone", "NO"),
    "by_actor": ("text", "NO"),
}

_TENANT = uuid.UUID("7c41d2e9-3b5a-4f68-9e17-2a0c6d8b4f53")
_SESSION = uuid.UUID("e2b85f07-91c4-4d3a-b6f2-5c0a7e9d1b48")


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    """``{column_name: (data_type, is_nullable)}`` for the close sidecar."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _CLOSES},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _indexdef(engine: Engine, index_name: str) -> str | None:
    """``pg_indexes.indexdef`` for ``coord.<index_name>``, or None when absent."""
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND indexname = :idx
                """
            ),
            {"idx": index_name},
        ).scalar_one_or_none()


def _constraints(engine: Engine) -> dict[str, tuple[str, str]]:
    """``{conname: (contype, definition)}`` for every constraint on the sidecar."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = 'coord.operator_touch_closes'::regclass
                """
            )
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _insert_touch(engine: Engine, key: str) -> uuid.UUID:
    """One bare runner touch, as coordtouch_01's emitter writes it; its id."""
    with engine.begin() as conn:
        touch_id = conn.execute(
            text(
                """
                INSERT INTO coord.operator_touches
                    (tenant_id, session_id, kind, source, idempotency_key)
                VALUES (:tid, :sid, 'idle_at_prompt', 'runner_hook', :key)
                RETURNING touch_id
                """
            ),
            {"tid": _TENANT, "sid": _SESSION, "key": key},
        ).scalar_one()
    assert isinstance(touch_id, uuid.UUID)
    return touch_id


_INSERT_CLOSE = text(
    """
    INSERT INTO coord.operator_touch_closes
        (touch_id, resolution, close_source, close_actor_class,
         observed_wait_ms, by_actor)
    VALUES (:touch, :resolution, :source, :actor_class, :wait_ms, :by_actor)
    """
)


def _close(
    engine: Engine,
    touch: uuid.UUID,
    *,
    resolution: str = "answered",
    source: str = "runner_observed",
    actor_class: str | None = "human",
    wait_ms: int | None = 41_250,
    by_actor: str | None = "device:test",
) -> None:
    with engine.begin() as conn:
        conn.execute(
            _INSERT_CLOSE,
            {
                "touch": touch,
                "resolution": resolution,
                "source": source,
                "actor_class": actor_class,
                "wait_ms": wait_ms,
                "by_actor": by_actor,
            },
        )


def _close_count(engine: Engine, touch: uuid.UUID) -> int:
    """Close rows for ONE touch the test created — never a table-wide count."""
    with engine.connect() as conn:
        count = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM coord.operator_touch_closes
                 WHERE touch_id = :touch
                """
            ),
            {"touch": touch},
        ).scalar_one()
    return int(count)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coordtouch_02_creates_the_close_sidecar_additively() -> None:
    """Shape, the enforced (touch, source) key, the CHECK, cascade, and reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coordtouch02_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision — no sidecar yet, and the open index still stands.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _CLOSES), (
            "the sidecar must be created by this revision, not an earlier one"
        )
        original_open_indexdef = _indexdef(engine, _OPEN_INDEX)
        assert original_open_indexdef is not None, (
            f"{_OPEN_INDEX} must exist at the parent revision"
        )
        assert "WHERE (resolved_at IS NULL)" in original_open_indexdef

        # ----------------------------------------------------------------
        # 2. Apply — the sidecar and its unique index; nothing else changes.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _CLOSES)

        columns = _columns(engine)
        assert columns == _EXPECTED_COLUMNS, (
            "coord.operator_touch_closes' column set moved — it is a contract "
            "with coord's close door and effective-resolution fold. Update the "
            "revision docstring's 'Column contract' in the same diff."
        )
        close_id = column_info(engine, _CLOSES, "close_id")
        assert close_id is not None and close_id[2] == "gen_random_uuid()"
        closed_at = column_info(engine, _CLOSES, "closed_at")
        assert closed_at is not None and closed_at[2] == "clock_timestamp()", (
            "closed_at is coord's clock read under the row lock — not now(), "
            "which is the transaction start"
        )

        unique_def = _indexdef(engine, _UNIQUE_INDEX)
        assert unique_def is not None, f"missing index {_UNIQUE_INDEX}"
        # By NAME is not enough: pin uniqueness and the exact key, in order —
        # touch_id leads, so the open read's anti-join on touch_id uses it too.
        assert unique_def.startswith("CREATE UNIQUE INDEX"), unique_def
        assert unique_def.endswith("USING btree (touch_id, close_source)"), unique_def

        assert _indexdef(engine, _OPEN_INDEX) == original_open_indexdef, (
            f"{_OPEN_INDEX} must survive this additive revision unchanged — "
            "its drop ships with the read-side switch (plan Phase 4)"
        )
        assert index_exists(engine, _WINDOW_INDEX), (
            f"{_WINDOW_INDEX} is the window the open read will be bounded by (plan Phase 4)"
        )

        # Constraints: the PK, the FK (cascading), and ONE CHECK — on
        # close_source only. No CHECK on resolution / close_actor_class.
        constraints = _constraints(engine)
        assert sorted(contype for contype, _ in constraints.values()) == [
            "c",
            "f",
            "p",
        ], constraints
        check_def = constraints["ck_operator_touch_closes_close_source"][1]
        assert "close_source" in check_def
        # The EXACT closer vocabulary: a CHECK that silently gained a third
        # allowed value must fail here.
        assert sorted(re.findall(r"'([^']*)'::text", check_def)) == [
            "runner_observed",
            "session_closed_sweep",
        ], check_def
        assert "resolution" not in check_def
        assert "close_actor_class" not in check_def
        fk_defs = [d for contype, d in constraints.values() if contype == "f"]
        assert len(fk_defs) == 1
        assert "REFERENCES coord.operator_touches(touch_id)" in fk_defs[0]
        assert "ON DELETE CASCADE" in fk_defs[0]

        # ----------------------------------------------------------------
        # 3. Behaviour — one close per (touch, source), enforced.
        # ----------------------------------------------------------------
        touch = _insert_touch(engine, f"{_SESSION}:idle_at_prompt:1791158400")
        _close(engine, touch)
        assert _close_count(engine, touch) == 1

        with engine.connect() as conn:
            stamped = conn.execute(
                text(
                    """
                    SELECT close_id IS NOT NULL, closed_at IS NOT NULL,
                           observed_wait_ms
                      FROM coord.operator_touch_closes
                     WHERE touch_id = :touch
                    """
                ),
                {"touch": touch},
            ).one()
        assert tuple(stamped) == (True, True, 41_250)

        # A second close from the SAME source is refused by the index ...
        with pytest.raises(IntegrityError):
            _close(engine, touch, resolution="self_resolved", actor_class="none")
        # ... and ON CONFLICT (touch_id, close_source) — the arbiter coord's
        # close insert names — infers against it and absorbs the repeat.
        with engine.begin() as conn:
            absorbed = conn.execute(
                text(
                    """
                    INSERT INTO coord.operator_touch_closes
                        (touch_id, resolution, close_source, by_actor)
                    VALUES (:touch, 'abandoned', 'runner_observed', 'device:test')
                    ON CONFLICT (touch_id, close_source) DO NOTHING
                    """
                ),
                {"touch": touch},
            )
            assert absorbed.rowcount == 0
        assert _close_count(engine, touch) == 1, (
            "a repeated (touch, source) must not produce a second row"
        )

        # A DIFFERENT source is a second row — D2's fold reads both.
        _close(
            engine,
            touch,
            resolution="abandoned",
            source="session_closed_sweep",
            actor_class=None,
            wait_ms=None,
            by_actor="coord:session_closed_sweep",
        )
        assert _close_count(engine, touch) == 2

        # ----------------------------------------------------------------
        # 4. The CHECK is on close_source ONLY; by_actor is NOT NULL.
        # ----------------------------------------------------------------
        other = _insert_touch(engine, f"{_SESSION}:permission_prompt:1791158460")
        with pytest.raises(IntegrityError):
            _close(engine, other, source="agent_self_report")
        # A resolution / actor-class word outside today's vocabulary is
        # accepted: coord validates those at its write boundary, not the DB.
        _close(
            engine,
            other,
            resolution="a_future_resolution_word",
            actor_class="a_future_actor_class",
        )
        assert _close_count(engine, other) == 1
        third = _insert_touch(engine, f"{_SESSION}:idle_at_prompt:1791158520")
        with pytest.raises(IntegrityError):
            _close(engine, third, by_actor=None)
        assert _close_count(engine, third) == 0

        # ----------------------------------------------------------------
        # 5. Cascade — a close never outlives its touch.
        # ----------------------------------------------------------------
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.operator_touches WHERE touch_id = :touch"),
                {"touch": touch},
            )
        assert _close_count(engine, touch) == 0

        # ----------------------------------------------------------------
        # 6. Downgrade — the sidecar gone, the open index untouched.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _CLOSES)
        assert not index_exists(engine, _UNIQUE_INDEX), (
            f"index {_UNIQUE_INDEX} survived downgrade"
        )
        assert _indexdef(engine, _OPEN_INDEX) == original_open_indexdef, (
            f"the downgrade must leave {_OPEN_INDEX} exactly as "
            "coordtouch_01 defined it"
        )

        # And forward again — the revision is re-appliable after a downgrade.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _CLOSES)
        assert _indexdef(engine, _OPEN_INDEX) == original_open_indexdef
