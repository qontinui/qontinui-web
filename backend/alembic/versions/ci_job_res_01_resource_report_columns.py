"""coord.ci_job_observations — the columns a CI job's resource report fills

Revision ID: ci_job_res_01
Revises: coord_agent_questions_recommendation
Create Date: 2026-10-28

Phase 3 of plan ``2026-10-27-coord-routes-ci-jobs-by-runner-capability``,
extending the per-job resource columns that ``ci_job_mem_01`` (plan
``2026-09-20-ci-memory-headroom-in-the-dev-ops-console``) added.

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``;
``coord-schema-moves-to-the-coord-repo`` has not reached its R16 phase — coord's
``crates/coord-migrations`` still declares itself NOT AUTHORITATIVE), so the
columns coord's ``ci_job_sampler`` will write land here and this revision must
merge **before** the coord PR that writes them. Hand-authored;
``alembic revision --autogenerate`` was not run and is never run against
``coord.*``.

What fills them
===============

Plan 2026-10-27 Phase 2 makes each heavy CI job emit ONE check-run annotation::

    ::notice title=qontinui-resource-report::{json}

with the keys ``os, phys_mem_mb, commit_limit_mb, pagefile_alloc_mb,
pagefile_peak_mb, peak_commit_mb, peak_rss_mb, cgroup_oom_kills,
disk_free_min_mb, build_outcome``, each present ONLY when measured. coord's
sampler reads that annotation and writes the row with
``resource_source = 'job_annotation'``. Five keys already have a home on the
row (``ci_job_mem_01``) and need no column:

==================  =====================  ==========================================
report key          column                 why it is the same quantity
==================  =====================  ==========================================
phys_mem_mb         mem_total_mb           total physical memory, the denominator
pagefile_alloc_mb   swap_total_mb          the backing-store capacity the job RAN
                                           WITH, including any swap or pagefile the
                                           job added itself
pagefile_peak_mb    peak_swap_used_mb      peak backing-store use (Windows PeakUsage;
                                           omitted on non-GitHub-hosted Windows)
disk_free_min_mb    min_disk_avail_mb      free disk at the job's fullest point
==================  =====================  ==========================================

The other six have no home, so this revision adds them:

* ``peak_commit_mb`` / ``commit_limit_mb`` — the Windows commit charge peak and
  the commit limit the OS enforces. The motivating incident (runner job
  122032841168, ``rustc-LLVM ERROR: out of memory``) was commit exhaustion with
  RAM to spare, which no memory or swap column can express.
* ``peak_anon_mem_mb`` — the report's ``peak_rss_mb`` key: the job's peak
  ANONYMOUS memory (cgroup v2 ``memory.stat`` ``anon``) — the memory the build
  actually holds, page cache excluded. It may be absent on some jobs. It is
  deliberately NOT written into ``peak_mem_used_mb``, whose own COMMENT says it
  is SYSTEM-WIDE ``free -m`` and was "deliberately not named peak_rss_mb"; it
  gets a column named for what it is. The cgroup's ``memory.peak`` charge (page
  cache included) is NOT ingested anywhere.
* ``cgroup_oom_kills`` — ``memory.events`` ``oom_kill`` for the job's cgroup:
  positive kernel evidence of an OOM kill, which plan 2026-10-27 D4 needs.
* ``resource_os`` — the OS the report measured (``linux`` | ``windows`` |
  ``macos``). ``runner_labels`` names a label, not a measured OS, and after a
  reroute a leg's name can say ``windows-latest`` while its class changed.
* ``build_outcome`` — the outcome of the job's heavy compile-and-test work
  (``success`` | ``failure`` | ``cancelled`` | ``skipped``), which is not the
  job's ``conclusion``: a job can conclude ``failure`` on a later step after the
  build succeeded, and the requirement estimator must know whether the peak
  belongs to a build that finished.

NULL is UNKNOWN, never 0
========================

Every column is nullable with no DEFAULT, as in ``ci_job_mem_01`` and for the
same reason: the report OMITS an unmeasured key rather than zeroing it, and a
defaulted 0 would turn "Linux keeps no commit peak" into "this job committed
nothing" and an unread ``memory.events`` into a fabricated all-clear.
``cgroup_oom_kills = 0`` IS a real reading (the counter was read and did not
rise) and stays distinct from NULL.

TEXT without CHECK
==================

``resource_os`` and ``build_outcome`` carry no CHECK, matching ``outcome``,
``duration_band`` and ``resource_source`` on this table: ingest is best-effort
and a CHECK violation would fail the whole UPSERT, discarding the job's timing
and conclusion over a label. coord validates both app-side and writes NULL for
anything outside the vocabulary.

``resource_source`` gains a value, and that is not a migration
==============================================================

``ci_job_mem_01``'s COMMENT on ``resource_source`` states that "adding a class
stays a Rust PR rather than a migration". ``job_annotation`` is that class;
it is named in coord (``ci_resource_report.rs``), not here.

No new index
============

These are read on rows the shipped indexes already select; nothing filters or
orders by them.

Head choice
===========

``down_revision`` is the LOCAL single alembic head on ``origin/main`` at
``8b59aa675`` (711 revisions, exactly 1 head, derived by parsing every file's
``revision`` / ``down_revision`` with ``ast``). If another alembic PR lands
first, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the companion test together. No ``alembic merge``.

Deploy ordering
===============

The coord PR that WRITES these columns is ``downstream-of`` this one
(``[policy: alembic-sole-authorship]`` "land the companion qontinui-web alembic
migration FIRST, then the read"). coord's write also degrades on
``42703 undefined_column`` to a logged skip of the resource fields only, so an
out-of-order deploy loses resource readings, never the observation row.

Safety and idempotency
======================

``ADD COLUMN IF NOT EXISTS`` (type-blind — the companion test asserts every
type by name) plus re-runnable ``COMMENT ON``. Each ADD is catalogue-only
(nullable, no default), and ``SET LOCAL lock_timeout = '3s'`` bounds the brief
``ACCESS EXCLUSIVE`` lock on a table coord's sampler UPSERTs every 120 s, as
``ci_job_mem_01`` does. Pure SQL with no bind, so ``--sql`` offline mode works.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ci_job_res_01"
down_revision: str | Sequence[str] | None = "coord_agent_questions_recommendation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.ci_job_observations"

# The one column list. The upgrade's ADDs and the downgrade's removals are both
# generated from it so they cannot drift. INTEGER for megabyte counts and a
# kill count (coord reads them as Option<i32>), as in ci_job_mem_01.
_REPORT_COLUMNS: tuple[tuple[str, str], ...] = (
    ("peak_commit_mb", "INTEGER"),
    ("commit_limit_mb", "INTEGER"),
    ("peak_anon_mem_mb", "INTEGER"),
    ("cgroup_oom_kills", "INTEGER"),
    ("resource_os", "TEXT"),
    ("build_outcome", "TEXT"),
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so the table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _REPORT_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list.

    Referenced ONLY from [`downgrade`]: ``scripts/ci/check_coord_column_drops.py``
    excludes ``downgrade()`` and helpers reachable only from it.
    """
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _REPORT_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the six resource-report columns to coord.ci_job_observations."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(_add_columns(_TABLE))

    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.peak_commit_mb IS
            'Peak COMMIT CHARGE of the machine the job ran on, in MEGABYTES, '
            'from the job''s qontinui-resource-report annotation key '
            'peak_commit_mb (Windows GetPerformanceInfo CommitPeak, since boot; '
            'a hosted VM boots per job). Omitted - so NULL - on every Linux row '
            '(Linux keeps no commit peak) and on non-GitHub-hosted Windows '
            'runners (a long-lived host''s since-boot peak is not the job''s). '
            'NULL = UNKNOWN, NEVER 0: a 0 would assert '
            'a job that committed nothing. Compare against commit_limit_mb - '
            'commit exhaustion with RAM to spare is the failure mode (runner '
            'job 122032841168) no memory or swap column can express.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.commit_limit_mb IS
            'The commit limit the OS ENFORCED on the job''s machine, in '
            'MEGABYTES, from the report key commit_limit_mb (Windows '
            'GetPerformanceInfo CommitLimit = RAM + pagefile, so a job that '
            'sizes its own pagefile raises its own limit; Linux CommitLimit '
            'only under strict overcommit, else omitted because the kernel does '
            'not enforce it). A property of the JOB, not of the runner class. '
            'NULL = UNKNOWN, NEVER 0: no machine has a 0 MB commit limit, and '
            'a ratio consumer must still NULLIF(commit_limit_mb, 0).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.peak_anon_mem_mb IS
            'Peak ANONYMOUS memory of the job, in MEGABYTES, from the report '
            'key peak_rss_mb (cgroup v2 memory.stat anon: the memory the build '
            'holds, page cache EXCLUDED). NOT system-wide - which is why it is '
            'not written into peak_mem_used_mb, whose meaning is system-wide '
            'free -m - and NOT the cgroup memory.peak charge, which includes '
            'page cache and is not ingested. Linux only; may be absent on some '
            'jobs; NULL on Windows. NULL = UNKNOWN, NEVER 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.cgroup_oom_kills IS
            'Kernel OOM kills in the job''s cgroup, from the report key '
            'cgroup_oom_kills (memory.events oom_kill: the rise over a '
            'pre-build baseline, or on a github-hosted runner the cumulative '
            'count of the job''s own VM). Positive kernel evidence of an OOM '
            'kill. 0 IS A REAL READING (the counter was read and did not '
            'rise) and is distinct from NULL = UNKNOWN (not read, Windows, or a '
            'self-hosted reading with no baseline). Never coalesce NULL to 0: '
            'that fabricates an all-clear.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.resource_os IS
            'The OS the job''s resource report MEASURED: linux | windows | '
            'macos. Not derived from runner_labels, which name a requested '
            'label rather than the machine that answered. NULL = UNKNOWN (no '
            'report, or the emitter could not tell). Free text, no CHECK: '
            'coord validates app-side and writes NULL outside the vocabulary.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.build_outcome IS
            'Outcome of the job''s HEAVY compile-and-test work as its resource '
            'report states it: '
            'success | failure | cancelled | skipped. NOT the job''s '
            'conclusion - a job can fail a later step after its build '
            'succeeded - and it is what tells a requirement estimator whether '
            'the peaks on this row belong to a build that finished. NULL = '
            'UNKNOWN. Free text, no CHECK: coord validates app-side.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Remove the six resource-report columns. Exact reverse of upgrade().

    The TABLE and the ci_job_mem_01 columns are untouched.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_drop_columns(_TABLE))
    op.execute("SET LOCAL lock_timeout = DEFAULT")
