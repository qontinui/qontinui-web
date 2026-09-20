"""coord.ci_job_observations — the memory-headroom columns for a CI job

Revision ID: ci_job_mem_01
Revises: notif_gate_action_03_drop_enum_value
Create Date: 2026-09-20

Phase 1 of plan
``2026-09-20-ci-memory-headroom-in-the-dev-ops-console``.

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``),
so the columns coord's Phase 2 will write and its Phase 3 will read land here,
in qontinui-web, and this revision must merge **before** the coord PR that
touches them. Hand-authored; ``alembic revision --autogenerate`` was not run and
is never run against ``coord.*`` — there are no SQLAlchemy models behind this
schema, so autogenerate emits spurious drops.

Why these columns exist
=======================

``/admin/coord/devops`` section 4 answers *"how much CI is this machine ALLOWED
to take?"* — which runners exist, what labels they carry, whether they are
enabled. Nothing anywhere answers the adjacent question: *how close is a CI job
running to its runner's physical limits, and in which direction is that
moving?*

Because nothing answered it, the answer was produced by hand. The
``coord-ci-memory-cliff`` dossier records peak rustc RSS on coord's workspace
climbing **13,422 MB (2026-09-03) -> 14,264 (09-07) -> 15,209 (09-12)**, about
+200 MB/day against ~19k lines/day of crate growth, while ``coord-db-tests``
runs on a GitHub-hosted **2 vCPU / 7 GB** runner with a hand-made 12 GB
swapfile (``qontinui-coord`` ``.github/workflows/ci.yml``, the ``coord-db-tests``
job header and its "Add swap" step). The latest green main run measured minimum
``mem_avail`` **194 MB** and peak ``swap_used`` **7,981 MB of 12,288** (64.9%)
across 12,024 tests.

The failure mode is not a test failure, which is why no test surface shows it:
the kernel OOM killer takes the runner **agent**, surfacing as ``The runner has
received a shutdown signal`` — indistinguishable from infrastructure flake.
``ci.yml``'s own job header names seven such runs. A second signature is the
80-minute step timeout with collateral ``pr_merge`` DB failures unrelated to the
diff (dossier ``coord-db-tests-wall-time-mis-sized``, the 2026-09-15
12:18-13:12Z window). Four shipped remediations never moved the margin, because
nothing measures the margin between them.

What is already built, and why these are COLUMNS rather than a table
====================================================================

``coord.ci_job_observations`` already exists (``coord_ci_job_observations_01_create``
+ ``_02_indexes``, 2026-09-15, plan
``2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it``). It
holds one row per completed GitHub Actions JOB, keyed ``(repo, job_id)``,
written by ``qontinui-coord``'s leader-gated ``ci_job_sampler`` worker, retained
30 days by a reaper that already runs, and re-fillable through
``POST /coord/fleet/ci-jobs/backfill``, which already exists.

It carries ``duration_secs``, ``runner_name``, ``runner_labels``,
``self_hosted``, ``conclusion``, ``outcome`` and ``duration_band`` — every join
this surface needs — and **no memory column at all**. So the per-job spine, the
duration half of the metric, the hosted/self-hosted discriminator, the retention
and the backfill are all already running. These nine columns are the missing
half, added to the row that already exists rather than to a sibling table that
would duplicate its key, its reaper and its backfill for no capability.

NULL is never 0, and here that rule has two distinct teeth
==========================================================

Every column is nullable and none carries a DEFAULT, for the same reason
``fleet_res_tel_04`` argues at length on the saturation axis — but on this axis
the consequence is sharper in two specific places:

1. ``min_mem_avail_mb = 0`` renders as *a job that ran out of memory*, and
   ``peak_swap_used_mb = 0`` as *a job that never touched swap*. Those are
   opposite claims about the same absence, and both are wrong. A job whose log
   carried no ``[sample]`` line at all — a job that died before the sampler
   started, which is precisely the OOM case this surface exists to catch —
   must read UNKNOWN on every one of these columns.
2. ``mem_total_mb`` is expected to be NULL for some time, and that is the
   honest state rather than a gap to paper over. ``resource-sampler.sh``
   resolves ``used`` and ``available`` from ``free``'s ``Mem:`` row **by column
   name and never reads** ``total``, so there is no ``mem_total=`` key in the
   wire format at all. Memory headroom as a percentage is therefore not
   computable today; swap headroom is, because ``swap_used`` and ``swap_total``
   are both emitted. A consumer must render memory headroom UNKNOWN until the
   plan's Phase 5 adds the key — never fabricate it against a hardcoded 7 GB,
   which would silently become wrong the day ``coord-db-tests`` moves to the
   self-hosted box.

Nullability alone does not defend that rule, which is why none of the nine
carries a DEFAULT either: a plain nullable ``DEFAULT 0`` is written into every
INSERT that omits the column, and every row the sampler writes before its
Phase 2 arm ships omits all nine.

``peak_mem_used_mb`` is SYSTEM-WIDE, not a process
==================================================

The sampler contains no ``ps``, no ``/proc/<pid>/status`` and no cgroup read:
its memory and disk readings are ``free -m`` plus ``df -m /``, and its only
other ``/proc`` read is ``/proc/sys/kernel/osrelease`` for WSL lane detection,
which measures nothing. So no per-process resident set is sampled anywhere in
this pipeline. The 13.4/14.3/15.2 GB rustc
figures in the dossier come from a separate hand method on a developer box, not
from CI. This column is named ``peak_mem_used_mb`` rather than ``peak_rss_mb``
so that no consumer can read it as a process's resident set, and the COMMENT
says so in the database, where a reader actually meets the schema.

``swap_total_mb`` is a DENOMINATOR, and it is the job's own
==========================================================

It is not a property of the runner image: on ``coord-db-tests`` it is the
12 GB swapfile the job creates in its own "Add swap" step, and it is what makes
the headroom metric survive the move to a self-hosted runner as a *denominator
change* rather than a reporting break. Every ratio consumer must
``NULLIF(swap_total_mb, 0)``. No CHECK forbids a zero, for the same reason
``device_resource_samples.swap_total_bytes`` allows one: forbidding it would
make an oddly-reporting job unable to report at all.

``resource_sample_count`` / ``resource_span_secs`` are the verdict's footing
===========================================================================

A ``breach`` computed from one sample is not the same claim as one computed
from sixty, and a reader is entitled to see which it got. The span is also not
``duration_secs``: a job killed by the OOM reaper stops emitting before it ends,
so a span far shorter than the duration is evidence about the incident.

``resource_source`` carries NO CHECK
====================================

Same reasoning as ``coord.ci_job_observations.outcome`` and ``duration_band``,
which this table already ships without CHECKs, and as
``device_resource_samples.saturation_source``: the vocabulary is open (``job_log``
today, a producer-pushed ``step_summary`` plausibly later), ingest is
best-effort, and a CHECK violation would fail the whole UPSERT and discard the
job's timing, conclusion and outcome over a provenance label. Adding a class
stays a Rust PR rather than a migration.

No new index
============

Deliberately. These nine are read on rows the shipped indexes already select
(``ix_ci_job_obs_runner_completed``, ``ix_ci_job_obs_key``), and nothing filters
or orders *by* them: the verdict and the slope of plan Phase 3 are computed per
selected row. An extra index would cost maintenance on every sampler UPSERT to
serve no query.

Head choice
===========

``down_revision`` is the repo's **LOCAL single alembic head at authoring
time** — ``notif_gate_action_03_drop_enum_value``, derived on ``origin/main``
at ``83c9ea5f7`` by parsing every file under ``backend/alembic/versions/`` for
its ``revision`` and every ``down_revision`` edge and taking the revision no
file names as a parent (576 revisions, exactly 1 head). The family name carries
no lineage; the edge does. On a busy repo that head MOVES, so if another
alembic PR lands first this is re-pointed at the new head — and
``alembic-heads-pr`` (a required check) is what catches the fork rather than a
convention. Re-point ``down_revision``, the ``Revises:`` header above and
``_PARENT_REVISION_ID`` in the companion test together. No ``alembic merge``:
this repo keeps strict single-head discipline.

Deploy ordering
===============

Beyond ``alembic-sole-authorship``'s migration-first rule, ``coord-db-tests``
pins ``MIGRATOR_ALEMBIC_HEAD`` against a ``MIGRATOR_DIGEST`` and
``schema_head_check.py`` reds the job when the provisioned DB disagrees. That
pin asserts image-to-head consistency, **not** "qontinui-web's head equals this
value", so a new web revision is invisible to ``coord-db-tests`` until someone
rebuilds the migrator image and bumps the digest. This revision can therefore
land first and sit harmlessly, which is exactly the ordering the policy wants;
the coord PR that READS these columns bumps the pin in the same PR.

Merge-train classifier disposition
==================================

coord's migration classifier is expected to classify this revision Reject: it
does not recognise ``COMMENT ON`` and it scans ``downgrade()``, where it rejects
every drop. Every SQL string here is a static literal, so it is not rejected for
being dynamic. The landed precedents ``fleet_res_tel_04`` and
``coord_ci_job_observations_01`` classify Reject the same way.

Safety and idempotency
======================

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house pattern for
this family — and re-runnable ``COMMENT ON``, so a partial apply re-runs
cleanly. Note ``IF NOT EXISTS`` matches on NAME alone and is **type-blind**, so
a column of the right name and the wrong type makes the ADD a silent no-op and
leaves the wrong type in place; re-running ``upgrade()`` is not a repair for
that, and the companion test asserts every type by name for exactly this reason.

Every column is nullable with no default, so each ADD is a catalogue-only
``ALTER`` that rewrites no row. It still takes a brief ``ACCESS EXCLUSIVE`` lock
on a table coord's sampler UPSERTs every 120 s, and ``env.py`` runs the batch in
one transaction, so both directions bound the wait with
``SET LOCAL lock_timeout = '3s'`` and restore the default afterwards — the guard
``coord_ci_job_observations_01`` uses on this same table. A blocked apply fails
fast instead of queueing in front of coord.

Both directions are pure SQL execution with no bind or inspection, so they work
under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ci_job_mem_01"
down_revision: str | Sequence[str] | None = "notif_gate_action_03_drop_enum_value"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.ci_job_observations"

# The one column list, spelled once. The upgrade's ADDs and the downgrade's
# removals are generated from it so they cannot drift into different sets — the
# construction the fleet_res_tel_03/04 revisions use, for the same reason.
#
# INTEGER, not BIGINT, and that is a consumer-driven choice rather than a
# default: these are MEGABYTE counts on a machine whose whole address space is
# measured in tens of thousands of them, and a count of samples or a span in
# seconds over a job capped at 80 minutes cannot approach 2^31-1. coord reads
# them as Option<i32>. If that ever changes, widening needs an explicit
# ALTER COLUMN in a new revision — re-running this one cannot repair a type,
# because ADD COLUMN IF NOT EXISTS matches on name alone.
_MEMORY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("peak_swap_used_mb", "INTEGER"),
    ("swap_total_mb", "INTEGER"),
    ("min_mem_avail_mb", "INTEGER"),
    ("peak_mem_used_mb", "INTEGER"),
    ("mem_total_mb", "INTEGER"),
    ("min_disk_avail_mb", "INTEGER"),
    ("resource_sample_count", "INTEGER"),
    ("resource_span_secs", "INTEGER"),
    ("resource_source", "TEXT"),
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so the table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _MEMORY_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list.

    Referenced ONLY from [`downgrade`]. That is load-bearing rather than
    stylistic: ``scripts/ci/check_coord_column_drops.py`` excludes
    ``downgrade()`` and every module-level helper reachable only from it, on the
    ground that a drop a downgrade performs does not LAND. A helper also
    reachable from ``upgrade()`` is scanned (fail-closed) and would report an
    unresolved site on an additive revision.
    """
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _MEMORY_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the nine memory-headroom columns to coord.ci_job_observations."""
    # The ALTER takes ACCESS EXCLUSIVE on a table coord's ci_job_sampler UPSERTs
    # every 120 s. Bound the wait so a blocked apply fails fast rather than
    # queueing in front of coord.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(_add_columns(_TABLE))

    # Column comments carry what a name cannot: the unit, whose ceiling a
    # denominator is, that peak_mem_used_mb is system-wide rather than a
    # process, that mem_total_mb is expected to be NULL — and, on every one of
    # them, that NULL is UNKNOWN and never 0. A reader who gets any of these
    # wrong builds a confidently-wrong gauge, which is the defect this whole
    # revision exists to close, and psql describe output is where a human
    # actually meets this schema.
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.peak_swap_used_mb IS
            'Maximum swap_used across the [sample] lines this job emitted, in '
            'MEGABYTES. Produced by resource-sampler.sh (qontinui-coord '
            '.github/scripts, INTERVAL=20s, system-wide free -m) and reduced '
            'the way extract-sampler-trend.sh already reduces it. NULL = '
            'UNKNOWN, meaning no sample was parsed for this job. NEVER 0: a 0 '
            'here asserts a job that never touched swap, which is the exact '
            'OPPOSITE claim from min_mem_avail_mb = 0 (a job that ran out of '
            'memory) about the SAME absence, and both would be fabrications. A '
            'job whose log carried no [sample] line at all - the OOM-killed '
            'case this column exists to catch, where the kernel takes the '
            'runner agent and the job never reaches its end - must read '
            'UNKNOWN on every resource column of the row. Latest measured '
            'green main run of coord-db-tests: 7981 of 12288 MB, 64.9 percent. '
            'Divide by NULLIF(swap_total_mb, 0), never by a hardcoded ceiling.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.swap_total_mb IS
            'The swap ceiling the JOB ITSELF reported, in MEGABYTES. On '
            'coord-db-tests today that is the 12288 MB swapfile the job '
            'creates in its own Add swap step - not a property of the runner '
            'image, and not a fleet constant. This is the DENOMINATOR of every '
            'swap-headroom ratio, so a consumer must NULLIF(swap_total_mb, 0): '
            'no CHECK forbids a zero, for the same reason '
            'device_resource_samples.swap_total_bytes allows one, since '
            'forbidding it would make an oddly-reporting job unable to report '
            'at all. NULL = UNKNOWN, never 0 and never replaced by a hardcoded '
            'constant - the ceiling changes the day coord-db-tests moves to a '
            'self-hosted runner, and a hardcoded denominator would silently '
            'become wrong on exactly the day the platform changed.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.min_mem_avail_mb IS
            'Floor of mem_avail across the samples of this job, in MEGABYTES, '
            'from the Mem: row of free -m. The strongest single signal on the '
            'row, and the one that needs NO denominator - which matters '
            'because the memory axis has no denominator yet (see '
            'mem_total_mb), while this arm works today. NULL = UNKNOWN, NEVER '
            '0: a 0 here reads as a job that ran out of memory, which is an '
            'assertion of the very fault this surface exists to detect, so a '
            'job with no parsed sample must render UNKNOWN and must not fire a '
            'detector. Latest measured green main run of coord-db-tests: 194 '
            'MB, which is inside the proposed breach band while GitHub '
            'reported the run green.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.peak_mem_used_mb IS
            'Peak SYSTEM-WIDE mem_used across the samples of this job, in '
            'MEGABYTES, from free -m over the whole runner. This is NOT a '
            'process resident set and must never be read as one. '
            'resource-sampler.sh contains no ps, no /proc/<pid>/status and no '
            'cgroup read - its memory and disk readings are free -m plus '
            'df -m /, and its only other /proc read is '
            '/proc/sys/kernel/osrelease for WSL lane detection, which measures '
            'nothing - so per-process rustc RSS is never sampled by this '
            'pipeline at all. '
            'The 13422 / 14264 / 15209 MB rustc figures in the '
            'coord-ci-memory-cliff dossier come from a separate hand method '
            'run on a developer box against origin/main, and must not be '
            'compared against this column. The column is deliberately not '
            'named peak_rss_mb. NULL = UNKNOWN, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.mem_total_mb IS
            'Total system memory in MEGABYTES - the denominator a memory '
            'headroom percentage would need. EXPECTED TO BE NULL for now, and '
            'that is the honest state rather than a gap to paper over: '
            'resource-sampler.sh resolves used and available from the Mem: row '
            'of free by column NAME and never reads total, so there is no '
            'mem_total= key in the wire format for a parser to find. Memory '
            'headroom as a percentage is therefore NOT computable today. SWAP '
            'headroom is, because swap_used and swap_total are both emitted, '
            'and the dossier argues swap is the better axis anyway - on a '
            'saturated box mem_used and mem_avail are pinned flat by the '
            'kernel reserve while swap moved +138.6 MB/day. A consumer renders '
            'memory headroom UNKNOWN with the reason named; it must never '
            'fabricate a percentage against a hardcoded 7 GB, which would '
            'silently become wrong the day coord-db-tests moves to the '
            'self-hosted box. Phase 5 of plan '
            '2026-09-20-ci-memory-headroom-in-the-dev-ops-console adds the key. '
            'NULL = UNKNOWN, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.min_disk_avail_mb IS
            'Floor of disk_avail on / across the samples of this job, in '
            'MEGABYTES, from df -m /. Disk exhaustion is a failure mode '
            'distinct from memory and one of the four shipped remediations was '
            'disk-space reclamation, so it is carried on the same row rather '
            'than inferred from a memory reading. NULL = UNKNOWN, NEVER 0: a 0 '
            'here reads as a full disk, which is a fault assertion rather than '
            'an absence of measurement.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.resource_sample_count IS
            'How many [sample] lines were parsed to produce the peaks and '
            'floors on this row. This is what the verdict RESTS ON and a '
            'reader is entitled to see it: a breach computed from 1 sample is '
            'not the same claim as one computed from 60, and a consumer that '
            'renders a verdict without it is hiding the difference. At '
            'INTERVAL=20s a 24-minute job yields roughly 70. NULL = UNKNOWN, '
            'meaning the log was not parsed at all. 0 is a LEGITIMATE and '
            'DIFFERENT reading - the log was read and carried no [sample] line '
            '- and in that case every peak and floor on this row is NULL, '
            'which is precisely the OOM signature.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.resource_span_secs IS
            'Seconds between the first and last parsed [sample] line - the '
            'window the peaks on this row actually cover. This is NOT '
            'duration_secs and must not be substituted for it: a job killed by '
            'the OOM reaper stops emitting before it ends, so a span far '
            'shorter than duration_secs is itself evidence about the incident '
            'rather than a rounding artefact. Read together with '
            'resource_sample_count: the two say what the peaks rest on. NULL = '
            'UNKNOWN and never 0 on an unparsed job - a 0 span is a real and '
            'different reading, meaning a single sample.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.resource_source IS
            'Provenance of the resource numbers on this row: job_log (parsed '
            'out of the streamed GitHub Actions job log, which is the only '
            'artefact that survives an OOM-killed runner agent - nothing after '
            'an agent kill can be uploaded, so only lines already streamed '
            'exist) or step_summary (a producer-pushed reduction, plausible '
            'later). NULL = UNKNOWN: the provenance was not recorded, which is '
            'never an empty string and never a guessed label. Free text with NO '
            'CHECK, '
            'matching the outcome and duration_band columns this table already '
            'ships without CHECKs and device_resource_samples.saturation_source: '
            'the vocabulary is open, ingest is best-effort, and a CHECK '
            'violation would fail the whole UPSERT and discard the timing, '
            'conclusion and outcome of the job over a provenance label. Adding '
            'a class stays a Rust PR rather than a migration. The writer that '
            'will populate it is coord Phase 2 of plan '
            '2026-09-20-ci-memory-headroom-in-the-dev-ops-console, which has '
            'not shipped as of this revision; validation of the label will be '
            'app-side at that door when it does. Until then this column is '
            'NULL on every row, which is UNKNOWN and not an empty vocabulary.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Remove the nine memory-headroom columns. Exact reverse of upgrade().

    The COMMENTs go with the columns — a column comment has no independent
    existence to remove. The TABLE is untouched: it belongs to
    ``coord_ci_job_observations_01``, not to this revision, and coord's sampler
    writes it continuously.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_drop_columns(_TABLE))
    op.execute("SET LOCAL lock_timeout = DEFAULT")
