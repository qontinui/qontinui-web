"""Fleet-fresh P5: app config + test-host designation routes.

Backs the fleet UI's three write/read surfaces (see plan
``2026-06-20-fleet-fresh-test-target-routing.md``):

* **App config** — edit an app's ``update_strategy`` + build/start commands
  (``project.apps`` via :class:`app.models.app_registry.App`).
* **Freshness** — per-(device, app) deployment freshness for badges
  (``project.app_deploy_state``, written by the runner's auto-fresh engine).
* **Designation** — mark a device as a test host for an app + toggle
  ``auto_fresh`` (``coord.test_targets`` via
  :class:`app.models.test_target.TestTarget`).

Reads are scoped to the caller's owned devices (``Device.user_id ==
current_user.id``). The designation WRITES (PUT / DELETE) have exactly one
writer: coord's binding-checked ``POST /coord/trees/test-targets/upsert`` and
``DELETE /coord/trees/test-targets/:device_id/:app_id``, reached through the
``operations`` proxy helpers with the caller's bearer and
``X-Qontinui-Active-Tenant`` forwarded (``get_tenant_id`` captures both). coord
stamps the row with the caller's EFFECTIVE tenant and refuses a device that
tenant has no ``coord.tenant_devices`` binding for — the same set of tenants
the runner's ``by-device`` poll serves, so a designation web accepts is one the
device's runner can see. This module never writes ``coord.test_targets``
itself: a second writer with a weaker invariant is how a designation used to be
stamped into a project the device is not bound to and silently vanish from its
runner. Plan
``2026-09-30-test-host-designation-put-stamps-a-tenant-the-device-is-not-bound-to``. The GET still reads the table through the ``TestTarget`` ORM
model.

coord checks the tenant BINDING only — not caller ownership and not that the
app is registered — so both checks stay here, ahead of any coord call.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.operations import (
    _proxy_coord_delete,
    _proxy_coord_post,
    get_tenant_id,
)
from app.models.app_deploy_state import AppDeployState
from app.models.app_registry import App
from app.models.device import Device
from app.models.test_target import TestTarget
from app.models.user import User
from app.schemas.fleet_targets import (
    AppConfig,
    AppConfigUpdate,
    FreshnessRow,
    TestTargetDesignation,
    TestTargetRow,
)
from app.services.coord_identity import get_coord_identity

router = APIRouter()
logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# App config (project.apps)
# ---------------------------------------------------------------------------


@router.get("/apps", response_model=list[AppConfig])
async def list_apps(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[AppConfig]:
    """List registered apps + their fleet-fresh config.

    ``project.apps`` is not user-partitioned (it is the runner-local app
    registry mirrored on shared Postgres), so this returns every registered
    app — the fleet UI is an operator surface.
    """
    result = await db.execute(select(App).order_by(App.display_name))
    return [AppConfig.model_validate(row) for row in result.scalars().all()]


def _normalize_command(raw: str) -> str | None:
    """Blank (empty or whitespace-only) clears the column; otherwise store trimmed.

    The trim is load-bearing, not tidiness. The previous ``raw or None`` used
    Python truthiness, so ``""`` cleared but ``"   "`` was **stored verbatim** —
    and the runner's auto-fresh engine runs a stored command with
    ``sh -c``/``cmd /C`` and checks only the exit status. A whitespace command
    exits 0 on every platform, so the engine recorded a successful build having
    built nothing, and marked the app ``fresh`` at the newly-pulled SHA. The
    ``fresh_only`` dispatcher then routes tests to that host while it still
    serves the previous artifact.

    ``project.apps`` has TWO independent writers: this backend, and the runner's
    own ``PATCH /apps/:app_id``. The runner side normalizes too now
    (``pg/apps.rs::normalize_command``), so both writers agree on the same
    blank-means-clear contract. The runner's engine-side blank check
    (``fleet.rs::execute_build_and_restart``) remains as belt-and-braces for
    rows written before that normalization landed.
    """
    return raw.strip() or None


@router.patch("/apps/{app_id}", response_model=AppConfig)
async def update_app_config(
    app_id: str,
    body: AppConfigUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> AppConfig:
    """Edit an app's update strategy + build/start commands.

    Fields left ``None`` are unchanged. ``build_command`` / ``start_command``
    are cleared by sending a blank value (empty or whitespace-only).
    """
    app = await db.get(App, app_id)
    if app is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "app_not_found", "message": f"App '{app_id}' not found."},
        )

    if body.update_strategy is not None:
        app.update_strategy = body.update_strategy.value
    if body.build_command is not None:
        app.build_command = _normalize_command(body.build_command)
    if body.start_command is not None:
        app.start_command = _normalize_command(body.start_command)

    await db.commit()
    await db.refresh(app)
    return AppConfig.model_validate(app)


# ---------------------------------------------------------------------------
# Freshness (project.app_deploy_state)
# ---------------------------------------------------------------------------


@router.get("/freshness", response_model=list[FreshnessRow])
async def list_freshness(
    app_id: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[FreshnessRow]:
    """Per-(device, app) deployment freshness across the caller's devices.

    Sourced from ``project.app_deploy_state`` (the P4-landed freshness store
    the runner's auto-fresh engine writes). Optionally filtered to one app.
    """
    query = (
        select(AppDeployState, Device)
        .join(Device, Device.device_id == AppDeployState.device_id)
        .where(Device.user_id == current_user.id)
    )
    if app_id is not None:
        query = query.where(AppDeployState.app_id == app_id)

    result = await db.execute(query)
    rows: list[FreshnessRow] = []
    for state, device in result.all():
        rows.append(
            FreshnessRow(
                device_id=device.device_id,
                app_id=state.app_id,
                device_name=device.name,
                hostname=device.hostname,
                freshness=state.freshness,
                deployed_sha=state.deployed_sha,
                deployed_at=state.deployed_at,
                last_error=state.last_error,
                updated_at=state.updated_at,
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Designation (coord.test_targets)
# ---------------------------------------------------------------------------


@router.get("/test-targets", response_model=list[TestTargetRow])
async def list_test_targets(
    app_id: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[TestTargetRow]:
    """List test-host designations for the caller's devices.

    Joins ``coord.test_targets`` → ``coord.devices`` (owned by the caller)
    and left-joins ``project.app_deploy_state`` so each row carries the
    device's current freshness for the app. Optionally filtered to one app.
    """
    query = (
        select(TestTarget, Device, AppDeployState)
        .join(Device, Device.device_id == TestTarget.device_id)
        .outerjoin(
            AppDeployState,
            (AppDeployState.device_id == TestTarget.device_id)
            & (AppDeployState.app_id == TestTarget.app_id),
        )
        .where(Device.user_id == current_user.id)
    )
    if app_id is not None:
        query = query.where(TestTarget.app_id == app_id)

    result = await db.execute(query)
    rows: list[TestTargetRow] = []
    for target, device, state in result.all():
        rows.append(
            TestTargetRow(
                device_id=target.device_id,
                app_id=target.app_id,
                auto_fresh=target.auto_fresh,
                device_name=device.name,
                hostname=device.hostname,
                derived_status=device.derived_status,
                freshness=state.freshness if state is not None else None,
                deployed_sha=state.deployed_sha if state is not None else None,
                deployed_at=state.deployed_at if state is not None else None,
                created_at=target.created_at,
                updated_at=target.updated_at,
            )
        )
    return rows


async def _owned_device(db: AsyncSession, device_id: UUID, user_id: UUID) -> Device:
    """Fetch a device and enforce caller ownership (404 otherwise)."""
    device = await db.get(Device, device_id)
    if device is None or device.user_id != user_id:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "device_not_found",
                "message": f"Device {device_id} not found or not owned by caller.",
            },
        )
    return device


_COORD_UPSERT_PATH = "/coord/trees/test-targets/upsert"

# coord's ``post_upsert`` answers ``404 {"error": "device not found"}`` when the
# caller's effective tenant has no ``coord.tenant_devices`` binding for the
# device — deliberately indistinguishable from "no such device". Web can tell
# the two apart only because ``_owned_device`` has ALREADY proved the device
# exists and belongs to the caller, so after that check this body means one
# thing: the device is not bound to the project the request targets.
_COORD_UNBOUND_ERROR = "device not found"


def _coord_delete_path(device_id: UUID, app_id: str) -> str:
    return f"/coord/trees/test-targets/{device_id}/{quote(app_id, safe='')}"


async def _project_label(request: Request, tenant_id: UUID) -> str:
    """How to name coord tenant ``tenant_id`` to the operator.

    The display name (else slug) from the caller's coord memberships, which
    ``get_tenant_id`` has already fetched and memoized on the request — so
    this costs no extra round-trip on the paths that reach it. Falls back to
    the bare tenant id when the caller is not a member of that tenant or the
    identity cannot be read: a refusal message must never fail to render.
    """
    try:
        identity = await get_coord_identity(request)
    except HTTPException:
        return str(tenant_id)
    for tenant in identity.tenants:
        if tenant.tenant_id == tenant_id:
            return f'"{tenant.display_name or tenant.slug}"'
    return str(tenant_id)


def _reraise_coord_refusal(exc: HTTPException) -> HTTPException:
    """Give a coord JSON refusal the ``message`` the error envelope renders.

    coord's refusals are ``{"error": "<prose>"}`` with no ``message``, and
    ``http_exception_handler`` would otherwise render ``message`` as the Python
    repr of the whole dict. Anything else passes through unchanged.
    """
    detail: Any = exc.detail
    if isinstance(detail, dict) and "message" not in detail:
        error = detail.get("error")
        if isinstance(error, str):
            return HTTPException(
                status_code=exc.status_code,
                detail={
                    "error": "coord_refused",
                    "message": f"coord refused the designation: {error}",
                    "coord_error": error,
                },
            )
    return exc


@router.put("/test-targets/{device_id}/{app_id}", response_model=TestTargetRow)
async def designate_test_target(
    device_id: UUID,
    app_id: str,
    body: TestTargetDesignation,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    tenant_id: UUID = Depends(get_tenant_id),
) -> TestTargetRow:
    """Designate ``device_id`` as a test host for ``app_id`` (upsert).

    The write is coord's: ``POST /coord/trees/test-targets/upsert`` with the
    caller's bearer and ``X-Qontinui-Active-Tenant`` forwarded, so the row is
    stamped with the caller's EFFECTIVE tenant and refused unless the device is
    bound to it. Idempotent — re-designating updates ``auto_fresh``.

    Web checks what coord does not, BEFORE calling it: the device must be owned
    by the caller (404) and the app must be registered (404). A device the
    effective tenant has no binding for is a 409
    ``device_not_bound_to_project`` naming that project. The response is the
    row as it now reads, joined with device + freshness.
    """
    device = await _owned_device(db, device_id, current_user.id)

    app = await db.get(App, app_id)
    if app is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "app_not_found", "message": f"App '{app_id}' not found."},
        )

    try:
        await _proxy_coord_post(
            _COORD_UPSERT_PATH,
            {
                "device_id": str(device_id),
                "app_id": app_id,
                "auto_fresh": body.auto_fresh,
            },
            tenant_id=tenant_id,
            structured_errors=True,
        )
    except HTTPException as exc:
        detail: Any = exc.detail
        if (
            exc.status_code == 404
            and isinstance(detail, dict)
            and detail.get("error") == _COORD_UNBOUND_ERROR
        ):
            # ``tenant_id`` is the tenant coord actually used: a header naming
            # a tenant the caller is not a member of degrades to home coord-
            # side, and ``get_tenant_id`` returns coord's post-override answer.
            project = await _project_label(request, tenant_id)
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "device_not_bound_to_project",
                    "message": (
                        f"Device {device.name!r} is not bound to project "
                        f"{project}, the project this designation targets, so "
                        f"its runner would never see it. Bind the device to "
                        f"{project}, or switch to a project the device is "
                        f"bound to, then designate it again."
                    ),
                    "device_id": str(device_id),
                    "tenant_id": str(tenant_id),
                },
            ) from exc
        raise _reraise_coord_refusal(exc) from exc

    # coord answers only ``{device_id, app_id, auto_fresh}``; the response
    # model carries timestamps and freshness, so read the row coord just wrote.
    # ``populate_existing`` so nothing cached in this session can stand in for
    # what coord committed.
    target = await db.get(TestTarget, (device_id, app_id), populate_existing=True)
    if target is None:
        raise HTTPException(
            status_code=502,
            detail={
                "error": "designation_not_visible",
                "message": (
                    "coord accepted the designation but no row is visible for "
                    f"device {device_id} / app '{app_id}'; it may have been "
                    "removed concurrently. Refresh and retry."
                ),
            },
        )
    if target.tenant_id != tenant_id:
        # coord's ON CONFLICT updates auto_fresh but keeps the row's existing
        # tenant stamp, so a row written into another tenant earlier stays
        # there. Logged, not refused: the auto_fresh change did apply.
        logger.warning(
            "test_target_stamped_in_other_tenant",
            device_id=str(device_id),
            app_id=app_id,
            row_tenant_id=str(target.tenant_id),
            effective_tenant_id=str(tenant_id),
        )

    state = await db.get(AppDeployState, (device_id, app_id))
    return TestTargetRow(
        device_id=target.device_id,
        app_id=target.app_id,
        auto_fresh=target.auto_fresh,
        device_name=device.name,
        hostname=device.hostname,
        derived_status=device.derived_status,
        freshness=state.freshness if state is not None else None,
        deployed_sha=state.deployed_sha if state is not None else None,
        deployed_at=state.deployed_at if state is not None else None,
        created_at=target.created_at,
        updated_at=target.updated_at,
    )


@router.delete("/test-targets/{device_id}/{app_id}", status_code=204)
async def undesignate_test_target(
    device_id: UUID,
    app_id: str,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Response:
    """Remove a test-host designation through coord.

    coord's DELETE is scoped to the caller's EFFECTIVE tenant and answers
    ``200 {"deleted": false}`` for a row stamped with any other tenant — which
    is NOT a removal. So ``deleted: false`` is never taken as success on its
    own: the row is read back. Absent means the designation the operator asked
    to remove is gone (204, idempotent as before). Still present means it
    lives in another project — 409 ``designation_in_other_project`` naming
    it, since reporting success there would leave the device's runner serving
    a designation the operator believes is removed.
    """
    device = await _owned_device(db, device_id, current_user.id)

    result = await _proxy_coord_delete(
        _coord_delete_path(device_id, app_id), tenant_id=tenant_id
    )
    if isinstance(result, dict) and result.get("deleted") is True:
        return Response(status_code=204)

    remaining = await db.get(TestTarget, (device_id, app_id), populate_existing=True)
    if remaining is None:
        return Response(status_code=204)

    selected = await _project_label(request, tenant_id)
    if remaining.tenant_id == tenant_id:
        # coord removed nothing although the row is in the selected tenant — a
        # concurrent re-designation, or a coord answer this code cannot read.
        message = (
            f"coord removed nothing: the designation of device {device.name!r} "
            f"for app '{app_id}' is still recorded under project {selected}. "
            "Refresh and retry."
        )
    else:
        owner = await _project_label(request, remaining.tenant_id)
        message = (
            f"The designation of device {device.name!r} for app '{app_id}' is "
            f"recorded under project {owner}, not the selected project "
            f"{selected}, so it was not removed. Switch to project {owner} "
            "and remove it there."
        )
    raise HTTPException(
        status_code=409,
        detail={
            "error": "designation_in_other_project",
            "message": message,
            "device_id": str(device_id),
            "tenant_id": str(tenant_id),
            "row_tenant_id": str(remaining.tenant_id),
        },
    )
