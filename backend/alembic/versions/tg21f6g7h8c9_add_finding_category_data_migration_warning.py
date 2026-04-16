"""Add `data_migration` and `warning` to finding_category PG ENUM.

The Rust runner's `FindingCategory` enum (qontinui-runner findings/types.rs)
and the generated `qontinui_schemas.generated.TaskRunFindingCategory` both
include `warning` and `data_migration` variants.  The PG ENUM type
`finding_category` only had the 11 older variants, so any finding with
those two categories would fail at INSERT time with a
`invalid input value for enum` error — a latent data-loss bug.

This migration brings the DB enum up to parity with the Rust source of
truth.  `ALTER TYPE ... ADD VALUE` is non-transactional in PostgreSQL
and cannot be rolled back by wrapping in a transaction, so the
downgrade path recreates the enum without the new values (destroying
any rows that use them).

Revision ID: tg21f6g7h8c9
Revises: sf20e5f6g7b8
Create Date: 2026-04-16

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "tg21f6g7h8c9"
down_revision: str | None = "sf20e5f6g7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


NEW_VALUES = ("data_migration", "warning")


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block in
    # some Postgres versions; use AUTOCOMMIT for each statement and the
    # `IF NOT EXISTS` clause so reruns are safe.
    with op.get_context().autocommit_block():
        for value in NEW_VALUES:
            op.execute(
                f"ALTER TYPE finding_category ADD VALUE IF NOT EXISTS '{value}'"
            )


def downgrade() -> None:
    # PostgreSQL has no direct `DROP VALUE` for an enum type.  The
    # canonical downgrade pattern is: rename the old type, recreate the
    # type without the value(s), cast all columns back over, and drop
    # the renamed type.  We also zero out any rows that used the new
    # values to avoid cast failures.
    op.execute(
        "UPDATE task_run_findings SET category = 'code_bug' "
        "WHERE category IN ('data_migration', 'warning')"
    )
    op.execute("ALTER TYPE finding_category RENAME TO finding_category_old")
    op.execute(
        "CREATE TYPE finding_category AS ENUM ("
        "'code_bug', 'security', 'performance', 'todo', 'enhancement', "
        "'config_issue', 'test_issue', 'documentation', 'runtime_issue', "
        "'already_fixed', 'expected_behavior'"
        ")"
    )
    op.execute(
        "ALTER TABLE task_run_findings "
        "ALTER COLUMN category TYPE finding_category "
        "USING category::text::finding_category"
    )
    op.execute("DROP TYPE finding_category_old")
