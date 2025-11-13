"""
Pydantic schemas for snapshot models
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# Screenshot schemas
class ScreenshotBase(BaseModel):
    screenshot_path: str
    active_states: list[str]
    timestamp: datetime
    width: int
    height: int
    state_hash: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ScreenshotCreate(ScreenshotBase):
    pass


class Screenshot(ScreenshotBase):
    id: int
    snapshot_run_id: int

    class Config:
        from_attributes = True


# Pattern schemas
class PatternBase(BaseModel):
    pattern_id: str
    name: str
    type: str
    screenshot_path: str
    region: dict[str, Any]
    active_states: list[str]
    confidence: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class PatternCreate(PatternBase):
    pass


class Pattern(PatternBase):
    id: int
    snapshot_run_id: int

    class Config:
        from_attributes = True


# Snapshot Run schemas
class SnapshotRunBase(BaseModel):
    run_name: str
    description: str | None = None
    states: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SnapshotRunCreate(SnapshotRunBase):
    run_id: str
    timestamp: datetime
    project_id: int | None = None
    workflow_id: int | None = None


class SnapshotRunUpdate(BaseModel):
    run_name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None


class SnapshotRun(SnapshotRunBase):
    id: int
    run_id: str
    timestamp: datetime
    created_at: datetime
    updated_at: datetime
    project_id: int | None
    workflow_id: int | None
    num_screenshots: int
    num_patterns: int

    class Config:
        from_attributes = True


class SnapshotRunDetail(SnapshotRun):
    """Snapshot run with full details including screenshots and patterns"""

    screenshots: list[Screenshot] = Field(default_factory=list)
    patterns: list[Pattern] = Field(default_factory=list)

    class Config:
        from_attributes = True


# List response
class SnapshotRunListResponse(BaseModel):
    runs: list[SnapshotRun]
    total: int
    limit: int
    offset: int
