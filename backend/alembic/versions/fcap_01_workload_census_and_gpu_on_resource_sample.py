"""coord.device_resource_samples — the workload class census and the GPU axes

Revision ID: fcap_01
Revises: policy_rules_agent_name_uq_01
Create Date: 2026-10-08

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``
(Decisions 2 and 3).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the two
columns the runner's publisher writes and coord's capacity analysis reads land
here, in qontinui-web, and this revision must merge **before** the coord PR that
reads them. Hand-authored; ``alembic revision --autogenerate`` was not run and is
never run against ``coord.*``.

Why these columns exist
=======================

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
====================

argv, cwd and the environment of a classified process never leave the host.
Command lines on this fleet carry tokens (a staged bearer header was once
published from a tempfile path), so the runner reads them in-process to pick a
class and emits **only the class**. There is no column for a process name, a
PID or a command line, and an entry with such a key is a publisher bug, not a
schema extension.

NULL, ``[]`` and zero are three different facts
================================================

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
=====================================================

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
=====================================================

Both arrays are small and bounded (16 entries of five scalars each), and the
table's growth is bounded by coord ``prune_samples`` on ``sampled_at`` (default
7-day rolling window, ``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``). The
capacity analysis reads windows of samples per device through the existing
anchor index (``idx_device_resource_samples_anchor_sampled``); nothing filters
or orders *by* these columns, so no index is added — an extra index on an
append-only table written every 30 s would cost maintenance on every insert to
serve no query.

Degrade obligation on the coord side
====================================

The coord PR that reads these columns must degrade on a missing column
(``pg_error::is_missing_schema_object``, SQLSTATE 42703) so a coord deploy that
lands ahead of this migration fails open. Because that helper swallows 42703, a
**typo'd column name idles forever with no error** — the two names below are an
interface and the coord side must match them exactly.

Idempotency and locking
=======================

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
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fcap_01"
down_revision: str | Sequence[str] | None = "policy_rules_agent_name_uq_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the LOCAL CHAIN HEAD at authoring time
# (`scripts/ci/count_alembic_heads.py` -> HEAD_COUNT=1,
# HEAD=policy_rules_agent_name_uq_01). The head can move before this lands; if
# `alembic-heads-pr` reports HEAD_COUNT=2, re-point this line onto the new head
# — the migration test reads it at runtime, so nothing else needs to move. That
# is the gate working as designed.

_TABLE = "coord.device_resource_samples"

# The two columns, as data. Mirrors `blane_01`'s `_BLOCKING_LANE_COLUMNS`: this
# tuple is the interface the migration test pins (name and DDL type); the SQL
# below spells the same columns as STATIC string literals, and the test asserts
# the two agree. Not generated from the tuple, because coord's merge-train
# migration classifier can only inspect a static literal.
_CAPACITY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("workloads", "JSONB"),
    ("gpu", "JSONB"),
)


def upgrade() -> None:
    """Add the workloads and gpu JSONB columns to coord.device_resource_samples."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS workloads JSONB,
            ADD COLUMN IF NOT EXISTS gpu JSONB
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


def downgrade() -> None:
    """Drop the workloads and gpu columns. Exact reverse of upgrade().

    The COMMENTs go with the columns — a column comment has no independent
    existence to drop.

    The DROP lives in this function body as a static literal, out of
    `scripts/ci/check_coord_column_drops.py`'s upgrade-path scan (which skips
    the `downgrade()` body), and as a literal coord's migration classifier can
    read rather than a dynamic string.
    """
    # Same bounded lock wait as upgrade(): the runner keeps publishing into
    # this table, and a queued ACCESS EXCLUSIVE lock blocks every writer.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS gpu,
            DROP COLUMN IF EXISTS workloads
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
