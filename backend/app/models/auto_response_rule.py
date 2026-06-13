"""
Auto-Response Rule Model

Stores org-scoped (fleet-wide) auto-response rules. A rule matches runner
output against a regex ``pattern`` and, when it fires, injects ``prompt`` as
an auto-continue response with an exponential ``backoff`` schedule.

Operators CRUD these in the web UI (Cognito, org-scoped); every runner in the
org fetches the enabled rules via a device-JWT endpoint. One built-in default
rule is seeded per-org on first read.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AutoResponseRule(Base):
    """
    Org-scoped auto-response rule.

    Each row is one rule (built-in or custom). The built-in default rule is
    auto-seeded on first read and cannot be deleted (but can be edited).
    """

    __tablename__ = "auto_response_rules"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    pattern: Mapped[str] = mapped_column(String(1000), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # {initial_delay_secs:int, multiplier:float, max_delay_secs:int|None}
    backoff: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        Index("idx_auto_response_rule_org", "organization_id"),
        {"schema": "auth"},
    )

    def __repr__(self) -> str:
        """Return string representation of AutoResponseRule."""
        return (
            f"<AutoResponseRule(id={self.id}, name='{self.name}', "
            f"enabled={self.enabled}, built_in={self.is_built_in})>"
        )
