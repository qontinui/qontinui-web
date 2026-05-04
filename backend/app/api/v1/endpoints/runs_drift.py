"""
Drift report proxy endpoints — Section 11 follow-up FU-3.

Forwards qontinui-web frontend drift requests to the runner's HTTP API on
localhost:9876 (`/runs/:run_id/drift[/:entry_id]`, see
`qontinui-runner/src-tauri/src/regression_api/handlers.rs`). Pass-through
of the persisted `drift_report_json` blob from `regression_runs`.

The runner is the canonical store for drift reports. We don't replicate
into qontinui-web's own DB — the proxy returns 503 if the runner is
unreachable and 404 if it has nothing for this run.
"""

from __future__ import annotations

from typing import Any

import httpx
import structlog
from fastapi import APIRouter, HTTPException, status

logger = structlog.get_logger(__name__)
router = APIRouter()

RUNNER_BASE_URL = "http://localhost:9876"
_TIMEOUT = httpx.Timeout(10.0)


async def _proxy_get(path: str) -> dict[str, Any]:
    """GET the runner endpoint, return its `data` payload, raise on failure."""
    url = f"{RUNNER_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.get(url)
        except httpx.ConnectError as exc:
            logger.warning("runner connect error in drift proxy", path=path, error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Runner HTTP API is unreachable. "
                    "Confirm the runner is up and listening on port 9876."
                ),
            ) from exc

    if resp.status_code == status.HTTP_404_NOT_FOUND:
        body = resp.json() if resp.content else {}
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=body.get("error", "drift-not-found"),
        )

    if resp.status_code >= 400:
        body = resp.json() if resp.content else {}
        raise HTTPException(
            status_code=resp.status_code,
            detail=body.get("error", f"runner returned {resp.status_code}"),
        )

    body = resp.json()
    if not isinstance(body, dict) or not body.get("success", False):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=body.get("error", "runner response envelope malformed"),
        )

    data = body.get("data")
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="runner data payload missing or wrong shape",
        )
    return data


@router.get(
    "/{run_id}/drift",
    summary="List drift entries for a run",
    description=(
        "Forwards to the runner's `/runs/:run_id/drift` endpoint and returns "
        "the persisted `DriftReport`. The runner stores the report on the "
        "`regression_runs.drift_report_json` column at run-record time. "
        "Returns 404 when no drift report exists for the run."
    ),
)
async def list_drift_entries(run_id: str) -> dict[str, Any]:
    data = await _proxy_get(f"/runs/{run_id}/drift")
    # Frontend's `DriftReportView` shape: `{ runId, entries }`. The runner
    # returns `{ entries }` (it doesn't echo the run id back, since the
    # caller already has it). Re-wrap so the frontend contract holds.
    entries = data.get("entries", [])
    return {"runId": run_id, "entries": entries}


@router.get(
    "/{run_id}/drift/{entry_id}",
    summary="Get a single drift entry",
    description=(
        "Forwards to the runner's `/runs/:run_id/drift/:entry_id` endpoint "
        "and returns the matched entry. 404 when the entry id is not "
        "present in the persisted report."
    ),
)
async def get_drift_entry(run_id: str, entry_id: str) -> dict[str, Any]:
    return await _proxy_get(f"/runs/{run_id}/drift/{entry_id}")
