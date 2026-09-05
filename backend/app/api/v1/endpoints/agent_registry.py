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
  OWN pref, proxied to coord's SELF door
  ``PUT /coord/agent-registry/prefs/me/{agent_name}``. The acting user is
  derived inside coord from the verified operator token; the forwarded body
  carries **no** ``user_id`` (coord's self-route body is
  ``deny_unknown_fields``, so sending one is a 422). Coord's 422 validation
  errors (``disposition_required`` — disabling a policy-required agent
  without choosing a disposition — and ``invalid_disposition``) are
  forwarded verbatim as structured JSON so the frontend can render the
  forced disposition choice inline, as are its two 403s (a plain
  authorization denial, and ``operator_not_provisioned_in_web`` — a coord
  operator whose verified email matches no ``auth.users`` row, which is an
  account-linking problem rather than a permissions one).
- ``GET  /api/v1/agent-registry/admin/registry`` — ADMIN: the raw
  ``coord.agent_registry`` rows (tenant defaults), each carrying a count of
  how many tenant members have a pref row overriding it.
- ``PUT  /api/v1/agent-registry/admin/registry/{agent_name}`` — ADMIN: edit
  one row's ``default_enabled`` / ``policy_required``. The forwarded body is
  MINIMAL (never a full row): coord's upsert is ``COALESCE``-preserving, and
  an earlier full-row shape is what once reset a seeded row's ``purpose``
  and ``fanout_bound``.

DB-session posture (the ``/operations/*`` pinned-connection hazard): the
request-scoped fastapi-users dependency keeps its session-generator open
for the whole request — including any outbound coord HTTP call. The two
per-user routes therefore authenticate via :func:`get_registry_user`, which
verifies the Cognito bearer in a dedicated short-lived session that is
committed and CLOSED before the handler's coord call runs. No DB connection
is held across the coord round-trip.

The two ``/admin/registry`` routes are the declared exception: they gate on
the shared :func:`require_coord_tenant_admin`, which resolves the operator's
coord role over HTTP and *does* depend on the request-scoped fastapi-users
session. That is the same posture every other admin-gated coord proxy in
``operations.py`` already has, and the alternative — a second, private
admin-resolution path so these two routes could keep the unpinned posture —
would be a third copy of the role check on the one surface whose whole job
is spawn authorization. Correctness of the gate beats connection economy on
a low-traffic operator surface; the per-user routes, which every session
hits, keep the unpinned posture.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote
from uuid import UUID

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
    require_coord_tenant_admin,
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


async def _coord_request_deploy_order_aware(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    coord_route: str,
    log_event: str,
    addendum: str = "",
) -> Any:
    """:func:`_coord_request`, with a coord that is BEHIND made self-diagnosing.

    Every route this module proxies is newer than some deployed coord, so a
    coord that has not yet shipped one answers **404** — and coord registers
    no axum fallback, so that body is EMPTY. Passed through unchanged it
    surfaces as web's own 404 with a blank reason, which reads as "this web
    route is missing" rather than "coord is behind". Re-shape it into the 502
    it actually is, naming the route and the remedy.

    **The empty body is the discriminator, and it is load-bearing.** These
    same coord routes answer 404 for an APPLICATION reason too — the pref
    doors return ``{"error": "unknown_agent", ...}`` when no registry row
    exists for the named agent. Translating that into "deploy qontinui-coord
    first" would be a confident misdiagnosis of a routine typo. A route-absent
    404 has no body at all; an application 404 always carries structured JSON.
    So only an EMPTY detail is re-shaped, and everything else — including the
    403s and 422s the frontend renders inline — passes through untouched.
    """
    try:
        return await _coord_request(method, path, json_body=json_body)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND or exc.detail:
            raise
        logger.error(log_event)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"coord does not serve {coord_route} yet — deploy "
                f"qontinui-coord first{addendum}"
            ),
        ) from exc


# ── Why the four authorization fields below carry NO default ──────────────
# Deliberately a comment, not docstring prose: a model docstring ships
# verbatim as that component's `description` in the committed OpenAPI
# snapshot, which coord's route-serving observer reads as the web backend's
# declared external surface — the same reason `get_agent_registry`'s
# rationale is a comment.
#
# `_render_effective` already refuses to READ a row missing one of
# `_AUTHZ_FIELDS`, but a default here would still weaken the published
# contract: an optional field tells every generated client that an
# authorization state may legitimately be absent, and lets any future
# construction path omit one silently.
#
# The values those defaults held make that concrete — `enabled=True` and
# `disposition="block"`, i.e. EXACTLY the two wrong values the bug this
# module was rewritten to remove produced on every row. (`"block"` is doubly
# wrong: coord defaults an unset disposition to `degrade`.)
#
# Descriptive fields keep their defaults, matching the strict/permissive
# split `_render_effective` applies on the read side.
class AgentRegistryEntry(BaseModel):
    """One agent in the caller's effective registry view, as folded by coord."""

    agent_name: str
    purpose: str = ""
    spawn_path: str = ""
    model: str | None = None
    effort: str | None = None
    policy_required: bool
    fanout_bound: int | str | None = None
    enabled: bool
    disposition: str = Field(..., description="block | degrade | warn_proceed")
    source: str = Field(..., description="default | user_pref")


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
#: AUTHORIZATION, as opposed to describing the agent, mapped to the JSON type
#: each must arrive as. Read strictly — absent, null, or the wrong type is a
#: 502; see :func:`_render_effective`.
#:
#: The TYPE half matters as much as the presence half, because the read used to
#: end in ``bool(...)`` / ``str(...)``, which cannot fail: ``bool("false")`` is
#: ``True`` and ``str(0)`` is ``"0"``. A wrong-typed field therefore produced a
#: confident, well-formed, wrong authorization claim — strictly worse than the
#: null this guard already refuses, which at least fails loudly.
_AUTHZ_FIELD_TYPES: dict[str, type] = {
    "enabled": bool,
    "disposition": str,
    "source": str,
    "policy_required": bool,
}

#: The names alone, in declaration order.
_AUTHZ_FIELDS = tuple(_AUTHZ_FIELD_TYPES)

#: The same rule for the ADMIN route's raw ``AgentRegistryRow``. Different
#: field names — the raw row carries the tenant DEFAULT (``default_enabled``)
#: rather than the folded ``enabled``, and no ``disposition`` / ``source``,
#: which exist only after coord's fold — but identically an authorization
#: claim, so identically strict.
#:
#: It is a second MAP, deliberately not a second IMPLEMENTATION. This route
#: shipped with the presence-only guard plus ``bool(...)`` that
#: :func:`_unusable_authz_fields` had already been written to remove, because
#: nothing made the two paths share the rule. Adding a name here is now the
#: whole cost of getting it right on a third one.
_ADMIN_AUTHZ_FIELD_TYPES: dict[str, type] = {
    "default_enabled": bool,
    "policy_required": bool,
}

#: One route's descriptive-field contract: ``{field: (accepted, fallback)}``.
_DescriptiveSpec = dict[str, tuple[type | tuple[type, ...], Any]]

#: The DESCRIPTIVE half of the strict/permissive split, mapped to the JSON
#: type(s) each field is read under and the value it degrades to otherwise.
#:
#: Permissive was only ever implemented as "may be ABSENT". A field that
#: arrived with the wrong TYPE did one of two things, neither of them
#: permissive (both measured against the route):
#:
#: * ``model: 42``, ``effort: 0``, ``fanout_bound: {...}`` raised
#:   ``ValidationError`` out of the model constructor — a **500**, which is
#:   precisely the "takes the settings page down" that :func:`_render_effective`
#:   promises a descriptive field never does. Worse than the 502s beside it:
#:   those carry a ``detail`` naming the field, which the page renders on its
#:   error card, while a 500 tells the reader nothing.
#: * ``fanout_bound: true`` rendered as a bound of **1** (and ``false`` as
#:   **0**), because ``bool`` is a subclass of ``int``. That is a fabricated
#:   number presented as coord's — the same laundering the authz guard exists
#:   to remove, still live on the route that guard was added to.
#:
#: So the split now means what it says: an authorization field is LOUD
#: (502, :data:`_AUTHZ_FIELD_TYPES`), a descriptive field DEGRADES to its
#: declared fallback, and neither launders.
_EFFECTIVE_DESCRIPTIVE: _DescriptiveSpec = {
    "purpose": (str, ""),
    "spawn_path": (str, ""),
    "model": (str, None),
    "effort": (str, None),
    "fanout_bound": ((int, str), None),
}

#: The same rule for the admin route's raw row. ``fanout_bound`` is ``int``
#: alone here — :class:`AdminAgentRegistryRow` declares no ``str`` arm — and
#: ``trigger_condition`` exists only on this side.
_ADMIN_DESCRIPTIVE: _DescriptiveSpec = {
    "purpose": (str, ""),
    "trigger_condition": (str, ""),
    "spawn_path": (str, ""),
    "model": (str, None),
    "effort": (str, None),
    "fanout_bound": (int, None),
}

#: Descriptive fields that arrive as a LIST OF STRINGS, read through
#: :func:`_string_list`. Fallback is always a fresh ``[]``, so this is a tuple
#: of names rather than a third ``{field: (accepted, fallback)}`` map — a
#: shared ``[]`` in a spec would have every row aliasing one list.
#:
#: A separate map from :data:`_DescriptiveSpec` because a list needs its
#: ELEMENTS checked, which is a different predicate, not a different type
#: argument. It exists at all because ``allowed_dispositions`` was the one
#: descriptive field on either route that "one rule, two field maps" did not
#: reach: it was hand-read at the call site, so it was the only one whose drift
#: logged NOTHING. Measured against the route before this commit — a string, an
#: object and ``null`` each rendered as ``[]``, and ``["block", 42]`` silently
#: became ``["block"]``, all four in total silence. Every render was right and
#: said so to no one, which is how a field goes empty for everyone without
#: anyone noticing — the same reason :func:`_degraded_descriptive_fields`
#: exists for the scalars beside it.
_ADMIN_STRING_LISTS: tuple[str, ...] = ("allowed_dispositions",)


def _descriptive_is_usable(value: Any, accepted: type | tuple[type, ...]) -> bool:
    """Whether a descriptive value may be read as its declared type.

    The single predicate behind both the RENDER (:func:`_descriptive`) and the
    LOG (:func:`_degraded_descriptive_fields`). They must never disagree: a
    second copy of this rule is how the admin route came to hand-roll the
    presence check ``_unusable_authz_fields`` had already been written to
    remove, and a log that says "degraded" while the render says otherwise is
    the same defect aimed at whoever is debugging.

    ``bool`` is rejected first and unconditionally, because it is a subclass of
    ``int``: without this, ``fanout_bound: true`` reads as a fan-out bound of
    ``1``. None of these fields is a boolean on either contract, so there is no
    case where a bool is the right answer.
    """
    if isinstance(value, bool):
        return False
    return isinstance(value, accepted)


def _descriptive(row: dict[str, Any], field: str, spec: _DescriptiveSpec) -> Any:
    """Read one descriptive field, degrading unless it arrives as its type.

    The counterpart to :func:`_unusable_authz_fields`: same "read it only as
    the declared type" rule, opposite consequence. These fields describe an
    agent rather than asserting anything about its authorization, so a wrong
    one must not take the page down — but it must not be INVENTED either.

    The field's accepted types and fallback are looked up from ``spec`` rather
    than passed alongside it, so a caller cannot pair a name with another
    field's contract.

    The previous ``str(row.get("purpose") or "")`` is gone for the same reason
    the ``bool(...)`` / ``str(...)`` coercions were removed from the authz
    read: ``str`` cannot fail, so ``purpose: {"a": 1}`` rendered as the Python
    repr ``"{'a': 1}"`` on the settings page — a value coord never sent,
    displayed as though it had.
    """
    accepted, fallback = spec[field]
    value = row.get(field)
    return value if _descriptive_is_usable(value, accepted) else fallback


def _degraded_descriptive_fields(
    row: dict[str, Any], spec: _DescriptiveSpec
) -> list[str]:
    """Name every descriptive field that will be degraded rather than read.

    A degrade is the correct RENDER and still an off-contract read, so it is
    logged. Silently dropping the field is how a coord serialization drift
    survives unnoticed until someone notices a column is empty for everyone —
    which is the shape of the original outage, one severity down.

    A field that is simply ABSENT or ``null`` is not reported: that is the
    permissiveness working as designed, and coord legitimately serves
    ``model``/``effort`` as ``null``.
    """
    degraded: list[str] = []
    for field, (accepted, _fallback) in spec.items():
        value = row.get(field)
        if value is None:
            continue
        if not _descriptive_is_usable(value, accepted):
            degraded.append(f"{field} (got {type(value).__name__})")
    return degraded


def _string_list(row: dict[str, Any], field: str) -> tuple[list[str], str | None]:
    """Read a list-of-strings descriptive field, degrading and SAYING SO.

    Returns the usable strings plus, when anything was refused, a note in the
    same shape :func:`_degraded_descriptive_fields` produces — so both kinds of
    descriptive drift on one row land on ONE log line. Two lines about the same
    row is how a log comes to disagree with itself, which is the defect
    :func:`_descriptive_is_usable` was made a single predicate to avoid.

    A whole non-list degrades to ``[]``; a list keeps its strings and drops the
    rest. Dropping is the right RENDER — ``allowed_dispositions`` names the
    options an admin is offered to CHOOSE from, so a repr'd non-string
    (``"{'x': 1}"``) would be a pickable disposition coord never declared,
    which coord's own ``invalid_disposition`` then refuses on save with the
    page having invited it. But a silent drop is not, for exactly the reason a
    silent scalar degrade was not: an emptied option list is indistinguishable
    from an agent for which coord declares no dispositions at all.

    Absent or ``null`` is not reported, matching
    :func:`_degraded_descriptive_fields` — that is the permissiveness working
    as designed rather than drift.
    """
    value = row.get(field)
    if value is None:
        return [], None
    if not isinstance(value, list):
        return [], f"{field} (expected list, got {type(value).__name__})"
    usable = [item for item in value if isinstance(item, str)]
    dropped = len(value) - len(usable)
    if not dropped:
        return usable, None
    kinds = sorted({type(i).__name__ for i in value if not isinstance(i, str)})
    return usable, (
        f"{field} (dropped {dropped} of {len(value)} entries, "
        f"non-string: {', '.join(kinds)})"
    )


def _unusable_authz_fields(
    row: dict[str, Any], field_types: dict[str, type] | None = None
) -> list[str]:
    """Name every authorization field this row cannot be rendered from.

    Three ways a field is unusable, all of them the same defect — the page
    would state an authorization fact that is not the system's:

    * **missing or null** — ``bool(None)`` is ``False``, ``str(None)`` is
      ``"None"``.
    * **wrong type** — ``bool("false")`` is ``True``, so a string ``enabled``
      renders a DISABLED agent as enabled: the exact shape of the outage this
      module was rewritten to remove. ``str(0)`` is ``"0"``, and a ``source``
      of ``"0"`` renders through the settings page's *default* branch,
      misattributing coord's unknown state as "registry default" — the same
      misattribution the null guard was written for.
    * **empty string** — a ``disposition`` of ``""`` renders as
      ``Disabled ·`` with nothing after it, and an empty ``source`` again
      takes the *default* branch.

    Booleans are checked with :func:`isinstance`, which is exact for ``bool``
    here: JSON decodes only ``True``/``False`` to it, and the reverse hazard
    (``isinstance(True, int)``) is not one this uses.

    ``field_types`` selects which contract to read the row under — coord's
    folded ``EffectiveAgent`` (the default) or the admin route's raw
    ``AgentRegistryRow`` (:data:`_ADMIN_AUTHZ_FIELD_TYPES`). One rule, two
    field maps: the routes assert the same thing about different names, and
    giving them separate implementations is what let the admin one ship with
    the coercion this function exists to remove.
    """
    # `is None`, not `or`: an empty map must mean "check nothing" rather than
    # silently falling back to the effective contract, which on a raw admin
    # row would 502 on four fields that route never carries.
    if field_types is None:
        field_types = _AUTHZ_FIELD_TYPES
    unusable: list[str] = []
    for field, expected in field_types.items():
        value = row.get(field)
        if value is None:
            unusable.append(f"{field} (missing or null)")
        elif not isinstance(value, expected):
            unusable.append(
                f"{field} (expected {expected.__name__}, got {type(value).__name__})"
            )
        elif expected is str and not value:
            unusable.append(f"{field} (empty string)")
    return unusable


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

    ``agents`` itself is read under the same rule its rows are: it must be a
    LIST. Absent, ``null``, an object or a scalar are all coord failing to
    answer — not a tenant with no agents — and collapsing any of them to
    ``[]`` puts "No agents are registered for your tenant yet." on the
    settings page, which is a claim, not a shrug.
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
        rows_raw = payload["agents"]
        if not isinstance(rows_raw, list):
            # Same null-is-not-a-value rule the row fields get. `agents: null`
            # (or an object, or a string) is coord failing to answer, not a
            # tenant with no agents — and `... or []` would have laundered
            # every one of those into a confident empty list, which the
            # settings page states as "No agents are registered for your
            # tenant yet."
            logger.error(
                "agent_registry_effective_agents_not_a_list",
                agents_type=type(rows_raw).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned a non-list `agents` on the effective "
                    f"registry ({type(rows_raw).__name__}); refusing to render "
                    "it as an empty registry"
                ),
            )
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
    for index, r in enumerate(rows_raw):
        if not isinstance(r, dict):
            # Dropping the row would remove an agent from an authorization
            # surface without saying so — a strictly LARGER misstatement than
            # the single missing field `_render_effective` already 502s on.
            logger.error(
                "agent_registry_effective_row_not_an_object",
                index=index,
                row_type=type(r).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned a non-object effective agent row at index "
                    f"{index} ({type(r).__name__}); refusing to render a "
                    "registry with agents silently dropped from it"
                ),
            )
        rows.append(r)
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
    AUTHORIZATION — are read with **no fallback**, and absent, null *or the
    wrong type* is a 502 (:func:`_unusable_authz_fields`). Everything else
    (purpose, model, effort, …) is cosmetic and stays permissive, so a coord
    that adds or drops a descriptive field never takes the settings page down.

    Permissive means DEGRADES, not "is coerced" — see
    :data:`_EFFECTIVE_DESCRIPTIVE`. It used to mean only "may be absent": a
    descriptive field that arrived with the wrong *type* either 500'd the page
    out of the model constructor (``model: 42``), which is the exact opposite
    of the promise above, or was silently invented (``fanout_bound: true``
    rendering as a bound of ``1``, ``purpose: {"a": 1}`` as the repr
    ``"{'a': 1}"``). Both are now read only as the declared type and fall back
    to the field's default, with the drift logged.

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

    **The type is checked for the same reason the presence is.** ``bool`` and
    ``str`` cannot fail, so a guard that only rejects ``None`` and then coerces
    lets every OTHER wrong value through as a confident claim:
    ``enabled: "false"`` renders a disabled agent as **Enabled**, and
    ``source: 0`` becomes ``"0"``, which is not ``"user_pref"`` and so reads as
    "Registry default (no preference saved)". Those are worse than the null
    this guard already refuses — null is at least loud. So the four are read
    only when they arrive as the declared type, and the ``bool(...)`` /
    ``str(...)`` coercions that used to end this function are gone.

    Value-level validity is deliberately NOT checked: coord's ``effective_from``
    already normalizes an unknown stored disposition to ``degrade`` (a
    documented fail-open read) and stamps ``source`` from a ``&'static str``, so
    an out-of-enum value cannot reach here — and a web-side copy of the enum is
    the drift this module exists to remove (see :class:`AgentPrefUpdateRequest`
    for the same call on the write path).

    That strictness is the whole lesson of the bug this replaced: the old
    code read ``row.get("enabled", True)`` off a route that never emitted
    ``enabled``, so it silently rendered every disabled agent as enabled for
    months. A missing authorization field must be LOUD.

    ``agent_name`` is strict for a stronger reason than the four: it is the
    row's IDENTITY, and a row that cannot be identified cannot be rendered at
    all. Skipping it drops the agent from the page silently — a bigger
    misstatement than misreporting one of its fields, and if it was the only
    row the page reports the tenant as having no agents registered. Same for
    a row that is not an object (:func:`_effective_rows`).
    """
    entries: list[AgentRegistryEntry] = []
    for index, row in enumerate(rows):
        name = row.get("agent_name")
        if not isinstance(name, str) or not name:
            # `continue` here was the one hole left in "a missing
            # authorization field must be LOUD": identity is not a cosmetic
            # field. A dropped row takes the agent off the settings page
            # entirely, and if it was the only row the page then states "No
            # agents are registered for your tenant yet." — confidently wrong
            # in exactly the shape this module was rewritten to remove.
            logger.error(
                "agent_registry_effective_row_missing_agent_name",
                index=index,
                agent_name_type=type(name).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned an effective agent row with no usable "
                    f"`agent_name` at index {index}; refusing to render a "
                    "registry with agents silently dropped from it"
                ),
            )
        unusable = _unusable_authz_fields(row)
        if unusable:
            logger.error(
                "agent_registry_effective_row_unusable_authz_fields",
                agent_name=name,
                unusable=unusable,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned an off-contract effective agent row "
                    f"(agent {name!r}: {'; '.join(unusable)}); refusing "
                    "to render an authorization state that is not the "
                    "system's"
                ),
            )
        degraded = _degraded_descriptive_fields(row, _EFFECTIVE_DESCRIPTIVE)
        if degraded:
            # Not an error: the row still renders, and the authorization state
            # on it is coord's. But an off-contract descriptive field is drift,
            # and drift that logs nothing is how a field goes empty for every
            # user without anyone noticing.
            logger.warning(
                "agent_registry_effective_row_degraded_descriptive_fields",
                agent_name=name,
                degraded=degraded,
            )
        entries.append(
            AgentRegistryEntry(
                agent_name=name,
                # Read only as the declared type — see `_descriptive`. A wrong
                # type degrades to the fallback instead of 500-ing the page
                # (`model: 42`) or inventing a value (`fanout_bound: true`
                # rendering as a bound of 1).
                purpose=_descriptive(row, "purpose", _EFFECTIVE_DESCRIPTIVE),
                spawn_path=_descriptive(row, "spawn_path", _EFFECTIVE_DESCRIPTIVE),
                model=_descriptive(row, "model", _EFFECTIVE_DESCRIPTIVE),
                effort=_descriptive(row, "effort", _EFFECTIVE_DESCRIPTIVE),
                # No coercion: `_unusable_authz_fields` has already refused
                # anything that is not the declared type, so a `bool(...)` /
                # `str(...)` here could only ever be a no-op — or, if the guard
                # above were ever weakened, silently launder the wrong value
                # back in. Reading the field directly keeps the guard the ONLY
                # thing standing between coord and the page.
                policy_required=row["policy_required"],
                fanout_bound=_descriptive(row, "fanout_bound", _EFFECTIVE_DESCRIPTIVE),
                enabled=row["enabled"],
                disposition=row["disposition"],
                source=row["source"],
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
    # DEPLOY ORDER, made self-diagnosing — see
    # `_coord_request_deploy_order_aware`, which this route's own 404→502
    # block was extracted into so the newer `/prefs/me` door gets the
    # identical treatment instead of a second copy that can drift.
    payload = await _coord_request_deploy_order_aware(
        "GET",
        f"/coord/agent-registry/effective-for?user_id={quote(user_id, safe='')}",
        coord_route="GET /coord/agent-registry/effective-for",
        log_event="agent_registry_effective_for_route_absent_on_coord",
        addendum=(
            "; this endpoint will not fall back to re-deriving the effective "
            "view web-side"
        ),
    )
    return AgentRegistryResponse(
        agents=_render_effective(_effective_rows(payload, user_id))
    )


@router.put("/prefs/{agent_name}")
async def put_agent_pref(
    agent_name: str,
    body: AgentPrefUpdateRequest,
    user: User = Depends(get_registry_user),
) -> dict[str, Any]:
    """Upsert the caller's OWN pref for one agent.

    Proxies coord's SELF door ``PUT /coord/agent-registry/prefs/me/{agent_name}``.
    Coord's 403s and 422 error codes pass through as structured detail.
    """
    # ── Why this targets `/prefs/me` and sends no `user_id` ─────────────────
    # Deliberately a comment, not docstring prose: this text would otherwise
    # ship verbatim as the route `description` in the committed OpenAPI
    # snapshot, which coord's route-serving observer reads as the web
    # backend's declared external surface.
    #
    # The admin door `PUT /coord/agent-registry/prefs/:agent_name` names the
    # `user_id` it writes, so coord keeps it on the ADMIN router — any tenant
    # member could otherwise rewrite any other member's prefs. That made
    # `/settings/agents` a page every member can open and no non-admin can
    # use: the toggle 403'd for exactly the population it exists for.
    #
    # The self door takes the acting user from the verified operator token
    # instead of the body, so it needs no admin gate. Its request struct is
    # `deny_unknown_fields` — a leftover `user_id` is a 422, not a harmless
    # extra — so dropping the field is part of the repoint, not tidying. The
    # authorization posture is UNCHANGED either way: the acting user was
    # already server-derived here and is now server-derived one hop further
    # in, where the identity is actually verified.
    #
    # `user` stays in the signature: `get_registry_user` is what captures the
    # caller's bearer into the ContextVar `_tenant_headers` forwards, so
    # dropping the dependency would send coord an unauthenticated request.
    del user
    coord_body: dict[str, Any] = {"enabled": body.enabled}
    if body.disposition is not None:
        coord_body["disposition"] = body.disposition
    result = await _coord_request_deploy_order_aware(
        "PUT",
        f"/coord/agent-registry/prefs/me/{quote(agent_name, safe='')}",
        json_body=coord_body,
        coord_route="PUT /coord/agent-registry/prefs/me/{agent_name}",
        log_event="agent_registry_prefs_me_route_absent_on_coord",
        addendum=(
            "; this endpoint will not fall back to the admin prefs door, "
            "which 403s every non-admin member"
        ),
    )
    if isinstance(result, dict):
        return result
    return {"result": result}


# ── The tenant-default admin surface ──────────────────────────────────────
#
# Deliberately a comment, not docstring prose (same OpenAPI-snapshot reason as
# above). Both routes below are gated with `require_coord_tenant_admin` even
# though coord's own gate would 403 a non-admin anyway. Failing in the WEB
# tier is what makes the denial RENDERABLE: a coord 403 arrives as an opaque
# passed-through body, while this gate's `not_coord_tenant_admin` is the same
# code every other admin console surface already renders.
#
# The pair is deliberately asymmetric with coord's own posture, and that is
# not an oversight. Coord serves `GET /coord/agent-registry` to any tenant
# member (`TenantId`), because `effective-for`'s "this discloses strictly
# less" argument rests on it. Narrowing the WEB proxy does not narrow coord's
# route, so that argument is untouched; it only keeps the tenant-default
# EDITING page — where a read that a non-admin cannot act on is just a broken
# page — behind the same gate as its writes.


class AdminAgentRegistryRow(BaseModel):
    """One raw ``coord.agent_registry`` row, plus its pref-override counts."""

    agent_name: str
    purpose: str = ""
    trigger_condition: str = ""
    spawn_path: str = ""
    model: str | None = None
    effort: str | None = None
    # Strict for the same reason `_AUTHZ_FIELDS` are on the read path: these
    # two ASSERT SOMETHING ABOUT AUTHORIZATION, and a default here would let a
    # future construction path publish a wrong one silently.
    default_enabled: bool
    policy_required: bool
    allowed_dispositions: list[str] = []
    fanout_bound: int | None = None
    #: Tenant members with a recorded pref row for this agent. They are exactly
    #: the population a change to ``default_enabled`` does NOT reach.
    pref_count: int
    #: Of those, the ones whose recorded ``enabled`` differs from the current
    #: ``default_enabled`` — i.e. members actively contradicting the default.
    pref_differs_from_default_count: int


class AdminAgentRegistryResponse(BaseModel):
    """Response envelope for ``GET /api/v1/agent-registry/admin/registry``."""

    agents: list[AdminAgentRegistryRow]


class AgentRegistryDefaultsRequest(BaseModel):
    """Client body for the tenant-default edit.

    Only the two fields the admin page edits. ``default_enabled`` is REQUIRED
    because coord requires it (it is the lever itself, and defaulting it would
    let a typo flip a tenant's autonomy) — so editing ``policy_required``
    alone still means sending the agent's current ``default_enabled`` back.
    """

    default_enabled: bool
    policy_required: bool | None = None


def _admin_registry_rows(
    payload: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pull both lists out of coord's raw ``{"agents": [...], "prefs": [...]}``.

    Read under the same rule :func:`_effective_rows` applies: a missing key, a
    non-list, or a non-object row is coord failing to answer, not a tenant
    with no agents — and collapsing any of them to ``[]`` would put "no agents
    registered" (or "nobody has overridden this") on a page whose whole job is
    a tenant-wide consent decision. Both are claims, not shrugs.
    """
    if not isinstance(payload, dict):
        logger.error(
            "agent_registry_admin_unexpected_payload",
            payload_type=type(payload).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="coord returned an unrecognized agent-registry payload",
        )
    out: list[list[dict[str, Any]]] = []
    for key in ("agents", "prefs"):
        raw = payload.get(key)
        if not isinstance(raw, list):
            logger.error(
                "agent_registry_admin_key_not_a_list",
                key=key,
                value_type=type(raw).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"coord returned a non-list `{key}` on the raw agent "
                    f"registry ({type(raw).__name__}); refusing to render it "
                    "as an empty one"
                ),
            )
        for index, row in enumerate(raw):
            if not isinstance(row, dict):
                logger.error(
                    "agent_registry_admin_row_not_an_object",
                    key=key,
                    index=index,
                    row_type=type(row).__name__,
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        f"coord returned a non-object `{key}` row at index "
                        f"{index} ({type(row).__name__}); refusing to render "
                        "a registry with rows silently dropped from it"
                    ),
                )
        out.append(raw)
    agents, prefs = out
    return agents, prefs


def _render_admin_rows(
    agents: list[dict[str, Any]], prefs: list[dict[str, Any]]
) -> list[AdminAgentRegistryRow]:
    """Render the raw rows, folding the tenant's pref rows into two counts.

    The counts are the only derivation on this path, and they are an
    AGGREGATE — not a re-derivation of the effective view, which stays coord's
    alone (see :func:`_render_effective`). Coord serves no such aggregate, and
    counting web-side is also what keeps every other member's ``user_id`` off
    the wire: the page needs "how many", never "who".

    ``pref_count`` is deliberately every recorded pref row, not only the ones
    that disagree. A member who explicitly recorded the current default is
    still immune to a change of it, which is precisely the question the admin
    is asking. ``pref_differs_from_default_count`` is the narrower reading,
    reported beside it rather than instead of it.

    Because those two numbers ARE the page's claim, a pref row that cannot be
    attributed to an agent is a 502 rather than a skip — see below.
    """
    by_agent: dict[str, list[dict[str, Any]]] = {}
    for index, pref in enumerate(prefs):
        name = pref.get("agent_name")
        if not isinstance(name, str) or not name:
            # Read under the SAME identity rule the registry rows below get,
            # which this loop was the one place on the route not to apply:
            # `if isinstance(name, str) and name:` skipped the row instead.
            #
            # `_admin_registry_rows` already 502s on a non-object pref row, so
            # the guard here was half-present — shape checked, identity not —
            # and the missing half is the consequential one. An unattributable
            # pref row does not merely vanish: it decrements `pref_count`, the
            # number this page states as "changing the default does not reach
            # N members", and which also drives the amber attention rail, the
            # "Overridden" filter count and the health strip. Measured against
            # the route before this commit, one good row beside three
            # unattributable ones reported `pref_count=1` — telling an admin
            # that a change reaches everyone but one member when it in fact
            # misses four.
            #
            # It cannot be repaired by counting the row anyway, either: without
            # a name there is no agent to count it against, so the honest
            # reading is that EVERY count on the page is now unverifiable, not
            # one of them. That is the "refusing to render a registry with rows
            # silently dropped from it" case, one table over.
            logger.error(
                "agent_registry_admin_pref_row_missing_agent_name",
                index=index,
                agent_name_type=type(name).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned a preference row with no usable "
                    f"`agent_name` at index {index}; it cannot be attributed "
                    "to an agent, so refusing rather than under-reporting how "
                    "many members a change to a default would miss"
                ),
            )
        by_agent.setdefault(name, []).append(pref)

    entries: list[AdminAgentRegistryRow] = []
    for index, row in enumerate(agents):
        name = row.get("agent_name")
        if not isinstance(name, str) or not name:
            logger.error(
                "agent_registry_admin_row_missing_agent_name",
                index=index,
                agent_name_type=type(name).__name__,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned a registry row with no usable "
                    f"`agent_name` at index {index}; refusing to render a "
                    "registry with agents silently dropped from it"
                ),
            )
        # Read under the SAME rule `_render_effective` applies, via the same
        # function: absent, null, or the wrong TYPE. The presence-only check
        # that shipped here (`row.get(k) is None`) followed by `bool(...)` is
        # exactly the pair removed from the effective path, and it laundered
        # identically — `default_enabled: "false"` is `bool("false")` is
        # `True`, so the admin page badged an agent the tenant had defaulted
        # OFF as on, which is the claim this whole module exists not to make.
        unusable = _unusable_authz_fields(row, _ADMIN_AUTHZ_FIELD_TYPES)
        if unusable:
            logger.error(
                "agent_registry_admin_row_unusable_authz_fields",
                agent_name=name,
                unusable=unusable,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "coord returned an off-contract agent registry row "
                    f"(agent {name!r}: {'; '.join(unusable)}); refusing to "
                    "render an authorization state that is not the system's"
                ),
            )
        # No coercion: the guard above has already refused anything that is
        # not a real bool, so `bool(...)` here could only launder a wrong
        # value back in if that guard were ever weakened.
        default_enabled = row["default_enabled"]
        rows_for_agent = by_agent.get(name, [])
        degraded = _degraded_descriptive_fields(row, _ADMIN_DESCRIPTIVE)
        # The list-valued descriptive fields go through the same reporting rule
        # as the scalars, and their notes join THAT log line rather than
        # opening a second one about the same row. Read from the map rather
        # than by name, so a second such field costs one entry in
        # `_ADMIN_STRING_LISTS` and one argument below — the same "adding a
        # name here is the whole cost" shape the other two maps have.
        string_lists: dict[str, list[str]] = {}
        for list_field in _ADMIN_STRING_LISTS:
            string_lists[list_field], note = _string_list(row, list_field)
            if note:
                degraded.append(note)
        if degraded:
            logger.warning(
                "agent_registry_admin_row_degraded_descriptive_fields",
                agent_name=name,
                degraded=degraded,
            )
        # An `enabled` this route cannot read is why the count below is the
        # conservative one, and until now that was decided in silence. The
        # render is unchanged and still right — an unknown pref is not a
        # fabricated disagreement — but "N of M contradict the default" is
        # weaker evidence when some of the M could not be read at all, and
        # nothing said so to whoever is debugging why a number looks low.
        unreadable_enabled = sum(
            1 for p in rows_for_agent if not isinstance(p.get("enabled"), bool)
        )
        if unreadable_enabled:
            logger.warning(
                "agent_registry_admin_pref_rows_with_unreadable_enabled",
                agent_name=name,
                unreadable=unreadable_enabled,
                pref_count=len(rows_for_agent),
            )
        entries.append(
            AdminAgentRegistryRow(
                agent_name=name,
                # Same rule as the effective route, via the same helper. The
                # `fanout_bound` carve-out this route already had was right and
                # is now the rule for every descriptive field rather than the
                # one it was spelled out for; `model` and `effort` carried no
                # such guard and 500'd the admin page on a wrong type.
                purpose=_descriptive(row, "purpose", _ADMIN_DESCRIPTIVE),
                trigger_condition=_descriptive(
                    row, "trigger_condition", _ADMIN_DESCRIPTIVE
                ),
                spawn_path=_descriptive(row, "spawn_path", _ADMIN_DESCRIPTIVE),
                model=_descriptive(row, "model", _ADMIN_DESCRIPTIVE),
                effort=_descriptive(row, "effort", _ADMIN_DESCRIPTIVE),
                default_enabled=default_enabled,
                policy_required=row["policy_required"],
                # Real strings only, not `str(d)`. These are the options the
                # page offers an admin to CHOOSE from, so a repr'd non-string
                # (`"{'x': 1}"`) becomes a pickable disposition coord never
                # declared — the write would then be refused by coord's own
                # `invalid_disposition`, with the page having invited it. The
                # filtering that enforces that is now `_string_list`, which
                # REPORTS what it dropped instead of dropping it in silence.
                allowed_dispositions=string_lists["allowed_dispositions"],
                fanout_bound=_descriptive(row, "fanout_bound", _ADMIN_DESCRIPTIVE),
                pref_count=len(rows_for_agent),
                pref_differs_from_default_count=sum(
                    1
                    for p in rows_for_agent
                    # `enabled` absent is NOT counted as agreeing: a pref row
                    # coord could not serve is unknown, and the honest place
                    # for that is the smaller (more conservative) of the two
                    # counts, never a fabricated disagreement.
                    if isinstance(p.get("enabled"), bool)
                    and bool(p["enabled"]) != default_enabled
                ),
            )
        )
    return entries


@router.get("/admin/registry", response_model=AdminAgentRegistryResponse)
async def get_admin_agent_registry(
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> AdminAgentRegistryResponse:
    """ADMIN: the tenant's raw agent-registry rows and their override counts.

    Proxies coord ``GET /coord/agent-registry`` — the raw ``AgentRegistryRow``
    door (``default_enabled`` / ``policy_required``), NOT the effective fold.
    Every pref row it returns is folded into two per-agent COUNTS; no other
    member's ``user_id`` reaches the browser.
    """
    del tenant_id  # gate only — coord resolves the tenant from the bearer
    payload = await _coord_request_deploy_order_aware(
        "GET",
        "/coord/agent-registry",
        coord_route="GET /coord/agent-registry",
        log_event="agent_registry_raw_route_absent_on_coord",
    )
    agents, prefs = _admin_registry_rows(payload)
    return AdminAgentRegistryResponse(agents=_render_admin_rows(agents, prefs))


@router.put("/admin/registry/{agent_name}")
async def put_admin_agent_registry_row(
    agent_name: str,
    body: AgentRegistryDefaultsRequest,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> dict[str, Any]:
    """ADMIN: set one agent's tenant default.

    Proxies coord ``PUT /coord/agent-registry/{agent_name}`` with a MINIMAL
    body. Coord's upsert is ``COALESCE``-preserving, so every field this omits
    keeps its stored value.
    """
    # ── Why the body is minimal, and why that is a safety property ──────────
    # Deliberately a comment, not docstring prose (OpenAPI-snapshot reason as
    # above). Coord's `UpsertRegistryRequest` makes `default_enabled` the ONLY
    # required field and every other field optional-and-preserving. An earlier
    # shape did the opposite — it required `spawn_path` and REPLACED every
    # column the request did not name — and that is how following the
    # documented re-enable lever once reset a seeded row's `purpose` and
    # dropped its `fanout_bound` from 1 to 15. Sending a full row back would
    # reintroduce exactly that: this page reads `purpose`, `spawn_path`,
    # `model`, `effort` and `allowed_dispositions` for DISPLAY, and echoing
    # them on save would make every render-side normalisation (a `None` shown
    # as "", a list re-ordered) a silent write.
    #
    # The struct is also `deny_unknown_fields`, so this body may only ever
    # carry names coord declares — a misspelling is a 422 rather than a
    # silently-dropped field answering 200 with the unchanged row.
    del tenant_id  # gate only — coord resolves the tenant from the bearer
    coord_body: dict[str, Any] = {"default_enabled": body.default_enabled}
    if body.policy_required is not None:
        coord_body["policy_required"] = body.policy_required
    result = await _coord_request_deploy_order_aware(
        "PUT",
        f"/coord/agent-registry/{quote(agent_name, safe='')}",
        json_body=coord_body,
        coord_route="PUT /coord/agent-registry/{agent_name}",
        log_event="agent_registry_upsert_route_absent_on_coord",
    )
    if isinstance(result, dict):
        return result
    return {"result": result}
