"""Request/response schemas for the tenant agentic-memory API.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

The wire contract for ``/api/v1/memory/*``. ``kind`` / ``scope`` values
mirror the CHECK constraints in the ``coord_memory_records`` migration.
Tenant identity is NEVER part of these schemas — it comes exclusively
from the server-side principal (see ``get_memory_tenant``).

Embeddings are **client-supplied** (Phase 1 of
``2026-07-13-runner-paid-embedding``): the backend never embeds on the
request path. A caller either sends a vector it computed itself (which
must be ``EMBEDDING_DIM``-dimensional and carry an accepted model tag —
anything else is a loud 422, never a silent wrong-space write) or omits
it, in which case the row is stored with a NULL embedding, stays
immediately retrievable through the FTS arm, and is vectorized later by
the reindex sweep (``fetch_reindex_batch`` already targets NULL-embedding
rows). There is no server-side embed fallback.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.memory_vectors import ACCEPTED_EMBEDDING_MODEL_TAGS, EMBEDDING_DIM

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

# The job queue's dispatch discriminator — mirrors the CHECK on
# ``coord.memory_jobs.kind``.
JobKind = Literal["synthesis", "embedding"]
JOB_KINDS: tuple[JobKind, ...] = ("synthesis", "embedding")

# Batch + content caps (32 KB cap is app-enforced per the migration notes).
MAX_RECORDS_PER_REQUEST = 100
MAX_CONTENT_BYTES = 32 * 1024

# Query limits.
DEFAULT_QUERY_LIMIT = 8
MAX_QUERY_LIMIT = 50

# Job claim: default + hard cap on jobs handed out per claim.
DEFAULT_JOB_CLAIM_LIMIT = 4
MAX_JOB_CLAIM_LIMIT = 4

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


def check_embedding_dim(vector: list[float] | None, *, field: str) -> None:
    """Reject a wrong-dimensional vector before it can reach pgvector.

    The ``vector(384)`` column would reject it too, but with an opaque
    driver error at insert time; this raises a caller-actionable one that
    names the received length (→ 422).
    """
    if vector is not None and len(vector) != EMBEDDING_DIM:
        raise ValueError(
            f"{field} has {len(vector)} components; this server stores "
            f"{EMBEDDING_DIM}-dimensional vectors "
            f"(accepted models: {sorted(ACCEPTED_EMBEDDING_MODEL_TAGS)})"
        )


def check_embedding_input(
    embedding: list[float] | None,
    embedding_model: str | None,
    *,
    field: str = "embedding",
    model_field: str = "embedding_model",
) -> None:
    """Validate a client-supplied ``(embedding, embedding_model)`` pair.

    A vector without its tag is unattributable — for a WRITE the reindex
    sweep keys off the tag; for a QUERY the server cannot tell which
    space the incoming vector is in, and an untagged foreign vector would
    be cosine-compared against MiniLM ones (the silent-wrong-space class
    this plan exists to kill). A tag without a vector is a caller bug.
    Both are rejected rather than half-applied. An unrecognized tag is
    rejected because its vectors live in a different space. Omitting BOTH
    is the supported graceful-degradation path: a NULL-embedding row on
    write, an FTS-only (``skipped_no_embedding``) result on query.

    ``field`` / ``model_field`` name the pair in the raised errors, so a
    ``/query`` rejection talks about ``query_embedding`` rather than
    about a write's ``embedding``.
    """
    check_embedding_dim(embedding, field=field)
    if embedding is not None and embedding_model is None:
        raise ValueError(
            f"{model_field} is required whenever {field!r} is supplied; "
            f"accepted tags: {sorted(ACCEPTED_EMBEDDING_MODEL_TAGS)}"
        )
    if embedding is None and embedding_model is not None:
        raise ValueError(
            f"{model_field} was supplied without an {field!r} vector; "
            "send both or neither"
        )
    if embedding_model is not None and embedding_model not in (
        ACCEPTED_EMBEDDING_MODEL_TAGS
    ):
        raise ValueError(
            f"{model_field} {embedding_model!r} is not accepted by this "
            f"server; accepted tags: {sorted(ACCEPTED_EMBEDDING_MODEL_TAGS)}"
        )


class MemoryRecordIn(BaseModel):
    """One record in a batch write.

    ``embedding`` is computed by the CALLER. Omit it (with
    ``embedding_model``) to store the row unvectorized — it is still
    retrievable via FTS and is picked up by the reindex sweep.
    """

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
    embedding: list[float] | None = None
    embedding_model: str | None = None

    @model_validator(mode="after")
    def _embedding_input_valid(self) -> MemoryRecordIn:
        check_embedding_input(self.embedding, self.embedding_model)
        return self

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
    """``POST /memory/query`` body — hybrid RRF retrieval parameters.

    ``query_text`` is ALWAYS required: the lexical arm is pure Postgres
    (``websearch_to_tsquery``), costs the caller nothing, and stays
    server-side. ``query_embedding`` is the caller's own vector for the
    semantic arm — omit it and that arm is SKIPPED (the response says so
    via ``vector_arm``); the query degrades to FTS-only rather than
    making the backend embed.

    ``query_embedding_model`` is REQUIRED whenever ``query_embedding`` is
    present. Validating the vector's DIMENSION is not enough: every
    384-dim model would pass that check while living in a different
    space, and the server has no other way to tell which space an
    incoming query is in.
    """

    query_text: str = Field(min_length=1, max_length=8192)
    query_embedding: list[float] | None = None
    query_embedding_model: str | None = None
    kinds: list[MemoryKind] | None = None
    scopes: list[MemoryScope] | None = None
    # Required to see any `agent`/`session`-scoped rows: those are only
    # returned when `scopes` names them AND their scope_ref equals this.
    scope_ref: str | None = Field(default=None, max_length=512)
    since: datetime | None = None
    as_of: datetime | None = None
    min_importance: float | None = Field(default=None, ge=0.0, le=1.0)
    limit: int = Field(default=DEFAULT_QUERY_LIMIT, ge=1, le=MAX_QUERY_LIMIT)

    @model_validator(mode="after")
    def _query_embedding_input_valid(self) -> MemoryQueryRequest:
        check_embedding_input(
            self.query_embedding,
            self.query_embedding_model,
            field="query_embedding",
            model_field="query_embedding_model",
        )
        return self


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
    """``POST /memory/query`` result.

    ``vector_arm`` is REQUIRED and un-defaulted on purpose: FTS-only
    results must never be indistinguishable from hybrid ones. Its three
    states are the only ways a query can end:

    * ``hybrid`` — both arms ran and were RRF-fused.
    * ``skipped_no_embedding`` — the caller sent no ``query_embedding``,
      so the semantic arm had no vector to run with.
    * ``skipped_migrating`` — the caller DID send a vector, but this
      tenant still holds vectors written under a different model tag, so
      scoring against that mixed corpus would compare across two
      non-interchangeable spaces (Phase 0 measured min cosine 0.71 /
      k=10 exact-order 0% between them). The arm is skipped until the
      runner-paid reindex drains the tenant back to a single space. This
      is driven off actual corpus state, never a timer or a flag, so it
      clears itself the moment the last foreign-tag vector is rewritten.
    """

    hits: list[MemoryQueryHit]
    vector_arm: Literal["hybrid", "skipped_no_embedding", "skipped_migrating"]


class SupersedeRequest(BaseModel):
    """``POST /memory/records/{id}/supersede`` body.

    ``title``/``content`` are the replacement; every omitted field is
    inherited from the record being superseded. ``embedding`` is NOT
    inherited — it belongs to the OLD content and would be a lie about
    the new one; omit it and the successor lands unvectorized (NULL) for
    the reindex sweep to pick up.
    """

    title: str = Field(min_length=1, max_length=512)
    content: str = Field(min_length=1)
    kind: MemoryKind | None = None
    scope: MemoryScope | None = None
    scope_ref: str | None = Field(default=None, max_length=512)
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    source: dict[str, Any] | None = None
    embedding: list[float] | None = None
    embedding_model: str | None = None

    @model_validator(mode="after")
    def _embedding_input_valid(self) -> SupersedeRequest:
        check_embedding_input(self.embedding, self.embedding_model)
        return self

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
    # Synthesis-job backlog (runner-paid consolidation, v1.1). Scoped to
    # kind='synthesis' now that coord.memory_jobs also carries embedding
    # jobs, so these keep meaning exactly what their names say. Embedding
    # backlog has no field yet — add one when something needs it.
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
# Memory jobs — backend enqueues, runner executes, backend applies
# --------------------------------------------------------------------------
#
# One kind-dispatched queue for every piece of backend-initiated work a
# runner pays for. The backend has neither an LLM client nor (as of
# ``2026-07-13-runner-paid-embedding``) an embedding model on any live
# path, so both kinds of compute are offloaded to a runner that claims,
# computes locally, and posts the result back.


class ClaimJobsRequest(BaseModel):
    """``POST /memory/jobs/claim`` body.

    ``kinds`` is the runner's capability declaration — it only claims work
    it can actually execute, so a runner that cannot synthesize never
    takes a synthesis job hostage for a full lease before failing it.
    """

    limit: int = Field(default=DEFAULT_JOB_CLAIM_LIMIT, ge=1, le=MAX_JOB_CLAIM_LIMIT)
    kinds: list[JobKind] = Field(default_factory=lambda: list(JOB_KINDS), min_length=1)


class MemoryJobOut(BaseModel):
    """One claimed job — exactly what the runner needs to execute it.

    ``input_texts`` is the text to compute over and ``target_ids`` the
    rows the job is about; for ``kind='embedding'`` the two are index-
    aligned (``input_texts[i]`` is the content of ``target_ids[i]``) and
    the result must come back in that same order. The runner never reads
    the memory store directly.
    """

    job_id: UUID
    kind: JobKind
    target_ids: list[UUID]
    input_texts: list[str]


class ClaimJobsResponse(BaseModel):
    jobs: list[MemoryJobOut]


class SynthesisResultPayload(BaseModel):
    """``result`` for a ``kind='synthesis'`` job.

    ``embedding`` is the runner's vector for ``result_text`` — it already
    ran an LLM over this cluster, so the vector is its to pay for.
    Omitted (with ``embedding_model``) -> the ``mental_model`` row lands
    with a NULL embedding for the reindex sweep; the backend never embeds.
    """

    result_text: str = Field(min_length=1)
    embedding: list[float] | None = None
    embedding_model: str | None = None

    @model_validator(mode="after")
    def _embedding_input_valid(self) -> SynthesisResultPayload:
        check_embedding_input(self.embedding, self.embedding_model)
        return self


class EmbeddingResultPayload(BaseModel):
    """``result`` for a ``kind='embedding'`` job.

    One vector per ``input_texts`` entry, IN THE SAME ORDER — that order
    is the only thing mapping a vector onto its row, so the arity is
    checked against the stored job (a 422 from the store) and every vector
    is checked here for dimension. ``embedding_model`` is required and
    must be an accepted tag: an unrecognized model's vectors live in a
    different space and would silently poison the cosine arm.
    """

    embeddings: list[list[float]] = Field(min_length=1)
    embedding_model: str

    @field_validator("embeddings")
    @classmethod
    def _each_vector_dim(cls, v: list[list[float]]) -> list[list[float]]:
        for idx, vector in enumerate(v):
            check_embedding_dim(vector, field=f"embeddings[{idx}]")
        return v

    @field_validator("embedding_model")
    @classmethod
    def _tag_accepted(cls, v: str) -> str:
        if v not in ACCEPTED_EMBEDDING_MODEL_TAGS:
            raise ValueError(
                f"embedding_model {v!r} is not accepted by this server; "
                f"accepted tags: {sorted(ACCEPTED_EMBEDDING_MODEL_TAGS)}"
            )
        return v


class JobResultRequest(BaseModel):
    """``POST /memory/jobs/{job_id}/result`` body.

    Exactly one of ``result`` (success) or ``failure`` (the runner could
    not execute the job; the reason) must be set. ``result``'s shape is
    dispatched on the JOB's ``kind`` server-side rather than on a body
    discriminator — the job already knows what it is, and trusting a
    caller-supplied kind would let a runner post an embedding payload
    against a synthesis job.
    """

    result: dict[str, Any] | None = None
    failure: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _exactly_one(self) -> JobResultRequest:
        if (self.result is None) == (self.failure is None):
            raise ValueError(
                "provide exactly one of 'result' (success) or 'failure' (reason)"
            )
        return self


class JobResultResponse(BaseModel):
    # "applied" on the success path (vectors written / mental_model
    # inserted), "recorded" on the failure path (job marked failed).
    status: Literal["applied", "recorded"]
