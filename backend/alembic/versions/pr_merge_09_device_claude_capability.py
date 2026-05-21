"""pr_merge phase 8 — device Claude Code capability + suggestion mutes

Revision ID: pr_merge_09_device_claude_capability
Revises: pr_merge_08_merge_phase6_phase7
Create Date: 2026-05-22

Phase 8 D8.0 + D8.6 of the PR Merge Orchestrator
(``D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md``).

This single revision lands the small schema deltas Phase 8 needs:

1. **``coord.devices.claude_code_available``** (BOOLEAN NOT NULL DEFAULT
   false). Reported by the runner on its ``POST /coord/devices/register``
   heartbeat. Coord refuses to route Phase 8's auditor (or Phase 4's
   merge-specialist) spawn to a device whose latest heartbeat said
   ``false`` — the "no audit-capable device" precondition (D8.0).

2. **``coord.tenant_merge_settings.suggestion_mutes``** (JSONB DEFAULT
   ``'{}'::jsonb``). Per-tenant mute window for drift-suggestion kinds
   (Phase 8 D8.6 Mute-for-30-days). Shape:
   ``{"add_escalate_path": "2026-06-21T00:00:00Z", ...}``. When a kind's
   timestamp is in the future, the drift watcher skips proposals of that
   kind for the tenant.

Phase 8 D8.4 (the ``coord.user_overrides`` table itself) shipped early
in Phase 7's ``pr_merge_06_user_overrides.py`` — the schema there
matches the D8.4 spec verbatim, so this revision does NOT recreate it.
Phase 8's drift watcher reads from that already-shipped table.

``coord.tenant_merge_settings.preferred_auditor_device_id`` was already
seeded by Phase 2's ``pr_merge_02_tenant_settings.py`` migration (with
a FK to ``coord.devices`` and ``ON DELETE SET NULL``); we re-use it
as-is for the Phase 8 D8.2 audit-target-device pin.

Idempotency: ``ADD COLUMN IF NOT EXISTS``. Re-running against an
already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_merge_09_device_claude_capability"
down_revision: str = "pr_merge_08_merge_phase6_phase7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the Phase 8 columns."""

    # ------------------------------------------------------------------
    # 1. coord.devices.claude_code_available
    # ------------------------------------------------------------------
    # NOT NULL with default false so existing rows (the personal-jspinak
    # fleet) immediately satisfy the constraint without a backfill pass.
    # The runner-side heartbeat will overwrite to `true` once the
    # `claude --version` probe succeeds, on the next register tick.
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS claude_code_available BOOLEAN
                NOT NULL DEFAULT false
        """
    )
    # Partial index — only audit-capable rows participate in the
    # tenant_has_audit_capable_device lookup. Combined with
    # last_seen_at > now()-5m, this is the gating predicate.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_devices_claude_capable
            ON coord.devices (tenant_id, last_seen_at DESC)
            WHERE claude_code_available = true
        """
    )

    # ------------------------------------------------------------------
    # 2. coord.tenant_merge_settings.suggestion_mutes
    # ------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD COLUMN IF NOT EXISTS suggestion_mutes JSONB
                NOT NULL DEFAULT '{}'::jsonb
        """
    )


def downgrade() -> None:
    """Drop the two Phase 8 columns + the partial index.

    No data preservation. The drift watcher regenerates suggestions from
    the next 30-day window of overrides; mute windows are advisory.
    ``preferred_auditor_device_id`` is owned by Phase 2 and is NOT
    dropped here.
    """
    op.execute("DROP INDEX IF EXISTS coord.idx_devices_claude_capable")
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings "
        "DROP COLUMN IF EXISTS suggestion_mutes"
    )
    op.execute(
        "ALTER TABLE coord.devices DROP COLUMN IF EXISTS claude_code_available"
    )
