"""Celery beat task — MEMORY.md bridge indexer (Phase 5).

Plan ``2026-07-10-tenant-agentic-memory-web-backend``, Phase 5. Mirrors
``coord.memories_latest`` (coord's MEMORY.md federation view: latest
non-tombstoned version per name) into ``coord.memory_records`` rows so
federated memories participate in the tenant's hybrid retrieval:

* ``kind='reference'``, ``scope='tenant'``, ``title = memory name``,
* ``source = {"bridge": "coord.memories", "memory_name": ..., "version": ...}``,
* title + content pass through :func:`redact_text` BEFORE
  hashing/embedding/insert (same server-side pass as the API write
  path — bridged content must never land secrets in the store),
* ``content_hash`` over the REDACTED memory content (re-runs dedup
  naturally, and dedup keys match API-written rows),
* embedded via the standard embedder.

Sync semantics per run:

* **Upsert** — a ``memories_latest`` (tenant, name, version) with no
  matching live bridged record gets a new record; any prior live
  bridged record for the same name (older version) is superseded.
  Version bumps with UNCHANGED content dedup onto the existing row and
  just refresh its ``source`` version stamp (no supersede churn).
* **Tombstone** — a live bridged record whose name has vanished from
  ``memories_latest`` (memory tombstoned/deleted in coord) is
  tombstoned.
* **Cheap when clean** — the (tenant, name, version) key sets are
  compared BEFORE any content fetch or embedding; an in-sync run does
  two key-only SELECTs and stops.

Trigger: the 15-minute beat below IS the v1 trigger. Coord announces
upserts on NATS (``events.coord.memory.upserted.*``), but this backend
has no NATS consumer infrastructure (no nats dependency or subscriber
anywhere under ``app/``), and per the plan we do not introduce a new
NATS client for this — the beat's compare-first pass is cheap enough
at 15-minute cadence.

``coord.memories`` rows without a ``tenant_id`` binding are skipped:
``coord.memory_records.tenant_id`` is NOT NULL, so unbound memories
have no tenant store to land in.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.celery_app import celery_app
from app.services import memory_store as store
from app.services.memory_embedder import ensure_embedding_dims, get_embedder
from app.services.memory_redaction import log_redactions, redact_text

logger = structlog.get_logger(__name__)

# Importance assigned to bridged reference rows (the write-API default).
BRIDGE_IMPORTANCE = 0.5


def _content_hash(content: str) -> str:
    """sha256 hex over the stored content (same rule as the write API)."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _bridge_source(name: str, version: int) -> dict[str, Any]:
    return {
        "bridge": store.BRIDGE_SOURCE_NAME,
        "memory_name": name,
        "version": version,
    }


async def bridge_sync_once(
    session: AsyncSession, *, now: datetime | None = None
) -> dict[str, int]:
    """One bridge pass: diff key sets, then upsert/supersede/tombstone."""
    now = now or datetime.now(UTC)

    source_keys = await store.list_bridge_source_keys(session)
    bridged = await store.list_bridged_records(session, now=now)

    # Diff on (tenant, name, version) BEFORE fetching content/embedding.
    source_by_key: dict[tuple[UUID, str], int] = {
        (tenant_id, name): version for tenant_id, name, version in source_keys
    }
    to_upsert: dict[UUID, list[str]] = {}
    for (tenant_id, name), version in source_by_key.items():
        existing = bridged.get((tenant_id, name))
        if existing is None or existing[1] != version:
            to_upsert.setdefault(tenant_id, []).append(name)
    to_tombstone = [
        (tenant_id, memory_id)
        for (tenant_id, name), (memory_id, _version) in bridged.items()
        if (tenant_id, name) not in source_by_key
    ]

    if not to_upsert and not to_tombstone:
        logger.debug("memory_bridge_in_sync", source_count=len(source_keys))
        return {"upserted": 0, "superseded": 0, "tombstoned": 0}

    upserted = 0
    superseded = 0
    for tenant_id, names in to_upsert.items():
        contents = await store.fetch_bridge_source_contents(session, tenant_id, names)
        ordered = [name for name in names if name in contents]
        if not ordered:
            continue
        # Redact BEFORE hashing/embedding/insert — same pass as the API
        # write path, so bridged coord.memories content never lands
        # secrets in coord.memory_records, and the content_hash is over
        # the REDACTED text (dedup keys match API-written rows).
        redaction_counts: dict[str, int] = {}
        redacted: dict[str, tuple[int, str, str]] = {}
        for name in ordered:
            version, content = contents[name]
            rt = redact_text(name)
            rc = redact_text(content)
            for counts in (rt.counts, rc.counts):
                for cls, n in counts.items():
                    redaction_counts[cls] = redaction_counts.get(cls, 0) + n
            redacted[name] = (version, rt.text, rc.text)
        log_redactions("memory_bridge", redaction_counts)

        embeddings = get_embedder().embed_texts([redacted[name][2] for name in ordered])
        ensure_embedding_dims(embeddings)
        for name, embedding in zip(ordered, embeddings, strict=True):
            version, title, content = redacted[name]
            bridge_source = _bridge_source(name, version)
            memory_id, deduped = await store.insert_record(
                session,
                tenant_id=tenant_id,
                scope="tenant",
                scope_ref=None,
                kind="reference",
                title=title,
                content=content,
                content_hash=_content_hash(content),
                embedding=embedding,
                importance=BRIDGE_IMPORTANCE,
                source=bridge_source,
            )
            if deduped:
                # Same content already stored (typically the prior
                # bridged record after a content-neutral version bump):
                # refresh its bridge stamp so the key sets converge.
                await store.merge_record_source(
                    session, tenant_id, memory_id, bridge_source, now=now
                )
            prior = bridged.get((tenant_id, name))
            if prior is not None and prior[0] != memory_id:
                await store.mark_superseded(
                    session,
                    tenant_id=tenant_id,
                    old_memory_id=prior[0],
                    new_memory_id=memory_id,
                )
                superseded += 1
            upserted += 1

    tombstoned = 0
    for tenant_id, memory_id in to_tombstone:
        if await store.tombstone_record(session, tenant_id, memory_id):
            tombstoned += 1

    logger.info(
        "memory_bridge_synced",
        upserted=upserted,
        superseded=superseded,
        tombstoned=tombstoned,
    )
    return {
        "upserted": upserted,
        "superseded": superseded,
        "tombstoned": tombstoned,
    }


async def _async_bridge_sync(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, int]:
    """Async core for the beat task (throwaway committed session)."""
    async with session_maker() as session:
        result = await bridge_sync_once(session)
        await session.commit()
        return result


@celery_app.task(
    bind=True,
    name="app.tasks.memory_bridge.sync",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def run_memory_bridge_sync(self: Any) -> dict[str, int]:
    """15-minute beat: mirror coord.memories_latest into memory_records.

    Runs on a per-invocation NullPool engine in a fresh event loop —
    never the shared pooled ``async_engine``, whose asyncpg connections
    poison across closed ``asyncio.run`` loops.
    """
    # Lazy import to avoid a module-load-time DB engine handshake in
    # tests that never trigger the Celery path.
    from app.db.session import run_db_task_in_fresh_loop

    return run_db_task_in_fresh_loop(_async_bridge_sync)
