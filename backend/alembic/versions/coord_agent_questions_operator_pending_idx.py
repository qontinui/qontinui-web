"""coord.agent_questions — operator-audience pending partial index

Revision ID: coord_agent_questions_operator_pending_idx
Revises: prbody_citation_01
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
indexes the whole pending population. That is a one-time build cost, paid
CONCURRENTLY (see Locking below) so writers are never blocked by it, and it is
the point — the entries are what the
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

Locking — CONCURRENTLY, inside an autocommit_block
==================================================

The build is ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` run inside
``with op.get_context().autocommit_block():``. A plain ``CREATE INDEX`` takes
SHARE, which blocks every INSERT/UPDATE/DELETE for the whole build, on a table
~16 autonomous producers write continuously — and, unlike the sibling's index,
this one is NOT empty on creation, so the build is not instant. That is
precisely the shape coord's merge-gate migration classifier
(``pr_merge/migration_classifier.rs``) rejects as *"non-concurrent CREATE INDEX
locks writes on a populated table"*; it admits CONCURRENTLY only when the
``op.execute`` is lexically inside an autocommit_block (proven
non-transactional — CONCURRENTLY cannot run in alembic's shared transaction)
and carries ``IF NOT EXISTS``. CONCURRENTLY takes SHARE UPDATE EXCLUSIVE,
which conflicts with no DML: readers and writers proceed throughout.

No lock-timeout guard, deliberately. The earlier draft's
``SET LOCAL lock_timeout = '3s'`` is meaningless here — each autocommit
statement is its own transaction, so a ``SET LOCAL`` ends before the build
starts — and the session-scoped spellings (``SET lock_timeout`` /
``RESET lock_timeout``) are rejected by the same classifier (fail-closed: they
outlive the run). The hazard the guard existed for is also gone: a queued
SHARE UPDATE EXCLUSIVE request blocks only other SHARE UPDATE EXCLUSIVE-or-
stronger requests (DDL, VACUUM, ANALYZE), not the producers. The build does
wait for transactions older than it to finish; a long-held one delays the
deploy, it does not stall the table.

Failure mode to know: a CONCURRENTLY build that fails (cancel, deadlock,
timeout) leaves an INVALID index named ``idx_agent_questions_operator_pending``
behind, and a re-run's ``IF NOT EXISTS`` then SKIPS it — leaving an index the
planner never uses. Dropping a leftover on the upgrade path is not done here
because the classifier rejects any ``DROP`` on the upgrade path. Recovery is
manual: check ``SELECT indisvalid FROM pg_index WHERE indexrelid =
'coord.idx_agent_questions_operator_pending'::regclass``; if false, run
``DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_operator_pending``
(or this revision's downgrade) and re-apply.

House conventions followed
==========================

Raw ``op.execute`` with static string literals — ``CREATE INDEX CONCURRENTLY
IF NOT EXISTS`` / ``DROP INDEX CONCURRENTLY IF EXISTS`` (not
``op.create_index``), so the revision is collision-safe against
any canonical PG that might already carry the index — the convention of the
sibling and the ``coord_substrate_*`` revisions. Touches **only**
``coord.agent_questions``, created earlier in this same linear chain by
``coord_agent_questions``.

``down_revision`` chains off the single current head of ``origin/main``,
``prbody_citation_01`` (re-pointed 2026-10-08 from ``overlord_01_interventions``,
itself re-pointed 2026-10-01 from the original
``cinode_03_dispatch_pr_head_base_sha`` when this change was adopted from
qontinui-web#1461, whose parent had since been built on), computed from the chain itself with the
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
down_revision: str | Sequence[str] | None = "prbody_citation_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the operator-selective pending partial index, CONCURRENTLY."""
    # CONCURRENTLY cannot run in alembic's shared transaction; the
    # autocommit_block commits it and runs this body in autocommit mode. That
    # is also why there is no lock_timeout guard: a SET LOCAL here would end
    # with its own one-statement transaction (see the docstring's Locking).
    with op.get_context().autocommit_block():
        # The operator inbox's hot read path: pending operator-audience
        # questions for one tenant, newest first. Mirror image of
        # ``idx_agent_questions_agent_pending``; leading ``tenant_id`` because
        # coord's pending read filters it unconditionally. A static literal,
        # never an f-string: coord's migration classifier and the
        # alembic-schema-arg-gate hook both read the SQL statically.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_questions_operator_pending
            ON coord.agent_questions (tenant_id, created_at DESC)
            WHERE responded_at IS NULL AND audience = 'operator'
            """
        )


def downgrade() -> None:
    """Drop the operator-selective pending partial index, CONCURRENTLY."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_operator_pending"
        )
