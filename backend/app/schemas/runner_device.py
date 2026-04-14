from typing import Annotated
from uuid import UUID

from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import BeforeValidator

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

# Custom type that accepts int, UUID, or str and serializes to string
UuidAsString = Annotated[
    str,
    BeforeValidator(lambda v: str(v) if v is not None else None),
    PlainSerializer(lambda v: str(v) if v is not None else None, return_type=str),
]


class RunnerDeviceBase(BaseSchema):
    """Base schema for runner device"""

    device_id: str
    device_name: str
    platform: str


class RunnerDeviceRegister(RunnerDeviceBase):
    """Schema for registering a new runner device"""

    pass


class RunnerDeviceUpdate(BaseSchema):
    """Schema for updating a runner device"""

    device_name: str | None = None
    is_active: bool | None = None


class RunnerDeviceHeartbeat(BaseSchema):
    """Schema for device heartbeat"""

    project_id: UUID | None = None


class RunnerDeviceInDBBase(RunnerDeviceBase, BaseORMSchema):
    """Schema for runner device in database"""

    id: UuidAsString
    user_id: UuidAsString
    last_seen_at: IsoDatetime | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime
    is_active: bool


class RunnerDevice(RunnerDeviceInDBBase):
    """Full runner device schema"""

    pass


class RunnerDeviceHeartbeatResponse(BaseSchema):
    """Response schema for device heartbeat"""

    message: str
    has_active_connection: bool


class RunnerDeviceConnectionInfo(BaseSchema):
    """Connection information for a runner device"""

    device_id: str
    websocket_url: str
    http_url: str
    user_id: str
    is_active: bool
