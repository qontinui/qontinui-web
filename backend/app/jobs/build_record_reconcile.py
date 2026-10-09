"""Retract public build records whose coord product is no longer public.

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(D3: nothing is public unless the tenant opts in; D7: unpublish is one step).

A product can be made private through coord's OWN door — its
``PUT /coord/build-record-products/{slug}`` or the MCP upsert — without ever
passing through qontinui-web, so web's ``PUT /products/{slug}`` retraction
alone cannot keep the public page honest. This module closes that gap three
ways, all sharing :func:`reconcile_tenant`:

1. **On a schedule** — :func:`reconcile_all`, registered as the
   ``build_record_reconcile`` task on the in-process scheduler
   (``app/core/scheduler.py`` :func:`install_default_tasks`; kill-switch
   ``QONTINUI_SCHEDULER_BUILD_RECORD_RECONCILE_ENABLED``). It authenticates to
   coord with a tenant-scoped SERVICE token minted from
   ``COORD_ADMIN_SECRET`` (the same ``POST /coord/auth/service-token`` door
   ``app/jobs/session_archiver.py`` uses). With no secret, or a coord that
   refuses the token, the cycle is UNKNOWN for that tenant and retracts
   nothing — an unanswered question is never read as "not public".
2. **On demand** — ``POST /api/v1/build-records/reconcile`` (tenant admin),
   with the caller's own bearer; for the launch kit and the operator notice.
3. **On every publish attempt** — the publish route retracts a live snapshot
   whose product it finds missing, private or owned by another tenant.

4. **Repo visibility** — each scheduled tick also re-asks GitHub (anonymously,
   ``app/services/github_repo_visibility.py``) whether the repos on live pages
   are still public, at most :data:`VISIBILITY_CHECKS_PER_TICK` calls per tick,
   oldest-checked first (cursor ``last_visibility_check_at``, revision
   ``brs_03_build_record_visibility_check``). NOT_PUBLIC retracts; UNKNOWN
   leaves the page live.

What retracts: every LIVE slug the tenant owns whose coord product row is
absent from the tenant's listing, has ``is_public`` other than ``true``, or
names a different tenant. Retraction only sets ``unpublished_at``; snapshots
are kept, and ``POST /{slug}/publish`` with ``reactivate`` undoes it.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.build_record import BuildRecordPublicSlug, BuildRecordSnapshot

logger = structlog.get_logger(__name__)

#: ``sub = service:<name>`` on the coord-minted token this job presents.
SERVICE_NAME = "qontinui-web-build-record-reconcile"
_TOKEN_REFRESH_BUFFER_S = 300

#: Wall-clock cap on one tenant's coord reconcile within a tick.
TENANT_TIMEOUT_SECONDS = 30.0

#: GitHub calls per tick for the visibility re-check. Anonymous reads are
#: capped at 60/hour per egress IP and the tick is every 10 minutes, so 8 per
#: tick (48/hour) leaves headroom for the publish route's own checks.
VISIBILITY_CHECKS_PER_TICK = 8


@dataclass
class _MintedToken:
    token: str
    exp: int


_token_cache: dict[UUID, _MintedToken] = {}


def public_slugs(products: list[Any], tenant_id: UUID) -> set[str]:
    """The slugs coord says are public AND belong to ``tenant_id``."""
    out: set[str] = set()
    for product in products:
        if (
            isinstance(product, dict)
            and product.get("is_public") is True
            and str(product.get("tenant_id")) == str(tenant_id)
            and isinstance(product.get("slug"), str)
        ):
            out.add(product["slug"])
    return out


async def retract_live(db: AsyncSession, slug: str, tenant_id: UUID) -> bool:
    """Retract ``slug`` if ``tenant_id`` owns it and it is live. No commit.

    Locks the owner row (re-read from the database, never the identity map).
    Returns whether this call retracted it.
    """
    owner = (
        await db.execute(
            select(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == slug)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if (
        owner is None
        or owner.tenant_id != tenant_id
        or owner.unpublished_at is not None
    ):
        return False
    owner.unpublished_at = datetime.now(UTC)
    return True


async def reconcile_tenant(
    db: AsyncSession, tenant_id: UUID, products: list[Any]
) -> list[str]:
    """Retract every live slug of ``tenant_id`` not public in ``products``.

    ``products`` must be coord's ANSWERED listing for the tenant; the caller
    never passes an empty list in place of an unanswered read. Commits.
    """
    keep = public_slugs(products, tenant_id)
    live = (
        (
            await db.execute(
                select(BuildRecordPublicSlug.public_slug).where(
                    BuildRecordPublicSlug.tenant_id == tenant_id,
                    BuildRecordPublicSlug.unpublished_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    retracted = [
        slug
        for slug in sorted(live)
        if slug not in keep and await retract_live(db, slug, tenant_id)
    ]
    await db.commit()
    if retracted:
        logger.info(
            "build_record_reconcile_retracted",
            tenant_id=str(tenant_id),
            slugs=retracted,
        )
    return retracted


async def _service_bearer(tenant_id: UUID) -> str | None:
    """A tenant-scoped coord service token, or ``None`` (cycle is UNKNOWN)."""
    cached = _token_cache.get(tenant_id)
    if cached is not None and cached.exp - int(time.time()) > _TOKEN_REFRESH_BUFFER_S:
        return cached.token

    from app.core.config import settings

    if not settings.COORD_ADMIN_SECRET:
        return None
    url = f"{settings.COORD_URL.rstrip('/')}/coord/auth/service-token"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            resp = await client.post(
                url,
                headers={"X-Coord-Admin-Secret": settings.COORD_ADMIN_SECRET},
                json={
                    "service_name": SERVICE_NAME,
                    "tenant_id": str(tenant_id),
                    "scopes": {},
                },
            )
        body = resp.json() if resp.status_code == 200 else None
        token = str(body["token"]) if isinstance(body, dict) else ""
        exp = int(body["exp"]) if isinstance(body, dict) else 0
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        logger.warning("build_record_reconcile_mint_failed", error=type(exc).__name__)
        return None
    if not token:
        logger.warning("build_record_reconcile_mint_refused")
        return None
    _token_cache[tenant_id] = _MintedToken(token=token, exp=exp)
    return token


async def _list_products(tenant_id: UUID) -> list[Any] | None:
    """coord's product listing for the tenant, or ``None`` when unanswered."""
    from fastapi import HTTPException

    from app.api.v1.endpoints.operations import _proxy_coord_get

    try:
        listing = await _proxy_coord_get(
            "/coord/build-record-products", tenant_id=tenant_id
        )
    except (HTTPException, httpx.HTTPError, ValueError) as exc:
        logger.warning(
            "build_record_reconcile_coord_unanswered",
            tenant_id=str(tenant_id),
            error=type(exc).__name__,
            status=getattr(exc, "status_code", None),
        )
        return None
    products = listing.get("products") if isinstance(listing, dict) else None
    return products if isinstance(products, list) else None


async def _reconcile_one_tenant(
    session_maker: async_sessionmaker[AsyncSession], tenant_id: UUID
) -> int | None:
    """Reconcile one tenant; the retraction count, or ``None`` if unanswered."""
    from app.api.v1.endpoints.operations import _caller_bearer

    bearer = await _service_bearer(tenant_id)
    if bearer is None:
        raise _Uncredentialed
    token = _caller_bearer.set(bearer)
    try:
        products = await _list_products(tenant_id)
    finally:
        _caller_bearer.reset(token)
    if products is None:
        return None
    async with session_maker() as session:
        return len(await reconcile_tenant(session, tenant_id, products))


class _Uncredentialed(Exception):
    """No coord service token for this tenant (``COORD_ADMIN_SECRET`` unset or
    the mint refused) — the tenant is UNKNOWN this tick."""


async def _latest_repos(db: AsyncSession, slug: str) -> list[str]:
    document = (
        await db.execute(
            select(BuildRecordSnapshot.document)
            .where(BuildRecordSnapshot.public_slug == slug)
            .order_by(BuildRecordSnapshot.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    product = document.get("product") if isinstance(document, dict) else None
    repos = product.get("repos") if isinstance(product, dict) else None
    return [r for r in repos if isinstance(r, str)] if isinstance(repos, list) else []


async def recheck_visibility(
    db: AsyncSession,
    *,
    budget: int = VISIBILITY_CHECKS_PER_TICK,
    tenant_id: UUID | None = None,
) -> list[str]:
    """Re-ask GitHub about the repos on live pages, oldest-checked first.

    Spends at most ``budget`` GitHub calls. A repo answered NOT_PUBLIC retracts
    its page; UNKNOWN (rate limit, outage) leaves it live — an unanswered
    question is not a "private". Every slug examined has its
    ``last_visibility_check_at`` advanced either way, so the cursor moves on
    and the tail is reached. Commits. ``tenant_id`` narrows to one tenant (the
    on-demand route).
    """
    from app.services.github_repo_visibility import Visibility, repo_visibility

    stmt = (
        select(BuildRecordPublicSlug)
        .where(BuildRecordPublicSlug.unpublished_at.is_(None))
        .order_by(
            BuildRecordPublicSlug.last_visibility_check_at.asc().nulls_first(),
            BuildRecordPublicSlug.public_slug,
        )
    )
    if tenant_id is not None:
        stmt = stmt.where(BuildRecordPublicSlug.tenant_id == tenant_id)
    owners = (await db.execute(stmt)).scalars().all()

    retracted: list[str] = []
    spent = 0
    for owner in owners:
        repos = await _latest_repos(db, owner.public_slug)
        if spent + len(repos) > budget and spent > 0:
            break
        spent += len(repos)
        answers = [await repo_visibility(repo) for repo in repos]
        owner.last_visibility_check_at = datetime.now(UTC)
        if any(a is Visibility.NOT_PUBLIC for a in answers) and await retract_live(
            db, owner.public_slug, owner.tenant_id
        ):
            retracted.append(owner.public_slug)
    await db.commit()
    if retracted:
        logger.info("build_record_visibility_retracted", slugs=retracted)
    return retracted


async def reconcile_all(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, Any]:
    """One scheduled cycle: every tenant owning a LIVE public slug, then a
    bounded GitHub visibility re-check.

    Tenants are visited in a fresh random order each tick, each under
    :data:`TENANT_TIMEOUT_SECONDS`, and any failure of one tenant is counted
    and logged without stopping the rest — so a slow or broken tenant can never
    starve the ones after it.
    """
    async with session_maker() as session:
        tenants = list(
            set(
                (
                    await session.execute(
                        select(BuildRecordPublicSlug.tenant_id).where(
                            BuildRecordPublicSlug.unpublished_at.is_(None)
                        )
                    )
                )
                .scalars()
                .all()
            )
        )
    random.shuffle(tenants)
    totals: dict[str, Any] = {
        "tenants": len(tenants),
        "retracted": 0,
        "uncredentialed_tenants": 0,
        "unanswered_tenants": 0,
        "visibility_retracted": 0,
    }
    for tenant_id in tenants:
        try:
            count = await asyncio.wait_for(
                _reconcile_one_tenant(session_maker, tenant_id),
                timeout=TENANT_TIMEOUT_SECONDS,
            )
        except _Uncredentialed:
            totals["uncredentialed_tenants"] += 1
            continue
        except Exception as exc:  # noqa: BLE001 - one tenant never stops the tick
            logger.warning(
                "build_record_reconcile_tenant_failed",
                tenant_id=str(tenant_id),
                error=type(exc).__name__,
            )
            count = None
        if count is None:
            totals["unanswered_tenants"] += 1
        else:
            totals["retracted"] += count

    try:
        async with session_maker() as session:
            totals["visibility_retracted"] = len(await recheck_visibility(session))
    except Exception as exc:  # noqa: BLE001 - the coord half already landed
        logger.warning(
            "build_record_visibility_recheck_failed", error=type(exc).__name__
        )
    logger.info("build_record_reconcile_completed", **totals)
    return totals
