"""Milestones — the ``milestones`` resource on the authoring contract.

Plan ``2026-09-20-overview-authoring-layer`` Phase 4 (the overview plan's
Phase 3 model): the dated markers on the Timeline — pilots, the date of first
value, any other milestone — each optionally tied to a phase of one of the
project's estimates.

On the generic contract (``app.overview.router``) a milestone gets ``version``
as its ``ETag``, ``If-Match`` on every write with a 409 that carries the
server's copy, an ``Idempotency-Key`` on create, a change-log row per write,
and the served ``can_edit``. What this module adds:

* **A phase reference is checked.** ``phase_id`` names a phase of THIS
  project (any of its estimates) or nothing; anything else is a 422
  ``phase_not_found``, checked when it changes.
* **Done means dated.** A milestone is ``done`` exactly when it has a
  ``completed_date`` — checked on the milestone as a partial write would
  leave it, and by a CHECK in the database.
* **A milestone outlives its phase.** :func:`detach_milestones` is how the
  estimate store unties milestones from a phase it is about to delete: each
  one is a write of its own (version moved, change-log row), so an editor
  holding the milestone sees a conflict rather than a field that changed
  under an unchanged version.

**Tenancy.** Every query filters on ``ctx.access.tenant_id``; another
project's id reads as 404.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import Milestone, Phase
from app.overview import change_log
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.schemas.overview import (
    MilestoneCreate,
    MilestoneRead,
    MilestoneUpdate,
    milestone_problem,
)

RESOURCE = "milestones"


def _now() -> datetime:
    return datetime.now(UTC)


def _parse_id(record_id: str) -> UUID:
    try:
        return UUID(record_id)
    except ValueError as exc:
        raise RecordNotFound(record_id) from exc


async def _phase_codes(db: AsyncSession, phase_ids: set[UUID]) -> dict[UUID, str]:
    if not phase_ids:
        return {}
    rows = await db.execute(select(Phase.id, Phase.code).where(Phase.id.in_(phase_ids)))
    return dict(rows.tuples().all())


def _to_read(row: Milestone, codes: dict[UUID, str]) -> MilestoneRead:
    return MilestoneRead(
        id=str(row.id),
        title=row.title,
        description=row.description,
        kind=row.kind,  # type: ignore[arg-type]
        phase_id=row.phase_id,
        phase_code=codes.get(row.phase_id) if row.phase_id else None,
        target_date=row.target_date,
        completed_date=row.completed_date,
        status=row.status,  # type: ignore[arg-type]
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        created_by=row.created_by,
        updated_by=row.updated_by,
    )


async def _read(db: AsyncSession, row: Milestone) -> MilestoneRead:
    codes = await _phase_codes(db, {row.phase_id} if row.phase_id else set())
    return _to_read(row, codes)


async def _require_phase(
    db: AsyncSession, tenant_id: UUID, phase_id: UUID | None
) -> None:
    """``phase_id`` names a phase of this project, or nothing. The FK alone
    would accept another project's phase."""
    if phase_id is None:
        return
    found = (
        await db.execute(
            select(Phase.id).where(Phase.id == phase_id, Phase.tenant_id == tenant_id)
        )
    ).first()
    if found is None:
        raise StoreRefused(
            422,
            "phase_not_found",
            "A milestone's phase must be a phase of this project's estimate.",
        )


async def detach_milestones(ctx: StoreContext, phase_ids: list[UUID]) -> None:
    """Untie every milestone of this project from the phases about to be
    deleted, as writes of their own.

    Called by the estimate store before it deletes phases (a re-planned
    schedule, or the whole estimate). Each detached milestone's version moves
    and the change log gets a row, so a client holding the old copy gets a
    409 with the new one instead of a silently changed ``phase_id``.
    """
    if not phase_ids:
        return
    rows = (
        (
            await ctx.db.execute(
                select(Milestone)
                .where(
                    Milestone.tenant_id == ctx.access.tenant_id,
                    Milestone.phase_id.in_(phase_ids),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        before = await _read(ctx.db, row)
        row.phase_id = None
        row.version += 1
        row.updated_by = ctx.access.actor
        row.updated_at = _now()
        await ctx.db.flush()
        after = _to_read(row, {})
        await change_log.record(
            ctx.db,
            tenant_id=ctx.access.tenant_id,
            resource=RESOURCE,
            record_id=after.id,
            action="update",
            source=change_log.change_source(ctx.request),
            **change_log.attribution(ctx.access, ctx.request),
            before=before,
            after=after,
            version_before=before.version,
            version_after=after.version,
        )


class MilestoneStore:
    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> Milestone:
        stmt = select(Milestone).where(
            Milestone.id == _parse_id(record_id),
            Milestone.tenant_id == ctx.access.tenant_id,
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
        """In date order — the order the Timeline lane and list draw them.
        Filters: ``phase_id`` (repeatable; ``none`` for the unphased ones) and
        ``status`` (repeatable)."""
        stmt = select(Milestone).where(Milestone.tenant_id == ctx.access.tenant_id)
        phase_filter = filters.get("phase_id") or []
        if phase_filter:
            ids: list[UUID] = []
            unphased = False
            for value in phase_filter:
                if value == "none":
                    unphased = True
                    continue
                try:
                    ids.append(UUID(value))
                except ValueError:
                    continue  # names no phase, so matches nothing
            clauses: list[Any] = []
            if ids:
                clauses.append(Milestone.phase_id.in_(ids))
            if unphased:
                clauses.append(Milestone.phase_id.is_(None))
            if not clauses:
                return ListResult(items=[])
            stmt = stmt.where(or_(*clauses))
        statuses = filters.get("status") or []
        if statuses:
            stmt = stmt.where(Milestone.status.in_(statuses))
        stmt = stmt.order_by(
            Milestone.target_date, Milestone.title, Milestone.created_at
        )
        rows = (await ctx.db.execute(stmt)).scalars().all()
        codes = await _phase_codes(ctx.db, {r.phase_id for r in rows if r.phase_id})
        return ListResult(items=[_to_read(r, codes) for r in rows])

    async def get(self, ctx: StoreContext, record_id: str) -> MilestoneRead:
        return await _read(ctx.db, await self._load(ctx, record_id))

    async def create(
        self, ctx: StoreContext, payload: MilestoneCreate
    ) -> MilestoneRead:
        await _require_phase(ctx.db, ctx.access.tenant_id, payload.phase_id)
        row = Milestone(
            tenant_id=ctx.access.tenant_id,
            title=payload.title,
            description=payload.description,
            kind=payload.kind,
            phase_id=payload.phase_id,
            target_date=payload.target_date,
            completed_date=payload.completed_date,
            status=payload.status,
            version=1,
            created_by=ctx.access.actor,
            updated_by=ctx.access.actor,
        )
        ctx.db.add(row)
        await ctx.db.flush()
        return await _read(ctx.db, row)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: MilestoneUpdate,
        expected_version: int,
    ) -> tuple[MilestoneRead, MilestoneRead]:
        row = await self._load(ctx, record_id, lock=True)
        before = await _read(ctx.db, row)
        if row.version != expected_version:
            raise StaleVersion(before)
        changes = {
            k: v
            for k, v in payload.model_dump(exclude_unset=True).items()
            if getattr(row, k) != v
        }
        if not changes:
            return before, before
        if "phase_id" in changes:
            await _require_phase(ctx.db, row.tenant_id, changes["phase_id"])
        problem = milestone_problem(
            status=changes.get("status", row.status),
            completed_date=changes.get("completed_date", row.completed_date),
        )
        if problem:
            raise StoreRefused(422, "invalid_milestone", problem)
        for key, value in changes.items():
            setattr(row, key, value)
        row.version += 1
        row.updated_by = ctx.access.actor
        row.updated_at = _now()
        await ctx.db.flush()
        return before, await _read(ctx.db, row)

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> MilestoneRead:
        row = await self._load(ctx, record_id, lock=True)
        before = await _read(ctx.db, row)
        if row.version != expected_version:
            raise StaleVersion(before)
        await ctx.db.delete(row)
        await ctx.db.flush()
        return before


def milestone_store() -> MilestoneStore:
    """FastAPI dependency (a class instance so tests can override it)."""
    return MilestoneStore()


__all__ = ["MilestoneStore", "detach_milestones", "milestone_store"]
