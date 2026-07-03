"""
App deployment state tracking for fleet-fresh auto-fresh engine.

Tracks the current deployed state of apps per (device_id, app_id):
- deployed_sha: git commit hash currently deployed on the device
- freshness: state of the deployment (fresh, building, failed)
- timestamps: when deployed and last updated
- last_error: error message if freshness='failed'

Used by P3 auto-fresh engine to record build/restart results and by P4
dispatcher to route tests to fresh hosts.
"""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AppDeploymentFreshness(StrEnum):
    """Deployment freshness states.

    Must stay in lockstep with the DB CHECK constraint
    ``app_deploy_state_freshness_check`` (alembic
    ``app_deploy_state_tracking``) — widening this enum requires a
    companion migration that widens the CHECK.
    """

    FRESH = "fresh"  # deployed_sha == upstream HEAD
    BUILDING = "building"  # pull+build in progress
    FAILED = "failed"  # last build or restart failed


class AppDeployState(Base):
    """
    Tracks deployed app state per (device_id, app_id).

    Used by:
    - P3 auto-fresh engine: records deployed_sha and freshness after build/restart
    - P4 dispatcher: queries for fresh hosts (WHERE freshness='fresh')
    - Dashboard: displays freshness per device+app

    Primary key: (device_id, app_id) — one entry per running app instance.
    Indexes: app_id (dispatcher fan-out), (device_id) WHERE freshness='fresh'.
    """

    __tablename__ = "app_deploy_state"
    __table_args__ = ({"schema": "project"},)

    device_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        doc="Runner device ID publishing this deployment state",
    )
    app_id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        nullable=False,
        doc="Application ID (app_id from project.apps registry)",
    )
    deployed_sha: Mapped[str | None] = mapped_column(
        String(40),
        nullable=True,
        doc="git commit SHA currently running (NULL if unknown or never deployed)",
    )
    # Stored as TEXT + CHECK (see the alembic migration), NOT a PG enum type —
    # `Enum(...)` here would demand a `appdeploymentfreshness` type the
    # migration never creates.
    freshness: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=AppDeploymentFreshness.FAILED.value,
        doc="Deployment state: fresh, building, failed",
    )
    deployed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        doc="When deployed_sha was deployed (updated after successful build/restart)",
    )
    last_error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Error message if freshness='failed' (from build or restart failure)",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        doc="When this row was last updated",
    )
