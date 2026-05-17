"""strategy collaboration substrate — Phase 2.1

Revision ID: strategy_p2_01_collab_tables
Revises: wave_7_01_merge_heads
Create Date: 2026-05-17

Phase 2.1 of the Strategy Collaboration plan
(``plans/2026-05-17-strategy-phase-2.md`` §2.1; source design
``plans/2026-05-15-strategy-collaboration-design.md``). Adds the
substrate tables collaboration needs on top of Phase 1's read-only
document foundation (``strategy.spaces`` + ``strategy.documents``):

- ``strategy.threads``   — a comment thread anchored on a document
- ``strategy.posts``     — replies within a thread (nested + soft-deletable)
- ``strategy.mentions``  — ``@``-mention rows materialised at post create

PK naming follows the Phase 1 convention (``space_id`` / ``doc_id``
→ ``thread_id`` / ``post_id`` / ``mention_id``), NOT the generic
``id``. FK targets are verified live on ``origin/main``:

- ``strategy.documents(doc_id)`` — Phase 1 PK (see
  ``strategy_p1_01_schema.py:136``)
- ``auth.users(id)`` — precedent: ``strategy.documents.last_edited_by``
  → ``auth.users(id) ON DELETE SET NULL`` (``strategy_p1_01_schema.py:159``)

ON DELETE semantics:

- ``threads.doc_id``               → ``CASCADE``  (doc gone → its threads gone)
- ``threads.created_by``           → ``SET NULL`` (preserve thread on user delete)
- ``threads.resolved_by``          → ``SET NULL``
- ``posts.thread_id``              → ``CASCADE``  (thread gone → its posts gone)
- ``posts.parent_post_id``         → ``SET NULL`` (orphan reply, don't cascade-delete)
- ``posts.author_id``              → ``SET NULL`` (preserve post on user delete; soft-delete handles content)
- ``mentions.post_id``             → ``CASCADE``  (post gone → its mention rows gone)
- ``mentions.mentioned_user_id``   → ``CASCADE``  (user gone → their mention rows gone; no orphaned-mention surface)

Soft delete on posts: ``deleted_at`` column lets a post be
"removed" while preserving thread integrity (reply chain + mention
references stay intact). Hard-cascade on the parent thread is still
correct — when the whole thread is gone, soft-deleted children go
with it.

Indexes are chosen for the obvious read paths:

- ``idx_strategy_threads_doc_id``: list threads on a doc, newest first
- ``idx_strategy_threads_unresolved``: partial index on open threads only
- ``idx_strategy_posts_thread_id``: list posts in a thread, oldest first
- ``idx_strategy_posts_author_id``: per-author activity, newest first
- ``idx_strategy_mentions_mentioned_user``: partial index — unread mentions per user
- ``idx_strategy_mentions_post_id``: lookup mentions on a post (cascade + render)

``CREATE SCHEMA IF NOT EXISTS strategy`` is intentionally omitted —
Phase 1's ``strategy_p1_01_schema`` already creates it and this
revision runs after.

The ``.pre-commit-hooks/check_alembic_schema_args.py`` ALLOWED_SCHEMAS
list already contains ``strategy`` (added by Phase 1).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "strategy_p2_01_collab_tables"
down_revision: str = "wave_7_01_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # strategy.threads — comment thread anchored on a document.
    # ------------------------------------------------------------------
    op.create_table(
        "threads",
        sa.Column(
            "thread_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "doc_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.documents.doc_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        # Optional anchor: section heading or line number the thread is
        # anchored to. NULL = thread is on the doc as a whole.
        sa.Column("anchor", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "resolved_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_threads_doc_id",
        "threads",
        ["doc_id", sa.text("created_at DESC")],
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_threads_unresolved",
        "threads",
        ["doc_id"],
        schema="strategy",
        postgresql_where=sa.text("resolved_at IS NULL"),
    )

    # ------------------------------------------------------------------
    # strategy.posts — replies within a thread. Nested via
    # parent_post_id (NULL = top-level reply). Soft-delete via
    # deleted_at preserves thread integrity.
    # ------------------------------------------------------------------
    op.create_table(
        "posts",
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "thread_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.threads.thread_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.posts.post_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "edited_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_posts_thread_id",
        "posts",
        ["thread_id", "created_at"],
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_posts_author_id",
        "posts",
        ["author_id", sa.text("created_at DESC")],
        schema="strategy",
    )

    # ------------------------------------------------------------------
    # strategy.mentions — one row per (post, mentioned_user) pair,
    # materialised by the post-create handler after parsing
    # @[user_id:<uuid>] markers from body_markdown. read_at NULL =
    # unread; the partial index makes the "unread per user" query a
    # one-shot index scan.
    # ------------------------------------------------------------------
    op.create_table(
        "mentions",
        sa.Column(
            "mention_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.posts.post_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "mentioned_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "read_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="strategy",
    )
    op.create_index(
        "idx_strategy_mentions_mentioned_user",
        "mentions",
        ["mentioned_user_id", "read_at"],
        schema="strategy",
        postgresql_where=sa.text("read_at IS NULL"),
    )
    op.create_index(
        "idx_strategy_mentions_post_id",
        "mentions",
        ["post_id"],
        schema="strategy",
    )


def downgrade() -> None:
    # FK-reverse order: mentions → posts → threads.
    op.drop_table("mentions", schema="strategy")
    op.drop_table("posts", schema="strategy")
    op.drop_table("threads", schema="strategy")
