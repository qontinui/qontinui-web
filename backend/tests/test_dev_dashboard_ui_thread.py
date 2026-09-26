"""The fleet view must carry the runner's native UI-thread liveness block.

Plan
``2026-09-09-the-runner-ui-thread-liveness-block-is-emitted-to-three-sinks-and-read-by-none``,
Half 1.

The runner has published ``ui_thread`` on every heartbeat since 2026-08-19
(``qontinui-runner`` ``src-tauri/src/heartbeat.rs``, ``HeartbeatUiThread``),
and its own doc calls the block "the only path by which a wedged UI thread is
visible off-box". Until this change ``RunnerHeartbeat`` had no field for it, so
pydantic's default ``extra='ignore'`` dropped it at the door and nothing
anywhere read it.

These tests pin, end to end through the HTTP routes:

* a heartbeat carrying the block round-trips to ``POST /heartbeat``'s
  response AND to ``GET /fleet`` — for an unpaired beacon and, the common case,
  a PAIRED runner whose row is built from ``coord.devices``;
* an OMITTED block reads UNKNOWN (``None``), never a synthesized
  ``wedged: False``; and a ``wedged: null`` inside the block stays ``None``;
* the wire shape is the ten snake_case keys the Rust serializer emits (the
  cross-repo half of the contract — the Rust test
  ``payload_carries_the_native_ui_thread_block`` pins the same list);
* keys a newer runner adds ride through instead of being dropped.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.schemas.dev_dashboard import RunnerUiThread

API_PREFIX = "/api/v1/operations"

# Exactly what ``HeartbeatUiThread::new`` serializes (heartbeat.rs), in the
# 2026-08-19 wedged shape plus a live ping-suppression reading. Every key is
# always present on the Rust side — null rather than absent.
RUST_UI_THREAD_BLOCK: dict[str, Any] = {
    "wedged": True,
    "reason": "native_probe_wedged",
    "probe_wedged": True,
    "events_undelivered": True,
    "event_pong_age_ms": 400_000,
    "ping_delivery": "ping_undeliverable",
    "ping_emit_failures": 119_012,
    "last_ping_emit_ok_age_ms": 600_000,
    "last_ping_emit_fail_age_ms": 3_000,
    "false_death_suppressed": 49,
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
        ui_thread=None,
        derived_status="errored",
        last_heartbeat=None,
        created_at=datetime.now(UTC),
        capability_user_paired=True,
        ci_runner_status=None,
        ci_runner_labels=None,
        ci_runner_last_job_at=None,
        is_ci_runner=False,
    )


def _fleet_rows(client: TestClient, device: Any) -> list[dict[str, Any]]:
    with patch(
        "app.api.v1.endpoints.operations.runner_crud.list_runners",
        new=AsyncMock(return_value=[device]),
    ):
        resp = client.get(f"{API_PREFIX}/fleet")
    assert resp.status_code == 200
    rows: list[dict[str, Any]] = resp.json()["runners"]
    return rows


class TestWireShape:
    def test_model_fields_are_exactly_the_rust_serializers_keys(self) -> None:
        # A casing or naming drift on either side fails here: the Python
        # model's declared fields must be the ten snake_case keys the Rust
        # ``HeartbeatUiThread`` writes, no more and no fewer.
        assert set(RunnerUiThread.model_fields) == set(RUST_UI_THREAD_BLOCK)

    def test_camel_case_keys_do_not_populate_the_typed_fields(self) -> None:
        # The recorded incident: camelCase keys were silently dropped and a
        # literal "healthy" was written instead. A camelCase block must NOT
        # read as a real verdict.
        block = RunnerUiThread.model_validate({"probeWedged": True, "wedged": None})
        assert block.probe_wedged is None
        assert block.wedged is None

    def test_keys_a_newer_runner_adds_ride_through(self) -> None:
        block = RunnerUiThread.model_validate(
            {**RUST_UI_THREAD_BLOCK, "pong_receive_age_ms": 1_234}
        )
        assert block.model_dump(mode="json")["pong_receive_age_ms"] == 1_234

    def test_extras_are_bounded_not_rejected(self) -> None:
        # The route is unauthenticated and the registry lives in memory, so
        # extras are capped: nested values and over-long strings are dropped,
        # the count is capped, and the block itself still validates.
        many = {f"k{i:02d}": i for i in range(RunnerUiThread.MAX_EXTRA_KEYS + 8)}
        block = RunnerUiThread.model_validate(
            {
                **RUST_UI_THREAD_BLOCK,
                "nested": {"a": [1, 2, 3]},
                "huge": "x" * (RunnerUiThread.MAX_EXTRA_STR + 1),
                "short": "ok",
                "k" * (RunnerUiThread.MAX_KEY_LEN + 1): 1,
                **many,
            }
        )
        extra = block.model_extra or {}
        assert "k" * (RunnerUiThread.MAX_KEY_LEN + 1) not in extra
        assert "nested" not in extra
        assert "huge" not in extra
        assert extra["short"] == "ok"
        assert len(extra) == RunnerUiThread.MAX_EXTRA_KEYS
        assert block.wedged is True

    def test_over_long_labels_are_dropped_not_rejected(self) -> None:
        block = RunnerUiThread.model_validate(
            {**RUST_UI_THREAD_BLOCK, "reason": "r" * 1000, "ping_delivery": "p" * 1000}
        )
        assert block.reason is None
        assert block.ping_delivery is None
        assert block.wedged is True


class TestHeartbeatIngest:
    def test_block_round_trips_through_the_heartbeat_route(
        self, client: TestClient
    ) -> None:
        resp = client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat(ui_thread=RUST_UI_THREAD_BLOCK),
        )
        assert resp.status_code == 200
        assert resp.json()["ui_thread"] == RUST_UI_THREAD_BLOCK

    def test_omitted_block_reads_unknown_not_not_wedged(
        self, client: TestClient
    ) -> None:
        resp = client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat())
        assert resp.status_code == 200
        assert resp.json()["ui_thread"] is None

    def test_null_verdict_inside_the_block_stays_unknown(
        self, client: TestClient
    ) -> None:
        unknown = {**RUST_UI_THREAD_BLOCK, "wedged": None, "probe_wedged": None}
        resp = client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(ui_thread=unknown)
        )
        body = resp.json()["ui_thread"]
        assert body["wedged"] is None
        assert body["probe_wedged"] is None


class TestFleetView:
    def test_unpaired_beacon_row_carries_the_block(self, client: TestClient) -> None:
        client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(ui_thread=RUST_UI_THREAD_BLOCK)
        )
        # Owned device on the same host, different port: the beacon is merged.
        rows = _fleet_rows(client, _owned_device(hostname="spaceship", port=1))
        beacon = next(r for r in rows if r["id"] == "spaceship:9876")
        assert beacon["uiThread"] == RUST_UI_THREAD_BLOCK
        assert beacon["uiThreadSource"] == "beacon_unauthenticated"
        assert beacon["uiThreadObservedAt"] is not None

    def test_paired_runner_row_carries_its_beacons_block(
        self, client: TestClient
    ) -> None:
        # The common case: the runner is paired, so its row comes from
        # coord.devices and its beacon is skipped by the (hostname, port)
        # dedupe. The block must still reach that row.
        client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(ui_thread=RUST_UI_THREAD_BLOCK)
        )
        device = _owned_device(hostname="spaceship", port=9876)
        rows = _fleet_rows(client, device)
        assert [r["id"] for r in rows] == [str(device.device_id)]
        assert rows[0]["uiThread"] == RUST_UI_THREAD_BLOCK
        assert rows[0]["uiThread"]["wedged"] is True
        # The block came off the unauthenticated beacon registry, not the
        # device's own authenticated channel — the row must say so, and must
        # say when the reading was taken.
        assert rows[0]["uiThreadSource"] == "beacon_unauthenticated"
        assert rows[0]["uiThreadObservedAt"] is not None

    def test_extra_keys_ride_through_to_the_fleet_row(self, client: TestClient) -> None:
        client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat(
                ui_thread={**RUST_UI_THREAD_BLOCK, "pong_receive_age_ms": 7}
            ),
        )
        rows = _fleet_rows(client, _owned_device(hostname="spaceship", port=9876))
        assert rows[0]["uiThread"]["pong_receive_age_ms"] == 7

    def test_hostname_matches_case_insensitively(self, client: TestClient) -> None:
        client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat(hostname="SpaceShip", ui_thread=RUST_UI_THREAD_BLOCK),
        )
        device = _owned_device(hostname="spaceship", port=9876)
        rows = _fleet_rows(client, device)
        # One row: the case-variant beacon is deduped against the paired device
        # AND its block reaches that device's row.
        assert [r["id"] for r in rows] == [str(device.device_id)]
        assert rows[0]["uiThread"] == RUST_UI_THREAD_BLOCK

    def test_a_beacon_predating_the_block_reads_unknown_on_a_paired_row(
        self, client: TestClient
    ) -> None:
        client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat())
        rows = _fleet_rows(client, _owned_device(hostname="spaceship", port=9876))
        assert rows[0]["uiThread"] is None
        assert rows[0]["uiThreadSource"] is None

    def test_a_stale_beacon_only_row_keeps_its_last_known_block(
        self, client: TestClient
    ) -> None:
        # On a beacon-only row the row's own derivedStatus and lastHeartbeat
        # describe the reading's age, so the last-known block is kept.
        import app.services.dev_dashboard_service as svc

        client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(ui_thread=RUST_UI_THREAD_BLOCK)
        )
        svc.get_fleet_registry()._runners["spaceship:9876"].last_heartbeat = (
            datetime.now(UTC) - timedelta(seconds=600)
        )
        rows = _fleet_rows(client, _owned_device(hostname="spaceship", port=1))
        beacon = next(r for r in rows if r["id"] == "spaceship:9876")
        assert beacon["derivedStatus"] == "stale"
        assert beacon["uiThread"] == RUST_UI_THREAD_BLOCK
        assert beacon["uiThreadObservedAt"] is not None

    def test_a_stale_beacon_is_not_shown_on_a_paired_row(
        self, client: TestClient
    ) -> None:
        # A reading from a beacon that stopped heartbeating must not sit beside
        # the device's own fresh status looking current.
        import app.services.dev_dashboard_service as svc

        client.post(
            f"{API_PREFIX}/heartbeat", json=_heartbeat(ui_thread=RUST_UI_THREAD_BLOCK)
        )
        registry = svc.get_fleet_registry()
        registry._runners["spaceship:9876"].last_heartbeat = datetime.now(
            UTC
        ) - timedelta(seconds=600)
        rows = _fleet_rows(client, _owned_device(hostname="spaceship", port=9876))
        assert rows[0]["uiThread"] is None
        assert rows[0]["uiThreadSource"] is None

    def test_paired_runner_without_a_beacon_reads_unknown(
        self, client: TestClient
    ) -> None:
        rows = _fleet_rows(client, _owned_device(hostname="spaceship", port=9876))
        assert "uiThread" in rows[0]
        assert rows[0]["uiThread"] is None
        assert rows[0]["uiThreadSource"] is None
        assert rows[0]["uiThreadObservedAt"] is None

    def test_beacon_that_omits_the_block_reads_unknown(
        self, client: TestClient
    ) -> None:
        client.post(f"{API_PREFIX}/heartbeat", json=_heartbeat())
        rows = _fleet_rows(client, _owned_device(hostname="spaceship", port=9876))
        assert rows[0]["uiThread"] is None


class TestStoredBlock:
    """Half 2: the devices-WebSocket heartbeat stores the block on coord.devices."""

    def test_stored_block_wins_over_the_in_memory_beacon(
        self, client: TestClient
    ) -> None:
        # The beacon is per-replica and lost on restart; the stored column is
        # durable and identical on every replica, so it is preferred.
        client.post(
            f"{API_PREFIX}/heartbeat",
            json=_heartbeat(ui_thread={**RUST_UI_THREAD_BLOCK, "wedged": False}),
        )
        device = _owned_device(hostname="spaceship", port=9876)
        device.ui_thread = RUST_UI_THREAD_BLOCK
        rows = _fleet_rows(client, device)
        assert rows[0]["uiThread"] == RUST_UI_THREAD_BLOCK
        assert rows[0]["uiThreadSource"] == "device"

    def test_stored_block_is_served_with_no_beacon_at_all(
        self, client: TestClient
    ) -> None:
        device = _owned_device(hostname="spaceship", port=9876)
        device.ui_thread = {**RUST_UI_THREAD_BLOCK, "wedged": None}
        rows = _fleet_rows(client, device)
        assert rows[0]["uiThread"]["wedged"] is None
        assert rows[0]["uiThread"]["reason"] == "native_probe_wedged"


def _ws_env() -> tuple[Any, Any]:
    manager = MagicMock()
    manager.get_websocket = MagicMock(return_value=None)
    manager.refresh_ttl = AsyncMock()
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=MagicMock())
    session.__aexit__ = AsyncMock(return_value=None)
    return manager, MagicMock(return_value=session)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sent", "stored"),
    [
        (RUST_UI_THREAD_BLOCK, RUST_UI_THREAD_BLOCK),
        (None, None),
        ("not-an-object", None),
    ],
)
async def test_ws_heartbeat_stores_the_block_by_its_snake_case_name(
    sent: Any, stored: Any
) -> None:
    from app.api.v1.endpoints import devices_ws

    manager, session_local = _ws_env()
    msg: dict[str, Any] = {"type": "heartbeat", "derived_status": "errored"}
    if sent is not None:
        msg["ui_thread"] = sent
    heartbeat = AsyncMock()
    with (
        patch.object(devices_ws, "AsyncSessionLocal", session_local),
        patch.object(devices_ws.device_crud, "heartbeat_device", heartbeat),
    ):
        await devices_ws._handle_heartbeat(msg, uuid4(), manager, None, object())
    heartbeat.assert_awaited_once()
    assert heartbeat.await_args is not None
    assert heartbeat.await_args.kwargs["ui_thread"] == stored
