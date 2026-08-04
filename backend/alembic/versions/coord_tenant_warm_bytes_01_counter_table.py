"""coord tenant_warm_bytes — incremental warm-tier byte counter + backfill

Revision ID: coord_tenant_warm_bytes_01
Revises: memhold_adjudicate_02
Create Date: 2026-08-04

Phase 2a (the qontinui-web half) of plan
``D:/qontinui-root/plans/2026-07-28-coord-session-output-warm-quota-full-table-sum.md``.

Why
---

coord's ``tenant_warm_bytes`` quota check (``qontinui-coord``
``src/sessions.rs``) currently answers "how many warm bytes does this
tenant hold?" with a full aggregate::

    SELECT COALESCE(SUM(o.compressed_size), 0)::bigint
    FROM coord.session_output o
    JOIN coord.sessions s ON s.id = o.session_id
    WHERE s.tenant_id = $1

and it runs that **before every single appended chunk**. Phase 1 measured
it on prod (PG 16.13, ``db.m6g.xlarge``): a ``Parallel Seq Scan`` over
894,211 rows / 754 MB, **1367 ms execution, ``Buffers: shared hit=72461,
read=0``** — zero disk reads, so the cost is 100% CPU walking tuples and
**no access-path change (index, ``INCLUDE``, storage) can reduce it**.
``pg_stat_user_tables`` deltas put the call rate at 0.855 full-table
passes per second, continuously; it is the #1 consumer of production
database CPU (PI AAS 7.74–9.46, rank 1 in every window sampled).

The only fix that changes the growth curve is to stop recomputing the
aggregate. This revision creates the counter table that replaces it, and
seeds it from the current true SUM.

What lands
----------

``coord.tenant_warm_bytes(tenant_id UUID PRIMARY KEY, bytes BIGINT)`` —
one row per tenant, maintained incrementally by coord on every
``coord.session_output`` insert and delete. The quota check becomes a
single-row PK read.

Alembic is the sole author of ``coord.*`` schema (``coord_schema_authorship``):
this migration is the ONLY place this table is created. **coord must
issue zero DDL against it.**

Contract for the coord-side consumer (read this before writing the Rust)
------------------------------------------------------------------------

1. **A missing row means ZERO, never an error.** This migration
   back-fills exactly the tenants that have ``coord.session_output`` rows
   *right now*; every other tenant — including every tenant created after
   this migration applies — legitimately has **no row at all**. coord
   therefore MUST:

   * read with ``COALESCE``-style absence tolerance, e.g.
     ``SELECT COALESCE((SELECT bytes FROM coord.tenant_warm_bytes
     WHERE tenant_id = $1), 0)::bigint`` — a zero-row result is the
     correct answer ``0``, not a "missing counter" fault; and
   * write with an UPSERT, e.g.
     ``INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes)
     VALUES ($1, $2) ON CONFLICT (tenant_id)
     DO UPDATE SET bytes = coord.tenant_warm_bytes.bytes + EXCLUDED.bytes``
     — never a bare ``UPDATE``, which would silently no-op (zero rows
     affected) for a first-ever chunk and lose the bytes forever.

   The alternative contract — "a row exists for every tenant" — was
   rejected: it cannot be honored without a trigger or an insert on the
   tenant-creation path, i.e. it would make a *second* component
   responsible for this table's invariants, and it fails open (a tenant
   created between this migration and its first append would have no row
   and coord would fault on the hottest path in the system).

2. **``bytes`` is a signed ``BIGINT``, deliberately.** Measured prod
   ``SUM(compressed_size)`` is already **482,359,475** and
   ``coord.session_output.compressed_size`` is ``INTEGER`` — an
   ``INTEGER`` counter would be ~4.5× from overflow today and the sum of
   many ``INTEGER``s must be widened on principle. Signed (not "unsigned",
   which Postgres does not have anyway) so that an accounting bug is
   *representable* and therefore *detectable* by the constraint below,
   rather than wrapping.

3. **``CHECK (bytes >= 0)`` IS present — this is a behavioral contract,
   not decoration.** Both sides were weighed:

   * *Without the CHECK*, a decrement bug (a double-decrement, a delete
     path that decrements bytes some other path already removed) drives
     the counter negative and the quota **silently never trips** —
     unbounded warm-tier growth that nobody notices. That is the classic
     fail-open accounting outage.
   * *With the CHECK*, that same bug instead **hard-fails the
     transaction that over-decrements** — a FIFO eviction, a bulk warm
     GC, or a retention prune will error rather than corrupt the counter.
     That is louder and more disruptive in the moment.

   The CHECK is included. A quota counter going negative is a silent
   correctness failure in a correctness-bearing cap; failing loudly is
   strictly better, the failing statement is a *delete* path (retryable,
   and its work is re-attempted on the next tick rather than lost), and
   Phase 3's reconcile job exists precisely to recompute the true SUM and
   repair. Robustness outranks convenience here.

   **Consequence coord must design for:** a decrement must be clamped or
   the transaction must be prepared to fail. Prefer clamping at the
   statement — ``SET bytes = GREATEST(0, coord.tenant_warm_bytes.bytes - $2)``
   — only if you also emit a drift signal when the clamp bites; a silent
   clamp re-introduces exactly the fail-open hole the CHECK closes.

4. **FK to ``coord.tenants(tenant_id)`` ``ON DELETE CASCADE``.** Same
   shape as ``coord.tenant_policies`` (``coord_session_substrate``). Every
   ``tenant_id`` coord can reach here comes from
   ``coord.sessions.tenant_id``, which itself references
   ``coord.tenants(tenant_id) ON DELETE RESTRICT`` — so the referenced row
   is guaranteed to exist and the FK can never reject a legitimate
   UPSERT. It buys automatic cleanup of the counter row when a tenant is
   deleted, instead of an orphan that would be wrong the moment the
   tenant id were ever reused.

5. **No index beyond the PK.** Every access is a single-row lookup or
   UPSERT keyed on ``tenant_id``; the PK index serves both.

Backfill
--------

Seeded in this same migration from the current true SUM, grouped by
``s.tenant_id``. Phase 1 measured that scan at ~1.4 s against 894k rows
on prod — acceptable inside a migration and deliberately **not** batched;
batching would add moving parts to buy nothing at this size.

The backfill is ``ON CONFLICT (tenant_id) DO UPDATE SET bytes =
EXCLUDED.bytes`` (not ``DO NOTHING``), so a re-run re-seats every counter
to the recomputed truth. Note the deploy-window implication: if coord is
already maintaining the counter when this runs a second time, the SUM
wins — which is a repair, and is the same operation Phase 3's reconcile
performs.

Ordering note: this migration must be applied **before** the coord build
that reads the table ships (``coord_reads_new_column_without_web_migration``
— a coord read of a new ``coord.*`` object needs its qontinui-web
migration to land first).

Idempotency posture
===================

House style (``coord_session_substrate`` / ``coord_session_output_stream``):
``CREATE TABLE IF NOT EXISTS`` plus a ``DO $$ … IF NOT EXISTS … $$`` guard
for the CHECK constraint, so a re-run against an already-applied DB is a
no-op — including the case where the table exists but predates the named
constraint.

Downgrade
=========

Drops the table outright. Lossy only in the sense that the counter is a
*derived* value: it is fully reconstructible at any time from the
``SUM(compressed_size)`` aggregate this revision back-fills from, which
is exactly what the pre-counter coord code computes on every call. There
is no unrecoverable state here.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_tenant_warm_bytes_01"
down_revision: str = "memhold_adjudicate_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.tenant_warm_bytes`` and seed it from the true SUM."""
    # ----------------------------------------------------------------
    # 1. The counter table.
    #
    # * tenant_id  → PK, one row per tenant. FK CASCADE to coord.tenants
    #                mirrors coord.tenant_policies; see docstring point 4.
    # * bytes      → BIGINT. compressed_size is INTEGER and prod already
    #                sums to 4.8e8, so the aggregate must be widened.
    #                DEFAULT 0 lets a writer INSERT the key alone.
    # * CHECK      → bytes >= 0. Named so the DO block below can detect
    #                it, and so a violation names itself in the error.
    #                See docstring point 3 for why loud beats silent.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenant_warm_bytes (
            tenant_id   UUID PRIMARY KEY
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            bytes       BIGINT NOT NULL DEFAULT 0,
            CONSTRAINT tenant_warm_bytes_bytes_nonnegative
                CHECK (bytes >= 0)
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. Defensive: attach the CHECK if the table already existed
    #    without it. The inline constraint above is skipped entirely
    #    when CREATE TABLE IF NOT EXISTS no-ops, so this is the only
    #    thing that makes the constraint's presence unconditional.
    # ----------------------------------------------------------------
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord'
                   AND t.relname = 'tenant_warm_bytes'
                   AND c.conname = 'tenant_warm_bytes_bytes_nonnegative'
            ) THEN
                ALTER TABLE coord.tenant_warm_bytes
                    ADD CONSTRAINT tenant_warm_bytes_bytes_nonnegative
                    CHECK (bytes >= 0);
            END IF;
        END
        $$;
        """
    )

    # ----------------------------------------------------------------
    # 3. Document the absence contract in the database itself — coord
    #    readers land here long before they find this migration.
    # ----------------------------------------------------------------
    op.execute(
        """
        COMMENT ON TABLE coord.tenant_warm_bytes IS
            'Incremental per-tenant SUM(coord.session_output.compressed_size). '
            'ABSENCE OF A ROW MEANS ZERO — read with COALESCE, write with '
            'INSERT ... ON CONFLICT (tenant_id) DO UPDATE, never a bare UPDATE. '
            'Maintained by qontinui-coord in the same transaction as every '
            'session_output insert/delete; reconciled against the true SUM by '
            'the Phase 3 drift job. Alembic is the sole author of this schema.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.tenant_warm_bytes.bytes IS
            'Signed BIGINT (compressed_size is INTEGER; prod sum is already '
            '4.8e8). CHECK (bytes >= 0) makes an over-decrement fail the '
            'transaction loudly rather than fail the quota open.'
        """
    )

    # ----------------------------------------------------------------
    # 4. Backfill from the current true SUM — the exact aggregate this
    #    table replaces. Only tenants that hold session_output rows get
    #    a row; everyone else is correctly represented by absence.
    #
    #    ~1.4 s / 894k rows on prod (Phase 1 measurement). Deliberately
    #    unbatched. DO UPDATE (not DO NOTHING) so a re-run re-seats the
    #    counter to recomputed truth.
    # ----------------------------------------------------------------
    op.execute(
        """
        INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes)
        SELECT s.tenant_id, COALESCE(SUM(o.compressed_size), 0)::bigint
        FROM coord.session_output o
        JOIN coord.sessions s ON s.id = o.session_id
        GROUP BY s.tenant_id
        ON CONFLICT (tenant_id) DO UPDATE SET bytes = EXCLUDED.bytes
        """
    )


def downgrade() -> None:
    """Drop ``coord.tenant_warm_bytes``.

    Safe: the counter is a derived value, fully reconstructible from
    ``SUM(coord.session_output.compressed_size)`` grouped by tenant —
    which is precisely what the pre-counter coord code computes on every
    quota check. Downgrading past this revision therefore only makes
    sense alongside a coord rollback to the aggregate-per-call build.
    """
    op.execute("DROP TABLE IF EXISTS coord.tenant_warm_bytes")
