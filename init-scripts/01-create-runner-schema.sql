-- Runner schema for qontinui-runner's PostgreSQL tables.
-- Executed once on first PostgreSQL container startup via docker-entrypoint-initdb.d.
-- Separate from qontinui-web's public schema.

CREATE SCHEMA IF NOT EXISTS runner;
GRANT ALL ON SCHEMA runner TO qontinui_user;

-- Enable pgvector for future embedding columns
CREATE EXTENSION IF NOT EXISTS vector;

-- ----------------------------------------------------------------------------
-- Section 11 / Phase A2: Regression suite persistence (UI Bridge regression
-- subsystem). The runner crate also self-bootstraps these on first connect
-- (see src-tauri/src/database/pg/mod.rs); duplicated here for parity with
-- the docker volume init path. Tables are created in the default search_path
-- (project schema) once the qontinui-web alembic chain runs.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regression_suites (
    id           UUID PRIMARY KEY,
    ir_doc_id    TEXT NOT NULL,
    suite_json   JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS regression_suites_ir_doc_id_idx ON regression_suites(ir_doc_id);

CREATE TABLE IF NOT EXISTS regression_runs (
    id              UUID PRIMARY KEY,
    suite_id        UUID NOT NULL REFERENCES regression_suites(id) ON DELETE CASCADE,
    run_id          TEXT NOT NULL,
    passed          INT NOT NULL,
    failed          INT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ NOT NULL,
    run_result_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS regression_runs_suite_id_idx ON regression_runs(suite_id);

CREATE TABLE IF NOT EXISTS regression_diagnoses (
    id              UUID PRIMARY KEY,
    run_id          UUID NOT NULL REFERENCES regression_runs(id) ON DELETE CASCADE,
    diagnosis_json  JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS regression_diagnoses_run_id_idx ON regression_diagnoses(run_id);

CREATE TABLE IF NOT EXISTS regression_assertion_executions (
    id                    UUID PRIMARY KEY,
    run_id                UUID NOT NULL REFERENCES regression_runs(id) ON DELETE CASCADE,
    case_id               TEXT NOT NULL,
    assertion_id          TEXT NOT NULL,
    assertion_kind        TEXT NOT NULL, -- 'state-active' | 'action-target-resolves' | 'visual-gate' | 'overlay'
    status                TEXT NOT NULL, -- 'pass' | 'fail' | 'skip'
    started_at            TIMESTAMPTZ NOT NULL,
    duration_ms           INT NOT NULL,
    failure_kind          TEXT,
    failure_evidence_json JSONB,
    error_message         TEXT
);
CREATE INDEX IF NOT EXISTS regression_assertion_executions_run_id_idx ON regression_assertion_executions(run_id);
CREATE INDEX IF NOT EXISTS regression_assertion_executions_case_assertion_idx ON regression_assertion_executions(case_id, assertion_id, started_at DESC);
CREATE INDEX IF NOT EXISTS regression_assertion_executions_kind_status_idx ON regression_assertion_executions(assertion_kind, status);
CREATE INDEX IF NOT EXISTS regression_assertion_executions_failures_idx ON regression_assertion_executions(case_id, assertion_id) WHERE status = 'fail';
