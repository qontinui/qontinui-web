"""Plan & Prompt Library API — ``/api/v1/plan-library``.

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``: a read/write
surface over ``agent.work_artifacts`` so the plans, prompts, reports and
handoffs the fleet writes to disk become queryable, versioned and linkable
instead of living only as markdown in a dozen checkouts.

Routes
------
``GET  /plan-library``            list + filter (kind/status/repo/q/since/work_unit)
``GET  /plan-library/divergent``  same (kind, slug), differing content digests
``GET  /plan-library/{id}``       body + full version log + edges BOTH directions
``POST /plan-library``            upsert by (org, kind, slug, source_repo)
``POST /plan-library/{id}/edges`` add a provenance edge in either direction

Invariants this module is responsible for
-----------------------------------------
1. **``organization_id`` is never read from the request body.** It is derived
   from the authenticated principal's personal organization. The request
   schemas do not even declare the field, so there is nothing to trust.
2. **``status`` is opaque.** No vocabulary, no validation, no 422. An unknown
   status filters to an empty page; an unknown status on write is stored.
3. **``work_unit_slug`` may dangle.** It is a soft link to a coord work unit
   with no FK and no resolution step. A missing work unit NEVER 404s a read.
4. **No direct reads of coord's schema.** Nothing here touches ``coord.*``;
   anything coord-owned is reached over coord's HTTP API by other modules
   (house rule — see ``agent_sessions.py`` / ``prompt_injections.py``).
"""

from datetime import datetime
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.crud import work_artifact as crud
from app.models.user import User
from app.models.work_artifact import WorkArtifact, WorkArtifactVersion
from app.schemas.plan_library import (
    DivergentGroup,
    DivergentResponse,
    DivergentVariant,
    WorkArtifactDetail,
    WorkArtifactEdgeCreate,
    WorkArtifactEdgeRead,
    WorkArtifactListResponse,
    WorkArtifactSummary,
    WorkArtifactUpsert,
    WorkArtifactUpsertResponse,
    WorkArtifactVersionRead,
)
from app.services.permissions import get_personal_organization

logger = structlog.get_logger(__name__)

router = APIRouter()


async def _resolve_org_id(db: AsyncSession, user: User) -> UUID | None:
    """Derive the caller's organization scope — NEVER from the request body.

    Returns the personal organization's id, or ``None`` when the principal
    has no personal organization row. ``None`` is a real scope (the
    NULL bucket, which the functional unique index folds onto the nil UUID),
    not an error: ``agent.work_artifacts.organization_id`` is nullable so
    that unprovisioned/bootstrap principals can still capture artifacts.

    Reviewer note: two principals that BOTH lack a personal organization
    share the NULL bucket. Every registered user gets a personal org at
    signup, so this is a degenerate local/bootstrap case — but it is the
    reason this returns ``None`` rather than inventing a per-user sentinel.
    """
    org = await get_personal_organization(db, user.id)
    if org is None:
        logger.info(
            "plan_library.no_personal_organization",
            user_id=str(user.id),
            detail="scoping this caller to the NULL organization bucket",
        )
        return None
    # ``Organization`` is a legacy-style model, so mypy types ``id`` as
    # ``Column[UUID]`` rather than ``UUID`` — same cast known_issues.py makes.
    return org.id  # type: ignore[return-value]


def _actor(user: User) -> str:
    """A stable human-readable author stamp for version/edge rows."""
    return getattr(user, "email", None) or str(user.id)


def _summary(row: WorkArtifact) -> WorkArtifactSummary:
    return WorkArtifactSummary.model_validate(row)


def _detail(
    row: WorkArtifact,
    versions: list[WorkArtifactVersion],
    edges: list[WorkArtifactEdgeRead],
) -> WorkArtifactDetail:
    """Assemble the single-artifact response.

    Built field-by-field rather than by ``model_validate(row)``: the ORM
    row's ``versions`` relationship is lazy, and letting pydantic touch it
    inside an async handler raises ``MissingGreenlet``. The version rows are
    already loaded by an explicit query — use those.
    """
    return WorkArtifactDetail(
        id=row.id,
        organization_id=row.organization_id,
        created_by_user_id=row.created_by_user_id,
        kind=row.kind,
        slug=row.slug,
        title=row.title,
        status=row.status,
        content_sha256=row.content_sha256,
        source_path=row.source_path,
        source_repo=row.source_repo,
        work_unit_slug=row.work_unit_slug,
        repos=list(row.repos or []),
        authored_at=row.authored_at,
        captured_by=row.captured_by,
        current_version=row.current_version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        body=row.body,
        versions=[WorkArtifactVersionRead.model_validate(v) for v in versions],
        edges=edges,
    )


# ───────────────────────────── reads ─────────────────────────────


@router.get(
    "",
    response_model=WorkArtifactListResponse,
    summary="List work artifacts (plans, prompts, reports, handoffs)",
)
async def list_work_artifacts(
    kind: str | None = Query(None, description="Exact artifact kind"),
    artifact_status: str | None = Query(
        None,
        alias="status",
        description="Exact match on the OPAQUE status text. Unknown values "
        "return an empty page — they are never rejected.",
    ),
    repo: str | None = Query(
        None, description="Matches the repos[] array or source_repo"
    ),
    q: str | None = Query(None, description="Full-text query over title+body"),
    since: datetime | None = Query(
        None, description="Only artifacts updated at/after this timestamp"
    ),
    work_unit_slug: str | None = Query(
        None,
        description="Soft link to a coord work unit. Not resolved; a slug "
        "with no matching work unit simply returns its artifacts.",
    ),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkArtifactListResponse:
    org_id = await _resolve_org_id(db, current_user)
    rows, total = await crud.list_artifacts(
        db,
        org_id=org_id,
        kind=kind,
        status=artifact_status,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
        offset=offset,
        limit=limit,
    )
    return WorkArtifactListResponse(
        items=[_summary(r) for r in rows],
        total=total,
        offset=offset,
        limit=limit,
    )


# NOTE: declared BEFORE ``/{artifact_id}`` so the literal path wins the match.
@router.get(
    "/divergent",
    response_model=DivergentResponse,
    summary="Artifacts sharing a (kind, slug) but disagreeing on content",
)
async def list_divergent_artifacts(
    kind: str | None = Query(None, description="Restrict to one artifact kind"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> DivergentResponse:
    org_id = await _resolve_org_id(db, current_user)
    groups = await crud.find_divergent(db, org_id=org_id, kind=kind)
    return DivergentResponse(
        groups=[
            DivergentGroup(
                kind=g_kind,
                slug=g_slug,
                variant_count=len(variants),
                variants=[DivergentVariant.model_validate(v) for v in variants],
            )
            for g_kind, g_slug, variants in groups
        ],
        total=len(groups),
    )


@router.get(
    "/{artifact_id}",
    response_model=WorkArtifactDetail,
    summary="One artifact with its body, version log and edges both ways",
)
async def get_work_artifact(
    artifact_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkArtifactDetail:
    org_id = await _resolve_org_id(db, current_user)
    row = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact not found: {artifact_id}",
        )

    versions = await crud.list_versions(db, row.id)
    edge_rows = await crud.list_edges(db, row.id)

    # A dangling work_unit_slug is NOT resolved and NOT an error — see
    # invariant 3 in the module docstring.
    edges = [
        WorkArtifactEdgeRead(
            id=edge.id,
            from_id=edge.from_id,
            to_id=edge.to_id,
            relation=edge.relation,
            note=edge.note,
            created_by=edge.created_by,
            created_at=edge.created_at,
            direction="outgoing" if direction == "outgoing" else "incoming",
            peer_kind=peer.kind if peer is not None else None,
            peer_slug=peer.slug if peer is not None else None,
            peer_title=peer.title if peer is not None else None,
        )
        for edge, direction, peer in edge_rows
    ]
    return _detail(row, versions, edges)


# ───────────────────────────── writes ─────────────────────────────


@router.post(
    "",
    response_model=WorkArtifactUpsertResponse,
    summary="Upsert a work artifact by (organization, kind, slug, source_repo)",
)
async def upsert_work_artifact(
    payload: WorkArtifactUpsert,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkArtifactUpsertResponse:
    """Insert or update one artifact.

    Unchanged content is a no-op: the response carries ``changed=false``,
    ``X-Artifact-Unchanged: true`` and an ``ETag`` of the digest, and neither
    ``current_version`` nor the version log moves. That is the plan's
    "304-equivalent" — a literal 304 cannot carry the body the caller needs
    to assert the version did not move.
    """
    computed = crud.compute_content_sha256(payload.body)
    if payload.content_sha256 is not None and payload.content_sha256 != computed:
        # The caller's digest disagrees with its own body. Rejecting is the
        # only safe read: silently trusting the client's digest would let a
        # stale/forged hash suppress a genuine revision.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "content_sha256 does not match sha256(body): "
                f"supplied={payload.content_sha256} computed={computed}"
            ),
        )

    org_id = await _resolve_org_id(db, current_user)
    artifact, created, changed = await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=current_user.id,
        kind=payload.kind,
        slug=payload.slug,
        title=payload.title,
        status=payload.status,
        body=payload.body,
        source_path=payload.source_path,
        source_repo=payload.source_repo,
        work_unit_slug=payload.work_unit_slug,
        repos=payload.repos,
        authored_at=payload.authored_at,
        captured_by=payload.captured_by,
        change_description=payload.change_description,
        created_by=_actor(current_user),
    )

    response.headers["ETag"] = f'"{artifact.content_sha256}"'
    if created:
        response.status_code = status.HTTP_201_CREATED
    elif not changed:
        response.headers["X-Artifact-Unchanged"] = "true"

    return WorkArtifactUpsertResponse(
        changed=changed, created=created, artifact=_summary(artifact)
    )


@router.post(
    "/{artifact_id}/edges",
    response_model=WorkArtifactEdgeRead,
    summary="Link this artifact to another (outgoing or incoming)",
)
async def create_work_artifact_edge(
    artifact_id: UUID,
    payload: WorkArtifactEdgeCreate,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkArtifactEdgeRead:
    """Create one provenance edge.

    Supply exactly one of ``to_id`` (this artifact → that one, an OUTGOING
    edge) or ``from_id`` (that artifact → this one, an INCOMING edge).
    Re-posting an identical triple is idempotent and returns 200.
    """
    if (payload.to_id is None) == (payload.from_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Supply exactly one of 'to_id' (outgoing) or 'from_id' (incoming).",
        )

    org_id = await _resolve_org_id(db, current_user)
    anchor = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if anchor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact not found: {artifact_id}",
        )

    peer_id = payload.to_id if payload.to_id is not None else payload.from_id
    assert peer_id is not None  # guaranteed by the exactly-one check above
    peer = await crud.get_artifact(db, peer_id, org_id=org_id)
    if peer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact not found: {peer_id}",
        )

    outgoing = payload.to_id is not None
    edge, created = await crud.create_edge(
        db,
        from_artifact=anchor if outgoing else peer,
        to_artifact=peer if outgoing else anchor,
        relation=payload.relation,
        note=payload.note,
        created_by=_actor(current_user),
    )

    if created:
        response.status_code = status.HTTP_201_CREATED

    return WorkArtifactEdgeRead(
        id=edge.id,
        from_id=edge.from_id,
        to_id=edge.to_id,
        relation=edge.relation,
        note=edge.note,
        created_by=edge.created_by,
        created_at=edge.created_at,
        direction="outgoing" if outgoing else "incoming",
        peer_kind=peer.kind,
        peer_slug=peer.slug,
        peer_title=peer.title,
    )
