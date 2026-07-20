"""Tenant agentic-memory API — write, hybrid query, supersede, stats.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

Embeddings are CLIENT-supplied on every request path here (Phase 1 of
``2026-07-13-runner-paid-embedding``): no endpoint in this module embeds.
A caller sends its own vector (validated against ``EMBEDDING_DIM`` +
``ACCEPTED_EMBEDDING_MODEL_TAGS`` — a mismatch is a 422, never a silent
wrong-space write) or omits it, in which case the row is stored with a
NULL embedding, stays retrievable through the FTS arm, and is vectorized
later by the reindex sweep. There is deliberately no embed-for-you
fallback.

Endpoints (mounted under ``/api/v1/memory``):

* ``POST /records``                      — batch write (redact → hash →
  quota → dedup-insert; no server-side embed), optionally declaring
  typed graph ``links`` per record (Librarian Phase 4).
* ``GET /records``                       — keyset-paginated list of live
  records (newest-first-stable), with outbound links — the runner
  sync-pull surface.
* ``POST /query``                        — hybrid retrieval: pgvector
  HNSW cosine + websearch FTS, fused with RRF (k=60). The cosine arm
  runs only when the caller supplies ``query_embedding`` (+ its
  ``query_embedding_model``) AND the tenant's corpus is entirely at the
  deployed tag; otherwise the query degrades to FTS-only. The response's
  ``vector_arm`` always says which of the three happened.
* ``POST /graph``                        — bounded outbound traversal of
  ``coord.memory_links`` from a root record → ``{nodes, edges}``.
* ``POST /records/{id}/supersede``       — insert replacement, end the
  old row's validity.
* ``DELETE /records/{id}``               — tombstone.
* ``GET /stats``                         — usage/quota posture.
* ``POST /jobs/claim``                   — a runner claims pending jobs
  of the ``kinds`` it can execute (backend enqueues, runner computes).
* ``POST /jobs/{id}/result``             — the runner posts the job's
  result (success) or a failure reason back. The result's shape is
  dispatched on the JOB's own ``kind``: ``embedding`` writes the posted
  vectors onto the job's target rows; ``synthesis`` inserts the
  ``mental_model`` row and supersedes the cluster members.

Auth (fail-closed): the tenant comes EXCLUSIVELY from the server-side
principal resolved by :func:`get_memory_tenant` — never from the request
body or query. Three credential shapes are accepted, tried in order on
the presented bearer:

1. **Device JWT** (runner) — coord-signed, verified via
   ``coord_jwks_client`` through the same ``_verify_device_jwt``
   machinery as ``get_authenticated_device``; tenant = the token's
   ``tenant_id`` claim (the device's tenant, as in ``GET /devices/me``).
2. **Coord service token** (coord's MCP memory proxy) — validates
   against the SAME coord JWKS but carries ``token_kind ==
   "coord_service"`` + ``sub == "coord-memory-proxy"`` + ``tenant_id``
   (+ optional ``device_id``). Minted by the parallel qontinui-coord PR.
3. **Cognito operator user** (dashboard) — fastapi-users optional
   current-user + ``coord_identity`` home-tenant resolution (honoring
   the ``X-Qontinui-Active-Tenant`` re-scoping header, which
   ``get_coord_identity`` forwards to coord).

No credential → 401. Credential valid but no tenant resolvable → 403.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast, get_args
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    _optional_bearer_scheme,
    _verify_device_jwt,
    current_active_user_optional,
    get_async_db,
)
from app.models.user import User
from app.schemas.memory import (
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    ClaimJobsRequest,
    ClaimJobsResponse,
    EmbeddingResultPayload,
    JobResultRequest,
    JobResultResponse,
    ListRecordsResponse,
    MemoryGraphEdge,
    MemoryGraphNode,
    MemoryGraphRequest,
    MemoryGraphResponse,
    MemoryJobOut,
    MemoryKind,
    MemoryLinkOut,
    MemoryQueryHit,
    MemoryQueryRequest,
    MemoryQueryResponse,
    MemoryRecordOut,
    MemoryStatsResponse,
    SupersedeRequest,
    SupersedeResponse,
    SynthesisResultPayload,
    WriteRecordResult,
    WriteRecordsRequest,
    WriteRecordsResponse,
)
from app.services import memory_store as store
from app.services.coord_identity import get_coord_identity
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenInvalidError,
    coord_jwks_client,
)
from app.services.memory_redaction import log_redactions, redact_text
from app.services.memory_retrieval import rrf_fuse
from app.services.memory_vectors import EMBEDDING_MODEL_TAG

logger = structlog.get_logger(__name__)

router = APIRouter()

# --------------------------------------------------------------------------
# Auth — the memory principal
# --------------------------------------------------------------------------

# The coord-service-token contract (minted by the parallel qontinui-coord
# PR for its MCP memory proxy): same JWKS/signature as device tokens,
# discriminated by these claims.
COORD_SERVICE_TOKEN_KIND = "coord_service"
COORD_SERVICE_SUBJECT = "coord-memory-proxy"

# Scopes a query sees when it doesn't ask for narrower ones. `agent` /
# `session` rows require an explicit opt-in + matching scope_ref.
_DEFAULT_QUERY_SCOPES = ["tenant", "runner"]


@dataclass(frozen=True)
class MemoryPrincipal:
    """The server-side identity every memory operation is bound to."""

    tenant_id: UUID
    device_id: UUID | None
    actor: str  # "device" | "coord_service" | "operator"


def _claim_uuid(claims: dict[str, Any], key: str) -> UUID | None:
    raw = claims.get(key)
    if not raw:
        return None
    try:
        return UUID(str(raw))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"token {key} claim malformed",
        ) from exc


def _principal_from_service_claims(claims: dict[str, Any]) -> MemoryPrincipal:
    """Validate the coord-service-token contract and extract the tenant."""
    if claims.get("sub") != COORD_SERVICE_SUBJECT:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="coord service token has unexpected subject",
        )
    tenant_id = _claim_uuid(claims, "tenant_id")
    if tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="coord service token carries no tenant_id",
        )
    return MemoryPrincipal(
        tenant_id=tenant_id,
        device_id=_claim_uuid(claims, "device_id"),
        actor="coord_service",
    )


async def get_memory_tenant(
    request: Request,
    user: User | None = Depends(current_active_user_optional),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer_scheme),
) -> MemoryPrincipal:
    """Resolve the caller into a tenant-bound :class:`MemoryPrincipal`.

    Fail-closed: 401 with no credential, 403 when the credential is
    valid but resolves to no tenant. The tenant is NEVER accepted from
    the request payload.
    """
    if credentials is not None:
        claims: dict[str, Any] | None
        try:
            claims = await coord_jwks_client.verify_token(credentials.credentials)
        except CoordJWKSUnavailableError as exc:
            logger.error("memory_auth_jwks_unavailable", error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Memory authentication temporarily unavailable.",
            ) from exc
        except CoordTokenInvalidError:
            # Not a coord-signed token — fall through to the Cognito path.
            claims = None

        if claims is not None:
            if claims.get("token_kind") == COORD_SERVICE_TOKEN_KIND:
                return _principal_from_service_claims(claims)

            # Coord-signed but not a service token → device-token path.
            # Reuse the canonical device verification (user resolution +
            # active check) from app.api.deps.
            device_claims, _device_user = await _verify_device_jwt(
                credentials.credentials
            )
            tenant_id = _claim_uuid(device_claims, "tenant_id")
            if tenant_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="device token carries no tenant_id",
                )
            return MemoryPrincipal(
                tenant_id=tenant_id,
                device_id=_claim_uuid(device_claims, "device_id"),
                actor="device",
            )

    if user is not None:
        identity = await get_coord_identity(request)
        if identity.home_tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_not_resolved",
            )
        return MemoryPrincipal(
            tenant_id=identity.home_tenant_id, device_id=None, actor="operator"
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
    )


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# List-endpoint helpers — keyset cursor codec + kinds query parsing
# --------------------------------------------------------------------------

_VALID_KINDS = frozenset(get_args(MemoryKind))


def _encode_cursor(created_at: datetime, memory_id: UUID) -> str:
    """Opaque keyset cursor over ``(created_at, memory_id)``."""
    raw = f"{created_at.isoformat()}|{memory_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    """Inverse of :func:`_encode_cursor`; 400 on anything malformed."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_raw, sep, id_raw = raw.partition("|")
        if not sep:
            raise ValueError("missing separator")
        return datetime.fromisoformat(created_raw), UUID(id_raw)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="malformed cursor",
        ) from exc


def _parse_kinds(raw: list[str] | None) -> list[str] | None:
    """Expand repeatable/CSV ``kinds`` query params; 422 on unknown kinds."""
    if not raw:
        return None
    kinds: list[str] = []
    for item in raw:
        for part in item.split(","):
            part = part.strip()
            if not part:
                continue
            if part not in _VALID_KINDS:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"unknown kind {part!r}",
                )
            if part not in kinds:
                kinds.append(part)
    return kinds or None


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------


@router.post("/records", response_model=WriteRecordsResponse)
async def write_records(
    payload: WriteRecordsRequest,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """Batch-write memory records (≤100 per request).

    Server-side pipeline per batch: redact → hash → quota check (BEFORE
    insert; 429 on exceed) → ONE set-based insert deduping on
    ``(tenant_id, content_hash)`` against live rows only. Each record
    carries its own caller-computed ``embedding`` (+ ``embedding_model``)
    or neither, in which case that row is stored unvectorized.
    """
    # 1. Redact (server-side pass; log counts only, never the secrets).
    redaction_counts: dict[str, int] = {}
    titles: list[str] = []
    contents: list[str] = []
    for rec in payload.records:
        rt = redact_text(rec.title)
        rc = redact_text(rec.content)
        titles.append(rt.text)
        contents.append(rc.text)
        for counts in (rt.counts, rc.counts):
            for cls, n in counts.items():
                redaction_counts[cls] = redaction_counts.get(cls, 0) + n
    log_redactions("memory_write", redaction_counts)

    # 2. Hash the stored (post-redaction) contents.
    hashes = [_content_hash(c) for c in contents]

    # 3. Quota — enforced BEFORE insert, counting only the genuinely new
    # unique contents in this batch.
    already_stored = await store.existing_hashes(db, principal.tenant_id, hashes)
    new_by_hash: dict[str, str] = {}
    for content, h in zip(contents, hashes, strict=True):
        if h not in already_stored and h not in new_by_hash:
            new_by_hash[h] = content
    incoming_rows = len(new_by_hash)
    incoming_bytes = sum(len(c.encode("utf-8")) for c in new_by_hash.values())

    usage = await store.get_usage(db, principal.tenant_id)
    if (
        usage.bytes + incoming_bytes > usage.quota_bytes
        or usage.row_count + incoming_rows > usage.quota_rows
    ):
        logger.warning(
            "memory_quota_exceeded",
            tenant_id=str(principal.tenant_id),
            used_bytes=usage.bytes,
            quota_bytes=usage.quota_bytes,
            used_rows=usage.row_count,
            quota_rows=usage.quota_rows,
            incoming_bytes=incoming_bytes,
            incoming_rows=incoming_rows,
        )
        # Mirror coord's warm-quota 429 shape (sessions.rs).
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "error": "memory_quota_exceeded",
                "used_bytes": usage.bytes,
                "quota_bytes": usage.quota_bytes,
                "used_rows": usage.row_count,
                "quota_rows": usage.quota_rows,
            },
        )

    # 4. Insert every genuinely-new unique content in ONE set-based
    # statement (dedup via the live-row partial-index ON CONFLICT).
    # Intra-batch duplicates were collapsed in step 3 to their FIRST
    # occurrence — that record's scope/kind/title/importance/source AND
    # its embedding win; later occurrences report ``deduped=True`` onto
    # the same row.
    new_hashes = list(new_by_hash)
    first_index: dict[str, int] = {}
    for i, h in enumerate(hashes):
        first_index.setdefault(h, i)
    batch_items = [
        store.MemoryRecordInsert(
            scope=payload.records[first_index[h]].scope,
            scope_ref=payload.records[first_index[h]].scope_ref,
            kind=payload.records[first_index[h]].kind,
            title=titles[first_index[h]],
            content=contents[first_index[h]],
            content_hash=h,
            embedding=payload.records[first_index[h]].embedding,
            embedding_model=payload.records[first_index[h]].embedding_model,
            importance=payload.records[first_index[h]].importance,
            source=payload.records[first_index[h]].source,
        )
        for h in new_hashes
    ]
    batch_results = await store.insert_records_batch(
        db, tenant_id=principal.tenant_id, items=batch_items
    )
    outcome_by_hash: dict[str, tuple[UUID, bool]] = dict(
        zip(new_hashes, batch_results, strict=True)
    )

    # 5. Per-record responses, in request order.
    results: list[WriteRecordResult] = []
    for i, rec in enumerate(payload.records):
        h = hashes[i]
        outcome = outcome_by_hash.get(h)
        if outcome is None:
            # Known-duplicate content (pre-existing live row): report it.
            existing_id = await store.find_by_hash(db, principal.tenant_id, h)
            if existing_id is not None:
                results.append(WriteRecordResult(memory_id=existing_id, deduped=True))
                continue
            # Vanishingly rare race (row invalidated between the hash
            # pre-check and now): insert this one record on its own,
            # reusing ITS OWN caller-supplied vector (or none) — the race
            # path must never grow a server-side embed back.
            memory_id, deduped = await store.insert_record(
                db,
                tenant_id=principal.tenant_id,
                scope=rec.scope,
                scope_ref=rec.scope_ref,
                kind=rec.kind,
                title=titles[i],
                content=contents[i],
                content_hash=h,
                embedding=rec.embedding,
                embedding_model=rec.embedding_model,
                importance=rec.importance,
                source=rec.source,
            )
            # Later intra-batch occurrences dedup onto this row.
            outcome_by_hash[h] = (memory_id, True)
            results.append(WriteRecordResult(memory_id=memory_id, deduped=deduped))
            continue
        memory_id, db_deduped = outcome
        deduped = db_deduped or i != first_index[h]
        results.append(WriteRecordResult(memory_id=memory_id, deduped=deduped))

    # 7. Graph edges (Librarian Phase 4). Resolve each declared link's
    # target_ref (memory_id first, then content_hash — LIVE rows of THIS
    # tenant only; sibling records written above are visible) and upsert
    # the edges set-based. Unresolved targets and degenerate self-edges
    # are DROPPED and counted — flag-don't-reject.
    dropped_links = 0
    all_refs = [
        link.target_ref for rec in payload.records for link in (rec.links or [])
    ]
    if all_refs:
        resolved = await store.resolve_link_targets(db, principal.tenant_id, all_refs)
        seen_edges: set[tuple[UUID, UUID, str]] = set()
        link_items: list[store.MemoryLinkInsert] = []
        for i, rec in enumerate(payload.records):
            if not rec.links:
                continue
            source_id = results[i].memory_id
            for link in rec.links:
                target_id = resolved.get(link.target_ref)
                if target_id is None or target_id == source_id:
                    dropped_links += 1
                    continue
                edge_key = (source_id, target_id, link.relation)
                if edge_key in seen_edges:
                    # Intra-batch repeat of the same edge — collapses
                    # onto the first declaration (not a drop).
                    continue
                seen_edges.add(edge_key)
                link_items.append(
                    store.MemoryLinkInsert(
                        source_id=source_id,
                        target_id=target_id,
                        relation=link.relation,
                        description=link.description,
                    )
                )
        if link_items:
            await store.insert_links_batch(
                db, tenant_id=principal.tenant_id, items=link_items
            )
        if dropped_links:
            logger.info(
                "memory_links_dropped",
                tenant_id=str(principal.tenant_id),
                dropped=dropped_links,
                declared=len(all_refs),
            )

    return WriteRecordsResponse(
        records=results,
        deduped_count=sum(1 for r in results if r.deduped),
        dropped_links_count=dropped_links,
    )


@router.post("/query", response_model=MemoryQueryResponse)
async def query_records(
    payload: MemoryQueryRequest,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> MemoryQueryResponse:
    """Hybrid retrieval: pgvector cosine + websearch FTS, RRF-fused.

    Both arms are tenant-bound and validity-filtered (tombstones out,
    ``valid_from``/``valid_until`` against now() or ``as_of``).
    ``agent``/``session``-scoped rows are only visible when the request
    names those scopes AND supplies the matching ``scope_ref``.

    The semantic arm needs a vector, and this endpoint never computes
    one. It runs only when the caller supplies ``query_embedding`` (with
    its ``query_embedding_model``) AND this tenant's corpus is entirely
    in the deployed space. Otherwise it is SKIPPED and the result is
    FTS-only. Which of the three happened is reported in ``vector_arm``
    — never inferred, so an FTS-only result can't pass for a hybrid one.

    The mid-migration skip is what makes the model transition atomic per
    tenant: the old and new spaces are not interchangeable, so a
    new-space query is served FTS-only rather than cosine-scored against
    documents the runner-paid reindex has not rewritten yet.
    """
    as_of = payload.as_of or datetime.now(UTC)
    scopes: list[str] = (
        list(payload.scopes) if payload.scopes else list(_DEFAULT_QUERY_SCOPES)
    )
    kinds: list[str] | None = list(payload.kinds) if payload.kinds else None

    filter_kwargs: dict[str, Any] = {
        "tenant_id": principal.tenant_id,
        "as_of": as_of,
        "kinds": kinds,
        "scopes": scopes,
        "scope_ref": payload.scope_ref,
        "min_importance": payload.min_importance,
        "since": payload.since,
    }
    vector_arm: Literal["hybrid", "skipped_no_embedding", "skipped_migrating"]
    vector_hits: list[tuple[UUID, float]]
    if payload.query_embedding is None:
        # Checked first: a caller with no vector needs no corpus probe.
        vector_hits = []
        vector_arm = "skipped_no_embedding"
    elif await store.has_unmigrated_vectors(
        db, tenant_id=principal.tenant_id, current_tag=EMBEDDING_MODEL_TAG
    ):
        vector_hits = []
        vector_arm = "skipped_migrating"
    else:
        vector_hits = await store.vector_search(
            db, query_embedding=payload.query_embedding, **filter_kwargs
        )
        vector_arm = "hybrid"
    fts_ids = await store.fts_search(db, query_text=payload.query_text, **filter_kwargs)

    fused = rrf_fuse([mid for mid, _sim in vector_hits], fts_ids)
    top = fused[: payload.limit]

    rows = await store.fetch_records(db, principal.tenant_id, [h.id for h in top])
    similarity = dict(vector_hits)

    hits: list[MemoryQueryHit] = []
    for fh in top:
        row = rows.get(fh.id)
        if row is None:  # pragma: no cover — arm results are tenant-bound
            continue
        hits.append(
            MemoryQueryHit(
                memory_id=fh.id,
                title=row["title"],
                content=row["content"],
                kind=row["kind"],
                scope=row["scope"],
                importance=row["importance"],
                created_at=row["created_at"],
                source=row["source"] or {},
                rrf_score=fh.rrf_score,
                vector_rank=fh.vector_rank,
                fts_rank=fh.fts_rank,
                cosine_similarity=similarity.get(fh.id),
            )
        )

    await store.bump_access(db, principal.tenant_id, [h.memory_id for h in hits])
    return MemoryQueryResponse(hits=hits, vector_arm=vector_arm)


@router.get("/records", response_model=ListRecordsResponse)
async def list_records(
    kinds: list[str] | None = Query(default=None),
    since: datetime | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIST_LIMIT, ge=1, le=MAX_LIST_LIMIT),
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> ListRecordsResponse:
    """Keyset-paginated list of the tenant's LIVE records, newest first.

    The runner's sync-pull surface (``POST /query`` requires query_text,
    caps at 50, and relevance-ranks — unusable for a full mirror).
    ``kinds`` is repeatable and/or CSV; ``since`` filters on the
    freshest of updated/created; ``cursor`` is the opaque
    ``(created_at, memory_id)`` keyset token from the previous page.
    Each record carries its outbound ``links``. Ordering is
    ``created_at DESC, memory_id DESC`` — stable under concurrent
    writes (new rows only ever prepend).
    """
    kind_filter = _parse_kinds(kinds)
    cursor_key = _decode_cursor(cursor) if cursor else None
    rows = await store.list_records_page(
        db,
        tenant_id=principal.tenant_id,
        kinds=kind_filter,
        since=since,
        cursor=cursor_key,
        limit=limit,
        now=datetime.now(UTC),
    )
    links_by_source = await store.fetch_outbound_links(
        db, principal.tenant_id, [r["memory_id"] for r in rows]
    )
    records = [
        MemoryRecordOut(
            memory_id=row["memory_id"],
            title=row["title"],
            content=row["content"],
            kind=row["kind"],
            scope=row["scope"],
            scope_ref=row["scope_ref"],
            importance=row["importance"],
            content_hash=row["content_hash"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            source=row["source"] or {},
            links=[
                MemoryLinkOut(
                    link_id=link["link_id"],
                    target_id=link["target_id"],
                    relation=link["relation"],
                    description=link["description"],
                    created_at=link["created_at"],
                )
                for link in links_by_source.get(row["memory_id"], [])
            ],
        )
        for row in rows
    ]
    next_cursor = (
        _encode_cursor(rows[-1]["created_at"], rows[-1]["memory_id"])
        if len(rows) == limit
        else None
    )
    return ListRecordsResponse(records=records, next_cursor=next_cursor)


@router.post("/graph", response_model=MemoryGraphResponse)
async def memory_graph(
    payload: MemoryGraphRequest,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> MemoryGraphResponse:
    """Bounded outbound traversal of the memory graph from a root record.

    One tenant-bound ``WITH RECURSIVE`` walk over ``coord.memory_links``
    (see :func:`store.graph_edges`): outbound edges from the root, then
    from each reached target, up to ``depth`` (≤5) levels —
    ``relation_filter`` narrows which relations are followed. Cycles are
    safe (the depth cap terminates the recursion; duplicate edges
    collapse). 404 when the root does not exist in the caller's tenant
    (cross-tenant ids are never disclosed).
    """
    root = await store.get_record(db, principal.tenant_id, payload.root_memory_id)
    if root is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="memory record not found",
        )
    relations: list[str] | None = (
        [str(rel) for rel in payload.relation_filter]
        if payload.relation_filter
        else None
    )
    edge_rows = await store.graph_edges(
        db,
        tenant_id=principal.tenant_id,
        root_id=payload.root_memory_id,
        depth=payload.depth,
        relations=relations,
    )
    node_ids: set[UUID] = {payload.root_memory_id}
    for edge in edge_rows:
        node_ids.add(edge["source_id"])
        node_ids.add(edge["target_id"])
    node_rows = await store.fetch_records(db, principal.tenant_id, sorted(node_ids))
    nodes = [
        MemoryGraphNode(
            memory_id=memory_id,
            title=row["title"],
            content=row["content"],
            kind=row["kind"],
            scope=row["scope"],
            importance=float(row["importance"]),
            created_at=row["created_at"],
            source=row["source"] or {},
        )
        for memory_id, row in sorted(node_rows.items(), key=lambda kv: kv[0])
    ]
    edges = [
        MemoryGraphEdge(
            link_id=edge["link_id"],
            source_id=edge["source_id"],
            target_id=edge["target_id"],
            relation=edge["relation"],
            description=edge["description"],
            created_at=edge["created_at"],
        )
        for edge in edge_rows
    ]
    return MemoryGraphResponse(nodes=nodes, edges=edges)


@router.post("/records/{memory_id}/supersede", response_model=SupersedeResponse)
async def supersede_record(
    memory_id: UUID,
    payload: SupersedeRequest,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> SupersedeResponse:
    """Replace a record: insert the successor, end the old row's validity.

    404 for records that don't exist in the caller's tenant (including
    cross-tenant ids — never disclosed). The successor's ``embedding`` is
    the caller's (of the replacement content) or NULL — the old row's
    vector is never inherited, and nothing is embedded server-side.
    """
    old = await store.get_record(db, principal.tenant_id, memory_id)
    if old is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="memory record not found",
        )

    rt = redact_text(payload.title)
    rc = redact_text(payload.content)
    combined = {
        cls: rt.counts.get(cls, 0) + rc.counts.get(cls, 0)
        for cls in {*rt.counts, *rc.counts}
    }
    log_redactions("memory_supersede", combined)

    content_hash = _content_hash(rc.text)

    new_id, deduped = await store.insert_record(
        db,
        tenant_id=principal.tenant_id,
        scope=payload.scope if payload.scope is not None else old["scope"],
        scope_ref=(
            payload.scope_ref if payload.scope_ref is not None else old["scope_ref"]
        ),
        kind=payload.kind if payload.kind is not None else old["kind"],
        title=rt.text,
        content=rc.text,
        content_hash=content_hash,
        embedding=payload.embedding,
        embedding_model=payload.embedding_model,
        importance=(
            payload.importance
            if payload.importance is not None
            else float(old["importance"])
        ),
        source=payload.source if payload.source is not None else (old["source"] or {}),
    )
    if new_id == memory_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=("replacement content is identical to the record being superseded"),
        )
    await store.mark_superseded(
        db,
        tenant_id=principal.tenant_id,
        old_memory_id=memory_id,
        new_memory_id=new_id,
    )
    return SupersedeResponse(
        memory_id=new_id, superseded_memory_id=memory_id, deduped=deduped
    )


@router.delete("/records/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_record(
    memory_id: UUID,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> Response:
    """Tombstone a record (``is_tombstone = true, valid_until = now()``).

    404 for records that don't exist in the caller's tenant.
    """
    deleted = await store.tombstone_record(db, principal.tenant_id, memory_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="memory record not found",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stats", response_model=MemoryStatsResponse)
async def memory_stats(
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> MemoryStatsResponse:
    """Usage + quota posture for the caller's tenant."""
    usage = await store.get_usage(db, principal.tenant_id)
    coverage = await store.embedding_coverage(db, principal.tenant_id)
    # Scoped to kind='synthesis': the queue now also carries embedding
    # jobs, and these fields say "synthesis".
    job_counts = await store.job_counts(db, principal.tenant_id, kind="synthesis")
    utilization = max(
        usage.bytes / usage.quota_bytes if usage.quota_bytes > 0 else 0.0,
        usage.row_count / usage.quota_rows if usage.quota_rows > 0 else 0.0,
    )
    return MemoryStatsResponse(
        row_count=usage.row_count,
        bytes=usage.bytes,
        embedding_coverage=coverage,
        quota_bytes=usage.quota_bytes,
        quota_rows=usage.quota_rows,
        quota_utilization=utilization,
        synthesis_jobs_pending=job_counts["pending"],
        synthesis_jobs_claimed=job_counts["claimed"],
        synthesis_jobs_done=job_counts["done"],
        synthesis_jobs_failed=job_counts["failed"],
    )


# --------------------------------------------------------------------------
# Memory jobs — backend enqueues, runner executes, backend applies
# --------------------------------------------------------------------------


@router.post("/jobs/claim", response_model=ClaimJobsResponse)
async def claim_jobs(
    payload: ClaimJobsRequest,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> ClaimJobsResponse:
    """A runner claims up to ``limit`` pending jobs of ``kinds`` (tenant-bound).

    Concurrent claims on the same tenant split the queue via
    ``FOR UPDATE SKIP LOCKED`` — no job is ever handed to two runners.
    ``kinds`` is the runner's capability filter: it claims only work it
    can execute. Each job carries what the runner needs and nothing more
    (``job_id`` / ``kind`` / ``target_ids`` / ``input_texts``); the runner
    computes locally and posts back to ``/jobs/{job_id}/result``, never
    reading the memory store directly.
    """
    worker = str(principal.device_id) if principal.device_id else principal.actor
    jobs = await store.claim_jobs(
        db,
        principal.tenant_id,
        limit=payload.limit,
        kinds=list(payload.kinds),
        worker=worker,
    )
    return ClaimJobsResponse(
        jobs=[
            MemoryJobOut(
                job_id=job.job_id,
                kind=cast(Any, job.kind),
                target_ids=job.target_ids,
                input_texts=job.input_texts,
            )
            for job in jobs
        ]
    )


@router.post("/jobs/{job_id}/result", response_model=JobResultResponse)
async def submit_job_result(
    job_id: UUID,
    payload: JobResultRequest,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> JobResultResponse:
    """The runner posts a job's result (success) or a failure reason.

    The ``result`` payload is validated against the JOB's own ``kind``
    (read under the row lock), never against a caller-declared one:

    * ``embedding`` -> ``{"embeddings": [[...384], ...],
      "embedding_model": "<tag>"}``: one vector per ``input_texts`` entry
      in the SAME ORDER (that order is the only thing mapping a vector
      onto its row). The vectors are written onto ``target_ids``.
    * ``synthesis`` -> ``{"result_text": "...", "embedding": [...384],
      "embedding_model": "<tag>"}``: the text is redacted, inserted as a
      ``mental_model`` row (``consolidated_from`` = the cluster members,
      importance = best member + 0.1), and the member rows superseded —
      all in one transaction.

    Failure (``failure``): the job is marked failed -> ``recorded``.

    404 when the job is not in the caller's tenant (never disclosed); 409
    when the job exists but is not ``'claimed'`` (already applied,
    requeued by the reaper, or abandoned) — a runner may only post back
    for a job it holds a live claim on; 422 on a result whose shape does
    not match the job (wrong kind, wrong vector count, wrong dimension,
    unaccepted model tag), which leaves the job ``claimed`` so the runner
    can still post a correct result before its lease expires.
    """
    if payload.failure is not None:
        try:
            ok = await store.record_job_failure(
                db, principal.tenant_id, job_id, payload.failure
            )
        except store.JobNotClaimedError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="memory job not found",
            )
        return JobResultResponse(status="recorded")

    # Success path — `result` is guaranteed present by the schema
    # validator (exactly one of result / failure).
    assert payload.result is not None

    # Dispatch on the STORED kind. The job is locked + its kind checked
    # inside the store call; we must know the kind out here to parse the
    # payload, so a cheap unlocked peek picks the parser and the store's
    # locked re-check is what actually enforces it (a kind cannot change
    # under us — it is set at enqueue and never updated).
    kind = await store.get_job_kind(db, principal.tenant_id, job_id)
    if kind is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="memory job not found"
        )

    try:
        if kind == "embedding":
            embedding_result = EmbeddingResultPayload.model_validate(payload.result)
            applied = await store.record_embedding_result(
                db,
                principal.tenant_id,
                job_id,
                embeddings=embedding_result.embeddings,
                embedding_model=embedding_result.embedding_model,
            )
            if applied is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="memory job not found",
                )
        else:
            synthesis_result = SynthesisResultPayload.model_validate(payload.result)
            new_id = await store.record_synthesis_result(
                db,
                principal.tenant_id,
                job_id,
                synthesis_result.result_text,
                embedding=synthesis_result.embedding,
                embedding_model=synthesis_result.embedding_model,
            )
            if new_id is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="memory job not found",
                )
    except ValidationError as exc:
        # A malformed `result` for this job's kind. Raised here rather than
        # by FastAPI's own body validation because the expected shape is
        # only knowable once the job's kind is read.
        #
        # `include_context=False` is load-bearing, not cosmetic: pydantic's
        # default `ctx` carries the raw ValueError OBJECT, which is not
        # JSON-serializable — serializing it raises inside the response
        # encoder and turns this clean 422 into a 500. `include_input`
        # would also echo the runner's whole 384-float vector back.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(
                include_url=False, include_context=False, include_input=False
            ),
        ) from exc
    except store.JobNotClaimedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except (store.JobKindMismatchError, store.JobResultShapeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    return JobResultResponse(status="applied")
