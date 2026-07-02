"""Condition-groups (regression-tests) API — tenant-user coord proxy.

Backs the tenant-user "condition groups" page. The frontend calls these
routes on the qontinui-web FastAPI backend, which PROXIES each one to the
Rust coord service (``/coord/condition-groups`` + ``/coord/conditions`` +
``/coord/condition-runs``).

Auth posture: every route depends on ``get_tenant_id`` — ANY authenticated
user, scoped to their resolved coord tenant. This is deliberately NOT the
superuser/admin gate (``require_coord_tenant_admin`` /
``get_current_superuser``): condition groups are a normal tenant-user
surface, not an operator-only one. ``get_tenant_id`` resolves the
user → operator → tenant chain and, as a side effect, captures the caller's
Cognito bearer into a request-scoped ContextVar so the proxy helpers forward
it to coord (which authorizes on the bearer's operator identity and scopes
its SQL to the bearer's tenant).

The proxy helpers (``_proxy_coord_get`` / ``_post`` / ``_patch`` /
``_delete``) are imported from ``operations`` — their canonical home — so the
existing test suite's ``operations.httpx.AsyncClient`` patch target keeps
working and there is no third private copy of the coord plumbing.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.v1.endpoints.operations import (
    _proxy_coord_delete,
    _proxy_coord_get,
    _proxy_coord_patch,
    _proxy_coord_post,
    get_tenant_id,
)

router = APIRouter()


# ---- Condition groups -----------------------------------------------------


@router.get("/groups")
async def list_condition_groups(
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List the calling tenant's condition groups.

    Proxies coord's ``GET /coord/condition-groups``. Tenant-scoped: coord
    resolves the tenant from the forwarded operator bearer.
    """
    return await _proxy_coord_get("/coord/condition-groups", tenant_id=tenant_id)


@router.post("/groups")
async def create_condition_group(
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Create a condition group.

    Proxies coord's ``POST /coord/condition-groups`` with the request body
    forwarded verbatim.
    """
    return await _proxy_coord_post(
        "/coord/condition-groups",
        body,
        tenant_id=tenant_id,
    )


@router.get("/groups/{group_id}")
async def get_condition_group(
    group_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single condition group (with its conditions).

    Proxies coord's ``GET /coord/condition-groups/{group_id}``.
    """
    return await _proxy_coord_get(
        f"/coord/condition-groups/{group_id}",
        tenant_id=tenant_id,
    )


@router.patch("/groups/{group_id}")
async def update_condition_group(
    group_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Update a condition group's fields.

    Proxies coord's ``PATCH /coord/condition-groups/{group_id}``.
    """
    return await _proxy_coord_patch(
        f"/coord/condition-groups/{group_id}",
        body,
        tenant_id=tenant_id,
    )


@router.delete("/groups/{group_id}")
async def delete_condition_group(
    group_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Delete a condition group.

    Proxies coord's ``DELETE /coord/condition-groups/{group_id}``.
    """
    return await _proxy_coord_delete(
        f"/coord/condition-groups/{group_id}",
        tenant_id=tenant_id,
    )


# ---- Conditions (items within a group) ------------------------------------


@router.post("/groups/{group_id}/conditions")
async def add_condition(
    group_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Add a condition to a group.

    Proxies coord's ``POST /coord/condition-groups/{group_id}/conditions``.
    """
    return await _proxy_coord_post(
        f"/coord/condition-groups/{group_id}/conditions",
        body,
        tenant_id=tenant_id,
    )


@router.patch("/items/{condition_id}")
async def update_condition(
    condition_id: str,
    body: dict[str, Any],
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Update a single condition.

    Proxies coord's ``PATCH /coord/conditions/{condition_id}``.
    """
    return await _proxy_coord_patch(
        f"/coord/conditions/{condition_id}",
        body,
        tenant_id=tenant_id,
    )


@router.delete("/items/{condition_id}")
async def delete_condition(
    condition_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Delete a single condition.

    Proxies coord's ``DELETE /coord/conditions/{condition_id}``.
    """
    return await _proxy_coord_delete(
        f"/coord/conditions/{condition_id}",
        tenant_id=tenant_id,
    )


# ---- Runs -----------------------------------------------------------------


@router.post("/groups/{group_id}/run")
async def run_condition_group(
    group_id: str,
    body: dict[str, Any] | None = None,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Trigger a regression run of a condition group.

    Proxies coord's ``POST /coord/condition-groups/{group_id}/run``. The
    body is optional (run options); an empty object is forwarded when the
    caller sends none.
    """
    return await _proxy_coord_post(
        f"/coord/condition-groups/{group_id}/run",
        body or {},
        tenant_id=tenant_id,
    )


@router.get("/groups/{group_id}/runs")
async def list_condition_group_runs(
    group_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """List past runs for a condition group.

    Proxies coord's ``GET /coord/condition-groups/{group_id}/runs``.
    """
    return await _proxy_coord_get(
        f"/coord/condition-groups/{group_id}/runs",
        tenant_id=tenant_id,
    )


@router.get("/runs/{run_id}")
async def get_condition_run(
    run_id: str,
    tenant_id: UUID = Depends(get_tenant_id),
) -> Any:
    """Return a single condition run's detail/results.

    Proxies coord's ``GET /coord/condition-runs/{run_id}``.
    """
    return await _proxy_coord_get(
        f"/coord/condition-runs/{run_id}",
        tenant_id=tenant_id,
    )
