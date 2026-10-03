"""The estimate — the ``estimates`` resource on the authoring contract.

Plan ``2026-09-20-overview-authoring-layer`` Phase 3. The estimate a project is
approved against (the overview plan's Phase 2 model): a head row, and a content
graph of phases, tasks, per-task role efforts, roles, the phase × role FTE
matrix, price tiers, cost lines and calendar breaks.

On the generic contract (``app.overview.router``) it gets what every resource
gets: ``version`` as the ``ETag``, ``If-Match`` on every write and a 409 that
carries the server's copy, an ``Idempotency-Key`` on create, one
``overview.change_log`` row per write with its source (ui / api / import), and
the served ``can_edit``. What this module adds:

* **The content graph travels as one field.** ``content`` on a create or an
  update replaces the whole graph in the same transaction and the same version
  as any head-row change beside it — so "save the content and record the
  document it came from" is one write that cannot half-land. A CSV paste, a
  mermaid import and the inline editor all produce a complete graph, and a
  half-applied import is worse than a rejected one.
* **The source document is checked.** ``source_page_id`` names a DOCUMENT of
  this project or nothing (the column has no FK; it predates
  ``overview.pages``): anything else is refused as a 422
  ``source_page_not_found`` before anything is written.
* **One baseline per project.** Marking an estimate the baseline un-marks the
  one that held it, inside the same write.
* ``GET /estimates/{id}/rollup`` — every derived planned figure, computed on
  read, so the frontend does no money arithmetic and two surfaces cannot
  disagree about a total. Money is integer micros; every other derived decimal
  is a STRING (:func:`app.services.overview_rollup.stringify_decimals`), and a
  figure the rollup cannot produce is ``null`` with a reason, never 0.

**Tenancy.** Every query here filters on ``ctx.access.tenant_id``, the ACTIVE
project resolved through coord and membership-validated there. An id from
another project reads as 404, never 403: existence is itself information.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_async_db
from app.crud import overview_settings
from app.models.overview import (
    CalendarBreak,
    CostLine,
    Estimate,
    EstimateRole,
    Milestone,
    Page,
    Phase,
    PhaseAllocation,
    PhaseTask,
    PriceTier,
    TaskEffort,
)
from app.overview import change_log
from app.overview.milestones import detach_milestones
from app.overview.permissions import OverviewAccess, get_overview_access
from app.overview.phase_progress import (
    incoherent_recorded_progress,
    stored_progress_breaks,
    violated_progress_check,
)
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.schemas.overview import (
    PHASE_PROGRESS_FIELDS,
    AcknowledgedDrop,
    AllocationRead,
    CalendarBreakRead,
    CostLineRead,
    EstimateContent,
    EstimateContentWrite,
    EstimateCreate,
    EstimateRead,
    EstimateUpdate,
    PhaseRead,
    PhaseTaskRead,
    PriceTierRead,
    RoleRead,
    TaskEffortRead,
)
from app.services.overview_rollup import compute_rollup, stringify_decimals


def _now() -> datetime:
    return datetime.now(UTC)


def _parse_id(record_id: str) -> UUID:
    try:
        return UUID(record_id)
    except ValueError as exc:
        raise RecordNotFound(record_id) from exc


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


async def load_estimate_graph(
    db: AsyncSession, *, tenant_id: UUID, estimate_id: UUID, lock: bool = False
) -> Estimate | None:
    """The estimate with every child eagerly loaded, in ``tenant_id`` only.

    The rollup is a pure function over loaded rows, so it must not lazy-load
    inside an async session (which raises). This is the one loader that feeds
    it and the store.

    ``populate_existing``: an estimate already in the session (loaded by an
    earlier plain read, or written by a content replace) would otherwise be
    returned as it is, with its children NOT loaded — and the first access to
    one lazy-loads, which an async session refuses. ``lock=True`` takes the
    row lock a versioned write needs before it compares ``version``, on a row
    refreshed rather than cached.
    """
    stmt = (
        select(Estimate)
        .where(Estimate.id == estimate_id, Estimate.tenant_id == tenant_id)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Estimate.roles),
            selectinload(Estimate.price_tiers),
            selectinload(Estimate.cost_lines),
            selectinload(Estimate.calendar_breaks),
            selectinload(Estimate.phases).selectinload(Phase.allocations),
            selectinload(Estimate.phases)
            .selectinload(Phase.tasks)
            .selectinload(PhaseTask.efforts),
        )
    )
    if lock:
        stmt = stmt.with_for_update(of=Estimate)
    return (await db.execute(stmt)).scalars().first()


# ---------------------------------------------------------------------------
# Read projection
# ---------------------------------------------------------------------------


def _content(row: Estimate) -> EstimateContent:
    """Project a loaded graph onto the wire shape.

    Children come back in a stable order (``sort_order``, then code) so a
    round trip through the editor does not reshuffle a table, and every
    cross-reference is resolved to its CODE as well as its id — the code is
    what the CSV paste and the gantt import speak.
    """
    roles: list[EstimateRole] = sorted(row.roles, key=lambda r: (r.sort_order, r.code))
    role_code = {r.id: r.code for r in roles}
    phases: list[Phase] = sorted(row.phases, key=lambda p: (p.sort_order, p.code))
    phase_code = {p.id: p.code for p in phases}

    return EstimateContent(
        roles=[
            RoleRead(
                id=r.id,
                code=r.code,
                name=r.name,
                responsibility=r.responsibility,
                day_rate_micros=r.day_rate_micros,
                currency=r.currency,
                client_side=r.client_side,
                sort_order=r.sort_order,
            )
            for r in roles
        ],
        phases=[
            PhaseRead(
                id=p.id,
                code=p.code,
                name=p.name,
                sort_order=p.sort_order,
                planned_start=p.planned_start,
                planned_end=p.planned_end,
                stated_working_weeks=p.stated_working_weeks,
                gate_criteria=p.gate_criteria,
                actual_start=p.actual_start,
                actual_end=p.actual_end,
                gate_status=p.gate_status,  # type: ignore[arg-type]
                gate_decided_at=p.gate_decided_at,
                gate_notes=p.gate_notes,
                tasks=[
                    PhaseTaskRead(
                        id=t.id,
                        number=t.number,
                        title=t.title,
                        requirement_refs=t.requirement_refs,
                        planned_start=t.planned_start,
                        planned_end=t.planned_end,
                        is_critical=t.is_critical,
                        status=t.status,  # type: ignore[arg-type]
                        sort_order=t.sort_order,
                        efforts=[
                            TaskEffortRead(
                                role_id=e.role_id,
                                role_code=role_code.get(e.role_id, ""),
                                planned_person_days=Decimal(e.planned_person_days),
                            )
                            for e in sorted(
                                t.efforts,
                                key=lambda e: role_code.get(e.role_id, ""),
                            )
                        ],
                    )
                    for t in sorted(p.tasks, key=lambda t: (t.sort_order, t.number))
                ],
            )
            for p in phases
        ],
        allocations=[
            AllocationRead(
                phase_id=a.phase_id,
                phase_code=phase_code.get(a.phase_id, ""),
                role_id=a.role_id,
                role_code=role_code.get(a.role_id, ""),
                fte=Decimal(a.fte),
            )
            for p in phases
            for a in sorted(p.allocations, key=lambda a: role_code.get(a.role_id, ""))
        ],
        price_tiers=[
            PriceTierRead(
                id=t.id,
                name=t.name,
                multiplier=Decimal(t.multiplier),
                is_primary=t.is_primary,
                sort_order=t.sort_order,
            )
            for t in sorted(row.price_tiers, key=lambda t: (t.sort_order, t.name))
        ],
        cost_lines=[
            CostLineRead(
                id=c.id,
                kind=c.kind,  # type: ignore[arg-type]
                label=c.label,
                basis=c.basis,
                low_micros=c.low_micros,
                high_micros=c.high_micros,
                currency=c.currency,
                phase_id=c.phase_id,
                phase_code=phase_code.get(c.phase_id) if c.phase_id else None,
                run_model=c.run_model,
                sort_order=c.sort_order,
            )
            for c in sorted(
                row.cost_lines, key=lambda c: (c.kind, c.sort_order, c.label)
            )
        ],
        calendar_breaks=[
            CalendarBreakRead(
                id=b.id,
                label=b.label,
                start_date=b.start_date,
                end_date=b.end_date,
            )
            for b in sorted(row.calendar_breaks, key=lambda b: b.start_date)
        ],
    )


def _as_written(content: EstimateContent) -> EstimateContentWrite | None:
    """The stored graph in the shape a content write takes, for telling a
    write that changes nothing from one that does. ``None`` when the stored
    graph would not pass today's write validation (data older than a rule),
    which then always counts as changed."""
    try:
        return EstimateContentWrite.model_validate(
            {
                "roles": [
                    {
                        "code": r.code,
                        "name": r.name,
                        "responsibility": r.responsibility,
                        "day_rate_micros": r.day_rate_micros,
                        "currency": r.currency,
                        "client_side": r.client_side,
                    }
                    for r in content.roles
                ],
                "phases": [
                    {
                        **p.model_dump(
                            exclude={
                                "id",
                                "sort_order",
                                "tasks",
                                *PHASE_PROGRESS_FIELDS,
                            },
                        ),
                        "tasks": [
                            {
                                **t.model_dump(exclude={"id", "sort_order", "efforts"}),
                                "efforts": [
                                    {
                                        "role_code": e.role_code,
                                        "planned_person_days": e.planned_person_days,
                                    }
                                    for e in t.efforts
                                ],
                            }
                            for t in p.tasks
                        ],
                    }
                    for p in content.phases
                ],
                "allocations": [
                    {"phase_code": a.phase_code, "role_code": a.role_code, "fte": a.fte}
                    for a in content.allocations
                ],
                "price_tiers": [
                    {
                        "name": t.name,
                        "multiplier": t.multiplier,
                        "is_primary": t.is_primary,
                    }
                    for t in content.price_tiers
                ],
                "cost_lines": [
                    c.model_dump(exclude={"id", "phase_id", "sort_order"})
                    for c in content.cost_lines
                ],
                "calendar_breaks": [
                    b.model_dump(exclude={"id"}) for b in content.calendar_breaks
                ],
            }
        )
    except ValueError:
        return None


def _same_content(stored: EstimateContent, incoming: EstimateContentWrite) -> bool:
    """Whether writing ``incoming`` would leave the graph as it is. Order is
    part of the content (it is the order every table is shown in), except
    where the read sorts by something else: efforts by role and allocations
    by phase then role, and cost lines and breaks by their own keys.

    A phase's ``id`` is identity, not content: a write that names each phase
    by the id it already has (the editor's) and one that names none (a CSV or
    API client matching by code) describe the same graph. What an id CAN
    change is which row a code lands on — an id whose saved phase carries a
    different code is a rename, and an id this estimate does not have is a
    write to refuse — so either makes the write a real one."""
    current = _as_written(stored)
    if current is None:
        return False
    stored_code = {p.id: p.code for p in stored.phases}
    for phase in incoming.phases:
        if phase.id is not None and stored_code.get(phase.id) != phase.code:
            return False

    def canonical(content: EstimateContentWrite) -> dict[str, Any]:
        # Python mode: decimals stay Decimal, whose equality is numeric, so
        # "4" and "4.00" person-days are the same figure while a task number
        # "1.10" stays a different string from "1.1".
        dumped = content.model_dump()
        for phase in dumped["phases"]:
            phase.pop("id", None)
            for task in phase["tasks"]:
                task["efforts"].sort(key=lambda e: e["role_code"])
        dumped["allocations"].sort(key=lambda a: (a["phase_code"], a["role_code"]))
        dumped["cost_lines"].sort(key=lambda c: (c["kind"], c["label"]))
        dumped["calendar_breaks"].sort(key=lambda b: (b["start_date"], b["label"]))
        return dumped

    return canonical(current) == canonical(incoming)


def _to_read(row: Estimate, *, with_content: bool) -> EstimateRead:
    return EstimateRead(
        id=str(row.id),
        name=row.name,
        purpose=row.purpose,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        is_baseline=row.is_baseline,
        source_page_id=row.source_page_id,
        accuracy_note=row.accuracy_note,
        contingency_pct=row.contingency_pct,
        notes=row.notes,
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        created_by=row.created_by,
        updated_by=row.updated_by,
        content=_content(row) if with_content else None,
    )


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


async def _require_source_document(
    db: AsyncSession, tenant_id: UUID, page_id: UUID | None
) -> None:
    """``source_page_id`` names a DOCUMENT of this project, or nothing.

    The column carries no FK, so this is the check that keeps it honest: a
    wiki page, another project's document or an unknown id is refused as the
    422 it is, never stored as a dangling link.
    """
    if page_id is None:
        return
    found = (
        await db.execute(
            select(Page.id).where(
                Page.id == page_id,
                Page.tenant_id == tenant_id,
                Page.kind == "document",
            )
        )
    ).first()
    if found is None:
        raise StoreRefused(
            422,
            "source_page_not_found",
            "An estimate's source must be a document in this project.",
        )


async def _take_the_baseline(ctx: StoreContext, *, keep_id: UUID | None) -> None:
    """Make room for a new baseline: un-mark whichever estimate holds it.

    A project has at most one baseline (the partial unique index enforces it);
    this is what stops a legitimate re-baseline from tripping over it. It is
    a write to ANOTHER estimate, so it follows the contract like any other:
    that estimate's version moves (an ETag held on it goes stale) and the
    change log gets its own row, naming the write that caused it.

    Two re-baselines in one project at once would each un-mark only what its
    own snapshot saw and then collide on the unique index; a transaction-scoped
    advisory lock per project serialises them, and the second, running after
    the first commits, sees and un-marks the first's baseline.
    """
    tenant_id = ctx.access.tenant_id
    await ctx.db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"overview.estimates.baseline:{tenant_id}", 0)
            )
        )
    )
    stmt = (
        select(Estimate)
        .where(Estimate.tenant_id == tenant_id, Estimate.is_baseline.is_(True))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if keep_id is not None:
        stmt = stmt.where(Estimate.id != keep_id)
    for other in (await ctx.db.execute(stmt)).scalars().all():
        before = _to_read(other, with_content=False)
        other.is_baseline = False
        other.version += 1
        other.updated_by = ctx.access.actor
        other.updated_at = _now()
        await ctx.db.flush()
        after = _to_read(other, with_content=False)
        await change_log.record(
            ctx.db,
            tenant_id=tenant_id,
            resource="estimates",
            record_id=after.id,
            action="update",
            source=change_log.change_source(ctx.request),
            actor=ctx.access.actor,
            actor_user_id=ctx.access.user_id,
            before=before,
            after=after,
            version_before=before.version,
            version_after=after.version,
        )


def match_phases(
    existing: list[Phase], content: EstimateContentWrite
) -> list[Phase | None]:
    """For each submitted phase, the saved phase it continues — or ``None``
    for a new one. The one rule for which phase rows a content write keeps.

    By ``id`` first: a submitted id names a phase of THIS estimate (anything
    else — another estimate's phase, a deleted one, a made-up id — is refused
    as a 422 before anything is written), and the row it names continues
    under the submitted code, which is how a code is renamed without losing
    the phase. Then by code, among the saved phases no id claimed: what every
    client that sends no ids (a CSV paste, an API caller, a re-imported
    gantt) has always got. Never by name — two phases can share one, and a
    name says nothing about which recorded gate belongs to which.

    Each saved phase continues at most one submitted phase (the write's own
    validator refuses two submitted phases naming one id). A saved phase
    nothing continues is dropped by the write.
    """
    by_id = {p.id: p for p in existing}
    matched: list[Phase | None] = [None] * len(content.phases)
    claimed: set[UUID] = set()
    for index, phase in enumerate(content.phases):
        if phase.id is None:
            continue
        row = by_id.get(phase.id)
        if row is None:
            raise StoreRefused(
                422,
                "phase_not_in_estimate",
                f"Phase {phase.code} names phase id {phase.id}, which is not a "
                "phase of this estimate. Reload the estimate and try again.",
            )
        matched[index] = row
        claimed.add(row.id)
    by_code = {p.code: p for p in existing if p.id not in claimed}
    for index, phase in enumerate(content.phases):
        if phase.id is not None:
            continue
        row = by_code.pop(phase.code, None)
        if row is not None:
            matched[index] = row
            claimed.add(row.id)
    return matched


def has_recorded_progress(phase: Phase) -> bool:
    """Whether a phase holds progress recorded on the Timeline — what a drop
    would delete. The frontend's ``recordedProgress`` (``team/edit/_lib/
    dropped.ts``) reads the same five fields the same way."""
    return (
        phase.gate_status != "pending"
        or phase.gate_decided_at is not None
        or bool((phase.gate_notes or "").strip())
        or phase.actual_start is not None
        or phase.actual_end is not None
    )


async def _require_acknowledged_drops(
    ctx: StoreContext,
    dropped: list[Phase],
    acknowledged: Sequence[AcknowledgedDrop],
) -> None:
    """Refuse a write that would delete recorded work its writer never saw.

    Every dropped phase holding recorded progress or tied milestones needs an
    acknowledgement naming its CURRENT progress version and milestone count;
    a phase holding neither needs none. Called with the phases already locked
    (``FOR UPDATE``), so neither a progress write (which locks the row) nor a
    milestone write (``FOR KEY SHARE`` on its phase) can land between this
    check and the delete. A missing or outdated acknowledgement is a 409
    ``unacknowledged_drop`` carrying the fresh state of every such phase, so
    a client can show it and ask again — never a silent drop.
    """
    if not dropped:
        return
    counts: dict[UUID, int] = {
        phase_id: count
        for phase_id, count in (
            await ctx.db.execute(
                select(Milestone.phase_id, func.count())
                .where(
                    Milestone.tenant_id == ctx.access.tenant_id,
                    Milestone.phase_id.in_([p.id for p in dropped]),
                )
                .group_by(Milestone.phase_id)
            )
        ).all()
        if phase_id is not None
    }
    acks = {a.phase_id: a for a in acknowledged}
    unacknowledged = []
    for phase in dropped:
        tied = counts.get(phase.id, 0)
        if not has_recorded_progress(phase) and tied == 0:
            continue
        version = phase.progress_version or 1
        ack = acks.get(phase.id)
        if (
            ack is not None
            and ack.progress_version == version
            and ack.milestone_count == tied
        ):
            continue
        unacknowledged.append(
            {
                "phase_id": str(phase.id),
                "code": phase.code,
                "name": phase.name,
                "progress_version": version,
                "milestone_count": tied,
                "actual_start": phase.actual_start,
                "actual_end": phase.actual_end,
                "gate_status": phase.gate_status,
                "gate_decided_at": phase.gate_decided_at,
                "gate_notes": phase.gate_notes,
            }
        )
    if unacknowledged:
        codes = ", ".join(str(p["code"]) for p in unacknowledged)
        raise StoreRefused(
            409,
            "unacknowledged_drop",
            f"This save would drop {codes}, holding recorded progress or tied "
            "milestones it did not acknowledge as they stand now, so nothing "
            "was saved. Look at what each holds (attached), then acknowledge "
            "it in acknowledged_drops and save again.",
            detail={"phases": jsonable_encoder(unacknowledged)},
        )


async def _replace_content(
    ctx: StoreContext,
    *,
    estimate: Estimate,
    content: EstimateContentWrite,
    acknowledged: Sequence[AcknowledgedDrop] | None = None,
) -> None:
    """Replace an estimate's whole content graph. Leaves ``version`` alone —
    the caller moves it once per write, whatever the write carried.

    Delete-then-insert for everything but the PHASES: the payload is a
    complete description of the estimate and every child is identified by a
    code the client owns. Referential integrity between the parts is already
    guaranteed by ``EstimateContentWrite``'s validator, so nothing here has to
    re-check it.

    **A phase the write continues keeps its row** (:func:`match_phases`: by
    the id it names, else by its code) — its id, and with it the progress
    recorded against it on the Timeline (actual dates, the gate's outcome,
    ``progress_version``) and the milestones tied to it. Only its plan fields
    are rewritten, its code among them when the write renames it. A content
    write owns the plan and never the progress, so a Save in the estimate
    editor cannot put back a gate outcome somebody recorded since the editor
    loaded. A phase nothing continues is deleted with its progress (the
    change log's ``before`` keeps both), and the milestones tied to it are
    detached first, each as a logged write — but only once the write has
    acknowledged each such phase that holds recorded work, as it stands now
    (:func:`_require_acknowledged_drops`; ``acknowledged=None`` skips that,
    for a new estimate, which has nothing to drop).

    **Every phase of the estimate is locked first** (``FOR UPDATE``, in id
    order), before any milestone is touched. A rename rewrites ``code``, a
    column of the unique ``(estimate_id, code)`` index, so its UPDATE needs
    ``FOR UPDATE`` on that row — which conflicts with the ``FOR KEY SHARE`` a
    milestone write takes on the phase it names (``_lock_phase`` in
    :mod:`app.overview.milestones`). Taking that lock only at the rename
    (after :func:`detach_milestones` had locked milestones) was a deadlock:
    a milestone moving from a dropped phase to the renamed one held the
    renamed phase and waited for its milestone row, while the save held the
    milestone row and waited for the renamed phase. With every phase locked
    up front the order is phases (id order) → milestones here,
    in :func:`detach_milestones` and in every milestone write, so the two
    serialise instead.
    """
    db = ctx.db
    actor = ctx.access.actor
    tenant_id = estimate.tenant_id
    now = _now()

    rows = list(
        (
            await db.execute(
                select(Phase)
                .where(Phase.estimate_id == estimate.id)
                .order_by(Phase.id)
                .with_for_update(of=Phase)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    # Refused (422) here, before anything is written, when an id is foreign.
    matched = match_phases(rows, content)
    kept_ids = [row.id for row in matched if row is not None]
    kept = set(kept_ids)
    removed = [p.id for p in rows if p.id not in kept]
    if acknowledged is not None:
        await _require_acknowledged_drops(
            ctx, [p for p in rows if p.id not in kept], acknowledged
        )
    await detach_milestones(ctx, removed)

    # Tasks (and so their efforts) and allocations hang off phases; a kept
    # phase's are rewritten like every other table, so they go first.
    if kept_ids:
        await db.execute(delete(PhaseTask).where(PhaseTask.phase_id.in_(kept_ids)))
        await db.execute(
            delete(PhaseAllocation).where(PhaseAllocation.phase_id.in_(kept_ids))
        )
    if removed:
        await db.execute(delete(Phase).where(Phase.id.in_(removed)))
    await db.execute(
        delete(EstimateRole).where(EstimateRole.estimate_id == estimate.id)
    )
    await db.execute(delete(PriceTier).where(PriceTier.estimate_id == estimate.id))
    await db.execute(delete(CostLine).where(CostLine.estimate_id == estimate.id))
    await db.execute(
        delete(CalendarBreak).where(CalendarBreak.estimate_id == estimate.id)
    )
    # A renamed phase may take a code another kept phase is giving up (two
    # codes swapped, say), and (estimate_id, code) is unique at every
    # statement: park each renamed row on a code no phase can have first.
    renamed = [
        row
        for row, phase in zip(matched, content.phases, strict=True)
        if row is not None and row.code != phase.code
    ]
    for parked in renamed:
        parked.code = f"~renaming~{parked.id.hex}"
    await db.flush()

    audit = {
        "created_by": actor,
        "updated_by": actor,
        "created_at": now,
        "updated_at": now,
    }

    roles_by_code: dict[str, EstimateRole] = {}
    for index, role in enumerate(content.roles):
        row = EstimateRole(
            tenant_id=tenant_id,
            estimate_id=estimate.id,
            code=role.code,
            name=role.name,
            responsibility=role.responsibility,
            day_rate_micros=role.day_rate_micros,
            currency=role.currency,
            client_side=role.client_side,
            sort_order=index,
            **audit,
        )
        db.add(row)
        roles_by_code[role.code] = row

    phases_by_code: dict[str, Phase] = {}
    for index, (phase, continued) in enumerate(
        zip(content.phases, matched, strict=True)
    ):
        plan = {
            "code": phase.code,
            "name": phase.name,
            "sort_order": index,
            "planned_start": phase.planned_start,
            "planned_end": phase.planned_end,
            "stated_working_weeks": phase.stated_working_weeks,
            "gate_criteria": phase.gate_criteria,
        }
        prow = continued
        if prow is None:
            prow = Phase(
                tenant_id=tenant_id,
                estimate_id=estimate.id,
                **plan,
                **audit,
            )
            db.add(prow)
        else:
            changed = False
            for key, value in plan.items():
                if getattr(prow, key) != value:
                    setattr(prow, key, value)
                    changed = True
            if changed:
                prow.updated_by = actor
                prow.updated_at = now
        phases_by_code[phase.code] = prow
    await db.flush()

    tasks: list[tuple[PhaseTask, list[Any]]] = []
    for phase in content.phases:
        prow = phases_by_code[phase.code]
        for t_index, task in enumerate(phase.tasks):
            trow = PhaseTask(
                tenant_id=tenant_id,
                phase_id=prow.id,
                number=task.number,
                title=task.title,
                requirement_refs=task.requirement_refs,
                planned_start=task.planned_start,
                planned_end=task.planned_end,
                is_critical=task.is_critical,
                status=task.status,
                sort_order=t_index,
                **audit,
            )
            db.add(trow)
            tasks.append((trow, list(task.efforts)))
    # One flush for every task, not one per task: the efforts below need the
    # task ids, and a per-task round trip made a large import slow.
    await db.flush()
    for trow, efforts in tasks:
        for effort in efforts:
            db.add(
                TaskEffort(
                    tenant_id=tenant_id,
                    task_id=trow.id,
                    role_id=roles_by_code[effort.role_code].id,
                    planned_person_days=effort.planned_person_days,
                    **audit,
                )
            )

    for alloc in content.allocations:
        db.add(
            PhaseAllocation(
                tenant_id=tenant_id,
                phase_id=phases_by_code[alloc.phase_code].id,
                role_id=roles_by_code[alloc.role_code].id,
                fte=alloc.fte,
                **audit,
            )
        )

    for index, tier in enumerate(content.price_tiers):
        db.add(
            PriceTier(
                tenant_id=tenant_id,
                estimate_id=estimate.id,
                name=tier.name,
                multiplier=tier.multiplier,
                is_primary=tier.is_primary,
                sort_order=index,
                **audit,
            )
        )

    for index, line in enumerate(content.cost_lines):
        db.add(
            CostLine(
                tenant_id=tenant_id,
                estimate_id=estimate.id,
                kind=line.kind,
                label=line.label,
                basis=line.basis,
                low_micros=line.low_micros,
                high_micros=line.high_micros,
                currency=line.currency,
                phase_id=(
                    phases_by_code[line.phase_code].id
                    if line.phase_code is not None
                    else None
                ),
                run_model=line.run_model,
                sort_order=index,
                **audit,
            )
        )

    for brk in content.calendar_breaks:
        db.add(
            CalendarBreak(
                tenant_id=tenant_id,
                estimate_id=estimate.id,
                label=brk.label,
                start_date=brk.start_date,
                end_date=brk.end_date,
                **audit,
            )
        )
    await db.flush()


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------


class EstimateStore:
    async def _graph(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> Estimate:
        row = await load_estimate_graph(
            ctx.db,
            tenant_id=ctx.access.tenant_id,
            estimate_id=_parse_id(record_id),
            lock=lock,
        )
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def _fresh(self, ctx: StoreContext, estimate_id: UUID) -> EstimateRead:
        # The content replace deletes children through Core statements, so the
        # loaded collections still hold the old rows; the loader's
        # `populate_existing` re-reads them.
        row = await load_estimate_graph(
            ctx.db, tenant_id=ctx.access.tenant_id, estimate_id=estimate_id
        )
        if row is None:  # pragma: no cover — written in this transaction
            raise RecordNotFound(str(estimate_id))
        return _to_read(row, with_content=True)

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        """This project's estimates, baseline first then newest — the order a
        reader wants, and the one the Team page relies on when no baseline is
        marked. Head rows only (``content`` is null)."""
        stmt = (
            select(Estimate)
            .where(Estimate.tenant_id == ctx.access.tenant_id)
            .order_by(Estimate.is_baseline.desc(), Estimate.created_at.desc())
        )
        rows = (await ctx.db.execute(stmt)).scalars().all()
        return ListResult(items=[_to_read(r, with_content=False) for r in rows])

    async def get(self, ctx: StoreContext, record_id: str) -> EstimateRead:
        return _to_read(await self._graph(ctx, record_id), with_content=True)

    async def create(self, ctx: StoreContext, payload: EstimateCreate) -> EstimateRead:
        """A new estimate, with its content when the create carries one.

        Phase ids in that content are dropped before anything else: a new
        estimate has no phases for them to name, so each is a new phase —
        what makes ``GET`` → ``POST`` a copy rather than a 422 (or, before
        this, a refusal AFTER the head row and the baseline hand-over were
        written).
        """
        tenant_id = ctx.access.tenant_id
        content = payload.content
        if content is not None:
            content = content.model_copy(
                update={
                    "phases": [
                        phase.model_copy(update={"id": None})
                        for phase in content.phases
                    ]
                }
            )
        await _require_source_document(ctx.db, tenant_id, payload.source_page_id)
        if payload.is_baseline:
            await _take_the_baseline(ctx, keep_id=None)
        row = Estimate(
            tenant_id=tenant_id,
            name=payload.name,
            purpose=payload.purpose,
            status=payload.status,
            is_baseline=payload.is_baseline,
            source_page_id=payload.source_page_id,
            accuracy_note=payload.accuracy_note,
            contingency_pct=payload.contingency_pct,
            notes=payload.notes,
            version=1,
            created_by=ctx.access.actor,
            updated_by=ctx.access.actor,
        )
        ctx.db.add(row)
        await ctx.db.flush()
        if content is not None:
            await _replace_content(ctx, estimate=row, content=content)
        return await self._fresh(ctx, row.id)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: EstimateUpdate,
        expected_version: int,
    ) -> tuple[EstimateRead, EstimateRead]:
        row = await self._graph(ctx, record_id, lock=True)
        before = _to_read(row, with_content=True)
        if row.version != expected_version:
            raise StaleVersion(before)

        changes = payload.model_dump(
            exclude_unset=True, exclude={"content", "acknowledged_drops"}
        )
        # Checked only when it CHANGES: re-sending the recorded source (whose
        # document may since have been deleted or re-kinded) is not a new
        # claim and must not refuse an otherwise valid write.
        if (
            "source_page_id" in changes
            and changes["source_page_id"] != row.source_page_id
        ):
            await _require_source_document(
                ctx.db, row.tenant_id, changes["source_page_id"]
            )
        head = {k: v for k, v in changes.items() if getattr(row, k) != v}
        content = payload.content
        if (
            content is not None
            and before.content is not None
            and _same_content(before.content, content)
        ):
            # Re-sending the graph as it stands (the editor always sends it,
            # e.g. on a save that only records the source document) is not a
            # content write: no new rows, no version, no change-log entry.
            content = None
        if not head and content is None:
            return before, before
        if content is not None:
            # A foreign phase id refuses the write before ANY of it — the
            # baseline hand-over below included — is applied.
            match_phases(list(row.phases), content)

        # The baseline hand-over, the head fields and the content land
        # together or not at all: a refusal from the content (incoherent
        # stored progress, an unacknowledged drop) rolls back the savepoint,
        # and with it the head change and the OTHER estimate's demotion,
        # whatever the route then does with the session.
        async with ctx.db.begin_nested():
            if head.get("is_baseline") is True:
                await _take_the_baseline(ctx, keep_id=row.id)
            for key, value in head.items():
                setattr(row, key, value)
            if content is not None:
                await self._replace_or_refuse(
                    ctx, row, content, payload.acknowledged_drops
                )
            row.updated_by = ctx.access.actor
            row.updated_at = _now()
            row.version += 1
            await ctx.db.flush()
        return before, await self._fresh(ctx, row.id)

    @staticmethod
    async def _replace_or_refuse(
        ctx: StoreContext,
        row: Estimate,
        content: EstimateContentWrite,
        acknowledged: Sequence[AcknowledgedDrop],
    ) -> None:
        """:func:`_replace_content`, with a refusal by the database's progress
        CHECKs answered as a 422 ``incoherent_recorded_progress`` instead of
        a 500.

        Those CHECKs were added ``NOT VALID``, so a phase whose progress was
        stored incoherently before them refuses EVERY later UPDATE of its
        row — and a content write updates a kept phase whenever its plan
        changes (a rename, a new name, a moved position). The write is run in
        a savepoint so only it is rolled back; the reply names the phase(s)
        and sends the user to the Timeline, where progress is corrected.
        """
        # Read before the write, while the loaded rows still hold what is
        # stored: the phases the write keeps (a dropped one is deleted, which
        # no CHECK refuses), and which CHECKs each one's stored values break.
        incoherent = {
            phase.code: broken
            for phase in match_phases(list(row.phases), content)
            if phase is not None and (broken := stored_progress_breaks(phase))
        }
        try:
            async with ctx.db.begin_nested():
                await _replace_content(
                    ctx, estimate=row, content=content, acknowledged=acknowledged
                )
        except IntegrityError as exc:
            constraint = violated_progress_check(exc)
            if constraint is None:
                raise
            culprits = {
                code: broken
                for code, broken in incoherent.items()
                if constraint in broken
            }
            message = (
                " ".join(
                    incoherent_recorded_progress(code, broken)
                    for code, broken in sorted(culprits.items())
                )
                if culprits
                # Not one this write's rows showed before it ran (a peer wrote
                # it meanwhile): still the same refusal, without a name.
                else incoherent_recorded_progress(None, [constraint])
            )
            raise StoreRefused(422, "incoherent_recorded_progress", message) from exc

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> EstimateRead:
        """Delete an estimate and everything under it. The change-log row keeps
        the whole graph as it was, so a deleted estimate is still answerable
        ("what did it say, and who removed it")."""
        row = await self._graph(ctx, record_id, lock=True)
        before = _to_read(row, with_content=True)
        if row.version != expected_version:
            raise StaleVersion(before)
        # The milestones tied to its phases outlive it, detached as writes of
        # their own; the FK's SET NULL is the backstop, not the path.
        await detach_milestones(ctx, [p.id for p in row.phases])
        # The children cascade in Postgres (ON DELETE CASCADE) and in the ORM
        # (delete-orphan), so one delete is enough.
        await ctx.db.delete(row)
        await ctx.db.flush()
        return before


def estimate_store() -> EstimateStore:
    """FastAPI dependency (a class instance so tests can override it)."""
    return EstimateStore()


# ---------------------------------------------------------------------------
# Routes beyond the contract: the rollup
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/estimates/{estimate_id}/rollup")
async def read_rollup(
    estimate_id: str,
    request: Request,
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Every derived planned figure, computed on read. Readable by any member.

    The shape is documented on
    :func:`app.services.overview_rollup.compute_rollup`. Money is an integer
    count of micros; every other decimal is a STRING, so nothing in the money
    or effort path ever passes through a float. Figures whose inputs are
    missing are ``null`` and appear in ``unavailable`` with a machine
    ``reason`` and a sentence — never 0.
    """
    ctx = StoreContext(access=access, db=db, request=request)
    try:
        row = await EstimateStore()._graph(ctx, estimate_id)
    except RecordNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "There is no such estimate here."},
        ) from exc
    settings = await overview_settings.get_settings(db, tenant_id=access.tenant_id)
    if settings is None:
        settings = overview_settings.default_settings_row(access.tenant_id)
    rollup = compute_rollup(row, settings, generated_at=_now())
    serialized: dict[str, Any] = stringify_decimals(rollup)
    return serialized


__all__ = [
    "EstimateStore",
    "estimate_store",
    "load_estimate_graph",
    "router",
]
