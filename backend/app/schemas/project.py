from typing import Any
from uuid import UUID

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime


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
    id: str  # Project ID (UUID in production database)
    owner_id: UUID  # Changed from int to UUID to match fastapi-users User model
    created_at: IsoDatetime  # Serializes to ISO 8601 format
    updated_at: IsoDatetime  # Serializes to ISO 8601 format


class Project(ProjectInDBBase):
    pass
