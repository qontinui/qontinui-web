"""coord.findings — triage stamp (``triaged_at`` / ``triaged_by``)

Revision ID: findings_triage_01
Revises: blane_01
Create Date: 2026-09-17

Phase 0 of plan
``2026-09-17-findings-carry-a-triage-stamp-and-the-steward-reads-since-last-run``.
Adds two nullable columns and one partial index to ``coord.findings`` so a
finding records whether — and by whom — it has been consumed by a steward
cycle, and so the findings steward's default read becomes "everything since
the last run" instead of a fixed-size window that goes dark unread.

- ``triaged_at TIMESTAMPTZ NULL`` — when the finding was first consumed by a
  triage cycle. **NULL means never consumed by a steward cycle.** The mark
  door sets it to ``now()`` only where it is still NULL: the first consumer's
  stamp is the fact worth keeping, so a re-mark is a no-op rather than a
  re-stamp.
- ``triaged_by TEXT NULL`` — the consumer's own free-form, non-empty name. The
  steward writes ``findings-steward:<session-uuid>``; a hand mark writes
  ``session:<uuid>``. NULL whenever ``triaged_at`` is NULL.

Rows with ``kind = 'dossier'`` are never stamped: a dossier head is the
steward's *output*, not an input it consumes, so the read filter and the mark
door both leave those rows untouched (the columns still exist on them, and
stay NULL).

A partial index ``idx_findings_untriaged`` over ``(tenant_id, created_at)
WHERE triaged_at IS NULL`` serves the steward's ``triaged=false`` read — the
only consumer of that predicate — and the population it indexes shrinks to
roughly a day's worth of findings once the steward runs on its schedule. The
predicate is the constant ``IS NULL`` comparison, so there is no
IMMUTABLE-predicate hazard.

## House conventions followed

alembic is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); this revision is
hand-authored, never ``--autogenerate``d. A coord read of these columns must
land AFTER this migration is applied in production (the 2026-07-13
missing-column incident, ``database-migrations.md``).

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS`` /
``CREATE INDEX IF NOT EXISTS`` so the migration is collision-safe against any
canonical PG that might already carry the columns — same convention as
``gatesarchival01_gates_archival_cols``. Every statement names the ``coord``
schema explicitly (the ``forbid-public-schema`` check).

Touches **only** ``coord.findings`` (an ALTER of an existing table, created by
revision ``coord_findings`` earlier in this chain). It is NOT added to any
``ALEMBIC_OWNED_TABLES`` list — the table already exists; this revision only
ALTERs it.

``down_revision`` chains off the LIVE alembic head at authoring time
(``blane_01`` on ``a872dd9cb``, computed as the one revision no
``down_revision`` names across all 567 revision files) — NOT off the buried
``coord_findings``, which has had merged children since 2026-06-20.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "findings_triage_01"
down_revision: str | Sequence[str] | None = "blane_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.findings
            ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.findings
            ADD COLUMN IF NOT EXISTS triaged_by TEXT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_findings_untriaged
            ON coord.findings (tenant_id, created_at)
            WHERE triaged_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_findings_untriaged")
    op.execute("ALTER TABLE coord.findings DROP COLUMN IF EXISTS triaged_at")
    op.execute("ALTER TABLE coord.findings DROP COLUMN IF EXISTS triaged_by")
