"""The ``costs/entries`` resource: one-off cost entries, on the authoring
contract (plan ``2026-09-20-overview-authoring-layer`` Phase 5).

``overview.cost_entries`` holds two kinds of row, and they are not equally
editable:

* **Manual** rows (``source = manual``) are the project's own statement of an
  invoice — created, edited and deleted here like any other resource.
* **Provider** rows (``source`` = ``connector`` or ``recurring``) are what a
  provider reported, written by the ingest door. Changing their money would
  turn a provider's statement into an operator's guess, so a PATCH may only
  annotate them — ``phase_id`` (which phase the cost belongs to) and
  ``fx_rate_to_base`` (the rate the project converts it at). Any other field
  is ``422 provider_reported_field``; a DELETE is ``409 provider_reported``
  (the next import would only bring the row back). A re-import keeps both
  annotations (``app.spend.ingest``) and moves ``version`` only when the
  provider's own figures changed.

Permission: ``project_admin``, like the vendors and recurring costs the
entries hang off.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.costs.fx import Rate
from app.costs.integrity import refusal_for
from app.models.overview import CostEntry, Phase, Vendor
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.schemas.overview import MAX_MICROS, _WriteModel
from app.spend.connectors import CONNECTOR_REF_NAMESPACES
from app.spend.resources import Currency, VendorCategory

#: A cost may be a credit or a refund, so the amount is signed; the bound is
#: the one every overview amount has (a double-exact integer).
SignedMicros = Annotated[int, Field(ge=-MAX_MICROS, le=MAX_MICROS)]

#: The fields a PATCH may set on a provider-reported row.
PROVIDER_EDITABLE: frozenset[str] = frozenset({"phase_id", "fx_rate_to_base"})

#: A list read answers at most this many rows (newest period first) and says
#: so when there are more; the ledger (``GET /costs/ledger``) pages through
#: everything.
DEFAULT_LIST_LIMIT = 500
MAX_LIST_LIMIT = 5000


class CostEntryRead(BaseModel):
    id: str
    vendor_id: str
    #: The entry's own category; ``null`` means its vendor's.
    category: str | None
    description: str
    #: NET, in ``currency`` — the billed figure. Negative for a credit.
    amount_micros: int
    currency: str
    #: Units of the base currency per unit of ``currency`` for this entry;
    #: ``null`` means the project's rate (``settings.fx_rates``) applies.
    fx_rate_to_base: Decimal | None
    period_start: date
    period_end: date
    phase_id: str | None
    source: str
    source_ref: str | None
    gross_micros: int | None
    discount_micros: int | None
    quantity: Decimal | None
    unit: str | None
    scope_label: str | None
    sku: str | None
    product: str | None
    #: A provider's statement (connector / recurring) rather than the
    #: project's: only ``phase_id`` and ``fx_rate_to_base`` may change, and
    #: it cannot be deleted.
    provider_reported: bool
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None


class CostEntryCreate(_WriteModel):
    """A one-off cost, entered from an invoice. Always ``source = manual``."""

    model_config = ConfigDict(extra="forbid")

    vendor_id: UUID
    #: ``null`` — the vendor's category applies.
    category: VendorCategory | None = None
    description: str = Field(min_length=1, max_length=500)
    amount_micros: SignedMicros
    currency: Currency
    fx_rate_to_base: Rate | None = None
    period_start: date
    #: The last day the cost covers; defaults to ``period_start``. A
    #: multi-day entry is spread per day under the ``amortized`` view.
    period_end: date | None = None
    phase_id: UUID | None = None
    #: Your own reference (an invoice number). Unique per vendor, so the same
    #: invoice cannot be entered twice.
    source_ref: str | None = Field(default=None, min_length=1, max_length=500)


class CostEntryUpdate(_WriteModel):
    """Partial: a field left out is unchanged; ``null`` clears a nullable one.
    On a provider-reported row only ``phase_id`` and ``fx_rate_to_base``."""

    model_config = ConfigDict(extra="forbid")

    vendor_id: UUID | None = None
    category: VendorCategory | None = None
    description: str | None = Field(default=None, min_length=1, max_length=500)
    amount_micros: SignedMicros | None = None
    currency: Currency | None = None
    fx_rate_to_base: Rate | None = None
    period_start: date | None = None
    period_end: date | None = None
    phase_id: UUID | None = None
    source_ref: str | None = Field(default=None, min_length=1, max_length=500)


def _read(row: CostEntry) -> CostEntryRead:
    return CostEntryRead(
        id=str(row.id),
        vendor_id=str(row.vendor_id),
        category=row.category,
        description=row.description,
        amount_micros=row.amount_micros,
        currency=row.currency,
        fx_rate_to_base=row.fx_rate_to_base,
        period_start=row.period_start,
        period_end=row.period_end,
        phase_id=str(row.phase_id) if row.phase_id else None,
        source=row.source,
        source_ref=row.source_ref,
        gross_micros=row.gross_micros,
        discount_micros=row.discount_micros,
        quantity=row.quantity,
        unit=row.unit,
        scope_label=row.scope_label,
        sku=row.sku,
        product=row.product,
        provider_reported=row.source != "manual",
        version=row.version or 1,
        created_at=row.created_at,
        updated_at=row.updated_at,
        created_by=row.created_by,
        updated_by=row.updated_by,
    )


def _check_reference(source_ref: str | None) -> None:
    """A manual reference may not look like a provider's: the ingest door
    upserts on ``(vendor, source_ref)``, and an entry entered by hand must
    never stand where a provider line will arrive (nor be mistaken for one)."""
    if source_ref is None:
        return
    namespace, sep, _ = source_ref.partition(":")
    if sep and namespace.strip().lower() in CONNECTOR_REF_NAMESPACES:
        raise StoreRefused(
            422,
            "reserved_reference",
            f"References starting {namespace}: are how provider imports name "
            "their lines; use another reference for an entry entered by hand.",
        )


def _parse_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise RecordNotFound(value) from exc


#: Fields whose NULL is not storable (the column is NOT NULL): a ``null`` in a
#: partial update is a 422, not a database error.
_NOT_NULLABLE = frozenset(
    {"vendor_id", "description", "amount_micros", "currency", "period_start"}
)


class CostEntryStore:
    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> CostEntry:
        stmt = select(CostEntry).where(
            CostEntry.id == _parse_id(record_id),
            CostEntry.tenant_id == ctx.access.tenant_id,
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        row = (await ctx.db.execute(stmt)).scalars().first()
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def _check_vendor(self, ctx: StoreContext, vendor_id: UUID) -> None:
        found = await ctx.db.scalar(
            select(Vendor.id).where(
                Vendor.id == vendor_id, Vendor.tenant_id == ctx.access.tenant_id
            )
        )
        if found is None:
            raise StoreRefused(
                422, "unknown_vendor", "There is no such vendor in this project."
            )

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

    @staticmethod
    def _check_period(row: CostEntry) -> None:
        if row.period_end < row.period_start:
            raise StoreRefused(422, "bad_period", "period_end is before period_start.")

    async def _flush(self, ctx: StoreContext, add: Any = None) -> None:
        try:
            async with ctx.db.begin_nested():
                if add is not None:
                    ctx.db.add(add)
                await ctx.db.flush()
        except IntegrityError as exc:
            raise refusal_for(exc) from exc

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        stmt = select(CostEntry).where(CostEntry.tenant_id == ctx.access.tenant_id)
        try:
            for raw in filters.get("vendor_id", []):
                stmt = stmt.where(CostEntry.vendor_id == UUID(raw))
            for raw in filters.get("phase_id", []):
                stmt = stmt.where(
                    CostEntry.phase_id.is_(None)
                    if raw == "none"
                    else CostEntry.phase_id == UUID(raw)
                )
            for raw in filters.get("from", []):
                stmt = stmt.where(CostEntry.period_end >= date.fromisoformat(raw))
            for raw in filters.get("to", []):
                stmt = stmt.where(CostEntry.period_start <= date.fromisoformat(raw))
            limits = [int(raw) for raw in filters.get("limit", [])]
        except ValueError as exc:
            raise StoreRefused(
                422,
                "bad_filter",
                "vendor_id/phase_id are ids (phase_id may be 'none'), from/to "
                "are dates (YYYY-MM-DD) and limit is a number.",
            ) from exc
        sources = filters.get("source", [])
        if sources:
            stmt = stmt.where(CostEntry.source.in_(sources))
        limit = (
            min(max(limits[-1], 1), MAX_LIST_LIMIT) if limits else DEFAULT_LIST_LIMIT
        )
        rows = (
            (
                await ctx.db.execute(
                    stmt.order_by(
                        CostEntry.period_start.desc(),
                        CostEntry.created_at.desc(),
                        CostEntry.id,
                    ).limit(limit + 1)
                )
            )
            .scalars()
            .all()
        )
        items: list[BaseModel] = [_read(r) for r in rows[:limit]]
        degraded = None
        if len(rows) > limit:
            degraded = (
                f"truncated: only the newest {limit} entries are listed; narrow "
                "with from/to/vendor_id, raise limit (at most "
                f"{MAX_LIST_LIMIT}), or page through GET /costs/ledger"
            )
        return ListResult(items=items, degraded=degraded)

    async def get(self, ctx: StoreContext, record_id: str) -> BaseModel:
        return _read(await self._load(ctx, record_id))

    async def create(self, ctx: StoreContext, payload: BaseModel) -> BaseModel:
        assert isinstance(payload, CostEntryCreate)
        await self._check_vendor(ctx, payload.vendor_id)
        await self._check_phase(ctx, payload.phase_id)
        _check_reference(payload.source_ref)
        row = CostEntry(
            tenant_id=ctx.access.tenant_id,
            vendor_id=payload.vendor_id,
            category=payload.category,
            description=payload.description,
            amount_micros=payload.amount_micros,
            currency=payload.currency,
            fx_rate_to_base=payload.fx_rate_to_base,
            period_start=payload.period_start,
            period_end=payload.period_end or payload.period_start,
            phase_id=payload.phase_id,
            source="manual",
            source_ref=payload.source_ref,
            version=1,
            created_by=ctx.access.actor,
            updated_by=ctx.access.actor,
        )
        self._check_period(row)
        await self._flush(ctx, add=row)
        await ctx.db.refresh(row)
        return _read(row)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: BaseModel,
        expected_version: int,
    ) -> tuple[BaseModel, BaseModel]:
        row = await self._load(ctx, record_id, lock=True)
        before = _read(row)
        if before.version != expected_version:
            raise StaleVersion(before)
        changes = payload.model_dump(exclude_unset=True)
        nulled = sorted(k for k in changes if k in _NOT_NULLABLE and changes[k] is None)
        if nulled:
            raise StoreRefused(
                422, "required_field", f"{', '.join(nulled)} cannot be cleared."
            )
        if "period_end" in changes and changes["period_end"] is None:
            # A one-day entry: it ends where it starts.
            changes["period_end"] = changes.get("period_start") or row.period_start
        changes = {k: v for k, v in changes.items() if getattr(row, k) != v}
        if (
            "currency" in changes
            and "fx_rate_to_base" not in payload.model_fields_set
            and row.fx_rate_to_base is not None
        ):
            # The entry's rate was a rate FOR its old currency.
            changes["fx_rate_to_base"] = None
        if "source_ref" in changes:
            _check_reference(changes["source_ref"])
        if row.source != "manual":
            refused = sorted(set(changes) - PROVIDER_EDITABLE)
            if refused:
                raise StoreRefused(
                    422,
                    "provider_reported_field",
                    f"This cost was reported by the provider ({row.source}); "
                    f"only phase_id and fx_rate_to_base can change, not "
                    f"{', '.join(refused)}.",
                )
        if not changes:
            return before, before
        if "vendor_id" in changes:
            await self._check_vendor(ctx, changes["vendor_id"])
        if "phase_id" in changes:
            await self._check_phase(ctx, changes["phase_id"])
        # Every check runs on the would-be values BEFORE anything is applied,
        # so a refusal leaves the row exactly as it was loaded.
        if changes.get("period_end", row.period_end) < changes.get(
            "period_start", row.period_start
        ):
            raise StoreRefused(422, "bad_period", "period_end is before period_start.")
        for key, value in changes.items():
            setattr(row, key, value)
        row.version = (row.version or 1) + 1
        row.updated_by = ctx.access.actor
        await self._flush(ctx)
        await ctx.db.refresh(row)
        return before, _read(row)

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> BaseModel:
        row = await self._load(ctx, record_id, lock=True)
        before = _read(row)
        if before.version != expected_version:
            raise StaleVersion(before)
        if row.source != "manual":
            raise StoreRefused(
                409,
                "provider_reported",
                f"This cost was reported by the provider ({row.source}) and the "
                "next import would bring it back; it cannot be deleted here.",
            )
        await ctx.db.delete(row)
        await ctx.db.flush()
        return before


def cost_entry_store() -> CostEntryStore:
    return CostEntryStore()
