from collections import OrderedDict
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Path, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.core.config import settings
from app.core.error_codes import ErrorCode
from app.middleware.error_handler import not_found_error
from app.middleware.rate_limit import get_peer_ip_identifier, user_limiter
from app.models.build_record import (
    BUILD_RECORD_SLUG_PATTERN,
    BuildRecordPublicSlug,
    BuildRecordSnapshot,
)
from app.models.project import Project as ProjectModel
from app.schemas.project import Project
from app.services.build_record_allowlist import (
    ALLOWLIST_VERSION,
    build_record_violations,
    scan_off_loop,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/projects", response_model=list[Project])
async def read_public_projects(
    db: AsyncSession = Depends(get_async_db),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Get all public projects without authentication.

    This endpoint allows anyone to browse public demo projects.
    """
    logger.info("get_public_projects_request", skip=skip, limit=limit)

    # Query for public projects
    stmt = (
        select(ProjectModel)
        .where(ProjectModel.is_public.is_(True))
        .offset(skip)
        .limit(limit)
        .order_by(ProjectModel.updated_at.desc())
    )

    result = await db.execute(stmt)
    projects = result.scalars().all()

    logger.info("get_public_projects_response", project_count=len(projects))

    return [Project.model_validate(project) for project in projects]


@router.get("/projects/{project_id}", response_model=Project)
async def read_public_project(
    project_id: UUID,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Get a specific public project by ID without authentication.

    Returns 404 if project doesn't exist or is not public.
    """
    logger.info("get_public_project_request", project_id=project_id)

    # Query for specific public project
    stmt = select(ProjectModel).where(
        ProjectModel.id == project_id,
        ProjectModel.is_public.is_(True),
    )

    result = await db.execute(stmt)
    project = result.scalar_one_or_none()

    if not project:
        raise not_found_error(
            "Public project not found",
            ErrorCode.PROJECT_NOT_FOUND,
        )

    logger.info(
        "get_public_project_response", project_id=project_id, project_name=project.name
    )

    return Project.model_validate(project)


#: A retraction must take effect at once, so no cache may hold a copy.
_NO_STORE = {"Cache-Control": "no-store"}

#: Per-peer limit on the unauthenticated build-record read. A real reader
#: (a browser, the launch kit, a crawler) makes a handful of reads a minute;
#: this bounds a scripted loop. Keyed on the ALB-appended peer address.
#: slowapi in this app is per-decorator only (no ``SlowAPIMiddleware``), so
#: the decorator below IS the enforcement; ``shared_limit`` with a scope so
#: every slug shares one bucket per peer (``limit`` would bucket per URL).
PUBLIC_BUILD_RECORD_RATE_LIMIT = "120 per minute"

#: Re-validation verdicts for snapshots stored under an OLDER allowlist
#: version, keyed (slug, version, content_sha256, ALLOWLIST_VERSION) — the
#: inputs fully determine the verdict, so it never goes stale. Bounded LRU.
_REVALIDATION_CACHE: OrderedDict[tuple[str, int, str, int], bool] = OrderedDict()
_REVALIDATION_CACHE_SIZE = 1024


def _public_rate_limit_disabled() -> bool:
    return not settings.RATE_LIMIT_ENABLED


async def _passes_current_allowlist(snapshot: BuildRecordSnapshot) -> bool:
    """Whether a stored snapshot passes the CURRENT allowlist.

    A snapshot validated at publish under the current ``ALLOWLIST_VERSION``
    passed already (only passing documents are stored) — no scan. An older
    one is re-validated once per process, off the event loop under the
    scan's dedicated limiter, and the verdict cached.
    """
    if snapshot.allowlist_version == ALLOWLIST_VERSION:
        return True
    key = (
        snapshot.public_slug,
        snapshot.version,
        snapshot.content_sha256,
        ALLOWLIST_VERSION,
    )
    cached = _REVALIDATION_CACHE.get(key)
    if cached is not None:
        _REVALIDATION_CACHE.move_to_end(key)
        return cached
    violations = await scan_off_loop(build_record_violations, snapshot.document)
    passes = not violations
    _REVALIDATION_CACHE[key] = passes
    if len(_REVALIDATION_CACHE) > _REVALIDATION_CACHE_SIZE:
        _REVALIDATION_CACHE.popitem(last=False)
    return passes


class PublicBuildRecord(BaseModel):
    """The latest frozen version of a published build record."""

    public_slug: str
    version: int
    published_at: datetime
    content_sha256: str
    document: dict[str, Any]


@router.get("/build-records/{slug}", response_model=PublicBuildRecord)
@user_limiter.shared_limit(
    PUBLIC_BUILD_RECORD_RATE_LIMIT,
    scope="public-build-record-read",
    key_func=get_peer_ip_identifier,
    exempt_when=_public_rate_limit_disabled,
)
async def read_public_build_record(
    request: Request,
    slug: Annotated[str, Path(pattern=BUILD_RECORD_SLUG_PATTERN)],
    response: Response,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    The latest published snapshot of a product's build record, without
    authentication.

    Serves ONLY rows frozen by ``POST /api/v1/build-records/{slug}/publish``,
    which refuses a product that is not opted in (``is_public``) and
    re-validates the D3 allowlist before storing. It never proxies to coord,
    so the authed export is never reachable from here. 404 when nothing has
    been published under ``slug``, or when its owner has unpublished it
    (``DELETE /api/v1/build-records/{slug}/publish``).

    A snapshot validated under an older allowlist version is re-validated
    against the current one (once per process, cached, off the event loop
    under a dedicated limiter) and 404s if it fails; one validated under the
    current version is served on its stored verdict. Rate-limited per peer
    (:data:`PUBLIC_BUILD_RECORD_RATE_LIMIT`). Every answer carries
    ``Cache-Control: no-store`` so an unpublish is not outlived by a cached
    copy.

    ``content_sha256`` is the SHA-256 of ``document`` serialized with sorted
    keys and no insignificant whitespace, so a reader can verify it.
    """
    stmt = (
        select(BuildRecordSnapshot)
        .join(
            BuildRecordPublicSlug,
            BuildRecordPublicSlug.public_slug == BuildRecordSnapshot.public_slug,
        )
        .where(
            BuildRecordSnapshot.public_slug == slug,
            # Retracted by the D7 unpublish: 404 at once, history kept.
            BuildRecordPublicSlug.unpublished_at.is_(None),
        )
        .order_by(BuildRecordSnapshot.version.desc())
        .limit(1)
    )
    snapshot = (await db.execute(stmt)).scalar_one_or_none()
    if snapshot is not None and not await _passes_current_allowlist(snapshot):
        # Stored under an older, looser allowlist: never serve it.
        logger.warning(
            "public_build_record_fails_current_allowlist",
            slug=slug,
            version=snapshot.version,
        )
        snapshot = None
    if snapshot is None:
        not_found = not_found_error(
            "Public build record not found",
            ErrorCode.RESOURCE_NOT_FOUND,
        )
        not_found.headers = _NO_STORE
        raise not_found
    response.headers.update(_NO_STORE)
    return PublicBuildRecord(
        public_slug=snapshot.public_slug,
        version=snapshot.version,
        published_at=snapshot.published_at,
        content_sha256=snapshot.content_sha256,
        document=snapshot.document,
    )
