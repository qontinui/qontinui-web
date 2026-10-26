"""Session load — read proxies for coord's ``/coord/session-runs`` routes.

Plan ``2026-10-23-session-duration-by-work-type-and-per-device-session-load``
Phase 5. Backs ``/admin/coord/session-load``: how long each work type holds a
session slot, how many sessions each machine carries against its configured
session budget, and how the fleet's demanded slot-hours grow against the
slot-hours its budgets make available. The coord side is the same plan's
Phase 3 — ``coord.session_runs`` (one row per Claude session run) and its
hourly rollup ``coord.session_run_hourly`` — served as four reads:

* ``GET /coord/session-runs`` — one page of runs, newest first, filtered by
  ``work_type``, ``device``, ``initiator`` and an optional ``since``/``until``
  window on ``started_at``, paged by coord's ``next_cursor``;
* ``GET /coord/session-runs/stats`` — runs, wall-time percentiles,
  slot-hours, held-after-finish, inferred / reconciled / unknown counts over
  the runs started in ``window``, grouped by ``work_type``, ``device`` or both;
* ``GET /coord/session-runs/concurrency`` — per device, open runs now, peak
  and p95 concurrency over ``window`` and a bucketed series by work type,
  beside the device's configured session budget;
* ``GET /coord/session-runs/growth`` — runs and slot-hours per day (or week)
  per work type against the fleet's available slot-hours, with the recording
  coverage (``recording_since``, ``devices_recording``) that says how much
  history exists.

Mounted under ``/operations`` beside the spawn ledger, for the same reasons
``spawn_ledger.py`` gives: the frontend's ``/api/v1/operations/`` prefix
already covers it, and a sibling module keeps the operations package's hub
file untouched and its no-``__init__``-import guard satisfied.

**Passthrough, not the generic helpers.** Every route forwards coord's status
and JSON body verbatim (``_proxy_coord_passthrough``). The answers the page
must tell apart reach it as coord said them:

* ``503 {"error": "schema_missing", "degraded": true, …}`` — coord's answer
  while ``coord.session_runs`` is not migrated. It stays a 503 with its body,
  so the page says the run record is not deployed rather than drawing an empty
  fleet;
* a ``404`` from a coord that predates the routes — UNKNOWN, never "no runs";
* ``400 {"error": "invalid_query_parameter", "field", "reason"}`` — coord's
  refusal of a parameter this edge let through (a window past coord's 400-day
  retention, a bucket too fine for a rollup window).

Coord unreachable is the helper's 502 and a coord timeout its 504; neither is
ever turned into an empty body.

**This proxy adds no defaults and zero-fills nothing.** A ``null``
percentile, a ``null`` ``recording_since`` or a ``{state: "none"}`` budget is
coord saying it cannot state the number, and it stays that way: the page
renders UNKNOWN, never ``0``.

**Admin-gated, like the spawn ledger.** The rows name each run's device,
Claude account, model and session id, and the concurrency read is the
per-device breakdown the Computers and Spawns pages already guard. All four
routes depend on ``require_coord_tenant_admin``.

**Typed at the edge.** Each query parameter is declared with coord's grammar
(``window`` ``<N>d``/``<N>h``, ``bucket`` coord's closed set, ``group_by``,
``initiator``), a UUID (``device``), an offset-carrying timestamp
(``since``/``until``) or coord's bound (``limit`` ≤ 500), so a malformed value
is a 422 here rather than reaching coord. ``work_type`` is checked for SHAPE
only (coord's vocabulary grows with its classifier, and a value this build has
not heard of must still filter). An unset filter is omitted from the forwarded
query string rather than sent empty.
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

SESSION_RUNS_COORD_PATH = "/coord/session-runs"

#: coord's window grammar (``parse_window``): a whole number of days or hours.
#: coord bounds it to 1h..=400d and answers a 400 outside that.
SESSION_RUNS_WINDOW_PATTERN = r"^[1-9][0-9]{0,4}[dh]$"

#: The shape of a ``work_type`` token (the schemas vocabulary is snake_case).
WORK_TYPE_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"

#: ``coord.session_runs.initiator``'s CHECK.
SessionRunInitiator = Literal["operator", "coord", "runner_local", "unknown"]

#: coord's ``parse_group_by``.
SessionRunGroupBy = Literal[
    "work_type", "device", "device,work_type", "work_type,device"
]

#: coord's ``parse_bucket`` for the concurrency read.
ConcurrencyBucket = Literal[
    "1m", "5m", "15m", "1h", "hour", "6h", "1d", "day", "7d", "week"
]

#: The growth read accepts day or week buckets only.
GrowthBucket = Literal["1d", "day", "7d", "week"]

#: coord's page bound for ``GET /coord/session-runs`` (default 50).
SESSION_RUNS_LIST_MAX_LIMIT = 500


def _rfc3339_utc(value: AwareDatetime) -> str:
    """An aware timestamp as coord reads it: RFC 3339, UTC, ``Z``-suffixed."""
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _window_query() -> Any:
    return Query(
        default=None,
        pattern=SESSION_RUNS_WINDOW_PATTERN,
        description=(
            "The window, ``<N>d`` or ``<N>h`` (coord bounds it to 1h..400d). "
            "Unset takes coord's default."
        ),
    )


@router.get("/session-runs")
async def get_session_runs(
    work_type: str | None = Query(
        default=None,
        pattern=WORK_TYPE_PATTERN,
        description="Only runs classified as this work type.",
    ),
    device: UUID | None = Query(
        default=None,
        description="Only runs on this coord device.",
    ),
    initiator: SessionRunInitiator | None = Query(
        default=None,
        description="Only runs this initiator started.",
    ),
    since: AwareDatetime | None = Query(
        default=None,
        description=(
            "Only runs started at or after this instant. Must carry a UTC "
            "offset — a naive timestamp names no instant."
        ),
    ),
    until: AwareDatetime | None = Query(
        default=None,
        description="Only runs started before this instant (offset required).",
    ),
    cursor: str | None = Query(
        default=None,
        max_length=512,
        description="coord's ``next_cursor`` from the previous page.",
    ),
    limit: int | None = Query(
        default=None,
        ge=1,
        le=SESSION_RUNS_LIST_MAX_LIMIT,
        description="Page size; coord's default is 50.",
    ),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> JSONResponse:
    """Proxy coord's ``GET /coord/session-runs`` (tenant-scoped), verbatim.

    Returns ``{runs: [Run], shown, total, truncated, next_cursor, as_of}``,
    newest first, or coord's ``503 schema_missing`` while the run record is
    not migrated. A ``Run`` carries its device, session id and ``run_seq``,
    ``initiator``, ``work_type`` (and the facts it was classified from —
    ``skill``, ``first_command``, ``spawn_origin``, ``dispatch_source``,
    ``gate_id``, ``spawn_request_id`` …), its timestamps, ``wall_seconds`` and
    ``held_after_finish_seconds`` (``null`` while open), ``end_reason`` /
    ``end_source`` and ``history_complete`` (``false`` on a backfilled row).
    """
    params: dict[str, Any] = {}
    if work_type is not None:
        params["work_type"] = work_type
    if device is not None:
        params["device"] = str(device)
    if initiator is not None:
        params["initiator"] = initiator
    if since is not None:
        params["since"] = _rfc3339_utc(since)
    if until is not None:
        params["until"] = _rfc3339_utc(until)
    if cursor is not None:
        params["cursor"] = cursor
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_passthrough(
        "GET", SESSION_RUNS_COORD_PATH, tenant_id=tenant_id, params=params or None
    )


@router.get("/session-runs/stats")
async def get_session_run_stats(
    window: str | None = _window_query(),
    group_by: SessionRunGroupBy | None = Query(
        default=None,
        description="Group by ``work_type`` (coord's default), ``device``, or both.",
    ),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> JSONResponse:
    """Proxy coord's ``GET /coord/session-runs/stats`` (tenant-scoped), verbatim.

    Returns ``{window_seconds, since, group_by, population, groups: [Group],
    classifier_version, as_of}``. Each group carries ``runs``, ``open_now``,
    ``wall_seconds {p50, p90, p99, sum, samples}`` over OBSERVED ends only,
    ``slot_hours``, ``active_seconds``, ``held_after_finish_seconds {sum,
    samples}`` and the ``inferred`` / ``reconciled`` / ``unknown`` counts. A
    percentile over no observed end is ``null`` — coord's UNKNOWN.
    """
    params: dict[str, Any] = {}
    if window is not None:
        params["window"] = window
    if group_by is not None:
        params["group_by"] = group_by
    return await _proxy_coord_passthrough(
        "GET",
        f"{SESSION_RUNS_COORD_PATH}/stats",
        tenant_id=tenant_id,
        params=params or None,
    )


@router.get("/session-runs/concurrency")
async def get_session_run_concurrency(
    device: UUID | None = Query(
        default=None,
        description="Only this coord device (unset = every device that ran a session).",
    ),
    window: str | None = _window_query(),
    bucket: ConcurrencyBucket | None = Query(
        default=None,
        description="Series bucket width; coord's default is ``1h``.",
    ),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> JSONResponse:
    """Proxy coord's ``GET /coord/session-runs/concurrency`` (tenant-scoped), verbatim.

    Returns ``{window_seconds, bucket_seconds, since, raw_from, grid, devices:
    [Device], truncated, as_of}``. A ``Device`` carries ``name``, ``budget``
    (``{state: "published" | "zero" | "none", value, label}`` — read from
    ``max_concurrent_agents``, never from a role), ``last_heartbeat`` /
    ``heartbeat_age_seconds``, ``known_device``, ``open_now``, ``peak``,
    ``p95`` and its ``series`` of ``{bucket_start, source, total, by_work_type}``.
    """
    params: dict[str, Any] = {}
    if device is not None:
        params["device"] = str(device)
    if window is not None:
        params["window"] = window
    if bucket is not None:
        params["bucket"] = bucket
    return await _proxy_coord_passthrough(
        "GET",
        f"{SESSION_RUNS_COORD_PATH}/concurrency",
        tenant_id=tenant_id,
        params=params or None,
    )


@router.get("/session-runs/growth")
async def get_session_run_growth(
    window: str | None = _window_query(),
    bucket: GrowthBucket | None = Query(
        default=None,
        description="Day (coord's default) or week buckets.",
    ),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> JSONResponse:
    """Proxy coord's ``GET /coord/session-runs/growth`` (tenant-scoped), verbatim.

    Returns ``{window_seconds, bucket_seconds, since, raw_from,
    recording_since, devices_recording, series: [Bucket], fleet, truncated,
    as_of}``. Each bucket carries ``runs`` / ``slot_hours`` per work type and
    their totals, ``partial`` (the bucket holding now) and ``backfilled_runs``;
    ``fleet`` carries ``available_slot_hours_per_day`` (published non-zero
    budgets × 24) and how many devices published a budget, a zero budget or
    none. ``recording_since: null`` means nothing is recorded yet — an absent
    bucket before it is UNKNOWN, not zero.
    """
    params: dict[str, Any] = {}
    if window is not None:
        params["window"] = window
    if bucket is not None:
        params["bucket"] = bucket
    return await _proxy_coord_passthrough(
        "GET",
        f"{SESSION_RUNS_COORD_PATH}/growth",
        tenant_id=tenant_id,
        params=params or None,
    )
