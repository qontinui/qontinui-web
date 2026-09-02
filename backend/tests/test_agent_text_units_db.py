"""DB-backed tests for the agent text-unit corpus.

Runs against the shared test PostgreSQL through the session-scoped
``test_engine`` fixture in ``tests/conftest.py`` (which builds every table from
``Base.metadata``), with its own ``async_sessionmaker`` so the service's
``commit()`` calls behave exactly as they do in the app. Rows created here are
deleted in fixture teardown.

Carries forward the four gates the agent-command original covered — append-only
monotonic chain, revert-writes-a-new-head, the DB constraint that makes
"monotonic" true under concurrency, org isolation + delete-is-reset — and adds
the four this phase introduces:

* the **partial unique index pair** actually constrains BOTH layers, including
  the ``organization_id IS NULL`` fleet layer a plain three-column UNIQUE would
  leave wide open;
* ``account override -> fleet default`` resolution;
* ``files`` map write-boundary validation (traversal, caps, blank files);
* the canonical ``files``-map checksum, extending the ``#919`` single-body
  conformance vectors rather than replacing them.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.agent_text_unit import (
    KIND_COMMAND,
    KIND_SKILL,
    AgentTextUnit,
    AgentTextUnitVersion,
    entrypoint_path,
)
from app.models.organization import Organization
from app.models.user import User
from app.services.agent_text_unit_service import (
    MAX_FILE_BYTES,
    MAX_FILES_PER_UNIT,
    MAX_NAMES_PER_QUERY,
    AgentTextUnitCreate,
    AgentTextUnitService,
    AgentTextUnitUpdate,
    AgentTextUnitValidationError,
    compute_body_checksum,
    compute_files_checksum,
    validate_files,
    validate_relative_path,
    validate_unit_name,
)

UNIT_NAME = "vet-plan"
UNIT_FILE = f"{UNIT_NAME}.md"


def _files(body: str, name: str = UNIT_NAME) -> dict[str, str]:
    return {f"{name}.md": body}


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
            email=f"agentunit_{uuid4()}@example.com",
            username=f"agentunit_{uuid4().hex[:8]}",
            full_name="Agent Text Unit Test User",
            is_active=True,
            is_verified=True,
        )
        ac_db.add(user)
        await ac_db.flush()

        org = Organization(
            name=f"agentunit-org-{uuid4().hex[:8]}",
            slug=f"agentunit-org-{uuid4().hex[:8]}",
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
    # Fleet-default rows (organization_id IS NULL) have no owning org, so the
    # org filter alone would leak them into the next test.
    await ac_db.execute(
        delete(AgentTextUnit).where(
            or_(
                AgentTextUnit.organization_id.in_([org_a, org_b]),
                AgentTextUnit.organization_id.is_(None),
            )
        )
    )
    await ac_db.execute(delete(Organization).where(Organization.id.in_([org_a, org_b])))
    await ac_db.execute(delete(User).where(User.id.in_([user_a, user_b])))
    await ac_db.commit()


@pytest.fixture
def service() -> AgentTextUnitService:
    return AgentTextUnitService()


async def _versions(db: AsyncSession, unit_id: UUID) -> list[AgentTextUnitVersion]:
    result = await db.execute(
        select(AgentTextUnitVersion)
        .where(AgentTextUnitVersion.agent_text_unit_id == unit_id)
        .order_by(AgentTextUnitVersion.version_number.asc())
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# The version chain
# ---------------------------------------------------------------------------


class TestVersionChain:
    @pytest.mark.asyncio
    async def test_first_upsert_writes_version_one(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        created = await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# v1")),
            accounts.user_a,
        )

        assert created.current_version == 1
        assert created.kind == KIND_COMMAND
        assert created.entrypoint == UNIT_FILE
        assert created.source == "user"
        assert created.checksum == compute_files_checksum(_files("# v1"))

        chain = await _versions(ac_db, UUID(created.id))
        assert [v.version_number for v in chain] == [1]
        assert chain[0].files == _files("# v1")
        assert chain[0].restored_from is None

    @pytest.mark.asyncio
    async def test_appends_are_monotonic_and_keep_history(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        for body in ("# v1", "# v2", "# v3"):
            head = await service.upsert_unit(
                ac_db,
                accounts.org_a,
                AgentTextUnitCreate(name=UNIT_NAME, files=_files(body)),
                accounts.user_a,
            )

        assert head.current_version == 3
        assert head.files == _files("# v3")

        chain = await _versions(ac_db, UUID(head.id))
        assert [v.version_number for v in chain] == [1, 2, 3]
        # Append-only: the earlier maps are still exactly what was written.
        assert [v.files for v in chain] == [_files(b) for b in ("# v1", "# v2", "# v3")]

    @pytest.mark.asyncio
    async def test_revert_appends_a_new_head_and_mutates_nothing(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        for body in ("# v1", "# v2"):
            await service.upsert_unit(
                ac_db,
                accounts.org_a,
                AgentTextUnitCreate(name=UNIT_NAME, files=_files(body)),
                accounts.user_a,
            )

        reverted = await service.revert_to_version(
            ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME, 1, accounts.user_a
        )

        # A NEW head, not a rewind of the counter.
        assert reverted.current_version == 3
        assert reverted.files == _files("# v1")

        chain = await _versions(ac_db, UUID(reverted.id))
        assert [v.version_number for v in chain] == [1, 2, 3]
        assert [v.files for v in chain] == [_files(b) for b in ("# v1", "# v2", "# v1")]
        # History untouched behind the new head.
        assert chain[0].restored_from is None
        assert chain[1].restored_from is None
        assert chain[2].restored_from == 1
        assert chain[2].change_description == "Restored from version 1"

    @pytest.mark.asyncio
    async def test_duplicate_version_number_is_rejected_by_the_constraint(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """Two concurrent appends read the same latest number — the DB stops it.

        This is the gate that makes "monotonic" a property of the schema rather
        than of the service's arithmetic. Simulated the way a race lands: a
        second row carrying a ``version_number`` that already exists.
        """
        created = await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# v1")),
            accounts.user_a,
        )

        duplicate = AgentTextUnitVersion(
            agent_text_unit_id=UUID(created.id),
            version_number=1,  # the number the first append already took
            files=_files("# racing writer"),
            checksum=compute_files_checksum(_files("# racing writer")),
            created_by_user_id=accounts.user_a,
        )
        nested = await ac_db.begin_nested()
        ac_db.add(duplicate)
        with pytest.raises(IntegrityError):
            await ac_db.flush()
        await nested.rollback()

        chain = await _versions(ac_db, UUID(created.id))
        assert [v.version_number for v in chain] == [1]
        assert chain[0].files == _files("# v1")

    @pytest.mark.asyncio
    async def test_list_versions_is_newest_first(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        for body in ("# v1", "# v2"):
            await service.upsert_unit(
                ac_db,
                accounts.org_a,
                AgentTextUnitCreate(name=UNIT_NAME, files=_files(body)),
                accounts.user_a,
            )

        listing = await service.list_versions(
            ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME
        )
        assert listing.pagination.total == 2
        assert [v.version_number for v in listing.items] == [2, 1]


# ---------------------------------------------------------------------------
# kind discrimination
# ---------------------------------------------------------------------------


class TestKindDiscrimination:
    @pytest.mark.asyncio
    async def test_a_command_and_a_skill_may_share_a_name(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """The key is ``(layer, kind, name)`` — this is exactly the collision
        Design decision 1's option C could not express."""
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(
                kind=KIND_COMMAND, name="preflight", files=_files("# cmd", "preflight")
            ),
            accounts.user_a,
        )
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(
                kind=KIND_SKILL,
                name="preflight",
                files={"SKILL.md": "# skill", "run.sh": "echo hi"},
            ),
            accounts.user_a,
        )

        command = await service.get_unit(
            ac_db, accounts.org_a, KIND_COMMAND, "preflight"
        )
        skill = await service.get_unit(ac_db, accounts.org_a, KIND_SKILL, "preflight")
        assert command.files == {"preflight.md": "# cmd"}
        assert command.entrypoint == "preflight.md"
        assert skill.files == {"SKILL.md": "# skill", "run.sh": "echo hi"}
        assert skill.entrypoint == "SKILL.md"

    @pytest.mark.asyncio
    async def test_list_filters_by_kind(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name="a-command", files=_files("# c", "a-command")),
            accounts.user_a,
        )
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(
                kind=KIND_SKILL, name="a-skill", files={"SKILL.md": "# s"}
            ),
            accounts.user_a,
        )

        commands = await service.list_units(ac_db, accounts.org_a, kind=KIND_COMMAND)
        skills = await service.list_units(ac_db, accounts.org_a, kind=KIND_SKILL)
        every = await service.list_units(ac_db, accounts.org_a)

        assert [u.name for u in commands.items] == ["a-command"]
        assert [u.name for u in skills.items] == ["a-skill"]
        assert sorted(u.name for u in every.items) == ["a-command", "a-skill"]


# ---------------------------------------------------------------------------
# The two layers and the partial unique index PAIR
# ---------------------------------------------------------------------------


class TestTwoLayers:
    @pytest.mark.asyncio
    async def test_fleet_default_layer_is_actually_unique(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """The hazard this phase exists to close.

        ``organization_id`` is NULLABLE, and Postgres does not collide NULLs in
        a plain UNIQUE — so a three-column ``UNIQUE (organization_id, kind,
        name)`` would let N fleet defaults share one ``(kind, name)``. The
        partial index ``UNIQUE (kind, name) WHERE organization_id IS NULL`` is
        what makes "the fleet default" name exactly one row.
        """
        await service.upsert_unit(
            ac_db,
            None,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# fleet")),
            None,
        )

        second = AgentTextUnit(
            organization_id=None,
            kind=KIND_COMMAND,
            name=UNIT_NAME,
            files=_files("# a second fleet default"),
            current_version=1,
        )
        nested = await ac_db.begin_nested()
        ac_db.add(second)
        with pytest.raises(IntegrityError):
            await ac_db.flush()
        await nested.rollback()

    @pytest.mark.asyncio
    async def test_account_layer_is_unique_per_kind_and_name(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# a")),
            accounts.user_a,
        )

        second = AgentTextUnit(
            organization_id=accounts.org_a,
            kind=KIND_COMMAND,
            name=UNIT_NAME,
            files=_files("# a duplicate override"),
            current_version=1,
        )
        nested = await ac_db.begin_nested()
        ac_db.add(second)
        with pytest.raises(IntegrityError):
            await ac_db.flush()
        await nested.rollback()

    @pytest.mark.asyncio
    async def test_a_fleet_default_and_an_account_override_coexist(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        await service.upsert_unit(
            ac_db,
            None,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# fleet")),
            None,
        )
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# mine")),
            accounts.user_a,
        )

        # Org A sees its own; org B, which has no override, inherits the fleet's.
        mine = await service.get_unit(ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME)
        theirs = await service.get_unit(ac_db, accounts.org_b, KIND_COMMAND, UNIT_NAME)
        assert (mine.files, mine.source) == (_files("# mine"), "user")
        assert (theirs.files, theirs.source) == (_files("# fleet"), "fleet")

    @pytest.mark.asyncio
    async def test_resolved_list_shadows_fleet_defaults_by_kind_and_name(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        for name in ("shared-unit", "fleet-only"):
            await service.upsert_unit(
                ac_db,
                None,
                AgentTextUnitCreate(name=name, files=_files("# fleet", name)),
                None,
            )
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(
                name="shared-unit", files=_files("# mine", "shared-unit")
            ),
            accounts.user_a,
        )

        resolved = await service.list_units(ac_db, accounts.org_a)
        by_name = {u.name: u for u in resolved.items}
        assert set(by_name) == {"shared-unit", "fleet-only"}
        assert by_name["shared-unit"].source == "user"
        assert by_name["shared-unit"].files == _files("# mine", "shared-unit")
        assert by_name["fleet-only"].source == "fleet"
        assert resolved.pagination.total == 2

        # Opting out gives the account's own rows only.
        own = await service.list_units(
            ac_db, accounts.org_a, include_fleet_defaults=False
        )
        assert [u.name for u in own.items] == ["shared-unit"]

    @pytest.mark.asyncio
    async def test_history_and_delete_never_reach_the_fleet_layer(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """An account may READ a fleet default but must not revert or delete it."""
        await service.upsert_unit(
            ac_db,
            None,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# fleet")),
            None,
        )

        with pytest.raises(ValueError):
            await service.list_versions(ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME)
        with pytest.raises(ValueError):
            await service.revert_to_version(
                ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME, 1, accounts.user_a
            )
        assert (
            await service.delete_override(
                ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME
            )
        ) is False

        # Still there, untouched.
        fleet = await service.get_unit(ac_db, None, KIND_COMMAND, UNIT_NAME)
        assert fleet.files == _files("# fleet")


# ---------------------------------------------------------------------------
# Org isolation
# ---------------------------------------------------------------------------


class TestOrgIsolation:
    @pytest.mark.asyncio
    async def test_another_orgs_override_is_invisible(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# org A only")),
            accounts.user_a,
        )

        assert (await service.list_units(ac_db, accounts.org_b)).items == []

        with pytest.raises(ValueError):
            await service.get_unit(ac_db, accounts.org_b, KIND_COMMAND, UNIT_NAME)
        with pytest.raises(ValueError):
            await service.list_versions(ac_db, accounts.org_b, KIND_COMMAND, UNIT_NAME)
        with pytest.raises(ValueError):
            await service.revert_to_version(
                ac_db, accounts.org_b, KIND_COMMAND, UNIT_NAME, 1, accounts.user_b
            )
        assert (
            await service.delete_override(
                ac_db, accounts.org_b, KIND_COMMAND, UNIT_NAME
            )
        ) is False

        # Org A still holds its own override untouched.
        still_there = await service.get_unit(
            ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME
        )
        assert still_there.files == _files("# org A only")

    @pytest.mark.asyncio
    async def test_same_unit_name_may_exist_in_two_orgs(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """`(organization_id, kind, name)` — NOT a global unique name."""
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# A")),
            accounts.user_a,
        )
        await service.upsert_unit(
            ac_db,
            accounts.org_b,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# B")),
            accounts.user_b,
        )

        a = await service.get_unit(ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME)
        b = await service.get_unit(ac_db, accounts.org_b, KIND_COMMAND, UNIT_NAME)
        assert a.files == _files("# A")
        assert b.files == _files("# B")


# ---------------------------------------------------------------------------
# Delete-override
# ---------------------------------------------------------------------------


class TestDeleteOverride:
    @pytest.mark.asyncio
    async def test_delete_removes_the_unit_and_its_versions(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        for body in ("# v1", "# v2"):
            created = await service.upsert_unit(
                ac_db,
                accounts.org_a,
                AgentTextUnitCreate(name=UNIT_NAME, files=_files(body)),
                accounts.user_a,
            )
        unit_id = UUID(created.id)
        assert len(await _versions(ac_db, unit_id)) == 2

        assert (
            await service.delete_override(
                ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME
            )
        ) is True

        remaining = await ac_db.execute(
            select(func.count())
            .select_from(AgentTextUnitVersion)
            .where(AgentTextUnitVersion.agent_text_unit_id == unit_id)
        )
        assert remaining.scalar() == 0
        with pytest.raises(ValueError):
            await service.get_unit(ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME)

    @pytest.mark.asyncio
    async def test_delete_is_idempotent_and_re_creatable(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """Deleting only removes this layer — the next one down is not a row here.

        Re-creating afterwards therefore starts a FRESH chain at version 1
        rather than resuming the deleted one.
        """
        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# v1")),
            accounts.user_a,
        )
        assert (
            await service.delete_override(
                ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME
            )
        ) is True
        assert (
            await service.delete_override(
                ac_db, accounts.org_a, KIND_COMMAND, UNIT_NAME
            )
        ) is False

        recreated = await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(name=UNIT_NAME, files=_files("# fresh")),
            accounts.user_a,
        )
        assert recreated.current_version == 1
        assert [
            v.version_number for v in await _versions(ac_db, UUID(recreated.id))
        ] == [1]


# ---------------------------------------------------------------------------
# Copy-source specs: carried, never invocable
# ---------------------------------------------------------------------------


class TestCopySourceSpecs:
    @pytest.mark.asyncio
    async def test_underscore_unit_is_stored_but_not_invocable(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """``_gate-registration`` and ``_loop-control`` MUST be carried — other
        units paste from them — and must never be offered as ``/_...``."""
        stored = await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(
                name="_gate-registration",
                files=_files("# canonical spec", "_gate-registration"),
                is_invocable=False,
            ),
            accounts.user_a,
        )
        assert stored.name == "_gate-registration"
        assert stored.is_invocable is False
        assert stored.files == {"_gate-registration.md": "# canonical spec"}

    @pytest.mark.asyncio
    async def test_underscore_unit_cannot_be_marked_invocable(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        with pytest.raises(AgentTextUnitValidationError):
            await service.upsert_unit(
                ac_db,
                accounts.org_a,
                AgentTextUnitCreate(
                    name="_loop-control",
                    files=_files("# rubric", "_loop-control"),
                    is_invocable=True,
                ),
                accounts.user_a,
            )

        await service.upsert_unit(
            ac_db,
            accounts.org_a,
            AgentTextUnitCreate(
                name="_loop-control",
                files=_files("# rubric", "_loop-control"),
                is_invocable=False,
            ),
            accounts.user_a,
        )
        with pytest.raises(AgentTextUnitValidationError):
            await service.update_unit(
                ac_db,
                accounts.org_a,
                KIND_COMMAND,
                "_loop-control",
                AgentTextUnitUpdate(is_invocable=True),
                accounts.user_a,
            )

    @pytest.mark.asyncio
    async def test_the_database_itself_refuses_an_invocable_underscore_unit(
        self, ac_db: AsyncSession, accounts: _Accounts
    ) -> None:
        """The service rule above is application code; this is the CHECK that
        makes it true for every writer, including a seeding script."""
        row = AgentTextUnit(
            organization_id=accounts.org_a,
            kind=KIND_COMMAND,
            name="_gate-registration",
            files={"_gate-registration.md": "# spec"},
            is_invocable=True,
            current_version=1,
        )
        nested = await ac_db.begin_nested()
        ac_db.add(row)
        with pytest.raises(IntegrityError):
            await ac_db.flush()
        await nested.rollback()


# ---------------------------------------------------------------------------
# Write-boundary validation
# ---------------------------------------------------------------------------


class TestPathValidation:
    @pytest.mark.parametrize(
        "path",
        [
            "../escape.md",
            "a/../../escape.md",
            "./relative.md",
            "/absolute.md",
            "C:/windows.md",
            "c:relative-drive.md",
            "back\\slash.md",
            "..\\escape.md",
            "trailing/",
            "double//segment.md",
            " leading-space.md",
            "space-at-end.md ",
            "ends-with-dot.",
            "nul.md",
            "sub/CON.txt",
            "with\x00nul.md",
            "with\nnewline.md",
            "",
        ],
    )
    def test_traversal_and_unsafe_paths_are_refused(self, path: str) -> None:
        with pytest.raises(AgentTextUnitValidationError):
            validate_relative_path(path)

    @pytest.mark.parametrize(
        "path",
        ["SKILL.md", "coord-revive.sh", "sub/dir/file.md", "a.b.c", "réf.md"],
    )
    def test_ordinary_relative_paths_are_accepted(self, path: str) -> None:
        validate_relative_path(path)

    def test_a_traversal_path_cannot_be_written_through_the_service(self) -> None:
        """The store refuses it, not just the provisioner that later writes it —
        a corpus that accepts a traversal path is itself the defect."""
        with pytest.raises(AgentTextUnitValidationError):
            validate_files(KIND_SKILL, "evil", {"SKILL.md": "ok", "../out.sh": "boom"})

    def test_size_and_count_caps(self) -> None:
        with pytest.raises(AgentTextUnitValidationError):
            validate_files(
                KIND_COMMAND, UNIT_NAME, {UNIT_FILE: "x" * (MAX_FILE_BYTES + 1)}
            )
        too_many = {UNIT_FILE: "ok"}
        too_many.update({f"f{i}.md": "ok" for i in range(MAX_FILES_PER_UNIT)})
        with pytest.raises(AgentTextUnitValidationError):
            validate_files(KIND_COMMAND, UNIT_NAME, too_many)

    def test_blank_and_empty_are_refused(self) -> None:
        with pytest.raises(AgentTextUnitValidationError):
            validate_files(KIND_COMMAND, UNIT_NAME, {})
        with pytest.raises(AgentTextUnitValidationError):
            validate_files(KIND_COMMAND, UNIT_NAME, {UNIT_FILE: "   \n  "})

    def test_the_entrypoint_must_be_present(self) -> None:
        """A skill with no ``SKILL.md`` is not a skill; a command whose one file
        is not ``<name>.md`` cannot be provisioned by name."""
        with pytest.raises(AgentTextUnitValidationError):
            validate_files(KIND_SKILL, "coord-revive", {"coord-revive.sh": "echo"})
        with pytest.raises(AgentTextUnitValidationError):
            validate_files(KIND_COMMAND, UNIT_NAME, {"other.md": "body"})

    @pytest.mark.parametrize(
        "name", ["", "Upper", "has space", "-leading", "con", "__double", "a" * 65]
    )
    def test_bad_unit_names_are_refused(self, name: str) -> None:
        with pytest.raises(AgentTextUnitValidationError):
            validate_unit_name(name)

    @pytest.mark.parametrize(
        "name",
        [
            "vet-plan",
            "policy",
            "_gate-registration",
            "_loop-control",
            "a1",
            # A trailing hyphen is ugly but LEGAL — the canonical Rust
            # `validate_agent_command_name` accepts it, and this rule exists to
            # match that one, not to be independently stricter.
            "trailing-",
        ],
    )
    def test_good_unit_names_are_accepted(self, name: str) -> None:
        validate_unit_name(name)


# ---------------------------------------------------------------------------
# Checksum conformance
# ---------------------------------------------------------------------------


def test_checksum_matches_the_canonical_cross_surface_definition() -> None:
    """``compute_body_checksum`` must equal ``agent_command_checksum`` in
    ``qontinui-schemas/rust/src/agent_commands.rs``.

    It survives the text-unit cutover because the legacy
    ``/api/v1/agent-commands`` wire does — a not-yet-rebuilt runner reads that
    field. Vector recomputed from the Rust rule: strip CR, sha256 the UTF-8
    bytes, prefix ``sha256-``.
    """
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
    assert compute_body_checksum("a\r\nb\r\n") == compute_body_checksum("a\nb\n")


def test_checksum_carries_the_algorithm_prefix() -> None:
    """The ``sha256-`` prefix names the algorithm inline, so a future change is
    distinguishable rather than silently reinterpreted."""
    digest = compute_body_checksum("# body")
    assert digest.startswith("sha256-")
    assert len(digest) == len("sha256-") + 64


class TestFilesChecksum:
    """``agent-text-unit-files/v1`` — the canonical digest over a ``files`` map.

    A map has no inherent key order. Without a DEFINED canonicalization the
    digest is nondeterministic across writers and Phase 5's idempotent
    re-import writes a spurious version bump on every run. These are the
    vectors a Rust ``agent_text_unit_files_checksum`` must reproduce.
    """

    def test_key_order_does_not_move_the_digest(self) -> None:
        a = {"SKILL.md": "one", "run.sh": "two", "z/deep.md": "three"}
        b = {"z/deep.md": "three", "run.sh": "two", "SKILL.md": "one"}
        assert compute_files_checksum(a) == compute_files_checksum(b)

    def test_it_is_cr_invariant_like_the_body_digest(self) -> None:
        assert compute_files_checksum({"a.md": "x\r\ny\r\n"}) == compute_files_checksum(
            {"a.md": "x\ny\n"}
        )

    def test_length_framing_makes_the_encoding_injective(self) -> None:
        """The property a naive ``"\\n".join(...)`` does not have: no two
        distinct maps may collide, however the separators fall inside the
        content."""
        assert compute_files_checksum({"ab.md": "x"}) != compute_files_checksum(
            {"a.md": "", "b.md": "x"}
        )
        assert compute_files_checksum({"a.md": "1\n2"}) != compute_files_checksum(
            {"a.md": "1", "2": "a.md"}
        )

    def test_the_path_is_part_of_the_digest(self) -> None:
        assert compute_files_checksum({"a.md": "same"}) != compute_files_checksum(
            {"b.md": "same"}
        )

    def test_it_does_not_reduce_to_the_body_digest(self) -> None:
        """Deliberate: a one-entry map still carries its path, so it cannot
        equal a digest taken over the body alone."""
        assert compute_files_checksum({"a.md": "body"}) != compute_body_checksum("body")

    def test_pinned_vector(self) -> None:
        """Hand-computed from the five documented steps — the fixture a second
        implementation is reconciled against.

        Stream for ``{"SKILL.md": "hi\\n", "run.sh": "x"}`` (keys sorted by raw
        UTF-8 bytes: ``SKILL.md`` < ``run.sh`` because ``S`` (0x53) < ``r``
        (0x72))::

            b"8\\nSKILL.md3\\nhi\\n6\\nrun.sh1\\nx"
        """
        stream = b"8\nSKILL.md3\nhi\n6\nrun.sh1\nx"
        expected = f"sha256-{hashlib.sha256(stream).hexdigest()}"
        assert compute_files_checksum({"SKILL.md": "hi\n", "run.sh": "x"}) == expected

    def test_sorting_is_by_raw_utf8_bytes_not_by_case_folding(self) -> None:
        """``S`` (0x53) sorts before ``r`` (0x72); a case-insensitive or
        locale collation would order these the other way and produce a
        different digest."""
        stream = b"1\nS1\na1\nr1\nb"
        expected = f"sha256-{hashlib.sha256(stream).hexdigest()}"
        assert compute_files_checksum({"r": "b", "S": "a"}) == expected


# ---------------------------------------------------------------------------
# The metadata projection — `list_unit_index`
# ---------------------------------------------------------------------------


async def _seed_mixed_corpus(
    db: AsyncSession, service: AgentTextUnitService, accounts: _Accounts
) -> None:
    """A corpus that exercises every dimension the two projections share.

    Fleet defaults across both kinds, one of them shadowed by an account
    override, one non-invocable copy-source spec in each layer, and a multi-file
    skill so `file_paths` has more than one entry to report.
    """
    for name in ("shared-unit", "fleet-only"):
        await service.upsert_unit(
            db,
            None,
            AgentTextUnitCreate(name=name, files=_files("# fleet", name)),
            None,
        )
    await service.upsert_unit(
        db,
        None,
        AgentTextUnitCreate(
            name="_gate-registration",
            files=_files("# spec", "_gate-registration"),
            is_invocable=False,
        ),
        None,
    )
    await service.upsert_unit(
        db,
        None,
        AgentTextUnitCreate(
            kind=KIND_SKILL,
            name="coord-revive",
            files={"SKILL.md": "# skill", "coord-revive.sh": "echo hi\n"},
        ),
        None,
    )
    await service.upsert_unit(
        db,
        accounts.org_a,
        AgentTextUnitCreate(name="shared-unit", files=_files("# mine", "shared-unit")),
        accounts.user_a,
    )
    await service.upsert_unit(
        db,
        accounts.org_a,
        AgentTextUnitCreate(
            name="_loop-control",
            files=_files("# spec", "_loop-control"),
            is_invocable=False,
        ),
        accounts.user_a,
    )


#: The three ``_resolved_query`` branches, as (organization_id-selector, kwargs).
#: Named so a failure says WHICH branch disagreed rather than "case 2".
_BRANCHES: list[tuple[str, bool]] = [
    ("fleet-only", False),
    ("account-only", False),
    ("resolved-union", True),
]


class TestMetadataProjection:
    @pytest.mark.asyncio
    async def test_the_index_carries_no_bodies(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """The whole reason the route exists. If a body can reach this response
        the projection has failed and the fetch budget is back where it was."""
        await _seed_mixed_corpus(ac_db, service, accounts)

        index = await service.list_unit_index(ac_db, accounts.org_a)

        assert index.items
        serialized = index.model_dump_json()
        assert "files" not in serialized
        for row in index.items:
            assert not hasattr(row, "files")
        # The bodies seeded above must appear nowhere in the payload.
        for body in ("# fleet", "# mine", "# spec", "# skill", "echo hi"):
            assert body not in serialized

    @pytest.mark.asyncio
    async def test_it_describes_the_files_it_omits(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """Paths, byte count and digest — enough to decide whether to fetch."""
        await _seed_mixed_corpus(ac_db, service, accounts)

        index = await service.list_unit_index(ac_db, None, kind=KIND_SKILL)
        (skill,) = index.items

        assert skill.file_paths == ["SKILL.md", "coord-revive.sh"]
        assert skill.byte_count == len(b"# skill") + len(b"echo hi\n")
        assert skill.entrypoint == "SKILL.md"
        assert skill.checksum == compute_files_checksum(
            {"SKILL.md": "# skill", "coord-revive.sh": "echo hi\n"}
        )

    @pytest.mark.asyncio
    async def test_the_checksum_is_the_one_the_full_listing_serves(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """The index is only usable as a cache key if its digest is the SAME
        digest the bodies it points at hash to."""
        await _seed_mixed_corpus(ac_db, service, accounts)

        full = await service.list_units(ac_db, accounts.org_a)
        index = await service.list_unit_index(ac_db, accounts.org_a)

        full_by_key = {(u.kind, u.name): u for u in full.items}
        for row in index.items:
            unit = full_by_key[(row.kind, row.name)]
            assert row.checksum == unit.checksum
            assert row.checksum == compute_files_checksum(unit.files)
            assert row.file_paths == sorted(unit.files)
            assert row.byte_count == sum(
                len(t.encode("utf-8")) for t in unit.files.values()
            )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("branch", [b[0] for b in _BRANCHES])
    async def test_every_branch_agrees_with_the_full_listing(
        self,
        ac_db: AsyncSession,
        accounts: _Accounts,
        service: AgentTextUnitService,
        branch: str,
    ) -> None:
        """`list_units` has three query branches — fleet-only, account-only and
        the `union_all` resolved view. The index must return the same rows in
        the same order from all three: a client caching off a *disagreeing*
        index would skip a body fetch it needed and serve stale text.
        """
        await _seed_mixed_corpus(ac_db, service, accounts)

        if branch == "fleet-only":
            layer, kwargs = None, {}
        elif branch == "account-only":
            layer, kwargs = accounts.org_a, {"include_fleet_defaults": False}
        else:
            layer, kwargs = accounts.org_a, {"include_fleet_defaults": True}

        full = await service.list_units(ac_db, layer, **kwargs)
        index = await service.list_unit_index(ac_db, layer, **kwargs)

        assert full.items, f"{branch} seeded nothing — the test proves nothing"
        assert [(u.kind, u.name) for u in index.items] == [
            (u.kind, u.name) for u in full.items
        ]
        assert [u.source for u in index.items] == [u.source for u in full.items]
        assert [u.id for u in index.items] == [u.id for u in full.items]
        assert index.pagination == full.pagination

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "filters",
        [
            {},
            {"kind": KIND_COMMAND},
            {"kind": KIND_SKILL},
            {"invocable_only": True},
            {"kind": KIND_COMMAND, "invocable_only": True},
            {"include_fleet_defaults": False},
            {"include_fleet_defaults": False, "invocable_only": True},
            {"names": ["shared-unit", "fleet-only"]},
            {"kind": KIND_COMMAND, "names": ["shared-unit"], "invocable_only": True},
            {"offset": 1, "limit": 2},
            {"kind": KIND_COMMAND, "offset": 1, "limit": 1},
        ],
    )
    async def test_every_filter_composes_identically_on_both_projections(
        self,
        ac_db: AsyncSession,
        accounts: _Accounts,
        service: AgentTextUnitService,
        filters: dict[str, object],
    ) -> None:
        await _seed_mixed_corpus(ac_db, service, accounts)

        full = await service.list_units(ac_db, accounts.org_a, **filters)  # type: ignore[arg-type]
        index = await service.list_unit_index(ac_db, accounts.org_a, **filters)  # type: ignore[arg-type]

        assert [(u.kind, u.name) for u in index.items] == [
            (u.kind, u.name) for u in full.items
        ]
        assert index.pagination == full.pagination

    @pytest.mark.asyncio
    async def test_invocable_only_still_drops_the_copy_source_specs(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """The filter that keeps a `_gate-registration.md` off a provisioning
        client's disk must survive the projection, in both layers of the union.
        """
        await _seed_mixed_corpus(ac_db, service, accounts)

        listed = await service.list_unit_index(ac_db, accounts.org_a)
        provisioned = await service.list_unit_index(
            ac_db, accounts.org_a, invocable_only=True
        )

        assert {"_gate-registration", "_loop-control"} <= {u.name for u in listed.items}
        assert not [u for u in provisioned.items if u.name.startswith("_")]
        assert all(u.is_invocable for u in provisioned.items)


class TestNamesSelector:
    @pytest.mark.asyncio
    async def test_it_fetches_bodies_for_exactly_the_named_units(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """The second half of the two-call exchange: read the index, then pull
        bodies for the units whose digest moved — in ONE request."""
        await _seed_mixed_corpus(ac_db, service, accounts)

        picked = await service.list_units(
            ac_db, accounts.org_a, names=["shared-unit", "coord-revive"]
        )

        assert sorted(u.name for u in picked.items) == ["coord-revive", "shared-unit"]
        assert picked.pagination.total == 2
        # Bodies, not metadata — that is the point of coming back to this route.
        assert picked.items[0].files

    @pytest.mark.asyncio
    async def test_it_respects_the_shadowing_it_selects_through(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """Naming a shadowed unit must return the OVERRIDE, not both rows."""
        await _seed_mixed_corpus(ac_db, service, accounts)

        picked = await service.list_units(ac_db, accounts.org_a, names=["shared-unit"])

        (unit,) = picked.items
        assert unit.source == "user"
        assert unit.files == _files("# mine", "shared-unit")

    @pytest.mark.asyncio
    async def test_an_unknown_name_is_simply_absent(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        await _seed_mixed_corpus(ac_db, service, accounts)

        picked = await service.list_unit_index(
            ac_db, accounts.org_a, names=["fleet-only", "no-such-unit"]
        )

        assert [u.name for u in picked.items] == ["fleet-only"]

    @pytest.mark.asyncio
    async def test_an_empty_selector_selects_nothing(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """`names=[]` is "these zero units", not "no filter" — the alternative
        would hand a client the whole 1.9 MB corpus it was trying to avoid."""
        await _seed_mixed_corpus(ac_db, service, accounts)

        picked = await service.list_units(ac_db, accounts.org_a, names=[])

        assert picked.items == []
        assert picked.pagination.total == 0

    @pytest.mark.asyncio
    async def test_a_malformed_name_is_refused_not_silently_dropped(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        """A short list is indistinguishable from "that unit was deleted", which
        a provisioning client would act on."""
        for projection in (service.list_units, service.list_unit_index):
            with pytest.raises(AgentTextUnitValidationError):
                await projection(ac_db, accounts.org_a, names=["../etc/passwd"])

    @pytest.mark.asyncio
    async def test_the_selector_is_capped(
        self, ac_db: AsyncSession, accounts: _Accounts, service: AgentTextUnitService
    ) -> None:
        too_many = [f"unit-{i}" for i in range(MAX_NAMES_PER_QUERY + 1)]
        with pytest.raises(AgentTextUnitValidationError):
            await service.list_unit_index(ac_db, accounts.org_a, names=too_many)


def test_entrypoint_is_per_kind() -> None:
    assert entrypoint_path(KIND_COMMAND, "vet-plan") == "vet-plan.md"
    assert entrypoint_path(KIND_SKILL, "coord-revive") == "SKILL.md"
    # An unknown kind falls back to the `<name>.md` convention rather than
    # raising — `kind` is widenable, so a new one must not be a hard error here.
    assert entrypoint_path("agent", "code-reviewer") == "code-reviewer.md"
