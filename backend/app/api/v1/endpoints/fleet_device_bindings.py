"""Fleet device bindings — remove a machine's devices from the caller's tenant.

Plan ``2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console``
Phase 1. One route under ``/api/v1/operations``:

* ``POST /fleet/devices/unbind`` — body ``{"device_ids": [uuid, …]}`` (1 to 64,
  unique). For each id it proxies coord's per-tenant unbind,
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

Per-id outcome mapping:

* coord 2xx → ``unbound``. Coord's ``still_member_via_pointer`` (plan D4: the
  device still lists in this tenant through its legacy home-tenant pointer,
  which only its owner can change) passes through when coord sends a boolean,
  and is ``null`` — UNKNOWN — when it does not. An older coord omits the field,
  and that must never read as ``false`` (served policy
  ``verification-and-evidence`` ``unknown-must-not-render-as-a-default``).
* coord 404 whose structured body is ``{"error": "binding_not_found"}`` →
  ``already_absent``. A 404 WITHOUT that body (a coord that predates the route,
  a proxy's error page) is ``failed``: it says nothing about the binding.
* coord 401 / 403 → the whole batch ABORTS with coord's status. An auth refusal
  is a property of the caller, not of the row, so continuing would only repeat
  it; the error body still carries every result recorded before the refusal and
  the ids not attempted, so nothing already removed goes unreported.
* anything else (``503 tenant_devices_absent``, a 500, a 502/504 transport
  failure) → ``failed`` with coord's structured body as ``error``.

It is a sibling module rather than a module INSIDE the ``operations`` package
because the package's D4 guard (``tests/test_operations_route_table.py``
``test_operations_package_has_no_init_imports``) forbids a submodule importing
the package ``__init__``, where the proxy helpers still live; the helpers come
through :mod:`app.api.coord_proxy`. Mounted under ``/operations`` so the
frontend's active-tenant prefix rule covers it, and coord scopes the unbind to
the operator's EFFECTIVE tenant from the forwarded bearer and selection.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.coord_proxy import _proxy_coord_delete, require_coord_tenant_admin

logger = structlog.get_logger(__name__)

router = APIRouter()

#: Upper bound on one batch. A roster machine groups one device row per
#: registered repo; 64 covers any real host while keeping one request's
#: sequential coord round-trips bounded.
MAX_DEVICE_IDS = 64

#: Coord's typed 404 body for "this device is not bound to your tenant".
_BINDING_NOT_FOUND = "binding_not_found"

#: Coord statuses that describe the CALLER, not the row — they abort the batch.
_CALLER_REFUSAL_STATUSES = frozenset({401, 403})

UnbindOutcome = Literal["unbound", "already_absent", "failed"]


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
    """What coord answered for one device id."""

    device_id: UUID
    outcome: UnbindOutcome
    #: Coord's HTTP status for this id (502/504 when coord was not reached).
    status: int
    #: Coord's structured refusal for a ``failed`` or ``already_absent`` id;
    #: ``None`` for ``unbound``.
    error: Any = None
    #: ``True``/``False`` as coord reported it for an ``unbound`` id; ``None``
    #: when coord did not report it (an older build) or the id was not unbound.
    still_member_via_pointer: bool | None = None


class FleetDeviceUnbindResponse(BaseModel):
    """Per-id results plus the tally of each outcome."""

    results: list[FleetDeviceUnbindResult]
    unbound: int
    already_absent: int
    failed: int


def _tally(results: list[FleetDeviceUnbindResult]) -> FleetDeviceUnbindResponse:
    return FleetDeviceUnbindResponse(
        results=results,
        unbound=sum(1 for r in results if r.outcome == "unbound"),
        already_absent=sum(1 for r in results if r.outcome == "already_absent"),
        failed=sum(1 for r in results if r.outcome == "failed"),
    )


def _unbound_result(device_id: UUID, body: Any) -> FleetDeviceUnbindResult:
    pointer = body.get("still_member_via_pointer") if isinstance(body, dict) else None
    return FleetDeviceUnbindResult(
        device_id=device_id,
        outcome="unbound",
        status=200,
        error=None,
        still_member_via_pointer=pointer if isinstance(pointer, bool) else None,
    )


def _refused_result(device_id: UUID, exc: HTTPException) -> FleetDeviceUnbindResult:
    detail = exc.detail
    is_binding_not_found = (
        exc.status_code == 404
        and isinstance(detail, dict)
        and detail.get("error") == _BINDING_NOT_FOUND
    )
    return FleetDeviceUnbindResult(
        device_id=device_id,
        outcome="already_absent" if is_binding_not_found else "failed",
        status=exc.status_code,
        error=detail,
        still_member_via_pointer=None,
    )


@router.post("/fleet/devices/unbind", response_model=FleetDeviceUnbindResponse)
async def post_fleet_devices_unbind(
    body: FleetDeviceUnbindRequest,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> FleetDeviceUnbindResponse:
    """Remove each named device's binding to the caller's tenant (operator-only).

    Calls coord sequentially, one id at a time, so an auth refusal stops the
    batch before it is repeated for every remaining id. See the module
    docstring for the per-id outcome mapping.
    """
    results: list[FleetDeviceUnbindResult] = []
    for index, device_id in enumerate(body.device_ids):
        try:
            coord_body = await _proxy_coord_delete(
                f"/coord/devices/{device_id}/tenant-binding",
                tenant_id=tenant_id,
                structured_errors=True,
            )
        except HTTPException as exc:
            if exc.status_code in _CALLER_REFUSAL_STATUSES:
                partial = _tally(results)
                logger.warning(
                    "fleet_devices_unbind_aborted",
                    tenant_id=str(tenant_id),
                    device_id=str(device_id),
                    coord_status=exc.status_code,
                    recorded=len(results),
                    requested=len(body.device_ids),
                )
                raise HTTPException(
                    status_code=exc.status_code,
                    detail={
                        "error": "coord_refused_caller",
                        "coord_error": exc.detail,
                        "refused_device_id": str(device_id),
                        "not_attempted": [str(d) for d in body.device_ids[index + 1 :]],
                        **partial.model_dump(mode="json"),
                    },
                ) from exc
            results.append(_refused_result(device_id, exc))
            continue
        results.append(_unbound_result(device_id, coord_body))

    response = _tally(results)
    logger.info(
        "fleet_devices_unbind",
        tenant_id=str(tenant_id),
        requested=len(body.device_ids),
        unbound=response.unbound,
        already_absent=response.already_absent,
        failed=response.failed,
    )
    return response
