"""
Constraint engine proxy endpoints.

Proxies constraint-related requests to the runner's HTTP API (localhost:9876).
The constraint engine lives in the runner; the web backend simply forwards
requests so the Next.js frontend can reach it via the FastAPI backend.
"""

from typing import Any

import httpx
import structlog
from app.api.deps import current_active_user
from app.models.user import User
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

logger = structlog.get_logger(__name__)
router = APIRouter()

RUNNER_BASE_URL = "http://localhost:9876"
_TIMEOUT = httpx.Timeout(15.0)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class WriteConfigRequest(BaseModel):
    project_path: str | None = None
    toml: str


class ValidateConfigRequest(BaseModel):
    toml: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _proxy_get(path: str, params: dict[str, Any] | None = None) -> Any:
    """Proxy a GET request to the runner and return the JSON body."""
    url = f"{RUNNER_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.get(url, params=params)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="Runner is not reachable. Is the desktop runner running?",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="Timeout waiting for runner response",
            )

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


async def _proxy_post(path: str, body: dict[str, Any]) -> Any:
    """Proxy a POST request to the runner and return the JSON body."""
    url = f"{RUNNER_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.post(url, json=body)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=502,
                detail="Runner is not reachable. Is the desktop runner running?",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="Timeout waiting for runner response",
            )

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/active",
    summary="Get active constraints",
    description="Proxy to runner: returns active constraints for a project path.",
)
async def get_active_constraints(
    project_path: str = Query(..., description="Absolute path to the project"),
    current_user: User = Depends(current_active_user),
) -> Any:
    return await _proxy_get(
        "/constraints/active", params={"project_path": project_path}
    )


@router.get(
    "/config",
    summary="Get constraint config",
    description="Proxy to runner: returns the constraint TOML config for a project path.",
)
async def get_constraint_config(
    project_path: str = Query(..., description="Absolute path to the project"),
    current_user: User = Depends(current_active_user),
) -> Any:
    return await _proxy_get(
        "/constraints/config", params={"project_path": project_path}
    )


@router.post(
    "/config",
    summary="Write constraint config",
    description="Proxy to runner: writes a new constraint TOML config.",
)
async def write_constraint_config(
    body: WriteConfigRequest,
    current_user: User = Depends(current_active_user),
) -> Any:
    return await _proxy_post(
        "/constraints/config",
        body=body.model_dump(exclude_none=True),
    )


@router.post(
    "/validate",
    summary="Validate constraint config",
    description="Proxy to runner: validates a TOML config string without writing it.",
)
async def validate_constraint_config(
    body: ValidateConfigRequest,
    current_user: User = Depends(current_active_user),
) -> Any:
    return await _proxy_post("/constraints/validate", body=body.model_dump())


@router.get(
    "/results/{task_run_id}",
    summary="Get constraint results",
    description="Proxy to runner: returns constraint evaluation results for a task run.",
)
async def get_constraint_results(
    task_run_id: str,
    iteration: int | None = Query(None, description="Filter by iteration number"),
    current_user: User = Depends(current_active_user),
) -> Any:
    params: dict[str, Any] = {}
    if iteration is not None:
        params["iteration"] = iteration
    return await _proxy_get(f"/constraints/results/{task_run_id}", params=params)
