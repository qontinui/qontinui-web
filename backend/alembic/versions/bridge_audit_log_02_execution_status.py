"""web.bridge_audit_log -- add execution_status (receipt vs execution outcome).

Revision ID: bridge_audit_log_02
Revises: agent_tool_access_01
Create Date: 2026-06-03

Bug 3b of the co-pilot prod manual-test: an audit row records command RECEIPT,
not EXECUTION. ``status_code`` is the HTTP status the *relay* returned (200 the
moment the relay accepted/delivered the command to the target tab) -- so a 200
row is NOT proof the command actually ran (the route may never have changed).

This adds ``execution_status`` to distinguish the relay-receipt fact from the
target tab's execution outcome, derived web-side from the relay response body's
``success``/``code`` (the tab reports the outcome back through the same relay
response the Next.js handler already awaits -- e.g. ``UB-ACTION-TIMEOUT`` /
``success:false`` => the command did not execute):

* ``received``  -- relay accepted/delivered the command; execution outcome
                   not (yet) known from the response body. The conservative
                   default and the pre-#3b behaviour.
* ``executed``  -- the target tab confirmed the command ran (response body
                   ``success:true``).
* ``failed``    -- the target tab reported the command did NOT execute
                   (``success:false`` / an error ``code`` / no browser
                   connected), even though the relay HTTP status may be 200.

## Expand-only / forward-compatible

Pure expand: the column is nullable with ``server_default='received'`` and a
CHECK accepting the three known values. An app rolled back to before this
migration never writes the column; existing rows backfill to ``'received'``
(the honest statement: those rows only ever recorded receipt). Safe under
``migrate.yml`` auto-apply -- not reverted by a deploy auto-rollback, and the
prior insert path (no ``execution_status``) stays valid because the column is
nullable + defaulted. No contract step needed.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bridge_audit_log_02"
down_revision: str | Sequence[str] | None = "agent_tool_access_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_EXECUTION_STATUSES = ("received", "executed", "failed")
_CHECK_NAME = "bridge_audit_log_execution_status_chk"


def upgrade() -> None:
    op.add_column(
        "bridge_audit_log",
        sa.Column(
            "execution_status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'received'"),
        ),
        schema="web",
    )
    # DROP IF EXISTS keeps this idempotent / collision-safe on re-apply.
    op.execute(
        f"ALTER TABLE web.bridge_audit_log DROP CONSTRAINT IF EXISTS {_CHECK_NAME}"
    )
    allowed = ", ".join(f"'{s}'" for s in _EXECUTION_STATUSES)
    op.execute(
        f"ALTER TABLE web.bridge_audit_log ADD CONSTRAINT {_CHECK_NAME} "
        f"CHECK (execution_status IN ({allowed}))"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE web.bridge_audit_log DROP CONSTRAINT IF EXISTS {_CHECK_NAME}"
    )
    op.drop_column("bridge_audit_log", "execution_status", schema="web")
