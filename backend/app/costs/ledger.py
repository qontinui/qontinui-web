"""The ledger: ``GET /overview/costs/ledger`` — every cost and every hour.

Business-leaders plan, Phase 4 tab 3: every cost entry and effort entry,
filterable, with a CSV export. Recurring costs appear as their CHARGES (one
row per charge date in the window), so the ledger's money adds up to the
``charged`` view of the costs summary. Each row says which resource writes it
(``resource`` + ``id``) and whether the caller may (``editable``), so a
client edits through the authoring contract, never through this read.

Every amount is also given in the base currency where a rate converts it
(:mod:`app.costs.fx`); ``base_micros`` is ``null`` where none does — never
the original figure relabelled.

``format=csv`` returns the same rows as a spreadsheet: amounts as exact
decimal strings (micros never pass through a float), text cells guarded
against formula injection, and ``X-Ledger-Truncated`` when the export hit its
row cap.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.costs.effort import editable_by
from app.costs.fx import FxApplied, FxBook, FxMissing
from app.costs.labour import entry_cost_micros, is_labour, labour_entries_count_as_cost
from app.costs.summary import load_settings
from app.models.overview import CostEntry, EffortEntry, Phase, RecurringCost, Vendor
from app.overview.permissions import OverviewAccess
from app.spend.recurring import amount_micros, charge_dates

LedgerKind = Literal["cost", "recurring", "effort"]
CountedAs = Literal["vendor", "labour", "excluded_labour", "time_only"]

DEFAULT_PAGE = 200
MAX_PAGE = 1000
#: The most rows one CSV export carries.
MAX_EXPORT_ROWS = 100_000


class LedgerRow(BaseModel):
    kind: LedgerKind
    #: The registry resource that writes this row: ``cost_entries``,
    #: ``recurring_costs`` or ``effort_entries``.
    resource: str
    #: That resource's record id (a recurring row's id is its entry's; the
    #: charge itself is derived).
    id: str
    #: The entry's first day, a recurring charge's date, or the work date.
    date: dt.date
    period_end: dt.date | None
    vendor_id: str | None
    vendor_name: str | None
    #: The effective category (the entry's own, else its vendor's).
    category: str | None
    description: str
    #: ``manual|connector|recurring`` for money; ``effort`` for time.
    source: str
    amount_micros: int | None
    currency: str | None
    #: The rate that converted it, and where it came from.
    fx_rate: Decimal | None
    fx_source: Literal["entry", "settings"] | None
    base_micros: int | None
    #: The phase the row names itself (no derivation in the ledger).
    phase_id: str | None
    phase_code: str | None
    person: str | None
    hours: Decimal | None
    role_code: str | None
    #: How the costs summary counts it under the project's labour billing.
    counted_as: CountedAs
    provider_reported: bool
    editable: bool
    version: int


class LedgerPage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    base_currency: str
    labour_billing: str
    from_: dt.date = Field(alias="from")
    to: dt.date
    rows: list[LedgerRow]
    total_rows: int
    offset: int
    limit: int
    fx_applied: list[FxApplied]
    fx_missing: list[FxMissing]


@dataclass(frozen=True)
class LedgerQuery:
    start: dt.date
    end: dt.date
    kinds: frozenset[LedgerKind]
    vendor_id: UUID | None = None
    category: str | None = None
    #: A phase id, or ``"none"`` for rows naming no phase.
    phase: str | None = None
    source: str | None = None


def _counted(billing: str, labour: bool) -> CountedAs:
    if not labour:
        return "vendor"
    return "labour" if labour_entries_count_as_cost(billing) else "excluded_labour"


async def ledger_rows(
    db: AsyncSession, access: OverviewAccess, query: LedgerQuery
) -> tuple[list[LedgerRow], FxBook, str, str]:
    """Every row matching ``query``, newest first. Returns the rows, the FX
    book that converted them, the base currency and the labour billing."""
    tenant_id = access.tenant_id
    settings = await load_settings(db, tenant_id)
    fx = FxBook.for_settings(settings.base_currency, settings.fx_rates)
    billing = settings.labour_billing
    vendors = {
        v.id: v
        for v in (
            await db.execute(select(Vendor).where(Vendor.tenant_id == tenant_id))
        ).scalars()
    }
    phases = {
        p.id: p.code
        for p in (
            await db.execute(select(Phase).where(Phase.tenant_id == tenant_id))
        ).scalars()
    }
    can_admin = access.can_edit("project_admin")
    phase_none = query.phase == "none"
    phase_id: UUID | None = None
    if query.phase is not None and not phase_none:
        phase_id = UUID(query.phase)
    rows: list[LedgerRow] = []

    def convert(
        micros: int, currency: str, entry_rate: Decimal | None
    ) -> tuple[int | None, Decimal | None, Literal["entry", "settings"] | None]:
        if currency == fx.base_currency:
            return micros, None, None
        found = fx.rate_for(currency, entry_rate)
        base = fx.to_base(micros, currency, entry_rate)
        if found is None:
            return None, None, None
        return base, found[0], found[1]

    if "cost" in query.kinds and query.source != "effort":
        stmt = select(CostEntry).where(
            CostEntry.tenant_id == tenant_id,
            CostEntry.period_start <= query.end,
            CostEntry.period_end >= query.start,
        )
        if query.vendor_id is not None:
            stmt = stmt.where(CostEntry.vendor_id == query.vendor_id)
        if query.source is not None:
            stmt = stmt.where(CostEntry.source == query.source)
        if phase_none:
            stmt = stmt.where(CostEntry.phase_id.is_(None))
        elif phase_id is not None:
            stmt = stmt.where(CostEntry.phase_id == phase_id)
        for e in (await db.execute(stmt)).scalars():
            vendor = vendors.get(e.vendor_id)
            category = e.category or (vendor.category if vendor else None)
            if query.category is not None and category != query.category:
                continue
            base, rate, rate_source = convert(
                e.amount_micros, e.currency, e.fx_rate_to_base
            )
            rows.append(
                LedgerRow(
                    kind="cost",
                    resource="cost_entries",
                    id=str(e.id),
                    date=e.period_start,
                    period_end=e.period_end,
                    vendor_id=str(e.vendor_id),
                    vendor_name=vendor.name if vendor else None,
                    category=category,
                    description=e.description,
                    source=e.source,
                    amount_micros=e.amount_micros,
                    currency=e.currency,
                    fx_rate=rate,
                    fx_source=rate_source,
                    base_micros=base,
                    phase_id=str(e.phase_id) if e.phase_id else None,
                    phase_code=phases.get(e.phase_id) if e.phase_id else None,
                    person=None,
                    hours=None,
                    role_code=None,
                    counted_as=_counted(
                        billing,
                        is_labour(e.category, vendor.category if vendor else None),
                    ),
                    provider_reported=e.source != "manual",
                    editable=can_admin,
                    version=e.version or 1,
                )
            )

    if (
        "recurring" in query.kinds
        and query.source in (None, "recurring")
        and not phase_id
    ):
        stmt_r = select(RecurringCost).where(RecurringCost.tenant_id == tenant_id)
        if query.vendor_id is not None:
            stmt_r = stmt_r.where(RecurringCost.vendor_id == query.vendor_id)
        for r in (await db.execute(stmt_r)).scalars():
            vendor = vendors.get(r.vendor_id)
            category = vendor.category if vendor else None
            if query.category is not None and category != query.category:
                continue
            amount = amount_micros(r)
            for charge in charge_dates(r, query.start, query.end):
                base, rate, rate_source = convert(amount, r.currency, None)
                rows.append(
                    LedgerRow(
                        kind="recurring",
                        resource="recurring_costs",
                        id=str(r.id),
                        date=charge,
                        period_end=None,
                        vendor_id=str(r.vendor_id),
                        vendor_name=vendor.name if vendor else None,
                        category=category,
                        description=r.description,
                        source="recurring",
                        amount_micros=amount,
                        currency=r.currency,
                        fx_rate=rate,
                        fx_source=rate_source,
                        base_micros=base,
                        phase_id=None,
                        phase_code=None,
                        person=None,
                        hours=None,
                        role_code=None,
                        counted_as=_counted(billing, is_labour(None, category)),
                        provider_reported=False,
                        editable=can_admin,
                        version=r.version,
                    )
                )

    if (
        "effort" in query.kinds
        and query.vendor_id is None
        and query.source in (None, "effort")
        and query.category in (None, "labour")
    ):
        stmt_e = select(EffortEntry).where(
            EffortEntry.tenant_id == tenant_id,
            EffortEntry.work_date >= query.start,
            EffortEntry.work_date <= query.end,
        )
        if phase_none:
            stmt_e = stmt_e.where(EffortEntry.phase_id.is_(None))
        elif phase_id is not None:
            stmt_e = stmt_e.where(EffortEntry.phase_id == phase_id)
        for t in (await db.execute(stmt_e)).scalars():
            cost: int | None = None
            base = None
            rate = None
            effort_source: Literal["entry", "settings"] | None = None
            priced = (
                billing == "day_rates"
                and t.rate_micros_used is not None
                and t.rate_currency is not None
                and t.hours_per_day_used is not None
            )
            if priced:
                cost = entry_cost_micros(
                    Decimal(t.hours),
                    int(t.rate_micros_used),  # type: ignore[arg-type]
                    Decimal(t.hours_per_day_used),  # type: ignore[arg-type]
                )
                base, rate, effort_source = convert(
                    cost,
                    t.rate_currency,  # type: ignore[arg-type]
                    None,
                )
            rows.append(
                LedgerRow(
                    kind="effort",
                    resource="effort_entries",
                    id=str(t.id),
                    date=t.work_date,
                    period_end=None,
                    vendor_id=None,
                    vendor_name=None,
                    category="labour",
                    description=t.note,
                    source="effort",
                    amount_micros=cost,
                    currency=t.rate_currency if priced else None,
                    fx_rate=rate,
                    fx_source=effort_source,
                    base_micros=base,
                    phase_id=str(t.phase_id) if t.phase_id else None,
                    phase_code=phases.get(t.phase_id) if t.phase_id else None,
                    person=t.person,
                    hours=Decimal(t.hours),
                    role_code=t.role_code,
                    counted_as="labour" if billing == "day_rates" else "time_only",
                    provider_reported=False,
                    editable=editable_by(t, access),
                    version=t.version,
                )
            )

    rows.sort(key=lambda r: (r.date, r.kind, r.id), reverse=True)
    return rows, fx, settings.base_currency, billing


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

CSV_COLUMNS: tuple[str, ...] = (
    "date",
    "period_end",
    "kind",
    "vendor",
    "category",
    "description",
    "source",
    "amount",
    "currency",
    "fx_rate",
    "fx_source",
    "base_amount",
    "base_currency",
    "phase",
    "person",
    "hours",
    "role",
    "counted_as",
    "resource",
    "id",
)

_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _text(value: str | None) -> str:
    """A text cell a spreadsheet will not run as a formula."""
    if not value:
        return ""
    return "'" + value if value.startswith(_FORMULA_START) else value


def _money(micros: int | None) -> str:
    """Micros as an exact decimal string (``-12.5``), never via a float."""
    if micros is None:
        return ""
    value = (Decimal(micros) / Decimal(1_000_000)).normalize()
    return format(value, "f")


def to_csv(rows: list[LedgerRow], base_currency: str) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for r in rows:
        writer.writerow(
            [
                r.date.isoformat(),
                r.period_end.isoformat() if r.period_end else "",
                r.kind,
                _text(r.vendor_name),
                _text(r.category),
                _text(r.description),
                r.source,
                _money(r.amount_micros),
                r.currency or "",
                format(r.fx_rate, "f") if r.fx_rate is not None else "",
                r.fx_source or "",
                _money(r.base_micros),
                base_currency,
                _text(r.phase_code),
                _text(r.person),
                format(r.hours, "f") if r.hours is not None else "",
                _text(r.role_code),
                r.counted_as,
                r.resource,
                r.id,
            ]
        )
    return out.getvalue()


__all__ = [
    "CSV_COLUMNS",
    "DEFAULT_PAGE",
    "MAX_EXPORT_ROWS",
    "MAX_PAGE",
    "LedgerPage",
    "LedgerQuery",
    "LedgerRow",
    "ledger_rows",
    "to_csv",
]
