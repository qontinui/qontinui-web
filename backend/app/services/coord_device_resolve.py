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

Every failure to get coord's answer becomes a typed ``unavailable`` outcome —
UNKNOWN — and never a pick: no caller of this module may substitute a
heuristic of its own. In particular, until qontinui-coord#2402 is deployed the
door answers 404 and every call here is ``unavailable / not_deployed``.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
import structlog
from fastapi import Request
from pydantic import ValidationError

from app.core.config import coord_device_base
from app.schemas.device_resolve import (
    CoordResolveBody,
    DeviceResolveRequest,
    DeviceResolveResult,
    UnavailableOutcome,
    UnavailableReason,
)
from app.services.coord_device import extract_bearer

logger = structlog.get_logger(__name__)

RESOLVE_PATH = "/coord/devices/resolve"

# The dashboard tenant-switcher selection; coord re-scopes to it only for a
# member (``auth::apply_active_tenant_override``). Same header the operations
# proxies forward.
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"

# A read of a few rows; the same 5 s budget as the other coord device reads.
_RESOLVE_TIMEOUT = httpx.Timeout(5.0)


@dataclass(frozen=True)
class CoordCaller:
    """The credential a resolve is made AS. ``bearer=None`` = no credential.

    ``background`` marks a caller with NO request behind it (a scheduled
    fire). It is an explicit identity, never inferred from a missing bearer:
    an interactive request that arrives without a bearer is still an
    interactive caller, and is refused rather than treated as background.
    """

    bearer: str | None
    active_tenant: str | None = None
    background: bool = False

    @classmethod
    def from_request(cls, request: Request) -> CoordCaller:
        return cls(
            bearer=extract_bearer(request),
            active_tenant=request.headers.get(ACTIVE_TENANT_HEADER),
        )


NO_CALLER = CoordCaller(bearer=None, background=True)
"""For callers with no request behind them (a scheduled run)."""


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


def _error_code(resp: httpx.Response) -> str | None:
    try:
        body = resp.json()
    except ValueError:
        return None
    if isinstance(body, dict) and isinstance(body.get("error"), str):
        return str(body["error"])
    return None


async def resolve_device(
    request: DeviceResolveRequest, caller: CoordCaller
) -> DeviceResolveResult:
    """Ask coord which of the caller's devices should run this work.

    Returns one of coord's outcomes (``resolved``, ``pin_ineligible``,
    ``no_capable_device``, ``all_capable_drained``, ``drain_unreadable``) or
    ``unavailable`` when coord's answer could not be obtained. Never raises
    for a coord-side condition.
    """
    if not caller.bearer:
        # Nothing to authorize as; an anonymous call would be refused anyway,
        # and asking without a principal must not look like asking.
        return _unavailable("no_credential")

    headers = {"Authorization": f"Bearer {caller.bearer}"}
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
        # The route is not on the running coord build (qontinui-coord#2402
        # not deployed yet) — UNKNOWN, not "you have no devices".
        return _unavailable("not_deployed", status=status)
    if status >= 500:
        return _unavailable("upstream_error", status=status, code=_error_code(resp))
    if status >= 400:
        return _unavailable("refused", status=status, code=_error_code(resp))
    try:
        return CoordResolveBody.model_validate(resp.json()).root
    except (ValueError, ValidationError):
        return _unavailable("malformed_response", status=status)
