"""Celery beat tasks — tenant agentic-memory lifecycle (Phase 4).

Plan ``2026-07-10-tenant-agentic-memory-web-backend``, Phase 4. Three
sweeps over ``coord.memory_records``:

* **Decay** (daily): Ebbinghaus importance-weighted retention scoring —
  rows scoring below threshold become retrieval-invisible
  (``valid_until = now()``), and a second sweep physically prunes rows
  that have been invisible past a 90-day grace period AND carry a
  terminal marker (tombstone / superseded / decay-stamped).
* **Consolidation** (weekly, per tenant): near-duplicate merge via a
  bounded pgvector self-join, then LLM synthesis of episode clusters
  into ``mental_model`` rows through the injectable
  :class:`~app.services.memory_lifecycle.MemorySynthesizer` seam (the
  default degrades to a logged skip — this backend ships no LLM
  client).
* **Reindex** (daily, cheap no-op when clean): re-embeds rows whose
  ``embedding_model`` differs from the deployed tag or whose embedding
  is NULL (heals the Bug-1b drift class), in batches of 100.

Task/session shape follows ``app.tasks.scheduled_dispatch``: Celery
workers are sync, so each task wraps an async core with
``asyncio.run`` over a throwaway ``async_sessionmaker`` (lazy engine
import keeps module import free of a DB handshake). The orchestration
cores (``decay_once`` / ``consolidate_tenant`` / ``reindex_once``)
take an ``AsyncSession`` so DB tests drive them directly.

Beat schedule entries live in ``app.celery_app`` (redbeat loads the
static ``beat_schedule`` config alongside its dynamic entries).
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.celery_app import celery_app
from app.services import memory_store as store
from app.services.memory_embedder import (
    EMBEDDING_MODEL_TAG,
    ensure_embedding_dims,
    get_embedder,
)
from app.services.memory_lifecycle import (
    CLUSTER_CANDIDATE_LIMIT,
    CLUSTER_MIN_SIZE,
    CLUSTER_SIMILARITY,
    DECAY_PRUNE_GRACE_DAYS,
    DECAY_SCORE_THRESHOLD,
    NEAR_DUP_PAIR_LIMIT,
    NEAR_DUP_SIMILARITY,
    NEAR_DUP_WINDOW_DAYS,
    REINDEX_BATCH_SIZE,
    REINDEX_MAX_BATCHES,
    SYNTHESIS_IMPORTANCE_BONUS,
    MemorySynthesizer,
    get_synthesizer,
    greedy_clusters,
    resolve_merges,
    synthesized_title,
)

logger = structlog.get_logger(__name__)


def _content_hash(content: str) -> str:
    """sha256 hex over the stored content (same rule as the write API)."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Orchestration cores (AsyncSession-driven, directly testable)
# ---------------------------------------------------------------------------


async def decay_once(
    session: AsyncSession, *, now: datetime | None = None
) -> dict[str, int]:
    """One decay pass: invalidate below-threshold rows, prune past grace."""
    now = now or datetime.now(UTC)
    invalidated = await store.decay_invalidate(
        session, now=now, threshold=DECAY_SCORE_THRESHOLD
    )
    pruned = await store.decay_prune(
        session, now=now, grace_days=DECAY_PRUNE_GRACE_DAYS
    )
    logger.info("memory_decay_completed", invalidated=invalidated, pruned=pruned)
    return {"invalidated": invalidated, "pruned": pruned}


async def consolidate_tenant(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    synthesizer: MemorySynthesizer | None = None,
    now: datetime | None = None,
) -> dict[str, int]:
    """One tenant's consolidation pass: near-dup merge, then synthesis.

    Near-dup merge is fully mechanical (set-based pgvector self-join +
    greedy pair resolution). Synthesis runs only when the injected
    :class:`MemorySynthesizer` returns text — the default returns None
    (no LLM client in this backend), leaving merge fully functional.
    """
    now = now or datetime.now(UTC)
    synthesizer = synthesizer or get_synthesizer()

    # -- a. near-duplicate merge -------------------------------------
    pairs = await store.find_near_duplicate_pairs(
        session,
        tenant_id,
        now=now,
        min_similarity=NEAR_DUP_SIMILARITY,
        window_days=NEAR_DUP_WINDOW_DAYS,
        pair_limit=NEAR_DUP_PAIR_LIMIT,
    )
    decisions = resolve_merges(pairs)
    for decision in decisions:
        await store.apply_merge(session, tenant_id, decision, now=now)

    # -- b. LLM synthesis of episode clusters ------------------------
    # Candidates are fetched AFTER the merge pass in the same session,
    # so rows superseded by a merge above are already excluded.
    synthesized = 0
    candidates = await store.fetch_cluster_candidates(
        session, tenant_id, now=now, limit=CLUSTER_CANDIDATE_LIMIT
    )
    by_id = {row["memory_id"]: row for row in candidates}
    clusters = greedy_clusters(
        store.cluster_items_from_rows(candidates),
        similarity=CLUSTER_SIMILARITY,
        min_size=CLUSTER_MIN_SIZE,
    )
    for live_members in clusters:
        cluster_texts = [str(by_id[m]["content"]) for m in live_members]
        synthesis = synthesizer.synthesize(cluster_texts)
        if synthesis is None:
            logger.info(
                "memory_synthesis_skipped",
                tenant_id=str(tenant_id),
                cluster_size=len(live_members),
            )
            continue

        embedding = get_embedder().embed_texts([synthesis])
        ensure_embedding_dims(embedding)
        importance = min(
            1.0,
            max(float(by_id[m]["importance"]) for m in live_members)
            + SYNTHESIS_IMPORTANCE_BONUS,
        )
        new_id, _deduped = await store.insert_record(
            session,
            tenant_id=tenant_id,
            scope="tenant",
            scope_ref=None,
            kind="mental_model",
            title=synthesized_title(synthesis),
            content=synthesis,
            content_hash=_content_hash(synthesis),
            embedding=embedding[0],
            importance=importance,
            source={"consolidation_run": now.isoformat()},
            consolidated_from=live_members,
        )
        await store.supersede_many(
            session,
            tenant_id,
            [m for m in live_members if m != new_id],
            new_id,
            now=now,
        )
        synthesized += 1

    logger.info(
        "memory_consolidation_completed",
        tenant_id=str(tenant_id),
        candidate_pairs=len(pairs),
        merges=len(decisions),
        clusters=len(clusters),
        synthesized=synthesized,
    )
    return {
        "candidate_pairs": len(pairs),
        "merges": len(decisions),
        "clusters": len(clusters),
        "synthesized": synthesized,
    }


async def reindex_once(
    session: AsyncSession, *, now: datetime | None = None
) -> dict[str, int]:
    """Re-embed stale/NULL-embedding rows in batches; no-op when clean."""
    now = now or datetime.now(UTC)
    reindexed = 0
    batches = 0
    while batches < REINDEX_MAX_BATCHES:
        batch = await store.fetch_reindex_batch(
            session, current_tag=EMBEDDING_MODEL_TAG, limit=REINDEX_BATCH_SIZE
        )
        if not batch:
            break
        embeddings = get_embedder().embed_texts([content for _, content in batch])
        ensure_embedding_dims(embeddings)
        await store.update_embeddings(
            session,
            [
                (memory_id, vector)
                for (memory_id, _), vector in zip(batch, embeddings, strict=True)
            ],
            tag=EMBEDDING_MODEL_TAG,
            now=now,
        )
        reindexed += len(batch)
        batches += 1
        if len(batch) < REINDEX_BATCH_SIZE:
            break

    if reindexed:
        logger.info(
            "memory_reindex_completed",
            reindexed=reindexed,
            batches=batches,
            model_tag=EMBEDDING_MODEL_TAG,
        )
    else:
        logger.debug("memory_reindex_clean", model_tag=EMBEDDING_MODEL_TAG)
    return {"reindexed": reindexed, "batches": batches}


# ---------------------------------------------------------------------------
# Celery entrypoints (sync workers; asyncio.run over a throwaway session,
# same shape as app.tasks.scheduled_dispatch)
# ---------------------------------------------------------------------------


async def _with_session(core: Any) -> Any:
    """Run an async core against a fresh committed session."""
    # Lazy import to avoid a module-load-time DB engine handshake in
    # tests that never trigger the Celery path.
    from app.db.session import async_engine

    session_maker = async_sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_maker() as session:
        result = await core(session)
        await session.commit()
        return result


async def _async_consolidate_all() -> dict[str, Any]:
    """Consolidate every tenant with live records (commit per tenant)."""
    from app.db.session import async_engine

    session_maker = async_sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )
    now = datetime.now(UTC)
    totals: dict[str, int] = {
        "tenants": 0,
        "merges": 0,
        "clusters": 0,
        "synthesized": 0,
    }
    async with session_maker() as session:
        tenants = await store.list_tenants_with_live_records(session, now=now)
    for tenant_id in tenants:
        async with session_maker() as session:
            stats = await consolidate_tenant(session, tenant_id, now=now)
            await session.commit()
        totals["tenants"] += 1
        totals["merges"] += stats["merges"]
        totals["clusters"] += stats["clusters"]
        totals["synthesized"] += stats["synthesized"]
    logger.info("memory_consolidation_run_completed", **totals)
    return dict(totals)


@celery_app.task(
    bind=True,
    name="app.tasks.memory_lifecycle.decay",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def run_memory_decay(self: Any) -> dict[str, int]:
    """Daily beat: decay invalidation + grace-period prune."""
    result: dict[str, int] = asyncio.run(_with_session(decay_once))
    return result


@celery_app.task(
    bind=True,
    name="app.tasks.memory_lifecycle.consolidate",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def run_memory_consolidation(self: Any) -> dict[str, Any]:
    """Weekly beat: per-tenant near-dup merge + episode synthesis."""
    result: dict[str, Any] = asyncio.run(_async_consolidate_all())
    return result


@celery_app.task(
    bind=True,
    name="app.tasks.memory_lifecycle.reindex",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def run_memory_reindex(self: Any) -> dict[str, int]:
    """Daily beat: re-embed stale/NULL rows (cheap no-op when clean)."""
    result: dict[str, int] = asyncio.run(_with_session(reindex_once))
    return result
