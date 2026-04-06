"""Schemas for push device registration."""

from typing import Annotated

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

    push_token: str
    platform: str = "expo"
    device_name: str | None = None


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
