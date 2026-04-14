"""
Pydantic schemas for device sessions.
"""

from uuid import UUID

from app.schemas.base import IsoDatetime
from pydantic import BaseModel


class DeviceSessionBase(BaseModel):
    """Base device session schema."""

    device_fingerprint: str
    ip_address: str
    user_agent: str
    accept_language: str | None = None
    is_trusted: bool = False
    device_name: str | None = None


class DeviceSessionCreate(DeviceSessionBase):
    """Schema for creating a device session."""

    pass


class DeviceSessionUpdate(BaseModel):
    """Schema for updating a device session."""

    is_trusted: bool | None = None
    device_name: str | None = None


class DeviceSessionRead(DeviceSessionBase):
    """Schema for reading a device session."""

    id: UUID
    user_id: UUID
    first_seen: IsoDatetime
    last_seen: IsoDatetime
    last_ip: str
    created_at: IsoDatetime
    updated_at: IsoDatetime

    class Config:
        from_attributes = True


class DeviceSessionSummary(BaseModel):
    """
    Simplified device session schema for user-facing API.

    Hides sensitive information like device fingerprint.
    """

    id: UUID
    device_name: str | None = None
    user_agent: str
    ip_address: str
    last_ip: str
    is_trusted: bool
    email_verified: bool
    country: str | None = None
    city: str | None = None
    first_seen: IsoDatetime
    last_seen: IsoDatetime

    class Config:
        from_attributes = True
