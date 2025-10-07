from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.storage_usage import StorageUsage


class StorageQuotaExceeded(HTTPException):
    """Exception raised when storage quota is exceeded."""

    def __init__(self, used_bytes: int, quota_bytes: int):
        detail = (
            f"Storage quota exceeded. "
            f"Used: {used_bytes / (1024*1024):.2f}MB, "
            f"Quota: {quota_bytes / (1024*1024):.2f}MB"
        )
        super().__init__(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=detail
        )


class StorageService:
    """Service for tracking and managing user storage usage."""

    # Storage quotas by subscription tier (in bytes)
    STORAGE_QUOTAS = {
        "free": 25 * 1024 * 1024,  # 25MB
        "hobby": 200 * 1024 * 1024,  # 200MB
        "pro": 2 * 1024 * 1024 * 1024,  # 2GB
    }

    @staticmethod
    def get_quota_for_tier(tier: str) -> int:
        """Get storage quota in bytes for a subscription tier."""
        return StorageService.STORAGE_QUOTAS.get(
            tier, StorageService.STORAGE_QUOTAS["free"]
        )

    @staticmethod
    def track_upload(
        db: Session,
        user_id: int,
        file_path: str,
        file_size_bytes: int,
        file_type: str,
        project_id: int | None = None,
    ) -> StorageUsage:
        """
        Track a file upload in the storage_usage table.

        Args:
            db: Database session
            user_id: ID of the user uploading the file
            file_path: Path where the file is stored
            file_size_bytes: Size of the file in bytes
            file_type: Type of file (e.g., "image", "screenshot", "export")
            project_id: Optional project ID the file belongs to

        Returns:
            The created StorageUsage record
        """
        storage_record = StorageUsage(
            user_id=user_id,
            file_path=file_path,
            file_size=file_size_bytes,
            file_type=file_type,
            project_id=project_id,
            created_at=datetime.utcnow(),
        )
        db.add(storage_record)
        db.commit()
        db.refresh(storage_record)
        return storage_record

    @staticmethod
    def get_user_storage(db: Session, user_id: int) -> dict:
        """
        Calculate total storage usage for a user.

        Args:
            db: Database session
            user_id: ID of the user

        Returns:
            Dictionary with storage statistics:
            - used_bytes: Total bytes used
            - files_count: Number of files
        """
        result = (
            db.query(
                func.sum(StorageUsage.file_size).label("total_bytes"),
                func.count(StorageUsage.id).label("files_count"),
            )
            .filter(StorageUsage.user_id == user_id)
            .first()
        )

        return {
            "used_bytes": int(result.total_bytes or 0),
            "files_count": int(result.files_count or 0),
        }

    @staticmethod
    def check_quota(
        db: Session, user_id: int, subscription_tier: str, additional_bytes: int = 0
    ) -> dict:
        """
        Check if user is within storage quota.

        Args:
            db: Database session
            user_id: ID of the user
            subscription_tier: User's subscription tier
            additional_bytes: Additional bytes to check (for new upload)

        Returns:
            Dictionary with quota information:
            - used_bytes: Current bytes used
            - quota_bytes: Total quota in bytes
            - percentage_used: Percentage of quota used
            - files_count: Number of files
            - within_quota: Boolean indicating if within quota

        Raises:
            StorageQuotaExceeded: If the additional bytes would exceed quota
        """
        storage_info = StorageService.get_user_storage(db, user_id)
        quota_bytes = StorageService.get_quota_for_tier(subscription_tier)
        used_bytes = storage_info["used_bytes"]
        total_with_new = used_bytes + additional_bytes

        # Check if adding new file would exceed quota
        if additional_bytes > 0 and total_with_new > quota_bytes:
            raise StorageQuotaExceeded(
                used_bytes=total_with_new, quota_bytes=quota_bytes
            )

        percentage_used = (used_bytes / quota_bytes * 100) if quota_bytes > 0 else 0

        return {
            "used_bytes": used_bytes,
            "quota_bytes": quota_bytes,
            "percentage_used": round(percentage_used, 2),
            "files_count": storage_info["files_count"],
            "within_quota": used_bytes <= quota_bytes,
        }

    @staticmethod
    def delete_file_record(db: Session, file_path: str, user_id: int) -> bool:
        """
        Delete a storage usage record when a file is removed.

        Args:
            db: Database session
            file_path: Path of the file to remove
            user_id: ID of the user (for security check)

        Returns:
            True if deleted, False if not found
        """
        record = (
            db.query(StorageUsage)
            .filter(
                StorageUsage.file_path == file_path, StorageUsage.user_id == user_id
            )
            .first()
        )

        if record:
            db.delete(record)
            db.commit()
            return True
        return False

    @staticmethod
    def get_storage_by_type(db: Session, user_id: int) -> dict:
        """
        Get storage breakdown by file type.

        Args:
            db: Database session
            user_id: ID of the user

        Returns:
            Dictionary mapping file types to bytes used
        """
        results = (
            db.query(
                StorageUsage.file_type,
                func.sum(StorageUsage.file_size).label("total_bytes"),
            )
            .filter(StorageUsage.user_id == user_id)
            .group_by(StorageUsage.file_type)
            .all()
        )

        return {row.file_type: int(row.total_bytes) for row in results}
