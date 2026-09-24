"""strategy schema — drop it with the retired Strategy collaboration feature

Revision ID: strategy_p4_01_drop_schema
Revises: coord_wu_authored_at_02
Create Date: 2026-09-24

Phase 4 of plan ``2026-09-20-remove-the-strategy-collaboration-feature``.
The operator retired the Strategy collaboration product on 2026-09-20; its
frontend (qontinui-web ``049d19246``), its web backend routes (qontinui-web
#1458, ``4362c1c72``) and its coord modules (qontinui-coord ``e2e326fb``,
adopted from #2387) are all gone from ``main``. This revision removes the last
piece: the ``strategy`` PG schema and its five tables (``spaces``,
``documents``, ``threads``, ``posts``, ``mentions``).

Ordering (plan D3 — callers first, schema last)
===============================================

coord was the only thing that ever queried these tables (the web backend
proxied through coord). The drop is safe only once the DEPLOYED coord no
longer carries the Strategy modules — a coord still running the git-read sync
would error on every poll. Verified before authoring, 2026-09-24: coord
``/health`` served ``build_sha a3a769f66``, which contains ``e2e326fb``, and a
``strategy.<table>`` grep over that tree and over the ``origin/main`` of every
other repo in the workspace found no reader. coord's schema-consistency
watcher no longer scopes ``strategy`` either (default ``coord,public,project``
in that same build).

The old revisions stay (plan D4)
================================

``strategy_p1_01_schema``, ``strategy_p1_02_seed``,
``strategy_p2_01_collab_tables`` and the two merge revisions that link to them
(``5874f5af0e4b``, ``rp02_merge_heads``) are history on the chain and are
load-bearing joints. They still create the schema on a fresh database; this
revision then drops it.

Data does NOT come back
=======================

``DROP SCHEMA ... CASCADE`` destroys every row: comment threads, posts,
mentions and the seeded space/documents. ``downgrade()`` recreates the EMPTY
structure the two schema revisions built (``strategy_p1_01_schema`` and
``strategy_p2_01_collab_tables``: tables, keys, indexes) so the chain stays
reversible, and nothing more — it does not re-run ``strategy_p1_02_seed``. The recovery
path for the data is the ``pg_dump --schema=strategy`` plan D5 requires to be
taken from production immediately BEFORE this revision is applied; the PR that
carries this revision is held as a draft until that dump exists.

The document CONTENT is not in these tables — it lives as Markdown in
``qontinui-dev-notes/project-strategy/``, which this plan does not touch.

``CASCADE`` would also silently drop objects OUTSIDE the schema that depend on
it — a foreign key or a view in another schema. The repo creates none, but a
hand-made one in production would not show up in the repo, and the pre-apply
dump (``--schema=strategy``) would not capture it either. So ``upgrade()``
refuses rather than cascading across a schema boundary: it lists any such
dependent and raises, leaving the schema intact.

``strategy`` stays in ``.pre-commit-hooks/check_alembic_schema_args.py``
``ALLOWED_SCHEMAS``: the historical revisions and this revision's
``downgrade()`` still name it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "strategy_p4_01_drop_schema"
down_revision: str = "coord_wu_authored_at_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Objects in OTHER schemas that depend on a ``strategy`` relation: foreign keys
# referencing it, and views/rules selecting from it. ``to_regnamespace`` is NULL
# when the schema is already gone, so both arms then return nothing.
_FOREIGN_DEPENDENTS_SQL = """
WITH strategy_rels AS (
    SELECT oid FROM pg_class WHERE relnamespace = to_regnamespace('strategy')
)
SELECT 'foreign key ' || con.conname || ' on ' || con.conrelid::regclass::text
FROM pg_constraint con
WHERE con.contype = 'f'
  AND con.confrelid IN (SELECT oid FROM strategy_rels)
  AND con.connamespace <> to_regnamespace('strategy')
UNION
SELECT 'view/rule on ' || rw.ev_class::regclass::text
FROM pg_depend dep
JOIN pg_rewrite rw ON rw.oid = dep.objid
JOIN pg_class dependent ON dependent.oid = rw.ev_class
WHERE dep.classid = 'pg_rewrite'::regclass
  AND dep.refobjid IN (SELECT oid FROM strategy_rels)
  AND dependent.relnamespace <> to_regnamespace('strategy')
"""


def upgrade() -> None:
    bind = op.get_bind()
    dependents = [row[0] for row in bind.execute(sa.text(_FOREIGN_DEPENDENTS_SQL))]
    if dependents:
        raise RuntimeError(
            "refusing to DROP SCHEMA strategy CASCADE: objects outside the "
            "strategy schema depend on it and would be dropped with it: "
            + "; ".join(sorted(dependents))
        )
    op.execute("DROP SCHEMA IF EXISTS strategy CASCADE")


def _uuid_pk(name: str) -> sa.Column:
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def downgrade() -> None:
    # Structure only — the DDL of strategy_p1_01_schema and
    # strategy_p2_01_collab_tables, verbatim in shape. No rows are restored;
    # see the module docstring.
    op.execute("CREATE SCHEMA IF NOT EXISTS strategy")

    op.create_table(
        "spaces",
        _uuid_pk("space_id"),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("git_repo", sa.Text(), nullable=False),
        sa.Column(
            "git_branch", sa.Text(), nullable=False, server_default=sa.text("'main'")
        ),
        sa.Column(
            "git_path_prefix",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'project-strategy/'"),
        ),
        _created_at(),
        sa.Column(
            "settings",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema="strategy",
    )
    op.create_index("ix_spaces_org", "spaces", ["organization_id"], schema="strategy")

    op.create_table(
        "documents",
        _uuid_pk("doc_id"),
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
    op.create_index("ix_documents_space", "documents", ["space_id"], schema="strategy")

    op.create_table(
        "threads",
        _uuid_pk("thread_id"),
        sa.Column(
            "doc_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategy.documents.doc_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("anchor", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        _created_at(),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
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

    op.create_table(
        "posts",
        _uuid_pk("post_id"),
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
        _created_at(),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
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

    op.create_table(
        "mentions",
        _uuid_pk("mention_id"),
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
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
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
