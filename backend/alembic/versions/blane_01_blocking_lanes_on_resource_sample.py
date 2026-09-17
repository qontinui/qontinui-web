"""coord.device_resource_samples — per-lane blocking-thread breakdown

Revision ID: blane_01
Revises: plan_library_06_scan_root_slug_census
Create Date: 2026-09-16

Phase 1 of plan
``2026-09-16-runner-blocking-lane-telemetry-to-coord``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the one
column the runner's publisher writes and coord's grader reads lands here, in
qontinui-web, and this revision must merge **before** the coord PR that reads
it. Hand-authored; ``alembic revision --autogenerate`` was not run and is
never run against ``coord.*``.

Why this column exists
=======================

Coord's dev-ops twin already publishes and grades the AGGREGATE OS thread
count for every device (``thread_count`` / ``active_terminal_sessions``,
``lasac_01``), and exports it as ``coord_device_resource_thread_count`` whose
own metric description states the diagnostic outright: *"threads climbing
while sessions stay flat is a LEAK, both climbing together is load"*. That
diagnostic was exercised live on 2026-09-15/16: OS thread count climbed
287->345 over roughly 21h while live session count stayed flat, and a manual
``/proc/<pid>/task/*/stat`` split showed ~146 blocking-pool threads spread
across ~20 distinct spawn-time clusters, none younger than 10 minutes despite
continuous session activity — the never-reclaimed leak signature.

Coord's twin can say a device is leaking. It cannot say **from where**. The
runner already computes the answer on every health-check tick and discards
it: ``wedge_diagnostics.rs``'s ``LaneTable`` counts in-flight tracked
blocking bodies per spawning-runtime name (``tokio-rt-worker`` = the main
Tauri runtime, ``fleet-pub-rt``, ``mcp-api-rt``, …), exposed as
``tracked_blocking_by_thread() -> BTreeMap<String, usize>``. Today its only
consumer is an on-incident capture that writes to a local
``wedge-diagnostics.jsonl.<date>`` file on the one machine that wedged —
never published anywhere, never reaching coord. Phase 2 of this plan wires
the same reading into the routine ~30s resource-sample publish loop instead,
so a leak like the one observed is attributable from coord alone — no
runner-side log spelunking, no ``/proc`` archaeology, no waiting for a wedge
that may never come. This revision adds the one column that loop needs to
land its reading in.

Not a new table, and not a new endpoint
========================================

Same argument ``lasac_01`` and ``drr_01`` already won on this table: this is
not a memory or disk figure either, and it rides the per-lane sample row
because it is a capacity fact about the same machine at the same instant,
published by the same 30s loop. A second table or a second endpoint for one
JSONB column would fork the sampling clock, the tenant scoping, the retention
prune and the freshness gate for no gain.

The lane semantics here are DIFFERENT from the table's own ``lane`` /
``lane_instance`` columns, and worth stating precisely so a reader does not
conflate them: ``coord.device_resource_samples.lane`` names a HOST / WSL VM /
container that a whole sample row describes. ``blocking_lanes``' keys name a
spawning-runtime WITHIN the publishing process (``tokio-rt-worker``,
``fleet-pub-rt``, ``mcp-api-rt``, …) — an orthogonal, finer-grained axis that
exists only on whichever row carries the process-scoped ``thread_count`` /
``active_terminal_sessions`` columns (``lasac_01``), i.e. the host lane. A
non-host lane row has no meaningful ``blocking_lanes`` value for the same
reason it has no meaningful ``thread_count``.

NULL is not zero, and NULL is not "nothing is wrong"
======================================================

This column is nullable with no default, inheriting ``fleet_res_tel_01``'s
rule verbatim, restated by ``lasac_01`` and ``drr_01`` for this same table:
*"A publisher reports what it can probe and omits what it cannot; a probe
that fails must degrade to NULL, never to a fabricated zero."* Every row a
runner build predating Phase 2 of the wiring plan sends omits this column
entirely, and that row must read **UNKNOWN**:

* ``blocking_lanes`` NULL means **not reported** — a runner build that
  predates this field, or a probe that failed on that cycle. It must NEVER be
  read as "no blocking lanes are active": that reading is exactly the
  maximally-idle inversion ``lasac_01`` already warned about for
  ``thread_count = 0``, applied to this column's own absence.
* ``blocking_lanes = {}`` means **reported, and every tracked lane's
  in-flight count was zero at sample time**. This is a real, informative
  fact — the publishing process is not carrying any tracked blocking work
  this cycle — and it is a DIFFERENT fact from NULL. Collapsing the two would
  destroy the exact distinction ``wind_down_sessions`` (``drr_01``) already
  established between "not probed" and "probed, nothing found."
* A non-empty object is ``{lane_name: in_flight_count}`` — zero or more
  entries, one per spawning-runtime that ``LaneTable`` is currently tracking
  with a nonzero in-flight count. (``tracked_blocking_by_thread()`` returns
  every tracked lane regardless of count in the runner's own map, but Phase 2
  of the wiring plan is the one that decides whether zero-count lanes are
  filtered before publish; this migration's contract is agnostic to that
  choice — either shape satisfies "NULL = not reported, {} = reported and
  empty, non-empty = per-lane counts.")

Freshness is the consumer's obligation, same as ``drr_01``: a sample older
than the fleet's freshness window must be read as **UNKNOWN**, never as the
last value observed.

JSONB, not a fixed column per lane
====================================

The plan's own design-decision table considered one INTEGER column per known
lane name against a single JSONB map, and resolved JSONB — following
``drr_01``'s own precedent as the first JSONB column on this table. The lane
set is not fixed fleet-wide: ``MAX_BLOCKING_LANES`` plus one overflow lane is
a per-process cap, not a registry, and new named runtimes have already been
added twice since the original ``LaneTable`` shipped (``fleet-pub-rt``,
``mcp-api-rt``). A fixed-column design would need a schema migration each
time a new runtime is named; a JSONB column absorbs that with none.

No CHECK on this column
=========================

Same reasoning ``lasac_01`` and ``drr_01`` gave: ingest is best-effort by
contract, and a CHECK violation fails the **whole INSERT**, discarding the
memory, disk, saturation and spawn-capacity metrics sharing that row. That
includes a length CHECK: the map is bounded app-side by construction
(``MAX_BLOCKING_LANES = 15`` plus one overflow lane, so at most 16 entries in
the runner's own tracked-lane table), the same split this table already draws
between its CHECKed ``lane`` and its free-text ``source``.

Retention — the same posture ``drr_01`` established, re-confirmed for this
column
=========================================================================

This is the second JSONB column on this table (``drr_01``'s
``wind_down_sessions`` was the first), so the same retention finding applies
and is restated rather than re-derived:

* **A prune exists.** ``device_resource_samples::prune_samples`` runs a
  global ``DELETE`` of every row whose ``sampled_at`` is older than the
  retention window (``PRUNE_SQL``), wired into coord's leader-gated pruner
  loop.
* **The window is 7 days by default**
  (``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``, ``DEFAULT_RETENTION_DAYS``
  falls back on a non-finite or non-positive value).
* **The per-tenant knob is stored but not consumed by the prune** —
  ``coord.fleet_runtime_policy.sample_retention_days`` narrows, never
  widens, so it does not change the bound below.

The per-row size of ``blocking_lanes`` is bounded at ≤16 entries of a short
lane name plus a small integer — well under 1KB even fully populated, an
order of magnitude smaller than ``wind_down_sessions``' worst case. In
practice the runner's own health-check numbers put the tracked count far
below the cap during normal operation (the 2026-09-16 incident that motivates
this plan observed roughly 20 clusters against a 512-slot blocking pool, not
16 concurrently-tracked lanes), so steady-state cost is negligible and the
table stays bounded by the prune above — it is a sample table, not a metrics
platform.

Degrade obligation on the coord side
======================================

Unchanged from ``lasac_01`` / ``drr_01``: the coord PR that reads this column
must degrade on a missing column (``pg_error::is_missing_schema_object``,
SQLSTATE 42703), so a coord deploy that lands ahead of this migration fails
open. Because that helper swallows 42703, a **typo'd column name idles
forever with no error** — ``blocking_lanes`` is an interface and the coord
side must match it exactly.

No new index
=============

Read on rows the anchor index (``idx_device_resource_samples_anchor_sampled``)
already selects — the newest sample per device. Nothing filters or orders
*by* this column. An extra index on an append-only table written every 30s
would cost maintenance on every insert to serve no query.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. The column is nullable with no default, so
the ADD is a catalogue update with no table rewrite.

``IF NOT EXISTS`` is **type-blind** — it matches on name alone, so a column of
the right name and wrong type makes the ADD a silent no-op and leaves the
wrong type in place, where the coord read will **panic** (a ``JSONB``
mismatch against ``serde_json::Value`` is the failure this note exists to
flag) rather than return a degradable SQLSTATE. Re-running ``upgrade()`` is
not a repair for that; fix it with an explicit ``ALTER COLUMN … TYPE`` in a
new revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "blane_01"
down_revision: str | Sequence[str] | None = "plan_library_06_scan_root_slug_census"  # fmt: skip
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the LOCAL CHAIN HEAD at authoring time
# (`scripts/ci/count_alembic_heads.py` -> HEAD_COUNT=1), resolved by running
# `alembic heads` in this checkout rather than hardcoded from any other
# document — the chain has already moved twice since the plan that requested
# this revision was vetted. If `alembic-heads-pr` reports `HEAD_COUNT=2` after
# this lands, re-point this line and `_PARENT_REVISION_ID` in
# `tests/test_blane_01_blocking_lanes_on_resource_sample_migration.py`
# together — that is the gate working as designed.

_TABLE = "coord.device_resource_samples"

# The one column, as data. Mirrors `lasac_01`'s `_SPAWN_CAPACITY_COLUMNS` /
# `drr_01`'s `_READINESS_COLUMNS` shape: this tuple is the interface the
# migration test pins (name and DDL type); the SQL below spells the same
# column as a STATIC string literal, and the test asserts the two agree.
#
# Why the SQL is not generated from this tuple: coord's merge-train migration
# classifier (`qontinui-coord` `crates/coord/src/pr_merge/migration_classifier.rs`,
# `classify_op`, the "execute" arm) extracts string literals from the
# argument of each execute call and rejects a call with none as "op.execute
# with no static SQL string literal (dynamic = unsafe)". A static literal is
# the only op.execute shape it can inspect at all.
_BLOCKING_LANE_COLUMNS: tuple[tuple[str, str], ...] = (("blocking_lanes", "JSONB"),)


def upgrade() -> None:
    """Add the blocking_lanes JSONB column to coord.device_resource_samples."""
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS blocking_lanes JSONB
        """
    )

    # The column comment carries what a name cannot: that NULL is UNKNOWN and
    # never "nothing is wrong", that {} is a real reported-empty fact distinct
    # from NULL, and what shape a non-empty object takes. The psql
    # describe-table output is where a human meets this schema; the docstring
    # above ships nowhere they will see it.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.blocking_lanes IS
            'Per-spawning-runtime in-flight tracked-blocking-body counts on '
            'the publishing runner at sample time, from '
            'wedge_diagnostics::tracked_blocking_by_thread() (plan '
            '2026-09-16-runner-blocking-lane-telemetry-to-coord). Meaningful '
            'only on the host lane, the same row that carries thread_count / '
            'active_terminal_sessions (lasac_01) — a non-host lane row has no '
            'value for it, for the same reason it has none for those. NULL = '
            'NOT REPORTED (a runner build that predates this field, or a '
            'probe that failed this cycle) and must NEVER be read as "no '
            'blocking lanes are active" — that inverts the signal exactly as '
            'a fabricated thread_count = 0 would. {} (empty object) = '
            'reported, and every tracked lane''s in-flight count was zero '
            'everywhere; NULL and {} are different facts and must stay '
            'distinct, the same discipline wind_down_sessions (drr_01) '
            'established. A non-empty object is {lane_name: '
            'in_flight_count}, e.g. {"tokio-rt-worker": 3, "fleet-pub-rt": '
            '1} — bounded to at most MAX_BLOCKING_LANES (15) plus one '
            'overflow lane by the runner''s own LaneTable, so no CHECK is '
            'needed here. Growth over time is bounded by coord '
            'prune_samples (default 7-day rolling window on sampled_at).'
        """
    )


def downgrade() -> None:
    """Drop the blocking_lanes column. Exact reverse of upgrade().

    The COMMENT goes with the column — a column comment has no independent
    existence to drop.

    The DROP lives in this function body as a static literal, out of
    `scripts/ci/check_coord_column_drops.py`'s upgrade-path scan (which skips
    the `downgrade()` body), and as a literal coord's migration classifier can
    read rather than a dynamic string.
    """
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS blocking_lanes
        """
    )
