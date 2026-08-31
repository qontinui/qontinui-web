"""Integration tests for the CI-runner label-mirror proxy.

``GET /operations/fleet/ci-runners`` is plan
``2026-08-20-fleet-page-runner-enable-disable-switch`` Phase 2: the web proxy
for coord's ``GET /coord/fleet/ci-runners``, which serves the label set coord's
``ci_runner_registrar`` last mirrored from GitHub's ``actions/runners``
listing.

Auth posture: ``require_coord_tenant_admin``, matching what coord actually
enforces — ``fleet_ci_runners::get_fleet_ci_runners`` calls
``rbac::deny_unless_tenant_admin`` before it queries anything, so a
Developer-tier caller is refused there regardless. This route was first written
with ``get_tenant_id`` on the reasoning that admin-gating telemetry would blank
a read-only fact for viewers who may see the page; coord does not implement that
posture, and a door whose comment describes a behaviour the system does not have
is worse than a stricter door.

The route is a pass-through by design: ``as_of``, ``freshness_secs`` and each
row's ``last_seen_at`` describe the READ, and must reach the console untouched
so it can label what it is showing rather than imply live GitHub truth. These
tests pin that it adds no shape of its own.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"

# The pool as measured with `gh api` on 2026-08-31 — three hosts, with
# `merytshost` carrying no per-machine label at all. The third host is the one
# every written description of the pool in the tree has missed.
_COORD_PAYLOAD = {
    "runners": [
        {
            "device_id": "aaaaaaaa-0000-0000-0000-000000000001",
            "hostname": "merytshost",
            "ci_runner_status": "idle",
            "ci_runner_labels": ["self-hosted", "Linux", "X64", "qontinui"],
            "last_seen_at": "2026-08-31T12:00:00Z",
        },
        {
            "device_id": "aaaaaaaa-0000-0000-0000-000000000002",
            "hostname": "msi-wsl",
            "ci_runner_status": "busy",
            "ci_runner_labels": ["self-hosted", "Linux", "X64", "qontinui", "msi"],
            "last_seen_at": "2026-08-31T12:00:00Z",
        },
        {
            "device_id": "aaaaaaaa-0000-0000-0000-000000000003",
            "hostname": "spaceship-wsl",
            "ci_runner_status": "idle",
            "ci_runner_labels": [
                "self-hosted",
                "Linux",
                "X64",
                "qontinui",
                "spaceship",
            ],
            "last_seen_at": "2026-08-31T12:00:00Z",
        },
    ],
    "as_of": "2026-08-31T12:00:30Z",
    "freshness_secs": 30,
}


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "dev@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: uuid4()
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


class TestGetFleetCiRunners:
    def test_proxies_the_coord_route(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_COORD_PAYLOAD)
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/fleet/ci-runners")

        assert resp.status_code == 200
        assert instance.get.call_args.args[0].endswith("/coord/fleet/ci-runners")

    def test_labels_and_freshness_pass_through_untouched(self, client: TestClient):
        """The console computes the routing verdict from these labels and the
        per-row age from ``as_of - last_seen_at``; a proxy that reshaped any of
        the three would be a second, drifting definition of it.

        Note ``freshness_secs`` is coord's SELECTION WINDOW, not an age — a
        configured constant (``COORD_CI_RUNNER_FRESHNESS_SECS``, default 180).
        It is forwarded as-is and the console is careful not to print it as a
        measurement."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_COORD_PAYLOAD)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/fleet/ci-runners").json()

        assert body == _COORD_PAYLOAD
        by_host = {r["hostname"]: r for r in body["runners"]}
        assert set(by_host) == {"merytshost", "msi-wsl", "spaceship-wsl"}
        # Capitalisation is preserved: GitHub's own listing carries `Linux` /
        # `X64`, and normalising them here would hide a real difference.
        assert by_host["merytshost"]["ci_runner_labels"] == [
            "self-hosted",
            "Linux",
            "X64",
            "qontinui",
        ]
        assert body["freshness_secs"] == 30
        assert body["as_of"] == "2026-08-31T12:00:30Z"

    def test_a_delabelled_host_reaches_the_console_as_such(self, client: TestClient):
        """The whole point of the read: a host whose `qontinui` label was
        removed must arrive distinguishable, not normalised into the others."""
        delabelled = {
            **_COORD_PAYLOAD,
            "runners": [
                {
                    **_COORD_PAYLOAD["runners"][2],
                    "ci_runner_labels": [
                        "self-hosted",
                        "Linux",
                        "X64",
                        "spaceship",
                    ],
                }
            ],
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=delabelled)
            _configure_mock_client(MockClient, instance)

            body = client.get(f"{API_PREFIX}/fleet/ci-runners").json()

        assert "qontinui" not in body["runners"][0]["ci_runner_labels"]

    def test_an_empty_mirror_is_served_as_an_empty_mirror(self, client: TestClient):
        """An `ok` with zero runners is a real measurement and must not be
        confused with a failure; the console renders the two differently."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"runners": [], "as_of": None, "freshness_secs": None}
            )
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/fleet/ci-runners")

        assert resp.status_code == 200
        assert resp.json()["runners"] == []

    def test_coord_unreachable_is_a_502_not_an_empty_fleet(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("nope")
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/fleet/ci-runners")

        assert resp.status_code == 502
        assert "coord is not reachable" in resp.json()["detail"]


class TestCiRunnerLabelsColumnType:
    def test_the_model_maps_the_column_alembic_actually_created(self):
        """``coord.devices.ci_runner_labels`` is ``TEXT[]``.

        alembic is the sole author of ``coord.*`` DDL and created it as
        ``TEXT[]`` (``c5d6e7f8a9b0_add_ci_runner_columns_to_devices``); coord
        declares the same. This model mapped it as ``JSONB``, which had no live
        reader to fail on — the registrar's rows are invisible to the web
        device read — until Phase 2 became that reader. No migration: the DDL
        was always ``TEXT[]``.
        """
        from sqlalchemy import ARRAY

        from app.models.device import Device

        col = Device.__table__.c.ci_runner_labels
        assert isinstance(col.type, ARRAY)
        assert col.type.item_type.python_type is str
