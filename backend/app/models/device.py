"""Unified device registry model — SQLAlchemy mapping to ``coord.devices``.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
absorbed both ``coord.machines`` (coord-side fleet identity) and
``auth.runners`` (web-side user-paired runner registry) into a single
``coord.devices`` table. The schema is owned by qontinui-coord's
authoritative HTTP surface, but the web backend retains direct read
access via this model since the canonical Postgres instance is shared
across both services.

Writes from the web backend layer should ideally flow through coord's
HTTP surface (e.g. ``POST /coord/devices/register``) so coord remains
the source-of-truth issuer; however, web-managed lifecycle columns
(``last_heartbeat``, ``ui_error``, ``recent_crash``, ``ws_session_id``,
``ws_connected_at``, ``derived_status``) continue to be updated directly
via this model because the WS bridge is the only producer of those
columns.

The user-fingerprinting ``DeviceSession`` model in
``app.models.device_session`` is unrelated and stays in place — it
tracks browser-side login devices, not runner instances.
"""

from datetime import datetime
from uuid import UUID, uuid4

from qontinui_schemas.common import utc_now
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Device(Base):
    """Unified device registry row (``coord.devices``).

    Absorbs the columns of both legacy tables:

    * ``coord.machines`` (fleet identity, liveness, capacity) —
      capability_coord_target = true.
    * ``auth.runners`` (user-paired runner registry) —
      capability_user_paired = true.
    """

    __tablename__ = "devices"
    __table_args__ = {"schema": "coord"}

    # ---- Identity ----------------------------------------------------------
    device_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Paired user; NULL for system devices.",
    )

    name: Mapped[str] = mapped_column(
        String,
        nullable=False,
        comment="Human-readable device name (absorbed from auth.runners.name).",
    )

    hostname: Mapped[str] = mapped_column(
        String,
        nullable=False,
        index=True,
        comment="Hostname the device is reachable at (not unique).",
    )

    os: Mapped[str | None] = mapped_column(String, nullable=True)
    os_version: Mapped[str | None] = mapped_column(String, nullable=True)

    port: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Runner HTTP listener port (NULL for non-runner devices).",
    )

    # ---- Capability flags --------------------------------------------------
    capability_coord_target: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    capability_user_paired: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    capability_web_controlled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    capabilities: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
    )

    # ---- Liveness (Row-9 Phase 3 — from coord.machines) -------------------
    state: Mapped[str] = mapped_column(
        String,
        nullable=False,
        index=True,
        comment="healthy | degraded | partitioned | abandoned",
    )
    state_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    health_url: Mapped[str | None] = mapped_column(String, nullable=True)
    last_probe_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_probe_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )

    # ---- Runner-side derived status (absorbed from auth.runners) -----------
    derived_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        server_default=text("'offline'"),
        comment="healthy | unhealthy | offline",
    )
    ui_error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    recent_crash: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    restate_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    restate_healthy: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # ---- WS connection state (absorbed from auth.runners) ------------------
    ws_session_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
        comment=(
            "id of the open coord.device_connections row while the device's "
            "WebSocket is connected; NULL when disconnected."
        ),
    )
    ws_connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ---- Capacity (fleet Phase 1 budget columns — from coord.machines) -----
    role: Mapped[str | None] = mapped_column(String, nullable=True)
    cpu_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    memory_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ``disk_total_gb`` + ``disk_reserved_gb`` are BIGINT in the migration
    # (alembic/versions/ud01_unify_devices_registry.py:239-244). ``disk_total_gb``
    # is nullable; ``disk_reserved_gb`` is NOT NULL DEFAULT 0. The Python-side
    # ``default=0`` on ``disk_reserved_gb`` is load-bearing: without it,
    # SQLAlchemy emits an explicit ``NULL`` in the INSERT when the application
    # omits the column (devices_ws.py's runner_info handler does), which
    # overrides the server-side default and trips the NOT NULL constraint
    # (asyncpg.exceptions.NotNullViolationError, surfaced 2026-05-21 by the
    # post-unified-devices live-stack smoke after the JWT path was unblocked
    # by qontinui-web #184).
    disk_total_gb: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    disk_reserved_gb: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default=text("0"),
    )
    max_concurrent_agents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_concurrent_builds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    budget_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ---- CI Runner capability (Phase 4c self-hosted CI runners) -------------
    ci_runner_status: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="idle | busy | offline — NULL when the device has no CI runner.",
    )
    #
    # ``TEXT[]``, NOT ``JSONB``. Both authorities agree and this model was the
    # only thing that disagreed: alembic — the sole author of ``coord.*`` DDL —
    # created the column as ``TEXT[]``
    # (``c5d6e7f8a9b0_add_ci_runner_columns_to_devices.py``), and coord declares
    # the same in ``device_state.rs``'s self-heal helper. A ``JSONB`` mapping
    # over a ``TEXT[]`` column is a *silent* mismatch: nothing writes this
    # column from the web side (coord's ``ci_runner_registrar`` is the only
    # writer), and the rows it writes are invisible to the web read's
    # ``capability_user_paired`` filter, so the wrong type had no live reader to
    # fail on. It would have failed the moment one appeared. Corrected by plan
    # ``2026-08-20-fleet-page-runner-enable-disable-switch`` Phase 2, which is
    # that reader. **No migration** — the DDL was always ``TEXT[]``; this is the
    # model catching up to it.
    ci_runner_labels: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text),
        nullable=True,
        comment='CI runner labels, e.g. ["self-hosted", "linux", "x64"].',
    )
    ci_runner_last_job_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Timestamp of the most recent CI job executed by this runner.",
    )

    # ---- Audit -------------------------------------------------------------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=text("now()"),
        nullable=False,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_heartbeat: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_ip_address: Mapped[str | None] = mapped_column(String, nullable=True)
    last_user_agent: Mapped[str | None] = mapped_column(String, nullable=True)

    # ---- Relationships -----------------------------------------------------
    user = relationship("User", back_populates="devices")

    # ---- CI-runner categorisation (single definition) ----------------------
    #
    # THE canonical answer to "is this row infrastructure or a workstation?".
    # Defined once here so the API, the aggregates and the UI cannot drift
    # into three different answers.
    #
    # Why NOT ``ci_runner_status is not None``, the predicate this replaced:
    # ``coord.devices.ci_runner_status`` is nullable **with**
    # ``DEFAULT 'offline'``, so any insert path that simply omits the column
    # yields a non-NULL value on an ordinary workstation and misclassifies it
    # as CI infrastructure. Today every writer binds the column explicitly, so
    # the old predicate happened to be right — but it was right by accident,
    # and one new insert path would have broken it silently.
    #
    # ``capability_user_paired`` + ``ci_runner_labels`` has no such hole:
    # a CI runner is registered programmatically (never paired to a human, so
    # ``capability_user_paired`` is false) and always carries the GitHub label
    # set that made it a runner in the first place. Neither half defaults into
    # a wrong answer.
    @property
    def is_ci_runner(self) -> bool:
        """True when this row is CI infrastructure rather than a workstation.

        Mirrors the SQL predicate
        ``capability_user_paired = false AND ci_runner_labels IS NOT NULL``.
        """
        return not self.capability_user_paired and self.ci_runner_labels is not None

    # ---- Legacy compat alias (Phase 5 — Unified Devices Registry) ---------
    #
    # The legacy ``Runner`` model exposed an ``id`` primary key; the
    # unified ``Device`` model renames it to ``device_id`` for symmetry
    # with coord's HTTP surface. The ``id`` Python-level alias below
    # preserves source-code compat for in-flight migrations of the
    # broader fleet of WS-bridge HTTP handlers. The DB column is
    # ``device_id``; do NOT add an ``id`` Mapped column.
    @property
    def id(self) -> UUID:  # pragma: no cover - trivial alias
        """Legacy alias for :attr:`device_id`."""
        return self.device_id

    def __repr__(self) -> str:
        """Return string representation of the device."""
        return (
            f"<Device(device_id={self.device_id}, name={self.name!r}, "
            f"state={self.state}, host={self.hostname})>"
        )
