"""
Pydantic schemas for automation models
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import BaseORMSchema, IsoDatetime


# Automation Session schemas
class AutomationSessionBase(BaseModel):
    runner_version: str
    runner_os: str
    runner_hostname: str
    status: str = "active"
    configuration_snapshot: dict[str, Any] = Field(default_factory=dict)


class AutomationSessionCreate(AutomationSessionBase):
    project_id: UUID | None = None


class AutomationSessionUpdate(BaseModel):
    status: str | None = None
    ended_at: datetime | None = None


class AutomationSession(BaseORMSchema, AutomationSessionBase):
    id: UUID
    project_id: UUID | None
    created_at: IsoDatetime
    ended_at: IsoDatetime | None


class AutomationSessionWithStats(AutomationSession):
    """Session with basic statistics"""
    log_count: int
    screenshot_count: int


# Automation Log schemas
class AutomationLogBase(BaseModel):
    session_id: UUID
    sequence_number: int
    level: str
    message: str
    log_data: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime


class AutomationLogCreate(AutomationLogBase):
    pass


class AutomationLog(BaseORMSchema, AutomationLogBase):
    id: UUID
    created_at: IsoDatetime


# Automation Screenshot schemas
class AutomationScreenshotBase(BaseModel):
    session_id: UUID
    name: str
    storage_path: str
    width: int
    height: int
    content_type: str = "image/png"
    automation_metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime


class AutomationScreenshotCreate(AutomationScreenshotBase):
    pass


class AutomationScreenshot(BaseORMSchema, AutomationScreenshotBase):
    id: UUID
    presigned_url: str | None
    created_at: IsoDatetime


# Screenshot Input Association schemas
class ScreenshotInputAssociationBase(BaseModel):
    screenshot_id: UUID
    log_id: UUID
    input_type: str
    input_data: dict[str, Any] = Field(default_factory=dict)
    timestamp_diff_ms: int


class ScreenshotInputAssociationCreate(ScreenshotInputAssociationBase):
    pass


class ScreenshotInputAssociation(BaseORMSchema, ScreenshotInputAssociationBase):
    id: UUID
    created_at: IsoDatetime


# Timeline Event schema (for merged logs and screenshots)
class TimelineEvent(BaseModel):
    """A timeline event that can be either a log or a screenshot"""
    event_type: str  # "log" or "screenshot"
    timestamp: IsoDatetime
    id: UUID
    data: dict[str, Any]  # Log or screenshot data


class SessionTimeline(BaseModel):
    """Session with chronological timeline of events"""
    session: AutomationSession
    timeline: list[TimelineEvent]
    total_events: int


# Image Recognition Statistics schemas
class ImageRecognitionStats(BaseModel):
    """Statistics for a specific image"""
    image_id: str
    total_attempts: int
    successful: int
    failed: int
    success_rate: float
    avg_confidence: float | None


class ImageRecognitionReport(BaseModel):
    """Image recognition report for a session"""
    session_id: UUID
    total_attempts: int
    successful: int
    failed: int
    overall_success_rate: float
    images: list[ImageRecognitionStats]


# Screenshot with inputs schema
class ScreenshotWithInputs(BaseModel):
    """Screenshot with all associated input events"""
    screenshot: AutomationScreenshot
    inputs: list[dict[str, Any]]  # Input events with timestamps and metadata


# Session list response
class AutomationSessionListResponse(BaseModel):
    sessions: list[AutomationSessionWithStats]
    total: int
    limit: int
    offset: int


# Monitoring Event schemas (for WebSocket monitoring)
class MonitoringLogEvent(BaseModel):
    """Log event for monitoring WebSocket"""
    id: UUID
    sequence_number: int
    level: str
    message: str
    log_data: dict[str, Any] = Field(default_factory=dict)
    timestamp: IsoDatetime


class MonitoringScreenshotEvent(BaseModel):
    """Screenshot event for monitoring WebSocket"""
    id: UUID
    name: str
    presigned_url: str
    width: int
    height: int
    automation_metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: IsoDatetime


class MonitoringEvent(BaseModel):
    """Wrapper for all monitoring events"""
    type: str  # "log" or "screenshot"
    data: MonitoringLogEvent | MonitoringScreenshotEvent
    timestamp: IsoDatetime
