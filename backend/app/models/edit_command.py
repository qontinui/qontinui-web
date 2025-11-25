from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class EditCommand(Base):
    """
    Event sourcing model that logs every edit command applied to a project.

    This enables:
    - Full audit trail of all changes
    - Ability to replay commands to rebuild state
    - Detailed change history for debugging
    - Granular undo/redo capabilities (future enhancement)
    """
    __tablename__ = "edit_commands"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    command_type = Column(String, nullable=False)  # 'update', 'create', 'delete'
    entity_type = Column(String, nullable=False)  # 'workflow', 'state', 'action', 'project', etc.
    entity_id = Column(String, nullable=False)  # ID of the entity being modified
    payload = Column(JSON, nullable=False)  # What changed (new values, delta, etc.)
    sequence_number = Column(Integer, nullable=False)  # Ensures ordering and no gaps
    applied_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    project = relationship("Project", back_populates="edit_commands")
    user = relationship("User", back_populates="edit_commands")

    __table_args__ = (
        UniqueConstraint('project_id', 'sequence_number', name='uq_project_command_seq'),
    )
