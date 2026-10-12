"""Tests for the two CI-dashboard reads behind ``/admin/coord/ci``.

Plan ``2026-10-04-ci-dashboard-in-the-dev-ops-console`` Phase 3:

* ``GET /api/v1/operations/ci/overview`` — a VERBATIM passthrough of coord's
  ``GET /coord/ci/overview``. The tests pin the coord path, that the operator
  bearer is forwarded (tenant resolved), that every nullable count and every
  ``state`` survives the proxy untouched (a ``null`` must reach the page as
  ``null``, never as ``0`` or a dropped key), and that a coord 404 (a coord
  predating the route) is an error the page can render as UNKNOWN — not a
  silent ``{}`` that reads as an empty fleet.
* ``GET /api/v1/operations/ci-status`` — its ``response_model`` used to drop
  coord's freshness stamps (``as_of``, ``main_verdict_observed_at``,
  ``pr_checks_observed_at``) because undeclared keys are filtered. These pin
  that they now survive, that ``vacuously_green`` passes, and that a coord
  which sends no stamps (the pre-Phase-2 deploy) still answers 200 with the
  stamps ``null`` rather than failing validation.

Mirrors the mocked-``httpx.AsyncClient`` pattern of
``test_operations_ci_status_notify_proxy.py`` — no live coord needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

API_PREFIX = "/api/v1/operations"
OVERVIEW_PATH = f"{API_PREFIX}/ci/overview"
STATUS_PATH = f"{API_PREFIX}/ci-status"


def _build_test_app() -> FastAPI:
    """Minimal FastAPI app exposing the operations router with auth stubbed."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    resolved = uuid4()
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
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


def _get(auth_client: TestClient, path: str, coord_resp: MagicMock):
    """GET ``path`` with coord mocked; returns ``(response, mock_instance)``."""
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.get.return_value = coord_resp
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance
        resp = auth_client.get(path)
    return resp, instance


# The shared contract's shape, with the two arms the page must never flatten:
# a MEASURED pool whose zeros are real, and an UNKNOWN pool whose counts are
# null. Plus a repo with outcomes and the not-measured hosted block.
OVERVIEW_BODY = {
    "as_of": "2026-10-04T12:08:00+00:00",
    "coverage_note": "self-hosted jobs only; repo-registered runners only",
    "note": None,
    "pools": [
        {
            "repo": "qontinui/qontinui-web",
            "pool": "qontinui,self-hosted",
            "state": "measured",
            "state_reason": None,
            "observed_at": "2026-10-04T12:07:00+00:00",
            "stale_after_secs": 360,
            "poll_ok": True,
            "poll_complete": True,
            "queued_jobs": 0,
            "oldest_queued_age_secs": None,
            "threshold_secs": 1800,
            "p90_wait_secs": 42,
            "eligibility_state": "eligible",
            "eligible_runners": 2,
            "eligible_registrations": 3,
            "unknown_registrations": 0,
            "eligible_runners_drained": 1,
            "eligibility_observed_at": "2026-10-04T12:06:00+00:00",
            "required": True,
            "required_note": None,
            "coverage_note": "repo-registered runners only",
            "open_alerts": [],
        },
        {
            "repo": "qontinui/qontinui-claude-config",
            "pool": "qontinui-ccfg,self-hosted",
            "state": "unknown",
            "state_reason": "queue poll failed (GitHub 502)",
            "observed_at": "2026-10-04T12:05:00+00:00",
            "stale_after_secs": 360,
            "poll_ok": False,
            "poll_complete": False,
            "queued_jobs": None,
            "oldest_queued_age_secs": None,
            "threshold_secs": None,
            "p90_wait_secs": None,
            "eligibility_state": "unknown",
            "eligible_runners": None,
            "eligible_registrations": None,
            "unknown_registrations": None,
            "eligible_runners_drained": None,
            "eligibility_observed_at": None,
            "required": None,
            "required_note": "required-checks config unreadable",
            "coverage_note": "repo-registered runners only",
            "open_alerts": [
                {
                    "alert_id": "11111111-1111-1111-1111-111111111111",
                    "kind": "ci_job_queue_stalled",
                    "opened_at": "2026-10-04T11:00:00+00:00",
                    "summary": "14 jobs queued, oldest 3h12m",
                }
            ],
        },
    ],
    "repos": [
        {
            "repo": "qontinui/qontinui-web",
            "window_hours": 24,
            "state": "measured",
            "state_reason": None,
            "outcomes": {
                "pass": 120,
                "content_fail": 3,
                "infra_shaped": 7,
                "neutral": 2,
                "unknown": 0,
            },
            "hosted": {
                "state": "not_measured",
                "note": "hosted-only workflows are not sampled (ci_job_sampler hosted-only memo); see Phase 5a",
            },
        }
    ],
}


class TestCiOverviewProxy:
    def test_ci_overview_hits_coord_overview_path(self, auth_client: TestClient):
        resp, instance = _get(
            auth_client, OVERVIEW_PATH, _mock_response(json_data=OVERVIEW_BODY)
        )
        assert resp.status_code == 200
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/ci/overview")

    def test_ci_overview_forwards_operator_bearer(self, auth_client: TestClient):
        """A resolved tenant triggers bearer-forwarding — coord's route is
        ``TenantId``-authed, so an anonymous forward would 401."""
        sentinel = {"Authorization": "Bearer operator-token"}
        with patch_ops(
            "_tenant_headers",
            return_value=sentinel,
        ) as tenant_headers:
            _, instance = _get(
                auth_client, OVERVIEW_PATH, _mock_response(json_data=OVERVIEW_BODY)
            )
        tenant_headers.assert_called_once()
        assert instance.get.call_args.kwargs.get("headers") == sentinel

    def test_ci_overview_is_verbatim_including_nulls(self, auth_client: TestClient):
        """Exact equality on purpose: no field is dropped, no null is
        coerced. A measured ``0`` stays ``0`` and an unknown ``null`` stays
        ``null`` — the page's whole honesty rests on telling them apart."""
        resp, _ = _get(
            auth_client, OVERVIEW_PATH, _mock_response(json_data=OVERVIEW_BODY)
        )
        body = resp.json()
        assert body == OVERVIEW_BODY
        measured, unknown = body["pools"]
        assert measured["queued_jobs"] == 0
        assert unknown["queued_jobs"] is None
        assert unknown["required"] is None
        assert body["repos"][0]["hosted"]["state"] == "not_measured"

    def test_ci_overview_empty_tenant_passes_note(self, auth_client: TestClient):
        empty = {
            "as_of": "2026-10-04T12:08:00+00:00",
            "coverage_note": "",
            "note": "tenant has no registered repos",
            "pools": [],
            "repos": [],
        }
        resp, _ = _get(auth_client, OVERVIEW_PATH, _mock_response(json_data=empty))
        assert resp.status_code == 200
        assert resp.json() == empty

    def test_ci_overview_coord_404_is_not_an_empty_fleet(self, auth_client: TestClient):
        """A coord predating the route must reach the page as an error it
        renders UNKNOWN — never degraded to ``{}``, which would read as a
        tenant with no pools."""
        resp, _ = _get(
            auth_client,
            OVERVIEW_PATH,
            _mock_response(
                status_code=404, json_data=None, text='{"error":"NOT_FOUND"}'
            ),
        )
        assert resp.status_code == 404

    def test_ci_overview_coord_unreachable_is_502(self, auth_client: TestClient):
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = auth_client.get(OVERVIEW_PATH)
        assert resp.status_code == 502


class TestCiStatusFreshness:
    def test_ci_status_freshness_fields_survive_response_model(
        self, auth_client: TestClient
    ):
        coord = {
            "as_of": "2026-10-04T12:08:00+00:00",
            "repos": [
                {
                    "repo": "qontinui/qontinui-web",
                    "main_verdict": "green",
                    "open_pr_checks": {"success": 4, "failure": 1, "pending": 2},
                    "latest_details_url": None,
                    "main_head_sha": "abc123",
                    "main_verdict_observed_at": "2026-10-04T12:00:00+00:00",
                    "pr_checks_observed_at": "2026-10-04T12:07:30+00:00",
                }
            ],
        }
        resp, instance = _get(auth_client, STATUS_PATH, _mock_response(json_data=coord))
        assert resp.status_code == 200
        assert instance.get.call_args.args[0].endswith("/coord/ci/status")
        body = resp.json()
        # str pass-through: coord's RFC 3339 text arrives byte-for-byte.
        assert body["as_of"] == "2026-10-04T12:08:00+00:00"
        row = body["repos"][0]
        assert row["main_verdict_observed_at"] == "2026-10-04T12:00:00+00:00"
        assert row["pr_checks_observed_at"] == "2026-10-04T12:07:30+00:00"

    def test_ci_status_vacuously_green_with_null_stamp(self, auth_client: TestClient):
        """The zero-baseline arm: coord has no baseline to date the verdict
        by, so the stamp is ``null`` — and must stay ``null``."""
        coord = {
            "as_of": "2026-10-04T12:08:00+00:00",
            "repos": [
                {
                    "repo": "qontinui/new-repo",
                    "main_verdict": "vacuously_green",
                    "open_pr_checks": {"success": 0, "failure": 0, "pending": 0},
                    "latest_details_url": None,
                    "main_head_sha": None,
                    "main_verdict_observed_at": None,
                    "pr_checks_observed_at": None,
                }
            ],
        }
        resp, _ = _get(auth_client, STATUS_PATH, _mock_response(json_data=coord))
        assert resp.status_code == 200
        row = resp.json()["repos"][0]
        assert row["main_verdict"] == "vacuously_green"
        assert row["main_verdict_observed_at"] is None
        assert row["pr_checks_observed_at"] is None

    def test_ci_status_pre_phase2_coord_still_answers(self, auth_client: TestClient):
        """A coord that predates the stamps sends none. The proxy must not
        500 on validation; the stamps arrive ``null`` (UNKNOWN freshness)."""
        coord = {
            "repos": [
                {
                    "repo": "qontinui/qontinui-web",
                    "main_verdict": "red",
                    "open_pr_checks": {"success": 0, "failure": 2, "pending": 0},
                    "latest_details_url": None,
                    "main_head_sha": "def456",
                }
            ]
        }
        resp, _ = _get(auth_client, STATUS_PATH, _mock_response(json_data=coord))
        assert resp.status_code == 200
        body = resp.json()
        assert body["as_of"] is None
        assert body["repos"][0]["main_verdict_observed_at"] is None
        assert body["repos"][0]["pr_checks_observed_at"] is None
