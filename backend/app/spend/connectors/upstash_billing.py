"""Upstash developer API → cost entries (plan Phase 9).

HTTP Basic with ``<account email>:<api key>`` against
``https://api.upstash.com``:

* ``GET /v2/redis/databases`` lists the databases (``database_id``,
  ``database_name``…), then ``GET /v2/redis/stats/{id}`` per database answers
  ``dailybilling`` — a ``[{"x": <day>, "y": <amount in USD>}]`` series — and
  ``total_monthly_billing``.
* ``GET /v2/qstash/stats`` answers the same billing fields for QStash. An
  account with no QStash answers 404, which is read as "no QStash resource",
  not as a failure; any other error fails the pull.

**Provider-reported, not estimated**: ``dailybilling`` is Upstash's own daily
figure per resource, so nothing is derived from usage × price.
``source_ref = upstash:<resource type>:<id>:<day>``.

The series covers a short trailing window of the CURRENT month only, so the
statement a pull stores is exactly the days the series states: the run's
period is clipped to them, and a day outside it stays UNKNOWN, never $0.
``total_monthly_billing`` is kept as a fact (context), never as an entry.

Payload (both transports): ``{"resources": [{"type": "redis"|"qstash", "id",
"name", "stats": {<the stats answer verbatim>}}]}``.

The shape is from Upstash's documentation; until a real response is captured
it is UNKNOWN whether ``x`` is a timestamp string or epoch number, so both are
read (the fixture says so).
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

API = "https://api.upstash.com"
RESOURCE_TYPES = ("redis", "qstash")


def _point_day(x: Any, where: str) -> date:
    if isinstance(x, bool):
        raise NormaliseError(f"{where}.x is not a date")
    if isinstance(x, int | float):
        seconds = x / 1000 if x > 1e11 else x
        return datetime.fromtimestamp(seconds, tz=UTC).date()
    if isinstance(x, str) and len(x) >= 10:
        try:
            return date.fromisoformat(x[:10])
        except ValueError:
            pass
    raise NormaliseError(f"{where}.x is not a date")


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    if not isinstance(raw, dict) or not isinstance(raw.get("resources"), list):
        raise NormaliseError("payload has no resources list — not an Upstash read")
    if not query.is_day:
        raise NormaliseError("Upstash payloads are day or range statements")
    start, end = query.days()

    points: list[tuple[str, str, str, date, int]] = []
    monthly: dict[str, Any] = {}
    for index, resource in enumerate(raw["resources"]):
        where = f"resources[{index}]"
        if not isinstance(resource, dict):
            raise NormaliseError(f"{where} is not an object")
        kind = resource.get("type")
        if kind not in RESOURCE_TYPES:
            raise NormaliseError(f"{where}.type is not one of {RESOURCE_TYPES}")
        rid = str(resource.get("id") or "")
        if not rid:
            raise NormaliseError(f"{where} has no id")
        name = str(resource.get("name") or rid)
        stats = resource.get("stats")
        if not isinstance(stats, dict) or not isinstance(
            stats.get("dailybilling"), list
        ):
            raise NormaliseError(f"{where}.stats has no dailybilling series")
        for p_index, point in enumerate(stats["dailybilling"]):
            pw = f"{where}.stats.dailybilling[{p_index}]"
            if not isinstance(point, dict):
                raise NormaliseError(f"{pw} is not an object")
            day = _point_day(point.get("x"), pw)
            amount = micros(point.get("y"), field_name=f"{pw}.y")
            points.append((str(kind), rid, name, day, amount))
        if stats.get("total_monthly_billing") is not None:
            monthly[f"{kind}:{rid}"] = stats["total_monthly_billing"]

    stated = sorted({p[3] for p in points if start <= p[3] <= end})
    if points and not stated:
        raise NormaliseError(f"the series states no day within {start}..{end}")
    # The statement is the days the series states. With no resource at all,
    # the provider has stated the whole range: there is nothing to bill.
    lo, hi = (stated[0], stated[-1]) if stated else (start, end)

    merged: dict[str, NormalisedEntry] = {}
    for kind, rid, name, day, amount in points:
        if not lo <= day <= hi:
            continue
        ref = f"upstash:{kind}:{rid}:{day.isoformat()}"
        prior = merged.get(ref)
        merged[ref] = NormalisedEntry(
            source_ref=ref,
            period_start=day,
            period_end=day,
            amount_micros=amount + (prior.amount_micros if prior else 0),
            currency="USD",
            scope_label=name,
            sku=kind,
            product=kind,
            description=f"Upstash {kind} {name}",
            category="cloud",
        )
    # The ref puts the day LAST, so a day's statement is addressed per
    # resource: one "prefix" (the whole ref) per resource the payload names
    # and day it states. A resource's day no longer reported is dropped; a
    # resource the payload no longer names keeps its history (it was real).
    prefixes = sorted(
        {
            f"upstash:{kind}:{rid}:{day.isoformat()}"
            for kind, rid, _name, _day, _amount in points
            for day in _days(lo, hi)
        }
    )
    return NormalisedBatch(
        granularity="range" if hi > lo else "day",
        period_start=lo,
        period_end=hi,
        items_seen=len(points),
        provider_endpoint=f"GET {API}/v2/redis/stats/{{id}} dailybilling {lo}..{hi}",
        entries=list(merged.values()),
        ref_prefix=prefixes[0] if prefixes else None,
        extra_ref_prefixes=prefixes[1:],
        facts={"total_monthly_billing": monthly},
    )


def _days(lo: date, hi: date) -> list[date]:
    out: list[date] = []
    day = lo
    while day <= hi:
        out.append(day)
        day += timedelta(days=1)
    return out


async def _get(credential: dict[str, Any], path: str) -> Any:
    email, api_key = _http.require_fields(credential, "email", "api_key")
    return await _http.get_json(
        f"{API}{path}", provider="Upstash", auth=(email, api_key)
    )


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    body = await _get(credential, "/v2/redis/databases")
    if not isinstance(body, list):
        raise CredentialRejected(
            "invalid_response", "Upstash did not answer with a database list"
        )


async def fetch(ctx: FetchContext) -> list[Pull]:
    databases = await _get(ctx.credential, "/v2/redis/databases")
    if not isinstance(databases, list):
        raise CredentialRejected(
            "invalid_response", "Upstash did not answer with a database list"
        )
    resources: list[dict[str, Any]] = []
    for db in databases:
        if not isinstance(db, dict) or not db.get("database_id"):
            raise CredentialRejected(
                "invalid_response", "a database has no database_id"
            )
        rid = str(db["database_id"])
        stats = await _get(ctx.credential, f"/v2/redis/stats/{rid}")
        resources.append(
            {
                "type": "redis",
                "id": rid,
                "name": db.get("database_name") or rid,
                "stats": stats,
            }
        )
    try:
        qstash = await _get(ctx.credential, "/v2/qstash/stats")
    except CredentialRejected as exc:
        if exc.reason != "not_found":
            raise
    else:
        if isinstance(qstash, dict) and isinstance(qstash.get("dailybilling"), list):
            resources.append(
                {"type": "qstash", "id": "qstash", "name": "QStash", "stats": qstash}
            )
    today = ctx.now.astimezone(UTC).date()
    # The series is the current month's trailing window; the normaliser clips
    # the run to the days it actually states.
    return [
        Pull(
            IngestQuery.for_range(today.replace(day=1), today), {"resources": resources}
        )
    ]


SPEC = ConnectorSpec(
    key="upstash_billing",
    provider="Upstash",
    expected_lag_hours=24,
    provenance="as reported by the Upstash developer API (dailybilling)",
    normalise=normalise,
    credential_fields=(
        CredentialField("email", "Account email", secret=False),
        CredentialField("api_key", "Developer API key"),
    ),
    credential_help=(
        "console.upstash.com -> Account -> Developer API (Management API) -> "
        "Create API Key: name qontinui-spend, permission Read Only, expiry 1 "
        "year. Link it with the account email it belongs to. A fixed-price "
        "plan is a recurring cost — add it on the same card."
    ),
    validate=validate,
    fetch=fetch,
    min_pull_interval_hours=1,
)
