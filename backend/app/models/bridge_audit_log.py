"""``web.bridge_audit_log`` — one row per UI Bridge co-pilot write command.

§4.8 of the production-safe UI Bridge plan
(``D:/qontinui-root/plans/2026-05-28-production-safe-ui-bridge-design.md``).

Read-mostly: the Next.js relay route writes (one row per write command
fire-and-forget); the audit-log viewer reads (user-scoped, paginated).

The ``payload_summary`` column is SAFE-SUMMARY-ONLY:

* allowed: ``{action: "click", elementId: "btn-42"}``
* allowed: ``{action: "type", elementId: "input-3", textLength: 8}``
* FORBIDDEN: the text actually typed.

The middleware logs the FACT a write happened, NOT the secret it carried.
"""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.base import Base


class BridgeAuditLog(Base):
    """One row per UI Bridge co-pilot write command (POST/PUT/DELETE)."""

    __tablename__ = "bridge_audit_log"
    __table_args__ = (
        Index(
            "ix_bridge_audit_log_user_id_occurred_at",
            "user_id",
            text("occurred_at DESC"),
        ),
        Index("ix_bridge_audit_log_session_id", "session_id"),
        {"schema": "web"},
    )

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    session_id = Column(String(128), nullable=True)
    tab_id = Column(String(128), nullable=True)
    command_name = Column(String(128), nullable=False)
    target_element_id = Column(String(256), nullable=True)
    path = Column(String(512), nullable=False)
    method = Column(String(16), nullable=False)
    origin = Column(String(256), nullable=True)
    status_code = Column(Integer, nullable=False)
    # Execution outcome distinct from the relay-receipt ``status_code`` (Bug 3b).
    # ``status_code`` is the HTTP status the relay returned (200 on *delivery*);
    # ``execution_status`` records whether the TARGET TAB actually ran the
    # command, derived from the relay response body's ``success``/``code``:
    #   - ``received`` — relay delivered; tab outcome not (yet) known (default).
    #   - ``executed`` — tab confirmed the command ran (route changed / acted).
    #   - ``failed``   — tab reported the command did NOT execute (timeout /
    #                    error / no browser), even when ``status_code`` is 200.
    # CHECK + ``DEFAULT 'received'`` live in migration bridge_audit_log_02.
    execution_status = Column(
        String(16),
        nullable=False,
        server_default=text("'received'"),
    )
    occurred_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("NOW()"),
    )
    payload_summary = Column(JSONB, nullable=True)
