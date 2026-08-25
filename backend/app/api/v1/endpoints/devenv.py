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
* ``GET``/``PUT /machines/{id}/ci-node`` — the machine's desired CI-node
  configuration (the runner's ``CiNodeSettings``). The PUT saves and then
  dispatches through coord to the paired runner; see the section comment above
  those handlers for why that is the only write path.
* CRUD ``/environments``
* ``PUT /environments/{id}/canonical`` — atomically set the canonical
  machine (validated owned + has a config row for the env)
* ``GET /environments/{id}/drift`` and
  ``GET /environments/{id}/drift/{machine_id}`` — drift vs canonical
"""

from __future__ import annotations

from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import devenv_machine_crud
from app.models.devenv import Environment, Machine
from app.models.user import User
from app.repositories.devenv import (
    application_repo,
    can_edit,
    canonical_log_repo,
    config_history_repo,
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
    CiNodeConfig,
    CiNodeConfigResponse,
    CiNodeReachabilityT,
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
    ReposApplyDispatchRequest,
    ReposApplyDispatchResponse,
    SetCanonicalRequest,
    SetMachineEnvironmentRequest,
)
from app.services import coord_device, devenv_drift
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


@router.post(
    "/machines/{machine_id}/repos-apply-dispatch",
    response_model=ReposApplyDispatchResponse,
)
async def dispatch_repos_apply(
    machine_id: UUID,
    payload: ReposApplyDispatchRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> ReposApplyDispatchResponse:
    """Ask this machine's runner to reconcile its cloned repositories.

    The server REQUESTS; the box DECIDES. Coord publishes a directive on
    ``events.devenv.repos_apply_requested.<device_id>``; the target's own runner
    runs its local apply and re-captures. Nothing here executes a clone.

    ``dispatched: true`` means coord accepted the directive — not that the box
    acted on it. The runner may legitimately decline (no workspace root
    resolved, canonical and this box on incomparable scopes, free disk below the
    floor), and the outcome shows up as ordinary drift on the next capture.

    Plan ``2026-08-06-devenv-repos-section``, P4.
    """
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    # A machine with no bound coord device has no runner to ask. That is a
    # precondition failure, not a soft dispatch failure: retrying cannot fix it,
    # so say so rather than returning `dispatched: false` and inviting a retry.
    if machine.coord_device_id is None:
        raise _conflict(
            "machine_not_paired",
            "This machine is not bound to a coord device, so there is no runner "
            "to ask. Enroll it from the device first.",
        )

    auth = request.headers.get("Authorization")
    headers = {"Authorization": auth} if auth else {}

    try:
        resp = await post_to_coord(
            "/devenv/repos-apply-dispatch",
            headers=headers,
            json_body={
                "target_device_id": str(machine.coord_device_id),
                "confirm": payload.confirm,
            },
            log_event="devenv_dispatch_repos_apply",
            machine_id=str(machine.id),
            target_device_id=str(machine.coord_device_id),
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "coord dispatch failed"
        return ReposApplyDispatchResponse(
            dispatched=False, confirm=payload.confirm, detail=str(detail)
        )

    if resp.status_code >= 400:
        return ReposApplyDispatchResponse(
            dispatched=False,
            confirm=payload.confirm,
            detail=f"coord rejected the dispatch (HTTP {resp.status_code})",
        )
    return ReposApplyDispatchResponse(dispatched=True, confirm=payload.confirm)


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
# CI-node configuration (plan 2026-08-07, Phase 4)
#
# THE WRITE PATH, AND WHY THERE IS ONLY ONE.
#
# The runner owns its settings file; nothing in qontinui-web can write it
# directly. There were two candidate doors and one of them already existed:
#
#   (a) coord's `/ws` fanout. The runner's CI-node subscription
#       (`ci_node/subscription.rs`) already holds a socket on the Redis glob
#       `events.ci.*.<device_id>` — a WILDCARD over the whole CI channel family,
#       not a per-channel subscription. A settings directive published on
#       `events.ci.settings_requested.<device_id>` therefore arrives on a socket
#       the device already has open, needing no new connection, no new pattern,
#       and no polling loop. Coord already routes exactly this shape for
#       devenv's own dispatched self-enroll: `POST /devenv/enroll-dispatch`
#       publishes `events.devenv.enroll_requested.<device_id>`, which
#       `dispatch_enroll` above reaches through `post_to_coord`.
#
#   (b) a new pull endpoint on web that the runner polls.
#
# (a) wins and (b) is not built. Adding a poll would mean a second write path
# for the same struct, a second thing to keep in sync with `CiNodeSettings`,
# and a second failure mode — while (a) reuses a transport, an auth model and a
# call helper that are all already load-bearing in this very module. DO NOT ADD
# A POLL PATH LATER: if this door needs to change, change it here.
#
# WHAT WEB HONESTLY KNOWS, AND WHAT IT DOES NOT.
#
# Coord's fanout is fire-and-forget and the runner sends no acknowledgement for
# settings. So the strongest true statement web can make is "coord accepted the
# directive for delivery" — never "the runner applied it". These endpoints
# therefore report three separate facts and never collapse them: what was
# REQUESTED, when it was DISPATCHED, and how REACHABLE the device is according
# to coord's own WS session state. A UI that renders a saved-but-undeliverable
# config as though it were live would be lying, and this shape makes that lie
# require effort.
#
# AND WHEN THE DISPATCH IS REFUSED, WHOSE WORDS THE USER GETS.
#
# The same honesty applies to failures. coord refuses for genuinely different
# reasons, and only some of them are the user's to fix: a `*` in the allowlist
# is a 400 with an explanation they can act on in this form, while a device
# that is not registered to their tenant is a 404 they cannot do anything about
# here. Rendering both as "coord rejected the dispatch (HTTP 4xx)" — which is
# what this endpoint used to do — tells them a number and hides the one thing
# they needed.
#
# So coord's status and its parsed body are forwarded into the response
# (`dispatch_status` / `dispatch_error` / `dispatch_detail`) rather than
# collapsed, in the shape `operations.py::_proxy_coord_passthrough` uses for
# the tenant merge-remediation surface. What is NOT copied from that helper is
# returning coord's status as the endpoint's own: this PUT has already
# committed the save, so a 400 here would report the save as failed. The PUT
# stays 200 with `dispatched=False`, and the refusal rides the body.
# ---------------------------------------------------------------------------

# Coord's route for the CI-node settings directive, the sibling of
# `/devenv/enroll-dispatch`. Coord validates the target device and publishes
# `events.ci.settings_requested.<device_id>` on the family the runner's CI
# socket already subscribes to.
_COORD_CI_NODE_DISPATCH_PATH = "/devenv/ci-node-dispatch"

# What to say when coord refuses WITHOUT prose. Keyed by status because the
# status is the only thing we know in that case; each sentence claims exactly
# that much and no more.
#
# The 404 wording matters: coord answers 404 for "no such device" AND for
# "device in another tenant" deliberately, so that a caller cannot use the
# difference to enumerate another tenant's fleet. This copy must therefore not
# resolve that ambiguity either — it says the machine is not one this account
# can send to, which is true of both.
_COORD_STATUS_FALLBACKS: dict[int, str] = {
    400: ("These settings were not accepted. Check the values above and try again."),
    401: (
        "qontinui.io was not signed in to the coordinator, so nothing was sent. "
        "Reload and try again."
    ),
    403: (
        "Your account is not allowed to send settings to this machine. The "
        "settings are saved here."
    ),
    404: (
        "The coordinator does not have this machine registered to your account, "
        "so there was nothing to send to. The settings are saved here."
    ),
    409: "The coordinator could not apply these settings right now.",
}


async def _ci_node_reachability(
    request: Request,
    current_user: User,
    coord_device_id: UUID | None,
) -> CiNodeReachabilityT:
    """Ask coord whether the paired device could receive a directive at all.

    Degrades honestly: a coord that cannot be reached yields ``"unknown"``
    rather than ``"offline"``, because "we could not ask" and "it is not there"
    are different claims and only one of them is evidence.
    """
    if coord_device_id is None:
        return "unlinked"
    try:
        routing = await coord_device.get_device_routing(
            coord_device_id,
            bearer=coord_device.extract_bearer(request),
            user_id=str(current_user.id),
        )
    except HTTPException:
        # 502/504 from the coord client, or coord's own error status. The
        # machine page must still render; it just may not claim reachability.
        return "unknown"
    if routing is None:
        # Coord's 404: it does not know this device as owned by this user, so
        # there is nothing to deliver to.
        return "unlinked"
    return "online" if routing.get("ws_session_id") is not None else "offline"


def _coord_transport_detail(exc: HTTPException) -> str:
    """Human sentence for a `post_to_coord` transport failure.

    ``post_to_coord`` raises with ``detail`` as either a plain string
    (``"Coord unreachable."``) or the ``{"error", "message"}`` envelope it uses
    for the 503/504 degrades. The previous code kept only the string arm and
    flattened the envelope to ``"coord dispatch failed"`` — throwing away the
    one sentence written for a human ("Coord is temporarily unavailable (likely
    a rolling deploy); retry shortly."), which is precisely the case where
    telling the user to retry is the correct advice.
    """
    detail = exc.detail
    if isinstance(detail, str) and detail:
        return detail
    if isinstance(detail, dict):
        message = detail.get("message")
        if isinstance(message, str) and message:
            return message
    return (
        "qontinui.io could not reach the coordinator, so the settings were not "
        "sent. They are saved here — try again shortly."
    )


def _coord_dispatch_refusal(resp: httpx.Response) -> tuple[str | None, str]:
    """Turn coord's non-2xx answer into ``(machine code, human sentence)``.

    This is the passthrough shape that ``operations.py``'s
    ``_proxy_coord_passthrough`` uses on the tenant merge-remediation surface,
    adapted to a route that cannot simply forward coord's status: the PUT has
    ALREADY saved the config, so answering with coord's 400/404 would report
    the save as failed. So coord's status and parsed body ride the response
    BODY instead — ``dispatch_status`` / ``dispatch_error`` /
    ``dispatch_detail`` — while the PUT itself stays 200 with
    ``dispatched=False``.

    What this replaces: ``f"coord rejected the dispatch (HTTP {status})"``,
    which rendered a validation refusal the user could fix (a ``*`` in the
    allowlist) and an authorization refusal they cannot (the device is not
    theirs) as the same bare number.

    coord's refusal envelope on this route is uniform — ``{"error": <code>,
    "message": <prose>}`` — so the parse is one rule: ``error`` is always a
    code, ``message`` is always prose. Anything else (a proxy's HTML error
    page, an empty body, a non-object JSON) degrades to a status-derived
    sentence rather than to an invented code, because reporting "we do not
    know why" is honest and inventing a code is not.
    """
    payload: object
    try:
        payload = resp.json()
    except ValueError:
        payload = None

    code: str | None = None
    message: str | None = None
    if isinstance(payload, dict):
        raw_code = payload.get("error")
        if isinstance(raw_code, str) and raw_code:
            code = raw_code
        raw_message = payload.get("message")
        if isinstance(raw_message, str) and raw_message:
            message = raw_message

    if message is None:
        # No prose from coord. Say what we actually know — the status and, when
        # there is one, the code — instead of dressing it up.
        message = _COORD_STATUS_FALLBACKS.get(
            resp.status_code,
            f"The coordinator refused to send these settings (HTTP {resp.status_code}).",
        )
        if code is not None:
            message = f"{message} (coordinator said: {code})"
    return code, message


def _ci_node_response(
    machine: Machine,
    reachability: CiNodeReachabilityT,
    *,
    dispatched: bool | None = None,
    dispatch_status: int | None = None,
    dispatch_error: str | None = None,
    dispatch_detail: str | None = None,
) -> CiNodeConfigResponse:
    """Build the response from a machine row + a reachability verdict."""
    stored = machine.ci_node_config
    return CiNodeConfigResponse(
        machine_id=machine.id,
        coord_device_id=machine.coord_device_id,
        # A never-configured machine round-trips as the RUNNER's defaults
        # (off, empty allowlist), never as a friendlier posture.
        requested=CiNodeConfig.model_validate(stored) if stored else CiNodeConfig(),
        configured=stored is not None,
        requested_at=machine.ci_node_requested_at,
        dispatched_at=machine.ci_node_dispatched_at,
        reachability=reachability,
        dispatched=dispatched,
        dispatch_status=dispatch_status,
        dispatch_error=dispatch_error,
        dispatch_detail=dispatch_detail,
    )


@router.get("/machines/{machine_id}/ci-node", response_model=CiNodeConfigResponse)
async def get_ci_node_config(
    machine_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> CiNodeConfigResponse:
    """Read the machine's desired CI-node config + its delivery state.

    ``dispatched`` is always ``None`` here: a read attempts no delivery, and a
    client must not be able to mistake a GET for a successful push.
    """
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")
    reachability = await _ci_node_reachability(
        request, current_user, machine.coord_device_id
    )
    return _ci_node_response(machine, reachability)


@router.put("/machines/{machine_id}/ci-node", response_model=CiNodeConfigResponse)
async def set_ci_node_config(
    machine_id: UUID,
    payload: CiNodeConfig,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> CiNodeConfigResponse:
    """Save the desired CI-node config and dispatch it to the paired runner.

    The save ALWAYS happens; the dispatch is best-effort, exactly like
    ``dispatch_enroll``. That ordering is deliberate: an owner who curates an
    allowlist while their machine is asleep must not lose the work, and a
    silent "saved but never sent" is precisely the state the response's
    ``dispatched`` / ``dispatched_at`` / ``reachability`` triple exists to make
    visible.
    """
    machine = await machine_repo.get(
        db, owner_id=current_user.id, machine_id=machine_id
    )
    if machine is None:
        raise _not_found("machine")

    now = utc_now()
    await machine_repo.update(
        db,
        machine=machine,
        fields={
            "ci_node_config": payload.model_dump(mode="json"),
            "ci_node_requested_at": now,
        },
    )
    await db.commit()
    await db.refresh(machine)

    reachability = await _ci_node_reachability(
        request, current_user, machine.coord_device_id
    )
    if machine.coord_device_id is None:
        return _ci_node_response(
            machine,
            reachability,
            dispatched=False,
            dispatch_detail=(
                "This machine is not paired with a runner, so there is nothing "
                "to send the settings to. They are saved and will be sent the "
                "next time you apply them after pairing."
            ),
        )

    auth = request.headers.get("Authorization")
    headers = {"Authorization": auth} if auth else {}
    coord_body: dict[str, object] = {
        "target_device_id": str(machine.coord_device_id),
        "machine_id": str(machine.id),
        "ci_node": payload.model_dump(mode="json"),
    }
    try:
        resp = await post_to_coord(
            _COORD_CI_NODE_DISPATCH_PATH,
            headers=headers,
            json_body=coord_body,
            log_event="devenv_ci_node_dispatch",
            machine_id=str(machine.id),
            target_device_id=str(machine.coord_device_id),
        )
    except HTTPException as exc:
        # A TRANSPORT failure, raised by `post_to_coord` itself (coord
        # unreachable / timed out / still deploying). Distinct from a refusal:
        # coord never answered, so there is no coord status or code to forward
        # and both stay None. `dispatch_error` is left None on purpose — an
        # invented code here would be indistinguishable from one coord sent.
        detail = _coord_transport_detail(exc)
        return _ci_node_response(
            machine, reachability, dispatched=False, dispatch_detail=detail
        )

    if resp.status_code >= 400:
        # A REFUSAL: coord answered, with a reason. Forward its status and its
        # parsed body so the panel can say which class of refusal this was — a
        # value the user can fix here, or a device that is not theirs.
        code, message = _coord_dispatch_refusal(resp)
        return _ci_node_response(
            machine,
            reachability,
            dispatched=False,
            dispatch_status=resp.status_code,
            dispatch_error=code,
            dispatch_detail=message,
        )

    await machine_repo.update(
        db, machine=machine, fields={"ci_node_dispatched_at": utc_now()}
    )
    await db.commit()
    await db.refresh(machine)
    return _ci_node_response(machine, reachability, dispatched=True)


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
    ``canonical_change_log`` audit trail (who/when/from->to, plus the
    optional ``note`` explaining why) — the team-sync model requires every
    canonical change to be attributable; that audit is the safety mechanism
    for "any developer can re-designate canonical". A no-op change
    (re-designating the machine that is already canonical) is not recorded,
    and neither is its note: there is no change for it to annotate.
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
            note=payload.note,
        )
    await db.commit()
    return EnvironmentResponse.model_validate(env)


@router.get(
    "/environments/{environment_id}/canonical-history",
    response_model=list[CanonicalChangeResponse],
)
async def get_canonical_history(
    environment_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[CanonicalChangeResponse]:
    """List the environment's canonical-designation changes, newest first.

    Answers "who made this the canonical environment, when, and why."
    Visible to anyone who can VIEW the environment (non-viewable env id -> 404).

    Paged with the same ``limit``/``offset`` contract as the config-history
    timeline, so a client can page BACK through an audit trail longer than one
    page instead of silently presenting the first page as the whole history.

    Display names (actor email, from/to machine names) are resolved by the
    repository in the same query; each is ``None`` when the referenced row is
    gone, which is expected — the audit outlives machine/user deletion.
    """
    env = await environment_repo.get_viewable(
        db, user_id=current_user.id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    rows = await canonical_log_repo.list_for_environment(
        db, environment_id=environment_id, limit=limit, offset=offset
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


# ---------------------------------------------------------------------------
# Config history (P2 — drift over time)
# ---------------------------------------------------------------------------


async def _resolve_env_machine_or_404(
    db: AsyncSession, *, user_id: UUID, environment_id: UUID, machine_id: UUID
) -> tuple[Environment, Machine]:
    """Resolve a viewable (environment, machine) pair, 404-ing like siblings.

    Access is resolved through the ENVIRONMENT (view), matching the drift
    routes: on an org-shared environment the machine may belong to ANY user,
    but one that is neither the caller's own nor tied to this env by a config
    row resolves 404 — env visibility must not leak unrelated machines.
    """
    env = await environment_repo.get_viewable(
        db, user_id=user_id, env_id=environment_id
    )
    if env is None:
        raise _not_found("environment")
    machine = await machine_repo.get_by_id(db, machine_id=machine_id)
    if machine is None:
        raise _not_found("machine")
    if machine.owner_user_id != user_id and not await config_repo.exists(
        db, environment_id=env.id, machine_id=machine_id
    ):
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
        user_id=current_user.id,
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
        user_id=current_user.id,
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

    # ``temporal``: these two envelopes are two captures of the SAME machine, so
    # ``in_sync`` here means "nothing changed between them" — a different
    # question from the vs-canonical endpoints' "do these two boxes agree?". The
    # installed-inventory rules are only valid for the second one: they exist so
    # two boxes that both measured nothing cannot be called equal, but two
    # captures of one box that measured nothing genuinely ARE unchanged, and
    # asserting otherwise badges every consecutive pair on a box with a broken
    # Python (and would do it for ``from_id == to_id``).
    report = devenv_drift.diff_envelopes(from_row.config, to_row.config, temporal=True)
    report = _attach_machine_identity(report, machine)
    return ConfigHistoryDiffResponse(
        **report.model_dump(),
        from_id=from_row.id,
        to_id=to_row.id,
        from_captured_at=from_row.captured_at,
        to_captured_at=to_row.captured_at,
    )
