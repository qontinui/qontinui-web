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
:data:`VISIBILITY_CALLS_PER_TICK_ANONYMOUS` (8) GitHub calls — 80 with the
operator token — counted in repos, stalest page first, resuming a wide slug
at its stored offset (revision ``brs_03_build_record_visibility_check``).
Real throughput is :func:`recheck_throughput_per_hour`: ~30 repos/hour
(~720/day) anonymous, 480/hour with the token. It stops the tick only on a
transport error or a rate-limit signal; any other unanswered repo gives up
that slug for the tick and moves it to the back; six blamed give-ups retract
it. NOT_PUBLIC retracts. A staleness sweep retracts a page with no complete
answer past 24 h (if attempted) or 72 h (if never reached), and the tick
warns when the live repos exceed what can be checked in 72 h.

Retraction only sets ``unpublished_at``; snapshots are kept, and
``POST /{slug}/publish`` with ``reactivate`` undoes it.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
import structlog
from sqlalchemy import func, select
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

#: Hard caps on GitHub calls per visibility tick (one per repo), by mode.
#: These are CAPS, not reservations. What protects publish is the persisted
#: budget (``app/services/github_rate_budget.py``): the re-check stops at
#: ``RECHECK_RESERVE`` remaining, publish refuses only at the lower
#: ``PUBLISH_RESERVE``.
VISIBILITY_CALLS_PER_TICK_ANONYMOUS = 8
VISIBILITY_CALLS_PER_TICK_TOKEN = 80
#: Ticks per hour at the task's ``5-59/10`` cadence.
TICKS_PER_HOUR = 6
#: GitHub's per-hour limits for the two modes.
GITHUB_LIMIT_ANONYMOUS = 60
GITHUB_LIMIT_TOKEN = 5000
#: Consecutive give-ups on an unanswerable repo before the page is retracted.
VISIBILITY_UNKNOWN_RETRACT_AFTER = 6
#: The staleness clock of a page is the later of its last complete answer
#: and its latest publish (a publish checks every repo itself). A page the
#: tick ATTEMPTED and could not answer is retracted once that clock is older
#: than this…
VISIBILITY_STALE_AFTER = timedelta(hours=24)
#: …and a page the tick never reached (budget, rate limit, a pause of the
#: task) only once it is older than this longer ceiling — so a pause or an
#: outage shorter than this never retracts a page GitHub would call public.
VISIBILITY_UNREACHED_STALE_AFTER = timedelta(hours=72)


def recheck_throughput_per_hour(*, token: bool) -> int:
    """Repos the re-check can actually check per hour in each mode.

    ``min(per-tick cap × ticks/hour, limit − RECHECK_RESERVE)``. Anonymous:
    ``min(8 × 6, 60 − 30)`` = **30/hour (~720/day, ~2,160 per 72 h)** — the
    re-check stops at 30 remaining of the 60/hour window. With
    ``GITHUB_VISIBILITY_TOKEN``: ``min(80 × 6, 5000 − 30)`` = **480/hour**.
    An upper bound: other anonymous GitHub reads from the same egress IP
    (publish, ``releases.py``, ``auth/identities.py``) lower it further.
    """
    from app.services.github_rate_budget import RECHECK_RESERVE

    if token:
        per_tick, limit = VISIBILITY_CALLS_PER_TICK_TOKEN, GITHUB_LIMIT_TOKEN
    else:
        per_tick, limit = VISIBILITY_CALLS_PER_TICK_ANONYMOUS, GITHUB_LIMIT_ANONYMOUS
    return min(per_tick * TICKS_PER_HOUR, limit - RECHECK_RESERVE)


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
    #: Slugs given up on AND blamed (another slug got a definite answer this
    #: tick, so GitHub was answering) — counted toward retraction.
    gave_up: list[str] = field(default_factory=list)
    #: Slugs given up on in a tick where NOTHING got a definite answer — a
    #: GitHub-wide outage is not the slugs' fault; moved back, not counted.
    unblamed: list[str] = field(default_factory=list)
    #: The operator token was rejected (401); the tick fell back to anonymous.
    credential_error: bool = False
    #: Retracted by the staleness sweep (also listed in ``retracted``).
    stale: list[str] = field(default_factory=list)
    #: Set when the live repos exceed what the re-check can check within
    #: :data:`VISIBILITY_UNREACHED_STALE_AFTER` at the current throughput:
    #: ``{"live_repos", "capacity", "mode"}``. Pages WILL start retracting.
    capacity_shortfall: dict[str, Any] | None = None
    #: Why the tick stopped early, or ``None`` when the budget or list ran out.
    stopped: str | None = None


def _latest_publish_subquery() -> Any:
    return (
        select(
            BuildRecordSnapshot.public_slug,
            func.max(BuildRecordSnapshot.published_at).label("published_at"),
        )
        .group_by(BuildRecordSnapshot.public_slug)
        .subquery()
    )


async def _retract_stale(
    db: AsyncSession, tick: VisibilityTick, attempted_unanswered: set[str]
) -> None:
    """The staleness sweep. Runs after the tick's checks; no commit.

    * A page the tick ATTEMPTED and got no complete answer for (given up, or
      the tick stopped on it) is retracted when its staleness clock is older
      than :data:`VISIBILITY_STALE_AFTER`.
    * Any other live page — including one the tick never reached — only when
      older than :data:`VISIBILITY_UNREACHED_STALE_AFTER`.
    * A page answered this tick has a fresh clock and is never stale.
    """
    now = datetime.now(UTC)
    latest = _latest_publish_subquery()
    rows = (
        await db.execute(
            select(BuildRecordPublicSlug, latest.c.published_at)
            .outerjoin(
                latest, latest.c.public_slug == BuildRecordPublicSlug.public_slug
            )
            .where(BuildRecordPublicSlug.unpublished_at.is_(None))
        )
    ).all()
    for owner, published_at in rows:
        moments = [m for m in (owner.last_visibility_check_at, published_at) if m]
        clock = max(moments) if moments else None
        ceiling = (
            VISIBILITY_STALE_AFTER
            if owner.public_slug in attempted_unanswered
            else VISIBILITY_UNREACHED_STALE_AFTER
        )
        if clock is not None and clock >= now - ceiling:
            continue
        if await retract_live(db, owner.public_slug, owner.tenant_id):
            tick.retracted.append(owner.public_slug)
            tick.stale.append(owner.public_slug)


async def _check_capacity(db: AsyncSession, tick: VisibilityTick, token: bool) -> None:
    """WARN (and record on the tick) when the live repos exceed what the
    re-check can check within the unreached ceiling at this throughput."""
    latest_repo_counts = (
        select(
            BuildRecordSnapshot.public_slug,
            func.coalesce(
                func.jsonb_array_length(
                    BuildRecordSnapshot.document["product"]["repos"]
                ),
                0,
            ).label("repos"),
        )
        .distinct(BuildRecordSnapshot.public_slug)
        .order_by(BuildRecordSnapshot.public_slug, BuildRecordSnapshot.version.desc())
        .subquery()
    )
    live_repos = (
        await db.execute(
            select(func.coalesce(func.sum(latest_repo_counts.c.repos), 0))
            .select_from(BuildRecordPublicSlug)
            .join(
                latest_repo_counts,
                latest_repo_counts.c.public_slug == BuildRecordPublicSlug.public_slug,
            )
            .where(BuildRecordPublicSlug.unpublished_at.is_(None))
        )
    ).scalar_one()
    hours = VISIBILITY_UNREACHED_STALE_AFTER.total_seconds() / 3600
    capacity = int(recheck_throughput_per_hour(token=token) * hours)
    if int(live_repos) > capacity:
        mode = "token" if token else "anonymous"
        tick.capacity_shortfall = {
            "live_repos": int(live_repos),
            "capacity": capacity,
            "mode": mode,
        }
        logger.warning(
            "build_record_visibility_capacity_short",
            live_repos=int(live_repos),
            capacity_per_72h=capacity,
            mode=mode,
            note=(
                "more live repos than the re-check can check within 72 h; "
                "pages it cannot reach will be retracted as stale. Set "
                "GITHUB_VISIBILITY_TOKEN (operator resource) to raise throughput."
                if not token
                else "more live repos than the re-check can check within 72 h "
                "even with the operator token; pages will be retracted as stale."
            ),
        )


def _mark_complete(
    owner: BuildRecordPublicSlug, now: datetime, tick: VisibilityTick
) -> None:
    owner.visibility_check_offset = 0
    owner.visibility_unknown_attempts = 0
    owner.last_visibility_attempt_at = now
    owner.last_visibility_check_at = now
    tick.completed.append(owner.public_slug)


async def recheck_visibility(
    db: AsyncSession,
    *,
    budget: int | None = None,
    reserve: int | None = None,
) -> VisibilityTick:
    """Re-ask GitHub about the repos on live pages, stalest first.

    * **Order**: by the later of the staleness clock (last complete answer,
      latest publish) and the last attempt, oldest first — the stalest page is
      checked first, and a page just given up on or cut off moves behind the
      others, so nothing can wedge the head of the queue.
    * **Budget** defaults to the mode's per-tick cap
      (:data:`VISIBILITY_CALLS_PER_TICK_TOKEN` with an operator token, else
      :data:`VISIBILITY_CALLS_PER_TICK_ANONYMOUS`).

    * **Hard cap**: at most ``budget`` GitHub calls, one per repo. A slug wider
      than what is left is checked as far as the budget reaches and resumed at
      its stored offset next tick — never skipped, never over budget.
    * **NOT_PUBLIC** (404, 451, a redirect for a moved repo, ``private``) →
      retract.
    * **Stops the whole tick** only on a transport error or a rate-limit signal
      (403/429, or remaining at/below ``reserve`` — default
      :data:`~app.services.github_rate_budget.RECHECK_RESERVE`, which keeps the
      band above the publish reserve free for publishes). Also refuses to start
      while the persisted budget is already at the reserve.
    * **Any other UNKNOWN** (a 5xx, an unparseable body) gives up THAT slug for
      this tick and moves it behind the others. It is BLAMED (counted) only
      when some other slug got a definite answer in the same tick; after
      :data:`VISIBILITY_UNKNOWN_RETRACT_AFTER` consecutive blamed give-ups the
      page is retracted. When nothing in the tick got a definite answer, it is
      GitHub that is down, the tick stops, and no slug is counted.
    * A tick-stopping answer still stamps that slug's attempt time, so no slug
      can hold the head of the queue.
    * **Staleness sweep** at the end (:func:`_retract_stale`): a page attempted
      this tick without a complete answer is retracted past 24 h; any other
      page only past 72 h. A pause or outage shorter than that retracts
      nothing GitHub would call public, and an unanswerable page never lives
      forever.
    * **Capacity**: when the live repos exceed what this mode can check in
      72 h, a WARNING is logged and ``capacity_shortfall`` is set.
    * A rejected operator token (401) is retried anonymously by
      ``check_repo`` and logged at ERROR here.
    * ``last_visibility_check_at`` advances only on a COMPLETE definite answer.

    Commits.
    """
    from app.services import github_rate_budget
    from app.services.github_repo_visibility import Visibility, _token, check_repo

    reserve = github_rate_budget.RECHECK_RESERVE if reserve is None else reserve
    token = _token() is not None
    if budget is None:
        budget = (
            VISIBILITY_CALLS_PER_TICK_TOKEN
            if token
            else VISIBILITY_CALLS_PER_TICK_ANONYMOUS
        )
    tick = VisibilityTick()
    await _check_capacity(db, tick, token)
    attempted_unanswered: set[str] = set()
    if await github_rate_budget.reserved(db, reserve):
        tick.stopped = "budget_reserved"
        await _retract_stale(db, tick, attempted_unanswered)
        await db.commit()
        return tick

    latest = _latest_publish_subquery()
    # GREATEST ignores NULLs in Postgres; all-NULL sorts first.
    queue_key = func.greatest(
        BuildRecordPublicSlug.last_visibility_check_at,
        latest.c.published_at,
        BuildRecordPublicSlug.last_visibility_attempt_at,
    )
    owners = (
        (
            await db.execute(
                select(BuildRecordPublicSlug)
                .outerjoin(
                    latest, latest.c.public_slug == BuildRecordPublicSlug.public_slug
                )
                .where(BuildRecordPublicSlug.unpublished_at.is_(None))
                .order_by(
                    queue_key.asc().nulls_first(), BuildRecordPublicSlug.public_slug
                )
            )
        )
        .scalars()
        .all()
    )
    answers = []
    definite = 0  # PUBLIC / NOT_PUBLIC answers this tick
    unanswered: list[BuildRecordPublicSlug] = []  # gave up on, blame decided below
    for owner in owners:
        if tick.calls >= budget or tick.stopped is not None:
            break
        slug, tenant_id = owner.public_slug, owner.tenant_id
        repos = await latest_repos(db, slug)
        offset = owner.visibility_check_offset
        if offset >= len(repos):
            offset = 0
        outcome = "pending"  # → complete | private | gave_up
        while offset < len(repos) and tick.calls < budget:
            answer = await check_repo(repos[offset])
            answers.append(answer)
            tick.calls += answer.http_requests
            tick.credential_error = tick.credential_error or answer.credential_error
            if answer.transport_error or answer.rate_limited:
                tick.stopped = "rate_limited" if answer.rate_limited else "transport"
                break
            if answer.visibility is Visibility.UNKNOWN:
                outcome = "gave_up"
                break
            definite += 1
            if answer.visibility is Visibility.NOT_PUBLIC:
                outcome = "private"
                break
            offset += 1
            remaining = answer.rate_limit_remaining
            if remaining is not None and remaining <= reserve:
                tick.stopped = "rate_limit_low"
                break
        if outcome == "pending" and offset >= len(repos):
            outcome = "complete"

        now = datetime.now(UTC)
        if outcome == "gave_up" or (
            outcome == "pending" and tick.stopped in ("rate_limited", "transport")
        ):
            attempted_unanswered.add(slug)
        if outcome == "gave_up":
            # Behind the others either way; whether it is BLAMED is decided
            # once the tick knows if GitHub answered anyone at all.
            owner.visibility_check_offset = offset
            owner.last_visibility_attempt_at = now
            unanswered.append(owner)
            if definite == 0 and len(unanswered) >= 2:
                # Nothing answered this tick: that is GitHub, not the slugs.
                tick.stopped = "github_unanswering"
        elif outcome == "private":
            if await retract_live(db, slug, tenant_id):
                tick.retracted.append(slug)
            _mark_complete(owner, now, tick)
        elif outcome == "complete":
            _mark_complete(owner, now, tick)
        else:  # pending: out of budget, or the tick stopped mid-slug
            owner.visibility_check_offset = offset  # resume here next time
            if tick.stopped is not None:
                # The tick-stopping answer is not this slug's fault, but it
                # must not let the slug hold the head of the queue either.
                owner.last_visibility_attempt_at = now

    if definite > 0:
        for owner in unanswered:
            owner.visibility_unknown_attempts += 1
            tick.gave_up.append(owner.public_slug)
            if owner.visibility_unknown_attempts >= VISIBILITY_UNKNOWN_RETRACT_AFTER:
                if await retract_live(db, owner.public_slug, owner.tenant_id):
                    tick.retracted.append(owner.public_slug)
                _mark_complete(owner, datetime.now(UTC), tick)
    else:
        tick.unblamed = [o.public_slug for o in unanswered]
    if tick.credential_error:
        logger.error(
            "build_record_visibility_token_dead",
            note="GITHUB_VISIBILITY_TOKEN rejected; this tick ran anonymously",
        )
    await github_rate_budget.record(db, answers)
    await _retract_stale(db, tick, attempted_unanswered)
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
        "gave_up": len(tick.gave_up),
        "unblamed": len(tick.unblamed),
        "stale": len(tick.stale),
        "capacity_shortfall": tick.capacity_shortfall,
        "credential_error": tick.credential_error,
        "stopped": tick.stopped,
    }
    logger.info("build_record_visibility_recheck_completed", **totals)
    return totals
