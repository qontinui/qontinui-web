"""coord.device_resource_samples — the saturation lane (threads/PIDs + its source)

Revision ID: fleet_res_tel_04
Revises: ffland_headsync_01
Create Date: 2026-08-27

Phase 1 of plan
``D:/qontinui-root/plans/2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the five
columns coord's Phase 2 and the runner's Phase 3 will read and write land here,
in qontinui-web, and this revision must merge **before** the coord PR that reads
them. Hand-authored; ``alembic revision --autogenerate`` was not run and is
never run against ``coord.*``.

Why these columns exist
=======================

On 2026-08-27 the operator box reached a state where **no process in the WSL VM
could ``fork()``**. Every ``docker exec`` failed with ``EAGAIN``
(``resource temporarily unavailable``), no container could start, and all 16
containers rendered ``(unhealthy)`` because their healthchecks could not spawn.

At that same instant ``/admin/coord/devops`` was **green on every lane**, and
every reading behind that green was *accurate*:

* host lane: 35.8 GB free physical, 73.3 GB free commit of 125.6 GB;
* WSL lane: ``vmmemWSL`` at 4.63 GB against a 24 GB ceiling — ~21%;
* zero ``Microsoft-Windows-Resource-Exhaustion-Detector`` event 2004 in 3 days.

Every one of those is a **memory** instrument. The actual binding resource was
the kernel task table: ``qontinui-canonical-coord`` held **190,840** PIDs
against a ``/proc/sys/kernel/threads-max`` of **192,146** — 99.3%, pinned
across two samples 40 s apart (the signature of having *hit* the cap rather
than still climbing), while every sibling container sat at ≤ 68.

``ResourceSampleRow`` (``qontinui-coord/crates/coord/src/device_resource_samples.rs``,
``pub struct ResourceSampleRow``) carried CPU, load, memory, commit, swap,
disk, build slots, queue depth and CI job counts — and **no thread, PID, handle
or fd column anywhere**.

.. note::

   Two corrections to the sentence above, both made by **this very revision**
   and left visible rather than rewritten, because the diagnosis is only
   legible in the past tense (2026-09-01, while authoring
   ``fleet_res_tel_05_socket_census``):

   1. **"no thread, PID, handle or fd column anywhere" is no longer true.**
      It was true when written and this revision is what falsified it: the
      struct now carries ``threads_max`` / ``threads_used`` / ``pids_max`` /
      ``pids_used`` / ``saturation_source``, which are exactly the five columns
      added below. Read the claim as the state of the world the revision was
      written *against*, not as a description of the code today.
   2. **The line citation was stale.** It read ``:1711``; the struct is now at
      ``:2059``. Line numbers in another repo drift with every edit to the file
      above them, so this now cites the ``pub struct`` declaration by name
      instead — grep for that rather than trusting any number, here or
      elsewhere.

Both spellings of ``lane_pressure()`` score ``host`` on commit and ``wsl`` /
``container`` on swap — commit and swap instrument both. (Memory enters this
table elsewhere, as a BYTE FLOOR in ``headroom_against``, which the source
itself calls "a DIFFERENT AXIS from swap"; ``mem_available_bytes`` is not a
``PressureInputs`` field and never reaches the ratio.) The fleet therefore has a
saturation dimension it can reach 99.3% of while every gauge it owns reads
healthy, and the dispatcher kept ranking that machine as healthy and sending it
work for the whole incident — in direct contradiction of the devops page's own
contract, *"if the dashboard says a machine is red, the dispatcher must already
have stopped sending it work."*

These five columns are the storage for that missing dimension. They are the
**measurement** half only: composing them into a third pressure axis
(``lane_saturation`` / ``saturation_sql`` / ``saturation_floor``, worst-of at
the ``headroom`` layer, not folded into ``pressure``) is Phase 2, in coord, and
publishing them is Phase 3, in the runner. A column with no publisher reads
NULL, which is the honest state until Phase 3 lands — see "NULL is not zero"
below.

Prior art: this fleet has measured exactly this before
======================================================

``qontinui-coord/crates/coord/src/process_health.rs`` already reads all of this
for a **structurally identical incident 23 days earlier** — the 2026-08-04
production leader that accumulated 4,026 zombies at ~1,259/h, crossed
``kernel.threads-max`` at ~12.39 h, and took the merge train down when every
``fork()`` in the container began failing. This revision deliberately stores the
quantities that module already reads, under names that match it, rather than
minting a parallel vocabulary:

* ``threads_max``   ← ``process_health.rs:506`` (``read_i64_file("/proc/sys/kernel/threads-max")``)
* ``pids_max``      ← ``process_health.rs:510`` (``/sys/fs/cgroup/pids/pids.max`` with a ``/sys/fs/cgroup/pids.max`` fallback — it handles the cgroup v1/v2 split)
* ``threads_used`` / ``pids_used`` ← ``process_health.rs:161`` (``pids_current``)
* ``saturation_source`` ← ``process_health.rs:163`` (``pids_source``); the
  *reason* it exists is quoted from ``:158``-``:160``, the ``pids_current``
  doc block, NOT from ``:163`` — cite the block that carries the sentence.

``saturation_source`` is not bookkeeping
========================================

It is the column that keeps the other four legible, and it is here because
``process_health.rs:163`` already carries it, and ``:158``-``:160`` already
says why in one line:
``"cgroup"`` counts **tasks (threads)**, ``"proc"`` counts **thread-group
leaders**, and *"they are different quantities."*

A publisher that probes the cgroup, fails, and falls back to ``/proc`` therefore
emits a number that can differ from the previous tick by an order of magnitude
with **nothing in the row saying so**, and Phase 2's ratio would divide it by a
ceiling measured on the *other* quantity. The 2026-08-27 evidence is the live
example of the same hazard one level up: 190,840 came from cgroup
``pids.current`` (via ``docker stats``, which reads it through the daemon API)
and was compared against a host-wide ``/proc/sys/kernel/threads-max`` — **two
different scopes**. That comparison was the right call for that incident,
because ``docker inspect`` showed ``PidsLimit=<nil>`` so nothing bounded the
cgroup and the host ceiling genuinely *was* the binding one. But it is only
legible because a human wrote the sentence explaining it. This column is that
sentence, machine-readable, on every row.

Vocabulary — the shipped strings, not new ones:

    "cgroup" | "proc" | "job_object" | NULL

``"cgroup"`` and ``"proc"`` are exactly what ``process_health.rs`` publishes
today. ``"job_object"`` is the Windows arm, added here because the ``host``
lane on this fleet is Windows and its ceiling is a job object rather than a
cgroup; no Rust emits it yet, and the runner's Phase 3 is what will.

NULL means the instrument is unrecorded, which is not the same as "unmeasured
counts": a row may carry a ``threads_max`` read from a kernel file and NULL
counts, and a consumer must read the four numbers and their source together.

Why ``saturation_source`` gets NO CHECK, unlike ``lane``
========================================================

``fleet_res_tel_01`` split this table's TEXT columns deliberately: ``lane`` is
CHECKed over a closed set because it names a **resource pool** and the fleet has
exactly three, while ``source`` is free text because it is **provenance** whose
vocabulary is expected to grow as publishers are added, and a CHECK there would
force a migration per new publisher class. ``saturation_source`` is on the
``source`` side of that split, on two independent grounds:

1. **The set is demonstrably open.** This very revision widens the shipped
   two-value set (``"cgroup"`` / ``"proc"``) to three by adding
   ``"job_object"``. A vocabulary that grew while the migration adding it was
   being written is not a closed set, and a fourth instrument (a Windows
   ``NtQuerySystemInformation`` arm, an fd-table reader, a container runtime
   that reports neither) is a plausible Phase 3 outcome.
2. **A CHECK here would cost the very numbers this plan exists to capture.**
   Ingest is best-effort by contract (``fleet_res_tel_01``: persist failures log
   WARN and the handler still returns 200), and a CHECK violation fails the
   whole INSERT — so an unrecognised *provenance label* would discard the
   memory, disk and build-slot metrics on the same row. Rejecting a saturation
   sample because we did not recognise the name of the instrument that took it
   is precisely backwards during an incident, which is the only time these rows
   matter.

The value is still read for correctness by Phase 2, so the enforcement is
app-side at the door — the same stance ``fleet_res_tel_03`` takes for the
control columns' ranges ("fixed vocabularies get a CHECK, tunable ranges are
validated at the door"). This is a decision, not an omission.

NULL is not zero, and a lane that cannot measure reports NULL
=============================================================

Every column here is nullable, inheriting ``fleet_res_tel_01``'s rule verbatim:
*"A publisher reports what it can probe and omits what it cannot; a probe that
fails must degrade to NULL, never to a fabricated zero."* That rule is sharper
for these columns than for the memory ones, because a fabricated ``0`` here does
not merely misreport — it inverts the reading. ``threads_used = 0`` renders as
*perfectly idle* on the exact axis whose whole purpose is to catch a box at
99.3%, and a ``NULLS LAST`` ranking would then promote the blind machine to the
front of the dispatch queue.

The same rule already has three spellings across the fleet, and this is the
fourth:

* ``fleet_res_tel_01`` — every metric column nullable, NULL on an unprobed lane;
* ``fleet_res_tel_03`` — NULL means "no override", where ``0`` would *disable*
  the guard the column names;
* ``process_health.rs`` — ``UNMEASURED = -1`` on the Prometheus gauges
  (``coord_container_threads_max``, ``:456``), because Prometheus has no NULL.

Two write-path obligations SQL cannot express, stated here so a publisher does
not trip on them:

* **Guard the divisor.** ``threads_max`` / ``pids_max`` are ceilings and a ratio
  consumer must ``NULLIF(threads_max, 0)``. No CHECK forbids a zero, for the
  same reason ``swap_total_bytes = 0`` is allowed: forbidding it would make a
  machine reporting an odd reading unable to report at all.
* **``pids.max`` can read the literal string ``max``.** cgroup v2 spells "no
  limit" that way, which is exactly what ``docker inspect`` showed as
  ``PidsLimit=<nil>`` during the incident. A publisher that cannot parse it must
  emit NULL, never a sentinel and never the kernel ceiling — an unbounded cgroup
  is a real and important fact, and it is the fact the plan's remaining
  ``pids_limit`` work exists to change. Until a ``pids_limit`` is set on the
  coord service, the ``container`` lane will legitimately carry
  ``pids_max IS NULL`` and Phase 2's ratio will render ``unknown`` there.

Degrade obligation on the coord side
====================================

Unchanged from ``fleet_res_tel_01``, and it runs the other way: the coord PR
that reads these columns must degrade on a missing column
(``pg_error::is_missing_schema_object``, SQLSTATE 42703) so a coord deploy that
lands ahead of this migration fails open rather than erroring. Note that
``is_missing_schema_object`` swallowing 42703 also means a **typo'd column name
idles forever with no error** — so the names below are an interface, and the
coord side must match them exactly rather than relying on a failure to notice.

Types are chosen by the consumer, not here
==========================================

All four counts are ``BIGINT``. This is not defensive over-sizing: the same
``fleet_res_tel_03`` constraint applies — coord reads these with
``row.get(...)`` into ``Option<i64>``, and an ``i64`` read off an ``INTEGER``
column is a **runtime type error** in tokio-postgres, not a widening. It is also
not merely nominal at the value level: the observed ``threads_max`` on the
Docker VM was 192,146, which fits an ``INTEGER`` today, but the ceiling scales
with RAM and a task table is exactly the counter that grows by orders of
magnitude between machine classes.

``IF NOT EXISTS`` on the ADDs is **type-blind** — it matches on name alone, so a
column of the right name and wrong type makes the ADD a silent no-op and leaves
the wrong type in place, where ``row.get`` will **panic** rather than return a
degradable SQLSTATE. Re-running ``upgrade()`` is not a repair for that; fix it
with an explicit ``ALTER COLUMN … TYPE`` in a new revision.

No new index
============

Deliberately. These five columns are read on rows the anchor index
(``idx_device_resource_samples_anchor_sampled``) already selects — the
dispatcher's ``LEFT JOIN LATERAL`` and the strip's one-row-per-anchor both fetch
the heap tuple anyway, so the saturation columns come along for free. Nothing
filters or orders *by* them: Phase 2's ratio is computed per selected row, and
``pressure_sql``'s ``NULLS LAST`` ordering is over the computed ratio, not over
a stored column. An extra index on an append-only table written every 30 s would
cost maintenance on every insert to serve no query.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. Every column is nullable with no default, so
each ADD is a catalogue update with no table rewrite; the brief
``ACCESS EXCLUSIVE`` lock is immeasurable on this table.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_res_tel_04"
down_revision: str | Sequence[str] | None = "pdtier_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The plan names this revision "fleet_res_tel_04, revising fleet_res_tel_03".
# The revision *id* is that; the down_revision is NOT. `fleet_res_tel_03` has
# not been the chain head since 2026-08-07 and pointing at it would fork the
# graph — which `alembic-graph-pr.yml`'s `alembic-heads-pr` job (a required
# check on `web-protect-main`) fails the PR for. down_revision is therefore the
# LOCAL head at authoring time. The family *name* is what carries the lineage
# here, not the edge.
#
# That head MOVED between authoring and the first CI run: this originally
# pointed at `ffland_headsync_01`, and `pdtier_01` landed on main ~40 minutes
# later, itself revising `ffland_headsync_01`. `alembic-heads-pr` caught the
# fork immediately (`HEAD_COUNT=2: fleet_res_tel_04, pdtier_01`) and this was
# rebased onto the new head. That is the gate working exactly as designed —
# a stale local head is expected on a busy repo, which is why the fork check is
# a REQUIRED status check and not a lint.

_TABLE = "coord.device_resource_samples"

# The one column list, spelled once. The upgrade's ADDs and the downgrade's
# DROPs are generated from it so they cannot drift into different sets — the
# same construction `fleet_res_tel_03` uses, and for the same reason.
_SATURATION_COLUMNS: tuple[tuple[str, str], ...] = (
    ("threads_max", "BIGINT"),
    ("threads_used", "BIGINT"),
    ("pids_max", "BIGINT"),
    ("pids_used", "BIGINT"),
    ("saturation_source", "TEXT"),
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so the table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _SATURATION_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list."""
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _SATURATION_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the five saturation columns to coord.device_resource_samples."""
    op.execute(_add_columns(_TABLE))

    # Column comments carry what a name cannot: which quantity each number is,
    # that NULL is never zero here, and — for saturation_source — that the four
    # counts are uninterpretable without it. A reader who gets any of these
    # wrong builds a confidently-wrong gauge, which is the defect this whole
    # revision exists to close.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.threads_max IS
            'Kernel thread ceiling for this lane — /proc/sys/kernel/threads-max '
            'on Linux, the Windows equivalent on the host lane. The same value '
            'process_health.rs:506 already reads. NULL = not probed, NEVER 0: a '
            'ratio consumer must NULLIF this divisor, since 0 is not forbidden '
            'by a CHECK (forbidding it would make an oddly-reporting machine '
            'unable to report at all). Measured 192,146 on the Docker VM during '
            'the 2026-08-27 fork-exhaustion incident; BIGINT because the '
            'ceiling scales with RAM and coord reads it as Option<i64>.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.threads_used IS
            'Current thread count in this lane. Read together with '
            'saturation_source, which says WHICH quantity this is — cgroup '
            'tasks (threads) and /proc thread-group leaders are different '
            'quantities and can differ by an order of magnitude. NULL = the '
            'probe failed or the lane cannot measure it. NEVER 0 on a failed '
            'probe: 0 renders as perfectly idle on the one axis built to catch '
            'a box at 99.3%, and NULLS LAST would then rank the blind machine '
            'first.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.pids_max IS
            'cgroup / job-object PID ceiling where one applies — '
            '/sys/fs/cgroup/pids/pids.max with the /sys/fs/cgroup/pids.max v2 '
            'fallback (process_health.rs:510). NULL means NO ceiling applies or '
            'none could be read, which includes the literal cgroup v2 value '
            '"max" (what docker inspect showed as PidsLimit=<nil> on '
            '2026-08-27, when nothing bounded the container that consumed the '
            'whole kernel task table). A publisher that cannot parse it emits '
            'NULL — never a sentinel, and never the kernel ceiling in its '
            'place: an unbounded cgroup is a real and important fact.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.pids_used IS
            'Current PID count against pids_max, from the same instrument that '
            'produced the ceiling. saturation_source says which. NULL = not '
            'probed, never 0. Compare against pids_max, NOT against '
            'threads_max, unless pids_max IS NULL — the 2026-08-27 reading '
            'crossed those scopes deliberately (a container cgroup count '
            'against a host kernel ceiling) and it was correct only because '
            'nothing bounded the cgroup, so the host ceiling WAS the binding '
            'one. That is a judgement, not a default.'
        """
    )
    # The `''` below are SQL's escaped apostrophe and must stay BARE. They were
    # written `\'\'` at first: inert in a non-raw triple-quoted string, so the
    # SQL Postgres receives is identical either way and nothing at runtime could
    # tell the two apart. But the backslashes are not inert to a reader of this
    # FILE, and `_alembic_harness.comment_body_from_source` — which recovers a
    # comment body from source so a test need not hold a second copy of it — is
    # exactly such a reader. It strips SQL string literals and asserts the
    # remainder is blank; a stray backslash survives that strip and aborts it.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.saturation_source IS
            'Which instrument produced threads_used / pids_used: cgroup | proc '
            '| job_object, or NULL when unrecorded. cgroup and proc are the '
            'vocabulary coord already publishes as pids_source '
            '(process_health.rs:163); job_object is NEW here, for the Windows '
            'host lane, and has no shipped publisher yet. The reason the column '
            'exists is stated at process_health.rs:158-160: cgroup '
            'counts tasks (THREADS) and proc counts thread-group LEADERS, and '
            'they are different quantities. A publisher reading the PROMETHEUS '
            'exposition rather than the JSON must map its literal ''none'' label '
            'back to NULL (process_health.rs:445 renders '
            'pids_source.unwrap_or(''none'') because the metric has no null) - '
            'writing ''none'' here would record an unmeasured row as having a '
            'known-but-unrecognised instrument. Without this column a publisher '
            'that probes the cgroup, fails, and falls back to /proc silently '
            'changes what the number means, and a saturation ratio would divide '
            'it by a ceiling measured on the other quantity. Free text, NOT '
            'CHECKed — the set is demonstrably open (job_object is added by the '
            'same revision that documents the two-value shipped set) and a '
            'CHECK violation would fail the whole best-effort INSERT, '
            'discarding the memory and disk metrics on the row over a '
            'provenance label. Validated app-side at the door, the same split '
            'as this table''s CHECKed lane vs free-text source.'
        """
    )


def downgrade() -> None:
    """Drop the five saturation columns. Exact reverse of upgrade().

    The COMMENTs go with the columns — a column comment has no independent
    existence to drop.
    """
    op.execute(_drop_columns(_TABLE))
