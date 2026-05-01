"""
Prompt template version tracking.

Stores immutable snapshots of AI prompt template content at each version,
enabling version history, rollback, and performance comparison across versions.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class PromptTemplateVersion(Base):
    """
    Immutable snapshot of an AI prompt template at a specific version.

    Each time a template's prompt content changes, a new version row is created
    with the full prompt text, parameters, and a SHA256 content hash for dedup.

    The parent ai_prompt_templates row tracks the current_version number.
    """

    __tablename__ = "prompt_template_versions"
    __table_args__ = (
        UniqueConstraint("template_id", "version_number", name="uq_template_version"),
        {"schema": "project"},
    )

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign key to parent template
    template_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("project.ai_prompt_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    version_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # Content snapshot
    prompt_content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    parameters_json: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    content_hash: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    # Change metadata
    change_description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_by: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    # Aggregated performance metrics (updated over time)
    # {"success_rate": float, "avg_cost": float, "avg_latency": float}
    performance_metrics: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    # Relationships
    template = relationship("AIPromptTemplate", back_populates="versions")

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<PromptTemplateVersion(id={self.id}, template_id='{self.template_id}', "
            f"version_number={self.version_number})>"
        )

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": str(self.id),
            "template_id": self.template_id,
            "version_number": self.version_number,
            "prompt_content": self.prompt_content,
            "parameters_json": self.parameters_json,
            "content_hash": self.content_hash,
            "change_description": self.change_description,
            "created_by": self.created_by,
            "performance_metrics": self.performance_metrics,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
