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
    TERMINAL_EXITED = "terminal_exited"
    STEP_COMPLETED = "step_completed"
    HITL_QUESTION_PENDING = "hitl_question_pending"
    RUNNER_CRASHED = "runner_crashed"
    RUNNER_RECOVERED = "runner_recovered"
    BUILD_FAILED = "build_failed"
    VERIFICATION_FAILED = "verification_failed"
    PHASE_COMPLETED = "phase_completed"
    # New-project creation funnel (telemetry, not notifications). Emitted by
    # the runner's ``create_new_project`` command, correlated by ``run_id``
    # (the flow id). See ``TELEMETRY_EVENT_TYPES``.
    NEW_PROJECT_STARTED = "new_project_started"
    NEW_PROJECT_NAME_OK = "new_project_name_ok"
    NEW_PROJECT_REPO_CREATED = "new_project_repo_created"
    NEW_PROJECT_PUSHED = "new_project_pushed"
    NEW_PROJECT_ENROLLED = "new_project_enrolled"
    NEW_PROJECT_FINISHED = "new_project_finished"
    NEW_PROJECT_LIVE = "new_project_live"


# Event types that are TELEMETRY rather than user-facing notifications. They
# are ingested and stored like any other workflow event, but must never send a
# push notification nor appear in the user's event feed / unread badge. This
# is the ONE predicate both gates consume (push dispatch and the feed routes),
# so the two suppressions cannot drift apart.
TELEMETRY_EVENT_TYPES: frozenset[str] = frozenset(
    {
        WorkflowEventType.NEW_PROJECT_STARTED.value,
        WorkflowEventType.NEW_PROJECT_NAME_OK.value,
        WorkflowEventType.NEW_PROJECT_REPO_CREATED.value,
        WorkflowEventType.NEW_PROJECT_PUSHED.value,
        WorkflowEventType.NEW_PROJECT_ENROLLED.value,
        WorkflowEventType.NEW_PROJECT_FINISHED.value,
        WorkflowEventType.NEW_PROJECT_LIVE.value,
    }
)


def is_telemetry(event_type: str) -> bool:
    """Return True if ``event_type`` is telemetry (no push, not in the feed)."""
    return str(event_type) in TELEMETRY_EVENT_TYPES


class WorkflowEvent(Base):
    """
    Workflow event ingested from a runner device.

    Runners push events at key lifecycle points (run start, complete, fail, etc.)
    to the backend. These events drive push notifications and the mobile event feed.
    """

    __tablename__ = "workflow_events"
    __table_args__ = {"schema": "project"}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
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
