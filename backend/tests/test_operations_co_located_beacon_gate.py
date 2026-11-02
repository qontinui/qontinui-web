"""A beacon that names this backend's own host reaches its runner for an admin.

Coord finding ``e66c681f-ee4a-4056-aaa7-0212814aafcc``, item 2(d): the beacon
(``POST /operations/heartbeat``) takes no credential, so a signed-in non-admin
who owns a device on ``member-box`` could file it at ``127.0.0.1`` and read,
through ``/fleet/tasks`` and the two per-runner proxies, the running tasks,
prompts and output of whichever runner listens on this backend's loopback: the
runner ``device_bridge_ws.runner_proxy`` keeps for platform admins. The task was
labelled with the beacon's own hostname, so the owned-host filter passed it.
Item 2(b): ``/fleet/tasks`` dialled every filed address, whoever owned it, and
filtered only what it returned, so anyone signed in could make the backend dial
any address someone had filed.

The chain runs for real: the unauthenticated heartbeat files the host at a
stand-in runner's address, a real HTTP server on loopback that records every
request target. The one stand-in is ``runner_crud.list_runners``, which answers
what the caller owns. What the stand-in RECEIVED is the evidence.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.schemas.dev_dashboard import RunnerHeartbeat
from app.services import dev_dashboard_service as svc
from app.services.dev_dashboard_service import CoLocatedRunnerRefused, FleetRegistry
from tests._constraints_stand_in import Scripted, StandInRunner
from tests._ops_patch import setattr_ops

API_PREFIX = "/api/v1/operations"
HOST = "member-box"
TASK_RUN_ID = "trigger-wf-1700000000000-ab12cd34"
ROUTES = ["output", "workflow-state"]
RUNNING = {
    "scope": "workflow task-runs",
    "task_runs": [{"id": TASK_RUN_ID, "status": "running", "prompt": "do the thing"}],
}
REFUSAL = (
    "this runner's beacon names this server's own address, and tasks at that "
    "address are limited to platform administrators"
)


@pytest.fixture(autouse=True)
def _fresh_fleet_registry() -> Iterator[None]:
    svc._fleet_registry = None
    yield
    svc._fleet_registry = None


@pytest.fixture()
def runner() -> Iterator[StandInRunner]:
    stand_in = StandInRunner()
    stand_in.script("GET", "/task-runs/running", Scripted(200, json.dumps(RUNNING)))
    for route in ROUTES:
        stand_in.script(
            "GET",
            f"/task-runs/{TASK_RUN_ID}/{route}",
            Scripted(200, json.dumps({"ok": True, "route": route})),
        )
    try:
        yield stand_in
    finally:
        stand_in.close()


def _client_as(monkeypatch: pytest.MonkeyPatch, *, superuser: bool) -> TestClient:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    user = MagicMock()
    user.id = uuid4()
    user.is_active = True
    user.is_superuser = superuser
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


def _file(client: TestClient, ip: str, port: int, hostname: str = HOST) -> None:
    beacon = client.post(
        f"{API_PREFIX}/heartbeat",
        json={"hostname": hostname, "ip": ip, "port": port, "os": "linux"},
    )
    assert beacon.status_code == 200, beacon.text


def _proxy(client: TestClient, port: int, route: str):
    return client.get(
        f"{API_PREFIX}/fleet/runners/{HOST}:{port}/{route}",
        params={"task_run_id": TASK_RUN_ID},
    )


def _targets(runner: StandInRunner) -> list[str]:
    return [r.target for r in runner.received]


# ---------------------------------------------------------------------------
# Which addresses name this host
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "127.9.9.9",
        "::1",
        "0.0.0.0",
        "::",
        "::ffff:127.0.0.1",
        "::ffff:0.0.0.0",
        "192.0.2.10",
        "::ffff:192.0.2.10",
        "2001:db8::10",
    ],
)
def test_an_address_on_this_host_is_co_located(ip: str) -> None:
    assert svc._is_co_located(ip, {"192.0.2.10", "2001:db8::10"})


@pytest.mark.parametrize("ip", ["192.0.2.11", "::ffff:192.0.2.11", "2001:db8::11"])
def test_an_address_elsewhere_is_not(ip: str) -> None:
    assert not svc._is_co_located(ip, {"192.0.2.10", "2001:db8::10"})


@pytest.mark.parametrize("ip", ["localhost", "127.0.0.1:9876/apps#", ""])
def test_a_value_that_is_no_address_counts_as_this_host(ip: str) -> None:
    assert svc._is_co_located(ip, set())


def test_own_addresses_are_read_from_the_interfaces() -> None:
    assert "127.0.0.1" in svc._own_addresses()


def test_own_addresses_drop_an_ipv6_zone(monkeypatch: pytest.MonkeyPatch) -> None:
    import socket

    monkeypatch.setattr(
        svc.psutil,
        "net_if_addrs",
        lambda: {
            "eth0": [
                SimpleNamespace(family=socket.AF_INET6, address="fe80::1%eth0"),
                SimpleNamespace(family=-1, address="aa:bb:cc:dd:ee:ff"),
            ]
        },
    )

    assert svc._own_addresses() == frozenset({"fe80::1"})


def test_unreadable_interfaces_leave_the_loopback_check_standing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom() -> dict:
        raise OSError("no interfaces")

    monkeypatch.setattr(svc.psutil, "net_if_addrs", boom)

    assert svc._own_addresses() == frozenset()
    assert svc._is_co_located("127.0.0.1", svc._own_addresses())


# ---------------------------------------------------------------------------
# A non-admin
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_a_non_admin_is_refused_a_loopback_beacon_by_the_proxies(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner, route: str
) -> None:
    member = _client_as(monkeypatch, superuser=False)
    _file(member, "127.0.0.1", runner.port)

    resp = _proxy(member, runner.port, route)

    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == REFUSAL
    assert _targets(runner) == []


def test_the_refusal_carries_its_typed_envelope(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner
) -> None:
    """Through the production error handler, as a client receives it."""
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.main import app

    user = MagicMock(id=uuid4(), is_active=True, is_superuser=False)
    monkeypatch.setitem(
        app.dependency_overrides, get_current_active_user_async, lambda: user
    )
    monkeypatch.setitem(app.dependency_overrides, get_async_db, lambda: MagicMock())
    setattr_ops(
        monkeypatch,
        "runner_crud.list_runners",
        AsyncMock(return_value=[SimpleNamespace(hostname=HOST)]),
    )
    client = TestClient(app)
    _file(client, "127.0.0.1", runner.port)

    resp = _proxy(client, runner.port, "output")

    assert resp.status_code == 403, resp.text
    assert resp.json()["message"] == REFUSAL
    assert resp.json()["refusal"]["discriminator"] == "co_located_beacon_admin_only"
    assert resp.json()["refusal"]["next_action"]["kind"] == "none_terminal"
    assert _targets(runner) == []


def test_a_non_admin_is_refused_a_beacon_at_one_of_this_hosts_addresses(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner
) -> None:
    monkeypatch.setattr(svc, "_own_addresses", lambda: frozenset({"192.0.2.10"}))
    member = _client_as(monkeypatch, superuser=False)
    _file(member, "192.0.2.10", runner.port)

    assert _proxy(member, runner.port, "output").status_code == 403
    assert member.get(f"{API_PREFIX}/fleet/tasks").json() == {
        "task_runs": [],
        "total": 0,
        "withheld_co_located": 1,
    }


def test_a_non_admins_task_fan_out_does_not_dial_a_loopback_beacon(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner
) -> None:
    member = _client_as(monkeypatch, superuser=False)
    _file(member, "127.0.0.1", runner.port)

    resp = member.get(f"{API_PREFIX}/fleet/tasks")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"task_runs": [], "total": 0, "withheld_co_located": 1}
    assert _targets(runner) == []


# ---------------------------------------------------------------------------
# A platform admin
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("route", ROUTES)
def test_an_admin_reaches_a_loopback_beacon_through_the_proxies(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner, route: str
) -> None:
    admin = _client_as(monkeypatch, superuser=True)
    _file(admin, "127.0.0.1", runner.port)

    resp = _proxy(admin, runner.port, route)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "route": route}
    assert [t.split("?")[0] for t in _targets(runner)] == [
        f"/task-runs/{TASK_RUN_ID}/{route}"
    ]


def test_an_admin_reaches_a_loopback_beacon_through_the_task_fan_out(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner
) -> None:
    admin = _client_as(monkeypatch, superuser=True)
    _file(admin, "127.0.0.1", runner.port)

    resp = admin.get(f"{API_PREFIX}/fleet/tasks")

    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 1
    assert resp.json()["withheld_co_located"] == 0
    assert resp.json()["task_runs"][0]["id"] == TASK_RUN_ID
    assert _targets(runner) == ["/task-runs/running"]


# ---------------------------------------------------------------------------
# The fan-out's scope comes before the dial
# ---------------------------------------------------------------------------


def test_the_fan_out_never_dials_a_host_the_caller_does_not_own(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner
) -> None:
    """An admin, so the co-located rule is not what keeps it out."""
    admin = _client_as(monkeypatch, superuser=True)
    _file(admin, "127.0.0.1", runner.port, hostname="nobodys-box")

    resp = admin.get(f"{API_PREFIX}/fleet/tasks")

    assert resp.json() == {"task_runs": [], "total": 0, "withheld_co_located": 0}
    assert _targets(runner) == []


def test_a_non_admins_fan_out_dials_its_own_host_elsewhere(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner
) -> None:
    """The stand-in plays a runner on another host: loopback is the only
    address a test can serve, so this one case rules the address out."""
    monkeypatch.setattr(svc, "_is_co_located", lambda *_: False)
    member = _client_as(monkeypatch, superuser=False)
    _file(member, "127.0.0.1", runner.port)

    resp = member.get(f"{API_PREFIX}/fleet/tasks")

    assert resp.json()["total"] == 1
    assert _targets(runner) == ["/task-runs/running"]


def test_hostnames_match_whatever_their_case(
    monkeypatch: pytest.MonkeyPatch, runner: StandInRunner
) -> None:
    admin = _client_as(monkeypatch, superuser=True)
    _file(admin, "127.0.0.1", runner.port, hostname=HOST.upper())

    assert admin.get(f"{API_PREFIX}/fleet/tasks").json()["total"] == 1


# ---------------------------------------------------------------------------
# The registry judges the address it dials
# ---------------------------------------------------------------------------


def test_the_registry_itself_refuses_the_dial(runner: StandInRunner) -> None:
    registry = FleetRegistry()
    beacon = RunnerHeartbeat(
        hostname=HOST, ip="127.0.0.1", port=runner.port, os="linux"
    )
    asyncio.run(registry.register_heartbeat(beacon))

    with pytest.raises(CoLocatedRunnerRefused):
        asyncio.run(
            registry.proxy_runner_request(
                f"{HOST}:{runner.port}",
                "/task-runs/x/output",
                may_reach_co_located=False,
            )
        )

    assert _targets(runner) == []
