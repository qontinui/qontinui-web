"""Add ``GATE_ACTION`` to the ``notificationtype`` PG ENUM.

T3 gate-action notifications (web #540) added ``GATE_ACTION`` to the
``NotificationType`` Python enum, but no migration ever extended the
``notificationtype`` PG ENUM — the column is ``Enum(NotificationType)``
(default behaviour: persists member NAMES), so every
``POST /api/v1/internal/coord-notifications`` died with
``InvalidTextRepresentationError: invalid input value for enum
notificationtype: "GATE_ACTION"`` (500). This is why the
``Qontinui/T3/GateActionDelivered`` metric has shown ZERO deliveries
since T3 shipped: coord's ``gate_action_notify`` swallow-logged
``web returned non-2xx ... 500`` on every attempt.

Same shape as ``uh32g7h8i9d0`` (``finding_action_type`` + ``manual``):
``ADD VALUE`` must run outside the migration transaction, hence the
``autocommit_block``.

Revision ID: gate_action_02_notificationtype_enum
Revises: 111c659fc165
Create Date: 2026-06-11

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gate_action_02_notificationtype_enum"
down_revision: str | None = "111c659fc165"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'GATE_ACTION'"
        )


def downgrade() -> None:
    # PostgreSQL has no ``DROP VALUE`` — rename-and-recreate, per the
    # ``uh32g7h8i9d0`` precedent. Rows using the value are deleted (a
    # GATE_ACTION notification is advisory and re-creatable by coord's
    # next gate action).
    op.execute(
        "DELETE FROM project.notifications WHERE type = 'GATE_ACTION'"
    )
    op.execute("ALTER TYPE notificationtype RENAME TO notificationtype_old")
    op.execute(
        "CREATE TYPE notificationtype AS ENUM ("
        "'MENTION', 'SHARE', 'COMMENT', 'REPLY', 'LOCK_RELEASED', "
        "'PROJECT_UPDATE', 'TEAM_INVITE', 'ACCESS_GRANTED', 'ACCESS_REVOKED'"
        ")"
    )
    op.execute(
        "ALTER TABLE project.notifications "
        "ALTER COLUMN type TYPE notificationtype "
        "USING type::text::notificationtype"
    )
    op.execute("DROP TYPE notificationtype_old")
