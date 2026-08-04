"""
Agent command models — account-scoped overrides of the runner's embedded
default agent commands, with an append-only version history.

The runner ships its fleet commands (``/vet-plan``, ``/implement-plan``, …)
embedded in its binary, so out-of-the-box behaviour works offline and
unauthenticated. An organization may store an OVERRIDE that REPLACES a default
by name; resolution order is **account override → embedded default**. There is
no "default row" in this database — deleting an override simply lets the
embedded default apply again.

``AgentCommandVersion`` is the append-only chain: every body write appends a
new row, the parent's ``current_version`` is the head, and a revert writes a
NEW version whose body equals an older one. History rows are never mutated or
deleted.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AgentCommand(Base):
    """An account's override of one embedded agent command."""

    __tablename__ = "agent_commands"
    __table_args__ = (
        # One override per command per account. This deliberately does NOT
        # copy `Skill.slug`'s global `unique=True`, which is a cross-org
        # collision hazard — `(organization_id, name)` is the correct
        # multi-tenant key.
        UniqueConstraint("organization_id", "name", name="uq_agent_command_org_name"),
        {"schema": "project"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    # The command slug provisioned into a session cwd, e.g. "vet-plan".
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # The markdown body of the command.
    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    checksum: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        default=None,
    )

    is_shared: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
    )

    # Head pointer into the version chain.
    current_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
        default=1,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
    )

    versions = relationship(
        "AgentCommandVersion",
        back_populates="agent_command",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<AgentCommand(id={self.id}, name={self.name!r}, "
            f"organization_id={self.organization_id}, "
            f"current_version={self.current_version})>"
        )


class AgentCommandVersion(Base):
    """Immutable snapshot of an agent command's body at one version."""

    __tablename__ = "agent_command_versions"
    __table_args__ = (
        # Load bearing: without it "monotonic" is enforced only by application
        # code, and two concurrent appends both read the same latest version
        # number and write duplicates.
        UniqueConstraint(
            "agent_command_id", "version_number", name="uq_agent_command_version"
        ),
        {"schema": "project"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    agent_command_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.agent_commands.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    version_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    checksum: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        default=None,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    change_description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Which version a revert copied its body from. NULL for an ordinary edit.
    restored_from: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    agent_command = relationship("AgentCommand", back_populates="versions")

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<AgentCommandVersion(id={self.id}, "
            f"agent_command_id={self.agent_command_id}, "
            f"version_number={self.version_number})>"
        )
