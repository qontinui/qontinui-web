"""
Service for Unified Workflow business logic.

Handles workflow CRUD, duplication, import/export, and response mapping.

Losslessness contract
----------------------
``POST`` / ``PUT /api/v1/unified-workflows`` is a lossless round-trip for the
full canonical ``UnifiedWorkflow`` (~58 camelCase fields). The complete
incoming object is stored verbatim in ``UnifiedWorkflow.definition`` (JSONB).
The typed ORM columns (``name``, ``setup_steps``, ``provider``, ...) are a
*derived denormalized index* projected from ``definition`` via the single
:func:`_project_definition_to_columns` function; dispatch + list/search read
those columns. The columns are never set independently of ``definition`` — they
are always re-derived, so the two cannot drift.

The request body is a permissive ``dict[str, Any]`` (canonical camelCase),
**not** the generated ``qontinui_schemas`` ``UnifiedWorkflow`` Pydantic type:
that generated type declares ``model_config = ConfigDict(extra="forbid")``,
so it would *reject* any field outside its 58 declared keys (breaking
losslessness for future/runner-specific fields) and its typed step-union
fields would re-tag / normalize step JSON on re-serialization. Storing the raw
dict guarantees nothing is dropped or mutated.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.unified_workflow import UnifiedWorkflow
from app.repositories.unified_workflow import UnifiedWorkflowRepository

logger = structlog.get_logger(__name__)


# =============================================================================
# Canonical <-> column projection
# =============================================================================
#
# The canonical payload is camelCase (see qontinui-schemas `UnifiedWorkflow`).
# Step arrays (`setupSteps`, ...) carry FullRunnerStep-shaped objects whose
# *own* fields are already camelCase (`autoFix`, `criterionIds`, `phase`, ...)
# — the same JSON the typed `*_steps` columns store today (the previous code
# stored `FullRunnerStep.model_dump(mode="json")`, which emits exactly these
# camelCase keys). So step projection is a verbatim pass-through: we copy the
# canonical step objects into the columns untouched.

# Maps a typed ORM column kwarg (snake_case) -> the canonical key (camelCase)
# that feeds it, paired with the default to use when the key is absent. Mirrors
# the defaults previously baked into `_model_to_response` so list/search/dispatch
# behaviour is unchanged for older rows.
_COLUMN_SOURCES: dict[str, tuple[str, Any]] = {
    "description": ("description", ""),
    "category": ("category", "general"),
    "tags": ("tags", []),
    "setup_steps": ("setupSteps", []),
    "verification_steps": ("verificationSteps", []),
    "agentic_steps": ("agenticSteps", []),
    "completion_steps": ("completionSteps", []),
    "max_iterations": ("maxIterations", 10),
    "timeout_seconds": ("timeoutSeconds", None),
    "provider": ("provider", None),
    "model": ("model", None),
    "skip_ai_summary": ("skipAiSummary", False),
    "log_watch_enabled": ("logWatchEnabled", True),
    "health_check_enabled": ("healthCheckEnabled", True),
    "health_check_urls": ("healthCheckUrls", []),
    "preflight_check_enabled": ("preflightCheckEnabled", True),
    "log_source_selection": ("logSourceSelection", "default"),
    "context_ids": ("contextIds", []),
    "disabled_context_ids": ("disabledContextIds", []),
    "auto_include_contexts": ("autoIncludeContexts", True),
    "prompt_template": ("promptTemplate", None),
    "enable_sweep": ("enableSweep", False),
    "max_sweep_iterations": ("maxSweepIterations", 5),
    "generated_by_task_run_id": ("generatedByTaskRunId", None),
    "stages": ("stages", None),
    "stop_on_failure": ("stopOnFailure", False),
    "approval_gate": ("approvalGate", False),
    "reflection_mode": ("reflectionMode", True),
    "constraint_overrides": ("constraintOverrides", None),
    "model_overrides": ("modelOverrides", None),
}

# Columns whose stored value must never be NULL (the model declares them
# NOT NULL). When the canonical key is present but explicitly null, fall back
# to the column default so we never violate the constraint.
_NON_NULLABLE_COLUMN_DEFAULTS: dict[str, Any] = {
    "description": "",
    "category": "general",
    "tags": [],
    "setup_steps": [],
    "verification_steps": [],
    "agentic_steps": [],
    "completion_steps": [],
    "max_iterations": 10,
    "skip_ai_summary": False,
    "log_watch_enabled": True,
    "health_check_enabled": True,
    "health_check_urls": [],
    "preflight_check_enabled": True,
    "log_source_selection": "default",
    "context_ids": [],
    "disabled_context_ids": [],
    "auto_include_contexts": True,
    "enable_sweep": False,
    "max_sweep_iterations": 5,
    "stop_on_failure": False,
    "approval_gate": False,
    "reflection_mode": True,
}


def _project_definition_to_columns(definition: dict[str, Any]) -> dict[str, Any]:
    """Project the canonical (camelCase) workflow onto typed ORM column kwargs.

    This is the ONE place camelCase->snake_case translation happens. It is
    called from both create and update so the denormalized columns are always
    a faithful derivation of ``definition`` and the two cannot drift.

    ``name`` is intentionally not included here — it is required and handled by
    the callers directly so a missing/empty name is a hard validation error
    rather than a silent default.
    """
    columns: dict[str, Any] = {}
    for column, (canonical_key, default) in _COLUMN_SOURCES.items():
        value = definition.get(canonical_key, default)
        # Honour explicit null on NOT NULL columns by substituting the default.
        if value is None and column in _NON_NULLABLE_COLUMN_DEFAULTS:
            value = _NON_NULLABLE_COLUMN_DEFAULTS[column]
        columns[column] = value
    return columns


# =============================================================================
# Response Schemas
# =============================================================================


class Pagination(BaseModel):
    """Pagination metadata for list responses."""

    total: int
    limit: int
    offset: int
    has_more: bool


class UnifiedWorkflowListResponse(BaseModel):
    """Response for listing workflows.

    Items are the lossless canonical workflow objects (camelCase) augmented
    with server-authoritative fields. They are plain dicts rather than a typed
    model so no field is ever dropped on serialization.
    """

    items: list[dict[str, Any]]
    pagination: Pagination


# =============================================================================
# Response Mapping
# =============================================================================


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _columns_to_definition(workflow: UnifiedWorkflow) -> dict[str, Any]:
    """Reconstruct a canonical (camelCase) object from the typed columns.

    Inverse of :func:`_project_definition_to_columns` — the single mapping is
    reused so the two never disagree. Used as the read fallback for rows whose
    ``definition`` blob is empty: rows that pre-date the ``definition`` column
    (their data lives only in the typed columns) and any row written by a path
    that bypasses this service. Without it those rows would read back as an
    empty canonical object, dropping their name/steps/settings on every GET.
    """
    canonical: dict[str, Any] = {"name": workflow.name}
    for column, (canonical_key, _default) in _COLUMN_SOURCES.items():
        canonical[canonical_key] = getattr(workflow, column)
    return canonical


def _model_to_response(workflow: UnifiedWorkflow) -> dict[str, Any]:
    """Return the lossless canonical workflow for a stored row.

    The response is the stored ``definition`` layered over a column-derived
    reconstruction, then augmented with server-authoritative fields. Layering
    ``definition`` on top of :func:`_columns_to_definition` means service-written
    rows return their lossless blob verbatim (it wins key-for-key and carries the
    ~24 fields that have no column), while pre-``definition`` rows (empty blob)
    still return a faithful canonical object rebuilt from the typed columns —
    without this fallback they would read back empty. Server fields overwrite any
    stale copies in ``definition`` so the authoritative values always win.

    Timestamps are surfaced in both camelCase (``createdAt``) and the
    ``modified_at`` casing the canonical TS type declares for last-modified.
    ``created_at`` / ``modified_at`` snake_case aliases are also included for
    consumers that read the legacy shape.
    """
    # Reconstruct from columns, then overlay the lossless blob (blob wins where
    # present; columns fill rows whose blob is empty). Copy so we never mutate
    # the ORM-attached dict.
    response: dict[str, Any] = _columns_to_definition(workflow)
    response.update(workflow.definition or {})

    created_at = _iso(workflow.created_at)
    modified_at = _iso(workflow.updated_at)

    response.update(
        {
            "id": str(workflow.id),
            "createdByUserId": (
                str(workflow.created_by_user_id)
                if workflow.created_by_user_id
                else None
            ),
            "projectId": str(workflow.project_id) if workflow.project_id else None,
            "createdAt": created_at,
            "modified_at": modified_at,
            # Legacy snake_case aliases for older consumers.
            "created_by_user_id": (
                str(workflow.created_by_user_id)
                if workflow.created_by_user_id
                else None
            ),
            "project_id": str(workflow.project_id) if workflow.project_id else None,
            "created_at": created_at,
        }
    )
    return response


# =============================================================================
# Service
# =============================================================================


class UnifiedWorkflowService:
    """Service for unified workflow business logic."""

    def __init__(
        self,
        repo: UnifiedWorkflowRepository | None = None,
    ) -> None:
        self.repo = repo or UnifiedWorkflowRepository()

    @staticmethod
    def _validate_name(definition: dict[str, Any]) -> str:
        """Extract and validate the required, non-empty workflow name."""
        name = definition.get("name")
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(
                status_code=422,
                detail="Workflow 'name' is required and must be a non-empty string.",
            )
        return name

    async def create_workflow(
        self,
        db: AsyncSession,
        data: dict[str, Any],
        user_id: UUID,
    ) -> dict[str, Any]:
        """Create a new unified workflow from a canonical (camelCase) payload.

        The full incoming object is stored verbatim in ``definition``; the
        typed columns are derived from it via
        :func:`_project_definition_to_columns`. Server-authoritative fields
        (``created_by_user_id``, ``project_id``, optional client-supplied
        ``id`` for runner migration) are applied on top.
        """
        # Store the complete canonical object losslessly. Copy so later server
        # field handling never mutates the caller's dict.
        definition: dict[str, Any] = dict(data)
        name = self._validate_name(definition)

        # Server-authoritative / non-canonical fields are routed to columns and
        # must not pollute the stored canonical definition.
        client_id = definition.pop("project_id", None)
        project_id = definition.pop("projectId", None) or client_id
        supplied_id = definition.get("id") or None

        workflow = UnifiedWorkflow(
            id=UUID(supplied_id) if supplied_id else None,
            created_by_user_id=user_id,
            project_id=UUID(project_id) if project_id else None,
            name=name,
            definition=definition,
            **_project_definition_to_columns(definition),
        )

        try:
            created = await self.repo.create(db, workflow)
            await db.commit()
        except Exception as e:
            await db.rollback()
            if "duplicate" in str(e).lower() or "unique" in str(e).lower():
                raise HTTPException(
                    status_code=409,
                    detail=f"Workflow with ID {supplied_id} already exists",
                ) from e
            raise

        logger.info(
            "Created workflow",
            workflow_id=str(created.id),
            name=name,
            user_id=str(user_id),
        )

        return _model_to_response(created)

    async def update_workflow(
        self,
        db: AsyncSession,
        workflow_id: UUID,
        data: dict[str, Any],
        user_id: UUID,
    ) -> dict[str, Any]:
        """Update a workflow by merging a canonical (camelCase) patch.

        The incoming patch is shallow-merged into the stored ``definition``
        (incoming top-level keys overwrite). The merged ``definition`` is
        written back and ALL typed columns are re-derived from it via
        :func:`_project_definition_to_columns`. Typed columns are never set
        independently of ``definition`` so the two cannot drift.
        """
        workflow = await self.repo.get_by_id(db, workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        patch: dict[str, Any] = dict(data)

        # Pull server-authoritative / non-canonical fields out of the patch.
        project_id_set = "projectId" in patch or "project_id" in patch
        project_id = patch.pop("projectId", None)
        legacy_project_id = patch.pop("project_id", None)
        if project_id is None:
            project_id = legacy_project_id

        # Shallow-merge the patch into the stored canonical definition. Assign a
        # fresh dict (not in-place mutation) so SQLAlchemy flags the JSONB column
        # dirty and persists the change.
        merged: dict[str, Any] = dict(workflow.definition or {})
        merged.update(patch)

        # Validate the post-merge name (a partial update must not erase it).
        name = self._validate_name(merged)

        workflow.definition = merged
        workflow.name = name
        for column, value in _project_definition_to_columns(merged).items():
            setattr(workflow, column, value)

        if project_id_set:
            workflow.project_id = UUID(project_id) if project_id else None

        updated = await self.repo.update(db, workflow)
        await db.commit()

        logger.info(
            "Updated workflow",
            workflow_id=str(workflow_id),
            patched_keys=list(patch.keys()),
            user_id=str(user_id),
        )

        return _model_to_response(updated)

    async def delete_workflow(
        self,
        db: AsyncSession,
        workflow_id: UUID,
        user_id: UUID,
    ) -> None:
        """Delete a unified workflow."""
        workflow = await self.repo.get_by_id(db, workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        await self.repo.delete(db, workflow)
        await db.commit()

        logger.info(
            "Deleted workflow",
            workflow_id=str(workflow_id),
            user_id=str(user_id),
        )

    async def get_workflow(
        self,
        db: AsyncSession,
        workflow_id: UUID,
    ) -> dict[str, Any]:
        """Get a unified workflow by ID."""
        workflow = await self.repo.get_by_id(db, workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")
        return _model_to_response(workflow)

    async def list_workflows(
        self,
        db: AsyncSession,
        user_id: UUID | None = None,
        project_id: UUID | None = None,
        category: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> UnifiedWorkflowListResponse:
        """List unified workflows with optional filters."""
        workflows, total = await self.repo.list_workflows(
            db,
            user_id=user_id,
            project_id=project_id,
            category=category,
            offset=offset,
            limit=limit,
        )
        return UnifiedWorkflowListResponse(
            items=[_model_to_response(w) for w in workflows],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def search_workflows(
        self,
        db: AsyncSession,
        user_id: UUID | None = None,
        q: str | None = None,
        category: str | None = None,
        tag: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> UnifiedWorkflowListResponse:
        """Search unified workflows with text query."""
        workflows, total = await self.repo.search(
            db,
            user_id=user_id,
            q=q,
            category=category,
            tag=tag,
            offset=offset,
            limit=limit,
        )
        return UnifiedWorkflowListResponse(
            items=[_model_to_response(w) for w in workflows],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def duplicate_workflow(
        self,
        db: AsyncSession,
        workflow_id: UUID,
        user_id: UUID,
    ) -> dict[str, Any]:
        """Duplicate an existing workflow losslessly.

        Clones the full canonical ``definition`` (so no field is lost), renames
        the copy, drops the original id, and re-derives the typed columns via
        the shared projection.
        """
        original = await self.repo.get_by_id(db, workflow_id)
        if not original:
            raise ValueError(f"Workflow not found: {workflow_id}")

        definition: dict[str, Any] = dict(original.definition or {})
        # New row: drop the cloned id and bump the name.
        definition.pop("id", None)
        new_name = f"{original.name} (copy)"
        definition["name"] = new_name

        clone = UnifiedWorkflow(
            created_by_user_id=user_id,
            project_id=original.project_id,
            name=new_name,
            definition=definition,
            **_project_definition_to_columns(definition),
        )

        created = await self.repo.create(db, clone)
        await db.commit()

        logger.info(
            "Duplicated workflow",
            original_id=str(workflow_id),
            new_id=str(created.id),
            user_id=str(user_id),
        )

        return _model_to_response(created)

    async def export_workflow(
        self,
        db: AsyncSession,
        workflow_id: UUID,
    ) -> dict[str, Any]:
        """Export a workflow as the lossless canonical object."""
        workflow = await self.repo.get_by_id(db, workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        return _model_to_response(workflow)

    async def import_workflow(
        self,
        db: AsyncSession,
        data: dict[str, Any],
        user_id: UUID,
    ) -> dict[str, Any]:
        """Import a workflow from exported canonical data.

        The whole exported object is treated as the canonical definition. The
        original id is dropped so a fresh row is created.
        """
        definition: dict[str, Any] = dict(data)
        definition.pop("id", None)
        return await self.create_workflow(db, definition, user_id)
