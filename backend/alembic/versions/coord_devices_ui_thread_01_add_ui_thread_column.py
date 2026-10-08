"""add coord.devices.ui_thread — the runner's native UI-thread liveness block

Revision ID: coord_devices_ui_thread_01
Revises: prbody_citation_01
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

Why raw SQL rather than ``op.add_column``: coord's merge-gate migration
classifier (qontinui-coord ``pr_merge/migration_classifier.rs``) admits an
additive column only as a static ``ALTER TABLE ... ADD COLUMN IF NOT EXISTS``
literal inside ``op.execute``; an un-guarded ``op.add_column`` is held for
escalation. The ``IF NOT EXISTS`` guard also makes the revision idempotent
against a re-run. The column comment is a separate static ``COMMENT ON
COLUMN`` statement, which the same classifier admits. Precedent:
``sched_cond_01_scheduled_tasks_conditions.py``.

Adopted by route-around from qontinui-web#1529 (owner session gone), which
also re-pointed ``down_revision`` from ``coord_iops_idx_01`` onto main's
then-current single head, ``overlord_01_interventions``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_devices_ui_thread_01"
down_revision: str = "prbody_citation_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.devices.ui_thread`` (nullable JSONB). Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS ui_thread JSONB
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.devices.ui_thread IS
            'Runner native UI-thread liveness block from its latest heartbeat (wedged tri-state, reason, ping deliverability). NULL = UNKNOWN, never not-wedged.'
        """
    )


def downgrade() -> None:
    """Drop ``coord.devices.ui_thread``."""
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS ui_thread")
