"""``GET /api/v1/agent-text-units/index`` over the real HTTP surface.

The corpus is fetched by the runner on the **spawn critical path** inside a 4 s
budget, and resolution is fail-soft — a link too slow to finish degrades to
cache and then to embedded defaults, so an oversized corpus does not error, it
silently disappears. That is the failure plan
``2026-08-20-fleet-served-agent-skills`` exists to close, and the metadata
projection is what keeps it closed once Phase 5 fills the corpus. Measured over
the fleet's 87 units: 1,988,661 bytes with bodies against 47,093 without.

Driven over ASGI rather than against the service, because three of the things
that can break here are not service-level facts:

* ``/index`` is declared before ``/{name}`` and would otherwise be swallowed by
  it — a routing property, invisible to a service test;
* the filter set is shared through one ``UnitListFilters`` dependency, so
  "every filter still composes" has to be asserted on the parameters FastAPI
  actually publishes;
* gzip is middleware, and the compression half of the budget fix lives in
  ``app/main.py``, not in any endpoint.

Uses ``httpx.AsyncClient`` + ``ASGITransport`` (NOT ``TestClient``) so the
handler runs in the SAME asyncio loop as the shared async DB session — the
pattern ``test_agent_commands_alias_api.py`` already follows.
"""

from __future__ import annotations

import gzip as gzip_mod
import json
from collections.abc import AsyncGenerator
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import delete, or_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import current_active_user, get_async_db
from app.api.v1.endpoints.agent_text_units import router as units_router
from app.models.agent_text_unit import KIND_COMMAND, KIND_SKILL, AgentTextUnit
from app.models.organization import Organization
from app.models.user import User

UNITS_PREFIX = "/api/v1/agent-text-units"


@pytest_asyncio.fixture
async def idx_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def account(idx_db: AsyncSession) -> AsyncGenerator[tuple[UUID, UUID], None]:
    user = User(
        email=f"idx_{uuid4()}@example.com",
        username=f"idx_{uuid4().hex[:8]}",
        full_name="Index Test User",
        is_active=True,
        is_verified=True,
    )
    idx_db.add(user)
    await idx_db.flush()
    org = Organization(
        name=f"idx-org-{uuid4().hex[:8]}",
        slug=f"idx-org-{uuid4().hex[:8]}",
        owner_id=user.id,
        settings={},
    )
    idx_db.add(org)
    await idx_db.flush()
    await idx_db.commit()
    # Read the ids out BEFORE yielding: an endpoint under test commits on this
    # same session, which detaches these instances.
    org_id, user_id = org.id, user.id

    yield org_id, user_id

    await idx_db.rollback()
    await idx_db.execute(
        delete(AgentTextUnit).where(
            or_(
                AgentTextUnit.organization_id == org_id,
                AgentTextUnit.organization_id.is_(None),
            )
        )
    )
    await idx_db.execute(delete(Organization).where(Organization.id == org_id))
    await idx_db.execute(delete(User).where(User.id == user_id))
    await idx_db.commit()


def _build_client(
    idx_db: AsyncSession, user_id: UUID, *, with_gzip: bool
) -> httpx.AsyncClient:
    user = MagicMock()
    user.id = user_id
    user.is_active = True
    user.is_verified = True
    user.is_superuser = False

    app = FastAPI()

    async def _db_override() -> AsyncGenerator[AsyncSession, None]:
        yield idx_db

    app.dependency_overrides[get_async_db] = _db_override
    app.dependency_overrides[current_active_user] = lambda: user
    app.include_router(units_router, prefix=UNITS_PREFIX)
    if with_gzip:
        # The same configuration `app/main.py` installs.
        app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.fixture
def client(idx_db: AsyncSession, account: tuple[UUID, UUID]) -> httpx.AsyncClient:
    return _build_client(idx_db, account[1], with_gzip=False)


@pytest.fixture
def gzip_client(idx_db: AsyncSession, account: tuple[UUID, UUID]) -> httpx.AsyncClient:
    return _build_client(idx_db, account[1], with_gzip=True)


def _member() -> object:
    return patch(
        "app.api.v1.endpoints.agent_text_units.check_organization_membership",
        new=_always_a_member,
    )


async def _always_a_member(*_args: object, **_kwargs: object) -> bool:
    return True


def _org(account: tuple[UUID, UUID]) -> dict[str, str]:
    return {"organization_id": str(account[0])}


async def _seed(client: httpx.AsyncClient, params: dict[str, str]) -> None:
    """Two commands, a copy-source spec and a two-file skill."""
    for name, body in (("vet-plan", "# vet"), ("gate", "# gate")):
        created = await client.post(
            UNITS_PREFIX,
            params=params,
            json={"name": name, "files": {f"{name}.md": body}},
        )
        assert created.status_code == 200, created.text
    spec = await client.post(
        UNITS_PREFIX,
        params=params,
        json={
            "name": "_loop-control",
            "files": {"_loop-control.md": "# spec"},
            "is_invocable": False,
        },
    )
    assert spec.status_code == 200, spec.text
    skill = await client.post(
        UNITS_PREFIX,
        params=params,
        json={
            "kind": KIND_SKILL,
            "name": "coord-revive",
            "files": {"SKILL.md": "# revive", "coord-revive.sh": "echo x\n"},
        },
    )
    assert skill.status_code == 200, skill.text


class TestIndexRoute:
    @pytest.mark.asyncio
    async def test_it_is_not_swallowed_by_the_single_unit_route(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """``/index`` sits where ``GET /{name}`` also matches. It is declared
        first so it wins; if that ordering is ever lost this asks for a unit
        named ``index``, gets a 404, and says so.
        """
        params = _org(account)
        with _member():
            async with client:
                await _seed(client, params)
                index = await client.get(f"{UNITS_PREFIX}/index", params=params)
                one = await client.get(
                    f"{UNITS_PREFIX}/vet-plan", params={**params, "kind": KIND_COMMAND}
                )

        assert index.status_code == 200, index.text
        assert "items" in index.json(), "the /{name} route answered instead"
        # The route it shadows still works for every other name.
        assert one.status_code == 200, one.text
        assert one.json()["files"] == {"vet-plan.md": "# vet"}

    @pytest.mark.asyncio
    async def test_the_response_carries_metadata_and_no_bodies(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        params = _org(account)
        with _member():
            async with client:
                await _seed(client, params)
                response = await client.get(f"{UNITS_PREFIX}/index", params=params)

        assert response.status_code == 200, response.text
        assert "files" not in response.text
        for body in ("# vet", "# gate", "# spec", "# revive", "echo x"):
            assert body not in response.text

        rows = {row["name"]: row for row in response.json()["items"]}
        assert set(rows) == {"vet-plan", "gate", "_loop-control", "coord-revive"}
        skill = rows["coord-revive"]
        assert skill["file_paths"] == ["SKILL.md", "coord-revive.sh"]
        assert skill["byte_count"] == len(b"# revive") + len(b"echo x\n")
        assert skill["checksum"].startswith("sha256-")
        assert skill["entrypoint"] == "SKILL.md"
        assert rows["_loop-control"]["is_invocable"] is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("query", "expected"),
        [
            ({}, {"_loop-control", "coord-revive", "gate", "vet-plan"}),
            ({"kind": KIND_COMMAND}, {"_loop-control", "gate", "vet-plan"}),
            ({"kind": KIND_SKILL}, {"coord-revive"}),
            ({"invocable_only": "true"}, {"coord-revive", "gate", "vet-plan"}),
            ({"names": ["gate", "vet-plan"]}, {"gate", "vet-plan"}),
            (
                {
                    "kind": KIND_COMMAND,
                    "names": ["gate", "_loop-control"],
                    "invocable_only": "true",
                },
                {"gate"},
            ),
        ],
    )
    async def test_every_filter_composes_on_the_wire(
        self,
        client: httpx.AsyncClient,
        account: tuple[UUID, UUID],
        query: dict[str, object],
        expected: set[str],
    ) -> None:
        """The same filters the full listing takes, through the shared
        dependency, over HTTP — including the trio (`kind` + `names` +
        `invocable_only`) a client provisioning to disk actually sends.

        Membership is compared as a SET, order as a list against the full
        listing. Ordering is ``(kind, name)`` in the database's own collation,
        and where an underscore-prefixed name sorts is a property of that
        collation, not of this code — pinning it here would red the suite on a
        Postgres configured with a different one. What must hold is that the
        two projections agree, which the list comparison below asserts exactly.
        """
        params = {**_org(account), **query}
        with _member():
            async with client:
                await _seed(client, params={**_org(account)})
                index = await client.get(f"{UNITS_PREFIX}/index", params=params)
                full = await client.get(UNITS_PREFIX, params=params)

        assert index.status_code == 200, index.text
        assert full.status_code == 200, full.text
        assert {row["name"] for row in index.json()["items"]} == expected
        assert [row["name"] for row in index.json()["items"]] == [
            row["name"] for row in full.json()["items"]
        ]
        assert index.json()["pagination"] == full.json()["pagination"]

    @pytest.mark.asyncio
    async def test_pagination_slices_both_projections_the_same_way(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """A cold client with no index yet pages the full listing instead of
        pulling the whole corpus in one 4 s window, so the two must slice
        identically or a page would be silently skipped."""
        params = _org(account)
        with _member():
            async with client:
                await _seed(client, params)
                pages = [
                    (
                        await client.get(
                            f"{UNITS_PREFIX}/index",
                            params={**params, "offset": offset, "limit": 2},
                        ),
                        await client.get(
                            UNITS_PREFIX,
                            params={**params, "offset": offset, "limit": 2},
                        ),
                    )
                    for offset in (0, 2)
                ]

        seen: list[str] = []
        for offset, (index, full) in zip((0, 2), pages, strict=True):
            assert index.status_code == 200, index.text
            names = [row["name"] for row in index.json()["items"]]
            assert names == [row["name"] for row in full.json()["items"]]
            assert len(names) == 2
            assert index.json()["pagination"] == {
                "total": 4,
                "limit": 2,
                "offset": offset,
                "has_more": offset == 0,
            }
            seen.extend(names)

        assert set(seen) == {"_loop-control", "coord-revive", "gate", "vet-plan"}

    @pytest.mark.asyncio
    async def test_a_malformed_name_selector_is_a_422(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """A traversal-shaped name cannot match a stored row, and answering it
        with a short list would read as "that unit was deleted"."""
        params = {**_org(account), "names": ["../etc/passwd"]}
        with _member():
            async with client:
                await _seed(client, params=_org(account))
                index = await client.get(f"{UNITS_PREFIX}/index", params=params)
                full = await client.get(UNITS_PREFIX, params=params)

        assert index.status_code == 422, index.text
        assert full.status_code == 422, full.text

    @pytest.mark.asyncio
    async def test_the_names_selector_returns_bodies_from_the_full_route(
        self, client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """The second call of the intended exchange: index, diff, then fetch
        bodies for just the units whose digest moved."""
        params = _org(account)
        with _member():
            async with client:
                await _seed(client, params)
                index = await client.get(f"{UNITS_PREFIX}/index", params=params)
                stale = [
                    row["name"]
                    for row in index.json()["items"]
                    if row["name"] in {"gate", "coord-revive"}
                ]
                bodies = await client.get(
                    UNITS_PREFIX, params={**params, "names": stale}
                )

        assert bodies.status_code == 200, bodies.text
        fetched = {row["name"]: row["files"] for row in bodies.json()["items"]}
        assert fetched == {
            "gate": {"gate.md": "# gate"},
            "coord-revive": {"SKILL.md": "# revive", "coord-revive.sh": "echo x\n"},
        }


class TestCompression:
    @pytest.mark.asyncio
    async def test_the_full_listing_is_gzipped_for_a_client_that_asks(
        self, gzip_client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """The other half of the budget fix. Nothing else in the stack
        compresses this API — not the Elastic Beanstalk nginx overlay, not an
        ALB, and not the CloudFront behaviour, which is scoped to `images/*`.
        """
        params = _org(account)
        # Comfortably over `minimum_size`, and compressible the way real command
        # bodies are.
        body = "# a command\n" * 400
        with _member():
            async with gzip_client:
                created = await gzip_client.post(
                    UNITS_PREFIX,
                    params=params,
                    json={"name": "bulky", "files": {"bulky.md": body}},
                )
                assert created.status_code == 200, created.text
                response = await gzip_client.get(
                    UNITS_PREFIX, params=params, headers={"Accept-Encoding": "gzip"}
                )

        assert response.status_code == 200
        assert response.headers["content-encoding"] == "gzip"
        assert "accept-encoding" in response.headers["vary"].lower()
        # httpx decodes transparently; measure the bytes that actually crossed.
        decoded = json.dumps(response.json()).encode("utf-8")
        assert int(response.headers["content-length"]) < len(decoded)
        assert body in response.json()["items"][0]["files"]["bulky.md"]

    @pytest.mark.asyncio
    async def test_a_client_that_does_not_ask_gets_plain_bytes(
        self, gzip_client: httpx.AsyncClient, account: tuple[UUID, UUID]
    ) -> None:
        """`Accept-Encoding` is honoured, so an unrebuilt runner that sends none
        is unaffected by turning compression on."""
        params = _org(account)
        with _member():
            async with gzip_client:
                created = await gzip_client.post(
                    UNITS_PREFIX,
                    params=params,
                    json={"name": "bulky", "files": {"bulky.md": "# c\n" * 400}},
                )
                assert created.status_code == 200, created.text
                response = await gzip_client.get(
                    UNITS_PREFIX, params=params, headers={"Accept-Encoding": "identity"}
                )

        assert response.status_code == 200
        assert "content-encoding" not in response.headers

    def test_the_app_installs_the_gzip_middleware(self) -> None:
        """Pins the wiring in `app/main.py`, not Starlette's behaviour: the two
        tests above build their own app, so without this one the real one could
        lose the middleware and nothing would notice."""
        from app.main import app

        assert any(m.cls is GZipMiddleware for m in app.user_middleware)

    def test_gzip_leaves_event_streams_alone(self) -> None:
        """Why enabling it globally is safe here. Starlette excludes
        `text/event-stream` outright; this asserts the pinned version still
        does, because SSE compressed without a per-chunk flush would stall.
        """
        from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES

        assert "text/event-stream" in DEFAULT_EXCLUDED_CONTENT_TYPES

    def test_gzip_actually_shrinks_a_corpus_shaped_payload(self) -> None:
        """The 1.99 MB -> 703 KB claim in `app/main.py`, in miniature: the
        measurement is of gzip level 6, the level that file configures."""
        payload = ("# a command\n" * 20_000).encode("utf-8")
        assert len(gzip_mod.compress(payload, compresslevel=6)) < len(payload) // 4
