"""
Project File Management API Endpoints.

Provides endpoints for managing project files and directories:
- List files
- Upload files
- Get file content
- Update files
- Delete files
- Create folders
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.error_codes import ErrorCode
from app.crud.project import get_project
from app.middleware.error_handler import forbidden_error, not_found_error
from app.models import User
from app.models.organization import PermissionLevel
from app.schemas.project_file import (
    FileContentResponse,
    FileDeleteResponse,
    FileListResponse,
    FileUpdateRequest,
    FileUploadRequest,
    FileUploadResponse,
    FolderCreateRequest,
    FolderCreateResponse,
    ProjectLimitsResponse,
)
from app.services.permission_service import permission_service
from app.services.project_file_service import project_file_service

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/{project_id}/files", response_model=FileListResponse)
async def list_project_files(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: UUID,
    directory: str = ".",
) -> FileListResponse:
    """List all files in project directory."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise not_found_error("Project", "project")

    project_root = project_file_service.get_project_root(str(project_id))

    try:
        if directory == ".":
            search_dir = project_root
        else:
            search_dir = project_file_service.resolve_file_path(project_root, directory)
            if not search_dir.exists():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Directory not found: {directory}",
                )

        files = []
        total_size = 0
        for filepath in search_dir.rglob("*"):
            if filepath.is_file():
                file_info = project_file_service.get_file_info(filepath, project_root)
                files.append(file_info)
                total_size += file_info.size_bytes

        return FileListResponse(
            files=files,
            total_count=len(files),
            total_size_bytes=total_size,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list files: {str(e)}",
        )


@router.post("/{project_id}/files", response_model=FileUploadResponse)
async def upload_project_file(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: UUID,
    request: FileUploadRequest,
) -> FileUploadResponse:
    """Upload a file to project directory."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to upload files to this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    project_root = project_file_service.get_project_root(str(project_id))

    try:
        project_file_service.check_project_limits(str(project_id))
        filepath = project_file_service.resolve_file_path(project_root, request.path)

        if filepath.exists() and not request.overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"File already exists: {request.path}. Set overwrite=true to replace.",
            )

        if filepath.suffix == ".py":
            project_file_service.validate_python_syntax(request.content)

        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text(request.content, encoding="utf-8")
        size_bytes = filepath.stat().st_size

        if filepath.suffix == ".py":
            await project_file_service.scan_python_file_for_functions(
                db, project_id, request.path, request.content
            )

        return FileUploadResponse(
            success=True,
            path=request.path,
            size_bytes=size_bytes,
            message=f"File uploaded successfully: {request.path}",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {str(e)}",
        )


@router.get("/{project_id}/files/{file_path:path}", response_model=FileContentResponse)
async def get_project_file(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: UUID,
    file_path: str,
) -> FileContentResponse:
    """Get file content."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise not_found_error("Project", "project")

    project_root = project_file_service.get_project_root(str(project_id))
    if not project_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project directory not found",
        )

    try:
        filepath = project_file_service.resolve_file_path(project_root, file_path)

        if not filepath.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {file_path}",
            )

        if not filepath.is_file():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path is not a file: {file_path}",
            )

        content = filepath.read_text(encoding="utf-8")
        stat = filepath.stat()

        from datetime import datetime

        return FileContentResponse(
            path=file_path,
            content=content,
            size_bytes=stat.st_size,
            extension=filepath.suffix,
            modified_at=datetime.fromtimestamp(stat.st_mtime),
        )
    except HTTPException:
        raise
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is not a text file or uses unsupported encoding",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
        )


@router.put("/{project_id}/files/{file_path:path}", response_model=FileUploadResponse)
async def update_project_file(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: UUID,
    file_path: str,
    request: FileUpdateRequest,
) -> FileUploadResponse:
    """Update file content."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to update files in this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    project_root = project_file_service.get_project_root(str(project_id))
    if not project_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project directory not found",
        )

    try:
        filepath = project_file_service.resolve_file_path(project_root, file_path)

        if not filepath.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {file_path}",
            )

        if filepath.suffix == ".py":
            project_file_service.validate_python_syntax(request.content)

        filepath.write_text(request.content, encoding="utf-8")
        size_bytes = filepath.stat().st_size

        if filepath.suffix == ".py":
            await project_file_service.scan_python_file_for_functions(
                db, project_id, file_path, request.content
            )

        return FileUploadResponse(
            success=True,
            path=file_path,
            size_bytes=size_bytes,
            message=f"File updated successfully: {file_path}",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update file: {str(e)}",
        )


@router.delete(
    "/{project_id}/files/{file_path:path}", response_model=FileDeleteResponse
)
async def delete_project_file(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: UUID,
    file_path: str,
) -> FileDeleteResponse:
    """Delete a file."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to delete files in this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    project_root = project_file_service.get_project_root(str(project_id))
    if not project_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project directory not found",
        )

    try:
        filepath = project_file_service.resolve_file_path(project_root, file_path)

        if not filepath.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {file_path}",
            )

        if not filepath.is_file():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path is not a file: {file_path}",
            )

        if filepath.suffix == ".py":
            await project_file_service.delete_functions_for_file(
                db, project_id, file_path
            )

        filepath.unlink()

        return FileDeleteResponse(
            success=True,
            path=file_path,
            message=f"File deleted successfully: {file_path}",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete file: {str(e)}",
        )


@router.post("/{project_id}/files/folder", response_model=FolderCreateResponse)
async def create_project_folder(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: UUID,
    request: FolderCreateRequest,
) -> FolderCreateResponse:
    """Create a folder."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to create folders in this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    project_root = project_file_service.get_project_root(str(project_id))

    try:
        folder_path = project_file_service.resolve_file_path(project_root, request.path)

        if folder_path.exists():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Folder already exists: {request.path}",
            )

        folder_path.mkdir(parents=True, exist_ok=False)

        return FolderCreateResponse(
            success=True,
            path=request.path,
            message=f"Folder created successfully: {request.path}",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create folder: {str(e)}",
        )


@router.get("/{project_id}/files/limits", response_model=ProjectLimitsResponse)
async def get_project_limits(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: UUID,
) -> ProjectLimitsResponse:
    """Get project size and file count limits."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise not_found_error("Project", "project")

    try:
        limits = project_file_service.directory_manager.check_project_limits(
            str(project_id)
        )
        return ProjectLimitsResponse(**limits)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check limits: {str(e)}",
        )
