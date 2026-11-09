"""The callerless ``/integration-testing`` routes are retired, and stay retired.

- ``POST /api/v1/integration-testing/execute`` answered every request with
  fabricated execution data (a fixed 1500 ms run, every action
  ``success: True``, ``success_rate: 1.0``). Its only web caller,
  ``hooks/useMockExecution.ts``, was imported by nothing.
- ``POST /api/v1/integration-testing/reports/pdf`` and ``/reports/pdf/async``
  rendered a PDF from a client-supplied server filesystem path. Their only
  web caller, ``ReportExportButton``, was rendered only by the equally dead
  ``ExecutionVisualization``. The async job store was never wired:
  ``set_redis_client`` had no caller, and no route read the job status back.

No other qontinui repo calls any of the three. A result built from no
execution is a status signal that observes nothing
[policy: ux-priorities/a-status-signal-must-observe-the-state-it-names], and
dead paths are deleted, not kept [policy: operating-rules/delete-over-deprecate].
So the routes, ``app/services/reports`` and the ``reportlab`` dependency were
removed together with the dead frontend chain.

The snapshot screenshot routes on the same router ARE served and must stay
served. The control pins that, so a check that stops seeing the router cannot
pass silently.

Mutation that turns this red: re-adding any of the three handlers to
``app/api/v1/endpoints/integration_testing.py``.
"""

from __future__ import annotations

from typing import Any

import pytest

RETIRED_POST_PATHS = (
    "/api/v1/integration-testing/execute",
    "/api/v1/integration-testing/reports/pdf",
    "/api/v1/integration-testing/reports/pdf/async",
)

#: Served today on the same router; if the walk stops seeing it, it is vacuous.
CONTROL_PATH = "/api/v1/integration-testing/snapshots/{run_id}/screenshots"


@pytest.fixture(scope="module")
def live_app() -> Any:
    from app.main import app

    return app


def test_retired_routes_are_not_documented(live_app: Any) -> None:
    documented = live_app.openapi().get("paths", {})

    assert CONTROL_PATH in documented, (
        f"control: {CONTROL_PATH} is not in the OpenAPI document; the "
        "integration-testing router is not being read, so its silence proves nothing"
    )
    served = [p for p in RETIRED_POST_PATHS if p in documented]
    assert not served, f"retired callerless routes are documented again: {served}"


@pytest.mark.parametrize("path", RETIRED_POST_PATHS)
def test_retired_route_is_not_found_over_http(live_app: Any, path: str) -> None:
    from fastapi.testclient import TestClient

    # No ``with`` block: the lifespan (DB/Redis startup) is not needed to route.
    client = TestClient(live_app, raise_server_exceptions=False)
    response = client.post(path, json={})
    # 404, not 405/401/422: anything else means some route still owns this path.
    assert response.status_code == 404, (
        f"POST {path} answered {response.status_code}; the retired route must "
        "reach no handler"
    )
