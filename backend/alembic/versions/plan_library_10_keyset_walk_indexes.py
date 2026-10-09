"""agent.work_artifacts / work_artifact_edges — keyset walk indexes

Revision ID: plan_library_10_keyset_walk_indexes
Revises: coord_devices_ui_thread_01
Create Date: 2026-10-09

Phase 4 of ``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus``.

The plan-library routes stopped paging with ``OFFSET`` and walk an opaque
keyset cursor over each row's IMMUTABLE ``(created_at, id)`` (design decision
D8: never ``updated_at``, which every upsert moves). Each walk is the row
comparison ``(created_at, id) <|> ($k, $i)`` under ``ORDER BY created_at, id``
(DESC for ``GET /plan-library``, ASC for ``/candidates`` and ``/followups``),
inside the caller's org scope. Two indexes serve them (D6: one migration for
the phase's indexes):

* ``ix_work_artifacts_org_created_id`` —
  ``(coalesce(organization_id, nil), created_at, id)``. The leading expression
  is ``_org_scope``'s NULL-collapsing one (the identity index's), so the
  org-scoped walk is an index range scan in either direction instead of a sort
  of the org's whole corpus per page.
* ``ix_work_artifact_edges_open_followups_created_id`` — ``(created_at, id)``
  PARTIAL on ``relation = 'spawned_followup' AND to_id IS NULL``, exactly the
  open-follow-up predicate, so ``/followups`` walks only the open queue.

An index changes the plan and never the result, so the code does not depend on
this revision having run.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, built
``CONCURRENTLY`` in an autocommit block (both tables are live). A build that
fails part-way can leave an INVALID index a re-run's ``IF NOT EXISTS`` skips;
it only costs the plan (the walk is correct without it). Recovery:
``DROP INDEX CONCURRENTLY`` the named index and re-run.

Downgrade drops both indexes.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_10_keyset_walk_indexes"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "coord_devices_ui_thread_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Build the two keyset-walk indexes, concurrently."""
    # The nil UUID equals ``app.models.work_artifact.NIL_ORGANIZATION_ID``; a
    # literal, not interpolated — coord's migration classifier refuses an
    # f-string ``op.execute``.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_work_artifacts_org_created_id
                ON agent.work_artifacts (
                    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    created_at,
                    id
                )
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_work_artifact_edges_open_followups_created_id
                ON agent.work_artifact_edges (created_at, id)
                WHERE relation = 'spawned_followup' AND to_id IS NULL
            """
        )


def downgrade() -> None:
    """Drop both indexes; the walks stay correct, only slower."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "agent.ix_work_artifact_edges_open_followups_created_id"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS agent.ix_work_artifacts_org_created_id"
        )
