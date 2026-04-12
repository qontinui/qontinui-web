"""Workflow event model for runner-to-cloud event ingestion."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class WorkflowEventType(StrEnum):
    """Types of workflow events emitted by runners."""

    RUN_STARTED = "run_started"
    RUN_COMPLETED = "run_completed"
    RUN_FAILED = "run_failed"
    SESSION_COMPLETED = "session_completed"
    STEP_COMPLETED = "step_completed"
    HITL_QUESTION_PENDING = "hitl_question_pending"
    RUNNER_CRASHED = "runner_crashed"
    RUNNER_RECOVERED = "runner_recovered"
    BUILD_FAILED = "build_failed"
    VERIFICATION_FAILED = "verification_failed"


class WorkflowEvent(Base):
    """
    Workflow event ingested from a runner device.

    Runners push events at key lifecycle points (run start, complete, fail, etc.)
    to the backend. These events drive push notifications and the mobile event feed.
    """

    __tablename__ = "workflow_events"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type = Column(
        String(50),
        nullable=False,
        index=True,
    )
    device_id = Column(String(255), nullable=False, index=True)
    runner_name = Column(String(255), nullable=False)
    run_id = Column(String(255), nullable=True, index=True)
    summary = Column(Text, nullable=False)
    payload = Column(JSONB, nullable=True)
    seen = Column(
        Boolean, default=False, server_default=text("false"), nullable=False, index=True
    )
    timestamp = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    user = relationship("User", back_populates="workflow_events")
