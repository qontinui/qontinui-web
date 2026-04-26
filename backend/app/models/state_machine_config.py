"""
State machine configuration model.

Stores exported state machine builder configurations (states, transitions,
fingerprint details) in PostgreSQL for cross-device persistence.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class StateMachineConfig(Base):
    """
    Persisted state machine builder configuration.

    Stores the full builder state (states, transitions, fingerprint details)
    so users can save, load, and share configs across devices.
    """

    __tablename__ = "state_machine_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True
    )
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("runner.users.id"), nullable=False, index=True
    )

    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    version = Column(String, nullable=False, default="1.0.0")
    configuration = Column(
        JSON, nullable=False
    )  # {states, transitions, fingerprintDetails}
    tags = Column(JSON, nullable=False, default=list)

    created_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    project = relationship("Project", backref="state_machine_configs")
    creator = relationship("User", backref="created_state_machine_configs")
