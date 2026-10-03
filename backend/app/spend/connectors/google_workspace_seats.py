"""Google Workspace assigned seats — a WARNING, never money (plan Phase 9,
decisions 4 and 11).

A direct Workspace customer has no API for invoices, so Workspace spend is a
recurring cost the operator enters from the invoice. This connector reads only
the assigned seat count — Enterprise License Manager
``licensing.licenseAssignments.listForProduct``
(``GET https://licensing.googleapis.com/apps/licensing/v1/product/{productId}/users?customerId=``,
scope ``apps.licensing``, through a domain-wide-delegated service account
impersonating an admin) — and compares it with the seat count noted on the
vendor's recurring entry. When they differ the Sources card says so: a prompt
to update the entry. **It never computes a price** (no seats × list price).

The noted count is read from the recurring entry's ``source_note`` or
``description`` ("3 seats, Business Starter…"), else its ``quantity``.

Payload (both transports): ``{"product_id": "Google-Apps", "items": [...]}`` —
the license assignments of every page.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from urllib.parse import quote
from uuid import UUID

from sqlalchemy import select

from app.spend.connectors import (
    ConnectorSpec,
    CredentialField,
    CredentialRejected,
    FetchContext,
    IngestQuery,
    NormalisedBatch,
    NormaliseError,
    Pull,
    _google,
    _http,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.overview import Vendor

API = "https://licensing.googleapis.com/apps/licensing/v1/product/{product}/users"
SCOPE = "https://www.googleapis.com/auth/apps.licensing"
DEFAULT_PRODUCT = "Google-Apps"
MAX_PAGES = 100
_SEATS = re.compile(r"(\d+)\s*seats?\b", re.IGNORECASE)


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        raise NormaliseError(
            "payload has no items list — not a license assignment list"
        )
    if not query.is_day:
        raise NormaliseError("a seat count is a day's snapshot, not a month")
    start, end = query.days()
    by_sku: Counter[str] = Counter()
    users: set[str] = set()
    for index, item in enumerate(raw["items"]):
        if not isinstance(item, dict):
            raise NormaliseError(f"items[{index}] is not an object")
        user = item.get("userId")
        if not isinstance(user, str) or not user:
            raise NormaliseError(f"items[{index}] has no userId")
        sku = str(item.get("skuName") or item.get("skuId") or "unknown")
        by_sku[sku] += 1
        users.add(user.lower())
    product = str(raw.get("product_id") or DEFAULT_PRODUCT)
    return NormalisedBatch(
        granularity="day" if start == end else "range",
        period_start=start,
        period_end=end,
        items_seen=len(raw["items"]),
        provider_endpoint=f"GET {API.format(product=product)}",
        entries=[],
        facts={"seats": len(users), "by_sku": dict(by_sku), "product_id": product},
    )


def noted_seats(
    description: str, source_note: str | None, quantity: Decimal
) -> int | None:
    """The seat count an operator noted on a recurring entry, if any."""
    for text in (source_note or "", description or ""):
        match = _SEATS.search(text)
        if match:
            return int(match.group(1))
    if (
        quantity is not None
        and quantity == quantity.to_integral_value()
        and quantity > 1
    ):
        return int(quantity)
    return None


async def apply(
    db: AsyncSession, tenant_id: UUID, vendor: Vendor, batch: NormalisedBatch
) -> list[str]:
    from app.models.overview import RecurringCost

    seats = batch.facts.get("seats")
    if not isinstance(seats, int):
        return []
    entries = list(
        (
            await db.execute(
                select(RecurringCost).where(
                    RecurringCost.tenant_id == tenant_id,
                    RecurringCost.vendor_id == vendor.id,
                    RecurringCost.end_date.is_(None),
                )
            )
        ).scalars()
    )
    if not entries:
        return [
            f"Google Workspace reports {seats} assigned seat(s), and no recurring "
            "cost is entered — add the invoice amount as a recurring cost."
        ]
    notes: list[str] = []
    noted_any = False
    for entry in entries:
        noted = noted_seats(entry.description, entry.source_note, entry.quantity)
        if noted is None:
            continue
        noted_any = True
        if noted != seats:
            notes.append(
                f"Seats changed: Google Workspace reports {seats} assigned seat(s); "
                f"the recurring cost '{entry.description}' notes {noted}. Update "
                "it from the latest invoice."
            )
    if not noted_any:
        notes.append(
            f"Google Workspace reports {seats} assigned seat(s); no recurring cost "
            "notes a seat count (e.g. '3 seats' in its note) to compare with."
        )
    return notes


async def _assignments(
    credential: dict[str, Any], *, limit: int | None = None
) -> dict[str, Any]:
    admin, customer = _http.require_fields(credential, "admin_email", "customer_id")
    product = str(credential.get("product_id") or DEFAULT_PRODUCT)
    token = await _google.access_token(credential, scope=SCOPE, subject=admin)
    items: list[Any] = []
    page: str | None = None
    for _ in range(MAX_PAGES):
        params: dict[str, Any] = {"customerId": customer, "maxResults": limit or 1000}
        if page:
            params["pageToken"] = page
        body = await _http.get_json(
            API.format(product=quote(product, safe="")),
            provider="Google Enterprise License Manager",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
        )
        if not isinstance(body, dict):
            raise CredentialRejected(
                "invalid_response", "License Manager answered no assignment list"
            )
        items.extend(body.get("items") or [])
        page = body.get("nextPageToken")
        if limit is not None or not page:
            return {"product_id": product, "items": items}
    raise CredentialRejected(
        "provider_error", f"license assignments ran past {MAX_PAGES} pages"
    )


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    await _assignments(credential, limit=1)


async def fetch(ctx: FetchContext) -> list[Pull]:
    raw = await _assignments(ctx.credential)
    today = ctx.now.astimezone(UTC).date()
    return [Pull(IngestQuery(today.year, today.month, today.day), raw)]


SPEC = ConnectorSpec(
    key="google_workspace_seats",
    provider="Google Workspace",
    expected_lag_hours=24,
    provenance="seat count from the Enterprise License Manager API (no money)",
    normalise=normalise,
    produces_money=False,
    spike_rule=False,
    credential_fields=(
        CredentialField(
            "service_account_json", "Service-account JSON key", multiline=True
        ),
        CredentialField(
            "admin_email",
            "Admin email to impersonate",
            secret=False,
        ),
        CredentialField(
            "customer_id",
            "Customer ID",
            secret=False,
            help="C0xxxxxxx — Admin console -> Account -> Account settings",
        ),
        CredentialField(
            "product_id",
            "Product ID",
            secret=False,
            required=False,
            help="Google-Apps unless your licenses are under another product",
        ),
    ),
    credential_help=(
        "Optional seat-change warning. Enable the Enterprise License Manager "
        "API in a Google Cloud project, create a service account "
        "qontinui-workspace-seats with a JSON key, and in admin.google.com -> "
        "Security -> API controls -> Domain-wide delegation add its client id "
        "with ONLY the scope https://www.googleapis.com/auth/apps.licensing."
    ),
    validate=validate,
    fetch=fetch,
    apply=apply,
    min_pull_interval_hours=24,
)
