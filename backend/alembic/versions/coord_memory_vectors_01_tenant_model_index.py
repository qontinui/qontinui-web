"""coord.memory_records — index the per-tenant embedding-model probe

Revision ID: coord_memory_vectors_01
Revises: coord_memory_jobs_01
Create Date: 2026-07-17

Phase 4 of ``2026-07-13-runner-paid-embedding``.

Phase 4 flips the deployed embedding tag to the runner's
(``minilm-l6-v2-256@sentence-transformers``) and, because Phase 0 found
the old and new spaces NOT interchangeable, makes the transition ATOMIC
per tenant: ``POST /memory/query`` skips the cosine arm entirely
(``vector_arm='skipped_migrating'``) while a tenant still holds vectors
at a non-deployed tag, rather than scoring a new-space query against
old-space documents.

That check (``memory_store.has_unmigrated_vectors``) runs on EVERY query
that carries a vector, so it has to be near-free. This migration adds the
index that makes it so.

Why this shape
==============

The probe asks "does this tenant have any SCORABLE row whose
``embedding_model`` is not the deployed tag?" — expressed as three
boundary predicates (``embedding_model < :tag``, ``> :tag``,
``IS NULL``) rather than ``IS DISTINCT FROM :tag``, because only
boundaries can terminate an index scan early. With this index each
branch is a seek to the first potentially-disqualifying entry: O(log n),
independent of how many rows the tenant has.

* Columns ``(tenant_id, embedding_model)``: tenant equality then the
  model boundary — exactly the probe's access path.
* Partial on ``is_tombstone = false AND embedding IS NOT NULL``: the
  probe only cares about rows the cosine arm could actually score. This
  also keeps the index small — since Phase 2 the bridge sweep lands rows
  with ``embedding = NULL`` by design, and none of them belong here.

The predicate columns are mutable (a row gains a vector when the runner
posts one, or is tombstoned); Postgres moves rows in and out of a partial
index on UPDATE, which is the intended behaviour — a row leaving the
index is a row the probe no longer needs to consider.

No data migration. The tag flip itself needs none: ``fetch_reindex_batch``
targets rows whose ``embedding_model`` differs from the deployed tag, so
changing the constant is what sweeps the existing ``@fastembed`` rows into
the runner-paid embedding queue to be re-embedded.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "coord_memory_vectors_01"
down_revision = "coord_memory_jobs_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the partial (tenant_id, embedding_model) index."""
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_tenant_model_scorable
            ON coord.memory_records (tenant_id, embedding_model)
            WHERE is_tombstone = false AND embedding IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the index. The probe still answers correctly without it."""
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_records_tenant_model_scorable")
