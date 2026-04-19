"""
Runner fleet registry model.

Distinct from :class:`~app.models.runner_connection.RunnerConnection` (which
tracks transient WebSocket sessions) and :class:`~app.models.runner_token.RunnerToken`
(which holds credentials), a ``Runner`` row represents a long-lived
registration of a server-mode/headless runner instance. The runner registers
on startup, heartbeats periodically, and is deregistered when shut down.
"""

import secrets
from datetime import datetime
from uuid import UUID, uuid4

from qontinui_schemas.common import utc_now
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _new_dispatch_secret() -> str:
    """Mirror of ``server_default`` for Python-side inserts.

    Using both a Python ``default`` and a ``server_default`` is intentional:
    the server_default handles raw SQL inserts (migrations, test fixtures
    bypassing the ORM), while the Python default keeps us working on test
    databases where the ``pgcrypto`` extension isn't installed and
    ``gen_random_bytes`` doesn't exist.
    """
    return secrets.token_hex(32)


class Runner(Base):
    """Registered server-mode runner instance.

    A runner is identified by ``(user_id, name)`` — re-registering with the
    same name updates the existing row rather than creating a duplicate.
    """

    __tablename__ = "runners"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="User-provided runner name (unique per user)",
    )

    hostname: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Host the runner is reachable at",
    )

    port: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="TCP port the runner's HTTP/WS API listens on",
    )

    capabilities: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        comment="Feature flags advertised by the runner (gui_automation, accessibility, ...)",
    )

    server_mode: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
        comment="True for headless / Restate-backed runners",
    )

    restate_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )

    restate_healthy: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )

    last_heartbeat: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'offline'"),
        index=True,
        comment="healthy | unhealthy | offline",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=text("now()"),
        nullable=False,
    )

    runner_token_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("runner_tokens.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Token used at registration (nullable for legacy/test)",
    )

    # Per-runner machine-to-machine dispatch secret.
    #
    # Stored plaintext (64-hex = 32 random bytes). This is an intentional
    # tradeoff: web needs to *use* the secret to authenticate when POSTing
    # `/api/workflows/run` on the runner, so we cannot hash it. The blast
    # radius is one runner — rotation is handled by re-registration, which
    # overwrites the column.
    dispatch_secret: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        default=_new_dispatch_secret,
        server_default=text("encode(gen_random_bytes(32), 'hex')"),
        comment=(
            "Per-runner m2m secret used by web to authenticate workflow "
            "dispatch POSTs to the runner. Stored plaintext; rotated on "
            "re-registration."
        ),
    )

    # Relationships
    user = relationship("User", back_populates="runners")
    runner_token = relationship(
        "RunnerToken", back_populates="runners", foreign_keys=[runner_token_id]
    )

    def __repr__(self) -> str:
        """Return string representation of the runner."""
        return (
            f"<Runner(id={self.id}, name={self.name!r}, "
            f"status={self.status}, host={self.hostname}:{self.port})>"
        )
