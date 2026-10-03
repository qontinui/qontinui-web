"""The connector registry: every connector key the store admits, with what
the freshness rule and the provenance line need to know about it.

Plan decision 2: one Python normaliser per provider turns the provider's RAW
response into cost-entry rows, and both transports (the ingest door, a later
server pull) share it. Decision 5: freshness is lag-aware — each connector
declares ``expected_lag_hours``, the delay after a UTC day ends before the
provider serves that day complete (GitHub 24, AWS Cost Explorer 48).

Phase 7 adds the second transport: a connector with a ``fetch`` can be
PULLED by the server (``app.spend.collect``) once the tenant has linked a
credential for it (``app.spend.credentials``), and its ``validate`` is the one
live provider call that proves a credential before it is stored. A pulled
payload goes through the very same ``normalise`` as a pushed one.

Phase 9 adds the token-linked providers. Two of them produce NO money
(``produces_money=False``: Google Workspace seats, Namecheap domains) — their
runs carry facts and notices, and an ``apply`` hook acts on them (a seat-count
warning, a renewal date kept current), never a cost entry.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import TYPE_CHECKING, Any
from uuid import UUID

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.overview import Vendor

#: Money is integer micros.
MICROS = Decimal(1_000_000)


class NormaliseError(ValueError):
    """The raw payload is not what this connector accepts. The message is
    recorded on the failed import run and returned in the 422."""


@dataclass(frozen=True)
class IngestQuery:
    """What a payload is about: one UTC day (``day``), a month (no ``day``),
    or — server pulls only — a RANGE of days from ``day`` through ``until``
    inclusive, which is that range's whole statement."""

    year: int
    month: int
    day: int | None = None
    until: date | None = None

    @property
    def is_day(self) -> bool:
        return self.day is not None

    @property
    def is_range(self) -> bool:
        return self.day is not None and self.until is not None

    @classmethod
    def for_range(cls, start: date, end: date) -> IngestQuery:
        if end == start:
            return cls(start.year, start.month, start.day)
        return cls(start.year, start.month, start.day, until=end)

    def days(self) -> tuple[date, date]:
        """The first and last day a day/range query names. Raises
        :class:`NormaliseError` on a month query or an invalid date."""
        if self.day is None:
            raise NormaliseError("query names no day")
        try:
            start = date(self.year, self.month, self.day)
        except ValueError as exc:
            raise NormaliseError("query names no valid day") from exc
        end = self.until or start
        if end < start:
            raise NormaliseError("query range ends before it starts")
        return start, end


@dataclass(frozen=True)
class NormalisedEntry:
    source_ref: str
    period_start: date
    period_end: date
    amount_micros: int
    currency: str
    gross_micros: int | None = None
    discount_micros: int | None = None
    quantity: Decimal | None = None
    unit: str | None = None
    scope_label: str | None = None
    sku: str | None = None
    product: str | None = None
    description: str = ""
    category: str | None = None


@dataclass
class NormalisedBatch:
    """What one raw payload says.

    ``granularity`` ``day``: ``entries`` are the WHOLE statement for that day
    (an entry missing from a re-ingest no longer exists at the provider).
    ``month``: a reconciliation payload — ``month_net_micros`` is compared
    with the stored day entries and nothing is upserted.
    """

    granularity: str
    period_start: date
    period_end: date
    items_seen: int
    provider_endpoint: str
    entries: list[NormalisedEntry] = field(default_factory=list)
    month_net_micros: int | None = None
    #: The provider account the payload belongs to (a GitHub org), when the
    #: payload names one. Checked against the vendor's ``connector_config``.
    account: str | None = None
    #: The ``source_ref`` prefix every entry of this account+period shares,
    #: so a day re-ingest can drop rows the provider no longer reports.
    ref_prefix: str | None = None
    #: More such prefixes — a RANGE payload is several days' statements, one
    #: prefix per day.
    extra_ref_prefixes: list[str] = field(default_factory=list)
    #: What the provider said that is not money (a seat count, a domain's
    #: expiry) — read by the connector's ``apply`` hook.
    facts: dict[str, Any] = field(default_factory=dict)
    #: Human-readable warnings, stored on the run and shown on the vendor's
    #: Sources card (e.g. "AutoRenew is off for x.io, expiring 2026-11-01").
    notices: list[str] = field(default_factory=list)


Normaliser = Callable[[Any, IngestQuery, dict[str, Any]], NormalisedBatch]


class CredentialRejected(Exception):
    """A credential failed validation, or a provider refused a pull.

    ``reason`` is a TYPED, value-free token (``unauthorized``, ``forbidden``,
    ``not_found``, ``rate_limited``, ``provider_error``, ``unreachable``,
    ``invalid_response``, ``invalid_credential``, ``not_configured``…).
    ``detail`` is a short human sentence. NEITHER may carry a credential: they
    reach responses, logs and import-run rows.
    """

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class CredentialField:
    name: str
    label: str
    #: A secret field is never echoed anywhere; a non-secret one (a team id,
    #: an account id) is still stored ONLY in the vault, beside the secret.
    secret: bool = True
    required: bool = True
    help: str = ""
    #: A multi-line value (a service-account JSON key) — exempt from the
    #: printable-ASCII check single-line tokens get.
    multiline: bool = False


@dataclass(frozen=True)
class Pull:
    """One payload a server pull fetched, and the query it answers."""

    query: IngestQuery
    raw: Any


@dataclass
class FetchContext:
    tenant_id: UUID
    #: The vault's value for this tenant+connector (``{}`` for an arm that
    #: needs none, like the AWS task role). Never logged.
    credential: dict[str, Any]
    #: The vendor's NON-secret ``connector_config``.
    config: dict[str, Any]
    now: datetime
    #: The last day an ``ok`` PULL run of this vendor covered, or ``None`` on
    #: the first pull (the connector then backfills).
    last_pulled_day: date | None
    #: Which arm resolved the credential (``secret`` | ``task_role``).
    arm: str = "secret"


Validator = Callable[[dict[str, Any], dict[str, Any]], Awaitable[None]]
Fetcher = Callable[[FetchContext], Awaitable[list[Pull]]]
#: ``(db, tenant_id, vendor, batch) -> notices`` — runs inside the ingest's
#: savepoint after an ok normalise; it may update the tenant's own rows.
Applier = Callable[
    ["AsyncSession", UUID, "Vendor", NormalisedBatch], Awaitable[list[str]]
]


@dataclass(frozen=True)
class ConnectorSpec:
    key: str
    provider: str
    expected_lag_hours: int
    provenance: str
    normalise: Normaliser | None = None
    #: ``False`` for a connector that reports facts, never money (seat counts,
    #: domain expiries). Its vendor's figures come from recurring entries, and
    #: its freshness is "did the last read succeed recently".
    produces_money: bool = True
    #: A day is complete once a run finished this many days after it began:
    #: 1 for most providers, 2 for AWS Cost Explorer (complete day = day − 2).
    complete_lag_days: int = 1
    #: Whether the relative spike rule reads this vendor (off for Play, whose
    #: fees follow revenue, and for no-money connectors).
    spike_rule: bool = True
    #: The fields the "Link account" form asks for.
    credential_fields: tuple[CredentialField, ...] = ()
    #: Where the operator gets the credential, and the exact scope to grant.
    credential_help: str = ""
    validate: Validator | None = None
    fetch: Fetcher | None = None
    apply: Applier | None = None
    #: The fewest hours between two server pulls of one vendor.
    min_pull_interval_hours: int = 1
    #: Whether a fleet importer PUSHES this connector without any linked
    #: credential (GitHub, plan Phase 2). For every other connector a vendor
    #: with no credential and no run is "not linked", not merely "never".
    pushed_without_credential: bool = False
    #: Fields the SERVER issues per tenant and adds to the stored credential
    #: (the AWS ExternalId) — shown on the Link form, never accepted as input.
    issued_fields: Callable[[UUID], dict[str, str]] | None = None


#: The largest magnitude a ``bigint`` micros column holds.
MAX_MICROS = 2**63 - 1


def micros(value: Any, *, field_name: str) -> int:
    """A provider decimal amount → integer micros, half away from zero.

    ``float`` is read through ``str`` so ``0.1`` stays ``0.1``. Anything that
    is not a finite number, or does not fit a ``bigint`` once in micros, is a
    :class:`NormaliseError` — recorded as a failed run, never a 500.
    """
    if isinstance(value, bool) or not isinstance(value, int | float | str | Decimal):
        raise NormaliseError(f"{field_name} is not a number")
    try:
        amount = Decimal(str(value))
        if not amount.is_finite():
            raise NormaliseError(f"{field_name} is not a finite number")
        result = int((amount * MICROS).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except NormaliseError:
        raise
    except (InvalidOperation, ValueError, ArithmeticError) as exc:
        raise NormaliseError(f"{field_name} is not a usable number") from exc
    if abs(result) > MAX_MICROS:
        raise NormaliseError(f"{field_name} is too large to store")
    return result


def _registry() -> dict[str, ConnectorSpec]:
    from app.spend.connectors import (
        anthropic_cost_report,
        aws_cost_explorer,
        cloudflare_billing,
        github_billing,
        google_play_earnings,
        google_workspace_seats,
        namecheap_domains,
        upstash_billing,
        vercel_billing,
    )

    specs = tuple(
        module.SPEC
        for module in (
            github_billing,
            aws_cost_explorer,
            vercel_billing,
            cloudflare_billing,
            anthropic_cost_report,
            google_play_earnings,
            google_workspace_seats,
            upstash_billing,
            namecheap_domains,
        )
    )
    return {spec.key: spec for spec in specs}


CONNECTORS: dict[str, ConnectorSpec] = _registry()

#: The first segment of every ``source_ref`` a normaliser writes
#: (``github:<org>:<day>:…``). A reference entered by hand may not start with
#: one (``app.costs.entries``), so it can never collide with a provider line;
#: ``tests/test_costs_review_fixes.py`` pins this list against the sources.
CONNECTOR_REF_NAMESPACES: frozenset[str] = frozenset(
    {"anthropic", "aws", "cloudflare", "github", "play", "upstash", "vercel"}
)


def connector_spec(key: str | None) -> ConnectorSpec | None:
    return CONNECTORS.get(key) if key else None
