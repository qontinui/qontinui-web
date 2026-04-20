"""Schemas for sync lock operations."""

from pydantic import Field

from app.schemas.base import BaseSchema, IsoDatetime


class SyncLockRequest(BaseSchema):
    """Request to acquire a sync lock."""

    operation: str = Field(
        ...,
        description="Description of the operation (e.g., 'import_states', 'bulk_update')",
        max_length=100,
    )
    ttl_seconds: int = Field(
        default=300,
        ge=10,
        le=3600,
        description="Lock TTL in seconds (10-3600)",
    )


class SyncLockResponse(BaseSchema):
    """Response from sync lock operations."""

    lock_id: str = Field(..., description="Unique lock identifier")
    operation: str = Field(..., description="Operation description")
    user_id: str = Field(..., description="User who acquired the lock")
    project_id: str = Field(..., description="Project ID")
    acquired_at: IsoDatetime = Field(..., description="When the lock was acquired")
    expires_at: IsoDatetime = Field(..., description="When the lock expires")
    new_version: int | None = Field(
        None, description="New project version after lock release"
    )


class SyncLockReleaseRequest(BaseSchema):
    """Request to release a sync lock."""

    success: bool = Field(
        default=True, description="Whether the operation completed successfully"
    )
    error_message: str | None = Field(
        None, description="Error message if operation failed"
    )


class ActiveLockInfo(BaseSchema):
    """Information about an active lock on a project."""

    lock_id: str
    operation: str
    user_id: str
    user_email: str | None = None
    acquired_at: IsoDatetime
    expires_at: IsoDatetime


class SyncWebSocketEvent(BaseSchema):
    """Base schema for WebSocket sync events."""

    type: str


class LockAcquiredEvent(SyncWebSocketEvent):
    """Event when a lock is acquired."""

    type: str = "LOCK_ACQUIRED"
    lock_id: str
    operation: str
    user_id: str


class LockReleasedEvent(SyncWebSocketEvent):
    """Event when a lock is released."""

    type: str = "LOCK_RELEASED"
    lock_id: str
    new_version: int


class VersionUpdatedEvent(SyncWebSocketEvent):
    """Event when project version is updated."""

    type: str = "VERSION_UPDATED"
    version: int
    source: str  # e.g., "save", "import", "external"


class ConflictEvent(SyncWebSocketEvent):
    """Event when a version conflict is detected."""

    type: str = "CONFLICT"
    local_version: int
    server_version: int
