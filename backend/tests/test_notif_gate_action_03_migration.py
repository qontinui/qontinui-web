"""Behaviour test for ``notif_gate_action_03_drop_enum_value``.

The revision deletes every ``GATE_ACTION`` notification and removes the
``GATE_ACTION`` label from the ``notificationtype`` PG ENUM by
rename-and-recreate (PostgreSQL has no ``DROP VALUE``). It deliberately drops
NOTHING else: the dead preference columns and
``project.test_notification_preferences`` are still mapped by the image that
serves before this change, so dropping them here would break it mid-deploy.

What is asserted
================

1. At the parent revision the label exists.
2. After upgrade: the label is gone, the ``GATE_ACTION`` row is deleted, a row
   of every other type SURVIVES the column re-type, the renamed-aside type is
   not left behind, and the ``type`` index still exists.
3. **Deploy-order safety:** the two preference columns and the
   test-notification preferences table are still present.
4. Downgrade to the parent restores the label.
5. A second upgrade re-applies cleanly after the downgrade.

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
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_PARENT_REVISION_ID = "agent_questions_alert_episode_01"
_REVISION_ID = "notif_gate_action_03_drop_enum_value"

_PREF_COLUMNS = ("email_gate_action", "in_app_gate_action")


def _enum_labels(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT e.enumlabel
                  FROM pg_enum e
                  JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'notificationtype'
                 ORDER BY e.enumsortorder
                """
            )
        ).all()
    return [str(r[0]) for r in rows]


def _type_exists(engine: Engine, name: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text("SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = :n)"),
                {"n": name},
            ).scalar()
        )


def _notification_types(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT type::text FROM project.notifications ORDER BY type::text")
        ).all()
    return [str(r[0]) for r in rows]


def _seed_notifications(engine: Engine) -> None:
    """One user, one GATE_ACTION notification and one MENTION notification."""
    user_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO auth.users
                    (id, email, username, is_active, is_superuser, is_verified,
                     is_beta, subscription_tier, login_count,
                     remember_me_usage_count, automation_streaming_enabled,
                     automation_sessions_used, created_at, updated_at)
                VALUES
                    (:id, 'notif-test@example.com', 'notif-test', true, false,
                     true, false, 'free', 0, 0, false, 0, now(), now())
                """
            ),
            {"id": user_id},
        )
        conn.execute(
            text(
                """
                INSERT INTO project.notifications
                    (user_id, type, title, message, read, created_at)
                VALUES
                    (:uid, 'GATE_ACTION', 'gated', 'gated', false, now()),
                    (:uid, 'MENTION', 'mentioned', 'mentioned', false, now())
                """
            ),
            {"uid": user_id},
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_notif_gate_action_03_drops_rows_and_label_only() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "notif_gate_action_03") as (
        engine,
        url,
    ):
        # 1. Parent revision: the label exists.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert "GATE_ACTION" in _enum_labels(engine)
        _seed_notifications(engine)

        # 2. Upgrade: rows and label gone, every other row intact.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        labels = _enum_labels(engine)
        assert "GATE_ACTION" not in labels
        assert "MENTION" in labels and "LOCK_RELEASED" in labels, labels
        assert not _type_exists(engine, "notificationtype_old"), (
            "the renamed-aside type must be dropped"
        )
        assert _notification_types(engine) == ["MENTION"], (
            "the GATE_ACTION row is deleted and every other row survives the "
            "column re-type"
        )
        assert index_exists(engine, "ix_notifications_type", "project"), (
            "ALTER COLUMN TYPE rebuilds the type index; it must still exist"
        )

        # 3. Deploy-order safety: nothing the previous image maps is dropped.
        for column in _PREF_COLUMNS:
            assert column_info(
                engine, "notification_preferences", column, "project"
            ) == ("boolean", "NO", "true"), (
                f"project.notification_preferences.{column} must survive this "
                "revision — the previous image still maps it"
            )
        assert table_exists(engine, "project", "test_notification_preferences"), (
            "project.test_notification_preferences must survive this revision — "
            "the previous image still maps it"
        )

        # 4. Downgrade restores the label.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert "GATE_ACTION" in _enum_labels(engine)

        # 5. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert "GATE_ACTION" not in _enum_labels(engine)
