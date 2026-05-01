"""
Runner fleet registry model.

Distinct from :class:`~app.models.runner_session.RunnerSession` (which
tracks WebSocket session history) and
:class:`~app.models.runner_token.RunnerToken` (which holds credentials),
a ``Runner`` row represents a long-lived registration of a runner
instance. The runner registers on startup via WebSocket, heartbeats
over the same WS connection, and is deregistered when shut down.
"""

from datetime import datetime
from uuid import UUID, uuid4

from qontinui_schemas.common import utc_now
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Runner(Base):
    """Registered server-mode runner instance.

    A runner is identified by ``(user_id, name)`` — re-registering with the
    same name updates the existing row rather than creating a duplicate.
    """

    __tablename__ = "runners"
    __table_args__ = {"schema": "auth"}

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

    # WebSocket presence — id of the open RunnerSession row, or NULL while
    # disconnected. Definitive "is the runner online right now" signal —
    # complements ``last_heartbeat`` which is the freshness measure.
    ws_session_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
        comment=(
            "id of the open runner_sessions row while the runner's WebSocket "
            "is connected; NULL when disconnected. Authoritative liveness "
            "signal — distinct from last_heartbeat (freshness)."
        ),
    )

    ws_connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the current WebSocket session opened, NULL when offline.",
    )

    os: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Operating system family ('windows' / 'macos' / 'linux').",
    )

    os_version: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Operating system version string.",
    )

    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'offline'"),
        index=True,
        comment="healthy | unhealthy | offline",
    )

    # Runner-derived overall status (Phase 3J) — distinct from ``status`` which
    # is the runner's self-reported liveness. Computed by the runner from
    # multiple sub-signals (Restate health, UI errors, ...) and one of
    # ``healthy`` | ``degraded`` | ``errored`` | ``offline`` | ``starting``.
    # Nullable because pre-Phase-3J runners omit it from their heartbeat.
    derived_status: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment=(
            "Runner-derived overall status "
            "(healthy|degraded|errored|offline|starting); NULL for runners "
            "that have not yet reported a Phase 3J heartbeat."
        ),
    )

    # Most recent UI error reported by the runner (React error boundary
    # payload) or ``NULL`` if no error is currently outstanding. Cleared when
    # the runner's error boundary recovers.
    ui_error: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment=(
            "Most recent UI error reported by the runner "
            "(message/stack/component_stack/digest/first_seen/reported_at/"
            "count) or NULL if none is outstanding."
        ),
    )

    # Most recent Rust crash dump surfaced by the runner's startup scanner
    # (``file_path/reported_at/panic_location/panic_message/thread``) or
    # ``NULL`` when no fresh dump is present. Post-3J follow-up: non-unwinding
    # Rust panics abort the process before the React boundary can fire, so
    # this column is the only fleet-level signal for that class.
    recent_crash: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment=(
            "Most recent Rust crash dump surfaced by the runner's startup "
            "scanner (file_path/reported_at/panic_location/panic_message/"
            "thread) or NULL if no fresh dump is present."
        ),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=text("now()"),
        nullable=False,
    )

    runner_token_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.runner_tokens.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Token used at registration (nullable for legacy/test)",
    )

    # Relationships
    user = relationship("User", back_populates="runners")
    runner_token = relationship(
        "RunnerToken", back_populates="runners", foreign_keys=[runner_token_id]
    )
    sessions = relationship(
        "RunnerSession",
        back_populates="runner",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        """Return string representation of the runner."""
        return (
            f"<Runner(id={self.id}, name={self.name!r}, "
            f"status={self.status}, host={self.hostname}:{self.port})>"
        )
