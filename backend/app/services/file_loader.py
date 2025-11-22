"""
File loading service for Python code execution.

Provides secure file loading with path validation, preventing directory
traversal and unauthorized file access.
"""

import os
import re
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, status
import structlog

logger = structlog.get_logger(__name__)


class FilePathValidator:
    """Validates file paths for security.

    Prevents:
    - Directory traversal (../)
    - Absolute paths
    - Access outside project directory
    - Non-Python files
    """

    # Dangerous path patterns
    DANGEROUS_PATTERNS = [
        r'\.\.',  # Parent directory reference
        r'^/',    # Absolute path (Unix)
        r'^[A-Za-z]:',  # Absolute path (Windows)
        r'~',     # Home directory
        r'\$',    # Environment variables
    ]

    @classmethod
    def validate_path(cls, file_path: str, project_root: Optional[Path] = None) -> Path:
        """Validate and normalize file path.

        Args:
            file_path: Relative path to validate
            project_root: Project root directory (optional)

        Returns:
            Normalized absolute path

        Raises:
            HTTPException: If path is invalid or dangerous
        """
        # Check for dangerous patterns
        for pattern in cls.DANGEROUS_PATTERNS:
            if re.search(pattern, file_path):
                logger.warning(
                    "dangerous_path_pattern_detected",
                    file_path=file_path,
                    pattern=pattern
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid file path: contains forbidden pattern '{pattern}'"
                )

        # Ensure .py extension
        if not file_path.endswith('.py'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File path must have .py extension"
            )

        # Normalize path relative to project root (or CWD if no project root)
        base_path = project_root if project_root else Path.cwd()
        base_path = base_path.resolve()

        # Join relative path with base path
        normalized_path = (base_path / file_path).resolve()

        # Validate against project root if provided
        if project_root:
            # Ensure path is within project directory
            try:
                normalized_path.relative_to(base_path)
            except ValueError:
                logger.warning(
                    "path_outside_project_root",
                    file_path=str(normalized_path),
                    project_root=str(base_path)
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="File path must be within project directory"
                )

        # Check if file exists
        if not normalized_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {file_path}"
            )

        # Check if it's a file (not directory)
        if not normalized_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path is not a file: {file_path}"
            )

        logger.info(
            "file_path_validated",
            file_path=file_path,
            resolved_path=str(normalized_path)
        )

        return normalized_path


class PythonFileLoader:
    """Loads and caches Python files for execution."""

    def __init__(self, project_root: Optional[Path] = None):
        """Initialize file loader.

        Args:
            project_root: Root directory for file resolution
        """
        self.project_root = project_root or Path.cwd()
        self.validator = FilePathValidator()
        self._cache: dict[str, str] = {}  # Simple in-memory cache

    def load_file(self, file_path: str, use_cache: bool = True) -> str:
        """Load Python file content.

        Args:
            file_path: Relative path to Python file
            use_cache: Whether to use cached content

        Returns:
            File content as string

        Raises:
            HTTPException: If file is invalid or inaccessible
        """
        # Check cache first
        if use_cache and file_path in self._cache:
            logger.debug("file_loaded_from_cache", file_path=file_path)
            return self._cache[file_path]

        # Validate path
        absolute_path = self.validator.validate_path(
            file_path,
            project_root=self.project_root
        )

        # Load file content
        try:
            with open(absolute_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Cache content
            if use_cache:
                self._cache[file_path] = content

            logger.info(
                "file_loaded_successfully",
                file_path=file_path,
                size_bytes=len(content)
            )

            return content

        except UnicodeDecodeError as e:
            logger.error(
                "file_encoding_error",
                file_path=file_path,
                error=str(e)
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File encoding error: {str(e)}"
            )
        except PermissionError:
            logger.error(
                "file_permission_denied",
                file_path=file_path
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {file_path}"
            )
        except Exception as e:
            logger.error(
                "file_load_error",
                file_path=file_path,
                error=str(e),
                error_type=type(e).__name__
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to load file: {str(e)}"
            )

    def clear_cache(self, file_path: Optional[str] = None):
        """Clear file cache.

        Args:
            file_path: Specific file to clear, or None to clear all
        """
        if file_path:
            self._cache.pop(file_path, None)
            logger.debug("file_cache_cleared", file_path=file_path)
        else:
            self._cache.clear()
            logger.debug("file_cache_cleared_all")

    def list_python_files(self, directory: str = ".") -> list[str]:
        """List all Python files in directory (recursive).

        Args:
            directory: Directory to search (relative to project root)

        Returns:
            List of relative file paths
        """
        # Validate directory path
        dir_path = self.project_root / directory

        if not dir_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Directory not found: {directory}"
            )

        if not dir_path.is_dir():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path is not a directory: {directory}"
            )

        # Find all .py files
        python_files = []
        for file_path in dir_path.rglob("*.py"):
            # Make path relative to project root
            relative_path = file_path.relative_to(self.project_root)
            python_files.append(str(relative_path))

        logger.info(
            "python_files_listed",
            directory=directory,
            file_count=len(python_files)
        )

        return sorted(python_files)
