"""``overview.change_log`` — the one audit trail every overview write appends.

Plan ``2026-09-20-overview-authoring-layer`` §1 ("Audit"). A write and its
change-log row share a transaction wherever both live in this database, so a
write that commits always has its row. For a resource stored elsewhere (coord's
prompt documents) the row is written after the store accepted the write: the
store's own version log is authoritative for the content, and this row is what
names the overview as the place the edit came from.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import CHANGE_SOURCES, ChangeLog

if TYPE_CHECKING:
    from app.overview.permissions import OverviewAccess

#: The request header a client names its surface with. The overview pages send
#: ``ui``; the CSV paste and the gantt import send ``import``. Absent — which
#: is what an agent or script sends — reads as ``api``.
SOURCE_HEADER = "X-Overview-Source"

#: The request header a client REPORTS its session with: a lowercase
#: 8-4-4-4-12 uuid (a Claude Code ``Session-Id``). Coord's device JWT carries
#: no session id, so nothing can prove one — the value is a label, recorded
#: when it has the right shape and otherwise ignored (plan
#: ``2026-10-07-agents-publish-documents-to-the-project-overview`` D2).
SESSION_HEADER = "X-Overview-Session"

_SESSION_SHAPE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

ChangeAction = Literal["create", "update", "delete"]


def change_source(request: Request) -> str:
    """Where this write came from, per :data:`SOURCE_HEADER`.

    An unrecognised value is recorded as ``api`` rather than refused: the
    header is a label the client volunteers, never an authorization input,
    and failing a legitimate write over a label would be the wrong trade.
    """
    value = (request.headers.get(SOURCE_HEADER) or "").strip().lower()
    return value if value in CHANGE_SOURCES else "api"


def reported_session(request: Request) -> str | None:
    """The session :data:`SESSION_HEADER` reports, or ``None``.

    A malformed value is dropped with no record and no error: like the source
    header it is a label, never an authorization input, so a bad one must not
    fail the write — and must not be stored either, since a reader treats a
    stored value as a session id.
    """
    value = (request.headers.get(SESSION_HEADER) or "").strip()
    return value if _SESSION_SHAPE.fullmatch(value) else None


def attribution(access: OverviewAccess, request: Request) -> dict[str, Any]:
    """Who made a write, as every change-log row records it: the person, the
    device the write came through (from the verified token), and the session
    the client reported. Spread into :func:`record` so no call site can record
    the person and forget the device."""
    return {
        "actor": access.actor,
        "actor_user_id": access.user_id,
        "via_device": access.via_device,
        "via_session": reported_session(request),
    }


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
    via_device: UUID | None = None,
    via_session: str | None = None,
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
        via_device=via_device,
        via_session=via_session,
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
    source: str | None = None,
) -> list[ChangeLog]:
    """Newest first. ``limit + 1`` rows are read so the caller can say whether
    it truncated, rather than presenting the cap as the whole history."""
    stmt = select(ChangeLog).where(
        ChangeLog.tenant_id == tenant_id, ChangeLog.resource == resource
    )
    if record_id is not None:
        stmt = stmt.where(ChangeLog.record_id == record_id)
    if source is not None:
        stmt = stmt.where(ChangeLog.source == source)
    stmt = stmt.order_by(ChangeLog.created_at.desc(), ChangeLog.id.desc()).limit(
        limit + 1
    )
    return list((await db.execute(stmt)).scalars().all())
