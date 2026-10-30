"""The per-runner proxies GET only a task-run route, on a runner's own address.

``GET /operations/fleet/runners/{runner_id}/output`` and ``/workflow-state``
GET ``/task-runs/{task_run_id}/<route>`` from the address the unauthenticated
beacon (``POST /operations/heartbeat``) filed for that runner. Two inputs could
steer that GET to another route on whatever listens there, including
``GET /apps``: the app registry with every build and start command, which the
platform-admin gates on ``/fleet/apps`` and on the co-located runner proxy
exist to keep from a non-admin (coord finding
``b27adf71-4de5-49bc-ad89-7a8acd372035``).

* ``task_run_id`` was spliced into the path, and httpx resolves ``.`` and
  ``..`` segments and honours a ``?`` or ``#`` there: ``../../apps#`` sent
  ``GET /apps``.
* The beacon's ``ip`` was spliced into ``http://{ip}:{port}{path}``, so an
  ``ip`` of ``127.0.0.1:<port>/apps#`` chose the port and the path as well as
  the host.

The chain runs for real, as a signed-in NON-admin drives it: the
unauthenticated heartbeat files a host the caller owns a device on at the
address of a stand-in runner (a real HTTP server on loopback that records every
request target it receives), and the proxy reaches it through real httpx. The
one stand-in is ``runner_crud.list_runners``, which answers that the caller
owns a device on that host: owning one is the whole precondition the routes
check. What the stand-in runner RECEIVED is the evidence. A refused input must
leave it untouched, and a plain id must reach exactly its own task-run route.
"""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
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
#: composites, an underscore, a replay of a replay of a bare UUID (124
#: characters), and a replay of a replay of the longest minted base,
#: ``trigger-<uuid>-<ms>-<u8>`` (155 characters). Fixed values, so the
#: parametrized node ids are the same in every collection.
_U1 = "0f8c2a4e-7b1d-4c3a-9e5f-2d6b8a1c3e70"
_U2 = "5a9d3c1b-2e4f-4a6c-8b7d-1c3e5f7a9b20"
_U3 = "c4e6a8b0-d2f4-4e6a-8c0b-2d4f6a8c0e10"
LONGEST_REPLAY_ID = f"trigger-{_U1}-1700000000000-ab12cd34-replay-{_U2}-replay-{_U3}"
PLAIN_IDS = [
    _U1,
    "trigger-wf-1700000000000-ab12cd34",
    "ticket-github-42-ab12cd34",
    "unified_workflow_1",
    f"{_U1}-replay-{_U2}-replay-{_U3}",
    LONGEST_REPLAY_ID,
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

#: Beacon ``ip`` values that are not one IP address literal. ``{port}`` is the
#: stand-in runner's port, so the first value is the one that reached its
#: ``GET /apps`` while ``ip`` was spliced into the URL.
HOSTILE_IPS = [
    "127.0.0.1:{port}/apps#",
    "127.0.0.1:{port}/apps?",
    "127.0.0.1/apps#",
    "127.0.0.1#",
    "acme@127.0.0.1",
    "localhost",
    "[::1]",
    "fe80::1%eth0",
    " 127.0.0.1",
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
def member(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """A signed-in non-admin who owns a device on ``HOST``."""
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    user = MagicMock()
    user.id = uuid4()
    user.is_active = True
    user.is_superuser = False
    app = FastAPI()
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[get_async_db] = lambda: MagicMock()
    app.include_router(operations_router, prefix=API_PREFIX)
    setattr_ops(
        monkeypatch,
        "runner_crud.list_runners",
        AsyncMock(return_value=[SimpleNamespace(hostname=HOST)]),
    )
    return TestClient(app)


@pytest.fixture()
def client(member: TestClient, runner: StandInRunner) -> TestClient:
    """``member``, with ``HOST`` filed at the stand-in runner's address through
    the real, unauthenticated heartbeat."""
    beacon = member.post(
        f"{API_PREFIX}/heartbeat",
        json={"hostname": HOST, "ip": "127.0.0.1", "port": runner.port, "os": "linux"},
    )
    assert beacon.status_code == 200, beacon.text
    return member


def _get(client: TestClient, port: int, route: str, task_run_id: str):
    return client.get(
        f"{API_PREFIX}/fleet/runners/{HOST}:{port}/{route}",
        params={"task_run_id": task_run_id},
    )


def _file_unvalidated(ip: str, port: int) -> None:
    """File ``HOST`` at ``ip``/``port`` through the registry's own write path,
    skipping only the heartbeat's validation: the registry's readers must stay
    honest whatever it holds."""
    from app.schemas.dev_dashboard import RunnerHeartbeat
    from app.services.dev_dashboard_service import get_fleet_registry

    beacon = RunnerHeartbeat.model_construct(
        hostname=HOST, ip=ip, port=port, os="linux"
    )
    asyncio.run(get_fleet_registry().register_heartbeat(beacon))


# ---------------------------------------------------------------------------
# task_run_id
# ---------------------------------------------------------------------------


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


def test_the_longest_plain_id_is_the_runners_worst_case() -> None:
    """A 67-character base plus two ``-replay-<uuid>`` (44 each)."""
    assert len(f"trigger-{_U1}-1700000000000-ab12cd34") == 67
    assert len(LONGEST_REPLAY_ID) == 155


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


# ---------------------------------------------------------------------------
# The beacon's address
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("ip", HOSTILE_IPS)
def test_a_beacon_ip_that_is_not_one_address_is_refused_at_the_door(
    member: TestClient, runner: StandInRunner, route: str, ip: str
) -> None:
    beacon = member.post(
        f"{API_PREFIX}/heartbeat",
        json={
            "hostname": HOST,
            "ip": ip.format(port=runner.port),
            "port": 1,
            "os": "linux",
        },
    )
    resp = _get(member, 1, route, "abc")

    assert beacon.status_code == 422, beacon.text
    assert resp.status_code == 404, resp.text
    assert runner.seen == [], f"the runner was contacted: {runner.seen}"


@pytest.mark.parametrize(
    ("sent", "stored"),
    [
        ("127.0.0.1", "127.0.0.1"),
        ("192.168.8.192", "192.168.8.192"),
        ("0:0:0:0:0:0:0:1", "::1"),
        ("FE80::1", "fe80::1"),
    ],
)
def test_a_beacon_ip_is_filed_in_its_canonical_form(
    member: TestClient, sent: str, stored: str
) -> None:
    beacon = member.post(
        f"{API_PREFIX}/heartbeat",
        json={"hostname": HOST, "ip": sent, "port": 9876, "os": "linux"},
    )

    assert beacon.status_code == 200, beacon.text
    assert beacon.json()["ip"] == stored


@pytest.mark.parametrize("route", ROUTES)
def test_a_filed_address_that_is_no_host_is_never_dialled_by_the_proxy(
    member: TestClient, runner: StandInRunner, route: str
) -> None:
    _file_unvalidated(f"127.0.0.1:{runner.port}/apps#", 1)

    resp = _get(member, 1, route, "abc")

    assert resp.status_code == 404, resp.text
    assert runner.seen == [], f"the runner was contacted: {runner.seen}"
    assert "buildCommand" not in resp.text


def test_a_filed_address_that_is_no_host_is_never_dialled_by_the_task_fan_out(
    member: TestClient, runner: StandInRunner
) -> None:
    _file_unvalidated(f"127.0.0.1:{runner.port}/apps#", 1)

    resp = member.get(f"{API_PREFIX}/fleet/tasks")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"task_runs": [], "total": 0}
    assert runner.seen == [], f"the runner was contacted: {runner.seen}"


def test_the_task_fan_out_reaches_a_filed_runner_at_its_task_runs_route(
    client: TestClient, runner: StandInRunner
) -> None:
    resp = client.get(f"{API_PREFIX}/fleet/tasks")

    assert resp.status_code == 200, resp.text
    assert runner.seen == ["/task-runs/running"]


@pytest.mark.parametrize(
    ("ip", "url"),
    [
        ("127.0.0.1", "http://127.0.0.1:9876/task-runs/running"),
        ("::1", "http://[::1]:9876/task-runs/running"),
        ("fe80::1", "http://[fe80::1]:9876/task-runs/running"),
    ],
)
def test_a_runner_url_is_composed_with_ipv6_bracketed(ip: str, url: str) -> None:
    from app.schemas.dev_dashboard import RegisteredRunner
    from app.services.dev_dashboard_service import _runner_url

    filed = RegisteredRunner(
        id=f"{HOST}:9876",
        hostname=HOST,
        ip=ip,
        port=9876,
        os="linux",
        last_heartbeat=datetime.now(UTC),
    )

    assert str(_runner_url(filed, "/task-runs/running")) == url
