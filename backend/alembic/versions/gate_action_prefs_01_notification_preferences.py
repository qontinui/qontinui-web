"""project.notification_preferences — GATE_ACTION per-type opt-out columns

Revision ID: gate_action_prefs_01_notification_preferences
Revises: coord_tasks_emergent_columns_and_index
Create Date: 2026-06-08

Closes the gap identified in T3 (gate-action-notifications): the
``NotificationPreferences`` model previously hard-coded ``True`` for
``GATE_ACTION`` in both ``should_send_in_app`` and ``should_send_email``
(a comment noted "no dedicated preference column"). A user therefore had
no way to opt out of merge-gate notifications specifically — only via the
master account-level toggles.

This migration adds two boolean columns to
``project.notification_preferences`` that mirror the naming convention of
every other per-type column already on that table
(``email_mentions``, ``in_app_comments``, etc.):

  ``in_app_gate_action``  — controls in-app delivery of GATE_ACTION
  ``email_gate_action``   — controls email delivery of GATE_ACTION

Both default **TRUE**, which preserves the current default-ON behaviour:
existing rows implicitly gain the default value via ``server_default``,
so no backfill is needed and the migration applies cleanly to both
prod and fresh DBs.

The companion model patch replaces the two hard-coded ``True`` values in
``should_send_in_app`` / ``should_send_email`` with reads of these columns.

Down-migration drops the columns; re-applying the migration would restore
the default-ON behaviour for existing rows.

Coord reserve: reservation_id=fa39d973-7f46-4921-87c9-b51731bbf62f
(down_revision coord assigned: d6e7f8a9b0c1 — reflects coord's view of
the current chain head; the actual local head is
``coord_tasks_emergent_columns_and_index``, which is what this migration
chains off. The coord-assigned value is stale by one commit; the
alembic-heads-pr CI gate is the authoritative single-head guard.)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gate_action_prefs_01_notification_preferences"
down_revision: str | Sequence[str] | None = "coord_tasks_emergent_columns_and_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_column("notification_preferences", "email_gate_action", schema="project")
    op.drop_column("notification_preferences", "in_app_gate_action", schema="project")
