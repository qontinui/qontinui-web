"""Build records — the authed export proxy and the publish step.

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(D1–D3). A *build record* is a redacted, read-only JSON document composed by
coord from the twin (work-unit history, PR citations, merge events, lands,
gates) for one tenant-defined *product* — a named set of repos plus a window.

Routes (mounted at ``/api/v1/build-records``):

* ``GET  /products``           → coord ``GET /coord/build-record-products``
* ``PUT  /products/{slug}``    → coord ``PUT /coord/build-record-products/{slug}``
* ``GET  /{slug}``             → coord ``GET /coord/build-records/{slug}``
* ``POST /{slug}/publish``     → fetch the document from coord, refuse unless
  the product is public, RE-VALIDATE the D3 allowlist here, and freeze it as
  the next version in ``web.build_record_snapshots``.

The proxies follow ``digital_twin.py``'s shape: the caller's bearer and the
Project-selector header are forwarded (``get_tenant_id`` /
``capture_caller_bearer``), so coord authorizes and scopes on the caller's own
identity and the frontend covers this prefix in ``ACTIVE_TENANT_URL_PREFIXES``.

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
import re
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
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
from app.services.build_record_allowlist import build_record_violations

logger = structlog.get_logger(__name__)

router = APIRouter()

#: Slugs the PUT proxy refuses because a static route already owns the path.
RESERVED_SLUGS: frozenset[str] = frozenset({"products"})

_REPO_PATTERN = r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"


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
        bad = [r for r in self.repos if not re.fullmatch(_REPO_PATTERN, r)]
        if bad:
            raise ValueError(f"repos must be 'owner/name'; invalid: {bad}")
        if (
            self.window_start is not None
            and self.window_end is not None
            and self.window_end < self.window_start
        ):
            raise ValueError("window_end must not precede window_start")
        return self


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
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
) -> Any:
    """Create or replace one product definition. Tenant admins only: this is
    the switch that makes a product publishable (``is_public``)."""
    if slug in RESERVED_SLUGS:
        raise HTTPException(
            status_code=422,
            detail={"error": "build_record_slug_reserved", "slug": slug},
        )
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
        raise HTTPException(
            status_code=502,
            detail={"error": "coord_build_record_products_malformed"},
        )
    for product in products:
        if isinstance(product, dict) and product.get("slug") == slug:
            return product
    return None


async def _store_next_version(
    db: AsyncSession, *, slug: str, tenant_id: UUID, document: dict[str, Any]
) -> BuildRecordSnapshot:
    """Claim the slug if unclaimed, then append the next version under its lock.

    The owner row is the serialization point: ``SELECT … FOR UPDATE`` on it
    orders concurrent publishes of one slug, so ``max(version) + 1`` cannot be
    handed out twice. ``uq_build_record_snapshots_slug_version`` backs that up.
    """
    await db.execute(
        pg_insert(BuildRecordPublicSlug)
        .values(public_slug=slug, tenant_id=tenant_id)
        .on_conflict_do_nothing(index_elements=["public_slug"])
    )
    owner = (
        await db.execute(
            select(BuildRecordPublicSlug)
            .where(BuildRecordPublicSlug.public_slug == slug)
            .with_for_update()
        )
    ).scalar_one()
    if owner.tenant_id != tenant_id:
        # Nothing was written (the claim was a no-op on the existing owner);
        # the request's session rolls back on the raise and drops the lock.
        raise HTTPException(
            status_code=409,
            detail={"error": "public_slug_owned_by_another_tenant", "slug": slug},
        )

    latest = (
        await db.execute(
            select(func.max(BuildRecordSnapshot.version)).where(
                BuildRecordSnapshot.public_slug == slug
            )
        )
    ).scalar_one()
    snapshot = BuildRecordSnapshot(
        tenant_id=tenant_id,
        public_slug=slug,
        version=(latest or 0) + 1,
        document=document,
        content_sha256=canonical_sha256(document),
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
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    db: AsyncSession = Depends(get_async_db),
) -> BuildRecordPublishResult:
    """Freeze the product's current build record as its next public version.

    Refuses (nothing stored) when:

    * the product does not exist in the caller's tenant → 404;
    * the product's ``is_public`` is not ``true`` → 409 (D3: nothing is public
      by default);
    * coord's document fails the D3 allowlist, or names another product → 502
      (coord sent something it must not; the violations are listed);
    * another tenant already owns this public slug → 409.
    """
    product = await _find_product(slug, tenant_id)
    if product is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "build_record_product_not_found", "slug": slug},
        )
    if product.get("is_public") is not True:
        raise HTTPException(
            status_code=409,
            detail={"error": "build_record_product_not_public", "slug": slug},
        )

    document = await _proxy_coord_get(
        f"/coord/build-records/{slug}", tenant_id=tenant_id, structured_errors=True
    )
    violations = build_record_violations(document)
    if not violations:
        doc_product = document.get("product") or {}
        if doc_product.get("slug") != slug:
            violations.append("product.slug: does not match the product published")
    if violations:
        logger.warning(
            "build_record_publish_refused_allowlist",
            slug=slug,
            violation_count=len(violations),
        )
        raise HTTPException(
            status_code=502,
            detail={
                "error": "build_record_allowlist_violation",
                "slug": slug,
                "violations": violations,
            },
        )

    snapshot = await _store_next_version(
        db, slug=slug, tenant_id=tenant_id, document=document
    )
    logger.info(
        "build_record_published",
        slug=slug,
        version=snapshot.version,
        content_sha256=snapshot.content_sha256,
    )
    return BuildRecordPublishResult(
        public_slug=snapshot.public_slug,
        version=snapshot.version,
        content_sha256=snapshot.content_sha256,
    )
