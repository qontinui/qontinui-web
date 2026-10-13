"""The content-addressed image store — ``web.image_assets`` and ``web.image_slot_candidates``.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``. Mirrors
alembic revision ``image_assets_01``; read that migration's docstring for the
design rationale.

``ImageAsset``
    One row per (tenant, image). The image is identified by the SHA-256 of its
    bytes, computed by the server, and its object lives at
    ``image-assets/{tenant_id}/sha256/{h[:2]}/{h}{ext}`` — a key that names the
    tenant, so no object is ever shared between tenants (one tenant's erasure
    can never break another's asset, and a write reveals nothing about what
    another tenant holds). ``mime_type``, ``width`` and ``height`` are read from
    the bytes, never taken from the client.

``ImageSlotCandidate``
    An asset proposed for one image slot of one repo — the record the asset
    compile step (Phase 19), the judges (Phase 20) and the taste inbox
    (Phase 23) read and write. ``values`` holds the measured values, ``judge``
    the panel's votes and margins; ``status`` is where the candidate stands.
    At most one candidate per slot is ``chosen``.

Scoping: every row carries ``tenant_id`` — the coord tenant the caller's
credential names. There is no FK on it (tenants live in coord's own
deployment, the same reasoning as ``overview.*``), so every query filters on it
explicitly. A candidate references its asset through the composite FK
``(tenant_id, asset_sha256)``, which makes a cross-tenant reference
unconstructible in the database itself, not only in the API.

These tables are product data, not orchestration: nothing here reads or
references a ``coord.*`` table.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: How an image entered the store. ``candidate`` — a generated image proposed
#: for a slot; ``derivative`` — an encoding derived from another asset (AVIF,
#: WebP, a crop); ``capture`` — a rendered page or in-situ frame; ``exemplar``
#: — an image entering from outside, such as an operator's own reference.
#: Enforced by ``ck_image_assets_kind``.
IMAGE_ASSET_KINDS: tuple[str, ...] = ("candidate", "derivative", "capture", "exemplar")

#: The formats the store accepts, as the MIME type sniffed from the bytes.
#: Enforced by ``ck_image_assets_mime_type``; the sniffer
#: (``app.services.image_sniff``) is the only writer.
IMAGE_MIME_TYPES: tuple[str, ...] = (
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
)

#: Where a slot candidate stands. ``candidate`` — proposed, not decided;
#: ``chosen`` — the slot's pick (at most one per slot,
#: ``uq_image_slot_candidates_one_chosen``); ``rejected`` — decided against;
#: ``shipped`` — landed in the repo. Enforced by
#: ``ck_image_slot_candidates_status``.
SLOT_CANDIDATE_STATUSES: tuple[str, ...] = (
    "candidate",
    "chosen",
    "rejected",
    "shipped",
)


def _now() -> datetime:
    return datetime.now(UTC)


def _in_list(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class ImageAsset(Base):
    """One image a tenant holds, addressed by the SHA-256 of its bytes."""

    __tablename__ = "image_assets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sha256", name="uq_image_assets_tenant_sha256"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="ck_image_assets_sha256_hex"),
        CheckConstraint(
            _in_list("kind", IMAGE_ASSET_KINDS), name="ck_image_assets_kind"
        ),
        CheckConstraint(
            _in_list("mime_type", IMAGE_MIME_TYPES), name="ck_image_assets_mime_type"
        ),
        CheckConstraint(
            "width > 0 AND height > 0", name="ck_image_assets_dimensions_positive"
        ),
        CheckConstraint("byte_size > 0", name="ck_image_assets_byte_size_positive"),
        CheckConstraint(
            "jsonb_typeof(provenance) = 'object'",
            name="ck_image_assets_provenance_object",
        ),
        {"schema": "web"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(32), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )


class ImageSlotCandidate(Base):
    """One asset proposed for one image slot of one repo."""

    __tablename__ = "image_slot_candidates"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "asset_sha256"],
            ["web.image_assets.tenant_id", "web.image_assets.sha256"],
            ondelete="CASCADE",
            name="fk_image_slot_candidates_asset",
        ),
        UniqueConstraint(
            "tenant_id",
            "repo",
            "slot_id",
            "asset_sha256",
            name="uq_image_slot_candidates_slot_asset",
        ),
        Index(
            "uq_image_slot_candidates_one_chosen",
            "tenant_id",
            "repo",
            "slot_id",
            unique=True,
            postgresql_where=text("status = 'chosen'"),
        ),
        CheckConstraint(
            _in_list("status", SLOT_CANDIDATE_STATUSES),
            name="ck_image_slot_candidates_status",
        ),
        CheckConstraint(
            "jsonb_typeof(values) = 'object'",
            name="ck_image_slot_candidates_values_object",
        ),
        CheckConstraint(
            "jsonb_typeof(judge) = 'object'",
            name="ck_image_slot_candidates_judge_object",
        ),
        {"schema": "web"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    repo: Mapped[str] = mapped_column(String(200), nullable=False)
    slot_id: Mapped[str] = mapped_column(String(200), nullable=False)
    asset_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    recipe_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    values: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    judge: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'candidate'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )
