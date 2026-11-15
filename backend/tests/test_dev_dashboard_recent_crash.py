"""The HTTP heartbeat's ``recent_crash`` reaches a beacon-only fleet row.

The runner's HTTP heartbeat (``heartbeat.rs`` ``HeartbeatRecentCrash``,
snake_case, optional sections omitted) carries the most recent crash dump and
the pid of the crashed process (qontinui-runner#2551 / #2722). A paired runner's
row takes its crash from ``coord.devices``. A beacon-only runner has no such
row, so before this its fleet row hard-coded ``recentCrash: None`` and the dump
was dropped at ingest.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.schemas.dev_dashboard import RunnerHeartbeat, RunnerHeartbeatCrash
from tests._ops_patch import patch_ops

API_PREFIX = "/api/v1/operations"

# Exactly what ``HeartbeatRecentCrash`` serializes for a full dump.
RUST_RECENT_CRASH: dict[str, Any] = {
    "file_path": "C:/Users/x/.qontinui/crash-dumps/crash_1.txt",
    "reported_at": "2026-11-08T00:00:00Z",
    "panic_location": "src/main.rs:1:1",
    "panic_message": "boom",
    "thread": "main",
    "pid": 4242,
}


@pytest.fixture(autouse=True)
def _fresh_fleet_registry() -> Iterator[None]:
    import app.services.dev_dashboard_service as svc

    svc._fleet_registry = None
    yield
    svc._fleet_registry = None


def _names_db() -> Any:
    result = MagicMock()
    result.tuples.return_value.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.fixture()
def client() -> TestClient:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    user = MagicMock()
    user.id = uuid4()
    user.is_active = True
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[get_async_db] = lambda: _names_db()
    app.include_router(operations_router, prefix=API_PREFIX)
    return TestClient(app)


def _heartbeat(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "hostname": "spaceship",
        "ip": "192.168.8.192",
        "port": 9876,
        "os": "windows",
    }
    payload.update(overrides)
    return payload


def _owned_device(*, hostname: str, port: int) -> Any:
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
        derived_status="healthy",
        last_heartbeat=None,
        created_at=datetime.now(UTC),
        capability_user_paired=True,
        ci_runner_status=None,
        ci_runner_labels=None,
        ci_runner_last_job_at=None,
        is_ci_runner=False,
    )


def _beacon_row(client: TestClient) -> dict[str, Any]:
    # An owned device on the same host, different port, so the beacon is
    # the caller's and is merged in as its own beacon-only row.
    with patch_ops(
        "runner_crud.list_runners",
        new=AsyncMock(return_value=[_owned_device(hostname="spaceship", port=1)]),
    ):
        resp = client.get(f"{API_PREFIX}/fleet")
    assert resp.status_code == 200
    rows: list[dict[str, Any]] = resp.json()["runners"]
    return next(r for r in rows if r["id"] == "spaceship:9876")


class TestIngest:
    def test_model_fields_are_exactly_the_rust_serializers_keys(self) -> None:
        assert set(RunnerHeartbeatCrash.model_fields) == set(RUST_RECENT_CRASH)

    def test_crash_round_trips_through_the_heartbeat_route(
        self, client: TestClient
    ) -> None:
        resp = client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(recent_crash=RUST_RECENT_CRASH)
        )
        assert resp.status_code == 200
        assert resp.json()["recent_crash"] == RUST_RECENT_CRASH

    def test_malformed_crash_is_dropped_not_rejected(self, client: TestClient) -> None:
        # A 422 would lose the runner's liveness over one diagnostic field.
        for bad in ({"pid": 1}, {**RUST_RECENT_CRASH, "pid": -1}, "boom", 7):
            resp = client.post(
                f"{API_PREFIX}/heartbeat", json=_heartbeat(recent_crash=bad)
            )
            assert resp.status_code == 200, bad
            assert resp.json()["recent_crash"] is None, bad

    def test_text_is_bounded(self) -> None:
        cap = RunnerHeartbeatCrash.MAX_TEXT
        hb = RunnerHeartbeat.model_validate(
            _heartbeat(
                recent_crash={**RUST_RECENT_CRASH, "panic_message": "x" * (cap + 50)}
            )
        )
        assert hb.recent_crash is not None
        assert hb.recent_crash.panic_message == "x" * cap


class TestFleetView:
    def test_beacon_row_carries_the_crash_and_its_pid(self, client: TestClient) -> None:
        client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(recent_crash=RUST_RECENT_CRASH)
        )
        crash = _beacon_row(client)["recentCrash"]
        assert crash == {
            "filePath": RUST_RECENT_CRASH["file_path"],
            "panicMessage": "boom",
            "panicLocation": "src/main.rs:1:1",
            "thread": "main",
            "reportedAt": "2026-11-08T00:00:00Z",
            "pid": 4242,
        }

    def test_dump_without_sections_or_pid_renders_empty_text_and_unknown_pid(
        self, client: TestClient
    ) -> None:
        sparse = {
            "file_path": "C:/d/crash_2.txt",
            "reported_at": "2026-11-08T01:00:00Z",
        }
        client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat(recent_crash=sparse))
        crash = _beacon_row(client)["recentCrash"]
        assert crash["filePath"] == "C:/d/crash_2.txt"
        assert crash["panicMessage"] == ""
        assert crash["thread"] == ""
        assert crash["pid"] is None

    def test_no_crash_reads_none(self, client: TestClient) -> None:
        client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat())
        assert _beacon_row(client)["recentCrash"] is None

    def test_a_later_heartbeat_without_a_crash_clears_it(
        self, client: TestClient
    ) -> None:
        client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(recent_crash=RUST_RECENT_CRASH)
        )
        client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat())
        assert _beacon_row(client)["recentCrash"] is None
