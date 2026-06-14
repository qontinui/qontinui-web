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
    test_app.dependency_overrides[get_async_db] = lambda: None
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


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

        registry = FleetRegistry()
        asyncio.run(
            registry.register_heartbeat(
                RunnerHeartbeat(
                    hostname="beacon-host",
                    ip="192.168.1.50",
                    port=9876,
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
                    hostname="beacon-host",
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

        # The merged list: 2 DB devices + 1 heartbeat-only beacon.
        assert len(body["runners"]) == 3
        assert body["total_runners"] == 3

        # Healthy = the WS-connected DB device + the fresh beacon. The
        # offline DB device must not count.
        statuses = {r["hostname"]: r["derivedStatus"] for r in body["runners"]}
        assert statuses["db-healthy"] == "healthy"
        assert statuses["db-offline"] == "offline"
        assert statuses["beacon-host"] == "healthy"
        assert body["total_healthy"] == 2

        # Heartbeat-reported running tasks from the beacon registry.
        assert body["total_running_tasks"] == 3

        # Pre-existing aggregate keeps working.
        assert body["total_claude_sessions"] == 2

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
