"""
Skill model for storing user-created skill definitions.

Skills are parameterized step templates that produce pre-configured workflow
steps when instantiated. Built-in skills are embedded in the runner binary;
only user-created skills are stored in the database.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Skill(Base):
    """User-created skill definition."""

    __tablename__ = "skills"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    is_shared: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
    )

    version: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default=text("'1.0.0'"),
        default="1.0.0",
    )

    author: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
    )

    checksum: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        default=None,
    )

    depends_on: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    usage_count: Mapped[int] = mapped_column(
        nullable=False,
        server_default=text("0"),
        default=0,
    )

    approval_status: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        default=None,
    )

    forked_from: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        default=None,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    slug: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("''"),
        default="",
    )

    category: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        server_default=text("'custom'"),
        default="custom",
        index=True,
    )

    tags: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    icon: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        server_default=text("'puzzle'"),
        default="puzzle",
    )

    color: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        server_default=text("'gray'"),
        default="gray",
    )

    allowed_phases: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[\"setup\"]'::jsonb"),
        default=lambda: ["setup"],
    )

    parameters: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    template: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default=text("now()"),
        onupdate=datetime.utcnow,
    )
