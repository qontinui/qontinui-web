"""Wrapper marketplace models — Phase 6 of the wrapper-runner integration plan.

The canonical wrapper registry lives at
``github.com/jspinak/wrappers-registry`` (a single ``registry.json``).
This module owns the social/marketplace surface that augments it on
qontinui-web:

* :class:`WrapperEntry` — synced hourly from registry.json. One row per
  installable wrapper.
* :class:`WrapperRating` — one star rating (1..5) per (user, wrapper).
* :class:`WrapperComment` — threaded comments with a moderation state.
* :class:`WrapperInstallEvent` — anonymous install pings from runners.
  The runner id is sha256-hashed before insert; the table never holds
  raw runner identifiers.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class WrapperEntry(Base):
    """One installable wrapper, mirrored from registry.json."""

    __tablename__ = "wrapper_entries"

    id: Mapped[str] = mapped_column(
        Text,
        primary_key=True,
        comment="Mirrors the wrapper.id field in registry.json.",
    )

    package: Mapped[str] = mapped_column(Text, nullable=False)

    latest_version: Mapped[str] = mapped_column(Text, nullable=False)

    display_name: Mapped[str] = mapped_column(Text, nullable=False)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    categories: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    transport: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="api | headless | headed | live",
    )

    author_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment="{name, url?, email?}",
    )

    repo: Mapped[str | None] = mapped_column(Text, nullable=True)

    license: Mapped[str | None] = mapped_column(Text, nullable=True)

    verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
    )

    registry_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        default=lambda: datetime.now(UTC),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        default=lambda: datetime.now(UTC),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    ratings: Mapped[list["WrapperRating"]] = relationship(
        "WrapperRating",
        back_populates="entry",
        cascade="all, delete-orphan",
    )
    comments: Mapped[list["WrapperComment"]] = relationship(
        "WrapperComment",
        back_populates="entry",
        cascade="all, delete-orphan",
    )
    install_events: Mapped[list["WrapperInstallEvent"]] = relationship(
        "WrapperInstallEvent",
        back_populates="entry",
        cascade="all, delete-orphan",
    )


class WrapperRating(Base):
    """One star rating (1..5) per (user, wrapper)."""

    __tablename__ = "wrapper_ratings"
    __table_args__ = (
        CheckConstraint(
            "stars BETWEEN 1 AND 5",
            name="wrapper_ratings_stars_check",
        ),
        UniqueConstraint(
            "wrapper_id",
            "user_id",
            name="wrapper_ratings_wrapper_id_user_id_key",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(always=False),
        primary_key=True,
    )

    wrapper_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("wrapper_entries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    stars: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        default=lambda: datetime.now(UTC),
    )

    entry: Mapped[WrapperEntry] = relationship(
        "WrapperEntry",
        back_populates="ratings",
    )


class WrapperComment(Base):
    """Threaded comment on a wrapper marketplace entry."""

    __tablename__ = "wrapper_comments"

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(always=False),
        primary_key=True,
    )

    wrapper_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("wrapper_entries.id", ondelete="CASCADE"),
        nullable=False,
    )

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    parent_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("wrapper_comments.id", ondelete="CASCADE"),
        nullable=True,
    )

    body: Mapped[str] = mapped_column(Text, nullable=False)

    moderation_state: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'visible'"),
        default="visible",
        comment="visible | flagged | hidden",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        default=lambda: datetime.now(UTC),
    )

    entry: Mapped[WrapperEntry] = relationship(
        "WrapperEntry",
        back_populates="comments",
    )


class WrapperInstallEvent(Base):
    """Anonymous install ping from a runner. Runner id is sha256-hashed."""

    __tablename__ = "wrapper_install_events"

    id: Mapped[int] = mapped_column(
        BigInteger,
        Identity(always=False),
        primary_key=True,
    )

    wrapper_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("wrapper_entries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    runner_id_hash: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="sha256 of runner id; never the raw value (privacy).",
    )

    version: Mapped[str | None] = mapped_column(Text, nullable=True)

    installed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        default=lambda: datetime.now(UTC),
    )

    entry: Mapped[WrapperEntry] = relationship(
        "WrapperEntry",
        back_populates="install_events",
    )
