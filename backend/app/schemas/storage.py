from datetime import datetime

from pydantic import BaseModel


class StorageUsageBase(BaseModel):
    """Base schema for storage usage."""

    file_path: str
    file_type: str
    file_size: int
    project_id: int | None = None


class StorageUsageCreate(StorageUsageBase):
    """Schema for creating a storage usage record."""

    pass


class StorageUsageResponse(StorageUsageBase):
    """Schema for storage usage response."""

    id: int
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class StorageQuotaResponse(BaseModel):
    """Schema for storage quota information."""

    used_bytes: int
    quota_bytes: int
    percentage_used: float
    files_count: int

    class Config:
        from_attributes = True


class StorageBreakdownResponse(BaseModel):
    """Schema for storage breakdown by type."""

    breakdown_by_type: dict[str, int]
    total_bytes: int
    files_count: int

    class Config:
        from_attributes = True
