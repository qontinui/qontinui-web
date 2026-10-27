"""coord.merge_candidates, coord.merge_candidate_members, coord.merge_verdict_heads, coord.merge_lane_hourly, and coord.ci_job_observations.steps — the merge-lane capture stores

Revision ID: merge_capture_01
Revises: presentation_scope_01
Create Date: 2026-10-27

Slice B of Phase 1 (schema half) of plan
``2026-10-19-the-merge-theory-has-no-data-to-test-it-against`` (its D3, D4, D5
and D9). The merge theory names a cycle, a per-head verdict and a red
attribution that coord does not keep: candidate facts are overwritten per
attempt (``merge_proposal_repos.rebase_result``), a bisected batch loses its
membership (``merge_proposals.batch_id`` is cleared), and ``predicate_eval``
rows are coalesced in place. This revision adds the durable stores coord's
capture writes; the writers live in the coord PR (``merge_lane_capture``).

``coord.merge_candidates`` — one row per candidate ATTEMPT (plan D3)
    Every cut is a row: re-cuts, batches, speculative entries, bisect
    children, and the lands that never had a candidate ref (``ac_cache``,
    ``ci_skip``, ``ff_reuse``, ``expedited``, or ``unknown`` when coord's
    records cannot tell which). ``candidate_key`` is the writer-computed
    natural key of one PUSH: ``<candidate ref>@<tip sha>#<ledger id>`` for a
    pushed candidate and ``<kind>:land@<land sha>#<ledger id>`` for a land with
    no candidate ref, where the ledger id is the ``coord.git_write_ledger`` row
    of that push (kept in ``ledger_id`` too). Keying on the push rather than
    on the tip keeps two cuts that produce the same tip — a re-cut onto an
    unmoved base, or a re-emit pinned to the same parent — as two rows.
    ``uq_merge_candidates_repo_key`` is the conflict target of the writer's
    idempotent ``INSERT … ON CONFLICT (repo, candidate_key)``, so a projector
    re-run or the 90-day backfill writes nothing twice.

    ``base_sha`` is the tip the candidate was cut onto; ``base_basis`` names
    how it was established (``rebase_result``, ``speculative_chain``,
    ``land_parent``, ``scheduler_tick``, ``expedited_request``) and is set
    with it or not at all (``ck_merge_candidates_base_paired``). A candidate
    whose base was never stored has both NULL: UNKNOWN, never guessed.

    ``outcome`` is NULL while the candidate is open and is set with
    ``outcome_at``. ``land_sha`` and ``landed_at`` are set together
    (``ck_merge_candidates_land_fields_paired``), and exactly when ``outcome``
    is ``landed`` (``ck_merge_candidates_land_paired``). ``ci_red_at`` is the
    first failing conclusion observed on the tip; it survives a later green
    re-run, which is how a flake stays visible. ``recut_cause`` says why a
    green (or never-concluded) candidate was superseded: the slice-B writer
    sets ``base_moved`` only when the next cut's base is known to differ and
    ``unknown`` otherwise, and ``land_seam_deferral`` /
    ``precondition_deferral`` are reserved for a later writer that reads the
    deferral seams. ``run_class`` (plan D4: content, flake, infra,
    red_unclassified) is named so it cannot be confused with
    ``merge_proposals.failure_class``'s seven per-proposal literals.

``coord.merge_candidate_members`` — one row per member of a candidate (D3/D4)
    ``member_outcome`` is D4's attribution: passed, red_alone,
    red_against_main, interaction, flake, infra, cancelled or unknown. NULL
    means not attributed yet (the candidate is still open); ``unknown`` means
    the attribution ran and no evidence settled it — never ``passed``.
    ``attribution_basis`` / ``attribution_ref`` say which evidence rule
    decided it; the basis vocabulary is the attribution worker's, so it is
    free text here. ``lands_between`` is D4's J — NULL until counted.
    ``cut_at`` repeats the candidate's, so the two tables are swept on one
    clock and a backfilled member never outlives its candidate.

``coord.merge_verdict_heads`` — one row per (repo, PR, head) the verdict stage evaluated (D5)
    Written for every evaluation that recorded a verdict, on every replica
    (followers evaluate too); an evaluation that ends before recording a
    verdict is not counted. ``first_verdict`` / ``last_verdict`` are the
    predicate's block reason code (``none`` for a pass); the
    ``*_disposition`` columns carry coord's ``BlockDisposition`` for it —
    NULL on a pass — and are free text because that vocabulary is coord's.
    ``first_decisive_verdict`` and ``first_decisive_at`` are set together
    (``ck_merge_verdict_heads_decisive_paired``), for the first verdict that
    left nothing for the stage to wait on: a pass, or a block only an author,
    an operator or nothing can move. ``first_decisive_disposition`` is NULL
    when that verdict was a pass.

    ``recent_eval_at`` holds the instants of the head's newest evaluations,
    ascending, at most 64 of them. It keeps two measures exact without a row
    per evaluation: whether an evaluation is the head's first in its hour
    (``merge_lane_hourly.distinct_heads``), and which evaluations came after
    the PR had moved on (the stale-head count below).

    ``pushed_at`` is the earliest evidence of the head's push, and
    ``pushed_basis`` names it: ``pull_request_webhook`` (the first
    ``pull_request`` webhook coord received carrying this head),
    ``check_run`` (the earliest GitHub-stamped CI start on it) or
    ``first_evaluation`` (coord's own first evaluation, when nothing earlier
    is known). Each is an upper bound on the push; the webhook is usually
    within delivery latency of it. They are set together
    (``ck_merge_verdict_heads_pushed_paired``).

    ``superseded_at`` is the next head's ``pushed_at``, or the PR's merge
    time when it merged at a head coord never evaluated (basis
    ``pr_merged``); ``superseded_basis`` names the evidence.
    ``stale_eval_count`` is how many of this head's evaluations came after
    ``superseded_at`` — verdicts spent on a head the PR had already left,
    which happens when coord misses a ``synchronize``. ``superseded_at`` is
    an upper bound and only the newest 64 instants are kept, so the count is
    a LOWER bound. The three are set together
    (``ck_merge_verdict_heads_superseded_paired``).

    ``outcome`` (landed, closed, superseded) is filled at land, close or the
    next head, and is censored — NULL — until then; ``outcome_at`` is when
    coord recorded it.

``coord.merge_lane_hourly`` — the per-repo hourly rollup (D5, D6, D9)
    Two kinds of column. LIVE counters start at zero and are incremented as
    things happen: ``evaluations``, ``follower_evaluations``,
    ``decisive_evaluations`` and ``distinct_heads`` (a head counts once in
    each hour it was evaluated in) by the evaluation writer, and the
    queue-depth sample sum and count by the leader's capture tick.
    ``reeval_seated`` / ``reeval_deferred`` (``{reason: count}``) are live
    too, written by the reconciler's selection; NULL means no selection
    seated or deferred one of the repo's PRs in that hour.

    ROLLED-UP measures are NULL until the hour is rolled up, and NULL is
    UNKNOWN, never zero; ``unknown_reasons`` names why a rolled-up measure
    could not be computed. ``stale_evaluations`` is a lower bound like the
    per-head count, and is re-rolled as supersessions become known.
    ``decision_code_seconds`` is time-weighted, because the scheduler trace
    writes a row only when its decision changes or a heartbeat elapses.
    ``lane_state_seconds`` stays NULL until the lane-state ledger (plan Phase
    1b) exists. ``hour`` is a whole UTC hour
    (``ck_merge_lane_hourly_hour_aligned``, which reads the epoch, so it does
    not depend on the session time zone).

``coord.ci_job_observations.steps`` — per-step timings for a sampled job (Phase 1d)
    jsonb, NULL when no steps were stored (UNKNOWN, never "no steps"). It
    shares the job row's 30-day retention; the long trend comes from the
    hourly rollup, not from step rows (plan Phase 1, vet resolution 4).

No foreign keys: a candidate is history that must not follow a proposal,
batch, repo or tenant deletion, and members and verdict heads outlive the
rows they describe. Retention is coord's ``table_retention`` sweeps (400
days, plan D9): candidates and members on ``cut_at``, verdict heads on
``first_eval_at``, the rollup on ``hour``. No index covers a column that every
evaluation rewrites, so the evaluation writer's updates stay eligible for
HOT (heap-only) updates.

Hand-authored; ``alembic revision --autogenerate`` was not run and is never
run against ``coord.*``. coord authors **zero** DDL
(``[policy: production-and-cost alembic-sole-authorship]``), so this revision
must merge and apply **before** the coord PR that reads and writes these
tables. Plan intent for the coord side: until this has applied, the writers
log and skip, and nothing crashes.

Locks: the four tables are new, so creating them and their indexes locks no
existing relation. ``ADD COLUMN steps`` is a nullable column with no default,
a catalog-only change, but it still takes ACCESS EXCLUSIVE on
``coord.ci_job_observations``, which coord's sampler writes every 120 s, so
both directions bound their wait with ``SET LOCAL lock_timeout``.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, matching the
``coord.*`` migration house style.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "merge_capture_01"
down_revision: str | Sequence[str] | None = "presentation_scope_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The ALTER below takes ACCESS EXCLUSIVE on a table coord's ci_job_sampler
    # UPSERTs every 120 s. Bound the wait so a blocked apply fails fast rather
    # than queueing in front of coord.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.merge_candidates (
            candidate_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            UUID        NOT NULL,
            repo                 TEXT        NOT NULL,
            candidate_key        TEXT        NOT NULL,
            kind                 TEXT        NOT NULL,
            candidate_ref        TEXT        NULL,
            ledger_id            BIGINT      NULL,
            proposal_id          UUID        NULL,
            batch_id             UUID        NULL,
            base_sha             TEXT        NULL,
            base_basis           TEXT        NULL,
            tip_sha              TEXT        NOT NULL,
            retry_of             UUID        NULL,
            parent_candidate_id  UUID        NULL,
            chain_position       INTEGER     NULL,
            cut_at               TIMESTAMPTZ NOT NULL,
            pushed_at            TIMESTAMPTZ NULL,
            ci_first_job_at      TIMESTAMPTZ NULL,
            ci_concluded_at      TIMESTAMPTZ NULL,
            ci_red_at            TIMESTAMPTZ NULL,
            ci_attempts          INTEGER     NULL,
            outcome              TEXT        NULL,
            outcome_at           TIMESTAMPTZ NULL,
            recut_cause          TEXT        NULL,
            run_class            TEXT        NULL,
            land_sha             TEXT        NULL,
            landed_at            TIMESTAMPTZ NULL,
            land_route           TEXT        NULL,
            source               TEXT        NOT NULL DEFAULT 'observed',
            evidence             JSONB       NOT NULL DEFAULT '{}'::jsonb,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_merge_candidates_repo_key UNIQUE (repo, candidate_key),
            CONSTRAINT ck_merge_candidates_kind
                CHECK (kind IN (
                    'singleton', 'batch', 'speculative', 'bisect_child',
                    'ci_skip', 'ff_reuse', 'ac_cache', 'expedited', 'unknown',
                    'ctl_landing', 'ctl_cert', 'ctl_hedge'
                )),
            CONSTRAINT ck_merge_candidates_base_basis
                CHECK (base_basis IS NULL OR base_basis IN (
                    'rebase_result', 'speculative_chain', 'land_parent',
                    'scheduler_tick', 'expedited_request'
                )),
            CONSTRAINT ck_merge_candidates_base_paired
                CHECK ((base_sha IS NULL) = (base_basis IS NULL)),
            CONSTRAINT ck_merge_candidates_chain_position
                CHECK (chain_position IS NULL OR chain_position >= 0),
            CONSTRAINT ck_merge_candidates_outcome
                CHECK (outcome IS NULL OR outcome IN (
                    'landed', 'red', 'cancelled', 'superseded', 'voided',
                    'abandoned', 'unknown'
                )),
            CONSTRAINT ck_merge_candidates_outcome_paired
                CHECK ((outcome IS NULL) = (outcome_at IS NULL)),
            CONSTRAINT ck_merge_candidates_land_fields_paired
                CHECK ((land_sha IS NULL) = (landed_at IS NULL)),
            CONSTRAINT ck_merge_candidates_land_paired
                CHECK (
                    (outcome IS NOT DISTINCT FROM 'landed')
                    = (land_sha IS NOT NULL AND landed_at IS NOT NULL)
                ),
            CONSTRAINT ck_merge_candidates_recut_cause
                CHECK (recut_cause IS NULL OR recut_cause IN (
                    'base_moved', 'land_seam_deferral', 'precondition_deferral',
                    'unknown'
                )),
            CONSTRAINT ck_merge_candidates_run_class
                CHECK (run_class IS NULL OR run_class IN (
                    'content', 'flake', 'infra', 'red_unclassified'
                )),
            CONSTRAINT ck_merge_candidates_ci_attempts
                CHECK (ci_attempts IS NULL OR ci_attempts >= 0),
            CONSTRAINT ck_merge_candidates_source
                CHECK (source IN ('observed', 'backfill'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidates_tenant_repo_cut
            ON coord.merge_candidates (tenant_id, repo, cut_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidates_repo_tip
            ON coord.merge_candidates (repo, tip_sha)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidates_open
            ON coord.merge_candidates (repo)
            WHERE outcome IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidates_proposal
            ON coord.merge_candidates (proposal_id)
            WHERE proposal_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidates_batch
            ON coord.merge_candidates (batch_id)
            WHERE batch_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidates_cut_at
            ON coord.merge_candidates (cut_at)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.merge_candidate_members (
            candidate_id       UUID        NOT NULL,
            member_position    INTEGER     NOT NULL,
            tenant_id          UUID        NOT NULL,
            repo               TEXT        NOT NULL,
            cut_at             TIMESTAMPTZ NOT NULL,
            proposal_id        UUID        NULL,
            pr_number          INTEGER     NULL,
            head_sha           TEXT        NULL,
            member_outcome     TEXT        NULL,
            attribution_basis  TEXT        NULL,
            attribution_ref    JSONB       NULL,
            lands_between      INTEGER     NULL,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT merge_candidate_members_pkey
                PRIMARY KEY (candidate_id, member_position),
            CONSTRAINT ck_merge_candidate_members_position
                CHECK (member_position >= 0),
            CONSTRAINT ck_merge_candidate_members_outcome
                CHECK (member_outcome IS NULL OR member_outcome IN (
                    'passed', 'red_alone', 'red_against_main', 'interaction',
                    'flake', 'infra', 'cancelled', 'unknown'
                )),
            CONSTRAINT ck_merge_candidate_members_lands_between
                CHECK (lands_between IS NULL OR lands_between >= 0)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidate_members_repo_pr
            ON coord.merge_candidate_members (repo, pr_number)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_candidate_members_cut_at
            ON coord.merge_candidate_members (cut_at)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.merge_verdict_heads (
            tenant_id                   UUID          NOT NULL,
            repo                        TEXT          NOT NULL,
            pr_number                   INTEGER       NOT NULL,
            head_sha                    TEXT          NOT NULL,
            pushed_at                   TIMESTAMPTZ   NULL,
            pushed_basis                TEXT          NULL,
            first_eval_at               TIMESTAMPTZ   NOT NULL,
            last_eval_at                TIMESTAMPTZ   NOT NULL,
            eval_count                  INTEGER       NOT NULL,
            follower_eval_count         INTEGER       NOT NULL,
            recent_eval_at              TIMESTAMPTZ[] NOT NULL,
            first_verdict               TEXT          NOT NULL,
            first_disposition           TEXT          NULL,
            first_decisive_verdict      TEXT          NULL,
            first_decisive_disposition  TEXT          NULL,
            first_decisive_at           TIMESTAMPTZ   NULL,
            last_verdict                TEXT          NOT NULL,
            last_disposition            TEXT          NULL,
            superseded_at               TIMESTAMPTZ   NULL,
            superseded_basis            TEXT          NULL,
            stale_eval_count            INTEGER       NULL,
            outcome                     TEXT          NULL,
            outcome_at                  TIMESTAMPTZ   NULL,
            updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
            CONSTRAINT merge_verdict_heads_pkey
                PRIMARY KEY (repo, pr_number, head_sha),
            CONSTRAINT ck_merge_verdict_heads_counts
                CHECK (
                    eval_count >= 1
                    AND follower_eval_count >= 0
                    AND follower_eval_count <= eval_count
                ),
            CONSTRAINT ck_merge_verdict_heads_eval_order
                CHECK (last_eval_at >= first_eval_at),
            CONSTRAINT ck_merge_verdict_heads_recent_evals
                CHECK (
                    cardinality(recent_eval_at) BETWEEN 1 AND 64
                    AND cardinality(recent_eval_at) <= eval_count
                ),
            CONSTRAINT ck_merge_verdict_heads_pushed_basis
                CHECK (pushed_basis IS NULL OR pushed_basis IN (
                    'pull_request_webhook', 'check_run', 'first_evaluation'
                )),
            CONSTRAINT ck_merge_verdict_heads_pushed_paired
                CHECK ((pushed_at IS NULL) = (pushed_basis IS NULL)),
            CONSTRAINT ck_merge_verdict_heads_decisive_paired
                CHECK ((first_decisive_verdict IS NULL) = (first_decisive_at IS NULL)),
            CONSTRAINT ck_merge_verdict_heads_superseded_basis
                CHECK (superseded_basis IS NULL OR superseded_basis IN (
                    'pull_request_webhook', 'check_run', 'first_evaluation',
                    'pr_merged'
                )),
            CONSTRAINT ck_merge_verdict_heads_superseded_paired
                CHECK (
                    (superseded_at IS NULL) = (superseded_basis IS NULL)
                    AND (superseded_at IS NULL) = (stale_eval_count IS NULL)
                ),
            CONSTRAINT ck_merge_verdict_heads_stale_eval_count
                CHECK (
                    stale_eval_count IS NULL
                    OR (stale_eval_count >= 0 AND stale_eval_count <= eval_count)
                ),
            CONSTRAINT ck_merge_verdict_heads_outcome
                CHECK (outcome IS NULL OR outcome IN ('landed', 'closed', 'superseded')),
            CONSTRAINT ck_merge_verdict_heads_outcome_paired
                CHECK ((outcome IS NULL) = (outcome_at IS NULL))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_verdict_heads_tenant_repo_first
            ON coord.merge_verdict_heads (tenant_id, repo, first_eval_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_verdict_heads_open
            ON coord.merge_verdict_heads (repo, pr_number)
            WHERE outcome IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_verdict_heads_superseded
            ON coord.merge_verdict_heads (outcome_at)
            WHERE outcome = 'superseded'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_verdict_heads_first_eval
            ON coord.merge_verdict_heads (first_eval_at)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.merge_lane_hourly (
            tenant_id               UUID             NOT NULL,
            repo                    TEXT             NOT NULL,
            hour                    TIMESTAMPTZ      NOT NULL,
            evaluations             INTEGER          NOT NULL DEFAULT 0,
            follower_evaluations    INTEGER          NOT NULL DEFAULT 0,
            decisive_evaluations    INTEGER          NOT NULL DEFAULT 0,
            distinct_heads          INTEGER          NOT NULL DEFAULT 0,
            queue_depth_sample_sum  BIGINT           NOT NULL DEFAULT 0,
            queue_depth_samples     INTEGER          NOT NULL DEFAULT 0,
            reeval_seated           JSONB            NULL,
            reeval_deferred         JSONB            NULL,
            stale_evaluations       INTEGER          NULL,
            heads_first_decisive    INTEGER          NULL,
            decisive_latency_secs   JSONB            NULL,
            verdict_age_secs        JSONB            NULL,
            decision_code_seconds   JSONB            NULL,
            dominant_decision_code  TEXT             NULL,
            admissions              INTEGER          NULL,
            candidates_cut          INTEGER          NULL,
            candidates_landed       INTEGER          NULL,
            candidates_red          INTEGER          NULL,
            session_hours           DOUBLE PRECISION NULL,
            lane_state_seconds      JSONB            NULL,
            unknown_reasons         JSONB            NOT NULL DEFAULT '{}'::jsonb,
            rolled_up_at            TIMESTAMPTZ      NULL,
            updated_at              TIMESTAMPTZ      NOT NULL DEFAULT now(),
            CONSTRAINT merge_lane_hourly_pkey PRIMARY KEY (repo, hour),
            CONSTRAINT ck_merge_lane_hourly_hour_aligned
                CHECK (extract(epoch FROM hour) % 3600 = 0),
            CONSTRAINT ck_merge_lane_hourly_counts
                CHECK (
                    evaluations >= 0
                    AND follower_evaluations >= 0
                    AND decisive_evaluations >= 0
                    AND distinct_heads >= 0
                    AND follower_evaluations <= evaluations
                    AND decisive_evaluations <= evaluations
                    AND distinct_heads <= evaluations
                    AND queue_depth_sample_sum >= 0
                    AND queue_depth_samples >= 0
                ),
            CONSTRAINT ck_merge_lane_hourly_rolled_counts
                CHECK (
                    (stale_evaluations IS NULL OR stale_evaluations >= 0)
                    AND (heads_first_decisive IS NULL OR heads_first_decisive >= 0)
                    AND (admissions IS NULL OR admissions >= 0)
                    AND (candidates_cut IS NULL OR candidates_cut >= 0)
                    AND (candidates_landed IS NULL OR candidates_landed >= 0)
                    AND (candidates_red IS NULL OR candidates_red >= 0)
                    AND (session_hours IS NULL OR session_hours >= 0)
                )
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_lane_hourly_tenant_repo_hour
            ON coord.merge_lane_hourly (tenant_id, repo, hour DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_lane_hourly_hour
            ON coord.merge_lane_hourly (hour)
        """
    )

    op.execute(
        """
        ALTER TABLE coord.ci_job_observations
            ADD COLUMN IF NOT EXISTS steps JSONB NULL
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.steps IS
            'Per-step timings of this job, as the step-timing writer stores '
            'them from the GitHub jobs API: a JSON array with one object per '
            'step, in step order, carrying the step''s number, name, status, '
            'conclusion, started_at and completed_at. NULL = UNKNOWN (no steps '
            'were stored for this job), never an empty job; an empty array is '
            'a positive observation of zero steps. Kept with the row for its '
            '30-day retention; the long compile-time trend is the merge-lane '
            'hourly rollup''s, not this column''s (plan '
            '2026-10-19-the-merge-theory-has-no-data-to-test-it-against, '
            'Phase 1d).'
        """
    )


def downgrade() -> None:
    # The DROP COLUMN takes ACCESS EXCLUSIVE on the sampler's table too.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.ci_job_observations DROP COLUMN IF EXISTS steps")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_lane_hourly_hour")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_lane_hourly_tenant_repo_hour")
    op.execute("DROP TABLE IF EXISTS coord.merge_lane_hourly")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_first_eval")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_superseded")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_open")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_tenant_repo_first")
    op.execute("DROP TABLE IF EXISTS coord.merge_verdict_heads")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidate_members_cut_at")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidate_members_repo_pr")
    op.execute("DROP TABLE IF EXISTS coord.merge_candidate_members")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidates_cut_at")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidates_batch")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidates_proposal")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidates_open")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidates_repo_tip")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_candidates_tenant_repo_cut")
    op.execute("DROP TABLE IF EXISTS coord.merge_candidates")
