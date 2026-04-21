"""add_ui_error_and_derived_status_to_runners

Revision ID: a3b4c5d6e7f8
Revises: z2a3b4c5d6e7
Create Date: 2026-04-21

Phase 3J.5 — surface the runner's nuanced health state on the fleet page.

Adds two nullable columns to the ``runners`` table:

* ``ui_error`` (JSONB): structured description of the most recent UI error
  reported by the runner (React error boundary payload — message, stack,
  component stack, digest, first_seen, reported_at, count). ``NULL`` when
  no UI error is currently outstanding.
* ``derived_status`` (VARCHAR(32)): runner-computed overall status
  (``healthy`` / ``degraded`` / ``errored`` / ``offline`` / ``starting``)
  derived from multiple sub-signals. Distinct from the existing ``status``
  column which reflects the runner's self-reported liveness only.

Both are nullable with no server default: pre-existing rows keep ``NULL``
until their runner heartbeats in with the Phase 3J.5 payload extension.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3b4c5d6e7f8"
down_revision: str = "z2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runners",
        sa.Column(
            "ui_error",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment=(
                "Most recent UI error reported by the runner "
                "(message/stack/component_stack/digest/first_seen/"
                "reported_at/count) or NULL if none is outstanding."
            ),
        ),
    )
    op.add_column(
        "runners",
        sa.Column(
            "derived_status",
            sa.String(32),
            nullable=True,
            comment=(
                "Runner-derived overall status "
                "(healthy|degraded|errored|offline|starting). "
                "NULL for pre-Phase-3J runners that have not yet heartbeat "
                "with the extended payload."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("runners", "derived_status")
    op.drop_column("runners", "ui_error")
