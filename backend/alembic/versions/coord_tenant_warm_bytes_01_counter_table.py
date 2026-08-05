"""coord tenant_warm_bytes — incremental warm-tier byte counter + backfill

Revision ID: coord_tenant_warm_bytes_01
Revises: coord_primary_trees_selfheal_backfill
Create Date: 2026-08-04

Phase 2a (the qontinui-web half) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-07-28-coord-session-output-warm-quota-full-table-sum.md``.

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

   **Resolution recorded after the coord side shipped: that UPSERT
   mandate is scoped to INCREMENTS. coord's decrements are a bare
   ``UPDATE``, deliberately, and that is the better shape.** The rule
   above was derived from one failure — a first-ever chunk losing its
   bytes — and that is an *increment* failure. For a decrement the
   asymmetry inverts. An absent row already reads as zero, so there is
   nothing to decrement; an INSERT arm can only write a negative value
   (rejected by ``tenant_warm_bytes_bytes_nonnegative``, which aborts the
   whole statement — the 5-minute ``prune_closed_sessions`` and hourly
   ``gc_warm_output`` sweeps would then fail on *every tick* until some
   append happened to create the row) or a meaningless clamped zero that
   makes ``EXCLUDED.bytes`` useless on the conflict arm, per point 3
   below. A bare ``UPDATE`` matches nothing, affects zero rows, and can
   never create a counter row — which is exactly the wanted behaviour.
   So the shipped contract is: **increments UPSERT, decrements
   ``UPDATE``**, pinned in ``qontinui-coord``'s ``src/sessions.rs`` by
   ``a_tenant_with_no_counter_row_reads_zero_and_the_first_append_creates_it``
   and
   ``a_delete_path_on_a_tenant_with_no_counter_row_never_violates_the_check``.
   Both shapes are safe; this note exists because the seventh mutation
   path's author will read this migration before reading that code, and
   an unqualified "never a bare ``UPDATE``" points them at the one shape
   that wedges both sweeps. (The abbreviated ``COMMENT ON TABLE`` below
   carries the same increment-scoped wording, for the same reason it is
   worth stating here.)

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

   **Consequence coord must design for: any decrement written as an
   upsert must be clamped on BOTH arms.** (coord's shipped decrements are
   a bare ``UPDATE`` and so sidestep this entirely — see the resolution
   note under point 1. The analysis below is why: it is what makes the
   upsert form unattractive for a decrement in the first place, and it
   remains the trap for anyone who reaches for one anyway.) Clamping only
   the ``DO UPDATE`` arm is a trap, and the natural symmetric decrement is
   exactly the shape that falls into it::

       -- WRONG. $2 is negative; the DO UPDATE arm is clamped, the
       -- INSERT arm is not.
       INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE
         SET bytes = GREATEST(0, coord.tenant_warm_bytes.bytes + EXCLUDED.bytes)

   When the row is **absent** the conflict action never runs: the INSERT
   arm writes the negative value straight in, the CHECK rejects it and
   the whole transaction aborts. That is reachable in ordinary operation,
   not a corner case — the backfill below seeds only the tenants holding
   ``coord.session_output`` rows *at apply time*, so a tenant created
   afterwards whose first counter interaction is a **delete** (the
   5-minute ``prune_closed_sessions`` sweep, the hourly
   ``gc_warm_output``) hits it on every single tick. Write it fully
   clamped instead::

       INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes)
       VALUES ($1, GREATEST(0, $2))
       ON CONFLICT (tenant_id) DO UPDATE
         SET bytes = GREATEST(0, coord.tenant_warm_bytes.bytes + $2)

   **Note what the ``DO UPDATE`` arm adds: ``$2``, NOT
   ``EXCLUDED.bytes``.** ``EXCLUDED`` carries the row the INSERT arm
   *would have* written — which is the already-clamped
   ``GREATEST(0, $2)``, i.e. **0 for every decrement**. An
   ``EXCLUDED``-based update therefore adds nothing and silently drops
   the decrement on the conflict path, which is the *common* path once a
   tenant is seeded. That is a worse failure than the CHECK violation it
   was meant to avoid: it is silent, it is permanent, and it fails OPEN
   (the counter only ever grows, so the quota eventually wedges the
   tenant). ``coord.tenant_warm_bytes.bytes`` names the pre-update row
   and ``$2`` the true delta, so this form is correct on both arms and in
   both directions. (Verified, not assumed:
   ``tests/test_coord_tenant_warm_bytes_01_migration.py`` runs both
   shapes against a real database.)

   Emit a drift signal whenever a clamp bites; a silent clamp
   re-introduces exactly the fail-open hole the CHECK closes.

   **Mandating the clamp reverses the roles of the two detectors.** On a
   writer that clamps both arms the CHECK is unreachable *by
   construction*: it can only ever fire for a writer that forgot to
   clamp, or for a mutation path added later that nobody audited. So the
   CHECK is a **backstop** against an unclamped writer — not the
   day-to-day detector this point sold it as — and the **drift signal is
   the primary detector**. It is the signal that must be wired to an
   alert and watched; a permanently silent CHECK is the expected steady
   state, so its silence proves nothing on its own.

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

``DO UPDATE`` is the right choice, but it has two properties that are not
obvious and that the re-run above walks straight into:

* **It is lossy against a LIVE coord.** The ``SELECT`` snapshots
  ``coord.session_output`` at statement time, so anything coord commits
  between that snapshot and the write is overwritten by the older sum. A
  re-run therefore re-seats each counter to "truth as of the snapshot",
  not to truth — against a live writer it can *introduce* drift rather
  than remove it. **Phase 3's reconcile inherits this exactly**: it must
  not be a naive SUM-then-write either.
* **It holds a row lock until the whole batch commits.** ``env.py`` runs
  every pending migration inside ONE enclosing transaction, and Phase 1
  measured a single tenant holding 99.9997% of the rows — so ``DO
  UPDATE`` takes a row lock on effectively *the* hot row and keeps it for
  the duration of the entire migration batch, not just this statement.
  Harmless on the first run (the table is invisible outside this
  transaction, so nothing can contend for it); a real hazard on the
  re-run this section advertises, where coord is live and hitting that
  same row on every appended chunk.

Ordering note — this cuts BOTH ways
-----------------------------------

**Forward:** this migration must be applied *before* the coord build that
reads the table ships (``coord_reads_new_column_without_web_migration`` —
a coord read of a new ``coord.*`` object needs its qontinui-web migration
to land first).

**Backward, and this is the direction that actually costs something:**
the seed is true *at apply time* and immediately starts rotting. Between
this migration applying and the new coord build actually **serving**, the
OLD build keeps inserting into and deleting from ``coord.session_output``
without maintaining the counter. Inserts in that window leave the counter
*under*-counting (the quota trips late — annoying). **Deletes leave it
over-counting, and over-counting fails CLOSED**: the quota check sees
bytes the tenant no longer holds, returns 429 ``warm_quota_exceeded``,
and live session output is DROPPED.

That window is not reliably short. coord deploys **debounce**, so a green
"Deploy coord" run can mean nothing shipped at all
(``coord_deploy_success_can_mean_debounced_not_shipped``); the serving
build has to be confirmed by a feature marker, never by a green workflow.

So: a **reconcile must run once the new coord build is confirmed
serving** — that is the Phase 3 drift job, and it is precisely why
Phase 3 ships *together with* Phase 2 rather than after it.

Idempotency posture
===================

House style (``coord_session_substrate`` / ``coord_session_output_stream``):
``CREATE TABLE IF NOT EXISTS`` plus a ``DO $$ … IF NOT EXISTS … $$`` guard
for the CHECK constraint, so a re-run against an already-applied DB is a
no-op — including the case where the table exists but predates the named
constraint.

**Statement order is load-bearing: the backfill runs BEFORE the constraint
guard.** ``ALTER TABLE … ADD CONSTRAINT … CHECK`` *validates existing rows*.
This docstring advertises a re-run as the repair for a drifted counter — but
the drift actually worth repairing is a counter that has gone **negative**,
and with the constraint added first that re-run aborts on validation before
ever reaching the backfill that would have fixed it. Seeding first is what
makes the advertised repair reachable. (The alternative — ``ADD CONSTRAINT
… NOT VALID`` followed by a separate ``VALIDATE CONSTRAINT`` after the
backfill — buys the same reachability at the cost of a second statement and
a window in which the constraint exists unvalidated; simple reordering was
preferred.)

On a **fresh install** the inline CHECK in ``CREATE TABLE`` is already in
force when the backfill runs, so the reorder does not weaken that path — and
the seed cannot violate it: it is ``SUM()`` over ``NOT NULL`` non-negative
``INTEGER``s, which is non-negative by construction.

Residual, stated honestly: a tenant whose counter is negative *and* which
holds no ``coord.session_output`` rows is not in the seed's ``GROUP BY`` at
all (absence means zero — no row is written for it), so the constraint add
still rejects it. Such a row is corrupt beyond what a re-seed can express
and has to be deleted by hand.

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
down_revision: str = "coord_primary_trees_selfheal_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.tenant_warm_bytes`` and seed it from the true SUM."""
    # ----------------------------------------------------------------
    # 0. Bound every lock acquisition in this migration.
    #
    # Same guard, and the same reasoning, as coord_sessions_drop_plan_slug:
    # the CREATE TABLE below carries an inline REFERENCES coord.tenants,
    # which takes a SHARE ROW EXCLUSIVE lock on coord.tenants — the table
    # behind every session registration — and env.py runs the whole batch
    # in ONE transaction, so that lock is held until the batch commits.
    # Fail fast instead of stalling coord's session hot path behind one
    # slow in-flight query.
    # ----------------------------------------------------------------
    op.execute("SET LOCAL lock_timeout = '3s'")

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
    # 2. Document the absence contract in the database itself — coord
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
    # 3. Backfill from the current true SUM — the exact aggregate this
    #    table replaces. Only tenants that hold session_output rows get
    #    a row; everyone else is correctly represented by absence.
    #
    #    ~1.4 s / 894k rows on prod (Phase 1 measurement). Deliberately
    #    unbatched. DO UPDATE (not DO NOTHING) so a re-run re-seats the
    #    counter to recomputed truth.
    #
    #    THIS RUNS BEFORE THE CONSTRAINT GUARD BELOW, deliberately.
    #    ADD CONSTRAINT ... CHECK validates existing rows, so on the
    #    re-run this migration advertises as the repair for a counter
    #    that has drifted NEGATIVE, adding the constraint first would
    #    abort on validation before the backfill that repairs it ever
    #    ran. On a fresh install the inline CHECK from step 1 is already
    #    in force here and the seed still satisfies it: a SUM() over
    #    NOT NULL non-negative INTEGERs cannot be negative.
    #
    #    Two properties of DO UPDATE worth knowing (docstring, Backfill):
    #    it snapshots session_output at statement time, so it is LOSSY
    #    against a live coord; and it holds a row lock on the hot tenant
    #    (99.9997% of rows) until the whole migration batch commits.
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

    # ----------------------------------------------------------------
    # 4. Defensive: attach the CHECK if the table already existed
    #    without it. CREATE TABLE IF NOT EXISTS skips its inline
    #    constraint entirely when it no-ops, so this block is what makes
    #    THIS CHECK's presence unconditional.
    #
    #    Scope of that claim, precisely: it covers the CHECK and nothing
    #    else. The PK, the FK to coord.tenants, the NOT NULL and the
    #    BIGINT width have NO equivalent guard — if coord.tenant_warm_bytes
    #    already existed in a different shape, CREATE TABLE IF NOT EXISTS
    #    silently no-ops and this migration reports success against a
    #    wrong table. alembic is the sole author of coord.* schema
    #    (coord_schema_authorship), so such a table can only come from an
    #    out-of-band hand edit; this guard is not a substitute for that
    #    authorship rule.
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
    # 5. Release the lock bound.
    #
    # env.py runs every pending migration in ONE enclosing transaction,
    # so without a reset this SET LOCAL would silently apply to any
    # migration that runs after this one in the same batch (e.g. a
    # fresh-DB replay). Reset at the END rather than straight after the
    # DDL, deliberately: the backfill's ON CONFLICT DO UPDATE contends
    # for the hot tenant's row on a re-run against a live coord, and
    # failing fast there is wanted too.
    # ----------------------------------------------------------------
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop ``coord.tenant_warm_bytes``.

    Safe: the counter is a derived value, fully reconstructible from
    ``SUM(coord.session_output.compressed_size)`` grouped by tenant —
    which is precisely what the pre-counter coord code computes on every
    quota check. Downgrading past this revision therefore only makes
    sense alongside a coord rollback to the aggregate-per-call build.
    """
    # Same bound as the upgrade: dropping a table that carries an FK also
    # locks the REFERENCED table (coord.tenants), so fail fast rather than
    # queue an ACCESS EXCLUSIVE request in front of coord's session path.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS coord.tenant_warm_bytes")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
