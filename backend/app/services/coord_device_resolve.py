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
asked at all. In particular, a coord build without either door answers 404 and
the call is ``unavailable / not_deployed``.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import httpx
import structlog
from fastapi import Request
from pydantic import ValidationError

from app.core.config import coord_device_base
from app.schemas.device_resolve import (
    CoordResolveBody,
    DeviceResolveRequest,
    DeviceResolveResult,
    NoCapableDeviceOutcome,
    UnavailableOutcome,
    UnavailableReason,
)
from app.services.coord_device import extract_bearer
from app.services.coord_service_account import (
    CoordServiceAccountDisabledError,
    coord_service_account,
)

logger = structlog.get_logger(__name__)

RESOLVE_PATH = "/coord/devices/resolve"

# The dashboard tenant-switcher selection; coord re-scopes to it only for a
# member (``auth::apply_active_tenant_override``). Same header the operations
# proxies forward.
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"

# A read of a few rows; the same 5 s budget as the other coord device reads.
_RESOLVE_TIMEOUT = httpx.Timeout(5.0)

# Coord's mint-door code for "this user owns no paired device at all".
_NO_PAIRED_DEVICE = "user_has_no_paired_device"


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


async def _mint_acting_bearer(user_id: UUID) -> str | DeviceResolveResult:
    """A fresh bearer acting for ``user_id``, or why there is none.

    Asks coord's ``POST /coord/auth/service-acting-user-token`` with the web
    backend's service credential. Minted per call and never kept: the token
    names one user, so holding it could only hand it to another.

    Every failure is a typed non-resolved outcome, and the caller must then
    NOT ask the resolver — a mint that failed is never an anonymous ask and
    never a pick.
    """
    try:
        status, body = await coord_service_account.mint_acting_user_token(str(user_id))
    except CoordServiceAccountDisabledError:
        # COORD_ADMIN_SECRET unset: web holds no service credential to mint
        # with, so there is nothing to ask coord as.
        return _unavailable("no_credential")
    except (httpx.InvalidURL, httpx.UnsupportedProtocol) as exc:
        logger.warning("device_resolve_mint_bad_url", error=str(exc))
        return _unavailable("misconfigured")
    except httpx.HTTPError as exc:
        logger.warning("device_resolve_mint_transport_error", error=str(exc))
        return _unavailable("coord_unreachable")
    except (RuntimeError, KeyError, TypeError, ValueError) as exc:
        # The service account could not obtain its OWN token (coord refused
        # the admin secret, answered an error, or answered a 200 that is not
        # a token): still no credential.
        logger.warning("device_resolve_service_token_unobtainable", error=str(exc))
        return _unavailable("no_credential")

    code = _body_error_code(body)
    if status == 200:
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            return _unavailable("malformed_response", status=status)
        return token
    if status == 404 and code == _NO_PAIRED_DEVICE:
        # Coord's own answer, in the shape its resolver gives for the same
        # fact: the pool is this user's paired devices, and it is empty — so
        # none is online and none can run the work. Not UNKNOWN.
        logger.info("device_resolve_user_has_no_paired_device", user_id=str(user_id))
        return NoCapableDeviceOutcome(missing=[], online_devices=0)
    if status in (404, 405):
        # The mint door is not on the running coord build — UNKNOWN, not
        # "you have no devices".
        return _unavailable("not_deployed", status=status)
    if status >= 500:
        return _unavailable("upstream_error", status=status, code=code)
    if status >= 400:
        # 409 tenant_ambiguous, 403 tenant_not_bound / not the trusted web
        # service, and any other refusal: coord's code says which.
        return _unavailable("refused", status=status, code=code)
    # A 2xx/3xx that is not the contract's 200.
    return _unavailable("malformed_response", status=status)


async def resolve_device(
    request: DeviceResolveRequest, caller: CoordCaller
) -> DeviceResolveResult:
    """Ask coord which of the caller's devices should run this work.

    An interactive caller is asked for AS its own bearer. A background caller
    is asked for as a bearer minted for the user it names; when that mint
    fails, its typed outcome is returned and the resolver is not asked.

    Returns one of coord's outcomes (``resolved``, ``pin_ineligible``,
    ``no_capable_device``, ``all_capable_drained``, ``drain_unreadable``) or
    ``unavailable`` when coord's answer could not be obtained. Never raises
    for a coord-side condition.
    """
    bearer = caller.bearer
    if caller.acting_user_id is not None:
        # ``__post_init__`` makes this exactly the background callers.
        minted = await _mint_acting_bearer(caller.acting_user_id)
        if not isinstance(minted, str):
            return minted
        bearer = minted
    elif not bearer:
        # An interactive caller with no bearer. Nothing to authorize as; an
        # anonymous call would be refused anyway, and asking without a
        # principal must not look like asking. It is NOT background, so
        # nothing is minted for it.
        return _unavailable("no_credential")

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
    if status in (404, 405):
        # The route is not on the running coord build — UNKNOWN, not "you
        # have no devices".
        return _unavailable("not_deployed", status=status)
    if status >= 500:
        return _unavailable("upstream_error", status=status, code=_error_code(resp))
    if status >= 400:
        return _unavailable("refused", status=status, code=_error_code(resp))
    try:
        return CoordResolveBody.model_validate(resp.json()).root
    except (ValueError, ValidationError):
        return _unavailable("malformed_response", status=status)
