"""coord.device_resource_samples runner self-memory: private, resident, start

Revision ID: runmem_01
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-11

Phase 1 of plan
``2026-11-11-devops-runner-self-rss-is-absent-from-the-resource-sample``
(Design, "The metric to add" and "Migration order" step 1).

coord authors **zero** DDL (``[policy: production-and-cost
alembic-sole-authorship]``), and the R16 cut-over that moves coord's schema
into the coord repo has not landed (plan
``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord`` is
PARTIAL, its Phase 6.1 web freeze still open), so the columns coord will
ingest, store and grade land here, in qontinui-web. Hand-authored; ``alembic
revision --autogenerate`` was not run and is never run against ``coord.*``.

Why these columns exist
=======================

On two Linux hosts the PRIMARY qontinui-runner process grew over days of
uptime to tens of GiB, and no fleet telemetry field named it:

* **nilan** (device ``4b426e2b-cc10-4870-80a5-524aaac70719``),
  2026-11-11T12:31Z: runner pid 4163259, build ``73e30b33d``, up 6.6 d,
  **VmRSS 64.9 GiB + VmSwap 2.1 GiB** on a 503.5 GiB host whose 48 GiB of
  swap was exhausted.
* **nawa** (device ``bcf4751a``), 2026-11-07T07:28Z, coord finding
  ``cb585944``: runner pid 93996, build ``8dae5bb42``, up 4.4 d,
  **VmRSS 27.05 GB + VmSwap 14.19 GB**.

Both were read by hand from ``/proc/<pid>/status``. nilan's host lane did grade
``warn``, but only on its generic swap axis, and the single read taken
(2026-11-11T12:58Z) found host swap already exhausted. Nothing named the
runner, and nothing could have seen its growth days earlier:
the sample carries the publishing runner's own ``thread_count`` (``lasac_01``)
but nothing about its memory, and the host lane's ``top_consumers``
(``topcons_01``), once its publisher ships, will name the runner only while it
ranks in the host's top 5; today nothing writes it.
One process holding about 13 % of the machine, and still growing, falls below
every host-level floor until the host itself is exhausted.

What this adds, and to what
===========================

Three nullable columns on ``coord.device_resource_samples``: the publishing
runner's OWN process memory, read by the runner of itself and published on the
**host lane only** through the existing resource-sample pipe (plan Phase 4).
Every other lane leaves them NULL, because the values belong to the runner
process, not to a machine pool another lane could own.

```text
runner_private_bytes   BIGINT
runner_rss_bytes       BIGINT
runner_started_at      TIMESTAMPTZ
```

* ``runner_private_bytes`` is the GRADED value. Linux: ``RssAnon + VmSwap``
  from ``/proc/self/status`` (kB x 1024). Windows:
  ``PROCESS_MEMORY_COUNTERS_EX.PrivateUsage``. Neither page-out nor
  working-set trimming shrinks it, and it shares the basis ``top_consumers``
  declares for the same pid, so the two can differ only by the interval
  between two reads, never by definition.
* ``runner_rss_bytes`` is DISPLAY ONLY. Linux: ``VmRSS`` (kB x 1024). Windows:
  ``WorkingSetSize``. It is the number a hand read of ``/proc/<pid>/status``
  quotes, so the dashboard and a hand read agree by construction. It is never
  graded: page-out and working-set trimming lower it while the process holds
  just as much.
* ``runner_started_at`` is when the runner process started: the RESTART
  BOUNDARY. Per the plan, a slope of ``runner_private_bytes`` is to be fitted
  only over samples whose ``runner_started_at`` matches the latest within 2 s,
  so no slope will ever difference across two runner processes.
  ``os_booted_at`` (``kernel_gauges_01``) plays the same role for S7 across a
  reboot.

Deliberately absent: a swap column (the Linux private basis already includes
``VmSwap`` and ``PrivateUsage`` is its Windows equivalent, so no per-OS NULL
case is needed), and ``VmData`` (reserved address space, 148.8 GiB on nilan,
which overstates use and does not map onto host pressure).

NULL semantics — never zero
===========================

A column is NULL when the publisher predates it, when the runner's read of
itself failed (an unreadable ``/proc``, a parse failure, an OS call error), or
on any lane other than the host lane. A NULL must never be read, graded or
rendered as 0: a fabricated 0 would show the leaking runner as the leanest one
in the fleet. It renders as UNKNOWN (``[policy: verification-and-evidence
unknown-must-not-render-as-a-default]``), and per the plan a NULL input holds
an alert rather than firing it (``[policy: verification-and-evidence
an-unknown-input-must-not-fire-a-detector]``). Rows written before this
revision keep NULL, which is the honest record that no reading existed.

Graded at read time, never stored, never ranked
===============================================

There is no grade column. Per the plan, coord is to compute
``runner_memory_headroom`` at READ time beside ``thread_headroom`` (plan Phase
2), never store it and never fold it into ``headroom``, and to alert on it as
the observe-only ``s12`` / ``runner_memory`` instance of the existing
``device_resource_headroom_breach`` kind (plan Phase 3). The grade is in
absolute bytes plus a sustained slope, not a ratio of host memory, because a
runner's footprint does not scale with host RAM. The plan's compiled defaults
are warn 8 GiB, breach 16 GiB, and a slope of 512 MiB/h fitted over a covered
3 h window whose first sample is at least 2 h after ``runner_started_at``. The
thresholds and the 2 h start gate come from the plan's Phase 0 calibration
(fit.md, in ``qontinui-dev-notes``
``devops-data/2026-11-11-runner-rss-nilan/``). None of that grading exists in
coord yet, so this docstring and the column comments attribute it to the plan
rather than stating it as coord fact.

These columns are NOT a dispatch input. ``lane_pressure()`` ranks devices on
free host capacity, and the runner's memory is already counted in the host
lane's ``commit_*`` (MemAvailable on Linux, free commit on Windows); ranking on
it too would count the same bytes twice.

Types are an interface
======================

coord reads a ``BIGINT`` as ``Option<i64>`` and a ``TIMESTAMPTZ`` as an
optional UTC timestamp; nilan's 64.9 GiB does not fit an ``INTEGER``. ``ADD
COLUMN IF NOT EXISTS`` matches on name alone, so re-running ``upgrade()``
cannot repair a column of the wrong type; fix one with an explicit ``ALTER
COLUMN ... TYPE`` in a new revision. The migration test pins every name and
type against the column tuple below.

No DEFAULT, no CHECK, and no backfill
=====================================

No DEFAULT, because a default is a fabricated reading. No CHECK (``>= 0``),
because the range is to be validated app-side by coord's lenient decoder (plan
Phase 2, the ``device_resource_kernel_gauges.rs`` precedent): a CHECK would be
a second door on the same input, and one violating value would fail the whole
multi-row INSERT, discarding every other metric on the push. No backfill,
because no historical reading exists. Every column is nullable with no
default, so the ADD is a catalogue update with no table rewrite. Retention is
unchanged: the columns ride ``prune_samples``' rolling window on
``sampled_at`` (``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``).

Deploy ordering
===============

**This revision lands and deploys FIRST** (plan "Migration order"):

1. This revision.
2. coord's consumer (plan Phase 2), readiness-gated. The plan puts these
   columns in a ``runner_mem`` schema-readiness group, so coord's INSERT names
   them, and its reads project them, only once its schema-readiness probe
   observes them ``Present``; until then reads project typed NULLs. An INSERT
   naming a column the database lacks fails 42703 and drops the WHOLE
   multi-lane push, and that gate is what prevents it. The coord PR is
   additionally held with ``migration_order`` until this revision is verified
   live in prod.
3. The runner publisher (plan Phase 4), LAST: coord accepts the push and drops
   each unknown key, warning on every push that carries one, so readings
   published before its consumer ships are lost.

A device reports these fields only after its runner next starts on a build
that publishes them; until then its rows read NULL, which is UNKNOWN.

This revision arms nothing: no code writes or reads these columns yet.

Every ``op.execute`` below takes ONE static string literal, because coord's
migration classifier (``pr_merge/migration_classifier.rs``) reads only static
literals and holds a revision whose SQL it cannot see. Both ``upgrade()`` and
``downgrade()`` open with ``SET LOCAL lock_timeout = '3s'``, the house lock
bound, in a SET LOCAL form that classifier admits.

The down_revision below is the single alembic head of ``origin/main`` at
authoring time. If ``alembic-heads-pr`` reports ``HEAD_COUNT=2`` on this PR,
re-point this line, the ``Revises:`` line above and
``_PARENT_REVISION_ID`` in
``tests/test_runmem_01_runner_memory_on_resource_sample_migration.py``
together.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "runmem_01"
down_revision: str | Sequence[str] | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SAMPLE_TABLE = "coord.device_resource_samples"

# The columns, as data; the migration test pins names and DDL types against
# this tuple, and checks that the static SQL below adds, comments and drops
# exactly these. The SQL spells the same columns as STATIC literals because
# coord's migration classifier can only inspect static op.execute literals.
_RUNNER_MEMORY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("runner_private_bytes", "BIGINT"),
    ("runner_rss_bytes", "BIGINT"),
    ("runner_started_at", "TIMESTAMPTZ"),
)


def upgrade() -> None:
    """Add the three nullable runner self-memory sample columns.

    `alembic/env.py` runs this inside `context.begin_transaction()` and
    PostgreSQL DDL is transactional, so the ALTER and its COMMENTs commit
    together or not at all.
    """
    # Bound the ACCESS EXCLUSIVE lock wait first (house style): a QUEUED lock
    # request blocks every reader of the table behind it. `alembic/env.py`
    # restores lock_timeout after each revision, so no restore is needed here.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS runner_private_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS runner_rss_bytes BIGINT,
            ADD COLUMN IF NOT EXISTS runner_started_at TIMESTAMPTZ
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.runner_private_bytes IS
            'The publishing runner''s OWN process private memory in bytes at '
            'sample time, host lane only (plan '
            '2026-11-11-devops-runner-self-rss-is-absent-from-the-resource-sample). '
            'Linux: /proc/self/status (RssAnon + VmSwap) x 1024. Windows: '
            'PROCESS_MEMORY_COUNTERS_EX.PrivateUsage, the basis top_consumers '
            'declares for the same pid. Neither page-out nor working-set '
            'trimming shrinks it. The graded value: per the plan, coord is to '
            'grade it at read time in absolute bytes and on the observe-only '
            's12 runner_memory axis (plan Phases 2-3); it is never a '
            'lane-pressure ranking input. NULL = the publisher predates the '
            'field, the read failed, or a lane other than host; render it as '
            'UNKNOWN, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.runner_rss_bytes IS
            'The publishing runner''s OWN resident set in bytes at sample time, '
            'host lane only. Linux: /proc/self/status VmRSS x 1024. Windows: '
            'PROCESS_MEMORY_COUNTERS_EX.WorkingSetSize. DISPLAY ONLY: it is '
            'the number a hand read of /proc/<pid>/status quotes, but page-out '
            'and working-set trimming lower it while the process holds just as '
            'much, so it is never graded (runner_private_bytes is). NULL = the '
            'publisher predates the field, the read failed, or a lane other '
            'than host; render it as UNKNOWN, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.runner_started_at IS
            'When the publishing runner process started, host lane only: the '
            'restart boundary for any slope of runner_private_bytes. Per the '
            'plan, coord is to fit that slope (plan Phase 3) only over samples '
            'whose runner_started_at matches the latest within 2 s, so it '
            'never differences across two runner processes (os_booted_at plays '
            'the same role for S7), and only once the first sample of the '
            'window is at least 2 h after runner_started_at (the start gate '
            'from the plan''s Phase 0 calibration, fit.md). NULL = the '
            'publisher predates the field, the read failed, or a lane other '
            'than host; render it as UNKNOWN, and with no start time there is '
            'no restart boundary, so no slope.'
        """
    )


def downgrade() -> None:
    """Drop the three columns upgrade() added. Exact reverse.

    The COMMENTs go with their columns. The DROP is a static literal inside
    this function body, out of the upgrade-path drop scan.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS runner_private_bytes,
            DROP COLUMN IF EXISTS runner_rss_bytes,
            DROP COLUMN IF EXISTS runner_started_at
        """
    )
