"""
Drift report endpoints — Section 11, Phase D2 follow-up.

Surfaces drift entries for a given run for the qontinui-web drift dashboard.
The drift reports themselves are produced and persisted on the runner side
(see `qontinui-runner/src-tauri/src/database/pg/regression.rs`); the canonical
storage lives in the runner's PostgreSQL database, not the qontinui-web
backend's own DB.

CURRENT STATE — placeholder routes
==================================
The runner does not yet expose `/runs/:runId/drift` over HTTP, so we cannot
proxy here. Until that runner endpoint lands, these routes return a
deterministic "no drift entries available" payload (empty list for the
listing endpoint, 404 for the detail endpoint). The frontend pages render
the appropriate empty state instead of surfacing a network error.

TODO (follow-up work)
=====================
1. Add a runner HTTP endpoint:
     GET /runs/:runId/drift
     GET /runs/:runId/drift/:entryId
   These should query the runner's PG `regression_diagnoses` /
   `regression_assertion_executions` tables (or a new `drift_*` table)
   and return the contract documented in
   `qontinui-web/frontend/src/components/testing/drift/drift-api.ts`.

2. Replace the placeholders below with an httpx-based proxy to the runner
   on port 9876, mirroring the pattern in `runner_logs.py`. Auth flows
   through the same runner-token middleware.

3. Optionally cache the proxy responses or replicate into a qontinui-web
   side table for offline browsing — defer until usage justifies it.
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, status

logger = structlog.get_logger(__name__)
router = APIRouter()


@router.get(
    "/{run_id}/drift",
    summary="List drift entries for a run",
    description=(
        "Returns the drift report for a run. Currently a placeholder — the "
        "runner-side HTTP proxy has not yet been wired up, so this returns "
        "an empty entries list. Frontend renders the empty state."
    ),
)
async def list_drift_entries(run_id: str) -> dict[str, Any]:
    """Return placeholder drift report.

    Once the runner-side `/runs/:runId/drift` endpoint exists, replace this
    body with an httpx GET against the runner and forward the response.
    """
    logger.info(
        "drift list endpoint hit (placeholder — returns empty)",
        run_id=run_id,
    )
    return {"runId": run_id, "entries": []}


@router.get(
    "/{run_id}/drift/{entry_id}",
    summary="Get a single drift entry",
    description=(
        "Returns a single drift entry by id. Currently a placeholder — "
        "always returns 404 until the runner-side proxy lands."
    ),
)
async def get_drift_entry(run_id: str, entry_id: str) -> dict[str, Any]:
    """Return 404 for any drift entry id.

    Once the runner-side `/runs/:runId/drift/:entryId` endpoint exists,
    replace this body with an httpx GET against the runner and forward
    the response.
    """
    logger.info(
        "drift detail endpoint hit (placeholder — returns 404)",
        run_id=run_id,
        entry_id=entry_id,
    )
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=(
            f"Drift entry {entry_id} not found for run {run_id}. "
            "Drift report proxy is not yet wired up to the runner."
        ),
    )
