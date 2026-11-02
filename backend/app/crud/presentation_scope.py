"""Reads and writes of ``web.presentation_scopes``.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3). Every query
names its tenant; there is no other way in. A write is a compare-and-set on
``version``: two admins editing at once cannot silently drop each other's
confidential terms, because the second write names a version that has moved
and is refused (:class:`ScopeVersionConflict`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.presentation_scope import PresentationScope
from app.models.user import User


@dataclass(frozen=True)
class StoredScope:
    """One tenant's stored row, as the API reads it."""

    first_party_owners: tuple[str, ...] | None
    confidential_terms: tuple[str, ...]
    version: int
    updated_at: datetime
    updated_by: str | None


class ScopeVersionConflict(Exception):
    """The row moved since the writer read it."""

    def __init__(self, current_version: int) -> None:
        super().__init__(f"the stored version is {current_version}")
        self.current_version = current_version


def _stored(
    owners: Sequence[str] | None,
    terms: Sequence[str] | None,
    version: int,
    updated_at: datetime,
    updated_by: str | None,
) -> StoredScope:
    return StoredScope(
        first_party_owners=None if owners is None else tuple(owners),
        confidential_terms=tuple(terms or ()),
        version=version,
        updated_at=updated_at,
        updated_by=updated_by,
    )


async def get_scope(db: AsyncSession, tenant_id: UUID) -> StoredScope | None:
    """The tenant's stored row with its last writer's email, or ``None``."""
    row = (
        await db.execute(
            select(
                PresentationScope.first_party_owners,
                PresentationScope.confidential_terms,
                PresentationScope.version,
                PresentationScope.updated_at,
                User.email,
            )
            .outerjoin(User, User.id == PresentationScope.updated_by_user_id)
            .where(PresentationScope.tenant_id == tenant_id)
        )
    ).one_or_none()
    if row is None:
        return None
    return _stored(*row)


async def write_scope(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    first_party_owners: Sequence[str] | None,
    confidential_terms: Sequence[str],
    expected_version: int,
    user: User,
) -> StoredScope:
    """Replace the tenant's row when it is still at ``expected_version``.

    ``expected_version == 0`` creates the row and is refused when one exists.
    Any other value updates the row only while it is at that version, and the
    stored version moves by one. A refused write changes nothing and raises
    :class:`ScopeVersionConflict` naming the version actually stored (0 when
    there is no row). The caller commits.
    """
    owners = None if first_party_owners is None else list(first_party_owners)
    terms = list(confidential_terms)
    now = datetime.now(UTC)
    if expected_version == 0:
        inserted = await db.execute(
            pg_insert(PresentationScope)
            .values(
                tenant_id=tenant_id,
                first_party_owners=owners,
                confidential_terms=terms,
                version=1,
                updated_by_user_id=user.id,
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=[PresentationScope.tenant_id])
            .returning(PresentationScope.version)
        )
        written_version = inserted.scalar_one_or_none()
    else:
        updated = await db.execute(
            update(PresentationScope)
            .where(
                PresentationScope.tenant_id == tenant_id,
                PresentationScope.version == expected_version,
            )
            .values(
                first_party_owners=owners,
                confidential_terms=terms,
                version=PresentationScope.version + 1,
                updated_by_user_id=user.id,
                updated_at=now,
            )
            .returning(PresentationScope.version)
            .execution_options(synchronize_session=False)
        )
        written_version = updated.scalar_one_or_none()
    if written_version is None:
        current = await db.scalar(
            select(PresentationScope.version).where(
                PresentationScope.tenant_id == tenant_id
            )
        )
        raise ScopeVersionConflict(current or 0)
    return _stored(owners, terms, written_version, now, user.email)
