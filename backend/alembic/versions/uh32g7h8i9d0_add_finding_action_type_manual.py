"""Add `manual` to finding_action_type PG ENUM.

The generated ``TaskRunFindingActionType`` (from the Rust schemas crate)
declares four variants: ``auto_fix``, ``needs_user_input``, ``manual``,
``informational``.  The PG ENUM only had three.  Pydantic accepts
``manual`` at the API boundary (since 18e28bdd); without this migration
an INSERT with that action_type would fail.

The runner's internal ``FindingActionType`` enum (runner/findings/types.rs)
also gained the ``Manual`` variant in the same commit so runner-generated
findings can use it — otherwise the wire contract would be advertising a
value no producer could emit.

Revision ID: uh32g7h8i9d0
Revises: tg21f6g7h8c9
Create Date: 2026-04-16

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "uh32g7h8i9d0"
down_revision: str | None = "tg21f6g7h8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE finding_action_type ADD VALUE IF NOT EXISTS 'manual'"
        )


def downgrade() -> None:
    # See tg21f6g7h8c9 for the full rationale of the rename-and-recreate
    # pattern — PostgreSQL has no direct ``DROP VALUE`` for enum types.
    op.execute(
        "UPDATE task_run_findings SET action_type = 'auto_fix' "
        "WHERE action_type = 'manual'"
    )
    op.execute(
        "ALTER TYPE finding_action_type RENAME TO finding_action_type_old"
    )
    op.execute(
        "CREATE TYPE finding_action_type AS ENUM ("
        "'auto_fix', 'needs_user_input', 'informational'"
        ")"
    )
    op.execute(
        "ALTER TABLE task_run_findings "
        "ALTER COLUMN action_type TYPE finding_action_type "
        "USING action_type::text::finding_action_type"
    )
    op.execute("DROP TYPE finding_action_type_old")
