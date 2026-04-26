"""add wrapper marketplace tables

Revision ID: c6d1e2f3a4b5
Revises: b5c7d9e1f2g3
Create Date: 2026-04-25

Phase 6 of the wrapper-runner integration plan — backend storage for the
qontinui-web wrapper marketplace. The canonical registry lives at
``github.com/jspinak/wrappers-registry`` (a single ``registry.json``);
this migration adds the social/marketplace surface that augments it:

* ``wrapper_entries`` — synced hourly from registry.json. One row per
  wrapper, keyed on the wrapper id.
* ``wrapper_ratings`` — one star rating (1..5) per (user, wrapper).
* ``wrapper_comments`` — threaded comments with a moderation_state field.
* ``wrapper_install_events`` — anonymous install pings from runners; the
  raw runner id is hashed (sha256) before insert so the table never holds
  raw runner identifiers.

All four tables cascade-delete from ``wrapper_entries`` so removing a
wrapper from the registry purges its social data. ``wrapper_ratings``
and ``wrapper_comments`` cascade-delete from ``users`` so deleting a
user purges their content.

Hand-written (not autogen).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6d1e2f3a4b5"
down_revision: str = "b5c7d9e1f2g3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # wrapper_entries — synced from registry.json
    op.create_table(
        "wrapper_entries",
        sa.Column(
            "id",
            sa.Text(),
            nullable=False,
            comment="Mirrors the wrapper.id field in registry.json.",
        ),
        sa.Column("package", sa.Text(), nullable=False),
        sa.Column("latest_version", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "categories",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "transport",
            sa.Text(),
            nullable=False,
            comment="api | headless | headed | live",
        ),
        sa.Column(
            "author_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="{name, url?, email?}",
        ),
        sa.Column("repo", sa.Text(), nullable=True),
        sa.Column("license", sa.Text(), nullable=True),
        sa.Column(
            "verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "registry_synced_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("wrapper_entries_pkey")),
    )
    op.create_index(
        "wrapper_entries_categories_gin",
        "wrapper_entries",
        ["categories"],
        unique=False,
        postgresql_using="gin",
    )

    # wrapper_ratings — one (1..5) star rating per (user, wrapper)
    op.create_table(
        "wrapper_ratings",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(always=False),
            nullable=False,
        ),
        sa.Column("wrapper_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "stars",
            sa.SmallInteger(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "stars BETWEEN 1 AND 5",
            name=op.f("wrapper_ratings_stars_check"),
        ),
        sa.ForeignKeyConstraint(
            ["wrapper_id"],
            ["wrapper_entries.id"],
            name=op.f("wrapper_ratings_wrapper_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("wrapper_ratings_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("wrapper_ratings_pkey")),
        sa.UniqueConstraint(
            "wrapper_id",
            "user_id",
            name=op.f("wrapper_ratings_wrapper_id_user_id_key"),
        ),
    )
    op.create_index(
        "wrapper_ratings_wrapper_idx",
        "wrapper_ratings",
        ["wrapper_id"],
        unique=False,
    )

    # wrapper_comments — threaded comments with moderation state
    op.create_table(
        "wrapper_comments",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(always=False),
            nullable=False,
        ),
        sa.Column("wrapper_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "moderation_state",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'visible'"),
            comment="visible | flagged | hidden",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["wrapper_id"],
            ["wrapper_entries.id"],
            name=op.f("wrapper_comments_wrapper_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("wrapper_comments_user_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["wrapper_comments.id"],
            name=op.f("wrapper_comments_parent_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("wrapper_comments_pkey")),
    )
    op.create_index(
        "wrapper_comments_wrapper_idx",
        "wrapper_comments",
        ["wrapper_id", "created_at"],
        unique=False,
    )

    # wrapper_install_events — anonymous install pings, hashed runner id
    op.create_table(
        "wrapper_install_events",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(always=False),
            nullable=False,
        ),
        sa.Column("wrapper_id", sa.Text(), nullable=False),
        sa.Column(
            "runner_id_hash",
            sa.Text(),
            nullable=False,
            comment="sha256 of runner id; never the raw value (privacy).",
        ),
        sa.Column("version", sa.Text(), nullable=True),
        sa.Column(
            "installed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["wrapper_id"],
            ["wrapper_entries.id"],
            name=op.f("wrapper_install_events_wrapper_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("wrapper_install_events_pkey")),
    )
    op.create_index(
        "wrapper_install_events_wrapper_idx",
        "wrapper_install_events",
        ["wrapper_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "wrapper_install_events_wrapper_idx",
        table_name="wrapper_install_events",
    )
    op.drop_table("wrapper_install_events")

    op.drop_index(
        "wrapper_comments_wrapper_idx",
        table_name="wrapper_comments",
    )
    op.drop_table("wrapper_comments")

    op.drop_index(
        "wrapper_ratings_wrapper_idx",
        table_name="wrapper_ratings",
    )
    op.drop_table("wrapper_ratings")

    op.drop_index(
        "wrapper_entries_categories_gin",
        table_name="wrapper_entries",
        postgresql_using="gin",
    )
    op.drop_table("wrapper_entries")
