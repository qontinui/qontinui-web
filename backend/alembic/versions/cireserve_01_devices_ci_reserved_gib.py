"""coord.devices.ci_reserved_gib — persist the runner's published CI memory reservation

Revision ID: cireserve_01_devices_ci_reserved_gib
Revises: outbound_budget_windows_01
Create Date: 2026-11-07

Phase 3 of plan ``2026-11-05-the-worktree-cap-counts-idle-trees-against-a-ram-budget``
(the qontinui-web half).

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so the
column coord's budget publish is about to write lands here, and this revision must be
applied **before** any coord build reads it.

What the column holds
=====================

``qontinui-runner`` publishes ``ci_reserved_gib`` on ``POST /coord/fleet/budget``
(``BudgetPublishRequest.ci_reserved_gib`` in ``qontinui-coord``
``crates/coord/src/fleet.rs``): the GiB of host memory its CI slices may take — the sum
of the ``ci.slice/*.slice`` ``memory.high`` (else ``memory.max``), rounded **up** to a
whole GiB, and ``0`` only when the host has no CI slice. coord already consumes it as a
term of ``derive_agent_capacity(memory_gb, cpu_cores, ci_reserved_gib)``, but until now
it was explicitly "not stored in a column of its own", so once the publish was handled
the value was gone. A ``worktree_slot`` refusal therefore could not say WHICH term of
the cap formula bound — the memory budget net of the CI reservation, or the CPU term —
because the CI term was no longer observable. Persisting it lets coord name the binding
term in the refusal.

Type: INTEGER, not a float
==========================

The publisher's value is already a rounded-up whole GiB, and coord's request field is
``Option<u32>`` — the same width as the sibling budget terms it is subtracted from and
compared against, ``memory_gb INTEGER`` and ``cpu_cores INTEGER``
(``ud01_unify_devices_registry``). A ``DOUBLE PRECISION`` column would invite a
fractional value that no publisher produces and that ``derive_agent_capacity`` cannot
consume.

Nullable, no default, no backfill
=================================

``NULL`` is the correct value for every existing row and means "no publisher has
asserted a CI reservation for this device" — which is exactly true until the coord
writer ships, and stays true for any publisher that OMITS the field (an unbounded
slice, no cgroup v2, an older runner). A default of ``0`` would be actively wrong: ``0``
is a real published value meaning "this host has no CI slice", and it must remain
distinguishable from "unknown". Readers must treat ``NULL`` as UNKNOWN, never as zero.

Deploy ordering
===============

This revision lands FIRST and on its own; no coord build names the column when it
applies. The reverse order — a coord build that names the column deploying before this
applies — is the coord PR's responsibility (``schema_read_contract`` CI gate plus a
``MIGRATOR_DIGEST`` bump, and a readiness-selected statement for the write), exactly as
``cisplit_01_devices_max_concurrent_ci_jobs`` documents for its column.

No table rewrite, no index
==========================

Adding a nullable column with no default is a catalogue-only ``ALTER`` in PostgreSQL.
The column is only ever read per device alongside the rest of its budget row, on a
small table, so an index would be dead weight.

Not mirrored on ``app.models.device.Device``: the web backend neither reads nor writes
this column (coord is its only writer and reader), matching the precedent of
``max_concurrent_ci_jobs`` and ``reaped_at``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cireserve_01_devices_ci_reserved_gib"
down_revision: str | Sequence[str] | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable published-CI-reservation column."""
    # `IF NOT EXISTS` matches on NAME only; acceptable because no revision in this
    # chain spells `ci_reserved_gib` (it was never a column before this one).
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS ci_reserved_gib INTEGER
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.devices.ci_reserved_gib IS
            'GiB of host memory this device''s CI slices may take, as last '
            'published by qontinui-runner on the fleet budget publish '
            '(sum of ci.slice/*.slice memory.high, else memory.max, rounded '
            'up; 0 = the host has no CI slice). Written and read only by '
            'coord: it is the CI term of the worktree/agent cap formula, '
            'persisted so a worktree_slot refusal can name which term bound. '
            'NULL = no publisher has asserted it (unbounded slice, no cgroup '
            'v2, older runner) and reads as UNKNOWN, never as 0.'
        """
    )


def downgrade() -> None:
    """Exact inverse — drop the column (its comment goes with it)."""
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS ci_reserved_gib")
