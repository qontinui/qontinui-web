from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.storage_usage import StorageUsage


class StorageService:
    """Service for tracking and managing user storage usage.

    Storage tracking is OSS; quota enforcement is not. Self-host installs are
    unlimited. Cloud-control re-introduces caps via its own middleware.
    """

    @staticmethod
    async def track_upload(
        db: AsyncSession,
        user_id: UUID,
        file_path: str,
        file_size_bytes: int,
        file_type: str,
        project_id: str | None = None,
        metadata: dict | None = None,
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
            metadata: Optional metadata dictionary (stored as JSONB)

        Returns:
            The created StorageUsage record
        """
        storage_record = StorageUsage(
            user_id=user_id,
            file_path=file_path,
            file_size=file_size_bytes,
            file_type=file_type,
            project_id=project_id,
            file_metadata=metadata or {},
            created_at=datetime.now(UTC),
        )
        db.add(storage_record)
        await db.commit()
        await db.refresh(storage_record)
        return storage_record

    @staticmethod
    async def get_user_storage(db: AsyncSession, user_id: UUID) -> dict:
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
        result = await db.execute(
            select(
                func.sum(StorageUsage.file_size).label("total_bytes"),
                func.count(StorageUsage.id).label("files_count"),
            ).filter(StorageUsage.user_id == user_id)
        )
        row = result.one_or_none()

        return {
            "used_bytes": int(row.total_bytes or 0) if row else 0,
            "files_count": int(row.files_count or 0) if row else 0,
        }

    @staticmethod
    async def delete_file_record(
        db: AsyncSession, file_path: str, user_id: UUID
    ) -> bool:
        """
        Delete a storage usage record when a file is removed.

        Args:
            db: Database session
            file_path: Path of the file to remove
            user_id: ID of the user (for security check)

        Returns:
            True if deleted, False if not found
        """
        result = await db.execute(
            select(StorageUsage).filter(
                StorageUsage.file_path == file_path, StorageUsage.user_id == user_id
            )
        )
        record = result.scalar_one_or_none()

        if record:
            await db.delete(record)
            await db.commit()
            return True
        return False

    @staticmethod
    async def get_storage_by_type(db: AsyncSession, user_id: UUID) -> dict:
        """
        Get storage breakdown by file type.

        Args:
            db: Database session
            user_id: ID of the user

        Returns:
            Dictionary mapping file types to bytes used
        """
        result = await db.execute(
            select(
                StorageUsage.file_type,
                func.sum(StorageUsage.file_size).label("total_bytes"),
            )
            .filter(StorageUsage.user_id == user_id)
            .group_by(StorageUsage.file_type)
        )
        rows = result.all()

        return {row.file_type: int(row.total_bytes) for row in rows}

    @staticmethod
    async def update_metadata(
        db: AsyncSession,
        file_path: str,
        user_id: UUID,
        metadata: dict,
    ) -> bool:
        """
        Update metadata for a storage record.

        Args:
            db: Database session
            file_path: Path of the file
            user_id: ID of the user (for security check)
            metadata: New metadata dictionary to merge with existing

        Returns:
            True if updated, False if not found
        """
        result = await db.execute(
            select(StorageUsage).filter(
                StorageUsage.file_path == file_path, StorageUsage.user_id == user_id
            )
        )
        record = result.scalar_one_or_none()

        if record:
            # Merge metadata (update existing keys, add new ones)
            current_metadata: dict[Any, Any] = record.file_metadata or {}  # type: ignore[assignment]
            current_metadata.update(metadata)
            record.file_metadata = current_metadata  # type: ignore[assignment]
            await db.commit()
            return True
        return False
