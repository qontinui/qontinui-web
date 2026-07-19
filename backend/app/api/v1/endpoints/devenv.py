"""User-JWT management API for the ``devenv`` digital-twin feature.

Every route is authenticated with the user JWT
(:func:`get_current_active_user_async`) and every query is filtered by
``owner_user_id == current_user.id``. Cross-owner ids resolve to a **404
not-found** (NOT a 403) so the existence of another user's resources is
never leaked.

Mounted under ``/api/v1/devenv``. Endpoints:

* CRUD ``/applications``
* CRUD ``/machines`` (+ ``POST /machines/{id}/regenerate-enrollment``,
  ``POST /machines/{id}/revoke``)
* CRUD ``/environments``
* ``PUT /environments/{id}/canonical`` — atomically set the canonical
  machine (validated owned + has a config row for the env)
* ``GET /environments/{id}/drift`` and
  ``GET /environments/{id}/drift/{machine_id}`` — drift vs canonical
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import devenv_machine_crud
from app.models.devenv import Environment, Machine
from app.models.user import User
from app.repositories.devenv import (
    application_repo,
    canonical_log_repo,
    config_history_repo,
    config_repo,
    environment_repo,
    machine_repo,
)
from app.schemas.devenv import (
    ApplicationCreate,
    ApplicationResponse,
    ApplicationUpdate,
    CanonicalChangeResponse,
    ConfigHistoryDiffResponse,
    ConfigHistoryEntry,
    DispatchEnrollRequest,
    DispatchEnrollResponse,
    EnvironmentCreate,
    EnvironmentDriftResponse,
    EnvironmentResponse,
    EnvironmentUpdate,
    MachineCreate,
    MachineCreatedResponse,
    MachineDriftReport,
    MachineResponse,
    MachineUpdate,
    SetCanonicalRequest,
    SetMachineEnvironmentRequest,
)
from app.services import devenv_drift
from app.services.coord_proxy import post_to_coord

router = APIRouter()

# The tenant-switcher header the frontend sends; captured best-effort onto the
# canonical audit trail (tenants are a coord concept, resolving them
# authoritatively would add a coord round-trip + failure mode to the write).
_ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"


def _best_effort_tenant_id(request: Request) -> UUID | None:
    """Parse the active-tenant header as a UUID, or ``None`` (never raises)."""
    raw = request.headers.get(_ACTIVE_TENANT_HEADER)
    if not raw:
        return None
    try:
        return UUID(raw.strip())
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Shared error helpers
# ---------------------------------------------------------------------------


def _not_found(resource: str) -> HTTPException:
    """Build a 404 — used for both missing and cross-owner ids."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": f"{resource}_not_found", "message": f"{resource} not found."},
    )


def _conflict(code: str, message: str) -> HTTPException:
    """Build a 409 conflict."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": code, "message": message},
    )


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------


@router.post(
    "/applications",
    response_model=ApplicationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_application(
    payload: ApplicationCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> ApplicationResponse:
    """Create an application (slug unique per owner)."""
    if await application_repo.slug_exists(
        db, owner_id=current_user.id, slug=payload.slug
    ):
        raise _conflict("application_slug_taken", "Slug already in use.")
    app = await application_repo.create(
        db,
        owner_id=current_user.id,
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
    )
    await db.commit()
    return ApplicationResponse.model_validate(app)


@router.get("/applications", response_model=list[ApplicationResponse])
async def list_applications(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[ApplicationResponse]:
    """List the owner's applications."""
    apps = await application_repo.list(db, owner_id=current_user.id)
    return [ApplicationResponse.model_validate(a) for a in apps]


@router.get("/applications/{application_id}", response_model=ApplicationResponse)
async def get_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> ApplicationResponse:
    """Get one application."""
    app = await application_repo.get(
        db, owner_id=current_user.id, app_id=application_id
    )
    if app is None:
        raise _not_found("application")
    return ApplicationResponse.model_validate(app)


@router.patch("/applications/{application_id}", response_model=ApplicationResponse)
async def update_application(
    application_id: UUID,
    payload: ApplicationUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> ApplicationResponse:
    """Partially update an application."""
    app = await application_repo.get(
        db, owner_id=current_user.id, app_id=application_id
    )
    if app is None:
        raise _not_found("application")
    fields = payload.model_dump(exclude_unset=True)
    if "slug" in fields and await application_repo.slug_exists(
        db, owner_id=current_user.id, slug=fields["slug"], exclude_id=application_id
    ):
        raise _conflict("application_slug_taken", "Slug already in use.")
    app = await application_repo.update(db, app=app, fields=fields)
    await db.commit()
    return ApplicationResponse.model_validate(app)


@router.delete("/applications/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete an application."""
    app = await application_repo.get(
        db, owner_id=current_user.id, app_id=application_id
    )
    if app is None:
        raise _not_found("application")
    await application_repo.delete(db, app=app)
    await db.commit()


# ---------------------------------------------------------------------------
# Machines
# ---------------------------------------------------------------------------


@router.post(
    "/machines",
    response_model=MachineCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_machine(
    payload: MachineCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> MachineCreatedResponse:
    """Register a machine and mint its one-time enrollment code."""
    if await machine_repo.name_exists(db, owner_id=current_user.id, name=payload.name):
        raise _conflict("machine_name_taken", "Machine name already in use.")
    # Validate the optional environment binding is owned by the caller
    # (cross-owner or missing ids resolve to 404, per the module convention).
    if payload.environment_id is not None and not await environment_repo.get(
        db, owner_id=current_user.id, env_id=payload.environment_id
    ):
        raise _not_found("environment")
    machine = await machine_repo.create(
        db,
        owner_id=current_user.id,
        name=payload.name,
        hostname=payload.hostname,
        description=payload.description,
        environment_id=payload.environment_id,
    )
    devenv_machine_crud.mint_enrollment_code(machine)
    await db.flush()
    await db.refresh(machine)
    await db.commit()
    return MachineCreatedResponse.from_model(machine)


@router.post(
    "/machines/dispatch-enroll",
    response_model=DispatchEnrollResponse,
    status_code=status.HTTP_201_CREATED,
)
async def dispatch_enroll(
    payload: DispatchEnrollRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> DispatchEnrollResponse:
    """Create a machine + dispatch an enroll directive to a paired runner.

    Phase 3 (dispatched self-enroll): the operator picks an already-paired
    coord device in the dashboard; the server mints the machine + one-time
    code, binds it to the chosen device, then asks coord to publish an enroll
    directive to that device's runner. The runner enrolls itself — no terminal,
    no copy-paste.

    The machine + code are ALWAYS created and returned, even if the dispatch is
    rejected (device offline / unknown), so the UI can fall back to the
    copy-paste command (Phase 1(b)). Coord's admin-gated route resolves the
    operator from the forwarded Cognito bearer.
    """
    if await machine_repo.name_exists(db, owner_id=current_user.id, name=payload.name):
        raise _conflict("machine_name_taken", "Machine name already in use.")
    if payload.environment_id is not None and not await environment_repo.get(
        db, owner_id=current_user.id, env_id=payload.environment_id
    ):
        raise _not_found("environment")

    machine = await machine_repo.create(
        db,
        owner_id=current_user.id,
        name=payload.name,
        hostname=payload.hostname,
        description=payload.description,
        environment_id=payload.environment_id,
    )
    # Bind the machine to the chosen coord device up front (the dispatch flow
    # knows the device; the copy-paste flow learns it only at enroll-consume).
    machine.coord_device_id = payload.target_device_id
    devenv_machine_crud.mint_enrollment_code(machine)
    await db.flush()
    await db.refresh(machine)
    await db.commit()

    created = MachineCreatedResponse.from_model(machine)

    # Dispatch the enroll directive to the device's runner via coord. Best-effort:
    # a rejection/timeout does NOT undo the machine — the operator falls back to
    # the copy-paste command. `backend` is omitted so the runner resolves its web
    # base from its own paired profile.
    coord_body: dict[str, object] = {
        "target_device_id": str(payload.target_device_id),
        "enrollment_code": created.enrollment_code,
        "machine_id": str(machine.id),
    }
    if machine.environment_id is not None:
        coord_body["environment_id"] = str(machine.environment_id)

    auth = request.headers.get("Authorization")
    headers = {"Authorization": auth} if auth else {}

    try:
        resp = await post_to_coord(
            "/devenv/enroll-dispatch",
            headers=headers,
            json_body=coord_body,
            log_event="devenv_dispatch_enroll",
            machine_id=str(machine.id),
            target_device_id=str(payload.target_device_id),
        )
    except HTTPException as exc:
        # Coord unreachable/timeout — the machine is valid; surface a soft
        # failure so the UI offers the copy-paste fallback.
        detail = exc.detail if isinstance(exc.detail, str) else "coord dispatch failed"
        return DispatchEnrollResponse(
            machine=created, dispatched=False, detail=str(detail)
        )

    if resp.status_code >= 400:
        return DispatchEnrollResponse(
            machine=created,
            dispatched=False,
            detail=f"coord rejected the dispatch (HTTP {resp.status_code})",
        )
    return DispatchEnrollResponse(machine=created, dispatched=True)


@router.get("/machines", response_model=list[MachineResponse])
async def list_machines(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[MachineResponse]:
    """List the owner's machines (never exposes key material)."""
    machines = await machine_repo.list(db, owner_id=current_user.id)
    return [MachineResponse.from_model(m) for m in machines]


@router.get("/machines/{machine_id}", response_model=MachineResponse)
async def get_machine(
    machine_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> MachineResponse:
    """Get one machine."""
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    return MachineResponse.from_model(machine)


@router.patch("/machines/{machine_id}", response_model=MachineResponse)
async def update_machine(
    machine_id: UUID,
    payload: MachineUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> MachineResponse:
    """Partially update a machine's descriptive fields."""
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields and await machine_repo.name_exists(
        db, owner_id=current_user.id, name=fields["name"], exclude_id=machine_id
    ):
        raise _conflict("machine_name_taken", "Machine name already in use.")
    machine = await machine_repo.update(db, machine=machine, fields=fields)
    await db.commit()
    return MachineResponse.from_model(machine)


@router.delete("/machines/{machine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_machine(
    machine_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete a machine."""
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    await machine_repo.delete(db, machine=machine)
    await db.commit()


@router.post(
    "/machines/{machine_id}/regenerate-enrollment",
    response_model=MachineCreatedResponse,
)
async def regenerate_enrollment(
    machine_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> MachineCreatedResponse:
    """Mint a fresh one-time enrollment code for a machine.

    Re-enrolling a machine that already has a key rotates its credential:
    the agent must re-enroll with the new code to obtain a new key.
    """
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    devenv_machine_crud.mint_enrollment_code(machine)
    # A fresh enrollment supersedes any prior key — clear it so the old
    # credential stops authenticating once re-enrollment is requested.
    machine.key_hash = None
    machine.enrolled_at = None
    machine.revoked_at = None
    await db.flush()
    await db.refresh(machine)
    await db.commit()
    return MachineCreatedResponse.from_model(machine)


@router.post("/machines/{machine_id}/revoke", response_model=MachineResponse)
async def revoke_machine(
    machine_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> MachineResponse:
    """Revoke a machine's key — all future agent calls are rejected."""
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    await devenv_machine_crud.revoke_machine(db, machine)
    await db.commit()
    await db.refresh(machine)
    return MachineResponse.from_model(machine)


@router.put("/machines/{machine_id}/environment", response_model=MachineResponse)
async def set_machine_environment(
    machine_id: UUID,
    payload: SetMachineEnvironmentRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> MachineResponse:
    """Bind (or unbind, with ``environment_id: null``) a machine to an
    environment. Phase 2 P1: the explicit binding that enroll honors, so a
    machine can join a chosen environment even when several exist."""
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    if payload.environment_id is not None and not await environment_repo.get(
        db, owner_id=current_user.id, env_id=payload.environment_id
    ):
        raise _not_found("environment")
    machine = await machine_repo.update(
        db, machine=machine, fields={"environment_id": payload.environment_id}
    )
    await db.commit()
    return MachineResponse.from_model(machine)


# ---------------------------------------------------------------------------
# Environments
# ---------------------------------------------------------------------------


async def _resolve_application_or_404(
    db: AsyncSession, owner_id: UUID, application_id: UUID | None
) -> None:
    """Validate an optional application_id belongs to the owner."""
    if application_id is None:
        return
    app = await application_repo.get(db, owner_id=owner_id, app_id=application_id)
    if app is None:
        raise _not_found("application")


@router.post(
    "/environments",
    response_model=EnvironmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_environment(
    payload: EnvironmentCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> EnvironmentResponse:
    """Create an environment, optionally bound to an owned application."""
    if await environment_repo.name_exists(
        db, owner_id=current_user.id, name=payload.name
    ):
        raise _conflict("environment_name_taken", "Environment name already in use.")
    await _resolve_application_or_404(db, current_user.id, payload.application_id)
    env = await environment_repo.create(
        db,
        owner_id=current_user.id,
        name=payload.name,
        description=payload.description,
        application_id=payload.application_id,
    )
    await db.commit()
    return EnvironmentResponse.model_validate(env)


@router.get("/environments", response_model=list[EnvironmentResponse])
async def list_environments(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[EnvironmentResponse]:
    """List the owner's environments."""
    envs = await environment_repo.list(db, owner_id=current_user.id)
    return [EnvironmentResponse.model_validate(e) for e in envs]


@router.get("/environments/{environment_id}", response_model=EnvironmentResponse)
async def get_environment(
    environment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> EnvironmentResponse:
    """Get one environment."""
    env = await environment_repo.get(
        db, owner_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    return EnvironmentResponse.model_validate(env)


@router.patch("/environments/{environment_id}", response_model=EnvironmentResponse)
async def update_environment(
    environment_id: UUID,
    payload: EnvironmentUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> EnvironmentResponse:
    """Partially update an environment."""
    env = await environment_repo.get(
        db, owner_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields and await environment_repo.name_exists(
        db, owner_id=current_user.id, name=fields["name"], exclude_id=environment_id
    ):
        raise _conflict("environment_name_taken", "Environment name already in use.")
    if "application_id" in fields:
        await _resolve_application_or_404(db, current_user.id, fields["application_id"])
    env = await environment_repo.update(db, env=env, fields=fields)
    await db.commit()
    return EnvironmentResponse.model_validate(env)


@router.delete("/environments/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(
    environment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete an environment."""
    env = await environment_repo.get(
        db, owner_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    await environment_repo.delete(db, env=env)
    await db.commit()


@router.put(
    "/environments/{environment_id}/canonical", response_model=EnvironmentResponse
)
async def set_canonical_machine(
    environment_id: UUID,
    payload: SetCanonicalRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> EnvironmentResponse:
    """Designate a machine as the canonical source of truth for an env.

    Validates the machine is owned by the caller AND has reported a config
    row for this environment (a machine with no config can't be a useful
    source of truth). Atomic single-column update, plus an append to the
    ``canonical_change_log`` audit trail (who/when/from->to) — the team-sync
    model requires every canonical change to be attributable. A no-op change
    (re-designating the machine that is already canonical) is not recorded.
    """
    env = await environment_repo.get(
        db, owner_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=payload.machine_id
    )
    if machine is None:
        raise _not_found("machine")
    has_config = await config_repo.exists(
        db, environment_id=environment_id, machine_id=payload.machine_id
    )
    if not has_config:
        raise _conflict(
            "machine_has_no_config",
            "Machine has not reported a config for this environment yet.",
        )
    prior_canonical_id = env.canonical_machine_id
    env = await environment_repo.set_canonical(
        db, env=env, machine_id=payload.machine_id
    )
    # Audit the change (skip a no-op re-designation of the same machine).
    if prior_canonical_id != payload.machine_id:
        await canonical_log_repo.record(
            db,
            environment_id=environment_id,
            from_machine_id=prior_canonical_id,
            to_machine_id=payload.machine_id,
            changed_by_user_id=current_user.id,
            tenant_id=_best_effort_tenant_id(request),
        )
    await db.commit()
    return EnvironmentResponse.model_validate(env)


@router.get(
    "/environments/{environment_id}/canonical-history",
    response_model=list[CanonicalChangeResponse],
)
async def get_canonical_history(
    environment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[CanonicalChangeResponse]:
    """List the environment's canonical-designation changes, newest first.

    Answers "who made this the canonical environment, and when." Owner-scoped
    like every other route here (cross-owner env id -> 404).

    Display names (actor email, from/to machine names) are resolved by the
    repository in the same query; each is ``None`` when the referenced row is
    gone, which is expected — the audit outlives machine/user deletion.
    """
    env = await environment_repo.get(
        db, owner_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    rows = await canonical_log_repo.list_for_environment(
        db, environment_id=environment_id
    )
    return [
        CanonicalChangeResponse.model_validate(r.log).model_copy(
            update={
                "changed_by_email": r.changed_by_email,
                "from_machine_name": r.from_machine_name,
                "to_machine_name": r.to_machine_name,
            }
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Drift
# ---------------------------------------------------------------------------


def _attach_machine_identity(
    report: MachineDriftReport, machine: Machine
) -> MachineDriftReport:
    """Fill machine identity fields on a drift report."""
    report.machine_id = machine.id  # type: ignore[assignment]
    report.machine_name = machine.name
    return report


async def _build_machine_report(
    db: AsyncSession,
    *,
    env: Environment,
    canonical_config: dict,
    target_machine: Machine,
) -> MachineDriftReport:
    """Build a drift report for one target machine vs the canonical config."""
    target_cfg_row = await config_repo.get(
        db, environment_id=env.id, machine_id=target_machine.id
    )
    if target_cfg_row is None:
        report = devenv_drift.missing_config_report()
    else:
        report = devenv_drift.diff_envelopes(canonical_config, target_cfg_row.config)
    return _attach_machine_identity(report, target_machine)


@router.get(
    "/environments/{environment_id}/drift",
    response_model=EnvironmentDriftResponse,
)
async def get_environment_drift(
    environment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> EnvironmentDriftResponse:
    """Drift of every non-canonical machine vs the canonical machine.

    422 when no canonical machine is set (drift is undefined without a
    source of truth).
    """
    env = await environment_repo.get(
        db, owner_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    if env.canonical_machine_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "no_canonical_machine",
                "message": "No canonical machine set for this environment.",
            },
        )
    canonical_machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=env.canonical_machine_id
    )
    canonical_cfg_row = await config_repo.get(
        db, environment_id=env.id, machine_id=env.canonical_machine_id
    )
    canonical_config = canonical_cfg_row.config if canonical_cfg_row else {}

    config_rows = await config_repo.list_for_environment(db, environment_id=env.id)
    reports: list[MachineDriftReport] = []
    for row in config_rows:
        if row.machine_id == env.canonical_machine_id:
            continue
        target_machine = await machine_repo.get(
            db, owner_id=current_user.id, machine_id=row.machine_id
        )
        if target_machine is None:
            continue
        report = devenv_drift.diff_envelopes(canonical_config, row.config)
        reports.append(_attach_machine_identity(report, target_machine))

    return devenv_drift.rollup_environment(
        environment_id=env.id,
        canonical_machine_id=env.canonical_machine_id,
        canonical_machine_name=(canonical_machine.name if canonical_machine else None),
        reports=reports,
    )


@router.get(
    "/environments/{environment_id}/drift/{machine_id}",
    response_model=MachineDriftReport,
)
async def get_machine_drift(
    environment_id: UUID,
    machine_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> MachineDriftReport:
    """Drift of a single target machine vs the canonical machine."""
    env = await environment_repo.get(
        db, owner_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    if env.canonical_machine_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "no_canonical_machine",
                "message": "No canonical machine set for this environment.",
            },
        )
    target_machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if target_machine is None:
        raise _not_found("machine")

    canonical_cfg_row = await config_repo.get(
        db, environment_id=env.id, machine_id=env.canonical_machine_id
    )
    canonical_config = canonical_cfg_row.config if canonical_cfg_row else {}

    return await _build_machine_report(
        db,
        env=env,
        canonical_config=canonical_config,
        target_machine=target_machine,
    )


# ---------------------------------------------------------------------------
# Config history (P2 — drift over time)
# ---------------------------------------------------------------------------


async def _resolve_env_machine_or_404(
    db: AsyncSession, *, owner_id: UUID, environment_id: UUID, machine_id: UUID
) -> tuple[Environment, Machine]:
    """Resolve an owned (environment, machine) pair, 404-ing like siblings."""
    env = await environment_repo.get(db, owner_id=owner_id, env_id=environment_id)
    if env is None:
        raise _not_found("environment")
    machine = await machine_repo.get(db, owner_id=owner_id, machine_id=machine_id)
    if machine is None:
        raise _not_found("machine")
    return env, machine


@router.get(
    "/environments/{environment_id}/machines/{machine_id}/config-history",
    response_model=list[ConfigHistoryEntry],
)
async def get_config_history(
    environment_id: UUID,
    machine_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[ConfigHistoryEntry]:
    """A machine's config-capture timeline for an environment, newest first.

    Metadata only (no config bodies) — a long timeline stays a small payload.
    Owner-scoped like every sibling route (cross-owner env/machine → 404).
    Distinct-captures only: the agent write path dedups consecutive
    identical envelopes, so each entry is an actual change point.
    """
    await _resolve_env_machine_or_404(
        db,
        owner_id=current_user.id,
        environment_id=environment_id,
        machine_id=machine_id,
    )
    rows = await config_history_repo.list_for_machine(
        db,
        environment_id=environment_id,
        machine_id=machine_id,
        limit=limit,
        offset=offset,
    )
    return [ConfigHistoryEntry.model_validate(r) for r in rows]


@router.get(
    "/environments/{environment_id}/machines/{machine_id}/config-history/diff",
    response_model=ConfigHistoryDiffResponse,
)
async def get_config_history_diff(
    environment_id: UUID,
    machine_id: UUID,
    from_id: UUID = Query(),
    to_id: UUID = Query(),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> ConfigHistoryDiffResponse:
    """SELF-drift between two captures of the same machine over time.

    Distinct from the vs-canonical drift endpoints: both envelopes belong to
    the SAME (environment, machine), and the report reads as "what changed
    going from ``from_id`` to ``to_id``" (``from`` fills the expected slot,
    ``to`` the actual). A ``from_id``/``to_id`` that is missing OR belongs to
    a different (environment, machine) pair → 404, mirroring the module's
    never-leak-existence convention.
    """
    _env, machine = await _resolve_env_machine_or_404(
        db,
        owner_id=current_user.id,
        environment_id=environment_id,
        machine_id=machine_id,
    )
    from_row = await config_history_repo.get(
        db, history_id=from_id, environment_id=environment_id, machine_id=machine_id
    )
    if from_row is None:
        raise _not_found("config_history_entry")
    to_row = await config_history_repo.get(
        db, history_id=to_id, environment_id=environment_id, machine_id=machine_id
    )
    if to_row is None:
        raise _not_found("config_history_entry")

    report = devenv_drift.diff_envelopes(from_row.config, to_row.config)
    report = _attach_machine_identity(report, machine)
    return ConfigHistoryDiffResponse(
        **report.model_dump(),
        from_id=from_row.id,
        to_id=to_row.id,
        from_captured_at=from_row.captured_at,
        to_captured_at=to_row.captured_at,
    )
