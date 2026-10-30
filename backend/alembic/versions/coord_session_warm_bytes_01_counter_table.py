"""coord session_warm_bytes — incremental per-session warm byte counter + backfill

Revision ID: coord_session_warm_bytes_01
Revises: journey_04_explorations_stop_detail_any_stop
Create Date: 2026-10-30

Phase 1 (the qontinui-web half) of plan
``qontinui-dev-notes/plans/2026-10-30-coord-session-output-per-session-warm-sum-scans-the-session-on-every-chunk.md``.
Sibling of ``coord_tenant_warm_bytes_01``, which did the same for the TENANT
total; read that revision's docstring for the full counter contract — this one
restates only what differs.

``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is deliberately NOT pinned: ``alembic-graph-pr.yml`` serialises alembic PRs, so
any revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head (together with ``_PARENT_REVISION_ID`` in
``tests/test_coord_session_warm_bytes_01_migration.py``). Re-point it; never
author an ``alembic merge`` revision for it.

Why
---

After every appended output chunk, coord's ``enforce_warm_session_fifo``
(``qontinui-coord`` ``crates/coord/src/sessions.rs``) asks "how many warm bytes
does THIS session hold?" with::

    SELECT COALESCE(SUM(compressed_size), 0)::bigint
    FROM coord.session_output WHERE session_id = $1

The predecessor plan recorded that as "bounded by one session; not the hot
cost". Sessions now carry 20k–131k warm chunks, and on 2026-10-30 Performance
Insights put this statement at **1.23 AAS, the #2 statement** on the prod RDS
(``db.m6g.xlarge``, 4 vCPU): ``coord.session_output`` held 4.56 M live rows /
1.1 GB of heap across 401 sessions, took ~10.8 chunk inserts/s, and one
``EXPLAIN (ANALYZE, BUFFERS)`` of the SUM for the 131k-chunk session read
``shared read=82325`` (~643 MB) in 322 ms. The cost is O(chunks in the
session) per chunk appended. This revision creates the counter that replaces
the per-chunk SUM and seeds it from the current true SUM.

What lands
----------

``coord.session_warm_bytes(session_id UUID PRIMARY KEY, bytes BIGINT)`` — one
row per session, maintained incrementally by coord (Phase 2) in the same
statement as every ``coord.session_output`` insert and delete, alongside
``coord.tenant_warm_bytes``.

Alembic is the sole author of ``coord.*`` schema (``coord_schema_authorship``):
this migration is the ONLY place this table is created. **coord must issue
zero DDL against it.**

Contract for the coord-side consumer
------------------------------------

Identical to ``coord.tenant_warm_bytes`` (see ``coord_tenant_warm_bytes_01``
points 1–3), keyed by session instead of tenant:

1. **A missing row means ZERO, never an error.** The backfill seeds exactly the
   sessions holding ``coord.session_output`` rows when it runs; every other
   session — including every session registered afterwards — has no row.
   **Increments UPSERT** (``INSERT … ON CONFLICT (session_id) DO UPDATE SET
   bytes = coord.session_warm_bytes.bytes + EXCLUDED.bytes``); **decrements are
   a bare ``UPDATE``** clamped with ``GREATEST(0, …)``, which can never create a
   row and therefore can never write a negative one. Why decrements must not be
   upserts is spelled out in ``coord_tenant_warm_bytes_01`` point 3.
2. **``bytes`` is a signed ``BIGINT``.** ``compressed_size`` is ``INTEGER`` and prod's
   warm total is already 902 MB; a sum of many ``INTEGER``s is widened on
   principle, whatever one session holds today.
3. **``CHECK (bytes >= 0)``**, named ``session_warm_bytes_bytes_nonnegative``,
   is the backstop against an unclamped writer; the clamp-bite drift signal is
   the primary detector (same reasoning as the tenant counter).
4. **FK to ``coord.sessions(id)`` ``ON DELETE CASCADE``.** Every
   ``session_output`` row already references ``coord.sessions(id)``, so the
   referenced row exists for every legitimate write. The cascade is what keeps
   the counter correct for every ``DELETE FROM coord.sessions`` (the closed-
   session prune, ``retract_expected_session``) with no coord code at all.
5. **No index beyond the PK.** Every access is a single-row lookup or UPSERT
   keyed on ``session_id``.

Why the backfill runs OUTSIDE the DDL transaction (unlike the predecessor)
--------------------------------------------------------------------------

The inline ``REFERENCES coord.sessions(id)`` takes a **SHARE ROW EXCLUSIVE**
lock on ``coord.sessions``, and ``env.py`` runs a whole upgrade batch in ONE
transaction, so that lock is held until the batch commits. SHARE ROW EXCLUSIVE
conflicts with ROW EXCLUSIVE — every ``INSERT``/``UPDATE``/``DELETE`` on
``coord.sessions``: session registration, heartbeats, status writes, the prune.
An inline backfill would hold it for the whole 4.56 M-row / 1.1 GB scan,
blocking every one of those for its duration. The predecessor got away with an
inline backfill because its lock was on the cold ``coord.tenants`` table and its
scan was 894k rows (~1.4 s); neither holds here.

So the upgrade is two parts:

* **DDL, in the batch transaction**, bounded by ``SET LOCAL lock_timeout =
  '3s'``: ``CREATE TABLE`` + ``COMMENT``s. Brief.
* **Backfill, inside ``op.get_context().autocommit_block()``** (precedent:
  ``agent_questions_alert_episode_01``). Entering the block COMMITS the batch
  transaction — releasing the ``coord.sessions`` lock — and each statement in it
  then commits on its own. The backfill ``INSERT`` takes only ACCESS SHARE on
  ``coord.session_output`` (conflicts with nothing but ACCESS EXCLUSIVE, so
  coord keeps appending throughout) plus a per-row FK check (``FOR KEY SHARE`` on
  each referenced ``coord.sessions`` row, which conflicts only with a DELETE or a
  key update of that one session).

Timeouts inside the autocommit block. ``SET LOCAL`` is a no-op outside a
transaction block, so the block uses a SESSION-level ``SET lock_timeout =
'3s'``; ``env.py``'s ``_reset_revision_settings`` hook issues ``RESET
lock_timeout`` after this revision, so it does not reach later revisions.
``lock_timeout`` also bounds row-lock waits, so the FK check fails fast rather
than queueing behind a prune. **No ``statement_timeout`` is set**: the backfill
is one whole-table scan (~1.1 GB heap; the measured 643 MB per-session SUM read
took 322 ms, so the full scan should be well under a minute, but a cold disk at
the 3000-IOPS ceiling can stretch it) and a bound tight enough to matter could
kill a scan that would have finished. The migrator connection's own default
governs, the same posture as ``coord_iops_idx_01``'s multi-minute
``CONCURRENTLY`` builds.

Consequences, stated rather than discovered:

* **A failed backfill leaves the DDL committed and the revision UNSTAMPED.**
  ``alembic_version`` is written after ``upgrade()`` returns, so a re-run
  re-enters this revision: ``CREATE TABLE IF NOT EXISTS`` no-ops and the
  backfill runs again. Safe because every step is idempotent (below).
* **A session pruned between the backfill's scan and its FK check aborts the
  backfill** with a foreign-key violation. Loud, not silent; re-run the
  migration. Same for a lock wait over 3 s.
* **The seed starts rotting immediately.** Between this backfill and the Phase 2
  coord build actually SERVING, the old build keeps inserting into and deleting
  from ``coord.session_output`` without maintaining this counter (the
  predecessor's equivalent window carried ~94 MB of drift). Under-counting makes
  the 10 MiB per-session FIFO trip late; over-counting makes it flush/evict
  early. **Only Phase 2.4's startup reconcile repairs this window** — it is why
  2.4 ships in the SAME coord change as 2.1–2.3. A coord deploy can be debounced
  (``coord_deploy_success_can_mean_debounced_not_shipped``), so "serving" is
  confirmed by a feature marker, not a green workflow.

Ordering note
-------------

This migration must be applied (and deployed) BEFORE the coord build that reads
the table ships (``coord_reads_new_column_without_web_migration``). coord's
Phase 2 additionally degrades on a missing table (``is_missing_session_warm_counter``).

Idempotency posture
===================

``CREATE TABLE IF NOT EXISTS``; the backfill is ``ON CONFLICT (session_id) DO
UPDATE SET bytes = EXCLUDED.bytes`` (re-seats every counter to the recomputed
truth, i.e. a repair — and, against a live coord, lossy in exactly the way
``coord_tenant_warm_bytes_01`` describes); a ``DO $$ … IF NOT EXISTS … $$``
guard attaches the CHECK when the table pre-existed without it.

**Statement order is load-bearing: the backfill runs BEFORE the constraint
guard**, for the predecessor's reason: ``ADD CONSTRAINT … CHECK`` validates
existing rows, so adding it first would make the re-run that repairs a
NEGATIVE counter abort before reaching the backfill. On a fresh install the
inline CHECK is already in force and the seed satisfies it (a ``SUM()`` of
``NOT NULL`` non-negative ``INTEGER``s). As with the tenant counter, the guard
covers the CHECK only — the PK, the FK and the column types have no equivalent
guard against an out-of-band table of the same name.

Downgrade
=========

Drops the table outright. The counter is derived — fully reconstructible from
``SUM(coord.session_output.compressed_size)`` grouped by session, which is what
the pre-counter coord code computes on every chunk — so nothing unrecoverable is
lost. Only meaningful alongside a coord rollback to the SUM-per-chunk build.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "coord_session_warm_bytes_01"
down_revision: str = "journey_04_explorations_stop_detail_any_stop"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.session_warm_bytes``, then seed it outside the DDL txn."""
    # ----------------------------------------------------------------
    # 0. Bound the DDL's lock waits. The inline REFERENCES below takes
    #    SHARE ROW EXCLUSIVE on coord.sessions — the table behind every
    #    session registration and heartbeat — so fail fast rather than
    #    queue a conflicting lock in front of coord's session path. The
    #    bound ends when the autocommit block below commits this
    #    transaction; env.py's reset hook covers the rest.
    # ----------------------------------------------------------------
    op.execute("SET LOCAL lock_timeout = '3s'")

    # ----------------------------------------------------------------
    # 1. The counter table.
    #
    # * session_id → PK, one row per session. FK CASCADE to
    #                coord.sessions(id): docstring point 4.
    # * bytes      → BIGINT (compressed_size is INTEGER). DEFAULT 0 lets a
    #                writer INSERT the key alone.
    # * CHECK      → bytes >= 0, named so the guard in step 4 can find it
    #                and a violation names itself.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_warm_bytes (
            session_id  UUID PRIMARY KEY
                REFERENCES coord.sessions(id) ON DELETE CASCADE,
            bytes       BIGINT NOT NULL DEFAULT 0,
            CONSTRAINT session_warm_bytes_bytes_nonnegative
                CHECK (bytes >= 0)
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. Document the absence contract in the database itself.
    # ----------------------------------------------------------------
    op.execute(
        """
        COMMENT ON TABLE coord.session_warm_bytes IS
            'Incremental per-session SUM(coord.session_output.compressed_size). '
            'ABSENCE OF A ROW MEANS ZERO - read with COALESCE. Increments are '
            'INSERT ... ON CONFLICT (session_id) DO UPDATE (never a bare UPDATE); '
            'decrements are a bare clamped UPDATE (never an upsert). Maintained '
            'by qontinui-coord in the same statement as every session_output '
            'insert/delete; repaired by coord''s warm-counter reconcile. Alembic '
            'is the sole author of this schema.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_warm_bytes.bytes IS
            'Signed BIGINT (compressed_size is INTEGER). CHECK (bytes >= 0) '
            'makes an over-decrement fail the statement loudly rather than '
            'fail the per-session FIFO cap open.'
        """
    )

    # ----------------------------------------------------------------
    # Everything below runs OUTSIDE the batch transaction. Entering the
    # block COMMITS it, releasing the SHARE ROW EXCLUSIVE lock on
    # coord.sessions before the 1.1 GB scan starts (docstring, "Why the
    # backfill runs OUTSIDE the DDL transaction").
    # ----------------------------------------------------------------
    with op.get_context().autocommit_block():
        # SET LOCAL is a no-op without a transaction block, so this is a
        # session-level SET; env.py's _reset_revision_settings RESETs it
        # after this revision. It also bounds the FK check's row-lock waits.
        # No statement_timeout on purpose: docstring, "Timeouts".
        op.execute("SET lock_timeout = '3s'")

        # ------------------------------------------------------------
        # 3. Backfill from the current true SUM — the exact aggregate
        #    this table replaces. Only sessions that hold session_output
        #    rows get a row; every other session is correctly absent.
        #
        #    THIS RUNS BEFORE THE CONSTRAINT GUARD BELOW, deliberately:
        #    ADD CONSTRAINT ... CHECK validates existing rows, so a re-run
        #    meant to repair a NEGATIVE counter would otherwise abort
        #    before reaching this repair.
        #
        #    A session pruned mid-scan aborts this with an FK violation
        #    (loud; re-run — DO UPDATE makes the re-run a re-seat).
        # ------------------------------------------------------------
        op.execute(
            """
            INSERT INTO coord.session_warm_bytes (session_id, bytes)
            SELECT o.session_id, SUM(o.compressed_size)::bigint
            FROM coord.session_output o
            GROUP BY o.session_id
            ON CONFLICT (session_id) DO UPDATE SET bytes = EXCLUDED.bytes
            """
        )

        # ------------------------------------------------------------
        # 4. Defensive: attach the CHECK if the table already existed
        #    without it (CREATE TABLE IF NOT EXISTS skips its inline
        #    constraint when it no-ops). Covers the CHECK only.
        # ------------------------------------------------------------
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
                       AND t.relname = 'session_warm_bytes'
                       AND c.conname = 'session_warm_bytes_bytes_nonnegative'
                ) THEN
                    ALTER TABLE coord.session_warm_bytes
                        ADD CONSTRAINT session_warm_bytes_bytes_nonnegative
                        CHECK (bytes >= 0);
                END IF;
            END
            $$;
            """
        )


def downgrade() -> None:
    """Drop ``coord.session_warm_bytes``.

    Safe: the counter is a derived value, fully reconstructible from
    ``SUM(coord.session_output.compressed_size)`` grouped by session.
    """
    # Dropping a table that carries an FK also locks the REFERENCED table
    # (coord.sessions), so fail fast rather than queue an exclusive request
    # in front of coord's session path. env.py's hook resets the bound.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS coord.session_warm_bytes")
