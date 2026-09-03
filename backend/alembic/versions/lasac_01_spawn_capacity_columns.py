"""coord.device_resource_samples — the spawn-capacity lane (threads + sessions)

Revision ID: lasac_01
Revises: coord_pr_events_hydration_head_idx
Create Date: 2026-08-30

Phase 3a of plan
``2026-08-30-load-aware-spawn-admission-control``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the two
columns the runner's publisher writes and coord's grader reads land here, in
qontinui-web, and this revision must merge **before** the coord PR that reads
them. Hand-authored; ``alembic revision --autogenerate`` was not run and is
never run against ``coord.*``.

Why these columns exist
=======================

On **2026-08-29** the primary runner wedged. The binding resource was not RAM,
not commit, not disk and not the kernel task table — it was **tokio's blocking
thread pool**. That pool has a default ceiling of ``max_blocking_threads = 512``;
the wedged process carried **540 OS threads, 119 of them parked mid-
``CreateProcess``**. Every subsequent ``spawn_blocking`` — which on this runner
is how a terminal session is started — queued behind slots that were never
coming back, so new spawns simply stopped happening while the process stayed
"up" by every gauge the fleet owns.

Nothing in ``coord.device_resource_samples`` could have shown that. The table's
memory columns (``fleet_res_tel_01``) instrument RAM, commit, swap and disk; the
saturation columns (``fleet_res_tel_04``) instrument the *kernel's* thread and
PID ceilings for a **lane** — a host, a WSL VM, a container. None of them is the
thread count of the **publishing process**, and it is the process, not the lane,
that owns a 512-slot blocking pool. A box can sit at 3% of
``/proc/sys/kernel/threads-max`` while the one process that matters is at 105%
of the ceiling that actually gates work.

``thread_count`` is that number, and it is the *direct* proxy for blocking-pool
headroom rather than a correlate of it:

* it is already computed on the runner on every health-check tick
  (``qontinui-runner``'s ``health_monitor::get_thread_count()``, and the module
  already carries a ``THREAD_WARNING_THRESHOLD = 150``), so publishing it on the
  existing 30 s ``fleet::resource_sample`` loop costs nothing new to read;
* it is process-scoped by construction, which is the right granularity here —
  one Windows machine runs one primary runner instance, so "per process" already
  means "per machine" for spawn admission.

``active_terminal_sessions`` is the **explanatory** half, and it is deliberately
not the trip condition. A machine can carry N sessions comfortably, or N
sessions each leaking a stuck ``spawn_blocking`` call; only the thread count
separates those two. But a verdict that prints the thread count alone leaves an
operator — and the next incident's forensics — unable to answer "was this a lot
of work, or a leak?". Storing both is the same discipline
``device_resource_samples.rs``'s ``EffectiveFloor`` / ``SampleVerdict`` already
apply to memory, where the row always carries the threshold **and** the raw
value it was judged against.

Not a new table, and not a new endpoint
=======================================

This is the same argument ``build_slots_busy`` / ``build_queue_depth`` /
``ci_jobs_running`` already won on this table (``fleet_res_tel_01``): they are
not memory or disk figures either, and they ride the per-lane sample row because
they are *capacity* facts about the same machine at the same instant, published
by the same 30 s loop. A second table or a second endpoint for two integers
would fork the sampling clock, the tenant scoping, the retention prune and the
freshness gate for no gain. These two columns join that set.

The lane semantics are inherited unchanged: a row is per
``(device_id, lane, lane_instance)``, and these columns are meaningful on
whichever lane the runner publishes from. They are **never summed across lanes**
— the table comment already says so for every column, and it is not weaker here.

NULL is not zero, and it inverts the reading if you get it wrong
===============================================================

Both columns are nullable with no default, inheriting ``fleet_res_tel_01``'s
rule verbatim: *"A publisher reports what it can probe and omits what it cannot;
a probe that fails must degrade to NULL, never to a fabricated zero."*

That rule bites harder here than on the byte columns, in the same way
``fleet_res_tel_04`` argued for ``threads_used``. A fabricated ``0`` does not
merely under-report — it **inverts** the signal:

* ``thread_count = 0`` is not a low reading, it is an *impossible* one (a live
  process has at least one thread), and it renders as **maximally idle** on the
  one axis built to catch a process at 105% of its blocking-pool ceiling;
* ``active_terminal_sessions = 0`` reads as "this machine is doing nothing",
  which is precisely the state an admission controller rewards with more work.

An admission controller that ranks candidates ``NULLS LAST`` would therefore
promote the blind machine to the front of the spawn queue — the exact failure
the plan exists to prevent, arrived at through the telemetry meant to prevent
it. Every fleet-side consumer must read absence as **UNKNOWN**, and the plan's
§3 states the asymmetry the coord side must implement on top of that: a sample
that has **never arrived** (a device on a runner build that predates the
publisher) is UNKNOWN and fails OPEN, while a sample that **was arriving and has
gone stale** past ~2x the 30 s publish interval is a *hold*, not an unknown —
because a wedging runner is exactly a process that stops publishing.

``INTEGER``, not ``BIGINT`` — and the reason is the coord read, not the range
============================================================================

``fleet_res_tel_04`` chose ``BIGINT`` for its five saturation columns and stated
the constraint precisely: coord reads with ``row.get(...)`` into a concrete Rust
integer type, and tokio-postgres treats a width mismatch as a **runtime type
error**, not a widening. That constraint is what decides this revision too — it
just decides it the other way, because the peers these columns sit beside are
read as ``Option<i32>``:

    device_resource_samples.rs:1074  pub build_slots_busy: Option<i32>,
    device_resource_samples.rs:1078  pub ci_jobs_running:  Option<i32>,

and their storage is ``INTEGER`` (``fleet_res_tel_01``:292-295). ``thread_count``
and ``active_terminal_sessions`` are members of that same counter group on the
same wire shape, so they are ``INTEGER`` and the coord side **must** read them as
``Option<i32>``. This is an interface, not a preference: an ``Option<i64>``
``row.get`` against an ``INTEGER`` column panics rather than returning a
degradable SQLSTATE, and so does the reverse.

The value range does not argue against ``INTEGER`` either, and it is worth
saying why the ``fleet_res_tel_04`` sizing argument does not carry over. That
argument was about a **kernel ceiling that scales with machine RAM** (192,146 on
the Docker VM, and an order of magnitude more on a bigger box). These are a
**process's** thread count and a **process's** live session count, bounded in
practice by the very pool that wedged: 540 threads at the incident, against a
512-slot blocking pool plus the runtime's own workers. A process that reached
2^31 threads would have died long before this column overflowed.

No CHECK on either column
=========================

Same reasoning ``fleet_res_tel_04`` gave for declining a CHECK on
``saturation_source``, and the same one ``fleet_res_tel_01`` gave for allowing
``swap_total_bytes = 0``: ingest is best-effort by contract (persist failures log
WARN and the handler still returns 200), and a CHECK violation fails the **whole
INSERT** — so a nonsensical thread count would discard the memory, disk and
build-slot metrics sharing that row. Rejecting a sample because one counter read
oddly is exactly backwards during an incident, which is the only time these rows
matter. Sanity is enforced app-side at the door, the same split this table
already draws between its CHECKed ``lane`` and its free-text ``source``.

Note that this leaves ``thread_count = 0`` **storable** even though it is
physically impossible. That is deliberate and it is why the column comment says
so: the defence against a fabricated zero is the publisher contract and the
consumer's reading of it, not a constraint that would trade a whole row for it.

Degrade obligation on the coord side
====================================

Unchanged from ``fleet_res_tel_01`` / ``fleet_res_tel_04``, and it runs the other
way: the coord PR that reads these columns must degrade on a missing column
(``pg_error::is_missing_schema_object``, SQLSTATE 42703) so a coord deploy that
lands ahead of this migration fails open rather than erroring. Because that
helper swallows 42703, a **typo'd column name idles forever with no error** — so
the two names below are an interface and the coord side must match them exactly
rather than relying on a failure to notice.

No new index
============

Deliberately, for the same reason ``fleet_res_tel_04`` added none. These columns
are read on rows the anchor index
(``idx_device_resource_samples_anchor_sampled``) already selects — the
dispatcher's ``LEFT JOIN LATERAL`` and the strip's one-row-per-anchor both fetch
the heap tuple anyway. Nothing filters or orders *by* them: a spawn-admission
pre-filter grades the newest row it already selected per device, and any
ordering is over a computed verdict rather than over a stored column. An extra
index on an append-only table written every 30 s would cost maintenance on every
insert to serve no query.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. Both columns are nullable with no default, so
each ADD is a catalogue update with no table rewrite; the brief
``ACCESS EXCLUSIVE`` lock is immeasurable on this table.

``IF NOT EXISTS`` is **type-blind** — it matches on name alone, so a column of
the right name and wrong type makes the ADD a silent no-op and leaves the wrong
type in place, where ``row.get`` will **panic** rather than return a degradable
SQLSTATE. Re-running ``upgrade()`` is not a repair for that; fix it with an
explicit ``ALTER COLUMN … TYPE`` in a new revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "lasac_01"
down_revision: str | Sequence[str] | None = "coord_pr_events_hydration_head_idx"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the LOCAL CHAIN HEAD at authoring time, not a member of the
# `fleet_res_tel_*` family whose table this extends. `fleet_res_tel_04` has not
# been the head since 2026-08-27 and pointing at it would fork the graph —
# which `alembic-graph-pr.yml`'s `alembic-heads-pr` job (a required check on
# `web-protect-main`) fails the PR for. The same convention `fleet_res_tel_04`
# recorded, and for the same reason: the family *name* carries the lineage
# here, not the edge.
#
# That head can MOVE between authoring and the first CI run on a busy repo —
# `fleet_res_tel_04` was rebased once for exactly that. If `alembic-heads-pr`
# reports `HEAD_COUNT=2`, re-point this at the new head; that is the gate
# working as designed, not a defect in this revision.

_TABLE = "coord.device_resource_samples"

# The one column list, spelled once. The upgrade's ADDs and the downgrade's
# DROPs are generated from it so they cannot drift into different sets — the
# same construction `fleet_res_tel_03` and `fleet_res_tel_04` use.
#
# INTEGER, not BIGINT: these join the `build_slots_busy` / `ci_jobs_running`
# counter group, which coord reads as `Option<i32>`. See the module docstring —
# the width is an interface with the coord read, not a range judgement.
_SPAWN_CAPACITY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("thread_count", "INTEGER"),
    ("active_terminal_sessions", "INTEGER"),
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so the table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _SPAWN_CAPACITY_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list."""
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _SPAWN_CAPACITY_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the two spawn-capacity columns to coord.device_resource_samples."""
    op.execute(_add_columns(_TABLE))

    # Column comments carry what a name cannot: which SCOPE each number has
    # (process, not lane), that NULL is never zero here, and that the second
    # column explains the first rather than gating anything. A reader who gets
    # any of these wrong builds a confidently-wrong admission gate, which is
    # the defect this revision exists to close.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.thread_count IS
            'OS thread count of the PUBLISHING PROCESS (the runner) at sample '
            'time — process-scoped, NOT the lane-wide kernel figure that '
            'threads_used carries. This is the direct proxy for tokio '
            'blocking-pool headroom (default max_blocking_threads = 512): on '
            '2026-08-29 the primary runner wedged carrying 540 threads, 119 '
            'parked mid-CreateProcess, while every memory, commit, disk and '
            'kernel-saturation gauge on this row read healthy and accurate. '
            'Published from the runner''s existing health_monitor '
            'get_thread_count() on the 30s resource-sample loop. NULL = not '
            'probed. NEVER 0, which is not merely low but IMPOSSIBLE for a '
            'live process and renders as maximally idle on the one axis built '
            'to catch a saturated one — a NULLS LAST ranking would then hand '
            'the blind machine the next spawn. Storable anyway: no CHECK, '
            'because a CHECK violation would fail the whole best-effort INSERT '
            'and discard the memory and disk metrics on the same row. INTEGER '
            'because coord reads this counter group as Option<i32>, alongside '
            'build_slots_busy and ci_jobs_running.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.active_terminal_sessions IS
            'Live terminal sessions on this device at sample time. The '
            'EXPLANATORY signal carried alongside thread_count, deliberately '
            'NOT the trip condition: a machine can carry N sessions '
            'comfortably or N sessions each leaking a stuck spawn_blocking '
            'call, and only the thread count separates those. It is here so an '
            'operator (and the next incident''s forensics) can read both "how '
            'many sessions are live" and "how many threads that cost" — the '
            'same discipline EffectiveFloor/SampleVerdict already apply by '
            'always carrying the threshold AND the raw value. NULL = not '
            'probed, never 0: a fabricated 0 reads as "this machine is doing '
            'nothing", which is exactly the state an admission controller '
            'rewards with more work. Read together with thread_count; neither '
            'is interpretable alone.'
        """
    )


def downgrade() -> None:
    """Drop the two spawn-capacity columns. Exact reverse of upgrade().

    The COMMENTs go with the columns — a column comment has no independent
    existence to drop.
    """
    op.execute(_drop_columns(_TABLE))
