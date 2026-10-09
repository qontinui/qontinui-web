"""web.build_record_snapshots — frozen, versioned, public build-record documents.

Revision ID: brs_01_build_record_snapshots
Revises: brp_01_build_record_products
Create Date: 2026-10-09

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(the public snapshot half of the build-record export).

What it holds
=============

Publishing a build record FREEZES the document coord composed at that moment:
qontinui-web fetches it, re-validates the D3 allowlist, and stores it here as
the next version. The unauthenticated route
``GET /api/v1/public/build-records/{slug}`` serves only these rows and never
proxies to coord live, so an anonymous reader can never reach the authed
export.

Two tables, because the contract's ownership rule is a property of the SLUG,
not of any one snapshot row:

* ``web.build_record_public_slugs`` — one row per public address. The FIRST
  tenant to publish a slug owns it; ``public_slug`` is the primary key, so a
  second tenant cannot claim it even under a race.
* ``web.build_record_snapshots`` — the contract's table: ``id``,
  ``public_slug``, ``version``, ``document``, ``content_sha256``,
  ``published_at``, ``tenant_id``, and ``unique (public_slug, version)``,
  plus ``generated_at`` (coord's timestamp for the frozen document, so an
  older document can never be published over a newer one). Its
  composite FK ``(public_slug, tenant_id)`` → the owner row makes "every
  version of a slug belongs to the tenant that owns it" a catalog guarantee
  rather than an application convention.

``tenant_id`` is the coord tenant (web convention for coord-scoped rows, see
``overview.*``): no FK, because coord's tenants live in coord's deployment.

The ``web`` schema, not ``public`` — ``public`` holds only alembic's
bookkeeping (``scripts/ci/check_forbidden_public_schema.py``).

Additive only. Hand-authored, never ``--autogenerate``d.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "brs_01_build_record_snapshots"
down_revision: str | Sequence[str] | None = "brp_01_build_record_products"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the slug-ownership table and the snapshot table."""
    op.execute("CREATE SCHEMA IF NOT EXISTS web")

    op.create_table(
        "build_record_public_slugs",
        sa.Column("public_slug", sa.Text(), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "claimed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "public_slug",
            "tenant_id",
            name="uq_build_record_public_slugs_slug_tenant",
        ),
        sa.CheckConstraint(
            "public_slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'",
            name="ck_build_record_public_slugs_slug",
        ),
        schema="web",
    )

    op.create_table(
        "build_record_snapshots",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("public_slug", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("document", postgresql.JSONB(), nullable=False),
        sa.Column("content_sha256", sa.Text(), nullable=False),
        # coord's ``generated_at`` for the frozen document: a publish whose
        # document is OLDER than the latest snapshot's is refused as stale.
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["public_slug", "tenant_id"],
            [
                "web.build_record_public_slugs.public_slug",
                "web.build_record_public_slugs.tenant_id",
            ],
            name="fk_build_record_snapshots_owner",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "public_slug",
            "version",
            name="uq_build_record_snapshots_slug_version",
        ),
        sa.CheckConstraint("version >= 1", name="ck_build_record_snapshots_version"),
        sa.CheckConstraint(
            "content_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_build_record_snapshots_sha256",
        ),
        schema="web",
    )


def downgrade() -> None:
    """Drop both tables, snapshots first (they reference the owner rows)."""
    op.drop_table("build_record_snapshots", schema="web")
    op.drop_table("build_record_public_slugs", schema="web")
