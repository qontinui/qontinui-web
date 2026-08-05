"""Agent-registry proxy — per-user agent enable/disposition preferences.

Phase 4d of plan ``2026-07-28-migrate-claude-md-into-qontinui.md``. Pure
proxy: no web-side storage. Coord owns the registry (default agent rows)
and the per-user prefs; the web backend forwards the caller's Cognito
bearer so coord authorizes the operator and resolves the tenant from it
(the same T2b token-forwarding posture as the ``/operations/*`` proxies).

Routes:

- ``GET  /api/v1/agent-registry`` — the CURRENT USER's effective agent
  list. Proxies coord ``GET /coord/agent-registry/effective-for?user_id=…``
  and renders its ``EffectiveAgent`` rows VERBATIM. The fold
  (``pref.enabled ?? default_enabled``, ``pref.disposition ?? degrade``,
  and the ``source`` stamp) happens in coord and nowhere else — see
  :func:`get_agent_registry` for why re-deriving it here was a live bug.
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


#: Fields of coord's ``EffectiveAgent`` that ASSERT SOMETHING ABOUT
#: AUTHORIZATION, as opposed to describing the agent. Read strictly (absent or
#: null → 502); see :func:`_render_effective`.
_AUTHZ_FIELDS = ("enabled", "disposition", "source", "policy_required")


def _effective_rows(payload: Any, expected_user_id: str) -> list[dict[str, Any]]:
    """Pull the agent list out of coord's ``.../effective-for`` body.

    Contract: ``{"agents": [EffectiveAgent, ...], "folded_for": <uuid|null>}``.

    ``folded_for`` is **verified, not ignored**. Coord echoes the user its fold
    actually resolved against precisely so a caller can assert it, because a
    defaults-only body is a legitimate answer (a user with no prefs) and is
    otherwise indistinguishable from one where ``user_id`` never arrived.
    Coord's ``deny_unknown_fields`` rejects a MISSPELLED parameter with a 400,
    but a DROPPED one (an ingress rewriting the query, a ``COORD_URL`` carrying
    its own query string, a future refactor that assumes ``path`` is
    query-free, a renamed parameter) still yields a confident 200 with every
    row at ``source: "default"`` — telling a user who has recorded preferences
    that every agent sits at its registry default.

    That is the same confident-and-wrong shape as the bug this module was
    rewritten to remove, so it is a 502 rather than a render.
    """
    if isinstance(payload, dict):
        folded_for = payload.get("folded_for")
        if folded_for is None or str(folded_for) != expected_user_id:
            logger.error(
                "agent_registry_effective_folded_for_mismatch",
                expected=expected_user_id,
                got=folded_for,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord folded the agent registry for "
                    f"{folded_for!r}, not the authenticated user; refusing to "
                    "render another user's (or nobody's) preferences"
                ),
            )
        if "agents" not in payload:
            logger.error("agent_registry_effective_payload_missing_agents")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="coord returned no `agents` key on the effective registry",
            )
        rows_raw = payload.get("agents") or []
    else:
        # A bare array carries no `folded_for`, so it cannot be verified and
        # must not be rendered — an unverifiable authorization view is the
        # thing this module now refuses to produce.
        logger.error(
            "agent_registry_unexpected_payload", payload_type=type(payload).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="coord returned an unrecognized effective-registry payload",
        )
    rows: list[dict[str, Any]] = []
    for r in rows_raw:
        if isinstance(r, dict):
            rows.append(r)
        else:
            logger.warning(
                "agent_registry_effective_row_not_an_object",
                row_type=type(r).__name__,
            )
    return rows


def _render_effective(rows: list[dict[str, Any]]) -> list[AgentRegistryEntry]:
    """Render coord's ``EffectiveAgent`` rows verbatim.

    This function deliberately performs **no fold**. Coord's
    ``resolve_effective`` has already applied
    ``enabled = pref.enabled ?? default_enabled`` and
    ``disposition = pref.disposition ?? degrade``, and stamped ``source``.
    Re-deriving any of that here is what this module used to do and what
    broke it — see :func:`get_agent_registry`.

    Every field maps 1:1, so the response shape the settings page consumes is
    unchanged.

    ## The strict / permissive split

    :data:`_AUTHZ_FIELDS` — the four fields that ASSERT SOMETHING ABOUT
    AUTHORIZATION — are read with **no fallback**, and absent *or null* is a
    502. Everything else (purpose, model, effort, …) is cosmetic and stays
    permissive, so a coord that adds or drops a descriptive field never takes
    the settings page down.

    ``policy_required`` is in the strict set even though the write path fails
    closed independently (coord answers 422 ``disposition_required`` and the
    page opens the forced-disposition picker on that code). Nobody bypasses
    the choice — but the BADGE is still a claim about policy, and quietly
    defaulting it to ``False`` misreports one.

    Null counts as missing, not as a value: ``bool(None)`` is ``False`` and
    ``str(None)`` is ``"None"`` — a ``source`` of ``"None"`` renders through
    the page's *default* branch, misattributing coord's unknown state as
    "registry default". Coord's ``EffectiveAgent`` fields are non-``Option``
    today, so this cannot fire; the guard exists for the day that changes,
    and when it does it will be null-shaped rather than absent.

    That strictness is the whole lesson of the bug this replaced: the old
    code read ``row.get("enabled", True)`` off a route that never emitted
    ``enabled``, so it silently rendered every disabled agent as enabled for
    months. A missing authorization field must be LOUD.
    """
    entries: list[AgentRegistryEntry] = []
    for row in rows:
        name = row.get("agent_name")
        if not isinstance(name, str) or not name:
            logger.warning(
                "agent_registry_effective_row_missing_agent_name",
                agent_name_type=type(name).__name__,
            )
            continue
        unusable = [k for k in _AUTHZ_FIELDS if row.get(k) is None]
        if unusable:
            logger.error(
                "agent_registry_effective_row_missing_authz_fields",
                agent_name=name,
                missing=unusable,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned an off-contract effective agent row "
                    f"(agent {name!r} missing or null: {unusable}); refusing "
                    "to render an authorization state that is not the "
                    "system's"
                ),
            )
        entries.append(
            AgentRegistryEntry(
                agent_name=name,
                purpose=str(row.get("purpose") or ""),
                spawn_path=str(row.get("spawn_path") or ""),
                model=row.get("model"),
                effort=row.get("effort"),
                policy_required=bool(row["policy_required"]),
                fanout_bound=row.get("fanout_bound"),
                enabled=bool(row["enabled"]),
                disposition=str(row["disposition"]),
                source=str(row["source"]),
            )
        )
    return entries


@router.get("", response_model=AgentRegistryResponse)
async def get_agent_registry(
    user: User = Depends(get_registry_user),
) -> AgentRegistryResponse:
    """The current user's effective agent list, as folded by coord.

    Proxies ``GET /coord/agent-registry/effective-for`` and returns its
    ``EffectiveAgent`` rows unchanged — ``enabled``, ``disposition`` and
    ``source`` are coord's, not re-derived here. The operator bearer is
    forwarded and the tenant resolved coord-side from it; the folded user is
    always the authenticated caller, never a client-supplied id.
    """
    # ── Why this does NOT re-derive the fold ────────────────────────────────
    # Deliberately a comment, not docstring prose: this text would otherwise
    # ship verbatim as the route `description` in the committed OpenAPI
    # snapshot, which coord's route-serving observer reads as the declared
    # external surface. An API description should describe the API, not carry
    # a post-mortem.
    #
    # This route used to call `GET /coord/agent-registry` — the RAW rows door,
    # which serializes AgentRegistryRow (`default_enabled`,
    # `allowed_dispositions`) — and then read `row.get("enabled", True)` and
    # `row.get("disposition") or "block"`. NEITHER KEY EXISTS ON THAT ROUTE, so
    # both reads always took their fallback: every agent the operator had
    # disabled rendered as ENABLED, and every disposition rendered `block`,
    # regardless of configuration. A settings page asserting an authorization
    # state that is not the system's is the same failure shape as the
    # 2026-08-03 spawn outage, where the UI showed `enabled: true` for
    # continuations the runner was refusing.
    #
    # The fix deletes the fold rather than repairing it. `resolve_effective` is
    # ONE decision (`pref.enabled ?? default_enabled`,
    # `pref.disposition ?? degrade`) and it lives in coord; the web-side copy
    # was a THIRD independent implementation of it, beside coord's
    # `fold_strictest` and the runner's `lookup_row` — one more place to drift,
    # which is precisely what this work exists to remove.
    #
    # The fallback VALUE was wrong too: coord defaults an unset disposition to
    # `degrade`, per served policy `production-and-cost`
    # `agent-spawn-authorization` ("a disable arriving with NO recorded
    # disposition falls back to degrade — the only option that both honours the
    # cost decision and keeps the gate"). Web defaulted to `block`,
    # misreporting the gate as hard-stopping work.
    user_id = str(user.id)
    try:
        payload = await _coord_request(
            "GET",
            f"/coord/agent-registry/effective-for?user_id={quote(user_id, safe='')}",
        )
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        # DEPLOY ORDER, made self-diagnosing. `/effective-for` is newer than
        # this caller, so a coord that has not yet deployed it answers 404 —
        # and coord registers no axum fallback, so the body is EMPTY. Passed
        # through unchanged that surfaces as web's own 404 with a blank
        # reason, which reads as "this web route is missing" rather than
        # "coord is behind". Re-shape it into the 502 it actually is.
        logger.error("agent_registry_effective_for_route_absent_on_coord")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "coord does not serve GET /coord/agent-registry/effective-for "
                "yet — deploy qontinui-coord first; this endpoint will not "
                "fall back to re-deriving the effective view web-side"
            ),
        ) from exc
    return AgentRegistryResponse(
        agents=_render_effective(_effective_rows(payload, user_id))
    )


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
