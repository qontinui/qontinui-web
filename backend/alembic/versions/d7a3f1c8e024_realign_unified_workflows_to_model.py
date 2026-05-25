"""realign_unified_workflows_to_model

Realigns ``project.unified_workflows`` column TYPES to the ORM model.

The consolidation lineage (``consolidation_phase1_04_workflows.py``) created
``project.unified_workflows`` with generic types that do NOT match
``app/models/unified_workflow.py``:

  * ``id``                     text   → should be uuid  (PRIMARY KEY)
  * ``tags``                   text   → jsonb
  * ``setup_steps``            text   → jsonb
  * ``verification_steps``     text   → jsonb
  * ``agentic_steps``          text   → jsonb
  * ``completion_steps``       text   → jsonb
  * ``health_check_urls``      text   → jsonb
  * ``log_source_selection``   text   → jsonb
  * ``context_ids``            text   → jsonb
  * ``disabled_context_ids``   text   → jsonb

The ``id text`` drift is the hard failure: ``create_workflow`` inserts a
row then the ORM re-SELECTs ``WHERE id = $1::UUID``, which Postgres rejects
with ``operator does not exist: text = uuid``. This breaks BOTH workflow
creation AND every ORM-based read on staging (including the dispatch path,
``workflow_dispatcher`` → ``select(UnifiedWorkflow)``). Observed on staging
RDS 2026-05-25 immediately after ``c9e1f5a3b7d2`` added the missing columns.

``id`` is the PRIMARY KEY and is referenced by MULTIPLE inbound foreign
keys (``project.scheduled_workflow_runs.workflow_id``,
``project.workflow_versions.workflow_id``, and potentially others created
directly in SQL rather than via an ORM relationship). Retyping the PK while
those FKs reference a ``text`` column fails with
``DatatypeMismatch: ... incompatible types: text and uuid``. So this
migration discovers EVERY inbound FK generically from ``pg_constraint``,
captures each definition via ``pg_get_constraintdef``, drops them, retypes
the PK and every referencing column to uuid, then recreates the FKs exactly
as they were. This is name- and count-agnostic — it adapts to whatever FKs
exist on the target DB.

Sibling of the existing ``realign_workflow_variables_to_model``
(``e2c8b5d1f3a6``). Idempotent + transactional (asyncpg/psycopg assume
transactional DDL — a failed cast rolls the whole migration back with no
data loss). ``::uuid`` on an already-uuid column is a harmless self-cast, so
re-running on an already-correct DB is a no-op. JSON casts use
``NULLIF(col,'')`` so an empty-string value becomes NULL rather than
failing the ``::jsonb`` cast.

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

# JSON-array / JSON-object columns the consolidation created as ``text``.
_JSON_COLUMNS = (
    "tags",
    "setup_steps",
    "verification_steps",
    "agentic_steps",
    "completion_steps",
    "health_check_urls",
    "log_source_selection",
    "context_ids",
    "disabled_context_ids",
)


def _retype_id_and_inbound_fks(target_type: str) -> str:
    """Build a DO block that drops every inbound FK to
    ``project.unified_workflows``, retypes the PK + each referencing column
    to ``target_type``, then recreates the FKs from their captured
    definitions. ``target_type`` is ``uuid`` (upgrade) or ``text``
    (downgrade)."""
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


def upgrade() -> None:
    # PK + all inbound FK columns → uuid (FKs dropped/recreated by discovery).
    op.execute(_retype_id_and_inbound_fks("uuid"))

    # JSON columns → jsonb (empty string → NULL, not a cast error).
    for col in _JSON_COLUMNS:
        op.execute(
            f"ALTER TABLE project.unified_workflows "
            f"ALTER COLUMN {col} TYPE jsonb USING NULLIF({col}, '')::jsonb"
        )


def downgrade() -> None:
    for col in _JSON_COLUMNS:
        op.execute(
            f"ALTER TABLE project.unified_workflows "
            f"ALTER COLUMN {col} TYPE text USING {col}::text"
        )
    op.execute(_retype_id_and_inbound_fks("text"))
