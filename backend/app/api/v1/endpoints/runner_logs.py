"""Proxy endpoints exposing the qontinui-runner's persisted process logs.

The runner stores stdout/stderr from spawned processes into its own PostgreSQL
database (tables `process_sessions` and `process_session_output`, schema
`runner`). These endpoints let the mobile app — and any other authenticated
client — read those logs without needing a runner UI window open or a direct
Tauri IPC connection.

All endpoints are read-only and require an authenticated user.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_active_user_async
from app.db.runner_db import get_runner_pool
from app.models.runner_process_log import (
    RunnerProcessLogSearchHit,
    RunnerProcessSession,
    RunnerProcessSessionOutputLine,
)
from app.models.user import User

logger = structlog.get_logger(__name__)
router = APIRouter()


def _row_to_session(row) -> RunnerProcessSession:
    return RunnerProcessSession(
        id=row["id"],
        process_config_id=row["process_config_id"],
        process_name=row["process_name"],
        started_at=str(row["started_at"]) if row["started_at"] is not None else None,
        stopped_at=str(row["stopped_at"]) if row["stopped_at"] is not None else None,
        exit_code=row["exit_code"],
        state=row["state"],
        error_count=int(row["error_count"] or 0),
    )


def _row_to_line(row) -> RunnerProcessSessionOutputLine:
    return RunnerProcessSessionOutputLine(
        id=int(row["id"]),
        session_id=row["session_id"],
        timestamp=str(row["timestamp"]),
        stream=row["stream"],
        line=row["line"],
    )


@router.get(
    "/sessions",
    response_model=list[RunnerProcessSession],
    summary="List runner process sessions",
)
async def list_runner_process_sessions(
    config_id: str | None = Query(None, description="Filter by process_config_id"),
    limit: int = Query(20, ge=1, le=500),
    _user: User = Depends(get_current_active_user_async),
) -> list[RunnerProcessSession]:
    pool = await get_runner_pool()
    try:
        async with pool.acquire() as conn:
            if config_id is not None:
                rows = await conn.fetch(
                    """
                    SELECT id, process_config_id, process_name, started_at, stopped_at,
                           exit_code, state, error_count
                    FROM process_sessions
                    WHERE process_config_id = $1
                    ORDER BY started_at DESC
                    LIMIT $2
                    """,
                    config_id,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT id, process_config_id, process_name, started_at, stopped_at,
                           exit_code, state, error_count
                    FROM process_sessions
                    ORDER BY started_at DESC
                    LIMIT $1
                    """,
                    limit,
                )
    except Exception as e:
        logger.error("runner_logs_list_sessions_failed", error=str(e))
        raise HTTPException(status_code=503, detail=f"Runner DB unavailable: {e}")
    return [_row_to_session(r) for r in rows]


@router.get(
    "/sessions/{session_id}/output",
    response_model=list[RunnerProcessSessionOutputLine],
    summary="Get output lines for a runner process session",
)
async def get_runner_process_session_output(
    session_id: str,
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    _user: User = Depends(get_current_active_user_async),
) -> list[RunnerProcessSessionOutputLine]:
    pool = await get_runner_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, session_id, timestamp, stream, line
                FROM process_session_output
                WHERE session_id = $1
                ORDER BY id ASC
                LIMIT $2 OFFSET $3
                """,
                session_id,
                limit,
                offset,
            )
    except Exception as e:
        logger.error(
            "runner_logs_get_output_failed", error=str(e), session_id=session_id
        )
        raise HTTPException(status_code=503, detail=f"Runner DB unavailable: {e}")
    return [_row_to_line(r) for r in rows]


@router.get(
    "/search",
    response_model=list[RunnerProcessLogSearchHit],
    summary="Search runner process log lines (ILIKE)",
)
async def search_runner_process_logs(
    q: str = Query(
        ..., min_length=1, description="Substring to search for (case-insensitive)"
    ),
    config_id: str | None = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    _user: User = Depends(get_current_active_user_async),
) -> list[RunnerProcessLogSearchHit]:
    pattern = (
        "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    )
    pool = await get_runner_pool()
    try:
        async with pool.acquire() as conn:
            if config_id is not None:
                rows = await conn.fetch(
                    """
                    SELECT pso.id, pso.session_id, pso.timestamp, pso.stream, pso.line,
                           ps.process_config_id, ps.process_name
                    FROM process_session_output pso
                    JOIN process_sessions ps ON pso.session_id = ps.id
                    WHERE pso.line ILIKE $1
                      AND ps.process_config_id = $2
                    ORDER BY pso.id DESC
                    LIMIT $3
                    """,
                    pattern,
                    config_id,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT pso.id, pso.session_id, pso.timestamp, pso.stream, pso.line,
                           ps.process_config_id, ps.process_name
                    FROM process_session_output pso
                    JOIN process_sessions ps ON pso.session_id = ps.id
                    WHERE pso.line ILIKE $1
                    ORDER BY pso.id DESC
                    LIMIT $2
                    """,
                    pattern,
                    limit,
                )
    except Exception as e:
        logger.error("runner_logs_search_failed", error=str(e))
        raise HTTPException(status_code=503, detail=f"Runner DB unavailable: {e}")
    return [
        RunnerProcessLogSearchHit(
            id=int(r["id"]),
            session_id=r["session_id"],
            timestamp=str(r["timestamp"]),
            stream=r["stream"],
            line=r["line"],
            process_config_id=r["process_config_id"],
            process_name=r["process_name"],
        )
        for r in rows
    ]
