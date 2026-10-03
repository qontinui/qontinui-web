"""The editable spend resources: vendors, spend rules and recurring costs.

Each is a :class:`~app.overview.resource.ResourceSpec` in
``app.overview.registry``, so it gets the authoring layer's generic CRUD, the
``If-Match`` concurrency contract, ``overview.change_log`` audit and the
``project_admin`` write rule from one place. This module supplies the read and
write shapes and one small ORM-backed store per resource.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.overview import (
    SPEND_CONNECTORS,
    VENDOR_CATEGORIES,
    RecurringCost,
    SpendRule,
    Vendor,
)
from app.overview.precision import numeric
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.spend.recurring import next_charge_on

VendorCategory = Literal["ai", "cloud", "source_hosting", "saas", "labour", "other"]
ConnectorKey = Literal[
    "github_billing",
    "aws_cost_explorer",
    "vercel_billing",
    "cloudflare_billing",
    "anthropic_cost_report",
    "google_play_earnings",
    "google_workspace_seats",
    "upstash_billing",
    "namecheap_domains",
]
Cadence = Literal["monthly", "annual"]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]

assert set(VendorCategory.__args__) == set(VENDOR_CATEGORIES)  # type: ignore[attr-defined]
assert set(ConnectorKey.__args__) == set(SPEND_CONNECTORS)  # type: ignore[attr-defined]

#: A connector_config key that looks like a credential. Credentials live in
#: Secrets Manager (plan decision 7) and never in a database row.
_SECRETISH = re.compile(
    r"(token|secret|password|passwd|api_?key|private|credential)", re.I
)


def _parse_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise RecordNotFound(value) from exc


def _check_config(config: dict[str, Any] | None) -> None:
    """Refuse a key that looks like a credential. Raised by the STORE rather
    than as a pydantic error, because a validation error echoes the input —
    and the input here may be the very secret being refused."""
    if not config:
        return
    bad: list[str] = []

    def walk(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, inner in value.items():
                where = f"{path}.{key}" if path else str(key)
                if _SECRETISH.search(str(key)):
                    bad.append(where)
                walk(inner, where)
        elif isinstance(value, list):
            for index, inner in enumerate(value):
                walk(inner, f"{path}[{index}]")

    walk(config, "")
    bad.sort()
    if bad:
        raise StoreRefused(
            422,
            "credential_in_config",
            f"connector_config holds non-secret settings only; {bad} look like "
            "credentials — link those through the credential vault instead.",
        )


# ---------------------------------------------------------------------------
# Vendors
# ---------------------------------------------------------------------------


class VendorRead(BaseModel):
    id: str
    name: str
    category: VendorCategory
    preset_key: str | None
    connector: ConnectorKey | None
    connector_config: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime


class VendorCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    category: VendorCategory
    preset_key: str | None = Field(default=None, max_length=100)
    connector: ConnectorKey | None = None
    connector_config: dict[str, Any] = Field(default_factory=dict)


class VendorUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: VendorCategory | None = None
    preset_key: str | None = Field(default=None, max_length=100)
    connector: ConnectorKey | None = None
    connector_config: dict[str, Any] | None = None


def _vendor_read(row: Vendor) -> VendorRead:
    return VendorRead(
        id=str(row.id),
        name=row.name,
        category=row.category,  # type: ignore[arg-type]
        preset_key=row.preset_key,
        connector=row.connector,  # type: ignore[arg-type]
        connector_config=dict(row.connector_config or {}),
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ---------------------------------------------------------------------------
# Spend rules
# ---------------------------------------------------------------------------

Threshold = Annotated[int, Field(ge=1, le=1000)]


class SpendRuleRead(BaseModel):
    id: str
    vendor_id: str | None
    currency: str
    monthly_ceiling_micros: int | None
    daily_abs_micros: int | None
    spike_multiplier: Decimal | None
    median_window_days: int | None
    mtd_thresholds_pct: list[int] | None
    product_filter: list[str] | None
    note: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class SpendRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: NULL = an org-wide rule over every vendor.
    vendor_id: UUID | None = None
    currency: Currency = "USD"
    monthly_ceiling_micros: int | None = Field(default=None, gt=0)
    daily_abs_micros: int | None = Field(default=None, gt=0)
    spike_multiplier: Annotated[Decimal, numeric(6, 2, gt=1)] | None = None
    median_window_days: int | None = Field(default=None, ge=7, le=90)
    mtd_thresholds_pct: list[Threshold] | None = Field(default=None, max_length=20)
    product_filter: list[Annotated[str, Field(min_length=1, max_length=100)]] | None = (
        Field(default=None, max_length=50)
    )
    note: str | None = Field(default=None, max_length=2000)


class SpendRuleUpdate(BaseModel):
    """Partial: a field left out is unchanged; a field sent as ``null`` is
    cleared. The vendor a rule belongs to is fixed at creation."""

    model_config = ConfigDict(extra="forbid")

    currency: Currency | None = None
    monthly_ceiling_micros: int | None = Field(default=None, gt=0)
    daily_abs_micros: int | None = Field(default=None, gt=0)
    spike_multiplier: Annotated[Decimal, numeric(6, 2, gt=1)] | None = None
    median_window_days: int | None = Field(default=None, ge=7, le=90)
    mtd_thresholds_pct: list[Threshold] | None = Field(default=None, max_length=20)
    product_filter: list[Annotated[str, Field(min_length=1, max_length=100)]] | None = (
        Field(default=None, max_length=50)
    )
    note: str | None = Field(default=None, max_length=2000)


def _rule_read(row: SpendRule) -> SpendRuleRead:
    return SpendRuleRead(
        id=str(row.id),
        vendor_id=str(row.vendor_id) if row.vendor_id else None,
        currency=row.currency,
        monthly_ceiling_micros=row.monthly_ceiling_micros,
        daily_abs_micros=row.daily_abs_micros,
        spike_multiplier=row.spike_multiplier,
        median_window_days=row.median_window_days,
        mtd_thresholds_pct=(
            sorted(row.mtd_thresholds_pct) if row.mtd_thresholds_pct else None
        ),
        product_filter=list(row.product_filter) if row.product_filter else None,
        note=row.note,
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ---------------------------------------------------------------------------
# Recurring costs
# ---------------------------------------------------------------------------


class RecurringCostRead(BaseModel):
    id: str
    vendor_id: str
    description: str
    unit_amount_micros: int
    quantity: Decimal
    currency: str
    cadence: Cadence
    start_date: date
    end_date: date | None
    renews_on: date | None
    external_ref: str | None
    source_note: str | None
    #: Whether the provider renews it by itself — written only by a connector
    #: (Namecheap); ``null`` is "not known". Read-only here.
    auto_renew: bool | None = None
    #: The next date this entry charges on or after today (UTC), or ``null``
    #: once it has ended. Derived on read.
    next_charge_on: date | None
    version: int
    created_at: datetime
    updated_at: datetime


class RecurringCostCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor_id: UUID
    description: str = Field(min_length=1, max_length=500)
    unit_amount_micros: int = Field(ge=0)
    quantity: Annotated[Decimal, numeric(12, 4, gt=0)] = Decimal("1")
    currency: Currency = "USD"
    cadence: Cadence
    start_date: date
    end_date: date | None = None
    renews_on: date | None = None
    external_ref: str | None = Field(default=None, max_length=500)
    source_note: str | None = Field(default=None, max_length=2000)


class RecurringCostUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str | None = Field(default=None, min_length=1, max_length=500)
    unit_amount_micros: int | None = Field(default=None, ge=0)
    quantity: Annotated[Decimal, numeric(12, 4, gt=0)] | None = None
    currency: Currency | None = None
    cadence: Cadence | None = None
    start_date: date | None = None
    end_date: date | None = None
    renews_on: date | None = None
    external_ref: str | None = Field(default=None, max_length=500)
    source_note: str | None = Field(default=None, max_length=2000)


def _recurring_read(row: RecurringCost, today: date | None = None) -> RecurringCostRead:
    from datetime import UTC
    from datetime import datetime as _dt

    return RecurringCostRead(
        id=str(row.id),
        vendor_id=str(row.vendor_id),
        description=row.description,
        unit_amount_micros=row.unit_amount_micros,
        quantity=row.quantity,
        currency=row.currency,
        cadence=row.cadence,  # type: ignore[arg-type]
        start_date=row.start_date,
        end_date=row.end_date,
        renews_on=row.renews_on,
        external_ref=row.external_ref,
        source_note=row.source_note,
        auto_renew=row.auto_renew,
        next_charge_on=next_charge_on(row, today or _dt.now(UTC).date()),
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ---------------------------------------------------------------------------
# One ORM-backed store, three configurations
# ---------------------------------------------------------------------------

#: Fields an update may never touch through the generic route.
_FIXED = frozenset({"id", "tenant_id", "version", "created_at", "created_by"})


class _OrmStore:
    model: Any
    resource_label: str
    #: Columns whose UUID must name a vendor in the SAME tenant.
    vendor_fields: tuple[str, ...] = ()

    def _read(self, row: Any) -> BaseModel:
        raise NotImplementedError

    def _check(self, row: Any) -> None:
        """Cross-field rules the column CHECKs also enforce, raised as a 422
        naming the problem rather than a database error."""

    def _duplicate(self) -> StoreRefused:
        return StoreRefused(409, "name_taken", f"That {self.resource_label} exists.")

    async def _load(self, ctx: StoreContext, record_id: str) -> Any:
        row = (
            (
                await ctx.db.execute(
                    select(self.model).where(
                        self.model.id == _parse_id(record_id),
                        self.model.tenant_id == ctx.access.tenant_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def _check_vendor(self, ctx: StoreContext, vendor_id: UUID | None) -> None:
        if vendor_id is None:
            return
        found = await ctx.db.scalar(
            select(Vendor.id).where(
                Vendor.id == vendor_id, Vendor.tenant_id == ctx.access.tenant_id
            )
        )
        if found is None:
            # 422, never "exists elsewhere": another tenant's id is not news.
            raise StoreRefused(
                422, "unknown_vendor", "There is no such vendor in this project."
            )

    async def _flush(self, ctx: StoreContext, add: Any = None) -> None:
        """Flush inside a savepoint, so a duplicate refused by a unique
        constraint leaves the request's transaction usable for the 409."""
        try:
            async with ctx.db.begin_nested():
                if add is not None:
                    ctx.db.add(add)
                await ctx.db.flush()
        except IntegrityError as exc:
            raise self._duplicate() from exc

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        stmt = select(self.model).where(self.model.tenant_id == ctx.access.tenant_id)
        for raw in filters.get("vendor_id", []):
            try:
                stmt = stmt.where(self.model.vendor_id == UUID(raw))
            except ValueError:
                return ListResult(items=[])
        rows = (await ctx.db.execute(stmt.order_by(self.model.created_at))).scalars()
        return ListResult(items=[self._read(r) for r in rows.all()])

    async def get(self, ctx: StoreContext, record_id: str) -> BaseModel:
        return self._read(await self._load(ctx, record_id))

    async def create(self, ctx: StoreContext, payload: BaseModel) -> BaseModel:
        values = payload.model_dump()
        for name in self.vendor_fields:
            await self._check_vendor(ctx, values.get(name))
        row = self.model(
            tenant_id=ctx.access.tenant_id,
            version=1,
            created_by=ctx.access.actor,
            updated_by=ctx.access.actor,
            **values,
        )
        self._check(row)
        await self._flush(ctx, add=row)
        await ctx.db.refresh(row)
        return self._read(row)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: BaseModel,
        expected_version: int,
    ) -> tuple[BaseModel, BaseModel]:
        row = await self._load(ctx, record_id)
        before = self._read(row)
        if row.version != expected_version:
            raise StaleVersion(before)
        changes = {
            k: v
            for k, v in payload.model_dump(exclude_unset=True).items()
            if k not in _FIXED
        }
        for name in self.vendor_fields:
            if name in changes:
                await self._check_vendor(ctx, changes[name])
        changed = {k: v for k, v in changes.items() if getattr(row, k) != v}
        if not changed:
            return before, before
        original = {key: getattr(row, key) for key in changed}
        for key, value in changed.items():
            setattr(row, key, value)
        try:
            # The cross-field rules read the row as it would be; a refusal
            # puts every attribute back, so nothing half-applied can reach a
            # later flush or the request's commit.
            self._check(row)
        except StoreRefused:
            for key, value in original.items():
                setattr(row, key, value)
            raise
        row.version += 1
        row.updated_by = ctx.access.actor
        await self._flush(ctx)
        await ctx.db.refresh(row)
        return before, self._read(row)

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> BaseModel:
        row = await self._load(ctx, record_id)
        before = self._read(row)
        if row.version != expected_version:
            raise StaleVersion(before)
        await ctx.db.delete(row)
        await ctx.db.flush()
        return before


class VendorStore(_OrmStore):
    model = Vendor
    resource_label = "vendor"

    def _read(self, row: Any) -> BaseModel:
        return _vendor_read(row)

    def _duplicate(self) -> StoreRefused:
        return StoreRefused(
            409, "name_taken", "There is already a vendor with that name here."
        )

    def _check(self, row: Any) -> None:
        _check_config(row.connector_config)

    async def update(  # type: ignore[override]
        self,
        ctx: StoreContext,
        record_id: str,
        payload: BaseModel,
        expected_version: int,
    ) -> tuple[BaseModel, BaseModel]:
        # connector_config is NOT NULL: a null in a partial update means "no
        # settings", i.e. {}.
        if "connector_config" in payload.model_fields_set and (
            getattr(payload, "connector_config", None) is None
        ):
            payload = payload.model_copy(update={"connector_config": {}})
        return await super().update(ctx, record_id, payload, expected_version)


class SpendRuleStore(_OrmStore):
    model = SpendRule
    resource_label = "spend rule"
    vendor_fields = ("vendor_id",)

    def _read(self, row: Any) -> BaseModel:
        return _rule_read(row)

    def _duplicate(self) -> StoreRefused:
        return StoreRefused(
            409,
            "name_taken",
            "That vendor (or the org-wide scope) already has a rule; edit it instead.",
        )

    def _check(self, row: Any) -> None:
        from app.spend.summary import SUMMARY_CURRENCY

        # A vendor's rule reads that vendor's connector rows, which are in the
        # provider's currency. The org-wide rule is the project's spend LIMIT:
        # it is evaluated in the base currency over every converted figure and
        # priced labour (``app.spend.evaluate``), so it may be set in any
        # currency the project can convert.
        if row.vendor_id is not None and row.currency != SUMMARY_CURRENCY:
            raise StoreRefused(
                422,
                "unsupported_currency",
                f"A vendor's spend rule is in {SUMMARY_CURRENCY}, the currency its "
                f"connector reports; {row.currency} is not supported. The "
                "org-wide rule (no vendor) may be in any currency.",
            )
        if row.mtd_thresholds_pct and row.monthly_ceiling_micros is None:
            raise StoreRefused(
                422,
                "thresholds_without_ceiling",
                "Month-to-date thresholds are percentages of monthly_ceiling_micros; "
                "set a ceiling too.",
            )
        if row.mtd_thresholds_pct:
            row.mtd_thresholds_pct = sorted(set(row.mtd_thresholds_pct))


class RecurringCostStore(_OrmStore):
    model = RecurringCost
    resource_label = "recurring cost"
    vendor_fields = ("vendor_id",)

    def _read(self, row: Any) -> BaseModel:
        return _recurring_read(row)

    def _check(self, row: Any) -> None:
        # Any currency: the costs summary converts it to the project's base
        # currency (``app.costs.fx``), and the USD-only spend read names its
        # vendor as partial rather than summing it wrongly.
        if row.end_date is not None and row.end_date < row.start_date:
            raise StoreRefused(422, "bad_period", "end_date is before start_date.")
        if row.renews_on is not None and row.renews_on < row.start_date:
            raise StoreRefused(422, "bad_renewal", "renews_on is before start_date.")


def vendor_store() -> VendorStore:
    return VendorStore()


def spend_rule_store() -> SpendRuleStore:
    return SpendRuleStore()


def recurring_cost_store() -> RecurringCostStore:
    return RecurringCostStore()
