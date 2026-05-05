"""add_regression_tables

Section 11 + FU-5 follow-up: bring the runner-side regression schema
into the canonical alembic chain. The runner currently bootstraps these
tables with `CREATE TABLE IF NOT EXISTS` in
`qontinui-runner/src-tauri/src/database/pg/mod.rs`, which is idempotent
but bypasses alembic. Landing the migration here unblocks Clorinde
regen — `regenerate_schema_pg_sql.sh` runs `pg_dump` against the
alembic-managed canonical container, so Clorinde sees the regression
tables only once they're in the alembic chain.

Tables created (matching the runner's bootstrap exactly):
    regression_suites
    regression_runs (with drift_report_json column from FU-3)
    regression_diagnoses
    regression_assertion_executions

Indexes mirror the runner's bootstrap. The migration uses
`IF NOT EXISTS` semantics (via `CREATE TABLE` checks before each table)
because the runner may have already created them on a shared dev DB.

Revision ID: f9d3e8a4c1b6
Revises: add_arq_job_id_to_training_jobs
Create Date: 2026-05-03

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9d3e8a4c1b6"
down_revision: str | None = "add_arq_job_id_to_training_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the four regression tables + indexes.

    Idempotent: each table uses `CREATE TABLE IF NOT EXISTS` so this
    migration co-exists with the runner's existing in-crate bootstrap on
    pre-migration databases. Once the migration lands, the runner can drop
    its bootstrap (Section 12 cleanup); until then, both produce the same
    schema.
    """
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS regression_suites (
            id          UUID PRIMARY KEY,
            ir_doc_id   TEXT NOT NULL,
            suite_json  JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS regression_suites_ir_doc_id_idx
            ON regression_suites(ir_doc_id);

        CREATE TABLE IF NOT EXISTS regression_runs (
            id                UUID PRIMARY KEY,
            suite_id          UUID NOT NULL REFERENCES regression_suites(id) ON DELETE CASCADE,
            run_id            TEXT NOT NULL,
            passed            INT NOT NULL,
            failed            INT NOT NULL,
            started_at        TIMESTAMPTZ NOT NULL,
            completed_at      TIMESTAMPTZ NOT NULL,
            run_result_json   JSONB NOT NULL,
            drift_report_json JSONB
        );
        CREATE INDEX IF NOT EXISTS regression_runs_suite_id_idx
            ON regression_runs(suite_id);
        CREATE INDEX IF NOT EXISTS regression_runs_run_id_idx
            ON regression_runs(run_id);

        CREATE TABLE IF NOT EXISTS regression_diagnoses (
            id              UUID PRIMARY KEY,
            run_id          UUID NOT NULL REFERENCES regression_runs(id) ON DELETE CASCADE,
            diagnosis_json  JSONB NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS regression_diagnoses_run_id_idx
            ON regression_diagnoses(run_id);

        CREATE TABLE IF NOT EXISTS regression_assertion_executions (
            id                    UUID PRIMARY KEY,
            run_id                UUID NOT NULL REFERENCES regression_runs(id) ON DELETE CASCADE,
            case_id               TEXT NOT NULL,
            assertion_id          TEXT NOT NULL,
            assertion_kind        TEXT NOT NULL,
            status                TEXT NOT NULL,
            started_at            TIMESTAMPTZ NOT NULL,
            duration_ms           INT NOT NULL,
            failure_kind          TEXT,
            failure_evidence_json JSONB,
            error_message         TEXT
        );
        CREATE INDEX IF NOT EXISTS regression_assertion_executions_run_id_idx
            ON regression_assertion_executions(run_id);
        CREATE INDEX IF NOT EXISTS regression_assertion_executions_case_assertion_idx
            ON regression_assertion_executions(case_id, assertion_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS regression_assertion_executions_kind_status_idx
            ON regression_assertion_executions(assertion_kind, status);
        CREATE INDEX IF NOT EXISTS regression_assertion_executions_failures_idx
            ON regression_assertion_executions(case_id, assertion_id) WHERE status = 'fail';
        """
    )


def downgrade() -> None:
    """Drop the four regression tables (CASCADE drops dependent indexes/FKs)."""
    op.execute(
        """
        DROP TABLE IF EXISTS regression_assertion_executions CASCADE;
        DROP TABLE IF EXISTS regression_diagnoses CASCADE;
        DROP TABLE IF EXISTS regression_runs CASCADE;
        DROP TABLE IF EXISTS regression_suites CASCADE;
        """
    )


# `op.execute` raw-SQL block is preferred over `op.create_table` here for
# two reasons:
#   1. We need `CREATE TABLE IF NOT EXISTS` semantics to coexist with the
#      runner's existing in-crate bootstrap during the transition. SQLAlchemy
#      core's `op.create_table` does not support that flag.
#   2. The schema must be byte-identical to the runner bootstrap so
#      `regenerate_schema_pg_sql.sh` produces a stable Clorinde-consumable
#      `schema.pg.sql.generated`. Hand-rolled DDL keeps the source of truth
#      in one place; SQLAlchemy's column ordering and quoting heuristics
#      occasionally drift when the underlying versions change.
