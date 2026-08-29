"""Behaviour test for the ``coordtouch_01`` operator-touch store.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contracts worth pinning here are the ones a reviewer cannot
read off the DDL, and every one of them is a way the resulting metric could be
quietly wrong:

1. **Shape** — both tables and all six indexes exist after upgrade, and are
   gone after downgrade. The cheap half, and the only half a schema diff covers.
2. **The unique idempotency key actually dedupes.** The plan names
   double-counting as its primary risk: the runner and the agent can both
   observe one touch. A UNIQUE index that was created but not enforced (a
   non-unique index with a hopeful name, say) would let the stop-short rate
   inflate silently. This is the contract Phase 2's emitter relies on.
3. **A bare emit gets honest defaults** — ``unclassified`` / ``unknown``, with
   no resolution invented for a touch that is still open.
4. **The classification sidecar records a move, and cascades.** The audit of an
   enrichment must not outlive the touch it audits.

There is deliberately **no backfill test, because there is no backfill**. An
earlier form of this revision reconstructed rows from ``coord.agent_questions``
and the operator-cleared subset of ``coord.gates``, and this file asserted the
row set it produced. Phase 0 then measured that history against production and
found ~**1** real operator touch in all of it, against ≥1,309 machine-generated
rows the backfill would have imported to reach it — so the backfill was cut and
its tests with it. Do not "restore" either: the reasoning, the numbers, and the
touch/no-touch split the gates half encoded all live on in the revision's module
docstring.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "coordtouch_01"
_REVISION_FILENAME = "coordtouch_01_operator_touches.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent. ``alembic-heads-pr`` serialises alembic PRs by
    construction, so any revision that lands ahead of this one re-forks the
    chain and ``down_revision`` is re-pointed at the new head — which already
    happened once here (``ffland_headsync_01`` → ``pdann_01``). A pinned
    constant does not merely rot: it makes this test upgrade to a revision that
    is no longer this one's parent, so the "clean database" it then asserts
    against is the wrong one.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(r'^down_revision:.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, f"{_REVISION_FILENAME} must declare a down_revision"
    return match.group(1)


_PARENT_REVISION_ID = _parent_revision_id()

_TOUCHES = "operator_touches"
_CLASSIFICATIONS = "operator_touch_classifications"

_TOUCH_INDEXES = (
    "uq_operator_touches_idempotency_key",
    "ix_operator_touches_tenant_emitted_at",
    "ix_operator_touches_tenant_reason_emitted_at",
    "ix_operator_touches_tenant_session",
    "ix_operator_touches_tenant_open",
)
_CLASSIFICATION_INDEXES = ("ix_operator_touch_classifications_touch",)

_TENANT = uuid.UUID("2f2b1f6a-6d4e-4a2f-9a05-6c9a7c3d1e88")
_SESSION = uuid.UUID("9d6f2a11-8c7e-4c3b-9f52-1a4e8b7c0d63")


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coordtouch_01_creates_the_store_and_enforces_the_dedup_key() -> None:
    """Shape, honest defaults, the enforced dedup key, and the audit cascade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coordtouch01_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision — the store does not exist yet.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TOUCHES), (
            "the store must be created by this revision, not an earlier one"
        )
        assert not table_exists(engine, "coord", _CLASSIFICATIONS)

        # ----------------------------------------------------------------
        # 2. Apply — both tables and every index exist.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TOUCHES)
        assert table_exists(engine, "coord", _CLASSIFICATIONS)
        for name in (*_TOUCH_INDEXES, *_CLASSIFICATION_INDEXES):
            assert index_exists(engine, name), f"missing index {name}"

        # ----------------------------------------------------------------
        # 3. The unique key is ENFORCED, not merely declared.
        # ----------------------------------------------------------------
        insert_touch = text(
            """
            INSERT INTO coord.operator_touches
                (tenant_id, kind, source, idempotency_key)
            VALUES (:tid, 'permission_prompt', 'runner_hook', :key)
            """
        )
        duplicate_key = f"{_SESSION}:permission_prompt:1754006400"
        with engine.begin() as conn:
            conn.execute(insert_touch, {"tid": _TENANT, "key": duplicate_key})
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(insert_touch, {"tid": _TENANT, "key": duplicate_key})
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        """
                        SELECT COUNT(*) FROM coord.operator_touches
                         WHERE idempotency_key = :key
                        """
                    ),
                    {"key": duplicate_key},
                ).scalar_one()
                == 1
            ), "the second insert must not produce a second row"

        # The defaults are what make a bare emit honest: unclassified, unknown.
        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    """
                    SELECT reason_code, policy_authorized, resolved_at, resolution
                      FROM coord.operator_touches
                     WHERE idempotency_key = :key
                    """
                ),
                {"key": duplicate_key},
            ).one()
        assert defaults == ("unclassified", "unknown", None, None)

        # ----------------------------------------------------------------
        # 4. The classification sidecar records a move, and cascades.
        # ----------------------------------------------------------------
        with engine.connect() as conn:
            target = conn.execute(
                text(
                    """
                    SELECT touch_id FROM coord.operator_touches
                     WHERE idempotency_key = :key
                    """
                ),
                {"key": duplicate_key},
            ).scalar_one()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.operator_touch_classifications
                        (touch_id, from_reason_code, to_reason_code,
                         from_policy_authorized, to_policy_authorized, by_actor)
                    VALUES (:tid, 'unclassified', 'missing_permission_grant',
                            'unknown', 'no', 'phase3')
                    """
                ),
                {"tid": target},
            )
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        """
                        SELECT COUNT(*) FROM coord.operator_touch_classifications
                         WHERE touch_id = :tid
                        """
                    ),
                    {"tid": target},
                ).scalar_one()
                == 1
            )
        # Deleting the parent takes the audit row with it — the sidecar is an
        # audit OF a touch, so it must not outlive one.
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.operator_touches WHERE touch_id = :tid"),
                {"tid": target},
            )
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT COUNT(*) FROM coord.operator_touch_classifications")
                ).scalar_one()
                == 0
            )

        # ----------------------------------------------------------------
        # 5. Downgrade — both tables and every index gone.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TOUCHES)
        assert not table_exists(engine, "coord", _CLASSIFICATIONS)
        for name in (*_TOUCH_INDEXES, *_CLASSIFICATION_INDEXES):
            assert not index_exists(engine, name), f"index {name} survived downgrade"
