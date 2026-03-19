"""
Base schema classes with consistent datetime serialization.

All Pydantic schemas should inherit from these base classes to ensure
datetimes are serialized in ISO 8601 format compatible with Zod validation.
"""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict
from pydantic.functional_serializers import PlainSerializer


def _serialize_datetime_to_iso_utc(v: datetime | None) -> str | None:
    """Serialize a datetime to ISO 8601 with 'Z' suffix.

    If the datetime is timezone-aware, convert to UTC first.
    If naive, assume it is already UTC.
    """
    if v is None:
        return None
    if v.tzinfo is not None:
        v = v.astimezone(UTC)
    return v.replace(tzinfo=None).isoformat() + "Z"


# Custom datetime type that serializes to ISO 8601 with UTC timezone indicator.
# Converts timezone-aware datetimes to UTC before serializing, so the output
# is always a correct UTC timestamp with "Z" suffix.
IsoDatetime = Annotated[
    datetime,
    PlainSerializer(
        _serialize_datetime_to_iso_utc,
        return_type=str,
    ),
]


class BaseSchema(BaseModel):
    """
    Base schema class with consistent datetime serialization.

    Ensures all datetime fields are serialized as ISO 8601 strings with UTC
    timezone indicator (e.g., "2025-10-15T13:59:33.674328Z") which is
    compatible with Zod's datetime validation in the frontend.
    """

    pass


class BaseORMSchema(BaseSchema):
    """
    Base schema for ORM models with datetime serialization.

    Use this for schemas that are populated from SQLAlchemy models.
    """

    model_config = ConfigDict(
        from_attributes=True,
    )
