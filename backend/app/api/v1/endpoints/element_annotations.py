"""
API endpoints for project-scoped element annotation management.

These endpoints allow users to create, read, update, and manage element
annotations associated with specific projects. Supports versioning to
track annotation history over time.
"""

import uuid
from datetime import datetime
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import deps
from app.crud.project import get_project
from app.middleware.error_handler import not_found_error
from app.models.element_annotation import ElementAnnotation, ElementAnnotationSet
from app.models.organization import PermissionLevel
from app.models.user import User
from app.schemas.element_annotation import (
    ElementAnnotationSetCreate,
    ElementAnnotationSetResponse,
    ElementAnnotationSetUpdate,
    VersionListResponse,
    VersionResponse,
    VersionSnapshotCreate,
)
from app.services.permission_service import permission_service

logger = structlog.get_logger(__name__)

router = APIRouter()


async def _check_project_access(
    db: AsyncSession,
    project_id: UUID,
    user: User,
    required_level: PermissionLevel = PermissionLevel.VIEW,
) -> None:
    """
    Check if user has access to the project.

    Raises HTTPException if project not found or user lacks permission.
    """
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, user.id, project_id, required_level
    )
    if not has_access:
        # Return 404 to prevent timing attacks that reveal project existence
        raise not_found_error("Project", "project")


async def _get_current_annotation_set(
    db: AsyncSession, project_id: UUID
) -> ElementAnnotationSet | None:
    """Get the current (active) annotation set for a project."""
    result = await db.execute(
        select(ElementAnnotationSet)
        .options(selectinload(ElementAnnotationSet.elements))
        .filter(
            ElementAnnotationSet.project_id == project_id,
            ElementAnnotationSet.is_current == True,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


@router.get(
    "/{project_id}/element-annotations",
    response_model=ElementAnnotationSetResponse | None,
)
async def get_element_annotations(
    project_id: UUID,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> ElementAnnotationSet | None:
    """
    Get the current element annotations for a project.

    Returns the active annotation set with all elements, or null if no
    annotations exist yet.
    """
    logger.info(
        "get_element_annotations",
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    annotation_set = await _get_current_annotation_set(db, project_id)

    if annotation_set:
        logger.info(
            "element_annotations_found",
            project_id=str(project_id),
            annotation_set_id=str(annotation_set.id),
            element_count=annotation_set.element_count,
        )
    else:
        logger.info(
            "no_element_annotations_found",
            project_id=str(project_id),
        )

    return annotation_set


@router.post(
    "/{project_id}/element-annotations",
    response_model=ElementAnnotationSetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_element_annotations(
    project_id: UUID,
    annotation_data: ElementAnnotationSetCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> ElementAnnotationSet:
    """
    Create a new element annotation set for a project.

    If an annotation set already exists for the project, it will be marked
    as non-current and a new set will be created as the current version.
    """
    logger.info(
        "create_element_annotations",
        project_id=str(project_id),
        user_id=str(current_user.id),
        element_count=len(annotation_data.elements),
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    # Check for existing current annotation set
    existing_set = await _get_current_annotation_set(db, project_id)

    # Determine version number
    if existing_set:
        # Mark existing as non-current
        existing_set.is_current = False  # type: ignore[assignment]
        new_version = existing_set.version_number + 1
    else:
        new_version = 1

    # Create new annotation set
    annotation_set = ElementAnnotationSet(
        id=uuid.uuid4(),
        project_id=project_id,
        screenshot_width=annotation_data.screenshot_width,
        screenshot_height=annotation_data.screenshot_height,
        screenshot_url=annotation_data.screenshot_url,
        version_number=new_version,
        is_current=True,
        created_by_id=current_user.id,
    )
    db.add(annotation_set)

    # Add elements
    for i, element_data in enumerate(annotation_data.elements):
        element = ElementAnnotation(
            id=uuid.uuid4(),
            annotation_set_id=annotation_set.id,
            x=element_data.x,
            y=element_data.y,
            width=element_data.width,
            height=element_data.height,
            label=element_data.label,
            element_type=element_data.element_type,
            description=element_data.description,
            notes=element_data.notes,
            extra_data=element_data.extra_data,
            order=element_data.order if element_data.order else i,
            client_id=element_data.client_id,
        )
        db.add(element)

    await db.commit()
    await db.refresh(annotation_set, ["elements"])

    logger.info(
        "element_annotations_created",
        project_id=str(project_id),
        annotation_set_id=str(annotation_set.id),
        version_number=new_version,
        element_count=annotation_set.element_count,
    )

    return annotation_set


@router.put(
    "/{project_id}/element-annotations",
    response_model=ElementAnnotationSetResponse,
)
async def update_element_annotations(
    project_id: UUID,
    annotation_data: ElementAnnotationSetUpdate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> ElementAnnotationSet:
    """
    Update the current element annotations for a project.

    This replaces all elements in the current annotation set. If no current
    set exists, a new one will be created.

    For full version history, use the POST endpoint to create a new version
    instead of updating in place.
    """
    logger.info(
        "update_element_annotations",
        project_id=str(project_id),
        user_id=str(current_user.id),
        element_count=len(annotation_data.elements),
        current_version_id=annotation_data.current_version_id,
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    # Get current annotation set
    annotation_set = await _get_current_annotation_set(db, project_id)

    if annotation_set is None:
        # No existing set - create a new one
        annotation_set = ElementAnnotationSet(
            id=uuid.uuid4(),
            project_id=project_id,
            screenshot_width=annotation_data.screenshot_width,
            screenshot_height=annotation_data.screenshot_height,
            screenshot_url=annotation_data.screenshot_url,
            version_number=1,
            is_current=True,
            created_by_id=current_user.id,
        )
        db.add(annotation_set)
    else:
        # Update existing set metadata
        annotation_set.screenshot_width = annotation_data.screenshot_width  # type: ignore[assignment]
        annotation_set.screenshot_height = annotation_data.screenshot_height  # type: ignore[assignment]
        annotation_set.screenshot_url = annotation_data.screenshot_url  # type: ignore[assignment]
        annotation_set.updated_at = datetime.utcnow()  # type: ignore[assignment]

        # Delete existing elements
        for element in annotation_set.elements:
            await db.delete(element)

    # Add new elements
    for i, element_data in enumerate(annotation_data.elements):
        element = ElementAnnotation(
            id=uuid.uuid4(),
            annotation_set_id=annotation_set.id,
            x=element_data.x,
            y=element_data.y,
            width=element_data.width,
            height=element_data.height,
            label=element_data.label,
            element_type=element_data.element_type,
            description=element_data.description,
            notes=element_data.notes,
            extra_data=element_data.extra_data,
            order=element_data.order if element_data.order else i,
            client_id=element_data.client_id,
        )
        db.add(element)

    await db.commit()
    await db.refresh(annotation_set, ["elements"])

    logger.info(
        "element_annotations_updated",
        project_id=str(project_id),
        annotation_set_id=str(annotation_set.id),
        element_count=annotation_set.element_count,
    )

    return annotation_set


@router.get(
    "/{project_id}/element-annotations/versions",
    response_model=VersionListResponse,
)
async def get_annotation_versions(
    project_id: UUID,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> dict:
    """
    Get all saved versions of element annotations for a project.

    Returns a list of versions with timestamps and element counts,
    ordered by version number descending (newest first).
    """
    logger.info(
        "get_annotation_versions",
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    # Get all annotation sets for the project with element counts
    result = await db.execute(
        select(ElementAnnotationSet)
        .filter(ElementAnnotationSet.project_id == project_id)
        .order_by(desc(ElementAnnotationSet.version_number))
    )
    annotation_sets = result.scalars().all()

    # Find current version ID
    current_version_id = None
    versions = []

    for annotation_set in annotation_sets:
        if annotation_set.is_current:
            current_version_id = str(annotation_set.id)

        # Get element count via query
        count_result = await db.execute(
            select(func.count())
            .select_from(ElementAnnotation)
            .filter(ElementAnnotation.annotation_set_id == annotation_set.id)
        )
        element_count = count_result.scalar() or 0

        versions.append(
            VersionResponse(
                id=str(annotation_set.id),
                version_number=annotation_set.version_number,
                element_count=element_count,
                is_current=annotation_set.is_current,
                version_comment=annotation_set.version_comment,
                created_at=annotation_set.created_at,
                created_by_id=str(annotation_set.created_by_id),
            )
        )

    logger.info(
        "annotation_versions_retrieved",
        project_id=str(project_id),
        version_count=len(versions),
        current_version_id=current_version_id,
    )

    return {
        "versions": versions,
        "total": len(versions),
        "current_version_id": current_version_id,
    }


@router.post(
    "/{project_id}/element-annotations/versions",
    response_model=ElementAnnotationSetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_version_snapshot(
    project_id: UUID,
    version_data: VersionSnapshotCreate,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> ElementAnnotationSet:
    """
    Save a new version snapshot of element annotations.

    Creates a new version with the provided elements, marking it as the
    current version. The previous current version is marked as non-current
    but retained for history.
    """
    logger.info(
        "create_version_snapshot",
        project_id=str(project_id),
        user_id=str(current_user.id),
        element_count=len(version_data.elements),
        comment=version_data.comment,
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    # Get the current annotation set to determine screenshot dimensions and version number
    existing_set = await _get_current_annotation_set(db, project_id)

    if existing_set:
        # Mark existing as non-current
        existing_set.is_current = False  # type: ignore[assignment]
        new_version = existing_set.version_number + 1
        screenshot_width = existing_set.screenshot_width
        screenshot_height = existing_set.screenshot_height
        screenshot_url = existing_set.screenshot_url
    else:
        # No existing set - use defaults or require screenshot dimensions
        # For now, use reasonable defaults (they can be updated)
        new_version = 1
        screenshot_width = 1920
        screenshot_height = 1080
        screenshot_url = None

    # Create new version
    annotation_set = ElementAnnotationSet(
        id=uuid.uuid4(),
        project_id=project_id,
        screenshot_width=screenshot_width,
        screenshot_height=screenshot_height,
        screenshot_url=screenshot_url,
        version_number=new_version,
        is_current=True,
        version_comment=version_data.comment,
        created_by_id=current_user.id,
    )
    db.add(annotation_set)

    # Add elements
    for i, element_data in enumerate(version_data.elements):
        element = ElementAnnotation(
            id=uuid.uuid4(),
            annotation_set_id=annotation_set.id,
            x=element_data.x,
            y=element_data.y,
            width=element_data.width,
            height=element_data.height,
            label=element_data.label,
            element_type=element_data.element_type,
            description=element_data.description,
            notes=element_data.notes,
            extra_data=element_data.extra_data,
            order=element_data.order if element_data.order else i,
            client_id=element_data.client_id,
        )
        db.add(element)

    await db.commit()
    await db.refresh(annotation_set, ["elements"])

    logger.info(
        "version_snapshot_created",
        project_id=str(project_id),
        annotation_set_id=str(annotation_set.id),
        version_number=new_version,
        element_count=annotation_set.element_count,
    )

    return annotation_set


@router.get(
    "/{project_id}/element-annotations/versions/{version_id}",
    response_model=ElementAnnotationSetResponse,
)
async def get_annotation_version(
    project_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> ElementAnnotationSet:
    """
    Get a specific version of element annotations by version ID.

    Useful for viewing historical versions or comparing versions.
    """
    logger.info(
        "get_annotation_version",
        project_id=str(project_id),
        version_id=str(version_id),
        user_id=str(current_user.id),
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    # Get the specific version
    result = await db.execute(
        select(ElementAnnotationSet)
        .options(selectinload(ElementAnnotationSet.elements))
        .filter(
            ElementAnnotationSet.id == version_id,
            ElementAnnotationSet.project_id == project_id,
        )
    )
    annotation_set = result.scalar_one_or_none()

    if not annotation_set:
        raise not_found_error("Annotation version", "element_annotation_version")

    logger.info(
        "annotation_version_retrieved",
        project_id=str(project_id),
        version_id=str(version_id),
        version_number=annotation_set.version_number,
        element_count=annotation_set.element_count,
    )

    return annotation_set


@router.post(
    "/{project_id}/element-annotations/versions/{version_id}/restore",
    response_model=ElementAnnotationSetResponse,
)
async def restore_annotation_version(
    project_id: UUID,
    version_id: UUID,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> ElementAnnotationSet:
    """
    Restore a previous version of element annotations.

    Creates a new version based on the specified historical version,
    making it the current version. This preserves history by not
    modifying the original version.
    """
    logger.info(
        "restore_annotation_version",
        project_id=str(project_id),
        version_id=str(version_id),
        user_id=str(current_user.id),
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    # Get the version to restore
    result = await db.execute(
        select(ElementAnnotationSet)
        .options(selectinload(ElementAnnotationSet.elements))
        .filter(
            ElementAnnotationSet.id == version_id,
            ElementAnnotationSet.project_id == project_id,
        )
    )
    source_set = result.scalar_one_or_none()

    if not source_set:
        raise not_found_error("Annotation version", "element_annotation_version")

    # Get current set and mark as non-current
    current_set = await _get_current_annotation_set(db, project_id)
    new_version = 1

    if current_set:
        current_set.is_current = False  # type: ignore[assignment]
        new_version = current_set.version_number + 1

    # Create new version from source
    annotation_set = ElementAnnotationSet(
        id=uuid.uuid4(),
        project_id=project_id,
        screenshot_width=source_set.screenshot_width,
        screenshot_height=source_set.screenshot_height,
        screenshot_url=source_set.screenshot_url,
        version_number=new_version,
        is_current=True,
        version_comment=f"Restored from version {source_set.version_number}",
        created_by_id=current_user.id,
    )
    db.add(annotation_set)

    # Copy elements from source
    for _, source_element in enumerate(source_set.elements):
        element = ElementAnnotation(
            id=uuid.uuid4(),
            annotation_set_id=annotation_set.id,
            x=source_element.x,
            y=source_element.y,
            width=source_element.width,
            height=source_element.height,
            label=source_element.label,
            element_type=source_element.element_type,
            description=source_element.description,
            notes=source_element.notes,
            extra_data=source_element.extra_data,
            order=source_element.order,
            client_id=source_element.client_id,
        )
        db.add(element)

    await db.commit()
    await db.refresh(annotation_set, ["elements"])

    logger.info(
        "annotation_version_restored",
        project_id=str(project_id),
        source_version_id=str(version_id),
        new_version_id=str(annotation_set.id),
        new_version_number=new_version,
        element_count=annotation_set.element_count,
    )

    return annotation_set


@router.delete(
    "/{project_id}/element-annotations",
    status_code=status.HTTP_200_OK,
)
async def delete_element_annotations(
    project_id: UUID,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.get_current_active_user_async),
) -> dict:
    """
    Delete all element annotations for a project.

    This removes all versions of annotations. Use with caution.
    """
    logger.info(
        "delete_element_annotations",
        project_id=str(project_id),
        user_id=str(current_user.id),
    )

    await _check_project_access(db, project_id, current_user, PermissionLevel.ADMIN)

    # Get all annotation sets for the project
    result = await db.execute(
        select(ElementAnnotationSet).filter(
            ElementAnnotationSet.project_id == project_id
        )
    )
    annotation_sets = result.scalars().all()

    deleted_count = len(annotation_sets)

    # Delete all annotation sets (elements will be cascade deleted)
    for annotation_set in annotation_sets:
        await db.delete(annotation_set)

    await db.commit()

    logger.info(
        "element_annotations_deleted",
        project_id=str(project_id),
        deleted_count=deleted_count,
    )

    return {
        "success": True,
        "message": f"Deleted {deleted_count} annotation version(s)",
        "deleted_count": deleted_count,
    }
