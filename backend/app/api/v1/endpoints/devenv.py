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

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import devenv_machine_crud
from app.models.devenv import Environment, Machine
from app.models.user import User
from app.repositories.devenv import (
    application_repo,
    config_repo,
    environment_repo,
    machine_repo,
)
from app.schemas.devenv import (
    ApplicationCreate,
    ApplicationResponse,
    ApplicationUpdate,
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
)
from app.services import devenv_drift

router = APIRouter()


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


@router.delete(
    "/applications/{application_id}", status_code=status.HTTP_204_NO_CONTENT
)
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
    if await machine_repo.name_exists(
        db, owner_id=current_user.id, name=payload.name
    ):
        raise _conflict("machine_name_taken", "Machine name already in use.")
    machine = await machine_repo.create(
        db,
        owner_id=current_user.id,
        name=payload.name,
        hostname=payload.hostname,
        description=payload.description,
    )
    devenv_machine_crud.mint_enrollment_code(machine)
    await db.flush()
    await db.refresh(machine)
    await db.commit()
    return MachineCreatedResponse.from_model(machine)


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
        await _resolve_application_or_404(
            db, current_user.id, fields["application_id"]
        )
    env = await environment_repo.update(db, env=env, fields=fields)
    await db.commit()
    return EnvironmentResponse.model_validate(env)


@router.delete(
    "/environments/{environment_id}", status_code=status.HTTP_204_NO_CONTENT
)
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
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> EnvironmentResponse:
    """Designate a machine as the canonical source of truth for an env.

    Validates the machine is owned by the caller AND has reported a config
    row for this environment (a machine with no config can't be a useful
    source of truth). Atomic single-column update.
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
    env = await environment_repo.set_canonical(
        db, env=env, machine_id=payload.machine_id
    )
    await db.commit()
    return EnvironmentResponse.model_validate(env)


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
        canonical_machine_name=(
            canonical_machine.name if canonical_machine else None
        ),
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
