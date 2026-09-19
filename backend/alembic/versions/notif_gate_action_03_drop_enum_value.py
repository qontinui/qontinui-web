"""project.notifications: delete the dead ``GATE_ACTION`` rows and enum label.

Phase 2 of plan
``qontinui-dev-notes/plans/2026-09-18-delete-dead-project-notifications-producers.md``.

``GATE_ACTION`` had exactly one producer, the coord gate-action webhook
receiver, and that receiver was deleted in ``254eb398e``. This revision
deletes every ``GATE_ACTION`` notification and removes the label from the
``notificationtype`` PG ENUM (added by ``gate_action_02_notificationtype_enum``).

Deploy-order safety — why this revision drops NOTHING else
==========================================================================

``migrate.yml`` and ``deploy-web.yml`` fire on the same push with no ordering
between them, so a revision must be safe against BOTH the image it ships with
and the image serving before it:

* The previous image never writes ``GATE_ACTION`` (it has no producer) and its
  Python enum is a superset of the trimmed PG enum, so it is unaffected.
* The new image still carries ``NotificationType.GATE_ACTION``, so a stored row
  this revision has not yet deleted still loads if the image serves first.

The dead ``email_gate_action`` / ``in_app_gate_action`` columns and the
``project.test_notification_preferences`` table are deliberately NOT dropped
here: the previous image still maps them, and dropping them under it would
break every ``NotificationPreferences`` load and every project delete. The
code that reads them is removed in the same change as this revision; the drop
is the plan's follow-up phase, taken once this change's image is the one
serving (the "gone means DEPLOYED, not merged" rule in
``knowledge-base/qontinui-specific/database-migrations.md``).

Dropping an ENUM value
==========================================================================

PostgreSQL has no ``ALTER TYPE … DROP VALUE``. The label is removed by
rename-and-recreate, the exact sequence ``gate_action_02``'s own
``downgrade()`` already uses (precedent ``uh32g7h8i9d0``): delete the rows that
carry the value, rename the type aside, create the trimmed type, re-type the
one column that uses it (``project.notifications.type``, whose btree index is
rebuilt by the ``ALTER COLUMN … TYPE``), then drop the old type.

Downgrade re-adds the label with ``ADD VALUE IF NOT EXISTS`` inside an
``autocommit_block`` (``ADD VALUE`` cannot run inside the migration
transaction — same shape as ``gate_action_02``'s upgrade). Deleted rows are
not restored.

Revision ID: notif_gate_action_03_drop_enum_value
Revises: agent_questions_alert_episode_01
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "notif_gate_action_03_drop_enum_value"
down_revision: str | Sequence[str] | None = "agent_questions_alert_episode_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every label except GATE_ACTION, in the order gate_action_02 created them.
_REMAINING_LABELS = (
    "'MENTION', 'SHARE', 'COMMENT', 'REPLY', 'LOCK_RELEASED', "
    "'PROJECT_UPDATE', 'TEAM_INVITE', 'ACCESS_GRANTED', 'ACCESS_REVOKED'"
)


def upgrade() -> None:
    op.execute("DELETE FROM project.notifications WHERE type = 'GATE_ACTION'")
    op.execute("ALTER TYPE public.notificationtype RENAME TO notificationtype_old")
    op.execute(f"CREATE TYPE public.notificationtype AS ENUM ({_REMAINING_LABELS})")
    op.execute(
        "ALTER TABLE project.notifications "
        "ALTER COLUMN type TYPE public.notificationtype "
        "USING type::text::public.notificationtype"
    )
    op.execute("DROP TYPE public.notificationtype_old")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE public.notificationtype ADD VALUE IF NOT EXISTS 'GATE_ACTION'"
        )
