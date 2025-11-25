from datetime import datetime

from app.db.base import Base
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship


class AutomationVideo(Base):
    """
    Video recordings from automation sessions.

    Stores metadata and S3 location for session videos uploaded by the runner.
    """

    __tablename__ = "automation_videos"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, nullable=False, index=True, unique=True)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)

    # S3 storage
    s3_key = Column(String, nullable=False, unique=True)

    # Video metadata
    duration_seconds = Column(Integer, nullable=True)
    fps = Column(Integer, nullable=True)
    quality = Column(String, nullable=True)
    file_size_bytes = Column(Integer, nullable=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    project = relationship("Project", foreign_keys=[project_id])
