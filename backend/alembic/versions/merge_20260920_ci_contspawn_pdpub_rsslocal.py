"""merge the four sibling heads that landed off plan_library_07 on 2026-09-20

Revision ID: merge_20260920_ci_contspawn_pdpub_rsslocal
Revises: ci_job_mem_01, contspawn_01_gates_continuation_spawn_attempts, pdpub_03, rsslocal_02_drop_coord_tables
Create Date: 2026-09-20

Empty merge node. It adds, alters and drops NOTHING — it only rejoins the DAG
so ``alembic upgrade head`` resolves again. Hand-authored;
``alembic revision --autogenerate`` was not run and is never run against
``coord.*`` (served policy ``production-and-cost``
``alembic-sole-authorship`` — no SQLAlchemy models back that schema, so
autogenerate emits spurious drops).

## What forked, and how

Four independent migrations each chained off the SAME parent,
``plan_library_07_plan_difficulty``, and all four merged to main within about
eight hours on 2026-09-20. Each was single-headed when its author wrote it;
each became a sibling when the next one landed. This is the post-authoring
race ``scripts/ci/count_alembic_heads.py`` documents — the local pre-commit
lane cannot catch it, because at ``git commit`` time every one of these was
correct.

Three of the four had ALREADY been re-pointed onto ``plan_library_07``
during review, which is what converged them onto one parent rather than
spreading them down a chain:

=================================================  ========  ==============
head                                               PR commit  what it does
=================================================  ========  ==============
``ci_job_mem_01``                                  e5f4bd422  adds nine
                                                              memory-headroom
                                                              columns to
                                                              ``coord.ci_job_observations``
``contspawn_01_gates_continuation_spawn_attempts`` 3b5db2fa6  adds
                                                              ``coord.gates.continuation_spawn_attempts``
``pdpub_03``                                       cbb0beed6  adds
                                                              ``publish_mode`` to the two
                                                              ``coord.prompt_document*`` tables
``rsslocal_02_drop_coord_tables``                  c178839a7  drops four vestigial
                                                              ``coord.*`` session tables
=================================================  ========  ==============

## Why a merge revision and not a re-point

Every one of the four is already on ``origin/main``, so no ``down_revision``
can be moved without rewriting landed history, and each migration is wanted —
none is an orphan to delete. That is exactly the case the gate's own
``MERGE_REMEDY`` names. The four touch four disjoint sets of ``coord.*``
objects, so they commute: joining them here reorders nothing.

## What this unblocks

A multi-head chain makes ``alembic upgrade head`` refuse to disambiguate, so
``migrate.yml``'s migrator task cannot advance the canonical DB, and coord's
``/coord/schema/observe-live`` gauge reads ``multi_head`` — which is a
DEPLOY-BLOCKING condition for qontinui-coord's ``Build, push, and roll coord``
job. Measured against the live RDS catalog on 2026-09-20 while this fork
stood: ``applied_head = rsslocal_02_drop_coord_tables``, ``head_count = 4``,
``single_head = false``. Only the ``rsslocal_02`` branch had been applied —
``coord.gates.continuation_spawn_attempts``,
``coord.prompt_documents.publish_mode`` and
``coord.ci_job_observations.peak_swap_used_mb`` all read ``existence:
absent``, while the four tables ``rsslocal_02`` drops read absent too.

So landing this node is necessary but NOT sufficient: the DB still sits one
branch in. Once this is on main, ``migrate.yml`` (push-triggered on
``backend/alembic/**``) runs the migrator, which walks
``rsslocal_02_drop_coord_tables`` -> the three unapplied siblings -> this
node, and the gauge clears.
"""

from collections.abc import Sequence

revision: str = "merge_20260920_ci_contspawn_pdpub_rsslocal"
# NOTE: the parents must stay inside ONE parenthesised group. The gate's
# offline parser (`scripts/ci/_alembic_graph.py` `DOWN_RE`) reads the
# right-hand side as `(\([^)]*\)|[^\n]+)` — a parenthesised list may wrap
# across lines, a BARE tuple spilling past a `)` cannot.
down_revision: str | Sequence[str] | None = (
    "ci_job_mem_01",
    "contspawn_01_gates_continuation_spawn_attempts",
    "pdpub_03",
    "rsslocal_02_drop_coord_tables",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin the chain to a single head."""


def downgrade() -> None:
    """No-op: re-forks the chain back into the four heads it joined."""
