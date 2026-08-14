"""Let coord.repo_branches.base_branch say "unknown" — drop NOT NULL and the 'main' default

Revision ID: probe_base_01
Revises: pdaw_01
Create Date: 2026-08-14

Phase 1a of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-02-coord-probe-base-from-pr-baserefname.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
schema change its Phase 1b/1c code depends on lands here, in qontinui-web, and
must be deployed before any coord build reads the column expecting NULL.

What this changes
=================

``coord.repo_branches.base_branch`` was created by
``coordinator_phase_a_01_coord_tables`` as::

    sa.Column("base_branch", sa.Text(), nullable=False,
              server_default=sa.text("'main'"))

No later revision alters it, and the live prod catalogue agrees
(``is_nullable: NO``). This revision makes it::

    base_branch TEXT NULL          -- no server default

Both halves, and why the default is the load-bearing one
========================================================

The column answers "what branch does this PR target?". Under
``NOT NULL DEFAULT 'main'`` there is no way for it to answer "I have never
observed that" — the two facts *"this PR targets main"* and *"nobody ever told
us this PR's base"* are stored as the same byte string. That is not a cosmetic
gap: coord's downstream refusal gate fires on ``base != repo_default``, so a
fabricated ``'main'`` compares equal to the default, escapes the refusal, and
the PR is fast-forwarded onto ``main`` — a branch its author never targeted.
The same fabrication makes the ``branch_reapable`` gate's "is there an open
dependent PR?" guard under-match, so coord can reap a base branch out from
under an open PR.

Dropping NOT NULL alone would buy nothing. **Every ``INSERT`` that omits the
column takes the server default**, so the fabrication would simply continue at
its real source — the default itself — while the schema now merely *permits* a
NULL that no writer ever produces. Both statements are therefore issued
together, in one transaction, and neither is optional:

* ``ALTER COLUMN base_branch DROP NOT NULL`` — makes "unknown" representable;
* ``ALTER COLUMN base_branch DROP DEFAULT`` — stops manufacturing ``'main'``.

Neither statement rewrites the table. ``DROP NOT NULL`` clears
``pg_attribute.attnotnull`` and ``DROP DEFAULT`` clears the ``pg_attrdef``
entry; both are catalogue updates that take a brief ``ACCESS EXCLUSIVE`` lock
and return immediately.

No backfill, deliberately
=========================

Existing rows keep whatever they hold, including every ``'main'``. They are
**not** rewritten to NULL, and this is a decision rather than an omission.

After the fact, a row that genuinely targets ``main`` and a row that was
defaulted to ``'main'`` are indistinguishable — that indistinguishability *is*
the bug this revision closes going forward, and it cannot be un-mixed
retroactively. Backfilling every ``'main'`` to NULL would guess in the opposite
direction: it would throw away real, correctly-ingested bases (the overwhelming
majority — most PRs do target ``main``) in order to un-fabricate a few, which
re-commits exactly the same sin with the sign flipped. Writes are honest from
this revision forward; stale rows self-heal the next time a ``pull_request``
webhook or a GraphQL hydration stamps the real base, both of which write the
observed ``baseRefName`` unconditionally.

Consumers must read NULL as *unknown*, never as *main* — no ``COALESCE``. The
consumer changes are separate, later coord PRs (plan Phases 1b/1c onward); this
revision only makes the honest value representable.

Ordering: this lands FIRST, coord's read is a separate, later PR
================================================================

coord and qontinui-web deploy independently, and the asymmetry matters: a
missing *table* is caught at boot by ``require_table``, but a missing or
still-``NOT NULL`` **column** sails straight through boot. A coord build that
assumes NULL is possible against an un-migrated database simply never sees NULL
and degrades to today's behaviour, so the ordering is a
correctness-of-the-fix constraint rather than a crash risk — but it is still a
constraint.

No ``coord:stacked-on`` / ``coord:upstream-of`` label is needed for that
ordering. coord derives migration ordering from the ``down_revision`` chain,
not from PR labels.

Downgrade restores both halves
==============================

``downgrade()`` is a true inverse and must run in this order: backfill any NULL
introduced while this revision was applied back to ``'main'``, *then* re-add
the server default, *then* re-assert ``NOT NULL``. Re-asserting NOT NULL first
would fail on exactly the rows this revision exists to allow.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "probe_base_01"
down_revision: str | Sequence[str] | None = "pdaw_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make "unknown base" representable: drop NOT NULL and the ``'main'`` default.

    One ``ALTER TABLE`` carrying both actions, so the pair can never be applied
    half-way. `alembic/env.py` runs this inside `context.begin_transaction()`
    and PostgreSQL DDL is transactional, so both clauses commit or neither
    does.

    No backfill — see the revision docstring for why guessing which existing
    ``'main'`` rows were fabricated would re-commit the same defect in the
    opposite direction.
    """
    op.execute(
        """
        ALTER TABLE coord.repo_branches
            ALTER COLUMN base_branch DROP NOT NULL,
            ALTER COLUMN base_branch DROP DEFAULT
        """
    )

    # The column name cannot say that NULL is a real answer rather than a gap,
    # and the previous default trained every reader to assume otherwise. State
    # it in the catalogue so the next reader is not re-taught the bug.
    op.execute(
        """
        COMMENT ON COLUMN coord.repo_branches.base_branch IS
            'The branch this branch''s PR targets, as observed from GitHub '
            '(pullRequest.baseRefName, or pull_request.base.ref on a webhook). '
            'NULL means UNKNOWN (no ingest path has ever reported a base for '
            'this row) and must never be read as "main". Before revision '
            'probe_base_01 the column was NOT NULL DEFAULT ''main'', so '
            '"targets main" and "never observed" were stored identically; that '
            'fabricated ''main'' compared equal to the repo default, escaped '
            'coord''s non-default-base refusal, and could fast-forward a PR '
            'onto a branch it never targeted. Rows written before this '
            'revision were deliberately NOT backfilled and may still carry a '
            'fabricated ''main''; they self-heal on the next pull_request '
            'webhook or GraphQL hydration. Consumers: no COALESCE.'
        """
    )


def downgrade() -> None:
    """Restore ``NOT NULL DEFAULT 'main'``. Reverse of upgrade().

    Order is load-bearing: backfill first, then the default, then the
    constraint. Re-asserting NOT NULL while NULLs are present would abort the
    downgrade on precisely the rows this revision made possible.

    Note this is lossy in the same way the original schema was: every NULL
    collapses back into ``'main'`` and becomes indistinguishable from a real
    one. That is the pre-revision behaviour being restored, not a new defect.
    """
    op.execute(
        """
        UPDATE coord.repo_branches
           SET base_branch = 'main'
         WHERE base_branch IS NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.repo_branches
            ALTER COLUMN base_branch SET DEFAULT 'main',
            ALTER COLUMN base_branch SET NOT NULL
        """
    )
    op.execute("COMMENT ON COLUMN coord.repo_branches.base_branch IS NULL")
