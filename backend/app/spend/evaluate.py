"""The spend evaluator: rules → ``overview.spend_alerts`` rows (plan Phase 3).

Runs hourly with ``run_at_boot`` (``spend_evaluate`` in
``app.core.scheduler``) and after every successful ingest. Every run is
idempotent: an alert row is unique per crossing, so a tick that finds a
crossing already recorded writes nothing.

The rules
---------
* **daily_abs** — a vendor's (or, org-wide, every vendor's) connector-reported
  day exceeds ``daily_abs_micros``. Evaluated for yesterday (complete) and
  today so far.
* **spike** — one scope's (a repo for GitHub, a service for AWS) COMPLETE day
  exceeds ``spike_multiplier ×`` the median of its previous
  ``median_window_days`` days. The median runs over OBSERVED days only — days
  an ok import covered completely; a day nobody fetched is not a $0 day and
  is never filled with one. Fewer than 7 observed days is recorded as
  "insufficient history", which is not a pass. A vendor with no rule still
  gets this rule, at 3× a 14-day median (decision 8).
* **mtd_threshold** — month-to-date crosses N% of ``monthly_ceiling_micros``.
  Only the HIGHEST newly crossed threshold fires on a tick, so a first run in
  a month already at 133% fires one 100% alert, not four.
* **stale** — the vendor's figures are UNKNOWN (decision 5). Resolves when a
  fresh ok run lands.

Guards
------
* **First run:** daily and spike rules look only at the last two days, so a
  backfill of history never fires.
* **Scheduled renewals (decision 13):** spike and daily rules read connector
  rows only (recurring figures never), and a connector row within ±3 days and
  ±10% of a known recurring charge of the same vendor is a scheduled renewal,
  excluded from both.
* **Ceilings** read connector-reported spend for their own vendor through the
  rule's ``product_filter``; an org-wide ceiling reads the amortized view of
  every vendor (decision 12).

The org-wide rule is the project's spend LIMIT
-----------------------------------------------
(authoring-layer Phase 5: there is no separate limits table.) It is evaluated
in the project's BASE currency: every figure is converted with the project's
FX rates (``app.costs.fx`` — an entry's own rate first, then the settings'),
the rule's own thresholds too, and its month-to-date is ACTUAL cost as the
costs summary defines it — priced labour included under ``day_rates``, a
``labour`` cost entry counted only under ``fixed_fee``
(``app.costs.summary.month_to_date``). A figure no rate converts, or time
logged without a price, is never summed as zero and never converted 1:1: the
org-wide rule is skipped for the tick and the reason recorded
(``EvaluationReport.org_rule_skipped``).
"""

from __future__ import annotations

import asyncio
import statistics
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import RecurringCost, SpendAlert, SpendRule, Vendor
from app.spend.connectors import connector_spec
from app.spend.freshness import Freshness, vendor_freshness
from app.spend.recurring import amount_micros, charge_dates
from app.spend.summary import SUMMARY_CURRENCY, SpendRow, load_rows, month_bounds

logger = structlog.get_logger(__name__)

DEFAULT_SPIKE_MULTIPLIER = Decimal("3")
DEFAULT_MEDIAN_WINDOW_DAYS = 14
MIN_OBSERVED_DAYS = 7
#: Daily and spike rules look back this many days and no further.
FIRST_RUN_GUARD_DAYS = 2
RENEWAL_DAY_TOLERANCE = 3
RENEWAL_AMOUNT_TOLERANCE = Decimal("0.10")
#: The org-wide rule's ``vendor_key``.
ORG_VENDOR_KEY = "*"


@dataclass
class EvaluationReport:
    tenant_id: UUID
    fired: list[str] = field(default_factory=list)
    resolved: list[str] = field(default_factory=list)
    #: ``<vendor>:<scope>:<day>`` whose spike rule could not be evaluated —
    #: NOT a pass (fewer than 7 observed days, or a zero median).
    insufficient_history: list[str] = field(default_factory=list)
    #: Vendors with figures in a currency other than their rules' (USD) —
    #: UNKNOWN at alert time, so their money rules are not evaluated. Logged.
    unknown_currency: list[str] = field(default_factory=list)
    #: Why the org-wide rule was not evaluated this tick (an amount no FX
    #: rate converts to the base currency, unpriced time), or ``None``.
    org_rule_skipped: str | None = None


@dataclass(frozen=True)
class _Crossing:
    rule: str
    vendor_id: UUID | None
    scope_key: str
    period_key: str
    observed_micros: int | None
    threshold_micros: int | None
    detail: dict[str, Any]
    threshold_key: int = 0
    currency: str = "USD"


def _matches(product: str | None, product_filter: list[str] | None) -> bool:
    return not product_filter or (product is not None and product in product_filter)


def _renewal_exclusions(
    rows: list[SpendRow], recurring: list[RecurringCost]
) -> set[int]:
    """Indexes of connector rows that are a scheduled renewal charge."""
    by_vendor: dict[UUID, list[tuple[date, int]]] = defaultdict(list)
    for entry in recurring:
        amount = amount_micros(entry)
        if amount <= 0:
            continue
        lo = min((r.day for r in rows), default=None)
        hi = max((r.day for r in rows), default=None)
        if lo is None or hi is None:
            break
        for charge in charge_dates(
            entry,
            lo - timedelta(days=RENEWAL_DAY_TOLERANCE),
            hi + timedelta(days=RENEWAL_DAY_TOLERANCE),
        ):
            by_vendor[entry.vendor_id].append((charge, amount))
    excluded: set[int] = set()
    for index, row in enumerate(rows):
        for charge, amount in by_vendor.get(row.vendor_id, ()):
            near = abs((row.day - charge).days) <= RENEWAL_DAY_TOLERANCE
            close = abs(Decimal(row.net_micros - amount)) <= (
                RENEWAL_AMOUNT_TOLERANCE * amount
            )
            if near and close:
                excluded.add(index)
                break
    return excluded


def _scaled(multiplier: Decimal, value: float | int) -> int:
    return int(
        (multiplier * Decimal(str(value))).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )


def _vendor_crossings(
    vendor: Vendor,
    rule: SpendRule | None,
    fresh: Freshness,
    rows: list[SpendRow],
    all_rows: list[SpendRow],
    today: date,
    existing_mtd: dict[tuple[str, str], int],
    report: EvaluationReport,
    *,
    money: bool = True,
) -> list[_Crossing]:
    """Every crossing for one connector vendor. ``money=False`` (a vendor
    with figures in a foreign currency) runs only the stale rule — its money
    rules would sum the wrong figures, but whether its data is fresh is
    still known and still alerts. ``rows`` are its connector
    rows with scheduled renewals removed (what the daily and spike rules
    read); ``all_rows`` are all of them (what a ceiling reads — a connector
    charge is real spend against it even when it looks like a renewal)."""
    spec = connector_spec(vendor.connector)
    out: list[_Crossing] = []
    pf = rule.product_filter if rule else None
    counted = [r for r in rows if _matches(r.product, pf)]
    name = vendor.name
    provider = spec.provider if spec else name
    month_start, _ = month_bounds(today)
    mtd = sum(
        r.net_micros
        for r in all_rows
        if month_start <= r.day <= today and _matches(r.product, pf)
    )
    ceiling = rule.monthly_ceiling_micros if rule else None
    base_detail: dict[str, Any] = {"vendor": name, "provider": provider}
    if ceiling:
        base_detail["mtd_micros"] = mtd
        base_detail["ceiling_micros"] = ceiling

    # Stale (decision 5). A vendor with a connector that has never run is
    # flagged only once a rule says data is expected from it — a seeded,
    # not-yet-collected connector is "never", which the page already shows.
    if fresh.status in ("stale", "failed") or (
        fresh.status == "never" and rule is not None
    ):
        # Keyed on the last ok run's INSTANT, not its day: a vendor that goes
        # stale, recovers and goes stale again on one day is two episodes,
        # and the second must not collide with the first, resolved, row.
        since = (
            fresh.last_ok_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            if fresh.last_ok_at
            else "never"
        )
        out.append(
            _Crossing(
                rule="stale",
                vendor_id=vendor.id,
                scope_key="org",
                period_key=since,
                observed_micros=None,
                threshold_micros=None,
                detail={
                    **base_detail,
                    "status": fresh.status,
                    "reason": fresh.reason,
                    "newest_complete_day": (
                        fresh.newest_complete_day.isoformat()
                        if fresh.newest_complete_day
                        else None
                    ),
                },
            )
        )

    if not money:
        return out

    by_day: dict[date, int] = defaultdict(int)
    for r in counted:
        by_day[r.day] += r.net_micros

    # daily_abs — yesterday (complete) and today so far.
    if rule and rule.daily_abs_micros:
        for day in (today - timedelta(days=1), today):
            if day not in by_day:
                continue
            if by_day[day] > rule.daily_abs_micros:
                out.append(
                    _Crossing(
                        rule="daily_abs",
                        vendor_id=vendor.id,
                        scope_key="org",
                        period_key=day.isoformat(),
                        observed_micros=by_day[day],
                        threshold_micros=rule.daily_abs_micros,
                        detail={
                            **base_detail,
                            "day": day.isoformat(),
                            "complete": day in fresh.complete_days,
                        },
                    )
                )

    # spike — per scope, complete days within the first-run guard only.
    multiplier = (
        rule.spike_multiplier
        if rule and rule.spike_multiplier
        else DEFAULT_SPIKE_MULTIPLIER
    )
    window = (
        rule.median_window_days
        if rule and rule.median_window_days
        else DEFAULT_MEDIAN_WINDOW_DAYS
    )
    by_scope_day: dict[tuple[str, date], int] = defaultdict(int)
    for r in counted:
        by_scope_day[(r.scope_label or "(unscoped)", r.day)] += r.net_micros
    # A connector may opt out of the spike rule (Play's fees follow revenue;
    # a no-money connector has nothing to spike).
    spike_days = FIRST_RUN_GUARD_DAYS if spec is None or spec.spike_rule else 0
    for back in range(spike_days, 0, -1):
        day = today - timedelta(days=back)
        if day not in fresh.complete_days:
            continue
        history_days = [
            day - timedelta(days=i)
            for i in range(1, window + 1)
            if (day - timedelta(days=i)) in fresh.complete_days
        ]
        scopes = sorted({s for (s, d) in by_scope_day if d == day})
        for scope in scopes:
            observed = by_scope_day[(scope, day)]
            label = f"{name}:{scope}:{day.isoformat()}"
            if len(history_days) < MIN_OBSERVED_DAYS:
                report.insufficient_history.append(
                    f"{label} ({len(history_days)} observed days)"
                )
                continue
            # A complete day with no line for this scope is a stated $0 for
            # it — the provider reported the whole day.
            values = [by_scope_day.get((scope, d), 0) for d in history_days]
            median = statistics.median(values)
            if median <= 0:
                report.insufficient_history.append(f"{label} (zero median)")
                continue
            threshold = _scaled(multiplier, median)
            if observed > threshold:
                out.append(
                    _Crossing(
                        rule="spike",
                        vendor_id=vendor.id,
                        scope_key=scope,
                        period_key=day.isoformat(),
                        observed_micros=observed,
                        threshold_micros=threshold,
                        detail={
                            **base_detail,
                            "day": day.isoformat(),
                            "median_micros": int(median),
                            "multiplier": str(multiplier),
                            "window_days": window,
                            "observed_days": len(history_days),
                        },
                    )
                )

    # mtd_threshold — highest newly crossed only.
    if ceiling and rule and rule.mtd_thresholds_pct:
        out.extend(
            _mtd_crossing(
                vendor.id,
                str(vendor.id),
                mtd,
                ceiling,
                rule.mtd_thresholds_pct,
                today,
                existing_mtd,
                base_detail,
            )
        )
    return out


def _mtd_crossing(
    vendor_id: UUID | None,
    vendor_key: str,
    mtd: int,
    ceiling: int,
    thresholds: list[int],
    today: date,
    existing_mtd: dict[tuple[str, str], int],
    detail: dict[str, Any],
) -> list[_Crossing]:
    period = today.strftime("%Y-%m")
    crossed = [t for t in thresholds if mtd * 100 >= t * ceiling]
    if not crossed:
        return []
    top = max(crossed)
    if existing_mtd.get((vendor_key, period), 0) >= top:
        return []
    return [
        _Crossing(
            rule="mtd_threshold",
            vendor_id=vendor_id,
            scope_key="org",
            period_key=period,
            observed_micros=mtd,
            threshold_micros=ceiling * top // 100,
            threshold_key=top,
            detail={
                **detail,
                "pct": top,
                "mtd_micros": mtd,
                "ceiling_micros": ceiling,
            },
        )
    ]


async def _org_crossings(
    db: AsyncSession,
    tenant_id: UUID,
    org_rule: SpendRule,
    loaded: list[SpendRow],
    recurring: list[RecurringCost],
    today: date,
    existing_mtd: dict[tuple[str, str], int],
    report: EvaluationReport,
) -> list[_Crossing]:
    """The org-wide rule — the project's spend limit — in the base currency.

    Daily: every vendor's connector-reported day (renewals excluded),
    converted. Month to date: actual cost (:func:`month_to_date`). Anything
    that cannot be converted or priced skips the rule for this tick."""
    from app.costs.summary import month_to_date

    pf = org_rule.product_filter
    mtd = await month_to_date(db, tenant_id, today, product_filter=pf)
    fx = mtd.fx
    base = mtd.base_currency
    skipped: list[str] = []

    def threshold(micros: int | None) -> int | None:
        if micros is None:
            return None
        converted = fx.to_base(micros, org_rule.currency, record=False)
        if converted is None:
            skipped.append(f"no {org_rule.currency}->{base} rate for the rule itself")
        return converted

    daily_abs = threshold(org_rule.daily_abs_micros)
    ceiling = threshold(org_rule.monthly_ceiling_micros)
    connector = [r for r in loaded if r.source == "connector"]
    excluded = _renewal_exclusions(connector, recurring)
    by_day: dict[date, int] = defaultdict(int)
    seen_days: set[date] = set()
    for index, row in enumerate(connector):
        if index in excluded or not _matches(row.product, pf):
            continue
        if row.day not in (today - timedelta(days=1), today):
            continue
        converted = fx.to_base(
            row.net_micros, row.currency, row.fx_rate_to_base, record=False
        )
        if converted is None:
            skipped.append(f"no {row.currency}->{base} rate")
            continue
        by_day[row.day] += converted
        seen_days.add(row.day)
    skipped.extend(mtd.unknown)
    if skipped:
        report.org_rule_skipped = "; ".join(sorted(set(skipped)))
        logger.warning(
            "spend_evaluate_org_rule_skipped",
            tenant_id=str(tenant_id),
            reason=report.org_rule_skipped,
        )
        return []

    detail: dict[str, Any] = {
        "vendor": "All vendors",
        "provider": "all providers",
        "currency": base,
    }
    out: list[_Crossing] = []
    if daily_abs:
        for day in (today - timedelta(days=1), today):
            if day in seen_days and by_day[day] > daily_abs:
                out.append(
                    _Crossing(
                        rule="daily_abs",
                        vendor_id=None,
                        scope_key="org",
                        period_key=day.isoformat(),
                        observed_micros=by_day[day],
                        threshold_micros=daily_abs,
                        detail={**detail, "day": day.isoformat()},
                        currency=base,
                    )
                )
    if ceiling and org_rule.mtd_thresholds_pct:
        out.extend(
            replace(c, currency=base)
            for c in _mtd_crossing(
                None,
                ORG_VENDOR_KEY,
                mtd.micros,
                ceiling,
                org_rule.mtd_thresholds_pct,
                today,
                existing_mtd,
                detail,
            )
        )
    return out


async def evaluate_tenant(
    db: AsyncSession, tenant_id: UUID, now: datetime
) -> EvaluationReport:
    """Write every new crossing for one tenant; resolve recovered stale alerts.
    Flushes, never commits."""
    report = EvaluationReport(tenant_id=tenant_id)
    today = now.astimezone(UTC).date()
    vendors = list(
        (
            await db.execute(select(Vendor).where(Vendor.tenant_id == tenant_id))
        ).scalars()
    )
    if not vendors:
        return report
    rules = {
        r.vendor_id: r
        for r in (
            await db.execute(select(SpendRule).where(SpendRule.tenant_id == tenant_id))
        ).scalars()
    }
    window = max(
        [DEFAULT_MEDIAN_WINDOW_DAYS]
        + [r.median_window_days for r in rules.values() if r.median_window_days]
    )
    month_start, _ = month_bounds(today)
    start = min(today - timedelta(days=window + FIRST_RUN_GUARD_DAYS + 1), month_start)
    ids = [v.id for v in vendors]
    fresh = await vendor_freshness(db, tenant_id, vendors, now, since=start)
    # A vendor's rules are in the summary currency and read its CONNECTOR rows
    # only, so only a connector row in another currency makes them unknown. A
    # manual entry or recurring cost in another currency is not what they read
    # and must not switch them off (the org-wide rule converts those itself).
    loaded = await load_rows(db, tenant_id, ids, start, today, "amortized")
    foreign = {
        r.vendor_id
        for r in loaded
        if r.source == "connector" and r.currency != SUMMARY_CURRENCY
    }
    report.unknown_currency = sorted(v.name for v in vendors if v.id in foreign)
    if foreign:
        logger.warning(
            "spend_evaluate_unknown_currency",
            tenant_id=str(tenant_id),
            vendors=report.unknown_currency,
        )
    rows = [r for r in loaded if r.vendor_id not in foreign]
    recurring = list(
        (
            await db.execute(
                select(RecurringCost).where(RecurringCost.tenant_id == tenant_id)
            )
        ).scalars()
    )
    connector_rows = [r for r in rows if r.source == "connector"]
    excluded = _renewal_exclusions(connector_rows, recurring)
    evaluable = [r for i, r in enumerate(connector_rows) if i not in excluded]

    existing_mtd: dict[tuple[str, str], int] = {}
    for vendor_key, period, threshold in (
        await db.execute(
            select(
                SpendAlert.vendor_key, SpendAlert.period_key, SpendAlert.threshold_key
            ).where(
                SpendAlert.tenant_id == tenant_id,
                SpendAlert.rule == "mtd_threshold",
                SpendAlert.period_key == today.strftime("%Y-%m"),
            )
        )
    ).all():
        key = (vendor_key, period)
        existing_mtd[key] = max(existing_mtd.get(key, 0), threshold)

    crossings: list[_Crossing] = []
    for vendor in vendors:
        if vendor.connector is None:
            continue
        f = fresh[vendor.id]
        if f.status == "ok":
            resolved = await db.execute(
                update(SpendAlert)
                .where(
                    SpendAlert.tenant_id == tenant_id,
                    SpendAlert.vendor_id == vendor.id,
                    SpendAlert.rule == "stale",
                    SpendAlert.resolved_at.is_(None),
                )
                .values(resolved_at=now, coord_status="pending", updated_at=now)
                .returning(SpendAlert.id)
            )
            report.resolved.extend(str(i) for i in resolved.scalars())
        crossings.extend(
            _vendor_crossings(
                vendor,
                rules.get(vendor.id),
                f,
                [r for r in evaluable if r.vendor_id == vendor.id],
                [r for r in connector_rows if r.vendor_id == vendor.id],
                today,
                existing_mtd,
                report,
                # Foreign-currency vendor: stale raise/resolve still run;
                # the money rules (daily, spike, month-to-date) do not.
                money=vendor.id not in foreign,
            )
        )

    org_rule = rules.get(None)
    if org_rule is not None:
        crossings.extend(
            await _org_crossings(
                db,
                tenant_id,
                org_rule,
                loaded,
                recurring,
                today,
                existing_mtd,
                report,
            )
        )

    for c in crossings:
        inserted = await db.execute(
            insert(SpendAlert)
            .values(
                tenant_id=tenant_id,
                vendor_id=c.vendor_id,
                vendor_key=str(c.vendor_id) if c.vendor_id else ORG_VENDOR_KEY,
                rule=c.rule,
                scope_key=c.scope_key,
                period_key=c.period_key,
                threshold_key=c.threshold_key,
                observed_micros=c.observed_micros,
                threshold_micros=c.threshold_micros,
                currency=c.currency,
                detail=c.detail,
                fired_at=now,
                push_status="pending",
                coord_status="pending",
                created_by="spend_evaluate",
                updated_by="spend_evaluate",
            )
            .on_conflict_do_nothing(constraint="uq_overview_spend_alerts_crossing")
            .returning(SpendAlert.id)
        )
        new_id = inserted.scalar_one_or_none()
        if new_id is not None:
            report.fired.append(f"{c.rule}:{c.scope_key}:{c.period_key}")
    await db.flush()
    if report.insufficient_history:
        logger.info(
            "spend_spike_insufficient_history",
            tenant_id=str(tenant_id),
            scopes=report.insufficient_history[:20],
            count=len(report.insufficient_history),
        )
    return report


_LOCK_SQL = text("SELECT pg_try_advisory_lock(hashtext('spend:' || :tenant))")
_UNLOCK_SQL = text("SELECT pg_advisory_unlock(hashtext('spend:' || :tenant))")


async def _release(
    lock_db: AsyncSession, params: dict[str, str], tenant_id: UUID
) -> None:
    """Release the session-level lock — shielded, so a cancellation landing
    here cannot skip it. If the unlock still does not complete, the
    connection is INVALIDATED rather than returned to the pool: a pooled
    connection still holding the lock would turn every later evaluator for
    this tenant away until the process restarts."""

    async def unlock() -> None:
        await lock_db.execute(_UNLOCK_SQL, params)
        await lock_db.commit()

    try:
        await asyncio.shield(unlock())
    except BaseException:
        logger.warning("spend_evaluate_unlock_failed", tenant_id=str(tenant_id))
        try:
            connection = await lock_db.connection()
            await connection.invalidate()
        except Exception:  # noqa: BLE001 — nothing more can be done here
            logger.exception("spend_evaluate_lock_invalidate_failed")
        raise


async def evaluate_and_deliver_tenant(
    tenant_id: UUID, *, session_factory: Any = None, now: datetime | None = None
) -> EvaluationReport | None:
    """Evaluate, then deliver (push + coord), for one tenant. ``None`` when
    another evaluator holds the tenant (the hourly tick and an after-ingest
    call may overlap).

    The alert rows are COMMITTED before anything is sent, and each delivery is
    committed right after its send (``app.spend.deliver``), so a later failure
    can never roll back the record of a push the phone already has — which
    would send it again next tick. The per-tenant lock is therefore a
    session-level advisory lock held on its OWN session across those commits.
    """
    from app.spend.deliver import deliver_tenant

    if session_factory is None:
        from app.db.session import AsyncSessionLocal

        session_factory = AsyncSessionLocal
    params = {"tenant": str(tenant_id)}
    async with session_factory() as lock_db:
        if not bool((await lock_db.execute(_LOCK_SQL, params)).scalar()):
            logger.info("spend_evaluate_skipped_locked", tenant_id=str(tenant_id))
            return None
        try:
            async with session_factory() as db:
                when = now or datetime.now(UTC)
                report = await evaluate_tenant(db, tenant_id, when)
                await db.commit()
                await deliver_tenant(db, tenant_id, when)
                await db.commit()
                return report
        finally:
            await _release(lock_db, params, tenant_id)


async def evaluate_all_tenants(*, session_factory: Any = None) -> dict[str, Any]:
    """The ``spend_evaluate`` scheduler core: every tenant with a vendor."""
    if session_factory is None:
        from app.db.session import AsyncSessionLocal

        session_factory = AsyncSessionLocal
    async with session_factory() as db:
        tenants = list(
            (await db.execute(select(Vendor.tenant_id).distinct())).scalars()
        )
    summary: dict[str, Any] = {"tenants": len(tenants), "fired": 0, "failed": 0}
    for tenant_id in tenants:
        try:
            report = await evaluate_and_deliver_tenant(
                tenant_id, session_factory=session_factory
            )
        except Exception:  # noqa: BLE001 — one tenant must not stop the rest
            summary["failed"] += 1
            logger.exception("spend_evaluate_tenant_failed", tenant_id=str(tenant_id))
            continue
        if report is not None:
            summary["fired"] += len(report.fired)
    return summary
