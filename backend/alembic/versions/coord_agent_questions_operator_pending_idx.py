"""coord.agent_questions — operator-audience pending partial index

Revision ID: coord_agent_questions_operator_pending_idx
Revises: overview_02_authoring_core
Create Date: 2026-09-22

Backend half of plan
``2026-09-12-a-correctly-escalated-question-is-unreachable-in-the-operator-inbox``.

Adds ONE partial index and nothing else:

- ``idx_agent_questions_operator_pending``
  ``ON coord.agent_questions(tenant_id, created_at DESC)
  WHERE responded_at IS NULL AND audience = 'operator'``

It is the exact mirror image of ``idx_agent_questions_agent_pending``, which
``coord_agent_questions_audience`` (:217-223) created for ``audience =
'agent'`` — same table, same key, same predicate shape, opposite audience.
That revision's docstring is the authority for every design choice repeated
here; this one records only what differs.

Why the operator side needs its own index now
=============================================

The audience column split the escalation queue, but only the AGENT side got a
selective index. The census in ``coord_agent_questions_audience``'s header,
measured against production 2026-08-28: **23,700 pending rows**, 23,258 of
them ``pr_fix``. Re-read 2026-09-12 against the audience split, the shape is
lopsided — 23,258 ``pr_fix`` rows carry ``audience='agent'`` and only ~442
rows carry ``audience='operator'``. So the operator's own inbox is **under 2%**
of the pile it has to be found in.

A sibling change adds an ``?audience=operator`` filter to coord's pending
read door. Without this index that filter has no selective path to ride:

- ``idx_agent_questions_agent_pending`` is predicated on
  ``audience = 'agent'`` and therefore cannot serve an ``audience =
  'operator'`` query at all — a partial index is only usable when the
  planner can prove the query implies its predicate, and here it implies the
  negation.
- ``idx_agent_questions_pending`` (``coord_agent_questions``:95) is
  ``ON (created_at DESC) WHERE responded_at IS NULL``, audience-blind AND
  **not led by ``tenant_id``**. Riding it means walking pending rows
  newest-first and re-checking both ``tenant_id`` and ``audience`` per fetched
  row — across a population that is ~98% the wrong audience. That is the
  "poor index" this revision exists to remove, and it gets worse monotonically:
  the agent share is the one that grows (244-1,461 new rows/day over the week
  measured in the sibling's header).

Key and predicate, and why they match the sibling exactly
=========================================================

``(tenant_id, created_at DESC)``. ``tenant_id`` is ``NOT NULL`` on this table
(``coord_tenant_scope_columns`` then ``coord_tenant_id_not_null``, whose
``_LOCKED_TABLES`` names ``agent_questions``) and coord's pending read filters
it unconditionally — ``agent_questions.rs``:2473 carries the comment
*"Tenant filter (`tenant_id = $4`) is unconditional."* — so the leading
equality column lets ONE index scan satisfy the tenant predicate and the
``ORDER BY created_at DESC LIMIT`` together, instead of re-checking the tenant
per fetched row. (That comment is cited as ``:1487-1488`` in the sibling revision; it
sits at ``:2473`` as measured 2026-09-22 AFTER this change set's coord half
(it was ``:2140`` before it). The line moved, the comment did not
— grep the text, not the number.) Identical reasoning to the sibling; the key
is deliberately the same so the two audiences have symmetric read paths and a
future change to one is an obvious change to both.

The predicate is IMMUTABLE (two constant comparisons, no ``now()`` or other
non-IMMUTABLE function), so there is no IMMUTABLE-predicate hazard.

Unlike the sibling, this index is **not** empty on creation: ``audience``
defaults to ``'operator'``, so every pre-split row qualifies and the build
indexes the whole pending population. That is a one-time cost paid inside the
lock window bounded below, and it is the point — the entries are what the
operator inbox reads.

No column, no constraint, no backfill
=====================================

The column, its CHECK and the agent-side index all shipped in
``coord_agent_questions_audience``. Nothing here re-declares them, and
**no row is reclassified**: this revision reads the audience split, it does
not change it. Deliberately no row deletion or retirement either — the pile-up
is a design property (~16 autonomous producers, zero autonomous drains) and
pruning it is a separate decision with its own evidence, not a side effect of
adding an index.

Locking
=======

One statement, one lock: ``CREATE INDEX`` takes SHARE, which blocks INSERTs on
a table ~16 autonomous producers write continuously. ``CREATE INDEX
CONCURRENTLY`` is not available — alembic runs the whole upgrade inside a
transaction (``env.py`` calls ``context.begin_transaction()`` ONCE around
``run_migrations()`` and does not set ``transaction_per_migration``), and
CONCURRENTLY cannot run in one. So the same posture as the sibling: bound the
wait with ``SET LOCAL lock_timeout = '3s'`` and fail fast, because a queued
lock request itself blocks every reader and writer arriving behind it. A
timeout here is a retry, not a data problem.

``RESET lock_timeout`` at the end of each of ``upgrade()``/``downgrade()`` is
REQUIRED, not decorative — that single shared transaction means an unreset
``SET LOCAL`` leaks this timeout into every revision that lands after it.
Same convention as ``coord_agent_questions_audience`` (:193, :227),
``coord_plan_pr_citations_3c_drop`` (:213, :221) and
``scheduler_ticks_proposal_id_01_add_proposal_id`` (:139).

House conventions followed
==========================

Raw ``op.execute`` with ``CREATE INDEX IF NOT EXISTS`` / ``DROP INDEX IF
EXISTS`` (not ``op.create_index``), so the revision is collision-safe against
any canonical PG that might already carry the index — the convention of the
sibling and the ``coord_substrate_*`` revisions. Touches **only**
``coord.agent_questions``, created earlier in this same linear chain by
``coord_agent_questions``.

``down_revision`` chains off the single current head
``overview_02_authoring_core``, computed from the chain itself with the
repo's own counter (``scripts/ci/count_alembic_heads.py --report-only
--baseline-ref HEAD`` → ``HEAD_COUNT=1``), NOT taken from a coord migration
reservation and NOT hand-picked off a branch. Coord's own
``HEAD_KEYED_ALEMBIC_REDIRECT`` (``semantic_reserve.rs``:192-199) says
reserving is advisory-only for alembic — *"author against your local head and
push"* — the semantic ``reserve()`` door REFUSES the head outright
(``migration-head``, ``land_time_repointable: true``), and the older
``alembic_revision`` claim kind answers 410 Gone (``routes.rs``:4415-4424).
Land-time re-pointing plus the required ``alembic-heads-pr`` check is what
replaces it, so **no ``coord:stacked-on`` / ``coord:upstream-of`` label belongs
on this PR** — ``alembic-heads-pr`` owns the chain.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_operator_pending_idx"
down_revision: str | Sequence[str] | None = "overview_02_authoring_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the operator-selective pending partial index."""
    # Bound the DDL's lock wait: CREATE INDEX takes SHARE (blocks INSERTs) and
    # a queued request blocks every reader and writer arriving behind it, on a
    # table ~16 autonomous producers write continuously. Failing fast is a
    # retry, not a data problem.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # The operator inbox's hot read path: pending operator-audience questions
    # for one tenant, newest first. Mirror image of
    # ``idx_agent_questions_agent_pending``; leading ``tenant_id`` because
    # coord's pending read filters it unconditionally. See the docstring for
    # why neither shipped index can serve this query.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_questions_operator_pending
            ON coord.agent_questions(tenant_id, created_at DESC)
            WHERE responded_at IS NULL AND audience = 'operator'
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop the operator-selective pending partial index."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_questions_operator_pending")
    op.execute("RESET lock_timeout")
