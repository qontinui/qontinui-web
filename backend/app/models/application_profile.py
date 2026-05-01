"""Application Profile model for click-to-template system."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ApplicationProfile(Base):
    """
    Detection profile for a specific application.

    Stores learned detection parameters optimized for a particular
    application's UI style (e.g., a game, web browser, or desktop app).
    """

    __tablename__ = "application_profiles"
    __table_args__ = {"schema": "project"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    # Detection configuration (stored as JSONB)
    inference_config: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    preferred_strategies: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # Learned characteristics
    avg_element_size: Mapped[list[int] | None] = mapped_column(
        JSON, nullable=True, default=lambda: [60, 30]
    )
    common_color_ranges: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    edge_threshold_overrides: Mapped[list[int] | None] = mapped_column(
        JSON, nullable=True
    )

    # Tuning metrics (stored as JSONB)
    tuning_metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    success_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
