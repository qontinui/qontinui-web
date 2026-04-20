"""ScreenshotStateMatch model for workflow learning capture."""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from .screenshot import CaptureScreenshot


class ScreenshotStateMatch(Base):
    """
    A detected match between a screenshot and a known state.

    Multiple states can be active in a single screenshot (e.g., navbar + form + footer).
    Each match has a confidence score and list of which elements matched.

    Note: States are stored in project configuration JSON, not as database rows,
    so we reference them by name/identifier rather than foreign key.
    """

    __tablename__ = "screenshot_state_matches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    screenshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("capture_screenshots.id", ondelete="CASCADE")
    )

    # State identifier (name or ID from project configuration)
    state_identifier: Mapped[str] = mapped_column(String(255), nullable=False)

    # State metadata for reference
    state_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example:
    # {
    #   "state_name": "LoginForm",
    #   "state_id": "state-uuid-123",
    #   "project_version": 15
    # }

    # Match confidence (0.0 - 1.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Which elements matched (references to DetectedElement IDs and State element IDs)
    matched_elements: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Example:
    # {
    #   "matches": [
    #     {
    #       "detected_element_id": "uuid-1",
    #       "state_element_id": "login_button",
    #       "confidence": 0.95
    #     },
    #     {
    #       "detected_element_id": "uuid-2",
    #       "state_element_id": "username_input",
    #       "confidence": 0.88
    #     }
    #   ],
    #   "total_expected": 5,  # state has 5 elements
    #   "total_matched": 2,    # 2 elements matched
    #   "match_percentage": 0.4
    # }

    # User confirmation (null = not reviewed, true = confirmed, false = rejected)
    is_confirmed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=None
    )

    # Notes from user review
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )

    # Relationships
    screenshot: Mapped["CaptureScreenshot"] = relationship(
        "CaptureScreenshot", back_populates="state_matches"
    )
