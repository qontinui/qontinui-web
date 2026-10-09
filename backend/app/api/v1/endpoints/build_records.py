"""Build records — the authed export proxy, publish and unpublish.

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(D1–D3, D7). A *build record* is a redacted, read-only JSON document composed
by coord from the twin (work-unit history, PR citations, merge events, lands,
gates) for one tenant-defined *product* — a named set of repos plus a window.

Routes (mounted at ``/api/v1/build-records``):

* ``GET  /products``           → coord ``GET /coord/build-record-products``
* ``PUT  /products/{slug}``    → coord ``PUT /coord/build-record-products/{slug}``;
  setting ``is_public: false`` also retracts this tenant's published snapshot
  in the same request (before coord is called, so a coord failure leaves the
  page retracted rather than live).
* ``GET  /{slug}``             → coord ``GET /coord/build-records/{slug}``
* ``POST /{slug}/publish``     → fetch the document from coord, refuse unless
  the product is public and is coord's row for THIS tenant, RE-VALIDATE the D3
  allowlist here, and freeze it as the next version in
  ``web.build_record_snapshots``. A retracted slug is re-activated only with
  ``{"reactivate": true}``.
* ``DELETE /{slug}/publish``   → the D7 one-step unpublish: retract the public
  address so the public reader 404s at once, keeping every snapshot as history.
* ``POST /reconcile``          → retract every live record whose coord product
  is no longer public (also run by the scheduler; see
  ``app/jobs/build_record_reconcile.py``).

The proxies follow ``digital_twin.py``'s shape: the caller's bearer and the
Project-selector header are forwarded (``get_tenant_id`` /
``capture_caller_bearer``), so coord authorizes and scopes on the caller's own
identity and the frontend covers this prefix in ``ACTIVE_TENANT_URL_PREFIXES``.
The writes (PUT, publish, unpublish) require tenant admin.

The unauthenticated reader is NOT here: ``public.py`` serves frozen snapshots
only and never proxies to coord, so the authed export is never reachable
anonymously.

``products`` is reserved as a slug on the PUT proxy: ``GET /products`` is the
listing, so a product named ``products`` could be defined but its record
could never be read through ``GET /{slug}``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, NoReturn
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.v1.endpoints.operations import (
    _proxy_coord_get,
    _proxy_coord_put,
    get_tenant_id,
    require_coord_tenant_admin_target,
)
from app.jobs.build_record_reconcile import (
    reconcile_tenant,
    repos_outside,
    retract_live,
)
from app.models.build_record import (
    BUILD_RECORD_SLUG_PATTERN,
    BuildRecordPublicSlug,
    BuildRecordSnapshot,
)
from app.services import github_rate_budget
from app.services.build_record_allowlist import (
    REPO_RE,
    build_record_violations,
    names_token,
    scanned_strings,
)
from app.services.github_repo_visibility import (
    Visibility,
    VisibilityAnswer,
    check_repo,
)

logger = structlog.get_logger(__name__)

router = APIRouter()

#: Slugs the PUT proxy refuses because a static route already owns the path.
RESERVED_SLUGS: frozenset[str] = frozenset({"products"})

#: How old (and how far in the future) coord's ``generated_at`` may be at
#: publish. A document composed earlier than this is not the record "now".
GENERATED_AT_MAX_AGE = timedelta(minutes=15)
GENERATED_AT_MAX_SKEW = timedelta(minutes=5)

#: Concurrent anonymous GitHub reads per publish.
GITHUB_CONCURRENCY = 4
#: Most repos one publish will ask GitHub about; a larger product is refused
#: rather than allowed to drain the shared rate budget in one request.
MAX_REPOS_PER_PUBLISH = 50

#: A product slug in a path: the coord contract's domain, checked before any
#: value is interpolated into a coord URL.
SlugPath = Annotated[str, Path(pattern=BUILD_RECORD_SLUG_PATTERN)]


class BuildRecordProductWrite(BaseModel):
    """Body of ``PUT /products/{slug}`` — the coord contract's product fields."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1, max_length=200)
    repos: list[str] = Field(default_factory=list, max_length=200)
    window_start: datetime | None = None
    window_end: datetime | None = None
    is_public: bool = False

    @model_validator(mode="after")
    def _check(self) -> BuildRecordProductWrite:
        bad = [r for r in self.repos if not REPO_RE.fullmatch(r)]
        if bad:
            raise ValueError(f"repos must be 'owner/name'; invalid: {bad}")
        if (
            self.window_start is not None
            and self.window_end is not None
            and self.window_end < self.window_start
        ):
            raise ValueError("window_end must not precede window_start")
        return self


class BuildRecordPublishRequest(BaseModel):
    """Optional body of ``POST /{slug}/publish``."""

    model_config = ConfigDict(extra="forbid")

    #: Required to publish a slug its owner retracted: a retraction is never
    #: undone by an ordinary (e.g. scripted) publish.
    reactivate: bool = False


class BuildRecordUnpublishResult(BaseModel):
    """What ``DELETE /{slug}/publish`` returns."""

    public_slug: str
    unpublished_at: datetime
    #: The newest kept snapshot — what a later publish's version follows.
    latest_version: int | None


class BuildRecordPublishResult(BaseModel):
    """What ``POST /{slug}/publish`` returns."""

    public_slug: str
    version: int
    content_sha256: str


def canonical_sha256(document: dict[str, Any]) -> str:
    """SHA-256 of the document's canonical JSON form.

    Keys sorted, no insignificant whitespace, UTF-8. JSONB does not preserve
    key order, so this is the only form a reader can recompute from what the
    public route serves.
    """
    canonical = json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _refuse(status_code: int, error: str, slug: str, **extra: Any) -> NoReturn:
    raise HTTPException(
        status_code=status_code, detail={"error": error, "slug": slug, **extra}
    )


async def _read_owner(
    db: AsyncSession, slug: str, *, lock: bool
) -> BuildRecordPublicSlug | None:
    """The slug's ownership row, re-read from the database (never the identity
    map, which would hide a concurrent retraction), optionally ``FOR UPDATE``."""
    stmt = (
        select(BuildRecordPublicSlug)
        .where(BuildRecordPublicSlug.public_slug == slug)
        .execution_options(populate_existing=True)
    )
    if lock:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalar_one_or_none()


async def _latest_snapshot(db: AsyncSession, slug: str) -> BuildRecordSnapshot | None:
    return (
        await db.execute(
            select(BuildRecordSnapshot)
            .where(BuildRecordSnapshot.public_slug == slug)
            .order_by(BuildRecordSnapshot.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


@router.get("/products")
async def list_build_record_products(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """The tenant's product definitions (``{products: [...]}``), from coord."""
    return await _proxy_coord_get(
        "/coord/build-record-products", tenant_id=tenant_id, structured_errors=True
    )


@router.put("/products/{slug}")
async def put_build_record_product(
    body: BuildRecordProductWrite,
    slug: SlugPath,
    response: Response,
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """Create or replace one product definition. Tenant admins only: this is
    the switch that makes a product publishable (``is_public``).

    ``is_public: false`` — or a ``repos`` list that no longer covers every repo
    the live snapshot names — retracts this tenant's live public snapshot of
    the slug FIRST and commits, then calls coord — so whatever coord answers, the
    page is not left public under a product that was just made private. The
    ``X-Build-Record-Retracted`` header says whether this request retracted.
    """
    if slug in RESERVED_SLUGS:
        _refuse(422, "build_record_slug_reserved", slug)

    # Retract BEFORE asking coord (fail-closed: whatever coord answers, the
    # page is not left public under a definition that no longer allows it):
    # the product made private, or narrowed so the live snapshot names a repo
    # the definition no longer includes.
    retracted = False
    if not body.is_public or await repos_outside(
        db, slug, {r.lower() for r in body.repos}
    ):
        retracted = await retract_live(db, slug, tenant_id)
    await db.commit()
    retracted_header = {"X-Build-Record-Retracted": "true" if retracted else "false"}
    response.headers.update(retracted_header)

    try:
        row = await _proxy_coord_put(
            f"/coord/build-record-products/{slug}",
            body.model_dump(mode="json"),
            tenant_id=tenant_id,
            structured_errors=True,
        )
    except HTTPException as exc:
        # The retraction above is already committed; say so on the error too.
        exc.headers = {**(exc.headers or {}), **retracted_header}
        raise

    # coord's stored row is the authority on the repo set (it may normalise
    # what it was sent); re-check against it.
    stored = row.get("repos") if isinstance(row, dict) else None
    if (
        not retracted
        and isinstance(stored, list)
        and await repos_outside(
            db, slug, {r.lower() for r in stored if isinstance(r, str)}
        )
    ):
        retracted = await retract_live(db, slug, tenant_id)
        await db.commit()
    if retracted:
        logger.info("build_record_retracted_by_product_put", slug=slug)
    response.headers["X-Build-Record-Retracted"] = "true" if retracted else "false"
    return row


@router.get("/{slug}")
async def get_build_record(
    slug: SlugPath,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """The live ``build-record/1`` document for one product, from coord.

    coord's 404 ``{"error": "build_record_product_not_found"}`` passes through
    as a structured detail.
    """
    return await _proxy_coord_get(
        f"/coord/build-records/{slug}", tenant_id=tenant_id, structured_errors=True
    )


async def _find_product(slug: str, tenant_id: UUID) -> dict[str, Any] | None:
    listing = await _proxy_coord_get(
        "/coord/build-record-products", tenant_id=tenant_id, structured_errors=True
    )
    products = listing.get("products") if isinstance(listing, dict) else None
    if not isinstance(products, list):
        _refuse(502, "coord_build_record_products_malformed", slug)
    for product in products:
        if isinstance(product, dict) and product.get("slug") == slug:
            return product
    return None


def _document_violations(
    document: Any, slug: str, product: dict[str, Any]
) -> list[str]:
    """The D3 allowlist, plus the two checks that need the product definition."""
    violations = build_record_violations(document)
    if violations:
        return violations
    doc_product = document.get("product") or {}
    if doc_product.get("slug") != slug:
        violations.append("product.slug: does not match the product published")
    defined = product.get("repos")
    defined_repos = (
        {r.lower() for r in defined if isinstance(r, str)}
        if isinstance(defined, list)
        else set()
    )
    for index, repo in enumerate(doc_product.get("repos") or []):
        if repo.lower() not in defined_repos:
            violations.append(
                f"product.repos[{index}]: not in the product definition's repos"
            )
    if "generated_at" not in document:
        violations.append("generated_at: required to publish")

    # Repos the product defines but coord left out of the document are the
    # ones it could NOT establish as public — their names must not leak
    # through a title or a slug either. Token-bounded, case-insensitive,
    # after the same normalisation as the allowlist scan; the slot is
    # reported, never the name.
    in_document = {r.lower() for r in doc_product.get("repos") or []}
    excluded_names = {
        repo.split("/", 1)[1]
        for repo in defined_repos - in_document
        if "/" in repo and repo.split("/", 1)[1]
    }
    for where, text in scanned_strings(document):
        if any(names_token(text, name) for name in excluded_names):
            violations.append(f"{where}: names a repo excluded as not known public")
    return violations


def _product_refusal(
    product: dict[str, Any] | None, tenant_id: UUID
) -> tuple[int, str] | None:
    """Why coord's product row does not allow a public page, or ``None``."""
    if product is None:
        return 404, "build_record_product_not_found"
    if str(product.get("tenant_id")) != str(tenant_id):
        return 409, "build_record_tenant_mismatch"
    if product.get("is_public") is not True:
        return 409, "build_record_product_not_public"
    return None


async def _confirm_repos_public(db: AsyncSession, slug: str, repos: list[str]) -> None:
    """Refuse unless GitHub says every repo is public.

    Refuses BEFORE asking when the product has more than
    :data:`MAX_REPOS_PER_PUBLISH` repos, or while the persisted GitHub budget
    is at or below ``github_rate_budget.PUBLISH_RESERVE``. Asks at most
    :data:`GITHUB_CONCURRENCY` at a time and records the rate-limit reading
    GitHub returns (commits it).
    """
    unique = sorted({r.lower(): r for r in repos}.values())
    if len(unique) > MAX_REPOS_PER_PUBLISH:
        _refuse(409, "build_record_too_many_repos", slug, limit=MAX_REPOS_PER_PUBLISH)
    if await github_rate_budget.reserved(db, github_rate_budget.PUBLISH_RESERVE):
        _refuse(502, "build_record_repo_visibility_budget_reserved", slug)
    gate = asyncio.Semaphore(GITHUB_CONCURRENCY)

    async def ask(repo: str) -> VisibilityAnswer:
        async with gate:
            return await check_repo(repo)

    answers = await asyncio.gather(*(ask(r) for r in unique))
    await github_rate_budget.record(db, answers)
    await db.commit()
    verdicts = [a.visibility for a in answers]
    if any(v is Visibility.NOT_PUBLIC for v in verdicts):
        _refuse(502, "build_record_repo_not_public", slug)
    if any(v is not Visibility.PUBLIC for v in verdicts):
        _refuse(502, "build_record_repo_visibility_unknown", slug)


async def _store_next_version(
    db: AsyncSession,
    *,
    slug: str,
    tenant_id: UUID,
    document: dict[str, Any],
    generated_at: datetime,
    expected_unpublished_at: datetime | None,
    reactivate: bool,
) -> BuildRecordSnapshot:
    """Claim the slug if unclaimed, then append the next version under its lock.

    The owner row is the serialization point: ``SELECT … FOR UPDATE`` on it
    orders concurrent publishes and unpublishes of one slug, so a version is
    never handed out twice (``uq_build_record_snapshots_slug_version`` backs
    that up) and a retraction that committed while coord was being asked is
    seen here and wins. Every refusal raises before anything is written; the
    request's session rolls back on the raise and drops the lock.
    """
    await db.execute(
        pg_insert(BuildRecordPublicSlug)
        .values(public_slug=slug, tenant_id=tenant_id)
        .on_conflict_do_nothing(index_elements=["public_slug"])
    )
    owner = await _read_owner(db, slug, lock=True)
    assert owner is not None  # claimed above, and owner rows are never deleted here
    if owner.tenant_id != tenant_id:
        _refuse(409, "public_slug_owned_by_another_tenant", slug)
    if owner.unpublished_at != expected_unpublished_at:
        _refuse(409, "build_record_retraction_changed", slug)
    if owner.unpublished_at is not None:
        if not reactivate:
            _refuse(409, "build_record_retracted", slug)
        owner.unpublished_at = None

    latest = await _latest_snapshot(db, slug)
    if latest is not None and generated_at < latest.generated_at:
        _refuse(409, "build_record_stale", slug, latest_version=latest.version)

    snapshot = BuildRecordSnapshot(
        tenant_id=tenant_id,
        public_slug=slug,
        version=(latest.version if latest is not None else 0) + 1,
        document=document,
        content_sha256=canonical_sha256(document),
        generated_at=generated_at,
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)
    return snapshot


@router.post(
    "/{slug}/publish",
    status_code=201,
    response_model=BuildRecordPublishResult,
)
async def publish_build_record(
    slug: SlugPath,
    request_body: Annotated[BuildRecordPublishRequest | None, Body()] = None,
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    db: AsyncSession = Depends(get_async_db),
) -> BuildRecordPublishResult:
    """Freeze the product's current build record as its next public version.

    Refuses (nothing stored) when:

    * another tenant already owns this public slug → 409
      ``public_slug_owned_by_another_tenant``;
    * the slug is retracted and the body does not say ``reactivate: true`` →
      409 ``build_record_retracted``;
    * the product does not exist in the caller's tenant → 404;
    * coord's product row names a different tenant → 409
      ``build_record_tenant_mismatch``;
    * the product's ``is_public`` is not ``true`` → 409 (D3: nothing is public
      by default);

    — and in those three cases a LIVE snapshot this tenant owns is retracted
    on the spot (``retracted`` in the refusal says whether it was);

    * coord's document fails the D3 allowlist, names another product, or lists
      a repo outside the product definition → 502 (coord sent something it
      must not; the violations are listed);
    * coord's ``generated_at`` is outside [now − 15 min, now + 5 min] → 502
      ``build_record_generated_at_out_of_window``;
    * GitHub, asked anonymously, does not confirm a listed repo is public →
      502 ``build_record_repo_not_public`` (it said private / absent) or
      ``build_record_repo_visibility_unknown`` (no answer, rate limit, error);
      refused without asking when the product has more than 50 repos (409
      ``build_record_too_many_repos``) or the shared GitHub budget is at its
      publish reserve (502 ``build_record_repo_visibility_budget_reserved``);
    * the slug was retracted or re-activated while coord was being asked → 409
      ``build_record_retraction_changed``;
    * the document is older than the latest snapshot → 409
      ``build_record_stale``.

    After storing, the product is read from coord once more; if it went
    private (or the read fails) in the meantime, the new version is retracted
    at once and the answer is 409 ``build_record_product_not_public`` /
    502 ``build_record_post_publish_check_unanswered`` with ``retracted``.
    """
    reactivate = request_body.reactivate if request_body is not None else False

    # Read the slug's state BEFORE asking coord: a retraction that lands while
    # coord is composing the document must not be overwritten by it.
    before = await _read_owner(db, slug, lock=False)
    expected_unpublished_at = before.unpublished_at if before is not None else None
    if before is not None and before.tenant_id != tenant_id:
        _refuse(409, "public_slug_owned_by_another_tenant", slug)
    if expected_unpublished_at is not None and not reactivate:
        _refuse(409, "build_record_retracted", slug)
    # End the read transaction: nothing may stay open across the coord calls.
    await db.commit()

    product = await _find_product(slug, tenant_id)
    refusal = _product_refusal(product, tenant_id)
    if refusal is not None:
        # Retract-on-attempt: a product that is gone, private or not ours must
        # not keep a live page just because nobody unpublished it.
        retracted = await retract_live(db, slug, tenant_id)
        await db.commit()
        _refuse(refusal[0], refusal[1], slug, retracted=retracted)
    assert product is not None

    document = await _proxy_coord_get(
        f"/coord/build-records/{slug}", tenant_id=tenant_id, structured_errors=True
    )
    violations = _document_violations(document, slug, product)
    if violations:
        logger.warning(
            "build_record_publish_refused_allowlist",
            slug=slug,
            violation_count=len(violations),
        )
        _refuse(502, "build_record_allowlist_violation", slug, violations=violations)

    generated_at = datetime.fromisoformat(document["generated_at"])
    now = datetime.now(UTC)
    if not (now - GENERATED_AT_MAX_AGE <= generated_at <= now + GENERATED_AT_MAX_SKEW):
        _refuse(502, "build_record_generated_at_out_of_window", slug)

    await _confirm_repos_public(db, slug, document["product"].get("repos") or [])

    snapshot = await _store_next_version(
        db,
        slug=slug,
        tenant_id=tenant_id,
        document=document,
        generated_at=generated_at,
        expected_unpublished_at=expected_unpublished_at,
        reactivate=reactivate,
    )

    # Close the window between the is_public check above and the store: a PUT
    # (here or through coord's own door) may have made the product private
    # meanwhile. A failed re-read is not a "still public".
    try:
        after = await _find_product(slug, tenant_id)
    except (HTTPException, httpx.HTTPError, ValueError):
        await retract_live(db, slug, tenant_id)
        await db.commit()
        _refuse(502, "build_record_post_publish_check_unanswered", slug, retracted=True)
    late_refusal = _product_refusal(after, tenant_id)
    if late_refusal is not None:
        await retract_live(db, slug, tenant_id)
        await db.commit()
        _refuse(late_refusal[0], late_refusal[1], slug, retracted=True)
    logger.info(
        "build_record_published",
        slug=slug,
        version=snapshot.version,
        content_sha256=snapshot.content_sha256,
        reactivated=expected_unpublished_at is not None,
    )
    return BuildRecordPublishResult(
        public_slug=snapshot.public_slug,
        version=snapshot.version,
        content_sha256=snapshot.content_sha256,
    )


@router.delete("/{slug}/publish", response_model=BuildRecordUnpublishResult)
async def unpublish_build_record(
    slug: SlugPath,
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    db: AsyncSession = Depends(get_async_db),
) -> BuildRecordUnpublishResult:
    """D7's one-step unpublish: retract the public address immediately.

    ``GET /api/v1/public/build-records/{slug}`` answers 404 from the moment
    this commits. Every snapshot row is kept as history and the tenant keeps
    the slug; ``POST /{slug}/publish`` with ``{"reactivate": true}``
    re-activates it as the next version. Idempotent: unpublishing a retracted
    slug keeps its first retraction time.

    Refuses with the publish route's own answers: 404
    ``build_record_not_published`` when nothing was ever published under the
    slug, 409 ``public_slug_owned_by_another_tenant`` when another tenant owns
    it. coord is not consulted — retraction must work while coord is down.
    """
    owner = await _read_owner(db, slug, lock=True)
    if owner is None:
        _refuse(404, "build_record_not_published", slug)
    if owner.tenant_id != tenant_id:
        _refuse(409, "public_slug_owned_by_another_tenant", slug)

    if owner.unpublished_at is None:
        owner.unpublished_at = datetime.now(UTC)
    unpublished_at = owner.unpublished_at
    latest = await _latest_snapshot(db, slug)
    await db.commit()
    latest_version = latest.version if latest is not None else None
    logger.info("build_record_unpublished", slug=slug, latest_version=latest_version)
    return BuildRecordUnpublishResult(
        public_slug=slug, unpublished_at=unpublished_at, latest_version=latest_version
    )


class BuildRecordReconcileResult(BaseModel):
    """What ``POST /reconcile`` returns."""

    retracted: list[str]


@router.post("/reconcile", response_model=BuildRecordReconcileResult)
async def reconcile_build_records(
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    db: AsyncSession = Depends(get_async_db),
) -> BuildRecordReconcileResult:
    """Retract every live public build record of this tenant whose coord
    product is gone, private or another tenant's — now, with the caller's own
    coord credential — or whose snapshot names a repo the product no longer
    includes. GitHub visibility is NOT re-checked here: that spends the shared
    anonymous GitHub budget and runs only as the scheduled
    ``build_record_visibility_recheck`` task. The same reconcile also runs on the in-process scheduler
    every 10 minutes (``app/jobs/build_record_reconcile.py``); this door is for
    the launch kit and the operator notice, which should not wait for a tick.

    A coord read that fails is a refusal (coord's status), never an empty
    listing — an unanswered question retracts nothing.
    """
    listing = await _proxy_coord_get(
        "/coord/build-record-products", tenant_id=tenant_id, structured_errors=True
    )
    products = listing.get("products") if isinstance(listing, dict) else None
    if not isinstance(products, list):
        raise HTTPException(
            status_code=502,
            detail={"error": "coord_build_record_products_malformed"},
        )
    return BuildRecordReconcileResult(
        retracted=await reconcile_tenant(db, tenant_id, products)
    )
