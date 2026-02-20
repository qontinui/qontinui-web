"""Rename library_scriptlets to library_prompt_snippets.

Revision ID: i5j6k7l8m9n0
Revises: h4i5j6k7l8m9
Create Date: 2026-02-20

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "i5j6k7l8m9n0"
down_revision: str | None = "h4i5j6k7l8m9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Rename the table
    op.rename_table("library_scriptlets", "library_prompt_snippets")

    # Rename indexes to match new table name
    op.execute(
        "ALTER INDEX ix_library_scriptlets_created_by_user_id "
        "RENAME TO ix_library_prompt_snippets_created_by_user_id"
    )
    op.execute(
        "ALTER INDEX ix_library_scriptlets_project_id "
        "RENAME TO ix_library_prompt_snippets_project_id"
    )
    op.execute(
        "ALTER INDEX ix_library_scriptlets_category "
        "RENAME TO ix_library_prompt_snippets_category"
    )

    # Rename primary key constraint
    op.execute(
        "ALTER TABLE library_prompt_snippets "
        "RENAME CONSTRAINT library_scriptlets_pkey "
        "TO library_prompt_snippets_pkey"
    )


def downgrade() -> None:
    # Rename primary key constraint back
    op.execute(
        "ALTER TABLE library_scriptlets "
        "RENAME CONSTRAINT library_prompt_snippets_pkey "
        "TO library_scriptlets_pkey"
    )

    # Rename indexes back
    op.execute(
        "ALTER INDEX ix_library_prompt_snippets_created_by_user_id "
        "RENAME TO ix_library_scriptlets_created_by_user_id"
    )
    op.execute(
        "ALTER INDEX ix_library_prompt_snippets_project_id "
        "RENAME TO ix_library_scriptlets_project_id"
    )
    op.execute(
        "ALTER INDEX ix_library_prompt_snippets_category "
        "RENAME TO ix_library_scriptlets_category"
    )

    # Rename the table back
    op.rename_table("library_prompt_snippets", "library_scriptlets")
