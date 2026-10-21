"""Spawn ledger — read proxies for coord's ``/coord/spawns`` routes.

Plan ``2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration``
Phase 5. Backs ``/admin/coord/spawns``: every spawn coord was asked to place,
where it went, how long it waited and how it ended. The coord side is the same
plan's Phase 2 — ``coord.spawn_requests`` and its append-only
``coord.spawn_request_events``, served as three dashboard-tier reads:

* ``GET /coord/spawns`` — one page of requests, newest first unless
  ``order=asc``, filtered by ``class``, ``state`` (a comma list), ``device``
  and an optional ``since``/``until`` window, paged by an opaque ``cursor``;
* ``GET /coord/spawns/stats`` — the window's aggregates (started share, time to
  spawn p50/p90, requested and started per hour, first-attempt share, the
  queued backlog, per-device placement);
* ``GET /coord/spawns/{id}`` — one request and its event timeline.

Mounted under ``/operations`` (see ``app/api/v1/api.py``) beside the routes it
reads alongside, so the frontend's ``/api/v1/operations/`` active-tenant prefix
already covers it. It is a sibling module rather than a module INSIDE the
``operations`` package because the package's D4 guard
(``tests/test_operations_route_table.py``
``test_operations_package_has_no_init_imports``) forbids a submodule importing
from the package ``__init__`` — which is where ``_proxy_coord_passthrough`` and
``require_coord_tenant_admin`` still live — and so that adding these three
routes leaves the 16k-line hub file untouched. Same shape as
``repo_followup_dials.py``.

**Passthrough, not the generic helpers.** Every route forwards coord's status
and JSON body verbatim (``_proxy_coord_passthrough``). The page renders three
answers specifically, and each must reach it as coord said it:

* ``200 {"available": false, "reason": "schema_missing"}`` — coord's answer
  while the ledger tables are absent. It is a 200, not an error, so it passes
  through as one; the page says the ledger is not deployed rather than drawing
  an empty ledger.
* a ``404`` from a coord that predates the routes — UNKNOWN, never "no spawns";
* ``404 {"error": "spawn_not_found"}`` for a request id coord does not hold in
  the caller's tenant — "not found".

**This proxy adds no defaults and zero-fills nothing.** A ``null`` share, a
``null`` wait percentile or a ``null`` ``local_report_counts`` is coord saying
it cannot state the number, and it stays ``null``: the page renders UNKNOWN,
never ``0``.

**Admin-gated, like ``/computers``.** The rows name each spawn's device
history, Claude account and session id, and the stats read is the per-device
placement breakdown the Computers page's admin gate already guards. A
Developer-tier member must not read the same facts through a looser door, so
all three routes depend on ``require_coord_tenant_admin``.

**Typed at the edge.** Each query parameter is declared with coord's closed
vocabulary (``class``, each member of the ``state`` list, ``order``,
``window``), a UUID (``device``, the request id), an offset-carrying timestamp
(``since``/``until``) or coord's bound (``limit`` ≤ 200), so a malformed value
is a 422 here rather than a filter coord silently ignores — FastAPI drops an
undeclared query parameter on the floor, which is how an earlier proxy
reached coord with none of the filters its page sent. An unset filter is
omitted from the forwarded query string rather than sent empty.
"""

from __future__ import annotations

from datetime import UTC
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime

from app.api.v1.endpoints.operations import (
    _proxy_coord_passthrough,
    require_coord_tenant_admin,
)

router = APIRouter()

SPAWNS_COORD_PATH = "/coord/spawns"

#: coord's ``AdmissionClass`` (qontinui-coord#2761) — the CHECK on
#: ``coord.spawn_requests.class``.
SpawnClass = Literal["autofix", "continuation", "local", "attended"]

#: The CHECK on ``coord.spawn_requests.state``.
SPAWN_STATES: tuple[str, ...] = (
    "queued",
    "dispatched",
    "deferred",
    "spawned",
    "failed",
    "expired",
    "cancelled",
    "superseded",
)

#: coord's ``state`` filter is a comma list of those states (``queued,dispatched``).
#: Anchored, so a value with any other member — or an empty member — is a 422.
_STATE_ALTERNATION = "|".join(SPAWN_STATES)
SPAWN_STATE_LIST_PATTERN = rf"^(?:{_STATE_ALTERNATION})(?:,(?:{_STATE_ALTERNATION}))*$"

#: The list's order by ``requested_at`` (coord's default is ``desc``). ``asc``
#: lets a reader of still-waiting requests see the OLDEST first.
SpawnListOrder = Literal["asc", "desc"]

#: The windows coord's stats read aggregates over (its default is ``7d``).
SpawnStatsWindow = Literal["24h", "7d", "30d"]

#: coord's page bound for ``GET /coord/spawns`` (default 50).
SPAWNS_LIST_MAX_LIMIT = 200


def _rfc3339_utc(value: AwareDatetime) -> str:
    """An aware timestamp as coord reads it: RFC 3339, UTC, ``Z``-suffixed."""
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


@router.get("/spawns")
async def get_spawns(
    spawn_class: SpawnClass | None = Query(
        default=None,
        alias="class",
        description="Only requests of this admission class.",
    ),
    state: str | None = Query(
        default=None,
        pattern=SPAWN_STATE_LIST_PATTERN,
        description=(
            "Only requests currently in one of these states — a comma list, "
            "e.g. ``queued,dispatched,deferred``."
        ),
    ),
    device: UUID | None = Query(
        default=None,
        description="Only requests placed on, or started on, this coord device.",
    ),
    since: AwareDatetime | None = Query(
        default=None,
        description=(
            "Only requests first requested at or after this instant. Must carry "
            "a UTC offset — a naive timestamp names no instant."
        ),
    ),
    until: AwareDatetime | None = Query(
        default=None,
        description="Only requests first requested before this instant (offset required).",
    ),
    order: SpawnListOrder | None = Query(
        default=None,
        description=(
            "Order by ``requested_at``: ``desc`` (coord's default, newest "
            "first) or ``asc`` (oldest first)."
        ),
    ),
    cursor: str | None = Query(
        default=None,
        max_length=512,
        description="coord's opaque ``next_cursor`` from the previous page.",
    ),
    limit: int | None = Query(
        default=None,
        ge=1,
        le=SPAWNS_LIST_MAX_LIMIT,
        description="Page size; coord's default is 50.",
    ),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> JSONResponse:
    """Proxy coord's ``GET /coord/spawns`` (tenant-scoped), verbatim.

    Returns ``{available: true, items: [SpawnRow], shown, total, truncated,
    next_cursor, as_of}``, or ``{available: false, reason}`` while coord's
    ledger tables are absent. A ``SpawnRow`` carries the request's class and
    origin, its timestamps (``requested_at`` is the first moment coord tried to
    place it), its state, attempts and deferrals, its pinned / preferred /
    current / spawned device, its placement basis, the started session's id,
    account and outcome, ``history_complete`` (``false`` on a backfilled row)
    and ``wait_seconds`` (``null`` until it started).
    """
    params: dict[str, Any] = {}
    if spawn_class is not None:
        params["class"] = spawn_class
    if state is not None:
        params["state"] = state
    if device is not None:
        params["device"] = str(device)
    if since is not None:
        params["since"] = _rfc3339_utc(since)
    if until is not None:
        params["until"] = _rfc3339_utc(until)
    if order is not None:
        params["order"] = order
    if cursor is not None:
        params["cursor"] = cursor
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_passthrough(
        "GET", SPAWNS_COORD_PATH, tenant_id=tenant_id, params=params or None
    )


# Declared BEFORE ``/spawns/{spawn_id}``: routes match in declaration order, and
# the id route would otherwise claim ``stats`` and refuse it as a malformed UUID.
@router.get("/spawns/stats")
async def get_spawn_stats(
    window: SpawnStatsWindow | None = Query(
        default=None,
        description="Aggregation window; coord's default is ``7d``.",
    ),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> JSONResponse:
    """Proxy coord's ``GET /coord/spawns/stats`` (tenant-scoped), verbatim.

    Returns ``{available: true, window, window_start, as_of, overall,
    per_device, local_report_counts}``, or ``{available: false, reason}``.
    Every share and percentile in ``overall`` is ``null`` when its
    denominator is empty — coord's UNKNOWN, which this proxy never turns into
    a ``0``.
    """
    params = {"window": window} if window is not None else None
    return await _proxy_coord_passthrough(
        "GET", f"{SPAWNS_COORD_PATH}/stats", tenant_id=tenant_id, params=params
    )


@router.get("/spawns/{spawn_id}")
async def get_spawn(
    spawn_id: UUID,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> JSONResponse:
    """Proxy coord's ``GET /coord/spawns/{id}`` (tenant-scoped), verbatim.

    Returns ``{available: true, request: SpawnRow, events: [{at, kind,
    device_id, reason, detail}]}`` — the request and its device history
    (placed, dispatched, deferred, refused, rerouted, …), oldest first — or
    ``{available: false, reason}``. ``spawn_id`` is validated as a UUID here so
    a malformed id is a 422 at the web edge and never reaches coord as an
    arbitrary path segment.
    """
    return await _proxy_coord_passthrough(
        "GET", f"{SPAWNS_COORD_PATH}/{spawn_id}", tenant_id=tenant_id
    )
