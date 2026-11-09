"""coord.ci_runner_scope_listings - the CI registrar's persisted per-scope listing stamp

Revision ID: coord_ci_runner_scope_listings_01
Revises: fpl_02b
Create Date: 2026-11-09

Phase 3 of plan
``2026-11-09-ci-registration-presence-persisted-listing-stamp-and-slot-row-followups``.

One additive, coord-only table: ``coord.ci_runner_scope_listings``, one row per
registrar scope. A scope is the lower-cased ``owner/repo`` of a repo poll or
``org:<owner>`` of an org poll, the ``fleet_partition::scope_key`` grammar in
``qontinui-coord``. The row records when the newest COMPLETE refresh of that
scope read its GitHub runner listing, and whether a later refresh was only
partial. coord's registration-presence classifier reads it as a floor beside
the newest ``coord.devices`` row of the scope, so a scope whose ONLY runner
left the listing can be measured absent on every replica. Until now that clock
lived only in the leader's memory, which no other replica can read.

## What writes it

``qontinui-coord`` ``ci_runner_registrar`` (Phase 4, ``listing_stamp``) UPSERTs
one row per polled scope on the leader's registrar tick: the repo poll and the
org poll. ``fleet_partition`` reads it on any replica serving
``GET /coord/fleet/health``.

## Column shape

* ``scope`` TEXT PRIMARY KEY - the lower-cased scope key.
* ``listed_at`` TIMESTAMPTZ NULL - the DB-clock time the newest COMPLETE
  refresh read its listing, captured before that refresh wrote its rows. NULL
  until the scope's first complete refresh, because a partial refresh can be a
  scope's first write.
* ``outcome`` TEXT NULL - ``refreshed`` | ``refreshed_empty``, the outcome of
  that complete refresh. CHECKed (``ci_rsl_outcome_check``): unlike a ledger
  vocabulary this is a two-value read contract the classifier branches on.
* ``listed_runners`` INTEGER NULL - how many runners that listing carried.
* ``incomplete_since`` TIMESTAMPTZ NULL - set by a partial refresh (rows
  planned but not all written, unresolved leases, or a failed page), cleared
  by a later complete one. A scope whose ``incomplete_since`` is newer than its
  ``listed_at`` reads Unmeasured.
* ``updated_at`` TIMESTAMPTZ NOT NULL DEFAULT now(). The default covers INSERT
  only; there is no trigger in this chain, so the writer sets it on UPDATE.

``outcome`` and ``listed_runners`` are NULL exactly when ``listed_at`` is; the
writer keeps that, the database does not. The table CHECK
``ci_rsl_measured_check`` is ``listed_at IS NOT NULL OR incomplete_since IS NOT
NULL``: every row records either a complete listing or a partial one, never
neither.

## Why there is no tenant_id

The table is fleet-wide, on the same argument ``SCOPE_NEWEST_SEEN_SQL`` in
``qontinui-coord`` ``fleet_partition.rs`` documents for its fleet-wide read:

* one listing covers a scope's ``coord.devices`` rows whatever tenant each row
  is bound to, so a per-tenant key would split one observation into copies;
* the value is only ever compared against and never served, so it discloses
  nothing across tenants;
* the writer runs as the system tenant.

## No ORM model

coord-only tables stay out of the ORM graph; web is their schema author, never
a reader.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL. The coord change that
writes and reads this table (Phase 4) ships only after this revision is applied
in production, and degrades on an undefined table rather than failing the poll.

## Head choice

``down_revision`` is ``fpl_02b``, the single head ``alembic heads`` printed on
``origin/main`` at ``c71f3602d`` when this was written. If main moves first,
re-point this revision at the new single head. Do not add an ``alembic
merge``: this repo keeps strict single-head discipline.

## Merge-train classifier disposition

coord's migration classifier is expected to classify this revision Reject, as
it does the landed precedent ``coord_ci_runner_quarantines_01``: it does not
recognise ``COMMENT ON``, and it scans ``downgrade()`` too, where it rejects
every ``DROP``. Every SQL string is a static literal.

## Safety

``CREATE TABLE IF NOT EXISTS`` and re-runnable ``COMMENT ON``, so a partial
apply re-runs cleanly. No existing table is touched, so no lock bound is
needed. ``downgrade()`` drops the table ``IF EXISTS``; its comments go with it.
Both directions are pure SQL execution with no bind or inspection, so they work
under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runner_scope_listings_01"
down_revision: str | Sequence[str] | None = "fpl_02b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.ci_runner_scope_listings and document it."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_runner_scope_listings (
            scope            TEXT        NOT NULL,
            listed_at        TIMESTAMPTZ,
            outcome          TEXT,
            listed_runners   INTEGER,
            incomplete_since TIMESTAMPTZ,
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ci_runner_scope_listings_pkey PRIMARY KEY (scope),
            CONSTRAINT ci_rsl_outcome_check
                CHECK (outcome IS NULL OR outcome IN ('refreshed', 'refreshed_empty')),
            CONSTRAINT ci_rsl_measured_check
                CHECK (listed_at IS NOT NULL OR incomplete_since IS NOT NULL)
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.ci_runner_scope_listings IS
            'Per-scope listing stamp of the CI registrar: one row per lower-cased scope (owner/repo, or org:owner), upserted by the coord module ci_runner_registrar (listing_stamp) on the leader registrar tick and read by fleet_partition on every replica as the registration-presence floor. Fleet-wide with no tenant_id: one listing covers a scope whatever tenant its rows are bound to, the value is only compared and never served, and the writer runs as the system tenant. Plan 2026-11-09-ci-registration-presence-persisted-listing-stamp-and-slot-row-followups, Phase 3.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_scope_listings.listed_at IS
            'DB-clock time the newest COMPLETE refresh read its listing, captured before that refresh wrote its rows. NULL until the first complete refresh of the scope; outcome and listed_runners are NULL exactly when this is.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_scope_listings.outcome IS
            'refreshed | refreshed_empty: the outcome of the newest complete refresh. CHECKed by ci_rsl_outcome_check.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_scope_listings.incomplete_since IS
            'Set by a partial refresh (rows planned but not all written, unresolved leases, or a failed page) and cleared by a later complete one. Newer than listed_at, or set with listed_at NULL, means the scope reads Unmeasured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_scope_listings.updated_at IS
            'The default covers INSERT only; there is no trigger, so every UPDATE must set it explicitly.'
        """
    )


def downgrade() -> None:
    """Drop the table. Its constraints and comments go with it."""
    op.execute("DROP TABLE IF EXISTS coord.ci_runner_scope_listings")
