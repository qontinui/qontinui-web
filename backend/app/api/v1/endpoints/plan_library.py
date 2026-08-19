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
``GET   /plan-library/followups``  identified-but-UNOWNED follow-ups (Phase 7)
``GET   /plan-library/export``     the filtered corpus as a zip of verbatim .md
``GET   /plan-library/{id}``       body + full version log + edges BOTH directions
``GET   /plan-library/{id}/export`` one artifact's verbatim body (head or version)
``POST  /plan-library``            upsert by (org, kind, slug, source_repo)
``PATCH /plan-library/edges/{id}`` claim an open follow-up (Phase 7)
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
6b. **A null ``to_id`` is legal for exactly ONE relation.** Phase 7 of
   ``2026-08-16-plan-corpus-authority-and-run-provenance`` added
   ``spawned_followup`` — work a plan surfaced and deliberately did not do,
   recorded as a ONE-ENDED edge because the follow-up has no artifact yet.
   ``POST /{id}/edges`` rejects a null target for the other five relations with
   a 422 that names the relation, **before** the request reaches the database:
   ``ck_work_artifact_edges_open_target`` is the backstop, not the user-facing
   error, and the reason it exists at all is that ``/candidates`` walks
   ``depends_on`` through ``to_id`` — a null target there would drop the row
   out of the join and report a blocked plan as ready.
6a. **Export is verbatim, and one-way.** The two ``/export`` routes emit the
   stored body's bytes unmodified — no re-rendered status block, no normalized
   headings. Fidelity is the product: plan
   ``2026-08-16-plan-corpus-authority-and-run-provenance`` Phase 4 gates on
   exporting a plan and re-scanning it with an unchanged ``content_sha256``,
   which any cosmetic transformation would break. Provenance rides in headers
   and a ``manifest.json``, never inside the bodies. There is deliberately no
   import half: copies flow OUT of the authority, and a bidirectional git sync
   would rebuild the divergent-corpus problem the plan exists to close.
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

8. **Which credential authenticated is load-bearing for the coord hop.** The
   two routes that read coord (``/candidates`` and ``GET /{id}``) forward the
   caller's captured bearer VERBATIM, and coord's two door tiers reject each
   other's credential: its ``/coord/work-units/...`` reads resolve a tenant
   from a Cognito ``OperatorContext`` (403 ``tenant_not_resolved`` for a device
   JWT), while its ``/coord/agent-work-units/...`` twins lift the tenant from a
   verified device JWT (and reject a Cognito bearer). Those two routes
   therefore depend on :func:`~app.api.deps.get_audit_actor_principal`, which
   carries WHICH arm authenticated alongside the ``User``, and pass that kind
   to ``_CoordProbe``. Every other route needs only the ``User`` and keeps
   :func:`~app.api.deps.get_audit_actor_user`.
"""

import asyncio
import io
import json
import re
import zipfile
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

from app.api.deps import (
    ActorKind,
    ActorPrincipal,
    current_active_user,
    get_async_db,
    get_audit_actor_principal,
    get_audit_actor_user,
)
from app.api.v1.endpoints.operations import _proxy_coord_get, get_tenant_id
from app.crud import work_artifact as crud
from app.models.user import User
from app.models.work_artifact import (
    RELATIONS_ALLOWING_OPEN_TARGET,
    SPAWNED_FOLLOWUP_RELATION,
    WorkArtifact,
    WorkArtifactEdge,
    WorkArtifactVersion,
)
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
    OpenFollowup,
    OpenFollowupResponse,
    PlanCandidate,
    PlanCandidateResponse,
    WorkArtifactDetail,
    WorkArtifactEdgeClaim,
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

#: Hard ceiling on artifacts in one bulk export (Phase 4 of plan
#: ``2026-08-16-plan-corpus-authority-and-run-provenance``). The zip is built in
#: memory, so the bound exists to keep one request from pinning the process; at
#: the measured corpus size (~1000 plans across two directories) it is generous
#: rather than binding. It is NEVER applied silently — ``list_for_export``
#: reports truncation and the route emits ``X-Export-Truncated``, because an
#: export that stopped short reads exactly like a corpus that is short.
_EXPORT_MAX_ARTIFACTS = 5000

#: Characters allowed in an exported filename. Slugs are scanner-derived from
#: real filenames and are normally already safe, but they are NOT validated on
#: write (``slug`` is opaque TEXT), so everything else is folded to ``-``. This
#: also drops path separators and ``..`` segments, which is what keeps a hostile
#: slug from writing outside its archive directory on extraction (zip-slip).
_EXPORT_SAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _export_filename(slug: str) -> str:
    """A safe ``<slug>.md`` filename for a single-artifact download."""
    cleaned = _EXPORT_SAFE_CHARS.sub("-", slug).strip("-.") or "artifact"
    # Leave room for the extension inside common 255-byte filename limits.
    return f"{cleaned[:200]}.md"


def _export_archive_name(row: WorkArtifact, used: set[str]) -> str:
    """A unique ``<kind>/<slug>.md`` path for one entry in a bulk archive.

    Grouped by ``kind`` so an extracted archive lands as ``plan/…``,
    ``prompt/…`` and so on rather than one flat heap of a thousand files.

    Uniqueness matters and is not free: the store's identity is
    ``(org, kind, slug, source_repo)``, so the SAME slug legitimately appears
    more than once — that is design decision D7 (source-qualified identity),
    which keeps both copies of a forked plan instead of destroying one. Six such
    forks exist in this fleet's corpus today. Collapsing them onto one archive
    entry would silently discard exactly the divergence the operator is meant to
    review, so a collision gets the source repo appended, then a numeric suffix.
    """
    kind = _EXPORT_SAFE_CHARS.sub("-", row.kind).strip("-.") or "unknown"
    base = _export_filename(row.slug)
    candidate = f"{kind}/{base}"
    if candidate in used:
        repo = _EXPORT_SAFE_CHARS.sub("-", row.source_repo or "").strip("-.")
        if repo:
            candidate = f"{kind}/{base[:-3]}__{repo}.md"
    suffix = 2
    while candidate in used:
        candidate = f"{kind}/{base[:-3]}__{suffix}.md"
        suffix += 1
    used.add(candidate)
    return candidate


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


def _age_days(anchor: datetime, now: datetime) -> float:
    """Whole-ish days between ``anchor`` and ``now``, three decimals.

    Defends against a naive timestamp even though the columns are
    ``timestamptz``: the arithmetic raises rather than degrading if one side
    ever arrives without a tzinfo.
    """
    if anchor.tzinfo is None:  # pragma: no cover — the column is timestamptz
        anchor = anchor.replace(tzinfo=UTC)
    return round((now - anchor).total_seconds() / 86400.0, 3)


def _open_followup(
    edge: WorkArtifactEdge, origin: WorkArtifact, now: datetime
) -> OpenFollowup:
    """Project one open ``spawned_followup`` edge onto its response row."""
    return OpenFollowup(
        edge_id=edge.id,
        from_id=origin.id,
        from_kind=origin.kind,
        from_slug=origin.slug,
        from_title=origin.title,
        # Non-blank by construction (``ck_work_artifact_edges_followup_note``);
        # the ``or ""`` only satisfies the type, it is not a real branch.
        note=edge.note or "",
        created_by=edge.created_by,
        created_at=edge.created_at,
        age_days=_age_days(edge.created_at, now),
    )


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


def _coord_pr(raw: object, *, merged_is_degraded: bool = False) -> CandidateLinkedPr:
    """Project one coord citation onto :class:`CandidateLinkedPr`.

    Defensive about shape: coord's citation projection is
    ``{repo, pr_number, merged, branch, cited_at, sources}`` today, but this
    read must not 500 on a coord that grew or lost a field.

    ``merged_is_degraded`` — coord answered with ``merged_degraded_reason``,
    meaning its ``merged`` predicate is running in its DEGRADED form: the
    durable ``merge_commit_sha`` arm is dropped (a column it needs has not
    been migrated yet) and **every PR coord ff-landed reads ``merged: false``**.
    A ``false`` under that flag is UNKNOWN, not an observation, and coord
    ff-lands PRs routinely — so it is projected as ``state: "unknown"`` with
    ``merged: None`` rather than rendered as the fact "unmerged". A ``true`` is
    unaffected: the degraded arm narrows the disjunction, so it can only
    produce false NEGATIVES.

    This is the same "absence is UNKNOWN, not zero" discipline the enclosing
    block applies to the citation list, one level down — on the individual
    row's merged state.
    """
    if not isinstance(raw, dict):
        return CandidateLinkedPr()

    merged = raw.get("merged")
    merged_bool = merged if isinstance(merged, bool) else None
    if merged_is_degraded and merged_bool is False:
        merged_bool = None
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


def _merged_is_degraded(payload: object) -> bool:
    """Did coord flag its ``merged`` predicate as running DEGRADED?

    ``merged_degraded_reason`` is coord's own admission that the durable
    ``merge_commit_sha`` arm of the predicate is dropped (a column it needs is
    unmigrated), so every PR coord ff-landed reads ``merged: false``. Its
    presence is the whole signal; the body is prose.

    It rides on BOTH of coord's citation-bearing payloads on the same terms —
    the citations sub-resource and the by-slug response behind
    ``/coord/work-units/:slug`` and ``/coord/agent-work-units/:slug`` — which
    is why one probe serves both branches of :meth:`_CoordProbe.link_for`.

    One field name, one predicate, one place. Degradation is deliberately NOT
    re-derived here from ``delivery.evidence_complete`` (it goes false for
    evidence gaps that have nothing to do with the merged arm) nor by
    string-matching ``evidence_gaps`` prose (a brittle coupling to coord's
    wording). A second implementation in web would drift from coord's own.
    """
    return (
        isinstance(payload, dict) and payload.get("merged_degraded_reason") is not None
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


#: Backstop cap on the rendered citation-error line. Nothing that reaches it
#: is free text any more (:func:`_citation_error_text` echoes only structured
#: identifiers), so this is belt-and-braces against a pathological error code,
#: not the privacy control — that is the whitelist itself.
_REASON_MAX_CHARS = 300


def _citation_error_text(raw: object) -> str:
    """Render coord's ``citations_error`` object as one reason line.

    coord emits a structured body — ``{"error": "citation_surface_unavailable",
    "pg_code": "42P01", "message": …}`` for the pre-migration window, or a
    ``pg_error`` context object — and this read must survive either without
    500ing, so the shape is probed rather than assumed.

    Only the STRUCTURED identifiers cross the boundary: the ``error`` code and
    the SQLSTATE (:func:`_coord_error_code`, which finds it at ``pg_code`` or
    at ``pg.code``). The free-text fields are deliberately NOT echoed —
    ``message``, ``context`` and everything under ``pg`` are where coord's
    Postgres internals live, and ``pg.detail`` routinely carries ROW VALUES
    (``Key (tenant_id)=(…) is not present in table …``), constraint names and
    table names. This string is returned to this API's caller, so free text
    from another service's database is not something it may forward; the full
    body stays in coord's own logs, where it belongs.

    An object carrying neither identifier is DESCRIBED by its field names
    rather than dumped — names are schema, not data, and they are what says
    which of coord's error paths answered.
    """
    text: str
    if isinstance(raw, dict):
        parts = [
            part for part in (_coord_error_field(raw), _coord_error_code(raw)) if part
        ]
        if parts:
            text = ": ".join(parts)
        else:
            keys = ", ".join(sorted(str(key) for key in raw)[:6]) or "none"
            text = f"unrecognised coord error body (keys: {keys})"
    else:
        text = f"unrecognised coord error body ({type(raw).__name__})"
    if len(text) > _REASON_MAX_CHARS:
        text = text[: _REASON_MAX_CHARS - 1] + "…"
    return f"coord could not read citations: {text}"


#: coord's error code for ``CitationListing::SurfaceUnavailable`` — *the unit
#: is yours, and the relation backing the citation join is absent* (``42P01``,
#: a pre-migration window). It is the value of the ``error`` field of the 503
#: body, and it is what tells this read that a 503 on the citation sub-resource
#: is coord ANSWERING rather than coord being unreachable.
_CITATION_SURFACE_UNAVAILABLE = "citation_surface_unavailable"


def _detail_text(detail: object) -> str:
    """coord's response body as text, however ``_proxy_coord_get`` wrapped it.

    That helper raises ``HTTPException(status_code=resp.status_code,
    detail=resp.text)``, so the body is already in hand — but its own transport
    mapping raises a plain string instead, and a caller must not have to know
    which.
    """
    if isinstance(detail, str):
        return detail
    return str(detail)


def _parse_error_body(body: str) -> object | None:
    """coord's error body as JSON, or ``None`` when it is not JSON at all.

    An infrastructure 503 is an HTML page from a load balancer or a plain-text
    line from the proxy's own transport mapping; coord's own errors are JSON
    objects. Which of the two this is decides BOTH how the status is classified
    (:func:`_is_transport_failure`) and how much of the body may be echoed
    (:func:`_safe_body_excerpt`), so it is parsed ONCE here and the result
    handed to both — two parses could disagree.
    """
    try:
        parsed: object = json.loads(body)
    except (ValueError, TypeError):
        return None
    return parsed


def _coord_error_field(parsed: object) -> str | None:
    """coord's own error CODE — the ``error`` field of a JSON error body.

    It is matched by EQUALITY wherever it decides control flow. A substring
    test against the whole body would also fire on a body that merely QUOTES
    the code — a coord 500 whose Postgres error text names the failing query,
    say — and the one thing the 503 carve-out must never do is read an
    infrastructure failure as coord answering.
    """
    if isinstance(parsed, dict):
        error = parsed.get("error")
        if isinstance(error, str) and error:
            return error
    return None


def _coord_error_code(parsed: object) -> str | None:
    """The Postgres SQLSTATE coord attached, from either place it puts it.

    coord's hand-rolled ``citation_surface_unavailable`` body carries
    ``pg_code`` at the TOP level; its generic ``pg_error.to_body()`` nests the
    same thing at ``pg.code``. Both are read, because which one arrives depends
    on which of coord's error paths answered, and the SQLSTATE is the field
    that tells an operator whether to wait for a migration (``42P01``) or to
    page someone.
    """
    if not isinstance(parsed, dict):
        return None
    code = parsed.get("pg_code")
    if isinstance(code, str) and code:
        return code
    pg = parsed.get("pg")
    if isinstance(pg, dict):
        nested = pg.get("code")
        if isinstance(nested, str) and nested:
            return nested
    return None


def _safe_body_excerpt(body: str, parsed: object) -> str:
    """What of coord's error body may ride out in ``unavailable_reason``.

    A WHITELIST, not a redaction: the ``error`` code and the SQLSTATE, and
    nothing else. Never the body, never an excerpt of it.

    ``unavailable_reason`` is returned to THIS api's caller, and — because the
    page-wide circuit stores the first tripping reason and repeats it on every
    remaining row (:meth:`_CoordProbe._trip`) — it is returned STICKILY, on
    rows that never talked to coord at all. coord's ``pg_error.to_body()``
    carries the full anyhow chain plus structured Postgres fields, and
    ``pg.detail`` routinely contains ROW VALUES (``Key (tenant_id)=(…) is not
    present in table …``), constraint names and table names. Capping such a
    body at N characters does not make it safe — the row value is in the first
    N — so the fix is to name the fields that may cross rather than to trim the
    ones that may not.

    Those two identifiers are enough to act on: they separate "wait for the
    migration" (``42P01``) from "page someone", which is the whole decision an
    operator makes here. The rest of the body is in coord's own logs.

    A body that does not parse as JSON is not a coord error object at all, and
    it has no identifiers to lift — so it is DESCRIBED (its size) rather than
    echoed. An ALB's HTML page carries nothing an operator needs that the 502
    or 503 beside it does not already say.
    """
    if parsed is not None:
        identifiers = [
            part
            for part in (_coord_error_field(parsed), _coord_error_code(parsed))
            if part
        ]
        if identifiers:
            return ": ".join(identifiers)
        # JSON, but with nothing this read recognises as an identifier. Naming
        # the FIELDS beats both silence (which loses the only breadcrumb) and
        # dumping a body whose fields are unknown to this read — unknown fields
        # are exactly the ones that might carry values. Names are schema.
        if isinstance(parsed, dict):
            keys = ", ".join(sorted(str(key) for key in parsed)[:6]) or "none"
            return f"unrecognised coord error body (keys: {keys})"
        return f"unrecognised coord error body ({type(parsed).__name__})"

    stripped = body.strip()
    if not stripped:
        return ""
    return f"non-JSON body ({len(stripped)} bytes)"


def _is_transport_failure(
    http_status: int,
    *,
    body_error: str | None = None,
    answered_marker: str | None = None,
) -> bool:
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

    ``answered_marker`` — the ONE exception, and it is granted on the BODY, not
    on the status. coord's citation read answers ``503`` with
    ``{"error": "citation_surface_unavailable", …}``, which is coord ANSWERING
    about one sub-resource — the same class as the 401/403/405 above, one
    status band up. It must land as a per-slug ``unavailable`` and must NOT
    trip the page-wide circuit, or a schema-migration window would report the
    whole of coord as down and blank the work-unit half of every remaining row
    (which reads fine).

    ``body_error`` is the ``error`` field lifted out of a PARSED body
    (:func:`_coord_error_field`), and the carve-out needs it to EQUAL the
    marker. Not to contain it: a substring test over the raw body also passes
    for a body that merely QUOTES the code — coord's own Postgres error text
    naming the failing query is enough — and "the body mentions this string"
    is not the same claim as "coord declared this error". A body with no
    ``error`` field at all, which is every infrastructure 503, yields ``None``
    and therefore never matches.

    Keying it on the marker rather than on "the citations hop passed a flag" is
    what keeps the carve-out as narrow as it claims to be. The tempting
    argument — *the citations hop only runs after the presence hop succeeded,
    so coord is provably up* — is FALSE across the gap between two sequential
    requests: coord can go down between them (a deploy, an ECS rotation, an ALB
    target drain), and then an infrastructure 503 would be read as "coord
    answered" and leave ``coord_available`` reporting true through a total
    outage. An ALB's untyped 503 declares no error, so it still trips.
    """
    if (
        http_status == 503
        and answered_marker is not None
        and body_error == answered_marker
    ):
        return False
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

    ``actor_kind`` picks WHICH of coord's two door tiers the reads go to, and
    it is not a preference — each tier rejects the other's credential. This
    probe forwards the caller's captured bearer verbatim
    (``_proxy_coord_get(..., forward_bearer=True)``), and that bearer is a
    Cognito user JWT for the operator page but the runner's coord DEVICE JWT
    for a request that arrived through ``mcp/plan_library.rs``. coord's
    ``/coord/work-units/...`` reads resolve their tenant from an
    ``OperatorContext`` and answer a device JWT with 403 ``tenant_not_resolved``;
    its ``/coord/agent-work-units/...`` twins lift the tenant from the verified
    device JWT and reject a Cognito bearer. Sending every caller to one tier is
    exactly why a runner-originated ``/candidates`` read reported
    ``unavailable`` for every linked row.

    The kind comes from the DEPENDENCY that authenticated the request
    (:class:`~app.api.deps.ActorPrincipal`), never from inspecting the token
    here: the dependency has already decided which arm answered, and a second
    guess in the probe could only drift from the first. Nor is it discovered by
    trying the operator door and falling back on 403 — a 403 is also what a
    genuine cross-tenant read returns, so that fallback would paper over a
    tenant-boundary error, and it doubles the round-trips on the hot path.

    It is REQUIRED rather than defaulted: a default would silently reinstate
    exactly this bug at the next call site that forgets the argument, and the
    failure mode is a quiet ``unavailable`` rather than an exception.
    """

    def __init__(self, tenant_id: UUID | None, *, actor_kind: ActorKind) -> None:
        self.tenant_id = tenant_id
        self.actor_kind: ActorKind = actor_kind
        #: The coord door tier this probe's reads go to. Both hops use it —
        #: the presence read is on the same operator/agent split as the
        #: citations read, so routing only the citations hop would leave a
        #: device caller reading ``work_unit_state: "unavailable"`` on every
        #: row: the same bug, one level up.
        self._coord_base = (
            "/coord/agent-work-units" if actor_kind == "device" else "/coord/work-units"
        )
        self.degraded = False
        self.reason: str | None = None
        self._gate = asyncio.Semaphore(_COORD_FANOUT)

    def _trip(self, reason: str) -> None:
        self.degraded = True
        if self.reason is None:
            self.reason = reason

    async def _get(
        self, path: str, *, answered_marker: str | None = None
    ) -> tuple[object | None, int | None, str | None]:
        """``(payload, http_status, error)`` — never raises.

        ``http_status`` is coord's status when it answered with one (404 is a
        real answer: "no such work unit"); ``error`` is set when the call
        could not be completed at all.

        The circuit trips on TRANSPORT-CLASS failures only — see
        :func:`_is_transport_failure`. A 4xx is coord answering *about this
        route*, which says nothing about whether the next slug's read will
        work, and tripping on one made ``coord_available`` permanently false:
        against a coord that has not yet shipped the citation GET, a read
        there NEVER 404s — it 401/403s (the ``require_jwt`` layer in front of
        the ``post``/``delete`` registration rejects the forwarded bearer) or
        405s (method mismatch). That is the same reasoning :meth:`link_for`
        already applies to the citations hop itself ("absence of a route is
        not evidence of an absence of PRs"); the circuit obeys it too, or the
        one flag whose job is signalling a real coord outage can never do so.

        ``answered_marker`` forwards to :func:`_is_transport_failure` and
        extends that same reading to coord's typed ``503`` on the citations
        sub-resource — but only when coord's own error code is in the body, so
        an untyped 503 from a load balancer still trips.

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
                # coord's body is already in hand (``_proxy_coord_get`` puts
                # ``resp.text`` in ``detail``), and it is what separates a typed
                # answer from an infrastructure failure — so it decides the
                # classification AND supplies the reason, rather than the
                # status being discarded into a bare "coord returned 503".
                #
                # It is parsed once. Reading it and ECHOING it are separate
                # concerns and only the echo is dangerous: ``detail`` becomes
                # ``self.reason`` on a trip and is then repeated on every
                # remaining row of the page, so an excerpt of coord's error body
                # would egress another service's Postgres internals — row values
                # included — stickily, into this API's response. So the body
                # decides the classification in full, while only its whitelisted
                # identifiers cross into the reason
                # (:func:`_safe_body_excerpt`).
                body = _detail_text(exc.detail)
                parsed = _parse_error_body(body)
                detail = f"coord returned {exc.status_code}"
                excerpt = _safe_body_excerpt(body, parsed)
                if excerpt:
                    detail = f"{detail}: {excerpt}"
                if _is_transport_failure(
                    exc.status_code,
                    body_error=_coord_error_field(parsed),
                    answered_marker=answered_marker,
                ):
                    self._trip(detail)
                return None, exc.status_code, detail
            except Exception as exc:  # noqa: BLE001 — degrade, never 500
                detail = f"coord read failed: {exc}"
                self._trip(detail)
                return None, None, detail
        return payload, 200, None

    @staticmethod
    def _inline_citations(payload: object) -> tuple[list[object], str | None] | None:
        """Citations coord already attached to the PRESENCE payload, if any.

        coord's AGENT by-slug read returns ``citations`` (and, when the read
        did not happen, ``citations_error``) inline; its operator twin
        deliberately does not, keeping the dashboard payload lean. So this is
        an opportunistic short-circuit, not a contract: ``None`` means the
        payload carried no citation key at all and the caller must make the
        second hop.

        Otherwise ``(rows, error)``. A non-``None`` ``error`` means coord told
        us the read did not happen — ``citations_error`` sits beside an EMPTY
        list precisely so that list cannot be mistaken for an observation of
        zero, and flattening the two would destroy the one property this whole
        block exists to protect. The error field alone is enough to detect the
        block: coord's sibling ``delivery``/``delivery_error`` pair OMITS the
        value key entirely when the read failed, so keying only on ``citations``
        would miss the shape its own neighbour already uses.

        A ``citations`` that is present but is NOT a list is likewise an error,
        not an empty list. This method shape-sniffs by design, so the one thing
        it must never do with an unrecognised shape is report it as an
        observation of zero.
        """
        if not isinstance(payload, dict):
            return None
        if "citations" not in payload and "citations_error" not in payload:
            return None

        error = payload.get("citations_error")
        if error is not None:
            return [], _citation_error_text(error)

        raw = payload.get("citations")
        if not isinstance(raw, list):
            # Built here rather than routed through :func:`_citation_error_text`:
            # this sentence is OURS, not coord's body, so the whitelist that
            # function applies to another service's error object does not apply
            # — and the observed type is the whole diagnostic.
            return [], (
                "coord could not read citations: unrecognised_citations_shape: "
                f"coord returned `citations` as {type(raw).__name__}, not a list"
            )
        return list(raw), None

    async def link_for(self, slug: str) -> CandidateCoordLink:
        """Resolve one work-unit slug into its coord block.

        Two hops, both over coord's HTTP API, and both on the door tier the
        CALLER's credential can actually open (``self._coord_base`` —
        ``/coord/work-units`` for an operator, ``/coord/agent-work-units`` for
        a device; see the class docstring for why that is not a preference):

        1. ``{base}/{slug}`` — presence. A 404 here is the NORMAL dangling
           case (the link is FK-less by design), and it also settles the PR
           question: citations hang off the work unit by a hard FK, so no unit
           really does mean no citations.
        2. ``{base}/{slug}/citations`` — the PR citations, with the live
           merged state coord's own ``shipped`` predicate reduces (coord
           projects each row to
           ``{repo, pr_number, merged, branch, cited_at, sources}``).

        Hop 2 is SKIPPED when hop 1 already answered it: the agent by-slug read
        carries its citations inline (:meth:`_inline_citations`), so a
        device-principal page pays one round-trip per slug instead of two —
        and works against a coord that has not yet shipped the dedicated
        sub-resource. One consequence worth knowing: a device caller therefore
        never reaches the 503 branch below, because the same
        surface-unavailable condition reaches it as an inline
        ``citations_error`` instead. Both land on ``unavailable``.

        coord's three-state answer on the citations sub-resource maps straight
        onto this block. ``200`` → ``available``, and an empty list there IS an
        observation of zero. ``404`` → the unit is not ours, or not there.
        ``503`` carrying coord's ``citation_surface_unavailable`` code (the
        citation relation is unreadable) → ``unavailable`` for THIS slug and,
        deliberately, nothing at all about coord's health: coord answering about
        one sub-resource is coord answering. An UNTYPED 503 keeps its ordinary
        transport reading and still trips the circuit (see
        :func:`_is_transport_failure`).

        A successful read can still carry a caveat: ``merged_degraded_reason``
        says coord's ``merged`` predicate is running degraded, so a
        ``merged: false`` on those rows is UNKNOWN rather than "unmerged" — see
        :func:`_coord_pr`. Both hops honour it, off whichever payload carried
        the citations; the inline path must, because it is the ONLY path a
        device caller takes.

        Absence of a route, of permission, or of a readable relation is never
        evidence of an absence of PRs. Reporting an empty PR list in any of
        those cases would assert a fact this read has not established.

        Reading the citations out of coord's Postgres instead is NOT the
        workaround: the web→coord read boundary is closed and
        ``tests/test_coord_schema_boundary_guard.py`` enforces it.
        """
        encoded = quote(slug, safe="")
        payload, http_status, error = await self._get(f"{self._coord_base}/{encoded}")

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

        inline = self._inline_citations(payload)
        if inline is not None:
            rows, inline_error = inline
            if inline_error is not None:
                link.linked_prs_state = "unavailable"
                link.unavailable_reason = inline_error
                return link
            link.linked_prs_state = "available"
            # Both coord doors carry ``merged_degraded_reason`` on the same
            # terms — same field name, same body, present only while the
            # predicate is degraded — so the caveat is read off THIS payload
            # exactly as the sub-resource branch reads it off its own. It has
            # to be: the inline path short-circuits hop 2, so a device caller
            # never reaches that branch, and it is the caller this read exists
            # to unbreak. ``merged: None`` on these rows means UNKNOWN, never
            # "unmerged" (:func:`_coord_pr`).
            #
            # ONE field name, ONE predicate, ONE place. The degradation is not
            # re-derived here from ``delivery.evidence_complete`` (which
            # over-fires on gaps that have nothing to do with the merged arm)
            # nor by matching prose in ``evidence_gaps`` (which couples this
            # read to coord's wording); a second implementation would drift
            # from coord's own.
            link.linked_prs = [
                _coord_pr(row, merged_is_degraded=_merged_is_degraded(payload))
                for row in rows
            ]
            return link

        cites, cite_status, cite_error = await self._get(
            f"{self._coord_base}/{encoded}/citations",
            # A 503 whose body carries coord's own code is an answer about the
            # citation relation, not a verdict on coord's reachability. An
            # untyped 503 is still an outage and still trips.
            answered_marker=_CITATION_SURFACE_UNAVAILABLE,
        )
        if cites is None:
            # Includes 401/403/404/405 and coord's typed 503 — absence of a
            # route, of permission to call it, or of a readable citation
            # relation is not evidence of an absence of PRs. None of those
            # trips the page-wide circuit; see ``_is_transport_failure``.
            link.linked_prs_state = "unavailable"
            link.unavailable_reason = (
                cite_error or f"coord returned {cite_status} for citations"
            )
            return link

        sub = self._inline_citations(cites)
        if sub is not None and sub[1] is not None:
            # A forward guard, not a shape coord emits today: the sub-resource
            # answers 503 rather than flagging a 200. But a body that says the
            # read did not happen still means it did not happen, whatever the
            # status line says — and the inline twin already uses this shape.
            link.linked_prs_state = "unavailable"
            link.unavailable_reason = sub[1]
            return link

        link.linked_prs_state = "available"
        link.linked_prs = [
            _coord_pr(row, merged_is_degraded=_merged_is_degraded(cites))
            for row in _citation_rows(cites)
        ]
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
    "/export",
    summary="Bulk export the filtered corpus as a zip of verbatim .md files",
    response_class=Response,
    responses={
        200: {
            "content": {"application/zip": {}},
            "description": "A zip archive; one `<kind>/<slug>.md` per artifact.",
        }
    },
)
async def export_corpus(
    kind: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    repo: str | None = Query(None),
    q: str | None = Query(None),
    since: datetime | None = Query(None),
    work_unit_slug: str | None = Query(None),
    limit: int = Query(
        _EXPORT_MAX_ARTIFACTS,
        ge=1,
        le=_EXPORT_MAX_ARTIFACTS,
        description="Hard bound on archived artifacts. When it truncates, the "
        "response says so in `X-Export-Truncated` — a silently short export is "
        "indistinguishable from a short corpus.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> Response:
    """The bulk half of Phase 4 — the tenant's corpus back out as markdown.

    Plan ``2026-08-16-plan-corpus-authority-and-run-provenance`` Phase 4, which
    exists to pay for design decision D2 (the DB is authoritative for reads).
    Making the DB primary silently drops the **distributed durability** git gave
    for free: git keeps N copies, a database keeps one plus whatever backups
    exist. Before this route there was no export path at ALL — zero
    markdown-emitting exporters across qontinui-coord and this backend. That is
    not polish; it is the price of D2, and D5 says so explicitly.

    **Verbatim bodies, always.** Each entry is the stored body's UTF-8 bytes,
    unmodified — no re-rendered front matter, no normalized headings, no
    injected status block. The status block is already IN the body (it is the
    markdown the scanner captured), and re-rendering one would fork the exported
    text from the stored text. Fidelity is the whole product here, and it is
    exactly what Phase 4's gate measures: a plan exported and re-scanned must
    come back with an unchanged ``content_sha256``. Any transformation, however
    cosmetic, fails that round trip.

    **Export only, never import.** This route reads the authoritative store and
    emits copies. It has no write half by design (Risk: "export without
    discipline recreates the fork") — a bidirectional git sync would rebuild
    precisely the divergent-corpus problem this plan exists to close. Copies
    flow OUT of the authority; nothing flows back in except through the scanner.

    **No git push here.** D3 demotes git to an OPTIONAL per-tenant export
    target, so the archive is a plain download and **no tenant is required to
    own a repo**. A configured git target is a later, opt-in layer over this
    same byte stream, not a precondition for getting your plans out.

    The filter grammar is the list route's, verbatim (shared
    ``_apply_filters``), so "export what I am looking at" cannot drift from what
    the page showed.
    """
    org_id = await _resolve_org_id(db, current_user)
    rows, truncated = await crud.list_for_export(
        db,
        org_id=org_id,
        kind=kind,
        status=status_filter,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
        limit=limit,
    )

    buffer = io.BytesIO()
    # ZIP_DEFLATED: markdown compresses ~4x and the archive is streamed to a
    # browser. `strict_timestamps=False` so a pre-1980 authored_at (possible —
    # `authored_at` is scanner-supplied and unvalidated) cannot raise instead of
    # exporting.
    with zipfile.ZipFile(
        buffer, "w", compression=zipfile.ZIP_DEFLATED, strict_timestamps=False
    ) as archive:
        used: set[str] = set()
        manifest: list[dict[str, object]] = []
        for row in rows:
            name = _export_archive_name(row, used)
            archive.writestr(name, row.body.encode("utf-8"))
            manifest.append(
                {
                    "file": name,
                    "id": str(row.id),
                    "kind": row.kind,
                    "slug": row.slug,
                    "title": row.title,
                    "status": row.status,
                    "version_number": row.current_version,
                    "content_sha256": row.content_sha256,
                    "source_repo": row.source_repo,
                    "source_path": row.source_path,
                    "work_unit_slug": row.work_unit_slug,
                    "captured_by": row.captured_by,
                    "updated_at": row.updated_at.isoformat()
                    if row.updated_at
                    else None,
                }
            )
        # The manifest is provenance, not content: it records WHICH stored
        # version each file is a copy of, so a re-import or an audit can tell
        # whether a checked-out copy has drifted from the authority without
        # re-hashing anything. It is deliberately a sibling file rather than a
        # header injected into the bodies — see the verbatim rule above.
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "exported_at": datetime.now(UTC).isoformat(),
                    "artifact_count": len(rows),
                    "truncated": truncated,
                    "limit": limit,
                    "artifacts": manifest,
                },
                indent=2,
            ).encode("utf-8"),
        )

    if truncated:
        logger.warning(
            "plan_library.export.truncated",
            limit=limit,
            note="corpus exceeded the export bound; archive is incomplete",
        )

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": (f'attachment; filename="plan-library-{stamp}.zip"'),
            "X-Export-Artifact-Count": str(len(rows)),
            # Explicit on BOTH branches. A header present only when something
            # went wrong trains readers to ignore its absence.
            "X-Export-Truncated": "true" if truncated else "false",
        },
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
    principal: ActorPrincipal = Depends(get_audit_actor_principal),
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

    ``open_followups`` (Phase 7, additive) carries work that has **no plan
    yet** — open ``spawned_followup`` edges, oldest first. It is a separate
    list rather than extra ``items`` because a follow-up nobody has written is
    not an artifact and has no id to be a candidate with; folding it into
    ``items`` would mean inventing one. ``items`` is unchanged.

    Two principals reach this route (module docstring, invariant 7) and the
    coord half is fetched with whichever bearer they presented, so the coord
    reads follow the credential to the door tier that accepts it — the
    operator routes for a Cognito user, the ``agent-`` twins for the runner's
    device JWT. Nothing else about the response differs between them.
    """
    current_user = principal.user
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
        probe = _CoordProbe(tenant_id, actor_kind=principal.kind)
        slugs = sorted({r.work_unit_slug for r in rows if r.work_unit_slug})
        links = await _coord_links(slugs, probe)
        coord_available = not probe.degraded

    # Additive (Phase 7): work that has no plan yet. An unwritten follow-up is
    # not an artifact, so it can NEVER appear in ``items`` — and before this it
    # was invisible to the one read whose whole job is "what should I pick up
    # next". Bounded by the same ``limit`` and reported alongside its own
    # unpaged total; ``items`` keeps its shape exactly.
    followup_rows, followup_total = await crud.list_open_followups(
        db, org_id=org_id, offset=0, limit=limit
    )

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
        open_followups=[
            _open_followup(edge, origin, now) for edge, origin in followup_rows
        ],
        open_followup_total=followup_total,
    )


# NOTE: declared BEFORE ``/{artifact_id}`` so the literal path wins the match.
@router.get(
    "/followups",
    response_model=OpenFollowupResponse,
    summary="Follow-ups a plan identified but nobody owns yet",
)
async def list_open_followups(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> OpenFollowupResponse:
    """The queryable form of "worth its own plan".

    Phase 7 of ``2026-08-16-plan-corpus-authority-and-run-provenance``. A plan
    routinely surfaces work it deliberately does not do, and until this route
    that lived ONLY as prose in the plan body — unrecoverable from the data, so
    nothing could answer "show me follow-ups with no owning plan". It is now a
    ``spawned_followup`` edge whose ``to_id`` is still NULL, and this is the
    read that lists them.

    **Open only.** A follow-up that has been claimed
    (``PATCH /plan-library/edges/{edge_id}``) is an ordinary two-ended
    provenance edge and drops out of this list — but it is not deleted, and it
    stays on the originating artifact's edge list, so the trail from "this plan
    surfaced it" to "that plan owns it" survives the claim.

    **Oldest first**, and that is the useful default rather than an arbitrary
    one: an old unowned follow-up is work the fleet has known about and
    repeatedly not picked up. ``total`` is the unpaged count, so a bounded page
    can never be mistaken for the whole queue.
    """
    org_id = await _resolve_org_id(db, current_user)
    rows, total = await crud.list_open_followups(
        db, org_id=org_id, offset=offset, limit=limit
    )
    now = datetime.now(UTC)
    return OpenFollowupResponse(
        items=[_open_followup(edge, origin, now) for edge, origin in rows],
        total=total,
        offset=offset,
        limit=limit,
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
    principal: ActorPrincipal = Depends(get_audit_actor_principal),
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
    concrete reason: the two halves fail independently. The work unit can
    resolve while coord reports the citation relation unreadable (a ``503``
    ``SurfaceUnavailable``), or while a coord that has not yet shipped the
    citation read refuses the hop outright. Rendering an empty PR list in
    either case would assert something this read has not established.

    The coord reads go to the door tier the CALLING credential can open —
    coord's operator routes for a Cognito user, their ``agent-`` twins for the
    runner's device JWT — because each tier rejects the other's bearer.
    """
    current_user = principal.user
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
            probe = _CoordProbe(
                await _soft_tenant_id(request), actor_kind=principal.kind
            )
            coord_block = await probe.link_for(row.work_unit_slug)
        else:
            coord_block = CandidateCoordLink(
                work_unit_slug=row.work_unit_slug,
                work_unit_state="unavailable",
                linked_prs_state="unavailable",
                unavailable_reason="not fetched (include_coord=false)",
            )

    return _detail(row, versions, edges, coord_block)


@router.get(
    "/{artifact_id}/export",
    summary="One artifact as its verbatim markdown (head, or a given version)",
    response_class=Response,
    responses={
        200: {
            "content": {"text/markdown": {}},
            "description": "The stored body, byte-for-byte.",
        },
        404: {"description": "No such artifact, or no such version_number."},
    },
)
async def export_work_artifact(
    artifact_id: UUID,
    version_number: int | None = Query(
        None,
        ge=1,
        description="Export this historical snapshot instead of head. Reuses "
        "the shipped `agent.work_artifact_versions` log — nothing new is "
        "recorded to make an old version exportable.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> Response:
    """One artifact, back out as the markdown it came from.

    Plan ``2026-08-16-plan-corpus-authority-and-run-provenance`` Phase 4.

    **The body is emitted verbatim** — the stored UTF-8 bytes, with no
    re-rendering of any kind. This is what makes the phase's gate meaningful:
    export a plan, feed it back through the runner scanner, and its
    ``content_sha256`` must be unchanged. The digest is returned in
    ``X-Content-Sha256`` so a caller can check the round trip without a second
    request.

    ``version_number`` addresses the shipped version log
    (``agent.work_artifact_versions``, unique on
    ``(document_id, version_number)``) rather than only head — the plan asks for
    exactly this, and it costs nothing because the snapshots are already
    recorded.

    **Authorization is on the PARENT, not the version.** The artifact is
    resolved through the org-scoped read first, and only then is the version
    fetched by ``document_id``; ``document_id`` alone is not a boundary. A
    missing artifact and a missing version are both 404, and the version 404
    names the versions that DO exist rather than leaving the caller guessing.
    """
    org_id = await _resolve_org_id(db, current_user)
    row = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact not found: {artifact_id}",
        )

    if version_number is None or version_number == row.current_version:
        body = row.body
        digest = row.content_sha256
        exported_version = row.current_version
    else:
        snapshot = await crud.get_version(db, row.id, version_number)
        if snapshot is None:
            available = [v.version_number for v in await crud.list_versions(db, row.id)]
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    f"Artifact {artifact_id} has no version {version_number}. "
                    f"Recorded versions: {available or 'none'} "
                    f"(head is {row.current_version})."
                ),
            )
        body = snapshot.body
        digest = snapshot.content_sha256
        exported_version = snapshot.version_number

    return Response(
        content=body.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_export_filename(row.slug)}"'
            ),
            # Provenance travels beside the bytes, never inside them — see the
            # verbatim rule. A consumer can verify the round trip from headers
            # alone.
            "X-Content-Sha256": digest,
            "X-Artifact-Kind": row.kind,
            "X-Artifact-Slug": row.slug,
            "X-Artifact-Version": str(exported_version),
        },
    )


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


# NOTE: declared BEFORE ``/{artifact_id}/kind`` so the literal ``edges``
# segment cannot be swallowed by the artifact-id pattern.
@router.patch(
    "/edges/{edge_id}",
    response_model=WorkArtifactEdgeRead,
    summary="Claim an open follow-up by naming the artifact that owns it",
)
async def claim_followup_edge(
    edge_id: UUID,
    payload: WorkArtifactEdgeClaim,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> WorkArtifactEdgeRead:
    """Turn an open ``spawned_followup`` into a two-ended provenance edge.

    Phase 7 of ``2026-08-16-plan-corpus-authority-and-run-provenance``. When
    somebody finally writes the plan (or report, or prompt) that owns work an
    earlier plan surfaced, this is how the two get connected. The ORIGINAL edge
    row is updated rather than replaced: the follow-up drops out of
    ``GET /plan-library/followups`` but stays on the originating artifact's
    edge list, so the trail from "this plan surfaced it" to "that plan owns it"
    survives.

    Failure modes, each distinguished on purpose:

    * **404** — no such edge in the caller's organization scope. Edges carry no
      org of their own; the scope is inherited from the originating artifact,
      so an edge id is not a global handle.
    * **422 (relation)** — the edge is not a ``spawned_followup``. The other
      relations are two-ended already and there is nothing to claim.
    * **422 (target)** — ``to_id`` names no artifact the caller can see.
      Checked here so the message is actionable; the FK would otherwise
      surface it as a 500.
    * **409** — already claimed. Claiming is NOT idempotent across different
      targets: silently re-pointing the edge would erase the first claim with
      no trace and leave two callers each believing they own the work. The
      response names the current owner.
    """
    org_id = await _resolve_org_id(db, current_user)
    found = await crud.get_edge(db, edge_id, org_id=org_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact edge not found: {edge_id}",
        )
    edge, origin = found

    if edge.relation != SPAWNED_FOLLOWUP_RELATION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Edge {edge_id} has relation '{edge.relation}', which is "
                f"already two-ended. Only '{SPAWNED_FOLLOWUP_RELATION}' edges "
                "can be claimed."
            ),
        )

    if payload.to_id == edge.from_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "An artifact cannot claim the follow-up it surfaced itself — "
                "that would make it its own provenance peer."
            ),
        )

    target = await crud.get_artifact(db, payload.to_id, org_id=org_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Work artifact not found: {payload.to_id}",
        )

    try:
        claimed = await crud.claim_followup(db, edge_id, payload.to_id)
    except crud.FollowupAlreadyClaimed as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "followup_already_claimed",
                "message": str(exc),
                "edge_id": str(exc.edge_id),
                "to_id": str(exc.to_id),
            },
        ) from exc

    logger.info(
        "plan_library.followup_claimed",
        edge_id=str(claimed.id),
        from_id=str(claimed.from_id),
        from_slug=origin.slug,
        to_id=str(claimed.to_id),
        to_slug=target.slug,
        actor=_actor(current_user),
    )

    return WorkArtifactEdgeRead(
        id=claimed.id,
        from_id=claimed.from_id,
        to_id=claimed.to_id,
        relation=claimed.relation,
        note=claimed.note,
        created_by=claimed.created_by,
        created_at=claimed.created_at,
        # Relative to the artifact that SURFACED the work — the same frame
        # ``GET /{id}`` uses when it renders this edge on ``origin``.
        direction="outgoing",
        peer_kind=target.kind,
        peer_slug=target.slug,
        peer_title=target.title,
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

    **``spawned_followup`` is the exception, and the only one.** It records
    work this artifact SURFACED and deliberately did not do, which by
    definition has no artifact to point at yet, so it may be posted with BOTH
    endpoints omitted::

        {"relation": "spawned_followup", "note": "<text>", "to_id": null}

    ``note`` is then required and must not be blank — with no far end it is the
    entire content of the row, and an empty one puts an unactionable entry in
    the open-follow-ups queue forever. Supplying ``to_id`` is still allowed and
    records a follow-up that already has an owner; ``from_id`` is not, because
    the relation is inherently outgoing (this artifact surfaced that work).
    Re-posting the same note is idempotent on ``(from_id, relation, note)``,
    while a DIFFERENT note is a second follow-up — a plan may surface several.

    Every other relation still REJECTS a null target here, with a 422 rather
    than a database error. That is deliberate belt and braces:
    ``ck_work_artifact_edges_open_target`` would refuse the row anyway, but
    ``/candidates`` computes unmet dependencies by joining ``depends_on``
    through ``to_id``, so a null target slipping in would make a blocked plan
    read as ready — the failure is quiet enough to be worth two guards.

    A self-edge is refused. ``/candidates`` walks ``depends_on`` to compute
    unmet dependencies, so an artifact pointing at itself becomes its own
    permanently-unmet blocker and can never be reported as ready — and the
    prompt-chain walk would have to defend against the same cycle. There is
    no provenance relation an artifact can meaningfully hold with itself.
    """
    open_target_ok = payload.relation in RELATIONS_ALLOWING_OPEN_TARGET

    if payload.to_id is None and payload.from_id is None:
        if not open_target_ok:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Relation '{payload.relation}' requires a target: supply "
                    "exactly one of 'to_id' (outgoing) or 'from_id' "
                    "(incoming). Only "
                    f"'{SPAWNED_FOLLOWUP_RELATION}' may be recorded with no "
                    "far end, because the work it names has no artifact yet."
                ),
            )
    elif payload.to_id is not None and payload.from_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Supply exactly one of 'to_id' (outgoing) or 'from_id' (incoming).",
        )
    elif open_target_ok and payload.from_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"'{SPAWNED_FOLLOWUP_RELATION}' is always OUTGOING — this "
                "artifact surfaced that work. Omit 'from_id'; use 'to_id' only "
                "to record a follow-up that already has an owning artifact."
            ),
        )

    if open_target_ok and not (payload.note or "").strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"'{SPAWNED_FOLLOWUP_RELATION}' requires a non-empty 'note'. "
                "The follow-up has no artifact at the far end, so the note is "
                "the entire record of what was surfaced; a blank one occupies "
                "the open-follow-ups queue with nothing anyone can act on."
            ),
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
    peer: WorkArtifact | None = None
    if peer_id is not None:
        peer = await crud.get_artifact(db, peer_id, org_id=org_id)
        if peer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Work artifact not found: {peer_id}",
            )

    # No peer at all is the ONE-ENDED case, already narrowed to
    # ``spawned_followup`` above: the edge runs out of ``anchor`` into nothing.
    incoming = payload.from_id is not None
    edge, created = await crud.create_edge(
        db,
        from_artifact=peer if incoming and peer is not None else anchor,
        to_artifact=anchor if incoming else peer,
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
        direction="incoming" if incoming else "outgoing",
        peer_kind=peer.kind if peer is not None else None,
        peer_slug=peer.slug if peer is not None else None,
        peer_title=peer.title if peer is not None else None,
    )
