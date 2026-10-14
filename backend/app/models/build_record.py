"""Public build-record snapshots (``web.build_record_*``).

Phase 1 of ``2026-10-09-factory-built-product-portfolio-and-launch-kit``.
Mirrors alembic revision ``build_records_01_export``; read that
migration's docstring for why ownership is its own table.

The product DEFINITIONS (``coord.build_record_products``) are coord's: web
created that table (``build_records_01_export``) but never reads it — it
proxies coord's routes instead — so there is deliberately no ORM model for it
here.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: The public-address domain, shared with ``coord.build_record_products.slug``.
BUILD_RECORD_SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}$"


class BuildRecordPublicSlug(Base):
    """One public address, owned by the first tenant that published it."""

    __tablename__ = "build_record_public_slugs"
    __table_args__ = (
        UniqueConstraint(
            "public_slug",
            "tenant_id",
            name="uq_build_record_public_slugs_slug_tenant",
        ),
        CheckConstraint(
            "public_slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'",
            name="ck_build_record_public_slugs_slug",
        ),
        {"schema": "web"},
    )

    public_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    #: Set by the D7 unpublish (revision ``build_records_01_export``):
    #: the public reader 404s while it is set; a publish with ``reactivate``
    #: clears it.
    #: Snapshot rows are kept either way, and the tenant keeps the slug.
    unpublished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: When the visibility re-check last finished with this slug, whatever
    #: the outcome — the queue order (revision
    #: ``build_records_01_export``).
    last_visibility_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: When the scheduled reconcile last asked GitHub whether this page's repos
    #: are still public, set only when every repo got a definite answer
    #: (revision ``build_records_01_export``).
    last_visibility_check_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: How many of the slug's (sorted) repos the current check pass has
    #: already answered — a slug wider than one tick's budget spans ticks.
    visibility_check_offset: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    #: Consecutive re-checks that gave up on an unanswerable repo; the page
    #: is retracted at ``VISIBILITY_UNKNOWN_RETRACT_AFTER``.
    visibility_unknown_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    #: When the current run of unanswered attempts began; cleared by any
    #: complete answer. The 24 h attempted ceiling is measured from here.
    first_unanswered_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class BuildRecordSnapshot(Base):
    """One frozen, allowlist-validated version of a product's build record."""

    __tablename__ = "build_record_snapshots"
    __table_args__ = (
        ForeignKeyConstraint(
            ["public_slug", "tenant_id"],
            [
                "web.build_record_public_slugs.public_slug",
                "web.build_record_public_slugs.tenant_id",
            ],
            name="fk_build_record_snapshots_owner",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "public_slug",
            "version",
            name="uq_build_record_snapshots_slug_version",
        ),
        CheckConstraint("version >= 1", name="ck_build_record_snapshots_version"),
        CheckConstraint(
            "content_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_build_record_snapshots_sha256",
        ),
        {"schema": "web"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    public_slug: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    document: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    #: The allowlist version the document passed at publish.
    allowlist_version: Mapped[int] = mapped_column(Integer, nullable=False)
    #: coord's ``generated_at`` for this document (stale-publish guard).
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class GithubRateBudget(Base):
    """The singleton row holding GitHub's last reported rate-limit window.

    Written by every GitHub visibility read (publish and the scheduled
    re-check); read by publish, which refuses while ``remaining`` is at or
    below its reserve and ``reset_at`` has not passed.
    """

    __tablename__ = "github_rate_budget"
    __table_args__ = (
        CheckConstraint("id", name="ck_github_rate_budget_singleton"),
        {"schema": "web"},
    )

    id: Mapped[bool] = mapped_column(
        Boolean, primary_key=True, server_default=text("true"), default=True
    )
    remaining: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reset_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class BuildRecordPendingNotPublic(Base):
    """A NOT_PUBLIC verdict whose retraction could not take the owner row
    lock in time; applied first by the next visibility tick. No FK to the
    owner on purpose (see revision ``build_records_01_export``).
    """

    __tablename__ = "build_record_pending_not_public"
    __table_args__ = ({"schema": "web"},)

    public_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    repo: Mapped[str] = mapped_column(Text, primary_key=True)
    #: The snapshot version the verdict was about.
    snapshot_version: Mapped[int] = mapped_column(Integer, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
