"""coord.device_resource_samples process census + per-type handle counts

Revision ID: kernel_census_01
Revises: overview_07_schedule_last_known
Create Date: 2026-11-26

Phase 1 of plan
``2026-11-26-devops-windows-process-object-leak-has-no-holder-attribution``
(design decisions D2-D5 and D7, and re-plan items R1-R4).

coord authors **zero** DDL (``[policy: production-and-cost
alembic-sole-authorship]``), and the R16 cut-over that moves coord's schema
into the coord repo has not landed, so the columns coord will ingest and store
land here, in qontinui-web. Hand-authored; ``alembic revision --autogenerate``
was not run and is never run against ``coord.*``.

Nothing in the runner or coord writes or reads these columns yet. Every
behaviour described below and in the column comments is the PLAN's, as it
stood at authoring (runner Phase 4, coord Phase 3), and is attributed to the
plan rather than stated as runner or coord fact -- the rule
``kernel_gauges_01`` set for itself.

Why these columns exist
=======================

Plan ``2026-10-19-fleet-is-blind-to-kernel-object-leaks-and-os-process-creation-latency``
(revision ``kernel_gauges_01``) made the fleet see WHICH kernel object type
leaks. It cannot say WHICH PROCESS, or which kind of reference, holds the
leaked objects, so every recurrence still needs a human on the box.

The motivating measurement (coord finding
``da391a7e-4a35-4a6d-a1e5-b9ee6263d744``): on **2026-11-26T20:20Z** device
``spaceship`` read ``kernel_process_objects`` **482,303**, ``os_process_count``
**667** and ``kernel_handle_count`` **241,089**. So 481,636 process objects
were dead (exited but still referenced). Even if every handle on the box, of
every type, pointed at a different one of them, **at least 240,547 dead
process objects had no Process or other handle that could account for them**,
assuming one handle pins at most one process. A handle-holder ranking alone
cannot name that holder, which falsified the plan's first premise and
re-shaped this revision:

* ``kernel_process_handles`` (handles to Process objects, live and dead) and
  ``kernel_thread_handles`` (handles to Thread objects) are what coord will
  need (plan R2) for a TIGHTER lower bound,
  ``dead - kernel_process_handles - kernel_thread_handles``, on the dead
  process objects no handle accounts for, on every 30 s sample. Both terms
  are needed: a thread object references its owning process (plan R2; Phase 0
  probe (d) is to measure it), so an open Thread handle (the ``hThread`` half
  of a ``CreateProcess`` pair) can keep a dead process alive with no Process
  handle open. The bound subtracts the two handle types known to pin a process rather
  than every handle of every type, which is what makes it tighter than the
  loose ``dead - kernel_handle_count`` above. It is still evidence, not proof
  (plan R1/R2): a debug object or an ALPC port could also pin a process, and
  the subtraction assumes one handle pins at most one dead process.
* ``kernel_thread_objects`` / ``os_thread_count`` give the same dead-versus-live
  split for Thread objects.
* ``kernel_process_census`` is to name holders (plan R4) for the two classes a
  census CAN attribute: the handle-pinned class (``top_by_handles``) and the
  live-process class (``top_images``), plus (plan R3, if Phase 0 proves it
  unelevated) the images of a sample of the dead-but-referenced pids
  (``dead_images``).

Per plan D2 the four scalars come free: the ``ObjectTypesInformation`` buffer
the runner's ``os-health`` collector reads every 30 s carries the Process
handle count and the Thread entry, and ``PERFORMANCE_INFORMATION`` carries
``ThreadCount``; at the plan's read sha the collector discards all of them.

What this adds, and to what
===========================

Six nullable columns on ``coord.device_resource_samples``, and nothing else
(no policy-table column: per plan D7 the image-name off-switch rides the
existing egress flow family as ``egress_process_names``, and a new egress
domain needs no DDL):

```text
kernel_process_census     JSONB        the runner's per-process census
kernel_process_census_at  TIMESTAMPTZ  when the census was read
kernel_process_handles    BIGINT       ObjectTypes Process TotalNumberOfHandles
kernel_thread_objects     BIGINT       ObjectTypes Thread TotalNumberOfObjects
kernel_thread_handles     BIGINT       ObjectTypes Thread TotalNumberOfHandles
os_thread_count           BIGINT       PERFORMANCE_INFORMATION.ThreadCount
```

Per plan D2/R3 the census is ``{status: "measured" | "unmeasured", ...}``,
read from two instruments. From
``NtQuerySystemInformation(SystemProcessInformation)``, a measured reading
carries ``top_by_handles`` (the top 8 processes by handle count, each
``{image, pid, parent_pid, handle_count, thread_count, started_at}``),
``top_images`` (the top 8 images by live process count, each
``{image, processes, handle_count, thread_count}``), ``totals``
(``{processes, handle_count, thread_count}``) and ``top_by_handles_share``.
From ``SystemProcessIdInformation`` (class 88), and only if Phase 0 keeps
plan R3 (the key is absent if Phase 0 drops R3), it carries ``dead_images``:
``{status, reason, sampled, hits, range_max, top: [{image, image_withheld?,
hits}]}``, the images of SAMPLED dead-but-referenced pids, with ``top`` at
most 8 entries of RAW hits, never extrapolated to the population. Per plan D3
an applicable read that failed is ``{status: "unmeasured", reason,
required_bytes}``. Image BASE NAMES only: never a path, command line, user or
SID. Per plan D7, under the ``egress_process_names`` flow an entry may carry
``image: null`` with ``image_withheld`` set to the runner's egress verdict
source verbatim (``LevelSource::as_str``: ``coord``, ``persisted``,
``profile``, ``product_default`` or ``unknown``) -- a stated withholding,
never an empty string. Every ranked list is capped at 8, which bounds the row.

NULL semantics -- never zero, never ``[]``
==========================================

A column is NULL when its reading was never taken (a runner build predating
it, or before the collector's first census read) or when the instrument does
not apply on that OS (all six are Windows readings in v1, so Linux rows carry
NULL); a scalar is also NULL when an applicable read failed.
``kernel_source`` names the instruments that answered, which is how a reader
tells "does not apply" from "failed". A NULL must never be read, graded or
rendered as 0 or as an empty census: a 0 Process or Thread handle count
would widen the bound to every dead process, and ``[]`` would read as "no
holder". Per plan D3 a FAILED census read is not NULL either: the runner will
publish the typed ``unmeasured`` object, so its reason reaches coord.

Types are an interface
======================

coord will read these ``BIGINT`` columns as ``Option<i64>`` (plan Phase 3);
reading an ``i64`` off an ``INTEGER`` column (or an ``i32`` off a ``BIGINT``)
is a tokio-postgres runtime type error, not a widening. Note
``os_thread_count`` is ``BIGINT`` while the older ``os_process_count`` is
``INTEGER``: the two need different Rust types. ``ADD COLUMN IF NOT EXISTS``
matches on name alone, so re-running ``upgrade()`` cannot repair a column of
the wrong type; fix one with an explicit ``ALTER COLUMN ... TYPE`` in a new
revision. The migration test pins every name and type against
``_CENSUS_COLUMNS`` below.

No CHECK constraints, and no backfill
=====================================

The census shape is to be validated where the runner produces it and where
coord's wire sanitizer consumes it (plan Phase 3); a CHECK on a jsonb shape
would be a second door on the same input and would make every shape change a
migration. Samples written before this revision keep NULL, which is the
honest record that no reading existed. Every column is nullable with no
default, so each ADD is a catalogue update with no table rewrite. Retention
is unchanged: the columns ride ``prune_samples``' rolling window on
``sampled_at`` (``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``).

Deploy ordering
===============

**coord may deploy on either side of this revision.** coord drops unknown
sample keys with a warning, but an INSERT naming a column the database lacks
fails 42703 and drops the WHOLE push. So per plan D5 and Phase 3 coord will
name these columns only behind schema-readiness groups -- a ``census`` group
for the jsonb pair (``kernel_process_census``, ``kernel_process_census_at``)
and a NEW kernel-style readiness group for the four scalars, not the existing
``kernel`` group -- naming them in its INSERT, and projecting them in its
reads, only once its schema-readiness probe observes the group ``Present``,
and projecting typed NULLs until then. The scalars must not join the existing
group: coord's shipped ``kernel`` group (``device_resource_sample_cols.rs``
``KERNEL_INSERT_COLS``) names the 16 ``kernel_gauges_01`` gauges only when
all of them read ``Present``, so one more column in it would hold all 16 dark
wherever this revision had not yet deployed. A coord build predating Phase 3
names none of them. That gate is what makes either deploy order safe, and
nothing else does.

This revision arms nothing: no code writes or reads these columns yet.

Every ``op.execute`` below takes ONE static string literal, because coord's
migration classifier (``pr_merge/migration_classifier.rs``) reads only static
literals and holds a revision whose SQL it cannot see. Both ``upgrade()`` and
``downgrade()`` open with ``SET LOCAL lock_timeout = '3s'``, the house lock
bound and a SET form that classifier admits. No file of this change is named
after a security-surface glob (``**/jwt*``, ``**/auth*``, ``**/*token*``,
``**/credential*``).

The down_revision below is the single alembic head of ``origin/main`` at
authoring time (0fd406568). If ``alembic-heads-pr`` reports ``HEAD_COUNT=2``
after this lands, re-point this line and ``_PARENT_REVISION_ID`` in
``tests/test_kernel_census_01_process_census_on_resource_sample_migration.py``
together.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "kernel_census_01"
down_revision: str | Sequence[str] | None = "overview_07_schedule_last_known"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SAMPLE_TABLE = "coord.device_resource_samples"

# The columns, as data; the migration test pins names and DDL types against
# this tuple, and checks that the static SQL below adds, comments and drops
# exactly these. The SQL spells the same columns as STATIC literals because
# coord's migration classifier can only inspect static op.execute literals.
_CENSUS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("kernel_process_census", "JSONB"),
    ("kernel_process_census_at", "TIMESTAMPTZ"),
    ("kernel_process_handles", "BIGINT"),
    ("kernel_thread_objects", "BIGINT"),
    ("kernel_thread_handles", "BIGINT"),
    ("os_thread_count", "BIGINT"),
)


def upgrade() -> None:
    """Add the process-census pair and the four per-type count columns.

    `alembic/env.py` runs this inside `context.begin_transaction()` and
    PostgreSQL DDL is transactional, so the ALTER and every COMMENT commit or
    none does.
    """
    # Bound the ACCESS EXCLUSIVE lock wait first (house style): a QUEUED lock
    # request blocks every reader of the table behind it. `alembic/env.py`
    # restores lock_timeout after each revision, so no restore is needed here.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS kernel_process_census JSONB,
            ADD COLUMN IF NOT EXISTS kernel_process_census_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS kernel_process_handles BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_thread_objects BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_thread_handles BIGINT,
            ADD COLUMN IF NOT EXISTS os_thread_count BIGINT
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_process_census IS
            'Per-process census of the process table (plan '
            '2026-11-26-devops-windows-process-object-leak-has-no-holder-attribution, '
            'D2/R3). Windows only. Per plan D4 the runner will re-read it on '
            'the pool-tag cadence (about 2.5 min) and republish it with '
            'kernel_process_census_at on every 30 s sample. A measured reading '
            'is {status: measured, top_by_handles, top_images, dead_images, '
            'totals, top_by_handles_share}, dead_images being conditional '
            '(plan R3; absent if Phase 0 drops R3). From '
            'NtQuerySystemInformation(SystemProcessInformation): '
            'top_by_handles is the top 8 processes by handle count, each '
            '{image, pid, parent_pid, handle_count, thread_count, '
            'started_at}; top_images is the top 8 images by live process '
            'count, each {image, processes, handle_count, thread_count}; '
            'totals is {processes, handle_count, thread_count}; '
            'top_by_handles_share is the share of totals.handle_count the top '
            '8 hold. From SystemProcessIdInformation (class 88), only if '
            'Phase 0 keeps plan R3: dead_images (plan R3; absent if Phase 0 '
            'drops R3) is {status, reason, sampled, hits, range_max, top: [{image, '
            'image_withheld?, hits}]}, the images of SAMPLED '
            'dead-but-referenced pids, top at most 8 entries of raw hits only, '
            'never extrapolated. Per plan D3 an applicable read that failed '
            'is {status: unmeasured, reason, required_bytes}, not NULL. Image '
            'base names only, never a path, command line, user or SID; per '
            'plan D7, under the egress_process_names flow an entry may carry '
            'image: null with image_withheld = the runner egress verdict '
            'source verbatim (coord, persisted, profile, product_default or '
            'unknown). NULL = never read, or not applicable per kernel_source '
            '(Linux); never an empty array or 0 standing in for unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_process_census_at IS
            'When kernel_process_census was read. Per plan D4 the runner will '
            're-read the census on the pool-tag cadence (every 5th collector '
            'tick, about 2.5 min) and republish the cached value on every 30 s '
            'sample, so it may predate sampled_at by a few minutes. The '
            'publisher is to send both or neither; nothing enforces it. NULL = '
            'never read, or not applicable per kernel_source.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_process_handles IS
            'Handles to Process objects, system-wide, whether the target '
            'process is live or dead. Windows only, per plan D2: '
            'NtQueryObject(ObjectTypesInformation) Process '
            'TotalNumberOfHandles. With dead = kernel_process_objects - '
            'os_process_count, coord will compute (plan R2) dead - '
            'kernel_process_handles - kernel_thread_handles as a tighter lower '
            'bound on the dead process objects no handle accounts for. It '
            'subtracts the two handle types known to pin a process (a thread '
            'object references its owning process: plan R2; Phase 0 probe (d) '
            'is to measure it); a debug object or an ALPC port could also pin one, '
            'and the subtraction assumes one handle pins at most one dead '
            'process, so the bound is evidence, not proof (plan R1/R2). '
            '2026-11-26 spaceship: at least 240547 on the looser '
            'kernel_handle_count bound. NULL = never read, an applicable read '
            'failed, or not applicable per kernel_source (Linux); never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_thread_objects IS
            'Kernel Thread objects, system-wide, including exited threads '
            'still referenced. Windows only, per plan D2: '
            'ObjectTypesInformation Thread TotalNumberOfObjects. Minus '
            'os_thread_count it approximates the count of dead-but-referenced '
            'threads (the two terms are read by different calls at different '
            'instants; plan D2). '
            'NULL = never read, an applicable read failed, or not applicable '
            'per kernel_source (Linux); never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_thread_handles IS
            'Handles to Thread objects, system-wide, live or dead. Windows '
            'only, per plan D2: ObjectTypesInformation Thread '
            'TotalNumberOfHandles. A thread object references its owning '
            'process (plan R2; Phase 0 probe (d) is to measure it), so a Thread '
            'handle can pin a dead process with no Process handle open: this '
            'column is half of the dead-process bound dead - '
            'kernel_process_handles - kernel_thread_handles, which is '
            'evidence, not proof (plan R1/R2). NULL = never read, an '
            'applicable read failed, or not applicable per kernel_source '
            '(Linux); never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.os_thread_count IS
            'Live OS threads. Windows, per plan D2: GetPerformanceInfo '
            '(PERFORMANCE_INFORMATION) ThreadCount; no Linux instrument in v1. '
            'BIGINT: coord is to read it as Option<i64> (plan Phase 3), unlike '
            'the INTEGER os_process_count. NULL = never read, an applicable '
            'read failed, or not applicable per kernel_source; never 0.'
        """
    )


def downgrade() -> None:
    """Drop every column upgrade() added. Exact reverse.

    The COMMENTs go with their columns. The DROP is a static literal inside
    this function body, out of the upgrade-path drop scan.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS kernel_process_census,
            DROP COLUMN IF EXISTS kernel_process_census_at,
            DROP COLUMN IF EXISTS kernel_process_handles,
            DROP COLUMN IF EXISTS kernel_thread_objects,
            DROP COLUMN IF EXISTS kernel_thread_handles,
            DROP COLUMN IF EXISTS os_thread_count
        """
    )
