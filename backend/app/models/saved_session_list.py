"""A saved snapshot of one runner's terminal tabs and the sessions in them.

Plan ``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``,
Phase 2. A row is written only by the capture route
(``POST /api/v1/saved-session-lists``), which relays one ``GET
/terminal-layout`` to the runner that owns the device's relay socket and keeps
what the runner said (D1). It is never a client-posted payload.

* ``layout`` is the runner's body exactly as relayed, after it validated
  against the generated ``TerminalLayout`` model, plus one key the web adds: a
  top-level ``coordStatus`` map, keyed by ``claudeSessionId``, holding coord's
  work-axis answer for that session at capture time (D10). The body is kept
  raw rather than re-dumped from the model, so a field a newer runner adds is
  kept even though this backend's model does not declare it (D9).
* ``runner_instance`` / ``runner_port`` / ``runner_build_id`` are what the
  runner reported about itself (``layout.runner``), never caller input (D4).
* ``captured_at`` is THIS backend's clock at capture, and ``expires_at`` is
  ``captured_at`` plus :data:`SAVED_SESSION_LIST_RETENTION`. A runner with a
  skewed clock cannot shift retention. The runner's own ``capturedAt`` stays
  inside ``layout`` (D5).
* Visibility follows device access: any user who passes the relay's
  device-ownership check for ``device_id`` can read and delete the row. The
  creator is recorded, not used for access (D6).

Retention is enforced twice (D5): every read filters ``expires_at > now`` so
expiry is exact, and the hourly ``saved_session_lists_cleanup`` job deletes
expired rows. A device keeps at most :data:`SAVED_SESSION_LISTS_PER_DEVICE`
rows; the capture deletes the oldest beyond that.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: How long a saved list lives (the operator's "auto-delete after 14 days").
SAVED_SESSION_LIST_RETENTION = timedelta(days=14)

#: The newest lists a device keeps. The capture deletes older ones.
SAVED_SESSION_LISTS_PER_DEVICE = 50


class SavedSessionList(Base):
    """One saved per-tab list of a runner's open sessions (see module docs)."""

    __tablename__ = "saved_session_lists"
    __table_args__ = (
        # The list route's filter: a caller's devices, unexpired.
        Index("ix_saved_session_lists_device_id_expires_at", "device_id", "expires_at"),
        # The purge job's filter.
        Index("ix_saved_session_lists_expires_at", "expires_at"),
        {"schema": "project"},
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # coord's device id. No foreign key: coord.devices is coord's table, read
    # over coord's HTTP boundary, never joined from here.
    device_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    runner_instance: Mapped[str | None] = mapped_column(Text, nullable=True)
    runner_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    runner_build_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    tab_count: Mapped[int] = mapped_column(Integer, nullable=False)
    session_count: Mapped[int] = mapped_column(Integer, nullable=False)
    layout: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
