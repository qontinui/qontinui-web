"""
Service for Unified Workflow business logic.

Handles workflow CRUD, duplication, import/export, and response mapping.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.unified_workflow import UnifiedWorkflow
from app.repositories.unified_workflow import UnifiedWorkflowRepository

logger = structlog.get_logger(__name__)


# =============================================================================
# Request/Response Schemas
# =============================================================================


class UnifiedWorkflowCreate(BaseModel):
    """Request to create a workflow."""

    id: str | None = None  # Runner can specify UUID during migration
    name: str
    description: str = ""
    category: str = "general"
    tags: list[str] = Field(default_factory=list)
    setup_steps: list[Any] = Field(default_factory=list)
    verification_steps: list[Any] = Field(default_factory=list)
    agentic_steps: list[Any] = Field(default_factory=list)
    completion_steps: list[Any] = Field(default_factory=list)
    max_iterations: int = 10
    timeout_seconds: int | None = None
    provider: str | None = None
    model: str | None = None
    skip_ai_summary: bool = False
    log_watch_enabled: bool = True
    health_check_enabled: bool = True
    health_check_urls: list[Any] = Field(default_factory=list)
    preflight_check_enabled: bool = True
    log_source_selection: Any = "default"
    context_ids: list[str] = Field(default_factory=list)
    disabled_context_ids: list[str] = Field(default_factory=list)
    auto_include_contexts: bool = True
    prompt_template: str | None = None
    enable_sweep: bool = False
    max_sweep_iterations: int = 5
    generated_by_task_run_id: str | None = None
    project_id: str | None = None


class UnifiedWorkflowUpdate(BaseModel):
    """Request to update a workflow. All fields optional."""

    name: str | None = None
    description: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    setup_steps: list[Any] | None = None
    verification_steps: list[Any] | None = None
    agentic_steps: list[Any] | None = None
    completion_steps: list[Any] | None = None
    max_iterations: int | None = None
    timeout_seconds: int | None = None
    provider: str | None = None
    model: str | None = None
    skip_ai_summary: bool | None = None
    log_watch_enabled: bool | None = None
    health_check_enabled: bool | None = None
    health_check_urls: list[Any] | None = None
    preflight_check_enabled: bool | None = None
    log_source_selection: Any | None = None
    context_ids: list[str] | None = None
    disabled_context_ids: list[str] | None = None
    auto_include_contexts: bool | None = None
    prompt_template: str | None = None
    enable_sweep: bool | None = None
    max_sweep_iterations: int | None = None
    generated_by_task_run_id: str | None = None
    project_id: str | None = None


class UnifiedWorkflowResponse(BaseModel):
    """Response for a workflow."""

    id: str
    created_by_user_id: str | None
    project_id: str | None
    name: str
    description: str
    category: str
    tags: list[str]
    setup_steps: list[Any]
    verification_steps: list[Any]
    agentic_steps: list[Any]
    completion_steps: list[Any]
    max_iterations: int
    timeout_seconds: int | None
    provider: str | None
    model: str | None
    skip_ai_summary: bool
    log_watch_enabled: bool
    health_check_enabled: bool
    health_check_urls: list[Any]
    preflight_check_enabled: bool
    log_source_selection: Any
    context_ids: list[str]
    disabled_context_ids: list[str]
    auto_include_contexts: bool
    prompt_template: str | None
    enable_sweep: bool
    max_sweep_iterations: int
    generated_by_task_run_id: str | None
    created_at: datetime
    modified_at: datetime  # Exposed as modified_at for frontend compat


class Pagination(BaseModel):
    """Pagination metadata for list responses."""

    total: int
    limit: int
    offset: int
    has_more: bool


class UnifiedWorkflowListResponse(BaseModel):
    """Response for listing workflows."""

    items: list[UnifiedWorkflowResponse]
    pagination: Pagination


# =============================================================================
# Response Mapping
# =============================================================================


def _model_to_response(workflow: UnifiedWorkflow) -> UnifiedWorkflowResponse:
    return UnifiedWorkflowResponse(
        id=str(workflow.id),
        created_by_user_id=(
            str(workflow.created_by_user_id) if workflow.created_by_user_id else None
        ),
        project_id=str(workflow.project_id) if workflow.project_id else None,
        name=workflow.name,
        description=workflow.description or "",
        category=workflow.category or "general",
        tags=workflow.tags or [],
        setup_steps=workflow.setup_steps or [],
        verification_steps=workflow.verification_steps or [],
        agentic_steps=workflow.agentic_steps or [],
        completion_steps=workflow.completion_steps or [],
        max_iterations=workflow.max_iterations or 10,
        timeout_seconds=workflow.timeout_seconds,
        provider=workflow.provider,
        model=workflow.model,
        skip_ai_summary=workflow.skip_ai_summary or False,
        log_watch_enabled=(
            workflow.log_watch_enabled
            if workflow.log_watch_enabled is not None
            else True
        ),
        health_check_enabled=(
            workflow.health_check_enabled
            if workflow.health_check_enabled is not None
            else True
        ),
        health_check_urls=workflow.health_check_urls or [],
        preflight_check_enabled=(
            workflow.preflight_check_enabled
            if workflow.preflight_check_enabled is not None
            else True
        ),
        log_source_selection=(
            workflow.log_source_selection
            if workflow.log_source_selection is not None
            else "default"
        ),
        context_ids=workflow.context_ids or [],
        disabled_context_ids=workflow.disabled_context_ids or [],
        auto_include_contexts=(
            workflow.auto_include_contexts
            if workflow.auto_include_contexts is not None
            else True
        ),
        prompt_template=workflow.prompt_template,
        enable_sweep=workflow.enable_sweep
        if workflow.enable_sweep is not None
        else False,
        max_sweep_iterations=workflow.max_sweep_iterations
        if workflow.max_sweep_iterations is not None
        else 5,
        generated_by_task_run_id=workflow.generated_by_task_run_id,
        created_at=workflow.created_at,
        modified_at=workflow.updated_at,
    )


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

    async def create_workflow(
        self,
        db: AsyncSession,
        data: UnifiedWorkflowCreate,
        user_id: UUID,
    ) -> UnifiedWorkflowResponse:
        """Create a new unified workflow."""
        workflow = UnifiedWorkflow(
            id=UUID(data.id) if data.id else None,
            created_by_user_id=user_id,
            project_id=UUID(data.project_id) if data.project_id else None,
            name=data.name,
            description=data.description,
            category=data.category,
            tags=data.tags,
            setup_steps=data.setup_steps,
            verification_steps=data.verification_steps,
            agentic_steps=data.agentic_steps,
            completion_steps=data.completion_steps,
            max_iterations=data.max_iterations,
            timeout_seconds=data.timeout_seconds,
            provider=data.provider,
            model=data.model,
            skip_ai_summary=data.skip_ai_summary,
            log_watch_enabled=data.log_watch_enabled,
            health_check_enabled=data.health_check_enabled,
            health_check_urls=data.health_check_urls,
            preflight_check_enabled=data.preflight_check_enabled,
            log_source_selection=data.log_source_selection,
            context_ids=data.context_ids,
            disabled_context_ids=data.disabled_context_ids,
            auto_include_contexts=data.auto_include_contexts,
            prompt_template=data.prompt_template,
            generated_by_task_run_id=data.generated_by_task_run_id,
        )

        try:
            created = await self.repo.create(db, workflow)
            await db.commit()
        except Exception as e:
            await db.rollback()
            if "duplicate" in str(e).lower() or "unique" in str(e).lower():
                raise HTTPException(
                    status_code=409,
                    detail=f"Workflow with ID {data.id} already exists",
                ) from e
            raise

        logger.info(
            "Created workflow",
            workflow_id=str(created.id),
            name=data.name,
            user_id=str(user_id),
        )

        return _model_to_response(created)

    async def update_workflow(
        self,
        db: AsyncSession,
        workflow_id: UUID,
        data: UnifiedWorkflowUpdate,
        user_id: UUID,
    ) -> UnifiedWorkflowResponse:
        """Update an existing unified workflow."""
        workflow = await self.repo.get_by_id(db, workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        # Apply partial updates
        update_fields = data.model_dump(exclude_unset=True)
        for field, value in update_fields.items():
            if field == "project_id":
                setattr(workflow, field, UUID(value) if value else None)
            else:
                setattr(workflow, field, value)

        updated = await self.repo.update(db, workflow)
        await db.commit()

        logger.info(
            "Updated workflow",
            workflow_id=str(workflow_id),
            updated_fields=list(update_fields.keys()),
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
    ) -> UnifiedWorkflowResponse:
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
    ) -> UnifiedWorkflowResponse:
        """Duplicate an existing workflow."""
        original = await self.repo.get_by_id(db, workflow_id)
        if not original:
            raise ValueError(f"Workflow not found: {workflow_id}")

        clone = UnifiedWorkflow(
            created_by_user_id=user_id,
            project_id=original.project_id,
            name=f"{original.name} (copy)",
            description=original.description,
            category=original.category,
            tags=list(original.tags) if original.tags else [],
            setup_steps=list(original.setup_steps) if original.setup_steps else [],
            verification_steps=(
                list(original.verification_steps) if original.verification_steps else []
            ),
            agentic_steps=(
                list(original.agentic_steps) if original.agentic_steps else []
            ),
            completion_steps=(
                list(original.completion_steps) if original.completion_steps else []
            ),
            max_iterations=original.max_iterations,
            timeout_seconds=original.timeout_seconds,
            provider=original.provider,
            model=original.model,
            skip_ai_summary=original.skip_ai_summary,
            log_watch_enabled=original.log_watch_enabled,
            health_check_enabled=original.health_check_enabled,
            health_check_urls=(
                list(original.health_check_urls) if original.health_check_urls else []
            ),
            preflight_check_enabled=original.preflight_check_enabled,
            log_source_selection=original.log_source_selection,
            context_ids=list(original.context_ids) if original.context_ids else [],
            disabled_context_ids=(
                list(original.disabled_context_ids)
                if original.disabled_context_ids
                else []
            ),
            auto_include_contexts=original.auto_include_contexts,
            prompt_template=original.prompt_template,
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
        """Export a workflow as a dictionary."""
        workflow = await self.repo.get_by_id(db, workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        return {
            "id": str(workflow.id),
            "name": workflow.name,
            "description": workflow.description or "",
            "category": workflow.category or "general",
            "tags": workflow.tags or [],
            "setup_steps": workflow.setup_steps or [],
            "verification_steps": workflow.verification_steps or [],
            "agentic_steps": workflow.agentic_steps or [],
            "completion_steps": workflow.completion_steps or [],
            "max_iterations": workflow.max_iterations or 10,
            "timeout_seconds": workflow.timeout_seconds,
            "provider": workflow.provider,
            "model": workflow.model,
            "skip_ai_summary": workflow.skip_ai_summary or False,
            "log_watch_enabled": (
                workflow.log_watch_enabled
                if workflow.log_watch_enabled is not None
                else True
            ),
            "health_check_enabled": (
                workflow.health_check_enabled
                if workflow.health_check_enabled is not None
                else True
            ),
            "health_check_urls": workflow.health_check_urls or [],
            "preflight_check_enabled": (
                workflow.preflight_check_enabled
                if workflow.preflight_check_enabled is not None
                else True
            ),
            "log_source_selection": (
                workflow.log_source_selection
                if workflow.log_source_selection is not None
                else "default"
            ),
            "context_ids": workflow.context_ids or [],
            "disabled_context_ids": workflow.disabled_context_ids or [],
            "auto_include_contexts": (
                workflow.auto_include_contexts
                if workflow.auto_include_contexts is not None
                else True
            ),
            "prompt_template": workflow.prompt_template,
            "generated_by_task_run_id": workflow.generated_by_task_run_id,
        }

    async def import_workflow(
        self,
        db: AsyncSession,
        data: dict[str, Any],
        user_id: UUID,
    ) -> UnifiedWorkflowResponse:
        """Import a workflow from exported data."""
        create_data = UnifiedWorkflowCreate(**data)
        # Don't preserve the original ID on import — create a new one
        create_data.id = None
        return await self.create_workflow(db, create_data, user_id)
