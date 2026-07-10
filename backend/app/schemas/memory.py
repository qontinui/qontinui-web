"""Request/response schemas for the tenant agentic-memory API.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

The wire contract for ``/api/v1/memory/*``. ``kind`` / ``scope`` values
mirror the CHECK constraints in the ``coord_memory_records`` migration.
Tenant identity is NEVER part of these schemas — it comes exclusively
from the server-side principal (see ``get_memory_tenant``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Mirror the migration's CHECK constraints.
MemoryKind = Literal[
    "observation",
    "fact",
    "mental_model",
    "episode",
    "feedback",
    "reference",
    "rule",
]
MemoryScope = Literal["tenant", "runner", "agent", "session"]

# Batch + content caps (32 KB cap is app-enforced per the migration notes).
MAX_RECORDS_PER_REQUEST = 100
MAX_CONTENT_BYTES = 32 * 1024

# Query limits.
DEFAULT_QUERY_LIMIT = 8
MAX_QUERY_LIMIT = 50


class MemoryRecordIn(BaseModel):
    """One record in a batch write."""

    title: str = Field(min_length=1, max_length=512)
    content: str = Field(min_length=1)
    kind: MemoryKind
    scope: MemoryScope = "tenant"
    scope_ref: str | None = Field(default=None, max_length=512)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    source: dict[str, Any] = Field(default_factory=dict)

    @field_validator("content")
    @classmethod
    def _content_within_cap(cls, v: str) -> str:
        size = len(v.encode("utf-8"))
        if size > MAX_CONTENT_BYTES:
            raise ValueError(
                f"content is {size} bytes; the cap is {MAX_CONTENT_BYTES} "
                "bytes per record"
            )
        return v


class WriteRecordsRequest(BaseModel):
    """``POST /memory/records`` body — a batch of at most 100 records."""

    records: list[MemoryRecordIn] = Field(
        min_length=1, max_length=MAX_RECORDS_PER_REQUEST
    )


class WriteRecordResult(BaseModel):
    """Per-record outcome, in request order."""

    memory_id: UUID
    deduped: bool


class WriteRecordsResponse(BaseModel):
    records: list[WriteRecordResult]
    deduped_count: int


class MemoryQueryRequest(BaseModel):
    """``POST /memory/query`` body — hybrid RRF retrieval parameters."""

    query_text: str = Field(min_length=1, max_length=8192)
    kinds: list[MemoryKind] | None = None
    scopes: list[MemoryScope] | None = None
    # Required to see any `agent`/`session`-scoped rows: those are only
    # returned when `scopes` names them AND their scope_ref equals this.
    scope_ref: str | None = Field(default=None, max_length=512)
    since: datetime | None = None
    as_of: datetime | None = None
    min_importance: float | None = Field(default=None, ge=0.0, le=1.0)
    limit: int = Field(default=DEFAULT_QUERY_LIMIT, ge=1, le=MAX_QUERY_LIMIT)


class MemoryQueryHit(BaseModel):
    """One fused retrieval hit."""

    memory_id: UUID
    title: str
    content: str
    kind: str
    scope: str
    importance: float
    created_at: datetime
    source: dict[str, Any]
    rrf_score: float
    vector_rank: int | None = None
    fts_rank: int | None = None
    cosine_similarity: float | None = None


class MemoryQueryResponse(BaseModel):
    hits: list[MemoryQueryHit]


class SupersedeRequest(BaseModel):
    """``POST /memory/records/{id}/supersede`` body.

    ``title``/``content`` are the replacement; every omitted field is
    inherited from the record being superseded.
    """

    title: str = Field(min_length=1, max_length=512)
    content: str = Field(min_length=1)
    kind: MemoryKind | None = None
    scope: MemoryScope | None = None
    scope_ref: str | None = Field(default=None, max_length=512)
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    source: dict[str, Any] | None = None

    @field_validator("content")
    @classmethod
    def _content_within_cap(cls, v: str) -> str:
        size = len(v.encode("utf-8"))
        if size > MAX_CONTENT_BYTES:
            raise ValueError(
                f"content is {size} bytes; the cap is {MAX_CONTENT_BYTES} "
                "bytes per record"
            )
        return v


class SupersedeResponse(BaseModel):
    memory_id: UUID
    superseded_memory_id: UUID
    deduped: bool


class MemoryStatsResponse(BaseModel):
    """``GET /memory/stats`` — usage + quota posture for the tenant."""

    row_count: int
    bytes: int
    embedding_coverage: float
    quota_bytes: int
    quota_rows: int
    quota_utilization: float
