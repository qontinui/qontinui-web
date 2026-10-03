"""Vercel billing charges → cost entries (plan Phase 9).

Endpoint: ``GET https://api.vercel.com/v1/billing/charges?teamId=&from=&to=``,
which answers FOCUS v1.3 records as JSON Lines. Per record the normaliser reads
``ChargePeriodStart`` (its UTC day), ``ServiceName``, ``ChargeDescription``
(falling back to ``ChargeCategory``), ``BilledCost`` — the NET figure Vercel
bills — and ``BillingCurrency``; ``ListCost`` is kept as gross when every line
of an entry carries it, and ``ConsumedQuantity``/``ConsumedUnit`` as quantity.

* ``source_ref = vercel:<team>:<day>:<ServiceName>:<ChargeDescription>``; the
  lines sharing one are summed (they are all Vercel's own figures).
* A range payload is the whole statement for every day in the range, so a day
  re-pulled drops a line Vercel no longer reports.
* A record dated outside the queried range is not stored (a monthly charge
  period can straddle the window); it is counted in a notice.

Payload (both transports): ``{"team_id": "...", "jsonl": "<the body>"}`` or
``{"team_id": "...", "records": [...]}``.

The shape is from Vercel's and FOCUS's documentation; until a real response is
captured it is UNKNOWN whether every field is present (the fixture says so).
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
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

API = "https://api.vercel.com/v1/billing/charges"
FIRST_PULL_DAYS = 35
REREAD_DAYS = 3


def _records(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, dict):
        raise NormaliseError("payload is not an object with jsonl or records")
    if isinstance(raw.get("records"), list):
        records = raw["records"]
    elif isinstance(raw.get("jsonl"), str):
        records = []
        for number, line in enumerate(raw["jsonl"].splitlines(), start=1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except ValueError as exc:
                raise NormaliseError(f"jsonl line {number} is not JSON") from exc
    else:
        raise NormaliseError("payload has neither jsonl nor records")
    out: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise NormaliseError(f"record {index} is not an object")
        out.append(record)
    return out


def _record_day(record: dict[str, Any], index: int) -> date:
    value = record.get("ChargePeriodStart")
    if not isinstance(value, str):
        raise NormaliseError(f"record {index} has no ChargePeriodStart")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise NormaliseError(f"record {index} ChargePeriodStart is not a time") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).date()


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    records = _records(raw)
    if not query.is_day:
        raise NormaliseError("Vercel payloads are day or range statements")
    start, end = query.days()
    team = str(raw.get("team_id") or config.get("team_id") or "")
    if not team:
        raise NormaliseError("payload names no team_id")
    if config.get("team_id") and str(config["team_id"]) != team:
        raise NormaliseError(
            f"payload is for team {team}, the vendor is {config['team_id']}"
        )

    sums: dict[str, dict[str, Any]] = {}
    outside = 0
    for index, record in enumerate(records):
        day = _record_day(record, index)
        if not start <= day <= end:
            outside += 1
            continue
        if record.get("BilledCost") is None:
            raise NormaliseError(f"record {index} has no BilledCost")
        currency = str(record.get("BillingCurrency") or "")
        if len(currency) != 3:
            raise NormaliseError(f"record {index} has no BillingCurrency")
        service = str(record.get("ServiceName") or "(unnamed service)")
        charge = str(
            record.get("ChargeDescription") or record.get("ChargeCategory") or "-"
        )
        ref = f"vercel:{team}:{day.isoformat()}:{service}:{charge}"
        net = micros(record["BilledCost"], field_name=f"record {index} BilledCost")
        list_cost = record.get("ListCost")
        gross = (
            micros(list_cost, field_name=f"record {index} ListCost")
            if list_cost is not None
            else None
        )
        qty_raw = record.get("ConsumedQuantity")
        quantity = (
            Decimal(str(qty_raw))
            if isinstance(qty_raw, int | float | str) and not isinstance(qty_raw, bool)
            else None
        )
        bucket = sums.get(ref)
        if bucket is None:
            sums[ref] = {
                "day": day,
                "service": service,
                "charge": charge,
                "currency": currency.upper(),
                "net": net,
                "gross": gross,
                "gross_known": gross is not None,
                "quantity": quantity,
                "unit": record.get("ConsumedUnit"),
            }
            continue
        if bucket["currency"] != currency.upper():
            raise NormaliseError(f"{ref} mixes currencies")
        bucket["net"] += net
        if gross is None or not bucket["gross_known"]:
            bucket["gross_known"] = False
            bucket["gross"] = None
        else:
            bucket["gross"] += gross
        if bucket["quantity"] is not None and quantity is not None:
            bucket["quantity"] += quantity
        else:
            bucket["quantity"] = None

    entries = [
        NormalisedEntry(
            source_ref=ref,
            period_start=b["day"],
            period_end=b["day"],
            amount_micros=b["net"],
            gross_micros=b["gross"],
            discount_micros=(b["gross"] - b["net"]) if b["gross"] is not None else None,
            currency=b["currency"],
            quantity=b["quantity"],
            unit=str(b["unit"]) if b["unit"] else None,
            scope_label=b["service"],
            sku=b["charge"],
            product=b["service"],
            description=f"Vercel {b['service']} — {b['charge']}",
            category="cloud",
        )
        for ref, b in sums.items()
    ]
    prefixes: list[str] = []
    day = start
    while day <= end:
        prefixes.append(f"vercel:{team}:{day.isoformat()}:")
        day += timedelta(days=1)
    notices = (
        [
            f"{outside} Vercel charge record(s) fell outside {start}..{end} and were not stored"
        ]
        if outside
        else []
    )
    return NormalisedBatch(
        granularity="range" if end > start else "day",
        period_start=start,
        period_end=end,
        items_seen=len(records),
        provider_endpoint=f"GET {API}?teamId={team}&from={start}&to={end}",
        entries=entries,
        account=team,
        ref_prefix=prefixes[0],
        extra_ref_prefixes=prefixes[1:],
        notices=notices,
    )


async def _charges(token: str, team: str, start: date, end: date) -> str:
    response = await _http.request(
        "GET",
        API,
        provider="Vercel",
        headers={"Authorization": f"Bearer {token}"},
        params={
            "teamId": team,
            "from": f"{start.isoformat()}T00:00:00.000Z",
            "to": f"{(end + timedelta(days=1)).isoformat()}T00:00:00.000Z",
        },
    )
    return response.text


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    token, team = _http.require_fields(credential, "token", "team_id")
    today = datetime.now(UTC).date()
    body = await _charges(
        token, team, today - timedelta(days=1), today - timedelta(days=1)
    )
    try:
        _records({"jsonl": body})
    except NormaliseError as exc:
        raise CredentialRejected(
            "invalid_response", "Vercel did not answer with FOCUS JSON Lines"
        ) from exc


async def fetch(ctx: FetchContext) -> list[Pull]:
    token, team = _http.require_fields(ctx.credential, "token", "team_id")
    today = ctx.now.astimezone(UTC).date()
    first = today - timedelta(days=FIRST_PULL_DAYS - 1)
    # Re-read at least the last REREAD_DAYS days on every pull: Vercel's JSONL
    # cannot tell "no charges" from "not published yet", so a late day is
    # corrected by the next pulls (and is complete only two days later).
    start = (
        first
        if ctx.last_pulled_day is None
        else max(
            first,
            min(ctx.last_pulled_day, today - timedelta(days=REREAD_DAYS - 1)),
        )
    )
    body = await _charges(token, team, start, today)
    return [Pull(IngestQuery.for_range(start, today), {"team_id": team, "jsonl": body})]


SPEC = ConnectorSpec(
    key="vercel_billing",
    provider="Vercel",
    # An empty JSONL day may be "not published yet": trust a day only two
    # days later, and allow for it before calling the vendor stale.
    expected_lag_hours=48,
    complete_lag_days=2,
    provenance="as reported by Vercel billing charges (FOCUS BilledCost)",
    normalise=normalise,
    credential_fields=(
        CredentialField("token", "Access token"),
        CredentialField("team_id", "Team ID", secret=False, help="team_…"),
    ),
    credential_help=(
        "Team Settings -> Members: use a member with the Billing role. From "
        "that account: Account Settings -> Tokens -> Create, scoped to the "
        "team, expiry 1 year. A Billing-role account is what keeps the token "
        "read-only."
    ),
    validate=validate,
    fetch=fetch,
    min_pull_interval_hours=1,
)
