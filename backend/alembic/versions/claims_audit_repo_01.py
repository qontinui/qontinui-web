"""coord.claims_audit.repo — the repo a claim event was made in

Revision ID: claims_audit_repo_01
Revises: outbound_budget_windows_01
Create Date: 2026-11-07

Phase 5a of plan
``2026-10-30-reap-worker-followups-carried-from-the-2026-09-27-and-2026-10-03-plans``
(item 3). coord authors no ``coord.*`` DDL (``[policy: alembic-sole-authorship]``),
so the column lands here, and this revision must be deployed **before** the
coord Phase 5b PR that writes and reads it. Hand-authored;
``alembic revision --autogenerate`` was not run.

Why the column exists
=====================

``coord.claims_audit`` records every claim acquire / heartbeat / release and is
one of the coverage sources ``branch_has_coverage``
(``qontinui-coord`` ``crates/coord/src/data/repo_branches.rs``) reads when it
decides whether a closed PR's branch was authored by a coord session. A covered
branch gets an auto-clearing ``branch_reapable`` gate; an uncovered one gets an
operator question. The table has no repo column, so the claim source matches on
``resource_key`` (the branch name) and the PR window only. A session claiming
branch ``X`` in repo B during repo A's PR window therefore makes repo A's
closed, unmerged PR read as covered, and a human's unmerged branch can be
deleted. This is the plan's only destructive item.

Phase 5b adds an optional ``ClaimRequest.repo`` (``owner/name``), writes it here
on every event, and requires ``lower(ca.repo) = lower($1)`` in the claim
coverage source.

NULL is not evidence
====================

The column is nullable, with no DEFAULT and no backfill. Every existing row and
every row from a writer that does not send a repo stays NULL, and Phase 5b
treats NULL as *no coverage*: an unknown repo falls back to the operator gate
rather than authorising a delete. A DEFAULT, or a backfill guessed from the
branch name, would turn an absence into a claim of the very kind this column
exists to stop. Free text with no CHECK; the ``owner/name`` shape is validated
at coord's door, so a malformed value is refused there rather than failing the
audit INSERT and losing the event.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "claims_audit_repo_01"
down_revision: str | Sequence[str] | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable repo column to coord.claims_audit."""
    # coord INSERTs into this table on every claim event; bound the wait for
    # the ACCESS EXCLUSIVE lock so a blocked apply fails fast.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.claims_audit ADD COLUMN IF NOT EXISTS repo TEXT")
    op.execute(
        """
        COMMENT ON COLUMN coord.claims_audit.repo IS
            'The repo (owner/name) the claim event was made in, as sent in the '
            'claim request. NULL = UNKNOWN: the writer sent no repo, or the row '
            'predates the column. The reap coverage check counts a branch_name '
            'claim as coverage only when this matches the PR repo '
            'case-insensitively, so NULL is never coverage. Plan '
            '2026-10-30-reap-worker-followups-carried-from-the-2026-09-27-and-2026-10-03-plans '
            'item 3.'
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Remove the repo column. Exact reverse of upgrade()."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.claims_audit DROP COLUMN IF EXISTS repo")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
