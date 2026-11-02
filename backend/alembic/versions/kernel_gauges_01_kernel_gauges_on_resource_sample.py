"""coord.device_resource_samples kernel gauges + the S7-S9 tenant controls

Revision ID: kernel_gauges_01
Revises: coord_claude_acct_usage_04
Create Date: 2026-10-19

Phase 1 of plan
``2026-10-19-fleet-is-blind-to-kernel-object-leaks-and-os-process-creation-latency``
(design decisions D1, D2 and D4).

coord authors **zero** DDL (``[policy: production-and-cost
alembic-sole-authorship]``), and the R16 cut-over that moves coord's schema
into the coord repo has not landed, so the columns coord will ingest, store
and grade land here, in qontinui-web. Hand-authored; ``alembic revision
--autogenerate`` was not run and is never run against ``coord.*``.

Why these columns exist
=======================

Diagnostic ``probe-runner-2026-10-18-typing-lag-is-process-creation``
(plan-library id ``b5985c85-92e0-444c-9e1f-befd84eaf8bf``) found a Windows box
on which every process creation had slowed from tens of milliseconds to
0.7-7 s, freezing Claude Code sessions on their own synchronous spawns, while
every signal the fleet watches read healthy (CPU ~30 %, memory ~40 %, runner
``/health`` green, ``device_resource_headroom_breach`` silent). The cause was
measured only by hand, through two elevated ETW investigations:

* **4.2M leaked Token objects** (healthy: thousands), held by
  ``win32kfull!CForegroundLaunch::_CheckAllowForeground`` and growing in
  bursts; every ``NtCreateUserProcess`` walks the bloated token LUID index
  under one box-wide push lock, so process creation convoys.
* **36-43 GB of kernel pool** (paged + nonpaged), invisible in every
  process's working set and in the commit/physical numbers the sampler
  already publishes.
* **0.7-7 s OS process-creation latency** (``cmd /c exit`` wall time).

None of the three is visible to any existing ``coord.device_resource_samples``
column, so nothing could notice it until a human did. This revision adds the
columns that carry them, plus the tenant controls coord will grade them
against (plan Phase 3).

What this adds, and to what
===========================

Sixteen nullable columns on ``coord.device_resource_samples`` (plan D2), the
readings the runner's ``os-health`` collector publishes through the existing
resource-sample pipe:

```text
kernel_paged_bytes       BIGINT       kernel_pool_top_tags   JSONB
kernel_nonpaged_bytes    BIGINT       kernel_pool_tags_at    TIMESTAMPTZ
kernel_handle_count      BIGINT       spawn_probe_p50_ms     INTEGER
kernel_token_objects     BIGINT       spawn_probe_max_ms     INTEGER
kernel_process_objects   BIGINT       spawn_probe_count      INTEGER
os_process_count         INTEGER      spawn_probe_timeouts   INTEGER
os_booted_at             TIMESTAMPTZ  spawn_probe_errors     INTEGER
kernel_source            TEXT         spawn_probe_error_code INTEGER
```

Eight nullable control columns on **both** ``coord.fleet_runtime_policy`` and
``coord.fleet_runtime_policy_versions`` (plan D4; the ``sess_guard_01``
precedent, whose docstring argues every point about the two-table shape,
types and NULL semantics that applies here):

```text
                                           plan D4 default at authoring
kernel_token_objects_warn         BIGINT   250000
kernel_token_objects_breach       BIGINT   1000000
kernel_token_slope_warn_per_hour  BIGINT   10000 per hour
kernel_pool_warn_bytes            BIGINT   8 GiB
kernel_pool_breach_bytes          BIGINT   16 GiB
kernel_nonpaged_warn_bytes        BIGINT   4 GiB
spawn_p50_warn_ms                 INTEGER  250 ms
spawn_p50_breach_ms               INTEGER  1000 ms
```

None of these defaults, and none of the grading the column comments
describe, exists in coord yet: plan Phase 3 builds the S7-S9 grading and the
compiled defaults. The comments therefore attribute each behaviour and number
to the plan as it stood at authoring, rather than stating it as coord fact.

NULL semantics — never zero
===========================

A **sample** column is NULL when its reading was never taken, when an
APPLICABLE read failed, or when the instrument does not apply on that OS
(Token and Process object counts and pool tags on Linux). ``kernel_source``
names the instruments that answered, which is how a reader tells
"does not apply" from "failed". A NULL must never be read, graded or rendered
as 0: a 0 Token count would read as a perfectly healthy box.

A **control** column is NULL when the tenant has no override and coord's
compiled default applies. 0 is a different instruction (every reading at or
above 0 crosses the threshold), so a NULL must never be written as 0.

Types are an interface
======================

coord reads a ``BIGINT`` as ``Option<i64>`` and an ``INTEGER`` as
``Option<i32>``; reading an ``i64`` off an ``INTEGER`` column is a
tokio-postgres runtime type error, not a widening. ``ADD COLUMN IF NOT
EXISTS`` matches on name alone, so re-running ``upgrade()`` cannot repair a
column of the wrong type; fix one with an explicit ``ALTER COLUMN ... TYPE``
in a new revision. The migration test pins every name and type against the
two column tuples below (the control list covers both policy tables).

No CHECK constraints, and no backfill
=====================================

The invariants on the controls (``>= 0``, warn <= breach) are to be
validated app-side by coord's ``FleetPolicyControls::validate`` (plan Phase
3), the stance
``fleet_res_tel_03`` and ``sess_guard_01`` take for tunable ranges: a CHECK
would be a second door on the same input, would make every retune of the
allowed set a migration, and would retroactively invalidate historical
snapshot rows. Snapshot rows and samples written before this revision keep
NULL, which is the honest record that no reading or override existed.

Every column is nullable with no default, so each ADD is a catalogue update
with no table rewrite. Retention is unchanged: the sample columns ride
``prune_samples``' rolling window on ``sampled_at``
(``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``).

Deploy ordering
===============

The two column groups have DIFFERENT ordering rules, and only the first is
free.

**The 16 sample columns: coord may deploy on either side.** coord drops
unknown sample keys with a warning, but an INSERT naming a column the database
lacks fails 42703 and drops the WHOLE push. Plan Phase 2 therefore puts these
columns in a ``kernel`` schema-readiness group: coord's INSERT names them, and
its reads project them, only once its schema-readiness probe observes them
``Present``; until then reads project typed NULLs. That gate is what makes
either deploy order safe for these 16 columns, and nothing else does.

**The 8 control columns: NOT free.** coord must not add them to
``CONTROL_COLS`` unless that read is itself readiness-gated or 42703-gated.
``read_controls_only_on`` (``fleet_policy.rs``) classifies a 42703 as
``MissingSchema`` and ``read_controls_only_typed`` folds that into
``ControlsRead::Absent``, so a coord build naming a
control column this database lacks would make EVERY existing floor read as
"no controls" -- silently, for every tenant, until this revision deployed.
Plan Phase 3 owns that gate.

This revision arms nothing: no code writes or reads these columns yet.

Every ``op.execute`` below takes ONE static string literal, because coord's
migration classifier (``pr_merge/migration_classifier.rs``) reads only static
literals and holds a revision whose SQL it cannot see. Both ``upgrade()`` and
``downgrade()`` open with ``SET LOCAL lock_timeout = '3s'``, the house lock
bound and the one SET form that classifier admits. Plan D2's naming rule
keeps the security-surface glob ``**/*token*`` off this file's name.

The down_revision below is the single alembic head of ``origin/main`` at
authoring time. If ``alembic-heads-pr`` reports ``HEAD_COUNT=2`` after this
lands, re-point this line and ``_PARENT_REVISION_ID`` in
``tests/test_kernel_gauges_01_kernel_gauges_on_resource_sample_migration.py``
together.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "kernel_gauges_01"
down_revision: str | Sequence[str] | None = "coord_claude_acct_usage_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SAMPLE_TABLE = "coord.device_resource_samples"

_POLICY_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)

# The columns, as data; the migration test pins names and DDL types against
# these tuples, and checks that the static SQL below adds, comments and drops
# exactly these. The SQL spells the same columns as STATIC literals because
# coord's migration classifier can only inspect static op.execute literals.
_KERNEL_GAUGE_COLUMNS: tuple[tuple[str, str], ...] = (
    ("kernel_paged_bytes", "BIGINT"),
    ("kernel_nonpaged_bytes", "BIGINT"),
    ("kernel_handle_count", "BIGINT"),
    ("kernel_token_objects", "BIGINT"),
    ("kernel_process_objects", "BIGINT"),
    ("os_process_count", "INTEGER"),
    ("os_booted_at", "TIMESTAMPTZ"),
    ("kernel_pool_top_tags", "JSONB"),
    ("kernel_pool_tags_at", "TIMESTAMPTZ"),
    ("spawn_probe_p50_ms", "INTEGER"),
    ("spawn_probe_max_ms", "INTEGER"),
    ("spawn_probe_count", "INTEGER"),
    ("spawn_probe_timeouts", "INTEGER"),
    ("spawn_probe_errors", "INTEGER"),
    ("spawn_probe_error_code", "INTEGER"),
    ("kernel_source", "TEXT"),
)

# One list for BOTH policy tables, so the parent and its snapshot table can
# never carry different payloads (the sess_guard_01 rule).
_KERNEL_CONTROL_COLUMNS: tuple[tuple[str, str], ...] = (
    ("kernel_token_objects_warn", "BIGINT"),
    ("kernel_token_objects_breach", "BIGINT"),
    ("kernel_token_slope_warn_per_hour", "BIGINT"),
    ("kernel_pool_warn_bytes", "BIGINT"),
    ("kernel_pool_breach_bytes", "BIGINT"),
    ("kernel_nonpaged_warn_bytes", "BIGINT"),
    ("spawn_p50_warn_ms", "INTEGER"),
    ("spawn_p50_breach_ms", "INTEGER"),
)


def upgrade() -> None:
    """Add the sixteen kernel-gauge sample columns and the eight S7-S9 controls.

    `alembic/env.py` runs this inside `context.begin_transaction()` and
    PostgreSQL DDL is transactional, so every ALTER commits or none does.
    """
    # Bound the ACCESS EXCLUSIVE lock wait first (house style): a QUEUED lock
    # request blocks every reader of the table behind it. `alembic/env.py`
    # restores lock_timeout after each revision, so no restore is needed here.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # -- the sample columns (plan D2) ------------------------------------
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS kernel_paged_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_nonpaged_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_handle_count BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_token_objects BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_process_objects BIGINT,
            ADD COLUMN IF NOT EXISTS os_process_count INTEGER,
            ADD COLUMN IF NOT EXISTS os_booted_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS kernel_pool_top_tags JSONB,
            ADD COLUMN IF NOT EXISTS kernel_pool_tags_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS spawn_probe_p50_ms INTEGER,
            ADD COLUMN IF NOT EXISTS spawn_probe_max_ms INTEGER,
            ADD COLUMN IF NOT EXISTS spawn_probe_count INTEGER,
            ADD COLUMN IF NOT EXISTS spawn_probe_timeouts INTEGER,
            ADD COLUMN IF NOT EXISTS spawn_probe_errors INTEGER,
            ADD COLUMN IF NOT EXISTS spawn_probe_error_code INTEGER,
            ADD COLUMN IF NOT EXISTS kernel_source TEXT
        """
    )

    # -- the control columns, on the parent AND the snapshot table (D4) ----
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            ADD COLUMN IF NOT EXISTS kernel_token_objects_warn BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_token_objects_breach BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_token_slope_warn_per_hour BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_pool_warn_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_pool_breach_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_nonpaged_warn_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS spawn_p50_warn_ms INTEGER,
            ADD COLUMN IF NOT EXISTS spawn_p50_breach_ms INTEGER
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            ADD COLUMN IF NOT EXISTS kernel_token_objects_warn BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_token_objects_breach BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_token_slope_warn_per_hour BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_pool_warn_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_pool_breach_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS kernel_nonpaged_warn_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS spawn_p50_warn_ms INTEGER,
            ADD COLUMN IF NOT EXISTS spawn_p50_breach_ms INTEGER
        """
    )

    # -- sample column comments ------------------------------------------
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_paged_bytes IS
            'Kernel paged pool in bytes at sample time (plan '
            '2026-10-19-fleet-is-blind-to-kernel-object-leaks-and-os-process-creation-latency, D2). '
            'Windows: GetPerformanceInfo KernelPaged x PageSize. Linux: '
            '/proc/meminfo SReclaimable, REPORTING ONLY in v1 (reclaimable '
            'slab is cache; per plan D4, S8 is to grade windows: sources '
            'only). NULL = never '
            'read, an applicable read failed, or not applicable per '
            'kernel_source; never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_nonpaged_bytes IS
            'Kernel nonpaged pool in bytes at sample time. Windows: '
            'GetPerformanceInfo KernelNonpaged x PageSize. Linux: /proc/meminfo '
            'SUnreclaim + KernelStack + PageTables, REPORTING ONLY in v1. '
            'coord will grade it under S8 (plan Phase 3; paged + nonpaged, and '
            'nonpaged alone) for windows: sources only. NULL = never read, an '
            'applicable read failed, or not '
            'applicable per kernel_source; never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_handle_count IS
            'System-wide open handle count. Windows: GetPerformanceInfo '
            'HandleCount. Linux: /proc/sys/fs/file-nr allocated file handles. '
            'NULL = never read, an applicable read failed, or not applicable '
            'per kernel_source; never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_token_objects IS
            'Live kernel Token objects, system-wide. Windows only: '
            'NtQueryObject(ObjectTypesInformation) Token TotalNumberOfObjects, '
            'no elevation needed. The leading indicator coord will grade as '
            'S7 (plan Phase 3): healthy is '
            'thousands; the 2026-10 win32kfull leak reached 4.2M and slowed '
            'every process creation. NULL = never read, an applicable read '
            'failed, or not applicable per kernel_source (Linux has no such '
            'object); never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_process_objects IS
            'Kernel Process objects, system-wide, including exited processes '
            'still referenced. Windows only: ObjectTypesInformation Process '
            'TotalNumberOfObjects. Minus os_process_count it is the zombie '
            'count, which separates a zombie leak from a bare-reference leak. '
            'NULL = never read, an applicable read failed, or not applicable '
            'per kernel_source (Linux); never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.os_process_count IS
            'Live OS processes. Windows: GetPerformanceInfo ProcessCount. '
            'Linux: the count of /proc/[0-9]* entries. NULL = never read, an '
            'applicable read failed, or not applicable per kernel_source; '
            'never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.os_booted_at IS
            'OS boot time. Windows: now - GetTickCount64. Linux: /proc/stat '
            'btime. Per plan D4, the S7 slope coord will compute (plan Phase '
            '3) differences only samples sharing the latest os_booted_at and '
            'only once an hour has passed since boot, so it cannot difference '
            'across a reboot. NULL = never read, an '
            'applicable read failed, or not applicable per kernel_source.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_pool_top_tags IS
            'Top 8 kernel pool tags by bytes, as '
            '[{tag, bytes, outstanding_allocs}]. Windows only: '
            'NtQuerySystemInformation(SystemPoolTagInformation); per plan D2 '
            'the collector re-reads it every 5th tick (about 2.5 min) and '
            'caches it, and EVERY sample republishes the cached array with '
            'kernel_pool_tags_at, so an alert can name its leak. Tags are raw '
            '4-byte pool tags: writers must sanitize them to printable ASCII '
            'before binding, because Postgres jsonb rejects a NUL (U+0000) '
            'escape with 22P05, which would drop the whole multi-row INSERT. '
            'NULL = never read, an applicable read failed, or not applicable '
            'per kernel_source (Linux); never an empty array standing in for '
            'unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_pool_tags_at IS
            'When kernel_pool_top_tags was read (per plan D2 it is re-read '
            'every 5th collector tick, so it may predate sampled_at by a few '
            'minutes). The publisher sends both or neither; nothing enforces '
            'it. NULL = never read, an applicable read failed, or not '
            'applicable per kernel_source.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.spawn_probe_p50_ms IS
            'Median OS process-creation wall time in ms, spawn to exit, over a '
            'rolling window of the last 10 active probes (plan D3: Windows '
            'cmd.exe /c exit, Linux /bin/true, one every 60 s). A timeout '
            'counts as a censored sample at 30000 ms; a create error is not a '
            'measurement and is excluded. coord will grade it as S9 (plan '
            'Phase 3); healthy is tens of ms, the 2026-10 incident read '
            '700-7000. NULL = never read, no measured probe in '
            'the window, or not applicable per kernel_source; never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.spawn_probe_max_ms IS
            'Maximum OS process-creation wall time in ms over the same rolling '
            'window of the last 10 probes as spawn_probe_p50_ms, timeouts '
            'counted as 30000 ms. NULL = never read, no measured probe in the '
            'window, or not applicable per kernel_source; never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.spawn_probe_count IS
            'Number of spawn probes in the rolling window (at most 10) that '
            'the spawn_probe_* columns describe, timeouts and create errors '
            'included. NULL = the probe has never run or not applicable per '
            'kernel_source; 0 is never written to stand in for unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.spawn_probe_timeouts IS
            'Probes in the rolling window that hit the 30 s run_with_timeout '
            'limit and had their process tree killed (plan D3). Each one '
            'counts in spawn_probe_p50_ms and spawn_probe_max_ms as a censored '
            '30000 ms sample. Per plan D4, coord is to grade a window of '
            'failures with zero successes as an S9 Breach (spawn_failed). '
            'NULL = the probe has never run or not '
            'applicable per kernel_source.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.spawn_probe_errors IS
            'Probes in the rolling window whose child process could not be '
            'created at all (for example Windows error 1450, '
            'NoSystemResources). Not a measurement, so excluded from p50 and '
            'max; per plan D4, coord is to grade a window of failures with '
            'zero successes as an S9 Breach (spawn_failed). NULL = the probe '
            'has never run or not applicable per kernel_source.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.spawn_probe_error_code IS
            'The OS error code of the latest failed process creation in the '
            'rolling window (for example 1450 on Windows). NULL = no create '
            'error in the window, the probe has never run, or not applicable '
            'per kernel_source; 0 is never written to stand in for none.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.kernel_source IS
            'The instruments that ANSWERED this sample, for example '
            'windows:getperformanceinfo+objecttypes+pooltags or '
            'linux:proc-meminfo+file-nr. It is how a reader tells a '
            'measurement from an approximation, and an instrument that does '
            'not apply on this OS (skipped, never UNKNOWN) from one that '
            'failed (UNKNOWN). coord will grade S7-S9 (plan Phase 3) only on '
            'runner rows with a non-NULL kernel_source. NULL = the publisher '
            'sent no kernel '
            'reading (a host-lane supervisor row, or a build predating it).'
        """
    )

    # -- control column comments, parent table ---------------------------
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.kernel_token_objects_warn IS
            'S7 WARN threshold on the sample column kernel_token_objects '
            '(live kernel Token objects), for the S7 grading coord will run '
            '(plan Phase 3). NULL = no override; coord''s compiled default '
            'applies (plan D4 at authoring: 250000). 0 would warn on every '
            'reading, which is a different instruction. To be validated '
            'app-side by FleetPolicyControls::validate (plan Phase 3: >= 0, '
            'warn <= breach), not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.kernel_token_objects_breach IS
            'S7 BREACH threshold on kernel_token_objects. NULL = no override; '
            'coord''s compiled default applies (plan D4 at authoring: '
            '1000000). Must be >= kernel_token_objects_warn, to be validated '
            'app-side by FleetPolicyControls::validate (plan Phase 3), not by '
            'a CHECK. Plan D4: S7-S9 alert at severity Warning and are '
            'observe-only.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.kernel_token_slope_warn_per_hour IS
            'S7 WARN threshold on the Token-object growth rate, in objects per '
            'hour. Per plan D4 coord will compute the slope (plan Phase 3) '
            'over the last 3 h of samples sharing the latest os_booted_at and '
            'only once an hour has passed since boot (otherwise the slope is '
            'UNKNOWN and cannot fire). NULL = no override; coord''s compiled '
            'default applies (plan D4 at authoring: 10000 per hour). The '
            '2026-10 incident leaked about 36000-90000 per hour.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.kernel_pool_warn_bytes IS
            'S8 WARN threshold on kernel_paged_bytes + kernel_nonpaged_bytes, '
            'in bytes; per plan D4 to be graded for windows: kernel_source '
            'rows only in v1. NULL = no override; coord''s compiled default '
            'applies (plan D4 at authoring: 8 GiB (8589934592)). Healthy is '
            '1-3 GB. To be validated app-side by FleetPolicyControls::validate '
            '(plan Phase 3: >= 0, warn <= breach), not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.kernel_pool_breach_bytes IS
            'S8 BREACH threshold on kernel_paged_bytes + kernel_nonpaged_bytes, '
            'in bytes. NULL = no override; coord''s compiled default applies '
            '(plan D4 at authoring: 16 GiB (17179869184)). Must be >= '
            'kernel_pool_warn_bytes, to be validated app-side by '
            'FleetPolicyControls::validate (plan Phase 3), not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.kernel_nonpaged_warn_bytes IS
            'S8 WARN threshold on kernel_nonpaged_bytes alone, in bytes. NULL '
            '= no override; coord''s compiled default applies (plan D4 at '
            'authoring: 4 GiB (4294967296)). 0 would warn on every reading, '
            'which is a different instruction. To be validated app-side by '
            'FleetPolicyControls::validate (plan Phase 3), not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.spawn_p50_warn_ms IS
            'S9 WARN threshold on spawn_probe_p50_ms (rolling median OS '
            'process-creation latency), in ms. NULL = no override; coord''s '
            'compiled default applies (plan D4 at authoring: 250 ms). Healthy '
            'is tens of ms. INTEGER, so coord must read it as Option<i32>. To '
            'be validated app-side by FleetPolicyControls::validate (plan '
            'Phase 3: >= 0, warn <= breach), not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.spawn_p50_breach_ms IS
            'S9 BREACH threshold on spawn_probe_p50_ms, in ms. NULL = no '
            'override; coord''s compiled default applies (plan D4 at '
            'authoring: 1000 ms). Must be >= spawn_p50_warn_ms, to be '
            'validated app-side by FleetPolicyControls::validate (plan Phase '
            '3), not by a CHECK. Per plan D4, a window of failed probes with '
            'zero successes is to grade Breach regardless (spawn_failed).'
        """
    )

    # -- control column comments, snapshot table -------------------------
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.kernel_token_objects_warn IS
            'Snapshot of coord.fleet_runtime_policy.kernel_token_objects_warn; '
            'see that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.kernel_token_objects_breach IS
            'Snapshot of coord.fleet_runtime_policy.kernel_token_objects_breach; '
            'see that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.kernel_token_slope_warn_per_hour IS
            'Snapshot of coord.fleet_runtime_policy.kernel_token_slope_warn_per_hour; '
            'see that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.kernel_pool_warn_bytes IS
            'Snapshot of coord.fleet_runtime_policy.kernel_pool_warn_bytes; '
            'see that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.kernel_pool_breach_bytes IS
            'Snapshot of coord.fleet_runtime_policy.kernel_pool_breach_bytes; '
            'see that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.kernel_nonpaged_warn_bytes IS
            'Snapshot of coord.fleet_runtime_policy.kernel_nonpaged_warn_bytes; '
            'see that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.spawn_p50_warn_ms IS
            'Snapshot of coord.fleet_runtime_policy.spawn_p50_warn_ms; see '
            'that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.spawn_p50_breach_ms IS
            'Snapshot of coord.fleet_runtime_policy.spawn_p50_breach_ms; see '
            'that column for its meaning and why NULL is not zero. Rows '
            'written before revision kernel_gauges_01 carry NULL: no override '
            'could have been in force. Immutable: never UPDATE or DELETE.'
        """
    )


def downgrade() -> None:
    """Drop every column upgrade() added, from all three tables. Exact reverse.

    The COMMENTs go with their columns. Both policy tables are dropped
    together for the reason sess_guard_01 gives: leaving the snapshot columns
    behind would let the versions table hold payload the parent cannot. The
    DROPs are static literals inside this function body, out of the
    upgrade-path drop scan.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            DROP COLUMN IF EXISTS kernel_token_objects_warn,
            DROP COLUMN IF EXISTS kernel_token_objects_breach,
            DROP COLUMN IF EXISTS kernel_token_slope_warn_per_hour,
            DROP COLUMN IF EXISTS kernel_pool_warn_bytes,
            DROP COLUMN IF EXISTS kernel_pool_breach_bytes,
            DROP COLUMN IF EXISTS kernel_nonpaged_warn_bytes,
            DROP COLUMN IF EXISTS spawn_p50_warn_ms,
            DROP COLUMN IF EXISTS spawn_p50_breach_ms
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            DROP COLUMN IF EXISTS kernel_token_objects_warn,
            DROP COLUMN IF EXISTS kernel_token_objects_breach,
            DROP COLUMN IF EXISTS kernel_token_slope_warn_per_hour,
            DROP COLUMN IF EXISTS kernel_pool_warn_bytes,
            DROP COLUMN IF EXISTS kernel_pool_breach_bytes,
            DROP COLUMN IF EXISTS kernel_nonpaged_warn_bytes,
            DROP COLUMN IF EXISTS spawn_p50_warn_ms,
            DROP COLUMN IF EXISTS spawn_p50_breach_ms
        """
    )
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS kernel_paged_bytes,
            DROP COLUMN IF EXISTS kernel_nonpaged_bytes,
            DROP COLUMN IF EXISTS kernel_handle_count,
            DROP COLUMN IF EXISTS kernel_token_objects,
            DROP COLUMN IF EXISTS kernel_process_objects,
            DROP COLUMN IF EXISTS os_process_count,
            DROP COLUMN IF EXISTS os_booted_at,
            DROP COLUMN IF EXISTS kernel_pool_top_tags,
            DROP COLUMN IF EXISTS kernel_pool_tags_at,
            DROP COLUMN IF EXISTS spawn_probe_p50_ms,
            DROP COLUMN IF EXISTS spawn_probe_max_ms,
            DROP COLUMN IF EXISTS spawn_probe_count,
            DROP COLUMN IF EXISTS spawn_probe_timeouts,
            DROP COLUMN IF EXISTS spawn_probe_errors,
            DROP COLUMN IF EXISTS spawn_probe_error_code,
            DROP COLUMN IF EXISTS kernel_source
        """
    )
