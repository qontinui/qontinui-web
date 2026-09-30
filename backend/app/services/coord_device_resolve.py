"""The web side of coord's device resolver — "which of MY devices runs this?".

Plan ``2026-09-20-runner-selector-drives-a-transport-not-a-target`` Phase 3.
Forwards to coord's ``POST /coord/devices/resolve`` (qontinui-coord
``device_resolve.rs``), which is capability-checked, heartbeat-fresh,
drain-filtered and scoped to the CALLER's paired devices (plan D3). Two
consumers: the browser (``POST /api/v1/devices/resolve``) and the workflow
dispatcher's ``target="auto"`` pick.

Identity comes from the forwarded bearer, never from a request field: the body
carries no ``user_id`` (coord refuses one ``400 user_id_not_accepted``) and no
``x-qontinui-user-id`` header is sent (coord ignores it on this door; sending
it would only suggest it mattered).

The bearer has two sources, one per kind of caller:

* An INTERACTIVE caller (a request) forwards its own bearer.
* A BACKGROUND caller (a scheduled fire) has no request and so no bearer of
  its own. It names the user it runs for, and the bearer is minted per call
  from coord's ``POST /coord/auth/service-acting-user-token`` with the web
  backend's service credential (plan
  ``2026-09-23-runner-selector-follow-ups-drain-aware-background-dispatch-and-typed-instances``
  Phase 1). The resolver then answers for that user's paired devices, with
  the same capability, heartbeat and drain checks an interactive caller gets.

Every failure to get coord's answer becomes a typed ``unavailable`` outcome —
UNKNOWN — and never a pick: no caller of this module may substitute a
heuristic of its own. That includes a failed mint: the resolver is then not
asked at all. In particular, a coord build without either door answers a 404
carrying no coord error code and the call is ``unavailable / not_deployed``;
a 404 that DOES carry a code is coord's own refusal and keeps that code.

The mint goes to ``COORD_URL`` (the admin-secret bridge) and the resolver to
:func:`app.core.config.coord_device_base`. On a split box those are different
coords with different signing keys, so a token minted at one would be
presented to the other: a background caller is then refused
``unavailable / misconfigured`` and nothing is minted.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import httpx
import structlog
from fastapi import Request
from pydantic import ValidationError

from app.core.config import coord_device_base, coord_device_split_active, settings
from app.schemas.device_resolve import (
    CoordResolveBody,
    DeviceResolveRequest,
    DeviceResolveResult,
    UnavailableOutcome,
    UnavailableReason,
)
from app.services.coord_device import extract_bearer
from app.services.coord_service_account import (
    CoordServiceAccountDisabledError,
    CoordServiceTokenError,
    coord_service_account,
)

logger = structlog.get_logger(__name__)

RESOLVE_PATH = "/coord/devices/resolve"

# The dashboard tenant-switcher selection; coord re-scopes to it only for a
# member (``auth::apply_active_tenant_override``). Same header the operations
# proxies forward.
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"

# A read of a few rows; the same 5 s budget as the other coord device reads.
# The acting-user mint a background caller makes first gets the same budget,
# so a coord that answers nothing costs one scheduled row about 10 s, not 15.
_RESOLVE_TIMEOUT = httpx.Timeout(5.0)

NO_PAIRED_DEVICE_CODE = "user_has_no_paired_device"
"""Coord's mint-door code (a ``404``) for "this user owns no paired device at
all". It reaches a caller as ``unavailable / refused`` carrying this code —
not as ``no_capable_device``, which is the resolver's answer about devices
that ARE paired and would be indistinguishable from it."""


@dataclass(frozen=True)
class CoordCaller:
    """Who a resolve is made AS, and where its bearer comes from.

    An INTERACTIVE caller (:meth:`from_request`) carries the request's own
    ``bearer``; ``bearer=None`` there means the request had no credential.

    A BACKGROUND caller (:meth:`background_for`) has NO request behind it (a
    scheduled fire). It carries no bearer; it names ``acting_user_id``, the
    user it runs for, and :func:`resolve_device` mints a bearer acting for
    that user on every call.

    ``background`` is an explicit identity, never inferred from a missing
    bearer: an interactive request that arrives without a bearer is still an
    interactive caller, is refused ``unavailable / no_credential``, and never
    mints. The two shapes cannot be mixed — a background caller without a
    user, or with a bearer, is a construction error.
    """

    bearer: str | None
    active_tenant: str | None = None
    background: bool = False
    acting_user_id: UUID | None = None

    def __post_init__(self) -> None:
        if self.background:
            if self.acting_user_id is None:
                raise ValueError("a background CoordCaller must name its user")
            if self.bearer is not None:
                raise ValueError("a background CoordCaller carries no bearer")
        elif self.acting_user_id is not None:
            raise ValueError("only a background CoordCaller names an acting user")

    @classmethod
    def from_request(cls, request: Request) -> CoordCaller:
        return cls(
            bearer=extract_bearer(request),
            active_tenant=request.headers.get(ACTIVE_TENANT_HEADER),
        )

    @classmethod
    def background_for(cls, user_id: UUID) -> CoordCaller:
        """The caller for work with no request behind it, run for ``user_id``
        (a scheduled run names the schedule's owner)."""
        return cls(bearer=None, background=True, acting_user_id=user_id)


def _unavailable(
    reason: UnavailableReason,
    *,
    status: int | None = None,
    code: str | None = None,
) -> UnavailableOutcome:
    logger.warning(
        "device_resolve_unavailable", reason=reason, status=status, code=code
    )
    return UnavailableOutcome(reason=reason, status=status, code=code)


def _body_error_code(body: object) -> str | None:
    if isinstance(body, dict) and isinstance(body.get("error"), str):
        return str(body["error"])
    return None


def _error_code(resp: httpx.Response) -> str | None:
    try:
        body = resp.json()
    except ValueError:
        return None
    return _body_error_code(body)


def _not_answered(status: int, code: str | None) -> UnavailableOutcome:
    """The ``unavailable`` outcome for a coord door's non-200 ``status``.

    ``code`` is the string ``error`` in coord's body, if it sent one. A
    ``404``/``405`` with NO code is a route the running coord build does not
    have — UNKNOWN, not "you have no devices". One that carries a code is
    coord answering, and the code is kept.
    """
    if status in (404, 405) and code is None:
        return _unavailable("not_deployed", status=status)
    if status >= 500:
        return _unavailable("upstream_error", status=status, code=code)
    if status >= 400:
        # The mint's 404 user_has_no_paired_device, 409 tenant_ambiguous,
        # 403 tenant_not_bound / not the trusted web service; the resolver's
        # 400/401/403 — coord's code says which.
        return _unavailable("refused", status=status, code=code)
    # A 2xx/3xx that is not the contract's 200.
    return _unavailable("malformed_response", status=status)


def _service_token_unobtainable(exc: CoordServiceTokenError) -> UnavailableOutcome:
    """Web could not get its OWN service token, so there is nothing to mint
    with. A coord 5xx is coord's fault; any other answer (the admin secret
    refused, a 200 that is not a token) leaves web without a credential."""
    logger.warning(
        "device_resolve_service_token_unobtainable",
        status=exc.status,
        error=str(exc),
    )
    if exc.status is not None and exc.status >= 500:
        return _unavailable("upstream_error", status=exc.status)
    return _unavailable("no_credential", status=exc.status)


async def _mint_acting_bearer(user_id: UUID) -> str | UnavailableOutcome:
    """A fresh bearer acting for ``user_id``, or why there is none.

    Asks coord's ``POST /coord/auth/service-acting-user-token`` with the web
    backend's service credential. Minted per call and never kept: the token
    names one user, so holding it could only hand it to another.

    Every failure is a typed ``unavailable`` outcome, and the caller must
    then NOT ask the resolver — a mint that failed is never an anonymous ask
    and never a pick.
    """
    try:
        status, body = await coord_service_account.mint_acting_user_token(
            str(user_id), timeout=_RESOLVE_TIMEOUT
        )
    except CoordServiceAccountDisabledError:
        # COORD_ADMIN_SECRET unset: web holds no service credential to mint
        # with, so there is nothing to ask coord as.
        return _unavailable("no_credential")
    except CoordServiceTokenError as exc:
        return _service_token_unobtainable(exc)
    except (httpx.InvalidURL, httpx.UnsupportedProtocol) as exc:
        logger.warning("device_resolve_mint_bad_url", error=str(exc))
        return _unavailable("misconfigured")
    except httpx.HTTPError as exc:
        logger.warning("device_resolve_mint_transport_error", error=str(exc))
        return _unavailable("coord_unreachable")

    if status != 200:
        # Includes a second 401 after the one fresh-service-token retry.
        return _not_answered(status, _body_error_code(body))
    token = body.get("token") if isinstance(body, dict) else None
    if not isinstance(token, str) or not token:
        return _unavailable("malformed_response", status=status)
    return token


async def _bearer_for(caller: CoordCaller) -> str | UnavailableOutcome:
    """The bearer ``caller`` asks the resolver AS, or why there is none.

    An interactive caller's is its own. A background caller's is minted for
    the user it names — never on a split-coord box, where the mint and the
    resolver are different coords.
    """
    if caller.acting_user_id is None:
        if not caller.bearer:
            # An interactive caller with no bearer. Nothing to authorize as;
            # an anonymous call would be refused anyway, and asking without a
            # principal must not look like asking. It is NOT background, so
            # nothing is minted for it.
            return _unavailable("no_credential")
        return caller.bearer
    # ``__post_init__`` makes this exactly the background callers.
    if coord_device_split_active():
        logger.warning(
            "device_resolve_split_coord_mint_refused",
            bridge_coord_url=settings.COORD_URL.rstrip("/"),
            device_coord_url=coord_device_base(),
            note=(
                "the acting-user token is minted at bridge_coord_url but the "
                "resolver is at device_coord_url, which verifies with "
                "different keys; nothing was minted"
            ),
        )
        return _unavailable("misconfigured")
    return await _mint_acting_bearer(caller.acting_user_id)


async def resolve_device(
    request: DeviceResolveRequest, caller: CoordCaller
) -> DeviceResolveResult:
    """Ask coord which of the caller's devices should run this work.

    An interactive caller is asked for AS its own bearer. A background caller
    is asked for as a bearer minted for the user it names; when that mint
    fails or is not attempted, its typed outcome is returned and the resolver
    is not asked.

    Returns one of coord's outcomes (``resolved``, ``pin_ineligible``,
    ``no_capable_device``, ``all_capable_drained``, ``drain_unreadable``) or
    ``unavailable`` when coord's answer could not be obtained. Never raises
    for a coord-side condition.
    """
    bearer = await _bearer_for(caller)
    if not isinstance(bearer, str):
        return bearer

    headers = {"Authorization": f"Bearer {bearer}"}
    if caller.active_tenant:
        headers[ACTIVE_TENANT_HEADER] = caller.active_tenant
    # ``mode="json"`` stringifies the UUID; ``exclude_none`` leaves an absent
    # pin absent rather than an explicit null. The model has no ``user_id``
    # field, so none can be sent.
    body = request.model_dump(mode="json", exclude_none=True)

    try:
        url = f"{coord_device_base()}{RESOLVE_PATH}"
    except Exception as exc:  # noqa: BLE001 — a config fault is UNKNOWN, not a 500
        logger.warning("device_resolve_base_unresolvable", error=str(exc))
        return _unavailable("misconfigured")
    try:
        async with httpx.AsyncClient(timeout=_RESOLVE_TIMEOUT) as client:
            resp = await client.post(url, json=body, headers=headers)
    except (httpx.InvalidURL, httpx.UnsupportedProtocol) as exc:
        # The coord base URL is empty or not a URL: a deployment fault.
        logger.warning("device_resolve_bad_url", error=str(exc))
        return _unavailable("misconfigured")
    except httpx.HTTPError as exc:
        logger.warning("device_resolve_transport_error", error=str(exc))
        return _unavailable("coord_unreachable")

    status = resp.status_code
    if status >= 400:
        return _not_answered(status, _error_code(resp))
    try:
        return CoordResolveBody.model_validate(resp.json()).root
    except (ValueError, ValidationError):
        return _unavailable("malformed_response", status=status)
