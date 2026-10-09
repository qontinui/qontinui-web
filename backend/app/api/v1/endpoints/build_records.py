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

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Any, NoReturn
from uuid import UUID

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
from app.models.build_record import (
    BUILD_RECORD_SLUG_PATTERN,
    BuildRecordPublicSlug,
    BuildRecordSnapshot,
)
from app.services.build_record_allowlist import REPO_RE, build_record_violations

logger = structlog.get_logger(__name__)

router = APIRouter()

#: Slugs the PUT proxy refuses because a static route already owns the path.
RESERVED_SLUGS: frozenset[str] = frozenset({"products"})

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
        bad = [r for r in self.repos if not REPO_RE.match(r)]
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

    ``is_public: false`` retracts this tenant's live public snapshot of the
    slug FIRST and commits, then calls coord — so whatever coord answers, the
    page is not left public under a product that was just made private. The
    ``X-Build-Record-Retracted`` header says whether this request retracted.
    """
    if slug in RESERVED_SLUGS:
        _refuse(422, "build_record_slug_reserved", slug)

    retracted = False
    if not body.is_public:
        owner = await _read_owner(db, slug, lock=True)
        if (
            owner is not None
            and owner.tenant_id == tenant_id
            and owner.unpublished_at is None
        ):
            owner.unpublished_at = datetime.now(UTC)
            retracted = True
        await db.commit()
        if retracted:
            logger.info("build_record_retracted_by_product_private", slug=slug)
    response.headers["X-Build-Record-Retracted"] = "true" if retracted else "false"

    return await _proxy_coord_put(
        f"/coord/build-record-products/{slug}",
        body.model_dump(mode="json"),
        tenant_id=tenant_id,
        structured_errors=True,
    )


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
    return violations


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
    * coord's document fails the D3 allowlist, names another product, or lists
      a repo outside the product definition → 502 (coord sent something it
      must not; the violations are listed);
    * the slug was retracted or re-activated while coord was being asked → 409
      ``build_record_retraction_changed``;
    * the document is older than the latest snapshot → 409
      ``build_record_stale``.
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
    if product is None:
        _refuse(404, "build_record_product_not_found", slug)
    if str(product.get("tenant_id")) != str(tenant_id):
        _refuse(409, "build_record_tenant_mismatch", slug)
    if product.get("is_public") is not True:
        _refuse(409, "build_record_product_not_public", slug)

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

    snapshot = await _store_next_version(
        db,
        slug=slug,
        tenant_id=tenant_id,
        document=document,
        generated_at=datetime.fromisoformat(document["generated_at"]),
        expected_unpublished_at=expected_unpublished_at,
        reactivate=reactivate,
    )
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
