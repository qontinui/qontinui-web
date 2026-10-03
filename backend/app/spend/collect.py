"""``spend_collect`` — the server pull (plan Phase 7, transport (b)).

Hourly with ``run_at_boot`` (this backend redeploys more often than daily, so
a daily slot can be skipped forever). For every vendor whose connector has a
``fetch`` AND a linked credential — or, for ``aws_cost_explorer``, the pinned
tenant's task-role arm — it pulls through the SAME normaliser the ingest door
uses (:func:`app.spend.ingest.ingest_payload`) and records the run with
``transport=pull``. Idempotent: entries upsert on their ``source_ref``.

* Each connector declares ``min_pull_interval_hours`` (AWS 12, so Cost
  Explorer's $0.01 requests stay at two a day). A failed pull counts too, so a
  refusing provider is not hammered.
* A pull the provider refuses still writes a ``failed`` run carrying the typed
  reason, so freshness reports it rather than going quiet.
* A vendor with no linked credential is skipped — the page shows it "not
  linked". So is every vendor while the vault itself cannot answer (no run is
  written: that says nothing about the provider's data, and a pull-only vendor
  goes stale by itself). Nothing here ever logs or stores a credential value.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import CostImportRun, Vendor
from app.spend import credentials
from app.spend.connectors import CONNECTORS, CredentialRejected, FetchContext
from app.spend.ingest import ingest_payload, record_failed_fetch

logger = structlog.get_logger(__name__)

SOURCE = "pull:server"


def _now() -> datetime:
    return datetime.now(UTC)


def pullable_connectors() -> list[str]:
    return sorted(key for key, spec in CONNECTORS.items() if spec.fetch is not None)


async def collect_vendor(db: AsyncSession, vendor: Vendor, now: datetime) -> str:
    """Pull one vendor if it is due. Returns what happened (``ok``,
    ``failed:<reason>``, ``partial``, or ``skipped:<why>``). Commits."""
    spec = CONNECTORS.get(vendor.connector or "")
    if spec is None or spec.fetch is None:
        return "skipped:not_pullable"
    try:
        resolved = await credentials.resolve(vendor.tenant_id, spec.key)
    except credentials.StoreUnavailable as exc:
        # The VAULT could not answer — nothing about the provider's data. No
        # run is written: a vendor the fleet importer also pushes (GitHub)
        # must not read "failed" because this backend cannot reach Secrets
        # Manager. A pull-only vendor goes stale on its own, which is honest.
        logger.warning(
            "spend_collect_vault_unavailable", connector=spec.key, reason=exc.reason
        )
        return f"skipped:vault_{exc.reason}"
    if resolved is None:
        return "skipped:not_linked"
    credential, arm = resolved

    last_pull = await db.scalar(
        select(func.max(CostImportRun.started_at)).where(
            CostImportRun.tenant_id == vendor.tenant_id,
            CostImportRun.vendor_id == vendor.id,
            CostImportRun.transport == "pull",
        )
    )
    if last_pull is not None and last_pull > now - timedelta(
        hours=spec.min_pull_interval_hours
    ):
        return "skipped:interval"
    last_pulled_day = await db.scalar(
        select(func.max(CostImportRun.period_end)).where(
            CostImportRun.tenant_id == vendor.tenant_id,
            CostImportRun.vendor_id == vendor.id,
            CostImportRun.transport == "pull",
            CostImportRun.status == "ok",
            CostImportRun.granularity != "month",
        )
    )
    ctx = FetchContext(
        tenant_id=vendor.tenant_id,
        credential=credential,
        config=dict(vendor.connector_config or {}),
        now=now,
        last_pulled_day=last_pulled_day,
        arm=arm,
    )
    try:
        pulls = await spec.fetch(ctx)
    except CredentialRejected as exc:
        reason = exc.reason
        error = f"pull refused: {exc.reason}" + (
            f" — {exc.detail}" if exc.detail else ""
        )
    except Exception as exc:  # noqa: BLE001 — a connector bug is a failed run
        reason = "connector_error"
        error = f"pull failed: {type(exc).__name__}"
        # No exc_info: a traceback can carry a request line, and with it a value.
        logger.warning(
            "spend_pull_crashed", connector=spec.key, error_type=type(exc).__name__
        )
    else:
        statuses: list[str] = []
        for pull in pulls:
            result = await ingest_payload(
                db,
                tenant_id=vendor.tenant_id,
                vendor=vendor,
                connector=spec.key,
                query=pull.query,
                raw=pull.raw,
                source=SOURCE,
                transport="pull",
            )
            statuses.append(result.status)
        await db.commit()
        if not statuses:
            return "skipped:nothing_published"
        if all(s == "ok" for s in statuses):
            return "ok"
        return "partial" if "ok" in statuses else "failed:rejected"
    await record_failed_fetch(
        db,
        tenant_id=vendor.tenant_id,
        vendor=vendor,
        connector=spec.key,
        source=SOURCE,
        error=error,
    )
    await db.commit()
    return f"failed:{reason}"


async def collect_all_tenants(
    *, session_factory: Any = None, now: datetime | None = None, evaluate: bool = True
) -> dict[str, Any]:
    """The ``spend_collect`` scheduler core."""
    if session_factory is None:
        from app.db.session import AsyncSessionLocal

        session_factory = AsyncSessionLocal
    when = now or _now()
    async with session_factory() as db:
        targets = [
            (row.id, row.tenant_id)
            for row in (
                await db.execute(
                    select(Vendor.id, Vendor.tenant_id).where(
                        Vendor.connector.in_(pullable_connectors())
                    )
                )
            ).all()
        ]
    outcomes: Counter[str] = Counter()
    pulled: set[UUID] = set()
    for vendor_id, tenant_id in targets:
        try:
            async with session_factory() as db:
                vendor = await db.get(Vendor, vendor_id)
                if vendor is None:
                    continue
                outcome = await collect_vendor(db, vendor, when)
        except Exception as exc:  # noqa: BLE001 — one vendor must not stop the rest
            outcome = "failed:collector_error"
            logger.warning(
                "spend_collect_vendor_failed",
                vendor_id=str(vendor_id),
                error_type=type(exc).__name__,
            )
        outcomes[outcome.split(":", 1)[0]] += 1
        if outcome in ("ok", "partial"):
            pulled.add(tenant_id)
    if evaluate:
        from app.spend.evaluate import evaluate_and_deliver_tenant

        for tenant_id in pulled:
            try:
                await evaluate_and_deliver_tenant(tenant_id)
            except Exception:  # noqa: BLE001 — the hourly evaluate retries
                logger.warning(
                    "spend_collect_evaluate_failed", tenant_id=str(tenant_id)
                )
    return {"vendors": len(targets), **dict(outcomes)}
