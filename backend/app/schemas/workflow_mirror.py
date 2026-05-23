"""Pydantic schemas for the runner-authored workflow mirror.

See ``app/models/workflow_mirror.py`` for the table layout and Phase 3 of
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``
for the architecture.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WorkflowMirrorRead(BaseModel):
    """List-response shape — definition is omitted to keep the payload light."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    category: str | None = None
    runner_updated_at: datetime
    mirrored_at: datetime


class WorkflowMirrorReadFull(WorkflowMirrorRead):
    """Detail-response shape — includes the full UnifiedWorkflow payload."""

    definition: dict[str, Any]


class WorkflowMirrorSyncIn(BaseModel):
    """Runner write-through payload.

    The runner submits this on every successful local SQLite mutation.
    Tenancy (``tenant_id`` + ``owner_user_id``) is NOT accepted from the
    body — it's resolved server-side from the device JWT.

    ``deleted=True`` signals that the local row was removed; the mirror
    row is soft-deleted (DELETE) to match.
    """

    id: UUID
    name: str = ""
    category: str | None = None
    definition: dict[str, Any] = Field(default_factory=dict)
    runner_updated_at: datetime
    deleted: bool = False
