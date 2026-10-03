"""The ``costs/effort-entries`` resource: logged time, on the authoring
contract (plan ``2026-09-20-overview-authoring-layer`` Phase 5).

Permission rule ``member_self`` (business-leaders plan, open question 1:
"admins only, except optional effort logging, which any member may do for
themselves"):

* any member of the project may log, edit and delete THEIR OWN time — an
  entry whose ``person_user_id`` is theirs;
* whoever ``editing_roles`` admits may write anybody's;
* anything else is ``403 not_your_entry``. Every read serves ``editable`` per
  entry from the same rule, so the UI offers an edit only where the API will
  take it.

Rate snapshot: under ``labour_billing = day_rates`` an entry is priced when it
is logged — the baseline estimate's role (by ``role_code``), its day rate and
currency, and the project's hours per day are copied onto it, so a later rate
edit never rewrites history. A role the baseline does not price is ``422
role_not_priced``. Changing an entry's role re-prices it; an entry logged
before day rates applied is priced on its next edit. Under any other setting
the snapshot is empty and no cost derives from the entry.

A person's day holds at most 24 hours across all their entries (``422
day_over_24h``); the check runs under a per-person-day advisory lock, so two
concurrent saves cannot both pass it.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text

from app.costs.labour import entry_cost_micros, person_key
from app.crud import overview_settings
from app.models.overview import (
    MAX_HOURS_PER_DAY,
    EffortEntry,
    Estimate,
    EstimateRole,
    OverviewSettings,
    Phase,
)
from app.overview.permissions import OverviewAccess, PermissionRule
from app.overview.precision import numeric
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.schemas.overview import _WriteModel

Hours = Annotated[Decimal, numeric(5, 2, gt=0, le=MAX_HOURS_PER_DAY)]

#: The ``member_self`` rule's name in the registry, used for the per-record
#: ownership decision.
RULE: PermissionRule = "member_self"


class EffortEntryRead(BaseModel):
    id: str
    work_date: date
    person: str
    person_user_id: str | None
    hours: Decimal
    role_code: str | None
    phase_id: str | None
    task_number: str | None
    note: str
    #: The day rate this entry was priced at (``day_rates`` only), in
    #: ``rate_currency``, with the hours that made a day then. All three are
    #: ``null`` together: the entry carries no cost.
    rate_micros_used: int | None
    rate_currency: str | None
    hours_per_day_used: Decimal | None
    #: ``hours ÷ hours_per_day_used × rate_micros_used`` in ``rate_currency``;
    #: ``null`` when the entry carries no rate.
    cost_micros: int | None
    #: Whether the CALLER may edit or delete this entry — their own, or they
    #: may edit anybody's. The API enforces the same answer.
    editable: bool
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None


class EffortEntryCreate(_WriteModel):
    model_config = ConfigDict(extra="forbid")

    work_date: date
    hours: Hours
    #: Who did the work. Defaults to the caller.
    person: str | None = Field(default=None, min_length=1, max_length=200)
    #: The qontinui user who did it. Defaults to the caller; only an editor
    #: may name someone else.
    person_user_id: UUID | None = None
    #: The estimate role the time was worked as (its code, e.g. ``BE``).
    #: Required under ``day_rates``, where it prices the entry.
    role_code: str | None = Field(default=None, min_length=1, max_length=50)
    phase_id: UUID | None = None
    task_number: str | None = Field(default=None, min_length=1, max_length=50)
    note: str = Field(default="", max_length=2000)


class EffortEntryUpdate(_WriteModel):
    """Partial: a field left out is unchanged; ``null`` clears a nullable one."""

    model_config = ConfigDict(extra="forbid")

    work_date: date | None = None
    hours: Hours | None = None
    person: str | None = Field(default=None, min_length=1, max_length=200)
    person_user_id: UUID | None = None
    role_code: str | None = Field(default=None, min_length=1, max_length=50)
    phase_id: UUID | None = None
    task_number: str | None = Field(default=None, min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=2000)


def _owned(row: EffortEntry, access: OverviewAccess) -> bool:
    return access.user_id is not None and row.person_user_id == access.user_id


def editable_by(row: EffortEntry, access: OverviewAccess) -> bool:
    return access.can_edit_others(RULE) or (
        access.can_edit(RULE) and _owned(row, access)
    )


def _read(row: EffortEntry, access: OverviewAccess) -> EffortEntryRead:
    priced = row.rate_micros_used is not None and row.hours_per_day_used is not None
    return EffortEntryRead(
        id=str(row.id),
        work_date=row.work_date,
        person=row.person,
        person_user_id=str(row.person_user_id) if row.person_user_id else None,
        hours=Decimal(row.hours),
        role_code=row.role_code,
        phase_id=str(row.phase_id) if row.phase_id else None,
        task_number=row.task_number,
        note=row.note,
        rate_micros_used=row.rate_micros_used,
        rate_currency=row.rate_currency,
        hours_per_day_used=row.hours_per_day_used,
        cost_micros=(
            entry_cost_micros(
                Decimal(row.hours),
                int(row.rate_micros_used),  # type: ignore[arg-type]
                Decimal(row.hours_per_day_used),  # type: ignore[arg-type]
            )
            if priced
            else None
        ),
        editable=editable_by(row, access),
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        created_by=row.created_by,
        updated_by=row.updated_by,
    )


def _not_yours() -> StoreRefused:
    return StoreRefused(
        403,
        "not_your_entry",
        "You can log and change your own time only; this entry is someone else's.",
    )


def _parse_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise RecordNotFound(value) from exc


class EffortEntryStore:
    async def _settings(self, ctx: StoreContext) -> OverviewSettings:
        row = await overview_settings.get_settings(
            db=ctx.db, tenant_id=ctx.access.tenant_id
        )
        return row or overview_settings.default_settings_row(ctx.access.tenant_id)

    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> EffortEntry:
        stmt = select(EffortEntry).where(
            EffortEntry.id == _parse_id(record_id),
            EffortEntry.tenant_id == ctx.access.tenant_id,
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        row = (await ctx.db.execute(stmt)).scalars().first()
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def _check_phase(self, ctx: StoreContext, phase_id: UUID | None) -> None:
        if phase_id is None:
            return
        found = await ctx.db.scalar(
            select(Phase.id).where(
                Phase.id == phase_id, Phase.tenant_id == ctx.access.tenant_id
            )
        )
        if found is None:
            raise StoreRefused(
                422, "unknown_phase", "There is no such phase in this project."
            )

    async def _price(
        self, ctx: StoreContext, row: EffortEntry, settings: OverviewSettings
    ) -> None:
        """Snapshot what the entry costs, or clear the snapshot when labour is
        not billed by day rate."""
        if settings.labour_billing != "day_rates":
            row.rate_micros_used = None
            row.rate_currency = None
            row.hours_per_day_used = None
            return
        if row.role_code is None:
            raise StoreRefused(
                422,
                "role_required",
                "Labour is billed by day rate on this project, so a time entry "
                "names the role it was worked as (role_code) to be priced.",
            )
        role = (
            (
                await ctx.db.execute(
                    select(EstimateRole)
                    .join(Estimate, Estimate.id == EstimateRole.estimate_id)
                    .where(
                        Estimate.tenant_id == ctx.access.tenant_id,
                        Estimate.is_baseline.is_(True),
                        EstimateRole.code == row.role_code,
                    )
                )
            )
            .scalars()
            .first()
        )
        if (
            role is None
            or role.client_side
            or role.day_rate_micros is None
            or role.currency is None
        ):
            where = (
                "the baseline estimate has no such role"
                if role is None
                else "the baseline estimate gives that role no day rate"
            )
            raise StoreRefused(
                422,
                "role_not_priced",
                f"Role {row.role_code!r} cannot price this time: {where}. Labour "
                "is billed by day rate on this project.",
            )
        row.rate_micros_used = role.day_rate_micros
        row.rate_currency = role.currency
        row.hours_per_day_used = Decimal(settings.hours_per_day)

    async def _check_day(self, ctx: StoreContext, row: EffortEntry) -> None:
        """At most 24 hours per person per day, across all their entries."""
        key = person_key(row.person_user_id, row.person)
        await ctx.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"effort:{ctx.access.tenant_id}:{key}:{row.work_date.isoformat()}"},
        )
        stmt = select(func.coalesce(func.sum(EffortEntry.hours), 0)).where(
            EffortEntry.tenant_id == ctx.access.tenant_id,
            EffortEntry.work_date == row.work_date,
        )
        if row.person_user_id is not None:
            stmt = stmt.where(EffortEntry.person_user_id == row.person_user_id)
        else:
            stmt = stmt.where(
                EffortEntry.person_user_id.is_(None),
                func.lower(
                    func.regexp_replace(func.trim(EffortEntry.person), r"\s+", " ", "g")
                )
                == " ".join(row.person.split()).lower(),
            )
        if row.id is not None:
            stmt = stmt.where(EffortEntry.id != row.id)
        others = Decimal((await ctx.db.execute(stmt)).scalar_one())
        if others + Decimal(row.hours) > MAX_HOURS_PER_DAY:
            raise StoreRefused(
                422,
                "day_over_24h",
                f"{row.person} already has {others} hours on "
                f"{row.work_date.isoformat()}; a day holds at most "
                f"{MAX_HOURS_PER_DAY}.",
            )

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        stmt = select(EffortEntry).where(EffortEntry.tenant_id == ctx.access.tenant_id)
        try:
            for raw in filters.get("from", []):
                stmt = stmt.where(EffortEntry.work_date >= date.fromisoformat(raw))
            for raw in filters.get("to", []):
                stmt = stmt.where(EffortEntry.work_date <= date.fromisoformat(raw))
            for raw in filters.get("phase_id", []):
                stmt = stmt.where(
                    EffortEntry.phase_id.is_(None)
                    if raw == "none"
                    else EffortEntry.phase_id == UUID(raw)
                )
            for raw in filters.get("person_user_id", []):
                stmt = stmt.where(EffortEntry.person_user_id == UUID(raw))
        except ValueError as exc:
            raise StoreRefused(
                422,
                "bad_filter",
                "from/to are dates (YYYY-MM-DD); phase_id and person_user_id "
                "are ids (phase_id may be 'none').",
            ) from exc
        if "true" in filters.get("mine", []):
            stmt = stmt.where(EffortEntry.person_user_id == ctx.access.user_id)
        rows = (
            await ctx.db.execute(
                stmt.order_by(
                    EffortEntry.work_date.desc(),
                    EffortEntry.created_at.desc(),
                    EffortEntry.id,
                )
            )
        ).scalars()
        return ListResult(items=[_read(r, ctx.access) for r in rows.all()])

    async def get(self, ctx: StoreContext, record_id: str) -> BaseModel:
        return _read(await self._load(ctx, record_id), ctx.access)

    async def create(self, ctx: StoreContext, payload: BaseModel) -> BaseModel:
        assert isinstance(payload, EffortEntryCreate)
        access = ctx.access
        others = access.can_edit_others(RULE)
        user_id = payload.person_user_id or (
            access.user_id if payload.person is None or not others else None
        )
        if not others and (access.user_id is None or user_id != access.user_id):
            raise _not_yours()
        person = payload.person or (access.actor if user_id == access.user_id else None)
        if person is None:
            raise StoreRefused(
                422,
                "person_required",
                "Name the person whose time this is (person).",
            )
        await self._check_phase(ctx, payload.phase_id)
        row = EffortEntry(
            tenant_id=access.tenant_id,
            work_date=payload.work_date,
            person=person,
            person_user_id=user_id,
            hours=payload.hours,
            role_code=payload.role_code,
            phase_id=payload.phase_id,
            task_number=payload.task_number,
            note=payload.note,
            version=1,
            created_by=access.actor,
            updated_by=access.actor,
        )
        await self._price(ctx, row, await self._settings(ctx))
        await self._check_day(ctx, row)
        ctx.db.add(row)
        await ctx.db.flush()
        await ctx.db.refresh(row)
        return _read(row, access)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: BaseModel,
        expected_version: int,
    ) -> tuple[BaseModel, BaseModel]:
        access = ctx.access
        row = await self._load(ctx, record_id, lock=True)
        before = _read(row, access)
        if not editable_by(row, access):
            raise _not_yours()
        if row.version != expected_version:
            raise StaleVersion(before)
        changes: dict[str, Any] = payload.model_dump(exclude_unset=True)
        for required in ("work_date", "hours", "person"):
            if required in changes and changes[required] is None:
                raise StoreRefused(
                    422, "required_field", f"{required} cannot be cleared."
                )
        if "note" in changes and changes["note"] is None:
            changes["note"] = ""
        changes = {k: v for k, v in changes.items() if getattr(row, k) != v}
        if (
            "person_user_id" in changes
            and not access.can_edit_others(RULE)
            and changes["person_user_id"] != access.user_id
        ):
            raise _not_yours()
        settings = await self._settings(ctx)
        reprice = "role_code" in changes or (
            settings.labour_billing == "day_rates" and row.rate_micros_used is None
        )
        if not changes and not reprice:
            return before, before
        if "phase_id" in changes:
            await self._check_phase(ctx, changes["phase_id"])
        for key, value in changes.items():
            setattr(row, key, value)
        if reprice:
            await self._price(ctx, row, settings)
        if _read(row, access) == before:
            # Nothing moved — e.g. a re-price that found the same rate. The
            # attributes were set to their own values, so no UPDATE is issued.
            return before, before
        if {"hours", "work_date", "person", "person_user_id"} & set(changes):
            await self._check_day(ctx, row)
        row.version += 1
        row.updated_by = access.actor
        await ctx.db.flush()
        await ctx.db.refresh(row)
        return before, _read(row, access)

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> BaseModel:
        row = await self._load(ctx, record_id, lock=True)
        before = _read(row, ctx.access)
        if not editable_by(row, ctx.access):
            raise _not_yours()
        if row.version != expected_version:
            raise StaleVersion(before)
        await ctx.db.delete(row)
        await ctx.db.flush()
        return before


def effort_entry_store() -> EffortEntryStore:
    return EffortEntryStore()
