"""Public build-record snapshots (``web.build_record_*``).

Phase 1 of ``2026-10-09-factory-built-product-portfolio-and-launch-kit``.
Mirrors alembic revision ``brs_01_build_record_snapshots``; read that
migration's docstring for why ownership is its own table.

The product DEFINITIONS (``coord.build_record_products``) are coord's: web
created that table (``brp_01_build_record_products``) but never reads it — it
proxies coord's routes instead — so there is deliberately no ORM model for it
here.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
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
    #: Set by the D7 unpublish (revision ``brs_02_build_record_unpublish``):
    #: the public reader 404s while it is set; a publish with ``reactivate``
    #: clears it.
    #: Snapshot rows are kept either way, and the tenant keeps the slug.
    unpublished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: When the scheduled reconcile last asked GitHub whether this page's repos
    #: are still public, set only when every repo got a definite answer
    #: (revision ``brs_03_build_record_visibility_check``).
    last_visibility_check_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: How many of the slug's (sorted) repos the current check pass has
    #: already answered — a slug wider than one tick's budget spans ticks.
    visibility_check_offset: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
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
    #: coord's ``generated_at`` for this document (stale-publish guard).
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
