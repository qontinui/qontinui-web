"""
Design Policy Model

Stores tenant-scoped, user-authored design/UX policies. Policies are advisory
guidance that AI agents (any vendor) and humans apply when doing UI work — they
are NOT coord runtime automations (see coord.policy_rules for those).

Each policy follows a Principle / Rationale / Enforcement structure. A set of
built-in policies is seeded on first access; tenant admins can create, edit,
disable, or delete custom ones.

Consumed tool-agnostically over REST: GET /api/v1/design-policies returns the
enabled policies for the caller's tenant, so Claude, OpenAI/Codex, Gemini, or a
CI script all read the same source of truth from the database.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DesignPolicy(Base):
    """
    Tenant-scoped design/UX policy.

    Each row is one policy (built-in or custom). Built-in policies are
    auto-seeded per tenant and cannot be deleted (only disabled).

    ``tenant_id`` is a plain indexed UUID rather than a cross-schema FK: coord
    tenants are resolved over the HTTP boundary (see ``get_tenant_id``), so the
    web schema deliberately avoids a hard FK into the coord schema.
    """

    __tablename__ = "design_policies"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)

    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Principle / Rationale / Enforcement — the capture format.
    principle: Mapped[str] = mapped_column(Text, nullable=False, default="")
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    enforcement: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Classification.
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False, default="info"
    )  # info | warning | error
    applies_to: Mapped[str] = mapped_column(
        String(255), nullable=False, default=""
    )  # glob/scope, e.g. "**/*.{tsx,css}" or "all UI"

    is_built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_design_policy_tenant_slug"),
        {"schema": "project"},
    )

    def __repr__(self) -> str:
        """Return string representation of DesignPolicy."""
        return (
            f"<DesignPolicy(id={self.id}, tenant={self.tenant_id}, "
            f"slug='{self.slug}', built_in={self.is_built_in})>"
        )
