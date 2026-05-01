"""
Project Embedding Model

Stores vector embeddings for pattern images to enable semantic search.
Uses pgvector extension for efficient similarity search.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project


class ProjectEmbedding(Base):
    """
    Vector embeddings for pattern images in projects.

    Enables semantic search across all user's projects using pgvector.
    Each embedding represents a visual pattern used in workflow automation.
    """

    __tablename__ = "project_embeddings"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Project association
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("project.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Pattern identification
    pattern_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    pattern_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # State association (from QontinuiConfig)
    state_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Image reference
    image_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    image_storage_path: Mapped[str] = mapped_column(String(500), nullable=False)

    # Vector embedding (512 dimensions for CLIP ViT-B/32)
    # Note: Dimension can be changed based on embedding model:
    # - CLIP ViT-B/32: 512
    # - ResNet50: 2048
    # - Custom model: variable
    embedding: Mapped[Vector] = mapped_column(Vector(512), nullable=False)

    # Text embedding (384 dimensions for all-MiniLM-L6-v2)
    # Used for text-to-text semantic search
    text_embedding: Mapped[Vector | None] = mapped_column(Vector(384), nullable=True)

    # Embedding metadata
    embedding_model: Mapped[str] = mapped_column(String(100), nullable=False)
    # e.g., "clip-vit-base-patch32", "resnet50", etc.

    embedding_version: Mapped[str] = mapped_column(String(50), nullable=False)
    # Track model version for compatibility (e.g., "1.0.0")

    # Pattern metadata (JSONB for flexible storage)
    pattern_metadata: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # Stores: similarity threshold, search regions, fixed flag, offsets, etc.

    # Image dimensions
    image_width: Mapped[int] = mapped_column(Integer, nullable=False)
    image_height: Mapped[int] = mapped_column(Integer, nullable=False)

    # Text description for semantic search (AI-generated or manual)
    text_description: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="embeddings")

    # Composite indexes for efficient lookups
    __table_args__ = (
        Index("ix_project_embeddings_project_pattern", "project_id", "pattern_id"),
        {"schema": "project"},
    )

    def __repr__(self) -> str:
        return f"<ProjectEmbedding(id={self.id}, pattern_id='{self.pattern_id}', state='{self.state_name}')>"
