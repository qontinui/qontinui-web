"""Fleet-fresh test-host designation — SQLAlchemy mapping to ``coord.test_targets``.

One row per ``(device, app)`` an operator has designated as a test host for
fleet-fresh routing (see plan
``2026-06-20-fleet-fresh-test-target-routing.md``, phase P5).

* The runner's auto-fresh engine polls
  ``GET /coord/trees/test-targets/by-device/{device_id}`` each tick and
  refreshes any row with ``auto_fresh = true``.
* The P4 dispatcher treats a designation as "this device is allowed to
  receive test traffic for this app".

The table is authored by alembic (``coord_test_targets`` revision) with a
runtime self-heal on the coord side; the web backend reads AND writes it
directly via this model — the same shared-Postgres posture the
:class:`app.models.device.Device` model uses against ``coord.devices``.

``tenant_id`` is NOT NULL: writes are operator-scoped (the writer resolves
the caller's coord home tenant via ``operations.get_tenant_id``); the
device-keyed runner read resolves the tenant server-side from ``device_id``.
"""

from datetime import datetime
from uuid import UUID

from qontinui_schemas.common import utc_now
from sqlalchemy import Boolean, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TestTarget(Base):
    """Designation row (``coord.test_targets``).

    Primary key ``(device_id, app_id)`` — one designation per running app
    instance on a device. A device can host many apps; many devices can host
    one app (load-balanced fresh routing).
    """

    __tablename__ = "test_targets"
    __table_args__ = ({"schema": "coord"},)

    device_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        doc="Runner device designated as a test host.",
    )
    app_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
        doc="Application ID (app_id from project.apps registry).",
    )
    tenant_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=False,
        doc="Coord tenant that owns this designation (operator-scoped write).",
    )
    auto_fresh: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
        doc="When true, the runner keeps this device's build of app_id current.",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=text("now()"),
    )
