"""add capture-backend telemetry columns to coord.devices

Revision ID: d6e7f8a9b0c1
Revises: lineage_recorded_at_idx_01
Create Date: 2026-06-07

Fleet capture-backend telemetry (plan ``2026-06-07-fleet-capture-backend-telemetry``):
the runner's 30s device-scoped fleet heartbeat (``fleet::spawn_heartbeat`` ->
``POST /coord/devices/register``) carries the WebView2 capture-backend health
counters so fleet-wide questions become answerable — *what fraction of runners
are silently on the MonitorCrop fallback?* These are device-scoped operational
telemetry (one WebView2 runtime per machine), persisted as typed columns on the
one ``coord.devices`` row per device.

- ``capture_preview_count BIGINT NOT NULL DEFAULT 0`` — cumulative count of
  successful CapturePreview frames since the runner process booted (straight-write
  per heartbeat: latest cumulative value, monotonic per process; a runner restart
  resets to the new process's count = the honest "since this boot" value).
- ``monitor_crop_count BIGINT NOT NULL DEFAULT 0`` — cumulative count of frames
  served via the MonitorCrop fallback ladder (the field signal that a runner is
  silently on the fallback).
- ``last_capture_fallback_at TIMESTAMPTZ NULL`` — timestamp of the most recent
  CapturePreview -> MonitorCrop fallback on this device.

All three columns are nullable / have safe defaults so existing devices are
unaffected (ci_runner precedent). A coord-side boot self-heal helper mirrors
these ``ADD COLUMN IF NOT EXISTS`` statements so coord boots cleanly against a
PG where this alembic revision hasn't been applied yet — this decouples deploy
order between coord and web.
"""

from collections.abc import Sequence
from typing import Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, None] = "lineage_recorded_at_idx_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add capture-backend telemetry columns to coord.devices. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS capture_preview_count    BIGINT      NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS monitor_crop_count       BIGINT      NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS last_capture_fallback_at TIMESTAMPTZ NULL
        """
    )


def downgrade() -> None:
    """Remove capture-backend telemetry columns from coord.devices."""
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP COLUMN IF EXISTS last_capture_fallback_at,
            DROP COLUMN IF EXISTS monitor_crop_count,
            DROP COLUMN IF EXISTS capture_preview_count
        """
    )
