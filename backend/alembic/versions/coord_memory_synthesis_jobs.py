"""coord memory_synthesis_jobs — runner-paid synthesis queue

Revision ID: coord_memory_synthesis_jobs
Revises: coord_memory_records
Create Date: 2026-07-11

Phase 2 of the tenant-agentic-memory v1.1 rollout
(``2026-07-11-tenant-memory-v1-1-close-the-loop``).

The backend clusters episode memories but cannot synthesize them into a
``mental_model`` (it ships no LLM client). Instead consolidation enqueues
one row here per cluster; a runner claims it over
``POST /api/v1/memory/synthesis-jobs/claim``, calls its own warm LLM, and
posts the synthesized text back to ``/synthesis-jobs/{id}/result`` — at
which point the backend embeds (local model) + inserts the mental_model
row and supersedes the cluster members.

Design notes
============

* ``status`` is TEXT + CHECK (``pending`` → ``claimed`` → ``done`` /
  ``failed``) — same text+CHECK posture as the sibling coord tables.
* ``member_ids`` is a ``UUID[]`` (the cluster's ``coord.memory_records``
  ids); no FK is possible on an array element, matching
  ``memory_records.consolidated_from``.
* ``member_texts`` is JSONB (the redacted cluster contents) so a runner
  needs zero read-back into the memory store to synthesize.
* ``member_set_hash`` is a stable order-independent hash of the sorted
  member ids. A partial UNIQUE index over the LIVE statuses
  (``pending`` / ``claimed`` / ``done``) makes re-enqueue of a cluster
  that already has a live job a no-op — while a ``failed`` job (outside
  the index) permits a fresh retry.
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS`` so a
  re-run against an already-applied DB is a no-op.
* FK ``tenant_id → coord.tenants(tenant_id) ON DELETE CASCADE``: these
  are transient work items, not durable memory, so a tenant delete
  should sweep them rather than be blocked (unlike ``memory_records``,
  which is RESTRICT).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_memory_synthesis_jobs"
down_revision: str = "coord_memory_records"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.memory_synthesis_jobs + its claim/dedupe indexes."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.memory_synthesis_jobs (
            job_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            member_ids      UUID[] NOT NULL,
            member_texts    JSONB NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
            claimed_by      TEXT,
            claimed_at      TIMESTAMPTZ,
            finished_at     TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            result_text     TEXT,
            attempt         INTEGER NOT NULL DEFAULT 0,
            member_set_hash TEXT NOT NULL
        )
        """
    )

    # Claim path: pending jobs for a tenant, oldest-first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_synthesis_jobs_pending
            ON coord.memory_synthesis_jobs (tenant_id, created_at)
            WHERE status = 'pending'
        """
    )

    # Dedupe guard: at most one LIVE (pending/claimed/done) job per
    # (tenant, member set). A failed job is outside this index, so a
    # cluster can be re-enqueued after a permanent failure.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
            uq_memory_synthesis_jobs_live_member_set
            ON coord.memory_synthesis_jobs (tenant_id, member_set_hash)
            WHERE status IN ('pending', 'claimed', 'done')
        """
    )


def downgrade() -> None:
    """Drop the synthesis-jobs table (indexes drop with it)."""
    op.execute(
        "DROP INDEX IF EXISTS coord.uq_memory_synthesis_jobs_live_member_set"
    )
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_synthesis_jobs_pending")
    op.execute("DROP TABLE IF EXISTS coord.memory_synthesis_jobs")
