"""The agent catalog read and the tenant-admin spawn switch proxies.

Phase 7 of plan
``2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type``
(``app/api/v1/endpoints/agent_registry_admin_switch.py``). Coord is mocked at
:func:`_coord_request`, the one transport both routes share with the rest of
the agent-registry proxy.

What each gate catches:

1. :class:`TestTheSwitchIsAdminGated` — the switch route losing its
   ``require_coord_tenant_admin`` dependency: a non-admin would then reach
   coord, and the refusal would be coord's body instead of the renderable
   ``not_coord_tenant_admin``. Asserts NO coord call is made.
2. :class:`TestCoordRefusalsPassThroughVerbatim` — any flattening of coord's
   422 / 503 / 403 bodies; the page renders coord's own reason beside the
   refused switch.
3. :class:`TestTheSwitchBody` — the forwarded body growing a field the admin
   did not set (an explicit ``null`` disposition is a different request from
   an absent one), or the route pointing anywhere but ``/admin-switch``.
4. :class:`TestTheCatalogIsReadableByMembers` — the catalog acquiring the
   admin gate (members must see what is off and why), and
   ``sources_unread`` being dropped or an absent one reading as "all read".
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

TRANSPORT = "app.api.v1.endpoints.agent_registry._coord_request"
SWITCH = "/api/v1/agent-registry/admin/registry/triage-judge/switch"
CATALOG = "/api/v1/agent-registry/catalog"


def _user() -> MagicMock:
    u = MagicMock()
    u.id = uuid4()
    u.email = "member@example.com"
    u.is_active = True
    u.is_superuser = False
    return u


def _build_app(*, admin: bool) -> FastAPI:
    """Mount the new router with both gates overridden.

    ``admin=False`` makes the shared admin dependency raise the 403 the real
    one raises for a non-admin; the member gate always passes (a member is
    authenticated either way).
    """
    from app.api.coord_proxy import require_coord_tenant_admin
    from app.api.v1.endpoints.agent_registry import get_registry_user
    from app.api.v1.endpoints.agent_registry_admin_switch import router

    test_app = FastAPI()
    test_app.dependency_overrides[get_registry_user] = _user

    def _admin_gate():
        if not admin:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")
        return uuid4()

    test_app.dependency_overrides[require_coord_tenant_admin] = _admin_gate
    test_app.include_router(router, prefix="/api/v1/agent-registry")
    return test_app


def _switch_answer(**agent_overrides):
    agent = {
        "id": str(uuid4()),
        "agent_name": "triage-judge",
        "purpose": "",
        "trigger_condition": "",
        "spawn_path": "in_session_subagent",
        "model": None,
        "effort": None,
        "default_enabled": True,
        "policy_required": False,
        "allowed_dispositions": ["block", "degrade", "warn_proceed"],
        "fanout_bound": None,
        "definition_body": None,
        "admin_disabled": True,
        "admin_disposition": None,
        "admin_disabled_by": "admin@example.com",
        "admin_disabled_at": "2026-11-25T00:00:00Z",
        "admin_reason": "noisy",
    }
    agent.update(agent_overrides)
    return {
        "agent": agent,
        "effective": {
            "agent_name": "triage-judge",
            "purpose": "",
            "spawn_path": "in_session_subagent",
            "model": None,
            "effort": None,
            "policy_required": False,
            "fanout_bound": None,
            "enabled": False,
            "disposition": "degrade",
            "source": "admin",
            "admin_disabled": True,
        },
        "created": True,
    }


def _catalog(**overrides):
    body = {
        "agents": [
            {
                "agent_name": "triage-judge",
                "has_row": False,
                "spawn_path": "in_session_subagent",
                "purpose": "judges triage",
                "sources": [
                    {
                        "source": "declared_role",
                        "repo": "qontinui/qontinui-claude-config",
                        "sha": "abc123",
                        "path": ".claude/agents/triage-judge.md",
                    }
                ],
                "admin_disabled": False,
                "admin_disposition": None,
                "admin_reason": None,
                "default_enabled": True,
                "policy_required": False,
                "allowed_dispositions": ["block", "degrade", "warn_proceed"],
                "enforcement": "hook",
            }
        ],
        "sources_unread": [],
        "declared_skipped": [],
    }
    body.update(overrides)
    return body


class TestTheSwitchIsAdminGated:
    def test_a_non_admin_is_refused_without_calling_coord(self):
        app = _build_app(admin=False)
        with patch(TRANSPORT, new=AsyncMock(return_value=_switch_answer())) as req:
            resp = TestClient(app).put(SWITCH, json={"disabled": True})

        assert resp.status_code == 403
        assert resp.json()["detail"] == "not_coord_tenant_admin"
        req.assert_not_called()

    def test_the_route_depends_on_the_shared_admin_gate(self):
        """Pin the dependency itself, not only the override's behaviour."""
        from app.api.coord_proxy import require_coord_tenant_admin
        from app.api.v1.endpoints.agent_registry_admin_switch import router

        route = next(
            r
            for r in router.routes
            if getattr(r, "path", "") == "/admin/registry/{agent_name}/switch"
        )
        calls = [d.call for d in route.dependant.dependencies]
        assert require_coord_tenant_admin in calls

    def test_an_admin_gets_coords_answer_verbatim(self):
        app = _build_app(admin=True)
        answer = _switch_answer()
        with patch(TRANSPORT, new=AsyncMock(return_value=answer)):
            resp = TestClient(app).put(SWITCH, json={"disabled": True})

        assert resp.status_code == 200
        assert resp.json() == answer


class TestTheSwitchBody:
    def test_targets_the_admin_switch_door_with_the_minimal_body(self):
        app = _build_app(admin=True)
        with patch(TRANSPORT, new=AsyncMock(return_value=_switch_answer())) as req:
            TestClient(app).put(SWITCH, json={"disabled": True})

        method, path = req.call_args.args
        assert method == "PUT"
        assert path == "/coord/agent-registry/triage-judge/admin-switch"
        # Absent, not null: the admin set neither a disposition nor a reason.
        assert req.call_args.kwargs["json_body"] == {"disabled": True}

    def test_disposition_and_reason_are_forwarded_when_set(self):
        app = _build_app(admin=True)
        with patch(TRANSPORT, new=AsyncMock(return_value=_switch_answer())) as req:
            TestClient(app).put(
                SWITCH,
                json={"disabled": True, "disposition": "block", "reason": "noisy"},
            )

        assert req.call_args.kwargs["json_body"] == {
            "disabled": True,
            "disposition": "block",
            "reason": "noisy",
        }

    def test_an_unknown_field_is_refused_before_coord(self):
        """`default_enabled` must never ride this door (plan D4)."""
        app = _build_app(admin=True)
        with patch(TRANSPORT, new=AsyncMock(return_value=_switch_answer())) as req:
            resp = TestClient(app).put(
                SWITCH, json={"disabled": True, "default_enabled": False}
            )

        assert resp.status_code == 422
        req.assert_not_called()

    def test_the_agent_name_is_url_quoted(self):
        app = _build_app(admin=True)
        with patch(TRANSPORT, new=AsyncMock(return_value=_switch_answer())) as req:
            TestClient(app).put(
                "/api/v1/agent-registry/admin/registry/a%3Fb/switch",
                json={"disabled": True},
            )

        assert req.call_args.args[1] == "/coord/agent-registry/a%3Fb/admin-switch"

    def test_an_empty_404_says_coord_is_behind(self):
        app = _build_app(admin=True)
        with patch(
            TRANSPORT,
            new=AsyncMock(side_effect=HTTPException(status_code=404, detail="")),
        ):
            resp = TestClient(app).put(SWITCH, json={"disabled": True})

        assert resp.status_code == 502
        assert "admin-switch" in resp.json()["detail"]
        assert "deploy qontinui-coord first" in resp.json()["detail"]


class TestCoordRefusalsPassThroughVerbatim:
    @pytest.mark.parametrize(
        ("code", "status_code"),
        [
            ("invalid_agent_name", 422),
            ("disposition_not_allowed", 422),
            ("disposition_requires_disabled", 422),
            ("reason_too_long", 422),
            ("registry_not_provisioned", 503),
        ],
    )
    def test_status_and_error_code_reach_the_client(self, code, status_code):
        app = _build_app(admin=True)
        body = {"error": code, "message": f"coord says {code}", "agent_name": "x"}
        with patch(
            TRANSPORT,
            new=AsyncMock(
                side_effect=HTTPException(status_code=status_code, detail=body)
            ),
        ):
            resp = TestClient(app).put(SWITCH, json={"disabled": True})

        assert resp.status_code == status_code
        assert resp.json()["detail"] == body

    def test_coords_own_403_passes_through(self):
        """The web gate passed but coord's `rbac::require_role` did not."""
        app = _build_app(admin=True)
        body = {"error": "insufficient role", "required": "admin"}
        with patch(
            TRANSPORT,
            new=AsyncMock(side_effect=HTTPException(status_code=403, detail=body)),
        ):
            resp = TestClient(app).put(SWITCH, json={"disabled": False})

        assert resp.status_code == 403
        assert resp.json()["detail"] == body


class TestTheCatalogIsReadableByMembers:
    def test_a_member_reads_the_catalog(self):
        """`admin=False`: the catalog must not carry the admin gate."""
        app = _build_app(admin=False)
        with patch(TRANSPORT, new=AsyncMock(return_value=_catalog())) as req:
            resp = TestClient(app).get(CATALOG)

        assert resp.status_code == 200
        assert resp.json() == _catalog()
        assert req.call_args.args == ("GET", "/coord/agent-registry/catalog")

    def test_sources_unread_passes_through(self):
        unread = [{"source": "declared_role", "reason": "mirror read failed"}]
        app = _build_app(admin=False)
        with patch(
            TRANSPORT, new=AsyncMock(return_value=_catalog(sources_unread=unread))
        ):
            resp = TestClient(app).get(CATALOG)

        assert resp.json()["sources_unread"] == unread

    def test_an_absent_sources_unread_is_unknown_not_all_read(self):
        body = _catalog()
        del body["sources_unread"]
        app = _build_app(admin=False)
        with patch(TRANSPORT, new=AsyncMock(return_value=body)):
            resp = TestClient(app).get(CATALOG)

        unread = resp.json()["sources_unread"]
        assert len(unread) == 1
        assert "unknown" in unread[0]["reason"]

    @pytest.mark.parametrize(
        "payload", [{"sources_unread": []}, {"agents": None}, [], "nope"]
    )
    def test_no_agents_list_is_a_502_not_an_empty_catalog(self, payload):
        app = _build_app(admin=False)
        with patch(TRANSPORT, new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get(CATALOG)

        assert resp.status_code == 502

    def test_an_empty_404_says_coord_is_behind(self):
        app = _build_app(admin=False)
        with patch(
            TRANSPORT,
            new=AsyncMock(side_effect=HTTPException(status_code=404, detail="")),
        ):
            resp = TestClient(app).get(CATALOG)

        assert resp.status_code == 502
        assert "GET /coord/agent-registry/catalog" in resp.json()["detail"]

    def test_a_coord_failure_status_passes_through(self):
        app = _build_app(admin=False)
        body = {"error": "registry_not_provisioned"}
        with patch(
            TRANSPORT,
            new=AsyncMock(side_effect=HTTPException(status_code=503, detail=body)),
        ):
            resp = TestClient(app).get(CATALOG)

        assert resp.status_code == 503
        assert resp.json()["detail"] == body


class TestTheAppComposesTheRouter:
    def test_both_routes_are_mounted_under_the_agent_registry_prefix(self):
        from app.api.v1.api import api_router

        paths = {getattr(r, "path", "") for r in api_router.routes}
        assert "/agent-registry/catalog" in paths
        assert "/agent-registry/admin/registry/{agent_name}/switch" in paths


class TestTheAdminRowsCarryTheCeilingDetail:
    """`GET /admin/registry` passes who/when/why/disposition through."""

    def _get(self, row_overrides):
        from app.api.coord_proxy import require_coord_tenant_admin
        from app.api.v1.endpoints.agent_registry import router

        app = FastAPI()
        app.dependency_overrides[require_coord_tenant_admin] = lambda: uuid4()
        app.include_router(router, prefix="/api/v1/agent-registry")
        row = {
            "agent_name": "code-reviewer",
            "default_enabled": True,
            "policy_required": True,
            "allowed_dispositions": ["block", "degrade"],
            **row_overrides,
        }
        with patch(
            TRANSPORT, new=AsyncMock(return_value={"agents": [row], "prefs": []})
        ):
            return TestClient(app).get("/api/v1/agent-registry/admin/registry")

    def test_the_detail_fields_are_served(self):
        resp = self._get(
            {
                "admin_disabled": True,
                "admin_disposition": "block",
                "admin_reason": "too costly",
                "admin_disabled_by": "admin@example.com",
                "admin_disabled_at": "2026-11-25T00:00:00Z",
            }
        )
        agent = resp.json()["agents"][0]
        assert agent["admin_disposition"] == "block"
        assert agent["admin_reason"] == "too costly"
        assert agent["admin_disabled_by"] == "admin@example.com"
        assert agent["admin_disabled_at"] == "2026-11-25T00:00:00Z"

    def test_a_coord_without_the_columns_still_renders(self):
        resp = self._get({})
        assert resp.status_code == 200
        assert resp.json()["agents"][0]["admin_disposition"] is None

    def test_a_wrong_typed_detail_degrades_rather_than_500s(self):
        resp = self._get({"admin_reason": 42})
        assert resp.status_code == 200
        assert resp.json()["agents"][0]["admin_reason"] is None
