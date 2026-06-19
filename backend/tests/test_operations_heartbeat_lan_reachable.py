"""Tests for the optional ``lan_reachable`` heartbeat pass-through.

Plan ``D:/qontinui-root/plans/2026-06-12-mobile-account-usage-error-recovery.md``
(qontinui-runner P1 item, backend leg): runners that bind loopback-only
advertise a LAN IP they never serve. The runner heartbeat gains an
OPTIONAL ``lan_reachable: bool`` which the backend must:

* accept on ``POST /api/v1/operations/heartbeat`` (absent → ``None``,
  so pre-field runners keep working unchanged),
* persist on the in-memory fleet-registry record
  (``RegisteredRunner.lan_reachable``), and
* forward on the beacon wire shape merged into ``GET /operations/fleet``
  as ``lanReachable`` (next to ``ipAddress``) so mobile can avoid dead
  LAN hosts.

Testing pattern mirrors :mod:`test_operations_device_status` (minimal
FastAPI app + dependency overrides); the fleet registry singleton is
reset per-test so registrations don't leak between cases.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"


@pytest.fixture(autouse=True)
def _fresh_fleet_registry() -> Iterator[None]:
    """Reset the module-level FleetRegistry singleton around each test."""
    import app.services.dev_dashboard_service as svc

    svc._fleet_registry = None
    yield
    svc._fleet_registry = None


def _build_test_app() -> FastAPI:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "lan.reachable@example.com"
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _heartbeat_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "hostname": "spaceship",
        "ip": "192.168.8.192",
        "port": 9876,
        "os": "windows",
        "running_task_count": 0,
        "running_task_ids": [],
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# POST /operations/heartbeat — ingest
# ---------------------------------------------------------------------------


class TestHeartbeatIngest:
    def test_absent_field_is_accepted_and_null(self, client: TestClient) -> None:
        # Old runners that don't send lan_reachable MUST keep working
        # unchanged; the stored value is None (unknown), not False.
        resp = client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat_payload())
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "spaceship:9876"
        assert body["lan_reachable"] is None

    def test_false_is_persisted(self, client: TestClient) -> None:
        resp = client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat_payload(lan_reachable=False),
        )
        assert resp.status_code == 200
        assert resp.json()["lan_reachable"] is False

    def test_true_is_persisted(self, client: TestClient) -> None:
        resp = client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat_payload(lan_reachable=True),
        )
        assert resp.status_code == 200
        assert resp.json()["lan_reachable"] is True

    def test_later_heartbeat_overwrites_value(self, client: TestClient) -> None:
        # The registry keys on hostname:port; a runner that starts
        # reporting (or restarts without the field) must win over the
        # previous record.
        client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat_payload(lan_reachable=False),
        )
        resp = client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat_payload())
        assert resp.status_code == 200
        assert resp.json()["lan_reachable"] is None


# ---------------------------------------------------------------------------
# GET /operations/fleet — beacon wire shape forwarded to consumers
# ---------------------------------------------------------------------------


def _owned_device(*, hostname: str, port: int) -> Any:
    """Minimal ``coord.devices`` ORM stand-in the caller owns.

    `GET /fleet` scopes beacons to hostnames the caller owns a device on
    (cross-tenant guard), so to observe a beacon we must own a device on its
    host. Uses a *different* port than the beacon so the beacon is still
    merged (the db_keys skip is keyed on the (hostname, port) pair).
    """
    now = datetime.now(UTC)
    return SimpleNamespace(
        device_id=uuid4(),
        user_id=uuid4(),
        name=f"runner-{hostname}",
        hostname=hostname,
        port=port,
        os="windows",
        os_version="11",
        capabilities=[],
        ws_session_id=None,
        ui_error=None,
        recent_crash=None,
        derived_status="offline",
        last_heartbeat=None,
        created_at=now,
        ci_runner_status=None,
        ci_runner_labels=None,
        ci_runner_last_job_at=None,
    )


def _patch_owned_spaceship():
    """Caller owns a device on the ``spaceship`` host (different port), so the
    ``spaceship:9876`` beacon passes the cross-tenant scoping guard and is
    surfaced in ``GET /fleet``."""
    return patch(
        "app.api.v1.endpoints.operations.runner_crud.list_runners",
        new=AsyncMock(return_value=[_owned_device(hostname="spaceship", port=1)]),
    )


class TestFleetResponse:
    def _fleet_runner(self, client: TestClient, runner_id: str) -> dict[str, Any]:
        with _patch_owned_spaceship():
            resp = client.get(f"{API_PREFIX}/fleet")
        assert resp.status_code == 200
        runners = resp.json()["runners"]
        matches: list[dict[str, Any]] = [r for r in runners if r["id"] == runner_id]
        assert len(matches) == 1
        return matches[0]

    def test_beacon_forwards_false_next_to_ip(self, client: TestClient) -> None:
        client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat_payload(lan_reachable=False),
        )
        runner = self._fleet_runner(client, "spaceship:9876")
        assert runner["ipAddress"] == "192.168.8.192"
        assert runner["lanReachable"] is False

    def test_beacon_forwards_true(self, client: TestClient) -> None:
        client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat_payload(lan_reachable=True),
        )
        runner = self._fleet_runner(client, "spaceship:9876")
        assert runner["lanReachable"] is True

    def test_beacon_without_field_forwards_null(self, client: TestClient) -> None:
        # Back-compat: pre-field runners surface lanReachable=null so
        # consumers can distinguish "unknown" from "known dead".
        client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat_payload())
        runner = self._fleet_runner(client, "spaceship:9876")
        assert runner["lanReachable"] is None
