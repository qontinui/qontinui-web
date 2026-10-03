"""Namecheap domains — renewal dates, never money (plan Phase 9, decision 14).

``namecheap.domains.getList`` (XML, ``https://api.namecheap.com/xml.response``)
returns each domain's ``Expires`` date and ``AutoRenew`` flag — facts. Its
price list is NOT what was charged, so this connector writes no cost entry:
domain amounts are operator-entered annual recurring costs. What it does:

* keeps ``renews_on`` (and ``auto_renew``) current on the vendor's recurring
  entry whose ``external_ref`` is the domain — with a change-log row and a
  version bump, so a concurrent edit is detected, never silently overwritten;
* warns about a domain with ``AutoRenew=false`` that expires within 60 days;
* notes a domain that has no recurring entry to carry its amount.

The API key travels in a POST BODY, never a query string: httpx logs request
URLs at INFO, and a key in the URL would land in the log.

Payload (both transports): ``{"pages": ["<ApiResponse …>", …]}`` (or
``{"xml": "…"}`` for one page), verbatim.

The XML shape is from Namecheap's documentation; until a real response is
captured that is UNKNOWN in detail (the fixture says so).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET  # nosec B405 — DOCTYPE/ENTITY refused below
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import func, select

from app.spend.connectors import (
    ConnectorSpec,
    CredentialField,
    CredentialRejected,
    FetchContext,
    IngestQuery,
    NormalisedBatch,
    NormaliseError,
    Pull,
    _http,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.overview import Vendor

API = "https://api.namecheap.com/xml.response"
COMMAND = "namecheap.domains.getList"
PAGE_SIZE = 100
MAX_PAGES = 50
WARN_DAYS = 60
#: Namecheap error numbers with a known meaning (from its API documentation).
_AUTH_ERRORS = {"1011102", "1010101", "1010104", "1011104"}
_IP_ERRORS = {"1011150"}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse(xml: str, where: str) -> ET.Element:
    head = xml[:2048].upper()
    if "<!DOCTYPE" in head or "<!ENTITY" in head:
        raise NormaliseError(f"{where} declares a DOCTYPE/ENTITY — refused")
    try:
        return ET.fromstring(xml)  # nosec B314 — no DTD admitted (checked above)
    except ET.ParseError as exc:
        raise NormaliseError(f"{where} is not XML") from exc


def _errors(root: ET.Element) -> list[str]:
    return [
        str(el.get("Number") or "?") for el in root.iter() if _local(el.tag) == "Error"
    ]


def _expires(value: str | None, where: str) -> date:
    if not value:
        raise NormaliseError(f"{where} has no Expires")
    try:
        return datetime.strptime(value.strip(), "%m/%d/%Y").date()
    except ValueError as exc:
        raise NormaliseError(f"{where} Expires is not MM/DD/YYYY") from exc


def _flag(value: str | None) -> bool | None:
    if value is None:
        return None
    return value.strip().lower() == "true"


def domains_from(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, dict) and isinstance(raw.get("xml"), str):
        pages = [raw["xml"]]
    elif isinstance(raw, dict) and isinstance(raw.get("pages"), list):
        pages = raw["pages"]
    else:
        raise NormaliseError("payload has neither xml nor pages — not a Namecheap read")
    out: list[dict[str, Any]] = []
    for p_index, page in enumerate(pages):
        where = f"pages[{p_index}]"
        if not isinstance(page, str):
            raise NormaliseError(f"{where} is not XML text")
        root = _parse(page, where)
        if _local(root.tag) != "ApiResponse":
            raise NormaliseError(f"{where} is not an ApiResponse")
        if (root.get("Status") or "").upper() != "OK":
            raise NormaliseError(
                f"{where} has Status={root.get('Status')} (errors {_errors(root)})"
            )
        for el in root.iter():
            if _local(el.tag) != "Domain":
                continue
            name = (el.get("Name") or "").strip().lower()
            if not name:
                raise NormaliseError(f"{where} has a Domain with no Name")
            out.append(
                {
                    "name": name,
                    "expires": _expires(el.get("Expires"), f"{where} {name}"),
                    "auto_renew": _flag(el.get("AutoRenew")),
                    "is_expired": _flag(el.get("IsExpired")),
                }
            )
    return out


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    if not query.is_day:
        raise NormaliseError("a domain list is a day's snapshot, not a month")
    start, end = query.days()
    domains = domains_from(raw)
    notices: list[str] = []
    for domain in sorted(domains, key=lambda d: d["expires"]):
        days_left = (domain["expires"] - end).days
        if domain["auto_renew"] is False and days_left <= WARN_DAYS:
            notices.append(
                f"{domain['name']} expires {domain['expires'].isoformat()} "
                f"({days_left} days) and AutoRenew is OFF at Namecheap."
            )
    return NormalisedBatch(
        granularity="day" if start == end else "range",
        period_start=start,
        period_end=end,
        items_seen=len(domains),
        provider_endpoint=f"POST {API} Command={COMMAND}",
        entries=[],
        facts={
            "domains": [{**d, "expires": d["expires"].isoformat()} for d in domains]
        },
        notices=notices,
    )


async def apply(
    db: AsyncSession, tenant_id: UUID, vendor: Vendor, batch: NormalisedBatch
) -> list[str]:
    """Keep each matching recurring entry's ``renews_on``/``auto_renew``
    current; note domains no entry carries."""
    from app.models.overview import RecurringCost
    from app.overview import change_log
    from app.spend.resources import _recurring_read

    domains = batch.facts.get("domains") or []
    if not domains:
        return []
    by_name = {d["name"]: d for d in domains}
    entries = list(
        (
            await db.execute(
                select(RecurringCost).where(
                    RecurringCost.tenant_id == tenant_id,
                    RecurringCost.vendor_id == vendor.id,
                    func.lower(RecurringCost.external_ref).in_(list(by_name)),
                )
            )
        ).scalars()
    )
    carried: set[str] = set()
    actor = "connector:namecheap_domains"
    for entry in entries:
        name = (entry.external_ref or "").lower()
        domain = by_name.get(name)
        if domain is None:
            continue
        carried.add(name)
        expires = date.fromisoformat(domain["expires"])
        auto = domain["auto_renew"]
        if entry.renews_on == expires and entry.auto_renew == auto:
            continue
        before = _recurring_read(entry)
        entry.renews_on = expires
        entry.auto_renew = auto
        entry.version = (entry.version or 1) + 1
        entry.updated_by = actor
        await db.flush()
        await change_log.record(
            db,
            tenant_id=tenant_id,
            resource="recurring_costs",
            record_id=str(entry.id),
            action="update",
            source="import",
            actor=actor,
            actor_user_id=None,
            before=before,
            after=_recurring_read(entry),
            version_before=before.version,
            version_after=entry.version,
        )
    return [
        f"{name} (expires {by_name[name]['expires']}) has no recurring cost whose "
        "external_ref is the domain — add its renewal invoice amount."
        for name in sorted(set(by_name) - carried)
    ]


async def _page(credential: dict[str, Any], page: int, size: int) -> str:
    api_user, user_name, api_key, client_ip = _http.require_fields(
        credential, "api_user", "user_name", "api_key", "client_ip"
    )
    response = await _http.request(
        "POST",
        API,
        provider="Namecheap",
        data={
            "ApiUser": api_user,
            "UserName": user_name,
            "ApiKey": api_key,
            "ClientIp": client_ip,
            "Command": COMMAND,
            "Page": str(page),
            "PageSize": str(size),
        },
    )
    text = response.text
    try:
        root = _parse(text, "Namecheap's answer")
    except NormaliseError as exc:
        raise CredentialRejected("invalid_response", str(exc)) from exc
    if (root.get("Status") or "").upper() != "OK":
        numbers = set(_errors(root))
        if numbers & _IP_ERRORS:
            raise CredentialRejected(
                "forbidden",
                "Namecheap refused the caller IP — whitelist the NAT address",
            )
        if numbers & _AUTH_ERRORS:
            raise CredentialRejected(
                "unauthorized", "Namecheap refused the API user or key"
            )
        raise CredentialRejected(
            "provider_error", f"Namecheap answered errors {sorted(numbers)}"
        )
    return text


def _total(xml: str) -> int | None:
    root = _parse(xml, "page")
    for el in root.iter():
        if _local(el.tag) == "TotalItems" and (el.text or "").strip().isdigit():
            return int((el.text or "0").strip())
    return None


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    await _page(credential, 1, 10)


async def fetch(ctx: FetchContext) -> list[Pull]:
    pages: list[str] = []
    for page in range(1, MAX_PAGES + 1):
        xml = await _page(ctx.credential, page, PAGE_SIZE)
        pages.append(xml)
        total = _total(xml)
        if total is None or page * PAGE_SIZE >= total:
            break
    else:
        raise CredentialRejected(
            "provider_error", f"the domain list ran past {MAX_PAGES} pages"
        )
    today = ctx.now.astimezone(UTC).date()
    return [Pull(IngestQuery(today.year, today.month, today.day), {"pages": pages})]


SPEC = ConnectorSpec(
    key="namecheap_domains",
    provider="Namecheap",
    expected_lag_hours=24,
    provenance="renewal dates from the Namecheap API (amounts are entered from invoices)",
    normalise=normalise,
    produces_money=False,
    spike_rule=False,
    credential_fields=(
        CredentialField("api_user", "API user", secret=False),
        CredentialField("user_name", "Username", secret=False),
        CredentialField("api_key", "API key"),
        CredentialField(
            "client_ip",
            "Whitelisted IP",
            secret=False,
            help="the web service's NAT Elastic IP, whitelisted at Namecheap",
        ),
    ),
    credential_help=(
        "Optional renewal-date sync. Profile -> Tools -> Business & Dev Tools "
        "-> Namecheap API Access -> ON (only for eligible accounts); whitelist "
        "the web service's NAT Elastic IP. Namecheap API keys are not scoped: "
        "this key can also act on the account. Amounts stay operator-entered "
        "annual recurring costs (one per domain, external_ref = the domain)."
    ),
    validate=validate,
    fetch=fetch,
    apply=apply,
    min_pull_interval_hours=24,
)
