"""
API endpoints for custom function management.

Provides REST API for browsing, searching, and managing discovered custom functions.
"""

from uuid import UUID

import structlog
from app.api.deps import current_active_user, get_async_db
from app.crud import custom_function as crud
from app.models.project import Project
from app.models.user import User
from app.schemas.custom_function import (CustomFunctionListResponse,
                                         CustomFunctionRead,
                                         CustomFunctionSummary,
                                         CustomFunctionUpdate, FunctionStats)
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

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


# ===== List and Search Endpoints =====


@router.get(
    "/projects/{project_id}/custom-functions", response_model=CustomFunctionListResponse
)
async def list_custom_functions(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    List all custom functions for a project.

    Args:
        project_id: Project ID
        limit: Results per page
        offset: Pagination offset
        current_user: Authenticated user
        db: Database session

    Returns:
        Paginated list of custom functions

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    functions, total = await crud.list_project_functions(
        db, project_id, skip=offset, limit=limit
    )

    summaries = [CustomFunctionSummary.model_validate(f) for f in functions]

    return CustomFunctionListResponse(
        functions=summaries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.get(
    "/projects/{project_id}/custom-functions/search",
    response_model=CustomFunctionListResponse,
)
async def search_custom_functions(
    project_id: UUID,
    query: str | None = Query(None, description="Search query"),
    category: str | None = Query(None, description="Category filter"),
    tags: list[str] | None = Query(None, description="Tag filters"),
    file_path: str | None = Query(None, description="File path filter"),
    limit: int = Query(50, ge=1, le=200, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Search custom functions with filters.

    Args:
        project_id: Project ID
        query: Text search (name, description)
        category: Category filter
        tags: Tag filters
        file_path: File path filter
        limit: Results per page
        offset: Pagination offset
        current_user: Authenticated user
        db: Database session

    Returns:
        Paginated list of matching custom functions

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    functions, total = await crud.search_functions(
        db,
        project_id,
        query=query,
        category=category,
        tags=tags,
        file_path=file_path,
        skip=offset,
        limit=limit,
    )

    summaries = [CustomFunctionSummary.model_validate(f) for f in functions]

    return CustomFunctionListResponse(
        functions=summaries,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


# ===== Individual Function Endpoints =====


@router.get(
    "/projects/{project_id}/custom-functions/{function_id}",
    response_model=CustomFunctionRead,
)
async def get_custom_function(
    project_id: UUID,
    function_id: int,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get detailed custom function information.

    Args:
        project_id: Project ID
        function_id: Function ID
        current_user: Authenticated user
        db: Database session

    Returns:
        Custom function details

    Raises:
        HTTPException: If project/function not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    function = await crud.get_function_by_id(db, function_id)
    if not function:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom function not found",
        )

    if function.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom function not found in this project",
        )

    return CustomFunctionRead.model_validate(function)


@router.put(
    "/projects/{project_id}/custom-functions/{function_id}",
    response_model=CustomFunctionRead,
)
async def update_custom_function(
    project_id: UUID,
    function_id: int,
    update_data: CustomFunctionUpdate,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Update custom function metadata.

    Args:
        project_id: Project ID
        function_id: Function ID
        update_data: Update data
        current_user: Authenticated user
        db: Database session

    Returns:
        Updated custom function

    Raises:
        HTTPException: If project/function not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    function = await crud.get_function_by_id(db, function_id)
    if not function:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom function not found",
        )

    if function.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom function not found in this project",
        )

    function = await crud.update_custom_function(db, function, update_data)

    logger.info(
        "custom_function_updated",
        function_id=function_id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return CustomFunctionRead.model_validate(function)


@router.delete(
    "/projects/{project_id}/custom-functions/{function_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_custom_function(
    project_id: UUID,
    function_id: int,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Delete a custom function.

    Args:
        project_id: Project ID
        function_id: Function ID
        current_user: Authenticated user
        db: Database session

    Raises:
        HTTPException: If project/function not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    function = await crud.get_function_by_id(db, function_id)
    if not function:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom function not found",
        )

    if function.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom function not found in this project",
        )

    await crud.delete_custom_function(db, function)

    logger.info(
        "custom_function_deleted",
        function_id=function_id,
        project_id=project_id,
        user_id=current_user.id,
    )

    return None


# ===== Utility Endpoints =====


@router.get(
    "/projects/{project_id}/custom-functions/stats", response_model=FunctionStats
)
async def get_function_stats(
    project_id: UUID,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get custom function statistics for a project.

    Args:
        project_id: Project ID
        current_user: Authenticated user
        db: Database session

    Returns:
        Function statistics

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    stats = await crud.get_project_stats(db, project_id)

    return FunctionStats(
        total_functions=stats["total_functions"],
        categories=stats["categories"],
        tags=stats["tags"],
        files_with_functions=stats["files_with_functions"],
    )


@router.get(
    "/projects/{project_id}/custom-functions/categories", response_model=list[str]
)
async def get_function_categories(
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


@router.get("/projects/{project_id}/custom-functions/tags", response_model=list[str])
async def get_function_tags(
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


@router.get(
    "/projects/{project_id}/files/{file_path:path}/custom-functions",
    response_model=list[CustomFunctionSummary],
)
async def get_file_functions(
    project_id: UUID,
    file_path: str,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """
    Get all custom functions defined in a specific file.

    Args:
        project_id: Project ID
        file_path: File path (relative to project root)
        current_user: Authenticated user
        db: Database session

    Returns:
        List of custom functions in the file

    Raises:
        HTTPException: If project not found or not authorized
    """
    await verify_project_access(db, project_id, current_user)

    functions = await crud.get_functions_by_file(db, project_id, file_path)

    return [CustomFunctionSummary.model_validate(f) for f in functions]
