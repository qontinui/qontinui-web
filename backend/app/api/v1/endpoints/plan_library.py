"""Plan & Prompt Library API — ``/api/v1/plan-library``.

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``: a read/write
surface over ``agent.work_artifacts`` so the plans, prompts, reports and
handoffs the fleet writes to disk become queryable, versioned and linkable
instead of living only as markdown in a dozen checkouts.

Routes
------
``GET   /plan-library``            list + filter (kind/status/repo/q/since/work_unit)
``GET   /plan-library/divergent``  same (kind, slug) differing digests + kind forks
``GET   /plan-library/capture-health`` corpus census by capture door (Phase 5)
``GET   /plan-library/candidates`` unshipped plans + ranking INPUTS (Phase 6)
``GET   /plan-library/{id}``       body + full version log + edges BOTH directions
``POST  /plan-library``            upsert by (org, kind, slug, source_repo)
``PATCH /plan-library/{id}/kind``  correct the kind and LOCK it against re-scans
``POST  /plan-library/{id}/edges`` add a provenance edge in either direction

Invariants this module is responsible for
-----------------------------------------
1. **``organization_id`` is never read from the request body.** It is derived
   from the authenticated principal's personal organization. The request
   schemas do not even declare the field, so there is nothing to trust.
2. **``status`` is opaque.** No vocabulary, no validation, no 422. An unknown
   status filters to an empty page; an unknown status on write is stored.
3. **``work_unit_slug`` may dangle.** It is a soft link to a coord work unit
   with no FK and no resolution step. A missing work unit NEVER 404s a read.
4. **No direct reads of coord's schema.** Nothing here touches coord's
   Postgres tables; every coord-owned field on ``/candidates`` is fetched over
   coord's HTTP API via ``operations._proxy_coord_get`` (house rule — see
   ``agent_sessions.py`` / ``prompt_injections.py``, enforced by
   ``tests/test_coord_schema_boundary_guard.py``).
5. **An unavailable coord is UNKNOWN, never empty.** ``/candidates`` degrades
   to the local signals with the coord-sourced fields explicitly flagged
   ``unavailable`` rather than failing the whole read — and never renders an
   unreachable coord as "this plan has no PRs".
6. **``/candidates`` emits no score.** Design decision D6: the read exposes
   the ranking inputs, the agent ranks. A hardcoded criticality score would be
   a guess frozen into SQL.
7. **Two credentials open this surface; one route takes only the first.**
   Every route except ``PATCH /{id}/kind`` authenticates with EITHER a Cognito
   user JWT or a coord-issued device-token JWT, via
   :func:`~app.api.deps.get_audit_actor_user`.

   This is not a convenience. The deterministic capture backbone is the runner
   scan (``plan_workunit_adapter/body_push.rs``, which POSTs the upsert and its
   edges) and the agent write door is ``mcp/plan_library.rs`` (which POSTs the
   same two and reads the list + ``/candidates``); both hold ONLY the runner's
   device JWT, attached by ``crate::auth::attach_device_auth``. Cognito-only
   routes therefore 401 every one of those calls, and the corpus quietly fills
   from nothing but a human clicking in the browser — a silent failure, because
   an empty library is indistinguishable from a library nobody wrote to.

   Widening changes NO scoping. A device resolves to its paired operator and
   the org still comes from that principal's personal organization, so
   invariant 1 holds unchanged — and it is exactly why the org must come from a
   credential the runner owns rather than from the request body.

   ``PATCH /{id}/kind`` stays Cognito-only ON PURPOSE. It is the operator's
   override of a heuristic, and it sets ``kind_locked``, whose entire job is to
   stop the next runner scan from putting the guess back. A door the scan could
   call to lock in its own guess would cancel out the only mechanism that
   constrains it. The runner does not call it (it logs the route as operator
   guidance on the ambiguous-kind path and leaves it alone), so the narrower
   dependency costs nothing and keeps the correction a human assertion.
"""

import asyncio
from datetime import UTC, datetime
from typing import get_args
from urllib.parse import quote
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db, get_audit_actor_user
from app.api.v1.endpoints.operations import _proxy_coord_get, get_tenant_id
from app.crud import work_artifact as crud
from app.models.user import User
from app.models.work_artifact import WorkArtifact, WorkArtifactVersion
from app.schemas.plan_library import (
    CandidateCoordLink,
    CandidateDependency,
    CandidateLinkedPr,
    CandidatePromptLink,
    CapturedBy,
    CaptureDoorHealth,
    CaptureHealthResponse,
    DivergentGroup,
    DivergentResponse,
    DivergentVariant,
    KindForkGroup,
    PlanCandidate,
    PlanCandidateResponse,
    WorkArtifactDetail,
    WorkArtifactEdgeCreate,
    WorkArtifactEdgeRead,
    WorkArtifactKindPatch,
    WorkArtifactListResponse,
    WorkArtifactSummary,
    WorkArtifactUpsert,
    WorkArtifactUpsertResponse,
    WorkArtifactVersionRead,
)
from app.services.permissions import resolve_personal_organization

logger = structlog.get_logger(__name__)

router = APIRouter()

#: How many coord reads ``/candidates`` runs at once. Coord is a shared
#: service and a page of candidates can reference many distinct work units;
#: this bounds the fan-out without serialising it.
_COORD_FANOUT = 6


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

    Which is exactly why the lookup FAILING may not fall through to that same
    bucket. ``resolve_personal_organization`` is used rather than the
    swallowing ``get_personal_organization``: a statement timeout or a pool
    blip during the org read on a fully-provisioned operator would otherwise
    be indistinguishable from genuine absence, and would silently write the
    artifact into a scope shared with every other principal that degraded the
    same way. That is this module's own "an unavailable dependency is
    UNKNOWN, never empty" invariant (#5) applied to authorization scope, so
    it fails CLOSED with a 503 and the caller retries.
    """
    try:
        org = await resolve_personal_organization(db, user.id)
    except Exception as exc:  # noqa: BLE001 — re-raised as 503 below
        logger.error(
            "plan_library.org_scope_lookup_failed",
            user_id=str(user.id),
            error=str(exc),
            detail="failing closed rather than scoping to the NULL bucket",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Could not resolve the caller's organization scope. This is a "
                "transient dependency failure, not an authorization decision — "
                "retry. (Proceeding would scope this request to the shared "
                "NULL organization bucket.)"
            ),
        ) from exc

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
    coord: CandidateCoordLink | None = None,
) -> WorkArtifactDetail:
    """Assemble the single-artifact response.

    Built field-by-field rather than by ``model_validate(row)``: the ORM
    row's ``versions`` relationship is lazy, and letting pydantic touch it
    inside an async handler raises ``MissingGreenlet``. The version rows are
    already loaded by an explicit query — use those.
    """
    return WorkArtifactDetail(
        coord=coord if coord is not None else CandidateCoordLink(),
        id=row.id,
        organization_id=row.organization_id,
        created_by_user_id=row.created_by_user_id,
        kind=row.kind,
        kind_locked=row.kind_locked,
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


# ─────────────────── coord-owned signals (HTTP only) ───────────────────


async def _soft_tenant_id(request: Request) -> UUID | None:
    """Resolve the caller's coord tenant WITHOUT letting a coord outage 403.

    ``get_tenant_id`` is the fleet's normal dependency, but it raises 403
    ``tenant_not_resolved`` when coord cannot answer — which for
    ``/candidates`` would turn "coord is slow" into "you cannot see your own
    local plans". Resolution is therefore best-effort here.

    Calling it still runs its load-bearing side effect: the caller's bearer is
    captured into the request-scoped ContextVar BEFORE identity resolution and
    independently of its outcome, so ``_proxy_coord_get`` can forward the
    bearer even when the tenant came back ``None``.
    """
    try:
        return await get_tenant_id(request)
    except Exception as exc:  # noqa: BLE001 — any failure degrades, none 403s
        logger.info(
            "plan_library.tenant_unresolved",
            detail="continuing with local signals only",
            error=str(exc),
        )
        return None


def _coord_pr(raw: object) -> CandidateLinkedPr:
    """Project one coord citation onto :class:`CandidateLinkedPr`.

    Defensive about shape: coord's citation projection is
    ``{repo, pr_number, merged, branch, cited_at, sources}`` today, but this
    read must not 500 on a coord that grew or lost a field.
    """
    if not isinstance(raw, dict):
        return CandidateLinkedPr()

    merged = raw.get("merged")
    merged_bool = merged if isinstance(merged, bool) else None
    pr_number = raw.get("pr_number")
    sources = raw.get("sources")
    return CandidateLinkedPr(
        repo=raw.get("repo") if isinstance(raw.get("repo"), str) else None,
        pr_number=pr_number if isinstance(pr_number, int) else None,
        state=(
            "unknown"
            if merged_bool is None
            else ("merged" if merged_bool else "unmerged")
        ),
        merged=merged_bool,
        branch=raw.get("branch") if isinstance(raw.get("branch"), str) else None,
        cited_at=str(raw["cited_at"]) if raw.get("cited_at") is not None else None,
        sources=[str(s) for s in sources] if isinstance(sources, list) else [],
    )


def _citation_rows(payload: object) -> list[object]:
    """Pull the citation list out of whatever envelope coord returned."""
    if isinstance(payload, list):
        return list(payload)
    if isinstance(payload, dict):
        for key in ("citations", "prs", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return list(value)
    return []


def _is_transport_failure(http_status: int) -> bool:
    """Is this status evidence that COORD ITSELF is unreachable/broken?

    Only 5xx qualifies, and that covers both sources: the proxy's own
    transport mapping (``httpx.ConnectError`` → 502,
    ``httpx.TimeoutException`` → 504, in ``operations._proxy_coord_get``) and
    coord answering with a server error of its own.

    A 4xx is deliberately NOT a transport failure. 401/403 is coord's auth
    layer rejecting the forwarded credential for that route, 404 is "no such
    work unit", 405 is "wrong method for this path" — each is coord
    *answering about one route*, and none of them predicts anything about the
    next slug's read. Tripping a page-wide circuit on them is how
    ``coord_available`` ended up false on every request.
    """
    return http_status >= 500


class _CoordProbe:
    """One page's coord reads, with a fail-fast circuit.

    A page of candidates can reference many work units. If coord is down, the
    FIRST transport failure is enough to know the rest will fail too — every
    subsequent slug is marked ``unavailable`` without paying another timeout.
    That keeps a coord outage costing one 5s timeout for the whole page
    instead of one per row, which is what makes "degrade gracefully" actually
    graceful.

    "Transport failure" is narrow on purpose (:func:`_is_transport_failure`):
    a per-route 4xx leaves the circuit closed, because it is coord answering,
    not coord being unreachable.

    ``degraded`` is sticky and is what the response's ``coord_available: false``
    reports.
    """

    def __init__(self, tenant_id: UUID | None) -> None:
        self.tenant_id = tenant_id
        self.degraded = False
        self.reason: str | None = None
        self._gate = asyncio.Semaphore(_COORD_FANOUT)

    def _trip(self, reason: str) -> None:
        self.degraded = True
        if self.reason is None:
            self.reason = reason

    async def _get(self, path: str) -> tuple[object | None, int | None, str | None]:
        """``(payload, http_status, error)`` — never raises.

        ``http_status`` is coord's status when it answered with one (404 is a
        real answer: "no such work unit"); ``error`` is set when the call
        could not be completed at all.

        The circuit trips on TRANSPORT-CLASS failures only — see
        :func:`_is_transport_failure`. A 4xx is coord answering *about this
        route*, which says nothing about whether the next slug's read will
        work, and tripping on one made ``coord_available`` permanently false:
        the citations hop is registered on coord as ``post``/``delete`` behind
        a ``require_jwt`` layer, so a GET there NEVER 404s — it 401/403s (the
        layer rejects) or 405s (method mismatch). That is the same reasoning
        :meth:`link_for` already applies to the citations hop itself ("absence
        of a route is not evidence of an absence of PRs"); the circuit obeys
        it too, or the one flag whose job is signalling a real coord outage
        can never do so.

        The ``degraded`` short-circuit is checked INSIDE the semaphore, not
        before it. Checked outside, tasks 7+ of a fan-out have already passed
        it by the time they park in ``acquire``, so a trip could never
        actually shorten the page: 100 linked slugs against a hung coord cost
        ceil(100/6) × 5s ≈ 85s, holding the request-scoped session and six
        httpx connections the whole time. Inside, a trip is observed by every
        task still queued.
        """
        async with self._gate:
            if self.degraded:
                return None, None, self.reason or "coord unavailable"
            try:
                payload = await _proxy_coord_get(
                    path,
                    tenant_id=self.tenant_id,
                    forward_bearer=True,
                )
            except HTTPException as exc:
                detail = f"coord returned {exc.status_code}"
                if _is_transport_failure(exc.status_code):
                    self._trip(detail)
                return None, exc.status_code, detail
            except Exception as exc:  # noqa: BLE001 — degrade, never 500
                detail = f"coord read failed: {exc}"
                self._trip(detail)
                return None, None, detail
        return payload, 200, None

    async def link_for(self, slug: str) -> CandidateCoordLink:
        """Resolve one work-unit slug into its coord block.

        Two hops, both over coord's HTTP API:

        1. ``GET /coord/work-units/{slug}`` — presence. A 404 here is the
           NORMAL dangling case (the link is FK-less by design), and it also
           settles the PR question: citations hang off the work unit by a hard
           FK, so no unit really does mean no citations.
        2. ``GET /coord/work-units/{slug}/citations`` — the PR citations, with
           the live merged state coord's own ``shipped`` predicate reduces
           (coord projects each row to
           ``{repo, pr_number, merged, branch, cited_at, sources}``).

        ⚠️ **Known gap, verified 2026-08-15.** Coord registers only ``post``
        and ``delete`` on that second path; the read half exists today ONLY as
        the ``coord_work_unit_list_citations`` MCP tool, with no REST twin. So
        against the currently-deployed coord this hop never succeeds — the
        ``require_jwt`` layer in front of the path rejects a forwarded Cognito
        bearer with 401/403, and a credential that clears the layer gets a 405
        for the method — and ``linked_prs_state`` reads
        ``"unavailable"``. (It is specifically NOT a 404, which is why the
        page-wide circuit must not treat "not 404" as "coord is down".)
        That is the correct
        honest answer — the alternative (reporting an empty PR list) would
        assert a fact this read has not established, and the plan is explicit
        that an unavailable coord must not read as "no PRs". Adding the GET is
        a coord-side follow-up; nothing here changes when it lands, the field
        simply starts reading ``"available"``.

        Reading the citations out of coord's Postgres instead is NOT the
        workaround: the web→coord read boundary is closed and
        ``tests/test_coord_schema_boundary_guard.py`` enforces it.
        """
        encoded = quote(slug, safe="")
        payload, http_status, error = await self._get(f"/coord/work-units/{encoded}")

        if http_status == 404:
            return CandidateCoordLink(
                work_unit_slug=slug,
                work_unit_state="dangling",
                linked_prs_state="unlinked",
                unavailable_reason=None,
            )
        if payload is None:
            return CandidateCoordLink(
                work_unit_slug=slug,
                work_unit_state="unavailable",
                linked_prs_state="unavailable",
                unavailable_reason=error or "coord unavailable",
            )

        unit = payload.get("work_unit") if isinstance(payload, dict) else None
        unit = unit if isinstance(unit, dict) else {}
        link = CandidateCoordLink(
            work_unit_slug=slug,
            work_unit_state="linked",
            work_unit_status=(
                unit.get("status") if isinstance(unit.get("status"), str) else None
            ),
            work_unit_title=(
                unit.get("title") if isinstance(unit.get("title"), str) else None
            ),
        )

        cites, cite_status, cite_error = await self._get(
            f"/coord/work-units/{encoded}/citations"
        )
        if cites is None:
            # Includes 401/403/404/405 on the route itself — absence of a
            # route (or of permission to call it) is not evidence of an
            # absence of PRs. None of those trips the page-wide circuit
            # either; see ``_is_transport_failure``.
            link.linked_prs_state = "unavailable"
            link.unavailable_reason = (
                cite_error or f"coord returned {cite_status} for citations"
            )
            return link

        link.linked_prs_state = "available"
        link.linked_prs = [_coord_pr(row) for row in _citation_rows(cites)]
        return link


async def _coord_links(
    slugs: list[str], probe: _CoordProbe
) -> dict[str, CandidateCoordLink]:
    """Resolve every DISTINCT slug on the page concurrently."""
    if not slugs:
        return {}
    results = await asyncio.gather(*(probe.link_for(s) for s in slugs))
    return dict(zip(slugs, results, strict=True))


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
    current_user: User = Depends(get_audit_actor_user),
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
    summary="Artifacts that disagree — on content, or on kind",
)
async def list_divergent_artifacts(
    kind: str | None = Query(None, description="Restrict to one artifact kind"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> DivergentResponse:
    """Two distinct forks, reported side by side.

    ``groups`` — same ``(kind, slug)``, different ``content_sha256``: the same
    document captured from two repos/checkouts that have drifted apart.

    ``kind_forks`` — same ``(slug, source_repo)``, different ``kind``: the
    class the kind-lock fix prevents, and the one the scan-safe upsert now
    refuses to resolve on its own (it 409s rather than pick a winner). Grouping
    by ``(kind, slug)`` structurally cannot see these, which is why they are
    reported separately rather than folded into ``groups``.
    """
    org_id = await _resolve_org_id(db, current_user)
    groups = await crud.find_divergent(db, org_id=org_id, kind=kind)
    forks = await crud.find_kind_forks(db, org_id=org_id)
    if kind is not None:
        forks = [f for f in forks if any(row.kind == kind for row in f[2])]

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
        kind_forks=[
            KindForkGroup(
                slug=f_slug,
                source_repo=f_repo,
                kinds=sorted({row.kind for row in variants}),
                variant_count=len(variants),
                # Exactly one locked row is a fork the scanner can heal by
                # itself; anything else needs an operator to pick.
                resolvable=sum(1 for row in variants if row.kind_locked) == 1,
                variants=[DivergentVariant.model_validate(v) for v in variants],
            )
            for f_slug, f_repo, variants in forks
        ],
        kind_fork_total=len(forks),
    )


# NOTE: declared BEFORE ``/{artifact_id}`` so the literal path wins the match.
@router.get(
    "/capture-health",
    response_model=CaptureHealthResponse,
    summary="Corpus census by capture door (scan / agent / operator)",
)
async def get_capture_health(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> CaptureHealthResponse:
    """Which door is actually feeding the store.

    The deterministic scanner is the backbone (design decision D3) and the
    agent write door is the addition that captures what a scan cannot see —
    ad-hoc worktree prompts, and the provenance edges only the agent that ran
    the chain knows. If the agent door is unused, the corpus is quietly
    missing exactly that half, and nothing else on this page would say so.

    Every door in the schema's vocabulary is returned, **zeros included** — an
    unused door must render as ``0``, not as an absent row. A row with
    ``known: false`` is a value the CHECK constraint allows that this build
    does not recognise; it is surfaced rather than swallowed.
    """
    org_id = await _resolve_org_id(db, current_user)
    rows = await crud.capture_health(db, org_id=org_id)
    known_doors: tuple[str, ...] = get_args(CapturedBy)
    observed = {door: (count, first, touched) for door, count, first, touched in rows}

    doors = []
    for door in known_doors:
        count, first, touched = observed.get(door, (0, None, None))
        doors.append(
            CaptureDoorHealth(
                captured_by=door,
                count=count,
                known=True,
                first_at=first,
                last_touched_at=touched,
            )
        )
    doors.extend(
        CaptureDoorHealth(
            captured_by=door,
            count=count,
            known=False,
            first_at=first,
            last_touched_at=touched,
        )
        for door, count, first, touched in rows
        if door not in known_doors
    )
    return CaptureHealthResponse(
        total=sum(d.count for d in doors),
        doors=doors,
    )


@router.get(
    "/candidates",
    response_model=PlanCandidateResponse,
    summary="Unshipped plans with the ranking INPUTS attached (no score)",
)
async def list_plan_candidates(
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=100),
    include_coord: bool = Query(
        True,
        description="Fetch the coord-owned signals (work unit + PR citations). "
        "Set false for a purely local, coord-free read.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> PlanCandidateResponse:
    """Candidate selection for agents — signals, never a verdict.

    Returns unshipped ``kind='plan'`` artifacts, each carrying the inputs an
    agent needs to decide what to pick up next: ``status``, ``repos``,
    ``unmet_depends_on``, ``linked_prs`` with their merged state, ``age_days``,
    ``last_touched``, and the ``prompt_chain`` that produced the plan.

    **There is no criticality score** (design decision D6). A hardcoded score
    would be a guess frozen into SQL; the read exposes the evidence and the
    agent ranks. The only ordering is a stable default — oldest-vetted-first
    (``coalesce(authored_at, created_at) ASC``, ``id`` breaking ties) — with no
    weighting of any kind.

    Coord-owned fields (the work unit and its PR citations) come over coord's
    HTTP API, never from coord's Postgres schema. Two things the payload is
    careful about:

    * ``work_unit_slug`` is a soft link with NO foreign key and it may dangle.
      A missing work unit is a NORMAL result — null-joined as
      ``work_unit_state: "dangling"``, never a 404 and never an error.
    * An unreachable or slow coord degrades to ``"unavailable"`` on the
      affected fields, and the whole read still returns the local signals.
      ``unavailable`` is UNKNOWN — it is NOT "this plan has no PRs". The two
      are distinct values precisely so a consumer cannot confuse them.
    """
    org_id = await _resolve_org_id(db, current_user)
    rows, total = await crud.list_plan_candidates(
        db, org_id=org_id, offset=offset, limit=limit
    )

    ids = [row.id for row in rows]
    depends = await crud.load_depends_on(db, ids)
    chains = await crud.load_prompt_chains(db, ids)

    links: dict[str, CandidateCoordLink] = {}
    coord_available = True
    if include_coord:
        tenant_id = await _soft_tenant_id(request)
        probe = _CoordProbe(tenant_id)
        slugs = sorted({r.work_unit_slug for r in rows if r.work_unit_slug})
        links = await _coord_links(slugs, probe)
        coord_available = not probe.degraded

    now = datetime.now(UTC)
    items: list[PlanCandidate] = []
    for row in rows:
        anchor = row.authored_at or row.created_at
        if anchor.tzinfo is None:  # pragma: no cover — the column is timestamptz
            anchor = anchor.replace(tzinfo=UTC)

        if not include_coord:
            coord_block = CandidateCoordLink(
                work_unit_slug=row.work_unit_slug,
                work_unit_state="unavailable" if row.work_unit_slug else "unlinked",
                linked_prs_state="unavailable" if row.work_unit_slug else "unlinked",
                unavailable_reason=(
                    "not fetched (include_coord=false)" if row.work_unit_slug else None
                ),
            )
        elif row.work_unit_slug:
            coord_block = links.get(
                row.work_unit_slug,
                CandidateCoordLink(
                    work_unit_slug=row.work_unit_slug,
                    work_unit_state="unavailable",
                    linked_prs_state="unavailable",
                    unavailable_reason="coord unavailable",
                ),
            )
        else:
            coord_block = CandidateCoordLink()

        items.append(
            PlanCandidate(
                id=row.id,
                kind=row.kind,
                kind_locked=row.kind_locked,
                slug=row.slug,
                title=row.title,
                status=row.status,
                repos=list(row.repos or []),
                source_repo=row.source_repo,
                source_path=row.source_path,
                work_unit_slug=row.work_unit_slug,
                authored_at=row.authored_at,
                created_at=row.created_at,
                last_touched=row.updated_at,
                age_days=round((now - anchor).total_seconds() / 86400.0, 3),
                unmet_depends_on=[
                    CandidateDependency(
                        id=dep.id,
                        kind=dep.kind,
                        slug=dep.slug,
                        title=dep.title,
                        status=dep.status,
                    )
                    for dep in depends.get(row.id, [])
                    if not crud.is_terminal_status(dep.status)
                ],
                prompt_chain=[
                    CandidatePromptLink(
                        id=producer.id,
                        kind=producer.kind,
                        slug=producer.slug,
                        title=producer.title,
                        relation=relation,
                        depth=depth,
                    )
                    for producer, relation, depth in chains.get(row.id, [])
                ],
                coord=coord_block,
            )
        )

    return PlanCandidateResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        coord_available=coord_available,
    )


@router.get(
    "/{artifact_id}",
    response_model=WorkArtifactDetail,
    summary="One artifact with its body, version log and edges both ways",
)
async def get_work_artifact(
    artifact_id: UUID,
    request: Request,
    include_coord: bool = Query(
        True,
        description="Resolve the linked coord work unit and its PR citations. "
        "Set false for a purely local, coord-free read — the coord block then "
        "reports 'unavailable' for a linked artifact, because 'we did not "
        "look' is not the same answer as 'there is nothing there'.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> WorkArtifactDetail:
    """One artifact, with everything the operator page's detail view renders.

    The ``coord`` block is resolved over coord's HTTP API (never its Postgres
    schema — invariant 4) and carries its own honesty flags:

    * no ``work_unit_slug`` at all → ``unlinked``. A first-class normal state:
      the link is optional and most artifacts have none.
    * a slug coord does not know → ``dangling``. ALSO normal — the link has no
      FK by design and MAY dangle. It is never a 404 on this read.
    * coord unreachable → ``unavailable`` on both halves. UNKNOWN, not empty.

    ``linked_prs_state`` is tracked separately from ``work_unit_state`` for a
    concrete reason: today's deployed coord registers no HTTP route for the
    citation LIST (it exists only as an MCP tool), so that half reads
    ``unavailable`` even when the work unit resolves fine. Rendering an empty
    PR list there would assert something this read has not established.
    """
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

    coord_block = CandidateCoordLink()
    if row.work_unit_slug:
        if include_coord:
            probe = _CoordProbe(await _soft_tenant_id(request))
            coord_block = await probe.link_for(row.work_unit_slug)
        else:
            coord_block = CandidateCoordLink(
                work_unit_slug=row.work_unit_slug,
                work_unit_state="unavailable",
                linked_prs_state="unavailable",
                unavailable_reason="not fetched (include_coord=false)",
            )

    return _detail(row, versions, edges, coord_block)


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
    current_user: User = Depends(get_audit_actor_user),
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
    try:
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
            kind_is_heuristic=payload.kind_is_heuristic,
        )
    except crud.AmbiguousArtifactKind as exc:
        # A heuristic scan whose kind-less key matched several rows with no
        # single locked winner. NOTHING was written: picking one silently is
        # exactly the fork this fix exists to stop. The candidates are named
        # so the operator can resolve it via PATCH .../kind, and the fork is
        # already listed under GET /plan-library/divergent → kind_forks.
        logger.warning(
            "plan_library.ambiguous_kind_resolution",
            slug=exc.slug,
            source_repo=exc.source_repo,
            candidate_ids=[str(i) for i in exc.candidate_ids],
            kinds=exc.candidate_kinds,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "ambiguous_kind_resolution",
                "message": (
                    "This slug resolves to several artifacts with different "
                    "kinds and no single corrected (kind_locked) row to "
                    "prefer, so the heuristic scan refused to pick one. "
                    "Nothing was written. Correct one of the candidates with "
                    "PATCH /plan-library/{id}/kind, or see "
                    "GET /plan-library/divergent."
                ),
                "slug": exc.slug,
                "source_repo": exc.source_repo,
                "candidate_ids": [str(i) for i in exc.candidate_ids],
                "candidate_kinds": exc.candidate_kinds,
            },
        ) from exc
    except crud.ArtifactKindConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "kind_identity_conflict",
                "message": str(exc),
                "kind": exc.kind,
                "slug": exc.slug,
                "existing_id": (
                    str(exc.existing_id) if exc.existing_id is not None else None
                ),
            },
        ) from exc

    response.headers["ETag"] = f'"{artifact.content_sha256}"'
    if created:
        response.status_code = status.HTTP_201_CREATED
    elif not changed:
        response.headers["X-Artifact-Unchanged"] = "true"

    return WorkArtifactUpsertResponse(
        changed=changed, created=created, artifact=_summary(artifact)
    )


@router.patch(
    "/{artifact_id}/kind",
    response_model=WorkArtifactSummary,
    summary="Correct an artifact's kind and LOCK it against future re-scans",
)
async def patch_work_artifact_kind(
    artifact_id: UUID,
    payload: WorkArtifactKindPatch,
    db: AsyncSession = Depends(get_async_db),
    # DELIBERATELY still ``current_active_user`` — the ONE route on this
    # surface a device JWT may not reach. See invariant 7 and the docstring.
    current_user: User = Depends(current_active_user),
) -> WorkArtifactSummary:
    """Set ``kind`` deliberately and mark it ``kind_locked``.

    The door the library's inline kind correction needs. Heuristics only ever
    set an INITIAL kind; this is where that guess gets overruled, and the lock
    is what stops the next runner scan from quietly putting the guess back
    (which, because ``kind`` is part of the artifact's identity, would fork the
    document into a second row rather than merely re-label it).

    The lock is set even when ``kind`` is unchanged — confirming a guessed kind
    is itself the assertion that makes it stick.

    409 when another artifact already occupies
    ``(org, kind, slug, source_repo)``: that is a genuine identity collision
    and merging the two rows is an operator decision, not one this write may
    guess at.

    **Cognito-only, unlike every other route in this module.** A device JWT
    gets a 401 here by design: the lock exists to overrule the runner scan's
    heuristic, so a door the scan itself could use to set the lock on its own
    guess would cancel out the only mechanism constraining it. The correction
    is an operator's assertion and it takes an operator's credential.
    """
    org_id = await _resolve_org_id(db, current_user)
    row = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact not found: {artifact_id}",
        )

    try:
        updated = await crud.set_artifact_kind(
            db, row, kind=payload.kind, org_id=org_id
        )
    except crud.ArtifactKindConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "kind_identity_conflict",
                "message": str(exc),
                "kind": exc.kind,
                "slug": exc.slug,
                "existing_id": (
                    str(exc.existing_id) if exc.existing_id is not None else None
                ),
            },
        ) from exc

    logger.info(
        "plan_library.kind_corrected",
        artifact_id=str(updated.id),
        kind=updated.kind,
        actor=_actor(current_user),
    )
    return _summary(updated)


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
    current_user: User = Depends(get_audit_actor_user),
) -> WorkArtifactEdgeRead:
    """Create one provenance edge.

    Supply exactly one of ``to_id`` (this artifact → that one, an OUTGOING
    edge) or ``from_id`` (that artifact → this one, an INCOMING edge).
    Re-posting an identical triple is idempotent and returns 200.

    A self-edge is refused. ``/candidates`` walks ``depends_on`` to compute
    unmet dependencies, so an artifact pointing at itself becomes its own
    permanently-unmet blocker and can never be reported as ready — and the
    prompt-chain walk would have to defend against the same cycle. There is
    no provenance relation an artifact can meaningfully hold with itself.
    """
    if (payload.to_id is None) == (payload.from_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Supply exactly one of 'to_id' (outgoing) or 'from_id' (incoming).",
        )

    if payload.to_id == artifact_id or payload.from_id == artifact_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "An artifact cannot be linked to itself: a 'depends_on' "
                "self-edge makes the artifact its own unmet dependency and it "
                "can never appear as ready in /candidates."
            ),
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
