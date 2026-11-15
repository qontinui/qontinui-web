"""Fleet device bindings — remove a machine's devices from the caller's tenant.

Plan ``2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console``
Phase 1. One route under ``/api/v1/operations``:

* ``POST /fleet/devices/unbind`` — body ``{"device_ids": [uuid, …]}`` (1 to 64,
  unique). For each id it calls coord's per-tenant unbind,
  ``DELETE /coord/devices/{id}/tenant-binding``, which deletes only the
  ``(acting tenant, device)`` edge. Every other tenant's binding, and the device
  row itself, are untouched (plan D1: full deregistration stays on the device
  owner's ``/runners`` page).

**Why a LIST of ids (plan D3).** A CI host registered on N repos is N
``coord.devices`` rows, grouped per roster entry by coord's
``MachineView.device_ids``. Coord's unbind is per device, so this route calls it
once per id and reports a per-id outcome rather than one verdict for the batch.
The console must be able to say "2 of 3 rows removed; 1 failed", never a single
success for a partial removal (served policy ``ux-priorities``
``an-action-must-acknowledge-itself``). Each edge is independent and a repeat
call reads ``already_absent``, so a retry of a partial batch is safe.

Per-id outcomes — every requested id gets exactly one:

* ``unbound`` — coord answered 2xx with its documented body
  (``binding_deleted: true``). Coord answers this route ``200`` and nothing else
  on success; ``status`` is the status coord actually sent. Coord's
  ``still_member_via_pointer`` (plan D4: the device still lists in this tenant
  through its legacy home-tenant pointer, which only its owner can change)
  passes through when coord sends a boolean, and is ``null`` — UNKNOWN — when it
  does not. An older coord omits the field, and that must never read as
  ``false`` (served policy ``verification-and-evidence``
  ``unknown-must-not-render-as-a-default``).
* ``already_absent`` — coord 404 whose structured body is
  ``{"error": "binding_not_found"}``. A 404 WITHOUT that body (a coord that
  predates the route, a proxy's error page) is ``failed``: it says nothing
  about the binding.
* ``unknown`` — the request may have reached coord and coord may have acted,
  but its answer did not arrive intact: a read/write timeout, a transport error
  after the request was sent (``ReadError``, ``RemoteProtocolError``, …), the
  batch's wall budget expiring mid-call, a gateway 504, a 502/503 whose body is
  not a coord JSON object (a gateway's answer, not coord's), any coord 500 (coord
  also answers ``500 db_error`` when the delete's COMMIT failed, so the
  binding's state is not knowable from the answer), or a 2xx whose body is not
  coord's documented one. ``error`` is
  ``{"error": "coord_answer_lost", "detail": …}``. Never ``failed``, which would
  invite the operator to treat a possibly-removed binding as still present.
* ``failed`` — coord refused with its own structured JSON body as ``error``
  (``503 tenant_devices_absent``, a 400, …), or coord was never reached (a connect error or
  connect/pool timeout: nothing was sent, status 502/504,
  ``{"error": "coord_unreachable"}``).
* ``not_attempted`` — the id was never sent, because the batch's
  :data:`BATCH_DEADLINE_SECONDS` wall budget ran out first, or because an
  earlier id's caller refusal aborted the batch. Still a 200 in the deadline
  case, so the outcomes already reached are reported, not lost.

**A coord 401 / 403 aborts the batch, and this route answers 403 for both.**
An auth refusal is a property of the caller, not of the row, so continuing would
only repeat it. The route never answers HTTP 401: the web client treats a 401
as a stale token, refreshes it and REPLAYS the POST, which would re-run a batch
whose earlier ids already landed. Coord's own status is kept in the body as
``coord_status``. The error body still carries a complete ``results`` list (the refused id as
``failed``, every later id as ``not_attempted``) with the tallies, so nothing
already removed goes unreported.

It is a sibling module rather than a module INSIDE the ``operations`` package
because the package's D4 guard (``tests/test_operations_route_table.py``
``test_operations_package_has_no_init_imports``) forbids a submodule importing
the package ``__init__``, where the proxy plumbing still lives; it comes through
:mod:`app.api.coord_proxy`. The coord call is made here rather than through
``_proxy_coord_delete`` because that helper returns only the body and turns
every transport failure into an ``HTTPException``, which hides the two facts
this route has to report per id: coord's status, and whether a failure happened
before or after the request was sent. Mounted under ``/operations`` so the
frontend's active-tenant prefix rule covers it; the operator's bearer and the
``X-Qontinui-Active-Tenant`` selection are forwarded by ``_tenant_headers``, so
coord scopes the unbind to the operator's EFFECTIVE tenant.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.coord_proxy import (
    _COORD_TIMEOUT,
    _coord_error_detail,
    _tenant_headers,
    require_coord_tenant_admin,
)
from app.core.config import settings

logger = structlog.get_logger(__name__)

router = APIRouter()

#: Upper bound on one batch. A roster machine groups one device row per
#: registered repo; 64 covers any real host.
MAX_DEVICE_IDS = 64

#: Wall-clock budget for one batch. Each coord call is bounded by the shared
#: coord timeout AND by what is left of this budget, so 64 slow answers cannot
#: hold the browser's request open for minutes; ids the budget does not reach
#: are reported ``not_attempted``.
BATCH_DEADLINE_SECONDS = 45.0

#: The clock the deadline is measured on (a module attribute so a test can
#: drive it).
_monotonic = time.monotonic

#: Coord's typed 404 body for "this device is not bound to your tenant".
_BINDING_NOT_FOUND = "binding_not_found"

#: Coord statuses that describe the CALLER, not the row — they abort the batch.
_CALLER_REFUSAL_STATUSES = frozenset({401, 403})

#: The status this route answers an aborted batch with, whichever of the two
#: coord sent. Never 401: the web client replays a POST after a 401 refresh.
_ABORT_STATUS = 403

#: Statuses a gateway in front of coord also answers with. Without coord's JSON
#: object body they are the gateway's, so the outcome is UNKNOWN, not a refusal.
_GATEWAY_STATUSES = frozenset({502, 503})

UnbindOutcome = Literal[
    "unbound", "already_absent", "unknown", "failed", "not_attempted"
]


class FleetDeviceUnbindRequest(BaseModel):
    """Closed body for ``POST /operations/fleet/devices/unbind``."""

    model_config = ConfigDict(extra="forbid")

    device_ids: list[UUID] = Field(..., min_length=1, max_length=MAX_DEVICE_IDS)

    @field_validator("device_ids")
    @classmethod
    def _ids_are_unique(cls, v: list[UUID]) -> list[UUID]:
        if len(set(v)) != len(v):
            raise ValueError("device_ids must not contain duplicates")
        return v


class FleetDeviceUnbindResult(BaseModel):
    """What happened to one device id."""

    device_id: UUID
    outcome: UnbindOutcome
    #: The HTTP status coord sent for this id (coord answers ``200`` on
    #: success, never another 2xx); 502/504 when coord was not reached or its
    #: answer was lost in transit; ``None`` for ``not_attempted``.
    status: int | None
    #: Coord's structured body for ``already_absent`` / ``failed``, or this
    #: route's ``{"error": "coord_answer_lost" | "coord_unreachable" |
    #: "not_attempted", …}``; ``None`` for ``unbound``.
    error: Any = None
    #: ``True``/``False`` as coord reported it for an ``unbound`` id; ``None``
    #: when coord did not report it (an older build) or the id was not unbound.
    still_member_via_pointer: bool | None = None


class FleetDeviceUnbindResponse(BaseModel):
    """Per-id results (one per requested id, in request order) plus tallies."""

    results: list[FleetDeviceUnbindResult]
    unbound: int
    already_absent: int
    unknown: int
    failed: int
    not_attempted: int


def _tally(results: list[FleetDeviceUnbindResult]) -> FleetDeviceUnbindResponse:
    def count(outcome: UnbindOutcome) -> int:
        return sum(1 for r in results if r.outcome == outcome)

    return FleetDeviceUnbindResponse(
        results=results,
        unbound=count("unbound"),
        already_absent=count("already_absent"),
        unknown=count("unknown"),
        failed=count("failed"),
        not_attempted=count("not_attempted"),
    )


def _lost(device_id: UUID, status: int, detail: str) -> FleetDeviceUnbindResult:
    return FleetDeviceUnbindResult(
        device_id=device_id,
        outcome="unknown",
        status=status,
        error={"error": "coord_answer_lost", "detail": detail},
    )


def _unreachable(device_id: UUID, status: int, detail: str) -> FleetDeviceUnbindResult:
    return FleetDeviceUnbindResult(
        device_id=device_id,
        outcome="failed",
        status=status,
        error={"error": "coord_unreachable", "detail": detail},
    )


def _not_attempted(device_id: UUID, reason: str) -> FleetDeviceUnbindResult:
    return FleetDeviceUnbindResult(
        device_id=device_id,
        outcome="not_attempted",
        status=None,
        error={"error": "not_attempted", "detail": reason},
    )


def _classify_response(
    device_id: UUID, resp: httpx.Response
) -> FleetDeviceUnbindResult:
    """Map coord's answer for one id to its outcome."""
    status = resp.status_code
    if 200 <= status < 300:
        try:
            body = resp.json()
        except ValueError:
            return _lost(
                device_id, status, f"coord answered {status} with a non-JSON body"
            )
        if not isinstance(body, dict) or body.get("binding_deleted") is not True:
            return _lost(
                device_id,
                status,
                f"coord answered {status} without its documented binding_deleted: true",
            )
        pointer = body.get("still_member_via_pointer")
        return FleetDeviceUnbindResult(
            device_id=device_id,
            outcome="unbound",
            status=status,
            error=None,
            still_member_via_pointer=pointer if isinstance(pointer, bool) else None,
        )
    detail = _coord_error_detail(resp)
    is_coord_body = isinstance(detail, dict) and isinstance(detail.get("error"), str)
    if status in _GATEWAY_STATUSES and not is_coord_body:
        # A gateway in front of coord answered, not coord: every structured
        # error coord returns carries a string `error` key, so anything else
        # (text, or a gateway's own JSON such as {"message": ...}) is not
        # coord's reply, and the request may have been applied.
        return FleetDeviceUnbindResult(
            device_id=device_id,
            outcome="unknown",
            status=status,
            error={
                "error": "coord_answer_lost",
                "detail": f"a gateway in front of coord answered {status} with no "
                "coord body; coord may have acted",
                "upstream": detail,
            },
        )
    if status == 500:
        # Coord's own internal error. Its `db_error` body is also what it sends
        # when the delete's COMMIT failed, and an unexpected error may follow a
        # write, so the binding may or may not be gone.
        return FleetDeviceUnbindResult(
            device_id=device_id,
            outcome="unknown",
            status=status,
            error={
                "error": "coord_answer_lost",
                "detail": "coord reported an internal error after it may have acted",
                "upstream": detail,
            },
        )
    if status == 504:
        # A gateway timeout in front of coord: the request was forwarded and
        # coord may have applied it.
        return FleetDeviceUnbindResult(
            device_id=device_id,
            outcome="unknown",
            status=status,
            error={
                "error": "coord_answer_lost",
                "detail": "a gateway in front of coord timed out; coord may have acted",
                "upstream": detail,
            },
        )
    is_binding_not_found = (
        status == 404
        and isinstance(detail, dict)
        and detail.get("error") == _BINDING_NOT_FOUND
    )
    return FleetDeviceUnbindResult(
        device_id=device_id,
        outcome="already_absent" if is_binding_not_found else "failed",
        status=status,
        error=detail,
    )


async def _unbind_one(
    client: httpx.AsyncClient, device_id: UUID, tenant_id: UUID, budget: float
) -> FleetDeviceUnbindResult:
    """Call coord for one id and classify every way the call can end."""
    base = _COORD_TIMEOUT.read if _COORD_TIMEOUT.read is not None else budget
    # Leave wait_for a margin so a connect that never completes is reported by
    # httpx (nothing sent → failed), not by the wall-clock budget (unknown).
    timeout = httpx.Timeout(max(min(base, budget - _WAIT_FOR_MARGIN_SECONDS), 0.05))
    url = f"{settings.COORD_URL}/coord/devices/{device_id}/tenant-binding"
    try:
        # wait_for makes the batch budget a real total: httpx's timeout bounds
        # each phase (connect, read, …) separately, not the whole call.
        resp = await asyncio.wait_for(
            client.delete(url, headers=_tenant_headers(tenant_id), timeout=timeout),
            timeout=budget,
        )
    except TimeoutError:
        return _lost(
            device_id,
            504,
            "the batch's wall-clock budget ran out while waiting for coord; "
            "it may have acted",
        )
    except (
        httpx.ConnectError,
        httpx.ConnectTimeout,
        httpx.PoolTimeout,
        httpx.UnsupportedProtocol,
        httpx.ProxyError,
    ) as exc:
        # Nothing was sent: coord cannot have acted.
        status = (
            504 if isinstance(exc, (httpx.ConnectTimeout, httpx.PoolTimeout)) else 502
        )
        return _unreachable(
            device_id, status, f"coord was not reached ({type(exc).__name__})"
        )
    except httpx.TimeoutException as exc:
        return _lost(
            device_id,
            504,
            f"coord did not answer in time ({type(exc).__name__}); it may have acted",
        )
    except httpx.HTTPError as exc:
        return _lost(
            device_id,
            502,
            f"coord's answer was lost in transit ({type(exc).__name__}); it may have acted",
        )
    return _classify_response(device_id, resp)


_LOG_UPSTREAM_MAX_CHARS = 500
# A call started with less budget than this would almost surely come back
# unknown; reporting it not_attempted is the honest answer.
_MIN_CALL_BUDGET_SECONDS = 0.5
_WAIT_FOR_MARGIN_SECONDS = 0.1


def _truncate_for_log(text: str) -> str:
    if len(text) <= _LOG_UPSTREAM_MAX_CHARS:
        return text
    return text[:_LOG_UPSTREAM_MAX_CHARS] + "…"


def _log_row(result: FleetDeviceUnbindResult, tenant_id: UUID) -> None:
    """Log one finished id server-side: ``unbound`` at info, and ``unknown`` or
    ``failed`` at warning (``already_absent`` and ``not_attempted`` changed
    nothing and are not logged per row).

    So the web log names which ids were removed and which may have been. A
    gateway's raw body is truncated (whether coord's raw non-JSON text or a
    gateway's `upstream` body) so an HTML error page cannot flood the log line.
    """
    if result.outcome == "unbound":
        logger.info(
            "fleet_devices_unbind_row",
            tenant_id=str(tenant_id),
            device_id=str(result.device_id),
            outcome=result.outcome,
            status=result.status,
            still_member_via_pointer=result.still_member_via_pointer,
        )
        return
    if result.outcome in ("unknown", "failed"):
        error = result.error
        if isinstance(error, str):
            error = _truncate_for_log(error)
        elif isinstance(error, dict) and isinstance(error.get("upstream"), str):
            error = {**error, "upstream": _truncate_for_log(error["upstream"])}
        logger.warning(
            "fleet_devices_unbind_row",
            tenant_id=str(tenant_id),
            device_id=str(result.device_id),
            outcome=result.outcome,
            status=result.status,
            error=error,
        )


@router.post("/fleet/devices/unbind", response_model=FleetDeviceUnbindResponse)
async def post_fleet_devices_unbind(
    body: FleetDeviceUnbindRequest,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> FleetDeviceUnbindResponse:
    """Remove each named device's binding to the caller's tenant (operator-only).

    Calls coord sequentially, one id at a time, within
    :data:`BATCH_DEADLINE_SECONDS`, so an auth refusal stops the batch before it
    is repeated for every remaining id. See the module docstring for the
    outcomes.
    """
    ids = body.device_ids
    results: list[FleetDeviceUnbindResult] = []
    deadline = _monotonic() + BATCH_DEADLINE_SECONDS
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        for index, device_id in enumerate(ids):
            remaining = deadline - _monotonic()
            if remaining < _MIN_CALL_BUDGET_SECONDS:
                results.extend(
                    _not_attempted(d, "the batch's wall-clock budget ran out first")
                    for d in ids[index:]
                )
                break
            result = await _unbind_one(client, device_id, tenant_id, remaining)
            results.append(result)
            # Each row is logged as soon as its call FINISHES, so rows that
            # finished before a later crash or cancellation are on record. A
            # row whose call was in flight when the request was cancelled is
            # not logged here; coord's own audit row is the authority on what
            # was removed.
            _log_row(result, tenant_id)
            refused_status = result.status
            if (
                refused_status is not None
                and refused_status in _CALLER_REFUSAL_STATUSES
            ):
                results.extend(
                    _not_attempted(d, "the batch was aborted by a caller refusal")
                    for d in ids[index + 1 :]
                )
                partial = _tally(results)
                logger.warning(
                    "fleet_devices_unbind_aborted",
                    tenant_id=str(tenant_id),
                    device_id=str(device_id),
                    coord_status=refused_status,
                    reached=index + 1,
                    requested=len(ids),
                    unbound=partial.unbound,
                    already_absent=partial.already_absent,
                    unknown=partial.unknown,
                    failed=partial.failed,
                    not_attempted=partial.not_attempted,
                )
                raise HTTPException(
                    status_code=_ABORT_STATUS,
                    detail={
                        "error": "coord_refused_caller",
                        "coord_status": refused_status,
                        "coord_error": result.error,
                        "refused_device_id": str(device_id),
                        **partial.model_dump(mode="json"),
                    },
                )

    response = _tally(results)
    logger.info(
        "fleet_devices_unbind",
        tenant_id=str(tenant_id),
        requested=len(ids),
        unbound=response.unbound,
        already_absent=response.already_absent,
        unknown=response.unknown,
        failed=response.failed,
        not_attempted=response.not_attempted,
    )
    return response
