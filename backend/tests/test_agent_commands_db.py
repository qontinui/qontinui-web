"""DB-backed tests for account-versioned agent commands (Phase 1).

Runs against the shared test PostgreSQL through the session-scoped
``test_engine`` fixture in ``tests/conftest.py`` (which builds every table from
``Base.metadata``), with its own ``async_sessionmaker`` so the service's
``commit()`` calls behave exactly as they do in the app. Rows created here are
deleted in fixture teardown.

Covers the four gates Phase 1 of
``2026-07-29-account-versioned-agent-commands`` names:

* the version chain is append-only and monotonic;
* a revert creates a NEW head and mutates nothing behind it;
* ``uq_agent_command_version`` REJECTS a duplicate
  ``(agent_command_id, version_number)`` — the constraint, not just the happy
  path's arithmetic, is what makes "monotonic" true under concurrency;
* another organization's override is invisible, and deleting an override takes
  its versions with it (there is no default row to delete).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.agent_command import AgentCommand, AgentCommandVersion
from app.models.organization import Organization
from app.models.user import User
from app.services.agent_command_service import (
    AgentCommandCreate,
    AgentCommandService,
    compute_body_checksum,
)

COMMAND_NAME = "vet-plan"


class _Accounts:
    """Two independent organizations, each with its own owner."""

    def __init__(self, org_a: UUID, org_b: UUID, user_a: UUID, user_b: UUID) -> None:
        self.org_a = org_a
        self.org_b = org_b
        self.user_a = user_a
        self.user_b = user_b


@pytest_asyncio.fixture
async def ac_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """A committing session over the test engine."""
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def accounts(ac_db: AsyncSession) -> AsyncGenerator[_Accounts, None]:
    """Seed two orgs + owners; drop everything they own afterwards."""
    created: list[tuple[UUID, UUID]] = []
    for _ in range(2):
        user = User(
            email=f"agentcmd_{uuid4()}@example.com",
            username=f"agentcmd_{uuid4().hex[:8]}",
            full_name="Agent Command Test User",
            is_active=True,
            is_verified=True,
        )
        ac_db.add(user)
        await ac_db.flush()

        org = Organization(
            name=f"agentcmd-org-{uuid4().hex[:8]}",
            slug=f"agentcmd-org-{uuid4().hex[:8]}",
            owner_id=user.id,
            settings={},
        )
        ac_db.add(org)
        await ac_db.flush()
        created.append((org.id, user.id))
    await ac_db.commit()

    (org_a, user_a), (org_b, user_b) = created
    yield _Accounts(org_a=org_a, org_b=org_b, user_a=user_a, user_b=user_b)

    await ac_db.rollback()
    await ac_db.execute(
        delete(AgentCommand).where(AgentCommand.organization_id.in_([org_a, org_b]))
    )
    await ac_db.execute(delete(Organization).where(Organization.id.in_([org_a, org_b])))
    await ac_db.execute(delete(User).where(User.id.in_([user_a, user_b])))
    await ac_db.commit()


@pytest.fixture
def service() -> AgentCommandService:
    return AgentCommandService()


async def _versions(db: AsyncSession, command_id: UUID) -> list[AgentCommandVersion]:
    result = await db.execute(
        select(AgentCommandVersion)
        .where(AgentCommandVersion.agent_command_id == command_id)
        .order_by(AgentCommandVersion.version_number.asc())
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# The version chain
# ---------------------------------------------------------------------------


class TestVersionChain:
    @pytest.mark.asyncio
    async def test_first_upsert_writes_version_one(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        created = await service.upsert_command(
            ac_db,
            accounts.org_a,
            AgentCommandCreate(name=COMMAND_NAME, body="# v1"),
            accounts.user_a,
        )

        assert created.current_version == 1
        assert created.checksum == compute_body_checksum("# v1")

        chain = await _versions(ac_db, UUID(created.id))
        assert [v.version_number for v in chain] == [1]
        assert chain[0].body == "# v1"
        assert chain[0].restored_from is None

    @pytest.mark.asyncio
    async def test_appends_are_monotonic_and_keep_history(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        for body in ("# v1", "# v2", "# v3"):
            head = await service.upsert_command(
                ac_db,
                accounts.org_a,
                AgentCommandCreate(name=COMMAND_NAME, body=body),
                accounts.user_a,
            )

        assert head.current_version == 3
        assert head.body == "# v3"

        chain = await _versions(ac_db, UUID(head.id))
        assert [v.version_number for v in chain] == [1, 2, 3]
        # Append-only: the earlier bodies are still exactly what was written.
        assert [v.body for v in chain] == ["# v1", "# v2", "# v3"]

    @pytest.mark.asyncio
    async def test_revert_appends_a_new_head_and_mutates_nothing(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        for body in ("# v1", "# v2"):
            await service.upsert_command(
                ac_db,
                accounts.org_a,
                AgentCommandCreate(name=COMMAND_NAME, body=body),
                accounts.user_a,
            )

        reverted = await service.revert_to_version(
            ac_db, accounts.org_a, COMMAND_NAME, 1, accounts.user_a
        )

        # A NEW head, not a rewind of the counter.
        assert reverted.current_version == 3
        assert reverted.body == "# v1"

        chain = await _versions(ac_db, UUID(reverted.id))
        assert [v.version_number for v in chain] == [1, 2, 3]
        assert [v.body for v in chain] == ["# v1", "# v2", "# v1"]
        # History untouched behind the new head.
        assert chain[0].restored_from is None
        assert chain[1].restored_from is None
        assert chain[2].restored_from == 1
        assert chain[2].change_description == "Restored from version 1"

    @pytest.mark.asyncio
    async def test_duplicate_version_number_is_rejected_by_the_constraint(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        """Two concurrent appends read the same latest number — the DB stops it.

        This is the gate that makes "monotonic" a property of the schema rather
        than of the service's arithmetic. Simulated the way a race lands: a
        second row carrying a ``version_number`` that already exists.
        """
        created = await service.upsert_command(
            ac_db,
            accounts.org_a,
            AgentCommandCreate(name=COMMAND_NAME, body="# v1"),
            accounts.user_a,
        )

        duplicate = AgentCommandVersion(
            agent_command_id=UUID(created.id),
            version_number=1,  # the number the first append already took
            body="# racing writer",
            checksum=compute_body_checksum("# racing writer"),
            created_by_user_id=accounts.user_a,
        )
        nested = await ac_db.begin_nested()
        ac_db.add(duplicate)
        with pytest.raises(IntegrityError):
            await ac_db.flush()
        await nested.rollback()

        chain = await _versions(ac_db, UUID(created.id))
        assert [v.version_number for v in chain] == [1]
        assert chain[0].body == "# v1"

    @pytest.mark.asyncio
    async def test_list_versions_is_newest_first(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        for body in ("# v1", "# v2"):
            await service.upsert_command(
                ac_db,
                accounts.org_a,
                AgentCommandCreate(name=COMMAND_NAME, body=body),
                accounts.user_a,
            )

        listing = await service.list_versions(ac_db, accounts.org_a, COMMAND_NAME)
        assert listing.pagination.total == 2
        assert [v.version_number for v in listing.items] == [2, 1]


# ---------------------------------------------------------------------------
# Org isolation
# ---------------------------------------------------------------------------


class TestOrgIsolation:
    @pytest.mark.asyncio
    async def test_another_orgs_override_is_invisible(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        await service.upsert_command(
            ac_db,
            accounts.org_a,
            AgentCommandCreate(name=COMMAND_NAME, body="# org A only"),
            accounts.user_a,
        )

        assert (await service.list_commands(ac_db, accounts.org_b)).items == []

        with pytest.raises(ValueError):
            await service.get_command(ac_db, accounts.org_b, COMMAND_NAME)
        with pytest.raises(ValueError):
            await service.list_versions(ac_db, accounts.org_b, COMMAND_NAME)
        with pytest.raises(ValueError):
            await service.revert_to_version(
                ac_db, accounts.org_b, COMMAND_NAME, 1, accounts.user_b
            )
        assert (
            await service.delete_override(ac_db, accounts.org_b, COMMAND_NAME)
        ) is False

        # Org A still holds its own override untouched.
        still_there = await service.get_command(ac_db, accounts.org_a, COMMAND_NAME)
        assert still_there.body == "# org A only"

    @pytest.mark.asyncio
    async def test_same_command_name_may_exist_in_two_orgs(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        """`(organization_id, name)` — NOT a global unique name like Skill.slug."""
        await service.upsert_command(
            ac_db,
            accounts.org_a,
            AgentCommandCreate(name=COMMAND_NAME, body="# A"),
            accounts.user_a,
        )
        await service.upsert_command(
            ac_db,
            accounts.org_b,
            AgentCommandCreate(name=COMMAND_NAME, body="# B"),
            accounts.user_b,
        )

        assert (
            await service.get_command(ac_db, accounts.org_a, COMMAND_NAME)
        ).body == ("# A")
        assert (
            await service.get_command(ac_db, accounts.org_b, COMMAND_NAME)
        ).body == ("# B")


# ---------------------------------------------------------------------------
# Delete-override
# ---------------------------------------------------------------------------


class TestDeleteOverride:
    @pytest.mark.asyncio
    async def test_delete_removes_the_override_and_its_versions(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        for body in ("# v1", "# v2"):
            created = await service.upsert_command(
                ac_db,
                accounts.org_a,
                AgentCommandCreate(name=COMMAND_NAME, body=body),
                accounts.user_a,
            )
        command_id = UUID(created.id)
        assert len(await _versions(ac_db, command_id)) == 2

        assert (
            await service.delete_override(ac_db, accounts.org_a, COMMAND_NAME)
        ) is True

        remaining = await ac_db.execute(
            select(func.count())
            .select_from(AgentCommandVersion)
            .where(AgentCommandVersion.agent_command_id == command_id)
        )
        assert remaining.scalar() == 0
        with pytest.raises(ValueError):
            await service.get_command(ac_db, accounts.org_a, COMMAND_NAME)

    @pytest.mark.asyncio
    async def test_delete_is_idempotent_and_re_creatable(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentCommandService
    ) -> None:
        """Deleting only removes the customization — the default is not a row.

        Re-creating afterwards therefore starts a FRESH chain at version 1
        rather than resuming the deleted one.
        """
        await service.upsert_command(
            ac_db,
            accounts.org_a,
            AgentCommandCreate(name=COMMAND_NAME, body="# v1"),
            accounts.user_a,
        )
        assert (
            await service.delete_override(ac_db, accounts.org_a, COMMAND_NAME)
        ) is True
        assert (
            await service.delete_override(ac_db, accounts.org_a, COMMAND_NAME)
        ) is False

        recreated = await service.upsert_command(
            ac_db,
            accounts.org_a,
            AgentCommandCreate(name=COMMAND_NAME, body="# fresh"),
            accounts.user_a,
        )
        assert recreated.current_version == 1
        assert [
            v.version_number for v in await _versions(ac_db, UUID(recreated.id))
        ] == [1]


# ---------------------------------------------------------------------------
# Checksum conformance
# ---------------------------------------------------------------------------


def test_checksum_matches_the_canonical_cross_surface_definition() -> None:
    """``compute_body_checksum`` must equal ``agent_command_checksum`` in
    ``qontinui-schemas/rust/src/agent_commands.rs``.

    Three surfaces write this field (this service, the runner, the frontend).
    The canonical definition exists precisely so they cannot each invent one,
    so pin it here rather than trusting the two implementations to drift
    together. Vector recomputed from the Rust rule: strip CR, sha256 the UTF-8
    bytes, prefix ``sha256-``.
    """
    from app.services.agent_command_service import compute_body_checksum

    assert (
        compute_body_checksum("# vet-plan\r\nline two\r\n")
        == "sha256-d7edd01afb1634bb5ff178f923569f5df7bac8df5aa0cf5d2869cb5c027476b7"
    )


def test_checksum_is_cr_invariant() -> None:
    """A CRLF hop must NOT change the checksum.

    The body crosses Postgres, JSON and a Windows filesystem before any two
    checksums are compared. If line endings moved the digest, an unchanged
    command would report as changed — the only thing this field exists to
    detect. This is why the digest is taken over CR-stripped content and not
    over the raw bytes.
    """
    from app.services.agent_command_service import compute_body_checksum

    assert compute_body_checksum("a\r\nb\r\n") == compute_body_checksum("a\nb\n")


def test_checksum_carries_the_algorithm_prefix() -> None:
    """The ``sha256-`` prefix names the algorithm inline, so a future change is
    distinguishable rather than silently reinterpreted."""
    from app.services.agent_command_service import compute_body_checksum

    digest = compute_body_checksum("# body")
    assert digest.startswith("sha256-")
    assert len(digest) == len("sha256-") + 64
