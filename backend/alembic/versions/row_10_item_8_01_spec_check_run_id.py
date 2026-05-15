"""row 10 item 8 01 coord.merge_proposals.spec_check_run_id

Revision ID: row_10_item_8_01_spec_check_run_id
Revises: row_9_phase_4_01_coord_alerts
Create Date: 2026-05-15

Row 10 Item 8 of the validation-freshness tracker
(``D:/qontinui-root/plans/2026-05-14-row-10-implementation-tracker.md``).
Adds ``coord.merge_proposals.spec_check_run_id`` — the agent's
pre-propose Spec-Check (B) run id, carried on ``POST /merge/propose``.

## v1 scope: recorded, not gated

The merge-dequeue AC-freshness gate (``qontinui-coord src/ac_gate.rs``)
short-circuits CI on a fresh green Action-Cache entry at the
*post-rebase* canonical-diff hash. Per the Item 8 contract this column
is the **future** integration point: when a proposal carries a
``spec_check_run_id`` the freshness check will additionally verify that
Spec-Check run is still green. Spec-Check itself only just landed (MSI
track PR #123); the integration is iterative, so v1 *records* the value
on the proposal row without gating on it.

## Column choice

* Nullable TEXT. Proposals filed before this migration — and proposals
  from agents that ran no pre-propose Spec-Check — carry NULL. The
  scheduler treats NULL as "no Spec-Check signal", which is exactly the
  v1 (ungated) behaviour, so no backfill is needed.
* Stored opaque (the run id's structure is Spec-Check's contract, not
  coord's). No index: v1 never queries *by* this column; it is read
  back only on the per-proposal detail join (``p.spec_check_run_id``).
* Additive, nullable, no server default — matches the "additive changes
  only after Phase 3" contract documented in
  ``coord_phase_3_01_merge_proposals``.

## Chains off ``row_9_phase_4_01_coord_alerts``

That is the current head of the coord-merge migration lineage and the
first revision in which ``coord.merge_proposals`` is guaranteed to
exist (created by ``coord_phase_3_01_merge_proposals``, threaded
through ``wave_3_merge_phase_3_and_row_9_phase_3`` →
``row_9_phase_4_01_coord_alerts``). Extending that head keeps this a
plain single-parent revision rather than introducing a new sibling.
Per [[feedback_alembic_sibling_head_merge]]: if a concurrent Wave 6 PR
also lands an alembic migration off this same head, the second to land
needs an empty merge revision joining the two — the documented
empty-bookkeeping shape used before in this branch.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "row_10_item_8_01_spec_check_run_id"
down_revision: str = "row_9_phase_4_01_coord_alerts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merge_proposals",
        sa.Column("spec_check_run_id", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("merge_proposals", "spec_check_run_id", schema="coord")
