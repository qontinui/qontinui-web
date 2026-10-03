"""Cloudflare billing history → cost entries (plan Phase 9).

Endpoint: ``GET https://api.cloudflare.com/client/v4/accounts/{account_id}/billing/history``
(Cloudflare's v4 envelope: ``{"success", "errors", "messages", "result": [...],
"result_info": {...}}``). Each history item carries ``id``, ``type``,
``action``, ``description``, ``occurred_at``, ``amount``, ``currency`` and,
for a zone subscription, ``zone.name``.

* One entry per history item, dated to its charge day (``occurred_at``, UTC):
  ``source_ref = cloudflare:<account>:<day>:<item id>``.
* A ``refund`` item is a negative cost (Cloudflare reports its amount as a
  positive number with ``type: refund``).
* The Billable Usage API (daily usage, for the spike rule) is NOT read: it is
  available only on some plans, and its shape is unverified here. Invoice
  lines alone are the statement this connector stores.

Payload (both transports): ``{"account_id": "...", "result": [...]}`` — the
items of every page, verbatim; one page's envelope is accepted as is.

The shape is from Cloudflare's documentation; until a real response is
captured it is UNKNOWN whether every field is present (the fixture says so).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.spend.connectors import (
    ConnectorSpec,
    CredentialField,
    CredentialRejected,
    FetchContext,
    IngestQuery,
    NormalisedBatch,
    NormalisedEntry,
    NormaliseError,
    Pull,
    _http,
    micros,
)

API = "https://api.cloudflare.com/client/v4/accounts/{account}/billing/history"
FIRST_PULL_DAYS = 90
TRAILING_DAYS = 7
PER_PAGE = 50
MAX_PAGES = 20


def _occurred_day(item: dict[str, Any], index: int) -> date:
    value = item.get("occurred_at")
    if not isinstance(value, str):
        raise NormaliseError(f"result[{index}] has no occurred_at")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise NormaliseError(f"result[{index}].occurred_at is not a time") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).date()


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    if not isinstance(raw, dict) or not isinstance(raw.get("result"), list):
        raise NormaliseError(
            "payload has no result list — not Cloudflare billing history"
        )
    if raw.get("success") is False:
        raise NormaliseError("Cloudflare reported success: false")
    if not query.is_day:
        raise NormaliseError("Cloudflare payloads are day or range statements")
    start, end = query.days()
    account = str(raw.get("account_id") or config.get("account_id") or "")
    if not account:
        raise NormaliseError("payload names no account_id")
    if config.get("account_id") and str(config["account_id"]) != account:
        raise NormaliseError(
            f"payload is for account {account}, the vendor is {config['account_id']}"
        )

    entries: list[NormalisedEntry] = []
    for index, item in enumerate(raw["result"]):
        if not isinstance(item, dict):
            raise NormaliseError(f"result[{index}] is not an object")
        day = _occurred_day(item, index)
        if not start <= day <= end:
            continue
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            raise NormaliseError(f"result[{index}] has no id")
        if item.get("amount") is None:
            raise NormaliseError(f"result[{index}] has no amount")
        currency = str(item.get("currency") or "")
        if len(currency) != 3:
            raise NormaliseError(f"result[{index}] has no currency")
        amount = micros(item["amount"], field_name=f"result[{index}].amount")
        kind = str(item.get("type") or "charge").lower()
        if kind == "refund" and amount > 0:
            amount = -amount
        zone = item.get("zone")
        scope = str((zone.get("name") if isinstance(zone, dict) else None) or "account")
        action = str(item.get("action") or kind)
        entries.append(
            NormalisedEntry(
                source_ref=f"cloudflare:{account}:{day.isoformat()}:{item_id}",
                period_start=day,
                period_end=day,
                amount_micros=amount,
                currency=currency.upper(),
                scope_label=scope,
                sku=action,
                product=action,
                description=str(item.get("description") or f"Cloudflare {action}"),
                category="cloud",
            )
        )
    prefixes: list[str] = []
    day = start
    while day <= end:
        prefixes.append(f"cloudflare:{account}:{day.isoformat()}:")
        day += timedelta(days=1)
    return NormalisedBatch(
        granularity="range" if end > start else "day",
        period_start=start,
        period_end=end,
        items_seen=len(raw["result"]),
        provider_endpoint=f"GET {API.format(account=account)}",
        entries=entries,
        account=account,
        ref_prefix=prefixes[0],
        extra_ref_prefixes=prefixes[1:],
    )


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _page(token: str, account: str, page: int, per_page: int) -> dict[str, Any]:
    body = await _http.get_json(
        API.format(account=account),
        provider="Cloudflare",
        headers=_headers(token),
        params={
            "page": page,
            "per_page": per_page,
            "order": "occurred_at",
            "direction": "desc",
        },
    )
    if not isinstance(body, dict) or not isinstance(body.get("result"), list):
        raise CredentialRejected(
            "invalid_response", "Cloudflare answered without a result list"
        )
    if body.get("success") is False:
        raise CredentialRejected("provider_error", "Cloudflare reported success: false")
    return body


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    token, account = _http.require_fields(credential, "token", "account_id")
    await _page(token, account, 1, 1)


async def fetch(ctx: FetchContext) -> list[Pull]:
    token, account = _http.require_fields(ctx.credential, "token", "account_id")
    today = ctx.now.astimezone(UTC).date()
    days = FIRST_PULL_DAYS if ctx.last_pulled_day is None else TRAILING_DAYS
    start = today - timedelta(days=days - 1)
    items: list[Any] = []
    for page in range(1, MAX_PAGES + 1):
        body = await _page(token, account, page, PER_PAGE)
        result = body["result"]
        items.extend(result)
        oldest = None
        for item in result:
            try:
                day = _occurred_day(item, 0)
            except NormaliseError:
                continue
            oldest = day if oldest is None or day < oldest else oldest
        if len(result) < PER_PAGE or (oldest is not None and oldest < start):
            break
    else:
        raise CredentialRejected(
            "provider_error",
            f"Cloudflare billing history did not reach {start} in {MAX_PAGES} pages",
        )
    return [
        Pull(
            IngestQuery.for_range(start, today),
            {"account_id": account, "result": items},
        )
    ]


SPEC = ConnectorSpec(
    key="cloudflare_billing",
    provider="Cloudflare",
    expected_lag_hours=48,
    provenance="as reported by Cloudflare billing history",
    normalise=normalise,
    credential_fields=(
        CredentialField("token", "API token"),
        CredentialField("account_id", "Account ID", secret=False),
    ),
    credential_help=(
        "My Profile -> API Tokens -> Create Custom Token. Permissions: "
        "Account -> Billing -> Read, and nothing else. Account Resources: "
        "include only your account."
    ),
    validate=validate,
    fetch=fetch,
    min_pull_interval_hours=6,
)
