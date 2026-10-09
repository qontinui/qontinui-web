"""Retract public build records that are no longer allowed to be public.

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(D3: nothing is public unless the tenant opts in; D7: unpublish is one step).

Two independent questions, two scheduled tasks on the in-process scheduler
(``app/core/scheduler.py`` :func:`install_default_tasks`), each with its own
kill switch:

**Does coord still list the product public?** — task
``build_record_reconcile`` (:func:`reconcile_all`, kill switch
``QONTINUI_SCHEDULER_BUILD_RECORD_RECONCILE_ENABLED``). A product can be made
private, deleted, or narrowed to fewer repos through coord's OWN door — its
``PUT /coord/build-record-products/{slug}`` or the MCP upsert — which web never
sees. Per tenant owning a live slug, the job reads coord's listing with a
tenant-scoped SERVICE token minted from ``COORD_ADMIN_SECRET`` (the same
``POST /coord/auth/service-token`` door ``app/jobs/session_archiver.py``
uses) and runs :func:`reconcile_tenant`. Tenants are visited in a fresh
random order each tick, each under :data:`TENANT_TIMEOUT_SECONDS`, the whole
phase under :data:`TENANT_PHASE_DEADLINE_SECONDS` (well inside the
scheduler's 600 s task timeout); one tenant's failure is counted, never fatal.
An unanswered tenant retracts nothing — "unknown" is never read as "private".
The same :func:`reconcile_tenant` also runs on demand
(``POST /api/v1/build-records/reconcile``, the caller's own bearer) and, for
one slug, on every publish attempt.

**Does GitHub still say every repo on the page is public?** — task
``build_record_visibility_recheck`` (:func:`recheck_visibility_all`, kill
switch ``QONTINUI_SCHEDULER_BUILD_RECORD_VISIBILITY_RECHECK_ENABLED``),
scheduled only (never from the on-demand route: anonymous GitHub reads are
capped at 60/hour per egress IP, and a caller-triggered loop could spend the
publish route's share). Per tick it makes at most
:data:`VISIBILITY_CALLS_PER_TICK` GitHub calls, counted in repos and never
exceeded, oldest-checked slug first, resuming a wide slug at its stored offset
(revision ``brs_03_build_record_visibility_check``). It stops at the first
unanswered read or rate-limit signal. NOT_PUBLIC retracts; UNKNOWN leaves the
page live and the slug first in line.

Retraction only sets ``unpublished_at``; snapshots are kept, and
``POST /{slug}/publish`` with ``reactivate`` undoes it.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
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
#: Wall-clock cap on the whole tenant phase — well under the scheduler's
#: 600 s ``DEFAULT_TIMEOUT_SECONDS``, so the task ends on its own terms and
#: the tenants it did not reach are counted rather than lost to a cancel.
TENANT_PHASE_DEADLINE_SECONDS = 300.0

#: Hard cap on GitHub calls per visibility tick. The task runs every 10
#: minutes, so 8 per tick is at most 48/hour of the 60/hour anonymous limit,
#: leaving the rest for the publish route's own checks.
VISIBILITY_CALLS_PER_TICK = 8
#: Stop the tick once GitHub reports this few requests left in its window.
RATE_LIMIT_RESERVE = 10


@dataclass
class _MintedToken:
    token: str
    exp: int


_token_cache: dict[UUID, _MintedToken] = {}


def public_products(products: list[Any], tenant_id: UUID) -> dict[str, set[str]]:
    """``slug -> repos`` (lower-cased) for every product coord lists PUBLIC
    for ``tenant_id``."""
    out: dict[str, set[str]] = {}
    for product in products:
        if (
            isinstance(product, dict)
            and product.get("is_public") is True
            and str(product.get("tenant_id")) == str(tenant_id)
            and isinstance(product.get("slug"), str)
        ):
            repos = product.get("repos")
            out[product["slug"]] = (
                {r.lower() for r in repos if isinstance(r, str)}
                if isinstance(repos, list)
                else set()
            )
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


async def latest_repos(db: AsyncSession, slug: str) -> list[str]:
    """``product.repos`` of the slug's newest snapshot, sorted, de-duplicated."""
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
    if not isinstance(repos, list):
        return []
    return sorted({r.lower(): r for r in repos if isinstance(r, str)}.values())


async def repos_outside(db: AsyncSession, slug: str, allowed: set[str]) -> bool:
    """Whether the live snapshot names a repo the product no longer includes."""
    return any(r.lower() not in allowed for r in await latest_repos(db, slug))


async def reconcile_tenant(
    db: AsyncSession, tenant_id: UUID, products: list[Any]
) -> list[str]:
    """Retract every live slug of ``tenant_id`` that coord's listing no longer
    allows: absent, not public, another tenant's — or still public but its
    snapshot names a repo the product definition has since dropped.

    ``products`` must be coord's ANSWERED listing for the tenant; the caller
    never passes an empty list in place of an unanswered read. Commits.
    """
    keep = public_products(products, tenant_id)
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
    retracted: list[str] = []
    for slug in sorted(live):
        disallowed = slug not in keep or await repos_outside(db, slug, keep[slug])
        if disallowed and await retract_live(db, slug, tenant_id):
            retracted.append(slug)
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
    """coord's product listing for the tenant, or ``None`` when unanswered.

    Three failure shapes reach here, which is why three exception types are
    caught:

    * ``HTTPException`` — ``_proxy_coord_get`` turns a coord ≥400 into one, and
      a connect error / timeout into its subclass ``CoordTransportUnavailable``
      (502 / 504);
    * ``httpx.HTTPError`` — every OTHER transport fault (``ReadError``,
      ``RemoteProtocolError``, a cut connection mid-response) propagates from
      ``client.get`` unconverted;
    * ``ValueError`` — a 2xx whose body is not JSON makes ``resp.json()``
      raise ``json.JSONDecodeError``, a ``ValueError``.
    """
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


class _Uncredentialed(Exception):
    """No coord service token for this tenant (``COORD_ADMIN_SECRET`` unset or
    the mint refused) — the tenant is UNKNOWN this tick."""


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


async def reconcile_all(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, Any]:
    """One ``build_record_reconcile`` tick over every tenant owning a LIVE slug."""
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
        "deferred_tenants": 0,
    }
    deadline = time.monotonic() + TENANT_PHASE_DEADLINE_SECONDS
    for tenant_id in tenants:
        left = deadline - time.monotonic()
        if left <= 0:
            totals["deferred_tenants"] += 1
            continue
        try:
            count = await asyncio.wait_for(
                _reconcile_one_tenant(session_maker, tenant_id),
                timeout=min(TENANT_TIMEOUT_SECONDS, left),
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
    logger.info("build_record_reconcile_completed", **totals)
    return totals


@dataclass
class VisibilityTick:
    """What one visibility re-check tick did."""

    calls: int = 0
    retracted: list[str] = field(default_factory=list)
    completed: list[str] = field(default_factory=list)
    #: Why the tick stopped early, or ``None`` when the budget or list ran out.
    stopped: str | None = None


async def recheck_visibility(
    db: AsyncSession,
    *,
    budget: int = VISIBILITY_CALLS_PER_TICK,
    reserve: int = RATE_LIMIT_RESERVE,
) -> VisibilityTick:
    """Re-ask GitHub about the repos on live pages, oldest-checked first.

    * **Hard cap**: at most ``budget`` GitHub calls, one per repo. A slug wider
      than what is left is checked as far as the budget reaches and resumed at
      its stored offset next tick — never skipped, never over budget.
    * ``last_visibility_check_at`` advances ONLY when every repo of the slug
      got a definite answer (or one answered NOT_PUBLIC and the page was
      retracted); a cut-short slug stays first in line.
    * **Stops** at the first UNKNOWN (outage, rate limit — a 403/429 is
      reported as one) and when GitHub reports ``reserve`` or fewer requests
      left in its window.

    Commits.
    """
    from app.services.github_repo_visibility import Visibility, check_repo

    owners = (
        (
            await db.execute(
                select(BuildRecordPublicSlug)
                .where(BuildRecordPublicSlug.unpublished_at.is_(None))
                .order_by(
                    BuildRecordPublicSlug.last_visibility_check_at.asc().nulls_first(),
                    BuildRecordPublicSlug.public_slug,
                )
            )
        )
        .scalars()
        .all()
    )
    tick = VisibilityTick()
    for owner in owners:
        if tick.calls >= budget or tick.stopped is not None:
            break
        slug, tenant_id = owner.public_slug, owner.tenant_id
        repos = await latest_repos(db, slug)
        offset = owner.visibility_check_offset
        if offset >= len(repos):
            offset = 0
        went_private = False
        while offset < len(repos) and tick.calls < budget:
            answer = await check_repo(repos[offset])
            tick.calls += 1
            if answer.visibility is Visibility.UNKNOWN:
                tick.stopped = "rate_limited" if answer.rate_limited else "unanswered"
                break
            if answer.visibility is Visibility.NOT_PUBLIC:
                went_private = True
                break
            offset += 1
            remaining = answer.rate_limit_remaining
            if remaining is not None and remaining <= reserve:
                tick.stopped = "rate_limit_low"
                break
        if went_private:
            if await retract_live(db, slug, tenant_id):
                tick.retracted.append(slug)
            offset = len(repos)  # a definite answer ends the pass
        if offset >= len(repos):
            owner.visibility_check_offset = 0
            owner.last_visibility_check_at = datetime.now(UTC)
            tick.completed.append(slug)
        else:
            owner.visibility_check_offset = offset
    await db.commit()
    if tick.retracted:
        logger.info("build_record_visibility_retracted", slugs=tick.retracted)
    return tick


async def recheck_visibility_all(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, Any]:
    """One ``build_record_visibility_recheck`` tick."""
    async with session_maker() as session:
        tick = await recheck_visibility(session)
    totals = {
        "github_calls": tick.calls,
        "retracted": len(tick.retracted),
        "completed": len(tick.completed),
        "stopped": tick.stopped,
    }
    logger.info("build_record_visibility_recheck_completed", **totals)
    return totals
