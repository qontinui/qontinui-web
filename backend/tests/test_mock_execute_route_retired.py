"""``POST /api/v1/integration-testing/execute`` is retired, and stays retired.

It was a placeholder that answered every request with fabricated execution data
(a fixed 1500 ms run, every action ``success: True``, ``success_rate: 1.0``).
Its only web caller was ``hooks/useMockExecution.ts``, which nothing imported,
and no other qontinui repo called it. A result built from no execution is a
status signal that observes nothing [policy: ux-priorities/
a-status-signal-must-observe-the-state-it-names], so the route, its request
model and the dead frontend chain were deleted rather than kept.

The sibling routes under ``/integration-testing`` (snapshot screenshots, PDF
reports) are served and must stay served; the control below pins that, so a
walk that stops seeing the router cannot pass silently.

Mutation that turns this red: re-adding any ``@router.post("/execute")`` to
``app/api/v1/endpoints/integration_testing.py``.
"""

from __future__ import annotations

from typing import Any

import pytest

RETIRED_PATH = "/api/v1/integration-testing/execute"

#: Served today on the same router; if the walk stops seeing it, it is vacuous.
CONTROL_PATH = "/api/v1/integration-testing/snapshots/{run_id}/screenshots"


@pytest.fixture(scope="module")
def live_app() -> Any:
    from app.main import app

    return app


def test_mock_execute_route_is_not_served(live_app: Any) -> None:
    documented = live_app.openapi().get("paths", {})

    assert CONTROL_PATH in documented, (
        f"control: {CONTROL_PATH} is not in the OpenAPI document; the "
        "integration-testing router is not being read, so its silence proves nothing"
    )
    assert RETIRED_PATH not in documented, (
        f"{RETIRED_PATH} is documented again; it returned fabricated execution "
        "data and had no caller"
    )


def test_mock_execute_route_is_not_found_over_http(live_app: Any) -> None:
    from fastapi.testclient import TestClient

    # No ``with`` block: the lifespan (DB/Redis startup) is not needed to route.
    client = TestClient(live_app, raise_server_exceptions=False)
    response = client.post(RETIRED_PATH, json={})
    # 404, not 405/401: anything else means some route still owns this path.
    assert response.status_code == 404, (
        f"POST {RETIRED_PATH} answered {response.status_code}; the retired "
        "placeholder must reach no handler"
    )
