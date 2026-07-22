"""add renderer-memory telemetry columns to coord.devices

Revision ID: a1cc120c0fba
Revises: coord_sessions_role_01
Create Date: 2026-07-18

Renderer-memory watchdog + twin SLO (plan
``2026-06-09-runner-renderer-memory-watchdog-and-twin-slo``, Phase 3.3):
the runner's renderer-memory watchdog needs a device-scoped place to persist
its telemetry so coord's twin can answer fleet-wide questions — *how many
runners are trending toward a WebView2 renderer OOM, and how often is the
watchdog force-reloading them?* These are device-scoped operational telemetry
(one renderer process per machine), persisted as typed columns on the one
``coord.devices`` row per device.

- ``renderer_memory_bytes BIGINT NOT NULL DEFAULT 0`` — most recent renderer
  working-set sample reported by the watchdog (straight-write per heartbeat:
  latest sampled value).
- ``renderer_reload_total BIGINT NOT NULL DEFAULT 0`` — cumulative count of
  watchdog-triggered renderer reloads since the runner process booted
  (monotonic per process; a runner restart resets to the new process's count).
- ``renderer_reload_storming BOOLEAN NOT NULL DEFAULT false`` — true when the
  watchdog has detected reload-storming (repeated reloads in a short window
  without memory recovering) — the field signal that a runner is stuck in a
  reload loop rather than being healed by a single reload.

All three columns have safe defaults so existing devices are unaffected
(capture-backend telemetry precedent). Idempotent ``ADD COLUMN IF NOT EXISTS``
so coord boots cleanly against a PG where this alembic revision hasn't been
applied yet — this decouples deploy order between coord and web. This
migration must deploy BEFORE the coord PR that reads these columns.
"""

from collections.abc import Sequence
from typing import Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a1cc120c0fba"
down_revision: Union[str, None] = "coord_sessions_role_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add renderer-memory telemetry columns to coord.devices. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS renderer_memory_bytes     BIGINT  NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS renderer_reload_total     BIGINT  NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS renderer_reload_storming  BOOLEAN NOT NULL DEFAULT false
        """
    )


def downgrade() -> None:
    """Remove renderer-memory telemetry columns from coord.devices."""
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP COLUMN IF EXISTS renderer_reload_storming,
            DROP COLUMN IF EXISTS renderer_reload_total,
            DROP COLUMN IF EXISTS renderer_memory_bytes
        """
    )
