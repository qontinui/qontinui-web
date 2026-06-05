"""coord.restack_verifications -- one verification per signature (UNIQUE signature_id)

Revision ID: coord_restack_verif_sig_unique
Revises: twin_p6_01_worktree_reclaim_lifecycle
Create Date: 2026-06-05

Flips ``coord.restack_verifications`` from an **append-only-may-repeat** audit
overlay to a **one-verification-per-signature** posture: exactly one composed
verification row may exist per ``signature_id``.

## Why

The restack engine's failover-resume reconcile (``restack_engine.rs``,
``restack_signature::insert_verification``) relies on this. When a leader dies
mid-cascade and a promoted leader re-drives the SAME ``coord.restack_cascades``
row, the re-drive now REUSES the original signature (it no longer emits a second
signature) and composes ONE verification against the original's declared edges,
folding the union of its own fan-out observations with what already landed in
``coord.restack_log`` before the crash. To make that re-drive idempotent against
a verification the original drive may have already written, ``insert_verification``
issues ``INSERT ... ON CONFLICT (signature_id) DO NOTHING`` — whichever drive's
verification lands first wins, the other is a silent no-op. ``ON CONFLICT
(signature_id)`` REQUIRES a UNIQUE index on ``(signature_id)``; this migration
creates it. (The ``#[cfg(test)]`` DDL mirror
``create_restack_signature_tables_for_test`` creates the same UNIQUE index so
DB-gated tests exercise the real constraint.)

The original ``restack_01_coord_restack_signatures`` migration created a
NON-unique index ``idx_restack_verifications_signature`` (the
append-only-may-repeat posture). We drop it and replace it with a UNIQUE one.

## Dedup before the unique index

Production already carries duplicate ``(signature_id)`` rows from PAST orphan
re-drives (each re-drive emitted its own second signature + verification under
the old behavior, but a handful of legacy rows re-verified the SAME signature).
``CREATE UNIQUE INDEX`` would fail on those duplicates, so the upgrade first
de-duplicates: for each ``signature_id`` it keeps the EARLIEST ``created_at``
row (ties broken by ``id`` for determinism) and deletes the rest. This is a
lossy, NON-reversible step — see ``downgrade``.

No ``now()`` or other non-IMMUTABLE function appears in any index predicate (the
unique index is a bare column index, no ``WHERE``), so it is valid under
Postgres' IMMUTABLE-predicate rule.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_restack_verif_sig_unique"
down_revision: str | Sequence[str] | None = "twin_p6_01_worktree_reclaim_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """De-dup existing rows, drop the non-unique index, create the UNIQUE one."""

    # -----------------------------------------------------------------
    # (1) De-duplicate existing (signature_id) rows: keep the EARLIEST
    #     created_at per signature_id (id breaks created_at ties), delete the
    #     rest. Prod has duplicates from past orphan re-drives, and
    #     CREATE UNIQUE INDEX fails if any remain. LOSSY + non-reversible.
    # -----------------------------------------------------------------
    op.execute(
        """
        DELETE FROM coord.restack_verifications v
        USING (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY signature_id
                       ORDER BY created_at ASC, id ASC
                   ) AS rn
            FROM coord.restack_verifications
        ) ranked
        WHERE v.id = ranked.id
          AND ranked.rn > 1
        """
    )

    # -----------------------------------------------------------------
    # (2) Replace the append-only non-unique index with a UNIQUE one. The
    #     creator name is `idx_restack_verifications_signature` (see
    #     restack_01_coord_restack_signatures.py). The UNIQUE index doubles as
    #     the lookup index, so we do not recreate a separate non-unique one.
    # -----------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS coord.idx_restack_verifications_signature")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_restack_verifications_signature
            ON coord.restack_verifications (signature_id)
        """
    )


def downgrade() -> None:
    """Restore the non-unique index. Deleted duplicate rows are NOT restored.

    The upgrade's de-dup (step 1) is irreversible — the deleted duplicate
    verification rows are gone for good (mirrors how
    ``coord_conflict_resolutions_auto_rewrite_method`` documents its
    non-reversible narrowing). Downgrades are not run in production. We only
    revert the index posture back to the append-only-may-repeat non-unique
    shape.
    """
    op.execute("DROP INDEX IF EXISTS coord.uq_restack_verifications_signature")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_verifications_signature
            ON coord.restack_verifications (signature_id)
        """
    )
