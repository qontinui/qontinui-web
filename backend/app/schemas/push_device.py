"""Schemas for push device registration."""

from typing import Annotated

from pydantic import Field
from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import BeforeValidator

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

UuidAsString = Annotated[
    str,
    BeforeValidator(lambda v: str(v) if v is not None else None),
    PlainSerializer(lambda v: str(v) if v is not None else None, return_type=str),
]


class PushDeviceRegister(BaseSchema):
    """Schema for registering a push device token."""

    push_token: str = Field(..., max_length=255)
    platform: str = Field("expo", max_length=50)
    device_name: str | None = Field(None, max_length=255)


class PushDeviceResponse(BaseORMSchema):
    """Schema for push device in API responses."""

    id: UuidAsString
    user_id: UuidAsString
    push_token: str
    platform: str
    device_name: str | None = None
    is_active: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime
