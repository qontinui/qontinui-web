"""coord.devices.max_concurrent_ci_jobs — split the overloaded capacity column

Revision ID: cisplit_01_devices_max_concurrent_ci_jobs
Revises: devreap_01_devices_reaped_at
Create Date: 2026-08-14

Phase 1 of plan
``D:/qontinui-root/plans/2026-08-14-coord-devices-models-a-machine-but-publishers-are-processes.md``.

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so the
one column its CI dispatcher is moving onto lands here, and this revision must be
applied **before** coord reads the column.

The defect this splits
======================

``coord.devices.max_concurrent_builds`` is read by **two** consumers that mean two
different things by it, and written by **two** publishers that are each correct about
their own consumer:

* ``build_dispatcher`` reads it as **build-pool slots**: it filters
  ``AND d.max_concurrent_builds > 0`` and ranks on it — as the sole sort key in the
  headroom-free selector, and behind ``h.pressure ASC NULLS LAST`` in the
  headroom-ranked one. Its publisher is ``qontinui-supervisor``, which derives
  ``min(memory_gb / 4, cpu_cores / 4)``. Note the selection is keyed on
  ``d.role = 'build'``, not on a capability — an asymmetry with the CI lane that is
  Phase 2's subject, not this revision's.
* ``ci_dispatch`` reads it as **CI job slots** —
  ``GREATEST(COALESCE(d.max_concurrent_builds, 0), 1) > COALESCE(a.active, 0)`` — for
  devices matching ``d.capabilities @> '["ci_node"]'::jsonb``. Its publisher is
  ``qontinui-runner``, which advertises its ``ci_node.max_concurrent_builds`` setting
  (default 1).

One row, one column, two owners, so they alternate. A live ``GET /coord/fleet`` at
2026-08-14T08:51Z read the machine ``spaceship`` at ``max_concurrent_builds = 1`` with
``cpu_cores = 32`` and ``memory_gb = 125`` — i.e. the runner's CI slot count sitting in
the column the build dispatcher ranks on, where the supervisor's derivation would put
``min(31, 8) = 8``. Neither publisher is wrong; the column is.

After this revision the two capacities are disjoint: ``max_concurrent_builds`` keeps its
build-pool meaning and its single supervisor owner, and CI job slots move here.

Nullable, no default, no backfill — and that is load-bearing
============================================================

``NULL`` is the correct value for **every existing row** at the moment this applies, and
it stays correct until the runner ships the matching publisher change. It means "no
publisher has asserted a CI slot count for this device", which is exactly true.

A default of ``0`` would be actively harmful rather than merely redundant. coord's
``ci_dispatch`` floors its capacity read at 1 —
``GREATEST(COALESCE(d.max_concurrent_ci_jobs, 0), 1)`` — because the ``ci_node``
capability is re-asserted by a 30-second heartbeat while the capacity column is written
by a 600-second republisher, so ANDing a live signal with a stale one lets one bad write
un-elect a healthy node. That is not hypothetical: on 2026-07-28 a ``test-*`` runner
sharing ``~/.qontinui/machine.json`` with the primary published
``max_concurrent_builds = 0`` over the primary's row and coord's shadow lane elected
nobody for six days. The floor is that incident's mitigation — coord#1325, and in the
code the section headed *"Capacity is floored at 1, deliberately"* in
``qontinui-coord`` ``src/ci_dispatch.rs``, which tells the story in full. It moves onto
this column with the semantic it guards, and it lives at **five** sites, not one: two
selection statements, two rejection-summary statements, and a Rust-side ``mcb.max(1)``
in the diagnostic. A floor that survives the rename but stays pointed at
``max_concurrent_builds`` is the precise regression, and the coord PR asserts against
it by exact expression rather than by a loose "contains GREATEST".

So ``NULL`` here reads as 1 through the floor, which is precisely the desired
deploy-window behaviour: a ``ci_node``-advertising box stays electable at one concurrent
job — the same number the node's own admission control
(``ci_node/admission.rs``: ``running_count >= settings.max_concurrent_builds.max(1)``)
would admit anyway. Nothing goes dark while the runner change is in flight, and nothing
is over-offered.

Deploy ordering is safe in both directions
==========================================

This revision lands FIRST and on its own, so at the moment it applies no coord build
reads the column. The safety of the reverse order — a coord build deploying before this
applies — is a **requirement on the coord PR** (Phase 1 step 2 of the plan), not
something this file can assert as already true. Stated as the contract that PR must
meet:

Every coord statement naming ``max_concurrent_ci_jobs`` — both dispatcher selectors,
both rejection-summary variants, and the budget ``UPDATE`` — is selected by a
``schema_readiness`` probe of this column. ``Present`` selects the statement naming it;
``Missing`` **and** ``Unknown`` both select one that does not mention it anywhere.

The ``Unknown`` arm is the one worth naming explicitly, because coord's own
``ColumnState`` documents ``Unknown`` as fail-**open** for the 503 route guards — the
opposite default. Here it must join ``Missing``: "coord has not POSITIVELY observed the
column" is the only condition under which naming it is safe to avoid, and a read that
merely *names* a missing column does not degrade, it errors (the 2026-06-08
``default_source`` incident shape). For the same reason the guard is two COMPLETE
statements rather than one with an interpolated column name — a ``COALESCE`` or ``CASE``
over the column would still reference it.

With that contract met, either side can deploy first, and coord picks the column up
within one readiness refresh interval with no restart.

No table rewrite
================

Adding a nullable column with no default is a catalogue-only ``ALTER`` in PostgreSQL
(and has been for a non-volatile default since 11 regardless), so this takes a brief
``ACCESS EXCLUSIVE`` on ``coord.devices`` and no row-level work. ``coord.devices`` held
26 rows at authoring time; there is nothing here to do concurrently.

No index. Unlike ``devreap_01``'s ``reaped_at``, this column is never a filter that
selects a small subset of a large table — it appears only inside a ``GREATEST(...)``
comparison against a per-device dispatch count, on a table small enough that the planner
sequential-scans it regardless. An index would be dead weight the write path still has
to maintain.

Verified against a throwaway PostgreSQL: upgrade applies both statements, is idempotent
on re-run, and downgrade removes the column (taking the comment with it — there is no
separate teardown).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cisplit_01_devices_max_concurrent_ci_jobs"
down_revision: str | Sequence[str] | None = "devreap_01_devices_reaped_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable CI-slot capacity column."""
    # `IF NOT EXISTS` is type-blind — it matches on NAME only, so it would
    # silently keep a pre-existing `max_concurrent_ci_jobs` of the wrong type.
    # That is acceptable here precisely because no such column exists anywhere
    # in this chain: `coord.devices` is created by `ud01_unify_devices_registry`
    # and widened by seven later revisions, none of which spells
    # `max_concurrent_ci_jobs`.
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS max_concurrent_ci_jobs INTEGER
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.devices.max_concurrent_ci_jobs IS
            'How many CI jobs this device will run concurrently, as advertised '
            'by qontinui-runner. Read ONLY by coord ci_dispatch, for devices '
            'matching capabilities @> ''["ci_node"]''. NULL = no publisher has '
            'asserted a CI slot count; coord floors the read at 1 '
            '(GREATEST(COALESCE(...,0),1)) so a NULL or a stale 0 still admits '
            'one job — the capability is a 30s heartbeat signal while this '
            'column is written by a 600s republisher, and ANDing the two is '
            'what silenced the shadow lane for six days on 2026-07-28. Do NOT '
            'confuse with max_concurrent_builds, which is build-POOL slots, is '
            'owned by qontinui-supervisor, and is read only by '
            'build_dispatcher: one column meaning both is the defect this '
            'split exists to end.'
        """
    )


def downgrade() -> None:
    """Exact inverse — drop the column."""
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS max_concurrent_ci_jobs")
