"""Data-semantics test for the ``coordnotif_03_rename_irreversible_kind`` revision.

The revision rewrites ``coord.notifications.kind`` from
``agent_took_irreversible_action`` to ``agent_took_sensitive_action``. Its
contract is data only:

1. Every old-kind row is renamed, including more rows than one batch, so the
   cursor loop must go round more than once. ``summary``, ``detail`` and read
   marks are untouched.
2. No other kind moves — in particular ``agent_took_sensitive_gate_action``,
   the separate gate kind whose name shares the prefix.
3. A re-run is a no-op, and a re-run after a still-old coord wrote one more
   old-kind row renames that row.
4. Downgrade renames back — including a row a new coord wrote natively under
   the new name, which the docstring states — and the re-upgrade renames again.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it
at a non-default host:port).
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
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "coordnotif_03_rename_irreversible_kind"
_PARENT_REVISION_ID = "coordnotif_02_prune_non_agent_kinds"

_OLD = "agent_took_irreversible_action"
_NEW = "agent_took_sensitive_action"
_GATE = "agent_took_sensitive_gate_action"

# Re-stated rather than imported: more old-kind rows than one batch.
_BATCH_ROWS = 5_000
_BULK_OLD = _BATCH_ROWS + 700


def _kinds(engine: Engine) -> dict[str, int]:
    with engine.connect() as conn:
        return {
            str(kind): int(count)
            for kind, count in conn.execute(
                text("SELECT kind, count(*) FROM coord.notifications GROUP BY kind")
            )
        }


def _row(engine: Engine, notification_id: uuid.UUID) -> tuple[str, str, str]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT kind, summary, detail->>'action'
                  FROM coord.notifications WHERE notification_id = :n
                """
            ),
            {"n": notification_id},
        ).one()
    return str(row[0]), str(row[1]), str(row[2])


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)
def test_coordnotif_03_renames_only_the_irreversible_kind() -> None:
    root = backend_root()
    tenant = uuid.uuid4()

    with ephemeral_database(admin_database_url(), "coordnotif_03_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        with engine.begin() as conn:
            marked = conn.execute(
                text(
                    """
                    INSERT INTO coord.notifications (tenant_id, kind, summary, detail, actor)
                    VALUES (:t, :kind, 'an agent force-pushed main',
                            '{"action": "force_push"}'::jsonb, 'agent:x')
                    RETURNING notification_id
                    """
                ),
                {"t": tenant, "kind": _OLD},
            ).scalar_one()
            conn.execute(
                text(
                    """
                    INSERT INTO coord.notification_reads (notification_id, actor_key)
                    VALUES (:n, 'operator:reader')
                    """
                ),
                {"n": marked},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.notifications (tenant_id, kind, summary)
                    SELECT :t, :kind, 'bulk' FROM generate_series(1, :n)
                    """
                ),
                {"t": tenant, "kind": _OLD, "n": _BULK_OLD},
            )
            for kind in (_GATE, "policy_document_changed"):
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.notifications (tenant_id, kind, summary)
                        VALUES (:t, :kind, 'other')
                        """
                    ),
                    {"t": tenant, "kind": kind},
                )

        # Apply: every old-kind row renamed, nothing else moved.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        renamed = {_NEW: _BULK_OLD + 1, _GATE: 1, "policy_document_changed": 1}
        assert _kinds(engine) == renamed
        assert _row(engine, marked) == (
            _NEW,
            "an agent force-pushed main",
            "force_push",
        )
        with engine.connect() as conn:
            reads = conn.execute(
                text(
                    "SELECT count(*) FROM coord.notification_reads WHERE notification_id = :n"
                ),
                {"n": marked},
            ).scalar_one()
        assert reads == 1, "the read mark must survive the rename"

        # Re-run: a no-op.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _kinds(engine) == renamed

        # A still-old coord wrote one more old-kind row: a re-run renames it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.notifications (tenant_id, kind, summary)
                    VALUES (:t, :kind, 'late')
                    """
                ),
                {"t": tenant, "kind": _OLD},
            )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        renamed[_NEW] += 1
        assert _kinds(engine) == renamed

        # A new coord writes the new kind natively; downgrade renames it back too.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.notifications (tenant_id, kind, summary)
                    VALUES (:t, :kind, 'native')
                    """
                ),
                {"t": tenant, "kind": _NEW},
            )
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _kinds(engine) == {
            _OLD: renamed[_NEW] + 1,
            _GATE: 1,
            "policy_document_changed": 1,
        }
        assert _row(engine, marked)[0] == _OLD

        # Re-upgrade renames again.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _kinds(engine) == {
            _NEW: renamed[_NEW] + 1,
            _GATE: 1,
            "policy_document_changed": 1,
        }
