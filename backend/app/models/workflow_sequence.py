"""Workflow sequence model for storing ordered workflow execution sequences."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class WorkflowSequence(Base):
    """Ordered sequence of workflows for batch execution."""

    __tablename__ = "workflow_sequences"

    id = Column(UUID(as_uuid=True), primary_key=True, index=True, default=uuid.uuid4)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True
    )
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    workflow_ids = Column(JSON, nullable=False, default=list)
    stop_on_failure = Column(Boolean, nullable=False, default=True)
    schedule = Column(JSON, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    project = relationship("Project", backref="workflow_sequences")
    creator = relationship("User", backref="created_workflow_sequences")
