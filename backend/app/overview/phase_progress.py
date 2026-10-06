"""A phase's progress — the ``phase_progress`` resource — and the forecast.

Plan ``2026-09-20-overview-authoring-layer`` Phase 4: gate outcomes and actual
phase dates are recorded on the Timeline.

**Why a resource of its own, rather than a field of the estimate.** A phase
lives inside the estimate's content graph, whose only write is a whole-graph
replace under the ESTIMATE's version. Recording a gate outcome through that
write would (a) move the estimate's version, so every open estimate editor's
next Save became a conflict over fields its page never shows, and (b) on a
"keep mine", put the old outcome back. So the two are split by ownership:

* the estimate's content write owns the PLAN (name, planned dates, stated
  weeks, the gate's criteria) and refuses a progress field outright;
* this resource owns the PROGRESS (``actual_start``, ``actual_end``,
  ``gate_status``, ``gate_decided_at``, ``gate_notes``) under its own
  version, ``phases.progress_version``;
* and a content write keeps a phase whose code it keeps (same row, same id),
  so recorded progress survives every Save in the estimate editor.

Neither write can therefore overwrite, or conflict with, the other, and both
stay on the contract: ``If-Match`` with a 409 that carries the server's copy,
a change-log row per write, the served ``can_edit`` (``editing_roles``, as for
the estimate itself). There is no create or delete — a phase is created and
removed by the estimate's plan.

``GET /estimates/{id}/forecast`` (below) is the Timeline's derived figures:
current phase, next gate, forecast finish and slip. See
:mod:`app.services.overview_forecast`.

**Tenancy.** Every query filters on ``ctx.access.tenant_id``; another
project's phase reads as 404.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_async_db
from app.crud import overview_settings
from app.models.overview import Estimate, Phase
from app.overview.permissions import OverviewAccess, get_overview_access
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.schemas.overview import (
    PhaseProgressRead,
    PhaseProgressUpdate,
    TimelineForecast,
    phase_progress_problem,
)
from app.services.overview_forecast import compute_forecast
from app.services.overview_rollup import stringify_decimals


def _now() -> datetime:
    return datetime.now(UTC)


def _parse_id(record_id: str) -> UUID:
    try:
        return UUID(record_id)
    except ValueError as exc:
        raise RecordNotFound(record_id) from exc


# ---------------------------------------------------------------------------
# The database's coherence CHECKs, as a refusal a user can act on
# ---------------------------------------------------------------------------

#: The CHECKs on ``overview.phases`` that a phase's recorded progress must
#: satisfy, each with the fields it is about and what breaking it means.
#: ``…_actual_end_has_start`` and ``…_gate_decision_dated`` were added
#: ``NOT VALID`` (``overview_04b_phase_progress_checks``), so a row stored
#: before them can still break one — and then ANY later UPDATE of that row,
#: even one that only renames the phase, is refused by the database.
PROGRESS_CHECKS: dict[str, tuple[tuple[str, ...], str]] = {
    "ck_overview_phases_actual_order": (
        ("actual_start", "actual_end"),
        "its actual end is before its actual start",
    ),
    "ck_overview_phases_actual_end_has_start": (
        ("actual_start", "actual_end"),
        "it has an actual end but no actual start",
    ),
    "ck_overview_phases_gate_decision_dated": (
        ("gate_status", "gate_decided_at"),
        "its gate is decided with no decision date, or pending with one",
    ),
}


def violated_progress_check(exc: IntegrityError) -> str | None:
    """The name of the :data:`PROGRESS_CHECKS` constraint ``exc`` violated,
    or ``None`` when it is another integrity error (which the caller must
    then let through unchanged).

    asyncpg carries the name structurally as ``constraint_name`` on the
    original error, which SQLAlchemy's adapter chains as ``__cause__``; the
    message text is the fallback for any other driver."""
    orig = exc.orig
    for err in (orig, getattr(orig, "__cause__", None)):
        name = getattr(err, "constraint_name", None)
        if isinstance(name, str) and name:
            return name if name in PROGRESS_CHECKS else None
    message = str(orig)
    return next((name for name in PROGRESS_CHECKS if name in message), None)


def stored_progress_breaks(phase: Phase) -> list[str]:
    """Which :data:`PROGRESS_CHECKS` the phase's values, as they stand on the
    loaded row, break — the same predicates as the CHECKs, in Python."""
    broken: list[str] = []
    if (
        phase.actual_start is not None
        and phase.actual_end is not None
        and phase.actual_end < phase.actual_start
    ):
        broken.append("ck_overview_phases_actual_order")
    if phase.actual_end is not None and phase.actual_start is None:
        broken.append("ck_overview_phases_actual_end_has_start")
    if (phase.gate_status == "pending") != (phase.gate_decided_at is None):
        broken.append("ck_overview_phases_gate_decision_dated")
    return broken


def incoherent_recorded_progress(code: str | None, constraints: list[str]) -> str:
    """The sentence a 422 ``incoherent_recorded_progress`` carries: which
    phase (``None`` when the caller cannot tell), which fields, what is wrong
    with them, and where to fix it."""
    fields: list[str] = []
    reasons: list[str] = []
    for name in constraints:
        names, reason = PROGRESS_CHECKS[name]
        fields.extend(f for f in names if f not in fields)
        reasons.append(reason)
    detail = "; ".join(reasons) if reasons else "it does not add up"
    named = ", ".join(fields) if fields else "its actual dates and gate"
    subject = f"Phase {code}'s" if code else "A phase's"
    target = f"phase {code}'s" if code else "that phase's"
    return (
        f"{subject} recorded progress is incoherent ({detail}), so it "
        f"cannot be saved until that is corrected. Correct {target} "
        f"recorded progress on the Timeline ({named}), then try again."
    )


def _to_read(row: Phase) -> PhaseProgressRead:
    return PhaseProgressRead(
        id=str(row.id),
        estimate_id=row.estimate_id,
        code=row.code,
        name=row.name,
        sort_order=row.sort_order,
        planned_start=row.planned_start,
        planned_end=row.planned_end,
        gate_criteria=row.gate_criteria,
        actual_start=row.actual_start,
        actual_end=row.actual_end,
        gate_status=row.gate_status,  # type: ignore[arg-type]
        gate_decided_at=row.gate_decided_at,
        gate_notes=row.gate_notes,
        # NULL only on a row the migration's default somehow missed.
        version=row.progress_version or 1,
        updated_at=row.progress_updated_at,
        updated_by=row.progress_updated_by,
    )


async def project_estimate(
    db: AsyncSession, tenant_id: UUID, estimate_id: str | None
) -> Estimate | None:
    """The estimate a Timeline read is about: the one named, else the
    project's baseline, else its newest — the rule the overview pages use
    (``pickBaseline``), so the Timeline and the Team page show one estimate.
    """
    stmt = select(Estimate).where(Estimate.tenant_id == tenant_id)
    if estimate_id is not None:
        try:
            stmt = stmt.where(Estimate.id == UUID(estimate_id))
        except ValueError:
            return None
    stmt = stmt.order_by(Estimate.is_baseline.desc(), Estimate.created_at.desc())
    return (await db.execute(stmt.limit(1))).scalars().first()


class PhaseProgressStore:
    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> Phase:
        stmt = select(Phase).where(
            Phase.id == _parse_id(record_id),
            Phase.tenant_id == ctx.access.tenant_id,
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        row = (await ctx.db.execute(stmt)).scalars().first()
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        """The phases of one estimate, in plan order: ``estimate_id`` names
        it, else the project's baseline (else its newest). A project with no
        estimate has no phases — an empty list, which is what it is."""
        named = next(iter(filters.get("estimate_id") or []), None)
        estimate = await project_estimate(ctx.db, ctx.access.tenant_id, named)
        if estimate is None:
            return ListResult(items=[])
        rows = (
            (
                await ctx.db.execute(
                    select(Phase)
                    .where(Phase.estimate_id == estimate.id)
                    .order_by(Phase.sort_order, Phase.code)
                )
            )
            .scalars()
            .all()
        )
        return ListResult(items=[_to_read(r) for r in rows])

    async def get(self, ctx: StoreContext, record_id: str) -> PhaseProgressRead:
        return _to_read(await self._load(ctx, record_id))

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: PhaseProgressUpdate,
        expected_version: int,
    ) -> tuple[PhaseProgressRead, PhaseProgressRead]:
        row = await self._load(ctx, record_id, lock=True)
        before = _to_read(row)
        if before.version != expected_version:
            raise StaleVersion(before)
        changes = {
            k: v
            for k, v in payload.model_dump(exclude_unset=True).items()
            if getattr(row, k) != v
        }
        if not changes:
            return before, before
        problem = phase_progress_problem(
            actual_start=changes.get("actual_start", row.actual_start),
            actual_end=changes.get("actual_end", row.actual_end),
            gate_status=changes.get("gate_status", row.gate_status),
            gate_decided_at=changes.get("gate_decided_at", row.gate_decided_at),
            today=_now().date(),
        )
        if problem:
            raise StoreRefused(422, "invalid_progress", f"{row.code}: {problem}")
        code = row.code
        try:
            # A savepoint, so a refusal by the database's own CHECKs (a
            # writer that went around ``phase_progress_problem``, or the two
            # drifting apart) rolls back this write alone and answers a 422
            # naming the fields, never a 500 on an aborted transaction.
            async with ctx.db.begin_nested():
                for key, value in changes.items():
                    setattr(row, key, value)
                row.progress_version = before.version + 1
                row.progress_updated_at = _now()
                row.progress_updated_by = ctx.access.actor
                await ctx.db.flush()
        except IntegrityError as exc:
            constraint = violated_progress_check(exc)
            if constraint is None:
                raise
            raise StoreRefused(
                422,
                "incoherent_recorded_progress",
                incoherent_recorded_progress(code, [constraint]),
            ) from exc
        return before, _to_read(row)


def phase_progress_store() -> PhaseProgressStore:
    """FastAPI dependency (a class instance so tests can override it)."""
    return PhaseProgressStore()


# ---------------------------------------------------------------------------
# Routes beyond the contract: the forecast
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/estimates/{estimate_id}/forecast", response_model=TimelineForecast)
async def read_forecast(
    estimate_id: str,
    request: Request,
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> TimelineForecast:
    """Where the delivery stands against the plan: the current phase, the next
    gate, the forecast finish and its slip. Computed on read against today
    (UTC); readable by any member. A figure that cannot be produced is null
    and named in ``unavailable``, never 0."""
    del request
    try:
        parsed = UUID(estimate_id)
    except ValueError:
        parsed = None
    estimate = None
    if parsed is not None:
        estimate = (
            (
                await db.execute(
                    select(Estimate)
                    .where(
                        Estimate.id == parsed, Estimate.tenant_id == access.tenant_id
                    )
                    .options(
                        selectinload(Estimate.phases),
                        selectinload(Estimate.calendar_breaks),
                    )
                )
            )
            .scalars()
            .first()
        )
    if estimate is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "There is no such estimate here."},
        )
    settings = await overview_settings.get_settings(db, tenant_id=access.tenant_id)
    if settings is None:
        settings = overview_settings.default_settings_row(access.tenant_id)
    figures = compute_forecast(
        list(estimate.phases),
        list(estimate.calendar_breaks),
        working_day_factor=settings.working_day_factor,
        today=_now().date(),
    )
    return TimelineForecast.model_validate(
        {
            "estimate_id": estimate.id,
            "estimate_version": estimate.version,
            **stringify_decimals(figures),
        }
    )


__all__ = [
    "PhaseProgressStore",
    "phase_progress_store",
    "project_estimate",
    "router",
]
