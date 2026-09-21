"""Coord device-status bridge — REST proxy + WS bridge.

Plan: `D:/qontinui-root/plans/2026-05-21-coordination-improvements.md`
Phase 1.3. Provides the web backend's view of coord's
``coord.device_status`` surface so the operations dashboard can render
a live "currently doing" sub-line on each `MachineCard`.

Three pieces ship here:

1. :func:`fetch_device_status` — tenant-scoped REST proxy to
   ``GET /coord/status?tenant_id=<uuid>``. Used by the
   ``/api/v1/operations/device-status`` endpoint for the initial seed
   and as a polling fallback when the WS is offline.
2. :func:`mint_device_status_token` — mints a coord-issued service
   JWT carrying the operator's resolved ``tenant_id`` claim, scoped
   for the dashboard's WS subscription. Used by the WS-bridge
   endpoints to authenticate upstream to coord's
   ``/ws/device-status`` — and, since the generic ``/ws`` went
   authenticated, to coord's ``/ws?subscribe=<name>`` too.
3. :data:`COORD_EVENTS_SUBSCRIPTIONS` + :func:`build_coord_events_ws_url`
   — the closed set of named ``/ws`` subscriptions the
   ``/api/v1/operations/coord-events/ws`` bridge will forward, and the
   upstream URL for one of them.

The mint path requires `COORD_ADMIN_SECRET` to be set; without it the
device-status surface returns 503 (same posture as
:mod:`app.services.strategy`). The minted token's `tenant_id` claim
is the sole authorization input coord uses to scope subscription
topics on `/ws/device-status` (`device_status:<tenant_uuid>`) — the
admin secret + tenant resolution upstream guarantee an operator can
only ever subscribe to their own tenant's bucket.

Cache discipline: tokens are minted per-call (no in-process cache)
because the dashboard's WS bridge opens one upstream WS per browser
session, and the WS may live for hours; pre-minting + holding stale
tokens would be more complex than re-minting on each WS attach
(roughly one mint per page-load).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

# Same shared timeout as :mod:`app.api.v1.endpoints.operations`. Coord's
# `/coord/status` is a small JSON read backed by a single SQL SELECT;
# 5s is generous and matches the `_COORD_TIMEOUT` used by the other
# proxy helpers.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Service-name embedded in the minted JWT's `sub` claim
# (`sub = "service:qontinui-web-device-status"`). Distinct from the
# strategy-bridge service name so coord's audit log can disambiguate.
DEVICE_STATUS_SERVICE_NAME = "qontinui-web-device-status"


class CoordDeviceStatusDisabledError(RuntimeError):
    """Raised when COORD_ADMIN_SECRET is unset and the device-status
    bridge surface is therefore unavailable. Surfaced as HTTP 503."""


class CoordDeviceStatusMintFailedError(RuntimeError):
    """Raised when coord's service-token endpoint rejects the mint."""


async def fetch_device_status(
    *,
    tenant_id: UUID,
    since: str | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Proxy ``GET /coord/status?tenant_id=<uuid>&since=<rfc3339>``.

    Returns the parsed JSON body. Coord shapes the response as
    ``{"devices": [StatusRow, ...], "count": <int>}`` (Phase 6 of the
    unified-devices plan renamed the wrapper key from `machines` →
    `devices`).

    ``headers`` — the forwarded operator bearer
    (``Authorization: Bearer <cognito-token>``), built by the calling
    endpoint via ``operations._tenant_headers``. Coord's
    ``GET /coord/status`` is operator-auth fail-closed (fleet-auth P4:
    the required ``TenantId`` extractor rejects anonymous calls 403
    ``tenant_not_resolved``), so the bearer is required in practice.
    The explicit ``?tenant_id=`` param is kept as defense-in-depth —
    coord asserts it matches the bearer's home tenant.
    """
    url = f"{settings.COORD_URL.rstrip('/')}/coord/status"
    params: dict[str, str] = {"tenant_id": str(tenant_id)}
    if since is not None:
        params["since"] = since
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        resp = await client.get(url, params=params, headers=headers)
    resp.raise_for_status()
    body: Any = resp.json()
    if not isinstance(body, dict):
        # Defensive — coord always wraps; treat anything else as empty.
        return {"devices": [], "count": 0}
    return body


async def mint_device_status_token(*, tenant_id: UUID) -> str:
    """Mint a coord-issued service JWT scoped to ``tenant_id``.

    The minted token carries:

    - ``sub = "service:qontinui-web-device-status"``
    - ``sub_type = "service"``
    - ``tenant_id = <tenant_id>``  (Phase 1.3 of coordination-improvements)
    - 4h TTL (same as agent tokens)

    Coord's ``/ws/device-status`` subscription gate
    (``device_status_ws::claims_can_subscribe``) requires the JWT's
    ``tenant_id`` claim to match the requested
    ``device_status:<tenant_uuid>`` topic — that's the per-tenant
    isolation the dashboard relies on.

    Raises:
        CoordDeviceStatusDisabledError: ``COORD_ADMIN_SECRET`` unset
            (feature is intentionally disabled until coord is reachable
            with an admin secret).
        CoordDeviceStatusMintFailedError: coord rejected the mint
            (transport error, 4xx/5xx response). Surfaced as 502 by
            the calling endpoint.
    """
    admin_secret = settings.COORD_ADMIN_SECRET
    if not admin_secret:
        raise CoordDeviceStatusDisabledError(
            "COORD_ADMIN_SECRET not set — device-status WS bridge disabled"
        )

    url = f"{settings.COORD_URL.rstrip('/')}/coord/auth/service-token"
    payload = {
        "service_name": DEVICE_STATUS_SERVICE_NAME,
        "tenant_id": str(tenant_id),
        # The WS subscription gate only inspects the `tenant_id`
        # claim; no scope grants are required to read device_status.
        # We pass an empty scopes object to make that explicit
        # rather than implicit.
        "scopes": {},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                headers={"X-Coord-Admin-Secret": admin_secret},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token transport failed: {exc}"
        ) from exc

    if resp.status_code != 200:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token mint failed: HTTP {resp.status_code} "
            f"{resp.text[:200]}"
        )

    try:
        body = resp.json()
    except ValueError as exc:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token response not JSON: {resp.text[:200]}"
        ) from exc

    token = body.get("token")
    if not isinstance(token, str) or not token:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token response missing 'token' field: {body!r}"
        )
    logger.info(
        "device_status_token_minted",
        sub=body.get("sub"),
        tenant_id=str(tenant_id),
        exp=body.get("exp"),
    )
    return token


def build_device_status_ws_url(token: str) -> str:
    """Build the upstream coord WS URL with the token query param.

    Coord exposes the WS at ``wss?://<coord-host>/ws/device-status``;
    the token is carried in the query string (browsers can't set
    headers on WS upgrades, and coord's handler reads
    `?token=<jwt>` accordingly).

    """
    return f"{_coord_ws_base()}/ws/device-status?token={token}"


def _coord_ws_base() -> str:
    """``COORD_URL`` with its scheme translated for a WS upgrade.

    `http://` → `ws://`, `https://` → `wss://`. Falls back to `ws://`
    for any other (defensive — we don't expect another scheme).
    """
    base = settings.COORD_URL.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :]
    if base.startswith("http://"):
        return "ws://" + base[len("http://") :]
    return "ws://" + base


# The subscription names the coord-events bridge will forward to coord's
# generic ``/ws``. Coord's ``/ws`` takes a CLOSED set of named
# subscriptions (``?subscribe=<name>``, each mapped server-side to a fixed
# pattern the principal is entitled to; a caller-supplied ``?pattern=`` is
# refused) — plan
# 2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose
# Phase 2. These four are the ones a tenant-scoped service token (the web
# backend's identity) is admitted to:
#
#   strategy → events.strategy.*   (presence + mentions on /strategy)
#   merge    → events.merge.*      (the merge-pipeline hero's refetch trigger)
#   claims   → events.claims
#   branches → events.branches
#
# ``device`` and ``device_ci`` are deliberately ABSENT: those resolve to the
# token's own ``device_id`` claim (``events.agent.spawn_requested.<device>``
# and friends) and are runner-only — a service token has no device, and the
# spawn channel is the one whose contents this plan exists to take off the
# bus. Widening this set is a deliberate exposure decision, not a config
# change: every name here must also be in coord's map, or the upstream
# refuses 403 ``unknown_subscription``.
#: Subscription name → the channel FAMILY it is entitled to, spelled the way
#: coord resolves it: a trailing ``.`` means "prefix" (``events.strategy.*``
#: → every ``events.strategy.<anything>``), no trailing ``.`` means the exact
#: channel. The bridge enforces this on EVERY relayed frame
#: (:func:`channel_in_family`), not only at the upgrade: against a coord that
#: predates the ``?subscribe=`` half (``WsParams { pattern }`` defaulting to
#: ``events.*`` with unknown query params ignored) the upstream socket would
#: otherwise carry the ENTIRE bus — including the
#: ``events.agent.spawn_requested.<device>`` frames whose JWT payloads this
#: plan exists to take off it — into every operator's browser.
COORD_EVENTS_FAMILIES: dict[str, str] = {
    "strategy": "events.strategy.",
    "merge": "events.merge.",
    "claims": "events.claims",
    "branches": "events.branches",
}

COORD_EVENTS_SUBSCRIPTIONS: frozenset[str] = frozenset(COORD_EVENTS_FAMILIES)


def channel_in_family(subscribe: str, channel: str) -> bool:
    """True when ``channel`` is one the ``subscribe`` name is entitled to.

    A prefix family (trailing ``.``) admits any channel that starts with it;
    an exact family admits only the identical channel. An unknown
    ``subscribe`` admits nothing.
    """
    family = COORD_EVENTS_FAMILIES.get(subscribe)
    if family is None:
        return False
    if family.endswith("."):
        return channel.startswith(family)
    return channel == family


def envelope_channel(message: str) -> str | None:
    """The ``channel`` of a coord ``{"channel","payload"}`` envelope, or None.

    None for anything that is not a JSON object carrying a string
    ``channel`` — the bridge drops such frames rather than relaying bytes it
    cannot classify.
    """
    try:
        envelope = json.loads(message)
    except ValueError:
        return None
    if not isinstance(envelope, dict):
        return None
    channel = envelope.get("channel")
    return channel if isinstance(channel, str) else None


def build_coord_events_ws_url(token: str, subscribe: str) -> str:
    """Build the upstream URL for coord's authenticated generic ``/ws``.

    ``wss?://<coord-host>/ws?token=<jwt>&subscribe=<name>``. The token
    rides the query string for the same reason as the device-status
    bridge (coord verifies it in-handler before ``on_upgrade``); the
    subscription name is validated against
    :data:`COORD_EVENTS_SUBSCRIPTIONS` here as well as by the caller, so
    an unknown name never reaches coord even from a future call site
    that forgets the check.
    """
    if subscribe not in COORD_EVENTS_SUBSCRIPTIONS:
        raise ValueError(f"unknown coord-events subscription: {subscribe!r}")
    return f"{_coord_ws_base()}/ws?token={token}&subscribe={subscribe}"


#: Interval, in seconds, at which the bridge sends a browser-bound keepalive
#: frame while the upstream is idle. Coord's own JetStream ``/ws`` publisher
#: gap on the strategy channel — the socket this plan re-homed — measured
#: ~70s reconnect cycles in production against an ALB idle-timeout class
#: boundary (finding 67329129); the backend<->coord leg already survives
#: this via `websockets`' 20s ping, but nothing kept the browser<->backend
#: leg alive. 20s mirrors that same margin on the newly-added leg.
COORD_EVENTS_KEEPALIVE_INTERVAL_S: float = 20.0

#: The frame itself. Deliberately has NO ``channel`` key: `useStrategyWebSocket`
#: keys its per-frame handling off `channel` already, so the channel-less
#: shape alone makes it inert there with no code change. `useMergePipelineData`
#: treats ANY message as "something changed, refetch" — it has no channel to
#: key off — so it checks for this exact `{"type":"keepalive"}` shape
#: explicitly (`isKeepaliveFrame`) before that frontend change landed
#: alongside this one. Built once; the bridge sends the same bytes every
#: interval.
COORD_EVENTS_KEEPALIVE_FRAME: str = json.dumps({"type": "keepalive"})
