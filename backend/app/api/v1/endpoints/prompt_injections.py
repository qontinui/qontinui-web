"""Prompt-injection audit-log observability surface.

Phase 4 of the "Unified Coord Prompt-Injection Audit Log" plan — the
``/admin/prompt-injections`` panel backend.

Two read-only endpoints exposing coord's prompt-injection audit log:

* ``GET /api/v1/admin/prompt-injections`` — list injection events with
  ``limit`` / ``source`` / ``session_name`` / ``agent_session_id`` /
  ``since`` filters.

* ``GET /api/v1/admin/prompt-injections/{event_id}`` — the full event
  (including the FULL trigger output + injected prompt) for the lazy
  detail expand. Propagates coord's 404 on not-found.

Architectural posture (mirrors ``agent_sessions.py``): the web backend
does NOT read coord's schema directly. Both endpoints proxy coord's
HTTP API (``GET /coord/prompt-injections`` list +
``GET /coord/prompt-injections/:id`` detail), forwarding the caller's
Cognito bearer so coord authorizes and scopes the read. coord owns the
data; web is a presentation/authz layer over coord's HTTP API.

Auth: ``require_admin`` (superuser flag).
"""

from __future__ import annotations

import contextvars
from typing import Any
from urllib.parse import quote

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.admin_deps import require_admin
from app.core.config import settings
from app.models.user import User

logger = structlog.get_logger(__name__)
router = APIRouter()


# ---- Constants -----------------------------------------------------------

# Cap on rows returned by the list endpoint. The audit log is naturally
# bounded per-view; 500 covers the "show me every injection in the last
# week" historical view without unbounded pagination machinery.
# Validated web-side before forwarding to coord.
_LIST_MAX_LIMIT = 500
_LIST_DEFAULT_LIMIT = 100

# Timeout for coord proxy reads. Mirrors agent_sessions.py — a small JSON
# payload served from PG; if coord takes longer than 5s something is wrong.
_COORD_TIMEOUT = httpx.Timeout(5.0)


# ---- Coord proxy plumbing -------------------------------------------------
#
# Self-contained replica of the web→coord call pattern in
# ``app.api.v1.endpoints.agent_sessions``. These routes are
# ``require_admin``-gated, so they capture the caller's bearer +
# active-tenant selection per-route (``Request`` param) and forward both
# to coord for token-based authorization.


_caller_bearer: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "prompt_injections_caller_bearer", default=None
)

# The dashboard tenant-switcher selection. Forwarded to coord as
# ``X-Qontinui-Active-Tenant`` so coord re-scopes the operator's context to the
# chosen tenant (membership-validated coord-side; absent/invalid → home tenant).
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"

_caller_active_tenant: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "prompt_injections_caller_active_tenant", default=None
)


def _capture_caller_context(request: Request) -> None:
    """Capture the caller's bearer + active-tenant selection into the
    request-scoped ContextVars so ``_coord_headers`` can forward both to
    coord. Called at the top of each proxying route."""
    _caller_bearer.set(_extract_caller_token(request))
    _caller_active_tenant.set(request.headers.get(ACTIVE_TENANT_HEADER))


def _extract_caller_token(request: Request) -> str | None:
    """Pull the caller's bearer token from the ``access_token`` cookie or
    the ``Authorization`` header — the same two sources the backend's own
    ``CookieOrBearerScheme`` reads."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return None


def _coord_headers() -> dict[str, str]:
    """Forward the captured caller bearer (``Authorization: Bearer``) to
    coord so coord authorizes on the token's operator identity, plus the
    dashboard tenant-switcher selection."""
    headers: dict[str, str] = {}
    token = _caller_bearer.get()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    active = _caller_active_tenant.get()
    if active:
        headers[ACTIVE_TENANT_HEADER] = active
    return headers


async def _proxy_coord_get(
    path: str,
    *,
    params: dict[str, Any] | None = None,
) -> Any:
    """Proxy a GET request to coord and return the JSON body.

    Forwards the caller bearer, maps ``ConnectError`` → 502 and
    ``TimeoutException`` → 504, and re-raises coord's own ``>= 400``
    status with its body (so a 404 detail propagates as a 404).
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _coord_headers()
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, params=params, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


# ---- GET /admin/prompt-injections ----------------------------------------


@router.get("/prompt-injections")
async def list_prompt_injections(
    request: Request,
    limit: int = Query(
        _LIST_DEFAULT_LIMIT,
        ge=1,
        le=_LIST_MAX_LIMIT,
        description=f"Max rows to return (capped at {_LIST_MAX_LIMIT}).",
    ),
    source: str | None = Query(
        None,
        description=(
            "If set, filter to injections from this source "
            "(question_auto_answer | regex_submit_prompt | "
            "regex_resolve_scoring | session_bus_message | "
            "continuation_dispatch | spawned_session_initial)."
        ),
    ),
    session_name: str | None = Query(
        None,
        description="If set, filter to injections for this session name.",
    ),
    agent_session_id: str | None = Query(
        None,
        description="If set, filter to injections for this agent session id.",
    ),
    since: str | None = Query(
        None,
        description=("If set (RFC3339), filter to rows where created_at >= since."),
    ),
    _admin: User = Depends(require_admin),
) -> Any:
    """List prompt-injection events via coord's
    ``GET /coord/prompt-injections``.

    Forwards the ``limit`` / ``source`` / ``session_name`` /
    ``agent_session_id`` / ``since`` filters as query params. ``limit``
    (1..500) is validated by FastAPI before forwarding. Returns coord's
    ``{"events": [...], "count": N}`` envelope verbatim.
    """
    _capture_caller_context(request)

    params: dict[str, Any] = {"limit": limit}
    if source is not None:
        params["source"] = source
    if session_name is not None:
        params["session_name"] = session_name
    if agent_session_id is not None:
        params["agent_session_id"] = agent_session_id
    if since is not None:
        params["since"] = since

    return await _proxy_coord_get("/coord/prompt-injections", params=params)


# ---- GET /admin/prompt-injections/{event_id} ------------------------------


@router.get("/prompt-injections/{event_id}")
async def get_prompt_injection(
    request: Request,
    event_id: str,
    _admin: User = Depends(require_admin),
) -> Any:
    """Return the full prompt-injection event via coord's
    ``GET /coord/prompt-injections/:id`` — the lazy detail expand,
    including the FULL trigger output (``trigger_text``) and injected
    prompt (``injected_prompt``).

    coord 404s on not-found; that propagates as a 404 here (via
    :func:`_proxy_coord_get`'s ``>= 400`` re-raise).
    """
    _capture_caller_context(request)

    return await _proxy_coord_get(
        f"/coord/prompt-injections/{quote(event_id, safe='')}"
    )
