"""
Shared Pydantic schemas for automation session repositories.

These schemas are used internally by the repository layer for data transfer
between repository methods and their callers.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class AutomationSessionCreate(BaseModel):
    """Schema for creating an automation session."""

    project_id: UUID | None = None
    user_id: UUID
    runner_version: str
    runner_os: str
    runner_hostname: str
    status: str = "active"
    configuration_snapshot: dict[str, Any] = {}
    max_duration_seconds: int = 28800


class SessionWithStats(BaseModel):
    """A session with computed log and screenshot counts."""

    session: Any
    log_count: int
    screenshot_count: int

    class Config:
        arbitrary_types_allowed = True


class ImageRecognitionStatsData(BaseModel):
    """Per-image recognition statistics."""

    image_id: str
    total_attempts: int
    successful: int
    failed: int
    success_rate: float
    avg_confidence: float | None


class ImageRecognitionReportData(BaseModel):
    """Complete image recognition report for a session."""

    session_id: UUID
    total_attempts: int
    successful: int
    failed: int
    overall_success_rate: float
    images: list[ImageRecognitionStatsData]


class TimelineEventData(BaseModel):
    """A single event in the session timeline."""

    event_type: str  # "log" or "screenshot"
    timestamp: datetime
    id: UUID
    data: dict[str, Any]
