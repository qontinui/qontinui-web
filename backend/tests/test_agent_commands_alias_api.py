"""``/api/v1/agent-commands`` still works after the text-unit cutover.

The corpus moved to ``project.agent_text_units`` and
``/api/v1/agent-text-units``. **A runner built before that cutover still calls
``GET /api/v1/agent-commands?limit=500``** (``agent_commands/mod.rs``), so the
alias is not a nicety — an unrebuilt machine that stops resolving commands is
the exact silent-degradation failure the plan exists to close.

Phase 2's gate is "old runners still resolve commands — VERIFY, do not assume",
so this drives the real HTTP surface over the real test database rather than
asserting the translation functions in isolation:

* the pre-cutover wire shape (``body``, the legacy single-body ``checksum``,
  ``current_version``, ``source``) round-trips through every one of the seven
  routes;
* a unit written through the NEW API is readable through the OLD one, which is
  the case that actually breaks an unrebuilt runner;
* the list folds in **fleet defaults** — the two-layer model reaching a client
  that knows nothing about it;
* skills are never returned to a command client.

Uses ``httpx.AsyncClient`` + ``ASGITransport`` (NOT ``TestClient``) so the
handler runs in the SAME asyncio loop as the shared async DB session — the
proven pattern in ``test_pair_codes.py`` / ``test_devenv_environments.py``.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import delete, or_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import current_active_user, get_async_db
from app.api.v1.endpoints.agent_commands import router as commands_router
from app.api.v1.endpoints.agent_text_units import router as units_router
from app.models.agent_text_unit import AgentTextUnit
from app.models.organization import Organization
from app.models.user import User
from app.services.agent_text_unit_service import compute_body_checksum

COMMANDS_PREFIX = "/api/v1/agent-commands"
UNITS_PREFIX = "/api/v1/agent-text-units"


@pytest_asyncio.fixture
async def alias_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def account(alias_db: AsyncSession) -> AsyncGenerator[tuple[UUID, UUID], None]:
    """One org + owner, torn down with everything it owns."""
    user = User(
        email=f"alias_{uuid4()}@example.com",
        username=f"alias_{uuid4().hex[:8]}",
        full_name="Alias Test User",
        is_active=True,
        is_verified=True,
    )
    alias_db.add(user)
    await alias_db.flush()
    org = Organization(
        name=f"alias-org-{uuid4().hex[:8]}",
        slug=f"alias-org-{uuid4().hex[:8]}",
        owner_id=user.id,
        settings={},
    )
    alias_db.add(org)
    await alias_db.flush()
    await alias_db.commit()
    # Read the ids out BEFORE yielding: an endpoint under test commits on this
    # same session, which detaches these instances.
    org_id, user_id = org.id, user.id

    yield org_id, user_id

    await alias_db.rollback()
    await alias_db.execute(
        delete(AgentTextUnit).where(
            or_(
                AgentTextUnit.organization_id == org_id,
                AgentTextUnit.organization_id.is_(None),
            )
        )
    )
    await alias_db.execute(delete(Organization).where(Organization.id == org_id))
    await alias_db.execute(delete(User).where(User.id == user_id))
    await alias_db.commit()


@pytest.fixture
def client(alias_db: AsyncSession, account: tuple[UUID, UUID]) -> httpx.AsyncClient:
    """Both routers at their real prefixes, auth overridden, real DB."""
    _, user_id = account
    user = MagicMock()
    user.id = user_id
    user.is_active = True
    user.is_verified = True
    user.is_superuser = False

    app = FastAPI()

    async def _db_override() -> AsyncGenerator[AsyncSession, None]:
        yield alias_db

    app.dependency_overrides[get_async_db] = _db_override
    app.dependency_overrides[current_active_user] = lambda: user
    app.include_router(commands_router, prefix=COMMANDS_PREFIX)
    app.include_router(units_router, prefix=UNITS_PREFIX)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def _org_param(account: tuple[UUID, UUID]) -> dict[str, str]:
    return {"organization_id": str(account[0])}


# The alias resolves the account either from an explicit `organization_id`
# (membership-checked) or from the caller's personal org. The test user has no
# personal-org row, so pass the org explicitly and let the real membership
# check be the thing we stub — not the resolution itself.
def _member() -> object:
    return patch(
        "app.api.v1.endpoints.agent_commands.check_organization_membership",
        new=_always_a_member,
    )


def _units_member() -> object:
    return patch(
        "app.api.v1.endpoints.agent_text_units.check_organization_membership",
        new=_always_a_member,
    )


async def _always_a_member(*_args: object, **_kwargs: object) -> bool:
    return True


class TestLegacyWireShape:
    @pytest.mark.asyncio
    async def test_seven_routes_round_trip_the_pre_cutover_shape(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        params = _org_param(account)
        with _member():
            async with client:
                # POST — create
                created = await client.post(
                    COMMANDS_PREFIX,
                    params=params,
                    json={"name": "vet-plan", "body": "# v1"},
                )
                assert created.status_code == 200, created.text
                payload = created.json()
                assert payload["name"] == "vet-plan"
                assert payload["body"] == "# v1"
                assert payload["current_version"] == 1
                assert payload["source"] == "user"
                # The LEGACY digest, the one an unrebuilt runner's
                # `agent_command_checksum` reproduces.
                assert payload["checksum"] == compute_body_checksum("# v1")

                # GET one
                got = await client.get(f"{COMMANDS_PREFIX}/vet-plan", params=params)
                assert got.status_code == 200
                assert got.json()["body"] == "# v1"

                # GET list — the call the runner actually makes
                listed = await client.get(
                    COMMANDS_PREFIX, params={**params, "limit": 500}
                )
                assert listed.status_code == 200
                items = listed.json()["items"]
                assert [i["name"] for i in items] == ["vet-plan"]
                assert items[0]["body"] == "# v1"

                # PATCH — appends a version
                patched = await client.patch(
                    f"{COMMANDS_PREFIX}/vet-plan", params=params, json={"body": "# v2"}
                )
                assert patched.status_code == 200
                assert patched.json()["current_version"] == 2
                assert patched.json()["body"] == "# v2"

                # GET versions
                versions = await client.get(
                    f"{COMMANDS_PREFIX}/vet-plan/versions", params=params
                )
                assert versions.status_code == 200
                chain = versions.json()["items"]
                assert [v["version_number"] for v in chain] == [2, 1]
                assert [v["body"] for v in chain] == ["# v2", "# v1"]
                assert all("agent_command_id" in v for v in chain)

                # POST revert — a NEW head
                reverted = await client.post(
                    f"{COMMANDS_PREFIX}/vet-plan/revert",
                    params=params,
                    json={"version_number": 1},
                )
                assert reverted.status_code == 200
                assert reverted.json()["current_version"] == 3
                assert reverted.json()["body"] == "# v1"

                # DELETE
                deleted = await client.delete(
                    f"{COMMANDS_PREFIX}/vet-plan", params=params
                )
                assert deleted.status_code == 204
                gone = await client.get(f"{COMMANDS_PREFIX}/vet-plan", params=params)
                assert gone.status_code == 404

    @pytest.mark.asyncio
    async def test_a_unit_written_through_the_new_api_reads_through_the_old(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """The case that actually breaks an unrebuilt runner: the console (or a
        Phase 5 import) writes a text unit, and a pre-cutover runner must still
        see a command."""
        params = _org_param(account)
        with _member(), _units_member():
            async with client:
                written = await client.post(
                    UNITS_PREFIX,
                    params=params,
                    json={
                        "kind": "command",
                        "name": "implement-plan",
                        "files": {"implement-plan.md": "# from the new API"},
                    },
                )
                assert written.status_code == 200, written.text

                legacy = await client.get(
                    f"{COMMANDS_PREFIX}/implement-plan", params=params
                )
                assert legacy.status_code == 200
                assert legacy.json()["body"] == "# from the new API"
                assert legacy.json()["checksum"] == compute_body_checksum(
                    "# from the new API"
                )

    @pytest.mark.asyncio
    async def test_a_skill_is_never_returned_to_a_command_client(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """A pre-cutover runner writes every listed item to
        ``.claude/commands/<name>.md``; handing it a multi-file skill would put
        a skill body at a command path."""
        params = _org_param(account)
        with _member(), _units_member():
            async with client:
                made = await client.post(
                    UNITS_PREFIX,
                    params=params,
                    json={
                        "kind": "skill",
                        "name": "coord-revive",
                        "files": {
                            "SKILL.md": "# revive",
                            "coord-revive.sh": "echo hi",
                        },
                    },
                )
                assert made.status_code == 200, made.text

                listed = await client.get(
                    COMMANDS_PREFIX, params={**params, "limit": 500}
                )
                assert listed.status_code == 200
                assert listed.json()["items"] == []

                # …but it IS there on the real API.
                units = await client.get(
                    UNITS_PREFIX, params={**params, "kind": "skill"}
                )
                assert [u["name"] for u in units.json()["items"]] == ["coord-revive"]

    @pytest.mark.asyncio
    async def test_a_non_invocable_spec_is_never_returned_to_a_command_client(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """The underscore-prefixed copy-source specs (``_gate-registration``,
        ``_loop-control``) are real corpus members, but they are NOT slash
        commands.

        The legacy wire shape has no ``is_invocable`` field, and its consumer
        writes every listed item to ``.claude/commands/<name>.md`` — where a
        ``_gate-registration.md`` becomes an invocable ``/_gate-registration``
        on a device that cannot be told otherwise. So the alias filters
        server-side; that is the only layer that can. The spec must still be
        readable through the current API, or the console could not edit it.
        """
        params = _org_param(account)
        with _member(), _units_member():
            async with client:
                made = await client.post(
                    UNITS_PREFIX,
                    params=params,
                    json={
                        "kind": "command",
                        "name": "_gate-registration",
                        "files": {"_gate-registration.md": "# canonical spec"},
                        "is_invocable": False,
                    },
                )
                assert made.status_code == 200, made.text
                assert made.json()["is_invocable"] is False

                # An ordinary command alongside it, to prove the filter is
                # selective rather than emptying the list.
                ok = await client.post(
                    UNITS_PREFIX,
                    params=params,
                    json={
                        "kind": "command",
                        "name": "vet-plan",
                        "files": {"vet-plan.md": "# vet"},
                    },
                )
                assert ok.status_code == 200, ok.text

                listed = await client.get(
                    COMMANDS_PREFIX, params={**params, "limit": 500}
                )
                assert listed.status_code == 200
                assert [i["name"] for i in listed.json()["items"]] == ["vet-plan"]

                # …but the spec IS there on the current API, which is what the
                # console reads, and opt-in filtering is available to a
                # provisioning client that asks for it.
                units = await client.get(
                    UNITS_PREFIX, params={**params, "kind": "command"}
                )
                assert sorted(u["name"] for u in units.json()["items"]) == [
                    "_gate-registration",
                    "vet-plan",
                ]
                provisionable = await client.get(
                    UNITS_PREFIX,
                    params={**params, "kind": "command", "invocable_only": "true"},
                )
                assert [u["name"] for u in provisionable.json()["items"]] == [
                    "vet-plan"
                ]


class TestFleetDefaultsReachTheLegacyClient:
    @pytest.mark.asyncio
    async def test_an_unshadowed_fleet_default_appears_as_a_command(
        self,
        client: httpx.AsyncClient,
        alias_db: AsyncSession,
        account: tuple[UUID, UUID],
    ) -> None:
        """The two-layer model's payoff: a runner that predates it still picks
        up the fleet corpus, with no rebuild and no new query parameter."""
        alias_db.add(
            AgentTextUnit(
                organization_id=None,
                kind="command",
                name="policy",
                files={"policy.md": "# fleet policy command"},
                current_version=1,
            )
        )
        await alias_db.commit()

        params = _org_param(account)
        with _member():
            async with client:
                listed = await client.get(
                    COMMANDS_PREFIX, params={**params, "limit": 500}
                )
                assert listed.status_code == 200
                items = {i["name"]: i for i in listed.json()["items"]}
                assert "policy" in items
                assert items["policy"]["body"] == "# fleet policy command"
                assert items["policy"]["source"] == "fleet"

    @pytest.mark.asyncio
    async def test_an_account_override_shadows_the_fleet_default(
        self,
        client: httpx.AsyncClient,
        alias_db: AsyncSession,
        account: tuple[UUID, UUID],
    ) -> None:
        alias_db.add(
            AgentTextUnit(
                organization_id=None,
                kind="command",
                name="policy",
                files={"policy.md": "# fleet"},
                current_version=1,
            )
        )
        await alias_db.commit()

        params = _org_param(account)
        with _member():
            async with client:
                await client.post(
                    COMMANDS_PREFIX,
                    params=params,
                    json={"name": "policy", "body": "# mine"},
                )
                listed = await client.get(
                    COMMANDS_PREFIX, params={**params, "limit": 500}
                )
                items = listed.json()["items"]
                assert [i["name"] for i in items] == ["policy"]
                assert items[0]["body"] == "# mine"
                assert items[0]["source"] == "user"
