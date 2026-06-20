"""Tests for the ``GET /operations/fleet`` stat-row totals.

Regression guard: the FleetOverview stat row
(``frontend/src/components/operations/FleetOverview.tsx``) reads
``total_runners`` / ``total_healthy`` / ``total_running_tasks`` from the
``/operations/fleet`` response. The endpoint used to omit all three (only
``total_claude_sessions`` was emitted), so the stat row rendered zeros
regardless of fleet state.

Pattern mirrors :mod:`test_operations_device_status` — minimal FastAPI app
with the operations router, dependency overrides for auth/DB, and a real
in-memory ``FleetRegistry`` for the beacon half.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "fleet.totals@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: _empty_names_db()
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


def _empty_names_db() -> Any:
    """A minimal async-DB stand-in for the per-user machine-display-name SELECT.

    ``get_fleet_status`` issues ``await db.execute(select(MachineDisplayName...))``
    and reads ``result.tuples().all()`` to build the ``machine_display_names``
    map. These tests don't exercise display names, so the mock returns an empty
    result → ``machine_display_names == {}`` while keeping every other assertion
    (totals, scoping) unchanged.
    """
    result = MagicMock()
    result.tuples.return_value.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


def _db_device(
    *,
    hostname: str,
    port: int,
    ws_connected: bool,
    derived_status: str = "offline",
) -> Any:
    """A minimal stand-in for a ``coord.devices`` ORM row.

    ``_device_to_wire`` + ``_derive_status`` only touch the attributes
    below. A WS-connected device derives ``healthy`` unconditionally; a
    disconnected one with a stale/absent heartbeat derives from the stored
    ``derived_status`` column (liveness claims decay to ``offline``).
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
        ws_session_id="ws-session" if ws_connected else None,
        ui_error=None,
        recent_crash=None,
        derived_status=derived_status,
        last_heartbeat=now if ws_connected else None,
        created_at=now,
        ci_runner_status=None,
        ci_runner_labels=None,
        ci_runner_last_job_at=None,
    )


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


class TestFleetTotals:
    def test_totals_present_and_correct(self, client: TestClient) -> None:
        """2 DB devices (1 healthy, 1 offline) + 1 healthy beacon runner."""
        import asyncio

        from app.schemas.dev_dashboard import ClaudeSessionReport, RunnerHeartbeat
        from app.services.dev_dashboard_service import FleetRegistry

        # Heartbeat-only beacon on an *owned* host (db-healthy) but a
        # different port — i.e. a second un-paired instance on a machine the
        # caller already has a device on. The cross-tenant scoping guard in
        # ``get_fleet_status`` admits this one; the rejected case is covered by
        # ``test_beacon_on_unowned_host_is_filtered``.
        registry = FleetRegistry()
        asyncio.run(
            registry.register_heartbeat(
                RunnerHeartbeat(
                    hostname="db-healthy",
                    ip="192.168.1.50",
                    port=9877,
                    instance_name="primary",
                    os="windows",
                    running_task_count=3,
                    running_task_ids=["t1", "t2", "t3"],
                )
            )
        )
        asyncio.run(
            registry.report_claude_sessions(
                ClaudeSessionReport(
                    hostname="db-healthy",
                    sessions=[
                        {"pid": 101, "working_directory": "D:/repo-a"},
                        {"pid": 102, "working_directory": "D:/repo-b"},
                    ],
                )
            )
        )

        db_devices = [
            _db_device(hostname="db-healthy", port=9876, ws_connected=True),
            _db_device(hostname="db-offline", port=9876, ws_connected=False),
        ]

        with (
            patch(
                "app.api.v1.endpoints.operations.runner_crud.list_runners",
                AsyncMock(return_value=db_devices),
            ),
            patch(
                "app.api.v1.endpoints.operations.get_fleet_registry",
                return_value=registry,
            ),
        ):
            resp = client.get(f"{API_PREFIX}/fleet")

        assert resp.status_code == 200
        body = resp.json()

        # The merged list: 2 DB devices + 1 heartbeat-only beacon on an owned
        # host. Keyed by (hostname, port) because the beacon shares the
        # db-healthy hostname on a different port.
        assert len(body["runners"]) == 3
        assert body["total_runners"] == 3

        by_key = {(r["hostname"], r["port"]): r for r in body["runners"]}
        assert by_key[("db-healthy", 9876)]["derivedStatus"] == "healthy"
        assert by_key[("db-offline", 9876)]["derivedStatus"] == "offline"
        # The fresh beacon (db-healthy:9877) is admitted and healthy.
        assert by_key[("db-healthy", 9877)]["derivedStatus"] == "healthy"
        # Healthy = WS-connected DB device + fresh beacon; offline excluded.
        assert body["total_healthy"] == 2

        # Heartbeat-reported running tasks from the (owned) beacon.
        assert body["total_running_tasks"] == 3

        # Pre-existing aggregate keeps working (sessions on an owned host).
        assert body["total_claude_sessions"] == 2

        # Per-user machine display names are folded into the fleet read;
        # empty (no names saved) for this test.
        assert body["machine_display_names"] == {}

    def test_beacon_on_unowned_host_is_filtered(self, client: TestClient) -> None:
        """Cross-tenant regression guard: a beacon from a host the caller owns
        no device on must not appear in the caller's fleet, contribute to
        totals, or leak its Claude sessions."""
        import asyncio

        from app.schemas.dev_dashboard import ClaudeSessionReport, RunnerHeartbeat
        from app.services.dev_dashboard_service import FleetRegistry

        registry = FleetRegistry()
        asyncio.run(
            registry.register_heartbeat(
                RunnerHeartbeat(
                    hostname="other-tenant-host",
                    ip="10.0.0.9",
                    port=9876,
                    instance_name="primary",
                    os="windows",
                    running_task_count=5,
                    running_task_ids=["x1", "x2", "x3", "x4", "x5"],
                )
            )
        )
        asyncio.run(
            registry.report_claude_sessions(
                ClaudeSessionReport(
                    hostname="other-tenant-host",
                    sessions=[{"pid": 1, "working_directory": "D:/secret"}],
                )
            )
        )

        db_devices = [_db_device(hostname="db-mine", port=9876, ws_connected=True)]

        with (
            patch(
                "app.api.v1.endpoints.operations.runner_crud.list_runners",
                AsyncMock(return_value=db_devices),
            ),
            patch(
                "app.api.v1.endpoints.operations.get_fleet_registry",
                return_value=registry,
            ),
        ):
            resp = client.get(f"{API_PREFIX}/fleet")

        assert resp.status_code == 200
        body = resp.json()
        hostnames = {r["hostname"] for r in body["runners"]}
        assert "other-tenant-host" not in hostnames
        assert hostnames == {"db-mine"}
        assert body["total_runners"] == 1
        # The un-owned beacon's tasks and sessions must not leak into totals.
        assert body["total_running_tasks"] == 0
        assert body["total_claude_sessions"] == 0

    def test_totals_zero_on_empty_fleet(self, client: TestClient) -> None:
        from app.services.dev_dashboard_service import FleetRegistry

        with (
            patch(
                "app.api.v1.endpoints.operations.runner_crud.list_runners",
                AsyncMock(return_value=[]),
            ),
            patch(
                "app.api.v1.endpoints.operations.get_fleet_registry",
                return_value=FleetRegistry(),
            ),
        ):
            resp = client.get(f"{API_PREFIX}/fleet")

        assert resp.status_code == 200
        body = resp.json()
        assert body["runners"] == []
        assert body["total_runners"] == 0
        assert body["total_healthy"] == 0
        assert body["total_running_tasks"] == 0
        assert body["total_claude_sessions"] == 0
