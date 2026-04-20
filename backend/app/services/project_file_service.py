"""
Project file service for handling file operations and custom function scanning.

Provides file validation, path security, and function discovery for project files.
"""

from datetime import datetime
from pathlib import Path
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import custom_function as custom_function_crud
from app.schemas.custom_function import CustomFunctionCreate
from app.schemas.project_file import FileInfo
from app.services.function_scanner import FunctionScanner
from app.services.project_directory import ProjectDirectoryManager

logger = structlog.get_logger(__name__)


# ============================================================================
# Project File Service
# ============================================================================


class ProjectFileService:
    """
    Service for project file operations.

    Provides methods for:
    - File path validation and security
    - Python syntax validation
    - Function scanning and discovery
    - Building file info responses
    """

    def __init__(self) -> None:
        self.directory_manager = ProjectDirectoryManager()
        self.function_scanner = FunctionScanner()

    def validate_python_syntax(self, content: str) -> None:
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

    def sanitize_filename(self, filename: str) -> str:
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

    def validate_path_security(self, filepath: Path, project_root: Path) -> None:
        """
        Validate that a file path is within the project root.

        Args:
            filepath: Resolved file path
            project_root: Project root directory

        Raises:
            HTTPException: If path is outside project root
        """
        if not str(filepath).startswith(str(project_root)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File path outside project root",
            )

    def check_project_limits(self, project_id: str) -> dict:
        """
        Check project file and size limits.

        Args:
            project_id: Project ID

        Returns:
            dict: Limits information

        Raises:
            HTTPException: If project exceeds limits
        """
        limits = self.directory_manager.check_project_limits(project_id)
        if not limits["within_limits"]:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"Project exceeds limits: {limits['file_count']}/{limits['file_limit']} files, "
                    f"{limits['size_bytes']}/{limits['size_limit_bytes']} bytes"
                ),
            )
        return limits

    def get_project_root(self, project_id: str) -> Path:
        """
        Get the project root directory, creating it if needed.

        Args:
            project_id: Project ID

        Returns:
            Path: Project root directory
        """
        project_root = self.directory_manager.get_project_root(project_id)

        # Ensure directory exists
        if not project_root.exists():
            self.directory_manager.ensure_project_directory(project_id)

        return project_root

    def resolve_file_path(self, project_root: Path, relative_path: str) -> Path:
        """
        Resolve and validate a file path.

        Args:
            project_root: Project root directory
            relative_path: Relative file path

        Returns:
            Path: Resolved absolute path

        Raises:
            HTTPException: If path is outside project root
        """
        filepath = (project_root / relative_path).resolve()
        self.validate_path_security(filepath, project_root)
        return filepath

    def get_file_info(self, filepath: Path, project_root: Path) -> FileInfo:
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

    async def scan_python_file_for_functions(
        self,
        db: AsyncSession,
        project_id: UUID,
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
            functions = self.function_scanner.scan_file(content, file_path)

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

    async def delete_functions_for_file(
        self,
        db: AsyncSession,
        project_id: UUID,
        file_path: str,
    ) -> None:
        """
        Delete all custom functions for a file.

        Args:
            db: Database session
            project_id: Project ID
            file_path: Relative file path
        """
        await custom_function_crud.delete_functions_by_file(db, project_id, file_path)


# Singleton instance for convenience
project_file_service = ProjectFileService()
