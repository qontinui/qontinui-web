"""Anthropic cost report → cost entries (plan Phase 9).

Endpoint: ``GET https://api.anthropic.com/v1/organizations/cost_report`` with
``starting_at``/``ending_at`` (RFC 3339), ``bucket_width=1d`` and
``group_by[]=workspace_id`` + ``group_by[]=description``; headers
``x-api-key`` (an Admin key) and ``anthropic-version``. The answer is
``{"data": [{"starting_at", "ending_at", "results": [{"currency", "amount",
"workspace_id", "description", ...}]}], "has_more", "next_page"}``.

* ``amount`` is a decimal STRING in the currency's lowest unit (cents for
  USD) — so ``"123.45"`` is $1.2345. It is converted exactly, never through a
  float.
* One entry per (day, workspace, description):
  ``source_ref = anthropic:<day>:<workspace or default>:<description>``.
* API-key spend only. Claude subscriptions are recurring entries, not this
  connector.

Payload (both transports): ``{"data": [...]}`` — every page's buckets.

The shape is from Anthropic's Admin API documentation; until a real response
is captured it is UNKNOWN whether every field is present (the fixture says so).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
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

API = "https://api.anthropic.com/v1/organizations/cost_report"
ANTHROPIC_VERSION = "2023-06-01"
FIRST_PULL_DAYS = 31
MAX_PAGES = 50
#: The lowest-unit (cent) to whole-unit divisor for the currencies the cost
#: report uses. A currency outside this map is refused, never guessed.
_MINOR_UNITS = {"USD": Decimal(100)}


def _bucket_day(bucket: dict[str, Any], index: int) -> date:
    value = bucket.get("starting_at")
    if not isinstance(value, str):
        raise NormaliseError(f"data[{index}] has no starting_at")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise NormaliseError(f"data[{index}].starting_at is not a time") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).date()


def _whole_units(amount: Any, currency: str, where: str) -> Decimal:
    divisor = _MINOR_UNITS.get(currency)
    if divisor is None:
        raise NormaliseError(
            f"{where} is in {currency}, which this connector cannot scale"
        )
    if isinstance(amount, bool) or not isinstance(amount, str | int | float):
        raise NormaliseError(f"{where}.amount is not a number")
    try:
        value = Decimal(str(amount))
    except InvalidOperation as exc:
        raise NormaliseError(f"{where}.amount is not a number") from exc
    return value / divisor


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), list):
        raise NormaliseError("payload has no data list — not an Anthropic cost report")
    if not query.is_day:
        raise NormaliseError("Anthropic payloads are day or range statements")
    start, end = query.days()
    sums: dict[str, dict[str, Any]] = {}
    bucket_days: set[date] = set()
    items = 0
    for index, bucket in enumerate(raw["data"]):
        if not isinstance(bucket, dict):
            raise NormaliseError(f"data[{index}] is not an object")
        day = _bucket_day(bucket, index)
        bucket_days.add(day)
        if not start <= day <= end:
            raise NormaliseError(
                f"data[{index}] is dated {day}, outside {start}..{end}"
            )
        results = bucket.get("results")
        if not isinstance(results, list):
            raise NormaliseError(f"data[{index}].results is not a list")
        for r_index, result in enumerate(results):
            where = f"data[{index}].results[{r_index}]"
            if not isinstance(result, dict):
                raise NormaliseError(f"{where} is not an object")
            currency = str(result.get("currency") or "").upper()
            if len(currency) != 3:
                raise NormaliseError(f"{where} has no currency")
            whole = _whole_units(result.get("amount"), currency, where)
            workspace = str(result.get("workspace_id") or "default")
            description = str(
                result.get("description") or result.get("cost_type") or "-"
            )
            ref = f"anthropic:{day.isoformat()}:{workspace}:{description}"
            items += 1
            amount = micros(whole, field_name=f"{where}.amount")
            bucket_sum = sums.setdefault(
                ref,
                {
                    "day": day,
                    "workspace": workspace,
                    "description": description,
                    "currency": currency,
                    "net": 0,
                    "model": result.get("model"),
                },
            )
            if bucket_sum["currency"] != currency:
                raise NormaliseError(f"{ref} mixes currencies")
            bucket_sum["net"] += amount
    entries = [
        NormalisedEntry(
            source_ref=ref,
            period_start=b["day"],
            period_end=b["day"],
            amount_micros=b["net"],
            currency=b["currency"],
            scope_label=b["workspace"],
            sku=b["description"],
            product=str(b["model"]) if b["model"] else "api",
            description=f"Anthropic API — {b['description']}",
            category="ai",
        )
        for ref, b in sums.items()
    ]
    # The report answers one bucket per day, an empty one for a $0 day. The
    # statement runs from the first day through the last bucket answered (a
    # day not yet in the report is UNKNOWN, not claimed); a day missing
    # inside that span is refused, never read as $0.
    if not bucket_days:
        raise NormaliseError(f"the report answered no daily bucket for {start}..{end}")
    last = max(bucket_days)
    missing: list[str] = []
    prefixes: list[str] = []
    day = start
    while day <= last:
        if day not in bucket_days:
            missing.append(day.isoformat())
        prefixes.append(f"anthropic:{day.isoformat()}:")
        day += timedelta(days=1)
    if missing:
        raise NormaliseError(f"the report has no bucket for {', '.join(missing)}")
    return NormalisedBatch(
        granularity="range" if last > start else "day",
        period_start=start,
        period_end=last,
        items_seen=items,
        provider_endpoint=f"GET {API} bucket_width=1d {start}..{end}",
        entries=entries,
        ref_prefix=prefixes[0],
        extra_ref_prefixes=prefixes[1:],
    )


def _headers(api_key: str) -> dict[str, str]:
    return {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION}


async def _report(
    api_key: str, start: date, end: date, *, limit: int | None = None
) -> dict[str, Any]:
    """Every page of the report for ``[start, end]`` (inclusive days)."""
    data: list[Any] = []
    page: str | None = None
    for _ in range(MAX_PAGES):
        params: list[tuple[str, str | int]] = [
            ("starting_at", f"{start.isoformat()}T00:00:00Z"),
            ("ending_at", f"{(end + timedelta(days=1)).isoformat()}T00:00:00Z"),
            ("bucket_width", "1d"),
            ("group_by[]", "workspace_id"),
            ("group_by[]", "description"),
        ]
        if limit is not None:
            params.append(("limit", limit))
        if page:
            params.append(("page", page))
        body = await _http.get_json(
            API, provider="Anthropic", headers=_headers(api_key), params=params
        )
        if not isinstance(body, dict) or not isinstance(body.get("data"), list):
            raise CredentialRejected(
                "invalid_response", "Anthropic answered without a data list"
            )
        data.extend(body["data"])
        if limit is not None or not body.get("has_more"):
            return {"data": data}
        page = body.get("next_page")
        if not isinstance(page, str) or not page:
            raise CredentialRejected(
                "invalid_response", "Anthropic said has_more without a next_page"
            )
    raise CredentialRejected(
        "provider_error", f"the Anthropic cost report ran past {MAX_PAGES} pages"
    )


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    (api_key,) = _http.require_fields(credential, "api_key")
    yesterday = datetime.now(UTC).date() - timedelta(days=1)
    await _report(api_key, yesterday, yesterday, limit=1)


async def fetch(ctx: FetchContext) -> list[Pull]:
    (api_key,) = _http.require_fields(ctx.credential, "api_key")
    today = ctx.now.astimezone(UTC).date()
    first = today - timedelta(days=FIRST_PULL_DAYS - 1)
    start = (
        first
        if ctx.last_pulled_day is None
        else max(first, min(ctx.last_pulled_day, today - timedelta(days=1)))
    )
    raw = await _report(api_key, start, today)
    return [Pull(IngestQuery.for_range(start, today), raw)]


SPEC = ConnectorSpec(
    key="anthropic_cost_report",
    provider="Anthropic",
    expected_lag_hours=24,
    provenance="as reported by the Anthropic cost report API",
    normalise=normalise,
    credential_fields=(CredentialField("api_key", "Admin API key"),),
    credential_help=(
        "Console -> Settings -> Admin keys -> create an Admin key (needs an "
        "organization admin). Admin keys cannot be narrowed to read-only; link "
        "one only if API-key spend matters. Claude subscriptions are recurring "
        "costs, not this connector."
    ),
    validate=validate,
    fetch=fetch,
    min_pull_interval_hours=1,
)
