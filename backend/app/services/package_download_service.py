"""
Package Download Service.

Handles downloading, file writing, and virtual environment management for packages.

Features:
- Create package directories
- Write package code files
- Manage virtual environments
- Install pip dependencies
"""

import shutil
import subprocess
import sys
from pathlib import Path

import structlog

from app.models.code_package import CodePackage, PackageVersion
from app.services.package_validator import validate_package_name
from app.services.project_directory import ProjectDirectoryManager

logger = structlog.get_logger(__name__)


# ============================================================================
# Package Download Service
# ============================================================================


class PackageDownloadService:
    """
    Service for downloading and installing package files.

    Responsibilities:
    - Create package directory structures
    - Write package code files to disk
    - Manage virtual environments
    - Install pip dependencies
    """

    def __init__(
        self,
        project_dir_manager: ProjectDirectoryManager | None = None,
    ):
        """Initialize package download service."""
        self.project_dir_manager = project_dir_manager or ProjectDirectoryManager()

    async def create_package_directory(
        self, project_id: int, package: CodePackage, version: PackageVersion
    ) -> Path:
        """Create package directory at user_projects/{project_id}/packages/{package_slug}/."""
        project_root = self.project_dir_manager.ensure_project_directory(project_id)
        packages_dir = project_root / "packages"
        packages_dir.mkdir(exist_ok=True)

        package_dir = packages_dir / package.slug
        if package_dir.exists():
            # Clean existing installation
            shutil.rmtree(package_dir)

        package_dir.mkdir(parents=True)

        return package_dir

    async def write_package_files(
        self, install_path: Path, version: PackageVersion, package: CodePackage
    ) -> None:
        """Write code file, __init__.py, and README.md to installation directory."""
        # Extract typed values from models
        func_name: str = version.function_name  # type: ignore[assignment]
        code_content: str = version.code_content  # type: ignore[assignment]
        pkg_name: str = package.name  # type: ignore[assignment]
        pkg_desc: str = package.description  # type: ignore[assignment]
        ver_str: str = version.version  # type: ignore[assignment]
        pkg_license: str | None = package.license  # type: ignore[assignment]
        pkg_slug: str = package.slug  # type: ignore[assignment]
        dependencies_list: list[dict[str, str]] = version.dependencies  # type: ignore[assignment]
        changelog: str | None = version.changelog  # type: ignore[assignment]

        # Write main code file
        code_file = install_path / f"{func_name}.py"
        code_file.write_text(code_content)

        # Create __init__.py to export main function
        init_content = f'''"""
{pkg_name}

{pkg_desc}

Version: {ver_str}
Author: {package.author_id}
License: {pkg_license or 'Not specified'}
"""

from .{func_name} import {func_name}

__all__ = ["{func_name}"]
__version__ = "{ver_str}"
'''
        init_file = install_path / "__init__.py"
        init_file.write_text(init_content)

        # Create README with package metadata
        readme_content = f"""# {pkg_name}

{pkg_desc}

## Version

{ver_str}

## Usage

```python
from packages.{pkg_slug} import {func_name}

# Use the function in your workflow
result = {func_name}(...)
```

## Dependencies

{self._format_dependencies(dependencies_list)}

## Changelog

{changelog or 'No changelog available'}

## License

{pkg_license or 'Not specified'}

---

*Installed from Qontinui Community Library*
"""
        readme_file = install_path / "README.md"
        readme_file.write_text(readme_content)

    def _format_dependencies(self, dependencies: list[dict[str, str]]) -> str:
        """Format dependencies list for README."""
        if not dependencies:
            return "No dependencies"

        lines = []
        for dep in dependencies:
            name = dep.get("name", "")
            version = dep.get("version", "")
            lines.append(f"- `{name}{version}`")

        return "\n".join(lines)

    async def remove_package_directory(
        self, project_id: int, package: CodePackage
    ) -> bool:
        """Remove package directory. Returns True if removed."""
        project_root = self.project_dir_manager.get_project_root(project_id)
        package_dir = project_root / "packages" / package.slug

        if package_dir.exists():
            shutil.rmtree(package_dir)
            logger.info(
                "package_directory_removed",
                project_id=project_id,
                package_id=package.id,
                path=str(package_dir),
            )
            return True

        return False

    async def ensure_venv(self, project_id: int) -> Path:
        """Ensure virtual environment exists for project, create if needed."""
        project_root = self.project_dir_manager.get_project_root(project_id)
        venv_path = project_root / ".venv"

        if not venv_path.exists():
            logger.info("creating_virtual_environment", project_id=project_id)
            subprocess.run(
                [sys.executable, "-m", "venv", str(venv_path)],
                check=True,
                timeout=60,
            )

        return venv_path

    async def install_pip_dependencies(
        self, project_id: int, dependencies: list[str]
    ) -> bool:
        """Install pip dependencies into project's virtual environment."""
        if not dependencies:
            return True

        try:
            # Get or create virtual environment
            venv_path = await self.ensure_venv(project_id)

            # Install dependencies using pip
            pip_path = venv_path / "bin" / "pip"
            if sys.platform == "win32":
                pip_path = venv_path / "Scripts" / "pip.exe"

            for dep in dependencies:
                # Validate package name to prevent command injection
                if not validate_package_name(dep):
                    logger.error(
                        "invalid_package_name",
                        project_id=project_id,
                        package=dep,
                        reason="Package name does not follow PyPI conventions",
                    )
                    continue  # Skip invalid packages

                result = subprocess.run(
                    [str(pip_path), "install", "--no-deps", dep],
                    capture_output=True,
                    text=True,
                    timeout=300,  # 5 minute timeout
                )

                if result.returncode != 0:
                    logger.error(
                        "dependency_installation_failed",
                        project_id=project_id,
                        dependency=dep,
                        error=result.stderr,
                    )
                    return False

            logger.info(
                "dependencies_installed",
                project_id=project_id,
                count=len(dependencies),
            )
            return True

        except subprocess.TimeoutExpired:
            logger.error(
                "dependency_installation_timeout",
                project_id=project_id,
            )
            return False

        except Exception as e:
            logger.error(
                "dependency_installation_error",
                project_id=project_id,
                error=str(e),
            )
            return False


# Singleton instance for dependency injection
package_download_service = PackageDownloadService()
