"""coord pr_fix arm: partial expression index for the autodispatch idempotency probe.

Plan ``2026-10-13-pr-fix-idempotency-probe-times-out-so-the-arm-never-dispatches``.

Root cause
==========

coord's ``next_step::pr_already_dispatched`` runs on every ``pr_fix`` consult that
passes the cheap gates::

    SELECT EXISTS ( SELECT 1 FROM coord.policy_rule_resolutions
      WHERE tenant_id = $1 AND resolution_id <> $2
        AND resolved_entity->'context'->>'repo' = $3
        AND resolved_entity->'context'->>'pr_number' = $4
        AND resolved_entity->'context'->>'diagnosis_kind' = $5
        AND resolved_entity->'context'->>'head_sha' = $6
        AND (agent_decision->>'autodispatch') = 'true' )

Measured in production on 2026-10-13: the table holds about 4.06 M rows
(8,957 MB) and no index serves this predicate. The tenant/domain index
``idx_policy_rule_resolutions_tenant_domain_resolved`` is keyed on
``decision_domain``, which the probe does not filter on. The probe exceeds
coord's statement timeout on about 976 consults a day, and each failure fails
CLOSED (``held_by: dedup_unknown``): 993 ``pr_fix`` consults in one day, 0
dispatched, 979 ``dedup_unknown``. Adding a ``decision_domain`` conjunct is not
enough: EXPLAIN ANALYZE with it still visits 69,817 heap rows (42,102 buffer
reads, 39.0 s).

The index
=========

``(tenant_id, ((resolved_entity -> 'context') ->> 'head_sha'))`` where that
expression IS NOT NULL. ``head_sha`` is per-commit, so ``(tenant_id, head_sha)``
narrows the probe to a handful of heap rows; ``repo``, ``pr_number``,
``diagnosis_kind`` and the ``autodispatch`` conjunct stay heap filters over
those rows. The probe's ``... ->> 'head_sha' = $6`` is a strict operator, so the
planner proves it implies the ``IS NOT NULL`` predicate in both custom and
generic plans. coord needs no change.

``agent_decision`` MUST NOT appear in this index's key or predicate. PostgreSQL
cannot do a HOT update when the UPDATE changes a column any index references,
and a predicate column counts. coord UPDATEs ``agent_decision`` on almost every
consult (``held_marker``, ``mark_dispatched``, ``annotate_author_grace``, the
spawn_admission retire, decide.rs's record path), and no index references that
column today. Precedent ``coord_iops_idx_01`` measured 0 of 2000 such updates HOT
with the column in a predicate. ``resolved_entity`` is never UPDATEd and is
already referenced by two existing indexes, so this index adds no HOT-blocking
column.

Scope: this serves ``pr_already_dispatched`` only. The sibling
``session_already_dispatched`` has the same unwindowed shape keyed on
``context->>'session_id'`` and is measured in plan Phase 2; a sibling index is a
follow-up only if it is slow.

Building
========

``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` in ``autocommit_block()``, no
in-migration guards, exactly the shape of ``coord_iops_idx_01`` (coord's
fail-closed migration classifier admits only provably additive DDL). A plain
build on a 9 GB heap would stall decision writes for minutes. The build reads
the heap twice on an IOPS-pinned disk, so coord latency degrades while it runs.
Watch the ECS migrator task, not the GitHub job: the job's
``aws ecs wait tasks-stopped`` goes red at 10 minutes while the Fargate task keeps
building. Do NOT re-dispatch the migrator mid-build; on PostgreSQL 16.14 the
deadlock detector killed the first build in 2 of 4 reproductions, leaving it
INVALID.

Verify after deploy (must read ``indisvalid = true``)::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'ix_policy_rule_resolutions_ctx_head_sha';

Then run ``ANALYZE coord.policy_rule_resolutions`` if autovacuum has not yet
collected statistics for the new expression (the migration cannot, as coord's
classifier admits only additive DDL), and confirm the plan with EXPLAIN ANALYZE
on a live tuple (plan Phase 2).

A killed build leaves an INVALID index that ``IF NOT EXISTS`` skips. Recovery is
a follow-up revision doing ``DROP INDEX CONCURRENTLY IF EXISTS`` then this CREATE
again, never a re-run.

Additive and expand-only: every reader is correct without the index, only slower.
``downgrade`` drops it CONCURRENTLY.

Behaviour test: ``tests/test_pr_fix_ctx_head_sha_01_migration.py``.

Revision ID: pr_fix_ctx_head_sha_01
Revises: coord_repo_tenant_bindings_01
Create Date: 2026-10-14

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_fix_ctx_head_sha_01"
down_revision: str | Sequence[str] | None = "coord_repo_tenant_bindings_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """One additive CONCURRENTLY index; verify ``indisvalid`` after deploy."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_policy_rule_resolutions_ctx_head_sha
            ON coord.policy_rule_resolutions (
                tenant_id,
                ((resolved_entity -> 'context') ->> 'head_sha')
            )
            WHERE ((resolved_entity -> 'context') ->> 'head_sha') IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop the additive index. The table and its rows survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.ix_policy_rule_resolutions_ctx_head_sha"
        )
