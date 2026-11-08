"""coord.test_selection_decisions -- one row per typed check run (a selected green is its own verdict).

Phase 4 (web migration) of plan ``2026-11-07-a-selected-green-is-its-own-verdict``
(qontinui-dev-notes). Creates one new, empty table and three indexes::

    coord.test_selection_decisions (id, tenant_id, repo, source, check_run_id, ...)
        uq_test_selection_decisions_repo_check_run  UNIQUE (repo, check_run_id) WHERE check_run_id IS NOT NULL
        idx_test_selection_decisions_repo_head      (repo, head_sha)
        idx_test_selection_decisions_tenant_decided (tenant_id, decided_at DESC)

Why this table exists
=====================

Two jobs on this fleet run PART of their suite and still conclude ``success``:
qontinui-claude-config's per-PR roster legs (``frontmatter (k)``,
``guard-roster-linux-cargo (k)``) and qontinui-research's Scope-skipping
``consequence-model-tests``. Every coord reader of a green -- the reuse guard,
T3's skip prior, merge economics, the PR status card -- takes such a green for a
full one, because nothing records the difference.

The fix types the verdict (``theory/test-importance-and-selection.md``
Definition 27): FULL, SELECTED, RED or NOT-A-VERDICT. A job writes a manifest
about itself as a ``qontinui-selection-manifest`` check-run annotation; coord
ingests it into THIS table, keyed on the check run, and every reader folds the
check's conclusion with the row. A SELECTED or NOT-A-VERDICT green never
attests, never seeds T3, is never reused for a land, and is kept out of the
full-run percentiles.

The plan's D2 wire is the single source of the manifest's keys. Each manifest
key maps to one column below; ``source = 'coord_selector'`` rows are written by
plan ``2026-11-07-coord-shadow-test-selector-and-its-assessment`` (shadow
decisions, never a verdict), and every reader of plan C reads
``source = 'ci_annotation'`` rows only.

Schema notes
============

* ``id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`` -- a surrogate key:
  coord's retention sweep (``table_retention.rs`` ``prune_sql``) batches over ONE
  key column, the shape every registered table uses.
* ``ingest_state`` is SOURCE-COUPLED and nullable, by two named CHECKs:

  - ``ck_test_selection_decisions_ingest_state_iff_annotation``:
    ``(source = 'ci_annotation') = (ingest_state IS NOT NULL)``. Only an ingest
    has an ingest state; a ``coord_selector`` shadow row never claims an ingest
    that did not happen.
  - ``ck_test_selection_decisions_mode_iff_verdict``: ``mode`` is non-null
    exactly when ``ingest_state = 'ingested' OR source = 'coord_selector'``. A
    ``ci_annotation`` row coord wrote with no usable manifest (absent, pending,
    rejected) carries no mode, so no reader can mistake it for a typed verdict;
    a shadow row always carries the mode it decided.
* Counts are NULL when unknown (an absent manifest), never 0.
* Digests are lowercase 64-hex (sha256); shas are 40-hex.

Indexes are built CONCURRENTLY in ``autocommit_block()`` although the table is
new and empty. coord's migration classifier (the auto-land gate) would accept a
plain CREATE INDEX on a table created in the same revision only as
``AutoSafeIfNewTables``; CONCURRENTLY keeps its verdict ``AutoSafe`` with no
emptiness reasoning at all (cf. ``coord_test_result_heads_01``).

Idempotency / authorship posture
================================
* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE ... INDEX CONCURRENTLY IF NOT EXISTS``,
  with a symmetric ``downgrade()``.
* alembic is the SOLE author of the ``coord.*`` schema (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). coord only INSERTs,
  UPDATEs, SELECTs and prune-DELETEs this table, and its reads degrade on
  ``42P01`` / ``42703`` to NOT-A-VERDICT for registered jobs, never FULL.

Chaining
========
``down_revision`` -- ``coord_test_result_runs_01``, main's single alembic head when
this revision was authored (``scripts/ci/count_alembic_heads.py``: HEAD_COUNT=1).
A re-point is three coupled edits: ``down_revision``, the ``Revises:`` line below,
and ``_PARENT_REVISION_ID`` in
``tests/test_coord_test_selection_01_decisions_migration.py``.

Revision ID: coord_test_selection_01
Revises: coord_test_result_runs_01
Create Date: 2026-11-07
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_selection_01"
down_revision: str | None = "coord_test_result_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.test_selection_decisions`` and its indexes. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_selection_decisions (
            id                bigint           GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            tenant_id         uuid             NOT NULL,
            repo              text             NOT NULL,
            source            text             NOT NULL,
            check_run_id      bigint,
            workflow_run_id   bigint,
            run_attempt       integer,
            job               text             NOT NULL,
            head_sha          text             NOT NULL,
            base_sha          text,
            tested_sha        text,
            ref_class         text,
            proposal_id       uuid,
            proposal_attempt  integer,
            map_ref           text,
            map_digest        text,
            map_age_lands     integer,
            selector_version  text,
            pinned_digest     text,
            latch_state       text,
            risk_digest       text,
            ladder_index      integer,
            audit_propensity  double precision,
            audit_draw        double precision,
            audit_commitment  text,
            ingest_state      text,
            mode              text,
            unit              text,
            reasons           text[]           NOT NULL DEFAULT '{}',
            fallback_reason   text,
            selected_count    integer,
            universe_count    integer,
            expected_count    integer,
            executed_count    integer,
            selected_digest   text,
            deferred_digest   text,
            expected_digest   text,
            executed_digest   text,
            input_digest      text,
            shard             text,
            decided_at        timestamptz      NOT NULL,
            ingested_at       timestamptz      NOT NULL DEFAULT now(),
            CONSTRAINT ck_test_selection_decisions_source
                CHECK (source IN ('ci_annotation', 'coord_selector')),
            CONSTRAINT ck_test_selection_decisions_ref_class
                CHECK (ref_class IN ('pr_merge_ref', 'candidate', 'main_push',
                                     'schedule', 'dispatch', 'other')),
            CONSTRAINT ck_test_selection_decisions_ingest_state
                CHECK (ingest_state IN ('ingested', 'pending', 'absent', 'rejected')),
            CONSTRAINT ck_test_selection_decisions_mode
                CHECK (mode IN ('FULL', 'SELECTED', 'NOT-A-VERDICT')),
            CONSTRAINT ck_test_selection_decisions_ingest_state_iff_annotation
                CHECK ((source = 'ci_annotation') = (ingest_state IS NOT NULL)),
            CONSTRAINT ck_test_selection_decisions_mode_iff_verdict
                CHECK ((mode IS NOT NULL)
                       = (COALESCE(ingest_state = 'ingested', false)
                          OR source = 'coord_selector')),
            CONSTRAINT ck_test_selection_decisions_unit
                CHECK (unit IN ('test', 'suite', 'block')),
            CONSTRAINT ck_test_selection_decisions_counts_nonnegative
                CHECK (selected_count >= 0 AND universe_count >= 0
                       AND expected_count >= 0 AND executed_count >= 0),
            CONSTRAINT ck_test_selection_decisions_selected_le_universe
                CHECK (selected_count <= universe_count),
            CONSTRAINT ck_test_selection_decisions_shas
                CHECK (head_sha ~ '^[0-9a-f]{40}$'
                       AND (base_sha IS NULL OR base_sha ~ '^[0-9a-f]{40}$')
                       AND (tested_sha IS NULL OR tested_sha ~ '^[0-9a-f]{40}$')),
            CONSTRAINT ck_test_selection_decisions_digests
                CHECK ((selected_digest IS NULL OR selected_digest ~ '^[0-9a-f]{64}$')
                       AND (deferred_digest IS NULL OR deferred_digest ~ '^[0-9a-f]{64}$')
                       AND (expected_digest IS NULL OR expected_digest ~ '^[0-9a-f]{64}$')
                       AND (executed_digest IS NULL OR executed_digest ~ '^[0-9a-f]{64}$')
                       AND (input_digest IS NULL OR input_digest ~ '^[0-9a-f]{64}$')),
            CONSTRAINT ck_test_selection_decisions_audit_propensity
                CHECK (audit_propensity >= 0 AND audit_propensity <= 1),
            CONSTRAINT ck_test_selection_decisions_audit_draw
                CHECK (audit_draw >= 0 AND audit_draw < 1)
        )
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.id IS
            'Surrogate key; coord retention prunes over this one column.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.tenant_id IS
            'The repo''s proven owner tenant (coord owner_tenant_for_repo); an unresolvable owner writes no row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.repo IS
            'Canonical owner/name of the repository the check run belongs to.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.source IS
            'Who wrote the row: ci_annotation (a job''s own manifest, a verdict) or coord_selector (a shadow decision, never a verdict).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.check_run_id IS
            'GitHub check-run id (for Actions, the job id); the ingest conflict target with repo. Normally NULL on a coord_selector row, which decides before any check run exists.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.workflow_run_id IS
            'GitHub Actions workflow run id (the manifest run_id, or parsed from the check run details_url).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.run_attempt IS
            'GitHub Actions run attempt (the manifest run_attempt).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.job IS
            'The check-run name exactly as GitHub reports it, e.g. frontmatter (1).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.head_sha IS
            '40-hex head sha of the check run.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.base_sha IS
            '40-hex base the job selected against (manifest base_sha); NULL when not reported.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.tested_sha IS
            '40-hex tree the job tested (manifest tested_sha; GitHub''s merge commit on pull_request); NULL when not reported.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.ref_class IS
            'Which ref class ran the job, in coord.test_result_runs.ref_class''s six words exactly so the two tables join without a mapping; NULL when underivable.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.proposal_id IS
            'Merge-train proposal id parsed from a candidate head branch; NULL off the train.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.proposal_attempt IS
            'Merge-train proposal attempt; NULL off the train.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.map_ref IS
            'Coverage-map reference the selector read (manifest map_ref); NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.map_digest IS
            'Digest of the coverage map the selector read (manifest map_digest); NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.map_age_lands IS
            'Coverage-map age in lands (A2 Definition 22, manifest map_age); NULL when absent, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.selector_version IS
            'The selector that decided, e.g. affected-guard-suites@<blob12> (manifest selector).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.pinned_digest IS
            'Digest of the pinned (always-run) set (manifest pinned_digest); NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.latch_state IS
            'Selector latch state (manifest latch_state); NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.risk_digest IS
            'Risk-input digest for the shadow selector (plan D, integration hook 10); NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.ladder_index IS
            'Escalation-ladder index for the shadow selector (plan D, integration hook 10); NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.audit_propensity IS
            'Logged audit propensity e in [0,1]; an audited candidate runs FULL. NULL when absent, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.audit_draw IS
            'Keyed audit draw in [0,1); audited when audit_draw < audit_propensity. NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.audit_commitment IS
            'Commitment to the audit draw so it can be reproduced; NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.ingest_state IS
            'ingested (a manifest verified), pending (the read was refused or failed; retried), absent (no manifest), rejected (malformed, or two manifests). '
            'Non-null exactly on a ci_annotation row; NULL on a coord_selector shadow row, which claims no ingest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.mode IS
            'FULL, SELECTED or NOT-A-VERDICT; non-null exactly when ingest_state is ingested or the row is a coord_selector shadow decision. '
            'A SELECTED green never attests; NOT-A-VERDICT is neither green nor red.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.unit IS
            'What the counts count: test, suite or block.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.reasons IS
            'The selector''s stated reasons, verbatim; empty when none.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.fallback_reason IS
            'Why a FULL or NOT-A-VERDICT run fell back, e.g. executed_differs; NULL otherwise.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.selected_count IS
            '|R|: units the leg selected (manifest selected); NULL when unknown, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.universe_count IS
            '|J|: units in the leg''s universe (manifest universe); NULL when unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.expected_count IS
            'Units this job was expected to run, its part of R (manifest expected); NULL when unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.executed_count IS
            'Units this job actually ran (manifest executed); NULL when unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.selected_digest IS
            'sha256 of the selected unit ids, sorted, newline-terminated.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.deferred_digest IS
            'sha256 of the deferred set J minus R (Definition 23).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.expected_digest IS
            'sha256 of the units this job was expected to run.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.executed_digest IS
            'sha256 of the units this job ran; FULL or SELECTED only when equal to expected_digest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.input_digest IS
            'sha256 of the selector''s logged input record (manifest input_digest); NULL when absent.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.shard IS
            'k/n shard of the job, e.g. 1/12; NULL for an unsharded job.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.decided_at IS
            'When the decision was taken (manifest decided_at, else the check run''s completion).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.test_selection_decisions.ingested_at IS
            'When coord wrote or last rewrote the row.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.test_selection_decisions IS
            'One typed verdict per check run (Definition 27: FULL, SELECTED, RED, NOT-A-VERDICT). '
            'Written by coord from a qontinui-selection-manifest annotation (source ci_annotation) '
            'or by the shadow selector (source coord_selector, never a verdict).'
        """
    )
    # CONCURRENTLY although the table is new and empty: it keeps coord's
    # migration classifier at AutoSafe rather than AutoSafeIfNewTables
    # (cf. coord_test_result_heads_01).
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_test_selection_decisions_repo_check_run
                ON coord.test_selection_decisions (repo, check_run_id)
                WHERE check_run_id IS NOT NULL
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_selection_decisions_repo_head
                ON coord.test_selection_decisions (repo, head_sha)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_selection_decisions_tenant_decided
                ON coord.test_selection_decisions (tenant_id, decided_at DESC)
            """
        )


def downgrade() -> None:
    """Drop ``coord.test_selection_decisions`` and its indexes."""
    op.execute("DROP INDEX IF EXISTS coord.idx_test_selection_decisions_tenant_decided")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_selection_decisions_repo_head")
    op.execute("DROP INDEX IF EXISTS coord.uq_test_selection_decisions_repo_check_run")
    op.execute("DROP TABLE IF EXISTS coord.test_selection_decisions")
