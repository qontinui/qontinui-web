"""
Package installation service.

Provides business logic for installing and managing code packages in projects.
Extracted from crud/code_package.py for SRP compliance.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from app.models.code_package import (CodePackage, PackageInstallation,
                                     PackageVersion)
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)


class PackageInstallationService:
    """
    Service for managing package installations in projects.

    Handles:
    - Installing packages to projects
    - Updating package versions
    - Uninstalling packages
    - Tracking download statistics
    """

    async def install(
        self,
        db: AsyncSession,
        project_id: UUID,
        package_id: int,
        version_id: int,
        user_id: UUID,
    ) -> PackageInstallation:
        """
        Install a package to a project.

        If the package is already installed, updates to the new version.
        Tracks download statistics for both package and version.

        Args:
            db: Database session
            project_id: Project to install to
            package_id: Package to install
            version_id: Version to install
            user_id: User performing the installation

        Returns:
            Installation record
        """
        # Check if already installed
        existing = await self._get_existing_installation(db, project_id, package_id)

        if existing:
            return await self._update_installation(db, existing, version_id)

        return await self._create_installation(
            db, project_id, package_id, version_id, user_id
        )

    async def uninstall(
        self,
        db: AsyncSession,
        project_id: UUID,
        package_id: int,
    ) -> bool:
        """
        Uninstall a package from a project.

        Args:
            db: Database session
            project_id: Project to uninstall from
            package_id: Package to uninstall

        Returns:
            True if uninstalled, False if not found
        """
        installation = await self._get_existing_installation(db, project_id, package_id)

        if not installation:
            return False

        await db.delete(installation)
        await db.commit()

        logger.info(
            "package_uninstalled",
            project_id=str(project_id),
            package_id=package_id,
        )
        return True

    async def get_project_packages(
        self,
        db: AsyncSession,
        project_id: UUID,
    ) -> list[PackageInstallation]:
        """
        Get all packages installed in a project.

        Args:
            db: Database session
            project_id: Project ID

        Returns:
            List of installation records with package and version info
        """
        result = await db.execute(
            select(PackageInstallation)
            .where(PackageInstallation.project_id == project_id)
            .options(
                selectinload(PackageInstallation.package),
                selectinload(PackageInstallation.version),
            )
            .order_by(desc(PackageInstallation.installed_at))
        )
        return list(result.scalars().all())

    async def get_installation(
        self,
        db: AsyncSession,
        project_id: UUID,
        package_id: int,
    ) -> PackageInstallation | None:
        """
        Get a specific installation record.

        Args:
            db: Database session
            project_id: Project ID
            package_id: Package ID

        Returns:
            Installation record or None
        """
        return await self._get_existing_installation(db, project_id, package_id)

    async def is_installed(
        self,
        db: AsyncSession,
        project_id: UUID,
        package_id: int,
    ) -> bool:
        """
        Check if a package is installed in a project.

        Args:
            db: Database session
            project_id: Project ID
            package_id: Package ID

        Returns:
            True if installed
        """
        installation = await self._get_existing_installation(db, project_id, package_id)
        return installation is not None

    async def _get_existing_installation(
        self,
        db: AsyncSession,
        project_id: UUID,
        package_id: int,
    ) -> PackageInstallation | None:
        """Get existing installation if any."""
        result = await db.execute(
            select(PackageInstallation).where(
                and_(
                    PackageInstallation.project_id == project_id,
                    PackageInstallation.package_id == package_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def _update_installation(
        self,
        db: AsyncSession,
        installation: PackageInstallation,
        version_id: int,
    ) -> PackageInstallation:
        """Update an existing installation to a new version."""
        installation.version_id = version_id  # type: ignore[assignment]
        installation.updated_at = datetime.now(UTC)  # type: ignore[assignment]
        installation.status = "active"  # type: ignore[assignment]

        await db.commit()
        await db.refresh(installation)

        logger.info(
            "package_updated",
            installation_id=installation.id,
            project_id=str(installation.project_id),
            package_id=installation.package_id,
            version_id=version_id,
        )
        return installation

    async def _create_installation(
        self,
        db: AsyncSession,
        project_id: UUID,
        package_id: int,
        version_id: int,
        user_id: UUID,
    ) -> PackageInstallation:
        """Create a new installation and update download counts."""
        installation = PackageInstallation(
            project_id=project_id,
            package_id=package_id,
            version_id=version_id,
            user_id=user_id,
            status="active",
        )
        db.add(installation)

        # Update download statistics
        await self._increment_download_counts(db, package_id, version_id)

        await db.commit()
        await db.refresh(installation)

        logger.info(
            "package_installed",
            installation_id=installation.id,
            project_id=str(project_id),
            package_id=package_id,
            version_id=version_id,
        )
        return installation

    async def _increment_download_counts(
        self,
        db: AsyncSession,
        package_id: int,
        version_id: int,
    ) -> None:
        """Increment download counts for package and version."""
        # Increment package total_downloads
        package_result = await db.execute(
            select(CodePackage).where(CodePackage.id == package_id)
        )
        package = package_result.scalar_one_or_none()
        if package:
            package.total_downloads += 1  # type: ignore[assignment]

        # Increment version download_count
        version_result = await db.execute(
            select(PackageVersion).where(PackageVersion.id == version_id)
        )
        version = version_result.scalar_one_or_none()
        if version:
            version.download_count += 1  # type: ignore[assignment]


# Singleton instance for dependency injection
package_installation_service = PackageInstallationService()
