"""Helper-task portal proxy — web-side surface of the coord helper-task queue.

Helper-task-queue plan Phase 1.4 (web layer). Pure proxy: no web-side
storage. Coord owns the queue (``coord.helper_tasks`` / ``coord.helper_answers``,
routes in ``qontinui-coord/src/api/helper_task_routes.rs``); the web backend
forwards the caller's Cognito bearer so coord authorizes the operator (its
operator-hierarchy roles OR the custom ``helper`` operator_role) and scopes
every query to the caller's tenant.

Auth posture: ANY authenticated user may call these routes — including
helpers, who rank below viewer web-side and hold no management permission.
Tenant isolation and role gating are coord's job (``require_helper_or_operator``
+ the ``TenantId`` extractor); the web layer only requires authentication and
resolves the tenant via :func:`get_tenant_id` (which also captures the bearer
for forwarding).

Tenant scoping: coord defaults to the caller's HOME tenant. Like the
operations proxies, these routes honor the ``X-Qontinui-Active-Tenant``
override (captured by :func:`get_tenant_id`, forwarded by
``_tenant_headers``, membership-validated coord-side), so a caller who IS a
coord member of the task's tenant can point the portal at it.

PHASE-1 LIMITATION (documented gap): an EXTERNAL invited helper's coord home
tenant is their personal one, and coord has no cross-tenant membership grant
for helpers yet — so the override cannot resolve for them and they see an
empty queue. Full external-helper visibility requires coord-side tenant
membership for helpers. Owner-testing (an owner answering tasks in their own
tenant) is unaffected.

Degraded modes surfaced to the portal:

- coord 503 (``helper_task_queue_unavailable`` — tables not migrated) and
  coord unreachable/timeout (502/504) collapse to ``{"tasks": [],
  "available": false}`` on the list read, so the portal renders a friendly
  "no tasks right now" instead of an error screen.
- The answer POST keeps errors as errors (a helper's tapped verdict must
  never be silently dropped) but normalizes coord's 503 detail.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.coord_proxy import _proxy_coord_get, _proxy_coord_post, get_tenant_id
from app.api.deps import get_async_db, get_current_active_user_async
from app.models.organization import Organization, TeamMember, TeamRole
from app.models.user import User as UserModel

logger = structlog.get_logger(__name__)

router = APIRouter()

# Coord statuses collapsed to "queue unavailable" on the list read: 503 is
# coord's explicit not-migrated signal; 502/504 are the web proxy's
# coord-unreachable/timeout mappings.
_UNAVAILABLE_STATUSES = frozenset({502, 503, 504})

# Tenant-resolution failures that must degrade rather than error: 502/504
# (coord unreachable/timeout) plus 403 (``tenant_not_resolved`` — the caller
# is not a linked coord tenant member, e.g. a brand-new helper). Resolution
# happens INSIDE the handlers (not as a route dependency) precisely so these
# can be caught — ``Depends(get_tenant_id)`` would raise before any handler
# try/except runs.
_DEGRADABLE_TENANT_STATUSES = frozenset({403, 502, 504})


async def _resolve_tenant(request: Request, current_user: UserModel) -> UUID:
    """Call the ``get_tenant_id`` dependency function directly.

    Side effects (bearer + active-tenant capture into the proxy ContextVars)
    still run; the only difference from ``Depends(get_tenant_id)`` is that
    failures surface inside the handler where they can be degraded.
    """
    return await get_tenant_id(request, current_user)


class HelperAnswerRequest(BaseModel):
    """Body forwarded to coord ``POST /coord/helper-tasks/:id/answer``.

    ``verdict`` values are coord's snake_case ``HelperVerdict`` enum
    (``approve`` / ``reject`` / ``not_sure`` for a spot-check; ``choice_a`` /
    ``choice_b`` / ``choice_same`` for a compare). Coord validates the enum —
    the web layer only enforces shape.
    """

    verdict: str = Field(..., min_length=1, description="Helper verdict")
    reasons: list[str] = Field(
        default_factory=list,
        description="Preset reason codes selected on a reject",
    )
    free_text: str | None = Field(
        None, description="Optional free-text note (when the schema allows it)"
    )


@router.get("")
async def list_helper_tasks(
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict[str, Any]:
    """List the caller's-tenant open helper tasks (the portal work queue).

    Proxies coord ``GET /coord/helper-tasks?status=open`` → a bare array of
    ``HelperTask`` (camelCase wire shape). Wrapped here as ``{"tasks": [...],
    "available": true}`` so queue-unavailable degrades to the same shape with
    ``available: false`` instead of an error status. Tenant resolution runs
    in-handler so coord-unreachable / tenant-not-resolved degrade the same
    way instead of erroring out of the dependency.
    """
    try:
        tenant_id = await _resolve_tenant(request, current_user)
    except HTTPException as exc:
        if exc.status_code in _DEGRADABLE_TENANT_STATUSES:
            logger.info(
                "helper_tasks_tenant_unresolved_degraded",
                status_code=exc.status_code,
            )
            return {"tasks": [], "available": False}
        raise
    try:
        tasks = await _proxy_coord_get(
            "/coord/helper-tasks",
            params={"status": "open"},
            tenant_id=tenant_id,
        )
    except HTTPException as exc:
        if exc.status_code in _UNAVAILABLE_STATUSES:
            logger.info("helper_tasks_queue_unavailable", status_code=exc.status_code)
            return {"tasks": [], "available": False}
        raise
    if not isinstance(tasks, list):
        # Defensive: coord contract is a bare array.
        logger.warning(
            "helper_tasks_unexpected_payload", payload_type=type(tasks).__name__
        )
        return {"tasks": [], "available": False}
    return {"tasks": tasks, "available": True}


@router.post("/{task_id}/answer", status_code=201)
async def submit_helper_answer(
    task_id: UUID,
    body: HelperAnswerRequest,
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Submit the caller's verdict for a task.

    Proxies coord ``POST /coord/helper-tasks/:id/answer`` → 201 with the
    created ``HelperAnswer``. Coord enforces tenant isolation (404 when the
    task is not in the caller's tenant) and records the answer against the
    authenticated operator — never an argument-supplied identity.

    Unlike the list read, tenant-resolution failure here stays an ERROR (a
    verdict must never be silently dropped) — but normalized to the same 503
    ``helper_task_queue_unavailable`` detail the portal already understands.
    """
    try:
        tenant_id = await _resolve_tenant(request, current_user)
    except HTTPException as exc:
        if exc.status_code in _DEGRADABLE_TENANT_STATUSES:
            logger.info(
                "helper_answer_tenant_unresolved",
                status_code=exc.status_code,
            )
            raise HTTPException(
                status_code=503, detail="helper_task_queue_unavailable"
            ) from exc
        raise
    try:
        answer, status_code = await _proxy_coord_post(
            f"/coord/helper-tasks/{task_id}/answer",
            {
                "verdict": body.verdict,
                "reasons": body.reasons,
                "free_text": body.free_text,
            },
            tenant_id=tenant_id,
            return_status=True,
        )
    except HTTPException as exc:
        if exc.status_code == 503:
            raise HTTPException(status_code=503, detail="helper_task_queue_unavailable")
        raise
    return JSONResponse(content=answer, status_code=status_code)


@router.get("/status")
async def get_helper_status(
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict[str, Any]:
    """The caller's helper standing, for the frontend's /help routing.

    ``is_helper_only`` is true when the user holds at least one HELPER
    membership and no non-helper role in any *shared* (non-personal)
    organization — the signal the frontend uses to lock the session to the
    /help portal. Personal-organization ownership (auto-created at signup)
    is deliberately ignored: every user owns one, so it carries no signal.
    Superusers are never helper-only.
    """
    result = await db.execute(
        select(TeamMember.role, Organization.settings)
        .join(Organization, TeamMember.organization_id == Organization.id)
        .where(TeamMember.user_id == current_user.id)
    )
    has_helper_membership = False
    has_non_helper_shared_membership = False
    for role, settings in result.all():
        if role == TeamRole.HELPER.value:
            has_helper_membership = True
            continue
        is_personal = bool(settings and settings.get("is_personal"))
        if not is_personal:
            has_non_helper_shared_membership = True
    is_helper_only = (
        has_helper_membership
        and not has_non_helper_shared_membership
        and not current_user.is_superuser
    )
    return {
        "is_helper": has_helper_membership,
        "is_helper_only": is_helper_only,
    }
