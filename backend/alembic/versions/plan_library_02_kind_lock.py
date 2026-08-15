"""agent.work_artifacts.kind_locked — make a kind correction survive re-scans

Revision ID: plan_library_02_kind_lock
Revises: plan_library_01_work_artifacts
Create Date: 2026-08-15

Cross-phase correctness fix for ``2026-08-10-plan-and-prompt-library-in-web``.

The bug this closes
===================

``plan_library_01_work_artifacts`` made ``kind`` part of the artifact's
IDENTITY (``uq_work_artifacts_identity`` covers ``(coalesce(organization_id,
nil), kind, slug, coalesce(source_repo, ''))``). The plan simultaneously
requires that heuristics set an INITIAL kind only — "the page and the agent
door can correct it, and a correction is never overwritten by a later scan".

Those two are incompatible without this column. A runner scan re-derives the
heuristic kind from the filename/body on every pass. If an operator corrected
an artifact's kind, the corrected row now has a DIFFERENT identity, so the
next scan misses it and INSERTS A SECOND ROW for the same document. Every
corrected artifact silently forks — which is exactly the "corpus is already
silently forked" failure the plan exists to fix.

What the column does
====================

``kind_locked`` marks a row whose ``kind`` was set deliberately (an operator
or agent write, or the explicit ``PATCH /plan-library/{id}/kind`` door) rather
than guessed by a scanner. The scan-safe upsert path
(``kind_is_heuristic=true``) resolves its target by ``(org, slug,
source_repo)`` — IGNORING ``kind`` — and then:

* ``kind_locked = true``  → updates the row and leaves ``kind`` alone;
* ``kind_locked = false`` → updates the row and lets ``kind`` move to the
  heuristic value;
* no row at all           → inserts with the heuristic kind, unlocked.

Non-heuristic (operator/agent) writes keep the phase-1 exact-identity
behaviour and additionally SET the lock — that is what makes a correction
sticky.

``DEFAULT false`` is the right backfill: every row that exists when this
migration runs was written by phase 1, which had no notion of a deliberate
kind, so none of them may claim the lock.

The supporting index
====================

``ix_work_artifacts_scan_identity`` covers the kind-less resolution key the
scan-safe path now queries on. It is deliberately NOT unique: rows that
already forked (two kinds for one document) must keep loading so the API can
report the ambiguity as a structured 409 and ``/plan-library/divergent`` can
surface it — a unique index here would instead make the migration itself fail
on any already-forked corpus.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, with explicit
constraint/index names, so upgrade → downgrade → upgrade round-trips cleanly.
Hand-authored — ``alembic revision --autogenerate`` is never run here.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_02_kind_lock"
down_revision: str = "plan_library_01_work_artifacts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The sentinel the functional identity indexes fold a NULL organization onto.
# Must stay byte-identical to plan_library_01's ``_NIL_UUID``.
_NIL_UUID = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    """Add ``kind_locked`` plus the kind-less resolution index."""
    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            ADD COLUMN IF NOT EXISTS kind_locked BOOLEAN NOT NULL DEFAULT false
        """
    )

    # The scan-safe resolution key: (org, slug, source_repo) with kind OMITTED.
    # NOT unique — see the module docstring.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_scan_identity
            ON agent.work_artifacts (
                coalesce(organization_id, '{_NIL_UUID}'::uuid),
                slug,
                coalesce(source_repo, '')
            )
        """
    )

    # Serves "which rows carry a deliberate kind" — the tie-break the
    # ambiguity resolver runs when (org, slug, source_repo) matches more than
    # one row, and the page's "corrected" badge.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_kind_locked
            ON agent.work_artifacts (kind_locked)
            WHERE kind_locked
        """
    )


def downgrade() -> None:
    """Drop the index pair and the column."""
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_kind_locked")
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_scan_identity")
    op.execute("ALTER TABLE agent.work_artifacts DROP COLUMN IF EXISTS kind_locked")
