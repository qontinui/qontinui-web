"""Redbeat entry lifecycle — Phase 3D.

Thin wrapper around ``redbeat.RedBeatSchedulerEntry``. The DB row is always
the source of truth; these helpers exist so both the CRUD layer (user-driven
mutations) and the startup resync hook (boot-time reconciliation) can install
and tear down entries without caring about redbeat's Redis key layout.

Key convention: every scheduled run gets a redbeat entry named
``qontinui:schedule:{scheduled_run.id}``. Redbeat itself prepends its own
``redbeat_key_prefix`` (``"qontinui:redbeat:"``) internally, so the full
Redis key ends up as ``qontinui:redbeat:qontinui:schedule:{id}`` — slightly
verbose, but unambiguous and grep-friendly.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import structlog
from celery.schedules import crontab  # type: ignore[import-untyped]

from app.celery_app import celery_app
from app.models.scheduled_workflow_run import ScheduledWorkflowRun

logger = structlog.get_logger(__name__)

__all__ = [
    "schedule_entry_id_for",
    "crontab_from_cron",
    "upsert_schedule",
    "disable_schedule",
    "delete_schedule",
    "resync_all_enabled_from_db",
]

SCHEDULED_DISPATCH_TASK_NAME = "app.tasks.scheduled_dispatch.fire"


def schedule_entry_id_for(scheduled_run_id: UUID | str) -> str:
    """Build the redbeat entry name for a given scheduled-run id.

    The name is stable across the lifetime of the DB row; re-issuing an
    upsert with the same name overwrites the existing entry in place.
    """
    return f"qontinui:schedule:{scheduled_run_id}"


def crontab_from_cron(cron_expression: str) -> crontab:
    """Convert a 5-field cron string to a Celery ``crontab`` object.

    Celery's ``crontab`` and standard cron both accept the same field syntax
    (ranges, lists, step values, wildcards), so we can hand each slice
    straight through with no parsing. The caller is expected to have
    validated the expression via the schema layer already.
    """
    fields = cron_expression.strip().split()
    if len(fields) != 5:  # pragma: no cover - schema should have caught this
        raise ValueError(
            f"cron_expression must have 5 fields, got {len(fields)}: "
            f"{cron_expression!r}"
        )
    minute, hour, day_of_month, month_of_year, day_of_week = fields
    return crontab(
        minute=minute,
        hour=hour,
        day_of_month=day_of_month,
        month_of_year=month_of_year,
        day_of_week=day_of_week,
    )


def _load_redbeat_entry_class() -> Any:
    """Import ``RedBeatSchedulerEntry`` lazily.

    ``celery-redbeat`` imports Celery's scheduler machinery on module import,
    which pulls in kombu/tzlocal — fine in production, a surprise in unit
    tests that never touch redbeat. Lazy import keeps those costs off the
    import path for callers that only need :func:`crontab_from_cron`.

    Returns ``Any`` because redbeat has no type stubs — we're not gaining
    anything from a tighter annotation and type-checkers would flag every
    attribute access.
    """
    from redbeat import RedBeatSchedulerEntry  # type: ignore[import-untyped]

    return RedBeatSchedulerEntry


def upsert_schedule(scheduled_run: ScheduledWorkflowRun) -> str:
    """Install or overwrite the redbeat entry for ``scheduled_run``.

    The caller is responsible for persisting the returned entry id back onto
    ``scheduled_run.redbeat_entry_id`` and committing. We deliberately don't
    mutate the ORM row here so the CRUD layer can orchestrate the single
    transaction.

    Returns:
        The redbeat entry key that was written.
    """
    entry_cls = _load_redbeat_entry_class()
    entry_name = schedule_entry_id_for(scheduled_run.id)

    entry = entry_cls(
        name=entry_name,
        task=SCHEDULED_DISPATCH_TASK_NAME,
        schedule=crontab_from_cron(scheduled_run.cron_expression),
        args=[str(scheduled_run.id)],
        app=celery_app,
    )
    entry.save()
    logger.info(
        "redbeat_entry_upserted",
        scheduled_run_id=str(scheduled_run.id),
        entry_name=entry_name,
        cron_expression=scheduled_run.cron_expression,
    )
    return entry_name


def _delete_entry_by_name(entry_name: str) -> None:
    """Delete a redbeat entry by name; swallow "not found" as a no-op."""
    entry_cls = _load_redbeat_entry_class()
    try:
        entry = entry_cls.from_key(
            f"{celery_app.conf.redbeat_key_prefix}{entry_name}",
            app=celery_app,
        )
        entry.delete()
        logger.info("redbeat_entry_deleted", entry_name=entry_name)
    except KeyError:
        # Entry isn't there — common after a Redis flush, treat as success.
        logger.debug("redbeat_entry_already_absent", entry_name=entry_name)


def disable_schedule(scheduled_run: ScheduledWorkflowRun) -> None:
    """Remove the redbeat entry for ``scheduled_run`` but keep the DB row.

    The caller should clear ``scheduled_run.redbeat_entry_id`` after this
    returns.
    """
    if scheduled_run.redbeat_entry_id is None:
        return
    _delete_entry_by_name(scheduled_run.redbeat_entry_id)


def delete_schedule(scheduled_run: ScheduledWorkflowRun) -> None:
    """Remove the redbeat entry as part of a row delete.

    Distinct from :func:`disable_schedule` only in intent — the Redis side
    operation is identical.
    """
    if scheduled_run.redbeat_entry_id is None:
        return
    _delete_entry_by_name(scheduled_run.redbeat_entry_id)


async def resync_all_enabled_from_db() -> int:
    """Install a redbeat entry for every enabled row in the DB.

    Intended to be called once at web-backend startup: redbeat stores its
    state in Redis, which is durable in normal operation but gets blown
    away by ``redis-cli FLUSHALL`` / a fresh Redis boot / migrating to a
    new Redis instance. This hook re-hydrates redbeat from the DB so a
    Redis flush doesn't silently drop schedules.

    Returns:
        The number of entries re-installed.
    """
    # Local import to dodge the circular ``app.services -> app.db ->
    # app.models -> app.db`` cycle at module load.
    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal
    from app.models.scheduled_workflow_run import ScheduledWorkflowRun

    count = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ScheduledWorkflowRun).where(ScheduledWorkflowRun.enabled.is_(True))
        )
        rows = list(result.scalars().all())
        for row in rows:
            try:
                entry_name = upsert_schedule(row)
                if row.redbeat_entry_id != entry_name:
                    row.redbeat_entry_id = entry_name
            except Exception:
                logger.warning(
                    "redbeat_resync_failed_for_row",
                    scheduled_run_id=str(row.id),
                    exc_info=True,
                )
                continue
            count += 1
        await db.commit()

    logger.info("redbeat_resync_complete", enabled_rows_reinstalled=count)
    return count
