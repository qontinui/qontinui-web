"""realign_unified_workflows_to_model

Realigns ``project.unified_workflows`` column TYPES to the ORM model.

The consolidation lineage (``consolidation_phase1_04_workflows.py``) plus the
later sweep/stages migrations created ``project.unified_workflows`` with
generic types that do NOT match ``app/models/unified_workflow.py``:

  * ``id``                     text  → uuid  (PRIMARY KEY)
  * 12 JSON columns            text  → jsonb (see ``_JSONB_COLUMNS`` below)

The ``id text`` drift is the hard write failure: ``create_workflow`` inserts
a row then the ORM re-SELECTs ``WHERE id = $1::UUID`` →
``operator does not exist: text = uuid``. The JSON columns are read failures:
``_model_to_response`` gets a Python ``str`` (e.g. the literal ``'null'`` or a
JSON-array string) where ``UnifiedWorkflowResponse`` expects a list/dict, so
the response 500s with ``ValidationError`` even after the row is committed.
Both break BOTH workflow creation and ORM-based dispatch reads. Observed on
staging RDS 2026-05-25.

``id`` is the PRIMARY KEY referenced by MULTIPLE inbound FKs
(``scheduled_workflow_runs.workflow_id``, ``workflow_versions.workflow_id``,
possibly more), so this discovers every inbound FK from ``pg_constraint``,
captures each via ``pg_get_constraintdef``, drops them, retypes the PK + every
referencing column to uuid, then recreates the FKs exactly.

Idempotent + transactional:
  * The id/FK retype uses ``::uuid`` self-casts and pg_get_constraintdef
    round-trips, so it is a no-op on an already-uuid DB.
  * Each JSON column is altered ONLY if it is still ``text`` (guarded by an
    ``information_schema`` check), so it is a no-op on a DB whose columns are
    already jsonb (e.g. the ``b97e3bd6e0c7`` create lineage). This also keeps
    ``NULLIF(col,'')`` from being applied to a jsonb column.
  * The text default is DROPped before the jsonb cast (Postgres can't
    auto-cast a column DEFAULT to jsonb), then re-SET to the model's jsonb
    ``server_default`` where the model declares one.

Sibling of ``realign_workflow_variables_to_model`` (``e2c8b5d1f3a6``).

Revision ID: d7a3f1c8e024
Revises: c9e1f5a3b7d2
Create Date: 2026-05-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d7a3f1c8e024"
down_revision: str | None = "c9e1f5a3b7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every column the model declares as JSONB → its jsonb ``server_default``
# (or None when the model declares no server_default — nullable jsonb).
_JSONB_COLUMNS = {
    "tags": "'[]'::jsonb",
    "setup_steps": "'[]'::jsonb",
    "verification_steps": "'[]'::jsonb",
    "agentic_steps": "'[]'::jsonb",
    "completion_steps": "'[]'::jsonb",
    "health_check_urls": "'[]'::jsonb",
    "log_source_selection": "'\"default\"'::jsonb",
    "context_ids": "'[]'::jsonb",
    "disabled_context_ids": "'[]'::jsonb",
    "stages": None,
    "constraint_overrides": None,
    "model_overrides": None,
}


def _retype_id_and_inbound_fks(target_type: str) -> str:
    """DO block: drop every inbound FK to ``project.unified_workflows``,
    retype the PK + each referencing column to ``target_type``, recreate the
    FKs from their captured definitions. ``::uuid``/``::text`` self-casts make
    it a no-op when already the target type."""
    return f"""
        DO $$
        DECLARE
            fk record;
            stmt text;
            recreate text[] := '{{}}';
        BEGIN
            FOR fk IN
                SELECT con.conname AS name,
                       con.conrelid::regclass::text AS tbl,
                       a.attname AS col,
                       pg_get_constraintdef(con.oid) AS def
                  FROM pg_constraint con
                  JOIN pg_attribute a
                    ON a.attrelid = con.conrelid
                   AND a.attnum = ANY (con.conkey)
                 WHERE con.confrelid = 'project.unified_workflows'::regclass
                   AND con.contype = 'f'
            LOOP
                recreate := array_append(
                    recreate,
                    format('ALTER TABLE %s ADD CONSTRAINT %I %s',
                           fk.tbl, fk.name, fk.def));
                EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
                               fk.tbl, fk.name);
                EXECUTE format(
                    'ALTER TABLE %s ALTER COLUMN %I TYPE {target_type} USING %I::{target_type}',
                    fk.tbl, fk.col, fk.col);
            END LOOP;

            EXECUTE 'ALTER TABLE project.unified_workflows '
                 || 'ALTER COLUMN id TYPE {target_type} USING id::{target_type}';

            FOREACH stmt IN ARRAY recreate LOOP
                EXECUTE stmt;
            END LOOP;
        END $$;
    """


def _retype_json_column(col: str, target: str, default: str | None) -> str:
    """DO block that retypes ``col`` to ``target`` (jsonb/text) ONLY if it is
    not already that type, dropping the column default first and re-setting it
    when one is given. ``USING NULLIF(col,'')::{target}`` maps empty string →
    NULL and a stored ``'null'`` → SQL NULL on the jsonb side."""
    set_default = (
        f"ALTER TABLE project.unified_workflows ALTER COLUMN {col} SET DEFAULT {default};"
        if default
        else ""
    )
    # text→jsonb: map '' → NULL so an empty string doesn't break the cast.
    # jsonb→text: a plain cast (NULLIF against '' would type-mismatch on jsonb).
    using = (
        f"NULLIF({col}, '')::jsonb" if target == "jsonb" else f"{col}::text"
    )
    return f"""
        DO $$
        BEGIN
            IF (SELECT data_type
                  FROM information_schema.columns
                 WHERE table_schema = 'project'
                   AND table_name = 'unified_workflows'
                   AND column_name = '{col}') <> '{target}' THEN
                ALTER TABLE project.unified_workflows ALTER COLUMN {col} DROP DEFAULT;
                ALTER TABLE project.unified_workflows
                    ALTER COLUMN {col} TYPE {target} USING {using};
                {set_default}
            END IF;
        END $$;
    """


def upgrade() -> None:
    # PK + all inbound FK columns → uuid (FKs dropped/recreated by discovery).
    op.execute(_retype_id_and_inbound_fks("uuid"))

    # All 12 JSON columns → jsonb (guarded; only the ones still text).
    for col, default in _JSONB_COLUMNS.items():
        op.execute(_retype_json_column(col, "jsonb", default))


def downgrade() -> None:
    for col in _JSONB_COLUMNS:
        text_default = (
            "'\"default\"'" if col == "log_source_selection" else "'[]'"
        ) if _JSONB_COLUMNS[col] is not None else None
        op.execute(_retype_json_column(col, "text", text_default))
    op.execute(_retype_id_and_inbound_fks("text"))
