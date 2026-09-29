"""twin served-bundle — twin_targets.production_url + client_telemetry_observations.tenant_id

Revision ID: twin_10_served_bundle_target_columns
Revises: plan_library_09_scan_root_refusals
Create Date: 2026-09-29

Phase 2 (the **expand** step) of plan
``2026-09-17-twin-observer-genericity-non-release-consumers``.

coord's served-bundle observer (``served_bundle_observer.rs``) still watches a
hardcoded ``https://qontinui.io/`` entry URL and a hardcoded Vercel project, so
a deployment that is not qontinui reports confident readings about qontinui's
site. Phase 3 of the plan (a LATER coord change) moves it onto
``coord.twin_targets``: one cycle per ``vercel`` row that declares a
``production_url``, with the row's ``tenant_id`` stamped on every observation it
writes. That coord read needs these columns to exist first — served policy
``production-and-cost`` ``alembic-sole-authorship`` — so this migration lands and
is applied BEFORE the coord code that reads them.

Schema only
===========

This revision changes schema and nothing else, so coord's migration classifier
can prove it additive. Seeding qontinui's own ``production_url`` is data DML,
which that classifier refuses, so it is a separate revision
(``twin_11_seed_qontinui_production_url``) that follows this one.

What it does
============

1. ``coord.twin_targets.production_url`` — nullable ``TEXT``. The URL a
   ``vercel`` row is served at. A row with NULL here is simply not observed by
   the served-bundle observer (honestly dark), while Ξ_Release keeps observing
   it. A declared URL, rather than one derived from Vercel's alias list, because
   an alias list has no canonical "entry" member.

2. ``coord.client_telemetry_observations.tenant_id`` — nullable ``UUID``, plus
   a partial index — the ``twin_08`` ``release_observations`` posture. **No
   backfill**, unlike ``twin_08``: existing rows are pre-attribution history
   that coord's ``table_retention`` (180 days for this oplog) ages out, and a
   full-table ``UPDATE`` of an append-only oplog on the deploy path buys nothing
   a reader needs. NULL means "written before attribution", not "no tenant".
   The index is built ``CONCURRENTLY`` in an autocommit block — the
   ``oplog_age_idx_01`` idiom for this hot, append-heavy table — so the
   ``ALTER``'s ACCESS EXCLUSIVE lock is committed and released before the
   full-table scan the build needs.

3. ``fk_client_telemetry_observations_tenant_id`` — the column's FK to
   ``coord.tenants`` ``ON DELETE SET NULL`` (the append-only history outlives
   the tenant row), added as its own ``ADD CONSTRAINT ... NOT VALID`` rather
   than as an inline ``REFERENCES`` on the ``ADD COLUMN``. coord's classifier
   rejects the inline form as a validated FK. ``NOT VALID`` costs nothing here:
   the column is brand new and every existing row holds NULL, which a foreign
   key never checks, so there is nothing a validation scan could find. The
   constraint is enforced for every row written from now on either way.
   Validating it later (``VALIDATE CONSTRAINT``) is optional and would only
   mark it ``convalidated``.

Ordering
========

The two ``ADD COLUMN`` statements commit first, then the index is built
outside any transaction, then the constraint is added in the transaction
that also stamps the alembic version. That order lets a run that died partway
re-run cleanly: the columns and index are ``IF NOT EXISTS``, and the
constraint — which PostgreSQL cannot guard with ``IF NOT EXISTS`` — is only
ever committed together with the version stamp. Re-running a COMPLETED upgrade
is not supported (the constraint add would fail); alembic never does that.

Schema-arg gate: every raw-SQL statement is a plain literal naming the
``coord`` schema (``.pre-commit-hooks/check_alembic_schema_args.py`` audits only
constant SQL, so no f-strings).

Locking: ``SET LOCAL lock_timeout = '3s'`` before each transactional group of
``ALTER``s, so a long reader on the hot oplog fails the migration fast instead
of queueing every writer behind a lock request. Every ``ALTER`` is catalog-only:
nullable columns with no default, and a ``NOT VALID`` constraint that scans
nothing. Each direction ends with ``SET LOCAL lock_timeout = DEFAULT``:
``env.py`` runs every pending revision in one transaction, and a later one
must not inherit this bound.

INVALID-index limit: the index is built ``CONCURRENTLY`` outside the
migration transaction, where no ``lock_timeout`` applies (the ``SET LOCAL``
ended with the transaction it was set in, and coord's classifier admits no
session-level ``SET``). The build therefore waits without a bound, first to
acquire SHARE UPDATE EXCLUSIVE on the table (queueing behind conflicting DDL
or a running ``VACUUM``), then for every older transaction in the database to
finish. It never blocks writers, but it
can hold up a deploy. A build that fails partway (a cancel, or a timeout the
role or database itself configures) can leave an INVALID index that a re-run's ``IF NOT
EXISTS`` then skips, reporting success. The index only speeds up per-tenant
reads, so an invalid one is slow rather than wrong. Recovery:
``DROP INDEX CONCURRENTLY coord.idx_client_telemetry_observations_tenant_id``
and re-run. No ``indisvalid`` check is made here because coord's migration
classifier rejects ``op.get_bind()`` (SQL executed outside ``op.execute``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_10_served_bundle_target_columns"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "plan_library_09_scan_root_refusals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Expand: add the two columns, the partial index, and the NOT VALID FK."""

    # Fail fast rather than queueing an ACCESS EXCLUSIVE request in front of
    # every reader and writer of the hot oplog.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # 1. The URL a vercel target is served at (NULL = not served-bundle observed).
    op.execute(
        """
        ALTER TABLE coord.twin_targets
            ADD COLUMN IF NOT EXISTS production_url TEXT
        """
    )

    # 2. Per-tenant attribution of the client-telemetry oplog. The FK is added
    #    separately (step 4), NOT VALID.
    op.execute(
        """
        ALTER TABLE coord.client_telemetry_observations
            ADD COLUMN IF NOT EXISTS tenant_id UUID
        """
    )

    # 3. The partial index, CONCURRENTLY: autocommit_block() commits the ALTERs
    #    above first, so their ACCESS EXCLUSIVE lock is gone before the scan.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_client_telemetry_observations_tenant_id
                ON coord.client_telemetry_observations (tenant_id)
                WHERE tenant_id IS NOT NULL
            """
        )

    # 4. The FK, in the fresh transaction that also stamps the version, so a
    #    partial run never leaves it committed without the stamp. NOT VALID
    #    skips a scan that could find nothing: every existing tenant_id is NULL.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.client_telemetry_observations
            ADD CONSTRAINT fk_client_telemetry_observations_tenant_id
            FOREIGN KEY (tenant_id) REFERENCES coord.tenants (tenant_id)
            ON DELETE SET NULL NOT VALID
        """
    )
    # env.py runs every pending revision in one transaction: hand the next one
    # the lock bound it would have had without this revision.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Contract: drop the FK, the index and both columns, in ONE transaction.

    One transaction, so a failed downgrade (say, the 3s lock timeout) rolls
    back completely, leaving the database at the revision the downgrade started
    from, with all of twin_10's objects in place. A ``DROP INDEX CONCURRENTLY`` would have to
    commit on its own and buys nothing here, because ``DROP COLUMN`` takes
    ACCESS EXCLUSIVE regardless.

    Data lost: every ``production_url`` and every observation's ``tenant_id``.
    The attribution was stamped at observation time and cannot be rebuilt."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.client_telemetry_observations "
        "DROP CONSTRAINT IF EXISTS fk_client_telemetry_observations_tenant_id"
    )
    op.execute("DROP INDEX IF EXISTS coord.idx_client_telemetry_observations_tenant_id")
    op.execute(
        "ALTER TABLE coord.client_telemetry_observations DROP COLUMN IF EXISTS tenant_id"
    )
    op.execute("ALTER TABLE coord.twin_targets DROP COLUMN IF EXISTS production_url")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
