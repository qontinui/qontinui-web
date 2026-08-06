"""coord.device_resource_samples — per-machine, per-lane resource sample oplog

Revision ID: fleet_res_tel_01
Revises: coord_sesscompl_04
Create Date: 2026-08-06

Wave 1 (§A1) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-02-fleet-resource-telemetry-and-ci-allocation.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
storage for coord's ``POST /coord/devices/:device_id/resource-sample`` handler
lands here, in qontinui-web, and this migration must merge BEFORE the coord PR
that reads these columns. Until it does, coord's readers degrade through
``pg_error::is_missing_relation`` rather than erroring.

What this table is for
======================

On 2026-08-02 a single PR's pre-commit hook failed four times on one machine
with four different root causes — OOM, a background-task timeout, a cargo
build-directory lock held by orphans, and finally ``STATUS_DLL_INIT_FAILED``
from resource exhaustion — while the *other* self-hosted runner sat online and
idle. Free RAM, commit charge, disk and build-slot occupancy all existed as
numbers on each machine; none was durable, none was queryable, and none was
visible in qontinui-web. There were already four independent samplers in the
fleet and three different memory floors measuring two different quantities.

This table is the single durable home those samples land in, so that the
dispatcher ranks on the same rows the dashboard renders. It is **a sample
table, not a metrics platform** — if the fleet ever outgrows it, a real TSDB
*replaces* it rather than this growing into one (plan §A1).

Shape: append-only oplog, mirroring ``coord.worktree_census``
=============================================================

Same push shape as ``twin_07_coord_worktree_census``: a device POSTs rows,
coord appends them, nothing is ever updated in place.

* **No unique constraint.** The same ``(device_id, lane, lane_instance)`` tuple
  recurs on every sample tick — that recurrence *is* the history. Deliberate,
  matching ``worktree_census`` / ``worktree_volume``.
* ``coord`` already exists (created by
  ``consolidation_phase1_01_infrastructure``); this migration does NOT
  ``CREATE SCHEMA``.
* ``tenant_id`` is **nullable** and carries NO foreign key to
  ``coord.tenants`` — matching ``coord.device_status`` and ``worktree_census``.
  A device push must not fail because tenant resolution has not happened yet.
* Every metric column is nullable. A publisher reports what it can probe and
  omits what it cannot; a probe that fails must degrade to NULL, never to a
  fabricated zero. Only ``device_id``, ``sampled_at``, ``lane`` and ``source``
  are NOT NULL — without those four the row is uninterpretable.

Why ``lane`` is mandatory
=========================

``.wslconfig`` on the ``msi`` host caps WSL at 16 GB of 31.7 GB physical, so
the host and WSL samplers measure **different pools**. A row without a lane
cannot be read, and the UI must never sum lanes into one "machine RAM" figure.
The pools are *coupled*, not disjoint: ``pageReporting=true`` means WSL returns
idle pages to Windows, so host free-commit already nets out WSL's live usage
and the WSL lane's spendable headroom is ``min(ceiling - used, host_free)``.
That coupling is the UI's problem (plan §C3), but it is the reason the lane
label is not optional here.

``lane`` gets a **named CHECK** over the closed set ``('host','wsl',
'container')`` — the house convention for small closed value sets on coord
tables (``coord.gates.verdict``, ``coord.prompt_documents.kind``,
``coord.session_compliance.verdict``). It is named so a later widening can
``DROP CONSTRAINT ck_device_resource_samples_lane`` rather than hunt a
generated name. The set is closed on purpose: ``lane`` names a **resource
pool**, and the fleet has exactly three.

Why ``lane_instance`` exists (and is separate from ``lane``)
============================================================

Each self-hosted host runs **two** GitHub Actions runner services inside the
*same* WSL VM — one for qontinui-coord, one for qontinui-web
(``qontinui-coord/.github/workflows/ci.yml:109-110``). One ``wsl`` lane row
therefore cannot say whose job is running, and ``ci_jobs_running`` on it is
ambiguous the moment both are busy. ``lane_instance`` disambiguates: the
Actions runner name (e.g. ``msi-wsl``), or the runner-instance name for the
runner/supervisor lanes.

**NULL means "the sole publisher for this lane"** — the runner/supervisor case.
It is a real value in the anchor, not an absence, which is why the anchor index
below must tolerate NULLs rather than exclude them.

Chosen over widening the ``lane`` vocabulary per publisher because the enum
names a resource *pool* and these two services share one pool; splitting it
would imply an isolation that does not exist.

Why the swap columns are first-class
====================================

``mem_available_bytes`` is the **wrong** headline metric under saturation, and
this fleet has already measured that. The CI sampler's own findings
(``qontinui-coord/.github/scripts/resource-sampler.sh:51-55``, ``:193-198``):
on a saturated box ``mem_used`` / ``mem_avail`` are pinned by the kernel
reserve and stay flat — **-13.5 +/- 11.2 M/day, indistinguishable from zero** —
while ``swap_used`` moved **+138.6 +/- 41.7 M/day** over the same runs.
Verbatim: *"Leading with mem_avail is what let a saturating metric read as an
all-clear."*

So ``swap_total_bytes`` / ``swap_used_bytes`` are stored as ordinary
first-class columns, not folded into a JSONB blob, because the swap **ratio**
is the primary ranking key for the CI dispatcher (plan §B1a) and the leading
column of the dashboard strip (§C1).

**Write-path obligation, since SQL cannot express it:** ``swap_total_bytes = 0``
is a legitimate reading (a box with swap disabled), so every consumer computing
``swap_used_bytes / swap_total_bytes`` must guard the divisor —
``NULLIF(swap_total_bytes, 0)`` — or a swapless machine divides by zero. No
CHECK forbids the zero, because forbidding it would make a swapless machine
unable to report at all.

Column-contract and write-path notes
====================================

* The column set is a **shared contract** with the coord Rust code — column
  names must not drift from this list.
* ``commit_total_bytes`` / ``commit_available_bytes`` are **Windows-only**
  (``Win32_OperatingSystem`` commit charge, the same number
  ``qontinui-supervisor``'s ``available_commit_bytes()`` and ``cargo-guard.sh``
  already read). NULL on Linux lanes.
* ``load_1m`` is NULL on the Windows host lane — Windows has no load average.
  It is ``REAL`` rather than an integer because a load average is fractional.
* ``sampled_at`` is the **publisher's** clock, defaulted to ``now()`` only as a
  fallback for a publisher that omits it. coord's freshness gate (plan §B1a
  excludes devices whose newest sample is older than
  ``ci_runner_freshness_secs``) therefore reads a device-supplied timestamp: a
  skewed device clock could read as permanently fresh or permanently stale.
  The ingest handler must clamp a future ``sampled_at`` to server ``now()``.
  Deliberately NOT a second ``received_at`` column — the plan's column contract
  is closed and coord's reader is written against exactly this list.
* ``source`` is deliberately **not** value-CHECKed, unlike ``lane``. Same split
  as ``coord.session_compliance``'s CHECKed ``verdict`` vs free-text ``reason``:
  ``lane`` is read for correctness (a mislabelled lane produces a
  confidently-wrong dashboard), whereas ``source`` is provenance whose
  vocabulary (``runner`` / ``supervisor`` / ``ci-step``, ...) is expected to
  grow as publishers are added. A CHECK there would force a migration per new
  publisher class.
* Ingest is **best-effort**: persist failures log WARN and the handler still
  returns 200 (the ``worktree_census`` contract). Nothing boots on this table.

Indexes
=======

Two, matching the two access patterns and nothing else:

1. ``(device_id, lane, lane_instance, sampled_at DESC)`` — "newest sample per
   anchor", which is what the CI dispatcher's ``LEFT JOIN LATERAL`` selects on
   and what the dashboard strip renders one row per. Every leading column is an
   equality predicate and ``sampled_at DESC`` supplies the ordering, so the
   ``LIMIT 1`` is an index-only descent. It also serves the
   ``DISTINCT ON (device_id, lane, lane_instance) ... ORDER BY ...,
   sampled_at DESC`` fleet-wide form: btree NULLs sort last under the default
   ASC, which is the same position ``DISTINCT ON``'s ORDER BY puts them in, so
   a NULL ``lane_instance`` anchor is found by the index rather than sorted.
2. ``(sampled_at)`` — the retention prune. Rolling window, default 7d, on the
   ``prune_stale()`` shape at ``qontinui-coord/src/status.rs:335-346``. The
   anchor index cannot serve this: ``sampled_at`` is its *fourth* column, so
   ``DELETE ... WHERE sampled_at < $1`` would seq-scan.

No third ``(device_id, sampled_at DESC)`` index. The one question it would
answer — "what is the newest sample of any lane for this device", the per-device
freshness gate — is already answered by taking the max over the per-anchor rows
the dispatcher joins anyway. A redundant index on an append-only table written
every 30 s buys nothing.

Idempotency: raw ``op.execute`` with ``CREATE TABLE / INDEX IF NOT EXISTS`` —
the house convention for coord tables (``coord_sesscompl_01``,
``coord_prompt_docs_01``, ``coord_policy_clauses_01``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_res_tel_01"
down_revision: str | Sequence[str] | None = "coord_sesscompl_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.device_resource_samples and its two indexes."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.device_resource_samples (
            id                     BIGSERIAL PRIMARY KEY,
            device_id              UUID NOT NULL,
            tenant_id              UUID,
            sampled_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- Which resource pool this row measures. Never summed across.
            lane                   TEXT NOT NULL,
            -- Which publisher within that pool; NULL = the sole publisher.
            lane_instance          TEXT,
            cpu_cores              INTEGER,
            -- NULL on the Windows host lane (no load average on Windows).
            load_1m                REAL,
            mem_total_bytes        BIGINT,
            mem_available_bytes    BIGINT,
            -- Windows-only: Win32_OperatingSystem commit charge.
            commit_total_bytes     BIGINT,
            commit_available_bytes BIGINT,
            -- The ranking signal. swap_total_bytes = 0 is legitimate; every
            -- ratio consumer must NULLIF the divisor.
            swap_total_bytes       BIGINT,
            swap_used_bytes        BIGINT,
            disk_total_bytes       BIGINT,
            disk_free_bytes        BIGINT,
            disk_mount             TEXT,
            build_slots_total      INTEGER,
            build_slots_busy       INTEGER,
            build_queue_depth      INTEGER,
            ci_jobs_running        INTEGER,
            -- Publisher class ('runner' | 'supervisor' | 'ci-step'); free
            -- text on purpose, see the module docstring.
            source                 TEXT NOT NULL,
            -- Named, because this is the set a future publisher would need to
            -- widen and widening needs DROP CONSTRAINT <name>.
            CONSTRAINT ck_device_resource_samples_lane
                CHECK (lane IN ('host', 'wsl', 'container'))
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.device_resource_samples IS
            'Append-only per-machine resource sample oplog. Never UPDATE or '
            'DELETE a row except by the retention prune. A sample table, not '
            'a metrics platform: if the fleet outgrows it, a real TSDB '
            'replaces it rather than this growing into one.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.lane IS
            'Which resource pool this row measures: host | wsl | container. '
            'Mandatory and load-bearing — host and WSL measure different '
            'pools (.wslconfig caps WSL well below physical), so a row '
            'without a lane is uninterpretable and lanes must NEVER be '
            'summed into one machine-RAM figure. The pools are coupled, not '
            'disjoint: with pageReporting=true, host free-commit already '
            'nets out WSL usage, so WSL spendable headroom is '
            'min(ceiling - used, host_free).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.lane_instance IS
            'Which publisher within the lane — the Actions runner name (each '
            'host runs TWO runner services in one WSL VM, one per repo) or '
            'the runner-instance name. NULL means the sole publisher for '
            'this lane, which is the runner/supervisor case. Without it, '
            'ci_jobs_running on the wsl lane is ambiguous the moment both '
            'services are busy.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.swap_used_bytes IS
            'The primary ranking signal, reported against swap_total_bytes '
            'as a ratio and never as a bare byte count. Under saturation '
            'mem_available is pinned by the kernel reserve and reads as an '
            'all-clear while swap_used is what actually moves (measured: '
            'mem_avail -13.5 +/- 11.2 M/day vs swap_used +138.6 +/- 41.7 '
            'M/day). Guard the divisor: swap_total_bytes = 0 is a real '
            'reading on a swapless box.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.sampled_at IS
            'The publisher clock, not the ingest clock; the DEFAULT now() is '
            'only a fallback for a publisher that omits it. coord freshness '
            'gates read this, so the ingest handler must clamp a future '
            'value to server now() or a skewed device reads as permanently '
            'fresh.'
        """
    )

    # 1. Newest sample per (device_id, lane, lane_instance) — the CI
    #    dispatcher's LATERAL and the dashboard strip's one-row-per-anchor.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_device_resource_samples_anchor_sampled
            ON coord.device_resource_samples
            (device_id, lane, lane_instance, sampled_at DESC)
        """
    )
    # 2. Retention prune: DELETE WHERE sampled_at < now() - retention.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_device_resource_samples_sampled_at
            ON coord.device_resource_samples (sampled_at)
        """
    )


def downgrade() -> None:
    """Drop coord.device_resource_samples. Reverse order of upgrade()."""
    op.execute("DROP INDEX IF EXISTS coord.idx_device_resource_samples_sampled_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_device_resource_samples_anchor_sampled")
    op.execute("DROP TABLE IF EXISTS coord.device_resource_samples")
