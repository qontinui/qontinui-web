"""Data access for ``coord.memory_records`` — the tenant agentic memory.

Phases 1 + 4 + 5 of
``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

ALL SQL touching the memory substrate (``coord.memory_records`` +
``coord.tenant_policies`` quota knobs, plus the Phase 4 lifecycle
sweeps and the Phase 5 ``coord.memories_latest`` bridge reads) lives in
this one module, which is vetted into ``WRITE_PATH_FOLLOWUP`` in
``tests/test_coord_schema_boundary_guard.py``: web owns this substrate
(its schema ships in web's own alembic migration
``coord_memory_records``), so the memory API reads/writes it directly
over web's shared-Postgres session — the same posture as the
``Device`` / ``TestTarget`` write paths. Keeping every ``coord.*``
literal here keeps the boundary-guard allowlist to a single entry.

Schema reference: ``backend/alembic/versions/coord_memory_records.py``
(and ``coord_memories.py`` / ``coord_tenant_scope_columns.py`` for the
``coord.memories_latest`` view the MEMORY.md bridge mirrors).

Lifecycle SQL discipline: the decay sweep's retention-score expression
mirrors the pure-Python :func:`app.services.memory_lifecycle.retention_score`
formula exactly; ``tests/test_memory_lifecycle_db.py`` asserts the two
agree on seeded rows.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast
from uuid import UUID

import structlog
from sqlalchemy import CursorResult, Float, Text, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.memory_embedder import EMBEDDING_MODEL_TAG
from app.services.memory_lifecycle import (
    DECAY_ACCESS_CAP,
    DECAY_BASE_HORIZON_DAYS,
    ClusterItem,
    DupCandidate,
    MergeDecision,
)

logger = structlog.get_logger(__name__)

# Mirror the migration's tenant_policies column defaults — used when the
# tenant has no ``coord.tenant_policies`` row (COALESCE on a LEFT JOIN,
# so a missing policy row means "the defaults", never a failure).
DEFAULT_MEMORY_QUOTA_BYTES = 256 * 1024 * 1024
DEFAULT_MEMORY_ROW_QUOTA = 500_000

# How many candidates each retrieval arm contributes to RRF fusion.
ARM_LIMIT = 50

# Scopes that are only visible when the caller explicitly requests them
# AND supplies the matching ``scope_ref``.
NARROW_SCOPES = ("agent", "session")

# The liveness predicate of the ``uq_memory_records_tenant_content_hash_live``
# partial unique index (see the ``coord_memory_records`` migration): only
# LIVE rows participate in content-hash dedup, so tombstoning / superseding /
# ending a row's validity frees its content_hash for a fresh write. Every
# dedup lookup and every ON CONFLICT target in this module MUST use exactly
# this predicate — a broader check would resurrect the swallowed-re-write
# data-loss bug this index exists to prevent.
_LIVE_DEDUP_PREDICATE = (
    "is_tombstone = false AND superseded_by IS NULL AND valid_until IS NULL"
)


def format_pgvector(vector: list[float]) -> str:
    """Render a vector as pgvector's text literal (``[v1,v2,...]``)."""
    return "[" + ",".join(repr(float(v)) for v in vector) + "]"


@dataclass(frozen=True)
class TenantMemoryUsage:
    """Current usage + effective quotas for one tenant."""

    row_count: int
    bytes: int
    quota_bytes: int
    quota_rows: int


async def get_usage(session: AsyncSession, tenant_id: UUID) -> TenantMemoryUsage:
    """Rows/bytes used by ``tenant_id`` plus its effective quotas.

    Only non-tombstone rows count against quota (a delete frees quota
    immediately); superseded / decay-invalidated rows still count until
    the physical prune — they remain retrievable-storage lineage. Bytes
    are ``octet_length(content)``. Both definitions match the coord
    twin-census observer, so quota posture and census never disagree.

    Quotas COALESCE against the migration defaults over a LEFT JOIN, so
    a tenant without a ``coord.tenant_policies`` row gets the defaults —
    matching how coord treats missing policy rows.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT
                    (SELECT count(*)
                       FROM coord.memory_records r
                      WHERE r.tenant_id = :tenant_id
                        AND r.is_tombstone = false) AS row_count,
                    (SELECT COALESCE(sum(octet_length(r.content)), 0)
                       FROM coord.memory_records r
                      WHERE r.tenant_id = :tenant_id
                        AND r.is_tombstone = false) AS bytes,
                    COALESCE(p.memory_quota_bytes, :default_quota_bytes)
                        AS quota_bytes,
                    COALESCE(p.memory_row_quota, :default_row_quota)
                        AS quota_rows
                FROM (SELECT 1) AS one
                LEFT JOIN coord.tenant_policies p
                       ON p.tenant_id = :tenant_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "default_quota_bytes": DEFAULT_MEMORY_QUOTA_BYTES,
                "default_row_quota": DEFAULT_MEMORY_ROW_QUOTA,
            },
        )
    ).one()
    return TenantMemoryUsage(
        row_count=int(row.row_count),
        bytes=int(row.bytes),
        quota_bytes=int(row.quota_bytes),
        quota_rows=int(row.quota_rows),
    )


async def embedding_coverage(session: AsyncSession, tenant_id: UUID) -> float:
    """Fraction of the tenant's rows carrying a non-NULL embedding.

    An empty store counts as fully covered (1.0) — no drift to report.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT count(*) AS total,
                       count(embedding) AS embedded
                FROM coord.memory_records
                WHERE tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id},
        )
    ).one()
    total = int(row.total)
    return 1.0 if total == 0 else int(row.embedded) / total


async def insert_record(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    scope: str,
    scope_ref: str | None,
    kind: str,
    title: str,
    content: str,
    content_hash: str,
    embedding: list[float],
    importance: float,
    source: dict[str, Any],
    consolidated_from: list[UUID] | None = None,
) -> tuple[UUID, bool]:
    """Insert one record, deduping on ``(tenant_id, content_hash)``
    against LIVE rows only.

    The conflict target is the ``uq_memory_records_tenant_content_hash_live``
    partial unique index, so tombstoned / superseded / validity-ended
    rows never swallow a re-write of identical content. Returns
    ``(memory_id, deduped)`` — on conflict the EXISTING live row's id is
    returned with ``deduped=True``. ``consolidated_from`` carries the
    member lineage of a synthesized ``mental_model`` row (Phase 4).
    """
    inserted = (
        await session.execute(
            text(
                f"""
                INSERT INTO coord.memory_records
                    (tenant_id, scope, scope_ref, kind, title, content,
                     content_hash, embedding, embedding_model, importance,
                     source, consolidated_from)
                VALUES
                    (:tenant_id, :scope, :scope_ref, :kind, :title, :content,
                     :content_hash, CAST(:embedding AS vector),
                     :embedding_model, :importance, CAST(:source AS jsonb),
                     CAST(:consolidated_from AS uuid[]))
                ON CONFLICT (tenant_id, content_hash)
                    WHERE {_LIVE_DEDUP_PREDICATE}
                    DO NOTHING
                RETURNING memory_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "scope": scope,
                "scope_ref": scope_ref,
                "kind": kind,
                "title": title,
                "content": content,
                "content_hash": content_hash,
                "embedding": format_pgvector(embedding),
                "embedding_model": EMBEDDING_MODEL_TAG,
                "importance": importance,
                "source": json.dumps(source),
                "consolidated_from": consolidated_from,
            },
        )
    ).scalar_one_or_none()
    if inserted is not None:
        return UUID(str(inserted)), False

    existing = (
        await session.execute(
            text(
                f"""
                SELECT memory_id FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND content_hash = :content_hash
                  AND {_LIVE_DEDUP_PREDICATE}
                """
            ),
            {"tenant_id": tenant_id, "content_hash": content_hash},
        )
    ).scalar_one()
    return UUID(str(existing)), True


@dataclass(frozen=True)
class MemoryRecordInsert:
    """One record in a set-based :func:`insert_records_batch` call."""

    scope: str
    scope_ref: str | None
    kind: str
    title: str
    content: str
    content_hash: str
    embedding: list[float]
    importance: float
    source: dict[str, Any]


async def insert_records_batch(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    items: list[MemoryRecordInsert],
) -> list[tuple[UUID, bool]]:
    """Set-based multi-row insert with the same live-row dedup semantics
    as :func:`insert_record`, in ONE round-trip (plus one dedup lookup
    when any row conflicted).

    Callers must pre-dedupe intra-batch: each item's ``content_hash``
    must be unique within ``items`` (the write endpoint keeps the first
    occurrence and reports later intra-batch duplicates itself).

    Returns ``(memory_id, deduped)`` per item, in item order — conflicts
    against an existing LIVE row report that row's id with
    ``deduped=True``, exactly like :func:`insert_record`.
    """
    if not items:
        return []
    stmt = text(
        f"""
        INSERT INTO coord.memory_records
            (tenant_id, scope, scope_ref, kind, title, content,
             content_hash, embedding, embedding_model, importance, source)
        SELECT :tenant_id, u.scope, u.scope_ref, u.kind, u.title,
               u.content, u.content_hash, CAST(u.embedding AS vector),
               :embedding_model, u.importance, CAST(u.source AS jsonb)
        FROM unnest(
                 CAST(:scopes AS text[]),
                 CAST(:scope_refs AS text[]),
                 CAST(:kinds AS text[]),
                 CAST(:titles AS text[]),
                 CAST(:contents AS text[]),
                 CAST(:content_hashes AS text[]),
                 CAST(:embeddings AS text[]),
                 CAST(:importances AS float8[]),
                 CAST(:sources AS text[])
             ) AS u(scope, scope_ref, kind, title, content, content_hash,
                    embedding, importance, source)
        ON CONFLICT (tenant_id, content_hash)
            WHERE {_LIVE_DEDUP_PREDICATE}
            DO NOTHING
        RETURNING memory_id, content_hash
        """
    ).bindparams(
        bindparam("scopes", type_=ARRAY(Text())),
        bindparam("scope_refs", type_=ARRAY(Text())),
        bindparam("kinds", type_=ARRAY(Text())),
        bindparam("titles", type_=ARRAY(Text())),
        bindparam("contents", type_=ARRAY(Text())),
        bindparam("content_hashes", type_=ARRAY(Text())),
        bindparam("embeddings", type_=ARRAY(Text())),
        bindparam("importances", type_=ARRAY(Float())),
        bindparam("sources", type_=ARRAY(Text())),
    )
    rows = await session.execute(
        stmt,
        {
            "tenant_id": tenant_id,
            "embedding_model": EMBEDDING_MODEL_TAG,
            "scopes": [i.scope for i in items],
            "scope_refs": [i.scope_ref for i in items],
            "kinds": [i.kind for i in items],
            "titles": [i.title for i in items],
            "contents": [i.content for i in items],
            "content_hashes": [i.content_hash for i in items],
            "embeddings": [format_pgvector(i.embedding) for i in items],
            "importances": [i.importance for i in items],
            "sources": [json.dumps(i.source) for i in items],
        },
    )
    inserted: dict[str, UUID] = {
        str(r.content_hash): UUID(str(r.memory_id)) for r in rows
    }

    conflicted = [i.content_hash for i in items if i.content_hash not in inserted]
    existing: dict[str, UUID] = {}
    if conflicted:
        lookup = text(
            f"""
            SELECT memory_id, content_hash FROM coord.memory_records
            WHERE tenant_id = :tenant_id AND content_hash IN :hashes
              AND {_LIVE_DEDUP_PREDICATE}
            """
        ).bindparams(bindparam("hashes", expanding=True))
        found = await session.execute(
            lookup, {"tenant_id": tenant_id, "hashes": conflicted}
        )
        existing = {str(r.content_hash): UUID(str(r.memory_id)) for r in found}

    results: list[tuple[UUID, bool]] = []
    for item in items:
        new_id = inserted.get(item.content_hash)
        if new_id is not None:
            results.append((new_id, False))
        else:
            # Same invariant as insert_record's scalar_one: a conflict
            # means a live row with this hash exists.
            results.append((existing[item.content_hash], True))
    return results


async def existing_hashes(
    session: AsyncSession, tenant_id: UUID, hashes: list[str]
) -> set[str]:
    """Which of ``hashes`` already exist as LIVE rows for this tenant
    (pre-embed dedup check, so known-duplicate contents are never
    re-embedded). Dead rows (tombstoned / superseded / validity-ended)
    don't count — their content is re-writable."""
    if not hashes:
        return set()
    stmt = text(
        f"""
        SELECT content_hash FROM coord.memory_records
        WHERE tenant_id = :tenant_id AND content_hash IN :hashes
          AND {_LIVE_DEDUP_PREDICATE}
        """
    ).bindparams(bindparam("hashes", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "hashes": hashes})
    return {str(r.content_hash) for r in rows}


async def find_by_hash(
    session: AsyncSession, tenant_id: UUID, content_hash: str
) -> UUID | None:
    """The tenant's LIVE record id carrying ``content_hash``, if any."""
    found = (
        await session.execute(
            text(
                f"""
                SELECT memory_id FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND content_hash = :content_hash
                  AND {_LIVE_DEDUP_PREDICATE}
                """
            ),
            {"tenant_id": tenant_id, "content_hash": content_hash},
        )
    ).scalar_one_or_none()
    return UUID(str(found)) if found is not None else None


def _validity_filters(
    *,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
) -> tuple[str, dict[str, Any]]:
    """Shared WHERE fragment + params for both retrieval arms.

    Tenant binding, tombstone/validity filtering (against ``:as_of``),
    the scope rule (``agent``/``session`` rows require the matching
    ``scope_ref``), and the optional kind/importance/recency filters.
    """
    clauses = [
        "r.tenant_id = :tenant_id",
        "r.is_tombstone = false",
        "r.valid_from <= :as_of",
        "(r.valid_until IS NULL OR r.valid_until > :as_of)",
        "r.scope IN :scopes",
        "(r.scope NOT IN ('agent', 'session') OR r.scope_ref = :scope_ref)",
    ]
    params: dict[str, Any] = {"scopes": scopes, "scope_ref": scope_ref}
    if kinds:
        clauses.append("r.kind IN :kinds")
        params["kinds"] = kinds
    if min_importance is not None:
        clauses.append("r.importance >= :min_importance")
        params["min_importance"] = min_importance
    if since is not None:
        clauses.append("r.created_at >= :since")
        params["since"] = since
    return " AND ".join(clauses), params


async def vector_search(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    query_embedding: list[float],
    as_of: datetime,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
    arm_limit: int = ARM_LIMIT,
) -> list[tuple[UUID, float]]:
    """Semantic arm: HNSW cosine top-N as ``(memory_id, similarity)``."""
    where, params = _validity_filters(
        kinds=kinds,
        scopes=scopes,
        scope_ref=scope_ref,
        min_importance=min_importance,
        since=since,
    )
    stmt = text(
        f"""
        SELECT r.memory_id,
               1 - (r.embedding <=> CAST(:qvec AS vector)) AS cosine_similarity
        FROM coord.memory_records r
        WHERE {where} AND r.embedding IS NOT NULL
        ORDER BY r.embedding <=> CAST(:qvec AS vector)
        LIMIT :arm_limit
        """
    ).bindparams(bindparam("scopes", expanding=True))
    if "kinds" in params:
        stmt = stmt.bindparams(bindparam("kinds", expanding=True))
    rows = await session.execute(
        stmt,
        {
            **params,
            "tenant_id": tenant_id,
            "as_of": as_of,
            "qvec": format_pgvector(query_embedding),
            "arm_limit": arm_limit,
        },
    )
    return [(UUID(str(r.memory_id)), float(r.cosine_similarity)) for r in rows]


async def fts_search(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    query_text: str,
    as_of: datetime,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
    arm_limit: int = ARM_LIMIT,
) -> list[UUID]:
    """Lexical arm: websearch FTS top-N ids, ``ts_rank_cd``-ordered."""
    where, params = _validity_filters(
        kinds=kinds,
        scopes=scopes,
        scope_ref=scope_ref,
        min_importance=min_importance,
        since=since,
    )
    stmt = text(
        f"""
        SELECT r.memory_id,
               ts_rank_cd(r.content_tsv,
                          websearch_to_tsquery('english', :q)) AS fts_score
        FROM coord.memory_records r
        WHERE {where}
          AND r.content_tsv @@ websearch_to_tsquery('english', :q)
        ORDER BY fts_score DESC, r.created_at DESC
        LIMIT :arm_limit
        """
    ).bindparams(bindparam("scopes", expanding=True))
    if "kinds" in params:
        stmt = stmt.bindparams(bindparam("kinds", expanding=True))
    rows = await session.execute(
        stmt,
        {
            **params,
            "tenant_id": tenant_id,
            "as_of": as_of,
            "q": query_text,
            "arm_limit": arm_limit,
        },
    )
    return [UUID(str(r.memory_id)) for r in rows]


async def fetch_records(
    session: AsyncSession, tenant_id: UUID, memory_ids: list[UUID]
) -> dict[UUID, dict[str, Any]]:
    """Full rows for ``memory_ids``, keyed by id. Tenant-bound."""
    if not memory_ids:
        return {}
    stmt = text(
        """
        SELECT memory_id, title, content, kind, scope, scope_ref,
               importance, created_at, source
        FROM coord.memory_records
        WHERE tenant_id = :tenant_id AND memory_id IN :ids
        """
    ).bindparams(bindparam("ids", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "ids": memory_ids})
    out: dict[UUID, dict[str, Any]] = {}
    for r in rows.mappings():
        d = dict(r)
        out[UUID(str(d["memory_id"]))] = d
    return out


async def bump_access(
    session: AsyncSession, tenant_id: UUID, memory_ids: list[UUID]
) -> None:
    """Single UPDATE: increment access counters on the returned rows."""
    if not memory_ids:
        return
    stmt = text(
        """
        UPDATE coord.memory_records
        SET access_count = access_count + 1,
            last_accessed_at = now()
        WHERE tenant_id = :tenant_id AND memory_id IN :ids
        """
    ).bindparams(bindparam("ids", expanding=True))
    await session.execute(stmt, {"tenant_id": tenant_id, "ids": memory_ids})


async def get_record(
    session: AsyncSession, tenant_id: UUID, memory_id: UUID
) -> dict[str, Any] | None:
    """One row by id, tenant-bound (cross-tenant reads come back None)."""
    row = (
        (
            await session.execute(
                text(
                    """
                SELECT memory_id, tenant_id, scope, scope_ref, kind, title,
                       content, content_hash, importance, source,
                       is_tombstone, superseded_by, valid_from, valid_until,
                       created_at
                FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND memory_id = :memory_id
                """
                ),
                {"tenant_id": tenant_id, "memory_id": memory_id},
            )
        )
        .mappings()
        .one_or_none()
    )
    return dict(row) if row is not None else None


async def mark_superseded(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    old_memory_id: UUID,
    new_memory_id: UUID,
) -> None:
    """Point the old row at its replacement and end its validity."""
    await session.execute(
        text(
            """
            UPDATE coord.memory_records
            SET superseded_by = :new_memory_id,
                valid_until = now(),
                updated_at = now()
            WHERE tenant_id = :tenant_id AND memory_id = :old_memory_id
            """
        ),
        {
            "tenant_id": tenant_id,
            "old_memory_id": old_memory_id,
            "new_memory_id": new_memory_id,
        },
    )


async def tombstone_record(
    session: AsyncSession, tenant_id: UUID, memory_id: UUID
) -> bool:
    """Tombstone one row; False when it doesn't exist for this tenant."""
    deleted = (
        await session.execute(
            text(
                """
                UPDATE coord.memory_records
                SET is_tombstone = true,
                    valid_until = now(),
                    updated_at = now()
                WHERE tenant_id = :tenant_id AND memory_id = :memory_id
                RETURNING memory_id
                """
            ),
            {"tenant_id": tenant_id, "memory_id": memory_id},
        )
    ).scalar_one_or_none()
    return deleted is not None


# ===========================================================================
# Phase 4 — lifecycle sweeps (decay / consolidation / reindex)
# ===========================================================================

# The SQL retention-score expression. MUST stay in lockstep with
# ``memory_lifecycle.retention_score`` — the DB test asserts agreement.
# Age is measured against COALESCE(last_accessed_at, created_at) in days.
_RETENTION_SCORE_SQL = f"""
    importance * exp(
        -(EXTRACT(EPOCH FROM (CAST(:now AS timestamptz)
                              - COALESCE(last_accessed_at, created_at)))
          / 86400.0)
        / ({DECAY_BASE_HORIZON_DAYS}
           * (0.5 + LEAST(access_count, {DECAY_ACCESS_CAP})
                    / CAST({DECAY_ACCESS_CAP} AS double precision)))
    )
"""


def parse_pgvector(literal: str) -> list[float]:
    """Parse pgvector's text literal (``[v1,v2,...]``) back to floats."""
    inner = literal.strip().strip("[]")
    if not inner:
        return []
    return [float(part) for part in inner.split(",")]


async def compute_retention_scores(
    session: AsyncSession, tenant_id: UUID, *, now: datetime
) -> dict[UUID, float]:
    """SQL-side retention scores for a tenant's non-tombstone rows.

    Exists so tests can assert the SQL formula agrees with the pure
    Python :func:`memory_lifecycle.retention_score` on the same rows.
    """
    rows = await session.execute(
        text(
            f"""
            SELECT memory_id, {_RETENTION_SCORE_SQL} AS score
            FROM coord.memory_records
            WHERE tenant_id = :tenant_id AND is_tombstone = false
            """
        ),
        {"tenant_id": tenant_id, "now": now},
    )
    return {UUID(str(r.memory_id)): float(r.score) for r in rows}


async def decay_invalidate(
    session: AsyncSession, *, now: datetime, threshold: float
) -> int:
    """Set-based decay sweep: end validity of rows scoring below threshold.

    Rows become retrieval-invisible (``valid_until = :now``) — NOT
    deleted. Each is stamped ``source.decayed_at`` so the later physical
    prune can distinguish decay-invalidated rows from rows whose
    ``valid_until`` was set by an explicit temporal validity. Returns
    the number of rows invalidated.
    """
    result = await session.execute(
        text(
            f"""
            UPDATE coord.memory_records
            SET valid_until = :now,
                updated_at = :now,
                source = source
                    || jsonb_build_object('decayed_at',
                                          CAST(:now_iso AS text))
            WHERE is_tombstone = false
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
              AND {_RETENTION_SCORE_SQL} < :threshold
            """
        ),
        {"now": now, "now_iso": now.isoformat(), "threshold": threshold},
    )
    return int(cast("CursorResult[Any]", result).rowcount or 0)


async def decay_prune(session: AsyncSession, *, now: datetime, grace_days: int) -> int:
    """Physically delete rows invisible for longer than the grace period.

    Eligible rows: ``valid_until`` older than ``grace_days`` AND at
    least one terminal marker — tombstoned, superseded, or
    decay-invalidated (``source.decayed_at``). Rows with an explicit
    (user-set) ``valid_until`` and no terminal marker are never pruned.

    Inbound ``superseded_by`` references from surviving rows are NULLed
    in the same statement so the self-FK never blocks the delete.

    One CTE-based statement: victims are derived in SQL, never
    materialized into bind lists (a large sweep would otherwise expand
    thousands of ``IN (...)`` binds three times over).
    """
    prune_predicate = """
        valid_until IS NOT NULL
        AND valid_until < CAST(:now AS timestamptz)
                          - make_interval(days => :grace_days)
        AND (is_tombstone = true
             OR superseded_by IS NOT NULL
             OR jsonb_exists(source, 'decayed_at'))
    """
    # The UPDATE and DELETE target disjoint row sets (cleared explicitly
    # excludes victims), and the self-FK's deferred check runs after the
    # whole statement — by which point every surviving inbound reference
    # has been NULLed.
    result = await session.execute(
        text(
            f"""
            WITH victims AS (
                SELECT memory_id FROM coord.memory_records
                WHERE {prune_predicate}
            ),
            cleared AS (
                UPDATE coord.memory_records
                SET superseded_by = NULL, updated_at = :now
                WHERE superseded_by IN (SELECT memory_id FROM victims)
                  AND memory_id NOT IN (SELECT memory_id FROM victims)
            )
            DELETE FROM coord.memory_records
            WHERE memory_id IN (SELECT memory_id FROM victims)
            """
        ),
        {"now": now, "grace_days": grace_days},
    )
    return int(cast("CursorResult[Any]", result).rowcount or 0)


async def list_tenants_with_live_records(
    session: AsyncSession, *, now: datetime
) -> list[UUID]:
    """Tenants holding at least one live (visible) memory record."""
    rows = await session.execute(
        text(
            """
            SELECT DISTINCT tenant_id
            FROM coord.memory_records
            WHERE is_tombstone = false
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
            ORDER BY tenant_id
            """
        ),
        {"now": now},
    )
    return [UUID(str(r.tenant_id)) for r in rows]


async def find_near_duplicate_pairs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    now: datetime,
    min_similarity: float,
    window_days: int,
    pair_limit: int,
) -> list[tuple[DupCandidate, DupCandidate]]:
    """Near-duplicate candidate pairs via a bounded pgvector self-join.

    Same tenant, same kind, both live and embedded, cosine similarity
    above ``min_similarity`` (``<=>`` distance below ``1 - min_similarity``).
    The left side is bounded to rows created inside ``window_days`` and
    the pair batch is capped at ``pair_limit`` per run, tightest pairs
    first. ``a.memory_id < b.memory_id`` de-duplicates the symmetric join.
    """
    rows = await session.execute(
        text(
            """
            SELECT a.memory_id  AS id_a,
                   a.importance AS importance_a,
                   a.access_count AS access_a,
                   a.created_at AS created_a,
                   b.memory_id  AS id_b,
                   b.importance AS importance_b,
                   b.access_count AS access_b,
                   b.created_at AS created_b
            FROM coord.memory_records a
            JOIN coord.memory_records b
              ON b.tenant_id = a.tenant_id
             AND b.kind = a.kind
             AND b.memory_id > a.memory_id
            WHERE a.tenant_id = :tenant_id
              AND a.is_tombstone = false AND b.is_tombstone = false
              AND (a.valid_until IS NULL
                   OR a.valid_until > CAST(:now AS timestamptz))
              AND (b.valid_until IS NULL
                   OR b.valid_until > CAST(:now AS timestamptz))
              AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
              AND a.created_at > CAST(:now AS timestamptz)
                                 - make_interval(days => :window_days)
              AND (a.embedding <=> b.embedding) < :max_distance
            ORDER BY (a.embedding <=> b.embedding)
            LIMIT :pair_limit
            """
        ),
        {
            "tenant_id": tenant_id,
            "now": now,
            "window_days": window_days,
            "max_distance": 1.0 - min_similarity,
            "pair_limit": pair_limit,
        },
    )
    pairs: list[tuple[DupCandidate, DupCandidate]] = []
    for r in rows:
        pairs.append(
            (
                DupCandidate(
                    memory_id=UUID(str(r.id_a)),
                    importance=float(r.importance_a),
                    access_count=int(r.access_a),
                    created_at=r.created_a,
                ),
                DupCandidate(
                    memory_id=UUID(str(r.id_b)),
                    importance=float(r.importance_b),
                    access_count=int(r.access_b),
                    created_at=r.created_b,
                ),
            )
        )
    return pairs


async def apply_merge(
    session: AsyncSession,
    tenant_id: UUID,
    decision: MergeDecision,
    *,
    now: datetime,
) -> None:
    """Apply one near-dup merge: fold into survivor, supersede loser."""
    await session.execute(
        text(
            """
            UPDATE coord.memory_records
            SET importance = :importance,
                access_count = :access_count,
                updated_at = :now
            WHERE tenant_id = :tenant_id AND memory_id = :survivor_id
            """
        ),
        {
            "tenant_id": tenant_id,
            "survivor_id": decision.survivor_id,
            "importance": decision.folded_importance,
            "access_count": decision.folded_access_count,
            "now": now,
        },
    )
    await session.execute(
        text(
            """
            UPDATE coord.memory_records
            SET superseded_by = :survivor_id,
                valid_until = :now,
                updated_at = :now
            WHERE tenant_id = :tenant_id AND memory_id = :loser_id
            """
        ),
        {
            "tenant_id": tenant_id,
            "survivor_id": decision.survivor_id,
            "loser_id": decision.loser_id,
            "now": now,
        },
    )


async def fetch_cluster_candidates(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    now: datetime,
    limit: int,
) -> list[dict[str, Any]]:
    """Live ``episode``/``observation`` rows for synthesis clustering.

    Returns oldest-first dicts with the parsed embedding (each carries
    ``memory_id, title, content, importance, created_at, embedding``).
    """
    rows = await session.execute(
        text(
            """
            SELECT memory_id, title, content, importance, created_at,
                   CAST(embedding AS text) AS embedding_text
            FROM coord.memory_records
            WHERE tenant_id = :tenant_id
              AND kind IN ('episode', 'observation')
              AND is_tombstone = false
              AND superseded_by IS NULL
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
              AND embedding IS NOT NULL
            ORDER BY created_at ASC, memory_id ASC
            LIMIT :limit
            """
        ),
        {"tenant_id": tenant_id, "now": now, "limit": limit},
    )
    out: list[dict[str, Any]] = []
    for r in rows.mappings():
        d = dict(r)
        d["memory_id"] = UUID(str(d["memory_id"]))
        d["embedding"] = parse_pgvector(d.pop("embedding_text"))
        d["importance"] = float(d["importance"])
        out.append(d)
    return out


async def supersede_many(
    session: AsyncSession,
    tenant_id: UUID,
    member_ids: list[UUID],
    new_memory_id: UUID,
    *,
    now: datetime,
) -> None:
    """Point ``member_ids`` at their consolidated replacement (set-based)."""
    if not member_ids:
        return
    stmt = text(
        """
        UPDATE coord.memory_records
        SET superseded_by = :new_memory_id,
            valid_until = :now,
            updated_at = :now
        WHERE tenant_id = :tenant_id AND memory_id IN :member_ids
        """
    ).bindparams(bindparam("member_ids", expanding=True))
    await session.execute(
        stmt,
        {
            "tenant_id": tenant_id,
            "member_ids": member_ids,
            "new_memory_id": new_memory_id,
            "now": now,
        },
    )


def cluster_items_from_rows(rows: list[dict[str, Any]]) -> list[ClusterItem]:
    """Adapt :func:`fetch_cluster_candidates` rows to clustering items."""
    return [
        ClusterItem(
            memory_id=r["memory_id"],
            embedding=r["embedding"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


async def fetch_reindex_batch(
    session: AsyncSession, *, current_tag: str, limit: int
) -> list[tuple[UUID, str]]:
    """One batch of rows needing (re-)embedding.

    Targets rows whose ``embedding_model`` differs from the deployed tag
    (including NULL) or whose ``embedding`` is NULL (the Bug-1b drift
    class), skipping tombstones. Oldest-first for stable progress.
    """
    rows = await session.execute(
        text(
            """
            SELECT memory_id, content
            FROM coord.memory_records
            WHERE is_tombstone = false
              AND (embedding_model IS DISTINCT FROM :current_tag
                   OR embedding IS NULL)
            ORDER BY created_at ASC, memory_id ASC
            LIMIT :limit
            """
        ),
        {"current_tag": current_tag, "limit": limit},
    )
    return [(UUID(str(r.memory_id)), str(r.content)) for r in rows]


async def update_embeddings(
    session: AsyncSession,
    updates: list[tuple[UUID, list[float]]],
    *,
    tag: str,
    now: datetime,
) -> None:
    """Write re-computed embeddings + the current model tag (executemany)."""
    if not updates:
        return
    await session.execute(
        text(
            """
            UPDATE coord.memory_records
            SET embedding = CAST(:embedding AS vector),
                embedding_model = :tag,
                updated_at = :now
            WHERE memory_id = :memory_id
            """
        ),
        [
            {
                "memory_id": memory_id,
                "embedding": format_pgvector(vector),
                "tag": tag,
                "now": now,
            }
            for memory_id, vector in updates
        ],
    )


# ===========================================================================
# Phase 5 — MEMORY.md bridge (coord.memories_latest → memory_records)
# ===========================================================================

# ``source.bridge`` discriminator on bridged reference records.
BRIDGE_SOURCE_NAME = "coord.memories"


async def list_bridge_source_keys(
    session: AsyncSession,
) -> list[tuple[UUID, str, int]]:
    """(tenant_id, name, version) for every latest live coord memory.

    Reads the ``coord.memories_latest`` view (latest non-tombstoned
    version per name). Rows without a tenant binding are skipped — the
    bridge writes into ``coord.memory_records``, whose ``tenant_id`` is
    NOT NULL.
    """
    rows = await session.execute(
        text(
            """
            SELECT tenant_id, name, version
            FROM coord.memories_latest
            WHERE tenant_id IS NOT NULL
            """
        )
    )
    return [(UUID(str(r.tenant_id)), str(r.name), int(r.version)) for r in rows]


async def fetch_bridge_source_contents(
    session: AsyncSession, tenant_id: UUID, names: list[str]
) -> dict[str, tuple[int, str]]:
    """``{name: (version, content)}`` for the named latest coord memories."""
    if not names:
        return {}
    stmt = text(
        """
        SELECT name, version, content
        FROM coord.memories_latest
        WHERE tenant_id = :tenant_id AND name IN :names
        """
    ).bindparams(bindparam("names", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "names": names})
    return {str(r.name): (int(r.version), str(r.content)) for r in rows}


async def list_bridged_records(
    session: AsyncSession, *, now: datetime
) -> dict[tuple[UUID, str], tuple[UUID, int]]:
    """Live bridged records: ``{(tenant_id, name): (memory_id, version)}``.

    A bridged record is a live (non-tombstone, non-superseded, valid)
    ``reference`` row whose ``source.bridge`` names the coord memories
    bridge.
    """
    rows = await session.execute(
        text(
            """
            SELECT tenant_id, memory_id,
                   source->>'memory_name' AS memory_name,
                   CAST(source->>'version' AS bigint) AS version
            FROM coord.memory_records
            WHERE kind = 'reference'
              AND source->>'bridge' = :bridge
              AND is_tombstone = false
              AND superseded_by IS NULL
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
              AND source->>'memory_name' IS NOT NULL
            """
        ),
        {"bridge": BRIDGE_SOURCE_NAME, "now": now},
    )
    return {
        (UUID(str(r.tenant_id)), str(r.memory_name)): (
            UUID(str(r.memory_id)),
            int(r.version),
        )
        for r in rows
    }


async def merge_record_source(
    session: AsyncSession,
    tenant_id: UUID,
    memory_id: UUID,
    patch: dict[str, Any],
    *,
    now: datetime,
) -> None:
    """Shallow-merge ``patch`` into a record's ``source`` JSONB."""
    await session.execute(
        text(
            """
            UPDATE coord.memory_records
            SET source = source || CAST(:patch AS jsonb),
                updated_at = :now
            WHERE tenant_id = :tenant_id AND memory_id = :memory_id
            """
        ),
        {
            "tenant_id": tenant_id,
            "memory_id": memory_id,
            "patch": json.dumps(patch),
            "now": now,
        },
    )
