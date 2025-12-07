"""
Path discovery model for tracking unique path traversals through the application.

Discovers new paths through state space, identifies patterns,
and detects anomalous or unexpected paths.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class PathDiscovery(Base):
    """
    Track unique path traversals through the application.

    Discovers new paths through state space, identifies patterns,
    and detects anomalous or unexpected paths.
    """

    __tablename__ = "path_discoveries"

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

    # Path identification
    path_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
        comment="SHA256 of path_sequence for quick lookup",
    )

    path_sequence: Mapped[list] = mapped_column(
        JSONB, nullable=False, comment='Array of {state: "", transition: ""}'
    )

    # Path metrics
    path_length: Mapped[int] = mapped_column(Integer, nullable=False)

    unique_states_visited: Mapped[int] = mapped_column(Integer, nullable=False)

    unique_transitions_used: Mapped[int] = mapped_column(Integer, nullable=False)

    # Discovery context
    discovered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True
    )

    execution_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Outcome
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)

    end_state: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Path characteristics
    is_cyclic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    cycle_detected_at: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Step number where cycle detected"
    )

    # Frequency tracking
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    last_traversed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )

    # Metadata
    path_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Audit
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )

    # Relationships
    test_run = relationship("SoftwareTestRun", back_populates="path_discoveries")

    def __repr__(self) -> str:
        return f"<PathDiscovery(id={self.id}, path_length={self.path_length}, success={self.success})>"
