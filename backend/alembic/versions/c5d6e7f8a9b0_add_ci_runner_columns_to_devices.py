"""add CI runner columns to coord.devices

Revision ID: c5d6e7f8a9b0
Revises: b4d5e6f7a8c9
Create Date: 2026-05-26

Phase 3a of the self-hosted CI runners plan: extend ``coord.devices``
with CI runner capability tracking columns.

- ``ci_runner_labels TEXT[] NULL`` — user-defined labels (e.g.
  ``["linux", "gpu", "large"]``) that CI job selectors match against,
  analogous to GitHub Actions ``runs-on`` labels.
- ``ci_runner_status TEXT NULL DEFAULT 'offline'`` — current runner
  lifecycle state (``offline`` / ``idle`` / ``busy``).
- ``ci_runner_last_job_at TIMESTAMPTZ NULL`` — timestamp of the last
  CI job dispatched to or completed on this device.

All three columns are nullable / have safe defaults so existing devices
are unaffected. The coord self-heal helper
(``fleet::ensure_ci_runner_columns``) mirrors these columns so coord
boots cleanly against a PG where this alembic revision hasn't been
applied yet.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: str = "b4d5e6f7a8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add CI runner tracking columns to coord.devices. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS ci_runner_labels    TEXT[]       NULL,
            ADD COLUMN IF NOT EXISTS ci_runner_status    TEXT         NULL DEFAULT 'offline',
            ADD COLUMN IF NOT EXISTS ci_runner_last_job_at TIMESTAMPTZ NULL
        """
    )
    # Index for the list_ci_runners query: filter by capabilities @>
    # '["ci_runner"]' AND ci_runner_status. A partial GIN on capabilities
    # would help too, but the jsonb containment check is already indexed
    # by the existing capabilities GIN if one exists; this index covers
    # the status filter.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_devices_ci_runner_status
            ON coord.devices(ci_runner_status)
            WHERE ci_runner_status IS NOT NULL
        """
    )


def downgrade() -> None:
    """Remove CI runner tracking columns from coord.devices."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_devices_ci_runner_status"
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP COLUMN IF EXISTS ci_runner_last_job_at,
            DROP COLUMN IF EXISTS ci_runner_status,
            DROP COLUMN IF EXISTS ci_runner_labels
        """
    )
