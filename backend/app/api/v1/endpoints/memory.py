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
  ``vector_arm`` always says which of the three happened. An opt-in
  third arm (``link_expansion=true``) adds one-hop ``coord.memory_links``
  expansion of the fuse's head, reported in ``link_arm``.
* ``POST /graph``                        — bounded outbound traversal of
  ``coord.memory_links`` from a root record → ``{nodes, edges}``.
* ``POST /records/{id}/supersede``       — insert replacement, end the
  old row's validity.
* ``PUT /records/{id}/hold``             — hold the record out of every
  automatic lifecycle sweep while a human adjudicates it.
* ``DELETE /records/{id}/hold``          — release the hold (records
  "adjudicated and released"; returns the resulting state, not 204).
* ``DELETE /records/{id}``               — tombstone.
* ``GET /stats``                         — usage/quota posture, including
  the count of records currently held.
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
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast, get_args
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.exc import TimeoutError as SATimeoutError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    _optional_bearer_scheme,
    _verify_device_jwt,
    current_active_user_optional,
    get_async_db,
)
from app.core.config import settings
from app.models.user import User
from app.schemas.memory import (
    DEFAULT_LIST_LIMIT,
    MAX_ANCHORS_PER_RECORD,
    MAX_LIST_LIMIT,
    ClaimJobsRequest,
    ClaimJobsResponse,
    EmbeddingResultPayload,
    JobResultRequest,
    JobResultResponse,
    LifecycleHoldResponse,
    ListRecordsResponse,
    MemoryAgeFacet,
    MemoryFacets,
    MemoryGraphEdge,
    MemoryGraphNode,
    MemoryGraphRequest,
    MemoryGraphResponse,
    MemoryImportanceFacet,
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
    jwks_failure_log_fields,
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

# How many heads of the FIRST (vector+FTS) fuse seed the link-expansion
# arm. Deliberately independent of the caller's `limit`: the seed slice
# is taken PRE-limit, so a `limit=3` query still expands from the best
# 10 combined hits. Small on purpose — one hop from a bounded seed set is
# what keeps a graph arm from turning into a full-table scan (the per-arm
# fan-out is separately capped by store.ARM_LIMIT).
LINK_SEED_COUNT = 10

# Per-arm weights on the RRF contribution (`w / (k + rank)`). Arms absent
# here weigh 1.0, so `vector` and `fts` are unchanged textbook RRF.
#
# The link arm is DAMPED because plain RRF assumes every arm's rank-1 means
# roughly the same thing, and "one hop from a seed" is a far weaker claim
# than "nearest neighbour in the embedding space". Measured on the golden
# set (plan 2026-08-08-memory-graph-has-no-writer §4a), an equal vote cost
# MRR 0.8306 -> 0.2918 and nDCG@10 0.8412 -> 0.4402 while recall@20 held at
# 1.0 — a ranking collapse invisible to the widest metric.
#
# 0.1 is the LARGEST swept weight whose regression is within fixture noise
# (MRR 0.8293, nDCG@10 0.8397 — both within 0.002 of the arm-off baseline),
# chosen so the arm keeps as much tie-breaking signal as it safely can
# rather than being damped into a no-op. The full sweep:
#
#     w_link:  1.00   0.50   0.25   0.10   0.05   0.02
#     MRR:   0.2918 0.2918 0.3569 0.8293 0.8306 0.8306   (arm off: 0.8306)
#
# PROVISIONAL, and deliberately not tuned finer: on this 30-record corpus
# `ARM_LIMIT` (50) exceeds the corpus, so the vector arm ranks everything
# and the link arm can only RE-RANK, never add a hit. No weight improved any
# metric — damping makes the arm harmless, not useful. Re-tune against a
# corpus larger than ARM_LIMIT (that plan's Phase 6), where the arm can
# finally contribute hits the other arms missed.
ARM_WEIGHTS = {"link": 0.1}


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
            # Same diagnosability rule as the WS handshake in devices_ws.py
            # and the device-token dependency in deps.py: the 503 detail
            # below is deliberately vague, so this line is the whole
            # diagnostic surface.
            logger.error("memory_auth_jwks_unavailable", **jwks_failure_log_fields(exc))
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


# The cursor's ``seq`` half, parsed STRICTLY. ``int()`` alone is too
# permissive in two directions and both are reachable from a client-supplied
# query param: it accepts an integer of ANY magnitude (only >4300 digits
# raises), so an out-of-int64 value survives decode and dies downstream at
# ``CAST(:cursor_seq AS bigint)`` as an uncaught asyncpg ``DataError`` — a 500
# where the docstring promises 400 — and it also accepts surrounding
# whitespace, a sign, PEP-515 underscores and non-ASCII digits (``"1_0"`` -> 10,
# ``"٣"`` -> 3), which would make encode/decode a non-inverse. Digits only,
# then a range check.
_CURSOR_SEQ_RE = re.compile(r"\A[0-9]{1,19}\Z")
_MAX_BIGINT = 2**63 - 1


def _encode_cursor(created_at: datetime, seq: int) -> str:
    """Opaque keyset cursor over ``(created_at, seq)``.

    The token's composition is NOT a client contract — it is base64 of an
    internal pair, and callers only ever echo it back. It moved from
    ``(created_at, memory_id)`` to ``(created_at, seq)`` in lockstep with
    ``list_records_page``'s ``ORDER BY``, because a keyset that disagrees
    with its sort skips and repeats rows. Old tokens are NOT accepted:
    a cursor minted before that change decodes as malformed (400), which
    is the honest answer — silently reinterpreting it would page against
    the wrong key.
    """
    raw = f"{created_at.isoformat()}|{seq}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    """Inverse of :func:`_encode_cursor`; 400 on anything malformed."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        created_raw, sep, seq_raw = raw.partition("|")
        if not sep:
            raise ValueError("missing separator")
        if not _CURSOR_SEQ_RE.match(seq_raw):
            raise ValueError("seq is not a plain decimal integer")
        seq = int(seq_raw)
        if seq > _MAX_BIGINT:
            raise ValueError("seq out of bigint range")
        return datetime.fromisoformat(created_raw), seq
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
    first_index: dict[str, int] = {}
    for i, h in enumerate(hashes):
        first_index.setdefault(h, i)

    # ANCHORS ARE UNIONED ACROSS EVERY OCCURRENCE of a hash, not taken
    # from the first one. Every OTHER column still comes from the first
    # occurrence — that is the long-standing rule and it is unchanged —
    # but anchors are the one field where "first wins" is data loss:
    # two records with identical content are two writers making the same
    # claim, and the second naming its ground truth does not make the
    # first's naming wrong. Taking only ``records[first_index[h]].anchors``
    # dropped the anchor outright whenever the anchored occurrence was not
    # the first, which is the same silent-loss direction the store's own
    # ON CONFLICT union and its intra-batch collapse both exist to
    # prevent — and it defeated them from one layer above, before either
    # could see the anchor. The union here is what makes the store's
    # docstring parity ("later occurrences contribute only their
    # ANCHORS") actually true of the caller.
    #
    # ...but the union MUST be re-capped, because it crosses records and
    # ``MAX_ANCHORS_PER_RECORD`` does not. That cap is enforced on the
    # pydantic request model, i.e. per INCOMING RECORD; nothing below
    # here re-checks it (``MemoryRecordInsert.anchors`` is a bare
    # ``list[dict]``, ``insert_records_batch`` binds it verbatim, and the
    # column carries no length CHECK). So a single request of
    # ``MAX_RECORDS_PER_REQUEST`` identical-content records, each with a
    # full and DISTINCT set of 16 legal anchors, unions to 1600 on one
    # row with every record passing its own 422 — and at zero quota cost,
    # since none of them creates a row.
    #
    # The cap's reason is not tidiness: the array is read whole with its
    # record and RE-RESOLVED BY THE WATCHER EVERY TICK, so its length is
    # a per-tick fan-out of GitHub/twin reads for that one row. 1600
    # anchors is 1600 resolver reads per tick, forever.
    #
    # Truncation rather than rejection, at this layer: every record in
    # such a request is individually legal, so there is nothing honest to
    # 422 about — and silently keeping the first N matches the
    # "first occurrence wins every other column" rule this function
    # already applies right above. The drop is logged (counts only) the
    # same way dropped graph links are, so it is lossy but never silent
    # to an operator.
    anchors_by_hash: dict[str, list[dict[str, Any]]] = {}
    truncated_anchors = 0
    for i, h in enumerate(hashes):
        bucket = anchors_by_hash.setdefault(h, [])
        for anchor in payload.records[i].anchors:
            dumped = anchor.model_dump(mode="json")
            if dumped in bucket:
                continue
            if len(bucket) >= MAX_ANCHORS_PER_RECORD:
                truncated_anchors += 1
                continue
            bucket.append(dumped)
    if truncated_anchors:
        logger.info(
            "memory_anchors_truncated",
            tenant_id=str(principal.tenant_id),
            dropped=truncated_anchors,
            cap=MAX_ANCHORS_PER_RECORD,
        )

    # ANCHOR-BEARING known duplicates go through the batch statement TOO,
    # even though step 3 established their content already exists live.
    # This is the entire mechanism of the plan's Phase 6 backfill:
    # "anchors are added when a record is next written". Skipping them
    # here — which is what this endpoint did before anchors existed,
    # because a known duplicate had literally nothing to contribute —
    # would send them down the ``find_by_hash`` short-circuit in step 5,
    # the write would never reach Postgres, and the ON CONFLICT merge
    # that Phase 6 depends on would never fire. They cost no quota: they
    # create no row, so ``incoming_rows``/``incoming_bytes`` above stay
    # correct.
    #
    # The predicate keys on the UNION, not on the first occurrence: an
    # anchor arriving on a later duplicate of an already-stored hash has
    # to be able to pull that hash into the batch, or the backfill it was
    # written to perform never reaches Postgres at all.
    write_hashes = list(new_by_hash)
    write_hashes.extend(
        h for h in dict.fromkeys(hashes) if h in already_stored and anchors_by_hash[h]
    )
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
            anchors=anchors_by_hash[h],
        )
        for h in write_hashes
    ]
    batch_results = await store.insert_records_batch(
        db, tenant_id=principal.tenant_id, items=batch_items
    )
    outcome_by_hash: dict[str, tuple[UUID, bool]] = dict(
        zip(write_hashes, batch_results, strict=True)
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
                anchors=[a.model_dump(mode="json") for a in rec.anchors],
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

    Optionally a THIRD arm: with ``link_expansion=true`` the endpoint
    fuses twice — once over vector+FTS to pick the top
    :data:`LINK_SEED_COUNT` seeds, then again after one-hop expansion of
    those seeds over ``coord.memory_links``. ``link_arm`` says which of
    ``expanded`` / ``skipped_disabled`` / ``skipped_no_seeds`` happened,
    and a hit reached only that way carries ``link_rank`` with both other
    ranks null. The arm is default-OFF until the recall-efficacy harness
    can say whether it helps.

    All arms are tenant-bound and validity-filtered (tombstones out,
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

    Every hit carries ``anchor_state``. ``moved`` means the ground truth
    the record is anchored to changed under it: the record is still
    retrievable and normally ranked (§3.2 makes ``moved`` advisory on
    purpose — silently hiding a true memory is the failure mode that
    matters), and the flag is how a reader learns to check.

    ``anchored_to`` is the separate PROACTIVE arm (Phase 5): records
    anchored to the files the caller is touching, ranked by importance x
    freshness, returned in ``anchored_hits`` rather than fused into
    ``hits``. It is gated on ``MEMORY_ANCHORED_RECALL_ENABLED``, which is
    OFF by default; ``anchored_arm`` always says which of ran /
    not_requested / skipped_disabled happened.
    """
    # Left as ``None`` when the caller names no instant, so validity is
    # evaluated against the row's OWN transaction-stamped timestamps
    # rather than a clock read here. Substituting an app-host
    # ``datetime.now(UTC)`` made a just-written record invisible to the
    # query that follows it whenever the database clock ran ahead of this
    # host's. See ``memory_store._EFFECTIVE_NOW_SQL``.
    as_of = payload.as_of
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

    vector_ids = [mid for mid, _sim in vector_hits]
    # First fuse: picks the SEEDS. They must be the best COMBINED
    # evidence, not the head of either arm alone — hence a fuse rather
    # than a concatenation, and hence two fuses rather than one.
    fused_2 = rrf_fuse({"vector": vector_ids, "fts": fts_ids})

    link_arm: Literal["expanded", "skipped_disabled", "skipped_no_seeds"]
    seed_ids = [h.id for h in fused_2[:LINK_SEED_COUNT]]
    if not payload.link_expansion:
        link_arm = "skipped_disabled"
        fused = fused_2
    elif not seed_ids:
        # Nothing matched either arm, so there is nothing to hop FROM.
        # Reported distinctly from `expanded`: no expansion query ran.
        link_arm = "skipped_no_seeds"
        fused = fused_2
    else:
        link_ids = await store.link_expansion(db, seed_ids=seed_ids, **filter_kwargs)
        link_arm = "expanded"
        # Second fuse: the answer. Pure in-memory math over <= 3x50 ids.
        fused = rrf_fuse(
            {"vector": vector_ids, "fts": fts_ids, "link": link_ids},
            weights=ARM_WEIGHTS,
        )

    # Sliced only AFTER the re-fuse, so a link-only hit can displace a
    # weaker lexical one instead of being cut before it competes.
    top = fused[: payload.limit]

    # Anchor-keyed proactive recall (Phase 5). Runs only when the caller
    # asked AND the flag is on; the arm's own state is reported either
    # way, so an empty ``anchored_hits`` is never ambiguous between
    # "found nothing" and "never ran".
    anchored_arm: Literal["ran", "not_requested", "skipped_disabled"]
    anchored_ids: list[UUID] = []
    if not payload.anchored_to:
        anchored_arm = "not_requested"
    elif not settings.MEMORY_ANCHORED_RECALL_ENABLED:
        anchored_arm = "skipped_disabled"
    else:
        anchored_ids = await store.anchored_search(
            db,
            anchored_to=[(c.repo, c.path_glob) for c in payload.anchored_to],
            limit=payload.limit,
            **filter_kwargs,
        )
        anchored_arm = "ran"

    rows = await store.fetch_records(
        db, principal.tenant_id, [h.id for h in top] + anchored_ids
    )
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
                anchor_state=row["anchor_state"],
                rrf_score=fh.rrf_score,
                vector_rank=fh.vector_rank,
                fts_rank=fh.fts_rank,
                link_rank=fh.link_rank,
                # A link-only hit has no cosine score, and inventing one
                # would misreport how it was found. `None` is the answer.
                cosine_similarity=similarity.get(fh.id),
            )
        )

    anchored_hits: list[MemoryQueryHit] = []
    for anchored_id in anchored_ids:
        row = rows.get(anchored_id)
        if row is None:  # pragma: no cover — the arm is tenant-bound
            continue
        anchored_hits.append(
            MemoryQueryHit(
                memory_id=anchored_id,
                title=row["title"],
                content=row["content"],
                kind=row["kind"],
                scope=row["scope"],
                importance=row["importance"],
                created_at=row["created_at"],
                source=row["source"] or {},
                anchor_state=row["anchor_state"],
                # This arm ranks by importance x freshness, not by RRF —
                # ``anchored_ids`` is already best-first. A fabricated
                # rrf_score would read as a fusion rank it never had.
                rrf_score=0.0,
            )
        )

    await store.bump_access(
        db,
        principal.tenant_id,
        [h.memory_id for h in hits] + [h.memory_id for h in anchored_hits],
    )
    return MemoryQueryResponse(
        hits=hits,
        vector_arm=vector_arm,
        link_arm=link_arm,
        anchored_arm=anchored_arm,
        anchored_hits=anchored_hits,
    )


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
    ``(created_at, seq)`` keyset token from the previous page.
    Each record carries its outbound ``links``. Ordering is
    ``created_at DESC, seq DESC`` — newest first in WRITE order (``seq``
    is the monotone write-order key; a batch write shares one
    ``created_at``, so the old ``memory_id`` UUID tiebreak paginated a
    batch in random order) and stable under concurrent writes (new rows
    only ever prepend).
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
        # No caller-named instant — see ``_EFFECTIVE_NOW_SQL``.
        now=None,
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
            anchors=row["anchors"] or [],
            anchor_state=row["anchor_state"],
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
        _encode_cursor(rows[-1]["created_at"], rows[-1]["seq"])
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

    ``anchors`` ARE inherited when omitted (unlike ``embedding``) — see
    the comment on the insert below for why the two go opposite ways.
    This is the "superseded, or corrected" arm of the plan's Phase 6.
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

    # ANCHOR INHERITANCE (plan 2026-07-29-memory-anchored-derived-records,
    # Phase 6's "superseded, or corrected" arm).
    #
    # Omitting `anchors` INHERITS the superseded record's. That is the
    # opposite of what `embedding` does two lines down, and the asymmetry
    # is deliberate: an embedding is a function OF THE CONTENT, so
    # carrying it onto rewritten text makes it a lie about that text. An
    # anchor is not about the content — it names the ARTIFACT the record
    # asserts something about, and superseding is precisely how a record
    # about that artifact gets corrected. The predecessor's binding is
    # therefore still the best available claim about the successor.
    #
    # The decision rests on which way the mistake costs more, and the two
    # directions are not symmetric:
    #
    # * A WRONGLY INHERITED anchor gets the record `moved` (advisory,
    #   still retrievable, normally ranked) or at worst `gone` — which
    #   requires UNANIMITY across every anchor, only HIDES the row, is
    #   never a prune marker, and is un-invalidated automatically by
    #   `anchor_gone_sweep` the moment the verdict is withdrawn. Bounded
    #   and reversible.
    # * A WRONGLY DROPPED anchor is silent and unbounded: the successor
    #   falls back onto the Ebbinghaus curve, earns `source.decayed_at`
    #   around day 207, and `decay_prune` PHYSICALLY DELETES it 90 days
    #   after that. Nothing in the system ever notices the demotion.
    #
    # This is the same "hiding is reversible, deletion is not" rule that
    # made `anchor_gone_at` a distinct marker from `decayed_at`, applied
    # to inheritance. So: inherit by default, and let an explicit `[]`
    # un-anchor a rewrite that genuinely changed subject — the escape
    # hatch is what makes the default safe. A non-empty array REPLACES
    # wholesale rather than merging, because supersede is the explicit
    # human path and "here is what this record is about now" should be
    # authoritative, not additive.
    #
    # `anchor_state` is never inherited: the successor is a new row and
    # takes the column default `none`, so the watcher re-resolves it
    # rather than the row asserting a check that never ran against it.
    inherited_anchors: list[dict[str, Any]] = (
        [a.model_dump(mode="json") for a in payload.anchors]
        if payload.anchors is not None
        else list(old["anchors"] or [])
    )

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
        anchors=inherited_anchors,
    )
    if new_id == memory_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=("replacement content is identical to the record being superseded"),
        )
    try:
        await store.mark_superseded(
            db,
            tenant_id=principal.tenant_id,
            old_memory_id=memory_id,
            new_memory_id=new_id,
        )
    except store.SupersedeRefused as exc:
        # The supersede guard rejected the edge: the replacement is not live,
        # or it already points back at this record (which would form a
        # supersede cycle — the 2026-08-04 corruption). This is a conflict with
        # the corpus's current state, not a server fault, so it must not
        # surface as a 500. 409 matches the identical-content case above.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    return SupersedeResponse(
        memory_id=new_id, superseded_memory_id=memory_id, deduped=deduped
    )


@router.put("/records/{memory_id}/hold", response_model=LifecycleHoldResponse)
async def hold_record(
    memory_id: UUID,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> LifecycleHoldResponse:
    """Hold a record out of every AUTOMATIC lifecycle sweep.

    Sets ``source.lifecycle_hold = true``, which the seven automatic
    gates in ``memory_store`` honour: both consolidation supersede paths
    (near-dup and cluster), the in-flight synthesis apply, decay
    invalidate, the physical decay prune, closed-session expiry and the
    MEMORY.md bridge. It does NOT freeze the record against explicit
    action — ``POST /records/{id}/supersede`` and ``DELETE /records/{id}``
    still apply, because overriding a hold is exactly how an adjudication
    lands.

    Idempotent, and appliable to SUPERSEDED and tombstoned records — that
    is the point rather than an oversight. A record wrongly folded away
    by consolidation is the usual reason to hold one, and until a hold
    exists the prune physically deletes such a row once its 90-day grace
    passes.

    404 for records that don't exist in the caller's tenant (cross-tenant
    ids are never disclosed).
    """
    return await _set_hold(memory_id, held=True, principal=principal, db=db)


@router.delete("/records/{memory_id}/hold", response_model=LifecycleHoldResponse)
async def release_record_hold(
    memory_id: UUID,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> LifecycleHoldResponse:
    """Release the hold — the record returns to normal lifecycle management.

    Writes an explicit ``source.lifecycle_hold = false`` rather than
    dropping the key, because ``false`` records "this record was
    adjudicated and released" — a state the lifecycle predicate
    deliberately distinguishes from never having been held, and what
    makes the ``lifecycle_held`` count in ``GET /stats`` a true measure
    of the adjudication backlog rather than of churn.

    Idempotent: releasing an unheld record is a no-op that reports
    ``held=False``. 404 only when the record does not exist in the
    caller's tenant.
    """
    return await _set_hold(memory_id, held=False, principal=principal, db=db)


async def _set_hold(
    memory_id: UUID,
    *,
    held: bool,
    principal: MemoryPrincipal,
    db: AsyncSession,
) -> LifecycleHoldResponse:
    """Shared body of the two hold verbs — they differ only in ``held``."""
    matched = await store.set_lifecycle_hold(
        db,
        tenant_id=principal.tenant_id,
        memory_id=memory_id,
        held=held,
        now=datetime.now(UTC),
    )
    if not matched:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="memory record not found",
        )
    logger.info(
        "memory_lifecycle_hold_set",
        memory_id=str(memory_id),
        held=held,
    )
    return LifecycleHoldResponse(memory_id=memory_id, held=held)


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


async def _stats_facets(db: AsyncSession, tenant_id: UUID) -> MemoryFacets | None:
    """Content facets, or ``None`` when the read could not complete.

    ``None`` is the honest answer to a degraded read and drives
    ``corpus_complete=False``. The alternative — returning whatever
    partial aggregate came back — is the failure this whole surface
    exists to prevent: a caller cannot tell a partial read from a small
    corpus, so smaller-but-confident numbers are worse than no numbers.
    Same contract coord's ``coord_query_memory_state`` already states:
    unreachable is a blind spot, NEVER an empty confident success.

    Only TRANSIENT infrastructure failures degrade: a statement timeout
    on a very large corpus or a dropped connection
    (:class:`~sqlalchemy.exc.OperationalError`), a pool checkout timeout
    (:class:`sqlalchemy.exc.TimeoutError`), or an ``asyncio`` timeout
    (the builtin :class:`TimeoutError`, which ``asyncio.TimeoutError``
    aliases). Anything else propagates.

    The catch is deliberately NOT ``SQLAlchemyError``. That would swallow
    ``ProgrammingError`` (undefined column or function, syntax error) and
    ``DataError`` — the shapes a genuine defect in the hand-written facets
    SQL, or schema drift after a migration, actually take. Those are not
    degradation; they are permanent, they would silently null the facets
    on EVERY ``/stats`` call for every tenant, and the only trace would be
    a log line. Same reasoning that keeps ``TypeError`` uncaught here: a
    bug must be loud. Let them 500.

    Logged at ``error``, not ``warning``: even the transient arm means the
    surface is currently answering "I could not look", which is worth
    paging on if it persists.

    Called LAST in the handler and rolling back on failure, because a
    failed statement aborts the surrounding transaction: the plumbing
    fields are already read by then, and the rollback leaves the session
    in a state the request-scoped ``commit()`` can still close. The
    rollback is itself guarded — it runs on a connection that may be the
    very thing that just failed, and a raising rollback inside the
    graceful-degradation handler would turn ``/stats`` into a 500, which
    is exactly what this path exists to avoid.
    """
    try:
        facets = await store.facets(db, tenant_id)
    except (OperationalError, SATimeoutError, TimeoutError) as exc:
        try:
            await db.rollback()
        except SQLAlchemyError as rollback_exc:
            logger.warning(
                "memory_stats_facets_rollback_failed",
                tenant_id=str(tenant_id),
                error=str(rollback_exc),
            )
        logger.error(
            "memory_stats_facets_degraded",
            tenant_id=str(tenant_id),
            error=str(exc),
        )
        return None
    return MemoryFacets(
        live_row_count=facets.live_row_count,
        by_kind=facets.by_kind,
        by_scope=facets.by_scope,
        age=MemoryAgeFacet(
            p50_days=facets.age.p50_days,
            p90_days=facets.age.p90_days,
            oldest_days=facets.age.oldest_days,
        ),
        importance=MemoryImportanceFacet(
            p50=facets.importance.p50,
            p90=facets.importance.p90,
            above_0_8=facets.importance.above_0_8,
        ),
        recent_titles=facets.recent_titles,
    )


@router.get("/stats", response_model=MemoryStatsResponse)
async def memory_stats(
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> MemoryStatsResponse:
    """Usage + quota posture + content facets for the caller's tenant.

    The quota fields answer "is the plumbing healthy"; ``facets`` answers
    "what is in here" — the read an agent needs BEFORE guessing at query
    vocabulary. ``corpus_complete`` distinguishes a genuinely small
    corpus from a facet read that degraded.
    """
    usage = await store.get_usage(db, principal.tenant_id)
    coverage = await store.embedding_coverage(db, principal.tenant_id)
    held = await store.count_lifecycle_held(db, principal.tenant_id)
    # Scoped to kind='synthesis': the queue now also carries embedding
    # jobs, and these fields say "synthesis".
    job_counts = await store.job_counts(db, principal.tenant_id, kind="synthesis")
    utilization = max(
        usage.bytes / usage.quota_bytes if usage.quota_bytes > 0 else 0.0,
        usage.row_count / usage.quota_rows if usage.quota_rows > 0 else 0.0,
    )
    facets = await _stats_facets(db, principal.tenant_id)
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
        lifecycle_held=held,
        facets=facets,
        corpus_complete=facets is not None,
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
