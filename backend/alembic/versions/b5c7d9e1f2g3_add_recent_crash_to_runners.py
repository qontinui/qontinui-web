"""add_recent_crash_to_runners

Revision ID: b5c7d9e1f2g3
Revises: c1a6f50ead4e
Create Date: 2026-04-22

Post-Phase-3J follow-up — surface Rust crash dumps on the fleet page.

Adds a single nullable column to the ``runners`` table:

* ``recent_crash`` (JSONB): structured summary of the most recent Rust
  crash dump the runner's startup scanner found
  (``file_path/reported_at/panic_location/panic_message/thread``). ``NULL``
  when no fresh dump is present.

Non-unwinding Rust panics abort the process before the React error
boundary can fire, so ``ui_error`` alone misses that class of failure.
``recent_crash`` lets the web fleet dashboard flag a runner that just
restarted after a hard panic.

Nullable with no server default: pre-existing rows keep ``NULL`` until
their runner heartbeats in with the post-3J payload extension.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5c7d9e1f2g3"
down_revision: str = "c1a6f50ead4e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runners",
        sa.Column(
            "recent_crash",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment=(
                "Most recent Rust crash dump surfaced by the runner's "
                "startup scanner "
                "(file_path/reported_at/panic_location/panic_message/"
                "thread) or NULL if no fresh dump is present."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("runners", "recent_crash")
