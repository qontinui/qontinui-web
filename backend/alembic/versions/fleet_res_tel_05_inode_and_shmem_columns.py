"""coord.device_resource_samples — the INODE axis, and the shmem split of swap

Revision ID: fleet_res_tel_05
Revises: reqchk_walk_01
Create Date: 2026-09-05

Phase 1 of plan
``2026-09-04-devops-inode-and-shmem-axes-are-invisible-to-fleet-telemetry``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the three
columns coord's Phase 2 and the runner's Phase 3 will read and write land here,
in qontinui-web, and this revision must merge **before** the coord PR that reads
them. Hand-authored; ``alembic revision --autogenerate`` was not run and is
never run against ``coord.*``.

This revision is the direct structural sibling of ``fleet_res_tel_04``, which
added the saturation (thread/PID) columns for the 2026-08-27 fork-exhaustion
blind spot. Same shape, same rules, a different axis — and that is deliberate:
the plan names ``fleet_res_tel_04`` as its precedent explicitly, because the
argument for a third instrument is the argument that was already accepted for
the second one.

Why these columns exist
=======================

On ``merytshost`` (Linux, 368 GiB RAM, ``/tmp`` a 185 GiB RAM-backed tmpfs
shared by every Claude Code session, the runner and coord's test suites),
2026-09-04 04:12–04:20Z, four instruments read at the same instant::

    df -i /tmp   ->  1048576 total, 747696 used, 300880 free   = 71.3%  <- THE FAULT AXIS
    df -h /tmp   ->  185G size, 68G used, 117G avail           = 37%    <- READS HEALTHY
    swap         ->  73.5 GiB used / 101.1 GiB                 = 72.7%
    MemAvailable ->  283.7 GiB of 368.8 GiB                    = 77% FREE

That box has exhausted its ``/tmp`` **inode table sixteen times** (dossier
``tmp-exhaustion-on-merytshost``). Each occurrence presents as
``ENOSPC: no space left on device``, kills the Bash tool in **every** live
session at once, and — findings ``8a7ead50`` and ``fc2b1ffd`` — makes a heredoc
``cat > file`` write a **silently truncated** file that the next step consumes
as complete. That last one is a correctness hazard, not a capacity one.

Two absences in ``ResourceSampleRow``
(``qontinui-coord/crates/coord/src/device_resource_samples.rs``) let all of that
happen with every gauge green:

1. **The disk triple is bytes-only** — ``disk_total_bytes`` /
   ``disk_free_bytes`` / ``disk_mount``. There is no inode pair anywhere in the
   struct, so the 71.3% has no column, no lane, and no ranking input. Every
   floor in the fleet is byte-based and reads healthy straight through it.
2. **``swap_used_bytes`` has no shmem decomposition.** Summing ``VmSwap`` across
   every ``/proc/[0-9]*/status`` on the same box gives **455 processes, 10.93
   GiB total** against 73.5 GiB of swap in use — so **62.6 GiB (85%) of that
   swap is shmem, cold tmpfs pages, not process memory**. The largest single
   process ``VmSwap`` on the box was ``qontinui-runner`` at 0.23 GiB.

The second absence is not merely cosmetic, because that 72.7% is what the box
**publishes as ``pressure``**: ``lane_pressure``'s own doc comment states the
basis verbatim — *"Pressure is ``swap_used / swap_total`` on the Linux lanes and
``1 − commit_available / commit_total`` on the Windows host lane."* And
``ci_dispatch.rs:520`` orders CI dispatch on::

    HEADROOM_ORDER_SQL = "GREATEST(h.pressure, h.saturation) ASC NULLS LAST"

— max-of-axes, ascending, lower is better. So ``0.727`` goes straight into that
``GREATEST`` and ranks this machine near-last for CI dispatch **permanently**,
because a tmpfs full of cold files never drains. It is wrong in both directions
at once: a real ranking penalty for a reason that is not real, while the axis
that actually fails publishes nothing at all.

Per the devops page's own contract — *"if the dashboard says a machine is red,
the dispatcher must already have stopped sending it work"* — the live defect is
the converse: the surface cannot say *"this machine is about to refuse every
file creation"*, so the dispatcher keeps sending it work until Bash dies
fleet-wide.

The instrument is NOT missing — it is shipped and unwired
=========================================================

``qontinui-claude-config/scripts/tmpfs-inode-probe.sh`` (2026-09-01, shipped
with its own selftest in the guard roster) already reads exactly these numbers,
and its design is already right on every axis::

    $ bash scripts/tmpfs-inode-probe.sh /tmp
    {"mount":"/tmp","fs_type":"tmpfs","inodes_total":1048576,"inodes_free":299851,
     "inodes_pct_used":72,"bytes_free":125101297664,"bytes_pct_used":37,"status":"OK"}

One ``statfs(2)`` against the superblock — **O(1)**, it does not walk the mount,
which is what makes it safe on a 30 s publish cadence where ``find | wc -l`` is
not. It reports **both** numbers on purpose, in its header's words: *"a probe
that reported only 'inodes are high' would be a second byte-gauge with a
different unit. This one reports both, so a caller can see that the
healthy-looking one is the lie."* And its ``status`` is ``UNKNOWN`` on any read
it could not complete, never ``0``.

It has **zero consumers** — a workspace-wide grep for ``tmpfs-inode-probe`` and
``tmpfs_inode`` across ``qontinui-runner/src-tauri/src/`` and
``qontinui-coord/crates/`` returns nothing. So the work this column enables is
**wiring, not construction**, and the runner's Phase 3 sources the pair from the
same ``statfs`` its disk triple already makes rather than spawning that shell
probe on the hot path.

A THIRD axis, not a fold into either existing one
=================================================

These columns are storage for an axis that is **orthogonal to both memory and
tasks**. A box can read 0% on ``pressure`` and 0% on ``saturation`` and still
refuse every ``open(O_CREAT)``. That is the same statement ``fleet_res_tel_04``
made about the task table, and ``lane_saturation``'s doc gives the reason in a
form that transfers verbatim: *"unlike the memory axis, saturation does NOT
change instrument per lane, because a task table is a task table on every
platform."* An inode table is a hard object-count ceiling with exactly that
property.

The consumer is already shaped to take it. ``HEADROOM_ORDER_SQL`` is a
``GREATEST`` over the axes, so a third argument composes in with no change to
the ordering's meaning — *rank by the worst axis, unmeasured last*. Folding
inodes into either existing ratio would instead destroy the information that
``GREATEST`` exists to preserve.

NULL is not zero — and here it is not 100% either
=================================================

Every column is nullable, inheriting ``fleet_res_tel_01``'s rule verbatim: *"A
publisher reports what it can probe and omits what it cannot; a probe that fails
must degrade to NULL, never to a fabricated zero."*

For the inode pair that rule has a **second, filesystem-level** reason on top of
the failed-probe one, and it is the subtler of the two: **btrfs, xfs, zfs and
friends allocate inodes dynamically and report ``f_files == 0``.** There is no
ceiling to be near. A publisher that computed a ratio anyway would divide by
zero; one that "helpfully" substituted 0 used of 0 total would compute the
healthiest possible reading on exactly the filesystems where nothing is
measurable. The shipped probe already gets this right — it emits
``inode_limit_not_reported: fs_type=<t> reports f_files=0, so no inode cap is
measurable here`` rather than a ratio — and the obligation on the consumer is to
carry that through as **``None``: never ``1.0``, never ``0.0``**, the same trap
``lane_pressure``'s doc names (*"a ``0.0`` here would rank an unmeasured machine
FIRST"*) and the same reason ``HEADROOM_ORDER_SQL`` spells ``NULLS LAST``.

So: ``disk_inodes_total IS NULL`` legitimately means *this filesystem has no
inode cap*, and it is indistinguishable at the column level from *the probe did
not run*. Both must render **unknown**, and the consumer must guard its own
divisor (``NULLIF(disk_inodes_total, 0)``) because no CHECK forbids a zero here,
for the same reason ``fleet_res_tel_04`` allows ``threads_max = 0``: forbidding
it would make an oddly-reporting machine unable to report at all.

``swap_shmem_bytes`` is observability FIRST — read this before wiring it
=======================================================================

``/proc/meminfo`` does **not** expose swapped-out tmpfs as a single counter.
``Shmem`` (5.6 GiB on the incident box) is *resident* tmpfs; ``SwapCached``
(0.5 GiB) is something else again. The 62.6 GiB figure above was obtained by
**subtraction** — ``swap_used − Σ VmSwap over /proc/[0-9]*/status`` — which is
an **inference, not a counter**, and costs ~455 file reads. The publisher has
two candidate instruments and the choice belongs to a measurement, not to this
docstring:

* **Cheap, O(#mounts):** ``Σ tmpfs mount bytes_used (statfs) − Shmem_resident``.
  Reuses the probe above verbatim and adds no per-process cost.
* **Direct, O(#processes):** the ``Σ VmSwap`` subtraction. Exact, but ~500 opens
  per sample at a 30 s cadence.

Because the number's *provenance* changes what it means, whichever ships must be
legible — the same lesson ``saturation_source`` encodes one axis over.

⚠️ **Changing ``lane_pressure``'s FORMULA to net out shmem is explicitly NOT
authorised by this column.** That is a behaviour change to live dispatch ranking
on every Linux box in the fleet, and it belongs in a separate, separately-vetted
change once the column has been serving long enough to show what the corrected
ratio would have been. The plan says so in as many words: *"Do not smuggle it in
here."*

Ranking, not filtering
======================

Both additions are **ranking inputs**. ``headroom`` ranks and never excludes —
pinned by ``ci_dispatch.rs``'s own test
``headroom_is_a_ranking_input_and_never_a_filter`` — and nothing downstream of
this revision changes that. If the fleet later wants a machine at 95% inodes to
stop receiving work outright, that is a **drain predicate**: a different
mechanism (coord's device drain), needing its own plan.

Degrade obligation on the coord side
====================================

Unchanged from ``fleet_res_tel_01`` / ``fleet_res_tel_04``, and it runs the
other way: the coord PR that reads these columns must degrade on a missing
column (``pg_error::is_missing_schema_object``, SQLSTATE 42703) so a coord
deploy that lands ahead of this migration fails open rather than erroring. Note
that swallowing 42703 also means a **typo'd column name idles forever with no
error** — so the three names below are an interface, and the coord side must
match them exactly rather than relying on a failure to notice.

Types are chosen by the consumer, not here
==========================================

All three are ``BIGINT``. coord reads them with ``row.get(...)`` into
``Option<i64>``, and an ``i64`` read off an ``INTEGER`` column is a **runtime
type error** in tokio-postgres, not a widening. It is not merely nominal at the
value level either: ``swap_shmem_bytes`` counts BYTES and the incident value is
67.2e9, which does not fit an ``INTEGER`` at all.

``IF NOT EXISTS`` on the ADDs is **type-blind** — it matches on name alone, so a
column of the right name and wrong type makes the ADD a silent no-op and leaves
the wrong type in place, where ``row.get`` will **panic** rather than return a
degradable SQLSTATE. Re-running ``upgrade()`` is not a repair for that; fix it
with an explicit ``ALTER COLUMN … TYPE`` in a new revision.

No new index
============

Deliberately, and for ``fleet_res_tel_04``'s reason verbatim: these columns are
read on rows the anchor index (``idx_device_resource_samples_anchor_sampled``)
already selects, and nothing filters or orders *by* them — the inode ratio is
computed per selected row, and the ``NULLS LAST`` ordering is over the computed
ratio, not over a stored column. An extra index on an append-only table written
every 30 s would cost maintenance on every insert to serve no query.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. Every column is nullable with no default, so
each ADD is a catalogue update with no table rewrite; the brief
``ACCESS EXCLUSIVE`` lock is immeasurable on this table.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_res_tel_05"
down_revision: str | Sequence[str] | None = "reqchk_walk_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The family *name* carries the lineage (this is the fifth `fleet_res_tel_*`
# revision); the `down_revision` is the LOCAL CHAIN HEAD at authoring time and
# has nothing to do with the name. `fleet_res_tel_04` stopped being the head
# long ago, and pointing at it would fork the graph — which `alembic-graph-pr.yml`'s
# `alembic-heads-pr` job (a required check on `web-protect-main`) fails the PR
# for. Read `down_revision`, never infer the edge from the prefix.
#
# A busy repo moves that head between authoring and the first CI run; when it
# does, the fork check catches it immediately (`HEAD_COUNT=2: …`) and the fix is
# to re-point this line, not to argue with the gate.

_TABLE = "coord.device_resource_samples"

# The one column list, spelled once. The upgrade's ADDs and the downgrade's
# DROPs are generated from it so they cannot drift into different sets — the
# same construction `fleet_res_tel_03` and `fleet_res_tel_04` use, and for the
# same reason.
_INODE_AND_SHMEM_COLUMNS: tuple[tuple[str, str], ...] = (
    ("disk_inodes_total", "BIGINT"),
    ("disk_inodes_free", "BIGINT"),
    ("swap_shmem_bytes", "BIGINT"),
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so the table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _INODE_AND_SHMEM_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list."""
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _INODE_AND_SHMEM_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the inode pair and the shmem split to coord.device_resource_samples."""
    op.execute(_add_columns(_TABLE))

    # Column comments carry what a name cannot: which quantity each number is,
    # that NULL is never zero here, and — for the inode pair — that a NULL
    # ceiling is a legitimate FILESYSTEM fact and not only a failed probe. A
    # reader who gets any of these wrong builds a confidently-wrong gauge, which
    # is the defect this whole revision exists to close. psql's describe-table output is where a human
    # meets this schema; the docstring above ships nowhere they will see it.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.disk_inodes_total IS
            'Inode ceiling of the mount named by disk_mount — statfs(2) f_files, '
            'the same O(1) superblock read qontinui-claude-config''s '
            'scripts/tmpfs-inode-probe.sh already makes. NULL means NO CEILING '
            'IS MEASURABLE, which is a real filesystem fact and not only a '
            'failed probe: btrfs, xfs and zfs allocate inodes dynamically and '
            'report f_files = 0. Both cases must render UNKNOWN. NEVER '
            'fabricate a value: a ratio consumer must NULLIF this divisor (no '
            'CHECK forbids a 0, for the same reason threads_max = 0 is allowed '
            '— forbidding it would make an oddly-reporting machine unable to '
            'report at all), and a substituted 0-used-of-0 would compute the '
            'HEALTHIEST possible reading on exactly the filesystems where '
            'nothing is measurable. Measured 1,048,576 on merytshost''s /tmp '
            'tmpfs (nr_inodes=), the mount that exhausted sixteen times.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.disk_inodes_free IS
            'Free inodes on disk_mount — statfs(2) f_ffree. With '
            'disk_inodes_total this is the fleet''s THIRD pressure axis, '
            'orthogonal to both memory and the task table: a box can read 0 percent on '
            'pressure and 0 percent on saturation and still refuse every '
            'open(O_CREAT). It composes into the dispatcher''s '
            'GREATEST(pressure, saturation) ASC NULLS LAST as a third argument '
            '— rank by the worst axis, unmeasured last — and is a RANKING input '
            'only: headroom ranks and never excludes '
            '(headroom_is_a_ranking_input_and_never_a_filter). An exclusion '
            'threshold would be a drain predicate, a different mechanism. NULL '
            '= not probed or no cap; never 0, which reads as fully exhausted. '
            'Measured 300,880 free of 1,048,576 (71.3 percent used) at 2026-09-04 '
            '04:12Z while df -h on the same mount said 37 percent and MemAvailable '
            'said 77 percent free.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.swap_shmem_bytes IS
            'How much of swap_used_bytes is SHMEM (cold tmpfs pages) rather '
            'than process anonymous memory. Exists because the Linux lanes '
            'publish pressure = swap_used / swap_total, and on 2026-09-04 that '
            'ratio read 0.727 on a box with 283.7 GiB (77 percent) of memory '
            'available: 62.6 GiB of the 73.5 GiB in use was cold tmpfs, and the '
            'largest single process VmSwap on the box was 0.23 GiB. That 0.727 '
            'feeds GREATEST(pressure, saturation) in ci_dispatch and ranks the '
            'machine near-last for CI dispatch PERMANENTLY, because a tmpfs '
            'full of cold files never drains. NULL = not decomposed; never 0, '
            'which asserts that none of swap is shmem. HONEST BOUND: '
            '/proc/meminfo exposes no counter for swapped-out tmpfs — Shmem is '
            'RESIDENT tmpfs and SwapCached is something else again — so this '
            'number is an INFERENCE whose instrument matters (a per-mount '
            'statfs difference, or swap_used minus the sum of VmSwap over '
            '/proc/[0-9]*/status). This column is OBSERVABILITY FIRST: it does '
            'NOT authorise changing lane_pressure''s formula to net out shmem, '
            'which is a live behaviour change to dispatch ranking on every '
            'Linux box and needs its own vetted plan once this column has '
            'served long enough to show what the corrected ratio would be.'
        """
    )


def downgrade() -> None:
    """Drop the three columns. Exact reverse of upgrade().

    The COMMENTs go with the columns — a column comment has no independent
    existence to drop.
    """
    op.execute(_drop_columns(_TABLE))
