"""twin served-bundle — twin_targets.production_url + client_telemetry_observations.tenant_id

Revision ID: twin_10_served_bundle_target_columns
Revises: coord_dp_write_auth_daily_01
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

What it does:

1. ``coord.twin_targets.production_url`` — nullable ``TEXT``. The URL a
   ``vercel`` row is served at. A row with NULL here is simply not observed by
   the served-bundle observer (honestly dark), while Ξ_Release keeps observing
   it. A declared URL, rather than one derived from Vercel's alias list, because
   an alias list has no canonical "entry" member.

2. ``coord.client_telemetry_observations.tenant_id`` — nullable ``UUID``, FK to
   ``coord.tenants`` ``ON DELETE SET NULL`` (the append-only history outlives the
   tenant row), plus a partial index — the ``twin_08`` ``release_observations``
   posture. **No backfill**, unlike ``twin_08``: existing rows are pre-attribution
   history that coord's ``table_retention`` (180 days for this oplog) ages out,
   and a full-table ``UPDATE`` of an append-only oplog on the deploy path buys
   nothing a reader needs. NULL means "written before attribution", not "no
   tenant". The index is built ``CONCURRENTLY`` in an autocommit block — the
   ``oplog_age_idx_01`` idiom for this hot, append-heavy table — so the
   ``ALTER``'s ACCESS EXCLUSIVE lock is committed and released before the
   full-table scan the build needs.

3. Seed ``production_url = 'https://qontinui.io/'`` on the bootstrap tenant's
   (``personal-jspinak``) ``vercel`` / ``qontinui-web`` row — the value of the
   ``ENTRY_URL`` const coord currently hardcodes (removed in Phase 3). Only fills a NULL, so an operator-set
   value is never overwritten; a fresh dev DB with no such row is a no-op.

Schema-arg gate: every raw-SQL DDL names the ``coord`` schema
(``.pre-commit-hooks/check_alembic_schema_args.py``).

Idempotency: ``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX CONCURRENTLY IF NOT
EXISTS`` and a seed guarded on ``production_url IS NULL``. Re-running is a no-op.
(A killed concurrent build leaves an INVALID index that ``IF NOT EXISTS`` then
skips; the test asserts ``indisvalid``.)
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_10_served_bundle_target_columns"
down_revision: str = "coord_dp_write_auth_daily_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The canonical bootstrap tenant every coord data table backfills to
# (coord_tenant_scope_columns.py / twin_08). There is no "qontinui" slug.
_BOOTSTRAP_SLUG = "personal-jspinak"

# The entry URL coord's served_bundle_observer hardcoded as ENTRY_URL.
_QONTINUI_WEB_PRODUCTION_URL = "https://qontinui.io/"


def upgrade() -> None:
    """Expand: add the two columns, the partial index, and the one seed value."""

    # 1. The URL a vercel target is served at (NULL = not served-bundle observed).
    op.execute(
        """
        ALTER TABLE coord.twin_targets
            ADD COLUMN IF NOT EXISTS production_url TEXT
        """
    )

    # 2. Per-tenant attribution of the client-telemetry oplog.
    op.execute(
        """
        ALTER TABLE coord.client_telemetry_observations
            ADD COLUMN IF NOT EXISTS tenant_id UUID
                REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL
        """
    )

    # 3. Seed qontinui's own production URL on its qontinui-web vercel row.
    op.execute(
        f"""
        UPDATE coord.twin_targets
           SET production_url = '{_QONTINUI_WEB_PRODUCTION_URL}',
               updated_at = now()
         WHERE surface = 'vercel'
           AND target = 'qontinui-web'
           AND production_url IS NULL
           AND tenant_id = (
                   SELECT tenant_id FROM coord.tenants
                    WHERE slug = '{_BOOTSTRAP_SLUG}'
               )
        """
    )

    # 4. The partial index, CONCURRENTLY: autocommit_block() commits the ALTERs
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


def downgrade() -> None:
    """Contract: drop the index and both columns. The seed value is
    regenerated by re-applying upgrade; the observation tenant_id is a derived
    attribution, not source data."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_client_telemetry_observations_tenant_id"
        )
    op.execute(
        "ALTER TABLE coord.client_telemetry_observations DROP COLUMN IF EXISTS tenant_id"
    )
    op.execute("ALTER TABLE coord.twin_targets DROP COLUMN IF EXISTS production_url")
