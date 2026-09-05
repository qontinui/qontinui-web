"""pr_merge — per-tenant + per-repo require-review merge-gate opt-in columns

Revision ID: require_review_cols_01
Revises: atu_03_embedded_defaults
Create Date: 2026-09-05

Plan 2026-09-05-require-review-opt-in-columns-web-migration.

Lands the two columns coord has READ AHEAD OF since qontinui-coord#457
(2026-06-08, "make the approval gate optional, default off"). That PR made the
GitHub-approval merge gate opt-in per tenant — the operator's stated model,
"autonomous by default; reviews available but disabled" — and named this exact
revision id (``require_review_cols_01``) as the web migration that would carry
the opt-in columns. The coord side shipped: the best-effort resolver
(``crates/coord/src/pr_merge/settings.rs`` ``resolve_require_review_db_override``),
the ``PATCH /pr-merge/settings`` write path (``settings_routes.rs``,
``apply_tenant_field!(body.require_review, "require_review")``), the feature
attribution in ``dev_overview.rs``, and two ``KNOWN_MISSING`` waivers in
``schema_read_contract.rs``. The migration was never authored, so for three
months the read could only ever fail safe and the PATCH could only ever 500 —
a permanent read-ahead, which is the rot ``KNOWN_MISSING`` exists to expire.

The exact parallel of ``layering_gate_cols_01`` / ``blast_radius_gate_cols_01``.
Two nullable BOOLEAN columns, each NULL = "inherit the next tier up":

1. ``coord.tenant_merge_settings.require_review``
   — tenant-tier default. NULL = inherit the env / global default (OFF).

2. ``coord.tenant_repo_profiles.require_review_override``
   — per-(tenant, repo) override. NULL = inherit the tenant tier.

Resolution order (highest precedence first), as coord already resolves it
(``resolve_require_review_db_override``: ``trp_override.or(tms).unwrap_or(env)``):

    1. tenant_repo_profiles.require_review_override
    2. tenant_merge_settings.require_review
    3. env  QONTINUI_REQUIRE_REVIEW
    4. Defaults::REQUIRE_REVIEW = false

NULLABLE WITH NO DEFAULT is load-bearing, not a nicety: a ``NOT NULL DEFAULT
false`` on ``tenant_repo_profiles`` would turn every enrolled repo's existing
profile row into an EXPLICIT per-repo OFF, and an explicit per-repo value
dominates the tenant tier — an operator would flip review on at the tenant tier,
read it back as on, and it would gate nothing on any repo that has a profile.

Deploy order: coord's read is a SEPARATE best-effort query that degrades to
env/default on any error, so there is no coord<->web deploy-ordering
constraint. coord's two ``KNOWN_MISSING`` waivers for these columns self-expire
at the next ``MIGRATOR_DIGEST`` bump that carries this revision — that bump
commit must delete both, or ``stale_known_missing_entries_are_rejected`` reds.

Idempotency: column adds are guarded by an inspector check (skip
``add_column`` if the column already exists). Re-running against an
already-migrated DB is a no-op. ``downgrade()`` drops the columns
(reverse order). No CHECK constraints — a nullable BOOLEAN is already
fully constrained.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "require_review_cols_01"
down_revision: str = "atu_03_embedded_defaults"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add the two require-review opt-in columns (nullable BOOLEAN, no default)."""

    # 1. tenant-tier default.
    if not _has_column("tenant_merge_settings", "require_review"):
        op.add_column(
            "tenant_merge_settings",
            sa.Column("require_review", sa.Boolean(), nullable=True),
            schema="coord",
        )

    # 2. per-(tenant, repo) override.
    if not _has_column("tenant_repo_profiles", "require_review_override"):
        op.add_column(
            "tenant_repo_profiles",
            sa.Column("require_review_override", sa.Boolean(), nullable=True),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the two columns (reverse order)."""

    if _has_column("tenant_repo_profiles", "require_review_override"):
        op.drop_column(
            "tenant_repo_profiles",
            "require_review_override",
            schema="coord",
        )

    if _has_column("tenant_merge_settings", "require_review"):
        op.drop_column("tenant_merge_settings", "require_review", schema="coord")
