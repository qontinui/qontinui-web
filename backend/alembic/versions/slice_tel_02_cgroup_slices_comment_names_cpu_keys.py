"""coord.device_resource_samples.cgroup_slices — COMMENT names the CPU keys

Revision ID: slice_tel_02
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-12

Follow-up to ``slice_tel_01`` (plan
``2026-10-19-ci-nodes-run-the-tauri-runner-always-on-as-ci-node-role``
Phase 0b), found in the post-merge review of qontinui-web#2224.

COMMENT only: no column, type, data or index changes, so coord's
``schema.manifest`` object lines do not move (coord's fingerprint excludes
comments) and no deploy ordering applies.

``slice_tel_01`` describes ``cgroup_slices`` as "a JSON object keyed by slice
name" whose values hold only the memory keys. The column has held more than
that since the runner's CPU half landed (qontinui-runner
``src-tauri/src/fleet/slice_telemetry/cpu.rs``, "Wire shape", at ``origin/main``
``d9b56e71e``). Coord's sanitizer stores the object verbatim, subject to size,
key-count, depth and NUL caps (qontinui-coord
``crates/coord/src/device_resource_slice_telemetry.rs``
``sanitize_json_object``, at ``origin/main`` ``8da289732``). So a row now holds:

* a ``cpu`` object, ``{usage_delta_usec, interval_usec}``, inside each watched
  slice's entry;
* ``cpu_attribution``, a top-level key that is NOT a slice.

A consumer that takes the old text at its word treats every top-level key as a
slice. Coord's own ``parse_slices`` does exactly that on ``origin/main``: it
decodes ``cpu_attribution`` as a slice with every field empty, which grades
UNKNOWN and so opens nothing, but is a slice that does not exist. Open
qontinui-coord#4090 fixes the reader; qontinui-web#2221 applied the same
``*.slice``-only rule to the fleet strip. This revision corrects the catalog
both readers were written against.
The runner's module doc says "The memory keys mirror the ``slice_tel_01``
migration's column comments" and "The CPU keys extend that contract", so the
catalog is the contract, and it has to say what the extension added.

The new text also names the slice axis. Coord grades the slices on ``s11``
(``Axis::S11``, in ``resource_headroom_slice``), not on ``s10``, which is the
host commit time-to-floor axis.

The NULL list changes too. ``slice_tel_01`` named "a failed read" as a NULL
source, but on a unified-hierarchy host the runner always sends an object
(``collect_from`` returns ``Some(Value::Object(mem))``), leaving out a slice
whose memory files are unreadable. The NULL sources are a non-Linux or
non-unified host (``SliceTelemetry::not_supported``), a non-host lane (the
runner's ``only_the_host_lane_takes_a_slice_reading``), a value coord's
sanitizer rejects ("unacceptable slice-telemetry JSON stored as NULL"), and a
row from a publisher that does not send the field: any publisher but the
runner (qontinui-supervisor publishes ``lane = "host"`` rows whose payload has
no ``cgroup_slices``), or a runner build that predates it.

``psi`` and ``slice_source`` keep ``slice_tel_01``'s text: the runner's ``psi``
shape and the two ``slice_source`` spellings still match it.

Not corrected here: ``slice_tel_01``'s module docstring describes the same
memory-only map. That docstring records what the column was when it was
added, and it changes nothing a database serves; this COMMENT is what
``col_description`` serves, so this is where the correction goes.

``downgrade()`` restores ``slice_tel_01``'s text byte for byte. The companion
test checks it against that revision's source, its one author.

Head choice: ``down_revision`` is the single alembic head on ``origin/main`` at
``cc97af7df`` (``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). If
another alembic PR lands first, re-point ``down_revision``, the ``Revises:``
header and ``_PARENT_REVISION_ID`` in the companion test together. No
``alembic merge``. Hand-authored; ``--autogenerate`` is never run against
``coord.*``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "slice_tel_02"
down_revision: str | Sequence[str] | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.device_resource_samples"

# ``slice_tel_01``'s COMMENT on the one column ``upgrade()`` rewrites, which
# ``downgrade()`` restores. Byte-identical on purpose; the companion test checks
# it against ``slice_tel_01``'s own source, so a drift reds there.
_PRIOR_COMMENTS: dict[str, str] = {
    "cgroup_slices": (
        "Per-slice cgroup v2 memory reading at sample time, a JSON object "
        "keyed by slice name (ci-runners.slice, agent-builds.slice, "
        "qontinui-runner.slice): {memory_current, memory_high, memory_max, "
        'events:{high,max,oom_kill}}. Bytes are numbers; the string "max" '
        "is the cgroup v2 spelling of NO LIMIT and is kept verbatim. "
        "events are monotonic counters since cgroup creation, so rising is "
        "a comparison across samples. A slice absent from the machine is "
        "absent from the map. NULL = NOT MEASURED (non-Linux host, no "
        "unified cgroup hierarchy, a failed read, or a publisher build "
        "that predates the field); see slice_source. NEVER 0 and never an "
        "empty map standing in for unmeasured. Feeds "
        "device_resource_headroom_breach (plan "
        "2026-10-19-ci-nodes-run-the-tauri-runner-always-on-as-ci-node-role "
        "Phase 0b)."
    ),
}


def upgrade() -> None:
    """Rewrite cgroup_slices' COMMENT to name the CPU keys the map now holds."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.cgroup_slices IS
            'Per-slice cgroup v2 reading at sample time, a JSON object. Each '
            'top-level key ending in .slice is a watched slice '
            '(ci-runners.slice, agent-builds.slice, qontinui-runner.slice), '
            'and its value carries {memory_current, memory_high, memory_max, '
            'events:{high,max,oom_kill}, cpu:{usage_delta_usec, '
            'interval_usec}}. Bytes are numbers; the string "max" is the '
            'cgroup v2 spelling of NO LIMIT and is kept verbatim. events are '
            'monotonic counters since cgroup creation, so rising is a '
            'comparison across samples. cpu.usage_delta_usec is the CPU time '
            'the slice used since the previous read, in microseconds summed '
            'over CPUs, over cpu.interval_usec; cpu is absent on the first '
            'read after a publisher start, after a gap the publisher treats '
            'as stale, and when the slice has no delta that read (it '
            'appeared, was recreated or its counter went backwards). A slice '
            'is absent from the map when it does not exist on the machine or '
            'none of its memory files was readable, and a key the publisher '
            'could not measure is absent, never 0. ONE top-level key is NOT a '
            'slice: cpu_attribution, when present the split of the host''s '
            'CPU over the same interval into session work, CI and the rest '
            '(session_usec, ci_usec, unattributed_usec, host_usec, '
            'interval_usec and more; the full key set is in qontinui-runner '
            'src-tauri/src/fleet/slice_telemetry/cpu.rs). A consumer that '
            'enumerates slices takes only the keys ending in .slice. A map '
            'that names no slice (empty, or holding only cpu_attribution) '
            'beside slice_source linux_cgroup_v2 is a MEASUREMENT: the tree '
            'was read and no watched slice yielded a memory reading. NULL = '
            'NOT MEASURED: a non-Linux host or one with no unified cgroup '
            'hierarchy (slice_source not_supported), a non-host lane row, a '
            'value coord rejected (not an object, or over its size, '
            'key-count, depth or NUL caps), or a row from a publisher that '
            'does not send the field (any publisher but the runner, such as '
            'the supervisor, or a runner build that predates it). NEVER 0 and '
            'never an empty map standing in for unmeasured. Feeds the s11 '
            'axis of device_resource_headroom_breach, graded by coord''s '
            'resource_headroom_slice (plan '
            '2026-10-19-ci-nodes-run-the-tauri-runner-always-on-as-ci-node-role'
            ' Phase 0b).'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Restore ``slice_tel_01``'s COMMENT. Exact reverse of upgrade()."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    for column, comment in _PRIOR_COMMENTS.items():
        escaped = comment.replace("'", "''")
        op.execute(f"COMMENT ON COLUMN {_TABLE}.{column} IS '{escaped}'")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
