"""project notification prefs: drop the dead GATE_ACTION columns and test table.

Phase 4 of plan
``qontinui-dev-notes/plans/2026-09-18-delete-dead-project-notifications-producers.md``.

Drops the three schema objects the Phase 1-3 change stopped mapping:

* ``project.notification_preferences.email_gate_action``
* ``project.notification_preferences.in_app_gate_action``
  (both added by ``gate_action_prefs_01_notification_preferences``)
* ``project.test_notification_preferences``
  (created by ``05a366f58455_initial_schema_squashed``, moved into the
  ``project`` schema by ``consolidation_phase7_08_move_per_user_runtime_tables``)

Why this is a SEPARATE revision from the code that stopped reading them
==========================================================================

``migrate.yml`` and ``deploy-web.yml`` fire on the same push with no ordering
between them, so a revision must be safe against BOTH the image it ships with
and the image serving before it ("gone means DEPLOYED, not merged" —
``knowledge-base/qontinui-specific/database-migrations.md``).

``notif_gate_action_03_drop_enum_value`` shipped with the image that removed
the ORM mappings, and deliberately dropped nothing else: under the image
serving *before* it, ``NotificationPreferences`` still mapped both columns and
``Project`` still mapped the ``test_notification_preferences`` relationship, so
dropping them then would have broken every preference load and every project
delete mid-deploy.

This revision runs once that image is the one SERVING, so no live image maps
either object and the drop is unobservable.

The lock this takes reaches ``project.projects``, so the wait is bounded
==========================================================================

``DROP TABLE project.test_notification_preferences`` does not only lock the
table being dropped. Its foreign key is enforced by triggers on the REFERENCED
table, so removing the constraint takes ``ACCESS EXCLUSIVE`` on
``project.projects`` — the product's hottest table — which the drop's own
spelling does not reveal. Measured on a clone: after the ``DROP TABLE``,
``pg_locks`` shows ``projects | AccessExclusiveLock`` held by the migration's
backend.

So both ``upgrade()`` and ``downgrade()`` bound the wait with
``SET LOCAL lock_timeout = '3s'``, the convention
``coord_agent_questions_audience`` states and ``agent_questions_alert_episode_01``
(an ancestor of this revision) follows: a QUEUED ``ACCESS EXCLUSIVE`` request
blocks every reader and writer arriving behind it, so failing fast is strictly
better than stalling behind one long-lived transaction.

``RESET lock_timeout`` at the end of each is REQUIRED, not decorative:
``env.py`` calls ``context.begin_transaction()`` ONCE around
``run_migrations()`` and does not set ``transaction_per_migration``, so every
revision in one ``alembic upgrade`` run shares a single transaction and an
unreset ``SET LOCAL`` would leak this timeout into every migration that lands
after it.

Downgrade
==========================================================================

The downgrade restores the SHAPE, not the data:

* both columns come back ``NOT NULL DEFAULT true``, exactly as
  ``gate_action_prefs_01``'s ``upgrade()`` created them — existing rows pick up
  the default, which is the original default-ON behaviour;
* ``project.test_notification_preferences`` comes back EMPTY, with its
  primary key, its UNIQUE ``project_id`` index and its ``ON DELETE CASCADE``
  foreign key to ``project.projects``. Column list, types, nullability and
  per-column comments are those of the ``create_table`` in
  ``05a366f58455_initial_schema_squashed``.

Every constraint and index name here is the one PostgreSQL already assigned
(``test_notification_preferences_pkey``,
``ix_test_notification_preferences_project_id``,
``test_notification_preferences_project_id_fkey``): this metadata declares no
naming convention, so the defaults reproduce them.

Revision ID: notif_gate_action_04_drop_dead_prefs
Revises: plan_library_07_plan_difficulty
Create Date: 2026-09-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "notif_gate_action_04_drop_dead_prefs"
down_revision: str | Sequence[str] | None = "plan_library_07_plan_difficulty"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.drop_column("notification_preferences", "email_gate_action", schema="project")
    op.drop_column("notification_preferences", "in_app_gate_action", schema="project")
    op.drop_index(
        op.f("ix_test_notification_preferences_project_id"),
        table_name="test_notification_preferences",
        schema="project",
    )
    op.drop_table("test_notification_preferences", schema="project")
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.create_table(
        "test_notification_preferences",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column(
            "notify_test_run_completed",
            sa.Boolean(),
            nullable=False,
            comment="Send notification when test run completes successfully",
        ),
        sa.Column(
            "notify_test_run_failed",
            sa.Boolean(),
            nullable=False,
            comment="Send notification when test run fails or times out",
        ),
        sa.Column(
            "notify_critical_deficiency",
            sa.Boolean(),
            nullable=False,
            comment="Send immediate notification for critical deficiencies",
        ),
        sa.Column(
            "notify_high_deficiency",
            sa.Boolean(),
            nullable=False,
            comment="Send immediate notification for high severity deficiencies",
        ),
        sa.Column(
            "notify_medium_deficiency",
            sa.Boolean(),
            nullable=False,
            comment="Send notification for medium severity deficiencies",
        ),
        sa.Column(
            "notify_low_deficiency",
            sa.Boolean(),
            nullable=False,
            comment="Send notification for low severity deficiencies",
        ),
        sa.Column(
            "notify_coverage_drop",
            sa.Boolean(),
            nullable=False,
            comment="Alert when coverage drops below threshold",
        ),
        sa.Column(
            "coverage_drop_threshold",
            sa.Numeric(precision=5, scale=2),
            nullable=False,
            comment="Coverage percentage threshold (0-100)",
        ),
        sa.Column(
            "websocket_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="WebSocket notification configuration",
        ),
        sa.Column(
            "email_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="Email notification configuration",
        ),
        sa.Column(
            "slack_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="Slack webhook configuration",
        ),
        sa.Column(
            "webhook_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="Generic webhook configuration",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.projects.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        op.f("ix_test_notification_preferences_project_id"),
        "test_notification_preferences",
        ["project_id"],
        unique=True,
        schema="project",
    )
    op.add_column(
        "notification_preferences",
        sa.Column(
            "in_app_gate_action",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="project",
    )
    op.add_column(
        "notification_preferences",
        sa.Column(
            "email_gate_action",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="project",
    )
    op.execute("RESET lock_timeout")
