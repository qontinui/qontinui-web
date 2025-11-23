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

from datetime import datetime
from pathlib import Path
from typing import List

import structlog
from app.api import deps
from app.core.error_codes import ErrorCode
from app.crud import custom_function as custom_function_crud
from app.crud.project import get_project
from app.middleware.error_handler import forbidden_error, not_found_error
from app.models import User
from app.models.organization import PermissionLevel
from app.schemas.custom_function import CustomFunctionCreate
from app.schemas.project_file import (
    FileContentResponse,
    FileDeleteResponse,
    FileInfo,
    FileListResponse,
    FileUpdateRequest,
    FileUploadRequest,
    FileUploadResponse,
    FolderCreateRequest,
    FolderCreateResponse,
    ProjectLimitsResponse,
)
from app.services.function_scanner import FunctionScanner
from app.services.permission_service import permission_service
from app.services.project_directory import (
    ALLOWED_EXTENSIONS,
    MAX_FILES_PER_PROJECT,
    MAX_PROJECT_SIZE_BYTES,
    ProjectDirectoryManager,
)
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

# Initialize function scanner
function_scanner = FunctionScanner()

router = APIRouter()

# Initialize directory manager
directory_manager = ProjectDirectoryManager()


# ============================================================================
# Helper Functions
# ============================================================================


def validate_python_syntax(content: str) -> None:
    """
    Validate Python file syntax.

    Args:
        content: Python code to validate

    Raises:
        HTTPException: If syntax is invalid
    """
    try:
        compile(content, "<string>", "exec")
    except SyntaxError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "Invalid Python syntax",
                "message": str(e),
                "line": e.lineno,
                "offset": e.offset,
            },
        )


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent security issues.

    Args:
        filename: Original filename

    Returns:
        str: Sanitized filename
    """
    # Remove any path components
    filename = Path(filename).name

    # Remove or replace dangerous characters
    dangerous_chars = ["<", ">", ":", '"', "/", "\\", "|", "?", "*"]
    for char in dangerous_chars:
        filename = filename.replace(char, "_")

    return filename


async def scan_python_file_for_functions(
    db: AsyncSession,
    project_id: int,
    file_path: str,
    content: str,
) -> int:
    """
    Scan a Python file for @automation_function decorators and save to database.

    Args:
        db: Database session
        project_id: Project ID
        file_path: Relative file path
        content: File content

    Returns:
        int: Number of functions discovered
    """
    try:
        # Scan file for functions
        functions = function_scanner.scan_file_content(content, file_path)

        if not functions:
            # No functions found, but clean up any old ones for this file
            await custom_function_crud.delete_functions_by_file(
                db, project_id, file_path
            )
            return 0

        # Upsert each discovered function
        for func_info in functions:
            # Convert FunctionInfo to CustomFunctionCreate schema
            function_create = CustomFunctionCreate(
                file_path=func_info.file_path,
                function_name=func_info.function_name,
                display_name=func_info.display_name,
                description=func_info.description,
                category=func_info.category,
                tags=func_info.tags,
                parameters=[p.model_dump() for p in func_info.parameters],
                return_type=func_info.return_type,
                inputs=func_info.inputs,
                outputs=func_info.outputs,
                observable_outputs=func_info.observable_outputs,
                source_code=func_info.source_code,
                docstring=func_info.docstring,
                line_start=func_info.line_start,
                line_end=func_info.line_end,
            )

            # Upsert (create or update)
            await custom_function_crud.upsert_custom_function(
                db, project_id, function_create
            )

        logger.info(
            "python_file_scanned",
            project_id=project_id,
            file_path=file_path,
            functions_found=len(functions),
        )

        return len(functions)

    except Exception as e:
        # Don't fail the upload if scanning fails, just log it
        logger.warning(
            "function_scan_failed",
            project_id=project_id,
            file_path=file_path,
            error=str(e),
        )
        return 0


def get_file_info(filepath: Path, project_root: Path) -> FileInfo:
    """
    Get file information.

    Args:
        filepath: Absolute path to file
        project_root: Project root directory

    Returns:
        FileInfo: File information
    """
    stat = filepath.stat()
    rel_path = filepath.relative_to(project_root)

    return FileInfo(
        path=str(rel_path),
        name=filepath.name,
        size_bytes=stat.st_size,
        extension=filepath.suffix,
        is_directory=filepath.is_dir(),
        created_at=datetime.fromtimestamp(stat.st_ctime),
        modified_at=datetime.fromtimestamp(stat.st_mtime),
    )


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/{project_id}/files", response_model=FileListResponse)
async def list_project_files(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: int,
    directory: str = ".",
) -> FileListResponse:
    """
    List all files in project directory.

    Args:
        project_id: Project ID
        directory: Subdirectory to list (default: root)

    Returns:
        FileListResponse with file information
    """
    # Check project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permissions
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise not_found_error("Project", "project")

    # Get project root
    project_root = directory_manager.get_project_root(project_id)

    # Ensure directory exists (for backward compatibility)
    if not project_root.exists():
        directory_manager.ensure_project_directory(project_id)

    try:
        # Resolve directory path
        if directory == ".":
            search_dir = project_root
        else:
            search_dir = (project_root / directory).resolve()

            # Security check
            if not str(search_dir).startswith(str(project_root)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Directory path outside project root",
                )

            if not search_dir.exists():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Directory not found: {directory}",
                )

        # Collect file information
        files = []
        total_size = 0

        for filepath in search_dir.rglob("*"):
            if filepath.is_file():
                file_info = get_file_info(filepath, project_root)
                files.append(file_info)
                total_size += file_info.size_bytes

        logger.info(
            "project_files_listed",
            project_id=project_id,
            user_id=current_user.id,
            file_count=len(files),
        )

        return FileListResponse(
            files=files,
            total_count=len(files),
            total_size_bytes=total_size,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("list_files_error", error=str(e), project_id=project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list files: {str(e)}",
        )


@router.post("/{project_id}/files", response_model=FileUploadResponse)
async def upload_project_file(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: int,
    request: FileUploadRequest,
) -> FileUploadResponse:
    """
    Upload a file to project directory.

    Args:
        project_id: Project ID
        request: File upload request with path and content

    Returns:
        FileUploadResponse with upload status
    """
    # Check project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permissions (EDIT required)
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to upload files to this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get project root
    project_root = directory_manager.get_project_root(project_id)

    # Ensure directory exists
    if not project_root.exists():
        directory_manager.ensure_project_directory(project_id)

    try:
        # Check project limits before upload
        limits = directory_manager.check_project_limits(project_id)
        if not limits["within_limits"]:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Project exceeds limits: {limits['file_count']}/{limits['file_limit']} files, "
                f"{limits['size_bytes']}/{limits['size_limit_bytes']} bytes",
            )

        # Sanitize and validate path
        filepath = (project_root / request.path).resolve()

        # Security check
        if not str(filepath).startswith(str(project_root)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File path outside project root",
            )

        # Check if file exists
        if filepath.exists() and not request.overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"File already exists: {request.path}. Set overwrite=true to replace.",
            )

        # Validate Python syntax if .py file
        if filepath.suffix == ".py":
            validate_python_syntax(request.content)

        # Create parent directories
        filepath.parent.mkdir(parents=True, exist_ok=True)

        # Write file
        filepath.write_text(request.content, encoding="utf-8")

        # Get file size
        size_bytes = filepath.stat().st_size

        # Scan for custom functions if Python file
        if filepath.suffix == ".py":
            await scan_python_file_for_functions(
                db, project_id, request.path, request.content
            )

        logger.info(
            "project_file_uploaded",
            project_id=project_id,
            user_id=current_user.id,
            path=request.path,
            size_bytes=size_bytes,
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
        logger.error("upload_file_error", error=str(e), project_id=project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {str(e)}",
        )


@router.get("/{project_id}/files/{file_path:path}", response_model=FileContentResponse)
async def get_project_file(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: int,
    file_path: str,
) -> FileContentResponse:
    """
    Get file content.

    Args:
        project_id: Project ID
        file_path: Relative file path

    Returns:
        FileContentResponse with file content
    """
    # Check project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permissions
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise not_found_error("Project", "project")

    # Get project root
    project_root = directory_manager.get_project_root(project_id)

    if not project_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project directory not found",
        )

    try:
        # Resolve file path
        filepath = (project_root / file_path).resolve()

        # Security check
        if not str(filepath).startswith(str(project_root)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File path outside project root",
            )

        # Check file exists
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

        # Read file content
        content = filepath.read_text(encoding="utf-8")
        stat = filepath.stat()

        logger.info(
            "project_file_retrieved",
            project_id=project_id,
            user_id=current_user.id,
            path=file_path,
        )

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
        logger.error("get_file_error", error=str(e), project_id=project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
        )


@router.put("/{project_id}/files/{file_path:path}", response_model=FileUploadResponse)
async def update_project_file(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: int,
    file_path: str,
    request: FileUpdateRequest,
) -> FileUploadResponse:
    """
    Update file content.

    Args:
        project_id: Project ID
        file_path: Relative file path
        request: File update request with new content

    Returns:
        FileUploadResponse with update status
    """
    # Check project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permissions (EDIT required)
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to update files in this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get project root
    project_root = directory_manager.get_project_root(project_id)

    if not project_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project directory not found",
        )

    try:
        # Resolve file path
        filepath = (project_root / file_path).resolve()

        # Security check
        if not str(filepath).startswith(str(project_root)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File path outside project root",
            )

        # Check file exists
        if not filepath.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {file_path}",
            )

        # Validate Python syntax if .py file
        if filepath.suffix == ".py":
            validate_python_syntax(request.content)

        # Write updated content
        filepath.write_text(request.content, encoding="utf-8")

        # Get file size
        size_bytes = filepath.stat().st_size

        # Re-scan for custom functions if Python file
        if filepath.suffix == ".py":
            await scan_python_file_for_functions(
                db, project_id, file_path, request.content
            )

        logger.info(
            "project_file_updated",
            project_id=project_id,
            user_id=current_user.id,
            path=file_path,
            size_bytes=size_bytes,
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
        logger.error("update_file_error", error=str(e), project_id=project_id)
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
    project_id: int,
    file_path: str,
) -> FileDeleteResponse:
    """
    Delete a file.

    Args:
        project_id: Project ID
        file_path: Relative file path

    Returns:
        FileDeleteResponse with deletion status
    """
    # Check project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permissions (EDIT required)
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to delete files in this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get project root
    project_root = directory_manager.get_project_root(project_id)

    if not project_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project directory not found",
        )

    try:
        # Resolve file path
        filepath = (project_root / file_path).resolve()

        # Security check
        if not str(filepath).startswith(str(project_root)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File path outside project root",
            )

        # Check file exists
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

        # Delete custom functions if Python file
        if filepath.suffix == ".py":
            await custom_function_crud.delete_functions_by_file(
                db, project_id, file_path
            )

        # Delete file
        filepath.unlink()

        logger.info(
            "project_file_deleted",
            project_id=project_id,
            user_id=current_user.id,
            path=file_path,
        )

        return FileDeleteResponse(
            success=True,
            path=file_path,
            message=f"File deleted successfully: {file_path}",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("delete_file_error", error=str(e), project_id=project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete file: {str(e)}",
        )


@router.post("/{project_id}/files/folder", response_model=FolderCreateResponse)
async def create_project_folder(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: int,
    request: FolderCreateRequest,
) -> FolderCreateResponse:
    """
    Create a folder.

    Args:
        project_id: Project ID
        request: Folder creation request with path

    Returns:
        FolderCreateResponse with creation status
    """
    # Check project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permissions (EDIT required)
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.EDIT
    )
    if not has_access:
        raise forbidden_error(
            "You do not have permission to create folders in this project",
            ErrorCode.INSUFFICIENT_PERMISSIONS,
        )

    # Get project root
    project_root = directory_manager.get_project_root(project_id)

    # Ensure directory exists
    if not project_root.exists():
        directory_manager.ensure_project_directory(project_id)

    try:
        # Resolve folder path
        folder_path = (project_root / request.path).resolve()

        # Security check
        if not str(folder_path).startswith(str(project_root)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder path outside project root",
            )

        # Check if folder already exists
        if folder_path.exists():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Folder already exists: {request.path}",
            )

        # Create folder
        folder_path.mkdir(parents=True, exist_ok=False)

        logger.info(
            "project_folder_created",
            project_id=project_id,
            user_id=current_user.id,
            path=request.path,
        )

        return FolderCreateResponse(
            success=True,
            path=request.path,
            message=f"Folder created successfully: {request.path}",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("create_folder_error", error=str(e), project_id=project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create folder: {str(e)}",
        )


@router.get("/{project_id}/files/limits", response_model=ProjectLimitsResponse)
async def get_project_limits(
    *,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user: User = Depends(deps.current_active_user),
    project_id: int,
) -> ProjectLimitsResponse:
    """
    Get project size and file count limits.

    Args:
        project_id: Project ID

    Returns:
        ProjectLimitsResponse with current usage and limits
    """
    # Check project exists
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    # Check permissions
    has_access = await permission_service.can_user_access_project(
        db, current_user.id, project_id, PermissionLevel.VIEW
    )
    if not has_access:
        raise not_found_error("Project", "project")

    try:
        limits = directory_manager.check_project_limits(project_id)

        return ProjectLimitsResponse(**limits)

    except Exception as e:
        logger.error("get_limits_error", error=str(e), project_id=project_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check limits: {str(e)}",
        )
