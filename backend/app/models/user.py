from datetime import datetime

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(SQLAlchemyBaseUserTableUUID, Base):
    """
    User model extending fastapi-users base with UUID IDs.

    Inherited fields from SQLAlchemyBaseUserTableUUID:
    - id: UUID (primary key)
    - email: String (unique, indexed)
    - hashed_password: String
    - is_active: Boolean
    - is_superuser: Boolean
    - is_verified: Boolean
    """

    __tablename__ = "users"

    # Custom fields
    username: Mapped[str] = mapped_column(
        String, unique=True, index=True, nullable=False
    )
    full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    is_beta: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Phase 1 Analytics fields
    company: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    email_verification_token: Mapped[str | None] = mapped_column(String, nullable=True)
    subscription_tier: Mapped[str] = mapped_column(String, default="free")

    # Analytics tracking fields
    login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    remember_me_usage_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )
    last_device_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Automation streaming control
    automation_streaming_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,  # Disabled by default for all users
        nullable=False,
        index=True,
    )

    automation_sessions_limit: Mapped[int | None] = mapped_column(
        Integer, nullable=True, default=None  # NULL = unlimited (for paid users)
    )

    automation_sessions_used: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    automation_sessions_reset_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    projects = relationship(
        "Project", back_populates="owner", cascade="all, delete-orphan"
    )
    usage_metrics = relationship(
        "UsageMetric", back_populates="user", cascade="all, delete-orphan"
    )
    storage_usages = relationship(
        "StorageUsage", back_populates="user", cascade="all, delete-orphan"
    )
    audit_logs = relationship(
        "AuditLog",
        back_populates="user",
        foreign_keys="AuditLog.user_id",
        cascade="all, delete-orphan",
    )
    subscription = relationship(
        "Subscription",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    device_sessions = relationship(
        "DeviceSession", back_populates="user", cascade="all, delete-orphan"
    )
    analytics_events = relationship(
        "AnalyticsEvent", back_populates="user", cascade="all, delete-orphan"
    )
    automation_sessions = relationship(
        "AutomationSession", back_populates="user", cascade="all, delete-orphan"
    )
    runner_tokens = relationship(
        "RunnerToken", back_populates="user", cascade="all, delete-orphan"
    )
    runner_connections = relationship(
        "RunnerConnection", back_populates="user", cascade="all, delete-orphan"
    )
    project_versions = relationship(
        "ProjectVersion", back_populates="created_by_user", cascade="all, delete-orphan"
    )
    edit_commands = relationship(
        "EditCommand", back_populates="user", cascade="all, delete-orphan"
    )
    packages = relationship(
        "CodePackage", foreign_keys="CodePackage.author_id", back_populates="author"
    )
    capture_sessions = relationship(
        "CaptureSession", back_populates="user", cascade="all, delete-orphan"
    )
    assigned_deficiencies = relationship(
        "TestDeficiency",
        back_populates="assigned_to",
        foreign_keys="TestDeficiency.assigned_to_user_id",
    )
    runner_devices = relationship(
        "RunnerDevice", back_populates="user", cascade="all, delete-orphan"
    )
