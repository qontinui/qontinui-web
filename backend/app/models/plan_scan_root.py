"""Per-device plan-scan-source readings — ``agent.plan_scan_root_observations``.

Revised Phase 2 of ``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.
Mirrors alembic revision ``plan_library_05_scan_root_observations``; read that
migration's docstring for why the table exists and why its key is what it is.

One row per ``(organization, device)``: the LATEST reading that device's runner
made of the directory its plan-library body sync scans — how far that git work
tree is from its default branch, and how fresh the ref it measured against is.
Each report newer than the stored one (by ``observed_at``) overwrites the
reading, and EVERY report stamps ``received_at``. There is no history: the
question this row answers is "what does the corpus's feeder on device D look
like now", and a device not heard from within the freshness window (by
``received_at``, this server's clock) is rendered ``unknown`` by the read route
rather than kept around as a series.

The fields are the runner's ``ScanDivergence``
(``qontinui-runner/src-tauri/src/plan_workunit_adapter/trigger.rs``) plus
``ref_age_secs`` / ``counts_are_floors`` (this plan's Revised Phase 1) and
``source_repo``, carried verbatim. ``device_id`` is NEVER a request field — it
is the verified device token's ``device_id`` claim.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.work_artifact import NIL_ORGANIZATION_ID

#: The four states a runner's reading can be in. Enforced in Postgres by
#: ``ck_plan_scan_root_observations_state``; mirrored as a ``Literal`` on the
#: request schema so a bad value is a 422, not an IntegrityError 500. Spelled
#: exactly as the runner's ``ScanDivergenceState`` serializes.
SCAN_ROOT_STATES: tuple[str, ...] = (
    "measured",
    "not_scanning",
    "not_a_git_work_tree",
    "unknown",
)

#: The NULL-collapsing organization expression of the identity index, spelled
#: once. The upsert's ``ON CONFLICT`` target must be this exact expression for
#: Postgres to infer the index, so both are built from this string.
IDENTITY_ORG_SQL = f"coalesce(organization_id, '{NIL_ORGANIZATION_ID}'::uuid)"


class PlanScanRootObservation(Base):
    """The latest scan-source reading one device reported for one organization."""

    __tablename__ = "plan_scan_root_observations"
    __table_args__ = (
        # Identity — one row per (org, device). NULL-collapsing for the same
        # reason ``uq_work_artifacts_identity`` is: a plain UNIQUE over a
        # nullable column does not bind (NULL <> NULL), and a principal with no
        # personal organization is scoped to the NULL bucket by the same
        # resolver the artifact upsert uses.
        Index(
            "uq_plan_scan_root_observations_identity",
            text(IDENTITY_ORG_SQL),
            text("device_id"),
            unique=True,
        ),
        CheckConstraint(
            "state IN ('measured', 'not_scanning', 'not_a_git_work_tree', 'unknown')",
            name="ck_plan_scan_root_observations_state",
        ),
        CheckConstraint(
            "(behind IS NULL OR behind >= 0) "
            "AND (ahead IS NULL OR ahead >= 0) "
            "AND (ref_age_secs IS NULL OR ref_age_secs >= 0)",
            name="ck_plan_scan_root_observations_counts_nonnegative",
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # No FK, matching ``agent.work_artifacts.organization_id``: the scope is
    # derived from the reporting principal's personal organization and may be
    # the NULL bucket. Never accepted from a request body.
    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )

    # The verified device token's ``device_id`` claim. FK-less for the same
    # reason: the device registry is coord's, not this schema's.
    device_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)

    state: Mapped[str] = mapped_column(Text, nullable=False)
    plans_dir: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_root: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_repo: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    ref_sha: Mapped[str | None] = mapped_column(Text, nullable=True)
    head_sha: Mapped[str | None] = mapped_column(Text, nullable=True)

    # BIGINT because the runner's fields are ``u64``; the request schema caps
    # them at the BIGINT ceiling so an out-of-range value is a 422.
    behind: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ahead: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ref_age_secs: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    counts_are_floors: Mapped[bool] = mapped_column(Boolean, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: When the RUNNER took the reading (its clock).
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    #: When THIS server received the device's latest report (our clock) —
    #: stamped on every report, including one declined as out of order. The
    #: only stamp liveness is judged from.
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    #: Whether the device's LATEST report was applied. ``False`` means its
    #: latest report was observed before the stored reading (a clock step-back
    #: or a late-delivered report): the stored reading may not be what the
    #: device says now, and the read route renders ``reading_superseded``.
    last_report_applied: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    #: The ``observed_at`` of the device's latest report, applied or not. Equal
    #: to ``observed_at`` while ``last_report_applied``; otherwise earlier — by
    #: the N the ``reading_superseded`` detail reports.
    last_report_observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    #: When this device first reported for this organization.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )
