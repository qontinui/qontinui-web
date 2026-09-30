-- Runner schema for qontinui-runner's PostgreSQL tables.
-- Executed once on first PostgreSQL container startup via docker-entrypoint-initdb.d.
-- Separate from qontinui-web's public schema.

CREATE SCHEMA IF NOT EXISTS runner;
GRANT ALL ON SCHEMA runner TO qontinui_user;

-- Enable pgvector for future embedding columns
CREATE EXTENSION IF NOT EXISTS vector;

-- ----------------------------------------------------------------------------
-- The UI Bridge regression tables are NOT created here. Atlas owns them in the
-- `atlas_managed` schema (qontinui-runner/atlas/schema.hcl, plan
-- 2026-05-14-atlas-wave-6-triage); `atlas schema apply --env runner_pilot`
-- creates them, and the runner's boot self-heal moves any legacy
-- `project.regression_*` copies into `atlas_managed`.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Dev Docker volumes initialised before qontinui-web#1546 may still carry four
-- orphaned tables in `public`: regression_suites, regression_runs,
-- regression_diagnoses and regression_assertion_executions. The old version of
-- this script created them unqualified at initdb time, and initdb's
-- search_path put them in `public`. Nothing reads them (the runner's move only
-- looks in `project`). To clear them, recreate the volume with
-- `docker compose down -v`, or DROP TABLE those four by hand on that volume.
-- No automated drop lives here: it would need an exception to
-- .github/workflows/forbid-public-schema.yml for data nothing reads.
-- ----------------------------------------------------------------------------
