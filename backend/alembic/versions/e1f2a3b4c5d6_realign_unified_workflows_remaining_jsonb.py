"""realign_unified_workflows_remaining_jsonb

Follow-up to ``d7a3f1c8e024``. That revision was edited in place across
several deploys; the version that actually applied to staging RDS converted
``id`` + the FIRST 9 jsonb columns, but staging recorded the revision as
applied BEFORE the body was extended to cover ``stages``,
``constraint_overrides`` and ``model_overrides``. Alembic tracks by revision
id, not content, so re-deploying ``d7a3f1c8e024`` was a no-op on staging and
those three columns stayed ``text`` — surfacing as a response 500:

    ValidationError: 3 validation errors for UnifiedWorkflowResponse
      stages / constraint_overrides / model_overrides
      Input should be a valid list/dictionary [input_value='null', input_type=str]

This NEW revision converts every model-declared jsonb column to jsonb,
guarded by an ``information_schema`` ``data_type`` check so each column is
altered ONLY if still ``text``. On staging that catches the three stragglers;
on any DB where ``d7a3f1c8e024`` already converted all twelve (fresh applies
of the final body, or the ``b97e3bd6e0c7`` create lineage) every column is
already jsonb and this is a complete no-op. Idempotent + transactional.

``stages`` / ``constraint_overrides`` / ``model_overrides`` take no
``server_default`` (the model declares none — ``Mapped[list|None]`` /
``Mapped[dict|None]``); the stored ``'null'`` text → jsonb null → Python
``None`` → ``_model_to_response``'s ``or []`` coalescing.

Revision ID: e1f2a3b4c5d6
Revises: d7a3f1c8e024
Create Date: 2026-05-26
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d7a3f1c8e024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every model-declared jsonb column → its jsonb server_default (None when the
# model declares none). Mirrors d7a3f1c8e024; the guard makes already-jsonb
# columns a no-op, so listing all twelve is safe and self-healing.
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


def _retype_json_column(col: str, target: str, default: str | None) -> str:
    set_default = (
        f"ALTER TABLE project.unified_workflows ALTER COLUMN {col} SET DEFAULT {default};"
        if default
        else ""
    )
    using = f"NULLIF({col}, '')::jsonb" if target == "jsonb" else f"{col}::text"
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
    for col, default in _JSONB_COLUMNS.items():
        op.execute(_retype_json_column(col, "jsonb", default))


def downgrade() -> None:
    # No-op: the prior revisions own the text→jsonb history; reverting types
    # here would fight d7a3f1c8e024's downgrade. This follow-up only fills the
    # gap left by an in-place edit and has nothing distinct to undo.
    pass
