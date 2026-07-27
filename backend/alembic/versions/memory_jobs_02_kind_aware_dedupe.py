"""coord.memory_jobs — kind-aware live-input dedupe (embedding re-queues after done)

Revision ID: memory_jobs_02_kind_aware_dedupe
Revises: gates_clearance_provenance_01
Create Date: 2026-07-27

Fixes a confirmed-in-prod deadlock in the tenant-memory job queue.

The bug
=======

A memory row that still needs an embedding but already has a
``done``-but-unapplied embedding job never gets embedded. Two predicates
in ``app/services/memory_store.py`` disagree on how ``done`` embedding
jobs are treated:

* ``fetch_reindex_batch`` excludes a row only when it has an IN-FLIGHT
  (``pending`` / ``claimed``) embedding job — a row whose only job is
  ``done`` is STILL fetched (correct: a done-but-unapplied job left the
  embedding NULL, so the row genuinely needs re-embedding).
* ``enqueue_jobs`` dedupes against the ``uq_memory_jobs_live_input``
  partial unique index whose predicate is
  ``WHERE status IN ('pending','claimed','done')`` — so the re-enqueue is
  deduped against the stale ``done`` job and inserts nothing.

Net effect: the row is fetched every ``memory_reindex`` run yet its
re-enqueue is a no-op forever (``memory_reindex_enqueued rows:N jobs:0``).
The vectors are never computed. Confirmed stuck in prod 2026-07-27 for
tenant ``c38de42a-8d49-4c19-be02-b8183ce99880`` (memory_ids
``99adda15-…`` and ``379c8230-…``: non-empty content, embedding NULL, a
done embedding job, no in-flight job).

The fix
=======

Make the dedupe KIND-AWARE. An embedding job may re-queue after a
``done`` job because ``fetch_reindex_batch`` already gates re-embedding
on the row still being un-embedded — so no duplicate embedding work can
pile up. A synthesis job must KEEP ``done``-dedupe: a completed
synthesis already inserted its ``mental_model`` and superseded its
members, and must never be redone.

The single partial unique index carries a compound predicate:

    WHERE status IN ('pending', 'claimed')
       OR (status = 'done' AND kind = 'synthesis')

The ``enqueue_jobs`` ``ON CONFLICT ... WHERE`` clause is updated to match
this predicate exactly (a partial-index conflict target must state the
index predicate verbatim).

Self-heal
=========

This migration needs NO manual data repair. Once the ``done`` embedding
job no longer participates in the index, the very next ``memory_reindex``
(``*/10``) enqueues a fresh embedding job for each stuck row, and a
runner drains it. The prod-stuck rows above heal themselves on the next
sweep after this lands.

Idempotent both ways: ``DROP INDEX IF EXISTS`` + ``CREATE UNIQUE INDEX IF
NOT EXISTS``, so a re-run (or a fresh DB where the index already carries
the new predicate) falls straight through.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# ``down_revision`` chains off the single web head at authoring time
# (``gates_clearance_provenance_01``). Keep this on ONE physical line — the
# ``alembic-heads-pr`` CI gate parses it with a line-based regex.
revision: str = "memory_jobs_02_kind_aware_dedupe"
down_revision: str = "gates_clearance_provenance_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Recreate uq_memory_jobs_live_input with the kind-aware predicate."""
    op.execute("DROP INDEX IF EXISTS coord.uq_memory_jobs_live_input")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_jobs_live_input
            ON coord.memory_jobs (tenant_id, kind, input_hash)
            WHERE status IN ('pending', 'claimed')
               OR (status = 'done' AND kind = 'synthesis')
        """
    )


def downgrade() -> None:
    """Restore the original all-kinds ``done``-dedupe predicate."""
    op.execute("DROP INDEX IF EXISTS coord.uq_memory_jobs_live_input")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_jobs_live_input
            ON coord.memory_jobs (tenant_id, kind, input_hash)
            WHERE status IN ('pending', 'claimed', 'done')
        """
    )
