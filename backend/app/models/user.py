import uuid
from datetime import UTC, datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    """User model — Cognito-authenticated, UUID-keyed.

    Cognito is the sole user-authentication mechanism, so this model
    deliberately does NOT inherit ``SQLAlchemyBaseUserTableUUID`` (whose
    ``hashed_password`` column was dropped from ``auth.users``). The
    fastapi-users compatible columns are declared directly below:

    - ``id``: UUID (primary key)
    - ``email``: String (unique, indexed)
    - ``is_active`` / ``is_superuser`` / ``is_verified``: Boolean

    There is intentionally NO ``hashed_password`` column. fastapi-users'
    user-DB lookups (``get``/``get_by_email``) used by
    ``current_active_user`` only reference ``id``/``email``, so they keep
    working; identity comes from the verified Cognito ``sub`` resolved via
    :mod:`app.services.cognito_provision`.
    """

    __tablename__ = "users"
    __table_args__ = {"schema": "auth"}

    # fastapi-users compatible columns (declared directly; no hashed_password)
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(
        String(length=320), unique=True, index=True, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Custom fields
    username: Mapped[str] = mapped_column(
        String, unique=True, index=True, nullable=False
    )
    full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    is_beta: Mapped[bool] = mapped_column(Boolean, default=False)
    # AWS Cognito subject (``sub`` claim) for users that authenticate via
    # the Cognito user pool. Nullable: local email/password users have no
    # Cognito identity. Unique so a Cognito ``sub`` links to exactly one
    # row. Populated on first Cognito login (provision-or-link by verified
    # email) — see app/services/cognito_provision.py.
    cognito_sub: Mapped[str | None] = mapped_column(
        String, unique=True, index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
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
        DateTime(timezone=True), nullable=True, index=True
    )
    last_device_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Automation streaming control
    automation_streaming_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
    )

    automation_sessions_limit: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        default=1000,
    )

    automation_sessions_used: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    automation_sessions_reset_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # User preferences (flexible JSON storage)
    preferences: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
        comment="User preferences (product_mode, theme, etc.)",
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
    # Subscription model was carved out to qontinui-cloud-control in
    # 03b28e0e ("Step 3b: carve cloud-control out of qontinui-web") but
    # this relationship reference was left behind. SQLAlchemy mapper
    # init then fails on first access to a User-touching query — health
    # endpoints work (no User access), but POST /api/v1/auth/jwt/login
    # explodes with HTTP 500 + "expression 'Subscription' failed to
    # locate a name". Removed to unblock login on the AWS staging cutover.
    device_sessions = relationship(
        "DeviceSession", back_populates="user", cascade="all, delete-orphan"
    )
    analytics_events = relationship(
        "AnalyticsEvent", back_populates="user", cascade="all, delete-orphan"
    )
    automation_sessions = relationship(
        "AutomationSession", back_populates="user", cascade="all, delete-orphan"
    )
    device_connections = relationship(
        "DeviceConnection", back_populates="user", cascade="all, delete-orphan"
    )
    devices = relationship("Device", back_populates="user", passive_deletes=True)
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
    workflow_events = relationship(
        "WorkflowEvent", back_populates="user", cascade="all, delete-orphan"
    )
    push_devices = relationship(
        "PushDevice", back_populates="user", cascade="all, delete-orphan"
    )
    project_screenshots = relationship(
        "ProjectScreenshot", back_populates="user", cascade="all, delete-orphan"
    )
    project_images = relationship(
        "ProjectImage", back_populates="user", cascade="all, delete-orphan"
    )
    embedding_jobs = relationship(
        "EmbeddingGenerationJob",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    detected_issues = relationship(
        "DetectedIssue",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    discoveries = relationship(
        "Discovery",
        back_populates="user",
        foreign_keys="Discovery.user_id",
        cascade="all, delete-orphan",
    )
    execution_runs = relationship(
        "ExecutionRun",
        back_populates="created_by",
    )
    assigned_execution_issues = relationship(
        "ExecutionIssue",
        back_populates="assigned_to",
        foreign_keys="ExecutionIssue.assigned_to_user_id",
    )
    task_runs = relationship(
        "TaskRun",
        back_populates="created_by",
    )
    verification_tests = relationship(
        "VerificationTest",
        back_populates="created_by",
    )
    render_logs = relationship(
        "RenderLog",
        back_populates="user",
    )
