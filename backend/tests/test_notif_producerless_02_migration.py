"""Behaviour test for ``notif_producerless_02_drop_dead_prefs``.

The revision drops the three producer-less preference columns
``project.notification_preferences.email_team_invites``, ``.in_app_team_invites``
and ``.in_app_project_updates``, which no image after qontinui-web#1836 maps.
Its downgrade restores the SHAPE, not the data.

What is asserted
================

1. At the parent revision all three columns exist ``NOT NULL DEFAULT true``
   (the shape ``notif_producerless_01`` left them in), and a row can store
   ``false`` in them.
2. After upgrade: all three columns are gone, the surviving row is untouched
   (a ``DROP COLUMN`` must not cost rows), and the INSERT shape the serving
   image emits still succeeds.
3. After downgrade: the columns are back ``NOT NULL DEFAULT true`` and every
   pre-existing row reads ``true`` — the seeded ``false`` is NOT restored.
4. A second upgrade re-applies cleanly after the downgrade.

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
    run_alembic,
)

_PARENT_REVISION_ID = "coord_pdclaims_02_claim_lifecycle"
_REVISION_ID = "notif_producerless_02_drop_dead_prefs"

_PREF_COLUMNS = ("email_team_invites", "in_app_team_invites", "in_app_project_updates")


def _seed_user(engine: Engine, tag: str) -> uuid.UUID:
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
                    (:id, :email, :username, true, false, true, false, 'free',
                     0, 0, false, 0, now(), now())
                """
            ),
            {
                "id": user_id,
                "email": f"notif-pl02-{tag}@example.com",
                "username": f"notif-pl02-{tag}",
            },
        )
    return user_id


def _insert_prefs_with_dead_columns_false(engine: Engine, user_id: uuid.UUID) -> None:
    """A row that stores ``false`` in all three columns — the data a drop loses."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project.notification_preferences
                    (user_id, email_mentions, email_comments, email_shares,
                     email_replies, email_team_invites, in_app_mentions,
                     in_app_comments, in_app_shares, in_app_replies,
                     in_app_team_invites, in_app_project_updates,
                     created_at, updated_at)
                VALUES
                    (:uid, true, true, true, true, false, true, true, true,
                     true, false, false, now(), now())
                """
            ),
            {"uid": user_id},
        )


def _insert_prefs_serving_shape(engine: Engine, user_id: uuid.UUID) -> None:
    """The INSERT shape the serving image (no mapping for the three) emits."""
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


def _pref_row_count(engine: Engine, user_id: uuid.UUID) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM project.notification_preferences "
                    "WHERE user_id = :uid"
                ),
                {"uid": user_id},
            ).scalar_one()
        )


def _dead_column_values(engine: Engine, user_id: uuid.UUID) -> list[tuple[bool, ...]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT email_team_invites, in_app_team_invites, "
                "in_app_project_updates FROM project.notification_preferences "
                "WHERE user_id = :uid"
            ),
            {"uid": user_id},
        ).all()
    return [tuple(r) for r in rows]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_notif_producerless_02_drops_the_three_columns() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "notif_producerless_02") as (
        engine,
        url,
    ):
        # 1. Parent revision: the three columns exist NOT NULL DEFAULT true.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for column in _PREF_COLUMNS:
            assert column_info(
                engine, "notification_preferences", column, "project"
            ) == ("boolean", "NO", "true"), (
                f"{column} must be NOT NULL DEFAULT true at {_PARENT_REVISION_ID}"
            )
        seeded = _seed_user(engine, "seeded")
        _insert_prefs_with_dead_columns_false(engine, seeded)
        assert _dead_column_values(engine, seeded) == [(False, False, False)]

        # 2. Upgrade: the columns are gone; the row is not.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for column in _PREF_COLUMNS:
            assert (
                column_info(engine, "notification_preferences", column, "project")
                is None
            ), f"project.notification_preferences.{column} must be dropped"
        assert _pref_row_count(engine, seeded) == 1, "DROP COLUMN must not cost the row"
        fresh = _seed_user(engine, "fresh")
        _insert_prefs_serving_shape(engine, fresh)
        assert _pref_row_count(engine, fresh) == 1

        # 3. Downgrade restores the shape, not the data.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for column in _PREF_COLUMNS:
            assert column_info(
                engine, "notification_preferences", column, "project"
            ) == ("boolean", "NO", "true"), (
                f"{column} must come back NOT NULL DEFAULT true"
            )
        assert _dead_column_values(engine, seeded) == [(True, True, True)], (
            "the pre-existing row must pick up DEFAULT true; the dropped "
            "false values are not restored"
        )
        assert _dead_column_values(engine, fresh) == [(True, True, True)]

        # 4. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for column in _PREF_COLUMNS:
            assert (
                column_info(engine, "notification_preferences", column, "project")
                is None
            )
