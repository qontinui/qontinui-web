"""The ``/api/v1/testing/historical`` routes are retired, and stay retired.

Plan ``2026-11-06-verification-stores-nothing-writes-are-deleted-and-their-open-write-doors-close``,
Phase 2. The seven routes (``/random``, ``/pattern``, ``/frames``,
``/playback``, ``/index``, ``/actions``, ``/test-run``) read and wrote a store
nothing writes: the Phase 0 production census (coord finding ``45c41d86``)
measured every backing table at zero rows and zero inserts ever, and zero
handled requests in the 14-day log window. ``POST /actions`` was an
unauthenticated write door. Each was deleted rather than authenticated
(K-D1 arm 2), together with ``services/frame_extraction.py`` and
``services/video_file_reader.py``.

What must hold, with the mutation that turns it red: re-including any router
under ``/testing/historical`` in ``app/api/v1/api.py`` fails
``test_no_historical_route_is_served``. The walk reads the live ``app.routes``
and the served OpenAPI document, never a grep, and a control proves the walk
sees ``/api/v1`` routes at all.
"""

from __future__ import annotations

from typing import Any

import pytest

RETIRED_PREFIX = "/api/v1/testing/historical"

#: A route that is served today, under the same ``/api/v1`` router the retired
#: prefix was mounted on. If the walk stops seeing it, the walk is vacuous.
CONTROL_PATH_PREFIX = "/api/v1/execution"


@pytest.fixture(scope="module")
def live_app() -> Any:
    from app.main import app

    return app


def _route_paths(routes: list[Any]) -> list[str]:
    paths: list[str] = []
    for route in routes:
        path = getattr(route, "path", None)
        if isinstance(path, str):
            paths.append(path)
        # A mounted sub-application or included router exposes its own routes.
        sub_routes = getattr(route, "routes", None)
        if sub_routes:
            prefix = path or ""
            paths.extend(prefix + p for p in _route_paths(list(sub_routes)))
    return paths


def test_no_historical_route_is_served(live_app: Any) -> None:
    paths = _route_paths(list(live_app.routes))

    assert any(p.startswith(CONTROL_PATH_PREFIX) for p in paths), (
        f"control: no served route under {CONTROL_PATH_PREFIX}; the route walk "
        "is not reading the app's /api/v1 router, so its silence proves nothing"
    )

    served = sorted(
        p for p in paths if p == RETIRED_PREFIX or p.startswith(RETIRED_PREFIX + "/")
    )
    assert not served, (
        "a retired historical-data route is served again; the store behind it "
        "holds no rows and nothing writes it (finding 45c41d86). Re-adding one "
        f"needs a live writer and a credential first: {served}"
    )

    documented = sorted(
        p
        for p in live_app.openapi().get("paths", {})
        if p == RETIRED_PREFIX or p.startswith(RETIRED_PREFIX + "/")
    )
    assert not documented, (
        f"the OpenAPI document still names retired historical routes: {documented}"
    )


def test_retired_actions_write_door_is_not_found_over_http(live_app: Any) -> None:
    """``POST /actions`` was the unauthenticated write door; a request to it now
    reaches no handler. The route walk above proves absence from the table; this
    proves it at the HTTP boundary, through the app's own middleware stack.
    """
    from fastapi.testclient import TestClient

    # No ``with`` block: the lifespan (DB/Redis startup) is not needed to route.
    client = TestClient(live_app, raise_server_exceptions=False)
    response = client.post(f"{RETIRED_PREFIX}/actions", json={})
    # 404, not 405: a 405 would mean some route still owns this path.
    assert response.status_code == 404, (
        f"POST {RETIRED_PREFIX}/actions answered {response.status_code}; the "
        "retired write door must reach no handler"
    )
