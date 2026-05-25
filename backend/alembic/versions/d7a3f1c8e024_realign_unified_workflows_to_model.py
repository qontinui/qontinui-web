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

``id`` is the PRIMARY KEY and is referenced by
``project.scheduled_workflow_runs.workflow_id`` (FK, ON DELETE CASCADE), so
the FK is dropped, both endpoints are retyped to uuid, and the FK is
recreated. The FK is dropped by *discovery* (pg_constraint lookup) so this
works regardless of the constraint's generated name and is a no-op if the
FK is absent.

Sibling of the existing ``realign_workflow_variables_to_model``
(``e2c8b5d1f3a6``) pattern. Idempotent + transactional (asyncpg assumes
transactional DDL — a failed cast rolls the whole migration back with no
data loss). JSON casts use ``NULLIF(col,'')`` so an empty-string value
becomes NULL rather than failing the ``::jsonb`` cast.

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


def upgrade() -> None:
    # 1. Drop the inbound FK by discovery (name-agnostic; no-op if absent).
    op.execute(
        """
        DO $$
        DECLARE fk_name text;
        BEGIN
            SELECT conname INTO fk_name
              FROM pg_constraint
             WHERE conrelid = 'project.scheduled_workflow_runs'::regclass
               AND confrelid = 'project.unified_workflows'::regclass
               AND contype = 'f';
            IF fk_name IS NOT NULL THEN
                EXECUTE format(
                    'ALTER TABLE project.scheduled_workflow_runs DROP CONSTRAINT %I',
                    fk_name
                );
            END IF;
        END $$;
        """
    )

    # 2. Retype the PK and its dependent FK column to uuid.
    #    ``::uuid`` on an already-uuid column is a harmless self-cast.
    op.execute(
        "ALTER TABLE project.unified_workflows "
        "ALTER COLUMN id TYPE uuid USING id::uuid"
    )
    op.execute(
        "ALTER TABLE project.scheduled_workflow_runs "
        "ALTER COLUMN workflow_id TYPE uuid USING workflow_id::uuid"
    )

    # 3. Recreate the FK (matches the model: ON DELETE CASCADE). Raw SQL —
    #    schema-qualified inline (op.create_foreign_key's source_schema=/
    #    referent_schema= aren't recognised by the consolidation schema gate).
    op.execute(
        "ALTER TABLE project.scheduled_workflow_runs "
        "ADD CONSTRAINT scheduled_workflow_runs_workflow_id_fkey "
        "FOREIGN KEY (workflow_id) "
        "REFERENCES project.unified_workflows (id) ON DELETE CASCADE"
    )

    # 4. Retype the JSON columns to jsonb (empty string → NULL, not a cast error).
    for col in _JSON_COLUMNS:
        op.execute(
            f"ALTER TABLE project.unified_workflows "
            f"ALTER COLUMN {col} TYPE jsonb USING NULLIF({col}, '')::jsonb"
        )


def downgrade() -> None:
    # Revert JSON columns to text.
    for col in _JSON_COLUMNS:
        op.execute(
            f"ALTER TABLE project.unified_workflows "
            f"ALTER COLUMN {col} TYPE text USING {col}::text"
        )

    # Drop FK, revert uuid columns back to text, recreate FK.
    op.execute(
        """
        DO $$
        DECLARE fk_name text;
        BEGIN
            SELECT conname INTO fk_name
              FROM pg_constraint
             WHERE conrelid = 'project.scheduled_workflow_runs'::regclass
               AND confrelid = 'project.unified_workflows'::regclass
               AND contype = 'f';
            IF fk_name IS NOT NULL THEN
                EXECUTE format(
                    'ALTER TABLE project.scheduled_workflow_runs DROP CONSTRAINT %I',
                    fk_name
                );
            END IF;
        END $$;
        """
    )
    op.execute(
        "ALTER TABLE project.scheduled_workflow_runs "
        "ALTER COLUMN workflow_id TYPE text USING workflow_id::text"
    )
    op.execute(
        "ALTER TABLE project.unified_workflows "
        "ALTER COLUMN id TYPE text USING id::text"
    )
    op.execute(
        "ALTER TABLE project.scheduled_workflow_runs "
        "ADD CONSTRAINT scheduled_workflow_runs_workflow_id_fkey "
        "FOREIGN KEY (workflow_id) "
        "REFERENCES project.unified_workflows (id) ON DELETE CASCADE"
    )
