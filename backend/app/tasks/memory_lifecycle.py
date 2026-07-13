"""Celery beat tasks — tenant agentic-memory lifecycle (Phase 4).

Plan ``2026-07-10-tenant-agentic-memory-web-backend``, Phase 4. Three
sweeps over ``coord.memory_records``:

* **Decay** (daily): Ebbinghaus importance-weighted retention scoring —
  rows scoring below threshold become retrieval-invisible
  (``valid_until = now()``), and a second sweep physically prunes rows
  that have been invisible past a 90-day grace period AND carry a
  terminal marker (tombstone / superseded / decay-stamped). The same
  daily pass also runs the session-close expiry sweep (expire
  ``scope='session'`` rows 7 days after their session closed) and the
  synthesis-job reaper (requeue/fail claims a dead runner abandoned).
* **Consolidation** (weekly, per tenant): near-duplicate merge via a
  bounded pgvector self-join, then ENQUEUE of episode clusters as
  ``coord.memory_synthesis_jobs`` rows. This backend ships no LLM
  client, so synthesis itself is offloaded to a runner: it claims a job,
  calls its own warm LLM, and posts the result back to
  ``POST /api/v1/memory/synthesis-jobs/{id}/result``, which embeds
  (local model) + inserts the ``mental_model`` row.
* **Reindex** (daily, cheap no-op when clean): re-embeds rows whose
  ``embedding_model`` differs from the deployed tag or whose embedding
  is NULL (heals the Bug-1b drift class), in batches of 100.

Task/session shape: Celery workers are sync, so each task runs its
async core through ``app.db.session.run_db_task_in_fresh_loop`` — a
fresh event loop over a per-invocation ``NullPool`` engine, disposed
before the loop closes (the shared pooled ``async_engine`` must never
cross ``asyncio.run`` loops; pooled asyncpg connections poison across
closed loops). Lazy engine-module import keeps module import free of a
DB handshake. The orchestration cores (``decay_once`` /
``consolidate_tenant`` / ``reindex_once``) take an ``AsyncSession`` so
DB tests drive them directly.

Beat schedule entries live in ``app.celery_app`` (redbeat loads the
static ``beat_schedule`` config alongside its dynamic entries).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
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
    greedy_clusters,
    resolve_merges,
)

logger = structlog.get_logger(__name__)

# Only enqueue synthesis for clusters that actually have something to
# distill (a single-member "cluster" has nothing to synthesize).
_MIN_SYNTHESIS_CLUSTER = 2


# ---------------------------------------------------------------------------
# Orchestration cores (AsyncSession-driven, directly testable)
# ---------------------------------------------------------------------------


async def decay_once(
    session: AsyncSession, *, now: datetime | None = None
) -> dict[str, int]:
    """One daily maintenance pass over the memory substrate.

    Bundles the three cheap set-based sweeps that must run at least
    daily: Ebbinghaus decay (invalidate below-threshold rows + prune past
    the grace window), the session-close expiry sweep (expire
    ``scope='session'`` rows 7 days after their session closed, plus
    orphan cleanup), and the synthesis-job reaper (requeue/fail claims a
    dead runner abandoned).
    """
    now = now or datetime.now(UTC)
    invalidated = await store.decay_invalidate(
        session, now=now, threshold=DECAY_SCORE_THRESHOLD
    )
    pruned = await store.decay_prune(
        session, now=now, grace_days=DECAY_PRUNE_GRACE_DAYS
    )
    session_expired = await store.expire_closed_session_records(session, now=now)
    reaped = await store.reap_stale_synthesis_claims(session, now=now)
    logger.info(
        "memory_decay_completed",
        invalidated=invalidated,
        pruned=pruned,
        session_expired=session_expired,
        synthesis_requeued=reaped["requeued"],
        synthesis_failed=reaped["failed"],
    )
    return {
        "invalidated": invalidated,
        "pruned": pruned,
        "session_expired": session_expired,
        "synthesis_requeued": reaped["requeued"],
        "synthesis_failed": reaped["failed"],
    }


async def consolidate_tenant(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    """One tenant's consolidation pass: near-dup merge, then enqueue synthesis.

    Near-dup merge is fully mechanical (set-based pgvector self-join +
    greedy pair resolution) and stays in-process. Synthesis is NOT done
    here — this backend has no LLM client. Instead each episode cluster
    is enqueued as a ``coord.memory_synthesis_jobs`` row for a runner to
    synthesize with its own warm LLM and post back (the runner's result
    is what finally creates the ``mental_model`` row, via
    ``memory_store.record_synthesis_result``). Enqueue is deduped by
    member-set hash, so re-running before the runner drains the queue is
    a no-op for already-queued clusters.
    """
    now = now or datetime.now(UTC)

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

    # -- b. cluster episodes + enqueue synthesis jobs ----------------
    # Candidates are fetched AFTER the merge pass in the same session,
    # so rows superseded by a merge above are already excluded.
    candidates = await store.fetch_cluster_candidates(
        session, tenant_id, now=now, limit=CLUSTER_CANDIDATE_LIMIT
    )
    by_id = {row["memory_id"]: row for row in candidates}
    clusters = greedy_clusters(
        store.cluster_items_from_rows(candidates),
        similarity=CLUSTER_SIMILARITY,
        min_size=CLUSTER_MIN_SIZE,
    )
    cluster_inputs = [
        store.SynthesisClusterInput(
            member_ids=list(members),
            member_texts=[str(by_id[m]["content"]) for m in members],
        )
        for members in clusters
        if len(members) >= _MIN_SYNTHESIS_CLUSTER
    ]
    enqueued = await store.enqueue_synthesis_jobs(session, tenant_id, cluster_inputs)

    logger.info(
        "memory_consolidation_completed",
        tenant_id=str(tenant_id),
        candidate_pairs=len(pairs),
        merges=len(decisions),
        clusters=len(clusters),
        enqueued=enqueued,
    )
    return {
        "candidate_pairs": len(pairs),
        "merges": len(decisions),
        "clusters": len(clusters),
        "enqueued": enqueued,
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
# Celery entrypoints (sync workers). Each invocation runs in its own
# event loop over a DEDICATED NullPool engine via
# ``run_db_task_in_fresh_loop`` — the shared pooled ``async_engine``
# must never cross ``asyncio.run`` loops (pooled asyncpg connections
# poison across closed loops: "Event loop is closed").
# ---------------------------------------------------------------------------


def _run_committed(
    core: Callable[[AsyncSession], Awaitable[dict[str, int]]],
) -> dict[str, int]:
    """Run ``core`` against one fresh committed session on a fresh engine."""
    # Lazy import to avoid a module-load-time DB engine handshake in
    # tests that never trigger the Celery path.
    from app.db.session import run_db_task_in_fresh_loop

    async def _go(
        session_maker: async_sessionmaker[AsyncSession],
    ) -> dict[str, int]:
        async with session_maker() as session:
            result = await core(session)
            await session.commit()
            return result

    return run_db_task_in_fresh_loop(_go)


async def _async_consolidate_all(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, Any]:
    """Consolidate every tenant with live records (commit per tenant)."""
    now = datetime.now(UTC)
    totals: dict[str, int] = {
        "tenants": 0,
        "merges": 0,
        "clusters": 0,
        "enqueued": 0,
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
        totals["enqueued"] += stats["enqueued"]
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
    return _run_committed(decay_once)


@celery_app.task(
    bind=True,
    name="app.tasks.memory_lifecycle.consolidate",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def run_memory_consolidation(self: Any) -> dict[str, Any]:
    """Weekly beat: per-tenant near-dup merge + episode synthesis."""
    from app.db.session import run_db_task_in_fresh_loop

    result: dict[str, Any] = run_db_task_in_fresh_loop(_async_consolidate_all)
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
    return _run_committed(reindex_once)
