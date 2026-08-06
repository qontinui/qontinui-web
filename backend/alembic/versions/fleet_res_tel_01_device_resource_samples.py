"""coord.device_resource_samples — per-machine, per-lane resource sample oplog

Revision ID: fleet_res_tel_01
Revises: coord_sesscompl_04
Create Date: 2026-08-06

Wave 1 (§A1) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-02-fleet-resource-telemetry-and-ci-allocation.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
storage for coord's ``POST /coord/devices/:device_id/resource-sample`` handler
lands here, in qontinui-web, and must merge BEFORE the coord PR that reads or
writes it.

**No coord code touches this table yet** — ``device_resource_samples`` appears
nowhere on coord's ``origin/main`` as of this revision. There is therefore
nothing to degrade today; the obligation runs the other way, on the coord PR
that follows: its read must degrade on a missing relation
(``pg_error::is_missing_schema_object``, or the module-local
``is_missing_relation`` that ``src/ci_dispatch.rs:122`` already uses for
exactly this at eleven call sites) so a coord deploy that lands ahead of this
migration fails open rather than erroring.

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
  See "Retention" below for what that nullability costs the prune.
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

Why ``lane_instance`` exists, and why the anchor COALESCEs it
=============================================================

Each self-hosted host runs **two** GitHub Actions runner services inside the
*same* WSL VM — one for qontinui-coord, one for qontinui-web
(``qontinui-coord/.github/workflows/ci.yml:109-110``). One ``wsl`` lane row
therefore cannot say whose job is running, and ``ci_jobs_running`` on it is
ambiguous the moment both are busy. ``lane_instance`` disambiguates: the
Actions runner name (e.g. ``msi-wsl``), or the runner-instance name for the
runner/supervisor lanes.

NULL means "the sole publisher for this lane" — the runner/supervisor case,
which is the *common* one. That is precisely why the anchor cannot be spelled
``lane_instance = $3``: SQL equality never matches NULL, so a consumer written
that way would silently return no row for every runner and supervisor sample.
``IS NOT DISTINCT FROM`` has the right semantics but PostgreSQL cannot use it
as a btree index qual with a parameter, so it would cost the index descent.

**Resolved the way the sibling table already resolved it.**
``uq_fleet_runtime_policy_scope`` (``fleet_policy_01_coord_fleet_runtime_policy``
``:91-97``, rationale ``:29-33``) collapses its own nullable ``scope_key``
through ``COALESCE(scope_key, '')`` for the identical reason. So the anchor
index below is built on ``COALESCE(lane_instance, '')``, and **every consumer
must spell the anchor the same way**:

    WHERE device_id = $1 AND lane = $2 AND COALESCE(lane_instance, '') = $3

A ``CHECK`` forbids an empty-string ``lane_instance``, so the collapse is
unambiguous by construction rather than by a coord-side normalisation
convention nothing enforces: ``''`` can never be stored, therefore
``COALESCE(lane_instance, '') = ''`` means exactly "the sole publisher".

``lane_instance`` was chosen over widening the ``lane`` vocabulary per
publisher because the enum names a resource *pool* and these two services share
one pool; splitting it would imply an isolation that does not exist.

Why the swap columns are first-class
====================================

``mem_available_bytes`` is the **wrong** headline metric under saturation, and
this fleet has already measured that. The CI sampler's own header
(``qontinui-coord/.github/scripts/resource-sampler.sh:50-55``):

    swap_used leads the table deliberately. On a saturated box mem_used and
    mem_avail are PINNED by the kernel reserve and stay flat no matter how the
    pressure grows — measured at -13.5 +/- 11.2 M/day, indistinguishable from
    zero, while swap moved +138.6 +/- 41.7 M/day over the same runs. Leading
    with mem_avail is what let a saturating metric read as an all-clear.

(The reducer at ``:190-199`` restates that finding in its own words and cites
plan ``2026-07-28-coord-ci-memory-headroom-sizing-review`` §3.1 as the source
of the measurements; the wording above is the verbatim one.)

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

Column-contract notes
=====================

* The column set is a **shared contract** with the coord Rust code that will
  read it. It is exactly plan §A1's list, including the ``lane_instance``
  amendment; column names must not drift from it.
* ``commit_total_bytes`` / ``commit_available_bytes`` are **Windows-only**
  (``Win32_OperatingSystem`` commit charge, the same number
  ``qontinui-supervisor``'s ``available_commit_bytes()`` and ``cargo-guard.sh``
  already read). NULL on Linux lanes.
* ``load_1m`` is NULL on the Windows host lane — Windows has no load average.
  It is ``REAL`` rather than an integer because a load average is fractional.
* ``sampled_at`` is the **ingest** clock: coord stamps it with server ``now()``
  on receipt, exactly as the ``worktree_census`` handler stamps ``observed_at``.
  Publishers do **not** supply it.

  This is deliberate and it is what makes plan §B1a's freshness gate
  trustworthy. A publisher-supplied timestamp would put a device's own clock
  inside the gate: a device running fast reads as permanently fresh, and one
  running slow reads as permanently stale — and with no second timestamp to
  compare against, a lagging clock is **indistinguishable from a dead
  publisher**, which is the absence-read-as-a-state failure §C3 exists to
  prevent. A server stamp removes both directions at the cost of network
  latency, and there is no second ``received_at`` column to keep in sync.

  The cost this does impose, stated so a publisher does not trip on it: a
  publisher that *batches* samples and POSTs them together would have every row
  in the batch stamped at the same instant. Publishers must POST each sample as
  they take it, which is already how ``resource-sampler.sh`` is written.
* ``source`` is deliberately **not** value-CHECKed, unlike ``lane``. Same split
  as ``coord.session_compliance``'s CHECKed ``verdict`` vs free-text ``reason``:
  ``lane`` is read for correctness (a mislabelled lane produces a
  confidently-wrong dashboard), whereas ``source`` is provenance whose
  vocabulary (``runner`` / ``supervisor`` / ``ci-step``, ...) is expected to
  grow as publishers are added. A CHECK there would force a migration per new
  publisher class.
* Ingest is **best-effort**: persist failures log WARN and the handler still
  returns 200 (the ``worktree_census`` contract). Nothing boots on this table.

Retention
=========

A rolling window, default 7 days. Plan §D1 makes the window configurable per
tenant (``sample_retention_days``), which interacts badly with a nullable
``tenant_id``, so the prune contract is stated here rather than left to be
rediscovered:

**The prune MUST run a global pass keyed on ``sampled_at`` alone** —
``DELETE FROM coord.device_resource_samples WHERE sampled_at < now() - <fleet
default>``. Rows pushed before tenant resolution have ``tenant_id IS NULL`` and
belong to no tenant, so a purely per-tenant prune would never reach them and
this table would grow without bound in exactly the place its docstring promises
a bounded window. A per-tenant ``sample_retention_days`` is then a **narrowing**
second pass (``WHERE tenant_id = $1 AND sampled_at < $2``) which can only
shorten a tenant's window, never lengthen it past the global bound — and which
rides the same ``sampled_at`` index, since the global pass keeps the table small
enough that the extra ``tenant_id`` filter is cheap.

The shape to copy is ``prune_stale()`` at ``qontinui-coord/src/status.rs``
``:335-348`` — a 5-minute ``tokio::interval`` whose failures propagate to the
caller to log and retry on the next tick. Note it is only the *shape*: that
function prunes ``coord.device_status`` on a hardcoded ``interval '1 hour'``,
whereas this window is configurable and much longer.

Indexes
=======

Two, matching the two access patterns and nothing else:

1. ``(device_id, lane, COALESCE(lane_instance, ''), sampled_at DESC)`` —
   "newest sample per anchor", which is what the CI dispatcher's
   ``LEFT JOIN LATERAL`` selects on and what the dashboard strip renders one row
   per. Every leading column is an equality predicate and ``sampled_at DESC``
   supplies the ordering, so the ``LIMIT 1`` is a single index descent plus one
   heap fetch (an Index Scan, not an Index Only Scan — the dispatcher selects
   ``swap_*`` / ``commit_*``, which are not in the index).

   Emitted as raw SQL because ``op.create_index`` cannot express ``COALESCE``,
   the same reason and the same precedent as
   ``uq_fleet_runtime_policy_scope``.

   It also serves the fleet-wide
   ``DISTINCT ON (device_id, lane, COALESCE(lane_instance, '')) ... ORDER BY
   ..., sampled_at DESC`` form, whose ordering is the index's own.

2. ``(sampled_at)`` — the retention prune, both passes. The anchor index cannot
   serve it: ``sampled_at`` is its *fourth* column, so
   ``DELETE ... WHERE sampled_at < $1`` would seq-scan.

Measured (60 200 rows, one stale anchor — the drained/offline device the
freshness gate has to find): with the anchor index, 4 buffers / 0.055 ms;
without it, the planner falls back to a backward scan of the ``sampled_at``
index and pays 1392 buffers / 30 ms, discarding 60 000 rows by filter.

No third ``(device_id, sampled_at DESC)`` index. The one question it would
answer — "what is the newest sample of any lane for this device", the
per-device freshness gate — is already answered by taking the max over the
per-anchor rows the dispatcher joins anyway. A redundant index on an
append-only table written every 30 s buys nothing.

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
            -- Stamped by coord on receipt, never supplied by the publisher.
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
                CHECK (lane IN ('host', 'wsl', 'container')),
            -- Makes the anchor's COALESCE(lane_instance, '') unambiguous by
            -- construction: '' can never be stored, so it can only ever mean
            -- "the sole publisher for this lane".
            CONSTRAINT ck_device_resource_samples_lane_instance_nonempty
                CHECK (lane_instance IS NULL OR lane_instance <> '')
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.device_resource_samples IS
            'Append-only per-machine resource sample oplog. Never UPDATE or '
            'DELETE a row except by the retention prune, which must include a '
            'GLOBAL pass keyed on sampled_at alone — tenant_id is nullable, '
            'so a purely per-tenant prune never reaches rows pushed before '
            'tenant resolution. A sample table, not a metrics platform: if '
            'the fleet outgrows it, a real TSDB replaces it rather than this '
            'growing into one.'
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
            'this lane, which is the runner/supervisor case and the common '
            'one. Anchor on COALESCE(lane_instance, '''') — NEVER '
            'lane_instance = $n, which silently matches no NULL row.'
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
            'The INGEST clock — stamped by coord with server now() on '
            'receipt, as worktree_census stamps observed_at. Publishers do '
            'not supply it. A publisher-supplied timestamp would put the '
            'device clock inside the freshness gate, where a lagging clock '
            'is indistinguishable from a dead publisher. Publishers must '
            'POST each sample as they take it; a batched POST stamps every '
            'row in the batch at one instant.'
        """
    )

    # 1. Newest sample per (device_id, lane, lane_instance) — the CI
    #    dispatcher's LATERAL and the dashboard strip's one-row-per-anchor.
    #    COALESCE collapses the nullable lane_instance so the NULL ("sole
    #    publisher") anchor is an indexable equality rather than an
    #    unindexable IS NOT DISTINCT FROM. Raw SQL: op.create_index cannot
    #    express COALESCE (same precedent as uq_fleet_runtime_policy_scope).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_device_resource_samples_anchor_sampled
            ON coord.device_resource_samples
            (device_id, lane, COALESCE(lane_instance, ''), sampled_at DESC)
        """
    )
    # 2. Retention prune: the global pass, and the per-tenant narrowing pass.
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
