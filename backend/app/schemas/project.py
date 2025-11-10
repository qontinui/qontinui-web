from typing import Annotated, Any
from uuid import UUID

from pydantic.functional_serializers import PlainSerializer

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

# Custom type that accepts UUID and serializes to string
UuidAsString = Annotated[
    UUID | str,
    PlainSerializer(lambda v: str(v) if v else None, return_type=str),
]


class ProjectBase(BaseSchema):
    name: str
    description: str | None = None
    configuration: dict[str, Any] = {}


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseSchema):
    name: str | None = None
    description: str | None = None
    configuration: dict[str, Any] | None = None


class ProjectInDBBase(ProjectBase, BaseORMSchema):
    id: UuidAsString  # Project ID (UUID in production database, serialized as string)
    owner_id: UuidAsString  # Owner UUID (serialized as string)
    created_at: IsoDatetime  # Serializes to ISO 8601 format
    updated_at: IsoDatetime  # Serializes to ISO 8601 format


class Project(ProjectInDBBase):
    pass
