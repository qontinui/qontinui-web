"""Follow-up closure and anchor doors — ``/api/v1/plan-library/…``.

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
Phase 3 step 4 and Phase 5 step 2.

Routes
------
``PUT   /plan-library/edges/{edge_id}/anchors``     replace a follow-up's anchors (and optionally its size class)
``POST  /plan-library/edges/{edge_id}/resolution``  move a follow-up through its closure states
``POST  /plan-library/followups/match``             the open / ``fixing`` follow-ups on a diff's files
``POST  /plan-library/followups/reconcile``         settle ``fixing`` follow-ups from coord's land record

A sibling of ``app.api.v1.endpoints.plan_library`` [policy:
modular-code-and-file-size], mounted under the same ``/plan-library`` prefix
BEFORE it in ``app/api/v1/api.py`` — the order is load-bearing: that router's
``/{artifact_id}`` routes must never capture ``/edges/…`` or ``/followups/…``
(pinned through the real ``api_router`` by
``tests/test_plan_library_followups.py``). It shares that module's
``StrictQueryRoute`` class, its org resolver and its coord probe — imported,
never copied, so the two cannot drift; the dependency runs one way.

Every route admits a Cognito user OR a coord device JWT
(:func:`~app.api.deps.get_audit_actor_user`), like the rest of the library: the
runner's loopback door and the sessions it hosts hold only the device token.
The organization is always the principal's, never the body's.

Closure states (D1)
-------------------
``open`` → ``fixing`` (a PR that fixes it is open) | ``already_fixed`` (an
earlier commit fixed it) | ``dismissed`` (closed without a fix, with a reason);
``fixing`` → ``fixed`` (coord observed the PR land) | back to ``open`` (it closed
unlanded). A resting state may be reopened, with a reason — the store's
correction verb. Anything else is a 409 naming the current state.
"""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import quote
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    ActorPrincipal,
    get_async_db,
    get_audit_actor_principal,
    get_audit_actor_user,
)
from app.api.strict_query import StrictQueryRoute
from app.api.v1.endpoints.plan_library import (
    _actor,
    _CoordProbe,
    _resolve_org_id,
    _soft_tenant_id,
)
from app.crud import work_artifact as crud
from app.crud import work_artifact_followups as followups_crud
from app.models.user import User
from app.models.work_artifact import SPAWNED_FOLLOWUP_RELATION, WorkArtifactEdge
from app.schemas.plan_library_followups import (
    FollowupAnchorsReplace,
    FollowupMatchRequest,
    FollowupMatchResponse,
    FollowupReconcileResponse,
    FollowupResolutionRequest,
    FollowupWriteResponse,
)
from app.services.plan_library_followup_view import followup_match, open_followup

logger = structlog.get_logger(__name__)

router = APIRouter(route_class=StrictQueryRoute)


async def _resolve_followup(
    db: AsyncSession, edge_id: UUID, user: User
) -> tuple[WorkArtifactEdge, UUID | None]:
    """The follow-up edge in the caller's organization, and that organization.

    404 when the edge is not in scope (edges carry no org of their own; the
    scope is the originating artifact's), 422 when it is not a
    ``spawned_followup`` — the other relations are two-ended and carry neither
    anchors nor a closure state.
    """
    org_id = await _resolve_org_id(db, user)
    found = await crud.get_edge(db, edge_id, org_id=org_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact edge not found: {edge_id}",
        )
    edge, _ = found
    if edge.relation != SPAWNED_FOLLOWUP_RELATION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Edge {edge_id} has relation '{edge.relation}'. Only "
                f"'{SPAWNED_FOLLOWUP_RELATION}' edges carry anchors and a "
                "closure state."
            ),
        )
    return edge, org_id


async def _write_response(
    db: AsyncSession, edge_id: UUID, org_id: UUID | None, *, changed: bool
) -> FollowupWriteResponse:
    """Re-read the follow-up AS STORED and project it — the response is what
    the store holds after the write, never an echo of the request."""
    found = await crud.get_edge(db, edge_id, org_id=org_id)
    if found is None:  # pragma: no cover — it was resolved in this request
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Work artifact edge not found: {edge_id}",
        )
    edge, origin = found
    anchors = await followups_crud.load_anchors(db, [edge.id])
    return FollowupWriteResponse(
        changed=changed,
        followup=open_followup(edge, origin, anchors[edge.id], datetime.now(UTC)),
    )


# ───────────────────────────── anchors ─────────────────────────────


@router.put(
    "/edges/{edge_id}/anchors",
    response_model=FollowupWriteResponse,
    summary="Replace a follow-up's file anchors (and optionally its size class)",
)
async def replace_followup_anchors(
    edge_id: UUID,
    payload: FollowupAnchorsReplace,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> FollowupWriteResponse:
    """Say which files a follow-up is about — or why it names none.

    ``anchors`` REPLACES the stored set: each is ``owner/name`` + a
    repo-relative file path (forward slashes, no leading ``/``, no ``.`` /
    ``..`` segment, not a directory), with optional ``line_start`` /
    ``line_end`` / ``symbol`` hints. Matching is exact on ``(repo, path)``;
    lines drift and are hints only. An EMPTY set needs ``unanchored_reason``
    (an unanchored follow-up is visibly unanchored, never silently
    unmatchable); a non-empty one clears it.

    ``size_class`` + ``size_class_source`` (``declared`` | ``sweep``), when
    supplied together, set the class; omitted, the stored class is kept.

    This is the correction door for anchors: a wrong set is corrected by
    PUTting the right one. ``changed: false`` means the body restated what was
    stored and nothing was written. Works on any ``spawned_followup`` — open,
    resolved or claimed — because what a follow-up is ABOUT does not change
    with how it was closed.
    """
    _, org_id = await _resolve_followup(db, edge_id, current_user)
    try:
        _, changed = await followups_crud.replace_anchors(
            db,
            edge_id,
            anchors=[
                followups_crud.AnchorSpec(
                    repo=a.repo,
                    path=a.path,
                    line_start=a.line_start,
                    line_end=a.line_end,
                    symbol=a.symbol,
                )
                for a in payload.anchors
            ],
            unanchored_reason=payload.unanchored_reason,
            size_class=payload.size_class,
            size_class_source=payload.size_class_source,
        )
    except followups_crud.FollowupTransitionInvalid as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    logger.info(
        "plan_library.followup_anchors_replaced",
        edge_id=str(edge_id),
        anchors=len(payload.anchors),
        unanchored=payload.unanchored_reason is not None,
        size_class=payload.size_class,
        changed=changed,
        actor=_actor(current_user),
    )
    return await _write_response(db, edge_id, org_id, changed=changed)


# ───────────────────────────── resolution ─────────────────────────────


@router.post(
    "/edges/{edge_id}/resolution",
    response_model=FollowupWriteResponse,
    summary="Move a follow-up through its closure states (fixing, fixed, …)",
)
async def resolve_followup(
    edge_id: UUID,
    payload: FollowupResolutionRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> FollowupWriteResponse:
    """Record how a follow-up left — or returned to — the open queue.

    Legal transitions:

    * ``open`` → ``fixing`` (``resolution_pr``: the open PR that fixes it) |
      ``already_fixed`` (``resolution_commit``: the commit that fixed it
      earlier) | ``dismissed`` (``resolution_note``: why — required);
    * ``fixing`` → ``fixed`` (``resolution_commit``; normally written by the
      reconcile from coord's land record, not by hand) | ``open`` (its PR
      closed without landing);
    * ``fixed`` / ``already_fixed`` / ``dismissed`` → ``open``, with a
      ``resolution_note`` saying why the closure was wrong — the correction
      verb for a wrong closure.

    Anything else is a **409** ``followup_transition_conflict`` naming the
    current state and the legal next ones, decided under a row lock (so it
    names the state the row actually held). A claimed follow-up has no closure
    state (409). Restating the current state's facts is an idempotent replay —
    **200** with ``changed: false`` — while contradicting them (``fixing``
    under a different PR) is a 409. A request missing what its target needs is
    a **422**.

    Every transition appends ``{from, to, at, by, pr, commit, note}`` to the
    follow-up's ``resolution_history``.
    """
    _, org_id = await _resolve_followup(db, edge_id, current_user)
    actor = _actor(current_user)
    try:
        _, changed = await followups_crud.transition_followup(
            db,
            edge_id,
            to=payload.resolution,
            actor=actor,
            pr=payload.resolution_pr,
            commit=payload.resolution_commit,
            note=payload.resolution_note,
        )
    except followups_crud.FollowupTransitionConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "followup_transition_conflict",
                "message": str(exc),
                "edge_id": str(exc.edge_id),
                "current_state": exc.current_state,
                "requested": exc.requested,
                "legal": exc.legal,
                "resolution_pr": exc.resolution_pr,
            },
        ) from exc
    except followups_crud.FollowupTransitionInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    logger.info(
        "plan_library.followup_transitioned",
        edge_id=str(edge_id),
        to=payload.resolution,
        resolution_pr=payload.resolution_pr,
        changed=changed,
        actor=actor,
    )
    return await _write_response(db, edge_id, org_id, changed=changed)


# ───────────────────────────── match ─────────────────────────────


@router.post(
    "/followups/match",
    response_model=FollowupMatchResponse,
    summary="The open and fixing follow-ups anchored on a diff's files",
)
async def match_followups(
    payload: FollowupMatchRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> FollowupMatchResponse:
    """Which follow-ups are about the files this diff touches?

    ``{repo: "owner/name", paths: [...]}`` (up to 500 repo-relative paths) →
    every ``open`` and ``fixing`` follow-up with an anchor on one of them,
    oldest first, each with ``matched_anchors`` (the anchors the request hit).
    A ``fixing`` match is held by another PR and must not be folded twice.
    Matching is EXACT on ``(repo, path)`` — line hints never take part.

    A ``POST`` because 500 paths do not fit a query string; it reads and
    changes nothing.

    A zero is self-describing: ``repo_anchored_open_total`` (open follow-ups
    anchored anywhere in this repo) and ``unanchored_open_total`` (open ones
    that name no file at all, so no diff can ever match them) ride with every
    answer, empty or not.
    """
    org_id = await _resolve_org_id(db, current_user)
    result = await followups_crud.match_followups(
        db, org_id=org_id, repo=payload.repo, paths=payload.paths
    )
    now = datetime.now(UTC)
    paths = frozenset(payload.paths)
    return FollowupMatchResponse(
        repo=payload.repo,
        paths_requested=len(paths),
        items=[
            followup_match(
                edge,
                origin,
                result.anchors[edge.id],
                repo=payload.repo,
                paths=paths,
                now=now,
            )
            for edge, origin in result.rows
        ],
        matched_total=result.matched_total,
        truncated=result.truncated,
        repo_anchored_open_total=result.repo_anchored_open_total,
        unanchored_open_total=result.unanchored_open_total,
    )


# ───────────────────────────── reconcile ─────────────────────────────


class _ProbeLandReader:
    """coord's land record through :class:`_CoordProbe` — the caller's bearer,
    forwarded verbatim, behind the probe's fail-fast circuit.

    A transport-class failure trips the circuit once and every later read
    answers ``unknown`` (``coord_unavailable``) without paying another timeout;
    a 4xx is coord answering about THAT PR and leaves the circuit closed.
    """

    def __init__(self, probe: _CoordProbe) -> None:
        self._probe = probe

    @property
    def available(self) -> bool:
        return not self._probe.degraded

    @property
    def unavailable_reason(self) -> str | None:
        return self._probe.reason if self._probe.degraded else None

    async def read(self, repo: str, pr_number: int) -> followups_crud.LandVerdict:
        # ``repo`` is ``owner/name``; coord takes it as ONE path-encoded segment.
        path = f"/coord/pr/{quote(repo, safe='')}/{pr_number}/landed"
        payload, http_status, error = await self._probe._get(path)
        if error is None and payload is not None:
            return followups_crud.parse_land_verdict(payload)
        if self._probe.degraded:
            reason = "coord_unavailable"
        elif http_status is not None:
            reason = f"coord_http_{http_status}"
        else:
            reason = "coord_read_failed"
        return followups_crud.LandVerdict("unknown", unknown_reason=reason)


@router.post(
    "/followups/reconcile",
    response_model=FollowupReconcileResponse,
    summary="Settle fixing follow-ups from coord's land record",
)
async def reconcile_followups(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    principal: ActorPrincipal = Depends(get_audit_actor_principal),
) -> FollowupReconcileResponse:
    """Move this organization's ``fixing`` follow-ups whose PR coord has settled.

    For each ``fixing`` row (each distinct PR read once, from coord's
    ``GET /coord/pr/{repo}/{n}/landed``): ``landed`` → ``fixed``, stamped with
    coord's land commit when it holds one; ``closed_unlanded`` → back to
    ``open``; ``pending`` → unchanged; ``unknown`` → unchanged and counted
    with its reason. "Landed" is COORD's verdict, never GitHub's ``merged``
    flag — a coord fast-forward land reads ``CLOSED`` with no ``mergedAt`` on
    GitHub.

    coord is read with the CALLER's bearer (the same probe ``/candidates``
    uses, with its fail-fast circuit). A coord that cannot be read moves no
    row: ``coord_available: false``, and every row it could not read is in
    ``unknown`` — UNKNOWN, never "nothing to settle".

    The hand-run and in-session door. The scheduled ``followup_reconcile``
    task runs the SAME core over every organization through web's coord
    service identity, so a follow-up closes even when no session asks.
    """
    current_user = principal.user
    org_id = await _resolve_org_id(db, current_user)
    tenant_id = await _soft_tenant_id(request, actor_kind=principal.kind)
    reader = _ProbeLandReader(_CoordProbe(tenant_id, actor_kind=principal.kind))
    actor = f"followup_reconcile (requested by {_actor(current_user)})"
    outcome = await followups_crud.reconcile_fixing_followups(
        db, reader=reader, actor=actor, org_id=org_id
    )
    log = (
        logger.warning
        if outcome.unknown or not outcome.coord_available
        else logger.info
    )
    log(
        "plan_library.followups_reconciled",
        **outcome.as_dict(),
        actor=_actor(current_user),
        detail=(
            "rows counted unknown were left fixing: coord's verdict for them is UNKNOWN"
            if outcome.unknown
            else None
        ),
    )
    return FollowupReconcileResponse.model_validate(outcome.as_dict())
