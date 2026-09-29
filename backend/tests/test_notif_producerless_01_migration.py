"""Behaviour test for ``notif_producerless_01_drop_enum_values``.

The revision deletes every notification carrying one of the five
producer-less labels (``LOCK_RELEASED``, ``PROJECT_UPDATE``, ``TEAM_INVITE``,
``ACCESS_GRANTED``, ``ACCESS_REVOKED``), removes those labels from the
``notificationtype`` PG ENUM by rename-and-recreate, and gives the three dead
preference columns a ``DEFAULT true`` so the Phase 3 image, which no longer
maps them, can still INSERT a preferences row. It deliberately drops NO
column: every image up to and including this change still maps them.

What is asserted
================

1. At the parent revision all five labels exist.
2. After upgrade: the five labels are gone, the dead-label row is deleted, the
   ``MENTION`` row SURVIVES the column re-type, the renamed-aside type is not
   left behind, and the ``type`` index still exists.
3. **Deploy-order safety:** the three preference columns are still present,
   now ``NOT NULL DEFAULT true``, and an INSERT that omits them succeeds and
   stores ``true``.
4. Downgrade to the parent restores the five labels and drops the defaults.
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
    scalar,
)

_PARENT_REVISION_ID = "sched_cond_01_scheduled_tasks_conditions"
_REVISION_ID = "notif_producerless_01_drop_enum_values"

_DEAD_LABELS = (
    "LOCK_RELEASED",
    "PROJECT_UPDATE",
    "TEAM_INVITE",
    "ACCESS_GRANTED",
    "ACCESS_REVOKED",
)
_PREF_COLUMNS = ("email_team_invites", "in_app_team_invites", "in_app_project_updates")


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


def _seed_user(engine: Engine) -> uuid.UUID:
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
                    (:id, 'notif-pl-test@example.com', 'notif-pl-test', true,
                     false, true, false, 'free', 0, 0, false, 0, now(), now())
                """
            ),
            {"id": user_id},
        )
    return user_id


def _seed_notifications(engine: Engine, user_id: uuid.UUID) -> None:
    """One TEAM_INVITE (dead label) notification and one MENTION notification."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project.notifications
                    (user_id, type, title, message, read, created_at)
                VALUES
                    (:uid, 'TEAM_INVITE', 'invited', 'invited', false, now()),
                    (:uid, 'MENTION', 'mentioned', 'mentioned', false, now())
                """
            ),
            {"uid": user_id},
        )


def _insert_prefs_omitting_dead_columns(engine: Engine, user_id: uuid.UUID) -> None:
    """The INSERT shape an image that no longer maps the three columns emits."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project.notification_preferences
                    (user_id, email_mentions, email_comments, email_shares,
                     email_replies, in_app_mentions, in_app_comments,
                     in_app_shares, in_app_replies, created_at, updated_at)
                VALUES
                    (:uid, true, true, true, true, true, true, true, true,
                     now(), now())
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
def test_notif_producerless_01_drops_rows_and_labels_and_defaults_columns() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "notif_producerless_01") as (
        engine,
        url,
    ):
        # 1. Parent revision: all five labels exist.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        labels = _enum_labels(engine)
        for label in _DEAD_LABELS:
            assert label in labels, (label, labels)
        user_id = _seed_user(engine)
        _seed_notifications(engine, user_id)

        # 2. Upgrade: rows and labels gone, the MENTION row intact.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _enum_labels(engine) == ["MENTION", "SHARE", "COMMENT", "REPLY"]
        assert not _type_exists(engine, "notificationtype_old"), (
            "the renamed-aside type must be dropped"
        )
        assert _notification_types(engine) == ["MENTION"], (
            "the TEAM_INVITE row is deleted and the MENTION row survives the "
            "column re-type"
        )
        assert index_exists(engine, "ix_notifications_type", "project"), (
            "ALTER COLUMN TYPE rebuilds the type index; it must still exist"
        )

        # 3. Deploy-order safety: columns survive, defaulted, and omittable.
        for column in _PREF_COLUMNS:
            assert column_info(
                engine, "notification_preferences", column, "project"
            ) == ("boolean", "NO", "true"), (
                f"project.notification_preferences.{column} must survive this "
                "revision with DEFAULT true — the previous image still maps it "
                "and the new image omits it on INSERT"
            )
        _insert_prefs_omitting_dead_columns(engine, user_id)
        for column in _PREF_COLUMNS:
            assert (
                scalar(
                    engine,
                    f"SELECT {column} FROM project.notification_preferences "
                    "WHERE user_id = :uid",
                    uid=user_id,
                )
                is True
            )

        # 4. Downgrade restores the labels and drops the defaults.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        labels = _enum_labels(engine)
        for label in _DEAD_LABELS:
            assert label in labels, (label, labels)
        for column in _PREF_COLUMNS:
            assert column_info(
                engine, "notification_preferences", column, "project"
            ) == ("boolean", "NO", None)

        # 5. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _enum_labels(engine) == ["MENTION", "SHARE", "COMMENT", "REPLY"]
