"""
Transition execution model for tracking every single transition execution attempt.

Records each transition attempt with full context including timing,
input/output data, screenshots, and path traversal information.
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TransitionExecutionStatus(StrEnum):
    """Transition execution status enumeration."""

    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"
    ERROR = "error"


class TransitionExecution(Base):
    """
    Track every single transition execution attempt.

    Records each transition attempt with full context including timing,
    input/output data, screenshots, and path traversal information.
    """

    __tablename__ = "transition_executions"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign key
    test_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("software_test_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Transition identification
    transition_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="From workflow configuration",
    )

    transition_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    sequence_number: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Order within test run"
    )

    # Execution results
    status: Mapped[str] = mapped_column(
        Enum(TransitionExecutionStatus), nullable=False, index=True
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    execution_time_ms: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Calculated duration in milliseconds"
    )

    # Error tracking
    error_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    error_stacktrace: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Visual evidence
    screenshot_urls: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment="Array of S3 URLs"
    )

    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # State tracking
    source_state: Mapped[str | None] = mapped_column(String(255), nullable=True)

    target_state: Mapped[str | None] = mapped_column(String(255), nullable=True)

    actual_state: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="Where we actually ended up"
    )

    state_match: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, comment="Did we reach expected state?"
    )

    # Data context
    input_data: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, comment="Variables/context at start"
    )

    output_data: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, comment="Variables/context at end"
    )

    # Path tracking
    path_sequence: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment="Array of state IDs visited"
    )

    path_depth: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="How deep in exploration"
    )

    # Performance metrics
    action_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Metadata
    execution_metadata: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # Audit
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )

    # Relationships
    test_run = relationship("SoftwareTestRun", back_populates="transition_executions")

    deficiencies = relationship(
        "TestDeficiency",
        back_populates="transition_execution",
        cascade="all, delete-orphan",
        lazy="select",
    )

    screenshots = relationship(
        "TestScreenshot",
        back_populates="transition_execution",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<TransitionExecution(id={self.id}, transition_id='{self.transition_id}', status='{self.status}')>"
