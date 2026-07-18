"""User-JWT management API for the ``devenv`` digital-twin feature.

Every route is authenticated with the user JWT
(:func:`get_current_active_user_async`).

Access model (P4 org sharing): Applications/Environments are either personal
(``organization_id`` NULL → owner-only) or org-shared (visible to the owner
AND all non-``helper`` members of that org; ``owner``/``admin``/``member``
may edit, ``viewer`` is read-only). Machines stay strictly owner-scoped, but
an org-shared ENVIRONMENT's machine-derived reads (drift, canonical history,
the machines listed inside drift) are authorized through the environment's
accessibility. Ids the caller cannot even VIEW resolve to a **404 not-found**
(NOT a 403) so existence is never leaked; a caller who CAN view but not edit
gets an honest **403 read_only_access**. Sharing/unsharing (changing
``organization_id``) is reserved to the resource OWNER.

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

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import devenv_machine_crud
from app.models.devenv import Environment, Machine
from app.models.user import User
from app.repositories.devenv import (
    application_repo,
    can_edit,
    canonical_log_repo,
    config_repo,
    edit_org_ids,
    environment_repo,
    machine_repo,
)
from app.schemas.devenv import (
    ApplicationCreate,
    ApplicationResponse,
    ApplicationUpdate,
    CanonicalChangeResponse,
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


def _read_only(resource: str) -> HTTPException:
    """Build the 403 for a VIEWER who can see a shared resource but not edit it.

    Unlike the never-leak 404 for non-members, a viewer legitimately sees the
    resource — telling them "read-only" is honest UX rather than a leak.
    """
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "read_only_access",
            "message": f"You have read-only access to this {resource}.",
        },
    )


def _forbidden(code: str, message: str) -> HTTPException:
    """Build a 403 with an explicit code."""
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"code": code, "message": message},
    )


async def _require_org_edit_membership(
    db: AsyncSession, user_id: UUID, organization_id: UUID | None
) -> None:
    """403 unless the user holds an edit-capable role in ``organization_id``.

    Used when SETTING a share target: sharing a resource into an org requires
    the sharer to be an owner/admin/member of that org (a viewer/helper/
    non-member cannot pull resources into an org). ``None`` (personal) always
    passes.
    """
    if organization_id is None:
        return
    if organization_id not in await edit_org_ids(db, user_id):
        raise _forbidden(
            "organization_access_denied",
            "You are not a member with edit rights in that organization.",
        )


async def _get_editable_environment(
    db: AsyncSession, user_id: UUID, env_id: UUID
) -> Environment:
    """Resolve an environment for an EDIT route: 404 non-member, 403 viewer."""
    env = await environment_repo.get_viewable(db, user_id=user_id, env_id=env_id)
    if env is None:
        raise _not_found("environment")
    if not await can_edit(db, user_id, resource=env):
        raise _read_only("environment")
    return env


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
    """Create an application (slug unique per owner).

    ``organization_id`` shares it from birth — the caller must hold an
    edit-capable role in that org.
    """
    if await application_repo.slug_exists(
        db, owner_id=current_user.id, slug=payload.slug
    ):
        raise _conflict("application_slug_taken", "Slug already in use.")
    await _require_org_edit_membership(db, current_user.id, payload.organization_id)
    app = await application_repo.create(
        db,
        owner_id=current_user.id,
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        organization_id=payload.organization_id,
    )
    await db.commit()
    return ApplicationResponse.model_validate(app)


@router.get("/applications", response_model=list[ApplicationResponse])
async def list_applications(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[ApplicationResponse]:
    """List the applications the caller can view (owned + org-shared)."""
    apps = await application_repo.list_accessible(db, user_id=current_user.id)
    return [ApplicationResponse.model_validate(a) for a in apps]


@router.get("/applications/{application_id}", response_model=ApplicationResponse)
async def get_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> ApplicationResponse:
    """Get one application (owned or org-shared)."""
    app = await application_repo.get_viewable(
        db, user_id=current_user.id, app_id=application_id
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
    """Partially update an application (edit access; sharing is owner-only)."""
    app = await application_repo.get_viewable(
        db, user_id=current_user.id, app_id=application_id
    )
    if app is None:
        raise _not_found("application")
    if not await can_edit(db, current_user.id, resource=app):
        raise _read_only("application")
    fields = payload.model_dump(exclude_unset=True)
    if "organization_id" in fields:
        # Sharing/unsharing is the OWNER's call — an org member with edit
        # rights may change content, but not move the resource between orgs.
        if app.owner_user_id != current_user.id:
            raise _forbidden(
                "owner_only_operation",
                "Only the owner can share or unshare an application.",
            )
        # Sharing INTO an org requires the owner to hold an edit-capable
        # role there; unsharing (null) is always allowed for the owner.
        await _require_org_edit_membership(
            db, current_user.id, fields["organization_id"]
        )
    if "slug" in fields and await application_repo.slug_exists(
        db,
        owner_id=app.owner_user_id,
        slug=fields["slug"],
        exclude_id=application_id,
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
    """Delete an application (edit access)."""
    app = await application_repo.get_viewable(
        db, user_id=current_user.id, app_id=application_id
    )
    if app is None:
        raise _not_found("application")
    if not await can_edit(db, current_user.id, resource=app):
        raise _read_only("application")
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
    # Validate the optional environment binding is EDITABLE by the caller
    # (owned, or org-shared with an edit-capable role). Non-viewable ids
    # resolve to 404 per the module convention; a viewer gets the honest 403.
    if payload.environment_id is not None:
        await _get_editable_environment(db, current_user.id, payload.environment_id)
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
    if payload.environment_id is not None:
        await _get_editable_environment(db, current_user.id, payload.environment_id)

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
    if payload.environment_id is not None:
        await _get_editable_environment(db, current_user.id, payload.environment_id)
    machine = await machine_repo.update(
        db, machine=machine, fields={"environment_id": payload.environment_id}
    )
    await db.commit()
    return MachineResponse.from_model(machine)


# ---------------------------------------------------------------------------
# Environments
# ---------------------------------------------------------------------------


async def _resolve_application_or_404(
    db: AsyncSession, env_owner_id: UUID, application_id: UUID | None
) -> None:
    """Validate an optional application_id is viewable by the ENV's owner.

    Keyed on the environment's ``owner_user_id`` (the caller, on create) —
    NOT the editing member: otherwise an edit-capable member could bind a
    shared environment to their own private application, leaving the env
    owner unable to even fetch it.
    """
    if application_id is None:
        return
    app = await application_repo.get_viewable(
        db, user_id=env_owner_id, app_id=application_id
    )
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
    """Create an environment, optionally bound to a viewable application.

    ``organization_id`` shares it from birth — the caller must hold an
    edit-capable role in that org.
    """
    if await environment_repo.name_exists(
        db, owner_id=current_user.id, name=payload.name
    ):
        raise _conflict("environment_name_taken", "Environment name already in use.")
    await _resolve_application_or_404(db, current_user.id, payload.application_id)
    await _require_org_edit_membership(db, current_user.id, payload.organization_id)
    env = await environment_repo.create(
        db,
        owner_id=current_user.id,
        name=payload.name,
        description=payload.description,
        application_id=payload.application_id,
        organization_id=payload.organization_id,
    )
    await db.commit()
    return EnvironmentResponse.model_validate(env)


@router.get("/environments", response_model=list[EnvironmentResponse])
async def list_environments(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[EnvironmentResponse]:
    """List the environments the caller can view (owned + org-shared)."""
    envs = await environment_repo.list_accessible(db, user_id=current_user.id)
    return [EnvironmentResponse.model_validate(e) for e in envs]


@router.get("/environments/{environment_id}", response_model=EnvironmentResponse)
async def get_environment(
    environment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> EnvironmentResponse:
    """Get one environment (owned or org-shared)."""
    env = await environment_repo.get_viewable(
        db, user_id=current_user.id, env_id=environment_id
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
    """Partially update an environment (edit access; sharing is owner-only)."""
    env = await environment_repo.get_viewable(
        db, user_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    if not await can_edit(db, current_user.id, resource=env):
        raise _read_only("environment")
    fields = payload.model_dump(exclude_unset=True)
    if "organization_id" in fields:
        # Sharing/unsharing is the OWNER's call — an org member with edit
        # rights may change content, but not move the resource between orgs.
        if env.owner_user_id != current_user.id:
            raise _forbidden(
                "owner_only_operation",
                "Only the owner can share or unshare an environment.",
            )
        # Sharing INTO an org requires the owner to hold an edit-capable
        # role there; unsharing (null) is always allowed for the owner.
        await _require_org_edit_membership(
            db, current_user.id, fields["organization_id"]
        )
    # Name uniqueness is per resource OWNER (uq_devenv_env_owner_name), which
    # may differ from the editing member.
    if "name" in fields and await environment_repo.name_exists(
        db, owner_id=env.owner_user_id, name=fields["name"], exclude_id=environment_id
    ):
        raise _conflict("environment_name_taken", "Environment name already in use.")
    if "application_id" in fields:
        # Keyed on the ENV owner, not the (possibly member) caller — see helper.
        await _resolve_application_or_404(
            db, env.owner_user_id, fields["application_id"]
        )
    env = await environment_repo.update(db, env=env, fields=fields)
    await db.commit()
    return EnvironmentResponse.model_validate(env)


@router.delete("/environments/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(
    environment_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Delete an environment (edit access)."""
    env = await _get_editable_environment(db, current_user.id, environment_id)
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

    Requires EDIT access to the environment. On an org-shared environment
    the machine may belong to ANY user, but must have reported a config row
    for this environment (a machine with no config can't be a useful source
    of truth — and the config row is what ties a foreign machine to the env;
    a foreign machine WITHOUT one resolves 404 so existence never leaks).
    Atomic single-column update, plus an append to the
    ``canonical_change_log`` audit trail (who/when/from->to) — the team-sync
    model requires every canonical change to be attributable; that audit is
    the safety mechanism for "any developer can re-designate canonical". A
    no-op change (re-designating the machine that is already canonical) is
    not recorded.
    """
    env = await _get_editable_environment(db, current_user.id, environment_id)
    machine = await machine_repo.get_by_id(db, machine_id=payload.machine_id)
    if machine is None:
        raise _not_found("machine")
    has_config = await config_repo.exists(
        db, environment_id=environment_id, machine_id=payload.machine_id
    )
    if not has_config:
        # A foreign machine with no config row for this env is indistinguishable
        # from a nonexistent one to this caller — 404, never leak existence.
        if machine.owner_user_id != current_user.id:
            raise _not_found("machine")
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

    Answers "who made this the canonical environment, and when." Visible to
    anyone who can VIEW the environment (non-viewable env id -> 404).
    """
    env = await environment_repo.get_viewable(
        db, user_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    rows = await canonical_log_repo.list_for_environment(
        db, environment_id=environment_id
    )
    return [CanonicalChangeResponse.model_validate(r) for r in rows]


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

    Access is resolved through the ENVIRONMENT: anyone who can view it sees
    the drift of every machine that reported a config for it, regardless of
    which user owns those machines (machines themselves stay owner-scoped
    elsewhere). 422 when no canonical machine is set (drift is undefined
    without a source of truth).
    """
    env = await environment_repo.get_viewable(
        db, user_id=current_user.id, env_id=environment_id
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
    canonical_machine = await machine_repo.get_by_id(
        db, machine_id=env.canonical_machine_id
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
        # The config row ties the machine to this (already-authorized) env,
        # so the lookup is deliberately not caller-owner-scoped.
        target_machine = await machine_repo.get_by_id(db, machine_id=row.machine_id)
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
    """Drift of a single target machine vs the canonical machine.

    Access is resolved through the ENVIRONMENT (view). A machine that is
    neither the caller's own nor tied to this env by a config row resolves
    404 — env visibility must not leak unrelated machines.
    """
    env = await environment_repo.get_viewable(
        db, user_id=current_user.id, env_id=environment_id
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
    target_machine = await machine_repo.get_by_id(db, machine_id=machine_id)
    if target_machine is None:
        raise _not_found("machine")
    if target_machine.owner_user_id != current_user.id and not await config_repo.exists(
        db, environment_id=env.id, machine_id=machine_id
    ):
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
