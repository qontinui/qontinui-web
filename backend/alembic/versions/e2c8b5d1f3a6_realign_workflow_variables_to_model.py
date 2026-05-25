"""realign_workflow_variables_to_model

Realigns ``project.workflow_variables`` to the shape the
``WorkflowVariable`` SQLAlchemy model
(``backend/app/models/workflow_variable.py``) and the
``/api/v1/variables/global`` endpoint actually use.

Root cause — a table-name collision baked into the consolidation chain:

  * ``05a366f58455_initial_schema_squashed`` (the single base) created
    ``project.workflow_variables`` as the PROJECT-VARIABLE store the ORM
    expects::

        id, project_id (FK project.projects), workflow_id, name,
        value (JSON), scope (enum variablescope), description,
        created_at, updated_at

  * ``consolidation_phase1_01_infrastructure`` then did
    ``DROP SCHEMA IF EXISTS project RESTRICT`` and the consolidation
    series re-created ``project.workflow_variables`` in
    ``consolidation_phase1_20_tail_specialty`` with a COMPLETELY DIFFERENT,
    unrelated shape — a per-run variable-capture table::

        id, task_run_id (FK project.task_runs), variable_name,
        variable_value, source, source_step_id, created_at

The consolidation (capture) shape is what is live on staging. No backend
or runner code reads it — the only consumers of
``project.workflow_variables`` are the ORM model + the variables endpoint,
both of which use the project-variable shape. As a result every
``GET /api/v1/variables/global?project_id=<id>`` (the automation-builder
page loads global variables on mount) crashes::

    asyncpg.exceptions.UndefinedColumnError:
        column workflow_variables.project_id does not exist

This is the live same-origin 500 the Spec CI HTTP-500 invariant surfaced
for the ``automation-builder`` and ``automation-builder-workflow-crud``
specs.

Fix: drop the orphaned capture-shaped table and re-create
``project.workflow_variables`` with the model's project-variable shape
(matching the ``05a366f58455`` squash definition + the model). Guarded so
it is safe and idempotent:

  * If the table already has the model's ``project_id`` column, the table
    is already correct — no-op (idempotent re-apply; protects any env that
    somehow still carries the squash shape).
  * Else, if the capture-shaped table holds rows, ABORT with an exception
    — the capture data would need a separate, deliberate migration. (On
    canonical/staging the table is empty: no code writes it.)
  * Else drop the empty capture table and re-create the correct shape.

The re-created table reproduces the model's columns, the
``uq_project_workflow_var`` unique constraint, the cross-schema FK to
``project.projects(id)``, and the three model indexes.

Revision ID: e2c8b5d1f3a6
Revises: d1f4a7b2c9e0
Create Date: 2026-05-25
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2c8b5d1f3a6"
down_revision: str | None = "d1f4a7b2c9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# All DDL is schema-qualified (``project.*``) per the alembic schema-args
# gate (.pre-commit-hooks/check_alembic_schema_args.py).
_UPGRADE_SQL = """
DO $$
DECLARE
    has_project_id BOOLEAN;
    has_table BOOLEAN;
    row_count BIGINT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'project'
          AND table_name = 'workflow_variables'
          AND table_type = 'BASE TABLE'
    ) INTO has_table;

    IF NOT has_table THEN
        RAISE NOTICE 'realign_workflow_variables: project.workflow_variables absent — creating from model shape';
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'project'
              AND table_name = 'workflow_variables'
              AND column_name = 'project_id'
        ) INTO has_project_id;

        IF has_project_id THEN
            RAISE NOTICE 'realign_workflow_variables: already model-shaped (project_id present) — no-op';
            RETURN;
        END IF;

        EXECUTE 'SELECT COUNT(*) FROM project.workflow_variables' INTO row_count;
        IF row_count > 0 THEN
            RAISE EXCEPTION 'realign_workflow_variables: capture-shaped project.workflow_variables holds % row(s); refusing to drop — needs a deliberate data migration', row_count;
        END IF;

        EXECUTE 'DROP TABLE project.workflow_variables CASCADE';
        RAISE NOTICE 'realign_workflow_variables: dropped empty capture-shaped table';
    END IF;

    -- variablescope enum may survive from the squash lineage; create only if missing.
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'variablescope') THEN
        CREATE TYPE variablescope AS ENUM ('GLOBAL', 'WORKFLOW');
    END IF;

    CREATE TABLE project.workflow_variables (
        id VARCHAR NOT NULL,
        project_id UUID NOT NULL,
        workflow_id VARCHAR,
        name VARCHAR NOT NULL,
        value JSON,
        scope variablescope NOT NULL,
        description VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT pk_workflow_variables PRIMARY KEY (id),
        CONSTRAINT uq_project_workflow_var UNIQUE (project_id, workflow_id, name),
        CONSTRAINT fk_workflow_variables_project_id FOREIGN KEY (project_id)
            REFERENCES project.projects (id)
    );
    CREATE INDEX ix_workflow_variables_project_id
        ON project.workflow_variables (project_id);
    CREATE INDEX ix_workflow_variables_workflow_id
        ON project.workflow_variables (workflow_id);
    CREATE INDEX ix_workflow_variables_scope
        ON project.workflow_variables (scope);
    CREATE INDEX ix_workflow_variables_name
        ON project.workflow_variables (name);
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    raise NotImplementedError(
        "realign_workflow_variables: the prior capture-shaped "
        "project.workflow_variables table was orphaned (no code path read "
        "it) and empty by precondition, so this drop+recreate is not "
        "reversibly meaningful. The model-shaped table can be re-derived "
        "from the SQLAlchemy model; the capture shape, if ever needed, "
        "should be a new, differently-named table."
    )
