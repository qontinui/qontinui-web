"""coord.pr_holds — admit the hold kind ``safety_loosening``

Revision ID: coord_pr_holds_02_safety_loosening
Revises: agent_status_intent_globs_declared_01
Create Date: 2026-11-26

Step (0) of Phase 142 of plan ``2026-10-28-one-session-lifecycle-authority``
(the DDL half; the coord PR that places and releases such holds follows it).

## Why

Served policy ``coordination`` P-22 licenses any session of the owning tenant
to hold a PEER's PR whose landing would loosen a served safety condition. The
hold kind ``safety_loosening`` is the mark that a hold was placed under that
license, and it is what lets coord release it on a citation of a served
document or on its author's split (Phase 142 steps 2-3). Coord authors zero
``coord.*`` DDL (``[policy: production-and-cost/alembic-sole-authorship]``),
so the CHECK widens here, and this revision must be applied BEFORE coord
writes the new kind. Hand-authored; ``alembic revision --autogenerate`` was
not run.

## What changes

``pr_holds_kind_check`` was created by ``coord_pr_holds_01`` with five kinds
and no later revision altered it. ``upgrade()`` drops and recreates it with a
sixth, ``safety_loosening``, and refreshes the ``kind`` column comment. No
row is touched, no column is dropped.

## Downgrade

``downgrade()`` REFUSES while any ``safety_loosening`` row exists, live or
released, rather than deleting or relabelling it. Such a row records a hold
placed under P-22's license; rewriting it to another kind would change who may
release it (``security_tier`` is operator-only, ``manual`` is placer-only), and
deleting it would erase the audit trail of a release. An operator decides per
row before downgrading. With no such row it restores the five-kind CHECK and
the original column comment. The guard is a ``DO`` block, so it works in both
online and ``--sql`` modes.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "coord_pr_holds_02_safety_loosening"
down_revision = "agent_status_intent_globs_declared_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Widen pr_holds_kind_check to admit safety_loosening."""
    op.execute(
        "ALTER TABLE coord.pr_holds DROP CONSTRAINT IF EXISTS pr_holds_kind_check"
    )
    op.execute(
        "ALTER TABLE coord.pr_holds ADD CONSTRAINT pr_holds_kind_check "
        "CHECK (kind IN ('manual', 'security_tier', 'migration_order', 'create', "
        "'coord_proposal', 'safety_loosening'))"
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.kind IS
            'manual, security_tier, migration_order, create, coord_proposal or safety_loosening. One live hold per (tenant_id, repo, head_branch, kind). safety_loosening marks a hold placed under served coordination P-22 on a peer PR whose landing would loosen a served safety condition.'
        """
    )


def downgrade() -> None:
    """Refuse while safety_loosening rows exist; else restore the five kinds."""
    op.execute(
        """
        DO $$
        DECLARE
            n bigint;
        BEGIN
            SELECT count(*) INTO n
              FROM coord.pr_holds
             WHERE kind = 'safety_loosening';
            IF n > 0 THEN
                RAISE EXCEPTION
                    'cannot downgrade coord_pr_holds_02_safety_loosening: % coord.pr_holds row(s) carry kind safety_loosening; release and reclassify or delete them by hand first', n;
            END IF;
        END
        $$
        """
    )
    op.execute(
        "ALTER TABLE coord.pr_holds DROP CONSTRAINT IF EXISTS pr_holds_kind_check"
    )
    op.execute(
        "ALTER TABLE coord.pr_holds ADD CONSTRAINT pr_holds_kind_check "
        "CHECK (kind IN ('manual', 'security_tier', 'migration_order', 'create', "
        "'coord_proposal'))"
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.kind IS
            'manual, security_tier, migration_order, create or coord_proposal. One live hold per (tenant_id, repo, head_branch, kind).'
        """
    )
