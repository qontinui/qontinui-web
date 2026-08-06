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
from typing import Annotated, Any, Literal, get_args
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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

# The exhaustive bucket lists the ``/stats`` content facets zero-fill over,
# DERIVED from the Literals above rather than re-typed. A new kind or scope
# therefore appears in the facets the moment it appears in the CHECK mirror,
# and can never be silently missing from a facet payload — which is the whole
# point of exhaustive buckets: a caller must be able to tell "no ``feedback``
# records exist" from "``feedback`` was omitted".
MEMORY_KINDS: tuple[str, ...] = get_args(MemoryKind)
MEMORY_SCOPES: tuple[str, ...] = get_args(MemoryScope)

# Cap on the ``recent_titles`` vocabulary SAMPLE (see :class:`MemoryFacets`).
# Small and fixed on purpose — it is not a listing.
RECENT_TITLES_SAMPLE = 20

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
# Anchors per record (plan ``2026-07-29-memory-anchored-derived-records``
# §3.1). Same shape of cap as MAX_LINKS_PER_RECORD and for the same
# reason: the array is read whole with its record and re-resolved by the
# watcher on every tick, so an unbounded array is an unbounded fan-out of
# GitHub/twin reads per row.
MAX_ANCHORS_PER_RECORD = 16
# ``anchored_to`` clauses per proactive-recall query (Phase 5). One clause
# per declared-intent glob; a session declaring more than this many is
# asking for a corpus scan, not a recall.
MAX_ANCHORED_TO_CLAUSES = 16


# --------------------------------------------------------------------------
# Anchors — typed references to the ground truth a record asserts about
# --------------------------------------------------------------------------
#
# Plan ``2026-07-29-memory-anchored-derived-records`` §3.1. Five variants,
# discriminated on ``type``, each chosen because coord already knows how to
# read it. There is deliberately **no ``symbol`` variant**: coord's
# ``symbol_claims`` are coordination claims about who is EDITING a symbol,
# not a symbol index, and coord has no parser for any fleet language — so a
# ``symbol`` resolver would be larger than the rest of the plan. A record
# that wants symbol granularity anchors the ``blob``.
#
# Every variant forbids extra keys. Anchor IDENTITY is the whole JSON
# object (that is what the dedup-merge in ``memory_store.insert_record``
# unions on), so an unconstrained extra key would mint a second anchor
# that is "the same anchor" to a human and a distinct one to the store.
#
# ``anchor_state`` is NOT here and never will be: it is the watcher's
# roll-up verdict, writer-inaccessible by construction (see
# ``MemoryRecordIn._anchor_state_is_writer_inaccessible``).


class _AnchorBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BlobAnchor(_AnchorBase):
    """A file at a known content revision.

    ``sha`` is the GIT BLOB sha — exactly what
    ``GET /repos/{repo}/contents/{path}`` returns, so resolving this
    anchor costs the watcher one call it already makes and no separate
    sha lookup.
    """

    type: Literal["blob"]
    repo: str = Field(min_length=1, max_length=256)
    path: str = Field(min_length=1, max_length=1024)
    sha: str = Field(min_length=1, max_length=64)


class PRAnchor(_AnchorBase):
    """A pull request, resolved against coord's PR twin."""

    type: Literal["pr"]
    repo: str = Field(min_length=1, max_length=256)
    number: int = Field(ge=1)


class MigrationAnchor(_AnchorBase):
    """An alembic revision, resolved against ``coord.migration_revisions``."""

    type: Literal["migration"]
    revision: str = Field(min_length=1, max_length=256)


class SchemaAnchor(_AnchorBase):
    """A database object (``coord.memory_records.access_count``)."""

    type: Literal["schema"]
    object: str = Field(min_length=1, max_length=512)


class FlagAnchor(_AnchorBase):
    """A catalogued feature flag, resolved against coord's flag registry."""

    type: Literal["flag"]
    name: str = Field(min_length=1, max_length=256)


# Discriminated on ``type`` so an unrecognized type is a clean 422 naming
# the tag, never a silently-accepted blob-shaped object that the watcher
# would later fail to resolve (and, failing, leave in whatever state it
# was already in — an anchor nothing can check is worse than no anchor).
Anchor = Annotated[
    BlobAnchor | PRAnchor | MigrationAnchor | SchemaAnchor | FlagAnchor,
    Field(discriminator="type"),
]


class AnchoredTo(BaseModel):
    """One proactive-recall clause: ``{repo, path_glob}`` (Phase 5).

    ``path_glob`` matches an anchor's ``path`` with ``*`` / ``?`` /
    ``[...]`` glob syntax. ``repo`` is exact — it is what the GIN
    containment index narrows on before the glob is applied.
    """

    repo: str = Field(min_length=1, max_length=256)
    path_glob: str = Field(min_length=1, max_length=1024)


def reject_derived_anchor_state(data: Any) -> Any:
    """Reject a caller-supplied ``anchor_state`` on any write shape (422).

    ``anchor_state`` is a DERIVED column — the anchor watcher's roll-up
    verdict over the record's array — exactly like coord's derived
    work-unit statuses. Pydantic's default posture for an unknown key is
    to IGNORE it, which here would mean a writer that believes it pinned
    a record to ``fresh`` silently did nothing. A loud rejection is the
    only honest answer: the field is not writable by anyone, ever, over
    this API.

    Shared by every shape that can create a row (``MemoryRecordIn``,
    ``SupersedeRequest``) so the two cannot drift — a write path that
    quietly accepted the field would be a hole in the same wall.
    """
    if isinstance(data, dict) and "anchor_state" in data:
        raise ValueError(
            "anchor_state is derived — it is maintained by the anchor "
            "watcher from the record's anchors and is not writable over "
            "this API; send 'anchors' instead"
        )
    return data


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

    ``anchors`` names the ground truth this record asserts something
    about. A record with a non-empty array is decay-EXEMPT: its
    visibility is governed by the watcher's ``anchor_state`` rather than
    by the Ebbinghaus curve. Re-writing an identical record with a new
    anchor MERGES the anchor onto the existing live row (see
    ``memory_store.insert_record``'s ON CONFLICT clause), which is the
    only supported way to anchor an existing record.
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
    anchors: list[Anchor] = Field(
        default_factory=list, max_length=MAX_ANCHORS_PER_RECORD
    )
    embedding: list[float] | None = None
    embedding_model: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _anchor_state_is_writer_inaccessible(cls, data: Any) -> Any:
        return reject_derived_anchor_state(data)

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
    link_expansion: bool = Field(
        default=False,
        description=(
            "Run the third retrieval arm: one-hop expansion over the "
            "memory-link graph from the head of the vector+FTS fuse, "
            "re-fused by RRF. Default OFF pending the recall-efficacy "
            "harness (2026-07-29-memory-recall-efficacy-benchmark.md) — "
            "an unmeasured retrieval change defaulted on is how ranking "
            "quietly regresses. The expansion is tenant-bound and passes "
            "exactly the same validity/scope filters as the other arms."
        ),
    )
    # Anchor-keyed proactive recall (plan §3.4 / Phase 5): "what do I know
    # about the files this session is touching", keyed on what the caller
    # is TOUCHING rather than on what it thought to ask. Results come back
    # in ``anchored_hits``, ranked by importance x freshness — NOT fused
    # into ``hits``, whose RRF ranking means something else. DEFAULT-OFF
    # behind ``settings.MEMORY_ANCHORED_RECALL_ENABLED``; when the flag is
    # off the arm is skipped and ``anchored_arm`` says so.
    #
    # Independent of ``link_expansion`` above: separate request field,
    # separate settings flag, separate response arm, and neither reads the
    # other's state. The link arm re-fuses INTO ``hits`` by RRF; this one
    # never touches ``hits``.
    anchored_to: list[AnchoredTo] | None = Field(
        default=None, max_length=MAX_ANCHORED_TO_CLAUSES
    )

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
    """One fused retrieval hit.

    ``anchor_state`` is the watcher's roll-up verdict over the record's
    anchors — ``none`` (anchorless, today's Ebbinghaus lifecycle),
    ``fresh``, ``moved`` or ``gone``. It is carried on every hit because
    ``moved`` is ADVISORY: the record stays retrievable and normally
    ranked, and the only thing that makes it useful is that the reader
    is told the ground truth shifted under it. A flag the response does
    not carry is a flag nobody can act on.

    Typed ``str`` rather than a ``Literal`` on purpose: this is a READ
    shape over a column the watcher owns, and a value this build has
    never heard of must render, not 500.
    """

    memory_id: UUID
    title: str
    content: str
    kind: str
    scope: str
    importance: float
    created_at: datetime
    source: dict[str, Any]
    anchor_state: str = "none"
    rrf_score: float
    vector_rank: int | None = None
    fts_rank: int | None = None
    # Rank in the one-hop coord.memory_links expansion arm. A hit with
    # this set and BOTH other ranks null was pulled in purely by
    # association — the class of hit that must stay identifiable (it is
    # what the efficacy harness evaluates, and what the runner would
    # otherwise mislabel as a lexical hit).
    link_rank: int | None = None
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

    ``link_arm`` is REQUIRED and un-defaulted for exactly the same
    reason: a result that never consulted the graph must never be
    indistinguishable from one that did, and the arm is default-off, so
    "did it run" is the common question rather than the rare one. Its
    three states are the only ways the arm can end:

    * ``expanded`` — the expansion query RAN. (It running and finding no
      neighbour is still ``expanded``: the graph was consulted and had
      nothing to add, which is a different fact from not consulting it.)
    * ``skipped_disabled`` — the request did not set ``link_expansion``,
      so no expansion query was issued.
    * ``skipped_no_seeds`` — the arm was requested, but the vector+FTS
      fuse returned nothing to expand FROM. One-hop expansion is
      seeded by the other arms' heads; with no head there is no hop.
    """

    hits: list[MemoryQueryHit]
    vector_arm: Literal["hybrid", "skipped_no_embedding", "skipped_migrating"]
    link_arm: Literal["expanded", "skipped_disabled", "skipped_no_seeds"]
    # Anchor-keyed proactive recall (Phase 5), kept OUT of ``hits``: it
    # ranks by importance x freshness, not by RRF, so folding it in would
    # silently change what ``hits``' ordering means the moment the flag
    # flips on. ``anchored_arm`` is the same honesty contract as
    # ``vector_arm`` — a caller must never have to infer from an empty
    # list whether the arm ran and found nothing or never ran at all:
    #
    # * ``ran``               — the arm executed; ``anchored_hits`` is its result.
    # * ``not_requested``     — no ``anchored_to`` clauses were sent.
    # * ``skipped_disabled``  — clauses WERE sent but
    #   ``MEMORY_ANCHORED_RECALL_ENABLED`` is off (the default until the
    #   efficacy harness measures the injected context against its token
    #   cost).
    anchored_arm: Literal["ran", "not_requested", "skipped_disabled"] = "not_requested"
    anchored_hits: list[MemoryQueryHit] = Field(default_factory=list)


class SupersedeRequest(BaseModel):
    """``POST /memory/records/{id}/supersede`` body.

    ``title``/``content`` are the replacement; every omitted field is
    inherited from the record being superseded. ``embedding`` is NOT
    inherited — it belongs to the OLD content and would be a lie about
    the new one; omit it and the successor lands unvectorized (NULL) for
    the reindex sweep to pick up.

    ``anchors`` follows the INHERIT rule, not the embedding rule, and is
    three-valued on purpose (see the call site in
    ``endpoints/memory.py:supersede_record`` for the full argument):

    * **omitted / ``null``** — the successor INHERITS the superseded
      record's anchors. Superseding is how a record is corrected, and a
      correction is almost always about the same artifact; dropping the
      binding would silently demote an anchored record back onto the
      time-decay curve whose terminus is a hard delete.
    * **``[]``** — deliberately un-anchor. This is the escape hatch that
      makes inheritance safe: a rewrite that genuinely no longer asserts
      anything about the old artifact can say so explicitly.
    * **non-empty** — replaces the inherited set wholesale. Supersede is
      the explicit, human-initiated path, so "this is what the record is
      about now" is authoritative rather than additive.

    ``anchor_state`` is NOT inherited under any of the three: it is the
    watcher's derived verdict about the OLD row's anchors, so the
    successor starts at the column default ``none`` and is re-resolved on
    the next tick. Inheriting a verdict would assert a check that never
    ran against this row.
    """

    title: str = Field(min_length=1, max_length=512)
    content: str = Field(min_length=1)
    kind: MemoryKind | None = None
    scope: MemoryScope | None = None
    scope_ref: str | None = Field(default=None, max_length=512)
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    source: dict[str, Any] | None = None
    anchors: list[Anchor] | None = Field(
        default=None, max_length=MAX_ANCHORS_PER_RECORD
    )
    embedding: list[float] | None = None
    embedding_model: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _anchor_state_is_writer_inaccessible(cls, data: Any) -> Any:
        return reject_derived_anchor_state(data)

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


class LifecycleHoldResponse(BaseModel):
    """``PUT``/``DELETE /memory/records/{id}/hold`` — the resulting state.

    ``held`` is the state the record is now IN, not the change applied, so
    both verbs return the same shape and either is safe to replay.

    The release path returns ``held=False`` with a body rather than a bare
    204: an explicit ``false`` is a meaningful state ("adjudicated and
    released") that the lifecycle predicate distinguishes from the key
    being absent, so echoing it is more honest than an empty response
    that reads as "the flag is gone".
    """

    memory_id: UUID
    held: bool


class MemoryAgeFacet(BaseModel):
    """Age distribution of the LIVE corpus, in days since ``created_at``.

    All three are ``null`` on an empty corpus rather than a fabricated
    ``0``: "there is nothing to measure" is a different statement from
    "everything was written today", and collapsing them is the same
    absence-reads-as-a-value bug these facets exist to prevent.
    """

    p50_days: float | None = None
    p90_days: float | None = None
    oldest_days: float | None = None


class MemoryImportanceFacet(BaseModel):
    """Importance distribution of the LIVE corpus.

    ``p50`` / ``p90`` are ``null`` on an empty corpus (same reasoning as
    :class:`MemoryAgeFacet`). ``above_0_8`` is a count, so ``0`` is the
    honest answer for an empty corpus and it is never null.
    """

    p50: float | None = None
    p90: float | None = None
    above_0_8: int = 0


class MemoryFacets(BaseModel):
    """What is actually IN the corpus — the content half of ``/stats``.

    Every field here is computed over RETRIEVAL-LIVE rows only
    (``is_tombstone = false AND superseded_by IS NULL AND valid_from <=
    now AND (valid_until IS NULL OR valid_until > now)``) — the rows
    ``POST /memory/query`` and ``GET /memory/records`` can actually
    return. Note ``valid_until > now``, not ``valid_until IS NULL``: a
    row whose validity is dated into the FUTURE is still retrievable, and
    the session-expiry sweep dates validity seven days out, so counting
    those rows dead would report ``by_scope["session"] == 0`` to a caller
    whose next query returns session rows.

    **Retrieval-live MODULO ``scope_ref`` narrowing.** These counts are
    NOT an exact equivalence with what a given caller's query returns.
    Retrieval additionally requires ``agent``- and ``session``-scoped rows
    to carry that caller's own ``scope_ref``, which is caller-dependent
    and has no tenant-wide answer, so it is not applied here. A specific
    caller's ``agent`` / ``session`` buckets can therefore be SMALLER than
    reported; no bucket can be larger. Everything else — the tenant- and
    runner-scoped rows, and every other facet — is exactly the retrieval
    set.

    **Denominator invariant.** ``/stats`` carries three different
    liveness definitions, and they do not agree by design::

        sum(by_kind) == sum(by_scope) == facets.live_row_count <= row_count

    The first two equalities hold BY CONSTRUCTION: every facet number
    comes from a single ``SELECT``, so all of them describe one snapshot
    and no concurrent write can split them.

    The ``<= row_count`` relation is WEAKER — ``row_count`` is measured by
    a separate statement in the same request, at READ COMMITTED, so it is
    not snapshot-atomic with the facets. Under concurrent writes a
    response can briefly show ``live_row_count > row_count``. Treat that
    relation as a design statement about the two predicates, not as an
    assertion about any one payload.

    * ``row_count`` / ``bytes`` filter on ``is_tombstone = false`` ONLY —
      superseded and decay-invalidated rows still count, deliberately:
      they remain retrievable-storage lineage, and the definition matches
      the coord twin census so quota posture and census never disagree.
    * ``embedding_coverage`` filters on nothing at all — every row,
      tombstones included.
    * these facets use the retrieval-live predicate above.

    So ``sum(by_kind) < row_count`` is CORRECT, not a miscount. It is
    published as ``live_row_count`` rather than left implicit precisely
    so a caller never has to guess which of two numbers in one payload
    is the denominator — an unexplained gap is the same class of
    miscounted-absence bug as a silently omitted bucket.

    ``by_kind`` and ``by_scope`` are EXHAUSTIVE and zero-filled over all
    of :data:`MEMORY_KINDS` / :data:`MEMORY_SCOPES`. An empty bucket is
    reported as ``0``, never omitted, so "no ``feedback`` records exist"
    is distinguishable from "``feedback`` was not measured".

    ``anchor_state`` is deliberately ABSENT until
    ``2026-07-29-memory-anchored-derived-records.md`` Phase 1 lands; a
    null placeholder would claim the dimension is measured and empty.
    """

    live_row_count: int
    by_kind: dict[str, int]
    by_scope: dict[str, int]
    age: MemoryAgeFacet
    importance: MemoryImportanceFacet
    # A SAMPLE, not a listing: at most RECENT_TITLES_SAMPLE titles,
    # newest-first. It exists to expose the corpus's VOCABULARY so a
    # follow-up POST /memory/query can use words that are actually in
    # there. The paginated listing is GET /memory/records.
    recent_titles: list[str]


class MemoryStatsResponse(BaseModel):
    """``GET /memory/stats`` — usage + quota posture + content facets.

    The quota fields describe PLUMBING (storage, queue and adjudication
    backlog); :attr:`facets` describes CONTENT. ``corpus_complete`` says
    whether the content half can be trusted as whole-corpus — see its
    comment below.
    """

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
    # Records held out of every automatic lifecycle sweep. Counted
    # regardless of liveness — a hold on an already-superseded row is the
    # case that matters most, so a live-only count would under-report the
    # adjudication backlog. This is the "how much is left to decide"
    # number; it falls to zero when every hold has been released.
    lifecycle_held: int = 0
    # Content facets — null exactly when they could not be computed over
    # the whole live corpus.
    facets: MemoryFacets | None = None
    # The anti-UNKNOWN signal. True means the facets above were computed
    # over the WHOLE live corpus; false means the facet read degraded and
    # `facets` is null. It is never true alongside quietly smaller
    # numbers, because a caller cannot distinguish a partial read from a
    # small corpus — the same honesty contract coord's
    # `coord_query_memory_state` already states: store unreachable or no
    # observation yet is a blind spot, NEVER an empty confident success.
    # Defaults false so a response constructed without measuring the
    # corpus claims nothing about it.
    corpus_complete: bool = False


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

    This is the SYNC/LIST shape, so it carries the anchor array ITSELF
    and not just the roll-up: a mirror that pulled records without their
    anchors would round-trip them back anchorless on the next write, and
    the dedup-merge (union, never replace) would then be unable to tell
    "this writer has no anchors to add" from "this writer dropped them".

    ``anchors`` is typed as raw objects rather than the ``Anchor``
    discriminated union. On the WRITE side an unknown ``type`` must be a
    loud 422; on the READ side it must render — the watcher and a future
    coord build own this column's vocabulary, and a list endpoint that
    500s on a type this build predates would take the whole sync page
    down with it.
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
    anchors: list[dict[str, Any]] = Field(default_factory=list)
    anchor_state: str = "none"
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
