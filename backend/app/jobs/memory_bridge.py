"""Scheduled job — MEMORY.md bridge indexer.

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
* landed with ``embedding = NULL`` and ENQUEUED as a ``kind='embedding'``
  ``coord.memory_jobs`` row. This job loads no embedding model: a
  NULL-embedding row is immediately FTS-retrievable, and a runner claims
  the job, embeds locally, and posts the vectors back
  (``2026-07-13-runner-paid-embedding``). The queue's live-status
  ``input_hash`` dedupe is what keeps the 15-minute cadence from
  re-enqueueing the same rows.

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

Trigger: the scheduler's 15-minute ``memory_bridge_sync`` cadence IS the
v1 trigger. Coord announces upserts on NATS
(``events.coord.memory.upserted.*``), but this backend has no NATS
consumer infrastructure (no nats dependency or subscriber anywhere under
``app/``), and per the plan we do not introduce a new NATS client for
this — the compare-first pass is cheap enough at 15-minute cadence.

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

from app.services import memory_store as store
from app.services.memory_redaction import log_redactions, redact_text
from app.services.memory_vectors import EMBEDDING_MODEL_TAG

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
        return {"upserted": 0, "superseded": 0, "tombstoned": 0, "enqueued": 0}

    upserted = 0
    superseded = 0
    enqueued = 0
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

        # Bridged rows land UNVECTORIZED. This job loads no embedding
        # model — nothing in this backend does any more
        # (``2026-07-13-runner-paid-embedding``). A NULL-embedding row is
        # immediately FTS-retrievable and is vectorized by the runner via
        # the embedding job enqueued below.
        to_embed: list[tuple[UUID, str]] = []
        for name in ordered:
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
                embedding=None,
                embedding_model=None,
                importance=BRIDGE_IMPORTANCE,
                source=bridge_source,
            )
            if deduped:
                # Same content already stored (typically the prior
                # bridged record after a content-neutral version bump):
                # refresh its bridge stamp so the key sets converge. NOT
                # queued for embedding — this row predates the bridge pass
                # and owns whatever vector state it already has; if it is
                # genuinely unvectorized the reindex sweep will queue it.
                await store.merge_record_source(
                    session, tenant_id, memory_id, bridge_source, now=now
                )
            else:
                # A fresh insert, which always lands with embedding=NULL.
                to_embed.append((memory_id, content))
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

        # One embedding job per tenant per pass, for the rows just landed.
        # The queue's live-status `input_hash` dedupe is what keeps this
        # 15-minute cadence from piling up work: an identical target set
        # with a live (pending/claimed/done) job is a no-op insert. The
        # compare-first pass above already makes an in-sync run return
        # before reaching here, so this is belt AND braces — the braces
        # matter because a run that upserts ANY name re-walks that
        # tenant's whole `ordered` list.
        if to_embed:
            enqueued += await store.enqueue_jobs(
                session,
                tenant_id,
                [store.embedding_job_input(to_embed, model_tag=EMBEDDING_MODEL_TAG)],
            )

    tombstoned = 0
    for tenant_id, memory_id in to_tombstone:
        if await store.tombstone_record(session, tenant_id, memory_id):
            tombstoned += 1

    logger.info(
        "memory_bridge_synced",
        upserted=upserted,
        superseded=superseded,
        tombstoned=tombstoned,
        enqueued=enqueued,
    )
    return {
        "upserted": upserted,
        "superseded": superseded,
        "tombstoned": tombstoned,
        "enqueued": enqueued,
    }


async def _async_bridge_sync(
    session_maker: async_sessionmaker[AsyncSession],
) -> dict[str, int]:
    """Open a fresh committed session and run one bridge pass."""
    async with session_maker() as session:
        result = await bridge_sync_once(session)
        await session.commit()
        return result
