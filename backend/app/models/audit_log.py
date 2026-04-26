from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    action = Column(String, nullable=False, index=True)
    resource_type = Column(String, nullable=True, index=True)
    resource_id = Column(String, nullable=True, index=True)
    log_metadata = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )

    # New fields for enhanced audit logging
    event_category = Column(
        String,
        nullable=True,
        index=True,
        comment="Category: permission_change, membership_change, pii_access, account_modification, etc.",
    )
    correlation_id = Column(
        String,
        nullable=True,
        index=True,
        comment="Request correlation ID for tracing related events",
    )
    target_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="SET NULL"),
        nullable=True,
        comment="User being affected by the action (for permission/membership changes)",
    )
    changes = Column(
        JSON,
        nullable=True,
        comment="Before/after state for modifications as {before: {...}, after: {...}}",
    )

    # Relationships
    user = relationship("User", back_populates="audit_logs", foreign_keys=[user_id])
    target_user = relationship("User", foreign_keys=[target_user_id])

    # Composite indexes for common query patterns
    __table_args__ = (
        Index("ix_audit_logs_user_created", "user_id", "created_at"),
        Index("ix_audit_logs_category_created", "event_category", "created_at"),
        Index("ix_audit_logs_resource", "resource_type", "resource_id", "created_at"),
        Index("ix_audit_logs_target_user", "target_user_id", "created_at"),
    )
