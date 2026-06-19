"""Step 5 Phase 4 — drain legacy ``merge_escalation`` alerts

coord retired the merge-specialist / escalation tier (Step 3 + Step 5 of the
merge-tier retirement). The runtime no longer produces ``coord.alerts`` rows
with ``kind='merge_escalation'``; only ~54 legacy rows remain. This one-shot
data migration deletes them.

Scope — ROW-DRAIN ONLY (no schema change):

* ``upgrade()`` deletes ``coord.alerts`` rows where ``kind='merge_escalation'``.
  The matching ``coord.merge_escalations_meta`` rows auto-empty via the
  ``alert_id`` FK's ``ON DELETE CASCADE`` (see
  ``pr_merge_05_merge_escalations_meta``).

* The ``coord.merge_escalations_meta`` TABLE is intentionally left in place:
  coord's still-deployed ``sweep_resolve_stale_merge_escalations`` LEFT JOINs
  it until a later step deletes that sweep. Dropping the table here would break
  that sweep.

* ``coord.merge_decisions`` is LIVE (the engine writes ``decided_by='system'``
  rows) and is NOT touched.

* ``coord.alerts`` is the shared fleet-health sink — only the
  ``merge_escalation``-kind rows are deleted; the table schema is unchanged.

Irreversible (a one-time data drain): the deleted alert rows are not
reconstructable, so ``downgrade`` is a deliberate no-op (mirrors the
``commitlockfix_01_strip_lock_branches`` precedent) and does not block
downgrading the chain past this revision.

Revision ID: step5drain_01_merge_escalations
Revises: machine_display_names_01
Create Date: 2026-06-20 00:00:00.000000

"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "step5drain_01_merge_escalations"
down_revision: str | None = "coord_workunits_04_work_unit_pr_citations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    # Drain legacy merge-escalation alerts. The matching
    # coord.merge_escalations_meta rows cascade-delete via the alert_id FK
    # (ON DELETE CASCADE); the meta TABLE itself stays for the still-deployed
    # sweep_resolve_stale_merge_escalations LEFT JOIN.
    deleted = (
        op.get_bind()
        .execute(
            sa.text("DELETE FROM coord.alerts WHERE kind = 'merge_escalation'")
        )
        .rowcount
    )
    logger.info(
        "step5drain: deleted %d legacy 'merge_escalation' coord.alerts row(s)",
        deleted,
    )


def downgrade() -> None:
    # One-time, irreversible data drain: the deleted 'merge_escalation' alert
    # rows are not reconstructable. Intentional no-op so downgrading the chain
    # past this revision is not blocked.
    pass
