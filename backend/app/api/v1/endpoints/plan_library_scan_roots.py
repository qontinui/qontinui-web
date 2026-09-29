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
3d. **A refused report is recorded, not lost** (Phase 1 of
   ``2026-09-11-scan-root-readings-hide-refused-contact-and-never-prune``).
   The write route validates the body IN THE HANDLER, so a 422 still knows
   which device sent it: it upserts ``agent.plan_scan_root_refusals`` in the
   device's organization, COMMITS, and only then raises the 422 — whose body
   is byte-identical to FastAPI's own (every ``loc`` prefixed ``body``), so the
   runner's WARN key (``details[0].field == "body.observed_at"``) does not
   move. A device refused within the freshness window reads ``refused:``
   rather than silent, and outranks ``observation_stale``.
3e. **A device silent for 30 days is retired, not deleted** (Phase 2). The
   read leaves it out and counts it (``retired_count``);
   ``?include_retired=true`` on ``GET /scan-roots`` serves it marked
   ``retired: true``.
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

import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, Body, Depends, Query, Request, Response, status
from fastapi.dependencies.utils import get_body_field, get_dependant, get_flat_dependant
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
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
from app.crud import work_artifact as artifact_crud
from app.models.user import User
from app.schemas.plan_library_scan_roots import (
    ScanRootListResponse,
    ScanRootReport,
    ScanRootReportResponse,
)
from app.services.plan_scan_root_health import (
    coverage_source_repos,
    render_row,
    scan_roots_health,
)

logger = structlog.get_logger(__name__)

#: A query key these routes do not declare is a 422, as on the plan library's
#: own router — neither route takes any, so any key is refused.
router = APIRouter(route_class=StrictQueryRoute)


def _documents_scan_root_report(payload: ScanRootReport = Body(...)) -> None:
    """Signature-only: what the POST DOCUMENTS as its body. Never called."""


class _BodyValidatedInHandlerRoute(StrictQueryRoute):
    """The POST's route: the body is validated in the HANDLER, documented as usual.

    FastAPI validates a declared body before the handler runs, so a refused
    report never reached any code of ours and nothing could record it. The
    handler therefore declares NO body parameter and reads the raw request
    itself; at runtime this class is exactly :class:`StrictQueryRoute`.

    What it adds is documentation only: after the route is built (and its
    runtime handler with it), ``body_field`` is set from a signature that
    declares ``ScanRootReport`` as the body. ``body_field`` is read by the
    OpenAPI generator and by nothing else once the handler exists, so the
    published schema keeps ``requestBody -> ScanRootReport`` (and the
    components it references, and the 422 response) exactly as before, while
    the request is not validated twice.
    """

    def __init__(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        super().__init__(path, endpoint, **kwargs)
        documented = get_flat_dependant(
            get_dependant(path=self.path_format, call=_documents_scan_root_report)
        )
        self.body_field = get_body_field(
            flat_dependant=documented, name=self.unique_id, embed_body_fields=False
        )


def _body_errors(raw: bytes) -> tuple[ScanRootReport | None, list[dict[str, Any]]]:
    """Parse and validate the raw body, exactly as FastAPI would have.

    Returns the report, or the errors FastAPI's own body validation raises for
    the same input: ``missing`` at ``("body",)`` for an empty body or a JSON
    ``null`` (FastAPI treats a required body that decodes to ``None`` as
    absent),
    ``json_invalid`` at ``("body", <pos>)`` for a body that is not JSON, and
    the model's errors with every ``loc`` prefixed ``"body"``. That prefix is
    load-bearing: the web's 422 envelope spells ``details[].field`` as
    ``".".join(loc)``, and the runner keys its WARN on
    ``details[0].field == "body.observed_at"``.
    """
    missing: list[dict[str, Any]] = [
        {
            "type": "missing",
            "loc": ("body",),
            "msg": "Field required",
            "input": None,
        }
    ]
    if not raw:
        return None, missing
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        pos = exc.pos if isinstance(exc, json.JSONDecodeError) else exc.start
        return None, [
            {
                "type": "json_invalid",
                "loc": ("body", pos),
                "msg": "JSON decode error",
                "input": {},
                "ctx": {"error": str(exc)},
            }
        ]
    if body is None:
        return None, missing
    try:
        return ScanRootReport.model_validate(body), []
    except ValidationError as exc:
        return None, [
            {**error, "loc": ("body", *error["loc"])}
            for error in exc.errors(include_url=False)
        ]


async def report_scan_root(
    request: Request,
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

    A REFUSED report (any 422 on the body) is recorded before it is answered:
    the device's refusal row in ``agent.plan_scan_root_refusals`` is upserted
    and committed — its stored reading, if any, is not touched — and the 422
    body is the same as FastAPI's own validation would produce. An operator
    session is still a 403 first, from the dependency.
    """
    org_id = await _resolve_org_id(db, device.user)
    payload, errors = _body_errors(await request.body())
    if payload is None:
        reason = crud.refusal_reason(errors)
        try:
            await crud.record_refusal(
                db, org_id=org_id, device_id=device.device_id, reason=reason
            )
        except SQLAlchemyError:
            # Recording is a diagnostic; the device is owed its 422 either way.
            await db.rollback()
            logger.warning(
                "plan_library.scan_root_refusal_record_failed",
                device_id=str(device.device_id),
                exc_info=True,
            )
        logger.info(
            "plan_library.scan_root_refused",
            device_id=str(device.device_id),
            reason=reason,
        )
        raise RequestValidationError(errors)
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
    refusal = await crud.get_refusal(db, org_id=org_id, device_id=device.device_id)
    return ScanRootReportResponse(
        created=created,
        applied=applied,
        row=render_row(row, now=datetime.now(UTC), refusal=refusal),
    )


router.add_api_route(
    "/scan-roots",
    report_scan_root,
    methods=["POST"],
    route_class_override=_BodyValidatedInHandlerRoute,
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


@router.get(
    "/scan-roots",
    response_model=ScanRootListResponse,
    summary="Every device's latest plan-scan-source reading, judged for age",
)
async def list_scan_roots(
    coverage: bool = Query(
        True,
        description=(
            "Compute the coverage set difference (default). false skips the "
            "stem census load and the corpus anti-join for a caller that only "
            "needs the per-device readings and roll-up."
        ),
    ),
    include_retired: bool = Query(
        False,
        description=(
            "Also serve RETIRED devices' rows (silent — no reading and no "
            "refused report — for more than retire_after_secs), each marked "
            "retired: true. They still feed neither by_source_repo nor "
            "coverage. Default false: they are left out and counted in "
            "retired_count."
        ),
    ),
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
    ``ref_stale``; a device whose latest contact within the window was a
    REFUSED report reads ``refused:`` first of all. The device's own values
    stay in ``reported_state`` / ``reported_detail``. An organization with no
    rows answers ``state: "unknown"``, never an empty "all current".

    A device silent — no reading and no refused report — for more than
    ``retire_after_secs`` (30 days) is RETIRED: left out of ``rows``,
    ``by_source_repo`` and ``coverage``, and counted in ``retired_count``.
    ``include_retired=true`` serves those rows too, marked ``retired: true``.
    Nothing is deleted; a retired device's next report brings it back.

    ``by_source_repo`` folds the rows per scan source over its comparison set —
    readings that are fresh, applied and carry a count, including a
    ``ref_stale`` 0-behind floor: the fewest commits behind, whether that is a
    floor, and which devices the readings order as least behind or lagging,
    cannot order (``lag_unknown``), or have no comparable reading
    (``unmeasured``). A roll-up whose fewest commits behind is a floor of 0
    reads ``unknown`` with a null minimum — "at least 0" is no distance — and a
    detail naming the cause: ``ref_stale:`` when every comparable reading
    counted against one ref that is stale or of unknown age,
    ``refs_not_shared:`` when they counted against different or unidentified
    refs. Its lists keep whatever order the readings establish. The same builder renders the ``corpus_health.scan_roots``
    block the list and ``/candidates`` carry, so both apply the same rules to
    the same rows; two reads can still differ by when they happen (ages, and a
    verdict that flips at the freshness boundary), and the block degrades a
    failed read to ``read_failed`` where this route, whose whole answer the
    readings are, lets it surface as an error.

    ``coverage`` is computed HERE AND NOWHERE ELSE (design decision D2 of
    ``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``): it is a
    set difference between the stems a device enumerated at its default ref and
    the corpus rows under that ``source_repo``, and ``corpus_health.scan_roots``
    — the same response object — rides every ``GET /plan-library`` page
    including the runner's loopback search, which must not pay for an anti-join
    over every authored stem. There it is empty with ``coverage_detail`` saying
    which of the three reasons produced the empty list.

    **No ratio is served.** The entry carries two denominators (what exists at
    the ref, and what the scanned working tree could possibly have shown the
    body sync), the corpus rows under OTHER keys as
    ``out_of_scope_artifact_count``, and the attribution field
    ``authored_not_captured_but_invisible`` — a lagging checkout's plans are
    not a capture defect. A percentage over one of those denominators read
    101.8% in production for a real corpus; nothing served here can express
    that number. A key with no usable census reads ``unknown`` with a detail,
    never a zero and never an omitted key.

    ``coverage`` (the query parameter, default ``true``) lets a caller that
    only wants the per-device readings and roll-up — ``ScanSourcesPanel`` on
    the console, which renders no coverage field at all — say so and skip the
    stem census load and the corpus anti-join. Passing ``false`` reads
    ``coverage: []`` with ``coverage_detail`` starting ``not_requested:``,
    never an unexplained empty list. Follow-up to Phase 4 of the same plan,
    which shipped the two panels as two separate reads of this one route
    without a way for either to opt out of the other's cost.
    """
    org_id = await _resolve_org_id(db, current_user)
    now = datetime.now(UTC)
    refusals = await crud.list_refusals(db, org_id=org_id)
    if coverage:
        # The censuses are DEFERRED on ``list_observations`` — this is the one
        # branch that needs the stems, so it takes the loading read; see D2
        # above.
        observations = await crud.list_observations_with_censuses(db, org_id=org_id)
        captured = await artifact_crud.captured_plan_corpus(
            db,
            org_id=org_id,
            # Retired devices filtered by the renderer's own rule, so a
            # retired device's census never decides which keys are read.
            source_repos=coverage_source_repos(
                observations, refusals=refusals, now=now
            ),
        )
    else:
        observations = await crud.list_observations(db, org_id=org_id)
        captured = None
    return scan_roots_health(
        observations,
        now=now,
        refusals=refusals,
        captured=captured,
        coverage_requested=coverage,
        include_retired=include_retired,
    )
