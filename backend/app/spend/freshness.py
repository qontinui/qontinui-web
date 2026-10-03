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

from sqlalchemy import select, text
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
    #: Every day an ok run covered COMPLETELY (fetched after the day ended) —
    #: the "observed" days a spike median may use. A complete day with no
    #: entry for a scope is a stated $0 for that scope. A day absent here is
    #: either unfetched or fetched only partly; the median never uses it and
    #: never fills it with a zero. Filled only from ``since`` onwards.
    complete_days: set[date] = field(default_factory=set)
    #: Every day an ok run FETCHED at all, complete or not (today so far is
    #: fetched but not complete). The summary's figures and ``uncovered_days``
    #: read this: a connector day outside it is UNKNOWN, so a window
    #: containing one has no honest total. Filled only from ``since`` onwards.
    covered_days: set[date] = field(default_factory=set)
    #: The first day any ok run covered; before it the vendor has no data.
    #: The range up to ``newest_complete_day`` can still have HOLES (days no
    #: run fetched) — the summary lists them as ``uncovered_days``.
    oldest_covered_day: date | None = None
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


_RUN_FACTS = text(
    """
    SELECT vendor_id,
           max(finished_at) FILTER (WHERE status = 'ok') AS last_ok_at,
           max(LEAST(period_end, (finished_at AT TIME ZONE 'UTC')::date - 1))
               FILTER (WHERE status = 'ok'
                       AND period_end IS NOT NULL
                       AND finished_at IS NOT NULL
                       AND (finished_at AT TIME ZONE 'UTC')::date - 1 >= period_start)
               AS newest_complete_day,
           min(period_start) FILTER (WHERE status = 'ok') AS oldest_covered_day
      FROM overview.cost_import_runs
     WHERE tenant_id = :tenant
       AND vendor_id = ANY(:ids)
       AND granularity <> 'month'
     GROUP BY vendor_id
    """
)

_LAST_RUN = text(
    """
    SELECT DISTINCT ON (vendor_id)
           vendor_id, status, error, period_end, finished_at, started_at
      FROM overview.cost_import_runs
     WHERE tenant_id = :tenant
       AND vendor_id = ANY(:ids)
       AND granularity <> 'month'
     ORDER BY vendor_id, started_at DESC
    """
)


async def vendor_freshness(
    db: AsyncSession,
    tenant_id: UUID,
    vendors: list[Vendor],
    now: datetime,
    *,
    since: date | None = None,
) -> dict[UUID, Freshness]:
    """Freshness for these vendors.

    The status, ``last_ok_at``, ``newest_complete_day`` and
    ``oldest_covered_day`` are aggregates over EVERY run, computed in SQL.
    The per-day sets (``complete_days``, ``covered_days``) are filled only
    for runs reaching ``since`` or later — the window the caller reads — so
    the work is bounded by the window, not by the vendor's whole history.
    """
    ids = [v.id for v in vendors]
    if not ids:
        return {}
    params = {"tenant": tenant_id, "ids": ids}
    facts = {row.vendor_id: row for row in (await db.execute(_RUN_FACTS, params)).all()}
    last_runs = {
        row.vendor_id: row for row in (await db.execute(_LAST_RUN, params)).all()
    }
    window = select(CostImportRun).where(
        CostImportRun.tenant_id == tenant_id,
        CostImportRun.vendor_id.in_(ids),
        CostImportRun.granularity != "month",
        CostImportRun.status == "ok",
    )
    if since is not None:
        window = window.where(CostImportRun.period_end >= since)
    by_vendor: dict[UUID, list[CostImportRun]] = defaultdict(list)
    for run in (await db.execute(window)).scalars().all():
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
        last = last_runs.get(vendor.id)
        if last is None:
            out[vendor.id] = Freshness(status="never", reason="no import has run")
            continue
        fact = facts.get(vendor.id)
        fresh = Freshness(status="ok")
        if fact is not None:
            fresh.last_ok_at = fact.last_ok_at
            fresh.newest_complete_day = fact.newest_complete_day
            fresh.oldest_covered_day = fact.oldest_covered_day
        for run in by_vendor.get(vendor.id, []):
            fresh.complete_days.update(_covered(run))
            fresh.covered_days.update(_fetched(run))
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
