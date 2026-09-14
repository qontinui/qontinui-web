"""Per-user Claude account roster (``auth.claude_account_profiles``).

Declares which Claude Code accounts a user has (e.g. ``gmail``, ``hotmail``)
so any runner paired to that user can pull the roster down and rotate
sessions across those accounts — the server-side replacement for the
git-tracked ``qontinui-claude-config/accounts.json`` + per-machine
``install-claude-accounts.sh`` rendering.

This table holds only the PORTABLE, machine-independent facts (account key,
shortcut, email, an optional directory-name override) — exactly the fields
``accounts.json`` already carries. It never stores credentials; those stay
local to each machine's ``.claude-<id>/.credentials.json``, exactly as
today.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

_SCHEMA = "auth"


class ClaudeAccountProfile(Base):
    """One roster entry — one Claude Code account belonging to one user."""

    __tablename__ = "claude_account_profiles"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "account_key", name="uq_claude_account_profiles_user_key"
        ),
        UniqueConstraint(
            "user_id", "shortcut", name="uq_claude_account_profiles_user_shortcut"
        ),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # e.g. "gmail", "hotmail" — matches accounts.json's `id` field.
    account_key: Mapped[str] = mapped_column(String(100), nullable=False)
    # e.g. "clg" — informational only; the runner resolves accounts by
    # directory path/basename, not by this field.
    shortcut: Mapped[str] = mapped_column(String(20), nullable=False)
    # The login address, or NULL when unverified (accounts.json convention:
    # null means "unverified", not "absent").
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # Overrides the derived local directory name (default ".claude-<account_key>")
    # for the rare account that predates that convention.
    dir_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        """Return repr."""
        return (
            f"<ClaudeAccountProfile(user_id={self.user_id}, "
            f"account_key={self.account_key!r})>"
        )
