"""Schemas for workflow event ingestion and retrieval."""

from datetime import datetime
from typing import Annotated, Any

from pydantic.functional_serializers import PlainSerializer
from pydantic.functional_validators import BeforeValidator

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

UuidAsString = Annotated[
    str,
    BeforeValidator(lambda v: str(v) if v is not None else None),
    PlainSerializer(lambda v: str(v) if v is not None else None, return_type=str),
]


class WorkflowEventCreate(BaseSchema):
    """Schema for creating a workflow event (sent by runner)."""

    event_type: str
    device_id: str
    runner_name: str
    run_id: str | None = None
    summary: str
    payload: dict[str, Any] | None = None
    timestamp: datetime


class WorkflowEventResponse(BaseORMSchema):
    """Schema for workflow event in API responses."""

    id: UuidAsString
    user_id: UuidAsString
    event_type: str
    device_id: str
    runner_name: str
    run_id: str | None = None
    summary: str
    payload: dict[str, Any] | None = None
    seen: bool
    timestamp: IsoDatetime
    created_at: IsoDatetime
