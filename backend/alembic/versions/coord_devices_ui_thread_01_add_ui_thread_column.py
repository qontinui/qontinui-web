"""add coord.devices.ui_thread — the runner's native UI-thread liveness block

Revision ID: coord_devices_ui_thread_01
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Plan ``2026-09-09-the-runner-ui-thread-liveness-block-is-emitted-to-three-sinks-and-read-by-none``,
Half 2a (the migration, landed ALONE and ahead of any reader).

The runner sends a ``ui_thread`` object on its devices-WebSocket heartbeat
(qontinui-runner ``mcp/backend_relay.rs``, built by ``heartbeat.rs``
``HeartbeatUiThread`` — ten snake_case keys: ``wedged`` (tri-state; null is
UNKNOWN), ``reason``, ``probe_wedged``, ``events_undelivered``,
``event_pong_age_ms``, ``ping_delivery``, ``ping_emit_failures``,
``last_ping_emit_ok_age_ms``, ``last_ping_emit_fail_age_ms``,
``false_death_suppressed``). ``devices_ws._handle_heartbeat`` reads
``derived_status`` / ``ui_error`` / ``recent_crash`` off the same message and
drops ``ui_thread``, so the one verdict that separates "the UI thread is wedged"
from every other ``errored`` cause never reaches the database.

One nullable JSONB column, matching how ``ui_error`` and ``recent_crash`` are
already stored beside it (``app/models/device.py``). JSONB rather than typed
columns so keys a newer runner adds ride through without a migration each.

Nullable, no server default: a pre-existing row reads ``NULL`` — UNKNOWN,
never "not wedged" — until its runner next heartbeats with a writer that stores
the block. This revision adds NO reader and NO writer: the ORM mapping, the
``heartbeat_device`` write and the fleet read land in a separate, later PR, so
that no deployed image ever SELECTs a column that does not exist yet
(``deploy-web.yml`` rolls the image independently of the migrate workflow).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_devices_ui_thread_01"
down_revision: str = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column(
            "ui_thread",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment=(
                "Runner's native UI-thread liveness block from its latest "
                "heartbeat (wedged tri-state, reason, ping deliverability). "
                "NULL = UNKNOWN, never 'not wedged'."
            ),
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("devices", "ui_thread", schema="coord")
