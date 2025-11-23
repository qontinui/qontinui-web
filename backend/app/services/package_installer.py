"""
Package Installation Service.

Manages downloading and integrating community code packages into user projects.

Features:
- Install packages from community library
- Dependency resolution and management
- Version updates
- Security validation
- Virtual environment management
"""

import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import structlog
from app.models.code_package import (
    CodePackage,
    InstallationStatus,
    PackageInstallation,
    PackageVersion,
    SecurityScanStatus,
)
from app.schemas.package import (
    DependencyInfo,
    DependencyResolutionResult,
    InstallResult,
    SafetyCheckResult,
    UninstallResult,
    UpdateInfo,
    UpdateResult,
)
from app.services.project_directory import ProjectDirectoryManager
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


# ============================================================================
# Configuration
# ============================================================================

# Maximum package size (10MB per package)
MAX_PACKAGE_SIZE_BYTES = 10 * 1024 * 1024

# Minimum free disk space required (100MB)
MIN_FREE_DISK_SPACE_BYTES = 100 * 1024 * 1024


# ============================================================================
# Package Installer Service
# ============================================================================


class PackageInstaller:
    """Service for installing and managing community packages in user projects."""

    def __init__(
        self,
        db_session: AsyncSession,
        project_dir_manager: Optional[ProjectDirectoryManager] = None,
    ):
        """
        Initialize package installer.

        Args:
            db_session: Database session for queries
            project_dir_manager: Optional project directory manager (defaults to new instance)
        """
        self.db = db_session
        self.project_dir_manager = project_dir_manager or ProjectDirectoryManager()

    # ========================================================================
    # Installation
    # ========================================================================

    async def install_package(
        self, project_id: int, package_id: int, version_id: int, user_id: str
    ) -> InstallResult:
        """
        Install a package into a project.

        Downloads code to user_projects/{project_id}/packages/{package_slug}/
        Creates __init__.py to make package importable
        Records installation in package_installations table
        Updates download count

        Args:
            project_id: Target project ID
            package_id: Package to install
            version_id: Specific version to install
            user_id: User performing installation

        Returns:
            InstallResult with status and installed path
        """
        try:
            # 1. Fetch package and version from database
            package = await self._get_package(package_id)
            if not package:
                return InstallResult(
                    success=False,
                    package_id=package_id,
                    version_id=version_id,
                    installed_path="",
                    message="Package not found",
                    error="PACKAGE_NOT_FOUND",
                )

            version = await self._get_package_version(version_id)
            if not version or version.package_id != package_id:
                return InstallResult(
                    success=False,
                    package_id=package_id,
                    version_id=version_id,
                    installed_path="",
                    message="Version not found or version mismatch",
                    error="VERSION_NOT_FOUND",
                )

            # 2. Run safety checks
            safety_result = await self._run_safety_checks(project_id, package, version)
            if not safety_result.passed:
                return InstallResult(
                    success=False,
                    package_id=package_id,
                    version_id=version_id,
                    installed_path="",
                    message=f"Safety checks failed: {', '.join(safety_result.errors)}",
                    error="SAFETY_CHECK_FAILED",
                )

            # 3. Check if already installed
            existing = await self._get_installation(project_id, package_id)
            if existing and existing.status == InstallationStatus.ACTIVE.value:
                return InstallResult(
                    success=False,
                    package_id=package_id,
                    version_id=version_id,
                    installed_path="",
                    message=f"Package '{package.name}' is already installed. Use update instead.",
                    error="ALREADY_INSTALLED",
                )

            # 4. Create package directory
            install_path = await self._create_package_directory(
                project_id, package, version
            )

            # 5. Write package code files
            await self._write_package_files(install_path, version, package)

            # 6. Record installation in database
            installation = await self._record_installation(
                project_id, package_id, version_id, user_id, str(install_path)
            )

            # 7. Update download count
            await self._increment_download_count(package, version)

            await self.db.commit()

            logger.info(
                "package_installed",
                project_id=project_id,
                package_id=package_id,
                version_id=version_id,
                path=str(install_path),
            )

            return InstallResult(
                success=True,
                package_id=package_id,
                version_id=version_id,
                installed_path=f"packages/{package.slug}",
                message=f"Successfully installed {package.name} v{version.version}",
            )

        except Exception as e:
            await self.db.rollback()
            logger.error(
                "package_installation_failed",
                project_id=project_id,
                package_id=package_id,
                error=str(e),
            )
            return InstallResult(
                success=False,
                package_id=package_id,
                version_id=version_id,
                installed_path="",
                message="Installation failed",
                error=str(e),
            )

    # ========================================================================
    # Dependency Management
    # ========================================================================

    async def resolve_dependencies(
        self, dependencies: List[Dict[str, str]]
    ) -> DependencyResolutionResult:
        """
        Resolve package dependencies.

        Parses dependencies list (e.g., [{"name": "requests", "version": ">=2.0"}])
        Checks which are already installed
        Returns missing dependencies

        Args:
            dependencies: List of dependency specifications

        Returns:
            DependencyResolutionResult with required and missing dependencies
        """
        required_deps: List[DependencyInfo] = []
        missing_deps: List[str] = []

        for dep in dependencies:
            name = dep.get("name", "")
            version_spec = dep.get("version", "")

            # Check if dependency is installed
            is_installed, installed_version = self._check_dependency_installed(
                name, version_spec
            )

            dep_info = DependencyInfo(
                name=name,
                version_spec=version_spec,
                is_installed=is_installed,
                installed_version=installed_version,
            )
            required_deps.append(dep_info)

            if not is_installed:
                missing_deps.append(f"{name}{version_spec}")

        return DependencyResolutionResult(
            required_dependencies=required_deps,
            missing_dependencies=missing_deps,
        )

    async def install_dependencies(
        self, project_id: int, dependencies: List[str]
    ) -> bool:
        """
        Install missing dependencies for a package.

        Creates virtual environment for project (if needed)
        Runs pip install for dependencies
        Stores in user_projects/{project_id}/.venv/

        Args:
            project_id: Project ID
            dependencies: List of pip package specs (e.g., ["requests>=2.0", "pillow"])

        Returns:
            True if installation succeeded
        """
        if not dependencies:
            return True

        try:
            # Get or create virtual environment
            venv_path = await self._ensure_venv(project_id)

            # Install dependencies using pip
            pip_path = venv_path / "bin" / "pip"
            if sys.platform == "win32":
                pip_path = venv_path / "Scripts" / "pip.exe"

            for dep in dependencies:
                result = subprocess.run(
                    [str(pip_path), "install", dep],
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

        except Exception as e:
            logger.error(
                "dependency_installation_error",
                project_id=project_id,
                error=str(e),
            )
            return False

    # ========================================================================
    # Updates
    # ========================================================================

    async def check_updates(self, project_id: int) -> List[UpdateInfo]:
        """
        Check for available package updates.

        Compares installed versions with latest versions
        Returns packages that have updates

        Args:
            project_id: Project ID to check

        Returns:
            List of UpdateInfo for packages with available updates
        """
        updates: List[UpdateInfo] = []

        # Get all active installations for project
        query = select(PackageInstallation).where(
            PackageInstallation.project_id == project_id,
            PackageInstallation.status == InstallationStatus.ACTIVE.value,
        )
        result = await self.db.execute(query)
        installations = result.scalars().all()

        for installation in installations:
            # Get current version
            current_version = await self._get_package_version(installation.version_id)
            if not current_version:
                continue

            # Get latest version for this package
            latest_version = await self._get_latest_version(installation.package_id)
            if not latest_version:
                continue

            # Compare versions (simple string comparison for now)
            if self._is_newer_version(latest_version.version, current_version.version):
                package = await self._get_package(installation.package_id)
                if package:
                    updates.append(
                        UpdateInfo(
                            package_id=package.id,
                            package_name=package.name,
                            current_version=current_version.version,
                            latest_version=latest_version.version,
                            changelog=latest_version.changelog,
                        )
                    )

        return updates

    async def update_package(
        self, project_id: int, package_id: int, user_id: str
    ) -> UpdateResult:
        """
        Update a package to the latest version.

        Downloads latest version
        Replaces old code
        Updates installation record

        Args:
            project_id: Project ID
            package_id: Package to update
            user_id: User performing update

        Returns:
            UpdateResult with status
        """
        try:
            # Get current installation
            installation = await self._get_installation(project_id, package_id)
            if not installation:
                return UpdateResult(
                    success=False,
                    package_id=package_id,
                    old_version="",
                    new_version="",
                    message="Package not installed",
                    error="NOT_INSTALLED",
                )

            # Get current version
            old_version = await self._get_package_version(installation.version_id)
            if not old_version:
                return UpdateResult(
                    success=False,
                    package_id=package_id,
                    old_version="",
                    new_version="",
                    message="Current version not found",
                    error="VERSION_NOT_FOUND",
                )

            # Get latest version
            latest_version = await self._get_latest_version(package_id)
            if not latest_version:
                return UpdateResult(
                    success=False,
                    package_id=package_id,
                    old_version=old_version.version,
                    new_version="",
                    message="No updates available",
                    error="NO_UPDATES",
                )

            # Check if already on latest
            if latest_version.id == old_version.id:
                return UpdateResult(
                    success=True,
                    package_id=package_id,
                    old_version=old_version.version,
                    new_version=latest_version.version,
                    message="Already on latest version",
                )

            # Uninstall old version
            await self.uninstall_package(project_id, package_id)

            # Install new version
            install_result = await self.install_package(
                project_id, package_id, latest_version.id, user_id
            )

            if not install_result.success:
                return UpdateResult(
                    success=False,
                    package_id=package_id,
                    old_version=old_version.version,
                    new_version=latest_version.version,
                    message="Update failed",
                    error=install_result.error,
                )

            return UpdateResult(
                success=True,
                package_id=package_id,
                old_version=old_version.version,
                new_version=latest_version.version,
                message=f"Updated from {old_version.version} to {latest_version.version}",
            )

        except Exception as e:
            logger.error(
                "package_update_failed",
                project_id=project_id,
                package_id=package_id,
                error=str(e),
            )
            return UpdateResult(
                success=False,
                package_id=package_id,
                old_version="",
                new_version="",
                message="Update failed",
                error=str(e),
            )

    # ========================================================================
    # Uninstallation
    # ========================================================================

    async def uninstall_package(
        self, project_id: int, package_id: int
    ) -> UninstallResult:
        """
        Uninstall a package from project.

        Removes code files
        Marks installation as removed in DB

        Args:
            project_id: Project ID
            package_id: Package to uninstall

        Returns:
            UninstallResult with status
        """
        try:
            # Get installation
            installation = await self._get_installation(project_id, package_id)
            if not installation:
                return UninstallResult(
                    success=False,
                    package_id=package_id,
                    message="Package not installed",
                    error="NOT_INSTALLED",
                )

            # Get package for directory name
            package = await self._get_package(package_id)
            if not package:
                return UninstallResult(
                    success=False,
                    package_id=package_id,
                    message="Package not found",
                    error="PACKAGE_NOT_FOUND",
                )

            # Remove package directory
            project_root = self.project_dir_manager.get_project_root(project_id)
            package_dir = project_root / "packages" / package.slug

            if package_dir.exists():
                shutil.rmtree(package_dir)
                logger.info(
                    "package_directory_removed",
                    project_id=project_id,
                    package_id=package_id,
                    path=str(package_dir),
                )

            # Update installation status
            installation.status = InstallationStatus.DISABLED.value
            await self.db.commit()

            return UninstallResult(
                success=True,
                package_id=package_id,
                message=f"Successfully uninstalled {package.name}",
            )

        except Exception as e:
            await self.db.rollback()
            logger.error(
                "package_uninstallation_failed",
                project_id=project_id,
                package_id=package_id,
                error=str(e),
            )
            return UninstallResult(
                success=False,
                package_id=package_id,
                message="Uninstallation failed",
                error=str(e),
            )

    # ========================================================================
    # Helper Methods - Database
    # ========================================================================

    async def _get_package(self, package_id: int) -> Optional[CodePackage]:
        """Get package by ID."""
        result = await self.db.execute(
            select(CodePackage).where(CodePackage.id == package_id)
        )
        return result.scalar_one_or_none()

    async def _get_package_version(self, version_id: int) -> Optional[PackageVersion]:
        """Get package version by ID."""
        result = await self.db.execute(
            select(PackageVersion).where(PackageVersion.id == version_id)
        )
        return result.scalar_one_or_none()

    async def _get_latest_version(self, package_id: int) -> Optional[PackageVersion]:
        """Get latest version for a package."""
        query = (
            select(PackageVersion)
            .where(PackageVersion.package_id == package_id)
            .order_by(PackageVersion.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def _get_installation(
        self, project_id: int, package_id: int
    ) -> Optional[PackageInstallation]:
        """Get package installation record."""
        query = select(PackageInstallation).where(
            PackageInstallation.project_id == project_id,
            PackageInstallation.package_id == package_id,
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def _record_installation(
        self,
        project_id: int,
        package_id: int,
        version_id: int,
        user_id: str,
        installed_path: str,
    ) -> PackageInstallation:
        """Record package installation in database."""
        installation = PackageInstallation(
            project_id=project_id,
            package_id=package_id,
            version_id=version_id,
            user_id=user_id,
            status=InstallationStatus.ACTIVE.value,
            installed_at=datetime.utcnow(),
        )
        self.db.add(installation)
        return installation

    async def _increment_download_count(
        self, package: CodePackage, version: PackageVersion
    ):
        """Increment download counts for package and version."""
        package.total_downloads += 1
        version.download_count += 1

    # ========================================================================
    # Helper Methods - File System
    # ========================================================================

    async def _create_package_directory(
        self, project_id: int, package: CodePackage, version: PackageVersion
    ) -> Path:
        """
        Create package directory structure.

        Creates:
        user_projects/{project_id}/packages/{package_slug}/
        """
        project_root = self.project_dir_manager.ensure_project_directory(project_id)
        packages_dir = project_root / "packages"
        packages_dir.mkdir(exist_ok=True)

        package_dir = packages_dir / package.slug
        if package_dir.exists():
            # Clean existing installation
            shutil.rmtree(package_dir)

        package_dir.mkdir(parents=True)

        return package_dir

    async def _write_package_files(
        self, install_path: Path, version: PackageVersion, package: CodePackage
    ):
        """
        Write package code files to installation directory.

        Creates:
        - main code file (e.g., parser.py)
        - __init__.py (to make importable)
        - README.md (package metadata)
        """
        # Write main code file
        code_file = install_path / f"{version.function_name}.py"
        code_file.write_text(version.code_content)

        # Create __init__.py to export main function
        init_content = f'''"""
{package.name}

{package.description}

Version: {version.version}
Author: {package.author_id}
License: {package.license or 'Not specified'}
"""

from .{version.function_name} import {version.function_name}

__all__ = ["{version.function_name}"]
__version__ = "{version.version}"
'''
        init_file = install_path / "__init__.py"
        init_file.write_text(init_content)

        # Create README with package metadata
        readme_content = f"""# {package.name}

{package.description}

## Version

{version.version}

## Usage

```python
from packages.{package.slug} import {version.function_name}

# Use the function in your workflow
result = {version.function_name}(...)
```

## Dependencies

{self._format_dependencies(version.dependencies)}

## Changelog

{version.changelog or 'No changelog available'}

## License

{package.license or 'Not specified'}

---

*Installed from Qontinui Community Library*
"""
        readme_file = install_path / "README.md"
        readme_file.write_text(readme_content)

    def _format_dependencies(self, dependencies: List[Dict[str, str]]) -> str:
        """Format dependencies list for README."""
        if not dependencies:
            return "No dependencies"

        lines = []
        for dep in dependencies:
            name = dep.get("name", "")
            version = dep.get("version", "")
            lines.append(f"- `{name}{version}`")

        return "\n".join(lines)

    # ========================================================================
    # Helper Methods - Virtual Environment
    # ========================================================================

    async def _ensure_venv(self, project_id: int) -> Path:
        """
        Ensure virtual environment exists for project.

        Creates .venv directory if it doesn't exist.

        Args:
            project_id: Project ID

        Returns:
            Path to virtual environment
        """
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

    # ========================================================================
    # Helper Methods - Dependencies
    # ========================================================================

    def _check_dependency_installed(
        self, name: str, version_spec: str
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if a Python dependency is installed.

        Args:
            name: Package name
            version_spec: Version specification (e.g., ">=2.0.0")

        Returns:
            (is_installed, installed_version)
        """
        try:
            import importlib.metadata

            installed_version = importlib.metadata.version(name)

            # Simple version check (could be improved with packaging library)
            if self._version_satisfies(installed_version, version_spec):
                return True, installed_version
            else:
                return False, installed_version

        except importlib.metadata.PackageNotFoundError:
            return False, None

    def _version_satisfies(self, installed: str, spec: str) -> bool:
        """
        Check if installed version satisfies spec.

        Simple implementation - could use packaging.specifiers for production.

        Args:
            installed: Installed version (e.g., "2.1.0")
            spec: Version spec (e.g., ">=2.0.0")

        Returns:
            True if satisfied
        """
        if not spec:
            return True

        # Extract operator and version
        match = re.match(r"([><=!]+)(.+)", spec)
        if not match:
            return True  # No constraint

        operator, required = match.groups()
        required = required.strip()

        # Simple version comparison (split by dots)
        try:
            installed_parts = [int(x) for x in installed.split(".")]
            required_parts = [int(x) for x in required.split(".")]

            # Pad to same length
            max_len = max(len(installed_parts), len(required_parts))
            installed_parts += [0] * (max_len - len(installed_parts))
            required_parts += [0] * (max_len - len(required_parts))

            if operator == ">=":
                return installed_parts >= required_parts
            elif operator == ">":
                return installed_parts > required_parts
            elif operator == "==":
                return installed_parts == required_parts
            elif operator == "<=":
                return installed_parts <= required_parts
            elif operator == "<":
                return installed_parts < required_parts
            else:
                return True

        except ValueError:
            # If version parsing fails, assume satisfied
            return True

    def _is_newer_version(self, v1: str, v2: str) -> bool:
        """
        Check if v1 is newer than v2.

        Args:
            v1: Version 1 (e.g., "2.0.0")
            v2: Version 2 (e.g., "1.5.0")

        Returns:
            True if v1 > v2
        """
        try:
            v1_parts = [int(x) for x in v1.split(".")]
            v2_parts = [int(x) for x in v2.split(".")]

            # Pad to same length
            max_len = max(len(v1_parts), len(v2_parts))
            v1_parts += [0] * (max_len - len(v1_parts))
            v2_parts += [0] * (max_len - len(v2_parts))

            return v1_parts > v2_parts

        except ValueError:
            return False

    # ========================================================================
    # Helper Methods - Safety Checks
    # ========================================================================

    async def _run_safety_checks(
        self, project_id: int, package: CodePackage, version: PackageVersion
    ) -> SafetyCheckResult:
        """
        Run safety checks before installation.

        Checks:
        - Package passed security scan
        - Sufficient disk space
        - Python version compatibility

        Args:
            project_id: Project ID
            package: Package to install
            version: Version to install

        Returns:
            SafetyCheckResult
        """
        checks: Dict[str, bool] = {}
        errors: List[str] = []
        warnings: List[str] = []

        # Check security scan status
        security_passed = (
            version.security_scan_status == SecurityScanStatus.PASSED.value
        )
        checks["security_scan"] = security_passed
        if not security_passed:
            errors.append(
                f"Package has not passed security scan (status: {version.security_scan_status})"
            )

        # Check disk space
        project_root = self.project_dir_manager.get_project_root(project_id)
        if project_root.exists():
            stat = shutil.disk_usage(project_root)
            has_space = stat.free >= MIN_FREE_DISK_SPACE_BYTES
            checks["disk_space"] = has_space
            if not has_space:
                errors.append(
                    f"Insufficient disk space (free: {stat.free / 1024 / 1024:.1f}MB, required: {MIN_FREE_DISK_SPACE_BYTES / 1024 / 1024:.1f}MB)"
                )
        else:
            checks["disk_space"] = True

        # Check Python version compatibility
        if version.min_python_version:
            current_python = f"{sys.version_info.major}.{sys.version_info.minor}"
            python_compatible = self._version_satisfies(
                current_python, f">={version.min_python_version}"
            )
            checks["python_version"] = python_compatible
            if not python_compatible:
                errors.append(
                    f"Python version incompatible (current: {current_python}, required: >={version.min_python_version})"
                )
        else:
            checks["python_version"] = True

        # Check package size
        code_size = len(version.code_content.encode("utf-8"))
        size_ok = code_size <= MAX_PACKAGE_SIZE_BYTES
        checks["package_size"] = size_ok
        if not size_ok:
            errors.append(
                f"Package too large (size: {code_size / 1024 / 1024:.1f}MB, max: {MAX_PACKAGE_SIZE_BYTES / 1024 / 1024:.1f}MB)"
            )

        passed = all(checks.values())

        return SafetyCheckResult(
            passed=passed, checks=checks, errors=errors, warnings=warnings
        )
