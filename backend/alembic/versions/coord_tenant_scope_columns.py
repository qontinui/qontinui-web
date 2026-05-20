"""coord tenant_scope — add tenant_id to data tables + bootstrap personal tenant

Revision ID: coord_tenant_scope_columns
Revises: coord_plans_slug_unique
Create Date: 2026-05-20

Replaces the `require_admin` gate on `/api/v1/operations/*` with
`require_authenticated` + tenant scoping. The substrate (`coord.tenants`,
`coord.operators`, `coord.operator_roles`, `coord.tenant_devices`)
already landed in `coord_sso_rbac`; this revision adds the per-row
`tenant_id` column to every coord data table the dashboard reads and
backfills existing rows under the bootstrap "personal" tenant.

Tables touched (all gain a nullable `tenant_id UUID`):

* ``coord.plans``
* ``coord.agent_worktrees``
* ``coord.agent_questions``
* ``coord.agent_logs``
* ``coord.memories``
* ``coord.primary_trees``

Index posture: each table gains a partial ``idx_<table>_tenant_id``
``WHERE tenant_id IS NOT NULL`` so the scoped queries the coord-side
handlers issue (``WHERE tenant_id = $1``) hit an index even before the
column reaches NOT NULL. Nullable for now — multi-user backfill +
tightening to NOT NULL is a deliberate follow-up once SSO actually
mints `operators` rows for new sign-ins.

Bootstrap rows (single-user case for jspinak):

1. ``coord.tenants`` — slug=``personal-jspinak``, display_name=
   ``Personal (jspinak)``.
2. ``coord.operators`` — email=``josh@qontinui.io``, sso_subject=``''``
   (empty string until Cognito mints the real subject), sso_provider=
   ``''`` (same — empty until SSO lands), tenant_id=the personal tenant.
   ``coord.operators(sso_provider, sso_subject)`` is the natural-key
   UNIQUE; empty/empty is acceptable for the single-user bootstrap row
   because there will only ever be one such pair until SSO replaces it.
3. ``coord.operator_roles`` — operator_id × tenant_id × role=``admin``.
   Full role within the tenant.

Backfill: every existing row in the six data tables is stamped with the
``personal-jspinak`` tenant_id. The migration looks up the tenant by
slug at run time so the bootstrap INSERT and the UPDATE are guaranteed
to see the same UUID (PG runs both in a single alembic transaction).

Note on SSO posture: per the spec's identity-mapping section, jspinak
signs in via the qontinui-web cookie auth chain today (not Cognito).
Empty ``sso_provider`` + ``sso_subject`` is the documented gap until
SSO actually lands; tenant resolution happens via the
``coord.operators.email`` column instead, joining ``auth.users.email``
on the web side via the new
``app/services/coord_operator_resolver.py`` helper.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_tenant_scope_columns"
down_revision: str = "coord_plans_slug_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Stable identifiers for the bootstrap personal tenant.
_PERSONAL_SLUG = "personal-jspinak"
_PERSONAL_DISPLAY = "Personal (jspinak)"
_BOOTSTRAP_EMAIL = "josh@qontinui.io"


# Tables that gain a `tenant_id UUID NULL` column + partial index +
# backfill. (table_name, primary_key_columns_for_logging) — the
# primary-key list is documentation; the migration doesn't use it.
_SCOPED_TABLES: list[tuple[str, str]] = [
    ("plans", "id"),
    ("agent_worktrees", "(agent_id, repo)"),
    ("agent_questions", "question_id"),
    ("agent_logs", "log_id"),
    ("memories", "(name, version)"),
    ("primary_trees", "(device_id, repo)"),
]


def upgrade() -> None:
    """Add tenant_id columns + index + bootstrap rows + backfill. Idempotent."""
    # ----------------------------------------------------------------
    # Bootstrap the personal tenant + operator + role rows.
    #
    # ON CONFLICT DO NOTHING on the natural keys means re-running the
    # migration against an already-bootstrapped DB is a no-op. The
    # operator row uses (sso_provider, sso_subject) = ('', '') which
    # is the single-bootstrap-row convention documented above.
    # ----------------------------------------------------------------
    op.execute(
        f"""
        INSERT INTO coord.tenants (slug, display_name)
        VALUES ('{_PERSONAL_SLUG}', '{_PERSONAL_DISPLAY}')
        ON CONFLICT (slug) DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO coord.operators
            (tenant_id, email, sso_subject, sso_provider, display_name)
        SELECT
            t.tenant_id,
            '{_BOOTSTRAP_EMAIL}',
            '',
            '',
            'jspinak (bootstrap)'
        FROM coord.tenants t
        WHERE t.slug = '{_PERSONAL_SLUG}'
        ON CONFLICT (sso_provider, sso_subject) DO NOTHING
        """
    )
    op.execute(
        f"""
        INSERT INTO coord.operator_roles
            (operator_id, tenant_id, role)
        SELECT
            o.operator_id,
            t.tenant_id,
            'admin'
        FROM coord.operators o
        JOIN coord.tenants t ON t.tenant_id = o.tenant_id
        WHERE t.slug = '{_PERSONAL_SLUG}'
          AND o.email = '{_BOOTSTRAP_EMAIL}'
        ON CONFLICT (operator_id, tenant_id, role) DO NOTHING
        """
    )

    # ----------------------------------------------------------------
    # For each scoped table:
    #
    #  1. ADD COLUMN IF NOT EXISTS tenant_id UUID
    #  2. Backfill existing rows to the personal tenant
    #  3. CREATE INDEX IF NOT EXISTS idx_<table>_tenant_id
    #     (partial — WHERE tenant_id IS NOT NULL)
    #
    # tenant_id stays NULL-able for now. A follow-up migration tightens
    # to NOT NULL once SSO lands and every new row has a resolved tenant.
    # ----------------------------------------------------------------
    for table, _pk in _SCOPED_TABLES:
        op.execute(
            f"""
            ALTER TABLE coord.{table}
                ADD COLUMN IF NOT EXISTS tenant_id UUID
                    REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL
            """
        )
        op.execute(
            f"""
            UPDATE coord.{table}
            SET tenant_id = (
                SELECT tenant_id FROM coord.tenants WHERE slug = '{_PERSONAL_SLUG}'
            )
            WHERE tenant_id IS NULL
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_{table}_tenant_id
                ON coord.{table}(tenant_id)
                WHERE tenant_id IS NOT NULL
            """
        )

    # ----------------------------------------------------------------
    # ``coord.memories_latest`` view — DISTINCT ON (name) projection.
    # The view was created in ``coord_memories`` alembic + lives in the
    # coord-side ``memories::ensure_memories_table`` self-heal. Now that
    # ``coord.memories`` has a ``tenant_id`` column, the view's column
    # list grows by one — the dashboard's tenant-scoped SELECT joins
    # the view on tenant_id, so the view must expose it.
    #
    # ``CREATE OR REPLACE VIEW`` requires the new column list to be a
    # strict superset of the old one (no column-type changes, no
    # column reorders before the tail). Appending ``tenant_id`` at the
    # end satisfies that constraint.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE OR REPLACE VIEW coord.memories_latest AS
            SELECT DISTINCT ON (name)
                memory_id, name, version, content, description, type,
                written_by_agent, written_by_device, written_at, is_tombstone,
                tenant_id
            FROM coord.memories
            WHERE NOT is_tombstone
            ORDER BY name, version DESC
        """
    )


def downgrade() -> None:
    """Reverse column adds + index drops. Leaves bootstrap rows in place.

    The bootstrap ``coord.tenants`` / ``coord.operators`` /
    ``coord.operator_roles`` rows stay — those are subject to the
    Phase 7 SSO substrate's lifecycle, not this migration's. Only the
    per-row ``tenant_id`` columns + indices on the data tables are
    reverted, which is the part this migration owns end-to-end.
    """
    for table, _pk in _SCOPED_TABLES:
        op.execute(f"DROP INDEX IF EXISTS coord.idx_{table}_tenant_id")
        op.execute(f"ALTER TABLE coord.{table} DROP COLUMN IF EXISTS tenant_id")
