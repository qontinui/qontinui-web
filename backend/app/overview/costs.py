"""The Costs page's records — ``cost_categories``, ``recurring_costs`` and
``cost_entries`` on the authoring contract — and its derived summary.

On the generic contract (``app.overview.router``) each record gets
``version`` as its ``ETag``, ``If-Match`` on every write with a 409 that
carries the server's copy, an ``Idempotency-Key`` on create, a change-log row
per write, and the served ``can_edit``. What this module adds:

* **References stay inside the project.** A ``category_id`` or
  ``recurring_cost_id`` must name a record of THIS project; anything else is a
  422 (the foreign key alone would accept another project's).
* **History is not deleted out from under a heading.** A category in use, or
  a recurring cost with recorded periods, is refused deletion with a 409
  saying what to do instead (move the costs; give the recurring cost an end
  date).
* **One entry per recurring period**, and only on one of its due dates.
* ``GET /costs/summary`` — the totals, the month-by-category table and every
  period that has fallen due, computed by :mod:`app.services.overview_costs`.

**Tenancy.** Every query filters on ``ctx.access.tenant_id``; another
project's id reads as 404.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.crud import overview_settings
from app.models.overview import CostCategory, CostEntry, RecurringCost
from app.overview.permissions import OverviewAccess, get_overview_access
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.schemas.overview_costs import (
    CostCategoryRead,
    CostEntryRead,
    CostSummary,
    RecurringCostRead,
    entry_problem,
    recurring_problem,
)
from app.services.overview_costs import due_dates, is_due_date, summarize


def _now() -> datetime:
    return datetime.now(UTC)


def _parse_id(record_id: str) -> UUID:
    try:
        return UUID(record_id)
    except ValueError as exc:
        raise RecordNotFound(record_id) from exc


def _audit(row: Any) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "version": row.version,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "created_by": row.created_by,
        "updated_by": row.updated_by,
    }


def category_read(row: CostCategory) -> CostCategoryRead:
    return CostCategoryRead(
        **_audit(row),
        name=row.name,
        description=row.description,
        sort_order=row.sort_order,
    )


def recurring_read(row: RecurringCost) -> RecurringCostRead:
    return RecurringCostRead(
        **_audit(row),
        name=row.name,
        vendor=row.vendor,
        category_id=row.category_id,
        cadence=row.cadence,  # type: ignore[arg-type]
        amount_kind=row.amount_kind,  # type: ignore[arg-type]
        amount_micros=row.amount_micros,
        currency=row.currency,
        start_date=row.start_date,
        end_date=row.end_date,
        notes=row.notes,
    )


def entry_read(row: CostEntry) -> CostEntryRead:
    return CostEntryRead(
        **_audit(row),
        incurred_on=row.incurred_on,
        description=row.description,
        vendor=row.vendor,
        category_id=row.category_id,
        amount_micros=row.amount_micros,
        currency=row.currency,
        quantity=row.quantity,
        expects_delivery=row.expects_delivery,
        received_on=row.received_on,
        order_ref=row.order_ref,
        notes=row.notes,
        recurring_cost_id=row.recurring_cost_id,
        period_start=row.period_start,
    )


async def _require_category(
    db: AsyncSession, tenant_id: UUID, category_id: UUID | None
) -> None:
    if category_id is None:
        return
    found = (
        await db.execute(
            select(CostCategory.id).where(
                CostCategory.id == category_id, CostCategory.tenant_id == tenant_id
            )
        )
    ).first()
    if found is None:
        raise StoreRefused(
            422,
            "category_not_found",
            "A cost's category must be one of this project's.",
        )


async def _count(db: AsyncSession, *where: Any) -> int:
    return int((await db.execute(select(func.count()).where(*where))).scalar_one())


#: The constraints a concurrent write can trip past the store's checks, and
#: what each means to the reader.
_RACES: tuple[tuple[str, str, str], ...] = (
    (
        "uq_overview_cost_entries_period",
        "period_already_recorded",
        "That period was just recorded by somebody else — reload to see it.",
    ),
    (
        "uq_overview_cost_categories_name",
        "name_taken",
        "Somebody else just added a category with that name.",
    ),
)


def _race_refusal(exc: IntegrityError) -> StoreRefused:
    text = str(exc.orig)
    for constraint, error, message in _RACES:
        if constraint in text:
            return StoreRefused(409, error, message)
    if "foreign key" in text:
        return StoreRefused(
            409,
            "reference_changed",
            "A category or recurring cost this refers to was changed or removed "
            "at the same time. Reload and try again.",
        )
    return StoreRefused(
        409,
        "conflict",
        "Somebody else changed this at the same time. Reload and try again.",
    )


class _Store[Row: (CostCategory, RecurringCost, CostEntry)]:
    """Load, version-check and write one table's rows; each subclass adds its
    own rules in ``_check`` (create and update) and ``_before_delete``."""

    model: type[Row]

    async def _write(
        self,
        ctx: StoreContext,
        apply: Callable[[], None] = lambda: None,
        *,
        delete: Row | None = None,
    ) -> None:
        """Make the change inside a savepoint and flush it there, so a
        constraint a concurrent write hits past the checks rolls back only
        the savepoint and answers as a 409 — never an aborted transaction
        and a 500. The change must be MADE inside: a session flushes what is
        already pending before it opens the savepoint."""
        try:
            async with ctx.db.begin_nested():
                apply()
                if delete is not None:
                    await ctx.db.delete(delete)
                await ctx.db.flush()
        except IntegrityError as exc:
            raise _race_refusal(exc) from exc

    def _read(self, row: Row) -> Any:
        raise NotImplementedError

    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> Row:
        stmt = select(self.model).where(
            self.model.id == _parse_id(record_id),
            self.model.tenant_id == ctx.access.tenant_id,
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        row = (await ctx.db.execute(stmt)).scalars().first()
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def _check(
        self, ctx: StoreContext, values: dict[str, Any], row: Row | None
    ) -> None:
        """``values`` is the record as it will stand; ``row`` is the stored
        one on an update, ``None`` on a create."""

    async def _before_delete(self, ctx: StoreContext, row: Row) -> None:
        pass

    async def get(self, ctx: StoreContext, record_id: str) -> Any:
        return self._read(await self._load(ctx, record_id))

    async def create(self, ctx: StoreContext, payload: Any) -> Any:
        values = payload.model_dump()
        await self._check(ctx, values, None)
        row = self.model(
            tenant_id=ctx.access.tenant_id,
            **values,
            version=1,
            created_by=ctx.access.actor,
            updated_by=ctx.access.actor,
        )
        await self._write(ctx, lambda: ctx.db.add(row))
        return self._read(row)

    async def update(
        self, ctx: StoreContext, record_id: str, payload: Any, expected_version: int
    ) -> tuple[Any, Any]:
        row = await self._load(ctx, record_id, lock=True)
        before = self._read(row)
        if row.version != expected_version:
            raise StaleVersion(before)
        changes = {
            k: v
            for k, v in payload.model_dump(exclude_unset=True).items()
            if getattr(row, k) != v
        }
        if not changes:
            return before, before
        stored = {c: getattr(row, c) for c in type(payload).model_fields}
        await self._check(ctx, {**stored, **changes}, row)

        def apply() -> None:
            for key, value in changes.items():
                setattr(row, key, value)
            row.version += 1
            row.updated_by = ctx.access.actor
            row.updated_at = _now()

        await self._write(ctx, apply)
        return before, self._read(row)

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> Any:
        row = await self._load(ctx, record_id, lock=True)
        before = self._read(row)
        if row.version != expected_version:
            raise StaleVersion(before)
        await self._before_delete(ctx, row)
        await self._write(ctx, delete=row)
        return before


class CostCategoryStore(_Store[CostCategory]):
    model = CostCategory

    def _read(self, row: CostCategory) -> CostCategoryRead:
        return category_read(row)

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        rows = (
            await ctx.db.execute(
                select(CostCategory)
                .where(CostCategory.tenant_id == ctx.access.tenant_id)
                .order_by(CostCategory.sort_order, func.lower(CostCategory.name))
            )
        ).scalars()
        return ListResult(items=[category_read(r) for r in rows])

    async def _check(
        self, ctx: StoreContext, values: dict[str, Any], row: CostCategory | None
    ) -> None:
        stmt = select(CostCategory.id).where(
            CostCategory.tenant_id == ctx.access.tenant_id,
            func.lower(CostCategory.name) == values["name"].lower(),
        )
        if row is not None:
            stmt = stmt.where(CostCategory.id != row.id)
        if (await ctx.db.execute(stmt)).first() is not None:
            raise StoreRefused(
                409,
                "name_taken",
                f"There is already a category called “{values['name']}”.",
            )

    async def _before_delete(self, ctx: StoreContext, row: CostCategory) -> None:
        tenant = ctx.access.tenant_id
        used = await _count(
            ctx.db, CostEntry.tenant_id == tenant, CostEntry.category_id == row.id
        ) + await _count(
            ctx.db,
            RecurringCost.tenant_id == tenant,
            RecurringCost.category_id == row.id,
        )
        if used:
            raise StoreRefused(
                409,
                "category_in_use",
                f"“{row.name}” is the category of {used} cost(s). Move them to "
                "another category first.",
            )


class RecurringCostStore(_Store[RecurringCost]):
    model = RecurringCost

    def _read(self, row: RecurringCost) -> RecurringCostRead:
        return recurring_read(row)

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        rows = (
            await ctx.db.execute(
                select(RecurringCost)
                .where(RecurringCost.tenant_id == ctx.access.tenant_id)
                .order_by(func.lower(RecurringCost.name), RecurringCost.start_date)
            )
        ).scalars()
        return ListResult(items=[recurring_read(r) for r in rows])

    async def _check(
        self, ctx: StoreContext, values: dict[str, Any], row: RecurringCost | None
    ) -> None:
        if row is None or values["category_id"] != row.category_id:
            await _require_category(ctx.db, ctx.access.tenant_id, values["category_id"])
        problem = recurring_problem(
            amount_kind=values["amount_kind"],
            amount_micros=values["amount_micros"],
            start_date=values["start_date"],
            end_date=values["end_date"],
        )
        if problem:
            raise StoreRefused(422, "invalid_recurring_cost", problem)
        if row is None:
            return
        await self._refuse_rewriting_history(ctx, values, row)
        # The schedule decides which periods exist. Moving it would strand
        # periods already recorded on dates it no longer falls due.
        schedule = ("start_date", "end_date", "cadence")
        if any(values[f] != getattr(row, f) for f in schedule):
            recorded = (
                await ctx.db.execute(
                    select(CostEntry.period_start).where(
                        CostEntry.tenant_id == ctx.access.tenant_id,
                        CostEntry.recurring_cost_id == row.id,
                    )
                )
            ).scalars()
            stranded = [
                p
                for p in recorded
                if p is not None
                and not is_due_date(
                    values["start_date"], values["end_date"], values["cadence"], p
                )
            ]
            if stranded:
                first = min(stranded).isoformat()
                raise StoreRefused(
                    409,
                    "periods_recorded",
                    f"{len(stranded)} recorded period(s) — the first on {first} — "
                    "would no longer fall on this schedule. To change the price "
                    "or the billing day from now on, give this cost an end date "
                    "and add a new one.",
                )

    async def _refuse_rewriting_history(
        self, ctx: StoreContext, values: dict[str, Any], row: RecurringCost
    ) -> None:
        """A fixed cost's unrecorded periods are priced from the cost itself,
        on read. Once one has fallen due unrecorded, changing the amount,
        currency or kind would silently re-price spend already counted.
        Periods that are all recorded carry their own amounts, so nothing is
        rewritten and the change is allowed."""
        if "fixed" not in (row.amount_kind, values["amount_kind"]):
            return  # a variable cost's amount is only a guide
        priced = ("amount_micros", "currency", "amount_kind")
        if all(values[f] == getattr(row, f) for f in priced):
            return
        recorded = set(
            (
                await ctx.db.execute(
                    select(CostEntry.period_start).where(
                        CostEntry.tenant_id == ctx.access.tenant_id,
                        CostEntry.recurring_cost_id == row.id,
                    )
                )
            ).scalars()
        )
        due = next(
            (
                d
                for d in due_dates(
                    row.start_date, row.end_date, row.cadence, _now().date()
                )
                if d not in recorded
            ),
            None,
        )
        if due is None:
            return
        raise StoreRefused(
            409,
            "price_in_use",
            f"“{row.name}” has periods counted at its current amount that were "
            f"never recorded (the first on {due.isoformat()}), and they count "
            "towards what was spent. If the price changed, give this cost a last due date and add "
            "a new one at the new price. If the amount was entered wrongly, "
            "remove the cost and add it again.",
        )

    async def _before_delete(self, ctx: StoreContext, row: RecurringCost) -> None:
        recorded = await _count(
            ctx.db,
            CostEntry.tenant_id == ctx.access.tenant_id,
            CostEntry.recurring_cost_id == row.id,
        )
        if recorded:
            raise StoreRefused(
                409,
                "periods_recorded",
                f"“{row.name}” has {recorded} recorded period(s), which are real "
                "spend. Give it an end date to stop it instead.",
            )


class CostEntryStore(_Store[CostEntry]):
    model = CostEntry

    def _read(self, row: CostEntry) -> CostEntryRead:
        return entry_read(row)

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        """Newest first. Filters: ``category_id`` (repeatable; ``none`` for
        the uncategorised), ``awaiting_delivery`` (``true``: ordered items
        not yet received), ``recurring_cost_id``."""
        stmt = select(CostEntry).where(CostEntry.tenant_id == ctx.access.tenant_id)
        categories = filters.get("category_id") or []
        if categories:
            ids = [_uuid_or_none(v) for v in categories if v != "none"]
            clauses: list[Any] = []
            if any(ids):
                clauses.append(CostEntry.category_id.in_([i for i in ids if i]))
            if "none" in categories:
                clauses.append(CostEntry.category_id.is_(None))
            if not clauses:
                return ListResult(items=[])
            stmt = stmt.where(or_(*clauses))
        if (filters.get("awaiting_delivery") or [""])[0].lower() == "true":
            stmt = stmt.where(
                CostEntry.expects_delivery.is_(True), CostEntry.received_on.is_(None)
            )
        recurring = filters.get("recurring_cost_id") or []
        if recurring:
            ids = [i for i in (_uuid_or_none(v) for v in recurring) if i]
            if not ids:
                return ListResult(items=[])
            stmt = stmt.where(CostEntry.recurring_cost_id.in_(ids))
        stmt = stmt.order_by(CostEntry.incurred_on.desc(), CostEntry.created_at.desc())
        rows = (await ctx.db.execute(stmt)).scalars()
        return ListResult(items=[entry_read(r) for r in rows])

    async def _check(
        self, ctx: StoreContext, values: dict[str, Any], row: CostEntry | None
    ) -> None:
        if row is None or values["category_id"] != row.category_id:
            await _require_category(ctx.db, ctx.access.tenant_id, values["category_id"])
        problem = entry_problem(
            expects_delivery=values["expects_delivery"],
            received_on=values["received_on"],
        )
        if problem:
            raise StoreRefused(422, "invalid_cost_entry", problem)
        if row is None and values.get("recurring_cost_id") is not None:
            await self._check_period(
                ctx, values["recurring_cost_id"], values["period_start"]
            )

    async def _check_period(
        self, ctx: StoreContext, recurring_cost_id: UUID, period_start: date
    ) -> None:
        cost = (
            (
                await ctx.db.execute(
                    # Locked, so a concurrent reschedule (which locks the
                    # same row) cannot move the due dates under this check.
                    select(RecurringCost)
                    .where(
                        RecurringCost.id == recurring_cost_id,
                        RecurringCost.tenant_id == ctx.access.tenant_id,
                    )
                    .with_for_update()
                )
            )
            .scalars()
            .first()
        )
        if cost is None:
            raise StoreRefused(
                422,
                "recurring_cost_not_found",
                "A recorded period must belong to one of this project's recurring costs.",
            )
        if not is_due_date(cost.start_date, cost.end_date, cost.cadence, period_start):
            raise StoreRefused(
                422,
                "not_a_due_date",
                f"“{cost.name}” does not fall due on {period_start.isoformat()}.",
            )
        taken = await _count(
            ctx.db,
            CostEntry.tenant_id == ctx.access.tenant_id,
            CostEntry.recurring_cost_id == recurring_cost_id,
            CostEntry.period_start == period_start,
        )
        if taken:
            raise StoreRefused(
                409,
                "period_already_recorded",
                f"The {period_start.isoformat()} period of “{cost.name}” is "
                "already recorded — edit that entry instead.",
            )


def _uuid_or_none(value: str) -> UUID | None:
    try:
        return UUID(value)
    except ValueError:
        return None


def cost_category_store() -> CostCategoryStore:
    """FastAPI dependency (a class instance so tests can override it)."""
    return CostCategoryStore()


def recurring_cost_store() -> RecurringCostStore:
    return RecurringCostStore()


def cost_entry_store() -> CostEntryStore:
    return CostEntryStore()


router = APIRouter()


@router.get("/costs/summary", response_model=CostSummary)
async def read_cost_summary(
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> CostSummary:
    """What the project has spent, per currency; the month-by-category table;
    and every recurring period that has fallen due, recorded or not. Computed
    on read against today (UTC); readable by any member."""
    entries = (
        await db.execute(
            select(CostEntry).where(CostEntry.tenant_id == access.tenant_id)
        )
    ).scalars()
    recurring = (
        await db.execute(
            select(RecurringCost).where(RecurringCost.tenant_id == access.tenant_id)
        )
    ).scalars()
    settings = await overview_settings.get_settings(db, tenant_id=access.tenant_id)
    if settings is None:
        settings = overview_settings.default_settings_row(access.tenant_id)
    return CostSummary.model_validate(
        summarize(
            entries,
            recurring,
            today=_now().date(),
            base_currency=settings.base_currency,
        )
    )


__all__ = [
    "CostCategoryStore",
    "CostEntryStore",
    "RecurringCostStore",
    "cost_category_store",
    "cost_entry_store",
    "recurring_cost_store",
    "router",
]
