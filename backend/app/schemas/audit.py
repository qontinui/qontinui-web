"""
Pydantic schemas for audit log API responses.

Provides schemas for:
- Individual audit log entries
- Audit log lists with filtering
- Audit log statistics
"""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AuditLogBase(BaseModel):
    """Base audit log schema with common fields."""

    action: str = Field(..., description="Action performed")
    resource_type: Optional[str] = Field(None, description="Type of resource affected")
    resource_id: Optional[str] = Field(None, description="ID of the resource affected")
    event_category: Optional[str] = Field(None, description="Event category (e.g., permission_change)")
    log_metadata: Optional[dict[str, Any]] = Field(None, description="Additional metadata")
    ip_address: Optional[str] = Field(None, description="IP address of the actor")


class AuditLogCreate(AuditLogBase):
    """Schema for creating audit logs (internal use)."""

    user_id: Optional[UUID] = Field(None, description="User who performed the action")
    target_user_id: Optional[UUID] = Field(None, description="User affected by the action")
    changes: Optional[dict[str, Any]] = Field(None, description="Before/after state")
    correlation_id: Optional[str] = Field(None, description="Request correlation ID")


class AuditLogResponse(AuditLogBase):
    """Schema for audit log API responses."""

    id: int = Field(..., description="Audit log ID")
    user_id: Optional[UUID] = Field(None, description="User who performed the action")
    target_user_id: Optional[UUID] = Field(None, description="User affected by the action")
    changes: Optional[dict[str, Any]] = Field(None, description="Before/after state")
    correlation_id: Optional[str] = Field(None, description="Request correlation ID")
    created_at: datetime = Field(..., description="When the event occurred")

    # Optional enriched data (populated by endpoint)
    user_email: Optional[str] = Field(None, description="Email of user who performed action")
    user_username: Optional[str] = Field(None, description="Username of user who performed action")
    target_user_email: Optional[str] = Field(None, description="Email of user affected by action")
    target_user_username: Optional[str] = Field(None, description="Username of user affected by action")

    model_config = ConfigDict(from_attributes=True)


class AuditLogListResponse(BaseModel):
    """Schema for paginated audit log list responses."""

    total: int = Field(..., description="Total number of audit logs matching filters")
    logs: list[AuditLogResponse] = Field(..., description="List of audit logs")
    skip: int = Field(..., description="Number of records skipped")
    limit: int = Field(..., description="Maximum number of records returned")


class AuditLogStatsResponse(BaseModel):
    """Schema for audit log statistics."""

    total_events: int = Field(..., description="Total number of audit events")
    events_by_category: dict[str, int] = Field(..., description="Count by event category")
    events_by_action: dict[str, int] = Field(..., description="Count by action")
    recent_events_24h: int = Field(..., description="Events in last 24 hours")
    recent_events_7d: int = Field(..., description="Events in last 7 days")
    top_users: list[dict[str, Any]] = Field(..., description="Most active users")


class AuditLogFilters(BaseModel):
    """Schema for audit log filtering parameters."""

    user_id: Optional[UUID] = Field(None, description="Filter by user who performed action")
    target_user_id: Optional[UUID] = Field(None, description="Filter by user affected by action")
    action: Optional[str] = Field(None, description="Filter by action")
    resource_type: Optional[str] = Field(None, description="Filter by resource type")
    resource_id: Optional[str] = Field(None, description="Filter by resource ID")
    event_category: Optional[str] = Field(None, description="Filter by event category")
    correlation_id: Optional[str] = Field(None, description="Filter by correlation ID")
    start_date: Optional[datetime] = Field(None, description="Filter events after this date")
    end_date: Optional[datetime] = Field(None, description="Filter events before this date")
    skip: int = Field(0, ge=0, description="Number of records to skip")
    limit: int = Field(100, ge=1, le=1000, description="Maximum number of records to return")
