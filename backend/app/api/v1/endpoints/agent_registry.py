"""Agent-registry proxy — per-user agent enable/disposition preferences.

Phase 4d of plan ``2026-07-28-migrate-claude-md-into-qontinui.md``. Pure
proxy: no web-side storage. Coord owns the registry (default agent rows)
and the per-user prefs; the web backend forwards the caller's Cognito
bearer so coord authorizes the operator and resolves the tenant from it
(the same T2b token-forwarding posture as the ``/operations/*`` proxies).

Routes:

- ``GET  /api/v1/agent-registry`` — the CURRENT USER's effective agent
  list: coord's registry rows overlaid with the caller's own prefs
  (``source: "user_pref"`` when a pref row exists, else ``"default"``).
- ``PUT  /api/v1/agent-registry/prefs/{agent_name}`` — upsert the caller's
  pref. ``user_id`` is taken from the AUTHENTICATED user server-side and
  is never accepted from the client body. Coord's 422 validation errors
  (``disposition_required`` — disabling a policy-required agent without
  choosing a disposition — and ``invalid_disposition``) are forwarded
  verbatim as structured JSON so the frontend can render the forced
  disposition choice inline.

DB-session posture (the ``/operations/*`` pinned-connection hazard): the
request-scoped fastapi-users dependency keeps its session-generator open
for the whole request — including any outbound coord HTTP call. These
routes instead authenticate via :func:`get_registry_user`, which verifies
the Cognito bearer in a dedicated short-lived session that is committed
and CLOSED before the handler's coord call runs. No DB connection is held
across the coord round-trip.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.coord_proxy import (
    ACTIVE_TENANT_HEADER,
    _caller_active_tenant,
    _caller_bearer,
    _extract_caller_token,
    _tenant_headers,
)
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.user import User

logger = structlog.get_logger(__name__)

router = APIRouter()

_COORD_TIMEOUT = httpx.Timeout(5.0)


async def get_registry_user(request: Request) -> User:
    """Authenticate the caller WITHOUT pinning a request-scoped DB session.

    Verifies the Cognito bearer (cookie or ``Authorization`` header — the
    same two sources ``CookieOrBearerScheme`` reads) against the user-pool
    JWKS and resolves/provisions the local ``auth.users`` row in a
    dedicated session that closes before the handler body runs — so the
    coord round-trip never holds a DB connection.

    Side effect: captures the bearer + ``X-Qontinui-Active-Tenant`` header
    into the shared proxy ContextVars so :func:`_tenant_headers` forwards
    them to coord (coord resolves the operator/tenant from the token).
    """
    from app.auth.cognito_user import (
        CognitoAuthError,
        verify_cognito_token_and_resolve_user,
    )

    token = _extract_caller_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    # Dedicated session: the provision-or-link path may create/link a user
    # row on first Cognito login, so it must commit. Closed before return.
    async with AsyncSessionLocal() as db:
        try:
            user = await verify_cognito_token_and_resolve_user(token, db)
        except CognitoAuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token.",
            ) from exc
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User is not active.",
            )
        await db.commit()

    _caller_bearer.set(token)
    _caller_active_tenant.set(request.headers.get(ACTIVE_TENANT_HEADER))
    return user


async def _coord_request(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
) -> Any:
    """Send an authenticated request to coord and return the JSON body.

    Forwards the captured caller bearer + active-tenant header (via
    :func:`_tenant_headers`). Coord 4xx/5xx bodies are forwarded as
    STRUCTURED ``HTTPException`` detail (parsed JSON when possible) so
    coord's 422 error codes (``disposition_required`` /
    ``invalid_disposition``) reach the frontend intact rather than as an
    opaque string.
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(None)
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.request(method, url, json=json_body, headers=headers)
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="coord is not reachable",
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="timeout waiting for coord",
            ) from exc
        except httpx.RequestError as exc:
            # Any other transport failure (ReadError, RemoteProtocolError,
            # ...) — coord unreachable rather than an application error.
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="coord is not reachable",
            ) from exc
    if resp.status_code >= 400:
        detail: Any
        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)
    return resp.json()


class AgentRegistryEntry(BaseModel):
    """One agent in the caller's effective registry view.

    The effective entry shape derived WEB-SIDE from coord's
    ``GET /coord/agent-registry`` rows + prefs: registry defaults overlaid
    with the caller's own pref (``source`` tells the frontend which one is
    in force).
    """

    agent_name: str
    purpose: str = ""
    spawn_path: str = ""
    model: str | None = None
    effort: str | None = None
    policy_required: bool = False
    fanout_bound: int | str | None = None
    enabled: bool = True
    disposition: str = Field("block", description="block | degrade | warn_proceed")
    source: str = Field("default", description="default | user_pref")


class AgentRegistryResponse(BaseModel):
    """Response envelope for ``GET /api/v1/agent-registry``."""

    agents: list[AgentRegistryEntry]


class AgentPrefUpdateRequest(BaseModel):
    """Client body for ``PUT /api/v1/agent-registry/prefs/{agent_name}``.

    Deliberately excludes ``user_id`` — the acting user is always the
    authenticated caller, resolved server-side. Disposition validity
    (``block`` / ``degrade`` / ``warn_proceed``) is coord's job; its 422
    ``invalid_disposition`` is forwarded through rather than duplicated
    here (a web-side copy of the enum would drift).
    """

    enabled: bool
    disposition: str | None = Field(
        None,
        description=(
            "Required by coord when disabling a policy-required agent: "
            "block | degrade | warn_proceed"
        ),
    )


def _split_registry_payload(
    payload: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split coord's ``GET /coord/agent-registry`` body into (rows, prefs).

    Contract: a dict with registry rows + prefs. Tolerates a bare array
    (registry rows only, no prefs) defensively.
    """
    if isinstance(payload, dict):
        rows_raw = payload.get("agents") or payload.get("registry") or []
        prefs_raw = payload.get("prefs") or []
    elif isinstance(payload, list):
        rows_raw, prefs_raw = payload, []
    else:
        logger.warning(
            "agent_registry_unexpected_payload", payload_type=type(payload).__name__
        )
        rows_raw, prefs_raw = [], []
    rows = [r for r in rows_raw if isinstance(r, dict)]
    prefs = [p for p in prefs_raw if isinstance(p, dict)]
    return rows, prefs


def _merge_effective(
    rows: list[dict[str, Any]],
    prefs: list[dict[str, Any]],
    user_id: str,
) -> list[AgentRegistryEntry]:
    """Overlay the CALLER's prefs onto the registry defaults.

    A pref row applies ONLY when its ``user_id`` exactly matches the
    caller. The fixed contract has web supplying ``user_id`` on every PUT,
    so every pref row must carry one — a row without it is off-contract
    and is dropped (logged), never attributed to the caller: rendering
    someone else's pref as the caller's "recorded preference" would defeat
    the honesty line on an authz-adjacent surface.
    """
    prefs_by_agent: dict[str, dict[str, Any]] = {}
    for pref_row in prefs:
        raw_uid = pref_row.get("user_id")
        if raw_uid is None:
            logger.warning(
                "agent_registry_pref_missing_user_id",
                agent_name=pref_row.get("agent_name"),
            )
            continue
        if str(raw_uid) != user_id:
            continue
        pref_name = pref_row.get("agent_name")
        if isinstance(pref_name, str) and pref_name:
            prefs_by_agent[pref_name] = pref_row

    entries: list[AgentRegistryEntry] = []
    for row in rows:
        name = row.get("agent_name")
        if not isinstance(name, str) or not name:
            continue
        pref = prefs_by_agent.get(name)
        enabled = bool(row.get("enabled", True))
        disposition = str(row.get("disposition") or "block")
        source = "default"
        if pref is not None:
            source = "user_pref"
            if pref.get("enabled") is not None:
                enabled = bool(pref["enabled"])
            if pref.get("disposition"):
                disposition = str(pref["disposition"])
        entries.append(
            AgentRegistryEntry(
                agent_name=name,
                purpose=str(row.get("purpose") or ""),
                spawn_path=str(row.get("spawn_path") or ""),
                model=row.get("model"),
                effort=row.get("effort"),
                policy_required=bool(row.get("policy_required", False)),
                fanout_bound=row.get("fanout_bound"),
                enabled=enabled,
                disposition=disposition,
                source=source,
            )
        )
    return entries


@router.get("", response_model=AgentRegistryResponse)
async def get_agent_registry(
    user: User = Depends(get_registry_user),
) -> AgentRegistryResponse:
    """The current user's effective agent list.

    Proxies coord ``GET /coord/agent-registry`` (registry rows + prefs;
    operator bearer forwarded, tenant resolved coord-side from it) and
    overlays the caller's own prefs into the effective shape the settings
    page renders.
    """
    payload = await _coord_request("GET", "/coord/agent-registry")
    rows, prefs = _split_registry_payload(payload)
    return AgentRegistryResponse(agents=_merge_effective(rows, prefs, str(user.id)))


@router.put("/prefs/{agent_name}")
async def put_agent_pref(
    agent_name: str,
    body: AgentPrefUpdateRequest,
    user: User = Depends(get_registry_user),
) -> dict[str, Any]:
    """Upsert the caller's pref for one agent.

    Proxies coord ``PUT /coord/agent-registry/prefs/{agent_name}`` with
    ``user_id`` set from the AUTHENTICATED user (never the client body).
    Coord's 422 error codes pass through as structured detail.
    """
    coord_body: dict[str, Any] = {
        "user_id": str(user.id),
        "enabled": body.enabled,
    }
    if body.disposition is not None:
        coord_body["disposition"] = body.disposition
    result = await _coord_request(
        "PUT",
        f"/coord/agent-registry/prefs/{quote(agent_name, safe='')}",
        json_body=coord_body,
    )
    if isinstance(result, dict):
        return result
    return {"result": result}
