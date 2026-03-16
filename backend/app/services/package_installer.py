"""
Package Installation Service.

Orchestrates package installation by coordinating specialized services:
- PackageDependencyResolver: Dependency resolution and version compatibility
- PackageValidator: Security and compatibility validation
- PackageDownloadService: File writing and virtual environment management

This service maintains backward compatibility while delegating to focused services.
"""

from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.code_package import (
    CodePackage,
    InstallationStatus,
    PackageInstallation,
    PackageVersion,
)
from app.schemas.package import (
    DependencyResolutionResult,
    InstallResult,
    UninstallResult,
    UpdateInfo,
    UpdateResult,
)
from app.services.package_dependency_resolver import (
    PackageDependencyResolver,
    package_dependency_resolver,
)
from app.services.package_download_service import (
    PackageDownloadService,
    package_download_service,
)
from app.services.package_validator import PackageValidator, package_validator
from app.services.project_directory import ProjectDirectoryManager

logger = structlog.get_logger(__name__)


class PackageInstaller:
    """
    Orchestrator service for installing and managing community packages.

    This is a facade that coordinates the specialized services:
    - PackageDependencyResolver: Handles dependency resolution
    - PackageValidator: Handles security and compatibility checks
    - PackageDownloadService: Handles file operations and venv management
    """

    def __init__(
        self,
        db_session: AsyncSession,
        project_dir_manager: ProjectDirectoryManager | None = None,
        dependency_resolver: PackageDependencyResolver | None = None,
        validator: PackageValidator | None = None,
        download_service: PackageDownloadService | None = None,
    ):
        """
        Initialize package installer.

        Args:
            db_session: Database session for queries
            project_dir_manager: Optional project directory manager
            dependency_resolver: Optional dependency resolver (uses singleton if not provided)
            validator: Optional package validator (uses singleton if not provided)
            download_service: Optional download service (uses singleton if not provided)
        """
        self.db = db_session
        self.project_dir_manager = project_dir_manager or ProjectDirectoryManager()

        # Inject services or use singletons
        self.dependency_resolver = dependency_resolver or package_dependency_resolver
        self.validator = validator or package_validator
        self.download_service = download_service or package_download_service

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

            # 2. Run safety checks (delegated to validator)
            safety_result = await self.validator.run_safety_checks(
                project_id, package, version
            )
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

            # 4. Create package directory (delegated to download service)
            install_path = await self.download_service.create_package_directory(
                project_id, package, version
            )

            # 5. Write package code files (delegated to download service)
            await self.download_service.write_package_files(
                install_path, version, package
            )

            # 6. Record installation in database
            await self._record_installation(
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
    # Dependency Management (delegated to PackageDependencyResolver)
    # ========================================================================

    async def resolve_dependencies(
        self, dependencies: list[dict[str, str]]
    ) -> DependencyResolutionResult:
        """
        Resolve package dependencies.

        Delegates to PackageDependencyResolver.

        Args:
            dependencies: List of dependency specifications

        Returns:
            DependencyResolutionResult with required and missing dependencies
        """
        return self.dependency_resolver.resolve_dependencies(dependencies)

    async def install_dependencies(
        self, project_id: int, dependencies: list[str]
    ) -> bool:
        """
        Install missing dependencies for a package.

        Delegates to PackageDownloadService.

        Args:
            project_id: Project ID
            dependencies: List of pip package specs

        Returns:
            True if installation succeeded
        """
        return await self.download_service.install_pip_dependencies(
            project_id, dependencies
        )

    # ========================================================================
    # Updates
    # ========================================================================

    async def check_updates(self, project_id: int) -> list[UpdateInfo]:
        """
        Check for available package updates.

        Compares installed versions with latest versions
        Returns packages that have updates

        Args:
            project_id: Project ID to check

        Returns:
            List of UpdateInfo for packages with available updates
        """
        updates: list[UpdateInfo] = []

        # Get all active installations for project
        query = select(PackageInstallation).where(
            PackageInstallation.project_id == project_id,
            PackageInstallation.status == InstallationStatus.ACTIVE.value,
        )
        result = await self.db.execute(query)
        installations = result.scalars().all()

        for installation in installations:
            # Get current version
            version_id: int = installation.version_id  # type: ignore[assignment]
            current_version = await self._get_package_version(version_id)
            if not current_version:
                continue

            # Get latest version for this package
            package_id: int = installation.package_id  # type: ignore[assignment]
            latest_version = await self._get_latest_version(package_id)
            if not latest_version:
                continue

            # Compare versions using dependency resolver
            latest_ver_str: str = latest_version.version  # type: ignore[assignment]
            current_ver_str: str = current_version.version  # type: ignore[assignment]
            if self.dependency_resolver.is_newer_version(
                latest_ver_str, current_ver_str
            ):
                package = await self._get_package(package_id)
                if package:
                    pkg_id: int = package.id  # type: ignore[assignment]
                    pkg_name: str = package.name  # type: ignore[assignment]
                    changelog: str | None = latest_version.changelog  # type: ignore[assignment]
                    updates.append(
                        UpdateInfo(
                            package_id=pkg_id,
                            package_name=pkg_name,
                            current_version=current_ver_str,
                            latest_version=latest_ver_str,
                            changelog=changelog,
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
            version_id: int = installation.version_id  # type: ignore[assignment]
            old_version = await self._get_package_version(version_id)
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
            old_ver_str: str = old_version.version  # type: ignore[assignment]
            if not latest_version:
                return UpdateResult(
                    success=False,
                    package_id=package_id,
                    old_version=old_ver_str,
                    new_version="",
                    message="No updates available",
                    error="NO_UPDATES",
                )

            # Check if already on latest
            new_ver_str: str = latest_version.version  # type: ignore[assignment]
            latest_ver_id: int = latest_version.id  # type: ignore[assignment]
            if latest_ver_id == old_version.id:
                return UpdateResult(
                    success=True,
                    package_id=package_id,
                    old_version=old_ver_str,
                    new_version=new_ver_str,
                    message="Already on latest version",
                )

            # Uninstall old version
            await self.uninstall_package(project_id, package_id)

            # Install new version
            install_result = await self.install_package(
                project_id, package_id, latest_ver_id, user_id
            )

            if not install_result.success:
                return UpdateResult(
                    success=False,
                    package_id=package_id,
                    old_version=old_ver_str,
                    new_version=new_ver_str,
                    message="Update failed",
                    error=install_result.error,
                )

            return UpdateResult(
                success=True,
                package_id=package_id,
                old_version=old_ver_str,
                new_version=new_ver_str,
                message=f"Updated from {old_ver_str} to {new_ver_str}",
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

            # Remove package directory (delegated to download service)
            await self.download_service.remove_package_directory(project_id, package)

            # Update installation status
            new_status: str = InstallationStatus.DISABLED.value
            installation.status = new_status  # type: ignore[assignment]
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

    async def _get_package(self, package_id: int) -> CodePackage | None:
        """Get package by ID."""
        result = await self.db.execute(
            select(CodePackage).where(CodePackage.id == package_id)
        )
        return result.scalar_one_or_none()

    async def _get_package_version(self, version_id: int) -> PackageVersion | None:
        """Get package version by ID."""
        result = await self.db.execute(
            select(PackageVersion).where(PackageVersion.id == version_id)
        )
        return result.scalar_one_or_none()

    async def _get_latest_version(self, package_id: int) -> PackageVersion | None:
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
    ) -> PackageInstallation | None:
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
            installed_at=datetime.now(UTC),
        )
        self.db.add(installation)
        return installation

    async def _increment_download_count(
        self, package: CodePackage, version: PackageVersion
    ) -> None:
        """Increment download counts for package and version."""
        current_pkg_downloads: int = package.total_downloads  # type: ignore[assignment]
        package.total_downloads = current_pkg_downloads + 1  # type: ignore[assignment]
        current_ver_downloads: int = version.download_count  # type: ignore[assignment]
        version.download_count = current_ver_downloads + 1  # type: ignore[assignment]
