"""Spawn launch settings — the operator's model and effort per spawn type.

Phase 5 of plan
``2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type`` (D3, D7,
V10). Pure proxy: coord owns ``coord.spawn_launch_settings`` and resolves
every spawn against it at dispatch; this module forwards the operator's
Cognito bearer and the ``X-Qontinui-Active-Tenant`` selection so coord
authorizes the operator and scopes the read and the write to the effective
tenant.

Routes:

- ``GET /api/v1/spawn-launch-settings`` — every settable spawn type with its
  stored ``model`` / ``effort`` (``null`` = inherit from the originating
  session), ``source`` (``stored`` | ``default``), last writer and time, plus
  coord's two vocabularies. Proxies coord ``GET /coord/spawn-launch-settings``.
- ``PUT /api/v1/spawn-launch-settings/{spawn_type}`` — tenant-admin only
  (``require_coord_tenant_admin``; coord re-checks). Body ``{model, effort}``,
  both REQUIRED and each nullable: ``null`` is inherit, and it is a real write
  that clears a stored value. Proxies coord
  ``PUT /coord/spawn-launch-settings/{spawn_type}``, whose answer is the row as
  coord now holds it — the read-back this route returns.

Honesty properties:

- **An unreadable read is never "inherit".** A coord failure stays a failure
  (its status passes through), a route coord does not serve yet is a 502 naming
  the deploy order, and a 200 whose body this module cannot read is a 502 —
  never an empty list or a row of nulls, which would read as "every spawn type
  inherits".
- **The vocabularies are closed.** A model or effort outside the contract's
  families / levels is refused on the way in (422) and on the way out (502).
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, ValidationError

from app.api.deps import get_current_active_user_async
from app.api.v1.endpoints.operations import (
    ACTIVE_TENANT_HEADER,
    _effective_tenant_roles,
    _proxy_coord_get,
    _proxy_coord_put,
    get_tenant_id,
    require_coord_tenant_admin,
)
from app.core.refusal import (
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    refusal_error,
)
from app.models.user import User as UserModel
from app.services.coord_identity import get_coord_identity

logger = structlog.get_logger(__name__)
router = APIRouter()

COORD_PATH = "/coord/spawn-launch-settings"

ModelFamily = Literal["fable", "opus", "sonnet", "haiku"]
EffortLevel = Literal["low", "medium", "high", "xhigh", "max"]

#: A spawn type is a work-type wire name (``post_merge``, ``pr_fix_red_ci``…).
#: Checked locally only for shape, so a typo in the path is a 422 here rather
#: than a URL coord has to parse; whether the type is SETTABLE is coord's call
#: (its 422 names the settable list and passes through).
_SPAWN_TYPE_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"


class SpawnLaunchSettingRow(BaseModel):
    """One settable spawn type as coord resolves it."""

    spawn_type: str
    #: Coord's description of what spawns this type covers.
    description: str
    #: ``None`` — inherit from the originating session.
    model: ModelFamily | None
    #: ``None`` — inherit from the originating session.
    effort: EffortLevel | None
    #: ``stored`` — a row exists for this type; ``default`` — none does.
    source: Literal["stored", "default"]
    updated_by: str | None = None
    updated_at: str | None = None


class SpawnLaunchSettingsResponse(BaseModel):
    """Every settable spawn type, coord's two vocabularies, and edit rights."""

    settings: list[SpawnLaunchSettingRow]
    model_families: list[ModelFamily]
    effort_levels: list[EffortLevel]
    #: Admin in the EFFECTIVE tenant, or a qontinui superuser — the rule the
    #: PUT enforces. UI gating only; coord re-checks.
    can_edit: bool


class SpawnLaunchSettingPut(BaseModel):
    """The full ``{model, effort}`` pair. Both keys are required and each is
    nullable: ``null`` writes inherit, so clearing a stored value is a write."""

    model_config = ConfigDict(extra="forbid")

    model: ModelFamily | None
    effort: EffortLevel | None


def _route_absent(exc: HTTPException) -> bool:
    """A coord that has not shipped the route answers 404 with its fallback's
    ``{"error": "no_such_route", ...}`` body; an older coord with no fallback
    answers an EMPTY 404. Any other 404 is an application answer."""
    if exc.status_code != 404:
        return False
    if not exc.detail:
        return True
    return isinstance(exc.detail, dict) and exc.detail.get("error") == "no_such_route"


def _behind(coord_route: str) -> HTTPException:
    logger.error("spawn_launch_settings.route_absent_on_coord", route=coord_route)
    # The detail's prefix is the one `writeOutcome.ts` recognises as a 502
    # that wrote nothing (`PROXY_ROUTE_ABSENT_PREFIX`).
    return refusal_error(
        502,
        RefusalCode.upstream_unavailable,
        NextActionKind.retry_later,
        f"coord does not serve {coord_route} yet — deploy qontinui-coord first",
        discriminator="spawn_launch_settings_route_absent_on_coord",
        glossary_terms=[GlossaryTerm.coord],
    )


def _unreadable(what: str, *, write: bool) -> HTTPException:
    tail = (
        "; the change may have been applied, so re-read before retrying"
        if write
        else "; the spawn launch settings are unknown"
    )
    return refusal_error(
        502,
        RefusalCode.upstream_unavailable,
        NextActionKind.retry_later,
        f"coord answered with {what}{tail}",
        discriminator=(
            "spawn_launch_settings_unreadable_write_answer"
            if write
            else "spawn_launch_settings_unreadable_read"
        ),
        glossary_terms=[GlossaryTerm.coord],
    )


async def _can_edit(request: Request, current_user: UserModel) -> bool:
    """The rule ``require_coord_tenant_admin`` applies to the PUT: admin in the
    EFFECTIVE tenant, or a qontinui superuser."""
    identity = await get_coord_identity(request)
    active = request.headers.get(ACTIVE_TENANT_HEADER)
    return "admin" in _effective_tenant_roles(identity, active) or bool(
        current_user.is_superuser
    )


@router.get("", response_model=SpawnLaunchSettingsResponse)
async def get_spawn_launch_settings(
    request: Request,
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> SpawnLaunchSettingsResponse:
    """Every settable spawn type's model and effort for the effective tenant."""
    coord_route = f"GET {COORD_PATH}"
    try:
        payload = await _proxy_coord_get(
            COORD_PATH, tenant_id=tenant_id, structured_errors=True
        )
    except HTTPException as exc:
        if _route_absent(exc):
            raise _behind(coord_route) from exc
        raise
    except ValueError as exc:  # a 2xx whose body is not JSON
        raise _unreadable("a body that is not JSON", write=False) from exc
    if not isinstance(payload, dict):
        raise _unreadable("an unrecognised payload", write=False)
    try:
        rows = [
            SpawnLaunchSettingRow.model_validate(row) for row in payload["settings"]
        ]
        families = payload["model_families"]
        levels = payload["effort_levels"]
        can_edit = await _can_edit(request, current_user)
        return SpawnLaunchSettingsResponse(
            settings=rows,
            model_families=families,
            effort_levels=levels,
            can_edit=can_edit,
        )
    except (KeyError, TypeError, ValidationError) as exc:
        logger.warning("spawn_launch_settings.unreadable_payload", error=str(exc)[:500])
        raise _unreadable(
            "spawn launch settings this proxy cannot read", write=False
        ) from exc


@router.put("/{spawn_type}", response_model=SpawnLaunchSettingRow)
async def put_spawn_launch_setting(
    body: SpawnLaunchSettingPut,
    spawn_type: str = Path(..., pattern=_SPAWN_TYPE_PATTERN),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> SpawnLaunchSettingRow:
    """Write one spawn type's model and effort; answer with coord's row.

    Tenant-admin gated web-side; coord re-checks and its refusals (403, and the
    422 naming the settable types) pass through as coord sent them.
    """
    coord_route = f"PUT {COORD_PATH}/{{spawn_type}}"
    # Both keys always go on the wire, `null` included: inherit is a write.
    wire: dict[str, Any] = {"model": body.model, "effort": body.effort}
    try:
        written = await _proxy_coord_put(
            f"{COORD_PATH}/{quote(spawn_type, safe='')}",
            wire,
            tenant_id=tenant_id,
            structured_errors=True,
        )
    except HTTPException as exc:
        if _route_absent(exc):
            raise _behind(coord_route) from exc
        raise
    try:
        row = SpawnLaunchSettingRow.model_validate(written)
    except ValidationError as exc:
        logger.warning(
            "spawn_launch_settings.unreadable_write_answer",
            spawn_type=spawn_type,
            error=str(exc)[:500],
        )
        raise _unreadable("a row this proxy cannot read", write=True) from exc
    if row.spawn_type != spawn_type:
        raise _unreadable(
            f"the row for {row.spawn_type!r}, not {spawn_type!r}", write=True
        )
    return row
