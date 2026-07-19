"""Async repositories for the ``devenv`` digital-twin feature.

All operations are **owner-scoped** — every query filters on
``owner_user_id == owner_id`` so a user can never read or mutate another
user's rows. Cross-owner ids resolve to ``None`` (the endpoint layer turns
that into a 404, not a 403, so existence is not leaked).

The config upsert uses Postgres ``INSERT ... ON CONFLICT (environment_id,
machine_id) DO UPDATE`` so an agent re-reporting its config for the same
(environment, machine) replaces the prior row atomically.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.devenv import (
    Application,
    CanonicalChangeLog,
    Environment,
    Machine,
    MachineEnvironmentConfig,
    MachineEnvironmentConfigHistory,
)
from app.models.user import User

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------


class ApplicationRepository:
    """Owner-scoped CRUD for ``devenv.applications``."""

    async def create(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        name: str,
        slug: str,
        description: str | None,
    ) -> Application:
        """Create an application."""
        app = Application(
            owner_user_id=owner_id,
            name=name,
            slug=slug,
            description=description,
        )
        db.add(app)
        await db.flush()
        await db.refresh(app)
        return app

    async def get(
        self, db: AsyncSession, *, owner_id: UUID, app_id: UUID
    ) -> Application | None:
        """Get an owner's application by id."""
        stmt = select(Application).where(
            Application.id == app_id,
            Application.owner_user_id == owner_id,
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def list(self, db: AsyncSession, *, owner_id: UUID) -> list[Application]:
        """List an owner's applications, newest first."""
        stmt = (
            select(Application)
            .where(Application.owner_user_id == owner_id)
            .order_by(Application.created_at.desc())
        )
        return list((await db.execute(stmt)).scalars().all())

    async def slug_exists(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        slug: str,
        exclude_id: UUID | None = None,
    ) -> bool:
        """Check whether a slug already exists for this owner."""
        stmt = select(Application.id).where(
            Application.owner_user_id == owner_id,
            Application.slug == slug,
        )
        if exclude_id is not None:
            stmt = stmt.where(Application.id != exclude_id)
        return (await db.execute(stmt)).scalar_one_or_none() is not None

    async def update(
        self, db: AsyncSession, *, app: Application, fields: dict[str, Any]
    ) -> Application:
        """Apply a partial update to an application."""
        for key, value in fields.items():
            setattr(app, key, value)
        await db.flush()
        await db.refresh(app)
        return app

    async def delete(self, db: AsyncSession, *, app: Application) -> None:
        """Delete an application."""
        await db.delete(app)
        await db.flush()


# ---------------------------------------------------------------------------
# Machines
# ---------------------------------------------------------------------------


class MachineRepository:
    """Owner-scoped CRUD for ``devenv.machines``."""

    async def create(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        name: str,
        hostname: str | None,
        description: str | None,
        environment_id: UUID | None = None,
    ) -> Machine:
        """Create a machine (key material is set later, at enroll time)."""
        machine = Machine(
            owner_user_id=owner_id,
            name=name,
            hostname=hostname,
            description=description,
            environment_id=environment_id,
        )
        db.add(machine)
        await db.flush()
        await db.refresh(machine)
        return machine

    async def get(
        self, db: AsyncSession, *, owner_id: UUID, machine_id: UUID
    ) -> Machine | None:
        """Get an owner's machine by id."""
        stmt = select(Machine).where(
            Machine.id == machine_id,
            Machine.owner_user_id == owner_id,
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def list(self, db: AsyncSession, *, owner_id: UUID) -> list[Machine]:
        """List an owner's machines, newest first."""
        stmt = (
            select(Machine)
            .where(Machine.owner_user_id == owner_id)
            .order_by(Machine.created_at.desc())
        )
        return list((await db.execute(stmt)).scalars().all())

    async def name_exists(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        name: str,
        exclude_id: UUID | None = None,
    ) -> bool:
        """Check whether a machine name already exists for this owner."""
        stmt = select(Machine.id).where(
            Machine.owner_user_id == owner_id,
            Machine.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(Machine.id != exclude_id)
        return (await db.execute(stmt)).scalar_one_or_none() is not None

    async def update(
        self, db: AsyncSession, *, machine: Machine, fields: dict[str, Any]
    ) -> Machine:
        """Apply a partial update to a machine."""
        for key, value in fields.items():
            setattr(machine, key, value)
        await db.flush()
        await db.refresh(machine)
        return machine

    async def delete(self, db: AsyncSession, *, machine: Machine) -> None:
        """Delete a machine."""
        await db.delete(machine)
        await db.flush()


# ---------------------------------------------------------------------------
# Environments
# ---------------------------------------------------------------------------


class EnvironmentRepository:
    """Owner-scoped CRUD for ``devenv.environments``."""

    async def create(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        name: str,
        description: str | None,
        application_id: UUID | None,
    ) -> Environment:
        """Create an environment."""
        env = Environment(
            owner_user_id=owner_id,
            name=name,
            description=description,
            application_id=application_id,
        )
        db.add(env)
        await db.flush()
        await db.refresh(env)
        return env

    async def get(
        self, db: AsyncSession, *, owner_id: UUID, env_id: UUID
    ) -> Environment | None:
        """Get an owner's environment by id."""
        stmt = select(Environment).where(
            Environment.id == env_id,
            Environment.owner_user_id == owner_id,
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def list(self, db: AsyncSession, *, owner_id: UUID) -> list[Environment]:
        """List an owner's environments, newest first."""
        stmt = (
            select(Environment)
            .where(Environment.owner_user_id == owner_id)
            .order_by(Environment.created_at.desc())
        )
        return list((await db.execute(stmt)).scalars().all())

    async def name_exists(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        name: str,
        exclude_id: UUID | None = None,
    ) -> bool:
        """Check whether an environment name already exists for this owner."""
        stmt = select(Environment.id).where(
            Environment.owner_user_id == owner_id,
            Environment.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(Environment.id != exclude_id)
        return (await db.execute(stmt)).scalar_one_or_none() is not None

    async def update(
        self, db: AsyncSession, *, env: Environment, fields: dict[str, Any]
    ) -> Environment:
        """Apply a partial update to an environment."""
        for key, value in fields.items():
            setattr(env, key, value)
        await db.flush()
        await db.refresh(env)
        return env

    async def delete(self, db: AsyncSession, *, env: Environment) -> None:
        """Delete an environment."""
        await db.delete(env)
        await db.flush()

    async def set_canonical(
        self, db: AsyncSession, *, env: Environment, machine_id: UUID | None
    ) -> Environment:
        """Atomically set the single canonical-machine pointer.

        The one-canonical invariant is structural — this is a single
        nullable scalar column update, so designating a new canonical
        machine implicitly demotes the previous one.
        """
        env.canonical_machine_id = machine_id  # type: ignore[assignment]
        await db.flush()
        await db.refresh(env)
        return env


# ---------------------------------------------------------------------------
# Machine-environment configs
# ---------------------------------------------------------------------------


class MachineEnvironmentConfigRepository:
    """Owner-scoped CRUD + upsert for ``devenv.machine_environment_configs``."""

    async def get(
        self,
        db: AsyncSession,
        *,
        environment_id: UUID,
        machine_id: UUID,
    ) -> MachineEnvironmentConfig | None:
        """Get the config row for an (environment, machine) pair."""
        stmt = select(MachineEnvironmentConfig).where(
            MachineEnvironmentConfig.environment_id == environment_id,
            MachineEnvironmentConfig.machine_id == machine_id,
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def list_for_environment(
        self, db: AsyncSession, *, environment_id: UUID
    ) -> list[MachineEnvironmentConfig]:
        """List all config rows reported for an environment."""
        stmt = select(MachineEnvironmentConfig).where(
            MachineEnvironmentConfig.environment_id == environment_id
        )
        return list((await db.execute(stmt)).scalars().all())

    async def exists(
        self,
        db: AsyncSession,
        *,
        environment_id: UUID,
        machine_id: UUID,
    ) -> bool:
        """Check whether a config row exists for an (environment, machine)."""
        stmt = select(MachineEnvironmentConfig.id).where(
            MachineEnvironmentConfig.environment_id == environment_id,
            MachineEnvironmentConfig.machine_id == machine_id,
        )
        return (await db.execute(stmt)).scalar_one_or_none() is not None

    async def upsert(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        environment_id: UUID,
        machine_id: UUID,
        config: dict[str, Any],
        schema_version: int,
        source: str,
        captured_at: Any,
    ) -> MachineEnvironmentConfig:
        """Insert-or-update the config row for an (environment, machine).

        Uses Postgres ``ON CONFLICT (environment_id, machine_id) DO
        UPDATE`` so a re-report atomically replaces the prior envelope.
        """
        table = MachineEnvironmentConfig.__table__
        stmt = (
            pg_insert(table)
            .values(
                owner_user_id=owner_id,
                environment_id=environment_id,
                machine_id=machine_id,
                config=config,
                schema_version=schema_version,
                source=source,
                captured_at=captured_at,
            )
            .on_conflict_do_update(
                index_elements=["environment_id", "machine_id"],
                set_={
                    "config": config,
                    "schema_version": schema_version,
                    "source": source,
                    "captured_at": captured_at,
                    "updated_at": text("now()"),
                },
            )
            .returning(table.c.id)
        )
        result = await db.execute(stmt)
        row_id = result.scalar_one()
        await db.flush()
        fetched = await self._get_by_id(db, row_id)
        assert fetched is not None
        return fetched

    async def _get_by_id(
        self, db: AsyncSession, config_id: Any
    ) -> MachineEnvironmentConfig | None:
        """Fetch a config row by primary key."""
        stmt = select(MachineEnvironmentConfig).where(
            MachineEnvironmentConfig.id == config_id
        )
        return (await db.execute(stmt)).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Machine-environment config history (append-only capture timeline)
# ---------------------------------------------------------------------------


def compute_content_hash(config: dict[str, Any]) -> str:
    """Sha256 hex of the canonical-JSON envelope, ``captured_at`` excluded.

    Canonical JSON = sorted keys + compact separators, so semantically
    identical envelopes hash identically regardless of dict key order.
    The top-level ``captured_at`` is excluded because it moves on EVERY
    capture — including it would defeat the consecutive-dedup this hash
    exists for (the ~15-min runner re-capture of unchanged content).
    """
    hashable = {k: v for k, v in config.items() if k != "captured_at"}
    canonical = json.dumps(hashable, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


class MachineEnvironmentConfigHistoryRepository:
    """Append-only history for ``devenv.machine_environment_config_history``.

    Like :class:`CanonicalChangeLogRepository`, reads are not owner-filtered
    here — callers resolve+authorize the (environment, machine) pair first
    and then query by ids.
    """

    async def append_if_changed(
        self,
        db: AsyncSession,
        *,
        owner_user_id: UUID,
        environment_id: UUID,
        machine_id: UUID,
        config: dict[str, Any],
        schema_version: int,
        source: str,
        captured_at: datetime,
    ) -> bool:
        """Append a history row iff the envelope content actually changed.

        Consecutive dedup: compares ``content_hash`` against the most recent
        history row for the (environment, machine) pair and inserts only when
        the hash differs (or no prior row exists). Returns whether a row was
        appended.

        **Concurrency invariant — call only AFTER**
        :meth:`MachineEnvironmentConfigRepository.upsert` **for the same
        (environment, machine) in the same transaction.** The dedup here is a
        plain read-then-insert with no lock of its own; its race safety is
        positional: the upsert's ``INSERT ... ON CONFLICT`` takes a row lock
        on the (environment, machine) snapshot row, serializing concurrent
        reporters for the pair until commit, which is what keeps two
        simultaneous reports from both passing the hash check and appending
        duplicates. A future call site that skips the upsert (or runs in a
        separate transaction) silently reintroduces that race — add explicit
        locking here first.
        """
        content_hash = compute_content_hash(config)
        stmt = (
            select(MachineEnvironmentConfigHistory.content_hash)
            .where(
                MachineEnvironmentConfigHistory.environment_id == environment_id,
                MachineEnvironmentConfigHistory.machine_id == machine_id,
            )
            .order_by(
                MachineEnvironmentConfigHistory.captured_at.desc(),
                MachineEnvironmentConfigHistory.created_at.desc(),
            )
            .limit(1)
        )
        latest_hash = (await db.execute(stmt)).scalar_one_or_none()
        if latest_hash == content_hash:
            return False
        row = MachineEnvironmentConfigHistory(
            owner_user_id=owner_user_id,
            environment_id=environment_id,
            machine_id=machine_id,
            config=config,
            schema_version=schema_version,
            source=source,
            captured_at=captured_at,
            content_hash=content_hash,
        )
        db.add(row)
        await db.flush()
        return True

    async def list_for_machine(
        self,
        db: AsyncSession,
        *,
        environment_id: UUID,
        machine_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[MachineEnvironmentConfigHistory]:
        """List an (environment, machine)'s captures, newest first."""
        stmt = (
            select(MachineEnvironmentConfigHistory)
            .where(
                MachineEnvironmentConfigHistory.environment_id == environment_id,
                MachineEnvironmentConfigHistory.machine_id == machine_id,
            )
            .order_by(
                MachineEnvironmentConfigHistory.captured_at.desc(),
                MachineEnvironmentConfigHistory.created_at.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        return list((await db.execute(stmt)).scalars().all())

    async def get(
        self,
        db: AsyncSession,
        *,
        history_id: UUID,
        environment_id: UUID,
        machine_id: UUID,
    ) -> MachineEnvironmentConfigHistory | None:
        """Get one history row, scoped to its (environment, machine) pair.

        The pair scoping means a valid history id from ANOTHER pair resolves
        to ``None`` (the endpoint layer turns that into a 404).
        """
        stmt = select(MachineEnvironmentConfigHistory).where(
            MachineEnvironmentConfigHistory.id == history_id,
            MachineEnvironmentConfigHistory.environment_id == environment_id,
            MachineEnvironmentConfigHistory.machine_id == machine_id,
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def prune(
        self, db: AsyncSession, *, keep_per_pair: int = 500
    ) -> list[tuple[UUID, UUID, int]]:
        """Delete rows beyond the newest ``keep_per_pair`` per (env, machine).

        Uses a window-function DELETE (``row_number() OVER (PARTITION BY
        environment_id, machine_id ORDER BY captured_at DESC)``). Returns
        ``(environment_id, machine_id, deleted_count)`` per pruned pair so
        the caller can log every pair it capped — no silent cap.
        """
        result = await db.execute(
            text(
                """
                WITH ranked AS (
                    SELECT id,
                           row_number() OVER (
                               PARTITION BY environment_id, machine_id
                               ORDER BY captured_at DESC, created_at DESC
                           ) AS rn
                    FROM devenv.machine_environment_config_history
                ),
                doomed AS (
                    DELETE FROM devenv.machine_environment_config_history h
                    USING ranked r
                    WHERE h.id = r.id AND r.rn > :keep
                    RETURNING h.environment_id, h.machine_id
                )
                SELECT environment_id, machine_id, count(*) AS deleted
                FROM doomed
                GROUP BY environment_id, machine_id
                """
            ),
            {"keep": keep_per_pair},
        )
        return [
            (row.environment_id, row.machine_id, int(row.deleted))
            for row in result.fetchall()
        ]


# ---------------------------------------------------------------------------
# Canonical change log (audit)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CanonicalChangeRow:
    """One audit row plus its LEFT-JOIN-resolved display names.

    Every name is ``None``-able by design — the machine ids are soft refs so
    the audit survives machine deletion, and the actor FK is ``SET NULL``.
    """

    log: CanonicalChangeLog
    changed_by_email: str | None
    from_machine_name: str | None
    to_machine_name: str | None


class CanonicalChangeLogRepository:
    """Append-only audit of canonical designations for ``devenv.environments``.

    Unlike the other repositories this is not owner-filtered on read — callers
    resolve+authorize the environment first (owner- or, later, tenant-scoped)
    and then ask for its history by ``environment_id``.
    """

    async def record(
        self,
        db: AsyncSession,
        *,
        environment_id: UUID,
        from_machine_id: UUID | None,
        to_machine_id: UUID | None,
        changed_by_user_id: UUID | None,
        tenant_id: UUID | None = None,
        note: str | None = None,
    ) -> CanonicalChangeLog:
        """Append one canonical-change record."""
        row = CanonicalChangeLog(
            environment_id=environment_id,
            from_machine_id=from_machine_id,
            to_machine_id=to_machine_id,
            changed_by_user_id=changed_by_user_id,
            tenant_id=tenant_id,
            note=note,
        )
        db.add(row)
        await db.flush()
        await db.refresh(row)
        return row

    async def list_for_environment(
        self,
        db: AsyncSession,
        *,
        environment_id: UUID,
        limit: int = 100,
    ) -> list[CanonicalChangeRow]:
        """List an environment's canonical changes, newest first.

        Resolves the display names (actor email, from/to machine names) in
        the SAME query via LEFT JOINs — a per-row lookup by the caller would
        be an N+1 that grows with history length.

        Every joined name is nullable **by design**: the machine ids are soft
        references (see :class:`~app.models.devenv.CanonicalChangeLog`) so the
        audit row outlives machine deletion, and ``changed_by_user_id`` is an
        FK with ``ON DELETE SET NULL``. LEFT joins keep the audit row; the
        name simply comes back ``None``.
        """
        from_machine = aliased(Machine)
        to_machine = aliased(Machine)
        stmt = (
            select(
                CanonicalChangeLog,
                User.email.label("changed_by_email"),
                from_machine.name.label("from_machine_name"),
                to_machine.name.label("to_machine_name"),
            )
            .outerjoin(User, User.id == CanonicalChangeLog.changed_by_user_id)
            .outerjoin(
                from_machine, from_machine.id == CanonicalChangeLog.from_machine_id
            )
            .outerjoin(to_machine, to_machine.id == CanonicalChangeLog.to_machine_id)
            .where(CanonicalChangeLog.environment_id == environment_id)
            .order_by(CanonicalChangeLog.changed_at.desc())
            .limit(limit)
        )
        return [
            CanonicalChangeRow(
                log=row[0],
                changed_by_email=row[1],
                from_machine_name=row[2],
                to_machine_name=row[3],
            )
            for row in (await db.execute(stmt)).all()
        ]


# Singleton instances.
application_repo = ApplicationRepository()
machine_repo = MachineRepository()
environment_repo = EnvironmentRepository()
config_repo = MachineEnvironmentConfigRepository()
config_history_repo = MachineEnvironmentConfigHistoryRepository()
canonical_log_repo = CanonicalChangeLogRepository()
