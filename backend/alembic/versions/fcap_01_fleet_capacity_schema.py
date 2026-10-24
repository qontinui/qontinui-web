"""coord capacity schema — the workload census, its off-switch, and the advice log

Revision ID: fcap_01
Revises: route_serving_method_idx_01
Create Date: 2026-10-08

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``,
as ONE revision with three parts. It was authored as three chained revisions
(``fcap_01`` .. ``fcap_03``) and consolidated on 2026-10-16 because
``Migration Reversal Tested`` exercises exactly one added migration per PR
(``scripts/ci/mrt_qualify.py`` condition (a)). The three parts share one
transaction (``env.py`` wraps the whole run in one), so they land together or
not at all, exactly as the chain did. Where a part's prose below says
``fcap_02`` or ``fcap_03`` it means that part of THIS revision.

Part 1 — coord.device_resource_samples — the workload class census and the GPU axes
===================================================================================

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``
(Decisions 2 and 3).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the two
columns the runner's publisher writes and coord's capacity analysis reads land
here, in qontinui-web, and this revision must merge **before** the coord PR that
reads them. Hand-authored; ``alembic revision --autogenerate`` was not run and is
never run against ``coord.*``.

Why these columns exist
-----------------------

The fleet measures what each machine HAS (memory, commit, disk, threads,
sockets — ``fleet_res_tel_01`` .. ``blane_01``) but not WHAT IS USING IT. On
2026-10-01 nobody could say from a fleet read which resource limited CI, or
that a 32 GB GPU sat idle. Two columns close that:

* ``workloads`` (JSONB) — the **class census**: one entry per workload class
  present on the lane at sample time, each
  ``{class, cpu_pct, rss_bytes, gpu_mem_bytes, proc_count}``. The class
  vocabulary is closed and versioned on the runner: ``claude_session``,
  ``gh_actions_job``, ``gh_actions_runner_idle``, ``cargo_build``,
  ``qontinui_runner``, ``supervisor``, ``docker``, ``wsl_vm``,
  ``gpu_inference``, ``browser``, ``other``. ``other`` carries its share, so
  unexplained load is visible rather than hidden. Eleven classes today; the
  runner bounds the array at 16 entries.

* ``gpu`` (JSONB) — the **dynamic** per-GPU axes, one entry per GPU:
  ``{index, util_pct, mem_used_bytes, power_w, temp_c}`` from
  ``nvidia-smi --query-gpu``. The STATIC inventory (vendor, model, VRAM,
  driver) is owned by ``coord.computers.gpus`` (the computers plan's ``gpus``
  amendment, web#1598, pending at authoring time) and is deliberately not
  duplicated here. Written on the **host
  lane only** (the one-writer rule of runner#1988): a ``wsl`` lane row carries
  ``gpu = NULL`` so a fleet VRAM sum never double-counts.

What is NEVER stored
--------------------

argv, cwd and the environment of a classified process never leave the host.
Command lines on this fleet carry tokens (a staged bearer header was once
published from a tempfile path), so the runner reads them in-process to pick a
class and emits **only the class**. There is no column for a process name, a
PID or a command line, and an entry with such a key is a publisher bug, not a
schema extension.

NULL, ``[]`` and zero are three different facts
------------------------------------------------

* ``NULL`` = **not measured / UNKNOWN**: a runner build that predates the
  census, a probe that failed this cycle, the census switched off
  (``workload_census_enabled = false`` or ``QONTINUI_WORKLOAD_CENSUS=0``), or —
  for ``gpu`` — a non-host lane, or a host with no NVIDIA tooling
  (``not_supported``). It must NEVER be read as "nothing is running" or "the
  GPU is idle"; that fabricates exactly the idle hardware the capacity advice
  exists to find.
* ``[]`` = measured, and nothing was there (no classified process; a host whose
  ``nvidia-smi`` answered with zero GPUs).
* A numeric ``0`` inside an entry is a measured zero.

No CHECK on either column — including the length bound
-----------------------------------------------------

Every JSONB column on this table declines a CHECK, for the reason ``drr_01``,
``blane_01``, ``lasac_01`` and ``fleet_res_tel_04`` each restate: ingest is
best-effort by contract (persist failures log WARN and the handler still
returns 200), and a CHECK violation fails the **whole INSERT**, discarding the
memory, disk, saturation, spawn-capacity and blocking-lane metrics sharing that
row. A runner that emitted a 17th class during an incident would lose the very
row that explains the incident. The bounds (≤ 16 census entries, ≤ 16 GPUs) are
enforced app-side — by the runner's census, and by coord's ingest door, which
must truncate rather than reject (a Phase 3 obligation) — the same split this table already draws between
its CHECKed ``lane`` and its free-text ``source``. The column comments state the
bounds so a reader meets them in ``\\d+``.

Retention — same posture as ``drr_01`` / ``blane_01``
-----------------------------------------------------

Both arrays are small and bounded (16 entries of five scalars each), and the
table's growth is bounded by coord ``prune_samples`` on ``sampled_at`` (default
7-day rolling window, ``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``). The
capacity analysis reads windows of samples per device through the existing
anchor index (``idx_device_resource_samples_anchor_sampled``); nothing filters
or orders *by* these columns, so no index is added — an extra index on an
append-only table written every 30 s would cost maintenance on every insert to
serve no query.

Degrade obligation on the coord side
------------------------------------

The coord PR that reads these columns must degrade on a missing column
(``pg_error::is_missing_schema_object``, SQLSTATE 42703) so a coord deploy that
lands ahead of this migration fails open. Because that helper swallows 42703, a
**typo'd column name idles forever with no error** — the two names below are an
interface and the coord side must match them exactly.

Idempotency and locking
-----------------------

Raw static ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables, and the only ``op.execute`` shape coord's
merge-train migration classifier can inspect (``classify_op``, the
``"execute"`` arm, rejects a dynamic argument). Both columns are nullable with
no default, so the ADD is a catalogue update with no table rewrite. The
``ACCESS EXCLUSIVE`` lock it takes is held until the alembic transaction
commits (``env.py`` wraps the whole run in one transaction), so
``lock_timeout`` bounds the wait to acquire it — the runner publishes into this
table every 30 s and a queued exclusive lock blocks every writer behind it. The
same bound ``coordprio_01`` uses.

``IF NOT EXISTS`` is **type-blind** — a column of the right name and wrong type
makes the ADD a silent no-op and leaves the wrong type in place, where the coord
read will **panic** (a JSONB mismatch against ``serde_json::Value``) rather
than return a degradable SQLSTATE. Re-running ``upgrade()`` is not a repair for
that; fix it with an explicit ``ALTER COLUMN … TYPE`` in a new revision.

Part 2 — coord.fleet_runtime_policy(+_versions).workload_census_enabled — the census off-switch
===============================================================================================

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``
(Decision 6: ships enabled, one off-switch per scope).

The workload class census (``fcap_01``'s ``workloads`` column) and the GPU axes
publish by default ``[policy: capability-ships-enabled]``. The tenant-scope
off-switch is this one column on the ``fleet_resources`` domain of
``coord.fleet_runtime_policy``; the per-machine one is the runner kill switch
``QONTINUI_WORKLOAD_CENSUS=0``. The never-argv rule (``fcap_01``) is the
safeguard and is a separate mechanism — switching the census off is a choice,
not the privacy control.

Both tables, together
---------------------

Fleet-resource controls are typed columns on the parent AND on
``coord.fleet_runtime_policy_versions``, widened in the same revision — the
rule the versions table's own ``COMMENT ON TABLE`` states and that
``fleet_res_tel_03`` and ``sess_guard_01`` follow: a snapshot table that can
hold less than its parent is an audit trail that lies while still reporting as
versioned. coord composes the parent SELECT, the parent UPSERT and the snapshot
INSERT from one ``CONTROL_COLS`` constant (``fleet_policy.rs``), bound
**positionally**, so the coord PR tail-appends ``workload_census_enabled`` to
it; the column order here does not matter to that binding, only the name does.

Tri-state, and NULL means ON
----------------------------

``BOOLEAN NULL`` with no DEFAULT:

* ``NULL`` = no override — the census runs (the shipped default). Every
  pre-existing policy row and every snapshot written before this revision reads
  NULL, which is the honest record that no off-switch could have been in force.
* ``true`` = explicitly on (same behaviour as NULL, recorded as a decision).
* ``false`` = the tenant switched the census off; runners publish
  ``workloads = NULL`` and ``gpu = NULL`` (UNKNOWN), never ``[]``.

A ``DEFAULT true`` would erase the distinction between "never decided" and
"decided on", and a ``NOT NULL`` would force a backfill of every snapshot row
— rewriting immutable history. Neither is wanted.

Degrade obligation on the coord side
------------------------------------

The coord PR that tail-appends ``workload_census_enabled`` to ``CONTROL_COLS``
(qontinui-coord ``crates/coord/src/fleet_policy.rs``) must:

(a) add the name to the **refuse-on-miss** set next to ``SESSION_FLOOR_COLS``
    (``is_session_floor_miss`` / ``session_floor_miss_matches``, around
    ``fleet_policy.rs:420-427`` at authoring time) — or to a generalised
    tail-column set that replaces it — so a 42703 naming this column returns
    **503**. Left to the generic degrade path, a coord deploy that lands ahead
    of this revision would silently degrade every policy read to
    ``controls: null`` and the write path to an identity-only snapshot (around
    ``fleet_policy.rs:850-856`` and ``:1776-1784``) — a versions row that
    records a write while dropping every control it carried, i.e. an audit
    trail that lies.
(b) merge only after this revision has been applied
    ``[policy: alembic-sole-authorship]``.

Idempotency and locking
-----------------------

Raw static ``op.execute`` with ``ADD COLUMN IF NOT EXISTS``; every statement is
a static literal because coord's merge-train migration classifier rejects a
dynamic ``op.execute`` argument (``sess_guard_01`` predates that and generates
its snapshot comments with f-strings; this revision does not). A nullable
column with no default is a catalogue-only change. ``lock_timeout`` bounds the
wait for the ``ACCESS EXCLUSIVE`` lock, which is held until the alembic
transaction commits. PostgreSQL DDL is transactional and ``env.py`` runs the
whole upgrade in one transaction, so both tables gain the column or neither
does.

Part 3 — coord.capacity_advice_log — every capacity recommendation, and what happened next
==========================================================================================

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``
(Decision 4, and the store Phase 6 closes the loop in).

coord's pure ``capacity_advice(window) -> Vec<Advice>`` emits typed, sized,
explainable recommendations (``add_ci_runner_service``, ``restore_runner``,
``acquire_host``, ``use_idle_hardware``, ``move_workload``, ``hosted_ceiling``,
``measure_first``). This table is the append-only record of every advice
emitted, whether and by whom it was acted on, and the **realised** effect
measured afterwards — so a wrong prediction is falsifiable rather than
forgotten. coord authors zero DDL ``[policy: alembic-sole-authorship]``; this
revision lands before the coord PR that writes it, and coord must degrade on a
missing relation (SQLSTATE 42P01) until it does.

Column contract — shared with coord's Rust code
-----------------------------------------------

``id UUID PRIMARY KEY DEFAULT gen_random_uuid()``.

``tenant_id UUID NOT NULL`` — from coord's verified tenant context. **No FK**,
the same choice ``spawnadm_01`` made for its ledger: an append-only log must
never fail an insert for referential bookkeeping.

``emitted_at TIMESTAMPTZ NOT NULL DEFAULT now()``.

``kind TEXT NOT NULL`` — deliberately **not** CHECK-constrained. The v1 set is
listed above, and the plan already expects it to grow (``measure_first`` was
added during vetting); coord and this schema deploy independently, so a CHECK
would turn every new advice kind into a lockstep migration and, worse, a
failed log write. coord owns the vocabulary.

``target TEXT NOT NULL`` — what the advice is about: a repo, a computer, a pool.
Text, because the target kinds differ per advice kind.

``computer_id UUID NULL`` — **no FK yet**. ``coord.computers`` is created by
web#1598, which has not landed; the FK is added by a later revision once it
has. Until then this is an unenforced reference and readers must tolerate an
id that resolves to nothing.

``window_secs INTEGER NULL`` — the analysis window the advice was computed over.

``bottleneck``, ``evidence``, ``expected_effect`` (``JSONB NULL``) — the
bottleneck metric with its value and window; the evidence (row counts, sample
coverage, links to the reads it came from); the expected effect **with its
arithmetic** (queue minutes saved per day, lands per day). JSONB because each
advice kind carries a different shape; coord's ``Advice`` type is the schema.

``confidence TEXT NOT NULL`` — CHECK ``high`` | ``medium`` | ``low`` |
``unknown``. ``unknown`` is a value (Decision 5), not an absence: an advice
whose deciding input is UNKNOWN is recorded as such, never dropped. CHECKed,
unlike ``kind``, because the plan fixes this set and a consumer ranks on it.

``actor TEXT NOT NULL`` — CHECK ``agent`` | ``operator``: who is expected to act.

``acted_on_at TIMESTAMPTZ NULL`` / ``acted_by TEXT NULL`` — set when the advice
was acted on. NULL = not acted on (yet), never "rejected"; this table records
no rejection state.

``realised_effect JSONB NULL`` / ``realised_at TIMESTAMPTZ NULL`` — Phase 6's
measured outcome of an acted-on advice, comparable field-for-field with
``expected_effect``. NULL = not yet measured.

Append-only, and what that means for UPDATE
-------------------------------------------

Rows are never deleted except by retention, and the advice columns are never
rewritten. The four outcome columns (``acted_on_at``, ``acted_by``,
``realised_effect``, ``realised_at``) are the ONLY columns that are UPDATEd,
each set once, when the event happens. That is enforced by coord's writer, not
by a trigger — the same posture every other coord ledger takes.

Retention — 90 days, handled by coord
-------------------------------------

The plan bounds this table at 90 days. Pruning is coord's job (a periodic
``DELETE … WHERE emitted_at < now() - interval '90 days'``). Emission is a
handful of advices per analysis window per tenant, so the table stays small and
a sequential scan serves the prune; no dedicated ``emitted_at`` index is added
for it.

Index
-----

``ix_capacity_advice_log_tenant_emitted_at (tenant_id, emitted_at DESC)`` — the
tenant feed, newest first: the console's Capacity section and the
``coord_query_fleet_capacity`` history read.

Grants
------

No per-table GRANT and no RLS: the ``coord`` schema's privileges are granted at
the schema level, and no sibling ``coord.*`` table migration (``mdroles_01``,
``cmtland_01``, ``spawnadm_01``) issues per-table grants.

Shape
-----

HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here. Raw,
static, ``coord.``-qualified ``op.execute`` with ``IF NOT EXISTS`` — the house
convention for coord tables, and the only shape coord's merge-train migration
classifier can inspect. Pure DDL, no app imports.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fcap_01"
down_revision: str | Sequence[str] | None = "route_serving_method_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the LOCAL CHAIN HEAD (`scripts/ci/count_alembic_heads.py` ->
# HEAD_COUNT=1, HEAD=route_serving_method_idx_01, re-pointed 2026-10-16). The
# head can move before this lands; if `alembic-heads-pr` reports HEAD_COUNT=2,
# re-point this line onto the new head — the migration test reads it at
# runtime, so nothing else needs to move. That is the gate working as designed.

# Part 1's table and its two columns, as data. Mirrors `blane_01`'s
# `_BLOCKING_LANE_COLUMNS`: these tuples are the interface the migration test
# pins (name and DDL type); the SQL below spells the same columns as STATIC
# string literals, and the test asserts the two agree. Not generated from the
# tuples, because coord's merge-train migration classifier can only inspect a
# static literal.
_TABLE = "coord.device_resource_samples"

_CAPACITY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("workloads", "JSONB"),
    ("gpu", "JSONB"),
)

# Part 2's one column, on BOTH policy tables. Same shape as
# `fleet_res_tel_03`'s `_CONTROL_COLUMNS` and `sess_guard_01`'s
# `_SESSION_FLOOR_COLUMNS`.
_CENSUS_CONTROL_COLUMNS: tuple[tuple[str, str], ...] = (
    ("workload_census_enabled", "BOOLEAN"),
)

_POLICY_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)


def upgrade() -> None:
    """Parts 1-3: the census columns, the census off-switch, the advice log."""
    # Bound the wait for each ACCESS EXCLUSIVE lock: the runner publishes into
    # device_resource_samples every 30 s and a queued exclusive lock blocks
    # every writer behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # Part 1 — coord.device_resource_samples.workloads / gpu.
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS workloads JSONB,
            ADD COLUMN IF NOT EXISTS gpu JSONB
        """
    )

    # Part 2 — workload_census_enabled on the parent AND the versions table.
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            ADD COLUMN IF NOT EXISTS workload_census_enabled BOOLEAN
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            ADD COLUMN IF NOT EXISTS workload_census_enabled BOOLEAN
        """
    )

    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so put it back or it leaks into every later revision.
    op.execute("SET LOCAL lock_timeout = DEFAULT")

    # The column comments carry what a name cannot: that NULL is UNKNOWN and
    # never "idle", that [] is a measured-empty fact distinct from NULL, the
    # closed class vocabulary, the bound, and that argv/cwd/env are never
    # stored. The psql describe-table output is where a human meets this
    # schema; the docstring above ships nowhere they will see it.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.workloads IS
            'Workload class census on this lane at sample time (plan '
            '2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware, '
            'Decision 2): a JSON array, one entry per class present, each '
            '{class, cpu_pct, rss_bytes, gpu_mem_bytes, proc_count}. The class '
            'vocabulary is CLOSED and versioned: claude_session, '
            'gh_actions_job, gh_actions_runner_idle, cargo_build, '
            'qontinui_runner, supervisor, docker, wsl_vm, gpu_inference, '
            'browser, other — other carries its share so unexplained load '
            'stays visible. Bounded to at most 16 entries app-side (runner '
            'census + coord ingest), NOT by a CHECK: a CHECK violation would '
            'fail the whole best-effort INSERT and discard every other metric '
            'on the row. argv, cwd and env NEVER leave the host — only the '
            'class is emitted; an entry carrying a process name, PID or '
            'command line is a publisher bug. NULL = NOT MEASURED / UNKNOWN '
            '(older runner, failed probe, or census switched off by '
            'workload_census_enabled = false or QONTINUI_WORKLOAD_CENSUS=0) '
            'and must NEVER be read as "nothing is running"; [] = measured, no '
            'classified process. A gpu_mem_bytes of NULL inside an entry is '
            'unmeasured, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.gpu IS
            'Dynamic per-GPU axes at sample time (plan '
            '2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware, '
            'Decision 3): a JSON array, one entry per GPU, each {index, '
            'util_pct, mem_used_bytes, power_w, temp_c}, from nvidia-smi '
            '--query-gpu. The STATIC inventory (vendor, model, VRAM, driver) '
            'lives in coord.computers.gpus (web#1598, pending) and is not '
            'duplicated here. Written '
            'on the HOST lane only (one writer): a wsl lane row carries NULL, '
            'so a fleet VRAM sum never double-counts. Bounded to at most 16 '
            'entries app-side, NOT by a CHECK (same reason as workloads). NULL '
            '= NOT MEASURED / UNKNOWN (non-host lane, no NVIDIA tooling = '
            'not_supported, older runner, failed probe, census off) and must '
            'NEVER be read as an idle GPU; [] = nvidia-smi answered with zero '
            'GPUs. A NULL axis inside an entry is unmeasured, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.workload_census_enabled IS
            'Tenant off-switch for the workload class census and GPU axes on '
            'coord.device_resource_samples (workloads, gpu; revision fcap_01), '
            'on the fleet_resources domain. NULL = no override, the census '
            'RUNS (it ships enabled); true = explicitly on; false = switched '
            'off, and runners then publish workloads = NULL and gpu = NULL '
            '(UNKNOWN), never []. The per-machine switch is QONTINUI_WORKLOAD_CENSUS=0 on the '
            'runner. Not the privacy control: argv, cwd and env never leave '
            'the host whatever this says.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy_versions.workload_census_enabled IS
            'Snapshot of coord.fleet_runtime_policy.workload_census_enabled — '
            'see that column for its meaning and for why NULL is ON, not off. '
            'Snapshot rows written BEFORE revision fcap_01 carry NULL here: the '
            'column did not exist, so no off-switch could have been in force, '
            'and NULL is the honest record of that history rather than a gap '
            'to be backfilled. Immutable: never UPDATE or DELETE a row here.'
        """
    )

    # Part 3 — coord.capacity_advice_log and its tenant feed index. No rows.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.capacity_advice_log (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            emitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            kind             TEXT NOT NULL,
            target           TEXT NOT NULL,
            computer_id      UUID NULL,
            window_secs      INTEGER NULL,
            bottleneck       JSONB NULL,
            evidence         JSONB NULL,
            expected_effect  JSONB NULL,
            confidence       TEXT NOT NULL,
            actor            TEXT NOT NULL,
            acted_on_at      TIMESTAMPTZ NULL,
            acted_by         TEXT NULL,
            realised_effect  JSONB NULL,
            realised_at      TIMESTAMPTZ NULL,
            CONSTRAINT ck_capacity_advice_log_confidence
                CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
            CONSTRAINT ck_capacity_advice_log_actor
                CHECK (actor IN ('agent', 'operator'))
        )
        """
    )
    # Tenant feed, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_capacity_advice_log_tenant_emitted_at
            ON coord.capacity_advice_log (tenant_id, emitted_at DESC)
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.capacity_advice_log IS
            'Append-only record of every capacity recommendation coord''s '
            'capacity_advice() emitted (plan '
            '2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware), '
            'whether it was acted on, and the realised effect measured '
            'afterwards, so a wrong prediction is falsifiable. Only the four '
            'outcome columns (acted_on_at, acted_by, realised_effect, '
            'realised_at) are ever UPDATEd, each set once; nothing else is '
            'rewritten. Retained 90 days by coord on emitted_at. Written by '
            'coord only.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.kind IS
            'Advice kind (add_ci_runner_service, restore_runner, acquire_host, '
            'use_idle_hardware, move_workload, hosted_ceiling, measure_first, '
            '…). Deliberately NOT CHECKed: coord owns the vocabulary and it '
            'grows; a CHECK would make each new kind a lockstep migration and '
            'a failed log write.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.computer_id IS
            'The coord.computers row the advice targets, when it targets one. '
            'NO FOREIGN KEY YET: coord.computers is created by web#1598 and the '
            'FK is added by a later revision once it lands. Until then a '
            'reader must tolerate an id that resolves to nothing. NULL = the '
            'advice does not target a single computer.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.confidence IS
            'high | medium | low | unknown, derived from sample coverage and '
            'model fit. unknown is a VALUE, not an absence: an advice whose '
            'deciding input is UNKNOWN is recorded with it, never dropped.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.expected_effect IS
            'Predicted effect WITH its arithmetic (e.g. queue p90 minutes '
            'saved per day, lands per day), shaped per advice kind by coord''s '
            'Advice type. Compared field-for-field with realised_effect. NULL '
            '= no effect could be sized (never a predicted zero).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.acted_on_at IS
            'When the advice was acted on (by acted_by). NULL = not acted on '
            'yet — NOT "rejected"; this table records no rejection state. Set '
            'once.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.capacity_advice_log.realised_effect IS
            'Measured effect of an acted-on advice (Phase 6), in the shape of '
            'expected_effect, stamped at realised_at. NULL = not yet measured, '
            'never a realised zero. Set once.'
        """
    )


def downgrade() -> None:
    """Exact reverse of upgrade(): Part 3, then Part 2, then Part 1.

    Comments go with their columns and table — a comment has no independent
    existence to drop. Any recorded advice goes with the table.

    Every DROP lives in this function body as a static literal, out of
    `scripts/ci/check_coord_column_drops.py`'s upgrade-path scan (which skips
    the `downgrade()` body), and as a literal coord's migration classifier can
    read rather than a dynamic string.
    """
    # Same bounded lock wait as upgrade(): the runner keeps publishing into
    # device_resource_samples, and a queued ACCESS EXCLUSIVE lock blocks every
    # writer.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # Part 3. DROP TABLE takes both CHECK constraints and every comment with it.
    op.execute("DROP INDEX IF EXISTS coord.ix_capacity_advice_log_tenant_emitted_at")
    op.execute("DROP TABLE IF EXISTS coord.capacity_advice_log")

    # Part 2 — both tables again: leaving the snapshot column behind after
    # removing the parent's would produce a versions table that can hold
    # payload the parent cannot.
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            DROP COLUMN IF EXISTS workload_census_enabled
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            DROP COLUMN IF EXISTS workload_census_enabled
        """
    )

    # Part 1.
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS gpu,
            DROP COLUMN IF EXISTS workloads
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
