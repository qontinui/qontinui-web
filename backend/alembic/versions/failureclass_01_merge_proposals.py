"""failure-class 01 — coord.merge_proposals.failure_class terminal-failure label

Revision ID: failureclass_01_merge_proposals
Revises: dry_run_retire_01_backfill
Create Date: 2026-07-24

Adds ``failure_class TEXT`` (nullable, no default) to ``coord.merge_proposals``.

## What it stores

A failure-classification string for *terminal* merge_proposals rows — one of
``textual_conflict`` | ``infra`` | ``content`` | ``orchestrator_transient`` |
``reap_hardcap`` (coord's ``outbound_git::FailureClass`` enum is the authority;
this column merely persists the enum's serialized value). It lets the
merge-outcome metric distinguish *why* a proposal terminated without
re-deriving the reason from log markers.

## Nullable, no default, NO SQL backfill (deliberate)

The column is nullable with no server default. Historical/terminal rows stay
NULL — they are old and closed, and the consuming metric only cares about NEW
conflicts going forward. **No SQL backfill is written on purpose.** A backfill
would have to re-implement coord's Rust marker-matching classifier
(``outbound_git::FailureClass``) in SQL, which would duplicate the classifier
and drift out of sync with it over time — the exact failure-class-of-bug this
whole change exists to avoid. Forward-fill is done ONLY by coord's authoritative
Rust classifier at proposal-terminal time; NULL therefore reads as an honest
"classified by no engine build that carried the classifier yet".

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``; coord's Rust binary authors zero
``coord.*`` DDL, guarded by ``qontinui-coord/tests/coord_schema_authorship.rs``,
and asserts table/column presence at boot). The coord PR that WRITES and READS
``failure_class`` is downstream of this one, so this migration must land +
deploy before that coord binary ships. The table itself is alembic-owned
(``wave_6_01_coord_merge_batches``); this column is likewise authored here.

## Safety

A single ``ADD COLUMN`` that is nullable with no default is a metadata-only
operation on PG >= 11 (no table rewrite); the table is small regardless.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "failureclass_01_merge_proposals"
down_revision: str = "dry_run_retire_01_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merge_proposals",
        sa.Column("failure_class", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("merge_proposals", "failure_class", schema="coord")
