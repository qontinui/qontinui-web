"""Data access for ``coord.memory_records`` — the tenant agentic memory.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

ALL SQL touching the memory substrate (``coord.memory_records`` +
``coord.tenant_policies`` quota knobs) lives in this one module, which
is vetted into ``WRITE_PATH_FOLLOWUP`` in
``tests/test_coord_schema_boundary_guard.py``: web owns this substrate
(its schema ships in web's own alembic migration
``coord_memory_records``), so the memory API reads/writes it directly
over web's shared-Postgres session — the same posture as the
``Device`` / ``TestTarget`` write paths. Keeping every ``coord.*``
literal here keeps the boundary-guard allowlist to a single entry.

Schema reference: ``backend/alembic/versions/coord_memory_records.py``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.memory_embedder import EMBEDDING_MODEL_TAG

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
                      WHERE r.tenant_id = :tenant_id) AS row_count,
                    (SELECT COALESCE(sum(octet_length(r.content)), 0)
                       FROM coord.memory_records r
                      WHERE r.tenant_id = :tenant_id) AS bytes,
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
) -> tuple[UUID, bool]:
    """Insert one record, deduping on ``(tenant_id, content_hash)``.

    Returns ``(memory_id, deduped)`` — on conflict the EXISTING row's id
    is returned with ``deduped=True``.
    """
    inserted = (
        await session.execute(
            text(
                """
                INSERT INTO coord.memory_records
                    (tenant_id, scope, scope_ref, kind, title, content,
                     content_hash, embedding, embedding_model, importance,
                     source)
                VALUES
                    (:tenant_id, :scope, :scope_ref, :kind, :title, :content,
                     :content_hash, CAST(:embedding AS vector),
                     :embedding_model, :importance, CAST(:source AS jsonb))
                ON CONFLICT (tenant_id, content_hash) DO NOTHING
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
            },
        )
    ).scalar_one_or_none()
    if inserted is not None:
        return UUID(str(inserted)), False

    existing = (
        await session.execute(
            text(
                """
                SELECT memory_id FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND content_hash = :content_hash
                """
            ),
            {"tenant_id": tenant_id, "content_hash": content_hash},
        )
    ).scalar_one()
    return UUID(str(existing)), True


async def existing_hashes(
    session: AsyncSession, tenant_id: UUID, hashes: list[str]
) -> set[str]:
    """Which of ``hashes`` already exist for this tenant (pre-embed
    dedup check, so known-duplicate contents are never re-embedded)."""
    if not hashes:
        return set()
    stmt = text(
        """
        SELECT content_hash FROM coord.memory_records
        WHERE tenant_id = :tenant_id AND content_hash IN :hashes
        """
    ).bindparams(bindparam("hashes", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "hashes": hashes})
    return {str(r.content_hash) for r in rows}


async def find_by_hash(
    session: AsyncSession, tenant_id: UUID, content_hash: str
) -> UUID | None:
    """The tenant's record id carrying ``content_hash``, if any."""
    found = (
        await session.execute(
            text(
                """
                SELECT memory_id FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND content_hash = :content_hash
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
