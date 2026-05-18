"""Recording-pipeline run model.

Tracks an in-flight or completed recording-pipeline WS-bridge dispatch.
Created by ``POST /api/v1/recording-pipeline/{process,process-with-playbook,merge}``
in status ``queued``; updated by a background subscriber task as the
runner publishes the terminal ``recording_pipeline_result`` event;
queryable via ``GET /api/v1/recording-pipeline/runs/{run_id}``.

The row outlives the originating HTTP request — that's the whole point
of the async-with-progress design: minute-scale pipeline work persists
even if the web process restarts (boot-time recovery re-spawns the
subscriber for any row still in ``queued`` / ``running`` within the
TTL window).

Schema: ``project.recording_pipeline_runs`` (alembic
``rp01_add_recording_pipeline_runs``). Phase 4 of plan
``plans/2026-05-17-web-runner-ws-bridge-plan-b.md``.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RecordingPipelineRun(Base):
    """A recording-pipeline async dispatch.

    Lifecycle:

    1. ``queued`` (insert by the HTTP handler before dispatching to the
       runner).
    2. ``running`` (background subscriber task observes the dispatch ack
       OR a progress event from the runner).
    3. ``completed`` / ``failed`` (terminal; subscriber persists the
       result/error JSON and exits).
    4. ``timed_out`` (boot-time recovery sweep flips rows whose
       ``updated_at`` is older than the 30-minute TTL).
    """

    __tablename__ = "recording_pipeline_runs"
    __table_args__ = {"schema": "project"}

    # Long-lived run id; matches the runner-side ``run_id`` correlation
    # carried in every progress + result event.
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
    )

    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="CASCADE"),
        nullable=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    runner_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=False,
    )
    command_type: Mapped[str] = mapped_column(
        String(),
        nullable=False,
        comment=("One of recording_pipeline.process / .process_with_playbook / .merge"),
    )
    status: Mapped[str] = mapped_column(
        String(),
        nullable=False,
        server_default=text("'queued'"),
        comment="queued | running | completed | failed | timed_out",
    )

    progress_stage: Mapped[str | None] = mapped_column(
        String(),
        nullable=True,
        comment=(
            "Latest progress stage label from the runner; one of the "
            "qontinui_schemas.commands.recording_pipeline.ProgressStage "
            "literals."
        ),
    )
    progress_pct: Mapped[float | None] = mapped_column(Float(), nullable=True)
    progress_message: Mapped[str | None] = mapped_column(String(), nullable=True)

    result_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(),
        nullable=True,
        comment=(
            "Serialised RecordingPipelineResult payload on success "
            "(see qontinui_schemas.commands.recording_pipeline."
            "ProcessRecordingResult.result docstring)."
        ),
    )
    error_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(),
        nullable=True,
        comment="{error, message, traceback} on failure.",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
