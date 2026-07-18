"""Async repositories for the ``devenv`` digital-twin feature.

Access model (P4 org sharing):

* **Machines are strictly owner-scoped** — every machine query filters on
  ``owner_user_id == owner_id``.
* **Applications and Environments** are either personal
  (``organization_id`` NULL → visible to ``owner_user_id`` only) or
  org-shared (``organization_id`` set → visible to the owner AND all
  members of that ``auth`` org except ``helper``). Role mapping:
  ``owner``/``admin``/``member`` → edit, ``viewer`` → view only,
  ``helper`` → no devenv access. The ``get_viewable`` / ``list_accessible``
  methods plus the :func:`can_edit` predicate implement this (view-fetch then
  ``can_edit`` lets endpoints answer 404-for-nonmember vs 403-for-viewer);
  the plain ``get`` / ``list`` methods stay owner-scoped (the agent surface
  relies on them).

Cross-owner / non-member ids resolve to ``None`` (the endpoint layer turns
that into a 404, not a 403, so existence is not leaked).

The config upsert uses Postgres ``INSERT ... ON CONFLICT (environment_id,
machine_id) DO UPDATE`` so an agent re-reporting its config for the same
(environment, machine) replaces the prior row atomically.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.devenv import (
    Application,
    CanonicalChangeLog,
    Environment,
    Machine,
    MachineEnvironmentConfig,
)
from app.models.organization import TeamMember, TeamRole

# ---------------------------------------------------------------------------
# Org-membership access helper (shared by Application/Environment repos)
# ---------------------------------------------------------------------------

# Roles that grant EDIT on org-shared devenv resources. `viewer` is view-only;
# `helper` has no devenv access at all (it only sees the /help portal).
_EDIT_ROLES: tuple[str, ...] = (
    TeamRole.OWNER.value,
    TeamRole.ADMIN.value,
    TeamRole.MEMBER.value,
)


async def view_org_ids(db: AsyncSession, user_id: UUID) -> list[UUID]:
    """Org ids in which ``user_id`` may VIEW devenv resources (role != helper)."""
    stmt = select(TeamMember.organization_id).where(
        TeamMember.user_id == user_id,
        TeamMember.role != TeamRole.HELPER.value,
    )
    return list((await db.execute(stmt)).scalars().all())


async def edit_org_ids(db: AsyncSession, user_id: UUID) -> list[UUID]:
    """Org ids in which ``user_id`` may EDIT devenv resources."""
    stmt = select(TeamMember.organization_id).where(
        TeamMember.user_id == user_id,
        TeamMember.role.in_(_EDIT_ROLES),
    )
    return list((await db.execute(stmt)).scalars().all())


async def can_edit(
    db: AsyncSession, user_id: UUID, *, resource: Application | Environment
) -> bool:
    """Whether ``user_id`` may edit an (already-fetched) app/environment.

    The owner always may; otherwise the resource must be org-shared and the
    user must hold an edit-capable role (owner/admin/member) in that org.
    """
    if resource.owner_user_id == user_id:
        return True
    if resource.organization_id is None:
        return False
    return resource.organization_id in await edit_org_ids(db, user_id)


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------


class ApplicationRepository:
    """CRUD for ``devenv.applications`` (owner- or org-membership-scoped)."""

    async def create(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        name: str,
        slug: str,
        description: str | None,
        organization_id: UUID | None = None,
    ) -> Application:
        """Create an application (optionally org-shared from birth)."""
        app = Application(
            owner_user_id=owner_id,
            name=name,
            slug=slug,
            description=description,
            organization_id=organization_id,
        )
        db.add(app)
        await db.flush()
        await db.refresh(app)
        return app

    async def get_viewable(
        self, db: AsyncSession, *, user_id: UUID, app_id: UUID
    ) -> Application | None:
        """Get an application the user may VIEW (owner or non-helper member)."""
        org_ids = await view_org_ids(db, user_id)
        stmt = select(Application).where(
            Application.id == app_id,
            or_(
                Application.owner_user_id == user_id,
                Application.organization_id.in_(org_ids),
            ),
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def list_accessible(
        self, db: AsyncSession, *, user_id: UUID
    ) -> list[Application]:
        """List applications the user may view (owned + org-shared), newest first."""
        org_ids = await view_org_ids(db, user_id)
        stmt = (
            select(Application)
            .where(
                or_(
                    Application.owner_user_id == user_id,
                    Application.organization_id.in_(org_ids),
                )
            )
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

    async def get_by_id(self, db: AsyncSession, *, machine_id: UUID) -> Machine | None:
        """Get a machine by id with NO owner filter.

        For env-mediated reads only: machines remain strictly personal, but an
        org-shared ENVIRONMENT's machine-derived surfaces (drift reports,
        canonical designation) are visible to anyone who can view that
        environment, regardless of which user owns the machines. Callers MUST
        have already authorized the environment (get_viewable/get_editable)
        and must only surface machines tied to it (via its config rows).
        """
        stmt = select(Machine).where(Machine.id == machine_id)
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
    """CRUD for ``devenv.environments`` (owner- or org-membership-scoped).

    ``get`` / ``list`` remain strictly owner-scoped — the machine-key agent
    surface (``devenv_agent.py``) resolves environments through the machine's
    OWNER and must not see org-shared rows. The user-JWT endpoints use the
    membership-aware ``get_viewable`` / ``list_accessible`` (+ ``can_edit``).
    """

    async def create(
        self,
        db: AsyncSession,
        *,
        owner_id: UUID,
        name: str,
        description: str | None,
        application_id: UUID | None,
        organization_id: UUID | None = None,
    ) -> Environment:
        """Create an environment (optionally org-shared from birth)."""
        env = Environment(
            owner_user_id=owner_id,
            name=name,
            description=description,
            application_id=application_id,
            organization_id=organization_id,
        )
        db.add(env)
        await db.flush()
        await db.refresh(env)
        return env

    async def get(
        self, db: AsyncSession, *, owner_id: UUID, env_id: UUID
    ) -> Environment | None:
        """Get an owner's environment by id (strictly owner-scoped)."""
        stmt = select(Environment).where(
            Environment.id == env_id,
            Environment.owner_user_id == owner_id,
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def get_viewable(
        self, db: AsyncSession, *, user_id: UUID, env_id: UUID
    ) -> Environment | None:
        """Get an environment the user may VIEW (owner or non-helper member)."""
        org_ids = await view_org_ids(db, user_id)
        stmt = select(Environment).where(
            Environment.id == env_id,
            or_(
                Environment.owner_user_id == user_id,
                Environment.organization_id.in_(org_ids),
            ),
        )
        return (await db.execute(stmt)).scalar_one_or_none()

    async def list_accessible(
        self, db: AsyncSession, *, user_id: UUID
    ) -> list[Environment]:
        """List environments the user may view (owned + org-shared), newest first."""
        org_ids = await view_org_ids(db, user_id)
        stmt = (
            select(Environment)
            .where(
                or_(
                    Environment.owner_user_id == user_id,
                    Environment.organization_id.in_(org_ids),
                )
            )
            .order_by(Environment.created_at.desc())
        )
        return list((await db.execute(stmt)).scalars().all())

    # NOTE: defined AFTER list_accessible on purpose — once `list` exists in
    # the class namespace, a later `list[...]` annotation would resolve to
    # the method, not the builtin (mypy valid-type error).
    async def list(self, db: AsyncSession, *, owner_id: UUID) -> list[Environment]:
        """List an owner's environments, newest first (strictly owner-scoped)."""
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
# Canonical change log (audit)
# ---------------------------------------------------------------------------


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
    ) -> list[CanonicalChangeLog]:
        """List an environment's canonical changes, newest first."""
        stmt = (
            select(CanonicalChangeLog)
            .where(CanonicalChangeLog.environment_id == environment_id)
            .order_by(CanonicalChangeLog.changed_at.desc())
            .limit(limit)
        )
        return list((await db.execute(stmt)).scalars().all())


# Singleton instances.
application_repo = ApplicationRepository()
machine_repo = MachineRepository()
environment_repo = EnvironmentRepository()
config_repo = MachineEnvironmentConfigRepository()
canonical_log_repo = CanonicalChangeLogRepository()
