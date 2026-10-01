"""coord.repo_branches / coord.displaced_pr_rows .pr_state_observed_at — the PR-state clock

Revision ID: coord_pr_state_observed_at_01
Revises: overlord_01_interventions
Create Date: 2026-10-02

Phase 1 of plan
``2026-10-01-the-shipped-demotion-hold-has-no-pr-state-clock-so-stale-open-citations-pin-false-shipped``.

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the column coord will stamp lands here, and this revision must be APPLIED in
production before coord reads it.

What it is for
==============

coord's delivery view decides whether a cited PR's cached ``pr_state`` is fresh
enough to trust (``delivery_view.rs`` ``cited_row_is_stale``). Today the only
clock it has is the CITATION's insert time, which never moves, so every
citation older than five minutes reads stale for ever. When a live GitHub
re-read then fails -- in practice when the shared installation bucket is
exhausted -- a ``shipped`` unit whose evidence was observed a minute earlier is
HELD as "evidence incomplete" instead of being judged. This column records
WHEN a PR-state authority last told coord the PR's state, so a recent
observation survives one failed read.

Semantics
=========

``NULL`` means "no PR-state authority has observed this row since the column
existed" -- the state every existing row starts in, and the conservative arm by
construction (coord falls back to today's behaviour). So: no default, no
backfill. A ``DEFAULT now()`` would forge a fresh observation onto every row.

The writer contract (coord side; to be enforced by a census test in coord, plan Phase 3)
========================================================================================

Every coord statement that assigns ``pr_state`` falls into exactly one class:

* STAMP ``NOW()`` -- a PR-state authority wrote the value: the
  ``pull_request`` webhook upsert, the GraphQL hydrate, the delivery freshness
  floor's live read (``persist_pr_state`` and its displaced fallthrough), the
  first-observation writers, the webhook fallthroughs to the archive, and
  coord's own land records.
* CARRY -- the rebind archive copies the live row's stamp into
  ``displaced_pr_rows``; moving a row is not observing it.
* CLEAR -- a NON-authority writer that changes ``pr_state`` (``mark_branch_closed``,
  driven by a branch-delete event) must NULL the stamp in the same statement,
  or an older ``open`` observation would vouch for a ``closed`` value nobody
  observed.
* UNTOUCHED -- statements that do not assign ``pr_state`` (the ``push`` head
  upsert, the ``touched_files`` re-enrich write, the merge-state heal) must
  never name this column. ``last_refreshed_at`` is NOT this clock: every
  ``push`` webhook moves it, so a PR that keeps receiving pushes would re-arm it
  for ever.

Locking
=======

Nullable with no default, so each ADD is catalogue-only and rewrites no row.
Both tables are written by coord's webhook ingest, so the ACCESS EXCLUSIVE
wait is bounded with ``SET LOCAL lock_timeout = '3s'`` and restored afterwards
(env.py runs the batch in one transaction) -- the bracket
``coord_repo_branches_touched_files_authoritative_01`` documents.

No index: coord only projects the column inside the citation read's
aggregate, so an index would add write amplification and serve nothing.

Merge-train classifier disposition
==================================

The lock bracket makes this revision's ``upgrade()`` unclassifiable to coord's
migration classifier (``SET ...`` matches no branch of
``classify_sql_statement``), so an ``auto_if_provably_safe`` escalate policy
covering this glob returns Blocked rather than clearing. That is the known
price of the guard, the same one
``coord_repo_branches_touched_files_authoritative_01`` documents, not a defect.

Re-point rule: if another alembic revision lands first, coord re-points
``down_revision`` at land time; the companion test's ``_PARENT_REVISION_ID``
literal moves with it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_state_observed_at_01"
down_revision: str | Sequence[str] | None = "overlord_01_interventions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    """Add the nullable PR-state observation stamp to both row sources."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # `IF NOT EXISTS` matches on NAME only; acceptable because no revision in
    # this chain spells `pr_state_observed_at`.
    op.execute(
        """
        ALTER TABLE coord.repo_branches
            ADD COLUMN IF NOT EXISTS pr_state_observed_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.repo_branches.pr_state_observed_at IS
            'When a PR-state authority (a GitHub pull_request webhook, a live '
            'GitHub read, or coord''s own land record) last observed this '
            'row''s pr_state. NULL = not observed since the column existed; '
            'a non-authority pr_state write clears it.'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.displaced_pr_rows
            ADD COLUMN IF NOT EXISTS pr_state_observed_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.pr_state_observed_at IS
            'The archived row''s PR-state observation stamp, carried from '
            'coord.repo_branches on rebind and re-stamped only by a PR-state '
            'authority. NULL = not observed since the column existed.'
        """
    )

    # env.py runs the whole batch in one transaction, so leaving this set would
    # silently impose a 3 s ceiling on the next revision's DDL too.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the stamp from both tables (a catalogue inverse; the data does not return)."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.displaced_pr_rows
            DROP COLUMN IF EXISTS pr_state_observed_at
        """
    )
    op.execute(
        """
        ALTER TABLE coord.repo_branches
            DROP COLUMN IF EXISTS pr_state_observed_at
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")
