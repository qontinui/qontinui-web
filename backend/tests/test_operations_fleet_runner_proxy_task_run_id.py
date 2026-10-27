"""A task-run id cannot rewrite the path the per-runner proxies GET.

``GET /operations/fleet/runners/{runner_id}/output`` and ``/workflow-state``
splice ``task_run_id`` into the path they request from the runner
(``/task-runs/{id}/output``). httpx resolves ``.`` and ``..`` segments and
honours a ``?`` or ``#`` it finds in that path, so while ``task_run_id`` was a
free string a caller chose ANY runner GET: ``../../apps#`` sent ``GET /apps``,
the app registry with every build and start command — the disclosure the
platform-admin gates on ``/fleet/apps`` and on the co-located runner proxy
exist to stop (coord finding ``b27adf71-4de5-49bc-ad89-7a8acd372035``).

The whole chain runs here for real, as a signed-in NON-admin drives it: the
unauthenticated ``POST /operations/heartbeat`` registers a host the caller owns
a device on at the address of a stand-in runner (a real HTTP server on
loopback that records every request line it receives), and the proxy reaches it
through real httpx. The one stand-in is ``runner_crud.list_runners``, which
answers that the caller owns a device on that host: owning one is the whole
precondition the routes check. What the stand-in runner RECEIVED is the
evidence — a refused id must leave it untouched, and a plain id must reach
exactly its own task-run route.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import setattr_ops

API_PREFIX = "/api/v1/operations"
HOST = "member-box"

#: What a runner's ``GET /apps`` answers: the registry, commands included.
APPS_BODY = {
    "ok": True,
    "apps": [
        {
            "appId": "acme-app",
            "displayName": "Acme",
            "buildCommand": "ACME_TOKEN=abc npm run build",
            "startCommand": "npm start",
        }
    ],
}

#: Ids of every shape the runner mints: a bare UUID, the trigger and ticket
#: composites, an underscore, and a replay of a replay (124 characters). Fixed
#: values, so the parametrized node ids are the same in every collection.
_U1 = "0f8c2a4e-7b1d-4c3a-9e5f-2d6b8a1c3e70"
_U2 = "5a9d3c1b-2e4f-4a6c-8b7d-1c3e5f7a9b20"
_U3 = "c4e6a8b0-d2f4-4e6a-8c0b-2d4f6a8c0e10"
PLAIN_IDS = [
    _U1,
    "trigger-wf-1700000000000-ab12cd34",
    "ticket-github-42-ab12cd34",
    "unified_workflow_1",
    f"{_U1}-replay-{_U2}-replay-{_U3}",
]

#: Ids that rewrite the runner path, or are no task-run id at all.
HOSTILE_IDS = [
    "../../apps#",
    "../../apps?x=",
    "x/../../apps#",
    "../apps#",
    "..",
    ".",
    "a/b",
    "a#b",
    "a?b",
    "%2e%2e",
    "a%2Fb",
    "a b",
    "a\\b",
    "",
]

ROUTES = ["output", "workflow-state"]


class StandInRunner:
    """A loopback HTTP server that records every request target it receives.

    ``GET /apps`` answers the registry, a ``/task-runs/<id>/<route>`` answers a
    small body naming the route, and anything else is a 404.
    """

    def __init__(self) -> None:
        self.seen: list[str] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - the stdlib's name
                outer.seen.append(self.path)
                route = self.path.split("?", 1)[0]
                if route == "/apps":
                    self._answer(200, APPS_BODY)
                elif route.startswith("/task-runs/"):
                    self._answer(200, {"ok": True, "route": route})
                else:
                    self._answer(404, {"error": "not found"})

            def _answer(self, status: int, body: dict) -> None:
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture(autouse=True)
def _fresh_fleet_registry() -> Iterator[None]:
    """Reset the process-global beacon registry around each test."""
    import app.services.dev_dashboard_service as svc

    svc._fleet_registry = None
    yield
    svc._fleet_registry = None


@pytest.fixture()
def runner() -> Iterator[StandInRunner]:
    stand_in = StandInRunner()
    try:
        yield stand_in
    finally:
        stand_in.close()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, runner: StandInRunner) -> TestClient:
    """A signed-in non-admin who owns a device on ``HOST``, whose beacon entry
    points at the stand-in runner — registered through the real,
    unauthenticated heartbeat."""
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    member = MagicMock()
    member.id = uuid4()
    member.is_active = True
    member.is_superuser = False
    app = FastAPI()
    app.dependency_overrides[get_current_active_user_async] = lambda: member
    app.dependency_overrides[get_async_db] = lambda: MagicMock()
    app.include_router(operations_router, prefix=API_PREFIX)
    setattr_ops(
        monkeypatch,
        "runner_crud.list_runners",
        AsyncMock(return_value=[SimpleNamespace(hostname=HOST)]),
    )

    test_client = TestClient(app)
    beacon = test_client.post(
        f"{API_PREFIX}/heartbeat",
        json={"hostname": HOST, "ip": "127.0.0.1", "port": runner.port, "os": "linux"},
    )
    assert beacon.status_code == 200, beacon.text
    return test_client


def _get(client: TestClient, port: int, route: str, task_run_id: str):
    return client.get(
        f"{API_PREFIX}/fleet/runners/{HOST}:{port}/{route}",
        params={"task_run_id": task_run_id},
    )


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("task_run_id", HOSTILE_IDS)
def test_a_path_rewriting_id_is_refused_before_the_runner_is_contacted(
    client: TestClient, runner: StandInRunner, route: str, task_run_id: str
) -> None:
    resp = _get(client, runner.port, route, task_run_id)

    assert resp.status_code == 422, resp.text
    assert runner.seen == [], f"the runner was contacted: {runner.seen}"
    assert "buildCommand" not in resp.text


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("task_run_id", PLAIN_IDS)
def test_a_plain_id_reaches_only_its_own_task_run_route(
    client: TestClient, runner: StandInRunner, route: str, task_run_id: str
) -> None:
    resp = _get(client, runner.port, route, task_run_id)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "route": f"/task-runs/{task_run_id}/{route}"}
    query = "?tail_chars=5000" if route == "output" else ""
    assert runner.seen == [f"/task-runs/{task_run_id}/{route}{query}"]


@pytest.mark.parametrize("route", ROUTES)
def test_the_length_bound_admits_256_characters_and_refuses_257(
    client: TestClient, runner: StandInRunner, route: str
) -> None:
    at_bound = _get(client, runner.port, route, "a" * 256)
    over_bound = _get(client, runner.port, route, "a" * 257)

    assert at_bound.status_code == 200, at_bound.text
    assert over_bound.status_code == 422, over_bound.text
    assert runner.seen == [
        f"/task-runs/{'a' * 256}/{route}"
        + ("?tail_chars=5000" if route == "output" else "")
    ]
