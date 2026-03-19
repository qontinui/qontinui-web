from datetime import UTC, datetime

from sqlalchemy import DECIMAL, JSON, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class UsageMetric(Base):
    __tablename__ = "usage_metrics"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    metric_type = Column(String, nullable=False)
    value = Column(DECIMAL, nullable=False)
    timestamp = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )
    metric_metadata = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User", back_populates="usage_metrics")
