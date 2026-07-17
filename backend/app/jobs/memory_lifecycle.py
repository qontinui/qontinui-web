"""Scheduled jobs — tenant agentic-memory lifecycle.

Plan ``2026-07-10-tenant-agentic-memory-web-backend``, Phase 4. Three
sweeps over ``coord.memory_records``:

* **Decay** (daily): Ebbinghaus importance-weighted retention scoring —
  rows scoring below threshold become retrieval-invisible
  (``valid_until = now()``), and a second sweep physically prunes rows
  that have been invisible past a 90-day grace period AND carry a
  terminal marker (tombstone / superseded / decay-stamped). The same
  daily pass also runs the session-close expiry sweep (expire
  ``scope='session'`` rows 7 days after their session closed) and the
  job reaper (requeue/fail claims a dead runner abandoned).
* **Consolidation** (weekly, per tenant): near-duplicate merge via a
  bounded pgvector self-join, then ENQUEUE of episode clusters as
  ``kind='synthesis'`` ``coord.memory_jobs`` rows. This backend ships no
  LLM client, so synthesis itself is offloaded to a runner: it claims a
  job, calls its own warm LLM, and posts the result back to
  ``POST /api/v1/memory/jobs/{id}/result``, which inserts the
  ``mental_model`` row with the runner's own vector.
* **Reindex** (daily, cheap no-op when clean): ENQUEUES rows whose
  ``embedding_model`` differs from the deployed tag or whose embedding
  is NULL (heals the Bug-1b drift class) as ``kind='embedding'`` jobs,
  in batches of 100. It does not embed — this backend loads no embedding
  model on any live path (``2026-07-13-runner-paid-embedding``); a runner
  claims the job, embeds locally, and posts the vectors back.

Session shape: the orchestration cores (``decay_once`` /
``consolidate_tenant`` / ``reindex_once``) take an ``AsyncSession`` so DB
tests drive them directly. The scheduler runs them on the app event loop
via the shared pooled engine (see :mod:`app.core.scheduler`).

Cadences live in :mod:`app.core.scheduler` (decay 03:10 UTC daily,
reindex 03:40 UTC daily, consolidate 04:20 UTC Sunday).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.services import memory_store as store
from app.services.memory_embedder import EMBEDDING_MODEL_TAG
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
    orphan cleanup), and the job reaper (requeue/fail claims a dead runner
    abandoned — kind-agnostic, so it covers synthesis and embedding jobs
    alike).
    """
    now = now or datetime.now(UTC)
    invalidated = await store.decay_invalidate(
        session, now=now, threshold=DECAY_SCORE_THRESHOLD
    )
    pruned = await store.decay_prune(
        session, now=now, grace_days=DECAY_PRUNE_GRACE_DAYS
    )
    session_expired = await store.expire_closed_session_records(session, now=now)
    reaped = await store.reap_stale_claims(session, now=now)
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
    is enqueued as a ``kind='synthesis'`` ``coord.memory_jobs`` row for a
    runner to synthesize with its own warm LLM and post back (the runner's
    result is what finally creates the ``mental_model`` row, via
    ``memory_store.record_synthesis_result``). Enqueue is deduped by
    ``input_hash``, so re-running before the runner drains the queue is a
    no-op for already-queued clusters.
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
        store.synthesis_job_input(
            list(members),
            [str(by_id[m]["content"]) for m in members],
        )
        for members in clusters
        if len(members) >= _MIN_SYNTHESIS_CLUSTER
    ]
    enqueued = await store.enqueue_jobs(session, tenant_id, cluster_inputs)

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
    """ENQUEUE stale/NULL-embedding rows for a runner; no-op when clean.

    This sweep no longer embeds. It still finds exactly the same rows —
    ``fetch_reindex_batch``'s tag-mismatch-OR-NULL predicate is unchanged
    — but hands each batch to the job queue as a ``kind='embedding'`` job
    instead of loading a model and vectorizing in-process. A runner claims
    it, embeds with its own model, and posts the vectors back to
    ``POST /api/v1/memory/jobs/{id}/result``, which writes them onto the
    rows. Nothing here loads an embedding model.

    The ``REINDEX_MAX_BATCHES x REINDEX_BATCH_SIZE`` bound is retained,
    now as an ENQUEUE-RATE bound (at most 50 x 100 rows queued per run;
    the daily beat picks up the remainder). It stays meaningful only
    because ``fetch_reindex_batch`` excludes rows with an in-flight
    embedding job: the loop's rows are no longer embedded by the time the
    next batch is fetched, so without that exclusion every iteration would
    re-select the same oldest 100 rows and the loop would spin.
    """
    now = now or datetime.now(UTC)
    enqueued_rows = 0
    enqueued_jobs = 0
    batches = 0
    while batches < REINDEX_MAX_BATCHES:
        batch = await store.fetch_reindex_batch(
            session, current_tag=EMBEDDING_MODEL_TAG, limit=REINDEX_BATCH_SIZE
        )
        if not batch:
            break
        # Per-tenant jobs: a job is claimed by a runner within ONE tenant
        # (the claim is tenant-bound), so a batch spanning tenants cannot
        # be one job. The batch fetch is deliberately tenant-agnostic —
        # it sweeps the whole substrate oldest-first — so it is grouped
        # here rather than by running the sweep once per tenant.
        by_tenant: dict[UUID, list[tuple[UUID, str]]] = {}
        for tenant_id, memory_id, content in batch:
            by_tenant.setdefault(tenant_id, []).append((memory_id, content))
        for tenant_id, targets in by_tenant.items():
            enqueued_jobs += await store.enqueue_jobs(
                session,
                tenant_id,
                [store.embedding_job_input(targets, model_tag=EMBEDDING_MODEL_TAG)],
            )
        enqueued_rows += len(batch)
        batches += 1
        if len(batch) < REINDEX_BATCH_SIZE:
            break

    if enqueued_rows:
        logger.info(
            "memory_reindex_enqueued",
            rows=enqueued_rows,
            jobs=enqueued_jobs,
            batches=batches,
            model_tag=EMBEDDING_MODEL_TAG,
        )
    else:
        logger.debug("memory_reindex_clean", model_tag=EMBEDDING_MODEL_TAG)
    return {
        "enqueued_rows": enqueued_rows,
        "enqueued_jobs": enqueued_jobs,
        "batches": batches,
    }


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
