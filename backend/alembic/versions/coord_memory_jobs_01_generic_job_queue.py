"""coord memory_synthesis_jobs -> memory_jobs — kind-dispatched job queue

Revision ID: coord_memory_jobs_01
Revises: coord_policy_clauses_01
Create Date: 2026-07-17

Phase 2 of ``2026-07-13-runner-paid-embedding``.

``coord.memory_synthesis_jobs`` was already a lease-based work queue with
the right bones (pending -> claimed -> done/failed, claim lease + reaper,
live-status dedupe). Phase 2 needs a SECOND shape of backend-initiated,
runner-executed work — embedding — which is the same shape of thing:
"here is text; do local compute; post the result back". A second table
would mean a second claim endpoint, a second reaper and a second runner
loop for one shape of work, so the table is RESTRUCTURED IN PLACE into a
generic, kind-dispatched queue rather than cloned.

What changes
============

* ``kind`` TEXT NOT NULL CHECK (``synthesis`` | ``embedding``) — the
  dispatch discriminator. Pre-existing rows are all synthesis.
* ``member_ids``      -> ``target_ids``  (UUID[]): the rows this job is
  ABOUT — a synthesis job's cluster members, an embedding job's records
  to vectorize.
* ``member_texts``    -> ``input_texts`` (JSONB): the text the runner
  computes over, in order. ``input_texts[i]`` corresponds to
  ``target_ids[i]`` for ``kind='embedding'``.
* ``result_text`` TEXT -> ``result`` JSONB: the runner's posted result,
  whose shape is kind-specific (``{"result_text", "embedding",
  "embedding_model"}`` for synthesis, ``{"embeddings", "embedding_model"}``
  for embedding) or ``{"failure": reason}`` on the failure path. JSONB
  because a vector payload is not text.
* ``member_set_hash`` -> ``input_hash``: same stable order-independent
  hash, generalized in name. The partial UNIQUE over LIVE statuses
  (``pending`` / ``claimed`` / ``done``) is now scoped ``(tenant_id,
  kind, input_hash)``, so the same target set under a DIFFERENT kind is a
  DISTINCT job (a cluster can have both a synthesis job and an embedding
  job) while a re-enqueue of the same (kind, targets) stays a no-op.

  **This dedupe is load-bearing, not hygiene**: ``memory_bridge_sync``
  runs every 15 minutes and ``memory_reindex`` daily, and both enqueue
  the rows they find un-embedded. Without the live-status dedupe every
  tick would re-enqueue the same rows, so the queue would grow without
  bound between runner drains.

Preserved as-is
===============

* the reaper's columns (``attempt`` / ``claimed_at`` / ``claimed_by``),
* the claim-path partial index (now carrying ``kind``, which is in the
  claim's WHERE clause),
* FK ``tenant_id -> coord.tenants(tenant_id) ON DELETE CASCADE`` (survives
  the table rename automatically),
* the ``IF NOT EXISTS`` / ``IF EXISTS`` idempotency idiom.

Data migration
==============

Written to be correct whether or not rows exist. Local canonical PG had
``count(*) = 0`` at authoring time, but the producer (``memory_consolidate``,
cron ``20 4 * * 0``) may have fired elsewhere, so pre-existing rows are
MIGRATED rather than assumed away: ``kind='synthesis'``, the column renames
carry values across untouched, and ``result_text`` folds into ``result`` in
the shape the new writers use — ``{"failure": ...}`` for a failed job (whose
``result_text`` held the failure reason) and ``{"result_text": ...}``
otherwise.

Every step is guarded on catalog state, so this is a no-op against an
already-migrated DB and creates the table outright on a fresh one.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_memory_jobs_01"
down_revision: str = "coord_policy_clauses_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Restructure the synthesis queue into a generic kind-dispatched queue."""
    # -- 1. Rename the table (existing-DB path) ---------------------------
    # Guarded on both sides: only when the old table is there AND the new
    # one is not, so a re-run (or a fresh DB) falls straight through.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'coord'
                  AND table_name = 'memory_synthesis_jobs'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'coord' AND table_name = 'memory_jobs'
            ) THEN
                ALTER TABLE coord.memory_synthesis_jobs RENAME TO memory_jobs;
            END IF;
        END $$
        """
    )

    # -- 2. Create outright (fresh-DB path) -------------------------------
    # A no-op after step 1 renamed an existing table into place.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.memory_jobs (
            job_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            kind        TEXT NOT NULL
                CONSTRAINT memory_jobs_kind_check
                CHECK (kind IN ('synthesis', 'embedding')),
            target_ids  UUID[] NOT NULL,
            input_texts JSONB NOT NULL,
            status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
            claimed_by  TEXT,
            claimed_at  TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            result      JSONB,
            attempt     INTEGER NOT NULL DEFAULT 0,
            input_hash  TEXT NOT NULL
        )
        """
    )

    # -- 3. Column renames (existing-DB path) -----------------------------
    # Each guarded on the OLD name still being present, so they are no-ops
    # on a fresh DB (step 2 already created the new names) and on a re-run.
    for old, new in (
        ("member_ids", "target_ids"),
        ("member_texts", "input_texts"),
        ("member_set_hash", "input_hash"),
    ):
        op.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'coord' AND table_name = 'memory_jobs'
                      AND column_name = '{old}'
                ) THEN
                    ALTER TABLE coord.memory_jobs
                        RENAME COLUMN {old} TO {new};
                END IF;
            END $$
            """
        )

    # -- 4. kind: add, backfill, constrain --------------------------------
    # Added nullable so pre-existing rows can be backfilled before the
    # NOT NULL lands (an ADD COLUMN NOT NULL without a default would fail
    # outright on a non-empty table).
    op.execute("ALTER TABLE coord.memory_jobs ADD COLUMN IF NOT EXISTS kind TEXT")
    op.execute(
        "UPDATE coord.memory_jobs SET kind = 'synthesis' WHERE kind IS NULL"
    )
    op.execute("ALTER TABLE coord.memory_jobs ALTER COLUMN kind SET NOT NULL")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'memory_jobs_kind_check'
                  AND conrelid = 'coord.memory_jobs'::regclass
            ) THEN
                ALTER TABLE coord.memory_jobs
                    ADD CONSTRAINT memory_jobs_kind_check
                    CHECK (kind IN ('synthesis', 'embedding'));
            END IF;
        END $$
        """
    )

    # -- 5. result_text TEXT -> result JSONB ------------------------------
    # The USING clause folds the old flat text into the shape the new
    # writers emit, discriminating on status: a failed job's result_text
    # held its failure REASON (record_synthesis_failure wrote it there),
    # so it becomes {"failure": ...} rather than being mislabeled as a
    # synthesized result. NULL stays NULL (never-finished jobs).
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'coord' AND table_name = 'memory_jobs'
                  AND column_name = 'result_text'
            ) THEN
                ALTER TABLE coord.memory_jobs RENAME COLUMN result_text TO result;
                ALTER TABLE coord.memory_jobs
                    ALTER COLUMN result TYPE JSONB
                    USING (
                        CASE
                            WHEN result IS NULL THEN NULL
                            WHEN status = 'failed'
                                THEN jsonb_build_object('failure', result)
                            ELSE jsonb_build_object('result_text', result)
                        END
                    );
            END IF;
        END $$
        """
    )
    # Fresh DBs created by step 2 already have it; this covers the
    # (impossible-in-practice) shape where neither name is present.
    op.execute("ALTER TABLE coord.memory_jobs ADD COLUMN IF NOT EXISTS result JSONB")

    # -- 6. Constraint names ----------------------------------------------
    # Postgres does NOT rename a table's constraints when the table is
    # renamed, so a MIGRATED db would keep `memory_synthesis_jobs_pkey` /
    # `..._status_check` while a FRESH one (step 2) gets the `memory_jobs_*`
    # names. That divergence is invisible until some later migration says
    # `DROP CONSTRAINT memory_jobs_pkey` and passes on a fresh dev box while
    # failing on prod. Converge them now.
    for old, new in (
        ("memory_synthesis_jobs_pkey", "memory_jobs_pkey"),
        ("memory_synthesis_jobs_status_check", "memory_jobs_status_check"),
        ("memory_synthesis_jobs_tenant_id_fkey", "memory_jobs_tenant_id_fkey"),
    ):
        op.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = '{old}'
                      AND conrelid = 'coord.memory_jobs'::regclass
                ) AND NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = '{new}'
                      AND conrelid = 'coord.memory_jobs'::regclass
                ) THEN
                    ALTER TABLE coord.memory_jobs
                        RENAME CONSTRAINT {old} TO {new};
                END IF;
            END $$
            """
        )

    # -- 7. Indexes -------------------------------------------------------
    # The old names go with the old column names they were built on.
    op.execute(
        "DROP INDEX IF EXISTS coord.uq_memory_synthesis_jobs_live_member_set"
    )
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_synthesis_jobs_pending")

    # Claim path: pending jobs for a tenant, oldest-first, now carrying
    # `kind` because the claim filters on it (`kinds` in the request body).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_jobs_pending
            ON coord.memory_jobs (tenant_id, kind, created_at)
            WHERE status = 'pending'
        """
    )

    # Dedupe guard: at most one LIVE (pending/claimed/done) job per
    # (tenant, kind, input set). `kind` is IN the key, so the same targets
    # under a different kind are a distinct job. A failed job sits outside
    # the partial index, so it permits a fresh retry.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_jobs_live_input
            ON coord.memory_jobs (tenant_id, kind, input_hash)
            WHERE status IN ('pending', 'claimed', 'done')
        """
    )


def downgrade() -> None:
    """Restructure back to the synthesis-only queue.

    Lossy by nature: ``kind='embedding'`` jobs have no representation in
    the old shape and are DROPPED (they are transient work items, not
    durable memory — the reindex sweep re-enqueues whatever it still finds
    un-embedded). Synthesis results fold back to their flat text.
    """
    op.execute("DROP INDEX IF EXISTS coord.uq_memory_jobs_live_input")
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_jobs_pending")

    op.execute("DELETE FROM coord.memory_jobs WHERE kind = 'embedding'")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'coord' AND table_name = 'memory_jobs'
                  AND column_name = 'result'
            ) THEN
                ALTER TABLE coord.memory_jobs
                    ALTER COLUMN result TYPE TEXT
                    USING (
                        COALESCE(
                            result ->> 'result_text',
                            result ->> 'failure'
                        )
                    );
                ALTER TABLE coord.memory_jobs RENAME COLUMN result TO result_text;
            END IF;
        END $$
        """
    )
    op.execute(
        """
        ALTER TABLE coord.memory_jobs
            DROP CONSTRAINT IF EXISTS memory_jobs_kind_check
        """
    )
    op.execute("ALTER TABLE coord.memory_jobs DROP COLUMN IF EXISTS kind")

    # Mirror of the upgrade's constraint-name convergence.
    for new, old in (
        ("memory_jobs_pkey", "memory_synthesis_jobs_pkey"),
        ("memory_jobs_status_check", "memory_synthesis_jobs_status_check"),
        ("memory_jobs_tenant_id_fkey", "memory_synthesis_jobs_tenant_id_fkey"),
    ):
        op.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = '{new}'
                      AND conrelid = 'coord.memory_jobs'::regclass
                ) AND NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = '{old}'
                      AND conrelid = 'coord.memory_jobs'::regclass
                ) THEN
                    ALTER TABLE coord.memory_jobs
                        RENAME CONSTRAINT {new} TO {old};
                END IF;
            END $$
            """
        )

    for new, old in (
        ("target_ids", "member_ids"),
        ("input_texts", "member_texts"),
        ("input_hash", "member_set_hash"),
    ):
        op.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'coord' AND table_name = 'memory_jobs'
                      AND column_name = '{new}'
                ) THEN
                    ALTER TABLE coord.memory_jobs
                        RENAME COLUMN {new} TO {old};
                END IF;
            END $$
            """
        )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'coord' AND table_name = 'memory_jobs'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'coord'
                  AND table_name = 'memory_synthesis_jobs'
            ) THEN
                ALTER TABLE coord.memory_jobs RENAME TO memory_synthesis_jobs;
            END IF;
        END $$
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_synthesis_jobs_pending
            ON coord.memory_synthesis_jobs (tenant_id, created_at)
            WHERE status = 'pending'
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
            uq_memory_synthesis_jobs_live_member_set
            ON coord.memory_synthesis_jobs (tenant_id, member_set_hash)
            WHERE status IN ('pending', 'claimed', 'done')
        """
    )
