"""Characterization suite for every route in ``ui_bridge_states``.

Phase 0 of plan
``2026-10-04-web-ui-bridge-states-endpoint-inlines-its-crud-and-discovery``.
The endpoint module (29 routes over six resources plus two runner-dispatch
flows) had no tests at all, and later phases of that plan move its SQL into
``app.crud``, its runner selection/dispatch into ``app.services`` and split the
module into a package. This file pins today's observable behaviour so each of
those moves can be proven behaviour-preserving: status codes, 404 detail text,
ordering, the export shape, the persisted rows after discover, the 503/504/404
runner envelopes and the structlog event names (an observability contract).

Layering mirrors ``tests/api/test_phase_result_ingestion.py``: the router is
mounted on a bare ``FastAPI`` under ``/api/v1`` and driven through
``httpx.AsyncClient`` over ``ASGITransport``, sharing the test's asyncio loop
and the rolled-back ``async_db_session``. ``get_async_db`` and
``get_current_active_user_async`` are replaced through
``app.dependency_overrides``.

**The runner seam is the singleton, on purpose.** The endpoints call
``get_redis()`` / ``get_runner_websocket_manager(redis)`` in their bodies (not
via ``Depends``), and the later phases move those call sites. Patching the
import site would have to follow them; patching the process-wide singleton
``app.services.runner_websocket_manager._runner_websocket_manager`` does not,
because ``get_runner_websocket_manager`` returns it whenever it is set.
``get_redis()`` needs no patch: ``redis.asyncio.from_url`` builds a pool
without connecting, and the fake manager never touches the client.

**pgvector.** ``tests/conftest.py`` skips the ``project.domain_knowledge`` and
``project.ui_bridge_state_domain_knowledge`` tables when ``CREATE EXTENSION
vector`` fails. Every route that eager-loads ``UIBridgeState.domain_knowledge_refs``
(or cascades a delete through it) needs those tables, so those tests carry
``needs_pgvector`` and SKIP — with the reason — instead of erroring. CI's
Postgres is ``pgvector/pgvector:pg16``, so nothing skips there.

**Coverage is asserted, not hoped for.** Every request made through
``make_client`` records the ``(method, path)`` of the route that served it;
the last test enumerates the routes of the REAL app whose endpoint lives in
``app.api.v1.endpoints.ui_bridge_states`` (by module, not by path prefix: other
modules mount ``/projects/{project_id}/...`` too) and fails on any route no
behavioural test reached. The blanket non-owner test does not record, so it
cannot satisfy coverage on its own.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator, Callable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
import structlog
from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import ASGIApp, Receive, Scope, Send

import app.services.runner_websocket_manager as runner_ws_manager_module
from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints import ui_bridge_states as ui_bridge_states_module
from app.models.device import Device
from app.models.project import Project
from app.models.ui_bridge_state import (
    DomainKnowledge,
    UIBridgeState,
    UIBridgeStateConfig,
)
from app.models.ui_bridge_transition import UIBridgeTransition
from app.models.user import User
from app.services.runner import RunnerCommandTimeoutError, RunnerNotConnectedError

pytestmark = pytest.mark.asyncio

API = "/api/v1"
ENDPOINT_MODULE = "app.api.v1.endpoints.ui_bridge_states"

DISCOVER_ENDPOINT = "/api/v1/projects/{project_id}/ui-bridge-discover"
PATHFIND_ENDPOINT = (
    "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/pathfind"
)

P = "/api/v1/projects/{project_id}"
C = P + "/ui-bridge-configs/{config_id}"
S = C + "/states/{state_id}"

# The 29 routes, as the real app mounts them. The coverage test asserts the
# module's routes equal this list exactly AND that each one was exercised.
EXPECTED_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", P + "/ui-bridge-configs"),
        ("POST", P + "/ui-bridge-configs"),
        ("GET", C),
        ("PATCH", C),
        ("DELETE", C),
        ("GET", C + "/states"),
        ("GET", S),
        ("PATCH", S),
        ("POST", S + "/knowledge"),
        ("DELETE", S + "/knowledge/{knowledge_id}"),
        ("GET", P + "/domain-knowledge"),
        ("POST", P + "/domain-knowledge"),
        ("GET", P + "/domain-knowledge/{knowledge_id}"),
        ("PATCH", P + "/domain-knowledge/{knowledge_id}"),
        ("DELETE", P + "/domain-knowledge/{knowledge_id}"),
        ("POST", P + "/ui-bridge-discover"),
        ("GET", P + "/exploration-sessions"),
        ("POST", P + "/exploration-sessions"),
        ("GET", P + "/exploration-sessions/{session_id}"),
        ("PATCH", P + "/exploration-sessions/{session_id}"),
        ("POST", P + "/exploration-sessions/{session_id}/renders"),
        ("DELETE", P + "/exploration-sessions/{session_id}"),
        ("GET", C + "/transitions"),
        ("POST", C + "/transitions"),
        ("PATCH", C + "/transitions/{transition_id}"),
        ("DELETE", C + "/transitions/{transition_id}"),
        ("GET", C + "/export"),
        ("POST", C + "/pathfind"),
        ("GET", C + "/full"),
    }
)

# (method, route path) of every route a recording client reached.
_EXERCISED: set[tuple[str, str]] = set()
# Node ids of tests skipped for want of pgvector (the coverage test reports them).
_PGVECTOR_SKIPS: list[str] = []


# =============================================================================
# App / client plumbing
# =============================================================================


class _RouteRecorder:
    """ASGI middleware: after the router ran, note which route served it.

    Starlette's router writes the matched route into the SAME scope dict the
    middleware passed down (``scope.update(child_scope)``), so ``scope["route"]``
    is readable here once the inner app returns — whatever status it produced.
    """

    def __init__(self, app: ASGIApp, *, record: bool) -> None:
        self.app = app
        self.record = record

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await self.app(scope, receive, send)
        finally:
            route = scope.get("route")
            if self.record and isinstance(route, APIRoute):
                _EXERCISED.add((scope["method"], route.path))


def _build_app(*, db: AsyncSession, user: User, record: bool) -> FastAPI:
    app = FastAPI()

    async def _db_override() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_async_db] = _db_override
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.include_router(ui_bridge_states_module.router, prefix=API)
    app.add_middleware(_RouteRecorder, record=record)
    return app


ClientFactory = Callable[..., httpx.AsyncClient]


@pytest.fixture()
def make_client(async_db_session: AsyncSession) -> ClientFactory:
    def _factory(user: User, *, record: bool = True) -> httpx.AsyncClient:
        app = _build_app(db=async_db_session, user=user, record=record)
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    return _factory


# =============================================================================
# pgvector gate — the same condition conftest's table build uses
# =============================================================================


@pytest_asyncio.fixture()
async def _require_pgvector(
    request: pytest.FixtureRequest, async_db_session: AsyncSession
) -> None:
    """Skip, loudly, when conftest could not enable pgvector.

    conftest builds the vector-dependent tables iff ``CREATE EXTENSION vector``
    succeeded, so "the extension is installed in this database" is the same
    predicate it branched on.
    """
    row = await async_db_session.execute(
        text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
    )
    if row.scalar_one_or_none() is None:
        _PGVECTOR_SKIPS.append(request.node.nodeid)
        pytest.skip(
            "pgvector unavailable: tests/conftest.py skipped project.domain_knowledge "
            "and project.ui_bridge_state_domain_knowledge, which this route loads"
        )


needs_pgvector = pytest.mark.usefixtures("_require_pgvector")


# =============================================================================
# Seed helpers
# =============================================================================


async def _make_user(db: AsyncSession, stem: str) -> User:
    user = User(
        email=f"{stem}_{uuid4().hex[:8]}@example.com",
        username=f"{stem}_{uuid4().hex[:8]}",
        full_name=f"{stem} tester",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_project(db: AsyncSession, owner: User, name: str = "uibs") -> Project:
    project = Project(id=uuid4(), name=name, owner_id=owner.id, configuration={})
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@dataclass
class Graph:
    config_id: UUID
    state_ids: dict[str, UUID] = field(default_factory=dict)  # state_id -> row id
    transition_ids: dict[str, UUID] = field(default_factory=dict)


async def _seed_graph(
    db: AsyncSession,
    project: Project,
    *,
    states: Sequence[dict[str, Any]] = (),
    transitions: Sequence[dict[str, Any]] = (),
    name: str = "seeded",
) -> Graph:
    """Insert a config with the given states/transitions; return their ids.

    The session is expunged afterwards so the routes load everything fresh
    instead of reusing half-initialised identity-map objects from the seed.
    """
    config = UIBridgeStateConfig(
        project_id=project.id,
        name=name,
        description="seeded config",
        render_count=3,
        element_count=7,
    )
    db.add(config)
    await db.flush()
    graph = Graph(config_id=config.id)
    for spec in states:
        row = UIBridgeState(config_id=config.id, **spec)
        db.add(row)
        await db.flush()
        graph.state_ids[spec["state_id"]] = row.id
    for spec in transitions:
        trow = UIBridgeTransition(config_id=config.id, **spec)
        db.add(trow)
        await db.flush()
        graph.transition_ids[spec["transition_id"]] = trow.id
    await db.commit()
    db.expunge_all()
    return graph


async def _make_knowledge(
    db: AsyncSession, project_id: UUID | None, title: str
) -> UUID:
    k = DomainKnowledge(project_id=project_id, title=title, content=f"{title} body")
    db.add(k)
    await db.commit()
    kid = k.id
    db.expunge(k)
    return kid


async def _make_device(
    db: AsyncSession, *, user: User, name: str, paired: bool = True
) -> Device:
    device = Device(
        device_id=uuid4(),
        user_id=user.id,
        name=name,
        hostname=name,
        state="healthy",
        capability_user_paired=paired,
        paired_at=datetime.now(UTC) if paired else None,
        last_heartbeat=datetime.now(UTC),
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


# =============================================================================
# Fixtures
# =============================================================================


@pytest_asyncio.fixture()
async def owner(async_db_session: AsyncSession) -> User:
    return await _make_user(async_db_session, "uibs_owner")


@pytest_asyncio.fixture()
async def stranger(async_db_session: AsyncSession) -> User:
    return await _make_user(async_db_session, "uibs_stranger")


@pytest_asyncio.fixture()
async def project(async_db_session: AsyncSession, owner: User) -> Project:
    return await _make_project(async_db_session, owner)


class _FakeRegistry:
    """The two predicates runner selection reads, over one set of live ids."""

    def __init__(self) -> None:
        self.connected: set[str] = set()

    def is_runner_connected(self, runner_id: str) -> bool:
        return runner_id in self.connected

    def is_runner_socket_live(self, runner_id: str) -> bool:
        return runner_id in self.connected


@dataclass
class FakeRunnerManager:
    registry: _FakeRegistry
    dispatch: AsyncMock

    @property
    def relay(self) -> SimpleNamespace:
        return SimpleNamespace(dispatch_and_wait=self.dispatch)

    def connect(self, device: Device) -> None:
        self.registry.connected.add(str(device.device_id))

    @property
    def sent_command(self) -> dict[str, Any]:
        assert self.dispatch.await_count == 1
        return self.dispatch.await_args.args[1]

    @property
    def sent_kwargs(self) -> dict[str, Any]:
        return dict(self.dispatch.await_args.kwargs)


@pytest.fixture()
def fake_runner_manager(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeRunnerManager]:
    """Install a scripted manager as the process-wide singleton.

    ``get_runner_websocket_manager`` returns the singleton whenever it is set,
    so this reaches every call site no matter which module later owns it.
    """
    fake = FakeRunnerManager(registry=_FakeRegistry(), dispatch=AsyncMock())
    monkeypatch.setattr(
        runner_ws_manager_module, "_runner_websocket_manager", fake, raising=True
    )
    yield fake


# =============================================================================
# Ownership: a project the caller does not own is a 404 on every route
# =============================================================================


def _concrete(path: str, project_id: UUID) -> str:
    return (
        path.replace("{project_id}", str(project_id))
        .replace("{config_id}", str(uuid4()))
        .replace("{state_id}", str(uuid4()))
        .replace("{knowledge_id}", str(uuid4()))
        .replace("{session_id}", str(uuid4()))
        .replace("{transition_id}", str(uuid4()))
    )


# A body that passes request validation for each body-taking route, so the
# handler (and its project check) actually runs.
_VALID_BODIES: dict[tuple[str, str], dict[str, Any]] = {
    ("POST", P + "/ui-bridge-configs"): {"name": "x"},
    ("PATCH", C): {"name": "x"},
    ("PATCH", S): {"name": "x"},
    ("POST", S + "/knowledge"): {"knowledge_id": str(uuid4())},
    ("POST", P + "/domain-knowledge"): {"title": "t", "content": "c"},
    ("PATCH", P + "/domain-knowledge/{knowledge_id}"): {"title": "t"},
    ("POST", P + "/ui-bridge-discover"): {"renders": []},
    ("POST", P + "/exploration-sessions"): {},
    ("PATCH", P + "/exploration-sessions/{session_id}"): {},
    ("POST", P + "/exploration-sessions/{session_id}/renders"): {"render_logs": []},
    ("POST", C + "/transitions"): {"name": "t"},
    ("PATCH", C + "/transitions/{transition_id}"): {"name": "t"},
    ("POST", C + "/pathfind"): {"from_states": [], "target_states": []},
}


@pytest.mark.parametrize(
    ("method", "path"), sorted(EXPECTED_ROUTES), ids=lambda v: str(v)
)
async def test_non_owner_project_is_404_on_every_route(
    method: str,
    path: str,
    make_client: ClientFactory,
    project: Project,
    stranger: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    url = _concrete(path, project.id)
    body = _VALID_BODIES.get((method, path))
    async with make_client(stranger, record=False) as client:
        resp = await client.request(method, url, json=body)
    assert resp.status_code == 404, resp.text
    assert resp.json() == {"detail": "Project not found"}
    fake_runner_manager.dispatch.assert_not_awaited()


# Config-scoped routes answer the config 404 before touching anything else.
_CONFIG_SCOPED = sorted(
    (m, p)
    for (m, p) in EXPECTED_ROUTES
    if p.startswith(C) and (m, p) != ("POST", C + "/pathfind")
) + [("POST", C + "/pathfind")]


@pytest.mark.parametrize(("method", "path"), _CONFIG_SCOPED, ids=lambda v: str(v))
async def test_unknown_config_is_404_with_detail_text(
    method: str,
    path: str,
    make_client: ClientFactory,
    project: Project,
    owner: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    url = _concrete(path, project.id)
    body = _VALID_BODIES.get((method, path))
    async with make_client(owner) as client:
        resp = await client.request(method, url, json=body)
    assert resp.status_code == 404, resp.text
    assert resp.json() == {"detail": "State configuration not found"}
    fake_runner_manager.dispatch.assert_not_awaited()


# =============================================================================
# State configs
# =============================================================================


async def test_config_create_list_patch_delete(
    make_client: ClientFactory, project: Project, owner: User
) -> None:
    base = f"{API}/projects/{project.id}/ui-bridge-configs"
    async with make_client(owner) as client:
        r1 = await client.post(base, json={"name": "first", "description": "d1"})
        assert r1.status_code == 201, r1.text
        first = r1.json()
        assert first["project_id"] == str(project.id)
        assert first["name"] == "first"
        assert first["description"] == "d1"
        assert first["render_count"] == 0
        assert first["element_count"] == 0
        assert first["include_html_ids"] is False

        r2 = await client.post(base, json={"include_html_ids": True})
        assert r2.status_code == 201
        second = r2.json()
        assert second["name"] == "default"
        assert second["include_html_ids"] is True

        listed = await client.get(base)
        assert listed.status_code == 200
        body = listed.json()
        assert body["total"] == 2
        # Ordered by updated_at DESC: the newest config first.
        assert [c["id"] for c in body["items"]] == [second["id"], first["id"]]

        patched = await client.patch(f"{base}/{first['id']}", json={"name": "renamed"})
        assert patched.status_code == 200
        assert patched.json()["name"] == "renamed"
        assert patched.json()["description"] == "d1"  # None leaves it alone

        deleted = await client.delete(f"{base}/{first['id']}")
        assert deleted.status_code == 204
        assert deleted.content == b""

        after = await client.get(base)
        assert [c["id"] for c in after.json()["items"]] == [second["id"]]

        gone = await client.patch(f"{base}/{first['id']}", json={"name": "x"})
        assert gone.status_code == 404
        assert gone.json() == {"detail": "State configuration not found"}


async def test_config_of_another_project_is_404(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    """A config id is scoped to its project, even across the owner's own projects."""
    other = await _make_project(async_db_session, owner, name="other")
    graph = await _seed_graph(async_db_session, other)
    async with make_client(owner) as client:
        resp = await client.get(
            f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}/transitions"
        )
    assert resp.status_code == 404
    assert resp.json() == {"detail": "State configuration not found"}


@needs_pgvector
async def test_get_config_includes_states_with_knowledge(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    graph = await _seed_graph(
        async_db_session,
        project,
        states=[
            {"state_id": "s_b", "name": "Bravo", "element_ids": ["e1"]},
            {"state_id": "s_a", "name": "Alpha"},
        ],
    )
    async with make_client(owner) as client:
        resp = await client.get(
            f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}"
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(graph.config_id)
    assert body["render_count"] == 3
    assert body["element_count"] == 7
    # relationship order_by="UIBridgeState.name"
    assert [s["name"] for s in body["states"]] == ["Alpha", "Bravo"]
    assert body["states"][1]["element_ids"] == ["e1"]
    assert all(s["domain_knowledge"] == [] for s in body["states"])


@needs_pgvector
async def test_delete_config_cascades_its_states(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    graph = await _seed_graph(
        async_db_session,
        project,
        states=[{"state_id": "s1", "name": "One"}],
        transitions=[{"transition_id": "t1", "name": "T"}],
    )
    async with make_client(owner) as client:
        resp = await client.delete(
            f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}"
        )
    assert resp.status_code == 204
    left = await async_db_session.execute(
        select(UIBridgeState.id).where(UIBridgeState.config_id == graph.config_id)
    )
    assert left.all() == []
    left_t = await async_db_session.execute(
        select(UIBridgeTransition.id).where(
            UIBridgeTransition.config_id == graph.config_id
        )
    )
    assert left_t.all() == []


# =============================================================================
# States + knowledge links
# =============================================================================


@needs_pgvector
async def test_states_list_get_patch(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    graph = await _seed_graph(
        async_db_session,
        project,
        states=[
            {"state_id": "s_z", "name": "Zulu", "confidence": 0.5},
            {"state_id": "s_m", "name": "Mike", "render_ids": ["r1", "r2"]},
        ],
    )
    base = f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}/states"
    async with make_client(owner) as client:
        listed = await client.get(base)
        assert listed.status_code == 200
        body = listed.json()
        assert body["total"] == 2
        assert [s["name"] for s in body["items"]] == ["Mike", "Zulu"]  # by name

        sid = graph.state_ids["s_z"]
        got = await client.get(f"{base}/{sid}")
        assert got.status_code == 200
        state = got.json()
        assert state["state_id"] == "s_z"
        assert state["confidence"] == 0.5
        assert state["element_ids"] == []
        assert state["acceptance_criteria"] == []
        assert state["extra_metadata"] == {}
        assert state["domain_knowledge"] == []

        patched = await client.patch(
            f"{base}/{sid}",
            json={
                "name": "Zulu 2",
                "description": "desc",
                "acceptance_criteria": ["visible"],
                "extra_metadata": {"blocking": True},
            },
        )
        assert patched.status_code == 200, patched.text
        p = patched.json()
        assert p["name"] == "Zulu 2"
        assert p["description"] == "desc"
        assert p["acceptance_criteria"] == ["visible"]
        assert p["extra_metadata"] == {"blocking": True}
        assert p["state_id"] == "s_z"  # immutable via PATCH

        # Partial patch leaves the rest alone.
        again = await client.patch(f"{base}/{sid}", json={"description": "d2"})
        assert again.json()["name"] == "Zulu 2"
        assert again.json()["description"] == "d2"

        missing = await client.get(f"{base}/{uuid4()}")
        assert missing.status_code == 404
        assert missing.json() == {"detail": "State not found"}
        missing_patch = await client.patch(f"{base}/{uuid4()}", json={"name": "x"})
        assert missing_patch.status_code == 404
        assert missing_patch.json() == {"detail": "State not found"}


@needs_pgvector
async def test_link_unlink_knowledge_ordering_and_errors(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    stranger: User,
) -> None:
    graph = await _seed_graph(
        async_db_session, project, states=[{"state_id": "s1", "name": "One"}]
    )
    k_project = await _make_knowledge(async_db_session, project.id, "project-k")
    k_global = await _make_knowledge(async_db_session, None, "global-k")
    foreign_project = await _make_project(async_db_session, stranger, name="theirs")
    k_foreign = await _make_knowledge(async_db_session, foreign_project.id, "foreign-k")

    sid = graph.state_ids["s1"]
    state_url = (
        f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}/states/{sid}"
    )
    async with make_client(owner) as client:
        r1 = await client.post(
            f"{state_url}/knowledge", json={"knowledge_id": str(k_global), "order": 5}
        )
        assert r1.status_code == 200, r1.text
        assert [k["id"] for k in r1.json()["domain_knowledge"]] == [str(k_global)]

        r2 = await client.post(
            f"{state_url}/knowledge", json={"knowledge_id": str(k_project), "order": 1}
        )
        assert r2.status_code == 200, r2.text
        # Ordered by link.order, not by link time.
        assert [k["id"] for k in r2.json()["domain_knowledge"]] == [
            str(k_project),
            str(k_global),
        ]
        assert r2.json()["domain_knowledge"][0]["title"] == "project-k"

        dup = await client.post(
            f"{state_url}/knowledge", json={"knowledge_id": str(k_project)}
        )
        assert dup.status_code == 400
        assert dup.json() == {"detail": "Knowledge already linked to state"}

        foreign = await client.post(
            f"{state_url}/knowledge", json={"knowledge_id": str(k_foreign)}
        )
        assert foreign.status_code == 404
        assert foreign.json() == {"detail": "Domain knowledge not found"}

        no_state = await client.post(
            f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}"
            f"/states/{uuid4()}/knowledge",
            json={"knowledge_id": str(k_project)},
        )
        assert no_state.status_code == 404
        assert no_state.json() == {"detail": "State not found"}

        un = await client.delete(f"{state_url}/knowledge/{k_project}")
        assert un.status_code == 204
        assert un.content == b""

        # Unlinking something not linked is a silent 204.
        un_again = await client.delete(f"{state_url}/knowledge/{k_project}")
        assert un_again.status_code == 204

        un_missing_state = await client.delete(
            f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}"
            f"/states/{uuid4()}/knowledge/{k_global}"
        )
        assert un_missing_state.status_code == 404
        assert un_missing_state.json() == {"detail": "State not found"}

        after = await client.get(state_url)
        assert [k["id"] for k in after.json()["domain_knowledge"]] == [str(k_global)]


# =============================================================================
# Domain knowledge
# =============================================================================


@needs_pgvector
async def test_domain_knowledge_crud_and_global_visibility(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    k_global = await _make_knowledge(async_db_session, None, "Aaa global")
    base = f"{API}/projects/{project.id}/domain-knowledge"
    async with make_client(owner) as client:
        created = await client.post(
            base, json={"title": "Zed", "content": "body", "tags": ["a", "b"]}
        )
        assert created.status_code == 201, created.text
        k = created.json()
        assert k["project_id"] == str(project.id)
        assert k["tags"] == ["a", "b"]

        with_global = await client.get(base)
        assert with_global.status_code == 200
        assert with_global.json()["total"] == 2
        # Ordered by title.
        assert [i["id"] for i in with_global.json()["items"]] == [
            str(k_global),
            k["id"],
        ]

        project_only = await client.get(base, params={"include_global": "false"})
        assert [i["id"] for i in project_only.json()["items"]] == [k["id"]]

        got_global = await client.get(f"{base}/{k_global}")
        assert got_global.status_code == 200
        assert got_global.json()["project_id"] is None

        patched = await client.patch(f"{base}/{k['id']}", json={"content": "new"})
        assert patched.status_code == 200
        assert patched.json()["content"] == "new"
        assert patched.json()["title"] == "Zed"

        # Global knowledge is readable but neither editable nor deletable.
        edit_global = await client.patch(f"{base}/{k_global}", json={"title": "x"})
        assert edit_global.status_code == 404
        assert edit_global.json() == {
            "detail": "Domain knowledge not found or cannot be edited"
        }
        del_global = await client.delete(f"{base}/{k_global}")
        assert del_global.status_code == 404
        assert del_global.json() == {
            "detail": "Domain knowledge not found or cannot be deleted"
        }

        deleted = await client.delete(f"{base}/{k['id']}")
        assert deleted.status_code == 204
        missing = await client.get(f"{base}/{k['id']}")
        assert missing.status_code == 404
        assert missing.json() == {"detail": "Domain knowledge not found"}


# =============================================================================
# Exploration sessions
# =============================================================================


async def test_exploration_session_lifecycle_and_append_renders(
    make_client: ClientFactory, project: Project, owner: User
) -> None:
    base = f"{API}/projects/{project.id}/exploration-sessions"
    async with make_client(owner) as client:
        created = await client.post(base, json={"target_type": "web"})
        assert created.status_code == 201, created.text
        s = created.json()
        assert s["name"].startswith("Exploration ")  # generated when omitted
        assert s["status"] == "running"
        assert s["target_type"] == "web"
        assert s["render_count"] == 0
        assert s["completed_at"] is None
        assert "render_logs" not in s

        named = await client.post(base, json={"name": "named"})
        assert named.status_code == 201
        named_id = named.json()["id"]

        appended = await client.post(
            f"{base}/{s['id']}/renders",
            json={"render_logs": [{"r": 1}, {"r": 2}], "elements_discovered": 4},
        )
        assert appended.status_code == 200, appended.text
        assert appended.json()["render_count"] == 2
        assert appended.json()["elements_discovered"] == 4
        assert appended.json()["elements_explored"] == 0

        appended2 = await client.post(
            f"{base}/{s['id']}/renders",
            json={"render_logs": [{"r": 3}], "elements_explored": 1},
        )
        assert appended2.json()["render_count"] == 3
        assert appended2.json()["elements_discovered"] == 4  # untouched

        # PATCH render_logs APPENDS too, and a terminal status stamps completed_at.
        patched = await client.patch(
            f"{base}/{s['id']}",
            json={
                "render_logs": [{"r": 4}],
                "status": "completed",
                "discovery_completed": True,
                "error_message": "none",
            },
        )
        assert patched.status_code == 200, patched.text
        p = patched.json()
        assert p["render_count"] == 4
        assert p["status"] == "completed"
        assert p["completed_at"] is not None
        assert p["discovery_completed"] is True
        assert p["error_message"] == "none"

        got = await client.get(f"{base}/{s['id']}")
        assert got.status_code == 200
        assert got.json()["render_logs"] == [{"r": 1}, {"r": 2}, {"r": 3}, {"r": 4}]

        everything = await client.get(base)
        assert everything.json()["total"] == 2
        # created_at DESC
        assert [i["id"] for i in everything.json()["items"]] == [named_id, s["id"]]
        open_only = await client.get(base, params={"include_completed": "false"})
        assert [i["id"] for i in open_only.json()["items"]] == [named_id]
        limited = await client.get(base, params={"limit": 1})
        assert [i["id"] for i in limited.json()["items"]] == [named_id]

        deleted = await client.delete(f"{base}/{s['id']}")
        assert deleted.status_code == 204
        for method, url, body in (
            ("GET", f"{base}/{s['id']}", None),
            ("PATCH", f"{base}/{s['id']}", {}),
            ("POST", f"{base}/{s['id']}/renders", {"render_logs": []}),
            ("DELETE", f"{base}/{s['id']}", None),
        ):
            gone = await client.request(method, url, json=body)
            assert gone.status_code == 404, (method, url)
            assert gone.json() == {"detail": "Exploration session not found"}


# =============================================================================
# Transitions
# =============================================================================


async def test_transition_create_list_patch_delete(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    graph = await _seed_graph(async_db_session, project)
    base = (
        f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}/transitions"
    )
    async with make_client(owner) as client:
        created = await client.post(
            base,
            json={
                "name": "Open Settings!",
                "from_states": ["home"],
                "activate_states": ["settings"],
                "exit_states": ["home"],
                "actions": [{"type": "click", "target": "btn-settings"}],
                "path_cost": 2.0,
                "stays_visible": True,
                "extra_metadata": {"k": "v"},
            },
        )
        assert created.status_code == 201, created.text
        t = created.json()
        # transition_id is slugified from the name.
        assert t["transition_id"] == "open_settings"
        # Actions are stored with None fields dropped.
        assert t["actions"] == [{"type": "click", "target": "btn-settings"}]
        assert t["path_cost"] == 2.0
        assert t["stays_visible"] is True
        assert t["extra_metadata"] == {"k": "v"}

        await client.post(base, json={"name": "Alpha step"})
        listed = await client.get(base)
        assert listed.json()["total"] == 2
        assert [i["name"] for i in listed.json()["items"]] == [
            "Alpha step",
            "Open Settings!",
        ]

        patched = await client.patch(
            f"{base}/{t['id']}",
            json={"name": "Renamed", "actions": [{"type": "wait", "delay_ms": 10}]},
        )
        assert patched.status_code == 200
        pj = patched.json()
        assert pj["name"] == "Renamed"
        assert pj["transition_id"] == "open_settings"  # not re-derived
        assert pj["actions"] == [{"type": "wait", "delay_ms": 10}]
        assert pj["from_states"] == ["home"]

        deleted = await client.delete(f"{base}/{t['id']}")
        assert deleted.status_code == 204

        for method, body in (("PATCH", {"name": "x"}), ("DELETE", None)):
            gone = await client.request(method, f"{base}/{t['id']}", json=body)
            assert gone.status_code == 404
            assert gone.json() == {"detail": "Transition not found"}


# =============================================================================
# Export and /full
# =============================================================================


_STATE_WITH_RUNTIME_META = {
    "state_id": "modal",
    "name": "Modal",
    "element_ids": ["m1"],
    "extra_metadata": {
        "blocking": True,
        "blocks": ["home"],
        "group": "overlays",
        "path_cost": 2.5,
        "note": "kept",
    },
}
_PLAIN_STATE = {"state_id": "home", "name": "Home", "element_ids": ["h1", "h2"]}
_TRANSITION = {
    "transition_id": "open_modal",
    "name": "Open modal",
    "from_states": ["home"],
    "activate_states": ["modal"],
    "exit_states": [],
    "actions": [{"type": "click", "target": "h1"}],
    "path_cost": 1.5,
    "stays_visible": True,
    "extra_metadata": {"why": "test"},
}


async def test_export_shape_including_runtime_metadata_fields(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    graph = await _seed_graph(
        async_db_session,
        project,
        states=[_STATE_WITH_RUNTIME_META, _PLAIN_STATE],
        transitions=[_TRANSITION],
        name="exported",
    )
    async with make_client(owner) as client:
        resp = await client.get(
            f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}/export"
        )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "states": {
            "modal": {
                "id": "modal",
                "name": "Modal",
                "element_ids": ["m1"],
                "blocking": True,
                "blocks": ["home"],
                "group": "overlays",
                "path_cost": 2.5,
                "metadata": _STATE_WITH_RUNTIME_META["extra_metadata"],
            },
            "home": {
                "id": "home",
                "name": "Home",
                "element_ids": ["h1", "h2"],
                # Defaults when extra_metadata is empty.
                "blocking": False,
                "blocks": [],
                "group": None,
                "path_cost": 1.0,
                "metadata": {},
            },
        },
        "transitions": {
            "open_modal": {
                "id": "open_modal",
                "name": "Open modal",
                "from_states": ["home"],
                "activate_states": ["modal"],
                "exit_states": [],
                "actions": [{"type": "click", "target": "h1"}],
                "path_cost": 1.5,
                "stays_visible": True,
                "metadata": {"why": "test"},
            }
        },
        "config": {
            "name": "exported",
            "description": "seeded config",
            "render_count": 3,
            "element_count": 7,
        },
    }


@needs_pgvector
async def test_full_includes_states_knowledge_and_transitions(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
) -> None:
    graph = await _seed_graph(
        async_db_session,
        project,
        states=[_PLAIN_STATE, _STATE_WITH_RUNTIME_META],
        transitions=[_TRANSITION],
    )
    k1 = await _make_knowledge(async_db_session, project.id, "Second by order")
    k2 = await _make_knowledge(async_db_session, None, "First by order")
    state_url = (
        f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}"
        f"/states/{graph.state_ids['home']}/knowledge"
    )
    async with make_client(owner) as client:
        for kid, order in ((k1, 2), (k2, 1)):
            linked = await client.post(
                state_url, json={"knowledge_id": str(kid), "order": order}
            )
            assert linked.status_code == 200, linked.text
        resp = await client.get(
            f"{API}/projects/{project.id}/ui-bridge-configs/{graph.config_id}/full"
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(graph.config_id)
    assert [s["name"] for s in body["states"]] == ["Home", "Modal"]
    home, modal = body["states"]
    assert [k["id"] for k in home["domain_knowledge"]] == [str(k2), str(k1)]
    assert modal["domain_knowledge"] == []
    assert modal["extra_metadata"] == _STATE_WITH_RUNTIME_META["extra_metadata"]
    assert len(body["transitions"]) == 1
    t = body["transitions"][0]
    assert t["transition_id"] == "open_modal"
    assert t["actions"] == [{"type": "click", "target": "h1"}]
    assert t["extra_metadata"] == {"why": "test"}


# =============================================================================
# Runner-dispatch flows: discover + pathfind
# =============================================================================


def _own(logs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """This module's runner events only.

    Unrelated lines can land in the capture (e.g. ``redis_client_initialized``
    from the lazy client ``get_redis()`` builds on first use), so the
    observability contract is asserted over the ``ui_bridge_*`` events alone.
    """
    return [e for e in logs if str(e.get("event", "")).startswith("ui_bridge_")]


def _events(logs: list[dict[str, Any]]) -> list[str]:
    return [e["event"] for e in _own(logs)]


async def _discover(
    client: httpx.AsyncClient, project: Project, runner_id: UUID | None = None
) -> httpx.Response:
    params = {"runner_id": str(runner_id)} if runner_id else None
    return await client.post(
        f"{API}/projects/{project.id}/ui-bridge-discover",
        params=params,
        json={
            "config_name": "discovered",
            "config_description": "from renders",
            "renders": [{"id": "r1"}, {"id": "r2"}],
            "include_html_ids": True,
            "strategy": "fingerprint",
        },
    )


async def _pathfind(
    client: httpx.AsyncClient,
    project: Project,
    config_id: UUID,
    runner_id: UUID | None = None,
) -> httpx.Response:
    params = {"runner_id": str(runner_id)} if runner_id else None
    return await client.post(
        f"{API}/projects/{project.id}/ui-bridge-configs/{config_id}/pathfind",
        params=params,
        json={"from_states": ["home"], "target_states": ["modal"]},
    )


@dataclass
class RunnerCase:
    """One runner route, called uniformly so the shared arms run for both."""

    name: str
    prefix: str  # structlog event prefix
    endpoint: str  # the `endpoint` string in the 503/504 envelope

    async def call(
        self,
        client: httpx.AsyncClient,
        project: Project,
        graph: Graph,
        runner_id: UUID | None = None,
    ) -> httpx.Response:
        if self.name == "discover":
            return await _discover(client, project, runner_id)
        return await _pathfind(client, project, graph.config_id, runner_id)


RUNNER_CASES = [
    RunnerCase("discover", "ui_bridge_discover_save", DISCOVER_ENDPOINT),
    RunnerCase("pathfind", "ui_bridge_pathfind", PATHFIND_ENDPOINT),
]


@pytest_asyncio.fixture()
async def runner_graph(async_db_session: AsyncSession, project: Project) -> Graph:
    return await _seed_graph(
        async_db_session,
        project,
        states=[_PLAIN_STATE, _STATE_WITH_RUNTIME_META],
        transitions=[_TRANSITION],
        name="graph-for-pathfind",
    )


@pytest.mark.parametrize("case", RUNNER_CASES, ids=lambda c: c.name)
async def test_runner_route_503_when_no_runner_connected(
    case: RunnerCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    runner_graph: Graph,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    # A paired device exists but has no live socket: the auto-pick finds none.
    await _make_device(async_db_session, user=owner, name="offline")
    async with make_client(owner) as client:
        resp = await case.call(client, project, runner_graph)
    assert resp.status_code == 503, resp.text
    detail = resp.json()["detail"]
    assert detail["error"] == "no_runner_connected"
    assert detail["endpoint"] == case.endpoint
    fake_runner_manager.dispatch.assert_not_awaited()


@pytest.mark.parametrize("case", RUNNER_CASES, ids=lambda c: c.name)
async def test_runner_route_foreign_runner_id_is_404(
    case: RunnerCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    stranger: User,
    runner_graph: Graph,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    theirs = await _make_device(async_db_session, user=stranger, name="theirs")
    fake_runner_manager.connect(theirs)  # connected, but not the caller's
    async with make_client(owner) as client:
        foreign = await case.call(client, project, runner_graph, theirs.device_id)
        unknown_id = uuid4()
        unknown = await case.call(client, project, runner_graph, unknown_id)
    assert foreign.status_code == 404, foreign.text
    assert foreign.json()["detail"] == {
        "error": "runner_not_found",
        "runner_id": str(theirs.device_id),
    }
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == {
        "error": "runner_not_found",
        "runner_id": str(unknown_id),
    }
    fake_runner_manager.dispatch.assert_not_awaited()


@pytest.mark.parametrize("case", RUNNER_CASES, ids=lambda c: c.name)
async def test_runner_route_explicit_runner_registered_check(
    case: RunnerCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    runner_graph: Graph,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    """An owned but unregistered ``runner_id`` is a 503 — it is not re-picked."""
    mine_offline = await _make_device(async_db_session, user=owner, name="mine-off")
    mine_online = await _make_device(async_db_session, user=owner, name="mine-on")
    fake_runner_manager.connect(mine_online)
    async with make_client(owner) as client:
        resp = await case.call(client, project, runner_graph, mine_offline.device_id)
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["error"] == "no_runner_connected"
    assert resp.json()["detail"]["endpoint"] == case.endpoint
    fake_runner_manager.dispatch.assert_not_awaited()


@pytest.mark.parametrize("case", RUNNER_CASES, ids=lambda c: c.name)
async def test_runner_route_disconnect_mid_dispatch_is_503(
    case: RunnerCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    runner_graph: Graph,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    device = await _make_device(async_db_session, user=owner, name="flaky")
    fake_runner_manager.connect(device)
    fake_runner_manager.dispatch.side_effect = RunnerNotConnectedError("gone")
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            resp = await case.call(client, project, runner_graph)
    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["error"] == "no_runner_connected"
    assert resp.json()["detail"]["endpoint"] == case.endpoint
    assert _events(logs) == [
        f"{case.prefix}_dispatch",
        f"{case.prefix}_runner_disconnected_mid_dispatch",
    ]
    assert _own(logs)[1]["runner_id"] == str(device.device_id)
    assert _own(logs)[1]["log_level"] == "warning"


@pytest.mark.parametrize("case", RUNNER_CASES, ids=lambda c: c.name)
async def test_runner_route_timeout_is_504(
    case: RunnerCase,
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    runner_graph: Graph,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    device = await _make_device(async_db_session, user=owner, name="slow")
    fake_runner_manager.connect(device)
    fake_runner_manager.dispatch.side_effect = RunnerCommandTimeoutError(
        str(device.device_id), "req", 30.0
    )
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            resp = await case.call(client, project, runner_graph)
    assert resp.status_code == 504, resp.text
    request_id = fake_runner_manager.sent_kwargs["request_id"]
    assert resp.json()["detail"] == {
        "error": "runner_timeout",
        "endpoint": case.endpoint,
        "request_id": request_id,
    }
    assert fake_runner_manager.sent_kwargs["timeout_s"] == 30.0
    assert _events(logs) == [f"{case.prefix}_dispatch", f"{case.prefix}_timeout"]
    assert _own(logs)[1]["log_level"] == "error"
    assert _own(logs)[1]["request_id"] == request_id


async def test_discover_success_persists_config_and_states(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    other = await _make_device(async_db_session, user=owner, name="other")
    device = await _make_device(async_db_session, user=owner, name="picked")
    fake_runner_manager.connect(device)

    def _respond(runner_id: str, cmd: dict[str, Any], **kw: Any) -> dict[str, Any]:
        return {
            "type": "command_response",
            "command": "state_machine.ui_bridge.discover",
            "request_id": kw["request_id"],
            "states": [
                {
                    "id": "s_login",
                    "name": "Login",
                    "element_ids": ["u", "p"],
                    "render_ids": ["r1"],
                    "confidence": 0.75,
                },
                {"id": "s_home", "name": "Home"},
            ],
            "elements": [],
            "element_to_renders": {"u": ["r1"]},
            "render_count": 2,
            "unique_element_count": 3,
            "strategy_used": "fingerprint",
            "strategy_metadata": {"k": 1},
        }

    fake_runner_manager.dispatch.side_effect = _respond
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            resp = await _discover(client, project)
    assert resp.status_code == 201, resp.text

    # Auto-pick chose the connected device, not the other paired one.
    assert fake_runner_manager.dispatch.await_args.args[0] == str(device.device_id)
    assert str(other.device_id) not in fake_runner_manager.registry.connected
    cmd = fake_runner_manager.sent_command
    assert cmd["command"] == "state_machine.ui_bridge.discover"
    assert cmd["project_id"] == str(project.id)
    assert cmd["renders"] == [{"id": "r1"}, {"id": "r2"}]
    assert cmd["strategy"] == "fingerprint"
    assert cmd["include_html_ids"] is True
    assert cmd["request_id"] == fake_runner_manager.sent_kwargs["request_id"]
    assert fake_runner_manager.sent_kwargs["timeout_s"] == 30.0

    body = resp.json()
    assert body["render_count"] == 2
    assert body["unique_element_count"] == 3
    assert body["config"]["name"] == "discovered"
    assert body["config"]["description"] == "from renders"
    assert body["config"]["render_count"] == 2
    assert body["config"]["element_count"] == 3
    assert body["config"]["include_html_ids"] is True
    assert [s["state_id"] for s in body["states"]] == ["s_login", "s_home"]
    login, home = body["states"]
    assert login["element_ids"] == ["u", "p"]
    assert login["render_ids"] == ["r1"]
    assert login["confidence"] == 0.75
    assert login["domain_knowledge"] == []
    assert home["element_ids"] == []
    assert home["confidence"] == 0.0

    config_id = UUID(body["config"]["id"])
    row = (
        await async_db_session.execute(
            select(UIBridgeStateConfig).where(UIBridgeStateConfig.id == config_id)
        )
    ).scalar_one()
    assert row.project_id == project.id
    assert row.discovery_result == {
        "element_to_renders": {"u": ["r1"]},
        "strategy_used": "fingerprint",
        "strategy_metadata": {"k": 1},
    }
    states = (
        (
            await async_db_session.execute(
                select(UIBridgeState)
                .where(UIBridgeState.config_id == config_id)
                .order_by(UIBridgeState.state_id)
            )
        )
        .scalars()
        .all()
    )
    assert [(s.state_id, s.name, s.confidence) for s in states] == [
        ("s_home", "Home", 0.0),
        ("s_login", "Login", 0.75),
    ]
    assert {str(s.id) for s in states} == {s["id"] for s in body["states"]}

    assert _events(logs) == [
        "ui_bridge_discover_save_dispatch",
        "ui_bridge_discover_save_completed",
    ]
    assert _own(logs)[1]["states_persisted"] == 2
    assert _own(logs)[1]["config_id"] == str(config_id)


async def test_discover_runner_error_is_500_and_persists_nothing(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    device = await _make_device(async_db_session, user=owner, name="erring")
    fake_runner_manager.connect(device)
    fake_runner_manager.dispatch.return_value = {
        "type": "command_response",
        "error": "qontinui_exception",
        "message": "boom",
    }
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            resp = await client.post(
                f"{API}/projects/{project.id}/ui-bridge-discover",
                params={"runner_id": str(device.device_id)},
                json={"renders": []},
            )
    assert resp.status_code == 500, resp.text
    assert resp.json()["detail"] == {
        "error": "runner_error",
        "runner_error": "qontinui_exception",
        "message": "boom",
    }
    assert fake_runner_manager.dispatch.await_args.args[0] == str(device.device_id)
    assert _events(logs) == [
        "ui_bridge_discover_save_dispatch",
        "ui_bridge_discover_save_runner_error",
    ]
    rows = await async_db_session.execute(
        select(UIBridgeStateConfig.id).where(
            UIBridgeStateConfig.project_id == project.id
        )
    )
    assert rows.all() == []

    # No message from the runner -> the default one.
    fake_runner_manager.dispatch.return_value = {"error": "internal_error"}
    async with make_client(owner) as client:
        resp2 = await client.post(
            f"{API}/projects/{project.id}/ui-bridge-discover", json={"renders": []}
        )
    assert resp2.status_code == 500
    assert resp2.json()["detail"]["message"] == "Runner returned an error."


async def test_pathfind_success_sends_graph_and_maps_steps(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    runner_graph: Graph,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    device = await _make_device(async_db_session, user=owner, name="pf")
    fake_runner_manager.connect(device)

    def _respond(runner_id: str, cmd: dict[str, Any], **kw: Any) -> dict[str, Any]:
        return {
            "type": "command_response",
            "command": "state_machine.ui_bridge.pathfind",
            "request_id": kw["request_id"],
            "found": True,
            "steps": [
                {
                    "transition_id": "open_modal",
                    "transition_name": "Open modal",
                    "from_states": ["home"],
                    "activate_states": ["modal"],
                    "exit_states": [],
                    "path_cost": 1.5,
                }
            ],
            "total_cost": 1.5,
        }

    fake_runner_manager.dispatch.side_effect = _respond
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            resp = await _pathfind(
                client, project, runner_graph.config_id, device.device_id
            )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "found": True,
        "steps": [
            {
                "transition_id": "open_modal",
                "transition_name": "Open modal",
                "from_states": ["home"],
                "activate_states": ["modal"],
                "exit_states": [],
                "path_cost": 1.5,
            }
        ],
        "total_cost": 1.5,
        "error": None,
    }

    cmd = fake_runner_manager.sent_command
    assert cmd["command"] == "state_machine.ui_bridge.pathfind"
    assert cmd["config_id"] == str(runner_graph.config_id)
    assert cmd["from_states"] == ["home"]
    assert cmd["target_states"] == ["modal"]
    # Characterizes the documented gap: the pathfind payload carries only these
    # three state keys — NOT blocking/blocks/group/path_cost, which export emits.
    assert cmd["config"]["states"] == [
        {"state_id": "home", "name": "Home", "element_ids": ["h1", "h2"]},
        {"state_id": "modal", "name": "Modal", "element_ids": ["m1"]},
    ]
    assert cmd["config"]["transitions"] == [
        {
            "transition_id": "open_modal",
            "name": "Open modal",
            "from_states": ["home"],
            "activate_states": ["modal"],
            "exit_states": [],
            "actions": [{"type": "click", "target": "h1"}],
            "path_cost": 1.5,
            "stays_visible": True,
        }
    ]
    assert _events(logs) == [
        "ui_bridge_pathfind_dispatch",
        "ui_bridge_pathfind_completed",
    ]
    assert _own(logs)[0]["state_count"] == 2
    assert _own(logs)[0]["transition_count"] == 1
    assert _own(logs)[1]["found"] is True


async def test_pathfind_runner_error_and_no_path_are_found_false(
    make_client: ClientFactory,
    async_db_session: AsyncSession,
    project: Project,
    owner: User,
    runner_graph: Graph,
    fake_runner_manager: FakeRunnerManager,
) -> None:
    device = await _make_device(async_db_session, user=owner, name="pf-err")
    fake_runner_manager.connect(device)

    # Runner-side exception envelope (no `found`): 200 with found=False.
    fake_runner_manager.dispatch.return_value = {
        "type": "command_response",
        "command": "state_machine.ui_bridge.pathfind",
        "request_id": str(uuid4()),
        "error": "multistate_unavailable",
        "message": "no multistate",
    }
    with structlog.testing.capture_logs() as logs:
        async with make_client(owner) as client:
            err = await _pathfind(client, project, runner_graph.config_id)
    assert err.status_code == 200, err.text
    assert err.json() == {
        "found": False,
        "steps": [],
        "total_cost": 0.0,
        "error": "Runner error (multistate_unavailable): no multistate",
    }
    assert _events(logs) == [
        "ui_bridge_pathfind_dispatch",
        "ui_bridge_pathfind_runner_error",
    ]

    # A genuine "no path" answer carries `found` and passes its error through.
    fake_runner_manager.dispatch.return_value = {
        "type": "command_response",
        "command": "state_machine.ui_bridge.pathfind",
        "request_id": str(uuid4()),
        "found": False,
        "error": "no path between states",
    }
    async with make_client(owner) as client:
        none = await _pathfind(client, project, runner_graph.config_id)
    assert none.status_code == 200
    assert none.json() == {
        "found": False,
        "steps": [],
        "total_cost": 0.0,
        "error": "no path between states",
    }


# =============================================================================
# Coverage — must stay the LAST test in this module
# =============================================================================


def _module_routes() -> set[tuple[str, str]]:
    from app.main import app as main_app

    found: set[tuple[str, str]] = set()
    for route in main_app.routes:
        if not isinstance(route, APIRoute):
            continue
        if not route.endpoint.__module__.startswith(ENDPOINT_MODULE):
            continue
        for method in route.methods:
            found.add((method, route.path))
    return found


async def test_route_catalog_matches_the_mounted_app() -> None:
    assert _module_routes() == EXPECTED_ROUTES
    assert len(EXPECTED_ROUTES) == 29


async def test_every_route_is_exercised(request: pytest.FixtureRequest) -> None:
    """Every route the real app mounts from the module was reached by a test.

    Only meaningful when the whole module ran in this process, in file order,
    with nothing skipped — otherwise it skips and says why rather than passing.
    """
    module = request.module
    selected = {
        getattr(i, "originalname", i.name)
        for i in request.session.items
        if getattr(i, "module", None) is module
    }
    defined = {name for name in vars(module) if name.startswith("test_")}
    if not defined <= selected:
        pytest.skip(
            f"coverage needs the whole module; not selected: {sorted(defined - selected)}"
        )
    if os.environ.get("PYTEST_XDIST_WORKER") and request.config.getoption(
        "dist", "no"
    ) not in ("loadfile", "loadscope", "loadgroup"):
        pytest.skip("coverage needs the whole module in one xdist worker")
    if _PGVECTOR_SKIPS:
        pytest.skip(
            f"coverage incomplete: {len(_PGVECTOR_SKIPS)} pgvector test(s) skipped"
        )
    missing = sorted(_module_routes() - _EXERCISED)
    assert not missing, f"routes no behavioural test reached: {missing}"
