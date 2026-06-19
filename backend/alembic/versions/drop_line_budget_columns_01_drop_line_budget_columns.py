"""drop coord line-budget columns — vestigial after coord #707

Revision ID: drop_line_budget_columns_01
Revises: coord_session_messages
Create Date: 2026-06-19

Drops two now-dead columns from the ``coord`` schema:

* ``coord.tenant_merge_settings.line_budget``
* ``coord.tenant_repo_profiles.line_budget_override``

coord PR #707 (MERGED + DEPLOYED) removed ALL reads/writes of the line-budget
columns from coord, so they are vestigial. coord authors no schema of its own —
qontinui-web's alembic tree is the SOLE author of ``coord.*`` schema — so the
DROP belongs here.

Pure ``op.execute`` DDL, every statement schema-qualified to ``coord`` (the
``check_alembic_schema_args.py`` gate requires it). ``IF EXISTS`` makes the drop
idempotent-friendly, matching the house style of the surrounding migrations. No
app-code imports, no backfill — the prod migrator container lacks app deps.

down_revision chains off ``coord_session_messages`` — the head assigned by
coord's migration-reservation handshake (POST /coord/migrations/reserve,
reservation_id 96f78417-4cbe-470e-85eb-56c6f9b988d8, position 3, i.e. stacked
behind two in-flight migrations). The assignment is used VERBATIM rather than
hand-picking a head.

NOTE: qontinui-web's alembic tree is intentionally multi-headed; chaining off
coord's reservation-tracked head is correct and expected — no attempt is made to
collapse the multi-head state.

The columns were originally created by ``pr_merge_02_tenant_settings`` as plain
nullable ``INTEGER`` columns (no default):

* ``tenant_merge_settings.line_budget          INTEGER``  (nullable, no default)
* ``tenant_repo_profiles.line_budget_override  INTEGER``  (nullable, no default)

downgrade() RE-ADDS both columns mirroring those original definitions exactly, so
the drop is a true inverse (column data is not preserved).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "drop_line_budget_columns_01"
down_revision: str = "coord_session_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the two vestigial coord line-budget columns."""
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP COLUMN IF EXISTS line_budget"
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP COLUMN IF EXISTS line_budget_override"
    )


def downgrade() -> None:
    """Re-add the line-budget columns with their original definitions.

    Mirrors the original ``pr_merge_02_tenant_settings`` column definitions:
    both are plain nullable ``INTEGER`` columns with no default.
    """
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings "
        "ADD COLUMN IF NOT EXISTS line_budget INTEGER"
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "ADD COLUMN IF NOT EXISTS line_budget_override INTEGER"
    )
