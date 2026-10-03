"""The connector registry: every connector key the store admits, with what
the freshness rule and the provenance line need to know about it.

Plan decision 2: one Python normaliser per provider turns the provider's RAW
response into cost-entry rows, and both transports (the ingest door, a later
server pull) share it. Decision 5: freshness is lag-aware — each connector
declares ``expected_lag_hours``, the delay after a UTC day ends before the
provider serves that day complete (GitHub 24, AWS Cost Explorer 48).

A connector whose ``normalise`` is ``None`` is declared (the vendor CHECK
admits it, the page can show it "not linked") but has no normaliser yet —
Phase 9 adds them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

#: Money is integer micros.
MICROS = Decimal(1_000_000)


class NormaliseError(ValueError):
    """The raw payload is not what this connector accepts. The message is
    recorded on the failed import run and returned in the 422."""


@dataclass(frozen=True)
class IngestQuery:
    year: int
    month: int
    day: int | None = None

    @property
    def is_day(self) -> bool:
        return self.day is not None


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


Normaliser = Callable[[Any, IngestQuery, dict[str, Any]], NormalisedBatch]


@dataclass(frozen=True)
class ConnectorSpec:
    key: str
    provider: str
    expected_lag_hours: int
    provenance: str
    normalise: Normaliser | None = None


def micros(value: Any, *, field_name: str) -> int:
    """A provider decimal amount → integer micros, half away from zero.

    ``float`` is read through ``str`` so ``0.1`` stays ``0.1``.
    """
    if isinstance(value, bool) or not isinstance(value, int | float | str | Decimal):
        raise NormaliseError(f"{field_name} is not a number")
    try:
        amount = Decimal(str(value))
    except Exception as exc:  # noqa: BLE001 — decimal raises several kinds
        raise NormaliseError(f"{field_name} is not a number") from exc
    if not amount.is_finite():
        raise NormaliseError(f"{field_name} is not a finite number")
    from decimal import ROUND_HALF_UP

    return int((amount * MICROS).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _registry() -> dict[str, ConnectorSpec]:
    from app.spend.connectors.github_billing import normalise as github_normalise

    specs = (
        ConnectorSpec(
            key="github_billing",
            provider="GitHub",
            expected_lag_hours=24,
            provenance="as reported by GitHub billing usage API",
            normalise=github_normalise,
        ),
        ConnectorSpec(
            key="aws_cost_explorer",
            provider="AWS",
            # Cost Explorer's complete day is day - 2.
            expected_lag_hours=48,
            provenance="as reported by AWS Cost Explorer (UnblendedCost)",
        ),
        ConnectorSpec(
            key="vercel_billing",
            provider="Vercel",
            expected_lag_hours=24,
            provenance="as reported by Vercel billing charges (FOCUS BilledCost)",
        ),
        ConnectorSpec(
            key="cloudflare_billing",
            provider="Cloudflare",
            expected_lag_hours=48,
            provenance="as reported by Cloudflare billing history",
        ),
        ConnectorSpec(
            key="anthropic_cost_report",
            provider="Anthropic",
            expected_lag_hours=24,
            provenance="as reported by the Anthropic cost report API",
        ),
        ConnectorSpec(
            key="google_play_earnings",
            provider="Google Play",
            # Monthly earnings reports land days after the month ends.
            expected_lag_hours=24 * 35,
            provenance="as reported by Google Play earnings reports (fees only)",
        ),
        ConnectorSpec(
            key="google_workspace_seats",
            provider="Google Workspace",
            expected_lag_hours=24,
            provenance="seat count from the Enterprise License Manager API (no money)",
        ),
        ConnectorSpec(
            key="upstash_billing",
            provider="Upstash",
            expected_lag_hours=24,
            provenance="as reported by the Upstash developer API (dailybilling)",
        ),
    )
    return {spec.key: spec for spec in specs}


CONNECTORS: dict[str, ConnectorSpec] = _registry()


def connector_spec(key: str | None) -> ConnectorSpec | None:
    return CONNECTORS.get(key) if key else None
