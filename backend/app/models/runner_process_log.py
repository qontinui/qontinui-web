"""Read-only Pydantic schemas for the runner's process_sessions / output tables.

These are NOT SQLAlchemy ORM models — the runner DB is queried directly via
asyncpg in `app.db.runner_db` because:

1. The runner owns the schema (migrations live in qontinui-runner).
2. The data is read-only from the backend's perspective.
3. The runner uses `search_path = runner, public`, so binding via SQLAlchemy
   metadata reflection adds complexity for no benefit.

Schemas mirror the Rust types in `database/types.rs` (ProcessSession,
ProcessSessionOutputLine, ProcessLogSearchHit).
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class RunnerProcessSession(BaseModel):
    id: str
    process_config_id: str
    process_name: str
    started_at: Optional[str] = None
    stopped_at: Optional[str] = None
    exit_code: Optional[int] = None
    state: str
    error_count: int = 0


class RunnerProcessSessionOutputLine(BaseModel):
    id: int
    session_id: str
    timestamp: str
    stream: str
    line: str


class RunnerProcessLogSearchHit(BaseModel):
    id: int
    session_id: str
    timestamp: str
    stream: str
    line: str
    process_config_id: str
    process_name: str
