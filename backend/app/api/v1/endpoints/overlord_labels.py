"""Operator label route for the overlord intervention ledger (Phase 2b).

``POST /api/v1/admin/coord/overlord/labels`` appends an operator label row to an
intervention's chain in coord. Gated on :func:`require_coord_tenant_admin` — a
signed-in operator USER; a device or agent token resolves no coord operator
identity and is refused there.

The coord write is an ``operator_page`` write: web's service token plus
``X-Qontinui-User-Id`` (``coord_service_account._headers``, the device-pairing
arm-B pattern), so coord derives ``label_source`` itself. This module never
sends it.

Coord's chain is append-only and has no by-id read, so the newest row is found
by paging the list door, each entry of which is one chain's newest row with its
columns at the entry's top level (see :func:`_newest_row_id`). ``supersedes``
must name that newest row; a 409 ``supersedes_not_latest`` (a concurrent
append) is retried once after re-reading it.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, StrictBool

from app.api.deps import get_current_active_user_async
from app.api.v1.endpoints.agent_sessions import ACTIVE_TENANT_HEADER
from app.api.v1.endpoints.operations import require_coord_tenant_admin
from app.core.config import settings
from app.models.user import User
from app.schemas.overlord_labels import OverlordLabelRequest
from app.services.coord_service_account import (
    CoordServiceAccountDisabledError,
    coord_service_account,
)

router = APIRouter()
logger = structlog.get_logger(__name__)

_PAGE = 200  # coord clamps `limit` to its own cap; this is the most it serves
_MAX_PAGES = 50  # 10k chains; a bound so a bad `truncated` can never loop forever
_COORD_TIMEOUT = httpx.Timeout(10.0)
_PATH = "/coord/overlord/interventions"


def _coord_detail(resp: httpx.Response) -> Any:
    """Coord's error body as an object when it is one, else its text."""
    try:
        parsed = resp.json()
    except ValueError:
        return resp.text[:500]
    return parsed if isinstance(parsed, dict) else resp.text[:500]


def _refuse_coord(resp: httpx.Response) -> HTTPException:
    """Coord 4xx passes through with its status; anything else is a 502.

    Except 401/403: those refuse WEB's service credential, not the operator, who
    already passed :func:`require_coord_tenant_admin`. Passed through, they would
    read in the browser as the operator's own session failing, so they are a 502.
    """
    if resp.status_code in (401, 403):
        logger.warning(
            "overlord_label_coord_refused_web",
            status=resp.status_code,
            body=resp.text[:500],
        )
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": "coord_upstream_error",
                "coord_status": resp.status_code,
                "coord_detail": _coord_detail(resp),
            },
        )
    if 400 <= resp.status_code < 500:
        return HTTPException(status_code=resp.status_code, detail=_coord_detail(resp))
    logger.warning(
        "overlord_label_coord_error", status=resp.status_code, body=resp.text[:500]
    )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={"error": "coord_upstream_error", "coord_status": resp.status_code},
    )


class _CoordEntry(BaseModel):
    """The two columns this route reads from one entry of coord's list page.

    Both are top-level keys, because coord flattens each chain's newest row into
    its entry (see :func:`_newest_row_id`). The entry's other keys are ignored.
    """

    id: UUID
    intervention_id: UUID


class _CoordPage(BaseModel):
    """The part of coord's list page this route reads."""

    interventions: list[_CoordEntry]
    truncated: StrictBool


def _malformed_page() -> HTTPException:
    """Coord's list page broke its contract: a 502, never a 404."""
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={"error": "coord_malformed_interventions_page"},
    )


async def _newest_row_id(
    client: httpx.AsyncClient, headers: dict[str, str], intervention_id: UUID
) -> str:
    """Id of the intervention chain's newest row, paging coord's list door.

    Each entry coord serves IS its chain's newest row: ``InterventionView``
    flattens that row's columns into the entry (``#[serde(flatten)] latest``,
    qontinui-coord ``crates/coord/src/overlord_interventions.rs``), beside
    ``history`` / ``history_len`` / ``history_truncated``. There is no nested
    ``latest`` key, so the chain is matched on the entry's own
    ``intervention_id`` and its newest row is the entry's own ``id``.

    Only a complete read of well-formed pages answers 404
    ``intervention_not_found``. A page that breaks :class:`_CoordPage`, and
    running out of pages while coord still says ``truncated``, are 502s: neither
    shows that the intervention does not exist.
    """
    offset = 0
    for _ in range(_MAX_PAGES):
        resp = await client.get(
            f"{settings.COORD_URL.rstrip('/')}{_PATH}",
            headers=headers,
            params={"limit": _PAGE, "offset": offset},
        )
        if resp.status_code != 200:
            raise _refuse_coord(resp)
        try:
            page = _CoordPage.model_validate(resp.json())
        except ValueError as exc:  # undecodable JSON, or a pydantic ValidationError
            raise _malformed_page() from exc
        for entry in page.interventions:
            if entry.intervention_id == intervention_id:
                return str(entry.id)
        if not page.truncated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": "intervention_not_found",
                    "intervention_id": str(intervention_id),
                },
            )
        if not page.interventions:
            # "More pages" with nothing on this one: the offset could never move.
            raise _malformed_page()
        offset += len(page.interventions)
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={
            "error": "intervention_lookup_incomplete",
            "intervention_id": str(intervention_id),
            "chains_read": offset,
        },
    )


@router.post("/labels")
async def post_overlord_label(
    payload: OverlordLabelRequest,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Append the operator's label to an intervention; return coord's new row."""
    try:
        headers = await coord_service_account._headers(str(current_user.id))  # noqa: SLF001
        # The service token is tenant-blind: coord takes the tenant from this
        # header (the membership-checked tenant require_coord_tenant_admin resolved),
        # trusting it on the same terms as X-Qontinui-User-Id. That is the Phase 2b
        # coord (qontinui-coord#3417); coord before it reads the tenant from the
        # token only, so it refuses these calls with 403 token_carries_no_tenant.
        headers[ACTIVE_TENANT_HEADER] = str(tenant_id)
    except CoordServiceAccountDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "coord_integration_disabled",
                "message": "COORD_ADMIN_SECRET unset; operator labels unavailable.",
            },
        ) from exc

    url = f"{settings.COORD_URL.rstrip('/')}{_PATH}"
    # True only while a POST is in flight: the one moment a transport failure
    # leaves the append unknown. A lookup GET that fails has written nothing.
    posting = False
    try:
        async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
            resp: httpx.Response | None = None
            for attempt in (1, 2):
                supersedes = await _newest_row_id(
                    client, headers, payload.intervention_id
                )
                body = {
                    "intervention_id": str(payload.intervention_id),
                    "supersedes": supersedes,
                    **payload.coord_fields(),
                }
                posting = True
                resp = await client.post(url, headers=headers, json=body)
                posting = False
                if resp.status_code == 409 and attempt == 1:
                    # A concurrent append moved the chain; re-read and go again.
                    logger.info(
                        "overlord_label_supersedes_retry",
                        intervention_id=str(payload.intervention_id),
                    )
                    continue
                break
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "coord_unreachable"},
        ) from exc
    except httpx.TimeoutException as exc:
        # Only a POST in flight may have landed; a re-read is the only way to know.
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={"error": "coord_timeout", "write_may_have_landed": posting},
        ) from exc
    except httpx.TransportError as exc:
        # The exchange broke mid-flight (read, write or protocol error).
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "coord_transport_error", "write_may_have_landed": posting},
        ) from exc

    assert resp is not None
    if resp.status_code not in (200, 201):
        raise _refuse_coord(resp)
    try:
        intervention = resp.json()["intervention"]
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "coord_malformed_label_response"},
        ) from exc
    return intervention
