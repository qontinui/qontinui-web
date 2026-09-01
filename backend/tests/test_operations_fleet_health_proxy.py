"""Integration tests for the fleet-health proxy's response SHAPE.

``GET /api/v1/operations/fleet/health`` proxies coord's
``GET /coord/fleet/health`` so the ``/admin/coord/*`` console can render
the machine roster without the browser hitting coord cross-origin. Three
surfaces poll it: ``useFleetHealth.ts`` (10s), ``useFleetAlarmBadge.ts``
and ``SpawnModal.tsx``'s device picker.

Its transport is already pinned one file over —
``test_operations_coord_dashboard_proxy.py`` covers the coord URL, the
tenant header, the 403 tenant-not-resolved branch and the 502 on an
unreachable coord. **What nothing pinned is the body**, and this file is
that half: the roster's per-device fields have to survive the hop
uncoerced, because every one of them encodes a distinction the console
renders as different words.

Plan ``2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory``
Phase 4, whose coord half landed as coord ``b00558b5`` and put three new
fields on this wire (``heartbeat_state``, ``newest_sample_age_secs``,
``sample_stale_after_secs``) that nothing in this repo reads or asserts.

The properties under test are the honesty rules, not the plumbing:

* the derived ``stale`` state and the PERSISTED ``heartbeat_state``
  arrive as a PAIR — the overlay exists precisely so it loses nothing,
  and a caller that sees ``stale`` alone cannot tell an unreachable box
  from a healthy one with a quiet publisher,
* ``state_raw`` arrives only on a parse failure, since its presence *is*
  the anomaly marker,
* the freshness pair (``newest_sample_age_secs`` +
  ``sample_stale_after_secs``) survives, threshold included, so the
  client keeps no staleness constant of its own,
* a coord predating those fields arrives WITHOUT them — absent and
  ``null`` are different claims and the console words them differently,
* ``excluded: null`` is NOT MEASURED and must not be coerced to an empty
  set, and an all-zero ``alerts`` block is not evidence of a quiet fleet.

Mirrors ``test_operations_resource_samples_proxy.py``: minimal FastAPI
app + mocked ``httpx.AsyncClient``, so no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
ROUTE = f"{API_PREFIX}/fleet/health"

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
        # this ContextVar and `_tenant_headers` reads it back, so the bearer
        # has to be set for the endpoint to build its request at all. This
        # file asserts nothing ABOUT the bearer — that is
        # `test_operations_coord_dashboard_proxy.py`'s half; here it is
        # setup, not a property. `async def` is load-bearing: FastAPI runs a
        # SYNC dependency in a worker thread whose ContextVar writes never
        # reach the request task.
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


def _get(client: TestClient, payload):
    """Arm the mocked coord client with one 200 body, and GET the route."""
    with _patch_httpx() as MockClient:
        mock_instance = MagicMock()
        mock_instance.get = AsyncMock(return_value=_mock_response(200, payload))
        _configure_mock_client(MockClient, mock_instance)
        return client.get(ROUTE)


DEVICE_ID = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd"

# A healthy machine, carrying every field coord's `DeviceHealthSnapshot`
# serializes for one. `newest_sample_age_secs` well under
# `sample_stale_after_secs` is what makes this row NOT stale, and both
# numbers ride the wire so the client never decides that boundary itself.
HEALTHY_DEVICE = {
    "device_id": DEVICE_ID,
    "hostname": "merytshost",
    "state": "healthy",
    "heartbeat_state": "healthy",
    "state_changed_at": "2026-08-30T09:15:00Z",
    "last_probe_at": "2026-08-31T11:40:00Z",
    "last_probe_ok": True,
    "last_seen_at": "2026-08-31T11:41:30Z",
    "within_dispatch_window": True,
    "consecutive_failures": 0,
    "agents_active": 3,
    "updated_at": "2026-08-31T11:41:35Z",
    "capture_preview_count": 91_204,
    "monitor_crop_count": 0,
    "last_capture_fallback_at": None,
    "newest_sample_age_secs": 42.5,
    # 120.0 is coord's DEFAULT: `sample_interval_secs` (30s where the tenant
    # sets none) x `SAMPLE_STALE_INTERVALS` (4). Not the cadence itself.
    "sample_stale_after_secs": 120.0,
}

# The 2026-08-27 shape: the heartbeat is FINE and the resource sampler has
# gone quiet. 1320s is 22 minutes — the sample age that sat behind a
# `{healthy: 4}` rollup and started this plan.
STALE_DEVICE = {
    **HEALTHY_DEVICE,
    "device_id": "b1d0c7e4-2f77-4a58-8f5a-6b1c9d3e2a04",
    "hostname": "spaceship",
    "state": "stale",
    "heartbeat_state": "healthy",
    "newest_sample_age_secs": 1320.0,
    "sample_stale_after_secs": 120.0,
}

# The three fields coord `b00558b5` added. A coord predating it sends none
# of them — which is a different claim from sending them null.
FRESHNESS_KEYS = (
    "heartbeat_state",
    "newest_sample_age_secs",
    "sample_stale_after_secs",
)


class TestFleetHealthProxyShape:
    def test_forwards_the_device_roster_untouched(self, auth_client: TestClient):
        """Every field of a device snapshot survives the hop, verbatim.

        This route declares no ``response_model`` and the proxy filters
        nothing, so the assertion is deliberately whole-object rather
        than field-by-field: a future ``response_model`` added here for
        tidiness would silently drop whichever fields it did not
        enumerate, and the console would render the loss as an all-clear
        rather than an error.
        """
        payload = {
            "devices": [HEALTHY_DEVICE],
            "count": 1,
            "by_state": {"healthy": 1},
            "liveness": {
                "within_dispatch_window": 1,
                "outside_dispatch_window": 0,
                "heartbeat_ttl_secs": 180,
            },
            "excluded": [],
            "excluded_error": None,
            "alerts": {"critical": 0, "warning": 2, "info": 5},
            "kv_bucket": "fleet-health",
            "as_of": "2026-08-31T11:41:35Z",
        }

        resp = _get(auth_client, payload)

        assert resp.status_code == 200
        assert resp.json() == payload

    def test_a_stale_device_keeps_its_heartbeat_state(self, auth_client: TestClient):
        """``stale`` and ``heartbeat_state`` must arrive as a PAIR.

        ``stale`` is coord's only DERIVED ``DeviceState`` — computed at
        read time, never persisted, and meaning *the heartbeat is fine
        and the sampler has gone quiet*. coord ships ``heartbeat_state``
        alongside it for exactly one reason: so the overlay loses
        nothing, and a reader can still see that the machine underneath
        is ``healthy``.

        Dropping that half anywhere on this path would leave the console
        rendering ``(stale)`` with no way to tell it from
        ``(partitioned)``. They are opposite operational facts — a
        ``stale`` machine is reachable and perfectly spawnable, a
        ``partitioned`` one is not — and the spawn picker is where that
        confusion costs something.
        """
        resp = _get(
            auth_client,
            {
                "devices": [STALE_DEVICE, HEALTHY_DEVICE],
                "count": 2,
                "by_state": {"stale": 1, "healthy": 1},
                "alerts": {"critical": 0, "warning": 0, "info": 0},
            },
        )

        stale = resp.json()["devices"][0]
        assert stale["state"] == "stale"
        assert stale["heartbeat_state"] == "healthy"
        # The freshness pair that PRODUCED the overlay, threshold included.
        # The threshold rides the wire for the same reason the resource
        # strip's floors do: a client naming its own number could disagree
        # with coord about where stale begins.
        assert stale["newest_sample_age_secs"] == 1320.0
        assert stale["sample_stale_after_secs"] == 120.0
        # `by_state` is keyed on `DeviceState::as_str()` and is sparse, so
        # `stale` appears only when a device is actually in it.
        assert resp.json()["by_state"] == {"stale": 1, "healthy": 1}

    def test_state_raw_survives_a_parse_failure(self, auth_client: TestClient):
        """``unknown`` + ``state_raw`` is the anomaly marker, not noise.

        coord emits ``state_raw`` ONLY when the stored
        ``coord.devices.state`` string failed to parse, in which case
        ``state`` reads ``"unknown"``. It carries what the row actually
        said, and it is the only thing that separates *"coord has no
        verdict for this device"* from *"coord's database holds a value
        no build understands"* — the first is ordinary, the second is a
        schema drift someone has to chase.
        """
        resp = _get(
            auth_client,
            {
                "devices": [
                    {
                        **HEALTHY_DEVICE,
                        "state": "unknown",
                        "state_raw": "quiescent",
                        "heartbeat_state": "unknown",
                    }
                ],
                "count": 1,
                "by_state": {"unknown": 1},
            },
        )

        device = resp.json()["devices"][0]
        assert device["state"] == "unknown"
        assert device["state_raw"] == "quiescent"

    def test_a_clean_state_carries_no_state_raw(self, auth_client: TestClient):
        """The common case pays nothing, and must not be defaulted in.

        coord omits ``state_raw`` from the JSON entirely when the state
        parsed cleanly. Synthesising a ``null`` here would make the
        anomalous case indistinguishable from the ordinary one at a
        glance, which is the whole point of the omission.
        """
        resp = _get(auth_client, {"devices": [HEALTHY_DEVICE], "count": 1})

        assert "state_raw" not in resp.json()["devices"][0]

    def test_absent_freshness_fields_are_not_defaulted_in(
        self, auth_client: TestClient
    ):
        """A coord predating Phase 4 must arrive WITHOUT the pair.

        Mirrors ``test_absent_saturation_axis_is_not_defaulted_in`` on
        the sibling route. *Absent* says this coord predates the field;
        *null* says coord has the field and nothing to put in it. A
        fabricated ``newest_sample_age_secs: 0`` would be worse than
        either — it inverts, reading as *sampled this instant* on the one
        field that exists to catch a publisher that has stopped.
        """
        legacy_device = {
            k: v for k, v in HEALTHY_DEVICE.items() if k not in FRESHNESS_KEYS
        }

        resp = _get(auth_client, {"devices": [legacy_device], "count": 1})

        device = resp.json()["devices"][0]
        for key in FRESHNESS_KEYS:
            assert key not in device, f"{key} was defaulted in by the proxy"
        # The fields that DID cross still arrive intact — an old coord is
        # degraded, not unreadable.
        assert device["state"] == "healthy"
        assert device["within_dispatch_window"] is True

    def test_null_freshness_stays_null(self, auth_client: TestClient):
        """``null`` age is UNKNOWN — never zero, and never "fresh".

        The two shapes are DIFFERENT and the pair is what tells them
        apart, so both are exercised rather than collapsed:

        * a device with no sample inside the retention lookback — a null
          age beside a POPULATED threshold, because coord sets the
          threshold whenever the freshness read ran at all;
        * a tick where the freshness read itself failed — BOTH null, no
          device overlaid.

        Neither may be smoothed into a number on the way through, and a
        proxy that filled the threshold in on the second shape would make
        it look like the first.
        """
        no_sample = {
            **HEALTHY_DEVICE,
            "newest_sample_age_secs": None,
            "sample_stale_after_secs": 120.0,
        }
        read_failed = {
            **HEALTHY_DEVICE,
            "device_id": "c2e1f8a3-4b60-4d19-9a72-1e5f0b7c8d31",
            "newest_sample_age_secs": None,
            "sample_stale_after_secs": None,
        }

        resp = _get(auth_client, {"devices": [no_sample, read_failed], "count": 2})

        first, second = resp.json()["devices"]
        assert first["newest_sample_age_secs"] is None
        assert first["sample_stale_after_secs"] == 120.0
        assert second["newest_sample_age_secs"] is None
        assert second["sample_stale_after_secs"] is None
        # Present-and-null is a claim, so the keys must still be THERE —
        # absent would say "this coord predates the axis" instead.
        for device in (first, second):
            assert "newest_sample_age_secs" in device
            assert "sample_stale_after_secs" in device
            # The ladder state still says what the machine is underneath a
            # missing overlay.
            assert device["heartbeat_state"] == "healthy"

    def test_an_outside_window_device_is_listed_not_dropped(
        self, auth_client: TestClient
    ):
        """*Listed* stopped implying *reachable*, so the flag must survive.

        coord no longer filters out-of-window devices out of the roster;
        it lists them and ships ``within_dispatch_window`` instead, with
        the ``liveness`` block rolling the same split up. **That coord
        behaviour is not what this test pins** — coord is mocked here, so
        what is pinned is the hop: a `false` flag and its rollup reach the
        caller intact. Dropping either on this path would restore the
        silent omission coord removed, from one layer up — "merytshost,
        last seen 7 min ago" beats a device that simply is not in the
        picker.
        """
        resp = _get(
            auth_client,
            {
                "devices": [{**HEALTHY_DEVICE, "within_dispatch_window": False}],
                "count": 1,
                "liveness": {
                    "within_dispatch_window": 0,
                    "outside_dispatch_window": 1,
                    "heartbeat_ttl_secs": 180,
                },
            },
        )

        body = resp.json()
        assert body["devices"][0]["within_dispatch_window"] is False
        assert body["liveness"] == {
            "within_dispatch_window": 0,
            "outside_dispatch_window": 1,
            "heartbeat_ttl_secs": 180,
        }

    def test_excluded_null_is_not_measured_not_empty(self, auth_client: TestClient):
        """``excluded: null`` means NOT MEASURED, never "none excluded".

        ``excluded_error`` carries why. Coercing the ``null`` to ``[]``
        here would turn "coord could not compute the exclusion set" into
        "coord computed it and it was empty" — the same
        absent-is-not-zero rule the rest of this surface rests on
        (``[policy: silent-empty-is-unknown]``).

        Honest about its own reach: a ``null`` survives ``resp.json()``
        by construction, so what this actually guards is a future
        ``response_model`` that OMITS the pair, not one that types it
        nullably.
        """
        resp = _get(
            auth_client,
            {
                "devices": [],
                "count": 0,
                "excluded": None,
                "excluded_error": "pool acquire failed",
            },
        )

        body = resp.json()
        assert body["excluded"] is None
        assert body["excluded_error"] == "pool acquire failed"

    def test_an_all_zero_alert_block_arrives_verbatim(self, auth_client: TestClient):
        """Zeros cross unchanged — and are not evidence of a quiet fleet.

        coord initialises the severity rollup at zero and fills it only
        if the PG pool acquires AND the query succeeds; on the failing
        path it logs *"no alert rollup this tick"* and serves
        ``{critical: 0, warning: 0, info: 0}`` anyway, with no flag
        distinguishing that from a genuinely quiet fleet. On that same
        tick no freshness overlay runs either, so no device can read
        ``stale``.

        The proxy's job is not to repair that — it is to not make it
        worse by inventing a verdict, so what is pinned is that the block
        crosses verbatim.

        Not pinned, deliberately: that no ``alerts_scrape_up`` is
        synthesised. coord has never had such a field (it exists only as
        a forward declaration on this repo's ``FleetHealthPayload``), so
        an assertion that the proxy does not invent it could not fail and
        would be a tautology wearing a docstring.
        """
        resp = _get(
            auth_client,
            {
                "devices": [HEALTHY_DEVICE],
                "count": 1,
                "alerts": {"critical": 0, "warning": 0, "info": 0},
            },
        )

        body = resp.json()
        assert body["alerts"] == {"critical": 0, "warning": 0, "info": 0}

    def test_an_unrecognised_state_reaches_the_caller_uncoerced(
        self, auth_client: TestClient
    ):
        """A newer coord's sixth state must arrive, not be flattened.

        The client types ``state`` as a bare string deliberately: a union
        would make a coord newer than this build fail to parse instead of
        rendering *unknown*. That only holds if the value actually
        arrives, so the proxy must not map an unfamiliar state onto a
        familiar one.
        """
        resp = _get(
            auth_client,
            {
                "devices": [{**HEALTHY_DEVICE, "state": "quarantined"}],
                "count": 1,
                "by_state": {"quarantined": 1},
            },
        )

        assert resp.json()["devices"][0]["state"] == "quarantined"
