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

from pydantic import BaseModel, Field, field_validator, model_validator

# Mirror the migration's CHECK constraints.
MemoryKind = Literal[
    "observation",
    "fact",
    "mental_model",
    "episode",
    "feedback",
    "reference",
    "rule",
    "library",
]
MemoryScope = Literal["tenant", "runner", "agent", "session"]
# Mirror the coord.memory_links relation CHECK (coord_memory_links migration).
MemoryLinkRelation = Literal["depends_on", "implements", "supersedes", "related"]

# Batch + content caps (32 KB cap is app-enforced per the migration notes).
MAX_RECORDS_PER_REQUEST = 100
MAX_CONTENT_BYTES = 32 * 1024

# Query limits.
DEFAULT_QUERY_LIMIT = 8
MAX_QUERY_LIMIT = 50

# Synthesis-job claim: default + hard cap on jobs handed out per claim.
DEFAULT_SYNTHESIS_CLAIM_LIMIT = 4
MAX_SYNTHESIS_CLAIM_LIMIT = 4

# Graph traversal + list-endpoint limits.
DEFAULT_GRAPH_DEPTH = 3
MAX_GRAPH_DEPTH = 5
DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 500
MAX_LINKS_PER_RECORD = 32


class MemoryLinkIn(BaseModel):
    """One outbound edge declared alongside a record write.

    ``target_ref`` names the edge's target either by ``memory_id`` (UUID
    string) or by ``content_hash`` (sha256 hex of the target's stored
    content) — the write path tries the UUID interpretation first, then
    the hash, against LIVE rows of the caller's tenant only. Unresolved
    targets are dropped and counted, never rejected.
    """

    target_ref: str = Field(min_length=1, max_length=512)
    relation: MemoryLinkRelation
    description: str | None = Field(default=None, max_length=2048)


class MemoryRecordIn(BaseModel):
    """One record in a batch write."""

    title: str = Field(min_length=1, max_length=512)
    content: str = Field(min_length=1)
    kind: MemoryKind
    scope: MemoryScope = "tenant"
    scope_ref: str | None = Field(default=None, max_length=512)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    source: dict[str, Any] = Field(default_factory=dict)
    links: list[MemoryLinkIn] | None = Field(
        default=None, max_length=MAX_LINKS_PER_RECORD
    )

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
    # Links whose target_ref resolved to no LIVE record of the caller's
    # tenant (plus degenerate self-edges): dropped, never rejected.
    dropped_links_count: int = 0


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
    # Synthesis-job backlog (runner-paid consolidation, v1.1).
    synthesis_jobs_pending: int = 0
    synthesis_jobs_claimed: int = 0
    synthesis_jobs_done: int = 0
    synthesis_jobs_failed: int = 0


# --------------------------------------------------------------------------
# Graph layer (Librarian Phase 4) — POST /memory/graph + GET /memory/records
# --------------------------------------------------------------------------


class MemoryGraphRequest(BaseModel):
    """``POST /memory/graph`` body — bounded outbound traversal."""

    root_memory_id: UUID
    depth: int = Field(default=DEFAULT_GRAPH_DEPTH, ge=1, le=MAX_GRAPH_DEPTH)
    relation_filter: list[MemoryLinkRelation] | None = None


class MemoryGraphNode(BaseModel):
    """One record visited by the traversal (query-hit field shape)."""

    memory_id: UUID
    title: str
    content: str
    kind: str
    scope: str
    importance: float
    created_at: datetime
    source: dict[str, Any]


class MemoryGraphEdge(BaseModel):
    """One ``coord.memory_links`` edge among the visited nodes."""

    link_id: UUID
    source_id: UUID
    target_id: UUID
    relation: str
    description: str | None
    created_at: datetime


class MemoryGraphResponse(BaseModel):
    nodes: list[MemoryGraphNode]
    edges: list[MemoryGraphEdge]


class MemoryLinkOut(BaseModel):
    """One outbound edge hydrated onto a listed record."""

    link_id: UUID
    target_id: UUID
    relation: str
    description: str | None
    created_at: datetime


class MemoryRecordOut(BaseModel):
    """One record in a ``GET /memory/records`` page.

    The query-hit field shape plus sync-relevant extras
    (``scope_ref`` / ``content_hash`` / ``updated_at``) and the record's
    outbound ``links``.
    """

    memory_id: UUID
    title: str
    content: str
    kind: str
    scope: str
    scope_ref: str | None
    importance: float
    content_hash: str
    created_at: datetime
    updated_at: datetime
    source: dict[str, Any]
    links: list[MemoryLinkOut]


class ListRecordsResponse(BaseModel):
    """``GET /memory/records`` — one keyset page, newest-first-stable."""

    records: list[MemoryRecordOut]
    # Opaque keyset cursor for the next (older) page; None on the last page.
    next_cursor: str | None


# --------------------------------------------------------------------------
# Synthesis jobs (v1.1) — backend clusters, runner synthesizes, backend applies
# --------------------------------------------------------------------------


class ClaimSynthesisJobsRequest(BaseModel):
    """``POST /memory/synthesis-jobs/claim`` body."""

    limit: int = Field(
        default=DEFAULT_SYNTHESIS_CLAIM_LIMIT, ge=1, le=MAX_SYNTHESIS_CLAIM_LIMIT
    )


class SynthesisJobOut(BaseModel):
    """One claimed job — exactly what the runner needs to synthesize.

    The runner distills ``member_texts`` into a single mental-model text
    and posts it back to ``/synthesis-jobs/{job_id}/result``; it never
    reads the memory store directly.
    """

    job_id: UUID
    member_texts: list[str]


class ClaimSynthesisJobsResponse(BaseModel):
    jobs: list[SynthesisJobOut]


class SynthesisResultRequest(BaseModel):
    """``POST /memory/synthesis-jobs/{job_id}/result`` body.

    Exactly one of ``result_text`` (success — the synthesized model) or
    ``failure`` (the runner could not synthesize; the reason) must be
    set.
    """

    result_text: str | None = Field(default=None, min_length=1)
    failure: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _exactly_one(self) -> SynthesisResultRequest:
        if (self.result_text is None) == (self.failure is None):
            raise ValueError(
                "provide exactly one of 'result_text' (success) or 'failure' (reason)"
            )
        return self


class SynthesisResultResponse(BaseModel):
    # "applied" on the success path (mental_model inserted), "recorded"
    # on the failure path (job marked failed).
    status: Literal["applied", "recorded"]
