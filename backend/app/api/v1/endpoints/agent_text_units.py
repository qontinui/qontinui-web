"""Agent text-unit API — the fleet's ``.claude/`` corpus as one kind-discriminated
store of text-file bundles.

A unit is ``(kind, name)`` plus a ``files`` map of relative path → text.
``kind=command`` is the degenerate single-file case (``<name>.md``);
``kind=skill`` carries ``SKILL.md`` plus siblings. ``kind`` is a widenable
discriminator, not a two-value enum.

Two layers resolve here, ``account override → fleet default``:

* Every route is scoped to ONE organization by default. The org is either named
  explicitly (``organization_id``) and checked with the existing
  ``check_organization_membership``, or defaults to the caller's personal
  organization.
* ``fleet_default=true`` addresses the ``organization_id IS NULL`` layer
  instead. **Reads of it are open** to any authenticated caller — a fleet
  default is fleet-wide by definition — while **writes require a superuser**,
  because one write there changes every account that has not overridden the
  unit.

There is still no row for the runner's *embedded* default, so ``DELETE`` only
ever removes a stored layer and lets the next one down apply.

Two list projections, one query
-------------------------------

``GET ""`` returns whole units; ``GET "/index"`` returns the same rows with
every ``files`` map replaced by its paths, byte count and digest. The split is
not an optimization we reached for — the runner resolves the corpus on the
**spawn critical path** inside a 4 s budget and fails SOFT, degrading to cache
and then to embedded defaults, so a corpus too large to fetch in time does not
error, it silently disappears. Measured over the fleet corpus the full listing
is 1,988,661 bytes and the index is 47,093 (2.4%); the intended exchange is read
the index, diff ``checksum`` against the cache, then re-read ``GET ""`` with
``names=`` for just the units that moved. Both routes take the identical filter
set (``UnitListFilters``) and run the identical query, so the index can never
describe a listing the listing would not return.
"""

from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.services.agent_text_unit_service import (
    MAX_NAMES_PER_QUERY,
    AgentTextUnitCreate,
    AgentTextUnitIndexResponse,
    AgentTextUnitListResponse,
    AgentTextUnitResponse,
    AgentTextUnitService,
    AgentTextUnitUpdate,
    AgentTextUnitValidationError,
    AgentTextUnitVersionListResponse,
    RevertRequest,
)
from app.services.permissions.organization_access import (
    check_organization_membership,
    get_personal_organization,
)

router = APIRouter()


def get_service() -> AgentTextUnitService:
    return AgentTextUnitService()


async def resolve_layer(
    db: AsyncSession,
    user: User,
    organization_id: UUID | None,
    fleet_default: bool,
    *,
    write: bool,
) -> UUID | None:
    """Resolve + authorize the LAYER this request addresses.

    Returns ``None`` for the fleet-default layer and a UUID for an account's
    own. A fleet-default WRITE needs a superuser: the row it touches is
    inherited by every account that has not overridden the unit, so account
    membership is not the right authority for it.
    """
    if fleet_default:
        if write and not user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Writing a fleet default requires a superuser",
            )
        return None

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


class UnitListFilters:
    """The filter set BOTH list projections accept, declared exactly once.

    A second hand-written copy of these eight parameters is precisely how the
    full listing and the index would drift apart — one growing a filter the
    other lacks, so a client's index no longer describes the listing it is
    caching against. One dependency is how they cannot; FastAPI flattens it into
    each operation's parameters, so the published OpenAPI is unchanged by the
    sharing.
    """

    def __init__(
        self,
        kind: str | None = Query(
            None, description="Filter to one kind, e.g. 'command'"
        ),
        organization_id: UUID | None = Query(None),
        fleet_default: bool = Query(False, description="List the fleet-default layer"),
        include_fleet_defaults: bool = Query(
            True,
            description=(
                "Include fleet defaults the account has not overridden — the "
                "RESOLVED view the runner needs"
            ),
        ),
        invocable_only: bool = Query(
            False,
            description=(
                "Drop the non-invocable units (the underscore-prefixed copy-source "
                "specs). A client that PROVISIONS units to disk must pass true: a "
                "`_gate-registration.md` written into `.claude/commands/` becomes an "
                "invocable slash command. A client that EDITS the corpus wants the "
                "default, false, so the specs stay visible."
            ),
        ),
        names: list[str] | None = Query(
            None,
            description=(
                "Restrict the listing to these unit names. This is how a client "
                "that already holds the index fetches bodies for exactly the units "
                "whose `checksum` moved, in one request rather than one round trip "
                "per unit. Names are matched inside the `kind` filter, so pass "
                f"`kind` too when a name exists under more than one. At most "
                f"{MAX_NAMES_PER_QUERY}."
            ),
        ),
        offset: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
    ) -> None:
        self.kind = kind
        self.organization_id = organization_id
        self.fleet_default = fleet_default
        self.include_fleet_defaults = include_fleet_defaults
        self.invocable_only = invocable_only
        self.names = names
        self.offset = offset
        self.limit = limit


@router.get(
    "/index",
    response_model=AgentTextUnitIndexResponse,
    summary="List the agent text units WITHOUT their bodies",
)
async def list_agent_text_unit_index(
    filters: UnitListFilters = Depends(),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentTextUnitIndexResponse:
    """The resolved view with every `files` map replaced by its digest.

    Same rows, same filters, same pagination as `GET ""` — see
    `AgentTextUnitService.list_unit_index`, which shares the query rather than
    re-deriving it. Measured over the fleet corpus (87 units, 2026-08-25) this
    is 47,093 bytes against the full listing's 1,988,661 — 2.4% — which is what
    puts a cold resolve back
    inside the runner's 4 s spawn-path fetch budget.

    The intended exchange is two calls: read this index, diff `checksum` against
    the cache, then `GET ""?names=…` for the units that moved.

    Declared BEFORE `GET /{name}`, which would otherwise match `/index`. The
    cost is that a unit literally named `index` is not addressable through that
    route — it is still listed, editable and provisioned like any other, and the
    codebase already accepts this trade for `/search` and `/stats` elsewhere.
    """
    layer = await resolve_layer(
        db, current_user, filters.organization_id, filters.fleet_default, write=False
    )
    try:
        return await service.list_unit_index(
            db,
            layer,
            kind=filters.kind,
            include_fleet_defaults=filters.include_fleet_defaults,
            invocable_only=filters.invocable_only,
            names=filters.names,
            offset=filters.offset,
            limit=filters.limit,
        )
    except AgentTextUnitValidationError as exc:
        raise _validation_error(exc) from exc


@router.get(
    "",
    response_model=AgentTextUnitListResponse,
    summary="List the agent text units this account resolves to",
)
async def list_agent_text_units(
    filters: UnitListFilters = Depends(),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentTextUnitListResponse:
    """The resolved view: account overrides, plus unshadowed fleet defaults."""
    layer = await resolve_layer(
        db, current_user, filters.organization_id, filters.fleet_default, write=False
    )
    try:
        return await service.list_units(
            db,
            layer,
            kind=filters.kind,
            include_fleet_defaults=filters.include_fleet_defaults,
            invocable_only=filters.invocable_only,
            names=filters.names,
            offset=filters.offset,
            limit=filters.limit,
        )
    except AgentTextUnitValidationError as exc:
        raise _validation_error(exc) from exc


@router.post(
    "",
    response_model=AgentTextUnitResponse,
    summary="Create or replace an agent text unit",
)
async def upsert_agent_text_unit(
    data: AgentTextUnitCreate,
    organization_id: UUID | None = Query(None),
    fleet_default: bool = Query(False, description="Write the fleet-default layer"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentTextUnitResponse:
    """Upsert by ``(layer, kind, name)``; appends a new version."""
    layer = await resolve_layer(
        db, current_user, organization_id, fleet_default, write=True
    )
    try:
        return await service.upsert_unit(db, layer, data, current_user.id)
    except AgentTextUnitValidationError as exc:
        raise _validation_error(exc) from exc


@router.get(
    "/{name}",
    response_model=AgentTextUnitResponse,
    summary="Get one agent text unit",
)
async def get_agent_text_unit(
    name: str,
    kind: str = Query(..., description="The unit kind, e.g. 'command' or 'skill'"),
    organization_id: UUID | None = Query(None),
    fleet_default: bool = Query(False),
    include_fleet_defaults: bool = Query(True),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentTextUnitResponse:
    """Resolves ``account override → fleet default``."""
    layer = await resolve_layer(
        db, current_user, organization_id, fleet_default, write=False
    )
    try:
        return await service.get_unit(
            db, layer, kind, name, include_fleet_defaults=include_fleet_defaults
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.patch(
    "/{name}",
    response_model=AgentTextUnitResponse,
    summary="Update an agent text unit",
)
async def update_agent_text_unit(
    name: str,
    data: AgentTextUnitUpdate,
    kind: str = Query(...),
    organization_id: UUID | None = Query(None),
    fleet_default: bool = Query(False),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentTextUnitResponse:
    """A ``files`` change appends a version; other fields do not."""
    layer = await resolve_layer(
        db, current_user, organization_id, fleet_default, write=True
    )
    try:
        return await service.update_unit(db, layer, kind, name, data, current_user.id)
    except AgentTextUnitValidationError as exc:
        raise _validation_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.get(
    "/{name}/versions",
    response_model=AgentTextUnitVersionListResponse,
    summary="List a unit's version history",
)
async def list_agent_text_unit_versions(
    name: str,
    kind: str = Query(...),
    organization_id: UUID | None = Query(None),
    fleet_default: bool = Query(False),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentTextUnitVersionListResponse:
    """History belongs to the addressed layer only — never a fleet fallback."""
    layer = await resolve_layer(
        db, current_user, organization_id, fleet_default, write=False
    )
    try:
        return await service.list_versions(db, layer, kind, name, offset, limit)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.post(
    "/{name}/revert",
    response_model=AgentTextUnitResponse,
    summary="Revert a unit to an earlier version",
)
async def revert_agent_text_unit(
    name: str,
    data: RevertRequest,
    kind: str = Query(...),
    organization_id: UUID | None = Query(None),
    fleet_default: bool = Query(False),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> AgentTextUnitResponse:
    """Appends a NEW version whose files equal the target's — never a rewrite."""
    layer = await resolve_layer(
        db, current_user, organization_id, fleet_default, write=True
    )
    try:
        return await service.revert_to_version(
            db, layer, kind, name, data.version_number, current_user.id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.delete(
    "/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a unit so the next layer down applies again",
)
async def delete_agent_text_unit(
    name: str,
    kind: str = Query(...),
    organization_id: UUID | None = Query(None),
    fleet_default: bool = Query(False),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentTextUnitService = Depends(get_service),
) -> None:
    """Removes the addressed layer's row only — the embedded default is not one."""
    layer = await resolve_layer(
        db, current_user, organization_id, fleet_default, write=True
    )
    deleted = await service.delete_override(db, layer, kind, name)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent text unit not found: {kind}/{name}",
        )
