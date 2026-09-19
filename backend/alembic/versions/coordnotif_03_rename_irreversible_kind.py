"""coord.notifications: rename kind agent_took_irreversible_action -> agent_took_sensitive_action.

Phase 4 item 6 of plan
``qontinui-dev-notes/plans/2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work.md``.

Plan Phase 4 renames coord's ``NotificationKind::AgentTookIrreversibleAction``
to ``AgentTookSensitiveAction`` (wire ``agent_took_sensitive_action``): the
class is agent actions that are significant, permanent OR sensitive, and
"irreversible" named only one of the three. ``coord.notifications.kind`` is
TEXT with no CHECK (see ``coordnotif_01``), so the rename of stored rows is
this one ``UPDATE`` and nothing else. This revision authors no schema.

Rename safety
==========================================================================

* coord's kind parser accepts BOTH wire strings on read, mapping the old one to
  the new variant, and writes only the new one. So neither order of "coord
  deploys" and "this revision runs" leaves a row coord cannot read.
* This revision still lands AFTER the coord deploy (``coord:downstream-of``):
  a still-old coord would keep writing the old string after the rewrite, and
  those rows would wait for a re-run. Re-running is safe at any time.
* The parser alias is deleted in a follow-up once
  ``SELECT count(*) FROM coord.notifications WHERE kind =
  'agent_took_irreversible_action'`` reads 0.
* ``summary`` is pre-rendered at emit time and is left as written: it is the
  historical line the reader saw, not a function of the kind string.

Batching and idempotency
==========================================================================

Same shape as ``coordnotif_02`` / ``coord_alerts_retention_01``: the rewrite
runs inside ``autocommit_block()`` in bounded batches, each its own
transaction, walking ``notification_id`` with a high-water cursor. A re-run is a
no-op once no row carries the old string (the WHERE clause matches nothing).

Downgrade
==========================================================================

Reverses the rename. It cannot tell a row this revision renamed from one a new
coord wrote natively as ``agent_took_sensitive_action``, so it renames both.
That is the correct outcome: a downgrade means the old coord is the reader
again, and the old coord knows only the old string.

Revision ID: coordnotif_03_rename_irreversible_kind
Revises: coordnotif_02_prune_non_agent_kinds
Create Date: 2026-09-19

"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordnotif_03_rename_irreversible_kind"
down_revision: str | Sequence[str] | None = "coordnotif_02_prune_non_agent_kinds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

OLD_KIND: str = "agent_took_irreversible_action"
NEW_KIND: str = "agent_took_sensitive_action"

# Rows per transaction.
BATCH_ROWS: int = 5_000

# Defensive ceiling. The cursor guarantees termination.
MAX_BATCHES: int = 2_000

# The lowest possible uuid, as text: the cursor's starting point. A canonical
# uuid's text form is fixed-width lowercase hex, so text order is uuid order.
_CURSOR_START: str = "00000000-0000-0000-0000-000000000000"

_RENAME_BATCH_SQL = """
WITH batch AS (
    SELECT notification_id
      FROM coord.notifications
     WHERE kind = :from_kind
       AND notification_id > CAST(:after_id AS uuid)
     ORDER BY notification_id
     LIMIT :batch
)
UPDATE coord.notifications t
   SET kind = :to_kind
  FROM batch b
 WHERE t.notification_id = b.notification_id
RETURNING t.notification_id::text
"""


def _rename(from_kind: str, to_kind: str) -> None:
    """Rewrite every ``from_kind`` row to ``to_kind`` in cursor-ordered batches."""
    with op.get_context().autocommit_block():
        bind = op.get_bind()
        sql = sa.text(_RENAME_BATCH_SQL)
        total = 0
        batches = 0
        after_id = _CURSOR_START

        while True:
            ids = list(
                bind.execute(
                    sql,
                    {
                        "from_kind": from_kind,
                        "to_kind": to_kind,
                        "after_id": after_id,
                        "batch": BATCH_ROWS,
                    },
                ).scalars()
            )
            if not ids:
                break

            after_id = max(ids)
            total += len(ids)
            batches += 1

            if batches >= MAX_BATCHES:
                raise RuntimeError(
                    f"coordnotif_03: exceeded {MAX_BATCHES} batches after "
                    f"renaming {total} row(s) (cursor at {after_id}). The "
                    "primary-key cursor should make this unreachable; refusing "
                    "to spin."
                )

        logger.info(
            "coordnotif_03: renamed %d coord.notifications row(s) from kind %s "
            "to %s in %d batch(es).",
            total,
            from_kind,
            to_kind,
            batches,
        )


def upgrade() -> None:
    """Rename the stored kind to its new wire string."""
    _rename(OLD_KIND, NEW_KIND)


def downgrade() -> None:
    """Rename back, including rows a new coord wrote natively (see docstring)."""
    _rename(NEW_KIND, OLD_KIND)
