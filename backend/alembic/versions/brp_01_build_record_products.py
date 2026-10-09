"""coord.build_record_products — the tenant's product definitions for build records.

Revision ID: brp_01_build_record_products
Revises: coord_sessions_fleet_idx_01
Create Date: 2026-10-09

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(the build-record export, factory side).

What it holds
=============

A *product* is a named set of repos plus an optional time window, configured
by a tenant. qontinui-coord's ``coord_build_record`` composer reads a row to
decide which repos and which dates a product's build record covers, and its
``PUT /coord/build-record-products/{slug}`` writes one. ``is_public`` is the
D3 opt-in: nothing is publishable until a tenant sets it, and qontinui-web's
publish route refuses a product whose flag is false.

Columns follow the binding cross-repo contract for Phase 1 exactly:

* ``slug`` — the product's address, ``[a-z0-9][a-z0-9-]{0,62}``. The CHECK
  pins that domain in the catalog, so a writer that skipped validation fails
  here rather than minting a slug no route can address.
* ``repos`` — ``owner/name`` strings. Which of them are public is decided by
  coord at export time (a repo not POSITIVELY known public is dropped from the
  document), not stored here.
* ``window_start`` / ``window_end`` — nullable; an absent bound is open.
* ``unique (tenant_id, slug)`` — one definition per slug per tenant. Global
  uniqueness of the PUBLIC address is a separate, web-owned concern
  (``web.build_record_snapshots``, revision ``brs_01_build_record_snapshots``).

There is no FK on ``tenant_id``: coord's tenants are referenced by id across
the ``coord.*`` schema the same way, and the composer always filters on it.

Ordering
========

This revision lands BEFORE the coord reader (served policy
``production-and-cost`` ``alembic-sole-authorship``): coord's
``require_table`` / ``schema_read_contract`` gate would otherwise refuse the
read. Additive only — a new table, nothing existing is altered.

Hand-authored, never ``--autogenerate``d.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "brp_01_build_record_products"
down_revision: str | Sequence[str] | None = "coord_sessions_fleet_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.build_record_products``."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.build_record_products (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            slug          TEXT NOT NULL,
            title         TEXT NOT NULL,
            repos         TEXT[] NOT NULL DEFAULT '{}',
            window_start  TIMESTAMPTZ NULL,
            window_end    TIMESTAMPTZ NULL,
            is_public     BOOLEAN NOT NULL DEFAULT false,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT build_record_products_tenant_slug_key
                UNIQUE (tenant_id, slug),
            CONSTRAINT build_record_products_slug_chk
                CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$')
        )
        """
    )


def downgrade() -> None:
    """Drop the table (its constraints drop with it)."""
    op.execute("DROP TABLE IF EXISTS coord.build_record_products")
