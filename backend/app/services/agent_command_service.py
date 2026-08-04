"""
Agent command service — CRUD + append-only version history for account
overrides of the runner's embedded agent commands.

The runner ships ``/vet-plan``, ``/implement-plan``, … embedded in its binary.
This service manages the OPTIONAL account layer: an organization may store an
override that replaces a default by name. Resolution order in the runner is
**account override → embedded default**, so nothing here is on the critical
path of a spawn.

Version semantics mirror ``version_history_service.py``:

* every body write APPENDS a version with ``version_number = latest + 1``
  (or 1) and moves the parent's ``current_version`` head;
* a revert writes a NEW version whose body equals the target version's body,
  stamped with ``restored_from`` and a ``"Restored from version {n}"``
  description — history rows are never mutated or deleted.

Org scoping is the caller's job (the API layer runs
``check_organization_membership``); every query here is filtered by the
``organization_id`` it is handed, so one account can never read another's
override.
"""

import hashlib
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_command import AgentCommand, AgentCommandVersion

# =============================================================================
# Pydantic Schemas
# =============================================================================


class AgentCommandCreate(BaseModel):
    """Request to create (or replace) an account's override of a command."""

    name: str
    body: str
    change_description: str | None = None
    is_shared: bool = False


class AgentCommandUpdate(BaseModel):
    """Request to update an override. All fields optional."""

    body: str | None = None
    change_description: str | None = None
    is_shared: bool | None = None


class AgentCommandResponse(BaseModel):
    """Response for one account override."""

    id: str
    organization_id: str | None = None
    created_by_user_id: str | None = None
    name: str
    body: str
    checksum: str | None = None
    is_shared: bool = False
    current_version: int
    source: str = "user"
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentCommandVersionResponse(BaseModel):
    """Response for one row of the append-only version chain."""

    id: str
    agent_command_id: str
    version_number: int
    body: str
    checksum: str | None = None
    created_by_user_id: str | None = None
    change_description: str | None = None
    restored_from: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class Pagination(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


class AgentCommandListResponse(BaseModel):
    items: list[AgentCommandResponse]
    pagination: Pagination


class AgentCommandVersionListResponse(BaseModel):
    items: list[AgentCommandVersionResponse]
    pagination: Pagination


# =============================================================================
# Helpers
# =============================================================================


def compute_body_checksum(body: str) -> str:
    """Canonical agent-command checksum: ``"sha256-<hex>"`` over the
    LF-normalized body.

    This MUST stay byte-identical to ``agent_command_checksum`` in
    ``qontinui-schemas/rust/src/agent_commands.rs`` — the canonical definition
    for all three writing surfaces (this service, the runner, the frontend).
    Two things are load-bearing and neither is the obvious default:

    * **CR-stripping.** The body crosses Postgres, JSON and a Windows
      filesystem before any two checksums are compared. A single CRLF hop
      would report an unchanged command as changed — which is the only thing
      this field exists to detect.
    * **The ``sha256-`` prefix.** It names the algorithm inline, so a future
      change is distinguishable rather than silently reinterpreted.

    Deliberately NOT the bare ``hashlib.sha256(body).hexdigest()`` used by
    ``memory_store._content_hash`` — that rule is for a different content type
    that never crosses a Windows filesystem.
    """
    normalized = body.replace("\r", "")
    return f"sha256-{hashlib.sha256(normalized.encode('utf-8')).hexdigest()}"


def _command_to_response(command: AgentCommand) -> AgentCommandResponse:
    return AgentCommandResponse(
        id=str(command.id),
        organization_id=(
            str(command.organization_id) if command.organization_id else None
        ),
        created_by_user_id=(
            str(command.created_by_user_id) if command.created_by_user_id else None
        ),
        name=command.name,
        body=command.body,
        checksum=command.checksum,
        is_shared=command.is_shared if command.is_shared is not None else False,
        current_version=command.current_version or 1,
        source="user",
        created_at=command.created_at,
        updated_at=command.updated_at,
    )


def _version_to_response(version: AgentCommandVersion) -> AgentCommandVersionResponse:
    return AgentCommandVersionResponse(
        id=str(version.id),
        agent_command_id=str(version.agent_command_id),
        version_number=version.version_number,
        body=version.body,
        checksum=version.checksum,
        created_by_user_id=(
            str(version.created_by_user_id) if version.created_by_user_id else None
        ),
        change_description=version.change_description,
        restored_from=version.restored_from,
        created_at=version.created_at,
    )


# =============================================================================
# Service
# =============================================================================


class AgentCommandService:
    """Service for agent-command override CRUD and version history."""

    async def list_commands(
        self,
        db: AsyncSession,
        organization_id: UUID,
        offset: int = 0,
        limit: int = 100,
    ) -> AgentCommandListResponse:
        """List every override this account holds."""
        query = select(AgentCommand).where(
            AgentCommand.organization_id == organization_id
        )

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(AgentCommand.name.asc()).offset(offset).limit(limit)
        result = await db.execute(query)
        commands = list(result.scalars().all())

        return AgentCommandListResponse(
            items=[_command_to_response(c) for c in commands],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def get_command(
        self,
        db: AsyncSession,
        organization_id: UUID,
        name: str,
    ) -> AgentCommandResponse:
        """Get one override by name, or raise ``ValueError``."""
        command = await self._load_command(db, organization_id, name)
        if not command:
            raise ValueError(f"Agent command override not found: {name}")
        return _command_to_response(command)

    async def upsert_command(
        self,
        db: AsyncSession,
        organization_id: UUID,
        data: AgentCommandCreate,
        user_id: UUID | None,
    ) -> AgentCommandResponse:
        """Create the override, or update it in place, appending a version.

        The write is keyed on ``(organization_id, name)`` — the same pair the
        ``uq_agent_command_org_name`` constraint enforces — so an account can
        hold at most one override per command.
        """
        command = await self._load_command(db, organization_id, data.name)
        checksum = compute_body_checksum(data.body)

        if command is None:
            command = AgentCommand(
                organization_id=organization_id,
                created_by_user_id=user_id,
                name=data.name,
                body=data.body,
                checksum=checksum,
                is_shared=data.is_shared,
                current_version=1,
            )
            db.add(command)
            await db.flush()
            await self._append_version(
                db,
                command,
                version_number=1,
                body=data.body,
                checksum=checksum,
                user_id=user_id,
                change_description=data.change_description,
                restored_from=None,
            )
        else:
            next_number = await self._next_version_number(db, command.id)
            command.body = data.body
            command.checksum = checksum
            command.is_shared = data.is_shared
            command.current_version = next_number
            command.updated_at = datetime.now(UTC)
            await self._append_version(
                db,
                command,
                version_number=next_number,
                body=data.body,
                checksum=checksum,
                user_id=user_id,
                change_description=data.change_description,
                restored_from=None,
            )

        await db.commit()
        await db.refresh(command)
        return _command_to_response(command)

    async def update_command(
        self,
        db: AsyncSession,
        organization_id: UUID,
        name: str,
        data: AgentCommandUpdate,
        user_id: UUID | None,
    ) -> AgentCommandResponse:
        """Patch an existing override. A body change appends a version."""
        command = await self._load_command(db, organization_id, name)
        if not command:
            raise ValueError(f"Agent command override not found: {name}")

        if data.is_shared is not None:
            command.is_shared = data.is_shared

        if data.body is not None:
            checksum = compute_body_checksum(data.body)
            next_number = await self._next_version_number(db, command.id)
            command.body = data.body
            command.checksum = checksum
            command.current_version = next_number
            await self._append_version(
                db,
                command,
                version_number=next_number,
                body=data.body,
                checksum=checksum,
                user_id=user_id,
                change_description=data.change_description,
                restored_from=None,
            )

        command.updated_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(command)
        return _command_to_response(command)

    async def list_versions(
        self,
        db: AsyncSession,
        organization_id: UUID,
        name: str,
        offset: int = 0,
        limit: int = 100,
    ) -> AgentCommandVersionListResponse:
        """List an override's version chain, newest first."""
        command = await self._load_command(db, organization_id, name)
        if not command:
            raise ValueError(f"Agent command override not found: {name}")

        query = select(AgentCommandVersion).where(
            AgentCommandVersion.agent_command_id == command.id
        )

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = (
            query.order_by(AgentCommandVersion.version_number.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(query)
        versions = list(result.scalars().all())

        return AgentCommandVersionListResponse(
            items=[_version_to_response(v) for v in versions],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def revert_to_version(
        self,
        db: AsyncSession,
        organization_id: UUID,
        name: str,
        version_number: int,
        user_id: UUID | None,
    ) -> AgentCommandResponse:
        """Revert by APPENDING a new head whose body equals an older version.

        History is never mutated or deleted — the target version stays exactly
        where it was and a new version is written on top of the chain.
        """
        command = await self._load_command(db, organization_id, name)
        if not command:
            raise ValueError(f"Agent command override not found: {name}")

        target_result = await db.execute(
            select(AgentCommandVersion).where(
                AgentCommandVersion.agent_command_id == command.id,
                AgentCommandVersion.version_number == version_number,
            )
        )
        target = target_result.scalar_one_or_none()
        if not target:
            raise ValueError(
                f"Version {version_number} not found for agent command {name}"
            )

        next_number = await self._next_version_number(db, command.id)
        checksum = target.checksum or compute_body_checksum(target.body)

        command.body = target.body
        command.checksum = checksum
        command.current_version = next_number
        command.updated_at = datetime.now(UTC)

        await self._append_version(
            db,
            command,
            version_number=next_number,
            body=target.body,
            checksum=checksum,
            user_id=user_id,
            change_description=f"Restored from version {version_number}",
            restored_from=version_number,
        )

        await db.commit()
        await db.refresh(command)
        return _command_to_response(command)

    async def delete_override(
        self,
        db: AsyncSession,
        organization_id: UUID,
        name: str,
    ) -> bool:
        """Delete the account's override so the embedded default applies again.

        There is no default row in this database, so this can only ever remove
        the account's own customization. The version chain goes with it via the
        FK's ``ON DELETE CASCADE``.
        """
        command = await self._load_command(db, organization_id, name)
        if not command:
            return False

        await db.delete(command)
        await db.commit()
        return True

    # -------------------------------------------------------------------
    # Internals
    # -------------------------------------------------------------------

    async def _load_command(
        self,
        db: AsyncSession,
        organization_id: UUID,
        name: str,
    ) -> AgentCommand | None:
        """Load one override, always filtered by the owning account."""
        result = await db.execute(
            select(AgentCommand).where(
                AgentCommand.organization_id == organization_id,
                AgentCommand.name == name,
            )
        )
        return result.scalar_one_or_none()

    async def _next_version_number(
        self,
        db: AsyncSession,
        agent_command_id: UUID,
    ) -> int:
        """``latest + 1``, or 1 — the same rule ``VersionHistoryService`` uses.

        Application-side monotonicity only; ``uq_agent_command_version`` is
        what actually rejects two concurrent appends that both read the same
        latest number.
        """
        result = await db.execute(
            select(func.max(AgentCommandVersion.version_number)).where(
                AgentCommandVersion.agent_command_id == agent_command_id
            )
        )
        latest = result.scalar()
        return (latest + 1) if latest else 1

    async def _append_version(
        self,
        db: AsyncSession,
        command: AgentCommand,
        *,
        version_number: int,
        body: str,
        checksum: str,
        user_id: UUID | None,
        change_description: str | None,
        restored_from: int | None,
    ) -> AgentCommandVersion:
        """Append one immutable row to the chain."""
        version = AgentCommandVersion(
            agent_command_id=command.id,
            version_number=version_number,
            body=body,
            checksum=checksum,
            created_by_user_id=user_id,
            change_description=change_description,
            restored_from=restored_from,
        )
        db.add(version)
        await db.flush()
        return version
