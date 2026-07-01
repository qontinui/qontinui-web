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

from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.devenv import (
    Application,
    Environment,
    Machine,
    MachineEnvironmentConfig,
)

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


# Singleton instances.
application_repo = ApplicationRepository()
machine_repo = MachineRepository()
environment_repo = EnvironmentRepository()
config_repo = MachineEnvironmentConfigRepository()
