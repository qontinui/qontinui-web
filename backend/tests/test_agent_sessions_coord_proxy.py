"""Tests for the coord-proxying ``/api/v1/admin/agent-sessions`` endpoints.

Phase 2 of ``2026-05-30-web-coord-schema-boundary-decoupling.md``: the
two admin endpoints no longer read coord's ``coord.*`` schema directly
— they proxy to coord's HTTP API (``GET /coord/agent-sessions`` and
``GET /coord/agent-sessions/:id/lineage``) and pass coord's JSON
through verbatim.

These tests mock the coord GET (``_proxy_coord_get``) so no live coord
is needed, and assert:

* the endpoints call coord with the expected path + forwarded query
  params (live / user_id / since / limit),
* coord's ``{sessions,count}`` / ``{session_id,actions}`` shapes pass
  through untouched,
* web-side query validation (limit floor/cap, RFC3339 since, UUID
  session_id) still runs before the coord call,
* the ``require_admin`` gate is preserved,
* coord 502/504/4xx mapping is honored.

Supersedes ``test_agent_sessions_endpoints.py`` (which exercised the
old DB-direct cross-schema SQL path).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


def _admin_user() -> MagicMock:
    u = MagicMock()
    u.id = uuid4()
    u.email = "admin@example.com"
    u.is_active = True
    u.is_verified = True
    u.is_superuser = True
    return u


def _build_app(*, authenticated: bool = True) -> FastAPI:
    """Mount the agent_sessions router with require_admin overridden."""
    from app.api.admin_deps import require_admin
    from app.api.v1.endpoints.agent_sessions import router

    test_app = FastAPI()
    if authenticated:
        test_app.dependency_overrides[require_admin] = _admin_user
    test_app.include_router(router, prefix="/api/v1/admin")
    return test_app


# ---------------------------------------------------------------------------
# GET /admin/agent-sessions  → coord GET /coord/agent-sessions
# ---------------------------------------------------------------------------


class TestListAgentSessionsProxy:
    def test_passes_through_coord_envelope(self):
        sid = str(uuid4())
        coord_payload = {
            "sessions": [
                {
                    "id": sid,
                    "user_id": None,
                    "device_id": None,
                    "first_seen": "2026-05-18T12:00:00+00:00",
                    "last_seen": "2026-05-18T12:00:00+00:00",
                    "label": "ufix-2026-05-18",
                    "closed_at": None,
                }
            ],
            "count": 1,
        }
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value=coord_payload),
        ) as mock_get:
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 200
        # The web layer returns coord's envelope with only the two name
        # fields added (session-identity-registry enrichment); every
        # coord-supplied field passes through verbatim.
        body = resp.json()
        assert body["count"] == 1
        (row,) = body["sessions"]
        for key, value in coord_payload["sessions"][0].items():
            assert row[key] == value
        # Old-coord payload (no derived_name) → derived_name None,
        # name falls back to label.
        assert row["derived_name"] is None
        assert row["name"] == "ufix-2026-05-18"
        assert set(row) == set(coord_payload["sessions"][0]) | {
            "derived_name",
            "name",
        }
        # Called the right coord path.
        assert mock_get.call_args.args[0] == "/coord/agent-sessions"

    def test_name_fields_enrichment(self):
        """derived_name passes through; name = label if set else derived_name."""
        coord_payload = {
            "sessions": [
                # label wins over derived_name.
                {
                    "id": str(uuid4()),
                    "label": "operator-label",
                    "derived_name": "fix-web-enroll-bridge",
                },
                # No label → name falls back to derived_name.
                {
                    "id": str(uuid4()),
                    "label": None,
                    "derived_name": "fix-web-enroll-bridge",
                },
                # Neither → both None.
                {"id": str(uuid4()), "label": None},
            ],
            "count": 3,
        }
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value=coord_payload),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 200
        labeled, derived_only, bare = resp.json()["sessions"]
        assert labeled["name"] == "operator-label"
        assert labeled["derived_name"] == "fix-web-enroll-bridge"
        assert derived_only["name"] == "fix-web-enroll-bridge"
        assert derived_only["derived_name"] == "fix-web-enroll-bridge"
        assert bare["name"] is None
        assert bare["derived_name"] is None

    def test_forwards_all_filters_as_query_params(self):
        uid = uuid4()
        app = _build_app()
        captured: dict[str, Any] = {}

        async def fake_proxy(path, *, params=None):  # noqa: ANN001
            captured["path"] = path
            captured["params"] = params
            return {"sessions": [], "count": 0}

        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=fake_proxy,
        ):
            client = TestClient(app)
            resp = client.get(
                "/api/v1/admin/agent-sessions",
                params={
                    "live": "true",
                    "user_id": str(uid),
                    "since": "2026-05-18T00:00:00Z",
                    "limit": 42,
                },
            )
        assert resp.status_code == 200
        assert captured["path"] == "/coord/agent-sessions"
        p = captured["params"]
        assert p["live"] is True
        assert p["user_id"] == str(uid)
        assert p["limit"] == 42
        assert p["since"].startswith("2026-05-18T00:00:00")

    def test_forwards_identity_registry_filters(self):
        """q / status / device_id / repo (coord PR #894) forward to coord."""
        did = uuid4()
        app = _build_app()
        captured: dict[str, Any] = {}

        async def fake_proxy(path, *, params=None):  # noqa: ANN001
            captured["path"] = path
            captured["params"] = params
            return {"sessions": [], "count": 0}

        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=fake_proxy,
        ):
            client = TestClient(app)
            resp = client.get(
                "/api/v1/admin/agent-sessions",
                params={
                    "q": "enroll bridge",
                    "status": "stale",
                    "device_id": str(did),
                    "repo": "qontinui/qontinui-web",
                },
            )
        assert resp.status_code == 200
        p = captured["params"]
        assert p["q"] == "enroll bridge"
        assert p["status"] == "stale"
        assert p["device_id"] == str(did)
        assert p["repo"] == "qontinui/qontinui-web"

    def test_identity_registry_filters_omitted_when_unset(self):
        """Unset new filters are NOT forwarded (old coords reject unknowns)."""
        app = _build_app()
        captured: dict[str, Any] = {}

        async def fake_proxy(path, *, params=None):  # noqa: ANN001
            captured["params"] = params
            return {"sessions": [], "count": 0}

        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=fake_proxy,
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 200
        for key in ("q", "status", "device_id", "repo"):
            assert key not in captured["params"]

    def test_invalid_status_is_422_no_coord_call(self):
        app = _build_app()
        mock = AsyncMock(return_value={"sessions": [], "count": 0})
        with patch("app.api.v1.endpoints.agent_sessions._proxy_coord_get", new=mock):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions?status=zombie")
        assert resp.status_code == 422
        mock.assert_not_awaited()

    def test_invalid_device_id_is_422_no_coord_call(self):
        app = _build_app()
        mock = AsyncMock(return_value={"sessions": [], "count": 0})
        with patch("app.api.v1.endpoints.agent_sessions._proxy_coord_get", new=mock):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions?device_id=not-a-uuid")
        assert resp.status_code == 422
        mock.assert_not_awaited()

    def test_new_row_fields_and_search_degraded_pass_through(self):
        """summary/status per-row + top-level search_degraded pass verbatim."""
        coord_payload = {
            "sessions": [
                {
                    "id": str(uuid4()),
                    "label": None,
                    "derived_name": "proud-nimbus-rooster",
                    "summary": "P4 twin sessions UI in qontinui-web",
                    "status": "live",
                }
            ],
            "count": 1,
            "search_degraded": True,
        }
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value=coord_payload),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions?q=twin")
        assert resp.status_code == 200
        body = resp.json()
        assert body["search_degraded"] is True
        (row,) = body["sessions"]
        assert row["summary"] == "P4 twin sessions UI in qontinui-web"
        assert row["status"] == "live"
        assert row["name"] == "proud-nimbus-rooster"

    def test_default_limit_forwarded_is_100(self):
        app = _build_app()
        captured: dict[str, Any] = {}

        async def fake_proxy(path, *, params=None):  # noqa: ANN001
            captured["params"] = params
            return {"sessions": [], "count": 0}

        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=fake_proxy,
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 200
        assert captured["params"]["limit"] == 100

    def test_limit_above_cap_is_422_no_coord_call(self):
        app = _build_app()
        mock = AsyncMock(return_value={"sessions": [], "count": 0})
        with patch("app.api.v1.endpoints.agent_sessions._proxy_coord_get", new=mock):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions?limit=10000")
        assert resp.status_code == 422
        mock.assert_not_awaited()

    def test_limit_below_floor_is_422_no_coord_call(self):
        app = _build_app()
        mock = AsyncMock(return_value={"sessions": [], "count": 0})
        with patch("app.api.v1.endpoints.agent_sessions._proxy_coord_get", new=mock):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions?limit=0")
        assert resp.status_code == 422
        mock.assert_not_awaited()

    def test_invalid_since_is_422(self):
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value={"sessions": [], "count": 0}),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions?since=not-a-date")
        assert resp.status_code == 422

    def test_coord_502_propagates(self):
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(
                side_effect=HTTPException(
                    status_code=502, detail="coord is not reachable"
                )
            ),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 502

    def test_unauth_blocked(self):
        from app.api.deps import get_current_user_async
        from app.api.v1.endpoints.agent_sessions import router

        test_app = FastAPI()
        non_admin = MagicMock()
        non_admin.is_superuser = False
        test_app.dependency_overrides[get_current_user_async] = lambda: non_admin
        test_app.include_router(router, prefix="/api/v1/admin")
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value={"sessions": [], "count": 0}),
        ):
            client = TestClient(test_app)
            resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /admin/agent-sessions/{key}  → coord GET /coord/agent-sessions/:id
# ---------------------------------------------------------------------------


class TestResolveAgentSessionProxy:
    def test_passes_through_resolver_envelope(self):
        sid = str(uuid4())
        card = {
            "id": sid,
            "name": "proud-nimbus-rooster",
            "label": None,
            "derived_name": "proud-nimbus-rooster",
            "user_id": None,
            "device_id": str(uuid4()),
            "first_seen": "2026-07-01T12:00:00+00:00",
            "last_seen": "2026-07-02T12:00:00+00:00",
            "closed_at": None,
            "status": "live",
            "machine": {
                "id": str(uuid4()),
                "name": "spaceship",
                "hostname": "spaceship.local",
                "environment": {"id": str(uuid4()), "name": "dev"},
            },
            "summary": "P4 twin sessions UI",
            "working_on": {
                "session": {
                    "intent_purpose": "P4 twin sessions UI",
                    "plan_slug": "2026-07-02-digital-twin-session-identity-registry",
                    "correlation_topic": None,
                    "repo": "qontinui/qontinui-web",
                    "branch": "feat/session-identity-registry",
                    "provider": "claude",
                    "session_kind": "terminal_claude",
                    "state": "active",
                },
                "commits": [
                    {
                        "repo": "qontinui/qontinui-web",
                        "sha": "0761235feb5715f7e7919b4c2790058033ca623b",
                        "branch": "feat/session-identity-registry",
                        "occurred_at": "2026-07-02T11:00:00+00:00",
                    }
                ],
                "lineage": [
                    {
                        "kind": "agent_worktree",
                        "handle": "qontinui-web-wt-session-identity",
                        "occurred_at": "2026-07-02T10:00:00+00:00",
                    }
                ],
            },
        }
        coord_payload = {"resolved": [card], "count": 1}
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value=coord_payload),
        ) as mock_get:
            client = TestClient(app)
            resp = client.get(f"/api/v1/admin/agent-sessions/{sid}")
        assert resp.status_code == 200
        # Envelope verbatim — no web-side reshaping of the cards.
        assert resp.json() == coord_payload
        assert mock_get.call_args.args[0] == f"/coord/agent-sessions/{sid}"

    def test_resolves_by_name(self):
        """The key may be a derived/operator name, not just a UUID."""
        app = _build_app()
        coord_payload = {"resolved": [{"id": str(uuid4())}], "count": 1}
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value=coord_payload),
        ) as mock_get:
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions/proud-nimbus-rooster")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert (
            mock_get.call_args.args[0] == "/coord/agent-sessions/proud-nimbus-rooster"
        )

    def test_key_is_url_quoted(self):
        """Reserved characters in the key can't rewrite the coord path."""
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value={"resolved": [], "count": 0}),
        ) as mock_get:
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions/a%3Fb%23c")
        assert resp.status_code == 200
        assert mock_get.call_args.args[0] == "/coord/agent-sessions/a%3Fb%23c"

    def test_coord_404_propagates(self):
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(
                side_effect=HTTPException(status_code=404, detail="no such session")
            ),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions/no-such-name")
        assert resp.status_code == 404

    def test_unauth_blocked(self):
        from app.api.deps import get_current_user_async
        from app.api.v1.endpoints.agent_sessions import router

        test_app = FastAPI()
        non_admin = MagicMock()
        non_admin.is_superuser = False
        test_app.dependency_overrides[get_current_user_async] = lambda: non_admin
        test_app.include_router(router, prefix="/api/v1/admin")
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value={"resolved": [], "count": 0}),
        ):
            client = TestClient(test_app)
            resp = client.get("/api/v1/admin/agent-sessions/some-name")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /admin/agent-sessions/{id}/lineage  → coord GET .../:id/lineage
# ---------------------------------------------------------------------------


class TestSessionLineageProxy:
    def test_passes_through_coord_payload(self):
        sid = str(uuid4())
        coord_payload = {
            "session_id": sid,
            "actions": [
                {
                    "kind": "agent_log",
                    "handle": "info phase_start",
                    "occurred_at": "2026-05-18T12:00:00+00:00",
                },
                {
                    "kind": "merge_proposal",
                    "handle": str(uuid4()),
                    "occurred_at": "2026-05-18T11:00:00+00:00",
                },
            ],
        }
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value=coord_payload),
        ) as mock_get:
            client = TestClient(app)
            resp = client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert mock_get.call_args.args[0] == f"/coord/agent-sessions/{sid}/lineage"

    def test_empty_actions_passes_through(self):
        sid = str(uuid4())
        coord_payload = {"session_id": sid, "actions": []}
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(return_value=coord_payload),
        ):
            client = TestClient(app)
            resp = client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_invalid_session_id_is_422_no_coord_call(self):
        app = _build_app()
        mock = AsyncMock(return_value={"session_id": "x", "actions": []})
        with patch("app.api.v1.endpoints.agent_sessions._proxy_coord_get", new=mock):
            client = TestClient(app)
            resp = client.get("/api/v1/admin/agent-sessions/not-a-uuid/lineage")
        assert resp.status_code == 422
        mock.assert_not_awaited()

    def test_coord_504_propagates(self):
        sid = str(uuid4())
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_sessions._proxy_coord_get",
            new=AsyncMock(
                side_effect=HTTPException(
                    status_code=504, detail="timeout waiting for coord"
                )
            ),
        ):
            client = TestClient(app)
            resp = client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        assert resp.status_code == 504


# ---------------------------------------------------------------------------
# _proxy_coord_get helper — connect/timeout mapping + bearer forwarding
# ---------------------------------------------------------------------------


class TestProxyCoordGetHelper:
    @pytest.mark.asyncio
    async def test_connect_error_maps_to_502(self):
        from app.api.v1.endpoints import agent_sessions as mod

        class _Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, *a, **k):
                raise httpx.ConnectError("nope")

        with patch.object(mod.httpx, "AsyncClient", _Client):
            with pytest.raises(HTTPException) as ei:
                await mod._proxy_coord_get("/coord/agent-sessions")
        assert ei.value.status_code == 502

    @pytest.mark.asyncio
    async def test_timeout_maps_to_504(self):
        from app.api.v1.endpoints import agent_sessions as mod

        class _Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, *a, **k):
                raise httpx.TimeoutException("slow")

        with patch.object(mod.httpx, "AsyncClient", _Client):
            with pytest.raises(HTTPException) as ei:
                await mod._proxy_coord_get("/coord/agent-sessions")
        assert ei.value.status_code == 504

    @pytest.mark.asyncio
    async def test_forwards_caller_bearer(self):
        from app.api.v1.endpoints import agent_sessions as mod

        seen: dict[str, Any] = {}

        class _Resp:
            status_code = 200

            def json(self):
                return {"sessions": [], "count": 0}

        class _Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, url, params=None, headers=None):  # noqa: ANN001
                seen["headers"] = headers or {}
                return _Resp()

        token = mod._caller_bearer.set("tok-abc")
        try:
            with patch.object(mod.httpx, "AsyncClient", _Client):
                await mod._proxy_coord_get("/coord/agent-sessions")
        finally:
            mod._caller_bearer.reset(token)
        assert seen["headers"].get("Authorization") == "Bearer tok-abc"
