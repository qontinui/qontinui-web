"""
Known issue model for tracking verified/discovered issues.

Mirrors the runner's known_issues system in Rust/SQLite so the web
dashboard can display issue data. Issues represent recurring, verified
problems detected during workflow execution.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KnownIssue(Base):
    """A known issue tracked across workflow executions."""

    __tablename__ = "known_issues"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    organization_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_by_user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Issue identity
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # Classification
    category: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="other",
        server_default=text("'other'"),
        index=True,
        comment="duplication, rendering, data_integrity, timing, layout, state, performance, encoding, navigation, authentication, other",
    )

    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="medium",
        server_default=text("'medium'"),
        index=True,
        comment="critical, high, medium, low",
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="active",
        server_default=text("'active'"),
        index=True,
        comment="active, resolved, monitoring, wont_fix",
    )

    # Scope
    scope_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="global",
        server_default=text("'global'"),
        comment="global, spec, url, component, feature",
    )

    scope_value: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    scope_tags: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    # Detection
    detection_method: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="ai_judgment",
        server_default=text("'ai_judgment'"),
        comment="algorithmic, ai_judgment, visual, command, ui_bridge",
    )

    detection_config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
        default=dict,
    )

    pattern_template_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # Reproduction
    reproduction_context: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    trigger_conditions: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    # Confidence and provenance
    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.5,
        server_default=text("0.5"),
    )

    provenance: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="manual",
        server_default=text("'manual'"),
        comment="manual, auto_detected, reflection, imported",
    )

    source_finding_ids: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    source_task_run_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # Verification
    verification_hint: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    verification_step_template: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Occurrence tracking
    times_detected: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default=text("1"),
    )

    times_checked: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=text("0"),
    )

    last_detected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
    )
