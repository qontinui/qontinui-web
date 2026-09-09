"""coord.work_units.owner_agent_session_id — session tier for work-unit SoD

Revision ID: coord_wusod_01
Revises: grantorig_01
Create Date: 2026-09-01

Phase 2 (qontinui-web half) of plan
``2026-09-01-work-unit-sod-session-tier``.

What this adds
==============

A nullable ``owner_agent_session_id UUID`` on ``coord.work_units``: the Claude
Code session UUID (the id space keying ``coord.agent_sessions``, **not**
``coord.sessions.id``) of the session that owns the unit. It is the finest tier
of the separation-of-duties ladder — today SoD can only compare
``owner_actor_key`` (``device_id[:agent_id]``, added by
``coord_workunits_03_work_unit_owner_actor``), so two concurrent sessions on
one device are indistinguishable to the check. The session column lets the
ladder separate them.

Like every other identity column on ``coord.work_units``, it is **server-
stamped, never caller-supplied** — coord lifts it from the verified auth
context, the same posture as ``tenant_id`` and ``owner_actor_key``.

No index, deliberately
======================

The precedent ``coord_workunits_03_work_unit_owner_actor`` creates
``idx_work_units_owner_actor``, but that index exists to back the Phase-3
**graduation domain** queries, which evaluate ``lifecycle_autonomy`` per
``(tenant_id, owner_actor_key)`` — i.e. the actor column is a query key.
Nothing filters or groups on the session column. It is only ever read alongside
the row already fetched by ``work_unit_registry::lookup_with_owner``, so an
index would buy nothing and cost every insert and update on the table.

No FK, deliberately
===================

**No FK** to ``coord.agent_sessions(id)`` — mirroring
``coord_sesscompl_03_gates_agent_session_id`` (``coord.gates.agent_session_id``)
and the newer lineage tables (``coord.agent_logs``,
``coord.prompt_injection_events``, ``coord.footprint_drift_events``), which all
treat the column as a best-effort link. A work-unit transition must not fail
because the ``coord.agent_sessions`` upsert for a brand-new session has not
landed yet: a unit that cannot be transitioned is strictly worse than one whose
owning session cannot be joined.

Deploy order — this migration MUST land first
=============================================

alembic is the sole author of ``coord.*`` schema
(``[policy: alembic-sole-authorship]``). Rust (coord) only DMLs against these
tables and asserts them present at boot via ``state::require_table``. **This
web migration MUST be applied to prod RDS BEFORE the coord image deploys**, or
coord crash-loops on the boot gate — the same deploy-order rule carried by
``coord_workunits_01_work_units`` and ``coord_workunits_03_work_unit_owner_actor``.
The qontinui-coord PR that reads and stamps this column therefore merges AFTER
the PR carrying this revision.

There is deliberately NO backfill
=================================

Every existing ``coord.work_units`` row predates capture, and the only way to
fill one retroactively is the ``(device, tenant) → most-recent-session``
heuristic that **coord's own source explicitly refuses**
(``qontinui-coord/crates/coord/src/mcp/tools.rs:9804-9808``, the doc comment on
``validated_provenance_session``): *"it names the WRONG parent under concurrent
sessions — this fleet's normal state"*. A confidently wrong attribution is
strictly worse than an honest absence, because the absence is legible
downstream and the wrong id is not.

So NULL on an existing row means **"unknown, and honestly so"** — never "no
session". Under the consuming SoD ladder a NULL session lands on tier 6 ⇒
refuse, which is byte-for-byte today's behaviour for those rows. Adding the
column changes nothing until coord starts stamping it.

Idempotency: ``CREATE SCHEMA IF NOT EXISTS`` / ``ADD COLUMN IF NOT EXISTS`` via
raw ``op.execute`` — the collision-safe convention the sibling ``coord.*``
column migrations already use (see ``coord_singleauthored_01_gates``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wusod_01"
down_revision: str | Sequence[str] | None = "grantorig_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable owning-session column to coord.work_units. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # Nullable, server-stamped by coord from the verified auth context.
    # No index: nothing filters on this column — it is read alongside the row
    # already fetched by work_unit_registry::lookup_with_owner.
    op.execute(
        """
        ALTER TABLE coord.work_units
            ADD COLUMN IF NOT EXISTS owner_agent_session_id UUID
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.work_units.owner_agent_session_id IS
            'Claude Code session UUID owning this work unit (the id space '
            'keying coord.agent_sessions, NOT coord.sessions.id). Server-'
            'stamped from the verified auth context, never caller-supplied. '
            'Finest tier of the separation-of-duties ladder, below '
            'owner_actor_key. Nullable and DELIBERATELY NEVER BACKFILLED: the '
            'only retroactive fill is the (device,tenant) -> most-recent-'
            'session heuristic coord explicitly refuses as naming the wrong '
            'parent under concurrency. NULL means unknown, not no-session, and '
            'lands on the ladder tier that refuses.'
        """
    )


def downgrade() -> None:
    """Drop the column. No index or constraint to reverse."""
    op.execute(
        "ALTER TABLE coord.work_units DROP COLUMN IF EXISTS owner_agent_session_id"
    )
