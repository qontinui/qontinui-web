"""coord.ci_job_observations — COMMENTs the report-sourced rows contradict

Revision ID: ci_job_res_02
Revises: coord_agent_sessions_identity_01
Create Date: 2026-11-02

Follow-up to ``ci_job_res_01`` (plan
``2026-10-27-coord-routes-ci-jobs-by-runner-capability`` Phase 3).

COMMENTs only: no column, type, data or index changes, so coord's
``schema.manifest`` object lines do not move (coord's fingerprint excludes
comments) and no deploy ordering applies.

``ci_job_res_01`` re-commented ``mem_total_mb`` because coord's report-sourced
rows would contradict ``ci_job_mem_01``'s text. The same report key map fills
or leaves empty five more ``ci_job_mem_01`` columns, and coord's
``ci_job_sampler`` has been writing ``resource_source = 'job_annotation'`` since
``cb4dbf457``, so this text is now wrong about what those rows hold:

=================  ==========================================================
column             what ``ci_job_mem_01`` says, and what a report row holds
=================  ==========================================================
resource_source    "job_log or step_summary", no writer, "NULL on every row".
                   coord writes ``job_annotation``; ``job_log`` is unbuilt.
peak_swap_used_mb  "NEVER 0" and only [sample] lines. 0 is a real reading on a
                   report row.
swap_total_mb      Silent that 0 is a real reading (on Linux) and that a
                   self-hosted figure is the host's swap.
min_disk_avail_mb  "NEVER 0" and only df -m / samples. 0 (a full disk) is a real
                   reading on a report row.
min_mem_avail_mb   "No denominator yet (see mem_total_mb)", which ``ci_job_res_01``
                   ended; no writer fills this column at all.
peak_mem_used_mb   resource-sampler.sh has "no cgroup read", which it now does;
                   no writer fills this column at all.
=================  ==========================================================

A consumer that follows "NEVER 0" discards a real full-disk or no-swap reading
as corrupt. The parser is coord's ``ci_resource_report.rs``; coord's emitter is
``.github/scripts/resource-sampler.sh``.

qontinui-runner's emitter (``scripts/ci/resource-report.sh``) is in open PR
qontinui-runner#2421, not on its ``main``, and the Windows and single-reading
sentences below describe that PR at ``a83faf885``. They name the PR for that
reason. A change to its ``--disk-path`` or its pagefile keys needs a rewrite
here. ``mem_total_mb``, ``resource_sample_count`` and ``resource_span_secs``
keep their text.

``downgrade()`` restores ``ci_job_mem_01``'s six texts byte for byte; the
companion test checks them against that revision's source, their one author.

Not corrected here: ``ci_job_res_01``'s docstring says "Five keys" above a table
of four. Editing that revision fails ``Migration Reversal Tested`` (it holds
f-string fields, so it cannot qualify as a non-executable edit).

Head choice: ``down_revision`` is the single alembic head on ``origin/main`` at
``4e91eb240``. If another alembic PR lands first, re-point ``down_revision``,
the ``Revises:`` header and ``_PARENT_REVISION_ID`` in the companion test
together. No ``alembic merge``. Hand-authored; ``--autogenerate`` is never run
against ``coord.*``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ci_job_res_02"
down_revision: str | Sequence[str] | None = "coord_agent_sessions_identity_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.ci_job_observations"

# ``ci_job_mem_01``'s COMMENTs on the six columns ``upgrade()`` rewrites, which
# ``downgrade()`` restores. Byte-identical on purpose; the companion test checks
# them against ``ci_job_mem_01``'s own source, so a drift reds there.
_PRIOR_COMMENTS: dict[str, str] = {
    "peak_swap_used_mb": (
        "Maximum swap_used across the [sample] lines this job emitted, in "
        "MEGABYTES. Produced by resource-sampler.sh (qontinui-coord "
        ".github/scripts, INTERVAL=20s, system-wide free -m) and reduced the"
        " way extract-sampler-trend.sh already reduces it. NULL = UNKNOWN, "
        "meaning no sample was parsed for this job. NEVER 0: a 0 here "
        "asserts a job that never touched swap, which is the exact OPPOSITE "
        "claim from min_mem_avail_mb = 0 (a job that ran out of memory) "
        "about the SAME absence, and both would be fabrications. A job whose"
        " log carried no [sample] line at all - the OOM-killed case this "
        "column exists to catch, where the kernel takes the runner agent and"
        " the job never reaches its end - must read UNKNOWN on every "
        "resource column of the row. Latest measured green main run of "
        "coord-db-tests: 7981 of 12288 MB, 64.9 percent. Divide by "
        "NULLIF(swap_total_mb, 0), never by a hardcoded ceiling."
    ),
    "swap_total_mb": (
        "The swap ceiling the JOB ITSELF reported, in MEGABYTES. On "
        "coord-db-tests today that is the 12288 MB swapfile the job creates "
        "in its own Add swap step - not a property of the runner image, and "
        "not a fleet constant. This is the DENOMINATOR of every "
        "swap-headroom ratio, so a consumer must NULLIF(swap_total_mb, 0): "
        "no CHECK forbids a zero, for the same reason "
        "device_resource_samples.swap_total_bytes allows one, since "
        "forbidding it would make an oddly-reporting job unable to report at"
        " all. NULL = UNKNOWN, never 0 and never replaced by a hardcoded "
        "constant - the ceiling changes the day coord-db-tests moves to a "
        "self-hosted runner, and a hardcoded denominator would silently "
        "become wrong on exactly the day the platform changed."
    ),
    "min_disk_avail_mb": (
        "Floor of disk_avail on / across the samples of this job, in "
        "MEGABYTES, from df -m /. Disk exhaustion is a failure mode distinct"
        " from memory and one of the four shipped remediations was "
        "disk-space reclamation, so it is carried on the same row rather "
        "than inferred from a memory reading. NULL = UNKNOWN, NEVER 0: a 0 "
        "here reads as a full disk, which is a fault assertion rather than "
        "an absence of measurement."
    ),
    "min_mem_avail_mb": (
        "Floor of mem_avail across the samples of this job, in MEGABYTES, "
        "from the Mem: row of free -m. The strongest single signal on the "
        "row, and the one that needs NO denominator - which matters because "
        "the memory axis has no denominator yet (see mem_total_mb), while "
        "this arm works today. NULL = UNKNOWN, NEVER 0: a 0 here reads as a "
        "job that ran out of memory, which is an assertion of the very fault"
        " this surface exists to detect, so a job with no parsed sample must"
        " render UNKNOWN and must not fire a detector. Latest measured green"
        " main run of coord-db-tests: 194 MB, which is inside the proposed "
        "breach band while GitHub reported the run green."
    ),
    "peak_mem_used_mb": (
        "Peak SYSTEM-WIDE mem_used across the samples of this job, in "
        "MEGABYTES, from free -m over the whole runner. This is NOT a "
        "process resident set and must never be read as one. "
        "resource-sampler.sh contains no ps, no /proc/<pid>/status and no "
        "cgroup read - its memory and disk readings are free -m plus df -m "
        "/, and its only other /proc read is /proc/sys/kernel/osrelease for "
        "WSL lane detection, which measures nothing - so per-process rustc "
        "RSS is never sampled by this pipeline at all. The 13422 / 14264 / "
        "15209 MB rustc figures in the coord-ci-memory-cliff dossier come "
        "from a separate hand method run on a developer box against "
        "origin/main, and must not be compared against this column. The "
        "column is deliberately not named peak_rss_mb. NULL = UNKNOWN, never"
        " 0."
    ),
    "resource_source": (
        "Provenance of the resource numbers on this row: job_log (parsed out"
        " of the streamed GitHub Actions job log, which is the only artefact"
        " that survives an OOM-killed runner agent - nothing after an agent "
        "kill can be uploaded, so only lines already streamed exist) or "
        "step_summary (a producer-pushed reduction, plausible later). NULL ="
        " UNKNOWN: the provenance was not recorded, which is never an empty "
        "string and never a guessed label. Free text with NO CHECK, matching"
        " the outcome and duration_band columns this table already ships "
        "without CHECKs and device_resource_samples.saturation_source: the "
        "vocabulary is open, ingest is best-effort, and a CHECK violation "
        "would fail the whole UPSERT and discard the timing, conclusion and "
        "outcome of the job over a provenance label. Adding a class stays a "
        "Rust PR rather than a migration. The writer that will populate it "
        "is coord Phase 2 of plan "
        "2026-09-20-ci-memory-headroom-in-the-dev-ops-console, which has not"
        " shipped as of this revision; validation of the label will be "
        "app-side at that door when it does. Until then this column is NULL "
        "on every row, which is UNKNOWN and not an empty vocabulary."
    ),
}


def upgrade() -> None:
    """Rewrite six COMMENTs to say what report-sourced rows actually hold."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.peak_swap_used_mb IS
            'Peak swap or pagefile use of the job, in MEGABYTES. What it '
            'measures depends on resource_source, so read the two together. '
            'job_annotation: the qontinui-resource-report key '
            'pagefile_peak_mb, emitted only on a GitHub-hosted runner, whose '
            'VM is the job''s own. In qontinui-coord''s report '
            '(resource-sampler.sh) it is the largest swap_used any sampled '
            'window saw. In qontinui-runner''s Windows report '
            '(qontinui-runner#2421) it is PeakUsage of the one pagefile, '
            'which counts from boot and is omitted when there is more than '
            'one pagefile. job_log, whose arm is not built: the maximum '
            'swap_used across the [sample] lines the job emitted; a job whose'
            ' log carried no [sample] line, the OOM-killed case, must read '
            'UNKNOWN on every resource column of the row. 0 IS A REAL READING'
            ' on a job_annotation row: the job used no swap. NULL = UNKNOWN: '
            'no report was written, the key was omitted or rejected, or the '
            'runner was self-hosted, where these figures are the host''s '
            'rather than the job''s. Never coalesce NULL to 0, which asserts '
            'a job that never touched swap. Divide by NULLIF(swap_total_mb, '
            '0), never by a hardcoded ceiling.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.swap_total_mb IS
            'The swap or pagefile capacity the job RAN WITH, in MEGABYTES, as'
            ' the job itself reported it. What it measures depends on '
            'resource_source, so read the two together. job_annotation: the '
            'qontinui-resource-report key pagefile_alloc_mb. On Linux that is'
            ' SwapTotal at report time, or in qontinui-coord''s report else '
            'the largest swap_total sampled. In qontinui-runner''s Windows '
            'report (qontinui-runner#2421) it is the summed AllocatedBaseSize'
            ' of Win32_PageFileUsage. It includes anything the job added '
            'itself, such as the swapfile of an Add swap step or the pagefile'
            ' of a Configure pagefile step, so on a GitHub-hosted runner it '
            'is not a property of the runner image. On a self-hosted runner '
            'those steps are skipped and it is the host''s swap. It is never '
            'a fleet constant. This is the DENOMINATOR of every swap-headroom'
            ' ratio, so a consumer must NULLIF(swap_total_mb, 0): on Linux 0 '
            'IS A REAL READING on a job_annotation row, a machine with no '
            'swap, and no CHECK forbids it. A Windows machine with no '
            'pagefile omits the key and reads NULL (qontinui-runner#2421). '
            'NULL = UNKNOWN, never coalesced to 0 and never replaced by a '
            'hardcoded constant: the ceiling changes when a job moves between'
            ' a hosted and a self-hosted runner, and a hardcoded denominator '
            'would silently become wrong on exactly that day.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.min_disk_avail_mb IS
            'Free disk at the job''s fullest observed point, in MEGABYTES. '
            'What it measures depends on resource_source, so read the two '
            'together. job_annotation: the qontinui-resource-report key '
            'disk_free_min_mb. qontinui-coord''s report takes the smallest '
            'disk_avail it sampled on /, or its own final reading if that is '
            'lower. qontinui-runner''s report (qontinui-runner#2421) takes '
            'ONE reading of the volume holding the job''s workspace, in the '
            'job''s last step, when target/ is at its largest. job_log, whose'
            ' arm is not built: the floor of disk_avail on / across the '
            '[sample] lines, from df -m /. Disk exhaustion is a failure mode '
            'distinct from memory, so it is carried on the same row rather '
            'than inferred from a memory reading. 0 IS A REAL READING on a '
            'job_annotation row: a full disk. NULL = UNKNOWN: no report was '
            'written, or the key was omitted or rejected. Never coalesce NULL'
            ' to 0, which asserts a full disk, a fault, about an absence of '
            'measurement.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.min_mem_avail_mb IS
            'Floor of mem_avail across the [sample] lines of this job, in '
            'MEGABYTES, from the Mem: row of free -m. The strongest single '
            'signal of the job_log arm, and one that needs NO denominator. '
            'That arm (plan '
            '2026-09-20-ci-memory-headroom-in-the-dev-ops-console Phase 2) is'
            ' not built, and the qontinui-resource-report has no such key, so'
            ' resource_source = job_annotation rows leave this NULL and no '
            'row carries it yet. NULL = UNKNOWN, NEVER 0: a 0 here reads as a'
            ' job that ran out of memory, which is an assertion of the very '
            'fault this surface exists to detect, so a job with no parsed '
            'sample must render UNKNOWN and must not fire a detector.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.peak_mem_used_mb IS
            'Peak SYSTEM-WIDE mem_used across the [sample] lines of this job,'
            ' in MEGABYTES, from free -m over the whole runner. This is NOT a'
            ' process resident set or a cgroup figure and must never be read '
            'as one. The job''s own anonymous memory is peak_anon_mem_mb. The'
            ' arm that would fill this column (plan '
            '2026-09-20-ci-memory-headroom-in-the-dev-ops-console Phase 2) is'
            ' not built, and the qontinui-resource-report has no such key, so'
            ' resource_source = job_annotation rows leave this NULL and no '
            'row carries it yet. The 13422 / 14264 / 15209 MB rustc figures '
            'in the coord-ci-memory-cliff dossier come from a separate hand '
            'method run on a developer box against origin/main, and must not '
            'be compared against this column. The column is deliberately not '
            'named peak_rss_mb. NULL = UNKNOWN, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.resource_source IS
            'Provenance of the resource numbers on this row. The numbers mean'
            ' different things by provenance, so read every resource column '
            'together with it. job_annotation: the job''s '
            'qontinui-resource-report check-run annotation, written by '
            'coord''s ci_job_sampler since plan '
            '2026-10-27-coord-routes-ci-jobs-by-runner-capability Phase 3. It'
            ' is one report per job, with peaks the emitter reduced itself, '
            'so resource_sample_count, resource_span_secs, min_mem_avail_mb '
            'and peak_mem_used_mb stay NULL on such a row. job_log: parsed '
            'out of the streamed GitHub Actions job log, which is the only '
            'artefact that survives an OOM-killed runner agent. That is plan '
            '2026-09-20-ci-memory-headroom-in-the-dev-ops-console Phase 2 and'
            ' it is not built, so no row carries it yet; when it is, it joins'
            ' the same writer. step_summary: a producer-pushed reduction, '
            'plausible later, with no writer. NULL = UNKNOWN: no report was '
            'read for this job, or what was read was rejected or ambiguous, '
            'which is never an empty string and never a guessed label. Free '
            'text with NO CHECK, matching the outcome and duration_band '
            'columns this table already ships without CHECKs and '
            'device_resource_samples.saturation_source: the vocabulary is '
            'open, ingest is best-effort, and a CHECK violation would fail '
            'the whole UPSERT and discard the timing, conclusion and outcome '
            'of the job over a provenance label. Adding a class stays a coord'
            ' PR, validated app-side, plus a rewrite of this COMMENT.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Restore ``ci_job_mem_01``'s six COMMENTs. Exact reverse of upgrade()."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    for column, comment in _PRIOR_COMMENTS.items():
        escaped = comment.replace("'", "''")
        op.execute(f"COMMENT ON COLUMN {_TABLE}.{column} IS '{escaped}'")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
