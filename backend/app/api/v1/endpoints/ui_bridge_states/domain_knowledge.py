"""Domain knowledge routes: project-scoped CRUD, with global knowledge readable."""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import ui_bridge_domain_knowledge as knowledge_crud
from app.models.user import User
from app.schemas.ui_bridge_state import (
    DomainKnowledgeCreate,
    DomainKnowledgeListResponse,
    DomainKnowledgeResponse,
    DomainKnowledgeUpdate,
)

from ._deps import get_project_or_404

logger = structlog.get_logger(__name__)

router = APIRouter()


# =============================================================================
# Domain Knowledge Endpoints
# =============================================================================


@router.get(
    "/projects/{project_id}/domain-knowledge",
    response_model=DomainKnowledgeListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_domain_knowledge(
    project_id: UUID,
    include_global: bool = Query(True, description="Include global knowledge"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List domain knowledge for a project."""
    await get_project_or_404(project_id, current_user.id, db)

    items = await knowledge_crud.list_knowledge(
        db, project_id, include_global=include_global
    )

    return DomainKnowledgeListResponse(
        items=[DomainKnowledgeResponse.model_validate(k) for k in items],
        total=len(items),
    )


@router.post(
    "/projects/{project_id}/domain-knowledge",
    response_model=DomainKnowledgeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_domain_knowledge(
    project_id: UUID,
    request: DomainKnowledgeCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create new domain knowledge for a project."""
    await get_project_or_404(project_id, current_user.id, db)

    knowledge = await knowledge_crud.create_knowledge(db, project_id, request)

    logger.info(
        "Created domain knowledge",
        knowledge_id=str(knowledge.id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    return DomainKnowledgeResponse.model_validate(knowledge)


@router.get(
    "/projects/{project_id}/domain-knowledge/{knowledge_id}",
    response_model=DomainKnowledgeResponse,
    status_code=status.HTTP_200_OK,
)
async def get_domain_knowledge(
    project_id: UUID,
    knowledge_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get domain knowledge by ID."""
    await get_project_or_404(project_id, current_user.id, db)

    knowledge = await knowledge_crud.get_visible_knowledge(db, project_id, knowledge_id)

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found",
        )

    return DomainKnowledgeResponse.model_validate(knowledge)


@router.patch(
    "/projects/{project_id}/domain-knowledge/{knowledge_id}",
    response_model=DomainKnowledgeResponse,
    status_code=status.HTTP_200_OK,
)
async def update_domain_knowledge(
    project_id: UUID,
    knowledge_id: UUID,
    request: DomainKnowledgeUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update domain knowledge."""
    await get_project_or_404(project_id, current_user.id, db)

    # Can only edit project-specific
    knowledge = await knowledge_crud.get_project_knowledge(db, project_id, knowledge_id)

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found or cannot be edited",
        )

    knowledge = await knowledge_crud.update_knowledge(db, knowledge, request)

    return DomainKnowledgeResponse.model_validate(knowledge)


@router.delete(
    "/projects/{project_id}/domain-knowledge/{knowledge_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_domain_knowledge(
    project_id: UUID,
    knowledge_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete domain knowledge."""
    await get_project_or_404(project_id, current_user.id, db)

    # Can only delete project-specific
    knowledge = await knowledge_crud.get_project_knowledge(db, project_id, knowledge_id)

    if not knowledge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain knowledge not found or cannot be deleted",
        )

    await knowledge_crud.delete_knowledge(db, knowledge)

    logger.info(
        "Deleted domain knowledge",
        knowledge_id=str(knowledge_id),
        project_id=str(project_id),
        user_id=str(current_user.id),
    )
