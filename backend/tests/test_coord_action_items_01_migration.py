"""Behaviour test for ``coord_action_items_01`` (``coord.operator_action_items``).

``migration-reversal.yml`` only proves the statements execute. What this pins
is the contract coord's Phase 2 store relies on (plan
``2026-10-12-operator-action-items-pushed-to-the-phone``):

1. **Shape** — the table and its four indexes exist after upgrade and are gone
   after downgrade; ``upgrade`` again re-creates them.
2. **The CHECKs reject** a bad status, an empty title, a non-array ``links``,
   an open row carrying ``resolved_at``, and a resolved row without one.
3. **Gate dedupe is unconditional** — the same ``(tenant, dedupe_key)`` for a
   gate item is refused even after the first item was resolved.
4. **Agent dedupe holds only while open** — a second open item with the same
   key is refused, but once the first is resolved the key may be reused.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "coord_action_items_01"
_REVISION_FILENAME = "coord_action_items_01_operator_action_items.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` — never hardcode the parent."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "operator_action_items"

_INDEXES = (
    "ix_operator_action_items_tenant_status_keyset",
    "ix_operator_action_items_push_due",
    "ux_operator_action_items_source_dedupe",
    "ux_operator_action_items_agent_open_dedupe",
)

_TENANT = uuid.UUID("9d6c2f1a-4b3e-4a57-8e21-6f0b3c9d2a18")


def _insert(engine: Engine, **overrides: object) -> uuid.UUID:
    """Insert one item (defaults are a valid open agent item); return its id."""
    params: dict[str, object] = {
        "tid": _TENANT,
        "title": "Merge web#1780 and deploy",
        "body": "",
        "links": "[]",
        "source_kind": "agent",
        "dedupe_key": None,
        "status": "open",
        "resolution_note": None,
        "resolved_at_expr": None,
    }
    params.update(overrides)
    resolved_sql = "now()" if params.pop("resolved_at_expr") else "NULL"
    with engine.begin() as conn:
        item_id = conn.execute(
            text(
                f"""
                INSERT INTO coord.operator_action_items
                    (tenant_id, title, body, links, source_kind, created_by,
                     dedupe_key, status, resolution_note, resolved_at)
                VALUES (:tid, :title, :body, CAST(:links AS jsonb), :source_kind,
                        'agent:test', :dedupe_key, :status, :resolution_note,
                        {resolved_sql})
                RETURNING item_id
                """
            ),
            params,
        ).scalar_one()
    assert isinstance(item_id, uuid.UUID)
    return item_id


def _resolve(engine: Engine, item_id: uuid.UUID) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE coord.operator_action_items
                   SET status = 'done', resolved_at = now(), resolved_by = 'test'
                 WHERE item_id = :id
                """
            ),
            {"id": item_id},
        )


def _assert_rejected(engine: Engine, constraint: str, **overrides: object) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        _insert(engine, **overrides)
    assert constraint in str(excinfo.value), (
        f"expected {constraint} to reject {overrides}, got: {excinfo.value}"
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coord_action_items_01_checks_dedupe_and_reversal() -> None:
    """Shape, CHECK rejections, both dedupe indexes, and downgrade/upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coordactionitems01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)

        # 2. Apply — table and every index exist.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert index_exists(engine, name), f"missing index {name}"

        # Both COMMENT ON statements landed.
        table_comment = scalar(
            engine,
            "SELECT obj_description('coord.operator_action_items'::regclass, "
            "'pg_class')",
        )
        assert isinstance(table_comment, str)
        assert "2026-10-12-operator-action-items-pushed-to-the-phone" in table_comment
        push_comment = column_comment(engine, _TABLE, "push_state")
        assert push_comment is not None and "projection" in push_comment

        # A bare valid item takes the documented defaults.
        item = _insert(engine)
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT body, links, source_ref, status, push_state,
                           push_attempts, push_next_attempt_at IS NOT NULL,
                           push_detail, resolved_at
                      FROM coord.operator_action_items WHERE item_id = :id
                    """
                ),
                {"id": item},
            ).one()
        assert tuple(row) == ("", [], {}, "open", "pending", 0, True, {}, None)

        # 3. CHECK rejections.
        # A non-open status needs resolved_at, or the resolved_at CHECK fires
        # first and masks whether the status CHECK exists at all.
        _assert_rejected(
            engine,
            "ck_operator_action_items_status",
            status="closed",
            resolved_at_expr=True,
        )
        _assert_rejected(engine, "ck_operator_action_items_title_len", title="")
        # Upper bounds: exactly at the limit is accepted, one over is refused.
        _insert(engine, title="t" * 200, body="b" * 4000)
        _assert_rejected(engine, "ck_operator_action_items_title_len", title="t" * 201)
        _assert_rejected(engine, "ck_operator_action_items_body_len", body="b" * 4001)
        _insert(
            engine,
            status="done",
            resolved_at_expr=True,
            resolution_note="n" * 1000,
        )
        _assert_rejected(
            engine,
            "ck_operator_action_items_resolution_note_len",
            status="done",
            resolved_at_expr=True,
            resolution_note="n" * 1001,
        )
        _assert_rejected(
            engine, "ck_operator_action_items_links_array", links='{"a": 1}'
        )
        _assert_rejected(
            engine, "ck_operator_action_items_source_kind", source_kind="human"
        )
        _assert_rejected(
            engine,
            "ck_operator_action_items_resolved_at",
            status="open",
            resolved_at_expr=True,
        )
        _assert_rejected(
            engine,
            "ck_operator_action_items_resolved_at",
            status="done",
            resolved_at_expr=None,
        )
        with pytest.raises(IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        UPDATE coord.operator_action_items
                           SET push_state = 'sent' WHERE item_id = :id
                        """
                    ),
                    {"id": item},
                )
        assert "ck_operator_action_items_push_state" in str(excinfo.value)

        # 4. Gate dedupe is UNCONDITIONAL — refused even after resolve.
        gate_item = _insert(engine, source_kind="gate", dedupe_key="gate:g-1")
        _resolve(engine, gate_item)
        _assert_rejected(
            engine,
            "ux_operator_action_items_source_dedupe",
            source_kind="gate",
            dedupe_key="gate:g-1",
        )
        # ...and a work_unit item shares that dedupe namespace.
        _assert_rejected(
            engine,
            "ux_operator_action_items_source_dedupe",
            source_kind="work_unit",
            dedupe_key="gate:g-1",
        )
        # A different tenant is a different key.
        _insert(
            engine,
            tid=uuid.uuid4(),
            source_kind="gate",
            dedupe_key="gate:g-1",
        )
        # NULL gate dedupe keys never collide.
        _insert(engine, source_kind="gate")
        _insert(engine, source_kind="gate")
        # Gate and agent dedupe are separate partial indexes: an open agent
        # item with a gate item's key does not collide with it.
        _insert(engine, source_kind="agent", dedupe_key="gate:g-1")

        # 5. Agent dedupe holds only while OPEN.
        first = _insert(engine, dedupe_key="agent:k-1")
        _assert_rejected(
            engine, "ux_operator_action_items_agent_open_dedupe", dedupe_key="agent:k-1"
        )
        _resolve(engine, first)
        _insert(engine, dedupe_key="agent:k-1")  # reuse allowed once resolved
        # Agent dedupe is tenant-isolated: another tenant's open item with the
        # same key inserts while this tenant's is still open.
        _insert(engine, tid=uuid.uuid4(), dedupe_key="agent:k-1")
        # NULL dedupe keys never collide.
        _insert(engine)

        # 6. Downgrade — the table and every index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert not index_exists(engine, name), f"index {name} survived downgrade"

        # 7. Upgrade again — re-creates cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert index_exists(engine, name), f"missing index {name} on re-upgrade"
