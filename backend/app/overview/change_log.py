"""``overview.change_log`` — the one audit trail every overview write appends.

Plan ``2026-09-20-overview-authoring-layer`` §1 ("Audit"). A write and its
change-log row share a transaction wherever both live in this database, so a
write that commits always has its row. For a resource stored elsewhere (coord's
prompt documents) the row is written after the store accepted the write: the
store's own version log is authoritative for the content, and this row is what
names the overview as the place the edit came from.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import CHANGE_SOURCES, ChangeLog

#: The request header a client names its surface with. The overview pages send
#: ``ui``; the CSV paste and the gantt import send ``import``. Absent — which
#: is what an agent or script sends — reads as ``api``.
SOURCE_HEADER = "X-Overview-Source"

ChangeAction = Literal["create", "update", "delete"]


def change_source(request: Request) -> str:
    """Where this write came from, per :data:`SOURCE_HEADER`.

    An unrecognised value is recorded as ``api`` rather than refused: the
    header is a label the client volunteers, never an authorization input,
    and failing a legitimate write over a label would be the wrong trade.
    """
    value = (request.headers.get(SOURCE_HEADER) or "").strip().lower()
    return value if value in CHANGE_SOURCES else "api"


def snapshot(value: BaseModel | dict[str, Any] | None) -> dict[str, Any] | None:
    """A JSON-safe copy of a resource's read shape, for ``before``/``after``."""
    if value is None:
        return None
    if isinstance(value, BaseModel):
        dumped: dict[str, Any] = value.model_dump(mode="json")
        return dumped
    return value


async def record(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    resource: str,
    record_id: str,
    action: ChangeAction,
    source: str,
    actor: str | None,
    actor_user_id: UUID | None,
    before: BaseModel | dict[str, Any] | None,
    after: BaseModel | dict[str, Any] | None,
    version_before: int | None = None,
    version_after: int | None = None,
    idempotency_key: str | None = None,
) -> ChangeLog:
    """Append one row. Flushes but does not commit — the caller's transaction
    decides, so the row lands exactly when the write it describes does."""
    row = ChangeLog(
        tenant_id=tenant_id,
        resource=resource,
        record_id=record_id,
        action=action,
        source=source,
        actor=actor,
        actor_user_id=actor_user_id,
        before=snapshot(before),
        after=snapshot(after),
        version_before=version_before,
        version_after=version_after,
        idempotency_key=idempotency_key,
    )
    db.add(row)
    await db.flush()
    return row


async def find_by_idempotency_key(
    db: AsyncSession, *, tenant_id: UUID, resource: str, key: str
) -> ChangeLog | None:
    stmt = select(ChangeLog).where(
        ChangeLog.tenant_id == tenant_id,
        ChangeLog.resource == resource,
        ChangeLog.idempotency_key == key,
    )
    return (await db.execute(stmt)).scalars().first()


async def has_create(
    db: AsyncSession, *, tenant_id: UUID, resource: str, record_id: str
) -> bool:
    """Whether a create of this record was ever made through the contract."""
    stmt = (
        select(ChangeLog.id)
        .where(
            ChangeLog.tenant_id == tenant_id,
            ChangeLog.resource == resource,
            ChangeLog.record_id == record_id,
            ChangeLog.action == "create",
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def history(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    resource: str,
    record_id: str | None,
    limit: int,
) -> list[ChangeLog]:
    """Newest first. ``limit + 1`` rows are read so the caller can say whether
    it truncated, rather than presenting the cap as the whole history."""
    stmt = select(ChangeLog).where(
        ChangeLog.tenant_id == tenant_id, ChangeLog.resource == resource
    )
    if record_id is not None:
        stmt = stmt.where(ChangeLog.record_id == record_id)
    stmt = stmt.order_by(ChangeLog.created_at.desc(), ChangeLog.id.desc()).limit(
        limit + 1
    )
    return list((await db.execute(stmt)).scalars().all())
