"""
Project Directory Management Service.

Manages project directory structure for user files, including:
- Creating project directories
- Managing file structure (scripts/, lib/, workflows/)
- Template file creation
- Directory validation
- Security checks
"""

import os
import shutil
from pathlib import Path
from typing import Any
from uuid import UUID

import structlog

logger = structlog.get_logger(__name__)


# ============================================================================
# Configuration
# ============================================================================

# Base directory for all user projects
USER_PROJECTS_ROOT = Path(__file__).parent.parent.parent / "user_projects"

# Maximum total project size (100MB per project)
MAX_PROJECT_SIZE_BYTES = 100 * 1024 * 1024

# Maximum number of files per project
MAX_FILES_PER_PROJECT = 1000

# Allowed file extensions
ALLOWED_EXTENSIONS = {".py", ".txt", ".md", ".json", ".yaml", ".yml"}


# ============================================================================
# Template Files
# ============================================================================

GITIGNORE_TEMPLATE = """# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Virtual environments
venv/
ENV/
env/

# IDEs
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
*.log

# Testing
.pytest_cache/
.coverage
htmlcov/

# Temporary files
*.tmp
temp/
"""

README_TEMPLATE = """# {project_name}

{description}

## Project Structure

- `scripts/` - Main automation scripts
- `lib/` - Reusable library functions
- `workflows/` - Workflow definitions

## Getting Started

1. Write your Python automation scripts in the `scripts/` directory
2. Create reusable functions in the `lib/` directory
3. Define workflows in the `workflows/` directory

## Example

See `scripts/example.py` for a simple example.

## Notes

- All Python files are executed in a sandboxed environment
- Only whitelisted imports are allowed (re, json, math, datetime, etc.)
- Maximum execution timeout: 60 seconds
- Maximum file size: 1MB per file
- Maximum project size: 100MB

---

*Project created with Qontinui*
"""

EXAMPLE_SCRIPT = '''"""
Example automation script.

This file demonstrates how to write a simple Python function
that can be called from Qontinui workflows.
"""


def detect_unit(screenshot_data: dict, threshold: float = 0.8) -> dict:
    """
    Detect a unit on the screen.

    Args:
        screenshot_data: Screenshot data from action_result
        threshold: Detection confidence threshold (0.0-1.0)

    Returns:
        dict: Detection result with coordinates and confidence
    """
    # Example implementation
    # In a real scenario, this would use computer vision or pattern matching

    return {
        "found": True,
        "confidence": 0.95,
        "x": 100,
        "y": 200,
        "width": 50,
        "height": 50,
    }


def validate_state(action_result: dict) -> bool:
    """
    Validate that the automation is in the correct state.

    Args:
        action_result: Previous action result

    Returns:
        bool: True if state is valid, False otherwise
    """
    # Example validation logic
    if not action_result:
        return False

    # Check if required fields exist
    required_fields = ["status", "data"]
    return all(field in action_result for field in required_fields)


def transform_data(text: str, variables: dict) -> dict:
    """
    Transform extracted text data.

    Args:
        text: Raw text from OCR or action result
        variables: Workflow variables

    Returns:
        dict: Transformed data
    """
    import re

    # Example: Extract price from text
    price_match = re.search(r"\\$(\\d+\\.\\d{2})", text)
    price = float(price_match.group(1)) if price_match else 0.0

    # Extract other data
    return {
        "price": price,
        "currency": "USD",
        "timestamp": variables.get("timestamp"),
    }
'''


# ============================================================================
# Project Directory Manager
# ============================================================================


class ProjectDirectoryManager:
    """Manages project directory structure for user files."""

    def __init__(self, base_dir: Path | None = None):
        """
        Initialize the project directory manager.

        Args:
            base_dir: Base directory for user projects (defaults to USER_PROJECTS_ROOT)
        """
        self.base_dir = base_dir or USER_PROJECTS_ROOT

    def create_project_directory(
        self,
        project_id: int | str | UUID,
        project_name: str = "",
        description: str = "",
    ) -> Path:
        """
        Create project directory structure.

        Creates:
        - user_projects/{project_id}/
        - user_projects/{project_id}/scripts/
        - user_projects/{project_id}/lib/
        - user_projects/{project_id}/workflows/
        - user_projects/{project_id}/.gitignore
        - user_projects/{project_id}/README.md
        - user_projects/{project_id}/scripts/example.py

        Args:
            project_id: Unique project identifier
            project_name: Project name for README template
            description: Project description for README template

        Returns:
            Path: Path to created project directory

        Raises:
            FileExistsError: If project directory already exists
            OSError: If directory creation fails
        """
        project_root = self.get_project_root(project_id)

        # Check if directory already exists
        if project_root.exists():
            logger.warning(
                "project_directory_exists",
                project_id=project_id,
                path=str(project_root),
            )
            raise FileExistsError(f"Project directory already exists: {project_root}")

        try:
            # Create directory structure
            project_root.mkdir(parents=True, exist_ok=False)
            (project_root / "scripts").mkdir(exist_ok=True)
            (project_root / "lib").mkdir(exist_ok=True)
            (project_root / "workflows").mkdir(exist_ok=True)

            # Create .gitignore
            gitignore_path = project_root / ".gitignore"
            gitignore_path.write_text(GITIGNORE_TEMPLATE)

            # Create README.md
            readme_content = README_TEMPLATE.format(
                project_name=project_name or f"Project {project_id}",
                description=description or "No description provided.",
            )
            readme_path = project_root / "README.md"
            readme_path.write_text(readme_content)

            # Create example script
            example_path = project_root / "scripts" / "example.py"
            example_path.write_text(EXAMPLE_SCRIPT)

            logger.info(
                "project_directory_created",
                project_id=project_id,
                path=str(project_root),
            )

            return project_root

        except Exception as e:
            # Clean up on failure
            if project_root.exists():
                shutil.rmtree(project_root, ignore_errors=True)

            logger.error(
                "project_directory_creation_failed",
                project_id=project_id,
                error=str(e),
            )
            raise

    def get_project_root(self, project_id: int | str | UUID) -> Path:
        """
        Get project root directory path.

        Args:
            project_id: Project identifier

        Returns:
            Path: Path to project root directory
        """
        return self.base_dir / str(project_id)

    def validate_project_directory(self, project_id: int | str | UUID) -> bool:
        """
        Check if project directory exists and is valid.

        Args:
            project_id: Project identifier

        Returns:
            bool: True if directory exists and has required structure
        """
        project_root = self.get_project_root(project_id)

        if not project_root.exists():
            return False

        # Check required subdirectories
        required_dirs = ["scripts", "lib", "workflows"]
        for dir_name in required_dirs:
            if not (project_root / dir_name).is_dir():
                logger.warning(
                    "project_directory_missing_subdirectory",
                    project_id=project_id,
                    missing_dir=dir_name,
                )
                return False

        return True

    def delete_project_directory(self, project_id: int | str | UUID) -> bool:
        """
        Delete project directory and all contents.

        Args:
            project_id: Project identifier

        Returns:
            bool: True if deleted successfully, False if directory doesn't exist

        Raises:
            OSError: If deletion fails
        """
        project_root = self.get_project_root(project_id)

        if not project_root.exists():
            logger.warning(
                "project_directory_not_found",
                project_id=project_id,
                path=str(project_root),
            )
            return False

        try:
            shutil.rmtree(project_root)
            logger.info(
                "project_directory_deleted",
                project_id=project_id,
                path=str(project_root),
            )
            return True

        except Exception as e:
            logger.error(
                "project_directory_deletion_failed",
                project_id=project_id,
                error=str(e),
            )
            raise

    def get_project_size(self, project_id: int | str | UUID) -> int:
        """
        Calculate total size of project directory in bytes.

        Args:
            project_id: Project identifier

        Returns:
            int: Total size in bytes, or 0 if directory doesn't exist
        """
        project_root = self.get_project_root(project_id)

        if not project_root.exists():
            return 0

        total_size = 0
        for dirpath, dirnames, filenames in os.walk(project_root):
            for filename in filenames:
                filepath = Path(dirpath) / filename
                try:
                    total_size += filepath.stat().st_size
                except OSError:
                    # Skip files that can't be accessed
                    pass

        return total_size

    def get_file_count(self, project_id: int | str | UUID) -> int:
        """
        Count total number of files in project directory.

        Args:
            project_id: Project identifier

        Returns:
            int: Number of files, or 0 if directory doesn't exist
        """
        project_root = self.get_project_root(project_id)

        if not project_root.exists():
            return 0

        file_count = 0
        for dirpath, dirnames, filenames in os.walk(project_root):
            file_count += len(filenames)

        return file_count

    def check_project_limits(self, project_id: int | str | UUID) -> dict[str, Any]:
        """
        Check if project is within size and file count limits.

        Args:
            project_id: Project identifier

        Returns:
            dict: {
                "within_limits": bool,
                "size_bytes": int,
                "size_limit_bytes": int,
                "file_count": int,
                "file_limit": int
            }
        """
        size_bytes = self.get_project_size(project_id)
        file_count = self.get_file_count(project_id)

        return {
            "within_limits": (
                size_bytes <= MAX_PROJECT_SIZE_BYTES
                and file_count <= MAX_FILES_PER_PROJECT
            ),
            "size_bytes": size_bytes,
            "size_limit_bytes": MAX_PROJECT_SIZE_BYTES,
            "file_count": file_count,
            "file_limit": MAX_FILES_PER_PROJECT,
            "size_percentage": (size_bytes / MAX_PROJECT_SIZE_BYTES) * 100,
            "file_percentage": (file_count / MAX_FILES_PER_PROJECT) * 100,
        }

    def list_files(
        self,
        project_id: int | str | UUID,
        directory: str = ".",
        extensions: list[str] | None = None,
    ) -> list[str]:
        """
        List all files in project directory.

        Args:
            project_id: Project identifier
            directory: Subdirectory to list (relative to project root)
            extensions: File extensions to filter (e.g., ['.py', '.txt'])

        Returns:
            list: List of relative file paths

        Raises:
            FileNotFoundError: If project or directory doesn't exist
            ValueError: If directory is outside project root
        """
        project_root = self.get_project_root(project_id)

        if not project_root.exists():
            raise FileNotFoundError(f"Project directory not found: {project_root}")

        # Resolve and validate directory path
        if directory == ".":
            search_dir = project_root
        else:
            search_dir = (project_root / directory).resolve()

            # Security check: Ensure directory is within project root
            if not str(search_dir).startswith(str(project_root)):
                raise ValueError("Directory path outside project root")

            if not search_dir.exists():
                raise FileNotFoundError(f"Directory not found: {directory}")

        # Collect files
        files = []
        for filepath in search_dir.rglob("*"):
            if filepath.is_file():
                # Filter by extension if specified
                if extensions and filepath.suffix not in extensions:
                    continue

                # Get relative path from project root
                rel_path = filepath.relative_to(project_root)
                files.append(str(rel_path))

        return sorted(files)

    def ensure_project_directory(self, project_id: int | str | UUID) -> Path:
        """
        Ensure project directory exists, create if it doesn't.

        This is a helper method for backward compatibility with existing
        projects that may not have directories created yet.

        Args:
            project_id: Project identifier

        Returns:
            Path: Path to project root directory
        """
        project_root = self.get_project_root(project_id)

        if not project_root.exists():
            logger.info(
                "creating_missing_project_directory",
                project_id=project_id,
            )
            # Create minimal directory structure (no templates)
            project_root.mkdir(parents=True, exist_ok=True)
            (project_root / "scripts").mkdir(exist_ok=True)
            (project_root / "lib").mkdir(exist_ok=True)
            (project_root / "workflows").mkdir(exist_ok=True)

        return project_root
