"""
Test result model for tracking verification test execution results.

Links test executions to verification tests, task runs, and execution runs,
storing detailed results including output, assertions, and coverage data.
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from qontinui_schemas.common import utc_now
from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TestResultStatus(StrEnum):
    """Test result status enumeration."""

    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"
    TIMEOUT = "timeout"


class TestResult(Base):
    """
    Test result tracking verification test execution outcomes.

    Links to:
    - VerificationTest: The test definition being executed
    - TaskRun: Optional AI task run context
    - ExecutionRun: Optional execution run context
    """

    __tablename__ = "test_results"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys
    test_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("verification_tests.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="Reference to the verification test definition",
    )

    task_run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("task_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="Optional reference to AI task run context",
    )

    execution_run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("execution_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="Optional reference to execution run context",
    )

    # Status
    status: Mapped[str] = mapped_column(
        Enum(
            TestResultStatus,
            name="test_result_status",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=TestResultStatus.PENDING,
        index=True,
    )

    # Timestamps
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    duration_ms: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Test execution duration in milliseconds",
    )

    # Output data
    output: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Raw test output (stdout/stderr)",
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Error message if test failed",
    )

    structured_output: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Structured output data (JSON)",
    )

    screenshots: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
        comment="Array of screenshot references",
    )

    # Assertion results
    assertions_passed: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Number of assertions that passed",
    )

    assertions_failed: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Number of assertions that failed",
    )

    # Detailed test results (for test suites)
    individual_tests: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Individual test results within a suite",
    )

    # Coverage data
    coverage: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Code/state coverage data",
    )

    # Process info
    exit_code: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Process exit code",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=text("now()"),
    )

    # Relationships
    test = relationship(
        "VerificationTest",
        back_populates="results",
    )

    task_run = relationship(
        "TaskRun",
        back_populates="test_results",
    )

    execution_run = relationship(
        "ExecutionRun",
        back_populates="test_results",
    )

    def __repr__(self) -> str:
        """Return string representation of TestResult."""
        return f"<TestResult(id={self.id}, status='{self.status}', test_id={self.test_id})>"
