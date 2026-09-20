"""Behaviour test for ``notif_gate_action_04_drop_dead_prefs``.

The revision drops the three schema objects the Phase 1-3 change stopped
mapping: ``project.notification_preferences.email_gate_action`` and
``.in_app_gate_action``, and the table
``project.test_notification_preferences``. Its downgrade restores the SHAPE,
not the data.

What is asserted
================

1. At the parent revision all three objects exist, and rows can be stored in
   both tables.
2. After upgrade: both columns are gone, the table and its index are gone,
   and the *surviving* ``notification_preferences`` row is untouched — a
   ``DROP COLUMN`` must not cost rows.
3. After downgrade: the columns are back ``NOT NULL DEFAULT true`` and the
   pre-existing row picked the default up; the table is back EMPTY with the
   ORIGINAL constraint and index names, its per-column comments, a genuinely
   UNIQUE ``project_id`` and a working ``ON DELETE CASCADE`` to
   ``project.projects``.
4. A second upgrade re-applies cleanly after the downgrade.

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
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_PARENT_REVISION_ID = "plan_library_07_plan_difficulty"
_REVISION_ID = "notif_gate_action_04_drop_dead_prefs"

_PREF_COLUMNS = ("email_gate_action", "in_app_gate_action")
_TABLE = "test_notification_preferences"
_INDEX = "ix_test_notification_preferences_project_id"

# ``05a366f58455``'s ``create_table`` gives 12 of the table's 16 columns a
# comment. Neither the NAMES nor the BODIES are written out here: the test
# reads the whole comment map off the live table at the parent revision and
# compares the downgrade's map against it, so the oracle is the schema being
# reproduced rather than a third hand-copy of it. A mis-transcription carried
# into both the downgrade and the test would otherwise pass, and comparing
# whole maps catches a comment the downgrade ADDS as well as one it drops.
# Only the COUNT is pinned, so a comment appearing or disappearing at the
# parent revision fails here rather than silently shrinking the oracle.
# (``_alembic_harness.comment_body_from_source`` exists for the same reason but
# parses ``COMMENT ON COLUMN`` SQL, which a ``sa.Column(comment=...)`` revision
# does not emit.)
_COMMENTED_COLUMN_COUNT = 12

_INSERT_TEST_PREFS = text(
    """
    INSERT INTO project.test_notification_preferences
        (project_id, notify_test_run_completed, notify_test_run_failed,
         notify_critical_deficiency, notify_high_deficiency,
         notify_medium_deficiency, notify_low_deficiency,
         notify_coverage_drop, coverage_drop_threshold,
         websocket_config, email_config, slack_config, webhook_config,
         created_at, updated_at)
    VALUES
        (:pid, true, true, true, true, false, false, true, 80.00,
         '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now(), now())
    """
)


def _constraint_names(engine: Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('project.' || :table)
                """
            ),
            {"table": table},
        ).all()
    return {str(r[0]) for r in rows}


def _fk_delete_rule(engine: Engine, constraint: str) -> str | None:
    with engine.connect() as conn:
        return conn.execute(  # type: ignore[return-value]
            text(
                """
                SELECT confdeltype
                  FROM pg_constraint
                 WHERE conname = :name
                   AND connamespace = 'project'::regnamespace
                """
            ),
            {"name": constraint},
        ).scalar_one_or_none()


def _row_count(engine: Engine, qualified_table: str, column: str, value: object) -> int:
    """Rows in ``qualified_table`` whose ``column`` is ``value``.

    Scoped rather than a bare ``count(*)``: every population this test asserts
    on is one it seeded itself, so the discriminator is the seeded id.

    ``qualified_table`` and ``column`` are IDENTIFIERS, which no driver can
    bind, so they are interpolated — every caller passes a module constant.
    ``value`` is the one piece of data here and is bound as ``:v``.
    """
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(f"SELECT count(*) FROM {qualified_table} WHERE {column} = :v"),
                {"v": value},
            ).scalar_one()
        )


def _column_comments(engine: Engine) -> dict[str, str]:
    """Every commented column of the table, as ``{name: body}``.

    Derived from the catalog rather than from a list in this file, so the map
    is exactly what the schema carries at the moment it is read.
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT att.attname, col_description(att.attrelid, att.attnum)
                  FROM pg_attribute att
                 WHERE att.attrelid = to_regclass('project.' || :table)
                   AND att.attnum > 0
                   AND NOT att.attisdropped
                   AND col_description(att.attrelid, att.attnum) IS NOT NULL
                """
            ),
            {"table": _TABLE},
        ).all()
    return {str(r[0]): str(r[1]) for r in rows}


def _seed(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """A user with notification preferences, and a project with test prefs.

    Returns ``(user_id, project_id)``.
    """
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
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
                    (:id, 'notif04-test@example.com', 'notif04-test', true,
                     false, true, false, 'free', 0, 0, false, 0, now(), now())
                """
            ),
            {"id": user_id},
        )
        # Every other per-type column is NOT NULL with no server default, so
        # they are spelled out; the two gate-action columns are deliberately
        # left to their DEFAULT true.
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
                    (:uid, true, true, true, true, true, true, true, true,
                     true, true, true, now(), now())
                """
            ),
            {"uid": user_id},
        )
        conn.execute(
            text(
                """
                INSERT INTO project.projects
                    (id, name, configuration, version, is_public, owner_id)
                VALUES (:pid, 'notif04-test', '{}'::json, 1, false, :uid)
                """
            ),
            {"pid": project_id, "uid": user_id},
        )
        conn.execute(_INSERT_TEST_PREFS, {"pid": project_id})
    return user_id, project_id


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_notif_gate_action_04_drops_columns_and_table() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "notif_gate_action_04") as (
        engine,
        url,
    ):
        # 1. Parent revision: all three objects exist and accept rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for column in _PREF_COLUMNS:
            assert column_info(
                engine, "notification_preferences", column, "project"
            ) == ("boolean", "NO", "true")
        assert table_exists(engine, "project", _TABLE)
        # The oracle for step 3, read off the table the downgrade must
        # reproduce rather than typed out a third time.
        comments_before = _column_comments(engine)
        assert len(comments_before) == _COMMENTED_COLUMN_COUNT, (
            f"expected {_COMMENTED_COLUMN_COUNT} commented columns at "
            f"{_PARENT_REVISION_ID}, found {sorted(comments_before)}"
        )
        user_id, project_id = _seed(engine)
        assert _row_count(engine, f"project.{_TABLE}", "project_id", project_id) == 1

        # 2. Upgrade: the three objects are gone; the surviving preferences
        #    row is NOT.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for column in _PREF_COLUMNS:
            assert (
                column_info(engine, "notification_preferences", column, "project")
                is None
            ), f"project.notification_preferences.{column} must be dropped"
        assert not table_exists(engine, "project", _TABLE)
        assert not index_exists(engine, _INDEX, "project")
        assert (
            _row_count(engine, "project.notification_preferences", "user_id", user_id)
            == 1
        ), "DROP COLUMN must not cost the row"
        assert _row_count(engine, "project.projects", "id", project_id) == 1, (
            "dropping the dependent table must not touch project.projects"
        )

        # 3. Downgrade restores the shape, not the data.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for column in _PREF_COLUMNS:
            assert column_info(
                engine, "notification_preferences", column, "project"
            ) == ("boolean", "NO", "true"), (
                f"{column} must come back NOT NULL DEFAULT true"
            )
        with engine.connect() as conn:
            restored = conn.execute(
                text(
                    "SELECT email_gate_action, in_app_gate_action "
                    "FROM project.notification_preferences "
                    "WHERE user_id = :uid"
                ),
                {"uid": user_id},
            ).all()
        assert restored == [(True, True)], (
            "the pre-existing row must pick up the restored DEFAULT true"
        )

        assert table_exists(engine, "project", _TABLE)
        assert _row_count(engine, f"project.{_TABLE}", "project_id", project_id) == 0, (
            "the table is recreated EMPTY — the downgrade restores shape, not data"
        )
        assert index_exists(engine, _INDEX, "project")
        names = _constraint_names(engine, _TABLE)
        assert {
            "test_notification_preferences_pkey",
            "test_notification_preferences_project_id_fkey",
        } <= names, names
        assert (
            _fk_delete_rule(engine, "test_notification_preferences_project_id_fkey")
            == "c"
        ), "the foreign key must be ON DELETE CASCADE"
        assert _column_comments(engine) == comments_before, (
            "the recreated table's column comments must match the original "
            "map exactly — neither dropped nor added"
        )

        # The index must be genuinely UNIQUE, and the cascade must fire.
        with engine.begin() as conn:
            conn.execute(_INSERT_TEST_PREFS, {"pid": project_id})
        with pytest.raises(IntegrityError) as duplicate:
            with engine.begin() as conn:
                conn.execute(_INSERT_TEST_PREFS, {"pid": project_id})
        # Which constraint fired, not merely that SOME integrity rule did: a
        # NOT NULL or the foreign key would satisfy a bare `raises`.
        assert duplicate.value.orig.diag.constraint_name == _INDEX, (  # type: ignore[union-attr]
            "the duplicate must be refused by the UNIQUE project_id index"
        )
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM project.projects WHERE id = :pid"),
                {"pid": project_id},
            )
        assert _row_count(engine, f"project.{_TABLE}", "project_id", project_id) == 0, (
            "deleting the project must cascade to its test preferences"
        )

        # 4. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not table_exists(engine, "project", _TABLE)
        for column in _PREF_COLUMNS:
            assert (
                column_info(engine, "notification_preferences", column, "project")
                is None
            )
