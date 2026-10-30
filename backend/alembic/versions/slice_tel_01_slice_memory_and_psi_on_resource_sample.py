"""coord.device_resource_samples — per-slice cgroup memory and PSI telemetry

Revision ID: slice_tel_01
Revises: journey_04_explorations_stop_detail_any_stop
Create Date: 2026-10-30

Phase 0b of plan
``2026-10-19-ci-nodes-run-the-tauri-runner-always-on-as-ci-node-role``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the three
columns the runner's 30 s resource-sample publisher writes and coord's
``device_resource_headroom_breach`` sweep reads land here first, hand-authored
(``alembic revision --autogenerate`` was not run and is never run against
``coord.*``). This revision must merge **before** the runner and coord PRs.

Why: the msi incident was a *slice* starving (``ci-runners.slice`` at its
``memory.high`` while the host gauges read healthy). No existing column shows
that: the sample carries host load/CPU/memory/swap/commit/disk and only the
pids cgroup controller. Phase 0b rides the resource sample rather than the
computer report (``POST /coord/computers/report`` is not on main), so the
existing alert needs no cross-model join.

The three columns
=================

``cgroup_slices JSONB``
    A map keyed by slice name (``ci-runners.slice``, ``agent-builds.slice``,
    ``qontinui-runner.slice``). Each value is an object with the cgroup v2
    memory controller reading::

        {"memory_current": <bytes>, "memory_high": <bytes>|"max",
         "memory_max": <bytes>|"max",
         "events": {"high": <n>, "max": <n>, "oom_kill": <n>}}

    ``"max"`` is cgroup v2's own spelling of *no limit* and is preserved
    verbatim: it is a legitimate reading, and neither ``0`` nor ``NULL``. A
    slice that does not exist on the machine is simply ABSENT from the map.
    The ``events`` counters are monotonic since the cgroup was created, so
    "rising" is a comparison across consecutive samples, never a level.

``psi JSONB``
    Pressure-stall information from ``/proc/pressure/{memory,cpu,io}`` and each
    watched slice's own ``memory.pressure``/``cpu.pressure``/``io.pressure``::

        {"system": {"memory": {"some": {"avg10": f, "avg60": f},
                               "full": {"avg10": f, "avg60": f}},
                    "cpu": {"some": {...}}, "io": {"some": {...}, "full": {...}}},
         "slices": {"ci-runners.slice": {"memory": {...}, "cpu": {...},
                                         "io": {...}}}}

    ``full`` for ``cpu`` is not defined at system scope on every kernel, so an
    absent key means *not defined / not readable*, never zero. Values are
    percentages in ``[0, 100]``.

``slice_source TEXT``
    ``linux_cgroup_v2`` when the publisher read the cgroup tree, or
    ``not_supported`` when it cannot (Windows, macOS, a host without the unified
    cgroup hierarchy). The latter is the explicit form of *unmeasured*
    (``machine-resources.md`` section 7): off Linux the other two columns are
    NULL and this column says why, so a consumer cannot mistake a Windows host
    for a Linux host with idle slices. NULL means a publisher build that
    predates the field.

NULL is not zero
================

Every column is nullable with no default, inheriting ``fleet_res_tel_01``'s
rule: a probe that fails degrades to NULL, never to a fabricated zero. A
``DEFAULT`` would write a reading into every row a pre-Phase-0b runner sends.

Retention and size
==================

The columns live on ``coord.device_resource_samples``, so they age out with the
row under ``prune_samples`` and ``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``
— no new retention path. Each JSONB is a few hundred bytes per 30 s sample.

No new index: nothing filters or orders by these columns; the sweep reads rows
the anchor index (``idx_device_resource_samples_anchor_sampled``) already
selects.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS``. ``IF NOT
EXISTS`` is type-blind — a column of the right name and wrong type makes the ADD
a silent no-op — so the names and types here are an interface that the
migration test pins. Coord must degrade on a missing column
(``is_missing_schema_object``) so a coord deploy that lands first fails open.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "slice_tel_01"
down_revision: str | Sequence[str] | None = (
    "journey_04_explorations_stop_detail_any_stop"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.device_resource_samples"

# The columns, as data; the migration test pins names and DDL types against
# this tuple. The SQL below spells the same columns as STATIC literals because
# coord's migration classifier can only inspect static op.execute literals.
_SLICE_TELEMETRY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("cgroup_slices", "JSONB"),
    ("psi", "JSONB"),
    ("slice_source", "TEXT"),
)


def upgrade() -> None:
    """Add the three nullable slice/PSI columns to coord.device_resource_samples."""
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS cgroup_slices JSONB,
            ADD COLUMN IF NOT EXISTS psi JSONB,
            ADD COLUMN IF NOT EXISTS slice_source TEXT
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.cgroup_slices IS
            'Per-slice cgroup v2 memory reading at sample time, a JSON object '
            'keyed by slice name (ci-runners.slice, agent-builds.slice, '
            'qontinui-runner.slice): {memory_current, memory_high, memory_max, '
            'events:{high,max,oom_kill}}. Bytes are numbers; the string "max" '
            'is the cgroup v2 spelling of NO LIMIT and is kept verbatim. '
            'events are monotonic counters since cgroup creation, so rising is '
            'a comparison across samples. A slice absent from the machine is '
            'absent from the map. NULL = NOT MEASURED (non-Linux host, no '
            'unified cgroup hierarchy, a failed read, or a publisher build '
            'that predates the field); see slice_source. NEVER 0 and never an '
            'empty map standing in for unmeasured. Feeds '
            'device_resource_headroom_breach (plan '
            '2026-10-19-ci-nodes-run-the-tauri-runner-always-on-as-ci-node-role '
            'Phase 0b).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.psi IS
            'Pressure-stall information at sample time: {system:{memory,cpu,io}, '
            'slices:{slice:{memory,cpu,io}}}, each resource {some:{avg10,avg60}, '
            'full:{avg10,avg60}} in percent. system comes from /proc/pressure/*, '
            'slices from each slice own *.pressure file. A missing key means '
            'NOT DEFINED or NOT READABLE on this kernel (cpu has no system-scope '
            'full line), never zero. NULL = NOT MEASURED (non-Linux host, PSI '
            'disabled, a failed read, or an older publisher build); never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.slice_source IS
            'Which instrument produced cgroup_slices and psi: linux_cgroup_v2, or '
            'not_supported when the publisher cannot read them (Windows, macOS, '
            'no unified cgroup hierarchy). not_supported is the explicit form of '
            'unmeasured and must render as unknown, not as idle slices. NULL = a '
            'publisher build that predates the field.'
        """
    )


def downgrade() -> None:
    """Drop the three columns only. Exact reverse of upgrade().

    The COMMENTs go with the columns. The DROP is a static literal inside this
    function body, out of the upgrade-path drop scan.
    """
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS cgroup_slices,
            DROP COLUMN IF EXISTS psi,
            DROP COLUMN IF EXISTS slice_source
        """
    )
