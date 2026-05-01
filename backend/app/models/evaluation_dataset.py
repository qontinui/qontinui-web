"""
Evaluation dataset models for managing curated test cases.

Stores datasets of input/expected-output pairs used for regression testing
and prompt variant evaluation, aligned with the runner-side golden dataset
structure.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EvaluationDataset(Base):
    """
    A curated dataset of evaluation test cases.

    Each dataset contains items with input/expected-output pairs and is
    versioned so experiments can pin to a specific dataset snapshot.
    """

    __tablename__ = "evaluation_datasets"
    __table_args__ = {'schema': "project"}

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Dataset metadata
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Dataset name",
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional dataset description",
    )

    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default=text("1"),
        comment="Dataset version number, incremented on content changes",
    )

    content_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="Hash of dataset contents for change detection",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last update time",
    )

    # Relationships
    items = relationship(
        "DatasetItem",
        back_populates="dataset",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<EvaluationDataset(id={self.id}, name='{self.name}', "
            f"version={self.version})>"
        )


class DatasetItem(Base):
    """
    A single evaluation test case within a dataset.

    Stores the input to evaluate, the expected output for comparison,
    and a content hash for deduplication.
    """

    __tablename__ = "dataset_items"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign key to parent dataset
    dataset_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.evaluation_datasets.id", ondelete="CASCADE"),
        nullable=False,
        comment="FK to evaluation_datasets.id",
    )

    # Item data
    input: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment="Input data for the evaluation case",
    )

    expected_output: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Expected output for comparison",
    )

    metadata_: Mapped[dict | None] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
        comment="Additional metadata",
    )

    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="Hash of item content for deduplication",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    # Index on dataset_id is declared via index=True on the column above
    __table_args__ = (
        Index("ix_dataset_items_dataset_id", "dataset_id"),
        {"schema": "project"},
    )

    # Relationships
    dataset = relationship("EvaluationDataset", back_populates="items")

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<DatasetItem(id={self.id}, dataset_id={self.dataset_id}, "
            f"content_hash='{self.content_hash}')>"
        )
