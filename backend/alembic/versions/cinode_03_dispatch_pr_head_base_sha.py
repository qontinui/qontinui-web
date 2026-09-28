"""runner-as-CI-node — coord.ci_dispatches.pr_head_sha / base_sha + no_subscriber index

Revision ID: cinode_03_dispatch_pr_head_base_sha
Revises: coord_sessev_interact_idx_01
Create Date: 2026-09-28

Phase 2 (web DDL half) of plan
``2026-09-27-ci-node-shadow-dispatch-never-passes-checkout-race-lost-leases-unfiltered-selection``.

Why
==========================================================================

coord's ci_node shadow dispatch keys its supersede logic ("cancel the live
dispatch for this proposal when a newer head arrives") and its
``no_subscriber`` throttle on ``coord.ci_dispatches.head_sha``. That column
holds the DRY-REBASED tip — the candidate commit coord builds by rebasing the
PR head onto ``origin/<base>``. qontinui-coord ``merge_scheduler.rs``
``dry_rebase_in_worktree_with_fallback`` runs
``git rebase --onto origin/<base> origin/<base> HEAD`` with no pinned
``GIT_COMMITTER_DATE``, so every replayed commit takes the wall-clock
committer date. For a PR that is not already a fast-forward of its base the
tip therefore gets a NEW sha on every merge tick, even when neither the PR
nor its base moved. From ``head_sha`` alone
coord therefore cannot tell "a newer PR head" from "the same PR re-rebased",
and it supersedes (and re-dispatches) a build that should have been left
alone.

The two inputs of the rebase are stable where its output is not:

* ``pr_head_sha TEXT NULL`` — the PR branch head the dispatch was built from.
  It moves only when the author pushes.
* ``base_sha TEXT NULL`` — the ``origin/<base>`` sha it was rebased onto. It
  moves only when the base branch lands something.

``(pr_head_sha, base_sha)`` equal ⇒ the same candidate, whatever ``head_sha``
says. Both are NULL for every pre-existing row (the ledger never recorded
them), so both are nullable. Requirement on the coord consumer (not yet
written when this revision was authored): it MUST treat NULL as "unknown",
never as a match, so a pre-existing row is never judged the same candidate
as a new dispatch.

Each carries a CHECK that the value is NULL or a lowercase 40-hex git sha
(``^[0-9a-f]{40}$``). An abbreviated or upper-case sha would never compare
equal to the full one coord writes next tick, which is exactly the "looks
new every time" defect this revision exists to remove, so it is refused at
write time.

The ``no_subscriber`` index
==========================================================================

Plan Phase 3 step 3: when the ``build_requested`` publish reaches zero
receivers, coord cancels the row at once with ``state = 'cancelled'`` and
``summary.reason = 'no_subscriber'`` (``cancelled`` + a structured
``summary.reason`` is the plan's resolved vocabulary, vet finding C4 — the
ledger has no ``reason`` column, ``cinode_01_dispatch_ledger``). The throttle
then asks, per candidate device, "did this device have a ``no_subscriber``
cancel in the last N seconds?"::

    SELECT EXISTS (
        SELECT 1 FROM coord.ci_dispatches
         WHERE device_id = $1
           AND state = 'cancelled'
           AND summary ->> 'reason' = 'no_subscriber'
           AND completed_at > now() - make_interval(secs => $2))

``idx_ci_dispatches_no_subscriber_device`` is ``(device_id, completed_at)``
restricted to exactly those rows, so the probe is one index descent. The
predicate must be written the same way in the query (``state = 'cancelled'
AND summary ->> 'reason' = 'no_subscriber'``) for the planner to match the
partial index.

``tenant_id`` is carried as an ``INCLUDE`` column, not a key. The selection
query that drives the probe is tenant-scoped, but "no subscriber" is a fact
about the DEVICE's event subscription — a device bound to two tenants that
dropped its subscription is unreachable for both — so the throttle keys on
``device_id``. ``INCLUDE (tenant_id)`` lets a tenant-scoped variant of the
probe stay an index-only scan without making the device-level one pay for a
second key column.

Shape: additive ONLY, for coord's merge-time classifier
==========================================================================

Shaped to pass qontinui-coord ``pr_merge/migration_classifier.rs`` so it
auto-lands, following ``coord_sessev_interact_idx_01`` /
``coord_alerts_claim_01``:

* each CHECK is declared INLINE on its ``ADD COLUMN IF NOT EXISTS``, not as a
  separate catalog-guarded ``ADD CONSTRAINT``. A catalog guard needs a
  ``DO $$ … $$`` block, which the classifier refuses outright ("dollar-quoted
  string (lexer cannot delimit; fail-closed)"), and a bare ``ADD CONSTRAINT``
  must be ``NOT VALID`` and is not re-runnable. The inline form is re-runnable
  and atomic: on a re-run the whole column clause, constraint included, is
  skipped. Its one gap — a column that already exists WITHOUT the constraint
  (someone hand-added it) keeps lacking it — cannot arise from this ledger's
  history, since Rust authors zero coord DDL. The validation scan is over a
  column that is NULL on every existing row; measured read-only on prod
  2026-09-28, the ledger held 1984 rows and 2.1 MB in total
  (``pg_total_relation_size``), newest row 2026-08-27.
* the index is ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside an
  ``autocommit_block``. Nothing on the upgrade path drops or reads the
  catalog, so a killed CONCURRENTLY build leaves an INVALID index that a
  re-run keeps. Verify after deploy with ``pg_index.indisvalid``; recovery is
  ``DROP INDEX CONCURRENTLY coord.idx_ci_dispatches_no_subscriber_device``,
  ``alembic stamp coord_sessev_interact_idx_01``, re-run.
* ``lock_timeout`` bounds the ALTER's ACCESS EXCLUSIVE wait and is put back
  with ``SET LOCAL lock_timeout = DEFAULT`` before the autocommit block, so it
  does not leak into later revisions. That spelling, not ``RESET``, because
  the classifier admits only ``SET LOCAL`` of the two timeout GUCs.

``down_revision`` chains off main's head at authoring time
(``coord_sessev_interact_idx_01``). ``cinode_02_required_capabilities``
(qontinui-web#1544) was open and chained off a different parent; whichever of
the two lands second re-chains its ``down_revision`` onto the other.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cinode_03_dispatch_pr_head_base_sha"
down_revision: str | Sequence[str] | None = "coord_sessev_interact_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the two sha columns (with CHECKs), comment them, build the index."""
    # Bound the ALTER's ACCESS EXCLUSIVE wait: coord writes the ledger on
    # every dispatch, and a queued exclusive lock blocks everyone behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Plain literals, never f-strings: coord's classifier admits only a STATIC
    # op.execute argument, and the `alembic-schema-arg-gate` pre-commit hook
    # parses the raw SQL to prove every statement names its schema.
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            ADD COLUMN IF NOT EXISTS pr_head_sha TEXT NULL
                CONSTRAINT ck_ci_dispatches_pr_head_sha_hex40
                CHECK (pr_head_sha IS NULL OR pr_head_sha ~ '^[0-9a-f]{40}$'),
            ADD COLUMN IF NOT EXISTS base_sha TEXT NULL
                CONSTRAINT ck_ci_dispatches_base_sha_hex40
                CHECK (base_sha IS NULL OR base_sha ~ '^[0-9a-f]{40}$')
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without putting it back the timeout leaks into every
    # revision that lands after this one.
    op.execute("SET LOCAL lock_timeout = DEFAULT")
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_dispatches.pr_head_sha IS
            'PR branch head the dispatch was built from (40-hex). Stable across merge ticks, unlike the '
            'dry-rebased head_sha; with base_sha it identifies the candidate. NULL = not recorded.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_dispatches.base_sha IS
            'origin/<base> sha the PR head was rebased onto to produce head_sha (40-hex). '
            'NULL = not recorded.'
        """
    )

    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_ci_dispatches_no_subscriber_device
            ON coord.ci_dispatches (device_id, completed_at)
            INCLUDE (tenant_id)
            WHERE state = 'cancelled' AND summary ->> 'reason' = 'no_subscriber'
            """
        )


def downgrade() -> None:
    """Drop the index, the two constraints and the two columns. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_ci_dispatches_no_subscriber_device"
        )

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            DROP CONSTRAINT IF EXISTS ck_ci_dispatches_base_sha_hex40,
            DROP CONSTRAINT IF EXISTS ck_ci_dispatches_pr_head_sha_hex40,
            DROP COLUMN IF EXISTS base_sha,
            DROP COLUMN IF EXISTS pr_head_sha
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
