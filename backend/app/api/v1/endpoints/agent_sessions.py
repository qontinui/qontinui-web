"""Agent sessions observability surface.

Side D / Phase 4 of plan
``D:/qontinui-root/plans/coord-agent-session-id-tracking.md`` — the
``/admin/agent-sessions`` panel backend.

Three read-only endpoints exposing the agent-session lineage data:

* ``GET /api/v1/admin/agent-sessions`` — list sessions with
  live/user/since/limit filters plus the session-identity-registry
  filters (q/status/device_id/repo).

* ``GET /api/v1/admin/agent-sessions/{key}`` — resolve a session by
  UUID or name to its full identity card(s)
  (``{"resolved": [...], "count": N}``).

* ``GET /api/v1/admin/agent-sessions/{session_id}/lineage`` — the
  per-session action timeline.

Architectural decision (Phase 2 of
``2026-05-30-web-coord-schema-boundary-decoupling.md``): the web
backend no longer reads coord's schema directly. Both endpoints proxy
to coord's HTTP API (``GET /coord/agent-sessions`` and
``GET /coord/agent-sessions/:id/lineage``, deployed via coord PR
#212), forwarding the caller's Cognito bearer so coord authorizes and
scopes the read. This keeps the web→coord boundary clean — coord owns
its tables; web is a presentation/authz layer over coord's HTTP API.

Auth: ANY AUTHENTICATED TENANT MEMBER (``get_current_active_user_async`` —
authn only). These reads are tenant-scoped by coord: ``get_agent_sessions_list``
filters ``coord.agent_sessions`` to the caller's effective tenant via the
session's device (``coord.devices.tenant_id``), and the ``:id`` resolver +
``:id/lineage`` routes apply the same per-session ownership guard, so a
developer never sees another tenant's sessions. (Previously ``require_admin`` —
that superuser gate was the only leak-prevention while coord was unscoped; it
was relaxed once coord gained tenant scoping so the console's "any member may
VIEW" design holds.) The caller's Cognito bearer + active-tenant selection are
forwarded so coord authorizes and scopes the read.
"""

from __future__ import annotations

import contextvars
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.deps import get_current_active_user_async
from app.core.config import settings
from app.models.user import User

logger = structlog.get_logger(__name__)
router = APIRouter()


# ---- Constants -----------------------------------------------------------

# Cap on rows returned by the list endpoint. The dashboard's typical
# query (`live=true`) is naturally bounded by concurrent Claude Code
# sessions on a fleet (low double digits). 500 covers the "show me
# every session in the last week" historical view without unbounded
# pagination machinery. Validated web-side before forwarding to coord.
_LIST_MAX_LIMIT = 500
_LIST_DEFAULT_LIMIT = 100

# Timeout for coord proxy reads. Mirrors operations.py — a small JSON
# payload served from PG; if coord takes longer than 5s something is
# wrong.
_COORD_TIMEOUT = httpx.Timeout(5.0)


# ---- Coord proxy plumbing -------------------------------------------------
#
# Replicates the web→coord call pattern from
# ``app.api.v1.endpoints.operations`` (``_caller_bearer`` ContextVar +
# ``_extract_caller_token`` + ``_proxy_coord_get``). These routes gate on
# authn only (``get_current_active_user_async``) and don't go through
# operations.py's bearer-capturing dependency — we capture the caller's
# bearer + active-tenant here (per-route ``Request`` param) so coord can
# authorize and TENANT-SCOPE the read on the forwarded token.


_caller_bearer: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "agent_sessions_caller_bearer", default=None
)

# The dashboard tenant-switcher selection. Forwarded to coord as
# ``X-Qontinui-Active-Tenant`` so coord re-scopes the operator's context to the
# chosen tenant (membership-validated coord-side; absent/invalid → home tenant).
# Mirrors operations.py ``_caller_active_tenant``. Captured per-route alongside
# the bearer and forwarded by ``_coord_headers``.
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"

_caller_active_tenant: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "agent_sessions_caller_active_tenant", default=None
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
    ``CookieOrBearerScheme`` reads (and the same logic operations.py uses
    to forward the bearer to coord)."""
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
    coord so coord authorizes on the token's operator identity. Mirrors
    operations.py ``_tenant_headers`` (bearer-only since T2b)."""
    headers: dict[str, str] = {}
    token = _caller_bearer.get()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # Forward the dashboard tenant-switcher selection so coord re-scopes the
    # operator's context to the chosen tenant (membership-validated coord-side).
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

    Same posture as operations.py ``_proxy_coord_get``: forwards the
    caller bearer, maps ``ConnectError`` → 502 and ``TimeoutException``
    → 504, and re-raises coord's own ``>= 400`` status with its body.
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


# ---- Name enrichment -------------------------------------------------------


def _with_name_fields(payload: Any) -> Any:
    """Enrich coord's ``{sessions, count}`` envelope with name fields.

    Plan ``2026-07-02-digital-twin-session-identity-registry``: each
    session row gains

    * ``derived_name`` — passed through from coord when present (the
      coord-side derivation ships in the companion coord PR); ``None``
      when coord has not yet deployed the column, and
    * ``name`` — the display name: ``label`` when set, else
      ``derived_name``.

    Fail-soft by construction: this endpoint proxies coord's envelope
    (it does NOT read coord's PG), so an older coord that doesn't emit
    ``derived_name`` yields ``derived_name=None`` / ``name=label`` —
    merge order between this PR and the coord PR is free. All existing
    fields pass through unchanged; unexpected shapes are returned
    verbatim.
    """
    if not isinstance(payload, dict):
        return payload
    sessions = payload.get("sessions")
    if not isinstance(sessions, list):
        return payload
    for row in sessions:
        if not isinstance(row, dict):
            continue
        derived = row.get("derived_name")
        row["derived_name"] = derived
        label = row.get("label")
        row["name"] = label if label else derived
    return payload


# ---- GET /admin/agent-sessions -------------------------------------------


@router.get("/agent-sessions")
async def list_agent_sessions(
    request: Request,
    live: bool = Query(
        False,
        description="If true, filter to live (not-yet-closed) sessions.",
    ),
    user_id: UUID | None = Query(
        None,
        description="If set, filter to sessions owned by this user.",
    ),
    since: datetime | None = Query(
        None,
        description=(
            "If set (RFC3339), filter to rows where last_seen >= since. "
            "Useful for 'activity in the last N hours' views."
        ),
    ),
    limit: int = Query(
        _LIST_DEFAULT_LIMIT,
        ge=1,
        le=_LIST_MAX_LIMIT,
        description=f"Max rows to return (capped at {_LIST_MAX_LIMIT}).",
    ),
    q: str | None = Query(
        None,
        description=(
            "Full-text topic search over session activity (coord-side). "
            "Pre-migration coord DBs degrade to name-only matching and "
            "flag the response with top-level `search_degraded: true`."
        ),
    ),
    status: Literal["live", "stale", "closed"] | None = Query(
        None,
        description="Derived session status filter (live | stale | closed).",
    ),
    device_id: UUID | None = Query(
        None,
        description="If set, filter to sessions from this coord device.",
    ),
    repo: str | None = Query(
        None,
        description="If set, filter to sessions whose activity touches this repo.",
    ),
    _user: User = Depends(
        get_current_active_user_async
    ),  # any authenticated tenant member
) -> Any:
    """List agent sessions via coord's ``GET /coord/agent-sessions``.

    Forwards the ``live`` / ``user_id`` / ``since`` / ``limit`` filters
    plus the session-identity-registry filters (``q`` / ``status`` /
    ``device_id`` / ``repo``, coord PR #894) as query params. ``limit``
    (1..500), the RFC3339 ``since``, the ``status`` vocabulary, and the
    UUID ``device_id`` are validated by FastAPI before forwarding.
    Returns coord's ``{"sessions": [...], "count": N}`` envelope with
    each session row enriched by ``derived_name`` (coord passthrough,
    ``None`` until the companion coord PR deploys) and a computed
    ``name`` (``label`` if set, else ``derived_name``) — see
    :func:`_with_name_fields`. All other fields — including the new
    per-row ``summary`` / ``status`` and the top-level
    ``search_degraded`` marker — pass through verbatim.
    """
    _capture_caller_context(request)

    params: dict[str, Any] = {"limit": limit, "live": live}
    if user_id is not None:
        params["user_id"] = str(user_id)
    if since is not None:
        params["since"] = since.isoformat()
    if q is not None:
        params["q"] = q
    if status is not None:
        params["status"] = status
    if device_id is not None:
        params["device_id"] = str(device_id)
    if repo is not None:
        params["repo"] = repo

    payload = await _proxy_coord_get("/coord/agent-sessions", params=params)
    return _with_name_fields(payload)


# ---- GET /admin/agent-sessions/{key} --------------------------------------


@router.get("/agent-sessions/{key}")
async def resolve_agent_session(
    request: Request,
    key: str,
    _user: User = Depends(
        get_current_active_user_async
    ),  # any authenticated tenant member
) -> Any:
    """Resolve a session by UUID **or** name via coord's
    ``GET /coord/agent-sessions/:id`` resolver (coord PR #894).

    Names can be ambiguous, so coord returns ``{"resolved": [card, ...],
    "count": N}`` newest-first and 404s only on zero matches. The
    envelope — full cards with ``machine`` / ``summary`` /
    ``working_on`` — passes through verbatim, including coord's 404
    (via :func:`_proxy_coord_get`'s ``>= 400`` re-raise).
    """
    _capture_caller_context(request)

    return await _proxy_coord_get(f"/coord/agent-sessions/{quote(key, safe='')}")


# ---- GET /admin/agent-sessions/{id}/lineage ------------------------------


@router.get("/agent-sessions/{session_id}/lineage")
async def get_agent_session_lineage(
    request: Request,
    session_id: UUID,
    _user: User = Depends(
        get_current_active_user_async
    ),  # any authenticated tenant member
) -> Any:
    """Return the per-session action timeline via coord's
    ``GET /coord/agent-sessions/:id/lineage``.

    Coord returns ``{"session_id": "...", "actions": [{kind, handle,
    occurred_at}]}`` already capped at 500 actions and never-404 (an
    unknown / soft-closed session yields an empty ``actions`` list). The
    payload passes through verbatim.
    """
    _capture_caller_context(request)

    return await _proxy_coord_get(f"/coord/agent-sessions/{session_id}/lineage")
