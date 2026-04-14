"""
API endpoints for AI prompt template and sequence management.

Provides REST API for browsing, searching, and managing AI prompt templates
and sequences in the prompt library.
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.crud import ai_prompt as crud
from app.models.project import Project
from app.models.user import User
from app.schemas.ai_prompt import (
    AIPromptTemplateCreate,
    AIPromptTemplateListResponse,
    AIPromptTemplateResponse,
    AIPromptTemplateSummary,
    AIPromptTemplateUpdate,
    PromptLibraryStats,
    PromptSequenceCreate,
    PromptSequenceListResponse,
    PromptSequenceResponse,
    PromptSequenceSummary,
    PromptSequenceUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


# ===== Helper Functions =====


async def verify_project_access(
    db: AsyncSession, project_id: UUID, user: User
) -> Project:
    """
    Verify user has access to a project.

    Args:
        db: Database session
        project_id: Project ID
        user: Current user

    Returns:
        Project instance

    Raises:
        HTTPException: If project not found or user doesn't have access
    """
    from sqlalchemy import select

    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project",
        )

    return project


# ===== AI Prompt Template Endpoints =====


@router.get(
    "/projects/{project_id}/ai-prompts/templates",
    response_model=AIPromptTemplateListResponse,
)
async def list_prompt_templates(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    List all AI prompt templates for a project.

    Args:
        project_id: Project ID
        limit: Results per page
        offset: Pagination offset
        current_user: Authenticated user
        db: Database session

    Returns:
        Paginated list of AI prompt templates

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    templates, total = await crud.list_project_templates(
        db, project_id, skip=offset, limit=limit
    )

    summaries = [AIPromptTemplateSummary.model_validate(t) for t in templates]

    return AIPromptTemplateListResponse(
        templates=summaries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.post(
    "/projects/{project_id}/ai-prompts/templates",
    response_model=AIPromptTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_prompt_template(
    project_id: UUID,
    template_data: AIPromptTemplateCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Create a new AI prompt template.

    Args:
        project_id: Project ID
        template_data: Template creation data
        current_user: Authenticated user
        db: Database session

    Returns:
        Created template

    Raises:
        HTTPException: If project not found, not authorized, or template ID already exists
    """
    await verify_project_access(db, project_id, current_user)

    # Check if template ID already exists in this project
    existing = await crud.get_template_by_project_and_id(
        db, project_id, template_data.id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Template with ID '{template_data.id}' already exists in this project",
        )

    template = await crud.create_prompt_template(
        db, project_id, current_user.id, template_data
    )

    logger.info(
        "prompt_template_created",
        template_id=template.id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return AIPromptTemplateResponse.model_validate(template)


@router.get(
    "/projects/{project_id}/ai-prompts/templates/search",
    response_model=AIPromptTemplateListResponse,
)
async def search_prompt_templates(
    project_id: UUID,
    query: str | None = Query(None, description="Search query"),
    category: str | None = Query(None, description="Category filter"),
    tags: list[str] | None = Query(None, description="Tag filters"),
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Search AI prompt templates with filters.

    Args:
        project_id: Project ID
        query: Text search (name, description)
        category: Category filter
        tags: Tag filters
        limit: Results per page
        offset: Pagination offset
        current_user: Authenticated user
        db: Database session

    Returns:
        Paginated list of matching templates

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    templates, total = await crud.search_templates(
        db,
        project_id,
        query=query,
        category=category,
        tags=tags,
        skip=offset,
        limit=limit,
    )

    summaries = [AIPromptTemplateSummary.model_validate(t) for t in templates]

    return AIPromptTemplateListResponse(
        templates=summaries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.get(
    "/projects/{project_id}/ai-prompts/templates/{template_id}",
    response_model=AIPromptTemplateResponse,
)
async def get_prompt_template(
    project_id: UUID,
    template_id: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get detailed AI prompt template information.

    Args:
        project_id: Project ID
        template_id: Template ID
        current_user: Authenticated user
        db: Database session

    Returns:
        Template details

    Raises:
        HTTPException: If project/template not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    template = await crud.get_template_by_project_and_id(db, project_id, template_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="AI prompt template not found",
        )

    return AIPromptTemplateResponse.model_validate(template)


@router.put(
    "/projects/{project_id}/ai-prompts/templates/{template_id}",
    response_model=AIPromptTemplateResponse,
)
async def update_prompt_template(
    project_id: UUID,
    template_id: str,
    update_data: AIPromptTemplateUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Update AI prompt template.

    Args:
        project_id: Project ID
        template_id: Template ID
        update_data: Update data
        current_user: Authenticated user
        db: Database session

    Returns:
        Updated template

    Raises:
        HTTPException: If project/template not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    template = await crud.get_template_by_project_and_id(db, project_id, template_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="AI prompt template not found",
        )

    template = await crud.update_prompt_template(db, template, update_data)

    logger.info(
        "prompt_template_updated",
        template_id=template_id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return AIPromptTemplateResponse.model_validate(template)


@router.delete(
    "/projects/{project_id}/ai-prompts/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_prompt_template(
    project_id: UUID,
    template_id: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Delete an AI prompt template.

    Args:
        project_id: Project ID
        template_id: Template ID
        current_user: Authenticated user
        db: Database session

    Raises:
        HTTPException: If project/template not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    template = await crud.get_template_by_project_and_id(db, project_id, template_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="AI prompt template not found",
        )

    await crud.delete_prompt_template(db, template)

    logger.info(
        "prompt_template_deleted",
        template_id=template_id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return None


# ===== Prompt Sequence Endpoints =====


@router.get(
    "/projects/{project_id}/ai-prompts/sequences",
    response_model=PromptSequenceListResponse,
)
async def list_prompt_sequences(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    List all prompt sequences for a project.

    Args:
        project_id: Project ID
        limit: Results per page
        offset: Pagination offset
        current_user: Authenticated user
        db: Database session

    Returns:
        Paginated list of prompt sequences

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    sequences, total = await crud.list_project_sequences(
        db, project_id, skip=offset, limit=limit
    )

    # Create summaries with steps_count
    summaries = []
    for seq in sequences:
        summary_dict = {
            "id": seq.id,
            "project_id": seq.project_id,
            "name": seq.name,
            "description": seq.description,
            "category": seq.category,
            "tags": seq.tags,
            "steps_count": len(seq.steps),
            "created_at": seq.created_at,
        }
        summaries.append(PromptSequenceSummary.model_validate(summary_dict))

    return PromptSequenceListResponse(
        sequences=summaries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.post(
    "/projects/{project_id}/ai-prompts/sequences",
    response_model=PromptSequenceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_prompt_sequence(
    project_id: UUID,
    sequence_data: PromptSequenceCreate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Create a new prompt sequence.

    Args:
        project_id: Project ID
        sequence_data: Sequence creation data
        current_user: Authenticated user
        db: Database session

    Returns:
        Created sequence

    Raises:
        HTTPException: If project not found, not authorized, or sequence ID already exists
    """
    await verify_project_access(db, project_id, current_user)

    # Check if sequence ID already exists in this project
    existing = await crud.get_sequence_by_project_and_id(
        db, project_id, sequence_data.id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Sequence with ID '{sequence_data.id}' already exists in this project",
        )

    sequence = await crud.create_prompt_sequence(
        db, project_id, current_user.id, sequence_data
    )

    logger.info(
        "prompt_sequence_created",
        sequence_id=sequence.id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return PromptSequenceResponse.model_validate(sequence)


@router.get(
    "/projects/{project_id}/ai-prompts/sequences/search",
    response_model=PromptSequenceListResponse,
)
async def search_prompt_sequences(
    project_id: UUID,
    query: str | None = Query(None, description="Search query"),
    category: str | None = Query(None, description="Category filter"),
    tags: list[str] | None = Query(None, description="Tag filters"),
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Search prompt sequences with filters.

    Args:
        project_id: Project ID
        query: Text search (name, description)
        category: Category filter
        tags: Tag filters
        limit: Results per page
        offset: Pagination offset
        current_user: Authenticated user
        db: Database session

    Returns:
        Paginated list of matching sequences

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    sequences, total = await crud.search_sequences(
        db,
        project_id,
        query=query,
        category=category,
        tags=tags,
        skip=offset,
        limit=limit,
    )

    # Create summaries with steps_count
    summaries = []
    for seq in sequences:
        summary_dict = {
            "id": seq.id,
            "project_id": seq.project_id,
            "name": seq.name,
            "description": seq.description,
            "category": seq.category,
            "tags": seq.tags,
            "steps_count": len(seq.steps),
            "created_at": seq.created_at,
        }
        summaries.append(PromptSequenceSummary.model_validate(summary_dict))

    return PromptSequenceListResponse(
        sequences=summaries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.get(
    "/projects/{project_id}/ai-prompts/sequences/{sequence_id}",
    response_model=PromptSequenceResponse,
)
async def get_prompt_sequence(
    project_id: UUID,
    sequence_id: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get detailed prompt sequence information.

    Args:
        project_id: Project ID
        sequence_id: Sequence ID
        current_user: Authenticated user
        db: Database session

    Returns:
        Sequence details

    Raises:
        HTTPException: If project/sequence not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    sequence = await crud.get_sequence_by_project_and_id(db, project_id, sequence_id)
    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt sequence not found",
        )

    return PromptSequenceResponse.model_validate(sequence)


@router.put(
    "/projects/{project_id}/ai-prompts/sequences/{sequence_id}",
    response_model=PromptSequenceResponse,
)
async def update_prompt_sequence(
    project_id: UUID,
    sequence_id: str,
    update_data: PromptSequenceUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Update prompt sequence.

    Args:
        project_id: Project ID
        sequence_id: Sequence ID
        update_data: Update data
        current_user: Authenticated user
        db: Database session

    Returns:
        Updated sequence

    Raises:
        HTTPException: If project/sequence not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    sequence = await crud.get_sequence_by_project_and_id(db, project_id, sequence_id)
    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt sequence not found",
        )

    sequence = await crud.update_prompt_sequence(db, sequence, update_data)

    logger.info(
        "prompt_sequence_updated",
        sequence_id=sequence_id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return PromptSequenceResponse.model_validate(sequence)


@router.delete(
    "/projects/{project_id}/ai-prompts/sequences/{sequence_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_prompt_sequence(
    project_id: UUID,
    sequence_id: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Delete a prompt sequence.

    Args:
        project_id: Project ID
        sequence_id: Sequence ID
        current_user: Authenticated user
        db: Database session

    Raises:
        HTTPException: If project/sequence not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    sequence = await crud.get_sequence_by_project_and_id(db, project_id, sequence_id)
    if not sequence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt sequence not found",
        )

    await crud.delete_prompt_sequence(db, sequence)

    logger.info(
        "prompt_sequence_deleted",
        sequence_id=sequence_id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return None


# ===== Utility Endpoints =====


@router.get(
    "/projects/{project_id}/ai-prompts/stats",
    response_model=PromptLibraryStats,
)
async def get_prompt_library_stats(
    project_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get AI prompt library statistics for a project.

    Args:
        project_id: Project ID
        current_user: Authenticated user
        db: Database session

    Returns:
        Library statistics

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    stats = await crud.get_project_stats(db, project_id)

    return PromptLibraryStats(
        total_templates=stats["total_templates"],
        total_sequences=stats["total_sequences"],
        categories=stats["categories"],
        tags=stats["tags"],
    )


@router.get(
    "/projects/{project_id}/ai-prompts/categories",
    response_model=list[str],
)
async def get_prompt_categories(
    project_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get all unique categories used in a project.

    Args:
        project_id: Project ID
        current_user: Authenticated user
        db: Database session

    Returns:
        List of category names

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    categories = await crud.get_project_categories(db, project_id)
    return categories


@router.get(
    "/projects/{project_id}/ai-prompts/tags",
    response_model=list[str],
)
async def get_prompt_tags(
    project_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get all unique tags used in a project.

    Args:
        project_id: Project ID
        current_user: Authenticated user
        db: Database session

    Returns:
        List of tag names

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    tags = await crud.get_project_tags(db, project_id)
    return tags
