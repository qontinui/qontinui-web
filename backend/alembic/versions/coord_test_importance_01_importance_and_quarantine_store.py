"""coord test importance store: daily counts, estimates, run ledger, quarantine registry, applications

Revision ID: coord_test_importance_01
Revises: outbound_budget_windows_01
Create Date: 2026-11-07

Phase 2 of plan
``2026-11-07-test-importance-scores-and-a-quarantine-that-still-runs``.

Five tables, all additive, all coord-only. No build reads or writes any of
them until that plan's Phase 4:

1. ``coord.test_importance_counts`` - IMP-v1's label-agnostic DAILY sufficient
   statistics (design row D2): one row per player (target, test) x ref class x
   relation class x UTC head-day, under a ``label_version``. Raw per-test rows
   live 14 days and the estimation window is 30, so the window is read from
   these counts, and a rescore under new math needs no raw rows.
2. ``coord.test_importance`` - the served estimates: one row per player x ref
   class x relation class under an ``imp_version``. Every estimate is nullable
   and NULL is UNKNOWN; ``p_plus`` is the only bound fit for gating.
3. ``coord.test_importance_runs`` - the ledger of ``count_day`` and ``score``
   runs, with their inputs, fit state and holdout.
4. ``coord.test_quarantines`` - the per-test quarantine registry (D7): an owner,
   a diagnosis from a closed vocabulary with no production-defect member, and an
   expiry. A quarantined test STILL RUNS in the same jobs.
5. ``coord.test_quarantine_applications`` - one row per run's application of the
   registry: ``shadow`` ("would this red have flipped?") until the plan's
   Phase 9, which waits on an operator decision (G11).

## What writes and reads them

qontinui-coord ``test_importance/`` owns the first three (the Phase 4 counting
worker, the Phase 5 score worker, the Phase 6 read) and ``test_quarantine/``
the last two (Phase 7 doors, expiry sweeper and shadow applications; Phase 9
enforced applications). The scores are a report and never a selection rule
(A2 Proposition 50): coord's read guard
``importance_tables_have_only_allowlisted_readers`` (D6) fails on any reader of
``coord.test_importance`` or ``coord.test_importance_counts`` outside its
allowlist.

## Types the plan leaves open

* Trial-level counts are ``double precision``: ``trials``, ``pass_heads``,
  ``mixed_heads``, ``red_at_base`` and ``base_unknown`` on the counts, and
  ``n_runs``, ``y_failures`` and ``bad_heads`` on the estimates. A
  selector-chosen run enters weighted 1/pi (D5, Doc B Proposition 85), and the
  estimates' failure counts also carry each all-red trial's P(Y=1 | .) weight,
  so these are fractional statistics.
* Execution, sample and land counts are ``integer``: ``mixed_flaky_execs``,
  ``mixed_pass_execs``, ``exec_n``, ``exec_fail``, ``dur_n``, ``att``,
  ``debt_m_lands``, ``lands_since_pass``, ``heads``, ``quarantined_ran`` and
  ``other_failed``. ``rows_written`` is ``bigint``, the width of a row count
  sqlx reports.
* ``label_version`` and ``imp_version`` are ``text`` version tokens, the
  convention of the estimator id ``hierarchical-eb-v1``.
* ``day``, ``window_start`` and ``window_end`` are ``date``: the counts are
  daily, keyed by UTC head-day.
* ``finding_id`` and ``notification_ref`` are ``uuid``: both are coord
  ``finding_id`` values (``coord.findings.finding_id``; coord's
  ``notification_ref.rs`` parses the reference as a UUID).
* Rates, bounds, costs and net-value terms are ``double precision``;
  timestamps ``timestamptz``; the three flags and ``verdict_flipped``
  ``boolean``, NULL = UNKNOWN.

## NOT NULL, and what is left nullable

Keys, ``tenant_id``, vocabulary columns that every writer states, the counts
(D2: all NOT NULL) and the registry fields the door requires are NOT NULL, with
no default where the writer must state the value, so a writer that forgets a
column is refused instead of storing a default that reads as data. Defaults
exist only where the default IS the true value at insert: the ``now()`` stamps
of insertion, ``gen_random_uuid()`` / identity keys, ``target = '*'`` and an
empty ``degraded_reasons``. Every estimate and every observation a writer may
be unable to make (``quarantined_ran``, ``quarantined_failed``,
``other_failed``, ``verdict_flipped``) is nullable, so UNKNOWN is storable.

## Keys and indexes

* ``test_importance_counts``: ``id`` bigint identity PRIMARY KEY (coord's
  retention prune batches over ONE key column, as ``coord_test_result_heads_01``
  explains); ``uq_test_importance_counts_cell`` UNIQUE on
  ``(tenant_id, repo, label_version, day, target, test_id, ref_class,
  rel_class)``; ``idx_test_importance_counts_tenant_repo_label_day`` on
  ``(tenant_id, repo, label_version, day)``; ``idx_test_importance_counts_day``
  on ``(day)`` for the retention prune.
* ``test_importance``: PRIMARY KEY on the plan's unique key
  ``(tenant_id, repo, imp_version, target, test_id, ref_class, rel_class)``.
  The plan gives this table no surrogate id and no retention entry (the score
  worker's delete-absent upsert bounds it), so the unique key is the key.
* ``test_importance_runs``: ``id`` uuid PRIMARY KEY. Low volume (a few runs per
  repo per day), so no secondary index.
* ``test_quarantines``: ``id`` uuid PRIMARY KEY, and
  ``ux_test_quarantines_active`` UNIQUE on ``(tenant_id, repo, target,
  test_id) WHERE lifted_at IS NULL``: at most one active quarantine per test
  and target, enforced by the database. The predicate is a pure column test.
* ``test_quarantine_applications``: ``id`` bigint identity PRIMARY KEY;
  ``ux_test_quarantine_applications_run`` UNIQUE on ``(tenant_id, repo,
  head_sha, target, mode, coalesce(run_ref, ''))`` (an expression index, so an
  unnamed run is one key rather than an unlimited number of NULLs);
  ``idx_test_quarantine_applications_observed_at`` on ``(observed_at)`` for the
  retention prune.

Where each index is built: the identity-bearing ones (the primary keys,
``uq_test_importance_counts_cell``, ``ux_test_quarantines_active`` and
``ux_test_quarantine_applications_run``) are built inside alembic's
transaction with their tables, so no failed upgrade can leave a table without
its uniqueness rule. The three plain access-path indexes are built
``CONCURRENTLY`` in ``autocommit_block()``, the ``coord_test_result_heads_01``
pattern: instant on an empty table, and admitted by coord's migration
classifier, which cannot see that a table is empty.

## Why the vocabularies are text with no CHECK

``ref_class``, ``rel_class``, ``evidence_basis``, ``cf_basis``, ``kind``,
``status``, ``owner_kind``, ``diagnosis``, ``lift_reason`` and ``mode`` are
text with NO CHECK, the ``coord_ci_runner_quarantines_01`` choice: the closed
set lives in the Rust enum that writes it, and a new class is a Rust PR rather
than a migration. Each vocabulary is recorded on its column comment, so psql
describe output carries it. ``ref_class`` uses plan B's ledger tokens
(``coord.test_result_runs``), one vocabulary across plans B, C, D and F.

## The four CHECKs on coord.test_quarantines

They are not vocabularies; each pins a property the registry's meaning
depends on:

* ``ck_test_quarantines_expires_after_created`` - ``expires_at > created_at``:
  a quarantine always expires, after it starts.
* ``ck_test_quarantines_owner_ref_not_blank`` and
  ``ck_test_quarantines_diagnosis_detail_not_blank`` - each holds a
  non-whitespace character: an owner and a stated diagnosis are what separate
  a quarantine from a silent skip.
* ``ck_test_quarantines_lifted_at_iff_lift_reason`` -
  ``(lifted_at IS NULL) = (lift_reason IS NULL)``: a lifted row says why, and
  only a lifted row carries a reason.

## No tenant FK, no ORM model

``tenant_id`` is ``uuid NOT NULL`` with no FK on all five tables, the
``coord_findings`` / ``coord_ci_runner_quarantines_01`` side of the house
practice: these rows are coord's evidence ledger and registry, and a cascade on
tenant delete would erase the record of what coord measured and excluded.
``run_id`` and ``renews_id`` are plain columns for the same reason. No
SQLAlchemy model: coord-only tables stay out of the ORM graph, and web is their
schema author, never a reader.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL. The coord PRs that
read and write these tables (Phases 4-7 and 9) land only after this revision is
applied in production, read through two signals: ``coord_query_schema_object``
on ``coord.test_importance.p_plus`` and the migration lifecycle.

## Chaining

``down_revision`` is ``outbound_budget_windows_01``, the single head
``poetry run alembic heads`` printed on this branch's base (``origin/main``
``211c6d143``), and still the single head at ``origin/main`` ``045e22bd5``
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). If another revision lands first
(plan B's ``coord_test_result_runs_01`` is authored in parallel), re-chain
onto the new single head. A re-point is three coupled edits: ``down_revision``,
the ``Revises:`` line above, and ``_PARENT_REVISION_ID`` (with
``_PARENT_TABLE``) in ``tests/test_coord_test_importance_01_migration.py``. Do
not add an ``alembic merge``: this repo keeps strict single-head discipline.

## Merge-train classifier disposition

Every upgrade statement is a static literal in one of the shapes coord's
migration classifier admits (``qontinui-coord``
``crates/coord/src/pr_merge/migration_classifier.rs``, read at ``10eb209d0``):
``CREATE TABLE IF NOT EXISTS`` with a plain column list,
``CREATE [UNIQUE] INDEX IF NOT EXISTS`` on a table this file creates first (a
new-table claim coord discharges against trunk),
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block()``, and
``COMMENT ON`` with a plain literal. ``downgrade()`` is outside the classified
upgrade path. Expected verdict (read from that source, not measured, since no
PR exists to run ``coord_reevaluate_dry`` against): ``AutoSafeIfNewTables``
naming ``coord.test_quarantines`` and ``coord.test_quarantine_applications``,
the two tables whose unique indexes are built in the transaction; the keys
declared inside ``CREATE TABLE`` and the three concurrent builds raise no
claim.

## Safety

``CREATE TABLE IF NOT EXISTS``, ``CREATE [UNIQUE] INDEX [CONCURRENTLY] IF NOT
EXISTS`` and re-runnable ``COMMENT ON``, so a partial apply re-runs cleanly.
The one residue a re-run would not repair is an INVALID index left by a failed
``CONCURRENTLY`` build, which ``IF NOT EXISTS`` then skips; on these new, empty
tables such a build has nothing to fail on, and the migration test reads every
index back as valid and ready. No existing table is touched, so no lock bound
is needed. ``downgrade()`` drops
the five tables, ``IF EXISTS``; their indexes, constraints, identity sequences
and comments go with them. Both directions are pure SQL execution with no bind
or inspection, so they work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_importance_01"
down_revision: str | Sequence[str] | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Comment bodies avoid apostrophes so no SQL escaping is
# needed.


def upgrade() -> None:
    """Create the five coord test-importance and quarantine tables, document them."""
    # 1. coord.test_importance_counts: label-agnostic daily sufficient statistics.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_importance_counts (
            id                bigint           GENERATED ALWAYS AS IDENTITY,
            tenant_id         uuid             NOT NULL,
            repo              text             NOT NULL,
            target            text             NOT NULL,
            test_id           text             NOT NULL,
            ref_class         text             NOT NULL,
            rel_class         text             NOT NULL,
            label_version     text             NOT NULL,
            day               date             NOT NULL,
            trials            double precision NOT NULL,
            pass_heads        double precision NOT NULL,
            mixed_heads       double precision NOT NULL,
            mixed_flaky_execs integer          NOT NULL,
            mixed_pass_execs  integer          NOT NULL,
            exec_n            integer          NOT NULL,
            exec_fail         integer          NOT NULL,
            red_at_base       double precision NOT NULL,
            base_unknown      double precision NOT NULL,
            dur_n             integer          NOT NULL,
            allred_by_k       jsonb            NOT NULL,
            allred_heads      jsonb            NOT NULL,
            dur_p50           double precision,
            computed_at       timestamptz      NOT NULL DEFAULT now(),
            CONSTRAINT test_importance_counts_pkey PRIMARY KEY (id),
            CONSTRAINT uq_test_importance_counts_cell UNIQUE
                (tenant_id, repo, label_version, day, target, test_id, ref_class, rel_class)
        )
        """
    )

    # 2. coord.test_importance: the served estimates. NULL is UNKNOWN throughout.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_importance (
            tenant_id              uuid             NOT NULL,
            repo                   text             NOT NULL,
            imp_version            text             NOT NULL,
            target                 text             NOT NULL,
            test_id                text             NOT NULL,
            ref_class              text             NOT NULL,
            rel_class              text             NOT NULL,
            run_id                 uuid             NOT NULL,
            n_runs                 double precision,
            y_failures             double precision,
            p_hat                  double precision,
            p_plus                 double precision,
            evidence_basis         text,
            prior_strength         double precision,
            q_hat                  double precision,
            q_plus                 double precision,
            q_lower                double precision,
            att                    integer,
            cf                     double precision,
            cf_basis               text,
            detection_share        double precision,
            shapley_credit         double precision,
            bad_heads              double precision,
            dur_p50_secs           double precision,
            crit_path_secs         double precision,
            slot_secs              double precision,
            nv_detect_lane_h       double precision,
            nv_lane_lane_h         double precision,
            nv_slot_lane_h         double precision,
            nv_spurious_lane_h     double precision,
            nv_lane_h              double precision,
            debt_m                 double precision,
            debt_m_lands           integer,
            lands_since_pass       integer,
            negative_asset         boolean,
            flake_onset_suspected  boolean,
            quarantine_recommended boolean,
            computed_at            timestamptz      NOT NULL DEFAULT now(),
            CONSTRAINT test_importance_pkey PRIMARY KEY
                (tenant_id, repo, imp_version, target, test_id, ref_class, rel_class)
        )
        """
    )

    # 3. coord.test_importance_runs: the count_day and score run ledger.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_importance_runs (
            id               uuid        NOT NULL DEFAULT gen_random_uuid(),
            tenant_id        uuid        NOT NULL,
            repo             text        NOT NULL,
            kind             text        NOT NULL,
            label_version    text        NOT NULL,
            imp_version      text,
            day              date,
            window_start     date,
            window_end       date,
            status           text        NOT NULL,
            degraded_reasons text[]      NOT NULL DEFAULT '{}',
            heads            integer,
            rows_written     bigint,
            inputs           jsonb,
            hyper            jsonb,
            holdout          jsonb,
            started_at       timestamptz NOT NULL DEFAULT now(),
            finished_at      timestamptz,
            CONSTRAINT test_importance_runs_pkey PRIMARY KEY (id)
        )
        """
    )

    # 4. coord.test_quarantines: the registry. A quarantined test still runs.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_quarantines (
            id               uuid        NOT NULL DEFAULT gen_random_uuid(),
            tenant_id        uuid        NOT NULL,
            repo             text        NOT NULL,
            test_id          text        NOT NULL,
            target           text        NOT NULL DEFAULT '*',
            owner_kind       text        NOT NULL,
            owner_ref        text        NOT NULL,
            diagnosis        text        NOT NULL,
            diagnosis_detail text        NOT NULL,
            evidence         jsonb       NOT NULL,
            finding_id       uuid        NOT NULL,
            notification_ref uuid        NOT NULL,
            created_at       timestamptz NOT NULL DEFAULT now(),
            created_by       text        NOT NULL,
            expires_at       timestamptz NOT NULL,
            renews_id        uuid,
            lifted_at        timestamptz,
            lifted_by        text,
            lift_reason      text,
            CONSTRAINT test_quarantines_pkey PRIMARY KEY (id),
            CONSTRAINT ck_test_quarantines_expires_after_created
                CHECK (expires_at > created_at),
            CONSTRAINT ck_test_quarantines_owner_ref_not_blank
                CHECK (owner_ref ~ '[^[:space:]]'),
            CONSTRAINT ck_test_quarantines_diagnosis_detail_not_blank
                CHECK (diagnosis_detail ~ '[^[:space:]]'),
            CONSTRAINT ck_test_quarantines_lifted_at_iff_lift_reason
                CHECK ((lifted_at IS NULL) = (lift_reason IS NULL))
        )
        """
    )
    # At most one ACTIVE quarantine per (tenant, repo, target, test), enforced
    # by the database. Built in the transaction: it carries a safety rule.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_test_quarantines_active
            ON coord.test_quarantines (tenant_id, repo, target, test_id)
            WHERE lifted_at IS NULL
        """
    )

    # 5. coord.test_quarantine_applications: each run application of the registry.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_quarantine_applications (
            id                   bigint      GENERATED ALWAYS AS IDENTITY,
            tenant_id            uuid        NOT NULL,
            repo                 text        NOT NULL,
            head_sha             text        NOT NULL,
            target               text        NOT NULL,
            run_ref              text,
            mode                 text        NOT NULL,
            list_digest          text,
            quarantined_test_ids text[]      NOT NULL,
            quarantined_ran      integer,
            quarantined_failed   text[],
            other_failed         integer,
            verdict_flipped      boolean,
            observed_at          timestamptz NOT NULL,
            CONSTRAINT test_quarantine_applications_pkey PRIMARY KEY (id)
        )
        """
    )
    # One application per (head, target, mode) and run; an unnamed run is one
    # key, not an unlimited number of NULLs. Built in the transaction.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_test_quarantine_applications_run
            ON coord.test_quarantine_applications
               (tenant_id, repo, head_sha, target, mode, (coalesce(run_ref, '')))
        """
    )

    # Table comments.
    op.execute(
        """
        COMMENT ON TABLE coord.test_importance_counts IS
            'IMP-v1 label-agnostic daily sufficient statistics, one row per player (target, test) x ref_class x rel_class x UTC head-day under a label_version, written by the coord module test_importance (counting worker). No label is stored: the score worker labels these counts under the current imp_version. Retention prunes by day. Plan 2026-11-07-test-importance-scores-and-a-quarantine-that-still-runs, design row D2.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.test_importance IS
            'IMP-v1 served estimates, one row per player x ref_class x rel_class under an imp_version, written by the coord module test_importance (score worker). Every estimate is nullable and NULL is UNKNOWN. A report, never a selection rule (A2 Proposition 50): coord fails any reader outside its allowlist (D6).'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.test_importance_runs IS
            'Ledger of the coord module test_importance runs: one row per count_day or score run, with its inputs, fit state (hyper) and holdout.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.test_quarantines IS
            'Per-test quarantine registry, written by the coord module test_quarantine (doors and expiry sweeper). A quarantined test still runs in the same jobs and its rows are ingested as usual. Each row carries an owner, a diagnosis from a closed vocabulary and an expiry; ux_test_quarantines_active keeps at most one unlifted row per (tenant_id, repo, target, test_id). Plan design row D7.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.test_quarantine_applications IS
            'One row per CI run application of the quarantine registry to a head and target, written by the coord module test_quarantine. Shadow rows say whether the registry would have flipped the verdict; enforced rows record an exclusion that happened, and exist only after the plan Phase 9 (G11). Retention prunes by observed_at.'
        """
    )

    # Column comments: test_importance_counts.
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_counts.ref_class IS
            'pr_merge_ref | candidate | main_push | schedule | dispatch | other: the run ref class in plan B ledger tokens (coord.test_result_runs). The change-conditional p counts default to candidate, main_push and schedule, with pr_merge_ref opt-in per repo; q evidence is counted from every class. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_counts.rel_class IS
            'own | foot | near | far | unknown: the nearest relation between the test home and the change (design row D3). unknown is an unresolvable home module or change set, never far. The all row is the score worker sum over these cells, served in coord.test_importance, not counted here. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_counts.label_version IS
            'Names the trial and cell definition these counts were made under. Estimates are keyed by imp_version instead, so new posterior math rescores these counts with no raw rows; a new trial or cell definition rebuilds only what raw retention still holds.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_counts.allred_by_k IS
            'All-red heads of this player in this cell and day, bucketed by total attempts K (the sum of att over the head executions). Label-agnostic: the score worker labels them.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_counts.allred_heads IS
            'Each bad head on which this player was all-red, with its K, so the score worker can regroup by head into each bad head set of all-red players (for the size of F, credit and cf).'
        """
    )

    # Column comments: test_importance.
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.ref_class IS
            'pr_merge_ref | candidate | main_push | schedule | dispatch | other: the run ref class in plan B ledger tokens (coord.test_result_runs). Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.rel_class IS
            'own | foot | near | far | unknown | all: the relation-class cell. The unknown row carries its own n and evidence_basis and is excluded from the monotone envelope; its trials count in the all row. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.imp_version IS
            'Names the posterior math and the label rule the row was computed under. A math change rescores from coord.test_importance_counts.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.run_id IS
            'The coord.test_importance_runs score run that wrote this row. Plain column, no FK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.p_plus IS
            'Data-only one-sided Clopper-Pearson upper bound on the failure rate: the only bound fit for any gating use. NULL when n is 0, never 0 (a shrinkage quantile is never served as a bound).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.evidence_basis IS
            'module | test | population | prior_only: what the estimate rests on. A row with no history reads prior_only, never 0. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.cf_basis IS
            'How cf was formed: the default of 1 below 4 failing heads, or the observed mean of 1 over the size of F shrunk toward the repo mean with strength 4 (Proposition 47). Text with no CHECK; the token set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance.quarantine_recommended IS
            'True when negative_asset holds on every rel_class row with positive same-head flake evidence and no suspected flake onset. NULL = UNKNOWN, and any NULL input row makes it NULL. The evidence the quarantine door requires.'
        """
    )

    # Column comments: test_importance_runs.
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_runs.kind IS
            'count_day | score. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_runs.status IS
            'The run outcome, for example ok, or degraded with its reasons in degraded_reasons. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_importance_runs.imp_version IS
            'The imp_version a score run labelled and scored under. NULL for a count_day run, which applies no labels.'
        """
    )

    # Column comments: test_quarantines.
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.target IS
            'The target (CI job) the quarantine covers, or * for every target of the test.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.owner_kind IS
            'The kind of owner owner_ref names. Text with no CHECK; the closed set lives in the Rust enum the door validates against (422 unknown_owner_kind).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.diagnosis IS
            'nondeterministic_test | environment_dependent | external_dependency | timeout_shaped | order_dependent | unknown_flake. No production-defect member: a production defect is fixed or bisected, never quarantined (design row D7). Text with no CHECK; the closed set lives in the Rust enum the door validates against.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.evidence IS
            'The IMP-v1 evidence the door admitted: the score run id and the bounds behind quarantine_recommended.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.finding_id IS
            'The coord finding the door posted before inserting (topic test-quarantine): the completeness record naming the test, owner, diagnosis, expiry and evidence.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.notification_ref IS
            'The calling session notification finding (a coord finding_id), verified by the door before the insert.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.expires_at IS
            'At most COORD_TEST_QUARANTINE_MAX_DAYS (14) after created_at, enforced by the door; renewable only with fresh evidence. Expiry lifts the row with lift_reason expired and the test re-enters the verdict.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.renews_id IS
            'The quarantine this row renews. Plain column, no FK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.lift_reason IS
            'fixed | owner_lifted | superseded | expired. Set exactly when lifted_at is (ck_test_quarantines_lifted_at_iff_lift_reason). Text with no CHECK on the vocabulary; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantines.lifted_by IS
            'Who lifted the row: the caller of the lift door, or coord:expiry for the expiry sweeper.'
        """
    )

    # Column comments: test_quarantine_applications.
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantine_applications.mode IS
            'shadow | enforced. Shadow: computed by the counting worker, nothing excluded. Enforced: the quarantined tests ran in their own non-gating step and were excluded from the verdict (plan Phase 9, after G11). Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantine_applications.run_ref IS
            'The CI run this application belongs to. NULL keys as the empty string in ux_test_quarantine_applications_run, so an unnamed run is one application per head, target and mode.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantine_applications.list_digest IS
            'sha256 of the sorted active quarantine list the application used. NULL when the writer took no digest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantine_applications.quarantined_ran IS
            'How many of quarantined_test_ids executed in this run: the still-runs evidence. NULL = UNKNOWN.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantine_applications.other_failed IS
            'How many failing tests in this run were not quarantined. NULL = UNKNOWN.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_quarantine_applications.verdict_flipped IS
            'Shadow: true iff the target was red and every red was quarantined. Enforced: true iff the gating run was green and a quarantined test failed. NULL = UNKNOWN.'
        """
    )

    # The three plain access-path indexes: CONCURRENTLY although every table is
    # new and empty, because coord's migration classifier (the auto-land gate)
    # cannot see emptiness and rejects any non-concurrent CREATE INDEX that is
    # not on a table this file creates; on an empty table the concurrent build
    # is instant. No validity read after them: the classifier rejects bind
    # reads too (the coord_test_result_heads_01 pattern).
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_importance_counts_tenant_repo_label_day
                ON coord.test_importance_counts (tenant_id, repo, label_version, day)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_importance_counts_day
                ON coord.test_importance_counts (day)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_quarantine_applications_observed_at
                ON coord.test_quarantine_applications (observed_at)
            """
        )


def downgrade() -> None:
    """Drop the five tables; their indexes, constraints, sequences and comments go with them."""
    op.execute("DROP TABLE IF EXISTS coord.test_quarantine_applications")
    op.execute("DROP TABLE IF EXISTS coord.test_quarantines")
    op.execute("DROP TABLE IF EXISTS coord.test_importance_runs")
    op.execute("DROP TABLE IF EXISTS coord.test_importance")
    op.execute("DROP TABLE IF EXISTS coord.test_importance_counts")
