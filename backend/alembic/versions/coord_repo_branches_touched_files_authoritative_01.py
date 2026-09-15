"""coord.repo_branches.touched_files_authoritative_at — the citation re-enrich skip stamp

Revision ID: coord_repo_branches_touched_files_authoritative_01
Revises: coord_ci_job_observations_02
Create Date: 2026-09-15

Phase 1 of plan
``2026-09-10-citation-reenrich-is-unrunnable-and-plan-pr-is-unclassifiable``.

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the column coord's citation re-enrich pass will stamp lands here, and this
revision must be applied before coord reads it.

What it is for
==============

coord's citation re-enrich pass (``citation_reenrich.rs``) re-hydrates
``touched_files`` on PR rows whose citations are document-eligible, so the
read-time ``document_citation`` classifier stops treating a plan-document PR as
delivery. Its selection has no skip rule: an unclassifiable row (``'{}'``) or a
genuine code PR (``false``) is re-selected — and for a TERMINAL PR re-read from
GitHub's PR-files API — on every call. Phase 2 of the plan schedules the pass,
which is only viable with a durable skip rule.

Semantics
=========

``NULL`` means "not authoritatively hydrated" — the state every existing row
starts in, so this revision needs no backfill. A non-NULL value is the instant
the pass set ``touched_files`` on a TERMINAL (merged/closed) PR row from
GitHub's PR-files API, which is immutable once the PR is terminal — including
the ``'{}'`` outcomes (>=100 files, a 404, an empty list). The pass never
re-selects a stamped row.

Why a new column and not ``last_refreshed_at``
==============================================

``last_refreshed_at`` has many writers in coord's ``data/repo_branches.rs``
(push, PR-event and rebind paths all stamp it), so it cannot carry "this file
list came from the authoritative source". A dedicated column has exactly one
writer. Deliberately a timestamp rather than a boolean: it answers "when".

Locking
=======

Nullable with no default, so the ADD is a catalogue-only change with no table
rewrite (PostgreSQL 11+). No index: the pass's selection already narrows on
other predicates, and the stamp is a filter on that narrowed set.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_repo_branches_touched_files_authoritative_01"
down_revision: str | Sequence[str] | None = "coord_ci_job_observations_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable skip stamp and its comment."""
    # `IF NOT EXISTS` matches on NAME only; acceptable because no revision in
    # this chain spells `touched_files_authoritative_at`.
    op.execute(
        """
        ALTER TABLE coord.repo_branches
            ADD COLUMN IF NOT EXISTS touched_files_authoritative_at TIMESTAMPTZ
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.repo_branches.touched_files_authoritative_at IS
            'Set by coord''s citation re-enrich pass when touched_files on a '
            'TERMINAL PR row was hydrated from GitHub''s PR-files API; a '
            'stamped row is never re-selected.'
        """
    )


def downgrade() -> None:
    """Exact inverse — drop the column (its comment goes with it)."""
    op.execute(
        """
        ALTER TABLE coord.repo_branches
            DROP COLUMN IF EXISTS touched_files_authoritative_at
        """
    )
