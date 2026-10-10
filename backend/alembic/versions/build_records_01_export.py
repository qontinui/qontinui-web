"""Build-record export: product definitions, public snapshots, visibility re-check.

Revision ID: build_records_01_export
Revises: ci_read_token_01
Create Date: 2026-10-10

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``.
ONE revision for the whole Phase 1 schema (it was four while unlanded; the
migration-reversal gate requires one added file per PR).

coord.build_record_products
===========================

A *product* is a named set of repos plus an optional time window, configured
by a tenant; coord's ``coord_build_record`` composer reads it and its
``PUT /coord/build-record-products/{slug}`` writes it. ``is_public`` is the D3
opt-in. Columns follow the binding cross-repo contract exactly, plus a CHECK
pinning the slug domain ``[a-z0-9][a-z0-9-]{0,62}``. No FK on ``tenant_id``
(coord's tenants are referenced by id across ``coord.*``). This lands BEFORE
the coord reader (served policy ``production-and-cost``
``alembic-sole-authorship``). A plain ``CREATE TABLE``: a pre-existing table
of this name would be an unknown shape, and the migration should fail loudly.

web.build_record_public_slugs
=============================

One row per public address; the FIRST tenant to publish a slug owns it
(``public_slug`` is the PK, so a second tenant cannot claim it under a race).

* ``unpublished_at`` — the D7 one-step unpublish: set → the public route 404s
  at once; snapshots are kept and a publish with ``reactivate`` clears it.
* The GitHub visibility re-check cursor (task
  ``build_record_visibility_recheck``, ``app/jobs/build_record_reconcile.py``):
  ``last_visibility_attempt_at`` (queue order; set whenever the re-check
  finishes with the slug, so an unanswerable one moves back),
  ``last_visibility_check_at`` (last COMPLETE definite answer),
  ``visibility_check_offset`` (resume point for a slug wider than one tick's
  budget), ``visibility_unknown_attempts`` (consecutive BLAMED give-ups) and
  ``first_unanswered_attempt_at`` (start of the current blamed run; the 24 h
  ceiling is measured from it). A publish resets all five.

web.build_record_snapshots
==========================

Publishing FREEZES the document coord composed: ``version`` (unique per slug),
``document``, ``content_sha256``, coord's ``generated_at`` (a document older
than the latest snapshot is refused), ``allowlist_version`` (the allowlist the
document passed at publish; the public route re-validates only an older one)
and ``published_at``. ``tenant_id`` is the coord tenant (web convention, see
``overview.*``); the composite FK ``(public_slug, tenant_id)`` → the owner row
makes "every version of a slug belongs to its owner" a catalog guarantee.

web.github_rate_budget
======================

A singleton (``CHECK (id)``, following ``project.scheduler_settings`` /
``coordinator_leader_singleton``) holding GitHub's last reported
``X-RateLimit-Remaining`` / ``X-RateLimit-Reset``, shared by publish and the
re-check across replicas: publish refuses at its reserve, the re-check stops
at a higher one.

web.build_record_pending_not_public
===================================

(slug, repo, snapshot_version) NOT_PUBLIC verdicts whose retraction could not
take the owner row lock in time; the next re-check tick applies them first
unless that version has since been replaced or re-published. No FK to the
owner on purpose: inserting a child row takes a KEY SHARE lock on the parent,
which would wait on the very lock holder that forced the deferral.

Downgrade
=========

Drops everything. It first deletes the retracted slugs' snapshots and owner
rows explicitly (the semantics the separate ``unpublished_at`` revision's
downgrade had: never resurrect a page its owner took down), although with
every table dropped no retracted page can survive in any case.

The ``web`` schema, not ``public`` (``scripts/ci/check_forbidden_public_schema.py``).
Hand-authored, never ``--autogenerate``d.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "build_records_01_export"
down_revision: str | Sequence[str] | None = "ci_read_token_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamp(name: str, *, nullable: bool, default_now: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=sa.text("now()") if default_now else None,
    )


def upgrade() -> None:
    """Create the product table, the snapshot tables and the re-check state."""
    op.execute(
        """
        CREATE TABLE coord.build_record_products (
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

    op.execute("CREATE SCHEMA IF NOT EXISTS web")

    op.create_table(
        "build_record_public_slugs",
        sa.Column("public_slug", sa.Text(), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        _timestamp("claimed_at", nullable=False, default_now=True),
        _timestamp("unpublished_at", nullable=True),
        _timestamp("last_visibility_attempt_at", nullable=True),
        _timestamp("last_visibility_check_at", nullable=True),
        sa.Column(
            "visibility_check_offset",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "visibility_unknown_attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        _timestamp("first_unanswered_attempt_at", nullable=True),
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
        _timestamp("generated_at", nullable=False),
        sa.Column("allowlist_version", sa.Integer(), nullable=False),
        _timestamp("published_at", nullable=False, default_now=True),
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

    op.create_table(
        "github_rate_budget",
        sa.Column("id", sa.Boolean(), primary_key=True, server_default=sa.text("true")),
        sa.Column("remaining", sa.Integer(), nullable=True),
        _timestamp("reset_at", nullable=True),
        _timestamp("observed_at", nullable=False, default_now=True),
        sa.CheckConstraint("id", name="ck_github_rate_budget_singleton"),
        schema="web",
    )

    op.create_table(
        "build_record_pending_not_public",
        sa.Column("public_slug", sa.Text(), primary_key=True),
        sa.Column("repo", sa.Text(), primary_key=True),
        sa.Column("snapshot_version", sa.Integer(), nullable=False),
        _timestamp("observed_at", nullable=False, default_now=True),
        schema="web",
    )


def downgrade() -> None:
    """Delete retracted records first (never resurrect a retracted page), then
    drop every table this revision created."""
    op.execute(
        "DELETE FROM web.build_record_snapshots WHERE public_slug IN ("
        "SELECT public_slug FROM web.build_record_public_slugs "
        "WHERE unpublished_at IS NOT NULL)"
    )
    op.execute(
        "DELETE FROM web.build_record_public_slugs WHERE unpublished_at IS NOT NULL"
    )
    op.drop_table("build_record_pending_not_public", schema="web")
    op.drop_table("github_rate_budget", schema="web")
    op.drop_table("build_record_snapshots", schema="web")
    op.drop_table("build_record_public_slugs", schema="web")
    op.execute("DROP TABLE coord.build_record_products")
