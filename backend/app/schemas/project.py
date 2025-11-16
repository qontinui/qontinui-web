from typing import Annotated, Any
from uuid import UUID

from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import BeforeValidator

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

# Custom type that accepts int, UUID, or str and serializes to string
# The BeforeValidator converts any input to string first, then PlainSerializer ensures string output
UuidAsString = Annotated[
    str,
    BeforeValidator(lambda v: str(v) if v is not None else None),
    PlainSerializer(lambda v: str(v) if v is not None else None, return_type=str),
]


class ProjectBase(BaseSchema):
    name: str
    description: str | None = None
    configuration: dict[str, Any] = {}


class ProjectCreate(ProjectBase):
    organization_id: UUID | None = None


class ProjectUpdate(BaseSchema):
    name: str | None = None
    description: str | None = None
    configuration: dict[str, Any] | None = None


class ProjectInDBBase(ProjectBase, BaseORMSchema):
    id: UuidAsString  # Project ID (UUID in production database, serialized as string)
    owner_id: UuidAsString  # Owner UUID (serialized as string)
    organization_id: UuidAsString | None = None  # Organization UUID (serialized as string)
    created_at: IsoDatetime  # Serializes to ISO 8601 format
    updated_at: IsoDatetime  # Serializes to ISO 8601 format


class Project(ProjectInDBBase):
    pass
