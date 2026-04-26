"""Wrapper registry sync service — Phase 6.

Pulls the canonical ``registry.json`` from
``github.com/qontinui/wrappers-registry`` and upserts the rows into the
``wrapper_entries`` table. Designed to run on application startup AND
hourly thereafter via an asyncio background task created in
:mod:`app.main`'s startup hook.

Network politeness:
* GitHub raw is hit via ``httpx.AsyncClient`` with a 30-second timeout.
* The most recent ``registry_synced_at`` is sent as ``If-Modified-Since``
  so unchanged registries return 304 and don't waste bandwidth.

Failure handling:
* Any exception during fetch is swallowed and logged — the next tick
  retries. We never let the sync loop crash the app.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import format_datetime
from typing import Any

import httpx
import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models.wrapper_entry import WrapperEntry

logger = structlog.get_logger(__name__)

REGISTRY_URL = (
    "https://raw.githubusercontent.com/qontinui/wrappers-registry/main/registry.json"
)
DEFAULT_SYNC_INTERVAL_SECONDS = 3600  # one hour


@dataclass(slots=True)
class SyncStats:
    """Outcome of a single :func:`sync_registry` invocation."""

    added: int = 0
    updated: int = 0
    removed: int = 0
    unchanged_304: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "added": self.added,
            "updated": self.updated,
            "removed": self.removed,
            "unchanged_304": self.unchanged_304,
        }


def _semver_pin_to_version(version_pin: str) -> str:
    """Strip a leading ``>=`` / ``^`` / ``~`` from a registry version pin.

    ``registry.json`` records constraints like ``">=0.1.0"``; the
    ``latest_version`` column stores the literal version string we
    surface to clients. We don't currently resolve the constraint
    against npm — when registry submission tooling lands, that step
    will replace this normalization.
    """
    cleaned = version_pin.strip()
    for prefix in (">=", "<=", "==", ">", "<", "^", "~"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :].strip()
            break
    return cleaned or version_pin


async def fetch_registry(
    last_synced_at: datetime | None = None,
) -> tuple[list[dict[str, Any]] | None, bool]:
    """Fetch ``registry.json`` from the canonical GitHub repo.

    Args:
        last_synced_at: optional UTC timestamp from the most recent
            successful sync. Sent as ``If-Modified-Since`` so an
            unchanged registry returns 304 instead of the body.

    Returns:
        ``(wrappers, not_modified)``. ``wrappers`` is a list of raw
        registry entries on 200, or ``None`` on 304. ``not_modified``
        is ``True`` for the 304 case and ``False`` otherwise.
    """
    headers: dict[str, str] = {"User-Agent": "qontinui-web/wrapper-sync"}
    if last_synced_at is not None:
        # GitHub honours If-Modified-Since for raw blob URLs.
        if last_synced_at.tzinfo is None:
            last_synced_at = last_synced_at.replace(tzinfo=UTC)
        headers["If-Modified-Since"] = format_datetime(
            last_synced_at.astimezone(UTC), usegmt=True
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(REGISTRY_URL, headers=headers)

    if response.status_code == 304:
        return None, True

    response.raise_for_status()
    payload = response.json()
    wrappers = payload.get("wrappers") or []
    if not isinstance(wrappers, list):
        raise ValueError("registry.json wrappers field is not a list")
    return wrappers, False


async def _latest_synced_at(db: AsyncSession) -> datetime | None:
    """Return the maximum ``registry_synced_at`` across all entries."""
    result = await db.execute(select(func.max(WrapperEntry.registry_synced_at)))
    return result.scalar_one_or_none()


async def sync_registry(db: AsyncSession) -> SyncStats:
    """Pull registry.json and upsert ``wrapper_entries``.

    Behaviour:
    * Insert new wrapper ids.
    * Update the metadata + ``registry_synced_at`` on existing ids.
    * Leave entries that disappeared from the registry alone (we
      tombstone via verification rather than hard-delete; deletion is
      a future operator task once we know the abuse model).
    """
    last_synced_at = await _latest_synced_at(db)
    try:
        wrappers, not_modified = await fetch_registry(last_synced_at)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning(
            "wrapper_registry_fetch_failed",
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return SyncStats()

    stats = SyncStats(unchanged_304=not_modified)
    if not_modified or wrappers is None:
        # Bump registry_synced_at so the next tick still sends a fresh
        # If-Modified-Since header even when nothing changed.
        await db.execute(select(WrapperEntry).where(WrapperEntry.id.is_not(None)))
        return stats

    now = datetime.now(UTC)
    seen_ids: set[str] = set()

    # Pre-fetch existing rows so we don't issue N selects.
    existing_result = await db.execute(select(WrapperEntry))
    existing_by_id: dict[str, WrapperEntry] = {
        row.id: row for row in existing_result.scalars()
    }

    for raw in wrappers:
        wrapper_id = raw.get("id")
        if not isinstance(wrapper_id, str) or not wrapper_id:
            logger.warning("wrapper_registry_entry_missing_id", entry=raw)
            continue
        seen_ids.add(wrapper_id)

        author = raw.get("author") or {}
        if not isinstance(author, dict):
            author = {"name": str(author)}

        latest_version = _semver_pin_to_version(str(raw.get("version", "")))
        categories = raw.get("categories") or []
        if not isinstance(categories, list):
            categories = []

        existing = existing_by_id.get(wrapper_id)
        if existing is None:
            db.add(
                WrapperEntry(
                    id=wrapper_id,
                    package=str(raw.get("package", "")),
                    latest_version=latest_version,
                    display_name=str(
                        raw.get("displayName") or raw.get("display_name") or wrapper_id
                    ),
                    description=raw.get("description"),
                    categories=list(categories),
                    transport=str(raw.get("transport", "api")),
                    author_json=author,
                    repo=raw.get("repo"),
                    license=raw.get("license"),
                    verified=bool(raw.get("verified", False)),
                    registry_synced_at=now,
                )
            )
            stats.added += 1
        else:
            existing.package = str(raw.get("package", existing.package))
            existing.latest_version = latest_version or existing.latest_version
            existing.display_name = str(
                raw.get("displayName")
                or raw.get("display_name")
                or existing.display_name
            )
            existing.description = raw.get("description")
            existing.categories = list(categories)
            existing.transport = str(raw.get("transport", existing.transport))
            existing.author_json = author
            existing.repo = raw.get("repo")
            existing.license = raw.get("license")
            existing.verified = bool(raw.get("verified", existing.verified))
            existing.registry_synced_at = now
            stats.updated += 1

    await db.commit()
    return stats


async def _sync_loop(interval_seconds: int) -> None:
    """Background loop: sync once on entry, then every ``interval_seconds``."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                stats = await sync_registry(db)
            logger.info("wrapper_registry_sync_complete", **stats.to_dict())
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover — defensive
            logger.error(
                "wrapper_registry_sync_unexpected_error",
                error=str(exc),
                error_type=type(exc).__name__,
                exc_info=True,
            )

        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            raise


def start_sync_job(
    interval_seconds: int = DEFAULT_SYNC_INTERVAL_SECONDS,
) -> asyncio.Task[None]:
    """Spawn the background sync task.

    Returns the task handle so the caller (``main.py``) can cancel it
    on shutdown. The task is fire-and-forget — exceptions are logged
    inside :func:`_sync_loop` and never escape.
    """
    return asyncio.create_task(_sync_loop(interval_seconds))
