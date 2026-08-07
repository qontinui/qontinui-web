"""Integration tests for the fleet resource-samples proxy.

``GET /api/v1/operations/fleet/resource-samples`` proxies coord's
``GET /coord/devices/resource-samples`` so the ``/admin/coord/fleet``
resource strip can render without the browser hitting coord
cross-origin.

Plan ``2026-08-02-fleet-resource-telemetry-and-ci-allocation`` §C0/§C2.

The properties under test are the ones that make the surface honest
rather than merely working:

* the **server-computed** ``pressure`` reaches the caller untouched (the
  dashboard and coord's CI ranker must read ONE definition),
* the per-lane ``floor`` / ``disk_floor`` / ``headroom`` fields reach it
  untouched too — the *verdict* has to be shared for the same reason the
  *number* does, and the strip derives its red/amber from them rather
  than from a client-side constant,
* ``schema_pending`` and an empty set survive the hop, since that is the
  §C3 state the caller renders as *unknown* rather than healthy,
* out-of-range query params are FORWARDED for coord to clamp, not 422'd
  here — a rejection would turn a slightly-greedy render into a blank
  panel,
* the operator bearer is forwarded (never an anonymous coord call, which
  is what silently emptied ``DeviceStatusTile`` the last time).

Mirrors ``test_operations_claims_proxy.py``: minimal FastAPI app +
mocked ``httpx.AsyncClient``, so no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
ROUTE = f"{API_PREFIX}/fleet/resource-samples"


TEST_BEARER = "test-cognito-access-token"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # The real `get_tenant_id` captures the caller's Cognito token into
        # this ContextVar; `_tenant_headers` reads it back to build the
        # `Authorization` header. Overriding the dependency without setting it
        # would make the bearer-forwarding assertion vacuous — the header
        # would simply never be built, and the test would pass for the wrong
        # reason.
        #
        # `async def` is load-bearing: FastAPI runs a SYNC dependency in a
        # worker thread, whose ContextVar writes do not propagate back to the
        # request task, so a sync override would set the bearer somewhere the
        # endpoint can never read it.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
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


SAMPLE_ROW = {
    "device_id": str(uuid4()),
    "lane": "host",
    "lane_instance": None,
    "sampled_at": "2026-08-06T12:00:00Z",
    "age_secs": 12.5,
    "cpu_cores": 16,
    "load_1m": None,
    "mem_total_bytes": 34_359_738_368,
    "mem_available_bytes": 3_800_000_000,
    "commit_total_bytes": 68_719_476_736,
    "commit_available_bytes": 14_000_000_000,
    "swap_total_bytes": None,
    "swap_used_bytes": None,
    "disk_total_bytes": 1_000_000_000_000,
    "disk_free_bytes": 90_000_000_000,
    "disk_mount": "D:",
    "build_slots_total": 4,
    "build_slots_busy": 2,
    "build_queue_depth": 0,
    "ci_jobs_running": None,
    "source": "supervisor",
    "pressure": {"ratio": 0.7963, "basis": "commit"},
    "floor": {
        "basis": "commit_available",
        "bytes": 5_368_709_120,
        "source": "policy",
        "verdict": "defer",
        # The rejecting enforcer on the SAME column, deliberately lower.
        "reject_bytes": 4_294_967_296,
        "reject_source": "default",
    },
    "disk_floor": {
        "basis": "disk_free",
        "bytes": 32_212_254_720,
        "source": "default",
        "verdict": "reject",
    },
    "pressure_floor": None,
    "headroom": "warn",
}


class TestResourceSamplesProxy:
    def test_forwards_pressure_and_bounds_untouched(self, auth_client: TestClient):
        """The server-computed ``pressure`` must survive the hop verbatim.

        Recomputing it anywhere downstream is the dashboard/dispatcher
        drift §C0 exists to prevent, so the proxy is asserted to be a
        pass-through — including the effective bounds coord echoes back.
        """
        coord_payload = {
            "latest": [SAMPLE_ROW],
            "count": 1,
            "history": [
                {
                    "device_id": SAMPLE_ROW["device_id"],
                    "lane": "host",
                    "lane_instance": None,
                    "pressure_basis": "commit",
                    "points": [
                        {
                            "sampled_at": "2026-08-06T11:59:30Z",
                            "pressure": 0.79,
                            "disk_free_bytes": 90_000_000_000,
                            "disk_total_bytes": 1_000_000_000_000,
                            "build_slots_busy": 2,
                            "build_slots_total": 4,
                            "ci_jobs_running": None,
                        }
                    ],
                }
            ],
            "window_secs": 3600.0,
            "latest_lookback_secs": 21600.0,
            "history_points_per_anchor": 120,
            "history_truncated": False,
            "schema_pending": False,
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, coord_payload)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        assert resp.status_code == 200
        body = resp.json()
        assert body == coord_payload
        assert body["latest"][0]["pressure"] == {"ratio": 0.7963, "basis": "commit"}
        assert body["latest"][0]["age_secs"] == 12.5

    def test_forwards_the_floor_bands_untouched(self, auth_client: TestClient):
        """The admission VERDICT must survive the hop as verbatim as the ratio.

        The strip used to decide red/amber from ``SATURATED_AT`` /
        ``WARN_AT`` in TypeScript while coord admitted on byte floors, so
        the dashboard could show amber for a machine the ranker had
        already stopped electing. The fix is that coord sends the verdict
        (``headroom``) and the floor it was computed against — which is
        only worth anything if this proxy neither drops nor reshapes
        them.

        Note ``floor.basis``: the floor is on a DIFFERENT column from the
        pressure ratio's divisors, which is why it cannot be collapsed
        into a "pressure threshold" anywhere along this path.
        """
        coord_payload = {"latest": [SAMPLE_ROW], "count": 1}
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, coord_payload)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        row = resp.json()["latest"][0]
        assert row["headroom"] == "warn"
        assert row["floor"] == {
            "basis": "commit_available",
            "bytes": 5_368_709_120,
            "source": "policy",
            "verdict": "defer",
            "reject_bytes": 4_294_967_296,
            "reject_source": "default",
        }
        assert row["disk_floor"] == {
            "basis": "disk_free",
            "bytes": 32_212_254_720,
            "source": "default",
            "verdict": "reject",
        }

    def test_absent_floor_bands_are_not_defaulted_in(self, auth_client: TestClient):
        """A coord without the floor fields must arrive WITHOUT them.

        The caller renders a missing ``headroom`` as *unknown*, never as
        healthy. If this proxy helpfully filled in an "ok" (or a floor of
        zero), it would manufacture the all-clear §C3 exists to forbid —
        so the pass-through is asserted in the negative too.
        """
        legacy_row = {
            k: v
            for k, v in SAMPLE_ROW.items()
            if k not in ("floor", "disk_floor", "headroom")
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, {"latest": [legacy_row], "count": 1})
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        row = resp.json()["latest"][0]
        assert "headroom" not in row
        assert "floor" not in row
        assert "disk_floor" not in row

    def test_a_partial_rollout_arrives_partial(self, auth_client: TestClient):
        """The shape a STAGED coord rollout produces, unedited.

        `headroom` present while `floor` is absent, and a `floor` whose
        rejecting enforcer is `null` rather than a number, are both states
        the caller renders distinctly ("no reject threshold" is a fact about
        the fleet; "not reported" is a fact about the deploy). Defaulting
        either one here would erase that distinction before the browser saw
        it.
        """
        partial_row = {k: v for k, v in SAMPLE_ROW.items() if k not in ("floor",)}
        partial_row["disk_floor"] = {
            "basis": "disk_free",
            "bytes": 32_212_254_720,
            "source": "default",
            "verdict": "reject",
            "reject_bytes": None,
            "reject_source": None,
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, {"latest": [partial_row], "count": 1})
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        row = resp.json()["latest"][0]
        assert "floor" not in row
        assert row["headroom"] == "warn"
        # `null` survives as null — not dropped, and not replaced by `bytes`.
        assert row["disk_floor"]["reject_bytes"] is None
        assert row["disk_floor"]["reject_source"] is None

    def test_forwards_the_pressure_axis_and_a_null_verdict(
        self, auth_client: TestClient
    ):
        """The ratio-axis threshold and the unenforced-threshold marker.

        Two things the browser cannot reconstruct if this hop edits them:

        * ``pressure_floor`` is the ONLY guard on the Linux lanes —
          nothing in the fleet floors ``mem_available_bytes``, so those
          rows carry ``floor: null`` and a swap-ratio ceiling. Dropping
          it would render a lane under an active guard as unguarded.
        * ``verdict: null`` means coord reports a threshold that nothing
          enforces. Coercing it to a verb would show an operator a rule
          where there is only a number.
        """
        wsl_row = {
            **SAMPLE_ROW,
            "lane": "wsl",
            "floor": None,
            "pressure_floor": {
                "basis": "swap_ratio",
                "ratio": 0.5,
                "source": "default",
                "verdict": "defer",
                "reject_ratio": None,
                "reject_source": None,
            },
            "disk_floor": {
                "basis": "disk_free",
                "bytes": 32_212_254_720,
                "source": "policy",
                # A §D1 control with no consumer.
                "verdict": None,
                "reject_bytes": None,
                "reject_source": None,
            },
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, {"latest": [wsl_row], "count": 1})
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        row = resp.json()["latest"][0]
        # `null` survives as null — the lane has no BYTE floor, which is a
        # fact about the fleet and not a reporting gap.
        assert row["floor"] is None
        assert row["pressure_floor"]["basis"] == "swap_ratio"
        assert row["pressure_floor"]["ratio"] == 0.5
        assert row["pressure_floor"]["verdict"] == "defer"
        assert row["disk_floor"]["verdict"] is None

    def test_calls_the_coord_read_route(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, {"latest": [], "count": 0})
            )
            _configure_mock_client(MockClient, mock_instance)

            auth_client.get(ROUTE)

        url = mock_instance.get.call_args[0][0]
        assert url.endswith("/coord/devices/resource-samples")

    def test_forwards_the_operator_bearer(self, auth_client: TestClient):
        """Never an anonymous coord call.

        ``DeviceStatusTile`` records what happened last time a coord read
        went out without the operator bearer: coord went operator-auth
        fail-closed and the tile SILENTLY EMPTIED.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, {"latest": [], "count": 0})
            )
            _configure_mock_client(MockClient, mock_instance)

            auth_client.get(ROUTE)

        headers = mock_instance.get.call_args.kwargs["headers"]
        assert headers is not None
        # Specifically the bearer — "headers is not None" would pass on any
        # unrelated header and would not catch the regression this test is
        # named after.
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    def test_forwards_query_params(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, {"latest": [], "count": 0})
            )
            _configure_mock_client(MockClient, mock_instance)

            device_id = str(uuid4())
            auth_client.get(
                ROUTE,
                params={
                    "device_id": device_id,
                    "lane": "wsl",
                    "window_secs": 900,
                    "history_points": 60,
                    "history": "false",
                },
            )

        params = mock_instance.get.call_args.kwargs["params"]
        assert params["device_id"] == device_id
        assert params["lane"] == "wsl"
        assert params["window_secs"] == 900
        assert params["history_points"] == 60
        assert params["history"] is False

    def test_out_of_range_window_is_forwarded_for_coord_to_clamp(
        self, auth_client: TestClient
    ):
        """Coord CLAMPS rather than 422s; this proxy must not 422 first.

        A rejection here would turn a slightly-greedy render into a blank
        panel — and a blank panel reads as "the fleet went quiet", which
        is the false-safe §C3 forbids.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(
                    200, {"latest": [], "count": 0, "window_secs": 86400.0}
                )
            )
            _configure_mock_client(MockClient, mock_instance)

            # 8 days, well past coord's 24h ceiling.
            resp = auth_client.get(ROUTE, params={"window_secs": 691200})

        assert resp.status_code == 200
        assert mock_instance.get.call_args.kwargs["params"]["window_secs"] == 691200
        # The EFFECTIVE bound comes back from coord, not from here.
        assert resp.json()["window_secs"] == 86400.0

    def test_schema_pending_empty_set_survives_the_hop(self, auth_client: TestClient):
        """The pre-migration state must reach the UI as itself.

        coord degrades to an empty set with ``schema_pending: true``
        rather than 500ing. Collapsing that into a bare empty list would
        cost the caller the ability to say *unknown* instead of *idle*.
        """
        coord_payload = {
            "latest": [],
            "count": 0,
            "history": [],
            "window_secs": 3600.0,
            "latest_lookback_secs": 21600.0,
            "history_points_per_anchor": 120,
            "history_truncated": False,
            "schema_pending": True,
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, coord_payload)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        assert resp.status_code == 200
        assert resp.json()["schema_pending"] is True
        assert resp.json()["latest"] == []

    def test_coord_unreachable_is_a_502_not_a_fabricated_empty_set(
        self, auth_client: TestClient
    ):
        """A transport failure must NOT look like "no machines are busy"."""
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("nope"))
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        assert resp.status_code == 502

    def test_coord_error_status_is_propagated(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(400, None, text="unknown lane")
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE, params={"lane": "bogus"})

        assert resp.status_code == 400
