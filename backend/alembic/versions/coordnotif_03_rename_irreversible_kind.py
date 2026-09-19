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

* Once the plan Phase 4 coord PR is DEPLOYED, coord's kind parser accepts BOTH
  wire strings on read, mapping the old one to the new variant, and writes only
  the new one. Before that deploy, coord knows ONLY the old string, and a
  renamed row is a kind it cannot parse. So this revision must run only after
  the Phase 4 coord PR is deployed, not merely merged
  (``coord:downstream-of``). The same PR carries ``coordnotif_02``, which also
  needs coord Phases 1 and 3 deployed. The coordinator sequences both.
* A still-old coord would also keep writing the old string after the rewrite.
  Those rows wait for a re-run, which is safe at any time but needs a manual
  ``alembic stamp`` back below this revision, since ``upgrade head`` skips an
  applied revision.
* The parser alias is deleted in a follow-up once
  ``SELECT count(*) FROM coord.notifications WHERE kind =
  'agent_took_irreversible_action'`` reads 0.
* ``summary`` is pre-rendered at emit time and is left as written: it is the
  historical line the reader saw, not a function of the kind string.

Batching and idempotency
==========================================================================

Same shape as ``coordnotif_02`` / ``coord_alerts_retention_01``: the rewrite
runs inside ``autocommit_block()`` in bounded batches, each its own
transaction, walking ``notification_id`` with a high-water cursor. The cursor
advances to the highest id the batch SELECTED, not the highest id it updated,
so a row changed concurrently between the select and the update cannot end the
walk early. The batch ceiling is checked BEFORE each batch runs. A re-run is a
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

# Ceiling, checked BEFORE each batch. The cursor already guarantees
# termination, so this is a bound on work: 2,000 batches is 10 M rows, and a
# legitimately enormous table CAN trip it. Committed batches stay committed, so
# re-running (stamp back, then upgrade) resumes where this run stopped.
MAX_BATCHES: int = 2_000

# The lowest possible uuid, as text: the cursor's starting point.
_CURSOR_START: str = "00000000-0000-0000-0000-000000000000"

# One batch: select the next BATCH_ROWS ids above the cursor, rename exactly
# those, and report the highest SELECTED id (the next cursor, NULL only when the
# selection is empty) and how many rows were actually renamed.
_RENAME_BATCH_SQL = """
WITH batch AS (
    SELECT notification_id
      FROM coord.notifications
     WHERE kind = :from_kind
       AND notification_id > CAST(:after_id AS uuid)
     ORDER BY notification_id
     LIMIT :batch
),
renamed AS (
    UPDATE coord.notifications t
       SET kind = :to_kind
      FROM batch b
     WHERE t.notification_id = b.notification_id
       AND t.kind = :from_kind
    RETURNING 1
)
SELECT (SELECT notification_id::text
          FROM batch
         ORDER BY notification_id DESC
         LIMIT 1) AS high_water,
       (SELECT count(*) FROM renamed) AS renamed
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
            if batches >= MAX_BATCHES:
                raise RuntimeError(
                    f"coordnotif_03: reached the {MAX_BATCHES}-batch ceiling "
                    f"after renaming {total} row(s) (cursor at {after_id}). "
                    "Committed batches stay committed; stamp back and upgrade "
                    "again to resume."
                )

            high_water, renamed = bind.execute(
                sql,
                {
                    "from_kind": from_kind,
                    "to_kind": to_kind,
                    "after_id": after_id,
                    "batch": BATCH_ROWS,
                },
            ).one()
            if high_water is None:
                break

            after_id = str(high_water)
            total += int(renamed)
            batches += 1

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
