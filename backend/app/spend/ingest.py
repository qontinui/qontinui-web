"""Ingest one raw provider payload through its connector's normaliser.

Both transports (the push door, a later server pull) end here, so there is
one normaliser per provider and nothing to drift between them (decision 2).

* A **day** payload is that day's whole statement: its entries are upserted on
  ``(tenant_id, vendor_id, source_ref)`` — so the same payload twice is a
  no-op and a partial day re-ingested is corrected — and any stored line for
  that account and day the provider no longer reports is removed.
* A **month** payload is a reconciliation check only: its net is compared with
  the sum of the stored day entries for the month and the difference is
  recorded on the run (``reconcile_delta_micros``). Nothing is upserted.
* A payload the normaliser rejects still writes a ``failed`` run, with the
  reason, so the freshness signal reports the failure rather than going quiet.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import CostEntry, CostImportRun, Vendor
from app.spend.connectors import (
    CONNECTORS,
    IngestQuery,
    NormalisedBatch,
    NormaliseError,
)

logger = structlog.get_logger(__name__)


@dataclass
class IngestResult:
    run_id: UUID
    status: str
    rows_upserted: int
    items_seen: int
    reconcile_delta_micros: int | None
    error: str | None = None
    #: Why a failed run failed: ``rejected`` — the payload (the caller's to
    #: fix, a 422); ``storage`` — this server could not store it (a 5xx).
    failure: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


async def ingest_payload(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    vendor: Vendor,
    connector: str,
    query: IngestQuery,
    raw: Any,
    source: str,
    transport: str = "push",
) -> IngestResult:
    """Normalise and store ``raw``; returns the run. Flushes, never commits."""
    started = _now()
    spec = CONNECTORS[connector]
    run = CostImportRun(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        connector=connector,
        source=source,
        transport=transport,
        granularity=("range" if query.is_range else "day" if query.is_day else "month"),
        status="failed",
        started_at=started,
        created_by=source,
        updated_by=source,
    )
    run.period_start, run.period_end = _query_period(query)
    db.add(run)
    await db.flush()

    try:
        if spec.normalise is None:
            raise NormaliseError(
                f"connector {connector!r} has no normaliser in this release"
            )
        batch = spec.normalise(raw, query, dict(vendor.connector_config or {}))
    except NormaliseError as exc:
        run.error = str(exc)[:2000]
        run.finished_at = _now()
        await db.flush()
        return IngestResult(
            run.id, "failed", 0, _count_items(raw), None, run.error, "rejected"
        )
    except Exception as exc:  # noqa: BLE001 — still a recorded run
        # A normaliser is a pure function of the payload, so anything it
        # raises was triggered by the payload: a 422 the caller can act on,
        # with the failed run committed and the crash logged for a fix.
        logger.exception("spend_normaliser_crashed", connector=connector)
        run.error = f"the payload broke the normaliser: {type(exc).__name__}"
        run.finished_at = _now()
        await db.flush()
        return IngestResult(
            run.id, "failed", 0, _count_items(raw), None, run.error, "rejected"
        )

    run.provider_endpoint = batch.provider_endpoint
    run.period_start = batch.period_start
    run.period_end = batch.period_end
    run.items_seen = batch.items_seen
    run.granularity = batch.granularity

    try:
        # A savepoint, so a store failure (a constraint, a database error)
        # rolls back only the entries and the FAILED run is still written —
        # freshness must report the failure rather than go quiet.
        async with db.begin_nested():
            if batch.granularity == "month":
                run.reconcile_delta_micros = await _reconcile(
                    db, tenant_id, vendor.id, batch
                )
                run.rows_upserted = 0
            else:
                run.rows_upserted = await _upsert(
                    db, tenant_id, vendor.id, run.id, batch, source
                )
            notices = list(batch.notices)
            # Only a SERVER pull may act on the tenant's own rows: a pushed
            # payload (an import token) must not rewrite a recurring cost,
            # which the API reserves for a project admin.
            if spec.apply is not None and transport == "pull":
                notices.extend(await spec.apply(db, tenant_id, vendor, batch))
            run.notices = [str(n)[:500] for n in notices[:50]]
    except Exception as exc:  # noqa: BLE001 — recorded on the run, never lost
        run.status = "failed"
        run.rows_upserted = 0
        run.reconcile_delta_micros = None
        run.error = f"storing the entries failed: {type(exc).__name__}"
        run.finished_at = _now()
        await db.flush()
        return IngestResult(run.id, "failed", 0, batch.items_seen, None, run.error)
    run.status = "ok"
    run.finished_at = _now()
    await db.flush()
    return IngestResult(
        run.id,
        "ok",
        run.rows_upserted,
        run.items_seen,
        run.reconcile_delta_micros,
    )


async def record_failed_fetch(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    vendor: Vendor,
    connector: str,
    source: str,
    error: str,
) -> UUID:
    """A server pull that never got a payload (the provider refused it, or
    the credential could not be read) is still a run — a ``failed`` one — so
    freshness reports the failure instead of going quiet. ``error`` must be
    value-free (a typed reason). Flushes, never commits."""
    now = _now()
    run = CostImportRun(
        tenant_id=tenant_id,
        vendor_id=vendor.id,
        connector=connector,
        source=source,
        transport="pull",
        granularity="day",
        status="failed",
        started_at=now,
        finished_at=now,
        error=error[:2000],
        created_by=source,
        updated_by=source,
    )
    db.add(run)
    await db.flush()
    return run.id


def _query_period(query: IngestQuery) -> tuple[date | None, date | None]:
    """The days a query asked about, or ``(None, None)`` when it names none."""
    try:
        if query.day is not None:
            day = date(query.year, query.month, query.day)
            return day, query.until or day
        last = calendar.monthrange(query.year, query.month)[1]
        return date(query.year, query.month, 1), date(query.year, query.month, last)
    except ValueError:
        return None, None


def _count_items(raw: Any) -> int:
    if isinstance(raw, dict):
        for value in raw.values():
            if isinstance(value, list):
                return len(value)
    if isinstance(raw, list):
        return len(raw)
    return 0


async def _upsert(
    db: AsyncSession,
    tenant_id: UUID,
    vendor_id: UUID,
    run_id: UUID,
    batch: NormalisedBatch,
    actor: str,
) -> int:
    refs = [e.source_ref for e in batch.entries]
    prefixes = [p for p in (batch.ref_prefix, *batch.extra_ref_prefixes) if p]
    for prefix in prefixes:
        # Each day's statement is whole: a line it no longer reports is gone.
        stale = delete(CostEntry).where(
            CostEntry.tenant_id == tenant_id,
            CostEntry.vendor_id == vendor_id,
            CostEntry.source == "connector",
            CostEntry.source_ref.startswith(prefix, autoescape=True),
        )
        if refs:
            stale = stale.where(CostEntry.source_ref.not_in(refs))
        await db.execute(stale)
    if not batch.entries:
        return 0
    values = [
        {
            "tenant_id": tenant_id,
            "vendor_id": vendor_id,
            "source": "connector",
            "source_ref": e.source_ref,
            "category": e.category,
            "description": e.description,
            "amount_micros": e.amount_micros,
            "currency": e.currency,
            "period_start": e.period_start,
            "period_end": e.period_end,
            "gross_micros": e.gross_micros,
            "discount_micros": e.discount_micros,
            "quantity": e.quantity,
            "unit": e.unit,
            "scope_label": e.scope_label,
            "sku": e.sku,
            "product": e.product,
            "import_run_id": run_id,
            "created_by": actor,
            "updated_by": actor,
        }
        for e in batch.entries
    ]
    for start in range(0, len(values), _INSERT_CHUNK):
        await _upsert_chunk(db, values[start : start + _INSERT_CHUNK])
    return len(values)


#: Rows per INSERT: 20 binds a row stays far under asyncpg's 32,767 limit.
_INSERT_CHUNK = 500


async def _upsert_chunk(db: AsyncSession, values: list[dict[str, Any]]) -> None:
    stmt = insert(CostEntry).values(values)
    updated: dict[str, Any] = {
        col: stmt.excluded[col]
        for col in (
            "category",
            "description",
            "amount_micros",
            "currency",
            "period_start",
            "period_end",
            "gross_micros",
            "discount_micros",
            "quantity",
            "unit",
            "scope_label",
            "sku",
            "product",
            "import_run_id",
            "updated_by",
        )
    }
    updated["updated_at"] = func.now()
    await db.execute(
        stmt.on_conflict_do_update(
            constraint="uq_overview_cost_entries_source_ref", set_=updated
        )
    )


async def _reconcile(
    db: AsyncSession, tenant_id: UUID, vendor_id: UUID, batch: NormalisedBatch
) -> int | None:
    if batch.month_net_micros is None:
        return None
    stmt = select(func.coalesce(func.sum(CostEntry.amount_micros), 0)).where(
        CostEntry.tenant_id == tenant_id,
        CostEntry.vendor_id == vendor_id,
        CostEntry.source == "connector",
        CostEntry.period_start >= batch.period_start,
        CostEntry.period_start <= batch.period_end,
    )
    if batch.ref_prefix:
        stmt = stmt.where(
            CostEntry.source_ref.startswith(batch.ref_prefix, autoescape=True)
        )
    stored = int((await db.execute(stmt)).scalar_one())
    return batch.month_net_micros - stored
