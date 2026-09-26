"""coord policy_clauses.body — verbatim label-less clause block

Revision ID: coord_policy_clauses_02
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Phase 2 schema prerequisite of the policy-clause-schema-body-column plan.

What this migration does
=========================

Adds ``coord.policy_clauses.body TEXT`` (nullable). ``coord.policy_clauses``
(created in ``coord_policy_clauses_01.py``) only models "labelled" clauses —
category/status/tier/trigger/action/bounds/etc as separate columns. Every real
served policy document is prose-shaped rather than decomposed into that
label set, so this column holds a label-less clause block **verbatim**, for
byte-identical round-tripping, alongside the existing labelled columns.

Design / column-contract notes
===============================

* ``coord.policy_clauses`` is a **shared contract** with the coord Rust code
  (see ``coord_policy_clauses_01.py``) — this column name must not drift.
* Nullable, no backfill: existing rows get NULL. A row either carries the
  labelled columns (tier/trigger/action/bounds/...) or a verbatim ``body``,
  not both by construction — this migration does not enforce that as a CHECK
  (cross-cutting app-layer invariant, matching the existing app-layer-enforced
  ``category`` invariant from Phase 1).
* Per fleet policy ``production-and-cost`` ``alembic-sole-authorship``, this
  migration lands in qontinui-web ahead of the coord-side Rust reader/writer
  code for this column (a separate, parallel change in the qontinui-coord
  repo) — coord must not read/write ``body`` until this migration is live in
  production.
* Idempotency: ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS``,
  mirroring ``coord_policy_clauses_01.py`` and the neighbor coord migrations.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_policy_clauses_02"
down_revision: str | None = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add coord.policy_clauses.body — verbatim label-less clause text."""
    op.execute(
        """
        ALTER TABLE coord.policy_clauses
            ADD COLUMN IF NOT EXISTS body TEXT
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.policy_clauses.body IS
            'Verbatim label-less clause block, for byte-identical round-'
            'tripping of prose-shaped policy content that is not decomposed '
            'into the labelled columns (tier/trigger/action/bounds/...). '
            'Nullable; a row uses either the labelled columns or body, not '
            'both by construction (app-layer invariant, not a SQL CHECK).'
        """
    )


def downgrade() -> None:
    """Drop coord.policy_clauses.body."""
    op.execute("ALTER TABLE coord.policy_clauses DROP COLUMN IF EXISTS body")
