"""
Operations API — Fleet & cross-machine monitoring.

Renamed from ``dev_dashboard.py``. The route prefix moves from
``/dev-dashboard`` to ``/operations`` and the endpoints become
user-authenticated (premium-feature material). The `runners` list now
uses the canonical `Runner` wire shape (``derived_status``, etc.) so
consumers don't need a separate mental model for fleet vs runners.

Note: the ``/operations/heartbeat`` and ``/operations/claude-sessions``
ingestion endpoints stay unauthenticated (LAN-only) — they are the
cross-machine beacon path. Phase 5 cleanup may collapse them into the
new ``runners`` table.
"""

import asyncio
import contextvars
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
import structlog
import websockets
import websockets.exceptions
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from qontinui_schemas.generated.per_type.memory_restore_request import (
    MemoryRestoreRequest,
)

# Canonical wire-format DTOs for `/operations/memory/*` proxy routes —
# promoted to qontinui-schemas in plan
# ``2026-05-22-memories-on-coord-cross-machine.md`` Phase 6 so coord,
# runner-side memory bridge, and qontinui-web all share one shape.
from qontinui_schemas.generated.per_type.memory_upsert_request import (
    MemoryUpsertRequest,
)
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketState

# websockets.connect IS a top-level export in 16.x (verified via
# `dir(websockets)`), but it's a lazy import the mypy stubs don't
# resolve. The explicit re-import below is the type-checker affordance;
# at runtime the symbol is identical to `websockets.connect`.
from websockets.asyncio.client import connect as websockets_connect  # noqa: E402

from app.api.admin_deps import require_admin
from app.api.deps import (
    get_async_db,
    get_current_active_user_async,
    get_current_user_from_ws,
)
from app.api.v1.endpoints.devices import _device_to_wire as _runner_to_wire
from app.core.config import settings
from app.crud import runner_crud
from app.models.machine_display_name import MachineDisplayName
from app.models.user import User as UserModel
from app.schemas.dev_dashboard import (
    AggregatedTaskRuns,
    ClaudeSessionReport,
    RegisteredRunner,
    RunnerHeartbeat,
    RunnerTaskRun,
)
from app.services import cognito_admin
from app.services.cognito_admin import (
    CognitoAdminError,
    CognitoAmbiguousEmailError,
    CognitoGroupExistsError,
)
from app.services.coord_device_status import (
    CoordDeviceStatusDisabledError,
    CoordDeviceStatusMintFailedError,
    build_device_status_ws_url,
    fetch_device_status,
    mint_device_status_token,
)
from app.services.coord_identity import (
    CoordIdentity,
    get_coord_identity,
    get_coord_identity_for_token,
)
from app.services.dev_dashboard_service import get_fleet_registry
from app.websockets.safe_send import safe_close, safe_send_json

# Timeout for coord proxy reads. The merge queue is a small JSON payload
# served from PG; if coord takes longer than 5s something is wrong.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Phase T2b — the legacy ``X-Qontinui-Tenant-Id`` email-bridge header is no
# longer sent to coord. Coord resolves the operator/tenant from the
# forwarded Cognito bearer (``resolve_operator_optional`` middleware,
# enforced in ``qontinui-coord/src/tenant_scope.rs``). ``_tenant_headers``
# now forwards only ``Authorization: Bearer``.

logger = structlog.get_logger(__name__)
router = APIRouter()


# ---- Tenant resolution dependency ---------------------------------------
#
# Every dashboard endpoint that proxies to coord depends on this. It
# replaces the old ``require_admin`` posture — instead of "must be a
# superuser," the new rule is "any authenticated user, scoped to their
# resolved tenant." The dependency resolves the user → operator →
# tenant_id chain and returns the UUID. As of Phase T2b the tenant_id is
# NOT forwarded as a header; coord resolves it from the forwarded Cognito
# bearer instead (the UUID is still used by web-side authz / query params).
#
# The operator-management surfaces (``/admin/coord/operators/*``,
# ``/admin/coord/audit/*``) — when they land — will stay
# `require_role("admin")`-gated, not this dependency. They live in a
# different file and aren't part of the operations dashboard.


# Phase T2b — the caller's raw Cognito token, captured per-request by
# ``get_tenant_id`` and forwarded to coord by ``_tenant_headers`` so coord
# authorizes on the token's operator identity (its ``sub``) and resolves the
# tenant from it. The legacy ``X-Qontinui-Tenant-Id`` email-bridge header is
# no longer sent (removed in T2b once token-forwarding went live in T3).
# ContextVar is task-local, so each request sees only its own token (no
# cross-request leakage).
_caller_bearer: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "coord_caller_bearer", default=None
)

# The dashboard tenant-switcher selection. qontinui-web forwards the
# operator's chosen tenant to coord as ``X-Qontinui-Active-Tenant``; coord
# re-scopes the operator's context to it ONLY IF the operator holds a role
# in that tenant (validated coord-side — see qontinui-coord
# ``auth::apply_active_tenant_override``). Absent/invalid/non-member → coord
# keeps the operator's home tenant. Captured per-request alongside the
# bearer and forwarded by ``_tenant_headers``.
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"

_caller_active_tenant: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "coord_caller_active_tenant", default=None
)


def _extract_caller_token(request: Request) -> str | None:
    """Pull the caller's bearer token from the ``access_token`` cookie or
    the ``Authorization`` header — the same two sources the backend's own
    ``CookieOrBearerScheme`` reads. A Cognito-authenticated session carries
    a Cognito token here; a legacy local-login session carries a local JWT
    (which coord's verifier rejects and falls back to the header for, until
    Phase T3 removes local login)."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return None


async def get_tenant_id(
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> UUID:
    """Dependency: resolve the current user's home tenant_id (UUID).

    Identity is sourced from coord's ``GET /admin/coord/me`` over the HTTP
    boundary (no cross-schema read). Coord 403s an operator that isn't a
    linked tenant member, surfaced here as 403 ``tenant_not_resolved`` —
    the same fail-closed gate the old ``coord_operator_resolver`` provided.

    Side effect (Phase T2): captures the caller's bearer token into a
    request-scoped ContextVar so ``_tenant_headers`` can forward it to
    coord for token-based authorization.

    Ordering invariant (Phase 2): the bearer capture runs BEFORE — and
    independent of — identity resolution, so the forwarded bearer survives
    even if resolution raises. Coord authorizes on the bearer, not on the
    web-returned tenant (``_tenant_headers`` no longer puts the tenant on
    the wire), so this capture must never be coupled to the resolver
    outcome.

    The returned UUID is retained for call-site compatibility (handlers
    still pass it to ``_proxy_coord_get(..., tenant_id=...)`` to trigger
    bearer forwarding) but no longer goes on the wire.
    """
    _caller_bearer.set(_extract_caller_token(request))
    _caller_active_tenant.set(request.headers.get(ACTIVE_TENANT_HEADER))
    identity = await get_coord_identity(request)
    if identity.home_tenant_id is None:
        raise HTTPException(status_code=403, detail="tenant_not_resolved")
    return identity.home_tenant_id


async def require_coord_tenant_admin(
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> UUID:
    """Resolve the user's coord home tenant AND require admin on it.

    Returns the home tenant_id. Raises 403 ``not_coord_tenant_admin`` when
    coord reports the operator is not an admin (``is_admin`` on
    ``/admin/coord/me``).

    Web-side gate posture (plan Phase 1 #4): the ``is_admin`` flag from
    coord is the source; the web-side gate is kept so the proxied
    settings-write route is not silently opened. Coord-side enforcement on
    the write route is a noted follow-up, not this PR.
    """
    active = request.headers.get(ACTIVE_TENANT_HEADER)
    _caller_bearer.set(_extract_caller_token(request))
    _caller_active_tenant.set(active)
    identity = await get_coord_identity(request)
    if identity.home_tenant_id is None:
        raise HTTPException(status_code=403, detail="tenant_not_resolved")
    # Admin is checked IN THE EFFECTIVE TENANT — the active selection when the
    # operator is a member of it, otherwise the home tenant — using the
    # PER-TENANT roles from `identity.tenants`, NOT a union across every tenant.
    # An operator who is Administrator of tenant A but only Developer of tenant
    # B is correctly denied admin writes after switching to B. (`is_admin`
    # remains a union and would wrongly pass.) This resolves web-side and does
    # not depend on coord re-scoping the top-level `roles`; coord re-validates
    # the override server-side too (defense-in-depth). qontinui superusers
    # (staff) keep full access.
    effective_roles = _effective_tenant_roles(identity, active)
    is_active_tenant_admin = "admin" in effective_roles
    if not is_active_tenant_admin and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="not_coord_tenant_admin")
    return identity.home_tenant_id


def _effective_tenant_roles(
    identity: CoordIdentity, active_tenant: str | None
) -> tuple[str, ...]:
    """Roles the operator holds in the EFFECTIVE tenant.

    The effective tenant is the active-switcher selection when the operator is
    a member of it, otherwise the home tenant. Returns that tenant's per-tenant
    ``roles`` from ``identity.tenants`` — never a union across all tenants. The
    selection header carries the tenant id (matched against ``tenant_id``); a
    slug is also accepted defensively. Falls back to the top-level
    ``identity.roles`` only when the membership list lacks the effective tenant
    (coord normally always includes home)."""
    selection = (active_tenant or "").strip()
    if selection:
        for t in identity.tenants:
            if str(t.tenant_id) == selection or t.slug == selection:
                return t.roles
    # No selection, or the selection is not a tenant the operator belongs to
    # → fall back to the home tenant's per-tenant roles.
    if identity.home_tenant_id is not None:
        for t in identity.tenants:
            if t.tenant_id == identity.home_tenant_id:
                return t.roles
    return identity.roles


def _effective_tenant_id(
    identity: CoordIdentity, active_tenant: str | None
) -> UUID | None:
    """The operator's EFFECTIVE tenant id: the active-switcher selection when
    the operator is a member of it (matched against ``identity.tenants`` by
    id, or slug defensively), else the home tenant.

    The WS bridges use this: a browser ``WebSocket`` cannot send the
    ``X-Qontinui-Active-Tenant`` header, so the selection rides a query
    param and is membership-validated here — mirroring coord's
    ``auth::apply_active_tenant_override`` (non-member selection degrades
    to home, never widens)."""
    selection = (active_tenant or "").strip()
    if selection:
        for t in identity.tenants:
            if str(t.tenant_id) == selection or t.slug == selection:
                return t.tenant_id
    return identity.home_tenant_id


def _tenant_headers(tenant_id: UUID | None) -> dict[str, str]:
    """Build the request-headers dict forwarded to coord.

    Phase T2b — forwards ONLY the caller's Cognito bearer
    (``Authorization: Bearer <token>``) when present. After T3 every caller
    presents a Cognito token and coord resolves the operator/tenant from it
    (the ``resolve_operator_optional`` middleware), so the legacy
    ``X-Qontinui-Tenant-Id`` email-bridge header is no longer sent. The
    ``tenant_id`` arg is retained for call-site compatibility (callers still
    resolve + pass it) but no longer goes on the wire — so ``None`` is
    accepted (the ``forward_bearer`` path forwards the bearer without a
    resolved tenant).
    """
    headers: dict[str, str] = {}
    token = _caller_bearer.get()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # Forward the dashboard tenant-switcher selection so coord re-scopes the
    # operator's context to the chosen tenant (membership-validated coord-side).
    active = _caller_active_tenant.get()
    if active:
        headers[ACTIVE_TENANT_HEADER] = active
    return headers


# ---- Cross-machine beacon (unauth, LAN-only — kept verbatim) -------------


@router.post("/heartbeat", response_model=RegisteredRunner)
async def runner_heartbeat(heartbeat: RunnerHeartbeat) -> RegisteredRunner:
    """Receive heartbeat from a runner (cross-machine beacon)."""
    registry = get_fleet_registry()
    runner = await registry.register_heartbeat(heartbeat)
    logger.debug(
        "runner_heartbeat",
        runner_id=runner.id,
        tasks=runner.running_task_count,
    )
    return runner


@router.post("/claude-sessions")
async def report_claude_sessions(report: ClaudeSessionReport) -> dict:
    """Receive Claude Code session report from a machine."""
    registry = get_fleet_registry()
    await registry.report_claude_sessions(report)
    return {
        "status": "ok",
        "hostname": report.hostname,
        "session_count": len(report.sessions),
    }


# ---- Operations dashboard endpoints (auth, user-scoped) ------------------


@router.get("/fleet")
async def get_fleet_status(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict[str, Any]:
    """Return the user's fleet (runners + cross-machine Claude sessions).

    Response shape:
        ``{ "runners": list[Runner], "claude_sessions": dict[hostname, list[ClaudeSession]],
        "total_runners": int, "total_healthy": int, "total_running_tasks": int,
        "total_claude_sessions": int }``

    The ``runners`` list uses the canonical wire shape (with
    ``derived_status``, ``ws_connected``, ...). The ``claude_sessions``
    section comes from the in-memory cross-machine fleet registry.

    The ``total_*`` aggregates feed the FleetOverview stat row
    (``frontend/src/components/operations/FleetOverview.tsx`` reads
    ``total_runners`` / ``total_healthy`` / ``total_running_tasks``):

    * ``total_runners`` — every runner in the merged list (DB-paired +
      heartbeat-only beacons).
    * ``total_healthy`` — merged-list entries whose ``derivedStatus`` is
      ``"healthy"`` (same staleness-gated derivation the list itself uses).
    * ``total_running_tasks`` — heartbeat-reported running-task counts from
      the beacon registry (no live fan-out to runners on this poll path;
      ``GET /fleet/tasks`` remains the live-fetch surface).
    """
    runners = await runner_crud.list_runners(db, current_user.id)
    wire_runners = [_runner_to_wire(r).model_dump(mode="json") for r in runners]

    registry = get_fleet_registry()
    fleet_status = await registry.get_fleet_status()

    # Merge heartbeat-only runners (not yet paired/registered in the DB)
    # so they appear on the Operations page alongside paired devices.
    #
    # SCOPING GUARD (cross-tenant leak fix): the fleet registry is a single
    # process-global dict and the POST /heartbeat beacon endpoint is
    # unauthenticated, so a beacon carries NO owner/tenant identity. Without a
    # guard, every authenticated caller saw — and had ``current_user.id``
    # stamped onto — every *other* tenant's beaconing runner. Restrict the
    # merge to beacons whose hostname matches a device this caller already
    # owns: a runner beaconing from a machine the caller has no paired device
    # on is not theirs to see. This is a hostname-match heuristic; the durable
    # fix is to stamp an authenticated owner on the heartbeat itself and scope
    # the registry by it (see follow-up bug note).
    db_keys = {(r.hostname, r.port) for r in runners}
    owned_hostnames = {r.hostname.lower() for r in runners if r.hostname}
    for beacon in fleet_status.runners:
        if (beacon.hostname, beacon.port) in db_keys:
            continue
        if not beacon.hostname or beacon.hostname.lower() not in owned_hostnames:
            # Beacon from a host this caller owns no device on → not theirs.
            continue
        wire_runners.append(
            {
                "id": beacon.id,
                "userId": str(current_user.id),
                "name": beacon.instance_name or "primary",
                "hostname": beacon.hostname,
                "ipAddress": beacon.ip,
                # None = runner predates the field (assume reachable);
                # False = the advertised LAN ip is loopback-bound/dead.
                "lanReachable": beacon.lan_reachable,
                "port": beacon.port,
                "os": beacon.os,
                "osVersion": beacon.os_version,
                "capabilities": [],
                "derivedStatus": "healthy" if beacon.is_healthy else "stale",
                "lastHeartbeat": beacon.last_heartbeat.isoformat(),
                "wsConnected": False,
                "uiError": None,
                "recentCrash": None,
                "createdAt": beacon.last_heartbeat.isoformat(),
            }
        )

    # Build per-hostname CI runner info from coord.devices rows that
    # have ci_runner_status set (Phase 4c self-hosted CI runners).
    ci_runners: dict[str, dict[str, Any]] = {}
    for device in runners:
        if device.ci_runner_status is not None and device.hostname:
            ci_runners[device.hostname] = {
                "status": device.ci_runner_status,
                "labels": list(device.ci_runner_labels or []),
                "lastJobAt": (
                    device.ci_runner_last_job_at.isoformat()
                    if device.ci_runner_last_job_at
                    else None
                ),
            }

    # Same cross-tenant guard as the runner merge above: claude-session reports
    # and the task/session totals come from the global registry keyed by
    # hostname, so restrict them to hostnames this caller owns a device on.
    # Otherwise the counts — and the session prompts/ids — leak across tenants.
    owned_claude_sessions = {
        hostname: [s.model_dump(mode="json") for s in sessions]
        for hostname, sessions in fleet_status.claude_sessions.items()
        if hostname and hostname.lower() in owned_hostnames
    }
    owned_running_tasks = sum(
        beacon.running_task_count
        for beacon in fleet_status.runners
        if beacon.hostname and beacon.hostname.lower() in owned_hostnames
    )

    # Per-user friendly machine display names (hostname -> name). Folded
    # into the fleet read so the frontend can render names without a
    # second round-trip; `{}` when the user has saved none.
    name_rows = await db.execute(
        select(MachineDisplayName.hostname, MachineDisplayName.name).where(
            MachineDisplayName.user_id == current_user.id
        )
    )
    machine_display_names: dict[str, str] = dict(name_rows.tuples().all())

    result: dict[str, Any] = {
        "runners": wire_runners,
        "claude_sessions": owned_claude_sessions,
        "total_runners": len(wire_runners),
        "total_healthy": sum(
            1 for r in wire_runners if r.get("derivedStatus") == "healthy"
        ),
        "total_running_tasks": owned_running_tasks,
        "total_claude_sessions": sum(len(s) for s in owned_claude_sessions.values()),
        "machine_display_names": machine_display_names,
    }

    if ci_runners:
        result["ci_runners"] = ci_runners

    return result


# Max length for a user-assigned machine display name. Trimmed names
# longer than this are rejected (the frontend should mirror this limit).
_MACHINE_NAME_MAX_LEN = 100


class MachineRenameRequest(BaseModel):
    """Body for ``PATCH /fleet/machines/{hostname}``.

    ``name`` is the desired friendly display name. A non-empty (after
    trim) string upserts the name; an empty/whitespace-only string or
    ``null`` clears it (reverting the machine to its raw hostname).
    """

    name: str | None = None


@router.patch("/fleet/machines/{hostname}")
async def rename_machine(
    hostname: str,
    body: MachineRenameRequest,
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict[str, Any]:
    """Set or clear the current user's friendly display name for a machine.

    * Non-empty ``name`` (after trim, max ``100`` chars): UPSERT the row
      for ``(current_user.id, hostname)``.
    * Empty/whitespace-only ``name`` or ``null``: DELETE the row (clearing
      reverts the machine to showing its raw hostname).

    The ``hostname`` need NOT exist in the fleet (a user may rename a
    machine that's briefly offline) — the name is stored regardless.

    Response: ``{ "hostname": <hostname>, "name": <name> | null }`` (``name``
    is ``null`` after a clear).
    """
    name = (body.name or "").strip()

    if not name:
        await db.execute(
            delete(MachineDisplayName).where(
                MachineDisplayName.user_id == current_user.id,
                MachineDisplayName.hostname == hostname,
            )
        )
        await db.commit()
        return {"hostname": hostname, "name": None}

    if len(name) > _MACHINE_NAME_MAX_LEN:
        raise HTTPException(
            status_code=422,
            detail=f"name must be at most {_MACHINE_NAME_MAX_LEN} characters",
        )

    stmt = (
        pg_insert(MachineDisplayName)
        .values(user_id=current_user.id, hostname=hostname, name=name)
        .on_conflict_do_update(
            index_elements=[
                MachineDisplayName.user_id,
                MachineDisplayName.hostname,
            ],
            set_={"name": name, "updated_at": datetime.now(UTC)},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"hostname": hostname, "name": name}


@router.get("/fleet/tasks", response_model=AggregatedTaskRuns)
async def get_all_tasks(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> AggregatedTaskRuns:
    """Get all running tasks across all runners (cross-machine beacon).

    Scoped to the caller's own devices: the fleet registry is process-global
    and the beacon path is unauthenticated, so tasks are filtered to runners
    on a hostname the caller owns a device on — the same cross-tenant guard
    applied by ``GET /fleet``. Without it, every caller saw every tenant's
    running-task prompts and ids.
    """
    runners = await runner_crud.list_runners(db, current_user.id)
    owned_hostnames = {r.hostname.lower() for r in runners if r.hostname}
    registry = get_fleet_registry()
    tasks = await registry.get_all_running_tasks()
    owned_tasks = [
        t for t in tasks if str(t.get("runner_hostname", "")).lower() in owned_hostnames
    ]
    return AggregatedTaskRuns(
        task_runs=[RunnerTaskRun(**t) for t in owned_tasks],
        total=len(owned_tasks),
    )


async def _caller_owns_runner_host(
    db: AsyncSession, user_id: Any, runner_id: str
) -> bool:
    """Whether the caller owns a device on the host encoded in ``runner_id``.

    Beacon runner ids are ``hostname:port`` and the fleet registry is a single
    process-global, unauthenticated store. The per-runner proxy/remove
    endpoints below must therefore verify the caller owns the target host
    before acting on it — otherwise any authenticated user could read another
    tenant's task output/workflow-state or delete their runner (cross-tenant
    IDOR). Returns False when the caller owns no device on that hostname.
    """
    host = runner_id.rsplit(":", 1)[0].lower()
    runners = await runner_crud.list_runners(db, user_id)
    return any((r.hostname or "").lower() == host for r in runners)


@router.get("/fleet/runners/{runner_id}/output")
async def get_runner_task_output(
    runner_id: str,
    task_run_id: str = Query(...),
    tail_chars: int = Query(default=5000),
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict:
    """Proxy to a specific runner to get task output."""
    if not await _caller_owns_runner_host(db, current_user.id, runner_id):
        raise HTTPException(
            status_code=404, detail=f"Runner {runner_id} not found or unreachable"
        )
    registry = get_fleet_registry()
    result = await registry.proxy_runner_request(
        runner_id,
        f"/task-runs/{task_run_id}/output",
        params={"tail_chars": tail_chars},
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Runner {runner_id} not found or unreachable",
        )
    return dict(result)


@router.get("/fleet/runners/{runner_id}/workflow-state")
async def get_runner_workflow_state(
    runner_id: str,
    task_run_id: str = Query(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict:
    """Proxy to a specific runner to get workflow state."""
    if not await _caller_owns_runner_host(db, current_user.id, runner_id):
        raise HTTPException(
            status_code=404, detail=f"Runner {runner_id} not found or unreachable"
        )
    registry = get_fleet_registry()
    result = await registry.proxy_runner_request(
        runner_id,
        f"/task-runs/{task_run_id}/workflow-state",
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Runner {runner_id} not found or unreachable",
        )
    return dict(result)


@router.delete("/fleet/runners/{runner_id}")
async def remove_runner(
    runner_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict:
    """Manually remove a runner from the cross-machine beacon registry."""
    if not await _caller_owns_runner_host(db, current_user.id, runner_id):
        raise HTTPException(status_code=404, detail=f"Runner {runner_id} not found")
    registry = get_fleet_registry()
    removed = await registry.remove_runner(runner_id)
    if not removed:
        raise HTTPException(
            status_code=404,
            detail=f"Runner {runner_id} not found",
        )
    return {"status": "removed", "runner_id": runner_id}


# ---- Coord merge-queue proxy (operations dashboard) ----------------------
#
# The Next.js frontend at `qontinui.io` renders the merge-train
# section on /operations.
# Coord lives at a different origin and has no CORS layer, so the
# browser can't reach coord directly. These endpoints proxy
# read-only merge state through the web backend, which already shares
# the user's auth context. No mutating coord routes are exposed —
# proposal creation / cancellation / land still go agent → coord
# directly, which is the right boundary.
#
# Per plans/2026-05-18-coordination-layer-demos.md §5.2.1.


async def _proxy_coord_get(
    path: str,
    *,
    params: dict[str, Any] | None = None,
    tenant_id: UUID | None = None,
    forward_bearer: bool = False,
    headers: dict[str, str] | None = None,
) -> Any:
    """Proxy a GET request to coord and return the JSON body.

    ``params`` is forwarded as the query string when set — the merge
    queue endpoint takes none, but the claims dashboard endpoints
    (Phase 5 of plan 2026-05-18-agent-spawn-coordination.md) take
    ``kind``, ``prefix``, ``limit``, ``since`` filters.

    ``tenant_id`` — when set, the caller's Cognito bearer is forwarded
    (via :func:`_tenant_headers`) so coord can authenticate the operator
    and scope its SQL. Tenant-scoped dashboard endpoints pass their
    resolved tenant. Fleet-wide endpoints (``/merge/queue``,
    ``/pr-merge/prs``) ALSO pass it now — not to scope (they stay
    fleet-wide) but to forward the bearer so coord requires an
    authenticated operator.

    NOTE: this kwarg puts NOTHING on the wire itself (the legacy
    ``X-Qontinui-Tenant-Id`` header was retired in fleet-auth T2b) — it
    only triggers bearer-forwarding. An endpoint that needs coord to
    *assert* the tenant (the claims read paths,
    plan 2026-05-24-symbol-claim-tenant-scoping) must ALSO put
    ``tenant_id`` in ``params`` so it rides the query string.

    ``forward_bearer`` — forward the captured caller bearer EVEN WHEN
    ``tenant_id is None``. The bearer/tenant coupling exists only because
    historically every proxy resolved a tenant first (which also captured
    the bearer). A fleet-wide endpoint that must keep forwarding the
    operator bearer while tolerating coord-down identity resolution (so
    total outage degrades to a banner rather than 502ing in the
    dependency, ``/admin-dev/overview``) sets this True and passes its
    best-effort ``tenant_id`` (possibly ``None``). Default False preserves
    the prior behavior exactly: no bearer is forwarded unless a tenant was
    resolved.

    ``headers`` — extra request headers merged ON TOP of the bearer/tenant
    headers (extra keys win on collision). Used by the onboarding
    precondition proxy to forward ``X-Qontinui-User-Id`` so coord can
    compute the caller's ``paired_elsewhere`` device list (plan
    2026-07-02-multi-tenant-device-pairing-reconsideration Phase 1b).
    Default ``None`` puts nothing extra on the wire.
    """
    url = f"{settings.COORD_URL}{path}"
    request_headers: dict[str, str] | None
    if tenant_id is not None or forward_bearer:
        request_headers = _tenant_headers(tenant_id)
    else:
        request_headers = None
    if headers:
        request_headers = {**(request_headers or {}), **headers}
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, params=params, headers=request_headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.get("/merge/queue")
async def get_merge_queue(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the in-flight merge proposals from coord (fleet-wide).

    Forwards the operator bearer so coord can require an authenticated
    operator — retires the pilot-anonymous posture (operator decision
    2026-05-31). The endpoint stays fleet-wide; ``tenant_id`` is resolved
    only to trigger bearer-forwarding, not to scope the query."""
    return await _proxy_coord_get("/merge/queue", tenant_id=tenant_id)


@router.get("/merge/{proposal_id}")
async def get_merge_proposal(
    proposal_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single merge proposal's detail from coord (fleet-wide;
    bearer forwarded so coord requires an authenticated operator)."""
    return await _proxy_coord_get(f"/merge/{proposal_id}", tenant_id=tenant_id)


@router.get("/pr-merge/prs")
async def get_pr_merge_prs(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """PR Merge Orchestrator Phase 1 D1.6 + D1.7 -- proxy coord's
    ``GET /pr-merge/prs`` (read-only list of all open PRs joined to
    per-(repo, head_sha) CI lifecycle).

    Fleet-wide. Forwards the operator bearer so coord requires an
    authenticated operator — retires the pilot-anonymous posture
    (operator decision 2026-05-31), mirroring ``/merge/queue``.
    """
    return await _proxy_coord_get("/pr-merge/prs", tenant_id=tenant_id)


@router.get("/migrations/queue")
async def get_migrations_queue(
    repo: str,
    terminal_limit: int = 5,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Proxy coord's ``GET /coord/migrations/queue?repo=<owner/repo>``.

    The coord-authoritative migration-reservation queue read-side: the
    ordered live set (``queued`` / ``pr_bound``, each carrying its 1-based
    ``position``) plus the last ``terminal_limit`` terminal rows. Backs the
    Operations dashboard's Migration Queue tile.

    ``repo`` is required — coord 400s without it, since the queue is
    per-repo. Fleet-wide read; ``tenant_id`` is resolved only to forward the
    operator bearer so coord requires an authenticated operator (same posture
    as ``/merge/queue`` and ``/pr-merge/prs``).
    """
    return await _proxy_coord_get(
        "/coord/migrations/queue",
        params={"repo": repo, "terminal_limit": terminal_limit},
        tenant_id=tenant_id,
    )


# ---- PR Merge Orchestrator Phase 2 D2.4 — per-tenant settings ------------
#
# Five endpoints, each tenant-scoped via ``get_tenant_id``. The
# ``X-Qontinui-Tenant-Id`` header propagates to coord; the coord-side
# TenantId extractor (``src/tenant_scope.rs``) parses it into a UUID
# and feeds every SELECT/UPDATE in ``src/pr_merge/settings_routes.rs``.
#
# Coord-side endpoints are anonymous (pilot posture, same as
# ``/pr-merge/prs``); the web side enforces authentication +
# tenant resolution before forwarding.


async def _proxy_coord_patch(
    path: str,
    body: Any,
    *,
    tenant_id: UUID | None = None,
) -> Any:
    """Proxy a PATCH request to coord. Returns the JSON body.

    Used by the PR Merge Orchestrator Phase 2 settings endpoints
    (``PATCH /pr-merge/settings`` + ``PATCH /pr-merge/repos/:repo/profile``).
    Same posture as ``_proxy_coord_post`` — tenant header,
    timeout/connect-error mapping. Sticking to the existing httpx
    pattern keeps the proxy footprint minimal.
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.patch(url, json=body, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


async def _proxy_coord_put(
    path: str,
    body: Any,
    *,
    tenant_id: UUID | None = None,
) -> Any:
    """Proxy a PUT request to coord. Returns the JSON body.

    Clone of ``_proxy_coord_patch`` for HTTP PUT semantics. Used by the
    decision-engine next-step-settings endpoint (§5.3 of plan
    ``2026-05-30-decision-engine-tenant-ui.md``) where coord expects a
    full-replacement PUT rather than a partial PATCH. Same posture:
    tenant header, timeout/connect-error mapping.
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.put(url, json=body, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@router.get("/pr-merge/settings")
async def get_pr_merge_settings(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Tenant-scoped read of the per-tenant merge settings. Returns the
    resolved EffectiveProfile (global → tenant tier, no per-repo
    overrides applied)."""
    return await _proxy_coord_get("/pr-merge/settings", tenant_id=tenant_id)


@router.patch("/pr-merge/settings")
async def patch_pr_merge_settings(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """UPSERT the tenant-level merge settings. Coord audits the change
    + publishes a Redis pubsub invalidation. Returns the post-write
    EffectiveProfile."""
    return await _proxy_coord_patch("/pr-merge/settings", body, tenant_id=tenant_id)


@router.get("/pr-merge/repos")
async def get_pr_merge_repos(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List the tenant's repos with framework-signal chips +
    profile_source provenance. Drives the per-repo override-card list
    on the Merge Orchestration → Settings page."""
    return await _proxy_coord_get("/pr-merge/repos", tenant_id=tenant_id)


# ---- Runner "clone from GitHub" — reuse the tenant's GitHub App install ----
#
# The runner's setup wizard lets a user clone one of their GitHub repos during
# onboarding, reusing the GitHub App connection they already made (NOT a local
# `gh` login or a pasted PAT). Both endpoints are thin proxies to new coord
# routes (coord owns the App private key); ``get_tenant_id`` resolves the
# operator from the runner's forwarded Cognito bearer and coord scopes to that
# tenant's bound installation(s).


class CloneCredentialRequest(BaseModel):
    """Body for ``POST /operations/github/clone-credential`` — the ``owner/name``
    of the repo the runner wants a scoped clone token for."""

    repo: str


@router.get("/github/repos")
async def get_github_installation_repos(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List repositories the caller's connected GitHub App installation(s) can
    access, for the runner setup-wizard clone picker. Proxies coord
    ``GET /coord/onboarding/installations/repositories``. Returns
    ``{connected: bool, repos: [...]}`` — ``connected: false`` (with an empty
    list) when the tenant hasn't installed the GitHub App yet, so the runner can
    show a "connect your GitHub org" CTA instead of an error."""
    return await _proxy_coord_get(
        "/coord/onboarding/installations/repositories", tenant_id=tenant_id
    )


@router.post("/github/clone-credential")
async def post_github_clone_credential(
    body: CloneCredentialRequest,
    tenant_id: UUID = Depends(get_tenant_id),
) -> JSONResponse:
    """Mint a repo-scoped, short-TTL, contents:read clone token for a single
    repo. Proxies coord ``POST /coord/onboarding/installations/clone-credential``.

    Passes coord's status + JSON body through verbatim (like the onboarding
    claim proxy) so the runner sees a clean ``403 repo_owner_not_connected`` when
    the repo's owner isn't a GitHub account connected to the caller's workspace.
    """
    url = f"{settings.COORD_URL}/coord/onboarding/installations/clone-credential"
    headers = _tenant_headers(tenant_id)
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.post(url, json={"repo": body.repo}, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(status_code=502, detail="coord is not reachable")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="timeout waiting for coord")
    try:
        content = resp.json()
    except ValueError:
        content = {"detail": resp.text}
    return JSONResponse(content=content, status_code=resp.status_code)


@router.get("/pr-merge/repos/{repo:path}/profile")
async def get_pr_merge_repo_profile(
    repo: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Resolved per-(tenant, repo) settings — three-tier
    (global → tenant → repo) layered. The ``repo`` is the
    ``owner/name`` form; the ``:path`` converter lets FastAPI accept
    the ``/`` inline without URL-encoding."""
    return await _proxy_coord_get(
        f"/pr-merge/repos/{repo}/profile", tenant_id=tenant_id
    )


@router.patch("/pr-merge/repos/{repo:path}/profile")
async def patch_pr_merge_repo_profile(
    repo: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """UPSERT the per-repo override row. Coord stamps
    ``profile_source='user_edit'``, audits the change, and publishes
    invalidation. Returns the post-write EffectiveProfile."""
    return await _proxy_coord_patch(
        f"/pr-merge/repos/{repo}/profile", body, tenant_id=tenant_id
    )


@router.get("/pr-merge/graph")
async def get_pr_merge_graph(
    repo: str,
    pr: int,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """PR Merge Orchestrator Phase 5 D5.2 — cross-repo dependency
    graph for a PR's connected component, tenant-scoped.

    Coord returns ``{nodes, edges, topo_order, cycle_detected,
    cycle_members}`` — the frontend renders this as a DAG via dagre
    + the `@xyflow/react` workspace dep already present in
    ``frontend/package.json``.

    Cross-tenant edges are never traversed coord-side; the
    ``X-Qontinui-Tenant-Id`` header injected here is what enforces
    scoping. Two tenants viewing the same repo see disjoint graphs
    in the v1 one-repo-one-tenant model.
    """
    return await _proxy_coord_get(
        "/pr-merge/graph",
        params={"repo": repo, "pr": pr},
        tenant_id=tenant_id,
    )


# ---- Coordination-transparency: gate-decision reads ----------------------
#
# Plan 2026-06-07-coordination-transparency-surfaces.md T2 — surface the
# blast-radius merge gate's *decisions* (held PRs + reason + evidence +
# coverage) to the affected developer, not just to operators. These two
# proxies back the "Gate decisions" section of MergeTrain.
#
# Auth: ``get_tenant_id`` (ANY authenticated tenant member), deliberately
# NOT ``require_coord_tenant_admin``. The whole point of the transparency
# surface is that the developer whose PR was held can see *why* — coverage,
# the removed export, and who references it — without needing operator
# rights. These are read-only reads. Coord resolves the tenant from the
# forwarded Cognito bearer (``_tenant_headers``) and scopes its SQL via the
# ``TenantId`` extractor, exactly like the sibling read routes above.


@router.get("/pr-merge/blast-radius-blocks")
async def get_pr_merge_blast_radius_blocks(
    repo: str | None = None,
    limit: int = 50,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Tenant-scoped list of recent blast-radius gate blocks.

    Proxies coord's ``GET /pr-merge/blast-radius-blocks``
    (``pr_merge/blast_radius_monitor.rs::list_blocks``). Each row carries
    the PR identity, the ``BlockReason`` ``code`` (e.g.
    ``removes-referenced-export``), the per-reason evidence payload
    (removed export ``name``/``file`` + the ``referenced_by [{file,line}]``
    list), the ``coverage``/``graph_available`` honesty fields, and the
    resulting outer-state. Optional ``repo`` (``owner/name``) + ``limit``
    filters are forwarded.

    Read-only + ``get_tenant_id``-gated (any tenant member) so the affected
    developer — not only an operator — can see why their PR was held.
    """
    params: dict[str, Any] = {"limit": limit}
    if repo is not None:
        params["repo"] = repo
    return await _proxy_coord_get(
        "/pr-merge/blast-radius-blocks",
        params=params,
        tenant_id=tenant_id,
    )


@router.get("/pr-merge/decisions/{owner}/{name}/{pr}")
async def get_pr_merge_decisions(
    owner: str,
    name: str,
    pr: int,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Tenant-scoped decision history for a single PR.

    Proxies coord's ``GET /pr-merge/decisions/:owner/:name/:pr``
    (``specialist_query::get_decisions``) — the per-PR gate-evaluation
    trail (verdict, block reason, coverage/graph-availability). Backs the
    deep-link from a PR's check run / the gate-decisions row into the
    detail view.

    ``get_tenant_id``-gated (any tenant member, read-only): the affected
    developer sees their own PR's decision trail. Coord scopes the query to
    the bearer's tenant.
    """
    return await _proxy_coord_get(
        f"/pr-merge/decisions/{owner}/{name}/{pr}",
        tenant_id=tenant_id,
    )


# ---- PR Merge Orchestrator Phase 8 D8.0 + D8.2 + D8.3 — onboarding --------
#
# Five proxies. precondition-status drives the wizard's polling loop on
# step 2 ("Sign into Claude Code"); audit dispatches the repo-auditor
# (async, returns 202); audit-status is polled for the STARTER_PROFILE;
# accept persists the (possibly hand-edited) profile; profile-callback is
# the auditor-agent's write-back surface.


@router.get("/pr-merge/onboarding/precondition-status")
async def get_pr_merge_onboarding_precondition(
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return ``{paired, claude_code_available, ready, paired_elsewhere}``
    for the calling tenant. Drives the onboarding wizard's polling loop on
    step 2 (the "Sign into Claude Code on your device" verification step).

    ``X-Qontinui-User-Id`` is forwarded (same attribution header as the
    pair paths in ``devices.py``) so coord can compute
    ``paired_elsewhere`` — devices the CALLING USER has paired to a
    DIFFERENT tenant, which a re-pair here would silently steal. Older
    coord ignores the header and omits the field; the wizard treats a
    missing ``paired_elsewhere`` as ``[]`` (plan
    2026-07-02-multi-tenant-device-pairing-reconsideration Phase 1b).
    """
    return await _proxy_coord_get(
        "/pr-merge/onboarding/precondition-status",
        tenant_id=tenant_id,
        headers={"X-Qontinui-User-Id": str(current_user.id)},
    )


@router.post("/pr-merge/onboarding/audit")
async def post_pr_merge_onboarding_audit(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> JSONResponse:
    """Dispatch the repo-auditor subagent for the named repo (async).

    Coord now fire-and-forgets the auditor and immediately returns
    ``202 {agent_id, repo, status: "running"}`` — the browser polls
    ``/pr-merge/onboarding/audit-status`` for the STARTER_PROFILE instead of
    blocking the connection for the audit's (multi-minute) duration. On a
    precondition miss (no audit-capable device) coord returns 409 with body
    ``{"error": "no_audit_capable_device", "next_step": "pair_device"}`` —
    the dashboard surfaces this as a redirect back to the pairing wizard.

    The proxy MUST pass coord's status code through: a bare JSON return would
    be wrapped by FastAPI as ``200``, hiding the 202/running contract from
    the browser. ``return_status=True`` surfaces ``(body, status)`` so we can
    echo coord's 202 verbatim. Uses the default 5s timeout (the POST is now
    fast — the slow audit work happens off-connection).
    """
    coord_body, status_code = await _proxy_coord_post(
        "/pr-merge/onboarding/audit",
        body,
        tenant_id=tenant_id,
        return_status=True,
    )
    return JSONResponse(content=coord_body, status_code=status_code)


@router.get("/pr-merge/onboarding/audit-status")
async def get_pr_merge_onboarding_audit_status(
    agent_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Poll the async repo-audit's status for the given ``agent_id``.

    Coord runs ``poll_starter_profile_once(agent_id)`` once (stateless, no DB
    writes) and returns ``{status: "running", agent_id}`` until the auditor
    subagent writes back its STARTER_PROFILE, then
    ``{status: "ready", agent_id, starter_profile, audit_confidence}`` (or
    ``{status: "failed", agent_id, error}`` on a terminal error). The wizard
    polls this every ~4s after receiving the 202 from the audit POST.
    """
    return await _proxy_coord_get(
        "/pr-merge/onboarding/audit-status",
        params={"agent_id": agent_id},
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/onboarding/accept")
async def post_pr_merge_onboarding_accept(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """UPSERT ``coord.tenant_repo_profiles`` with
    ``profile_source='audit'`` + the (possibly hand-edited) starter
    profile. Stamps ``coord.operator_audit`` + publishes settings cache
    invalidation.
    """
    return await _proxy_coord_post(
        "/pr-merge/onboarding/accept",
        body,
        tenant_id=tenant_id,
    )


# ---- Zero-touch onboarding doctor (P4 status page) ------------------------
#
# Coord's upstream path for the onboarding-doctor read. Kept in ONE constant
# so a coord-side path choice (`/coord/onboarding/doctor` was the alternate
# spelling under discussion) is a one-line fix here.
COORD_ONBOARDING_DOCTOR_PATH = "/pr-merge/onboarding/doctor"

# `owner/name` — exactly one slash, both segments non-empty and drawn from
# GitHub's slug alphabet. Rejects path traversal / query smuggling before the
# value rides coord's query string.
_OWNER_REPO_RE = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9._-]*)/[A-Za-z0-9](?:[A-Za-z0-9._-]*)$"
)


@router.get("/pr-merge/onboarding/doctor")
async def get_pr_merge_onboarding_doctor(
    repo: str = Query(..., description="Repository as owner/name."),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Zero-touch onboarding checklist for one repo (tenant-scoped).

    Proxies coord's onboarding doctor (path in
    :data:`COORD_ONBOARDING_DOCTOR_PATH`). Response envelope (frozen
    contract, P4 zero-touch onboarding):

    ``{"repo": "owner/name", "checks": [{"id", "label", "status",
    "detail", "remediation"}], "summary": {"pass", "warn", "fail",
    "skip", "ready_to_land"}}``

    with the fixed 8-check vocabulary ``tenant_mapped / repo_enrolled /
    profile_present / rollout_state / config_yaml / bootstrap_pr /
    ci_workflow / ruleset_bypass`` and ``status`` in
    ``pass|warn|fail|skip``. Backs the ``/admin/coord/onboarding-status``
    page (the GitHub App's post-install Setup URL target). Operator
    bearer forwarded; coord scopes by the bearer's tenant.
    """
    if not _OWNER_REPO_RE.match(repo):
        raise HTTPException(
            status_code=422,
            detail="repo must be in owner/name form",
        )
    return await _proxy_coord_get(
        COORD_ONBOARDING_DOCTOR_PATH,
        params={"repo": repo},
        tenant_id=tenant_id,
    )


# ---- Zero-touch onboarding: connected GitHub accounts summary -------------
#
# The account-level read backing the onboarding-status page's "Connected
# organizations" summary (the bare visit — no ``?code``, no ``?repo``). Coord
# returns every GitHub account bound to the operator's tenant with its enrolled
# repos (``rollout_state`` + ``profile_source`` per repo), so a freshly-connected
# org with an empty ``repos`` list reads as success ("connected · no repositories
# enrolled yet") rather than a dead end. Kept in one constant so a coord-side
# path change is a one-line fix here.
COORD_ONBOARDING_ACCOUNTS_PATH = "/coord/onboarding/github-accounts"


@router.get("/pr-merge/onboarding/accounts")
async def get_pr_merge_onboarding_accounts(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List the GitHub accounts connected to the caller's tenant (+ enrolled repos).

    Proxies coord's ``GET /coord/onboarding/github-accounts`` (TenantId-gated).
    Response envelope (coord-owned):

    ``{"accounts": [{"account_login", "account_type", "installation_id",
    "repos": [{"repo", "rollout_state", "profile_source"}]}]}``

    (``repos`` may be ``[]`` for a freshly-connected org; ``rollout_state`` /
    ``profile_source`` may be null.) Reuses the onboarding-doctor proxy's auth
    exactly: ``get_tenant_id`` resolves the operator and captures the caller's
    bearer, which ``_tenant_headers`` forwards so coord scopes the read to the
    operator's own tenant. ``_proxy_coord_get`` passes coord's status code
    through (a coord 4xx/5xx re-raises as an ``HTTPException`` with the same
    status).
    """
    return await _proxy_coord_get(COORD_ONBOARDING_ACCOUNTS_PATH, tenant_id=tenant_id)


# ---- Zero-touch onboarding claim (Setup-URL OAuth code exchange) ----------
#
# The browser is redirected here post-install by GitHub's App Setup URL with
# ``?code=&installation_id=&setup_action=install``. The onboarding-status page
# POSTs the ``code`` + ``installation_id`` to this proxy, which forwards to
# coord's ``POST /coord/onboarding/github-accounts/claim`` (coord PR #901).
# Coord runs the GitHub OAuth code-exchange, verifies the operator administers
# the installation's org, binds the account to the operator's Cognito tenant,
# and enrolls the installation's repos. Coord returns
# ``{ok, account_login, installation_id, tenant_id, enrolled}`` on success.
#
# This proxy uses the SAME operator auth + tenant/bearer propagation as the
# doctor GET above (``get_tenant_id`` → bearer forwarded via ``_tenant_headers``)
# so coord scopes the bind to the operator's own tenant. It PASSES coord's
# status code + JSON body straight through — a 403 ``installation_not_
# administered`` / 409 ``account_already_bound`` / 400 ``code_exchange_failed``
# / 500 ``oauth_not_configured`` must surface to the browser with its own
# status so the page can render the right message, NOT be collapsed to 500.
COORD_ONBOARDING_CLAIM_PATH = "/coord/onboarding/github-accounts/claim"


class OnboardingClaimRequest(BaseModel):
    """Body for ``POST /pr-merge/onboarding/claim``.

    ``code`` — the short-lived GitHub OAuth code from the Setup-URL redirect.
    ``installation_id`` — the GitHub App installation id from the same
    redirect. Both are echoed verbatim to coord's claim endpoint.
    """

    code: str
    installation_id: int


@router.post("/pr-merge/onboarding/claim")
async def post_pr_merge_onboarding_claim(
    body: OnboardingClaimRequest,
    tenant_id: UUID = Depends(get_tenant_id),
) -> JSONResponse:
    """Self-serve onboarding: exchange the GitHub OAuth code + bind/enroll.

    Proxies coord's ``POST /coord/onboarding/github-accounts/claim`` (coord
    PR #901). Reuses the doctor proxy's auth exactly: ``get_tenant_id``
    resolves the operator and captures the caller's bearer, which
    ``_tenant_headers`` forwards to coord so coord binds the GitHub account
    to the operator's own Cognito tenant.

    Unlike the raising ``_proxy_coord_post`` helper (which collapses a coord
    4xx/5xx into an ``HTTPException`` whose body is a stringified ``detail``),
    this handler passes coord's status code AND JSON body through verbatim so
    the onboarding-status page can render a status-specific message:
    ``400 code_exchange_failed`` / ``403 installation_not_administered`` /
    ``409 account_already_bound`` / ``500 oauth_not_configured``. httpx
    transport errors mirror the shared helpers (ConnectError → 502,
    TimeoutException → 504).
    """
    url = f"{settings.COORD_URL}{COORD_ONBOARDING_CLAIM_PATH}"
    headers = _tenant_headers(tenant_id)
    payload = {"code": body.code, "installation_id": body.installation_id}
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.post(url, json=payload, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    # Pass coord's status code + JSON body straight through. Fall back to a
    # wrapped raw body if coord ever returns a non-JSON payload.
    try:
        content = resp.json()
    except ValueError:
        content = {"detail": resp.text}
    return JSONResponse(content=content, status_code=resp.status_code)


# ---- Coord device pairing — Step 1 of the onboarding wizard -------------
#
# The wizard's Pair Device step (``MergeOrchestrationOnboarding.tsx``,
# ``startPairing``) fires this route. Coord's ``POST /coord/devices/pair-start``
# (``qontinui-coord/src/routes_phase3.rs::post_pair_start``) is a PUBLIC
# route whose ``PairStartRequest`` struct (line 1013) requires ``tenant_id``
# in the BODY at deserialization time. Per coord's own doc comment at line
# 1031, the web-backend proxy is the enforcement point: it must resolve the
# operator's home tenant from the authenticated bearer chain and inject it
# into the body BEFORE forwarding, so the frontend never has to know or
# pass the tenant_id. This is the only existing operations proxy that
# mutates the body instead of forwarding it verbatim.
#
# Note: there is intentionally NO ``pair-complete`` proxy. The device-side
# ``qontinui_profile device pair`` CLI calls coord's ``pair-complete``
# directly over coord's public HTTP boundary; the wizard never invokes it.


@router.post("/coord/devices/pair-start")
async def post_coord_devices_pair_start(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Proxy POST /coord/devices/pair-start with server-injected tenant_id.

    Coord's pair-start is a public route whose PairStartRequest requires
    tenant_id in the body (routes_phase3.rs:1035). The web proxy is the
    enforcement point: it resolves the operator's home tenant via
    get_tenant_id and injects it into the body before forwarding, so the
    frontend never has to know or pass the tenant_id.
    """
    body["tenant_id"] = str(tenant_id)
    return await _proxy_coord_post(
        "/coord/devices/pair-start",
        body,
        tenant_id=tenant_id,
    )


# ---- PR Merge Orchestrator Phase 8 D8.6 — Suggestions inbox ------------


@router.get("/pr-merge/suggestions")
async def get_pr_merge_suggestions(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List pending drift-suggestion + audit-stale alerts for the
    calling tenant. Drives the MergeTrain "Suggestions" section.
    """
    return await _proxy_coord_get(
        "/pr-merge/suggestions",
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/suggestions/{alert_id}/accept")
async def post_pr_merge_suggestion_accept(
    alert_id: int,
    body: dict[str, Any] | None = None,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Apply the suggestion's ``proposed_diff`` to settings + resolve
    the alert + write a ``drift_suggestion_accepted`` user_override
    row (closes the feedback loop).
    """
    return await _proxy_coord_post(
        f"/pr-merge/suggestions/{alert_id}/accept",
        body or {},
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/suggestions/{alert_id}/reject")
async def post_pr_merge_suggestion_reject(
    alert_id: int,
    body: dict[str, Any] | None = None,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Resolve the alert with ``resolution_action='rejected'`` + write
    a ``drift_suggestion_rejected`` user_override row (signal: don't
    re-propose this kind for N days).
    """
    return await _proxy_coord_post(
        f"/pr-merge/suggestions/{alert_id}/reject",
        body or {},
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/suggestions/{alert_id}/mute")
async def post_pr_merge_suggestion_mute(
    alert_id: int,
    body: dict[str, Any] | None = None,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Mute the suggestion kind for ``body.days`` days (default 30).
    Stored in ``coord.tenant_merge_settings.suggestion_mutes`` JSONB.
    """
    return await _proxy_coord_post(
        f"/pr-merge/suggestions/{alert_id}/mute",
        body or {},
        tenant_id=tenant_id,
    )


# ---- Phase 9 D9.4 + D9.6 — rollout substrate proxies ----------------------
#
# Two endpoints proxying the coord-side ``src/pr_merge/rollout_routes.rs``
# (kill-switch) + ``src/pr_merge/slo_routes.rs`` (SLO dashboard). Both
# tenant-scoped via the ``X-Qontinui-Tenant-Id`` header.


@router.post("/pr-merge/kill-switch")
async def post_pr_merge_kill_switch(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Emergency-stop: flip the calling tenant's rollout_state to
    ``dry_run``. Body shape::

        {
            "scope": "tenant" | "repo:<owner/name>",
            "reason": "<operator's stated reason>"
        }

    Coord:
    1. Verifies the tenant owns the repo (when scope=repo).
    2. UPDATE ``coord.tenant_merge_settings.rollout_state='dry_run'``
       (scope=tenant) or ``coord.tenant_repo_profiles.rollout_state=
       'dry_run'`` (scope=repo).
    3. Invalidates the settings cache (process-local + Redis pubsub).
    4. INSERTs a ``coord.user_overrides(override_kind=
       'kill_switch_activated')`` row.
    5. INSERTs a ``coord.alerts(kind='kill_switch_fired',
       severity='warning')`` row.
    6. Stamps ``auth_sso::audit_mutation``.

    Returns ``{ "scope", "previous_state", "new_state", "affected_repos" }``.
    """
    return await _proxy_coord_post(
        "/pr-merge/kill-switch",
        body,
        tenant_id=tenant_id,
    )


@router.post("/pr-merge/rollout")
async def post_pr_merge_rollout(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Rollout promote — set the tenant's (or a specific repo's)
    rollout_state to an arbitrary target. Body shape::

        {
            "scope": "tenant" | "repo:<owner/name>",
            "state": "dry_run" | "shadow" | "live",
            "reason": "<operator's stated reason>",
            "force": false
        }

    The promote counterpart to the kill-switch's downward-only flip.
    Coord:
    1. Verifies the tenant owns the repo (when scope=repo).
    2. UPSERTs the per-tenant or per-repo ``rollout_state`` (a
       never-configured repo is created rather than no-op'd).
    3. Requires the current resolved state to be ``shadow`` when
       promoting to ``live`` unless ``force=true``.
    4. Invalidates the settings cache + writes a
       ``coord.user_overrides(override_kind='rollout_promote')`` audit
       row.

    Coord additionally rejects non-interactive bearers on this mutation
    (``403 non_interactive_write_forbidden``) — the promote is reserved
    for a logged-in dashboard session, which is exactly what this proxy
    forwards.

    Returns ``{ "scope", "state", "affected_repos" }``.
    """
    return await _proxy_coord_post(
        "/pr-merge/rollout",
        body,
        tenant_id=tenant_id,
    )


@router.get("/pr-merge/slo")
async def get_pr_merge_slo(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Per-tenant SLO dashboard — per-(tenant, repo) metrics over the
    last 7/30 days.

    Returns ``{ "tenant_id", "repos": [...], "kill_switch_history_last_30d":
    [...], "generated_at" }`` where each repo carries
    ``current_rollout_state`` + 7/30 day windows of
    ``auto_merge_success_rate``, ``escalation_rate``,
    ``operator_override_rate``, ``shadow_vs_live_agreement_rate``,
    ``total_decisions``, ``shadow_decisions``.

    Drives MergeOrchestrationSettings.tsx's SLO Dashboard section.
    """
    return await _proxy_coord_get(
        "/pr-merge/slo",
        tenant_id=tenant_id,
    )


async def _proxy_coord_post(
    path: str,
    body: Any,
    *,
    tenant_id: UUID | None = None,
    timeout: httpx.Timeout | None = None,
    return_status: bool = False,
) -> Any:
    """Proxy a POST request to coord and return the JSON body.

    ``tenant_id`` — see ``_proxy_coord_get``.
    ``timeout`` — optional per-route override. Defaults to ``_COORD_TIMEOUT``
    (5s) which is appropriate for short JSON-from-PG endpoints. Endpoints
    that dispatch device-side work (e.g., onboarding audit) must pass an
    explicit longer timeout that outlasts coord's own in-handler deadline.
    ``return_status`` — when True, return ``(json_body, status_code)`` instead
    of just the JSON body, so the caller can surface coord's status code to
    the browser (e.g. the async onboarding audit returns ``202`` and the
    proxy must pass that through — FastAPI would otherwise wrap the bare JSON
    body as ``200``). Coord 4xx/5xx still raise ``HTTPException`` either way;
    this only distinguishes the <400 success codes. Default False preserves
    the prior behavior exactly (returns just the JSON body).
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=timeout or _COORD_TIMEOUT) as client:
        try:
            resp = await client.post(url, json=body, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    if return_status:
        return resp.json(), resp.status_code
    return resp.json()


@router.post("/agents/allocate")
async def post_agents_allocate(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Proxy `POST /agents/allocate` to coord.

    Used by the demo-control page (§5.2.3 of the coordination-layer
    demo plan) to spawn agents on PC + MSI with one click. Body
    shape matches coord's `AllocateRequest` (machine_id, repos,
    optional intent). Coord's response — including the agent's JWT
    — passes through; the operator's browser doesn't consume the
    JWT itself, but the receiving runner picks up the allocation
    via the `events.agent.allocated` event coord fans out.

    fleet-auth P2/D6: forwards the operator bearer (via ``get_tenant_id``
    → ``tenant_id=``), mirroring the sibling ``/agents/spawn`` proxy.
    """
    return await _proxy_coord_post("/agents/allocate", body, tenant_id=tenant_id)


# ---- Coord claims-dashboard proxy ---------------------------------------
#
# Plan `2026-05-18-agent-spawn-coordination.md` Phase 5 — the
# `/admin/agent-claims` dashboard backend. Five read-only proxy
# endpoints that forward to coord:
#
# - `/operations/claims/list`             → coord `/coord/claims/list`
# - `/operations/claims/recent-conflicts` → coord `/coord/claims/recent-conflicts`
# - `/operations/claims/recent-expirations` → coord `/coord/claims/recent-expirations`
# - `/operations/claims/steals`           → coord `/coord/claims/steals`
# - `/operations/claims/alerts`           → coord `/coord/alerts` (filtered)
#
# Same proxy posture as the merge endpoints above — read-only, no
# mutating coord routes exposed through this surface. Steal +
# acquire stay agent → coord directly (correct auth boundary).


@router.get("/claims/list")
async def get_claims_list(
    kind: str,
    prefix: str = "",
    limit: int | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List active claims by kind + resource_key prefix, tenant-scoped.

    Coord's ``/coord/claims/list`` tenant-scopes optionally (plan
    2026-05-24-symbol-claim-tenant-scoping, qontinui-coord#528): the
    forwarded operator bearer (``tenant_id=`` kwarg → fleet-auth P2/D6)
    already derives the scope server-side; the explicit ``tenant_id``
    QUERY param on top makes coord assert param == bearer home tenant,
    so a web bug forwarding the wrong tenant is rejected 403 instead of
    silently widening the view. Mirrors the symbol-claims proxy (#559).
    """
    params: dict[str, Any] = {
        "kind": kind,
        "prefix": prefix,
        "tenant_id": str(tenant_id),
    }
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/claims/list", params=params, tenant_id=tenant_id
    )


# ---- Coord agent-status proxy (coord-native MCP coordination surface) ----
#
# Plan `coord-native-coordination-mcp` Phase 2 (dashboard-render half).
# Proxies coord's `GET /coord/agent-status` — the work-unit-grain agent
# status read backed by `coord.agent_status` (the MCP coordination surface
# `coord_report_status` / `coord_orient` write into this table). The
# operator dashboard renders it as a *dual-read*: it prefers these
# structured rows and falls back to `/claims/list` metadata when the tenant
# has no agent_status rows yet (cutover robustness).
#
# Tenant scope differs from coord's claims proxy: coord's /coord/agent-status
# reads `tenant_id` as a *query param* (the table's tenant_id is NOT NULL),
# not the `X-Qontinui-Tenant-Id` header. We resolve the caller's tenant via
# `get_tenant_id` and forward it as the query param.


@router.get("/agent-status")
async def get_agent_status(
    correlation_topic: str | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """List active (non-expired) agent_status rows for the caller's tenant.

    Optional ``correlation_topic`` narrows to a single topic. The response
    envelope mirrors coord: ``{"agents": [...], "count": N}``.
    """
    # coord derives the tenant from the forwarded Cognito bearer
    # (fail-closed `OperatorContext`); we no longer send the
    # web-computed tenant_id param. The bearer is forwarded by passing
    # ``tenant_id=`` to ``_proxy_coord_get`` (triggers ``_tenant_headers``,
    # which emits only ``Authorization: Bearer``).
    params: dict[str, Any] = {}
    if correlation_topic is not None:
        params["correlation_topic"] = correlation_topic
    return await _proxy_coord_get(
        "/coord/agent-status", params=params or None, tenant_id=tenant_id
    )


# ---- Coord gates-dashboard proxy ------------------------------------------
#
# Plan `2026-05-18-agent-spawn-coordination.md` Phase 5 — first-class
# gates dashboard. Three proxy endpoints:
#
# - GET  /operations/gates/list              → coord `/coord/gates`
# - POST /operations/gates/{gate_id}/approve → coord `/coord/gates/{gate_id}/approve`
# - POST /operations/gates/{gate_id}/reject  → coord `/coord/gates/{gate_id}/reject`


@router.get("/gates/list")
async def get_gates_list(
    verdict: str | None = None,
    claim_kind: str | None = None,
    resource_key: str | None = None,
    limit: int | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List gates, optionally filtered by verdict.

    Forwards the operator bearer (fleet-auth P2/D6)."""
    params: dict[str, Any] = {}
    if verdict is not None:
        params["verdict"] = verdict
    if claim_kind is not None:
        params["claim_kind"] = claim_kind
    if resource_key is not None:
        params["resource_key"] = resource_key
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get("/coord/gates", params=params, tenant_id=tenant_id)


@router.post("/gates/{gate_id}/approve")
async def approve_gate(
    gate_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Approve an OperatorApproval gate (operator bearer forwarded —
    fleet-auth P2/D6)."""
    return await _proxy_coord_post(
        f"/coord/gates/{gate_id}/approve", {}, tenant_id=tenant_id
    )


@router.post("/gates/{gate_id}/reopen")
async def reopen_gate(
    gate_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Reopen a cleared/failed gate by server-side cloning it into a new open
    gate (undo-by-reopen; operator bearer forwarded — fleet-auth P2/D6).

    Mirrors the approve proxy exactly: tenant derived server-side by coord's
    ``TenantId`` extractor from the forwarded bearer — never a client-supplied
    tenant. The coord route ``POST /coord/gates/{id}/reopen`` lands in the
    parallel coord PR; proxying to a not-yet-deployed route is fine — the
    upstream error passes through."""
    return await _proxy_coord_post(
        f"/coord/gates/{gate_id}/reopen", {}, tenant_id=tenant_id
    )


@router.post("/gates/{gate_id}/reject")
async def reject_gate(
    gate_id: str,
    reason: str | None = None,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Reject an OperatorApproval gate (operator bearer forwarded —
    fleet-auth P2/D6)."""
    body: dict[str, Any] = {}
    if reason:
        body["reason"] = reason
    return await _proxy_coord_post(
        f"/coord/gates/{gate_id}/reject", body, tenant_id=tenant_id
    )


# Mute / snooze are the gates panel's reversible "quiet this gate" actions
# (plan 2026-06-05-plan-gate-web-surface-and-productization, Phase 2). They
# mirror the approve/reject proxies' shape exactly: operator bearer forwarded
# via ``get_tenant_id`` → ``tenant_id=`` (fleet-auth P2/D6), tenant derived
# server-side by coord's ``TenantId`` extractor from that bearer — NEVER a
# client-supplied tenant_id. The coord routes
# (``POST /coord/gates/{id}/mute``·``/unmute``·``/snooze``) land in the
# parallel coord PR ``feat/gate-observation-predicates``; proxying to a
# not-yet-deployed route is fine — the upstream error passes through.


@router.post("/gates/{gate_id}/mute")
async def mute_gate(
    gate_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Mute a gate so the sweep skips it (reversible — operator bearer
    forwarded, fleet-auth P2/D6)."""
    return await _proxy_coord_post(
        f"/coord/gates/{gate_id}/mute", {}, tenant_id=tenant_id
    )


@router.post("/gates/{gate_id}/unmute")
async def unmute_gate(
    gate_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Unmute a previously-muted gate (operator bearer forwarded —
    fleet-auth P2/D6)."""
    return await _proxy_coord_post(
        f"/coord/gates/{gate_id}/unmute", {}, tenant_id=tenant_id
    )


@router.post("/gates/{gate_id}/snooze")
async def snooze_gate(
    gate_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Snooze a gate until ``body["until"]`` (rfc3339) — the sweep skips it
    while ``snoozed_until`` is in the future (reversible; operator bearer
    forwarded, fleet-auth P2/D6).

    The ``until`` field is forwarded verbatim to coord, which owns
    validation of the timestamp."""
    snooze_body: dict[str, Any] = {}
    until = body.get("until")
    if until is not None:
        snooze_body["until"] = until
    return await _proxy_coord_post(
        f"/coord/gates/{gate_id}/snooze", snooze_body, tenant_id=tenant_id
    )


@router.get("/claims/recent-conflicts")
async def get_recent_conflicts(
    limit: int | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the recent-conflicts ring buffer from coord (operator
    bearer forwarded — fleet-auth P2/D6)."""
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/claims/recent-conflicts", params=params, tenant_id=tenant_id
    )


@router.get("/claims/recent-expirations")
async def get_recent_expirations(
    limit: int | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the recent-expirations ring buffer from coord (operator
    bearer forwarded — fleet-auth P2/D6)."""
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/claims/recent-expirations", params=params, tenant_id=tenant_id
    )


@router.get("/claims/steals")
async def get_claims_steals(
    since: str | None = None,
    limit: int | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return recent admin_stolen audit rows from coord (operator bearer
    forwarded — fleet-auth P2/D6)."""
    params: dict[str, Any] = {}
    if since is not None:
        params["since"] = since
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/claims/steals", params=params, tenant_id=tenant_id
    )


@router.get("/claims/alerts")
async def get_claims_alerts(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return active claim-related alerts from coord.

    Filters the coord ``/coord/alerts`` response to rows whose
    ``alert_key`` starts with ``claim-`` (the convention used by
    [`claims_alert_watcher`](https://github.com/qontinui/qontinui-coord/blob/main/src/claims_alert_watcher.rs)).
    Other alert kinds (fleet-health, alembic-status, etc.) stay scoped
    to the Operations page's general alerts surface.

    Forwards the operator bearer (fleet-auth P2/D6).
    """
    payload = await _proxy_coord_get("/coord/alerts", tenant_id=tenant_id)
    # coord returns either a list or `{"alerts": [...]}` depending on
    # the version; tolerate both.
    if isinstance(payload, dict) and "alerts" in payload:
        rows = payload["alerts"]
        is_dict = True
    elif isinstance(payload, list):
        rows = payload
        is_dict = False
    else:
        return payload
    filtered = [
        a
        for a in rows
        if isinstance(a, dict) and str(a.get("alert_key", "")).startswith("claim-")
    ]
    if is_dict:
        return {"alerts": filtered}
    return filtered


# ---- Coord dev-action ledger proxy ----------------------------------------
#
# Plan ``2026-06-07-twin-dev-event-cause-effect-ledger.md``. Surfaces the
# dev-action ledger (`coord.dev_action_snapshots`) on the operator/fleet
# dashboard. Two read-only proxies mirroring the claims-proxy posture:
#
# - GET /operations/dev-actions/recent       → coord `/coord/dev-actions/recent`
# - GET /operations/dev-actions/{action_id}  → coord `/coord/dev-actions/{id}`
#
# The coord routes are public (no auth) in the pilot, but we still depend on
# ``get_tenant_id`` to forward the operator bearer — same posture as the
# symbol-claims / gates proxies. This keeps the dashboard surface
# consistently authenticated web-side and lets coord scope by the bearer's
# tenant once it gates these routes, without a wire-shape change here.


@router.get("/dev-actions/recent")
async def get_dev_actions_recent(
    limit: int | None = None,
    kind: str | None = None,
    device_id: str | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List recent dev actions from coord's ledger.

    Forwards ``limit`` / ``kind`` / ``device_id`` filters verbatim. The
    response envelope mirrors coord: ``{"actions": [...], "count": N}``.
    Operator bearer forwarded (consistent with the other dashboard
    proxies); coord owns the actual scoping.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if kind is not None:
        params["kind"] = kind
    if device_id is not None:
        params["device_id"] = device_id
    return await _proxy_coord_get(
        "/coord/dev-actions/recent", params=params or None, tenant_id=tenant_id
    )


@router.get("/dev-actions/{action_id}")
async def get_dev_action_detail(
    action_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single dev action + its outcome signatures from coord.

    Response shape mirrors coord:
    ``{"action": {...}, "outcomes": [{"signature", "observed_at", "late"}]}``.
    Operator bearer forwarded (consistent with the recent-list proxy).
    """
    return await _proxy_coord_get(
        f"/coord/dev-actions/{action_id}", tenant_id=tenant_id
    )


# ---- Coord readiness dashboard proxy (Wave 2 — tenant-scoped) ------------
#
# Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 2. Adds
# the browser-side operator console at ``/admin/coord/*``. ALL endpoints
# in this section are tenant-scoped via ``get_tenant_id`` (resolves
# the current user's coord operator row → home tenant_id, injects
# ``X-Qontinui-Tenant-Id`` on the coord call so coord-side handlers
# filter every SQL query). Replaces the prior ``require_admin`` gate;
# the dashboard is now usable by any authenticated qontinui user against
# their own tenant. The operator-management surfaces (when they land at
# ``/admin/coord/operators/*`` + ``/admin/coord/audit/*``) keep a separate
# admin-role gate — they're qontinui-staff fleet-wide views, not the
# user-scoped dashboard.
#
# Routes (read-only unless noted):
#
# - GET    /operations/plans                            — list coord.work_units
# - GET    /operations/plans/{slug}                      — single work-unit
# - GET    /operations/plans/{slug}/history              — status history
# - POST   /operations/plans/{slug}/transition           — set work-unit status
# - GET    /operations/trees/by-device/{device_id}       — primary trees
# - GET    /operations/trees/contention                  — overlap view
# - GET    /operations/alerts                            — full alert rollup
# - GET    /operations/fleet/health                      — fleet rollup
# - GET    /operations/agent-questions/pending           — Wave-3 prep
# - GET    /operations/agent-questions/{id}              — Wave-3a single lookup
# - GET    /operations/agent-questions/by-session/{sid}  — Wave-3a by-session
# - POST   /operations/agent-questions/{id}/respond      — Wave-3 prep
# - GET    /operations/agent-logs/by-agent/{agent_id}    — Wave-3 prep
# - GET    /operations/agent-logs/by-session/{session_id} — Wave 3b
# - GET    /operations/agent-logs/recent                 — Wave 3b
# - GET    /operations/memory/list                       — Wave-3 prep
# - GET    /operations/memory/{name}                     — Wave-3 prep
# - GET    /operations/memory/{name}/version/{version}    — Wave-3c
# - POST   /operations/memory/upsert                      — Wave-3c
# - DELETE /operations/memory/{name}                      — Wave-3c (soft-delete)
# - POST   /operations/memory/{name}/restore              — Wave-3c


# ---- Plans (now backed by coord.work_units — the generic work-unit
# primitive that GENERALIZES the retired coord.plans registry) ------------
#
# The operator UX is still "Plans" (operators author markdown plans), but
# coord stores them as generic, slug-keyed work-units (``coord.work_units``
# + ``coord.work_unit_status_history``). These web routes keep their
# ``/plans*`` paths so the frontend API client doesn't churn; only the
# coord UPSTREAM path moves to the operator-readable ``/coord/work-units*``
# surface (operator TenantId/Cognito auth — same bearer forwarding).


@router.get("/plans")
async def list_coord_plans(
    status: str | None = Query(default=None, description="Filter by status."),
    limit: int | None = Query(default=None, ge=1, le=500),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List work-units from coord (tenant-scoped).

    Proxies coord ``GET /coord/work-units``; the response envelope is
    ``{"work_units": [...], "limit": N, "offset": N}``.
    """
    params: dict[str, Any] = {}
    if status is not None:
        params["status"] = status
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/work-units", params=params or None, tenant_id=tenant_id
    )


@router.get("/plans/{slug}")
async def get_coord_plan(
    slug: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single work-unit from coord (tenant-scoped).

    Proxies coord ``GET /coord/work-units/{slug}``; the response envelope
    is ``{"work_unit": {...}, "recent_history": [...]}``.
    """
    return await _proxy_coord_get(f"/coord/work-units/{slug}", tenant_id=tenant_id)


@router.get("/plans/{slug}/history")
async def get_coord_plan_history(
    slug: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the status-transition history for a work-unit (tenant-scoped).

    Proxies coord ``GET /coord/work-units/{slug}/history``.
    """
    return await _proxy_coord_get(
        f"/coord/work-units/{slug}/history", tenant_id=tenant_id
    )


@router.post("/plans/{slug}/transition")
async def post_coord_plan_transition(
    slug: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Transition a work-unit to a new status (tenant-scoped, admin-gated).

    The dashboard sends ``{"status": "<new>", "note": "<optional>"}``. The
    coord ``POST /coord/work-units/{slug}/operator-transition`` route expects
    ``{"to_status": "<new>", "by_actor": "<who>", "reason": "<optional>"}``
    (``to_status`` + ``by_actor`` both required, non-empty) — the SAME wire
    shape the retired ``/coord/plans/{slug}/transition`` used. Remap the
    operator-friendly body onto that contract here so the dashboard control
    stays unchanged. ``by_actor`` is stamped with the operator marker (this
    surface is an admin lever audited via the history ``by_actor`` column).
    """
    to_status = body.get("status") or body.get("to_status")
    # `by_actor` is sent for compatibility with the currently-deployed coord,
    # whose operator-transition still requires a non-empty body actor. A coord
    # follow-up (work-units audit-actor fix) derives the actor server-side from
    # the authenticated operator and IGNORES this field; once that is deployed
    # this line can be dropped.
    transition_body: dict[str, Any] = {
        "to_status": to_status,
        "by_actor": body.get("by_actor") or "operator:web-admin",
    }
    note = body.get("note") if body.get("note") is not None else body.get("reason")
    if note is not None:
        transition_body["reason"] = note
    from_status = body.get("from_status")
    if from_status is not None:
        transition_body["from_status"] = from_status
    return await _proxy_coord_post(
        f"/coord/work-units/{slug}/operator-transition",
        transition_body,
        tenant_id=tenant_id,
    )


# ---- Primary trees (Phase 1 substrate) -----------------------------------


@router.get("/trees/by-device/{device_id}")
async def get_trees_by_device(
    device_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return primary-tree rows for a device (tenant-scoped)."""
    return await _proxy_coord_get(
        f"/coord/trees/by-device/{device_id}", tenant_id=tenant_id
    )


@router.get("/trees/contention")
async def get_trees_contention(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return primary-tree contention view across the fleet (tenant-scoped)."""
    return await _proxy_coord_get("/coord/trees/contention", tenant_id=tenant_id)


# ---- Pull-decision audit feed (repo_pull domain) -------------------------
#
# Plan ``2026-05-30-coord-pull-decision-ui.md`` Phase 2 (Feature A). Verbatim
# proxy of coord's ``GET /coord/policies/resolutions`` filtered to the
# ``repo_pull`` decision domain — the audit feed for the autonomous
# "is now a safe moment to pull origin/main?" judgment. Coord parses each
# ``coord.policy_rule_resolutions`` row into a clean ``PullDecisionRow`` DTO
# server-side, so this proxy forwards the JSON untouched (same posture as
# ``get_trees_by_device``). Tenant-scoped: coord derives the tenant from the
# forwarded Cognito bearer (post-T2b — no ``X-Qontinui-Tenant-Id`` header).


@router.get("/coord/pull-decisions")
async def get_pull_decisions(
    device_id: str | None = Query(default=None),
    repo: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=500),
    since: str | None = Query(default=None),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the ``repo_pull`` decision audit feed from coord (tenant-scoped).

    Forwards to coord's ``GET /coord/policies/resolutions`` with
    ``decision_domain=repo_pull`` always pinned, plus the optional
    ``device_id`` / ``repo`` / ``limit`` / ``since`` filters. Drives the
    ``/admin/coord/pull-decisions`` activity page.
    """
    params: dict[str, Any] = {"decision_domain": "repo_pull"}
    if device_id:
        params["device_id"] = device_id
    if repo:
        params["repo"] = repo
    if limit:
        params["limit"] = limit
    if since:
        params["since"] = since
    return await _proxy_coord_get(
        "/coord/policies/resolutions", tenant_id=tenant_id, params=params
    )


# ---- Alerts (full rollup; sibling of /claims/alerts) ---------------------


@router.get("/alerts")
async def get_coord_alerts(
    include_resolved: bool = Query(default=False),
    severity: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the full ``coord.alerts`` rollup with optional filters.

    Sibling of ``/operations/claims/alerts`` (which filters to
    ``alert_key`` prefix ``claim-``). This endpoint exposes ALL alert
    kinds (claim / conflict / stale_wip / health) for the dashboard's
    Alerts page. Tenant-scoped — the underlying ``coord.alerts`` rollup
    is fleet-wide today but the tenant header lets coord-side enforcement
    filter once the alert producer stamps a tenant_id per row.
    """
    params: dict[str, Any] = {"include_resolved": include_resolved}
    if severity is not None:
        params["severity"] = severity
    if kind is not None:
        params["kind"] = kind
    return await _proxy_coord_get("/coord/alerts", params=params, tenant_id=tenant_id)


# ---- Fleet health --------------------------------------------------------


@router.get("/fleet/health")
async def get_fleet_health(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the fleet-health rollup from coord (tenant-scoped)."""
    return await _proxy_coord_get("/coord/fleet/health", tenant_id=tenant_id)


# ---- Wave-3 prep (decision queue + agent-logs + memory) ------------------
#
# These endpoints are added now so the Wave-3 frontend (decision queue
# inbox, per-agent log tail, memory browser) doesn't need to re-touch
# operations.py. Backed by the Phase 3/5/6 coord routes — the substrate
# is shipped; the operator UI for them lands in Wave-3.


@router.get("/agent-questions/pending")
async def get_pending_agent_questions(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return pending agent questions awaiting an operator response."""
    return await _proxy_coord_get("/coord/agent-questions/pending", tenant_id=tenant_id)


@router.get("/agent-questions/answered")
async def get_answered_agent_questions(
    limit: int | None = Query(default=None, ge=1, le=500),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return recently-answered agent questions.

    Wave 3a — surfaces the "answered" tab on the questions inbox so
    operators can audit prior decisions without leaving the page.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        "/coord/agent-questions/answered",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/agent-questions/by-session/{session_id}")
async def get_agent_questions_by_session(
    session_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return all questions tied to a single ``agent_session_id``.

    Cross-link target from ``/admin/agent-sessions/{session_id}``. Returns
    pending + answered rows so the session-lineage view can show the
    operator-decision arm in line with the other UNION arms.
    """
    return await _proxy_coord_get(
        f"/coord/agent-questions/by-session/{session_id}", tenant_id=tenant_id
    )


@router.get("/agent-questions/{question_id}")
async def get_agent_question(
    question_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single agent-question row (pending or answered).

    Backs the ``/admin/coord/questions/[id]`` detail page so the operator
    can render the full question + context + options without first
    fetching the pending list.
    """
    return await _proxy_coord_get(
        f"/coord/agent-questions/{question_id}", tenant_id=tenant_id
    )


@router.post("/agent-questions/{question_id}/respond")
async def post_agent_question_response(
    question_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """A tenant member (Developer or Administrator) answers an agent question.

    Intentionally NOT admin-gated: a Developer must be able to answer their
    own running agent's questions. Coord scopes the respond route to the
    caller's tenant, so this stays within the shared account.
    """
    return await _proxy_coord_post(
        f"/coord/agent-questions/{question_id}/respond",
        body,
        tenant_id=tenant_id,
    )


@router.get("/agent-logs/by-agent/{agent_id}")
async def get_agent_logs_by_agent(
    agent_id: str,
    limit: int | None = Query(default=None, ge=1, le=2000),
    since: str | None = Query(default=None),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return ``coord.agent_logs`` rows for a single agent_id."""
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if since is not None:
        params["since"] = since
    return await _proxy_coord_get(
        f"/coord/agent-logs/by-agent/{agent_id}",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/agent-logs/by-session/{session_id}")
async def get_agent_logs_by_session(
    session_id: str,
    limit: int | None = Query(default=None, ge=1, le=2000),
    since: str | None = Query(default=None),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return ``coord.agent_logs`` rows for a single agent_session_id.

    Wave 3b — backs the per-agent live view's cross-link to the
    session-lineage page. Coord routes the request to its
    ``/coord/agent-logs/by-session/{session_id}`` handler, which selects
    on the ``agent_session_id`` column rather than ``agent_id``.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if since is not None:
        params["since"] = since
    return await _proxy_coord_get(
        f"/coord/agent-logs/by-session/{session_id}",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/agent-logs/recent")
async def get_agent_logs_recent(
    limit: int | None = Query(default=None, ge=1, le=2000),
    since: str | None = Query(default=None),
    level: str | None = Query(default=None, description="Filter by min level."),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the fleet-wide recent agent_logs timeline.

    Wave 3b — backs the ``/admin/coord/agents`` landing timeline.
    Optional ``level`` filters to a minimum severity (trace/debug/info/
    warn/error). Coord owns the ordering + level-rollup semantics; this
    endpoint is a transparent proxy.
    """
    params: dict[str, Any] = {}
    if limit is not None:
        params["limit"] = limit
    if since is not None:
        params["since"] = since
    if level is not None:
        params["level"] = level
    return await _proxy_coord_get(
        "/coord/agent-logs/recent",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/memory/list")
async def get_memory_list(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List entries from the canonical memory substrate."""
    return await _proxy_coord_get("/coord/memory/list", tenant_id=tenant_id)


@router.get("/memory/{name}")
async def get_memory_entry(
    name: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single memory entry (latest version) by name."""
    return await _proxy_coord_get(f"/coord/memory/{name}", tenant_id=tenant_id)


# ---- Wave 4 — Spawn-from-Plan ---------------------------------------------
#
# Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 4 (Wave 4).
# The operator authoring path: pick a plan + phase, pick a device, pick
# repos + intent + declared_overlap_paths, write an initial prompt, hit
# Submit. Coord owns claim acquisition + agent allocation + first-tick
# prompt delivery; this surface is a thin proxy.
#
# Sibling of ``POST /agents/allocate`` (Wave 0 demo-control path). The
# spawn route is admin-gated because it mints a coord agent and pins
# device state; allocate stays user-auth (legacy demo entrypoint).
#
# Wire shape (request):
#   ``{ "plan_slug": str, "plan_phase": str, "device_id": str,
#       "repos": list[str], "intent": str,
#       "declared_overlap_paths": list[str] | None,
#       "initial_prompt": str }``
#
# Wire shape (response): coord's spawn payload passes through — at
# minimum ``{ "agent_id": str, "agent_session_id": str, ...}``.


@router.post("/agents/spawn")
async def post_agents_spawn(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Proxy ``POST /agents/spawn`` to coord (Wave 4 spawn-from-plan).

    Operator-driven spawn from the ``/admin/coord/spawn`` page. Coord
    handles claim acquisition, device pinning, agent JWT mint, and
    first-tick initial-prompt delivery. The browser doesn't consume
    the agent JWT directly — the receiving runner picks up the new
    agent through the ``events.agent.spawned`` event coord publishes.
    """
    return await _proxy_coord_post("/agents/spawn", body, tenant_id=tenant_id)


@router.get("/agents/{agent_id}")
async def get_agent(
    agent_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single spawned agent's status row from coord.

    Backs the spawn-confirmation surface so the operator can see
    "spawn succeeded; agent X is now allocated to device Y" without
    leaving the page. Read-only — mutating routes (steal, kill, ...)
    stay agent→coord direct.
    """
    return await _proxy_coord_get(f"/agents/{agent_id}", tenant_id=tenant_id)


# ---- Wave-3c memory browser (mutation surface) ---------------------------
#
# Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 6.
# Resolved decision Q3 — event-sourced LWW with full version history.
# Resolved decision Q8 — dual-write + 30-day reversible window
# (coord is the canonical store, per-machine FS is the backup).
#
# All endpoints below mutate or read historical memory state and are
# admin-gated.


async def _proxy_coord_delete(
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: Any | None = None,
    tenant_id: UUID | None = None,
) -> Any:
    """Proxy a DELETE request to coord and return the JSON body.

    Mirrors ``_proxy_coord_get`` / ``_proxy_coord_post`` for the
    tombstone-soft-delete path (coord retains the row + version history;
    DELETE only sets a tombstone marker per Q3's event-sourced shape).

    ``params`` is forwarded as the query string when set.

    ``body`` — when set, a JSON body is sent on the DELETE (coord's
    ``DELETE /admin/coord/operators/{id}/roles`` and
    ``DELETE /admin/coord/group-tenant-roles`` both take a JSON body
    naming the role to remove). ``httpx`` supports a body on DELETE via
    ``client.request("DELETE", ..., json=body)``; ``client.delete`` does
    not accept ``json=``, so this branches. The bearer header is attached
    on both paths.
    """
    url = f"{settings.COORD_URL}{path}"
    headers = _tenant_headers(tenant_id) if tenant_id is not None else None
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            if body is not None:
                resp = await client.request(
                    "DELETE", url, params=params, json=body, headers=headers
                )
            else:
                resp = await client.delete(url, params=params, headers=headers)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="coord is not reachable",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="timeout waiting for coord",
            )
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    # Coord may return 204 No Content for delete; tolerate empty bodies.
    if resp.status_code == 204 or not resp.content:
        return {"status": "ok"}
    return resp.json()


@router.get("/memory/{name}/version/{version}")
async def get_memory_version(
    name: str,
    version: int,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a specific historical version of a memory entry.

    Per Q3, every write appends an immutable new version row; the
    dashboard's version-history dropdown drives this endpoint to render
    older content (read-only).
    """
    return await _proxy_coord_get(
        f"/coord/memory/{name}/version/{version}", tenant_id=tenant_id
    )


@router.post("/memory/upsert")
async def post_memory_upsert(
    body: MemoryUpsertRequest,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Upsert a memory entry (creates a new immutable version row).

    Body shape (coord): ``{"name", "content", "type"?, "description"?,
    "written_by_agent"?, "written_by_device"?}``. Coord stamps the
    monotonic version number + ``written_at``. Validated against the
    canonical wire-format schema
    (`qontinui_schemas.generated.per_type.memory_upsert_request`)
    promoted in plan
    ``2026-05-22-memories-on-coord-cross-machine.md`` Phase 6.
    """
    return await _proxy_coord_post(
        "/coord/memory/upsert",
        body.model_dump(exclude_none=True),
        tenant_id=tenant_id,
    )


@router.delete("/memory/{name}")
async def delete_memory_entry(
    name: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Soft-delete (tombstone) a memory entry.

    Per Q3 the row + version history is retained; coord only sets a
    tombstone marker so reads filter the entry out but ``restore`` can
    revive it.
    """
    return await _proxy_coord_delete(f"/coord/memory/{name}", tenant_id=tenant_id)


@router.post("/memory/{name}/restore")
async def post_memory_restore(
    name: str,
    body: MemoryRestoreRequest,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Restore a memory entry to a previous version.

    Body shape: ``{"version": <int>, "written_by_agent"?, "written_by_device"?}``.
    Coord copies the selected version's content into a fresh write (new
    version number), so the history line stays append-only. Validated
    against the canonical wire-format schema
    (`qontinui_schemas.generated.per_type.memory_restore_request`).
    """
    return await _proxy_coord_post(
        f"/coord/memory/{name}/restore",
        body.model_dump(exclude_none=True),
        tenant_id=tenant_id,
    )


# ---- Memory federation reports proxy ------------------------------------
#
# Plan `2026-05-22-memories-on-coord-cross-machine.md` Phase 2 — the
# `/admin/coord/federation` dashboard backend. Two read-only proxy
# endpoints that forward to coord:
#
# - `/operations/federation/reports`           → coord `/coord/federation/reports`
# - `/operations/federation/reports/{report_id}` → coord `/coord/federation/reports/{report_id}`
#
# Reports are submitted by the runner's memory bridge directly to coord;
# these proxies only serve the dashboard read path.


@router.get("/federation/reports")
async def get_federation_reports(
    device_id: UUID | None = None,
    session_id: UUID | None = None,
    has_failures: bool | None = None,
    since: str | None = None,
    limit: int = Query(default=50, le=200),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List memory federation reports from coord (paginated, filterable)."""
    params: dict[str, str] = {}
    if device_id:
        params["device_id"] = str(device_id)
    if session_id:
        params["session_id"] = str(session_id)
    if has_failures is not None:
        params["has_failures"] = str(has_failures).lower()
    if since:
        params["since"] = since
    params["limit"] = str(limit)
    return await _proxy_coord_get(
        "/coord/federation/reports", tenant_id=tenant_id, params=params
    )


@router.get("/federation/reports/{report_id}")
async def get_federation_report_detail(
    report_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Single memory federation report detail from coord."""
    return await _proxy_coord_get(
        f"/coord/federation/reports/{report_id}", tenant_id=tenant_id
    )


# ---- GitOp federation feed proxy ----------------------------------------
#
# Plan `2026-05-24-federation-verify-and-gitop.md` Phase 7 — the
# `/admin/coord/git-ops` dashboard backend. Three read-only proxy
# endpoints that forward to coord's git-ops feed:
#
# - `/operations/git-ops/list`                  → coord `/coord/git-ops/list`
# - `/operations/git-ops/by-session/{session_id}` → coord `/coord/git-ops/by-session/{session_id}`
# - `/operations/git-ops/branches`              → coord `/coord/git-ops/branches`
#
# Git ops (commit/checkout/branch_create/merge/rebase/push/…) are
# observed by the runner's GitOpBridge (notify-watch + the pre-push hook)
# and submitted to coord directly; these proxies only serve the
# dashboard read path. Tenant resolution + the `X-Qontinui-Tenant-Id`
# header forwarding are identical to the memory-federation block above —
# `get_tenant_id` resolves the caller's tenant and `_proxy_coord_get`
# injects the header so coord scopes every SQL query on `coord.git_ops`.


@router.get("/git-ops/list")
async def get_git_ops_list(
    repo: str | None = None,
    branch: str | None = None,
    since: str | None = None,
    limit: int = Query(default=50, le=200),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List GitOp records from coord (paginated, filterable).

    Forwards the optional ``repo`` / ``branch`` / ``since`` filters and
    the ``limit`` cap to coord, which scopes the query to the caller's
    tenant via the injected ``X-Qontinui-Tenant-Id`` header.
    """
    params: dict[str, str] = {}
    if repo:
        params["repo"] = repo
    if branch:
        params["branch"] = branch
    if since:
        params["since"] = since
    params["limit"] = str(limit)
    return await _proxy_coord_get(
        "/coord/git-ops/list", tenant_id=tenant_id, params=params
    )


@router.get("/git-ops/by-session/{session_id}")
async def get_git_ops_by_session(
    session_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the GitOp records for a single runner session from coord."""
    return await _proxy_coord_get(
        f"/coord/git-ops/by-session/{session_id}", tenant_id=tenant_id
    )


@router.get("/git-ops/branches")
async def get_git_ops_branches(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the current branch-per-device summary from coord."""
    return await _proxy_coord_get("/coord/git-ops/branches", tenant_id=tenant_id)


# ---- Push/Land effect-signatures proxy ----------------------------------
#
# Plan `2026-05-31-push-land-action-effect-signatures-plan.md` Phase 4 —
# the `/admin/coord/lands` operator dashboard backend. Three read-only
# proxy endpoints that forward to coord's land-signatures surface:
#
# - `/operations/lands`           → coord `/coord/lands`           (recent declared lands + verifications)
# - `/operations/lands/preview`   → coord `/coord/lands/preview`   (pre-land PredictedLandEffect + risk verdict)
# - `/operations/lands/precision` → coord `/coord/lands/precision` (per-dimension TP/FP/TN/FN + precision/recall)
#
# Land signatures are declared/verified entirely server-side by the merge
# scheduler + cascade observer; these proxies only serve the dashboard
# read path. The operator bearer is forwarded (via `_proxy_coord_get`'s
# `tenant_id` → `_tenant_headers`) so coord requires an authenticated
# operator, mirroring the merge-queue posture above. Coord's own 404
# (PR not found) and 422 (bad params) status codes pass straight through
# `_proxy_coord_get` so the dashboard can render them as inline messages.


@router.get("/lands")
async def get_lands(
    repo: str | None = None,
    limit: int = Query(default=25, le=200),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List recent declared lands + their verifications from coord.

    Forwards the optional ``repo`` filter and ``limit`` cap to coord."""
    params: dict[str, str] = {}
    if repo:
        params["repo"] = repo
    params["limit"] = str(limit)
    return await _proxy_coord_get("/coord/lands", tenant_id=tenant_id, params=params)


@router.get("/lands/preview")
async def get_lands_preview(
    repo: str,
    pr: int,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the pre-land PredictedLandEffect + risk verdict for a PR.

    ``repo`` (owner/name) and ``pr`` (PR number) are required. Coord
    returns 422 on bad params and 404 when the PR is not found; both
    propagate through ``_proxy_coord_get`` unchanged."""
    return await _proxy_coord_get(
        "/coord/lands/preview",
        tenant_id=tenant_id,
        params={"repo": repo, "pr": str(pr)},
    )


@router.get("/lands/verifications")
async def get_lands_verifications(
    correlation_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return composed cross-repo restack verifications for a correlation.

    ``correlation_id`` (the cascade correlation UUID) is required. Coord
    returns 422 on bad params; it propagates through ``_proxy_coord_get``
    unchanged. The empty case is ``{"composed":{"repo_count":0,...},
    "repos":[]}``."""
    return await _proxy_coord_get(
        "/coord/restacks/verifications",
        tenant_id=tenant_id,
        params={"correlation_id": str(correlation_id)},
    )


@router.get("/lands/precision")
async def get_lands_precision(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return per-dimension land-predictor precision/recall from coord."""
    return await _proxy_coord_get("/coord/lands/precision", tenant_id=tenant_id)


# ---- Deploy effect-signatures proxy --------------------------------------
#
# Plan `2026-05-31-deploy-action-effect-signatures` — the
# `/admin/coord/deploys` operator dashboard backend. Three read-only proxy
# endpoints forwarding to coord's deploy-signatures surface:
#
# - `/operations/deploys`                          → coord `/coord/deploys`
# - `/operations/deploys/{id}`                     → coord `/coord/deploys/{id}`
# - `/operations/deploys/{id}/rollback-proposal`   → coord `/coord/deploys/{id}/rollback-proposal`
#
# Deploy signatures are declared/verified by the CI deploy pipelines
# (deploy-coord.yml / deploy-web.yml §3.6 wiring); these proxies only serve
# the dashboard read path. Coord's deploy read routes are
# FleetPrincipal-gated (operator OIDC bearer or device-JWT, fail-closed
# 403) — the forwarded operator bearer (`_tenant_headers`) IS the
# credential, exactly the lands posture above. Coord's 404 (signature not
# found / no rollback-justified verification) passes straight through so
# the dashboard renders it as an inline message.


@router.get("/deploys")
async def get_deploys(
    service: str | None = None,
    environment: str | None = None,
    limit: int = Query(default=25, le=200),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List recent declared deploys + their latest verification from coord.

    Forwards the optional ``service`` / ``environment`` filters and the
    ``limit`` cap to coord."""
    params: dict[str, str] = {"limit": str(limit)}
    if service:
        params["service"] = service
    if environment:
        params["environment"] = environment
    return await _proxy_coord_get("/coord/deploys", tenant_id=tenant_id, params=params)


@router.get("/deploys/{deploy_id}")
async def get_deploy(
    deploy_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single deploy signature + its latest verification."""
    return await _proxy_coord_get(f"/coord/deploys/{deploy_id}", tenant_id=tenant_id)


@router.get("/deploys/{deploy_id}/rollback-proposal")
async def get_deploy_rollback_proposal(
    deploy_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return coord's rollback proposal for a failed deploy signature.

    Coord 404s unless the latest verification is a settled hard terminal
    with a clean, targeted rollback — the dashboard renders the 404 as an
    honest "no rollback proposed" message."""
    return await _proxy_coord_get(
        f"/coord/deploys/{deploy_id}/rollback-proposal", tenant_id=tenant_id
    )


# ---- Symbol-claims surface (Phase 4.4) ----------------------------------
#
# Plan: `D:/qontinui-root/plans/2026-05-21-coordination-improvements.md`
# Phase 4.4. Drives the "currently editing" sub-line on each
# `MachineCard`. The tree-sitter `symbol_watcher` daemon (Phase 4.1,
# qontinui-supervisor) posts `ClaimKind::Symbol` claims as agents edit
# local files; coord stores them in Redis with a 300s default TTL.
#
# This endpoint is a thin proxy to coord's `/coord/claims/list` with
# `kind=symbol` pinned. Optional `?machine_id` filter is forwarded so a
# future per-machine view can fan out without changing the proxy.
#
# Tenant-scoped (plan `2026-05-24-symbol-claim-tenant-scoping.md` Phase 2):
# the operator's resolved tenant rides BOTH channels —
#
#   1. the forwarded Cognito bearer (fleet-auth P2/D6; coord derives the
#      home tenant from the `OperatorContext`), and
#   2. an explicit `?tenant_id=` query param, which coord's
#      `resolve_optional_tenant_scope` asserts against the bearer's home
#      tenant (defense-in-depth: a mismatch is rejected 403, so a web bug
#      forwarding the wrong tenant can't widen the view).
#
# NOTE the param must ride the `params` dict (coord reads it from the
# query string), NOT `_proxy_coord_get`'s `tenant_id=` kwarg alone — that
# kwarg only triggers bearer-forwarding and puts nothing on the wire.
# Coord drops holders whose device belongs to another tenant; holders
# gain a resolved `tenant_id` field (surfaced in `SymbolClaim`).


@router.get("/symbol-claims")
async def get_symbol_claims(
    machine_id: str | None = Query(
        default=None,
        description="When set, return only claims held by this machine_id (UUID).",
    ),
    limit: int | None = Query(default=None, ge=1, le=500),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Proxy ``GET /coord/claims/list?kind=symbol`` for the dashboard.

    Response shape (coord ``ListResponse``):

        {
            "kind": "symbol",
            "prefix": "<echo>",
            "holders": [
                {
                    "kind": "symbol",
                    "resource_key": "<repo>:<file>:<symbol>",
                    "machine_id": "<uuid>",
                    "ttl_seconds": <int>
                },
                ...
            ],
            "truncated": <bool>
        }

    Optional ``machine_id`` filter is applied client-side after coord
    returns (coord's ``/coord/claims/list`` doesn't accept a machine
    filter directly — prefix matches on resource_key, not on holder).
    The dashboard groups client-side anyway; this filter is for
    targeted CLI / curl consumers.
    """
    params: dict[str, Any] = {
        "kind": "symbol",
        "prefix": "",
        # Explicit tenant scope — coord asserts this matches the forwarded
        # bearer's home tenant and filters holders to the tenant's devices
        # (plan 2026-05-24-symbol-claim-tenant-scoping Phase 2).
        "tenant_id": str(tenant_id),
    }
    if limit is not None:
        params["limit"] = limit
    # Operator bearer forwarded (fleet-auth P2/D6).
    payload = await _proxy_coord_get(
        "/coord/claims/list", params=params, tenant_id=tenant_id
    )

    if machine_id is not None and isinstance(payload, dict):
        holders = payload.get("holders", [])
        if isinstance(holders, list):
            payload = {
                **payload,
                "holders": [
                    h
                    for h in holders
                    if isinstance(h, dict)
                    and str(h.get("machine_id", "")) == machine_id
                ],
            }
    return payload


# ---- Device-status surface (Phase 1.3) ----------------------------------
#
# Plan: `D:/qontinui-root/plans/2026-05-21-coordination-improvements.md`
# Phase 1.3. Two endpoints back the live `currentActivity` sub-line on
# each `MachineCard` in the operations dashboard:
#
#   1. `GET /operations/device-status`       — tenant-scoped REST proxy.
#                                               Used for the initial
#                                               seed and as a polling
#                                               fallback when the WS
#                                               is offline.
#   2. `WS  /operations/device-status/ws`    — bridges browser to
#                                               coord's per-tenant
#                                               typed `/ws/device-status`.
#
# The WS bridge mints a coord service JWT carrying the operator's
# resolved tenant_id (see `app.services.coord_device_status`), opens
# the upstream WS, subscribes to `device_status:<tenant_uuid>`, and
# forwards `device_status.changed` frames to the browser.


@router.get("/device-status")
async def get_device_status(
    since: str | None = Query(
        default=None,
        description="RFC 3339 timestamp; only rows updated at-or-after are returned.",
    ),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return live ``coord.device_status`` rows scoped to the caller's tenant.

    Response shape::

        { "devices": [StatusRow, ...], "count": <int> }

    The list is unsorted from coord; clients render in arbitrary order
    (the `MachineCard` consumer keys on hostname). When the caller's
    tenant has no devices reporting, ``devices`` is an empty list and
    ``count`` is zero — never 4xx.

    The operator bearer is forwarded (``_tenant_headers``) — coord's
    ``GET /coord/status`` is operator-auth fail-closed (fleet-auth P4)
    and 403s ``tenant_not_resolved`` on anonymous calls, which is what
    this proxy used to send.
    """
    try:
        return await fetch_device_status(
            tenant_id=tenant_id, since=since, headers=_tenant_headers(tenant_id)
        )
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=502, detail="coord is not reachable") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504, detail="timeout waiting for coord"
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code, detail=exc.response.text
        ) from exc


@router.websocket("/device-status/ws")
async def websocket_device_status(
    websocket: WebSocket,
) -> None:
    """Bridge browser ↔ coord's typed `/ws/device-status` channel.

    Per-connection flow:

    1. Browser opens `WS /api/v1/operations/device-status/ws?token=<jwt>`.
       Auth: the same JWT used elsewhere on the operations surface
       (cookie-based session token; mirrors `runner_status_ws.py`).
    2. We resolve the caller's tenant_id (same path as
       `/operations/device-status`).
    3. We mint a tenant-scoped coord service JWT via
       `POST /coord/auth/service-token` (admin-secret-gated).
    4. We open the upstream WS at `wss://<coord>/ws/device-status?token=<minted>`
       and subscribe to `device_status:<tenant_id>`.
    5. Every `{"kind":"device_status.changed","row":...}` frame from
       coord is forwarded verbatim to the browser.

    Disconnect / failure handling:

    - Browser drops → close upstream, exit.
    - Coord upstream drops → close browser with 1011 so the browser-
      side hook can reconnect; client-side handles exponential backoff
      (see `useDeviceStatusStream` on the frontend).
    - Coord unreachable / mint failed → close browser with 1011 + an
      error frame so the frontend can fall back to polling.
    """
    await websocket.accept()

    # --- Browser-side auth ------------------------------------------------
    token = websocket.query_params.get("token")
    if not token:
        await safe_send_json(
            websocket, {"type": "error", "error": "Missing authentication token"}
        )
        await safe_close(websocket, 1008, reason="Missing authentication token")
        return

    try:
        user = await get_current_user_from_ws(token)
    except Exception as exc:  # noqa: BLE001 — auth diagnostics live in deps
        logger.warning("device_status_ws_auth_failed", error=str(exc))
        await safe_send_json(
            websocket, {"type": "error", "error": "Authentication failed"}
        )
        await safe_close(websocket, 1008, reason="Authentication failed")
        return

    # --- Tenant resolution + token mint ----------------------------------
    # Source identity from coord's `/admin/coord/me` over the HTTP boundary
    # (forwarding the WS-auth bearer), then resolve the EFFECTIVE tenant:
    # the dashboard tenant-switcher selection rides the `active_tenant`
    # query param (a browser WebSocket cannot send custom headers) and is
    # membership-validated by `_effective_tenant_id`; a non-member or
    # absent selection degrades to the home tenant, never widens. This
    # keeps the live stream consistent with the REST seed, which forwards
    # X-Qontinui-Active-Tenant to coord.
    try:
        identity = await get_coord_identity_for_token(token)
        tenant_id = _effective_tenant_id(
            identity, websocket.query_params.get("active_tenant")
        )
        if tenant_id is None:
            raise HTTPException(status_code=403, detail="tenant_not_resolved")
    except HTTPException as http_exc:
        await safe_send_json(websocket, {"type": "error", "error": http_exc.detail})
        await safe_close(websocket, 1008, reason=str(http_exc.detail))
        return
    except Exception as exc:  # noqa: BLE001
        logger.error("device_status_ws_tenant_lookup_failed", error=str(exc))
        await safe_send_json(
            websocket, {"type": "error", "error": "Tenant lookup failed"}
        )
        await safe_close(websocket, 1011, reason="Tenant lookup failed")
        return

    try:
        coord_token = await mint_device_status_token(tenant_id=tenant_id)
    except CoordDeviceStatusDisabledError as exc:
        logger.warning(
            "device_status_ws_disabled",
            user_id=str(user.id),
            reason=str(exc),
        )
        await safe_send_json(
            websocket,
            {
                "type": "error",
                "error": "Coord integration disabled — fall back to REST polling.",
            },
        )
        await safe_close(websocket, 1011, reason="Coord integration disabled")
        return
    except CoordDeviceStatusMintFailedError as exc:
        logger.error(
            "device_status_ws_mint_failed",
            user_id=str(user.id),
            error=str(exc),
        )
        await safe_send_json(websocket, {"type": "error", "error": "Token mint failed"})
        await safe_close(websocket, 1011, reason="Token mint failed")
        return

    upstream_url = build_device_status_ws_url(coord_token)
    subscribe_topic = f"device_status:{tenant_id}"

    # --- Upstream bridge --------------------------------------------------
    upstream: Any = None
    try:
        try:
            upstream = await websockets_connect(upstream_url, open_timeout=10)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "device_status_ws_upstream_connect_failed",
                user_id=str(user.id),
                error=str(exc),
            )
            await safe_send_json(
                websocket, {"type": "error", "error": "Upstream coord WS unreachable"}
            )
            await safe_close(websocket, 1011, reason="Upstream WS unreachable")
            return

        # Send the typed subscribe message (coord won't push diffs
        # until it receives this).
        await upstream.send(
            json.dumps({"action": "subscribe", "topic": subscribe_topic})
        )

        # Forward both directions: upstream → browser is the hot path
        # (device_status.changed frames). Browser → upstream stays open
        # only so close-frames propagate; we don't forward arbitrary
        # browser payloads (the subscription is fixed per-connection).
        async def pump_upstream_to_browser() -> None:
            try:
                async for message in upstream:
                    if websocket.client_state != WebSocketState.CONNECTED:
                        break
                    # Coord sends Text frames; the websockets lib gives
                    # us str directly. Forward verbatim — the browser
                    # parses the JSON.
                    if isinstance(message, bytes):
                        message = message.decode("utf-8")
                    await websocket.send_text(message)
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "device_status_ws_upstream_pump_error",
                    user_id=str(user.id),
                    error=str(exc),
                )

        async def pump_browser_to_upstream() -> None:
            try:
                while True:
                    # We only need to detect disconnect; the subscription
                    # is fixed so any received frame is informational
                    # (likely a ping/pong from a JS WS lib).
                    await websocket.receive_text()
            except WebSocketDisconnect:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "device_status_ws_browser_pump_exit",
                    user_id=str(user.id),
                    error=str(exc),
                )

        # Race the two pumps — whichever side closes first ends the
        # bridge. asyncio.wait+FIRST_COMPLETED + cancel the rest.
        upstream_task = asyncio.create_task(pump_upstream_to_browser())
        browser_task = asyncio.create_task(pump_browser_to_upstream())
        done, pending = await asyncio.wait(
            {upstream_task, browser_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "device_status_ws_task_cancel_exception",
                    user_id=str(user.id),
                    error=str(exc),
                )
    finally:
        if upstream is not None:
            try:
                await upstream.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("device_status_ws_upstream_close_failed", error=str(exc))
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("device_status_ws_close_failed", error=str(exc))


# ---- CI Status Dashboard surface (Phase 3 + Phase 5) --------------------
#
# Plan: `D:/qontinui-root/qontinui-dev-notes/plans/2026-05-25-ci-status-dashboard-plan.md`
# Phases 3 + 5. Three endpoints back the per-tenant CI status panel on
# the operations dashboard:
#
#   1. `GET  /operations/ci-status`                  — tenant-scoped REST
#                                                      proxy (seed + the
#                                                      polling fallback).
#   2. `WS   /operations/ci-status/ws`               — bridges browser to
#                                                      coord's typed
#                                                      `/ws/device-status`
#                                                      channel, subscribing
#                                                      to the
#                                                      `ci_status:<tenant>`
#                                                      topic family.
#   3. `POST /operations/ci-status/notify-when-green` — register a
#                                                      `CiGreen` gate so an
#                                                      agent is informed
#                                                      when the repo goes
#                                                      green at a given SHA.
#
# The WS bridge reuses the same coord service-JWT mint + upstream WS URL
# as the device-status bridge (`app.services.coord_device_status`) —
# coord multiplexes its `/ws/device-status` channel by topic prefix, so
# the only difference from the device-status bridge is the subscribe
# topic (`ci_status:<tenant>`) and the relayed frame kind
# (`ci_status.changed`).


class RepoCiRow(BaseModel):
    """One repo's CI status, mirroring coord's ``RepoCiRow`` wire shape.

    ``main_verdict`` is coord's 3-state ``MainCiStatus`` rendering
    (``green`` / ``red`` / ``unknown``); any amber tone is a frontend
    derivation from ``open_pr_checks`` counts, not a backend value.
    """

    repo: str
    main_verdict: str = Field(..., description='"green" | "red" | "unknown"')
    open_pr_checks: dict[str, int] = Field(
        ..., description="counts keyed by 'success' | 'failure' | 'pending'"
    )
    latest_details_url: str | None = None
    main_head_sha: str | None = None


class CiStatusResponse(BaseModel):
    """Response wrapper for ``GET /operations/ci-status``."""

    repos: list[RepoCiRow]


class NotifyWhenGreenRequest(BaseModel):
    """Body for ``POST /operations/ci-status/notify-when-green``.

    Registers a ``CiGreen`` gate bound to ``(repo, head_sha)``. The
    optional ``continuation_prompt`` becomes the gate's continuation
    spawn ``initial_prompt`` so the gate engine can hand a follow-up
    prompt to an agent when the repo goes green.
    """

    repo: str
    head_sha: str
    continuation_prompt: str | None = None


class NotifyWhenGreenResponse(BaseModel):
    """Response for ``POST /operations/ci-status/notify-when-green``."""

    gate_id: UUID


@router.get("/ci-status", response_model=CiStatusResponse)
async def get_ci_status(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return per-repo CI status for the caller's tenant.

    Proxies coord's ``GET /coord/ci/status`` with the
    ``X-Qontinui-Tenant-Id`` header. Coord derives the repo set from
    ``coord.tenant_repos`` for the tenant, so an operator with no
    registered repos gets ``{"repos": []}`` — never 4xx.

    Wire shape (coord ``CiStatusResponse``)::

        { "repos": [RepoCiRow, ...] }
    """
    return await _proxy_coord_get("/coord/ci/status", tenant_id=tenant_id)


@router.post("/ci-status/notify-when-green", response_model=NotifyWhenGreenResponse)
async def post_ci_status_notify_when_green(
    body: NotifyWhenGreenRequest,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Register a ``CiGreen`` gate for ``(repo, head_sha)``.

    Builds coord's ``RegisterGateRequest`` (``gate_routes.rs``) with a
    claim anchor (``claim_kind="ci_notify"``,
    ``resource_key="ci-notify:<repo>"``) and the snake-case-tagged
    ``CiGreen`` predicate (``{"kind":"ci_green","repo":...,
    "head_sha":...}``). When ``continuation_prompt`` is set, it is
    carried as the continuation spawn's ``initial_prompt`` — coord's
    ``spawn_continuation`` reads that key (best-effort; it also wants a
    ``target_device_id`` which the dashboard does not supply today, so
    the prompt rides along for when a target is bound).

    Proxies to coord ``POST /coord/gates/register`` with the tenant
    header and returns ``{"gate_id": <uuid>}``.
    """
    register_body: dict[str, Any] = {
        "claim_kind": "ci_notify",
        "resource_key": f"ci-notify:{body.repo}",
        "predicate": {
            "kind": "ci_green",
            "repo": body.repo,
            "head_sha": body.head_sha,
        },
    }
    if body.continuation_prompt is not None:
        register_body["continuation_spawn"] = {
            "initial_prompt": body.continuation_prompt,
        }
    return await _proxy_coord_post(
        "/coord/gates/register", register_body, tenant_id=tenant_id
    )


@router.websocket("/ci-status/ws")
async def websocket_ci_status(
    websocket: WebSocket,
) -> None:
    """Bridge browser ↔ coord's typed `/ws/device-status` channel for CI.

    Mirrors :func:`websocket_device_status` exactly — coord multiplexes
    its WS by topic prefix, so the same minted service JWT + upstream WS
    URL are reused. The only differences are the subscribe topic
    (``ci_status:<tenant>`` instead of ``device_status:<tenant>``) and
    the frame kind relayed (``ci_status.changed``). Frames are forwarded
    verbatim; the browser parses the JSON.

    Per-connection flow:

    1. Browser opens `WS /api/v1/operations/ci-status/ws?token=<jwt>`.
    2. We resolve the caller's tenant_id (same path as `/ci-status`).
    3. We mint a tenant-scoped coord service JWT.
    4. We open coord's `/ws/device-status` and subscribe to
       `ci_status:<tenant_id>`.
    5. Every `{"kind":"ci_status.changed","row":...}` frame is forwarded
       to the browser.

    Disconnect / failure handling matches the device-status bridge:
    browser drop → close upstream; coord drop → close browser 1011 so
    the hook reconnects; mint/connect failure → 1011 + error frame so
    the frontend falls back to polling.
    """
    await websocket.accept()

    # --- Browser-side auth ------------------------------------------------
    token = websocket.query_params.get("token")
    if not token:
        await safe_send_json(
            websocket, {"type": "error", "error": "Missing authentication token"}
        )
        await safe_close(websocket, 1008, reason="Missing authentication token")
        return

    try:
        user = await get_current_user_from_ws(token)
    except Exception as exc:  # noqa: BLE001 — auth diagnostics live in deps
        logger.warning("ci_status_ws_auth_failed", error=str(exc))
        await safe_send_json(
            websocket, {"type": "error", "error": "Authentication failed"}
        )
        await safe_close(websocket, 1008, reason="Authentication failed")
        return

    # --- Tenant resolution + token mint ----------------------------------
    # Source identity from coord's `/admin/coord/me` over the HTTP boundary
    # (forwarding the WS-auth bearer), then resolve the EFFECTIVE tenant:
    # the dashboard tenant-switcher selection rides the `active_tenant`
    # query param (a browser WebSocket cannot send custom headers) and is
    # membership-validated by `_effective_tenant_id`; a non-member or
    # absent selection degrades to the home tenant, never widens. This
    # keeps the live stream consistent with the REST seed, which forwards
    # X-Qontinui-Active-Tenant to coord.
    try:
        identity = await get_coord_identity_for_token(token)
        tenant_id = _effective_tenant_id(
            identity, websocket.query_params.get("active_tenant")
        )
        if tenant_id is None:
            raise HTTPException(status_code=403, detail="tenant_not_resolved")
    except HTTPException as http_exc:
        await safe_send_json(websocket, {"type": "error", "error": http_exc.detail})
        await safe_close(websocket, 1008, reason=str(http_exc.detail))
        return
    except Exception as exc:  # noqa: BLE001
        logger.error("ci_status_ws_tenant_lookup_failed", error=str(exc))
        await safe_send_json(
            websocket, {"type": "error", "error": "Tenant lookup failed"}
        )
        await safe_close(websocket, 1011, reason="Tenant lookup failed")
        return

    try:
        coord_token = await mint_device_status_token(tenant_id=tenant_id)
    except CoordDeviceStatusDisabledError as exc:
        logger.warning(
            "ci_status_ws_disabled",
            user_id=str(user.id),
            reason=str(exc),
        )
        await safe_send_json(
            websocket,
            {
                "type": "error",
                "error": "Coord integration disabled — fall back to REST polling.",
            },
        )
        await safe_close(websocket, 1011, reason="Coord integration disabled")
        return
    except CoordDeviceStatusMintFailedError as exc:
        logger.error(
            "ci_status_ws_mint_failed",
            user_id=str(user.id),
            error=str(exc),
        )
        await safe_send_json(websocket, {"type": "error", "error": "Token mint failed"})
        await safe_close(websocket, 1011, reason="Token mint failed")
        return

    upstream_url = build_device_status_ws_url(coord_token)
    subscribe_topic = f"ci_status:{tenant_id}"

    # --- Upstream bridge --------------------------------------------------
    upstream: Any = None
    try:
        try:
            upstream = await websockets_connect(upstream_url, open_timeout=10)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "ci_status_ws_upstream_connect_failed",
                user_id=str(user.id),
                error=str(exc),
            )
            await safe_send_json(
                websocket, {"type": "error", "error": "Upstream coord WS unreachable"}
            )
            await safe_close(websocket, 1011, reason="Upstream WS unreachable")
            return

        # Send the typed subscribe message (coord won't push diffs
        # until it receives this).
        await upstream.send(
            json.dumps({"action": "subscribe", "topic": subscribe_topic})
        )

        # Forward both directions: upstream → browser is the hot path
        # (ci_status.changed frames). Browser → upstream stays open only
        # so close-frames propagate; we don't forward arbitrary browser
        # payloads (the subscription is fixed per-connection).
        async def pump_upstream_to_browser() -> None:
            try:
                async for message in upstream:
                    if websocket.client_state != WebSocketState.CONNECTED:
                        break
                    # Coord sends Text frames; the websockets lib gives
                    # us str directly. Forward verbatim — the browser
                    # parses the JSON.
                    if isinstance(message, bytes):
                        message = message.decode("utf-8")
                    await websocket.send_text(message)
            except websockets.exceptions.ConnectionClosed:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ci_status_ws_upstream_pump_error",
                    user_id=str(user.id),
                    error=str(exc),
                )

        async def pump_browser_to_upstream() -> None:
            try:
                while True:
                    # We only need to detect disconnect; the subscription
                    # is fixed so any received frame is informational
                    # (likely a ping/pong from a JS WS lib).
                    await websocket.receive_text()
            except WebSocketDisconnect:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "ci_status_ws_browser_pump_exit",
                    user_id=str(user.id),
                    error=str(exc),
                )

        # Race the two pumps — whichever side closes first ends the
        # bridge. asyncio.wait+FIRST_COMPLETED + cancel the rest.
        upstream_task = asyncio.create_task(pump_upstream_to_browser())
        browser_task = asyncio.create_task(pump_browser_to_upstream())
        done, pending = await asyncio.wait(
            {upstream_task, browser_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "ci_status_ws_task_cancel_exception",
                    user_id=str(user.id),
                    error=str(exc),
                )
    finally:
        if upstream is not None:
            try:
                await upstream.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("ci_status_ws_upstream_close_failed", error=str(exc))
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.close()
            except Exception as exc:  # noqa: BLE001
                logger.debug("ci_status_ws_close_failed", error=str(exc))


# ---- Coord-Native Session Coordination — Phase 5 ------------------------
#
# Plan: `D:/qontinui-root/qontinui-dev-notes/plans/2026-05-22-coord-native-session-coordination.md`
# Phase 5. The dashboard `/sessions` panel reads from coord's
# `/sessions` REST + SSE surface (Phase 1 SHIPPED, LIVE at
# `coord.qontinui.io`).
#
# We proxy from the web backend so the browser gets:
#   1. Same-origin requests (no CORS to coord required).
#   2. Tenant scoping via the resolved operator → tenant_id (the
#      header-driven dependency below).
#   3. A future hook for RBAC + audit if Phase 5/7 grows teeth.
#
# Endpoints:
#   GET    /api/v1/operations/sessions[?scope=active|all&since=...]
#   GET    /api/v1/operations/sessions/{id}
#   GET    /api/v1/operations/sessions/{id}/events                 (SSE)
#   POST   /api/v1/operations/sessions/{id}/steal { reason, machine_id }
#   DELETE /api/v1/operations/sessions/{id}
#   GET    /api/v1/operations/tenants                              (list)
#
# `GET /sessions/.../events` is an SSE proxy; the upstream coord stream
# is open until the browser disconnects. The proxy must NOT buffer —
# we use httpx streaming + StreamingResponse to keep the byte path
# tight.


@router.get("/sessions")
async def list_coord_sessions(
    request: Request,
    scope: str | None = Query(
        default=None,
        description="`active` (default) | `all` — session-state filter, "
        "passthrough to coord. Orthogonal to `tenant_scope`.",
    ),
    tenant_scope: str | None = Query(
        default=None,
        description="`active` (default — caller's active tenant only) | "
        "`all` (union across every tenant the caller is a member of). "
        "Distinct axis from `scope`: this controls tenant breadth, "
        "`scope` controls session-state breadth.",
    ),
    since: str | None = Query(
        default=None,
        description="RFC 3339 timestamp; only rows updated at-or-after are returned.",
    ),
    # `get_tenant_id` captures the caller's Cognito bearer into the
    # request-scoped ContextVar so `_proxy_coord_get(..., tenant_id=...)`
    # forwards it — coord derives the home tenant from it on the
    # single-tenant path. The returned UUID is otherwise unused on the
    # wire here (the `scope=all` path computes its own `tenant_ids`).
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """List active (default) or all sessions across one or all tenants
    the caller belongs to.

    `scope` (session-state) and `tenant_scope` (tenant breadth) are
    independent axes — see plan
    `2026-05-28-cross-org-tenant-membership-and-session-filter-split.md`.

    Wire shape from coord::

        { "count": <int>, "scope": "<active|all>", "sessions": [SessionRow, ...] }

    Where ``SessionRow`` matches ``qontinui-coord/src/sessions.rs::SessionRow``.
    """
    params: dict[str, Any] = {}
    if tenant_scope == "all":
        # Multi-tenant: coord's single-tenant `OperatorContext` cannot
        # reproduce the operator's full membership set, so we still
        # compute + send the explicit `tenant_ids`. The membership set is
        # sourced from coord's `/admin/coord/me` over the HTTP boundary
        # (cached per-request by `get_tenant_id`'s prior call). Coord
        # trusts the resolved set (see
        # `qontinui-coord/src/sessions.rs::get_list` —
        # `scope=all`/`tenant_ids` membership path preserved verbatim).
        identity = await get_coord_identity(request)
        tenant_ids = identity.tenant_ids()
        params["tenant_ids"] = ",".join(str(t) for t in tenant_ids)
    # Default + explicit `active` (single-tenant home): send NEITHER
    # param — coord derives the home tenant fail-closed from the
    # forwarded Cognito bearer's `OperatorContext`.
    if scope is not None:
        params["scope"] = scope
    if since is not None:
        params["since"] = since
    return await _proxy_coord_get(
        "/sessions", params=params or None, tenant_id=tenant_id
    )


@router.get("/sessions/{session_id}")
async def get_coord_session(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Fetch a single session row by id (read-only).

    Coord's `GET /sessions/:id` is not separately exposed today; we
    derive the row from `GET /sessions?scope=all` (session-state
    breadth — NOT a multi-tenant `tenant_ids` set) and filter
    client-side. coord scopes to the caller's home tenant fail-closed
    from the forwarded Cognito bearer; we no longer send the
    web-computed `tenant_id` param. Cheap because the row set is small
    in pilot.
    """
    payload = await _proxy_coord_get(
        "/sessions",
        params={"scope": "all"},
        tenant_id=tenant_id,
    )
    sessions = payload.get("sessions", []) if isinstance(payload, dict) else []
    for row in sessions:
        if isinstance(row, dict) and str(row.get("id", "")) == str(session_id):
            return row
    raise HTTPException(status_code=404, detail="session not found")


@router.get("/sessions/{session_id}/output")
async def get_coord_session_output(
    session_id: UUID,
    tier: str | None = Query(
        default=None,
        description="`warm` (default) | `cold` — passthrough to coord.",
    ),
    limit: int | None = Query(
        default=None,
        description="Max warm-tier chunks to return (warm tier only).",
    ),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Fetch a session's recorded PTY output (Phase 8 read-only pane).

    Bridges to coord's ``GET /sessions/:id/output[?tier=warm|cold][&limit=N]``.
    The response envelope is::

        {
          "session_id": "<uuid>",
          "tier": "warm" | "cold",
          "chunks": [ { "chunk_offset": <i64>, "payload_b64": "<base64>" }, ... ],
          "count": <int>
        }

    Each chunk's ``payload_b64`` decodes to raw PTY bytes (already redacted
    runner-side when the session opted into redaction). The dashboard fetches
    the ``warm`` tier for the xterm bootstrap window then live-tails the
    ``/sessions/:id/events`` SSE stream (``output_chunk`` frames carry the
    same ``chunk_offset`` + ``payload_b64`` shape), de-duping by
    ``chunk_offset``.

    Gated on coord serving the Phase 8 output endpoints (PR #130). Until
    those are deployed, coord returns an error for this path and the pane
    renders its empty / unavailable state.
    """
    params: dict[str, Any] = {}
    if tier is not None:
        params["tier"] = tier
    if limit is not None:
        params["limit"] = limit
    return await _proxy_coord_get(
        f"/sessions/{session_id}/output",
        params=params or None,
        tenant_id=tenant_id,
    )


@router.get("/sessions/{session_id}/events")
async def stream_coord_session_events(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Stream session events as Server-Sent Events.

    Bridges to coord's `GET /sessions/:id/events` (SSE). The upstream
    stream emits a replay of the last 100 events followed by a
    JetStream live-tail subscription for the same session.

    Tenant scoping: tenant_id is resolved server-side; coord ignores
    `X-Qontinui-Tenant-Id` on this route today (sessions endpoints
    are anonymous in pilot) but the header is forwarded for the
    Phase 6 hardening pass.
    """
    url = f"{settings.COORD_URL}/sessions/{session_id}/events"
    headers = _tenant_headers(tenant_id)

    async def _proxy() -> Any:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(None, connect=5.0),
        ) as client:
            async with client.stream("GET", url, headers=headers) as upstream:
                if upstream.status_code >= 400:
                    body = await upstream.aread()
                    raise HTTPException(
                        status_code=upstream.status_code,
                        detail=body.decode("utf-8", "ignore"),
                    )
                async for chunk in upstream.aiter_raw():
                    yield chunk

    return StreamingResponse(
        _proxy(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sessions/{session_id}/steal")
async def steal_coord_session(
    session_id: UUID,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Steal a session's claim (Phase 6 wires the dashboard UI; the
    proxy lives here so the byte-paths are stable from Phase 5)."""
    return await _proxy_coord_post(
        f"/sessions/{session_id}/steal", body, tenant_id=tenant_id
    )


@router.delete("/sessions/{session_id}")
async def close_coord_session(
    session_id: UUID,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Close a session (DELETE → `state='closed'`, releases claim)."""
    return await _proxy_coord_delete(f"/sessions/{session_id}", tenant_id=tenant_id)


@router.post("/sessions/{session_id}/handoff")
async def handoff_coord_session(
    session_id: UUID,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Hand a session off to another machine ("Continue elsewhere").

    Plan ``2026-05-23-coord-native-sessions-phase-7-10.md`` §Phase 7.
    Proxies coord's ``POST /sessions/:id/handoff {target_device_id}``,
    which records a durable ``handoff_request`` event on the source
    session and publishes the JetStream handoff subject scoped to the
    target machine. The target runner's receiver loop materializes a
    child session (``parent_session_id = source``) and closes this one —
    a one-way move (no live mirror; that's Phase 8).

    Body: ``{ "target_device_id": "<uuid>" }``.
    """
    return await _proxy_coord_post(
        f"/sessions/{session_id}/handoff", body, tenant_id=tenant_id
    )


# Canonical claim kinds — mirrors ``qontinui-coord/src/claims.rs::ClaimKind``
# (the ``as_str`` snake-case forms). coord's ``GET /coord/claims/list``
# REQUIRES a ``kind`` query param and rejects a bare call with HTTP 400
# ("missing field kind"); it also has no ``machine_id`` filter — it lists
# every active holder of the given kind. So to surface "all locks held by
# one device across kinds" we fan out one list call per kind and filter the
# holders by ``machine_id`` here.
_CLAIM_KINDS: tuple[str, ...] = (
    "alembic_revision",
    "branch_name",
    "file_glob",
    "phase",
    "worktree",
    "ci_wait",
    "symbol",
    "session",
    "repo_branch",
    "main_merge",
)


@router.get("/sessions/{session_id}/claims")
async def get_session_claims(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return active claims held by the device owning this session.

    Resolves the session's ``device_id`` from the sessions list, then
    aggregates that device's active claims across every claim kind.

    coord's ``GET /coord/claims/list`` (``claims_admin_routes.rs``)
    REQUIRES a ``kind`` field (a bare call returns HTTP 400 "missing
    field kind") and exposes no ``machine_id`` filter — it lists all
    active holders of one kind. We therefore fan out one list call per
    kind in :data:`_CLAIM_KINDS` (concurrently), keep the holders whose
    ``machine_id`` matches this session's device, and normalize coord's
    ``ClaimHolder`` rows into the ``{claims, count}`` envelope the
    dashboard's "N files locked" badge + claim list consume
    (``frontend/src/components/sessions/types.ts::SessionClaimsResponse``).

    coord's per-holder shape is
    ``{kind, resource_key, machine_id, ttl_seconds, status_text?,
    blocked_on?}`` — no claim ``id`` / ``acquired_at`` / ``expires_at``.
    We synthesize a stable ``id`` (``<kind>:<resource_key>``), derive
    ``expires_at`` from ``ttl_seconds`` (now + ttl), and leave
    ``acquired_at`` as the observation time (best-effort — the list
    endpoint doesn't expose acquire time).
    """
    session = await _resolve_session_row(session_id, tenant_id)
    device_id = session.get("device_id")
    if not device_id:
        return {"claims": [], "count": 0}
    device_str = str(device_id)

    results = await asyncio.gather(
        *(
            _proxy_coord_get(
                "/coord/claims/list",
                params={"kind": kind},
                tenant_id=tenant_id,
            )
            for kind in _CLAIM_KINDS
        ),
        return_exceptions=True,
    )

    now = datetime.now(UTC)
    now_iso = now.isoformat()
    claims: list[dict[str, Any]] = []
    for kind, result in zip(_CLAIM_KINDS, results, strict=True):
        if isinstance(result, BaseException):
            # A single kind failing (e.g. coord transient error) must not
            # blank the whole badge — degrade to the kinds that answered.
            logger.warning(
                "session_claims_kind_fetch_failed",
                session_id=str(session_id),
                kind=kind,
                error=str(result),
            )
            continue
        holders = result.get("holders", []) if isinstance(result, dict) else []
        for holder in holders:
            if not isinstance(holder, dict):
                continue
            if str(holder.get("machine_id", "")) != device_str:
                continue
            resource_key = str(holder.get("resource_key", ""))
            ttl_seconds = holder.get("ttl_seconds")
            expires_at: str | None = None
            if isinstance(ttl_seconds, (int, float)) and ttl_seconds > 0:
                expires_at = (now + timedelta(seconds=ttl_seconds)).isoformat()
            metadata: dict[str, Any] = {}
            if holder.get("status_text") is not None:
                metadata["status_text"] = holder["status_text"]
            if holder.get("blocked_on") is not None:
                metadata["blocked_on"] = holder["blocked_on"]
            claims.append(
                {
                    "id": f"{kind}:{resource_key}",
                    "kind": kind,
                    "resource_key": resource_key,
                    "machine_id": device_str,
                    "acquired_at": now_iso,
                    "expires_at": expires_at,
                    "metadata": metadata,
                }
            )

    return {"claims": claims, "count": len(claims)}


@router.get("/sessions/{session_id}/agent-status")
async def get_session_agent_status(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return agent_status rows for the device owning this session.

    Resolves the session's ``device_id`` then proxies
    ``GET /coord/agent-status?device_id=<device_id>``. coord derives the
    tenant fail-closed from the forwarded Cognito bearer's
    ``OperatorContext``; we no longer send the web-computed ``tenant_id``
    param (the bearer is forwarded via ``tenant_id=``). The dashboard
    renders agent coordination state (status_text, blocked_on,
    intent_globs, correlation_topic) on the session detail view.
    """
    session = await _resolve_session_row(session_id, tenant_id)
    device_id = session.get("device_id")
    if not device_id:
        return {"agents": [], "count": 0}
    return await _proxy_coord_get(
        "/coord/agent-status",
        params={"device_id": str(device_id)},
        tenant_id=tenant_id,
    )


@router.get("/sessions/{session_id}/lineage")
async def get_session_lineage(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return the agent-session lineage (worktree/claim/build/merge timeline).

    Proxies coord ``GET /coord/agent-sessions/{session_id}/lineage`` and
    returns its ``{session_id, actions:[{kind, handle, occurred_at}]}``
    envelope verbatim — the same UNION ALL timeline the admin
    ``/admin/agent-sessions`` dashboard renders, folded into the
    per-session drill-down so ``/sessions`` is the canonical fleet view.

    Auth: user-authenticated via ``get_tenant_id`` (NOT admin); the
    operator's Cognito bearer is forwarded so coord derives the tenant
    fail-closed from its ``OperatorContext``.
    """
    return await _proxy_coord_get(
        f"/coord/agent-sessions/{session_id}/lineage",
        tenant_id=tenant_id,
    )


# ---------------------------------------------------------------------------
# Commit lineage — "which Claude Code session produced which commit"
#
# Proxies coord's `coord.commit_lineage`-backed read endpoints so the web
# dashboard's /commits page renders the same feed the dev-only supervisor
# Lineage tab showed. Coord's lineage reads are FleetPrincipal-gated; the
# operator's Cognito bearer is forwarded via ``tenant_id=`` (same pattern as
# ``get_session_lineage`` above) so coord authenticates the operator and
# scopes the query. The coord routes return enveloped bodies
# (``{rows,count,limit}`` / ``{commits,count,...}``); we forward them verbatim
# and let the frontend unwrap.
# ---------------------------------------------------------------------------


@router.get("/lineage/recent")
async def get_lineage_recent(
    limit: int = 100,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Newest commit-lineage rows (default 100, coord caps at 500).

    Proxies coord ``GET /coord/lineage/recent?limit=N`` and returns its
    ``{rows, count, limit}`` envelope verbatim.
    """
    return await _proxy_coord_get(
        "/coord/lineage/recent",
        params={"limit": limit},
        tenant_id=tenant_id,
    )


@router.get("/lineage/stats")
async def get_lineage_stats(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Aggregate commit-lineage census (totals + by_source + top_sessions).

    Proxies coord ``GET /coord/lineage/stats`` verbatim.
    """
    return await _proxy_coord_get(
        "/coord/lineage/stats",
        tenant_id=tenant_id,
    )


@router.get("/lineage/sessions/{session_id}/commits")
async def get_lineage_session_commits(
    session_id: UUID,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Every commit attributed to a single session.

    Proxies coord ``GET /coord/sessions/{session_id}/commits`` and returns
    its ``{session_id, commits, count}`` envelope verbatim — backs the
    /commits page's per-session drill-down drawer.
    """
    return await _proxy_coord_get(
        f"/coord/sessions/{session_id}/commits",
        tenant_id=tenant_id,
    )


async def _resolve_session_row(session_id: UUID, tenant_id: UUID) -> dict[str, Any]:
    """Look up a single session row from coord's session list.

    Reuses the same list-and-filter approach as ``get_coord_session``:
    coord scopes to the caller's home tenant fail-closed from the
    forwarded bearer, so we send no web-computed `tenant_id` param
    (only forward the bearer via ``tenant_id=``).
    """
    payload = await _proxy_coord_get(
        "/sessions",
        params={"scope": "all"},
        tenant_id=tenant_id,
    )
    sessions = payload.get("sessions", []) if isinstance(payload, dict) else []
    for row in sessions:
        if isinstance(row, dict) and str(row.get("id", "")) == str(session_id):
            return row
    raise HTTPException(status_code=404, detail="session not found")


@router.get("/tenants")
async def list_user_tenants(
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> dict[str, Any]:
    """Return the tenants the current operator belongs to.

    Sourced from coord's ``GET /admin/coord/me`` over the HTTP boundary
    (no cross-schema read): an operator with rows in N tenants comes back
    with N entries; single-tenant operators come back with one. The
    ``active_tenant_id`` field is the operator's home tenant — the natural
    default for first-load selection; the frontend persists subsequent
    switches in localStorage (`tenant-context.tsx`).

    Coord returns ``tenants[]`` home-tenant-first (slug-asc otherwise);
    ``CoordIdentity.tenant_ids()`` re-confirms the home-first ordering so
    the first entry is the active default. A coord 403 for an unlinked
    operator propagates as ``tenant_not_resolved``.

    The per-tenant ``name`` field is not in the ``/me`` payload (coord
    returns ``{tenant_id, slug, roles}``); the dashboard tenant chip
    renders the slug, so ``name`` falls back to the slug.

    Wire shape::

        { "tenants": [ { "id": "<uuid>", "slug": "<str>", "name": "<str>" } ],
          "active_tenant_id": "<uuid>" }
    """
    identity = await get_coord_identity(request)
    ordered_ids = identity.tenant_ids()
    if not ordered_ids:
        raise HTTPException(status_code=403, detail="tenant_not_resolved")

    by_id = {t.tenant_id: t for t in identity.tenants}
    tenants_out: list[dict[str, str]] = []
    for tid in ordered_ids:
        member = by_id.get(tid)
        slug = member.slug if member is not None else ""
        tenants_out.append(
            {
                "id": str(tid),
                "slug": slug,
                # `/me` carries no display_name; the UI renders the slug.
                "name": slug,
            }
        )
    return {
        "tenants": tenants_out,
        "active_tenant_id": str(ordered_ids[0]),
    }


# ---- Repo management proxy (canonical-repos on coord) ----------------------


@router.get("/repos")
async def list_repos(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List registered canonical repositories for the caller's tenant."""
    return await _proxy_coord_get("/coord/canonical-repos", tenant_id=tenant_id)


@router.post("/repos")
async def register_repo(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Register a new canonical repository.

    Body: ``{"repo": "owner/name"}``.
    """
    return await _proxy_coord_post("/coord/canonical-repos", body, tenant_id=tenant_id)


@router.delete("/repos")
async def deregister_repo(
    repo: str = Query(..., description="Repository slug (owner/name)"),
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Deregister a canonical repository."""
    return await _proxy_coord_delete(
        "/coord/canonical-repos",
        params={"repo": repo},
        tenant_id=tenant_id,
    )


# ---- Decision-engine next-step-settings proxy (§5.3 + §7) ---------------
#
# Plan ``2026-05-30-decision-engine-tenant-ui.md`` §5.3 + §7.
#
# Three endpoints exposing the coord "next-step-settings" façade so the
# cloud-control UI can render and mutate per-tenant autonomy levels without
# the browser hitting coord cross-origin.
#
# Auth posture:
#   GET  (per-tenant) — any authenticated user whose tenant resolves.
#                       Response carries ``can_edit: bool`` so the UI can
#                       gate the Save button without a separate authz call.
#   PUT  (per-tenant) — coord-tenant ADMIN only (``require_coord_tenant_admin``
#                       dependency).  NOT gated on cloud-control org ownership
#                       or ``is_superuser`` — the setting scopes to a coord
#                       tenant, and the authoritative RBAC is
#                       ``coord.operator_roles``.
#   GET  /fleet        — ``is_superuser`` staff view (``require_admin``).
#                       No tenant header — intentionally tenant-blind.


@router.get("/coord/next-step-settings")
async def get_next_step_settings(
    request: Request,
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Per-tenant read of the decision-engine autonomy settings.

    Returns the coord payload (``master_enabled``, ``domains`` list with
    ``decision_domain``, ``label``, ``description``, ``autonomy_level``,
    ``default_autonomy_level``, ``mode``, ``resolved_from``,
    ``requires_master``, ``effective``) plus a synthesised ``can_edit``
    field so the UI can enable/disable the Save controls without a
    separate authz round-trip.
    """
    body = await _proxy_coord_get("/coord/next-step-settings", tenant_id=tenant_id)
    # Honesty signal: tell the UI whether save controls should be enabled.
    # Sourced from coord's `/admin/coord/me` `is_admin` (cached per-request
    # by `get_tenant_id`'s prior call) — UI gating only; coord remains the
    # authority on the PUT route.
    identity = await get_coord_identity(request)
    body["can_edit"] = identity.is_admin
    return body


@router.put("/coord/next-step-settings")
async def put_next_step_settings(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Overwrite the tenant's per-domain autonomy levels.

    Requires coord-tenant ADMIN role (``require_coord_tenant_admin``).
    Body: ``{"domains": [{"decision_domain": "<str>",
    "autonomy_level": "always_escalate"|"guidance_only"|"auto_decide"}]}``.
    Returns the same shape as the GET (post-write view from coord).
    Body-supplied tenant is never trusted — the tenant is resolved from
    the caller's credential exclusively.
    """
    return await _proxy_coord_put(
        "/coord/next-step-settings", body, tenant_id=tenant_id
    )


@router.get("/coord/next-step-settings/fleet")
async def get_next_step_settings_fleet(
    request: Request,
    current_user: UserModel = Depends(require_admin),  # is_superuser staff view
) -> Any:
    """Fleet/staff read of autonomy settings across all tenants.

    No tenant scope is sent — coord returns the full multi-tenant view
    (``master_enabled``, ``tenants`` list with ``tenant_id``, ``slug``,
    ``autonomy_level``, ``effective``, ``updated_at``). Read-only;
    mutations stay per-tenant.

    Requires ``is_superuser`` (``require_admin``).

    fleet-auth P2/D6: the caller's Cognito bearer is forwarded so coord
    can authenticate the operator once it gates this route. This endpoint
    uses ``require_admin`` (not ``get_tenant_id``), so the bearer is
    captured here explicitly. ``_tenant_headers`` forwards only the
    bearer — never a tenant header — so the view stays tenant-blind. The
    ``tenant_id`` arg below is just the forwarding trigger; its value is
    never sent on the wire.
    """
    _caller_bearer.set(_extract_caller_token(request))
    _caller_active_tenant.set(request.headers.get(ACTIVE_TENANT_HEADER))
    return await _proxy_coord_get(
        "/coord/next-step-settings/fleet", tenant_id=current_user.id
    )


# ---- Priority-sets + composition-rules CRUD proxy -----------------------
#
# Plan ``2026-05-15-priority-sets-write-path-and-implementation-set.md``
# Phase P2 — forward coord's priority-set / composition-rule CRUD through
# the web backend so the cloud-control tenant-settings UI can manage them
# without the browser hitting coord cross-origin.
#
# Auth posture: this is a tenant-admin settings surface, so EVERY route
# (reads and writes) is gated by ``require_coord_tenant_admin`` — coord's
# ``/admin/coord/me`` ``is_admin`` is the source of truth; the web-side
# gate keeps the surface from being silently opened. ``require_coord_tenant_admin``
# resolves the caller's home tenant AND captures the caller's bearer in the
# request-scoped ContextVar, so ``_proxy_coord_*`` forwards only the bearer
# (never a tenant header — coord derives the tenant from the bearer; Phase
# T2b semantics).
#
# Coord error bodies (403 ``admin_required``, 409 ``duplicate_set_name``,
# 404, ...) pass through verbatim via the ``_proxy_coord_*`` helpers, which
# mirror the upstream status + body rather than collapsing to a 500.


@router.get("/coord/priority-sets")
async def list_priority_sets(
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """List the tenant's priority sets. Tenant-admin only."""
    return await _proxy_coord_get("/coord/priority-sets", tenant_id=tenant_id)


@router.post("/coord/priority-sets")
async def create_priority_set(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Create a priority set. Body forwarded verbatim. Tenant-admin only.

    Coord's 409 ``duplicate_set_name`` (and any other 4xx) passes through.
    """
    return await _proxy_coord_post("/coord/priority-sets", body, tenant_id=tenant_id)


@router.patch("/coord/priority-sets/{priority_set_id}")
async def update_priority_set(
    priority_set_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Update a priority set. Body forwarded verbatim. Tenant-admin only."""
    return await _proxy_coord_patch(
        f"/coord/priority-sets/{priority_set_id}", body, tenant_id=tenant_id
    )


@router.delete("/coord/priority-sets/{priority_set_id}")
async def delete_priority_set(
    priority_set_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Delete a priority set. Tenant-admin only."""
    return await _proxy_coord_delete(
        f"/coord/priority-sets/{priority_set_id}", tenant_id=tenant_id
    )


# Plan ``2026-06-13-unified-automation-rule-framework.md`` — Phase 5c.
# Forward coord's unified automation-rule (policy) CRUD through the web backend
# so the Admin Coord Console authoring UI manages tenant-scoped rules without
# the browser hitting coord cross-origin. Replaces the org-scoped #580
# auto-response store (deleted in Phase 5a). Coord owns the kind→storage
# mapping; the UI sends the typed ``kind`` and coord persists it.
#
# Same auth posture as the priority-sets proxy above: EVERY route gated by
# ``require_coord_tenant_admin`` (coord's ``/admin/coord/me`` ``is_admin`` is
# the source of truth; the web-side gate keeps the surface from being silently
# opened). ``require_coord_tenant_admin`` captures the caller's bearer so
# ``_proxy_coord_*`` forwards only the bearer (coord derives the tenant).
# Coord 4xx error bodies pass through verbatim via the ``_proxy_coord_*``
# helpers.


@router.get("/coord/policies")
async def list_coord_policies(
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """List the tenant's automation policies (rules). Tenant-admin only."""
    return await _proxy_coord_get("/coord/policies", tenant_id=tenant_id)


@router.post("/coord/policies")
async def create_coord_policy(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Create an automation policy. Body forwarded verbatim. Tenant-admin only.

    The body carries the typed ``kind`` (e.g. ``terminal_auto_response``) plus
    ``condition``/``action`` sub-objects; coord maps the kind to storage and
    returns its 4xx (validation, duplicate) verbatim.
    """
    return await _proxy_coord_post("/coord/policies", body, tenant_id=tenant_id)


@router.patch("/coord/policies/{policy_id}")
async def update_coord_policy(
    policy_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Update an automation policy. Body forwarded verbatim. Tenant-admin only."""
    return await _proxy_coord_patch(
        f"/coord/policies/{policy_id}", body, tenant_id=tenant_id
    )


@router.delete("/coord/policies/{policy_id}")
async def delete_coord_policy(
    policy_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Delete an automation policy. Tenant-admin only."""
    return await _proxy_coord_delete(
        f"/coord/policies/{policy_id}", tenant_id=tenant_id
    )


@router.put("/coord/policies/system/{system_rule_id}/override")
async def put_coord_policy_override(
    system_rule_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Upsert this tenant's override of a system built-in rule (disable or
    customize). Tenant-admin only.

    Body is either ``{"disabled": true|false}`` (toggle the built-in for this
    tenant) or a full customized policy body (``name``/``kind``/``condition``/
    ``action`` + optional ``priority``/``rationale``). Coord derives the tenant
    from the bearer and returns its 4xx (validation, not-a-built-in) verbatim.
    """
    return await _proxy_coord_put(
        f"/coord/policies/system/{system_rule_id}/override",
        body,
        tenant_id=tenant_id,
    )


@router.delete("/coord/policies/system/{system_rule_id}/override")
async def delete_coord_policy_override(
    system_rule_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Revert this tenant's override of a system built-in rule. Tenant-admin only."""
    return await _proxy_coord_delete(
        f"/coord/policies/system/{system_rule_id}/override", tenant_id=tenant_id
    )


@router.get("/coord/composition-rules")
async def list_composition_rules(
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """List the tenant's composition rules. Tenant-admin only."""
    return await _proxy_coord_get("/coord/composition-rules", tenant_id=tenant_id)


@router.post("/coord/composition-rules")
async def create_composition_rule(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Create a composition rule. Body forwarded verbatim. Tenant-admin only.

    Coord's 4xx error bodies (e.g. 409 conflicts) pass through.
    """
    return await _proxy_coord_post(
        "/coord/composition-rules", body, tenant_id=tenant_id
    )


@router.patch("/coord/composition-rules/{composition_rule_id}")
async def update_composition_rule(
    composition_rule_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Update a composition rule. Body forwarded verbatim. Tenant-admin only."""
    return await _proxy_coord_patch(
        f"/coord/composition-rules/{composition_rule_id}",
        body,
        tenant_id=tenant_id,
    )


@router.delete("/coord/composition-rules/{composition_rule_id}")
async def delete_composition_rule(
    composition_rule_id: str,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Delete a composition rule. Tenant-admin only."""
    return await _proxy_coord_delete(
        f"/coord/composition-rules/{composition_rule_id}", tenant_id=tenant_id
    )


# ---- Coord tenant-member management (admin-proxy) -------------------------
#
# Lets an authenticated coordination ADMIN manage coord tenant members +
# roles from the dashboard, forwarding their OWN Cognito bearer to coord
# (no separate service token). These proxy coord's ``/admin/coord/*``
# operator/group-role endpoints (``qontinui-coord/src/routes_phase3.rs``).
#
# Gate: ``require_coord_tenant_admin``. Coord's ``GET /admin/coord/me``
# computes ``is_admin`` as true iff the operator holds an admin/owner role
# in ANY of their tenants (routes_phase3.rs:2170-2194 — it folds every
# ``tenants[]`` row, not just the home tenant). So a Pizzeria-tenant admin
# whose HOME tenant is different is NOT wrongly 403'd at this web gate. The
# precise per-target authorization is coord's own re-check: the role
# write/delete handlers call ``caller_is_admin_in_tenant`` against the
# (possibly ``target_tenant_id``-named) target tenant and 403
# ``not_admin_in_target_tenant`` if the caller lacks admin THERE. Web gate
# (ANY-tenant admin) + coord per-target re-check is the correct pairing —
# the web layer keeps the routes from being silently open while coord
# enforces the exact target-tenant grant. Bodies pass through as
# ``dict[str, Any]``; coord validates shape + role enum and its 4xx errors
# surface verbatim.


@router.get("/coord/members")
async def get_coord_members(
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """List the caller's-tenant operators with their roles.

    Proxies coord ``GET /admin/coord/operators`` →
    ``{operators: [{operator_id, email, display_name, sso_provider,
    last_login_at, created_at, roles: [str]}]}`` (scoped to the caller's
    tenant by coord)."""
    return await _proxy_coord_get("/admin/coord/operators", tenant_id=tenant_id)


@router.post("/coord/members")
async def post_coord_member(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Create an operator in the caller's home tenant (pre-login invites OK).

    Proxies coord ``POST /admin/coord/operators``. Body:
    ``{email, display_name?, sso_subject, sso_provider, roles?: [str]}`` →
    ``{operator_id}``."""
    return await _proxy_coord_post("/admin/coord/operators", body, tenant_id=tenant_id)


@router.post("/coord/members/{operator_id}/roles")
async def post_coord_member_role(
    operator_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Grant a role to an operator.

    Proxies coord ``POST /admin/coord/operators/{operator_id}/roles``. Body:
    ``{role, target_tenant_id?}`` (role ∈
    ``operator|agent_supervisor|admin|owner``; ``target_tenant_id`` for a
    cross-tenant grant, which coord re-checks admin-in-target for) →
    ``{ok: true}``."""
    return await _proxy_coord_post(
        f"/admin/coord/operators/{operator_id}/roles", body, tenant_id=tenant_id
    )


@router.delete("/coord/members/{operator_id}/roles")
async def delete_coord_member_role(
    operator_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Revoke a role from an operator.

    Proxies coord ``DELETE /admin/coord/operators/{operator_id}/roles`` with
    a JSON body ``{role}`` → ``{ok: true}``. The body is forwarded on the
    DELETE via ``_proxy_coord_delete(body=...)`` (httpx ``request("DELETE",
    json=...)``); the role name is NOT dropped."""
    return await _proxy_coord_delete(
        f"/admin/coord/operators/{operator_id}/roles",
        body=body,
        tenant_id=tenant_id,
    )


@router.get("/coord/group-tenant-roles")
async def get_coord_group_tenant_roles(
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """List SSO-group → tenant → role mappings.

    Proxies coord ``GET /admin/coord/group-tenant-roles`` →
    ``{group_tenant_roles: [{group_id, tenant_slug, role, auto_create_tenant,
    created_at, tenant_id}]}``."""
    return await _proxy_coord_get(
        "/admin/coord/group-tenant-roles", tenant_id=tenant_id
    )


@router.post("/coord/group-tenant-roles")
async def post_coord_group_tenant_role(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Create an SSO-group → tenant → role mapping.

    Proxies coord ``POST /admin/coord/group-tenant-roles``. Body:
    ``{group_id, tenant_slug, role, auto_create_tenant}`` → mapping echo.
    Coord re-checks admin-in-target-tenant (or requires
    ``auto_create_tenant`` for an unresolved slug)."""
    return await _proxy_coord_post(
        "/admin/coord/group-tenant-roles", body, tenant_id=tenant_id
    )


@router.delete("/coord/group-tenant-roles")
async def delete_coord_group_tenant_role(
    body: dict[str, Any],
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Delete an SSO-group → tenant → role mapping.

    Proxies coord ``DELETE /admin/coord/group-tenant-roles`` with a JSON
    body ``{group_id, tenant_slug, role}`` → ``{ok, deleted}``. The body is
    forwarded on the DELETE via ``_proxy_coord_delete(body=...)``."""
    return await _proxy_coord_delete(
        "/admin/coord/group-tenant-roles",
        body=body,
        tenant_id=tenant_id,
    )


@router.get("/coord/my-tenants")
async def get_coord_my_tenants(
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> Any:
    """Return the caller's home tenant + all tenant memberships + per-tenant
    roles.

    Proxies coord ``GET /admin/coord/me``. Backs a tenant-switcher /
    cross-tenant role-grant picker in the member-management UI."""
    return await _proxy_coord_get("/admin/coord/me", tenant_id=tenant_id)


# ---- Cognito GROUP administration (superuser-gated) ----------------------
#
# Pool-wide Cognito group CRUD + membership management, completing fully
# in-dashboard provisioning: a superuser can create the SSO groups that
# coord's ``/admin/coord/group-tenant-roles`` mappings (above) reference,
# and add/remove members by email — all without leaving the dashboard or
# touching the AWS console. The web + coord share the SAME pool
# (``us-east-1_rgTB9dbZ1``), so a group created here flows straight into
# coord's ``cognito:groups`` token claim.
#
# Gated on ``require_admin`` (``is_superuser``), NOT the per-tenant
# ``require_coord_tenant_admin``: these are pool-wide operations that affect
# every tenant keyed off the shared pool, so they deserve the higher bar.
#
# The synchronous boto3 calls in ``cognito_admin`` are offloaded to a
# worker thread via ``asyncio.to_thread`` so they never block the event
# loop (same pattern as ``auth/identities.py``). Module exceptions map to
# HTTP codes here; boto3 ``ResourceNotFoundException`` (e.g. an unknown
# group) is detected in the error text and mapped to 404.


class _CreateGroupBody(BaseModel):
    """Body for ``POST /coord/cognito/groups``."""

    group_name: str = Field(..., min_length=1)
    description: str | None = None


class _GroupMemberBody(BaseModel):
    """Body for add/remove group-member by email."""

    email: str = Field(..., min_length=1)


def _is_resource_not_found(exc: CognitoAdminError) -> bool:
    """True when a wrapped boto3 error denotes a missing AWS resource."""
    message = str(exc)
    return "ResourceNotFoundException" in message or "not found" in message.lower()


@router.get("/coord/cognito/groups")
async def list_cognito_groups(
    current_user: UserModel = Depends(require_admin),
) -> dict[str, Any]:
    """List every Cognito group in the shared pool. Superuser-gated."""
    try:
        groups = await asyncio.to_thread(cognito_admin.list_groups)
    except CognitoAdminError as exc:
        logger.error("cognito_groups_list_failed", error=str(exc))
        raise HTTPException(status_code=502, detail="Could not list Cognito groups.")
    return {"groups": groups}


@router.post("/coord/cognito/groups")
async def create_cognito_group(
    body: _CreateGroupBody,
    current_user: UserModel = Depends(require_admin),
) -> dict[str, Any]:
    """Create a Cognito group. 409 if a group with that name already
    exists. Superuser-gated."""
    try:
        group = await asyncio.to_thread(
            cognito_admin.create_group, body.group_name, body.description
        )
    except CognitoGroupExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except CognitoAdminError as exc:
        logger.error(
            "cognito_group_create_failed",
            group_name=body.group_name,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Could not create Cognito group.")
    return group


@router.delete("/coord/cognito/groups/{group_name}")
async def delete_cognito_group(
    group_name: str,
    current_user: UserModel = Depends(require_admin),
) -> dict[str, Any]:
    """Delete a Cognito group. 404 if no such group. Superuser-gated."""
    try:
        await asyncio.to_thread(cognito_admin.delete_group, group_name)
    except CognitoAdminError as exc:
        if _is_resource_not_found(exc):
            raise HTTPException(status_code=404, detail=f"No such group: {group_name}")
        logger.error(
            "cognito_group_delete_failed", group_name=group_name, error=str(exc)
        )
        raise HTTPException(status_code=502, detail="Could not delete Cognito group.")
    return {"ok": True}


@router.get("/coord/cognito/groups/{group_name}/users")
async def list_cognito_group_users(
    group_name: str,
    current_user: UserModel = Depends(require_admin),
) -> dict[str, Any]:
    """List the members of a Cognito group. 404 if no such group.
    Superuser-gated."""
    try:
        users = await asyncio.to_thread(cognito_admin.list_users_in_group, group_name)
    except CognitoAdminError as exc:
        if _is_resource_not_found(exc):
            raise HTTPException(status_code=404, detail=f"No such group: {group_name}")
        logger.error(
            "cognito_group_users_list_failed",
            group_name=group_name,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Could not list group members.")
    return {"users": users}


@router.post("/coord/cognito/groups/{group_name}/users")
async def add_cognito_group_user(
    group_name: str,
    body: _GroupMemberBody,
    current_user: UserModel = Depends(require_admin),
) -> dict[str, Any]:
    """Add a user (resolved by email) to a Cognito group. Superuser-gated.

    404 if no user has that email; 409 if the email is ambiguous (>1 match).
    """
    try:
        username = await asyncio.to_thread(
            cognito_admin.resolve_username_for_email, body.email
        )
    except CognitoAmbiguousEmailError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except CognitoAdminError as exc:
        logger.error("cognito_email_resolve_failed", error=str(exc))
        raise HTTPException(status_code=502, detail="Could not resolve user by email.")
    if not username:
        raise HTTPException(status_code=404, detail=f"No user with email: {body.email}")

    try:
        await asyncio.to_thread(cognito_admin.add_user_to_group, username, group_name)
    except CognitoAdminError as exc:
        if _is_resource_not_found(exc):
            raise HTTPException(status_code=404, detail=f"No such group: {group_name}")
        logger.error(
            "cognito_group_add_user_failed",
            group_name=group_name,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Could not add user to group.")
    return {"ok": True, "username": username}


@router.delete("/coord/cognito/groups/{group_name}/users")
async def remove_cognito_group_user(
    group_name: str,
    body: _GroupMemberBody,
    current_user: UserModel = Depends(require_admin),
) -> dict[str, Any]:
    """Remove a user (resolved by email) from a Cognito group.
    Superuser-gated.

    404 if no user has that email; 409 if the email is ambiguous (>1 match).
    """
    try:
        username = await asyncio.to_thread(
            cognito_admin.resolve_username_for_email, body.email
        )
    except CognitoAmbiguousEmailError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except CognitoAdminError as exc:
        logger.error("cognito_email_resolve_failed", error=str(exc))
        raise HTTPException(status_code=502, detail="Could not resolve user by email.")
    if not username:
        raise HTTPException(status_code=404, detail=f"No user with email: {body.email}")

    try:
        await asyncio.to_thread(
            cognito_admin.remove_user_from_group, username, group_name
        )
    except CognitoAdminError as exc:
        if _is_resource_not_found(exc):
            raise HTTPException(status_code=404, detail=f"No such group: {group_name}")
        logger.error(
            "cognito_group_remove_user_failed",
            group_name=group_name,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail="Could not remove user from group.")
    return {"ok": True, "username": username}
