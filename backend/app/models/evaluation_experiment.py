"""
Evaluation experiment models for tracking prompt variant evaluations.

Stores experiments that run a prompt variant against a dataset and record
per-item results with scores, cost, and token usage.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EvaluationExperiment(Base):
    """
    An evaluation experiment that tests a prompt variant against a dataset.

    Tracks overall status, aggregate metrics, and progress counts.
    """

    __tablename__ = "evaluation_experiments"
    __table_args__ = {"schema": "project"}

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Experiment metadata
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Experiment name",
    )

    dataset_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.evaluation_datasets.id", ondelete="CASCADE"),
        nullable=False,
        comment="FK to evaluation_datasets.id",
    )

    dataset_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default=text("1"),
        comment="Dataset version pinned for this experiment",
    )

    prompt_variant_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="ID of the prompt variant being tested",
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional experiment description",
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        server_default=text("'pending'"),
        comment="Experiment status: pending, running, completed, failed",
    )

    metrics: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Aggregate result metrics",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Completion time",
    )

    # Relationships
    dataset = relationship("EvaluationDataset")
    results = relationship(
        "ExperimentResult",
        back_populates="experiment",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<EvaluationExperiment(id={self.id}, name='{self.name}', "
            f"status='{self.status}')>"
        )


class ExperimentResult(Base):
    """
    Result for a single dataset item within an experiment.

    Records the actual output, per-metric scores, timing, cost, and
    token usage for one evaluation.
    """

    __tablename__ = "experiment_results"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys
    experiment_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.evaluation_experiments.id", ondelete="CASCADE"),
        nullable=False,
        comment="FK to evaluation_experiments.id",
    )

    dataset_item_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.dataset_items.id", ondelete="CASCADE"),
        nullable=False,
        comment="FK to dataset_items.id",
    )

    # Result data
    output: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment="Actual output from evaluation",
    )

    scores: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Score metrics (e.g. accuracy, similarity)",
    )

    duration_ms: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="Evaluation duration in milliseconds",
    )

    cost_usd: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="Cost of evaluation in USD",
    )

    tokens_total: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Total tokens consumed",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    # Indexes for common query patterns
    __table_args__ = (
        Index("ix_experiment_results_experiment_id", "experiment_id"),
        Index("ix_experiment_results_dataset_item_id", "dataset_item_id"),
        {"schema": "project"},
    )

    # Relationships
    experiment = relationship("EvaluationExperiment", back_populates="results")
    dataset_item = relationship("DatasetItem")

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<ExperimentResult(id={self.id}, experiment_id={self.experiment_id}, "
            f"dataset_item_id={self.dataset_item_id})>"
        )
