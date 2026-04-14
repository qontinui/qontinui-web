"""
Package publishing service.

Provides business logic for publishing packages and versions with security scanning.
Extracted from code_packages.py for SRP compliance.
"""

from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import code_package as crud
from app.models.code_package import CodePackage, PackageVersion, SecurityScanStatus
from app.schemas.code_package import PackageCreate, PackageUpdate, VersionCreate
from app.services.code_security import CodeSecurityScanner, SecurityStatus

logger = structlog.get_logger(__name__)


class PackageNotFoundError(Exception):
    """Raised when a package is not found."""


class PackageOwnershipError(Exception):
    """Raised when user doesn't own the package."""


class SecurityScanFailedError(Exception):
    """Raised when security scan fails for a version."""

    def __init__(self, message: str, scan_result: dict):
        super().__init__(message)
        self.scan_result = scan_result


class PackagePublishingService:
    """
    Service for package publishing operations.

    Handles:
    - Creating new packages
    - Publishing new versions with security scanning
    - Updating and deleting packages
    """

    async def create_package(
        self,
        db: AsyncSession,
        user_id: UUID,
        package_data: PackageCreate,
    ) -> CodePackage:
        """
        Create a new package.

        Args:
            db: Database session
            user_id: ID of the user creating the package
            package_data: Package creation data

        Returns:
            Created CodePackage

        Raises:
            Exception: If package name already exists
        """
        package = await crud.create_package(db, user_id, package_data)
        logger.info("package_created", package_id=package.id, user_id=str(user_id))
        return package

    async def get_package_with_ownership(
        self,
        db: AsyncSession,
        package_id: int,
        user_id: UUID,
    ) -> CodePackage:
        """
        Get package and verify ownership.

        Args:
            db: Database session
            package_id: Package ID
            user_id: User ID to verify ownership

        Returns:
            CodePackage if found and owned by user

        Raises:
            PackageNotFoundError: Package not found
            PackageOwnershipError: User doesn't own the package
        """
        package = await crud.get_package_by_id(db, package_id)
        if not package:
            raise PackageNotFoundError(f"Package {package_id} not found")

        if package.author_id != user_id:
            raise PackageOwnershipError(
                f"User {user_id} doesn't own package {package_id}"
            )

        return package

    async def publish_version(
        self,
        db: AsyncSession,
        package_id: int,
        version_data: VersionCreate,
        user_id: UUID,
    ) -> PackageVersion:
        """
        Publish a new version of a package with security scanning.

        Args:
            db: Database session
            package_id: Package ID
            version_data: Version creation data
            user_id: User ID for ownership verification

        Returns:
            Created PackageVersion

        Raises:
            PackageNotFoundError: Package not found
            PackageOwnershipError: User doesn't own the package
            SecurityScanFailedError: Security scan failed
            ValueError: Version already exists
        """
        # Verify ownership
        package = await self.get_package_with_ownership(db, package_id, user_id)

        # Create version with PENDING security status
        version = await crud.publish_version(db, package_id, version_data)

        # Run security scan
        scanner = CodeSecurityScanner()
        scan_result = scanner.scan_code(
            version_data.code_content, verified=bool(package.is_verified)
        )

        # Update version with scan results
        scan_status_map = {
            SecurityStatus.PASSED: SecurityScanStatus.PASSED.value,
            SecurityStatus.WARNING: SecurityScanStatus.PASSED.value,  # Allow with warnings
            SecurityStatus.FAILED: SecurityScanStatus.FAILED.value,
        }

        version = await crud.update_version_security_scan(
            db,
            version,
            scan_status_map[scan_result.status],
            scan_result.model_dump(),
        )

        # Reject if security scan failed
        if scan_result.status == SecurityStatus.FAILED:
            logger.warning(
                "version_publish_rejected",
                package_id=package_id,
                version_id=version.id,
                user_id=str(user_id),
                risk_score=scan_result.risk_score,
            )
            raise SecurityScanFailedError(
                "Security scan failed - version cannot be published",
                scan_result.model_dump(),
            )

        # Log warning if has warnings
        if scan_result.status == SecurityStatus.WARNING:
            logger.info(
                "version_published_with_warnings",
                package_id=package_id,
                version_id=version.id,
                user_id=str(user_id),
                warnings_count=len(
                    [i for i in scan_result.issues if i.severity.value == "medium"]
                ),
            )

        logger.info(
            "version_published",
            package_id=package_id,
            version_id=version.id,
            version=version.version,
            user_id=str(user_id),
        )
        return version

    async def update_package(
        self,
        db: AsyncSession,
        package_id: int,
        update_data: PackageUpdate,
        user_id: UUID,
    ) -> CodePackage:
        """
        Update package metadata.

        Args:
            db: Database session
            package_id: Package ID
            update_data: Update data
            user_id: User ID for ownership verification

        Returns:
            Updated CodePackage

        Raises:
            PackageNotFoundError: Package not found
            PackageOwnershipError: User doesn't own the package
        """
        package = await self.get_package_with_ownership(db, package_id, user_id)
        package = await crud.update_package(db, package, update_data)
        logger.info("package_updated", package_id=package_id, user_id=str(user_id))
        return package

    async def delete_package(
        self,
        db: AsyncSession,
        package_id: int,
        user_id: UUID,
    ) -> None:
        """
        Delete a package.

        Args:
            db: Database session
            package_id: Package ID
            user_id: User ID for ownership verification

        Raises:
            PackageNotFoundError: Package not found
            PackageOwnershipError: User doesn't own the package
        """
        package = await self.get_package_with_ownership(db, package_id, user_id)
        await crud.delete_package(db, package)
        logger.info("package_deleted", package_id=package_id, user_id=str(user_id))


# Singleton instance for dependency injection
package_publishing_service = PackagePublishingService()
