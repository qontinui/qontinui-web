"""Foreign exchange into the project's base currency (authoring-layer Phase 5).

There is no live FX feed (business-leaders plan, open question 2): every rate
is entered by hand, usually the estimate's own stated currency assumptions.
A rate means **units of the base currency per one unit of the foreign one** —
with base EUR, ``{"USD": {"rate": "0.92"}}`` makes 1 USD = 0.92 EUR. The same
reading holds for ``cost_entries.fx_rate_to_base``.

Precedence, per amount:

1. the amount is already in the base currency — no conversion;
2. the ENTRY's own ``fx_rate_to_base`` (the rate on that invoice);
3. the project's ``settings.fx_rates`` for the currency;
4. otherwise the amount is UNKNOWN in the base currency — recorded as a
   missing conversion and left out of every sum, which is then partial.
   Never converted at 1:1 and never counted as 0.

Every conversion a read applies is recorded in a :class:`FxBook`, so a
response can list exactly which rates produced its figures. Money stays
integer micros; each converted amount is rounded once, half up.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.overview.precision import numeric

#: A rate is stored like ``cost_entries.fx_rate_to_base``: NUMERIC(18, 8).
Rate = Annotated[Decimal, numeric(18, 8, gt=0)]


class FxRate(BaseModel):
    """One entry of ``settings.fx_rates``: the rate for one foreign currency."""

    model_config = ConfigDict(extra="forbid")

    #: Units of the BASE currency per one unit of this currency.
    rate: Rate
    #: When the rate was taken (the estimate's "as of" date, an invoice date).
    as_of: date | None = None
    note: str | None = Field(default=None, max_length=500)


def _currency_code(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    code = value.strip().upper()
    if len(code) != 3 or not (code.isascii() and code.isalpha()):
        return None
    return code


def validate_settings_rates(raw: Mapping[str, Any], base_currency: str) -> dict:
    """Validate and normalise ``settings.fx_rates`` for a WRITE.

    Raises ``ValueError`` naming the offending currency. Returns the JSON the
    column stores: ``{"USD": {"rate": "0.92", "as_of": "2026-01-01", "note":
    "…"}}`` — the rate as a decimal STRING, so it never passes through a float.
    """
    out: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        code = _currency_code(key)
        if code is None:
            raise ValueError(
                f"fx_rates key {key!r} is not a 3-letter ISO 4217 code, e.g. USD"
            )
        if code == base_currency:
            raise ValueError(
                f"fx_rates has a rate for {code}, the base currency itself; "
                "an amount in the base currency is never converted"
            )
        if code in out:
            raise ValueError(f"fx_rates names {code} twice")
        if not isinstance(value, Mapping):
            # The legacy bare-number shape ({"USD": 0.92}) — the one shape the
            # reader also accepts — is normalised rather than refused, so a
            # settings save that round-trips stored legacy data still works.
            value = {"rate": value}
        try:
            rate = FxRate.model_validate(value)
        except ValidationError as exc:
            problems = "; ".join(
                f"{'.'.join(str(p) for p in err['loc']) or 'value'}: {err['msg']}"
                for err in exc.errors()
            )
            raise ValueError(f"fx_rates[{code}] is not a rate ({problems})") from exc
        stored: dict[str, Any] = {"rate": format(rate.rate.normalize(), "f")}
        if rate.as_of is not None:
            stored["as_of"] = rate.as_of.isoformat()
        if rate.note:
            stored["note"] = rate.note
        out[code] = stored
    return out


def parse_settings_rates(
    raw: Mapping[str, Any] | None,
) -> tuple[dict[str, FxRate], dict[str, str]]:
    """Read ``settings.fx_rates`` as stored: ``(usable, unreadable)``.

    A row written before rates were validated may hold anything. An entry that
    does not parse is not guessed at: its currency goes in ``unreadable`` (with
    why), and an amount in it is as unconvertible as one with no rate at all.
    """
    usable: dict[str, FxRate] = {}
    unreadable: dict[str, str] = {}
    for key, value in (raw or {}).items():
        code = _currency_code(key)
        if code is None:
            unreadable[str(key)] = "not a currency code"
            continue
        candidate: Any = value
        if not isinstance(value, Mapping):
            # A bare number ({"USD": 0.92}) is the one legacy shape that is
            # unambiguous: it can only be the rate.
            candidate = {"rate": value}
        try:
            usable[code] = FxRate.model_validate(
                {k: v for k, v in candidate.items() if k in ("rate", "as_of", "note")}
            )
        except (ValidationError, InvalidOperation, TypeError) as exc:
            unreadable[code] = f"unreadable rate: {exc.__class__.__name__}"
    return usable, unreadable


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------------------
# What a read applied
# ---------------------------------------------------------------------------

FxSource = Literal["entry", "settings"]
MissingReason = Literal["no_rate", "unreadable_rate"]


class FxApplied(BaseModel):
    """One rate a read used, and how much it converted."""

    currency: str
    source: FxSource
    #: Units of the base currency per one unit of ``currency``.
    rate: Decimal
    as_of: date | None = None
    rows: int
    original_micros: int
    base_micros: int


class FxMissing(BaseModel):
    """A currency a read could NOT convert; its amounts are in no total."""

    currency: str
    reason: MissingReason
    detail: str
    rows: int
    original_micros: int


@dataclass
class _AppliedAcc:
    rows: int = 0
    original: int = 0
    base: int = 0


@dataclass
class FxBook:
    """Converts amounts to the base currency and remembers how."""

    base_currency: str
    rates: dict[str, FxRate] = field(default_factory=dict)
    unreadable: dict[str, str] = field(default_factory=dict)
    _applied: dict[tuple[str, FxSource, Decimal, date | None], _AppliedAcc] = field(
        default_factory=dict
    )
    _missing: dict[str, _AppliedAcc] = field(default_factory=dict)

    @classmethod
    def for_settings(cls, base_currency: str, fx_rates: Mapping[str, Any] | None):
        usable, unreadable = parse_settings_rates(fx_rates)
        usable.pop(base_currency, None)
        return cls(base_currency=base_currency, rates=usable, unreadable=unreadable)

    def rate_for(
        self, currency: str, entry_rate: Decimal | None = None
    ) -> tuple[Decimal, FxSource, date | None] | None:
        """The rate that would convert ``currency``, by the precedence above;
        ``None`` for the base currency itself is never asked — see
        :meth:`to_base`."""
        if entry_rate is not None and entry_rate > 0:
            return Decimal(entry_rate), "entry", None
        settings = self.rates.get(currency)
        if settings is not None:
            return settings.rate, "settings", settings.as_of
        return None

    def to_base(
        self,
        micros: int,
        currency: str,
        entry_rate: Decimal | None = None,
        *,
        rows: int = 1,
        record: bool = True,
    ) -> int | None:
        """``micros`` in the base currency, or ``None`` when no rate exists.

        ``record=False`` converts without adding to the book — for a figure a
        response does not report (a comparison basis computed twice)."""
        if currency == self.base_currency:
            return micros
        found = self.rate_for(currency, entry_rate)
        if found is None:
            if record:
                acc = self._missing.setdefault(currency, _AppliedAcc())
                acc.rows += rows
                acc.original += micros
            return None
        rate, source, as_of = found
        converted = _round(Decimal(micros) * rate)
        if record:
            acc = self._applied.setdefault(
                (currency, source, rate, as_of), _AppliedAcc()
            )
            acc.rows += rows
            acc.original += micros
            acc.base += converted
        return converted

    def applied(self) -> list[FxApplied]:
        return [
            FxApplied(
                currency=currency,
                source=source,
                rate=rate,
                as_of=as_of,
                rows=acc.rows,
                original_micros=acc.original,
                base_micros=acc.base,
            )
            for (currency, source, rate, as_of), acc in sorted(
                self._applied.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])
            )
        ]

    def missing(self) -> list[FxMissing]:
        out: list[FxMissing] = []
        for currency, acc in sorted(self._missing.items()):
            if currency in self.unreadable:
                reason: MissingReason = "unreadable_rate"
                detail = (
                    f"The project's rate for {currency} cannot be read "
                    f"({self.unreadable[currency]}); re-enter it in the settings."
                )
            else:
                reason = "no_rate"
                detail = (
                    f"No rate converts {currency} to {self.base_currency}: set "
                    f"one in the project's settings or on the entry itself."
                )
            out.append(
                FxMissing(
                    currency=currency,
                    reason=reason,
                    detail=detail,
                    rows=acc.rows,
                    original_micros=acc.original,
                )
            )
        return out
