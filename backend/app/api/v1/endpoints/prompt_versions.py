"""
Prompt Version API endpoints.

This module provides REST API endpoints for the prompt template versioning system,
supporting the Opik integration for tracking prompt content changes over time.

Endpoints:
- POST /ai-prompt-templates/{template_id}/versions — create a new version
- GET /ai-prompt-templates/{template_id}/versions — list versions (paginated)
- GET /ai-prompt-templates/{template_id}/versions/latest — get latest version
- GET /ai-prompt-templates/{template_id}/versions/{version_number} — get specific version
- GET /ai-prompt-templates/{template_id}/versions/{version_a}/diff/{version_b} — diff
- DELETE /ai-prompt-templates/{template_id}/versions/{version_number} — delete version
"""

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from qontinui_schemas.api.prompt_versions import (
    PromptVersionCreate,
    PromptVersionDiff,
    PromptVersionListResponse,
    PromptVersionResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.repositories.prompt_version import PromptVersionRepository

logger = structlog.get_logger(__name__)
router = APIRouter()


def _model_to_response(version) -> PromptVersionResponse:
    """Convert a PromptTemplateVersion model to a PromptVersionResponse schema."""
    return PromptVersionResponse(
        id=version.id,
        template_id=version.template_id,
        version_number=version.version_number,
        prompt_content=version.prompt_content,
        parameters_json=version.parameters_json,
        content_hash=version.content_hash,
        change_description=version.change_description,
        created_by=version.created_by,
        performance_metrics=version.performance_metrics,
        created_at=version.created_at,
    )


# =============================================================================
# Prompt Version Endpoints
# =============================================================================


@router.post(
    "/ai-prompt-templates/{template_id}/versions",
    response_model=PromptVersionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a prompt template version",
    description="Create a new version snapshot for a prompt template.",
)
async def create_prompt_version(
    template_id: str,
    version_data: PromptVersionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> PromptVersionResponse:
    """Create a new prompt template version."""
    data: dict = {
        "template_id": template_id,
        "prompt_content": version_data.prompt_content,
        "parameters_json": version_data.parameters,
        "change_description": version_data.change_description,
        "created_by": str(current_user.id),
    }

    version = await PromptVersionRepository.create_version(db, data)

    logger.info(
        "Created prompt version",
        version_id=str(version.id),
        template_id=template_id,
        version_number=version.version_number,
        user_id=str(current_user.id),
    )

    return _model_to_response(version)


@router.get(
    "/ai-prompt-templates/{template_id}/versions",
    response_model=PromptVersionListResponse,
    summary="List prompt template versions",
    description="List all versions for a prompt template with pagination.",
)
async def list_prompt_versions(
    template_id: str,
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> PromptVersionListResponse:
    """List versions for a prompt template."""
    versions, total = await PromptVersionRepository.list_versions(
        db, template_id, skip=skip, limit=limit
    )

    return PromptVersionListResponse(
        items=[_model_to_response(v) for v in versions],
        total=total,
    )


@router.get(
    "/ai-prompt-templates/{template_id}/versions/latest",
    response_model=PromptVersionResponse,
    summary="Get latest prompt template version",
    description="Get the latest (highest version number) version for a prompt template.",
)
async def get_latest_prompt_version(
    template_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> PromptVersionResponse:
    """Get the latest version for a prompt template."""
    version = await PromptVersionRepository.get_latest_version(db, template_id)
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No versions found for template {template_id}",
        )

    return _model_to_response(version)


@router.get(
    "/ai-prompt-templates/{template_id}/versions/{version_number}",
    response_model=PromptVersionResponse,
    summary="Get a specific prompt template version",
    description="Get a specific version of a prompt template by version number.",
)
async def get_prompt_version(
    template_id: str,
    version_number: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> PromptVersionResponse:
    """Get a specific prompt template version."""
    version = await PromptVersionRepository.get_version(db, template_id, version_number)
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {version_number} not found for template {template_id}",
        )

    return _model_to_response(version)


@router.get(
    "/ai-prompt-templates/{template_id}/versions/{version_a}/diff/{version_b}",
    response_model=PromptVersionDiff,
    summary="Diff two prompt template versions",
    description="Compute a unified diff between two versions of a prompt template.",
)
async def diff_prompt_versions(
    template_id: str,
    version_a: int,
    version_b: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> PromptVersionDiff:
    """Compute diff between two prompt template versions."""
    try:
        diff = await PromptVersionRepository.get_version_diff(
            db, template_id, version_a, version_b
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )

    return PromptVersionDiff(**diff)


@router.delete(
    "/ai-prompt-templates/{template_id}/versions/{version_number}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a prompt template version",
    description="Delete a specific version of a prompt template.",
)
async def delete_prompt_version(
    template_id: str,
    version_number: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> None:
    """Delete a prompt template version."""
    # First find the version to get its UUID
    version = await PromptVersionRepository.get_version(db, template_id, version_number)
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {version_number} not found for template {template_id}",
        )

    deleted = await PromptVersionRepository.delete_version(db, version.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {version_number} not found for template {template_id}",
        )

    logger.info(
        "Deleted prompt version",
        template_id=template_id,
        version_number=version_number,
        user_id=str(current_user.id),
    )
