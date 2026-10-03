"""GitHub billing usage → cost entries.

Endpoint: ``GET /organizations/<org>/settings/billing/usage?year=Y&month=M[&day=D]``,
whose body is ``{"usageItems": [...]}``. Each item carries ``date``,
``product``, ``sku``, ``quantity``, ``unitType``, ``pricePerUnit``,
``grossAmount``, ``discountAmount``, ``netAmount``, ``organizationName`` and
``repositoryName``.

* A ``day=`` query is that UTC day's whole statement: one item per (repo,
  product, SKU). Every item's ``date`` falls on the queried day (GitHub stamps
  it with a time of first use, so only the date part is compared).
* A month query (no ``day``) is read ONLY as a reconciliation check (plan
  decision 3): month figures are always sums of stored days, and a month
  payload is never summed with day payloads.

Every product is kept (Actions, Packages, LFS…) — a rule's
``product_filter`` decides what a ceiling counts, not the normaliser.
``amount_micros`` is ``netAmount`` (the billed figure); gross and discount
are stored beside it.
"""

from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal
from typing import Any

from app.spend.connectors import (
    IngestQuery,
    NormalisedBatch,
    NormalisedEntry,
    NormaliseError,
    micros,
)

ENDPOINT = "GET /organizations/{org}/settings/billing/usage"
_REQUIRED = ("date", "product", "sku", "grossAmount", "discountAmount", "netAmount")


def _items(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, dict) or "usageItems" not in raw:
        raise NormaliseError("payload has no usageItems — not a GitHub usage response")
    items = raw["usageItems"]
    if not isinstance(items, list):
        raise NormaliseError("usageItems is not a list")
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise NormaliseError(f"usageItems[{index}] is not an object")
        missing = [k for k in _REQUIRED if item.get(k) is None]
        if missing:
            raise NormaliseError(f"usageItems[{index}] lacks {', '.join(missing)}")
    return items


def _item_day(item: dict[str, Any], index: int) -> date:
    raw = item.get("date")
    if not isinstance(raw, str) or len(raw) < 10:
        raise NormaliseError(f"usageItems[{index}].date is not a date")
    try:
        return date.fromisoformat(raw[:10])
    except ValueError as exc:
        raise NormaliseError(f"usageItems[{index}].date is not a date") from exc


def _org(items: list[dict[str, Any]], config: dict[str, Any]) -> str:
    orgs = {str(i.get("organizationName")) for i in items if i.get("organizationName")}
    configured = config.get("org")
    if len(orgs) > 1:
        raise NormaliseError(f"payload mixes organizations: {sorted(orgs)}")
    org = next(iter(orgs), None) or configured
    if not org:
        raise NormaliseError(
            "payload names no organization and the vendor has no connector_config.org"
        )
    if configured and org != configured:
        raise NormaliseError(
            f"payload is for organization {org!r}, the vendor is {configured!r}"
        )
    return str(org)


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    items = _items(raw)
    org = _org(items, config)
    endpoint = ENDPOINT.format(org=org)
    try:
        month_start = date(query.year, query.month, 1)
    except ValueError as exc:
        raise NormaliseError("query names no valid month") from exc
    month_end = date(
        query.year, query.month, calendar.monthrange(query.year, query.month)[1]
    )

    if not query.is_day:
        net = 0
        for index, item in enumerate(items):
            day = _item_day(item, index)
            if not month_start <= day <= month_end:
                raise NormaliseError(
                    f"usageItems[{index}] is dated {day}, outside the queried month"
                )
            net += micros(
                item["netAmount"], field_name=f"usageItems[{index}].netAmount"
            )
        return NormalisedBatch(
            granularity="month",
            period_start=month_start,
            period_end=month_end,
            items_seen=len(items),
            provider_endpoint=f"{endpoint}?year={query.year}&month={query.month}",
            month_net_micros=net,
            account=org,
            ref_prefix=f"github:{org}:",
        )

    try:
        day = date(query.year, query.month, int(query.day or 0))
    except ValueError as exc:
        raise NormaliseError("query names no valid day") from exc

    merged: dict[str, NormalisedEntry] = {}
    for index, item in enumerate(items):
        item_day = _item_day(item, index)
        if item_day != day:
            # A month-shaped payload (or another day's) on the daily path:
            # storing it under this day would double-count it.
            raise NormaliseError(
                f"usageItems[{index}] is dated {item_day}, not the queried day {day} "
                "— a month payload cannot be ingested as a day"
            )
        product = str(item["product"])
        sku = str(item["sku"])
        repo = str(item.get("repositoryName") or "") or None
        ref = f"github:{org}:{day.isoformat()}:{repo or '-'}:{product}/{sku}"
        quantity_raw = item.get("quantity")
        quantity = (
            Decimal(str(quantity_raw))
            if isinstance(quantity_raw, int | float)
            and not isinstance(quantity_raw, bool)
            else None
        )
        entry = NormalisedEntry(
            source_ref=ref,
            period_start=day,
            period_end=day,
            amount_micros=micros(
                item["netAmount"], field_name=f"usageItems[{index}].netAmount"
            ),
            gross_micros=micros(
                item["grossAmount"], field_name=f"usageItems[{index}].grossAmount"
            ),
            discount_micros=micros(
                item["discountAmount"],
                field_name=f"usageItems[{index}].discountAmount",
            ),
            currency="USD",
            quantity=quantity,
            unit=str(item["unitType"]) if item.get("unitType") else None,
            scope_label=repo,
            sku=sku,
            product=product,
            description=f"{product} — {sku}",
            category="source_hosting",
        )
        prior = merged.get(ref)
        if prior is not None:
            # The same (repo, product, SKU) twice in one day's statement: both
            # are the provider's figures, so the line is their sum.
            entry = NormalisedEntry(
                **{
                    **entry.__dict__,
                    "amount_micros": prior.amount_micros + entry.amount_micros,
                    "gross_micros": (prior.gross_micros or 0)
                    + (entry.gross_micros or 0),
                    "discount_micros": (prior.discount_micros or 0)
                    + (entry.discount_micros or 0),
                    "quantity": (
                        prior.quantity + entry.quantity
                        if prior.quantity is not None and entry.quantity is not None
                        else None
                    ),
                }
            )
        merged[ref] = entry

    return NormalisedBatch(
        granularity="day",
        period_start=day,
        period_end=day,
        items_seen=len(items),
        provider_endpoint=(
            f"{endpoint}?year={query.year}&month={query.month}&day={query.day}"
        ),
        entries=list(merged.values()),
        account=org,
        ref_prefix=f"github:{org}:{day.isoformat()}:",
    )
