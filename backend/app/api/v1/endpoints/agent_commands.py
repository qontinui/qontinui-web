"""Agent command override API — a THIN ALIAS over the agent text-unit corpus.

The corpus this serves moved to ``project.agent_text_units``
(``/api/v1/agent-text-units?kind=…``), where a command is the degenerate
single-file case of a text unit: one ``files`` entry at ``<name>.md``. This
module exists for exactly one reason — **a not-yet-rebuilt runner still calls
``GET /api/v1/agent-commands?limit=500``** (``agent_commands/mod.rs``), and a
storage refactor must not stop it resolving commands.

So every route here is a translation, never a second implementation:

* ``files`` → ``body``: the entry at the unit's entrypoint (``<name>.md``), or
  the sole entry of a one-file map.
* ``body`` → ``files``: ``{"<name>.md": body}``.
* ``checksum``: the LEGACY single-body digest (``compute_body_checksum``, the
  cross-surface definition an old runner knows), **not** the unit's stored
  ``files``-map digest. The wire shape is legacy, so its digest is too.

One deliberate behaviour change, and it is the point of the two-layer model:
the list now folds in **fleet defaults** (``organization_id IS NULL``) the
account has not overridden, so an old runner picks up the fleet corpus with no
rebuild. Non-``command`` kinds are never returned here.

There is no ``fleet_default`` write arm on this alias. Writing the fleet layer
is a superuser action on the real API; a legacy client only ever writes its own
account's override.

**Delete this module once every runner in the fleet reads
``/api/v1/agent-text-units``** — it is a compatibility alias with a defined end,
not a second API.
"""

from datetime import datetime
from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.agent_text_unit import KIND_COMMAND, entrypoint_path
from app.models.user import User
from app.services.agent_text_unit_service import (
    AgentTextUnitCreate,
    AgentTextUnitResponse,
    AgentTextUnitService,
    AgentTextUnitUpdate,
    AgentTextUnitValidationError,
    AgentTextUnitVersionResponse,
    Pagination,
    RevertRequest,
    compute_body_checksum,
)
from app.services.permissions.organization_access import (
    check_organization_membership,
    get_personal_organization,
)

router = APIRouter()


def get_service() -> AgentTextUnitService:
    return AgentTextUnitService()


# =============================================================================
# The legacy wire shape — unchanged, so an old runner's structs still parse
# =============================================================================


class AgentCommandCreate(BaseModel):
    """Request to create (or replace) an account's override of a command."""

    name: str
    body: str
    change_description: str | None = None
    is_shared: bool = False


class AgentCommandUpdate(BaseModel):
    """Request to update an override. All fields optional."""

    body: str | None = None
    change_description: str | None = None
    is_shared: bool | None = None


class AgentCommandResponse(BaseModel):
    """Response for one command, in the pre-text-unit wire shape."""

    id: str
    organization_id: str | None = None
    created_by_user_id: str | None = None
    name: str
    body: str
    checksum: str | None = None
    is_shared: bool = False
    current_version: int
    source: str = "user"
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentCommandVersionResponse(BaseModel):
    """Response for one row of the append-only version chain."""

    id: str
    agent_command_id: str
    version_number: int
    body: str
    checksum: str | None = None
    created_by_user_id: str | None = None
    change_description: str | None = None
    restored_from: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentCommandListResponse(BaseModel):
    items: list[AgentCommandResponse]
    pagination: Pagination


class AgentCommandVersionListResponse(BaseModel):
    items: list[AgentCommandVersionResponse]
    pagination: Pagination


# =============================================================================
# Translation
# =============================================================================


def files_to_body(kind: str, name: str, files: dict[str, str]) -> str:
    """The unit's primary text, for a wire shape that only carries one string.

    A command's map has exactly one entry, so both arms agree for every unit
    this alias can return; the sole-entry fallback covers a unit stored under a
    different entrypoint convention rather than silently returning ``""``.
    """
    entrypoint = entrypoint_path(kind, name)
    if entrypoint in files:
        return files[entrypoint]
    if len(files) == 1:
        return next(iter(files.values()))
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"{kind}/{name} is a multi-file unit with no {entrypoint!r}; read it "
            "from /api/v1/agent-text-units"
        ),
    )


def body_to_files(name: str, body: str) -> dict[str, str]:
    """A command body is the degenerate single-entry ``files`` map."""
    return {entrypoint_path(KIND_COMMAND, name): body}


def _unit_to_command(unit: AgentTextUnitResponse) -> AgentCommandResponse:
    body = files_to_body(unit.kind, unit.name, unit.files)
    return AgentCommandResponse(
        id=unit.id,
        organization_id=unit.organization_id,
        created_by_user_id=unit.created_by_user_id,
        name=unit.name,
        body=body,
        checksum=compute_body_checksum(body),
        is_shared=unit.is_shared,
        current_version=unit.current_version,
        source=unit.source,
        created_at=unit.created_at,
        updated_at=unit.updated_at,
    )


def _unit_version_to_command_version(
    name: str, version: AgentTextUnitVersionResponse
) -> AgentCommandVersionResponse:
    body = files_to_body(KIND_COMMAND, name, version.files)
    return AgentCommandVersionResponse(
        id=version.id,
        agent_command_id=version.agent_text_unit_id,
        version_number=version.version_number,
        body=body,
        checksum=compute_body_checksum(body),
        created_by_user_id=version.created_by_user_id,
        change_description=version.change_description,
        restored_from=version.restored_from,
        created_at=version.created_at,
    )


async def _resolve_organization_id(
    db: AsyncSession,
    user: User,
    organization_id: UUID | None,
) -> UUID:
    """Resolve + authorize the account these commands belong to.

    An explicit ``organization_id`` goes through the existing membership check;
    omitting it falls back to the caller's personal organization, which every
    user gets at registration.
    """
    if organization_id is not None:
        membership = await check_organization_membership(
            db, user.id, organization_id, required_role="member"
        )
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a member of this organization",
            )
        return organization_id

    personal = await get_personal_organization(db, user.id)
    if not personal:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No personal organization for this user; pass organization_id "
                "explicitly."
            ),
        )
    # `Organization` is a legacy `Column`-style model, so `.id` types as a
    # Column rather than a UUID.
    return cast(UUID, personal.id)


def _validation_error(exc: AgentTextUnitValidationError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
    )


# =============================================================================
# Routes — the seven the runner and the shipped editor already call
# =============================================================================


@router.get(
    "",
    response_model=AgentCommandListResponse,
    summary="List the agent commands this account resolves to",
)
async def list_agent_commands(
    organization_id: UUID | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentCommandListResponse:
    """Account overrides plus unshadowed fleet defaults, ``kind='command'``.

    ``invocable_only=True`` is hardcoded, not a parameter. This wire shape has
    no field for ``is_invocable``, and its consumer is a runner that writes
    every command it is handed into ``.claude/commands/`` — so a returned
    ``_gate-registration`` would become an invocable ``/_gate-registration`` on
    an unrebuilt device. Filtering here is the only place that can prevent it.
    The underscore units remain readable through the current API and the
    console; they are simply never handed to a provisioning client.
    """
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    listing = await service.list_units(
        db,
        org_id,
        kind=KIND_COMMAND,
        invocable_only=True,
        offset=offset,
        limit=limit,
    )
    return AgentCommandListResponse(
        items=[_unit_to_command(u) for u in listing.items],
        pagination=listing.pagination,
    )


@router.post(
    "",
    response_model=AgentCommandResponse,
    summary="Create or replace an agent command override",
)
async def upsert_agent_command(
    data: AgentCommandCreate,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentCommandResponse:
    """Upsert by ``(organization_id, 'command', name)``; appends a version."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        unit = await service.upsert_unit(
            db,
            org_id,
            AgentTextUnitCreate(
                kind=KIND_COMMAND,
                name=data.name,
                files=body_to_files(data.name, data.body),
                change_description=data.change_description,
                is_shared=data.is_shared,
                is_invocable=not data.name.startswith("_"),
            ),
            current_user.id,
        )
    except AgentTextUnitValidationError as exc:
        raise _validation_error(exc) from exc
    return _unit_to_command(unit)


@router.get(
    "/{name}",
    response_model=AgentCommandResponse,
    summary="Get one agent command",
)
async def get_agent_command(
    name: str,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentCommandResponse:
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        unit = await service.get_unit(db, org_id, KIND_COMMAND, name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return _unit_to_command(unit)


@router.patch(
    "/{name}",
    response_model=AgentCommandResponse,
    summary="Update an agent command override",
)
async def update_agent_command(
    name: str,
    data: AgentCommandUpdate,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentCommandResponse:
    """A body change appends a version; other fields do not."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        unit = await service.update_unit(
            db,
            org_id,
            KIND_COMMAND,
            name,
            AgentTextUnitUpdate(
                files=(None if data.body is None else body_to_files(name, data.body)),
                change_description=data.change_description,
                is_shared=data.is_shared,
            ),
            current_user.id,
        )
    except AgentTextUnitValidationError as exc:
        raise _validation_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return _unit_to_command(unit)


@router.get(
    "/{name}/versions",
    response_model=AgentCommandVersionListResponse,
    summary="List an override's version history",
)
async def list_agent_command_versions(
    name: str,
    organization_id: UUID | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentCommandVersionListResponse:
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        listing = await service.list_versions(
            db, org_id, KIND_COMMAND, name, offset, limit
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return AgentCommandVersionListResponse(
        items=[_unit_version_to_command_version(name, v) for v in listing.items],
        pagination=listing.pagination,
    )


@router.post(
    "/{name}/revert",
    response_model=AgentCommandResponse,
    summary="Revert an override to an earlier version",
)
async def revert_agent_command(
    name: str,
    data: RevertRequest,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentCommandResponse:
    """Appends a NEW version whose body equals the target's — never a rewrite."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        unit = await service.revert_to_version(
            db, org_id, KIND_COMMAND, name, data.version_number, current_user.id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return _unit_to_command(unit)


@router.delete(
    "/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an override so the next layer down applies again",
)
async def delete_agent_command_override(
    name: str,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> None:
    """Removes the account's customization only — the fleet default survives."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    deleted = await service.delete_override(db, org_id, KIND_COMMAND, name)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent command override not found: {name}",
        )
