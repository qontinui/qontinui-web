"""Per-device plan-scan-source readings — ``/api/v1/plan-library/scan-roots``.

Revised Phase 2 (web half) of
``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.

The plan corpus is fed by each runner's body sync, which scans a git working
tree, and nothing on the read side could see how far that tree is from its
default branch — on 2026-09-11 a scan source 254 commits behind left the
corpus 54 plans short while every sync cycle read ``errors=0``. The runner
measures the distance (``ScanDivergence``, qontinui-runner #1453, plus this
plan's ref age); these two routes carry each device's reading to a corpus
reader.

Routes
------
``POST /plan-library/scan-roots``  a DEVICE reports its latest reading (upsert)
``GET  /plan-library/scan-roots``  every device's latest reading, age-judged

The same judged readings also ride on every ``GET /plan-library`` page and on
``/candidates`` as ``corpus_health.scan_roots``. All three render through
:func:`app.services.plan_scan_root_health.scan_roots_health`, which owns the
verdict rules below; this module owns the credential and the organization.

Invariants
----------
1. **The device is the token's, never the body's.** The write authenticates
   with :func:`~app.api.deps.get_reporting_device`, which takes ``device_id``
   from the verified coord device token's claim and 403s an operator session —
   an operator has no device identity to report under. The request schema
   forbids unknown keys, so a body ``device_id`` is a 422, not a silent
   override.
2. **The organization is the plan library's.** Both routes scope through
   ``plan_library._resolve_org_id`` — the same resolver the artifact upsert
   uses, imported rather than copied so the two cannot drift — so a device's
   readings land in the organization its artifacts land in.
3. **Silence is UNKNOWN, never "current".** An organization with no rows reads
   top-level ``state: "unknown"``; a row this server has not heard from within
   :data:`~app.services.plan_scan_root_health.FRESH_WITHIN_SECS` reads
   ``state: "unknown"`` with an ``observation_stale:`` detail (what the device
   sent stays in ``reported_state`` / ``reported_detail``). A device that
   stopped reporting has established nothing about now, and a reader that
   defaulted its last number would be trusting a feeder that may since have
   drifted arbitrarily far.
3a. **"0 behind" against a stale ref is UNKNOWN, never "in step".** A fresh
   ``measured`` reading whose counts are floors (ref stale or of unknown age)
   and whose ``behind`` is 0 reads ``state: "unknown"`` with a ``ref_stale:``
   detail, whatever ``ahead`` is: zero commits behind a ref that may itself be
   days old is a lower bound of nothing. A floor with a non-zero ``behind``
   stays ``measured`` — "at least 254 behind" is a true and useful claim, and
   ``counts_are_floors`` says it is a lower bound.
3b. **Liveness is judged on THIS server's clock.** Freshness reads
   ``received_at`` only, and every report — even one declined as out of order
   — stamps it. ``observed_at`` (the runner's clock) only orders readings, is
   refused more than 300 s in the future, and is shown beside
   ``observed_skew_secs`` so a skewed runner clock is visible rather than
   silently aging a live device out or pinning its row.
3c. **A contradicted reading is UNKNOWN, never current.** When the device's
   latest report was observed before the stored reading (its clock stepped
   back, or a stale retry arrived last), the stored reading is kept but the
   row reads ``state: "unknown"`` with a ``reading_superseded:`` detail until a
   newer report applies. Precedence: ``observation_stale`` >
   ``reading_superseded`` > ``ref_stale``.
4. **Report-only.** Nothing here gates a corpus read or a write; it is a
   diagnostic beside the corpus, not a condition on it.

Route order
-----------
``plan_library.py`` declares ``GET /{artifact_id}`` under the same
``/plan-library`` prefix, and FastAPI does not fall through on a failed
path-parameter conversion: if that router were registered first,
``GET /plan-library/scan-roots`` would be matched by ``/{artifact_id}`` and
answered 422. ``app/api/v1/api.py`` therefore includes THIS router before
``plan_library.router``; ``tests/test_plan_library_scan_roots.py`` pins it
through the real ``api_router``.
"""

from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    DeviceTokenContext,
    get_async_db,
    get_audit_actor_user,
    get_reporting_device,
)
from app.api.strict_query import StrictQueryRoute
from app.api.v1.endpoints.plan_library import _resolve_org_id
from app.crud import plan_scan_root as crud
from app.models.user import User
from app.schemas.plan_library_scan_roots import (
    ScanRootListResponse,
    ScanRootReport,
    ScanRootReportResponse,
)
from app.services.plan_scan_root_health import render_row, scan_roots_health

logger = structlog.get_logger(__name__)

#: A query key these routes do not declare is a 422, as on the plan library's
#: own router — neither route takes any, so any key is refused.
router = APIRouter(route_class=StrictQueryRoute)


@router.post(
    "/scan-roots",
    response_model=ScanRootReportResponse,
    summary="A device reports its latest plan-scan-source reading (upsert)",
    responses={
        status.HTTP_201_CREATED: {
            "model": ScanRootReportResponse,
            "description": "The device's first reading for this organization.",
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "The caller is an operator session, not a device.",
        },
    },
)
async def report_scan_root(
    payload: ScanRootReport,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    device: DeviceTokenContext = Depends(get_reporting_device),
) -> ScanRootReportResponse:
    """Store the reporting device's latest reading, replacing an older one.

    One row per ``(organization, device)``. ``device_id`` is the verified
    token's claim; the organization is the device's paired operator's personal
    organization — the same scope its artifact upserts land in. ``201`` on the
    device's first report, ``200`` on every later one.

    A report observed EARLIER than the stored reading (a late or retried
    delivery, or a runner clock that stepped back) does not replace it:
    ``200`` with ``applied: false`` and the stored row — but it still refreshes
    ``received_at``, because the device demonstrably reported, and marks the
    row ``reading_superseded`` until a newer report applies. A report whose
    ``observed_at`` is more than 300 s ahead of this server's clock is a 422.
    """
    org_id = await _resolve_org_id(db, device.user)
    row, created, applied = await crud.upsert_observation(
        db,
        org_id=org_id,
        device_id=device.device_id,
        fields=payload.model_dump(),
    )
    if created:
        response.status_code = status.HTTP_201_CREATED
    logger.info(
        "plan_library.scan_root_reported",
        device_id=str(row.device_id),
        created=created,
        applied=applied,
        state=row.state,
        behind=row.behind,
        ahead=row.ahead,
        ref_age_secs=row.ref_age_secs,
        counts_are_floors=row.counts_are_floors,
    )
    return ScanRootReportResponse(
        created=created,
        applied=applied,
        row=render_row(row, now=datetime.now(UTC)),
    )


@router.get(
    "/scan-roots",
    response_model=ScanRootListResponse,
    summary="Every device's latest plan-scan-source reading, judged for age",
)
async def list_scan_roots(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> ScanRootListResponse:
    """The caller's organization's readings, one per reporting device.

    Same credentials as the plan-library list (an operator session or a device
    token). Each row carries its age and a ``state`` VERDICT that is
    ``unknown`` when the device has not reported within ``fresh_within_secs``
    (by ``received_at``; ``observation_stale:``), when its latest report was
    observed before the stored reading (``reading_superseded:``), or when its
    reading is 0 behind a stale ref (``ref_stale:``) — in that order of
    precedence: ``observation_stale`` > ``reading_superseded`` >
    ``ref_stale``. The device's own values stay in ``reported_state`` /
    ``reported_detail``. An organization with no rows answers
    ``state: "unknown"``, never an empty "all current".

    ``by_source_repo`` folds the rows per scan source: the fewest commits
    behind among the ``measured`` verdicts, whether that minimum is a floor,
    and which devices lag or cannot be measured. It is byte-for-byte the
    ``corpus_health.scan_roots`` block the list and ``/candidates`` carry.
    """
    org_id = await _resolve_org_id(db, current_user)
    observations = await crud.list_observations(db, org_id=org_id)
    return scan_roots_health(observations, now=datetime.now(UTC))
