"""Is a vendor's spend KNOWN right now? (plan decision 5: unknown is not zero)

A vendor's freshness is read from its import runs, never from its entries: a
day with no entry might be a $0 day or a day nobody fetched, and only the runs
can tell those apart.

* A day ``D`` is **complete** when an ``ok`` day/range run covering it finished
  after ``D`` ended (UTC). Month reconciliation runs never count.
* The vendor is **stale** when the newest complete day is older than the
  latest day the connector should already serve: the day whose end lies more
  than ``expected_lag_hours + 12`` hours in the past. The lag is declared per
  connector (GitHub 24, AWS 48), so a provider that is slow by design is not
  permanently stale.

Statuses: ``ok``; ``stale``; ``failed`` (the last run failed); ``never`` (a
connector with no run); ``manual`` (no connector, but recurring or manual
entries — there is nothing to link); ``not_linked`` (no connector and no
entries). Only ``ok`` and ``manual`` are KNOWN.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import CostEntry, CostImportRun, RecurringCost, Vendor
from app.spend.connectors import connector_spec

#: Slack added to a connector's declared lag before a missing day is stale.
STALE_SLACK_HOURS = 12

KNOWN_STATUSES = frozenset({"ok", "manual"})


@dataclass
class Freshness:
    status: str
    reason: str | None = None
    last_ok_at: datetime | None = None
    newest_complete_day: date | None = None
    #: Every day an ok run covered completely — the "observed" days a spike
    #: median may use. A complete day with no entry for a scope is a real $0
    #: for that scope (the provider stated the whole day); a day absent here
    #: is UNKNOWN and is never filled with a zero.
    complete_days: set[date] = field(default_factory=set)
    #: Every day an ok run FETCHED at all, complete or not (today so far is
    #: fetched but not complete). A connector day outside this set is
    #: UNKNOWN: a window containing one has no honest total.
    covered_days: set[date] = field(default_factory=set)
    #: The finish time of the newest failed run, when the last run failed.
    last_failed_at: datetime | None = None

    @property
    def known(self) -> bool:
        return self.status in KNOWN_STATUSES


def required_day(now: datetime, lag_hours: int) -> date:
    """The newest day a connector with this lag must already serve."""
    return (now - timedelta(hours=lag_hours + STALE_SLACK_HOURS)).date() - timedelta(
        days=1
    )


def _fetched(run: CostImportRun) -> list[date]:
    if run.period_start is None or run.period_end is None:
        return []
    days: list[date] = []
    current = run.period_start
    while current <= run.period_end:
        days.append(current)
        current += timedelta(days=1)
    return days


def _covered(run: CostImportRun) -> list[date]:
    if run.period_start is None or run.period_end is None or run.finished_at is None:
        return []
    last_complete = run.finished_at.astimezone(UTC).date() - timedelta(days=1)
    last = min(run.period_end, last_complete)
    days: list[date] = []
    current = run.period_start
    while current <= last:
        days.append(current)
        current += timedelta(days=1)
    return days


async def vendor_freshness(
    db: AsyncSession,
    tenant_id: UUID,
    vendors: list[Vendor],
    now: datetime,
) -> dict[UUID, Freshness]:
    ids = [v.id for v in vendors]
    if not ids:
        return {}
    runs = (
        (
            await db.execute(
                select(CostImportRun)
                .where(
                    CostImportRun.tenant_id == tenant_id,
                    CostImportRun.vendor_id.in_(ids),
                    CostImportRun.granularity != "month",
                )
                .order_by(CostImportRun.started_at)
            )
        )
        .scalars()
        .all()
    )
    by_vendor: dict[UUID, list[CostImportRun]] = defaultdict(list)
    for run in runs:
        by_vendor[run.vendor_id].append(run)

    with_entries = set(
        (
            await db.execute(
                select(CostEntry.vendor_id)
                .where(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.vendor_id.in_(ids),
                    CostEntry.source.in_(("manual", "recurring")),
                )
                .distinct()
            )
        ).scalars()
    ) | set(
        (
            await db.execute(
                select(RecurringCost.vendor_id)
                .where(
                    RecurringCost.tenant_id == tenant_id,
                    RecurringCost.vendor_id.in_(ids),
                )
                .distinct()
            )
        ).scalars()
    )

    out: dict[UUID, Freshness] = {}
    for vendor in vendors:
        spec = connector_spec(vendor.connector)
        if vendor.connector is None or spec is None:
            out[vendor.id] = Freshness(
                status="manual" if vendor.id in with_entries else "not_linked",
                reason=(
                    None
                    if vendor.id in with_entries
                    else "no connector and no recurring or manual entries"
                ),
            )
            continue
        vendor_runs = by_vendor.get(vendor.id, [])
        if not vendor_runs:
            out[vendor.id] = Freshness(status="never", reason="no import has run")
            continue
        fresh = Freshness(status="ok")
        for run in vendor_runs:
            if run.status == "ok":
                fresh.complete_days.update(_covered(run))
                fresh.covered_days.update(_fetched(run))
                if run.finished_at and (
                    fresh.last_ok_at is None or run.finished_at > fresh.last_ok_at
                ):
                    fresh.last_ok_at = run.finished_at
        fresh.newest_complete_day = max(fresh.complete_days, default=None)
        last = vendor_runs[-1]
        # A failed run decides the status only when it is about the present:
        # a rejected backfill of an old day says nothing about whether the
        # current days are known. A run whose period is unknown (its query
        # itself was invalid) counts — a broken importer is news.
        if last.status == "failed" and (
            last.period_end is None
            or fresh.newest_complete_day is None
            or last.period_end >= fresh.newest_complete_day
        ):
            fresh.status = "failed"
            fresh.reason = f"last import failed: {last.error or 'no reason recorded'}"
            fresh.last_failed_at = last.finished_at or last.started_at
        else:
            need = required_day(now, spec.expected_lag_hours)
            if fresh.newest_complete_day is None or fresh.newest_complete_day < need:
                fresh.status = "stale"
                fresh.reason = (
                    f"no complete day since {fresh.newest_complete_day or 'ever'}; "
                    f"{need} was due (expected lag {spec.expected_lag_hours} h)"
                )
        out[vendor.id] = fresh
    return out
