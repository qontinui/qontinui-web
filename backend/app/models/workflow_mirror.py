"""Workflow mirror — runner-authored mirror of workflow definitions.

The runner (qontinui-runner) is the source of truth for **execution** of
workflows: workflow definitions live in the runner's SQLite, and runner
processes are the only thing that can actually run a workflow.

But the dashboard needs to browse workflows even when the runner is offline.
For that we maintain a web-PG **mirror** of the workflow definitions, written
through by the runner after every local CRUD. The mirror is owner-scoped
(``tenant_id`` + ``owner_user_id``) and uses last-write-wins driven by the
runner's local ``runner_updated_at`` timestamp.

This is intentionally a NEW table separate from
``project.unified_workflows``. ``unified_workflows`` is a legacy table that
holds the full workflow body for the existing dashboard CRUD; this table
is the always-fresh, runner-owned mirror keyed on the runner's UUID space.
The runner writes here on every SQLite mutation (Phase 3.2 of plan
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``).
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WorkflowMirror(Base):
    """Runner-authored mirror row for a single ``UnifiedWorkflow``.

    ``id`` mirrors the runner's local SQLite ``unified_workflow.id`` — both
    the runner and the web backend agree on the same UUID per workflow.

    Tenancy + ownership are enforced server-side from the device JWT, not
    from the request body. The runner never gets to assert which tenant a
    workflow belongs to.
    """

    __tablename__ = "workflows"
    __table_args__ = (
        Index(
            "ix_workflows_tenant_owner",
            "tenant_id",
            "owner_user_id",
        ),
        {"schema": "project"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        comment="Mirrors runner's local UnifiedWorkflow.id (UUID).",
    )

    tenant_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=False,
        index=True,
        comment=(
            "Resolved server-side from the device JWT — the operator's "
            "home tenant. Never trust the request body."
        ),
    )

    device_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("coord.devices.device_id", ondelete="SET NULL"),
        nullable=True,
        comment=(
            "The runner device that authored this mirror entry. "
            "Nullable so a device deletion does not cascade-delete its "
            "workflows from the mirror."
        ),
    )

    owner_user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="The operator that owns this workflow.",
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    category: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    definition: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment=(
            "Full UnifiedWorkflow payload from the runner — opaque to the "
            "web backend except for indexed fields. Source of truth for "
            "browse rendering; execution still goes through the runner."
        ),
    )

    runner_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment=(
            "The runner's local mtime when this row was authored. Used "
            "for last-write-wins conflict detection — a sync POST with a "
            "runner_updated_at older than the stored row is rejected as "
            "409 Conflict."
        ),
    )

    mirrored_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
        comment="Server-side wall clock when the mirror was last written.",
    )
