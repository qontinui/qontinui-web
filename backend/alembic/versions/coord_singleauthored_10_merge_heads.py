"""merge heads: single-authored coord chain + cognito_01

Revision ID: coord_singleauthored_10_merge_heads
Revises: coord_singleauthored_09_merge_proposals_columns, cognito_01_add_cognito_sub
Create Date: 2026-05-30

Empty alembic merge revision — collapses the two heads that exist once the
single-authored coord chain (this PR) lands alongside the sibling
``cognito_01_add_cognito_sub`` migration. No schema change; it only rejoins
the DAG to a single head.

Head topology this resolves (all three branched off
``decision_engine_phase1_kind_nullable``):
* ``decision_engine_phase3`` → ``coord_singleauthored_01..09`` (this chain,
  re-pointed onto ``decision_engine_phase3``).
* ``cognito_01_add_cognito_sub`` (sibling; PR #329 separately re-points it onto
  ``decision_engine_phase3`` — order-independent of this merge: this node
  reconverges the DAG whether cognito sits under ``phase1`` or ``phase3``).

Result: exactly one head (this revision), satisfying the ``alembic-heads-pr``
CI gate and the autonomous-migrate single-head invariant.
"""

from collections.abc import Sequence

from alembic import op  # noqa: F401  (kept for parity with the migration template)

revision: str = "coord_singleauthored_10_merge_heads"
# NOTE: keep down_revision on ONE line — the `alembic-heads-pr` CI gate's
# offline parser is `^down_revision...=(.+)$` with re.M (no DOTALL), so a
# multi-line tuple hides the parents and the gate miscounts heads.
down_revision: str | Sequence[str] | None = ("coord_singleauthored_09_merge_proposals_columns", "cognito_01_add_cognito_sub")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
