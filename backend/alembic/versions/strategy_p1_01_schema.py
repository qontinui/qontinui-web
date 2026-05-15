"""strategy schema — Phase 1 document substrate

Revision ID: strategy_p1_01_schema
Revises: wt01_workflow_triggers_workflow_id_nullable
Create Date: 2026-05-15

Phase 1 of the Strategy Collaboration product (design
``plans/2026-05-15-strategy-collaboration-design.md`` §5.2, §7
Phase 1). Read-only foundation: only the document substrate
(``strategy.spaces`` + ``strategy.documents``). Threads, posts,
reactions, mentions, drafts, permissions, activity are Phase 2-7
work and are NOT created here.

``strategy`` is the 6th canonical schema (project / coord / agent /
auth / cloud / strategy), registered in
``.pre-commit-hooks/check_alembic_schema_args.py`` ALLOWED_SCHEMAS
with the same precedent as ``cloud``.

Two surfaced deviations from design §5.2 (decided with the plan
author, not silently applied; §5.2 amended to match):

1. FK target schema. The sketch writes ``REFERENCES
   public.organizations(id)``, but the organizations table actually
   lives in ``auth`` — ``app/models/organization.py:50,92-94``
   declares ``__tablename__ = "organizations"`` with
   ``__table_args__ = (..., {"schema": "auth"})``. A FK to a
   nonexistent ``public.organizations`` would fail at apply time, so
   ``strategy.spaces.organization_id`` points at
   ``auth.organizations(id)``. ``auth.users(id)`` matches verbatim.

2. ``organization_id`` nullability. §5.2 sketches this NOT NULL, but
   Phase 1 is single-tenant dogfood with no owning org on a fresh
   DB (and seeding one would require a brittle raw-SQL INSERT into
   ``auth.users``'s ~10 non-defaulted NOT NULL columns). It is
   NULLABLE here; NULL explicitly means "single-tenant dogfood
   mode, no owning org yet". **Phase 7 (multi-tenant isolation) is
   the constraint-tightening migration**: it backfills
   ``organization_id`` and ``ALTER COLUMN ... SET NOT NULL``. The FK
   is still enforced for any non-NULL value. Verification harnesses
   that need a non-NULL owning org create the org+user parents via
   the SQLAlchemy ORM (which fills model-side defaults), never raw
   SQL.

Seed data (the dogfood space with ``organization_id = NULL`` + the
6 substrate documents) lands in the companion revision
``strategy_p1_02_seed``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "strategy_p1_01_schema"
down_revision: str = "wt01_workflow_triggers_workflow_id_nullable"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Defensive: the canonical bootstrap (qontinui-stack
    # init-scripts/01-create-schemas.sql) creates `strategy` on first
    # container start, but a fresh CI ephemeral PG won't have it.
    # No-op when the bootstrap already ran. Same pattern as
    # cloud_schema_initial_tables.
    op.execute("CREATE SCHEMA IF NOT EXISTS strategy")

    # ------------------------------------------------------------------
    # strategy.spaces — a strategic context; maps to a git directory.
    # ------------------------------------------------------------------
    op.create_table(
        "spaces",
        sa.Column(
            "space_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # Phase 1 = single-tenant dogfood; NULL = "no owning org yet".
        # Phase 7 (multi-tenant) backfills + ALTERs this to NOT NULL.
        # FK is still enforced for non-NULL values.
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        # coord-hosted repo identifier (e.g. "qontinui-dev-notes").
        sa.Column("git_repo", sa.Text(), nullable=False),
        sa.Column(
            "git_branch",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'main'"),
        ),
        sa.Column(
            "git_path_prefix",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'project-strategy/'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "settings",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema="strategy",
    )
    op.create_index(
        "ix_spaces_org",
        "spaces",
        ["organization_id"],
        schema="strategy",
    )

    # ------------------------------------------------------------------
    # strategy.documents — one Markdown file within a space. Git is the
    # source of truth for content; this row is a queryable pointer +
    # cached metadata. head_commit_sha is refreshed by coord's
    # git-read sync; the seed sets a zero-SHA sentinel until the first
    # sync lands.
    # ------------------------------------------------------------------
    op.create_table(
        "documents",
        sa.Column(
            "doc_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "space_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.spaces.space_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("head_commit_sha", sa.Text(), nullable=False),
        sa.Column(
            "last_edited_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_edited_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "space_id", "relative_path", name="uq_documents_space_path"
        ),
        schema="strategy",
    )
    op.create_index(
        "ix_documents_space",
        "documents",
        ["space_id"],
        schema="strategy",
    )


def downgrade() -> None:
    op.drop_table("documents", schema="strategy")
    op.drop_table("spaces", schema="strategy")
    # Leave the schema in place — it is canonical topology, not
    # revision-owned, and dropping it would cascade any concurrently
    # added strategy.* objects from later phases.
