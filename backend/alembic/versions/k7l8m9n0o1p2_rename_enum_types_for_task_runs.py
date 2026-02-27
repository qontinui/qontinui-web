"""Rename PostgreSQL enum types for task_runs migration.

The g3h4i5j6k7l8 migration renamed tables (ai_tasks -> task_runs, etc.)
but never renamed the PostgreSQL enum types. The SQLAlchemy model references
new enum names (task_run_status, finding_category, etc.) with create_type=False,
but the actual DB types are still ai_task_*.

This migration renames the enum types to match the model expectations.

Revision ID: k7l8m9n0o1p2
Revises: j6k7l8m9n0o1
Create Date: 2026-02-26

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k7l8m9n0o1p2"
down_revision: str | None = "j6k7l8m9n0o1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mapping of old enum type names to new enum type names
ENUM_RENAMES = [
    ("ai_task_status", "task_run_status"),
    ("ai_task_finding_category", "finding_category"),
    ("ai_task_finding_severity", "finding_severity"),
    ("ai_task_finding_status", "finding_status"),
    ("ai_task_finding_action_type", "finding_action_type"),
]


def upgrade() -> None:
    for old_name, new_name in ENUM_RENAMES:
        op.execute(f"ALTER TYPE {old_name} RENAME TO {new_name}")


def downgrade() -> None:
    for old_name, new_name in ENUM_RENAMES:
        op.execute(f"ALTER TYPE {new_name} RENAME TO {old_name}")
