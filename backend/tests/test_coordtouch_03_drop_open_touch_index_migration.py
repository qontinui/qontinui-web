"""Behaviour test for ``coordtouch_03_drop_open_touch_index``.

Plan ``2026-10-05-operator-touch-close-path`` Phase 4 (D7): once closes live in
the ``coord.operator_touch_closes`` sidecar, ``resolved_at IS NULL`` no longer
means "open", so the partial index built on it is dropped and coord's open read
becomes window-bounded on ``(tenant_id, emitted_at)`` plus an anti-join on the
sidecar. The contracts pinned here:

1. **Upgrade drops exactly the open index.** ``ix_operator_touches_tenant_open``
   is gone; the two indexes the window-bounded read depends on —
   ``ix_operator_touches_tenant_emitted_at`` (the window) and
   ``uq_operator_touch_closes_touch_source`` (the anti-join) — survive
   byte-for-byte, as do the touch rows.
2. **Downgrade restores it with the SAME definition** ``coordtouch_01`` gave
   it, so a downgraded database serves the pre-Phase-4 read path unchanged.
3. **Re-appliable** — upgrade after downgrade drops it again.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
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
    index_exists,
    run_alembic,
)

_REVISION_ID = "coordtouch_03_drop_open_touch_index"
_REVISION_FILENAME = "coordtouch_03_drop_open_touch_index.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent: ``alembic-graph-pr.yml`` serialises alembic PRs,
    so a revision landing ahead of this one re-points ``down_revision``, and a
    pinned constant would upgrade to a revision that is no longer the parent.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_OPEN_INDEX = "ix_operator_touches_tenant_open"
# The two indexes D7's window-bounded open read uses, which must survive.
_WINDOW_INDEX = "ix_operator_touches_tenant_emitted_at"
_ANTI_JOIN_INDEX = "uq_operator_touch_closes_touch_source"

_TENANT = uuid.UUID("3f9a1c7e-5d24-4b8e-a6f0-91c2d7e4b583")
_SESSION = uuid.UUID("b74e2d19-0c6a-4f35-8e91-d2a5c3f07e6b")


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


def _touch_count(engine: Engine, touch: uuid.UUID) -> int:
    """Rows for ONE touch the test created — never a table-wide count."""
    with engine.connect() as conn:
        count = conn.execute(
            text("SELECT COUNT(*) FROM coord.operator_touches WHERE touch_id = :t"),
            {"t": touch},
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
def test_coordtouch_03_drops_the_open_index_and_downgrade_restores_it() -> None:
    """Upgrade drops only the open index; downgrade recreates it identically."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coordtouch03_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the open index stands, as coordtouch_01 built it.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        original_open = _indexdef(engine, _OPEN_INDEX)
        assert original_open is not None, (
            f"{_OPEN_INDEX} must exist at the parent revision"
        )
        assert original_open.endswith(
            "USING btree (tenant_id, emitted_at DESC) WHERE (resolved_at IS NULL)"
        ), original_open
        original_window = _indexdef(engine, _WINDOW_INDEX)
        original_anti_join = _indexdef(engine, _ANTI_JOIN_INDEX)
        assert original_window is not None, f"{_WINDOW_INDEX} must exist at the parent"
        assert original_anti_join is not None, (
            f"{_ANTI_JOIN_INDEX} must exist at the parent"
        )

        with engine.begin() as conn:
            touch = conn.execute(
                text(
                    """
                    INSERT INTO coord.operator_touches
                        (tenant_id, session_id, kind, source, idempotency_key)
                    VALUES (:tid, :sid, 'idle_at_prompt', 'runner_hook', :key)
                    RETURNING touch_id
                    """
                ),
                {
                    "tid": _TENANT,
                    "sid": _SESSION,
                    "key": f"{_SESSION}:idle_at_prompt:1",
                },
            ).scalar_one()
        assert isinstance(touch, uuid.UUID)

        # 2. Apply — the open index is gone; nothing else moved.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not index_exists(engine, _OPEN_INDEX), (
            f"{_OPEN_INDEX} survived the upgrade"
        )
        assert _indexdef(engine, _WINDOW_INDEX) == original_window, (
            f"{_WINDOW_INDEX} bounds D7's open read and must survive unchanged"
        )
        assert _indexdef(engine, _ANTI_JOIN_INDEX) == original_anti_join, (
            f"{_ANTI_JOIN_INDEX} serves D7's anti-join and must survive unchanged"
        )
        assert _touch_count(engine, touch) == 1, "the drop must not touch a row"

        # 3. Downgrade — recreated with coordtouch_01's exact definition.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _indexdef(engine, _OPEN_INDEX) == original_open, (
            f"the downgrade must recreate {_OPEN_INDEX} exactly as coordtouch_01 defined it"
        )
        assert _indexdef(engine, _WINDOW_INDEX) == original_window
        assert _indexdef(engine, _ANTI_JOIN_INDEX) == original_anti_join

        # 4. Forward again — re-appliable after a downgrade.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not index_exists(engine, _OPEN_INDEX)
        assert _touch_count(engine, touch) == 1
