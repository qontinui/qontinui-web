"""Tests for the per-repo follow-up dial proxies.

Plan ``2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind``
Phase 4b. ``/api/v1/operations/post-merge-followup-scope`` and
``/api/v1/operations/continuation-delivery-mode`` proxy coord's two per-repo
``tenant_repo_profiles`` dials. What this file pins:

1. **An unreadable scope is never rendered as ``all``.** Coord answers an
   unreadable preference with a 503; that stays a 503 here, and a 200 that
   carries no recognisable scope is a 502 rather than a guessed default.
2. **The PUT body is closed and keeps coord's ``code_paths`` semantics** — an
   omitted ``code_paths`` stays omitted on the wire (coord's "keep the stored
   globs"), ``[]`` is sent as ``[]`` (clear), and ``code_only`` without a glob
   is refused locally.
3. **A write is followed by a fresh read**, and a failed read-back is UNKNOWN,
   not the written value.
4. ``can_edit`` follows the effective-tenant rule, not coord's ``is_admin``
   union — the same rule as the fleet-policy proxy.

Mirrors ``test_operations_fleet_policy_proxy.py``: a minimal FastAPI app plus a
mocked ``httpx.AsyncClient`` (patched in ``operations``, which owns the proxy
helpers), so no live coord is needed.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"
REPO = "qontinui/qontinui-dev-notes"

COORD_SCOPE_DECLARED = {
    "domain": "post_merge_followup_scope",
    "repo": REPO,
    "scope": "code_only",
    "code_paths": ["scripts/**", ".github/**"],
    "resolved_scope": "repo",
    "mode": "shadow",
}

COORD_SCOPE_DEFAULT = {
    "domain": "post_merge_followup_scope",
    "repo": REPO,
    "scope": "all",
    "code_paths": [],
    "resolved_scope": "default",
    "mode": "shadow",
}


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.repo_followup_dials import router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    resolved = uuid4()
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
    test_app.include_router(router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    resp.content = b"x"
    return resp


@contextmanager
def _patch_identity(effective_roles=("admin",)):
    identity = MagicMock()
    # The union flag is set OPPOSITE to the effective roles in every test, so
    # a `can_edit` that read it would fail.
    identity.is_admin = "admin" not in effective_roles
    with (
        patch(
            "app.api.v1.endpoints.repo_followup_dials.get_coord_identity",
            AsyncMock(return_value=identity),
        ),
        patch(
            "app.api.v1.endpoints.repo_followup_dials._effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


@contextmanager
def _coord(get=None, put=None):
    instance = MagicMock()
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    if get is not None:
        instance.get = get
    if put is not None:
        instance.put = put
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as mock_client:
        mock_client.return_value = instance
        yield instance


# ---------------------------------------------------------------------------
# GET /post-merge-followup-scope
# ---------------------------------------------------------------------------


class TestGetPostMergeFollowupScope:
    def test_declared_scope_round_trips_with_mode(self, client: TestClient):
        with (
            _coord(
                get=AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DECLARED))
            ) as c,
            _patch_identity(),
        ):
            resp = client.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "repo": REPO,
            "scope": "code_only",
            "code_paths": ["scripts/**", ".github/**"],
            "resolved_scope": "repo",
            "mode": "shadow",
            "can_edit": True,
        }
        assert c.get.call_args.kwargs["params"] == {"repo": REPO}
        assert c.get.call_args.args[0].endswith("/coord/post-merge-followup-scope")

    def test_undeclared_default_is_reported_as_default(self, client: TestClient):
        with (
            _coord(
                get=AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DEFAULT))
            ),
            _patch_identity(),
        ):
            body = client.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            ).json()
        assert body["scope"] == "all"
        assert body["resolved_scope"] == "default"

    def test_coord_503_is_not_rendered_as_all(self, client: TestClient):
        """The unknown arm: an unreadable preference stays a 503."""
        unreadable = {"error": "preference_unreadable", "detail": "PG unavailable"}
        with (
            _coord(get=AsyncMock(return_value=_mock_response(503, unreadable))),
            _patch_identity(),
        ):
            resp = client.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            )
        assert resp.status_code == 503
        assert "preference_unreadable" in resp.text
        assert '"scope"' not in resp.text

    def test_a_200_without_a_scope_is_a_502_not_a_default(self, client: TestClient):
        with (
            _coord(get=AsyncMock(return_value=_mock_response(200, {"repo": REPO}))),
            _patch_identity(),
        ):
            resp = client.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            )
        assert resp.status_code == 502
        assert "unknown" in resp.json()["detail"]

    def test_an_unrecognised_mode_is_unknown_not_shadow(self, client: TestClient):
        payload = dict(COORD_SCOPE_DECLARED, mode="armed-ish")
        payload.pop("resolved_scope")
        with (
            _coord(get=AsyncMock(return_value=_mock_response(200, payload))),
            _patch_identity(),
        ):
            body = client.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            ).json()
        assert body["mode"] is None
        assert body["resolved_scope"] is None

    def test_can_edit_follows_effective_tenant_roles(self, client: TestClient):
        with (
            _coord(
                get=AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DEFAULT))
            ),
            _patch_identity(effective_roles=("developer",)),
        ):
            body = client.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            ).json()
        assert body["can_edit"] is False

    def test_superuser_can_edit_without_a_coord_admin_role(self):
        su = TestClient(_build_test_app(is_superuser=True))
        with (
            _coord(
                get=AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DEFAULT))
            ),
            _patch_identity(effective_roles=()),
        ):
            body = su.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            ).json()
        assert body["can_edit"] is True

    def test_a_non_full_name_repo_is_refused_without_a_round_trip(
        self, client: TestClient
    ):
        get = AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DEFAULT))
        with _coord(get=get), _patch_identity():
            resp = client.get(
                f"{API_PREFIX}/post-merge-followup-scope",
                params={"repo": "qontinui-dev-notes"},
            )
        assert resp.status_code == 422
        get.assert_not_awaited()

    def test_coord_unreachable_is_502(self, client: TestClient):
        with (
            _coord(get=AsyncMock(side_effect=httpx.ConnectError("refused"))),
            _patch_identity(),
        ):
            resp = client.get(
                f"{API_PREFIX}/post-merge-followup-scope", params={"repo": REPO}
            )
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# PUT /post-merge-followup-scope
# ---------------------------------------------------------------------------


class TestPutPostMergeFollowupScope:
    def _put_ok(self):
        return AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "ok": True,
                    "repo": REPO,
                    "scope": "code_only",
                    "code_paths": ["scripts/**", ".github/**"],
                    "resolved_scope": "repo",
                    "mode": "shadow",
                    "updated_by": "operator@example.com",
                },
            )
        )

    def test_code_only_write_sends_closed_body_and_reads_back(self, client: TestClient):
        put = self._put_ok()
        get = AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DECLARED))
        with _coord(get=get, put=put):
            resp = client.put(
                f"{API_PREFIX}/post-merge-followup-scope",
                json={
                    "repo": f" {REPO} ",
                    "scope": "code_only",
                    "code_paths": [" scripts/** ", ".github/**"],
                },
            )

        assert resp.status_code == 200
        sent = put.call_args.kwargs["json"]
        assert sent == {
            "repo": REPO,
            "scope": "code_only",
            "code_paths": ["scripts/**", ".github/**"],
        }
        assert get.await_count == 1, "the read-back must be its own GET"
        body = resp.json()
        assert body["written_scope"] == "code_only"
        assert body["stored_code_paths"] == ["scripts/**", ".github/**"]
        assert body["updated_by"] == "operator@example.com"
        assert body["effective"]["scope"] == "code_only"
        assert body["effective"]["mode"] == "shadow"
        assert body["readback_error"] is None

    def test_omitted_code_paths_stays_omitted_on_the_wire(self, client: TestClient):
        """Coord reads an absent `code_paths` as KEEP; null would be a different
        request on a stricter deserializer, so it is never sent."""
        put = self._put_ok()
        get = AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DEFAULT))
        with _coord(get=get, put=put):
            resp = client.put(
                f"{API_PREFIX}/post-merge-followup-scope",
                json={"repo": REPO, "scope": "all"},
            )
        assert resp.status_code == 200
        assert put.call_args.kwargs["json"] == {"repo": REPO, "scope": "all"}

    def test_empty_code_paths_is_sent_as_a_clear(self, client: TestClient):
        put = self._put_ok()
        get = AsyncMock(return_value=_mock_response(200, COORD_SCOPE_DEFAULT))
        with _coord(get=get, put=put):
            client.put(
                f"{API_PREFIX}/post-merge-followup-scope",
                json={"repo": REPO, "scope": "none", "code_paths": []},
            )
        assert put.call_args.kwargs["json"] == {
            "repo": REPO,
            "scope": "none",
            "code_paths": [],
        }

    @pytest.mark.parametrize(
        "body",
        [
            {"repo": REPO, "scope": "code_only"},
            {"repo": REPO, "scope": "code_only", "code_paths": []},
            {"repo": REPO, "scope": "code_only", "code_paths": ["scripts/**", "  "]},
            {"repo": REPO, "scope": "everything"},
            {"repo": "no-owner", "scope": "all"},
            {"repo": REPO, "scope": "all", "updated_by": "spoof@example.com"},
        ],
    )
    def test_invalid_bodies_are_refused_locally(self, client: TestClient, body):
        put = self._put_ok()
        with _coord(put=put, get=AsyncMock()):
            resp = client.put(f"{API_PREFIX}/post-merge-followup-scope", json=body)
        assert resp.status_code == 422
        put.assert_not_awaited()

    def test_coord_400_passes_through(self, client: TestClient):
        """Coord is the authority on glob compilation; its message reaches the UI."""
        refusal = {"error": 'code_paths[0] "[" is not a valid glob: unclosed'}
        put = AsyncMock(return_value=_mock_response(400, refusal))
        with _coord(put=put, get=AsyncMock()):
            resp = client.put(
                f"{API_PREFIX}/post-merge-followup-scope",
                json={"repo": REPO, "scope": "code_only", "code_paths": ["["]},
            )
        assert resp.status_code == 400
        assert "not a valid glob" in resp.text

    def test_column_not_present_503_passes_through(self, client: TestClient):
        put = AsyncMock(
            return_value=_mock_response(503, {"error": "column_not_present"})
        )
        with _coord(put=put, get=AsyncMock()):
            resp = client.put(
                f"{API_PREFIX}/post-merge-followup-scope",
                json={"repo": REPO, "scope": "none"},
            )
        assert resp.status_code == 503
        assert "column_not_present" in resp.text

    def test_a_failed_read_back_is_unknown_not_the_written_scope(
        self, client: TestClient
    ):
        put = self._put_ok()
        get = AsyncMock(
            return_value=_mock_response(503, {"error": "preference_unreadable"})
        )
        with _coord(get=get, put=put):
            resp = client.put(
                f"{API_PREFIX}/post-merge-followup-scope",
                json={"repo": REPO, "scope": "none"},
            )
        assert resp.status_code == 200, "the WRITE succeeded — don't lose that"
        body = resp.json()
        assert body["effective"] is None
        assert "503" in body["readback_error"]
        assert body["written_scope"] == "none"


# ---------------------------------------------------------------------------
# Continuation-delivery mode
# ---------------------------------------------------------------------------


COORD_DELIVERY = {
    "domain": "continuation_delivery",
    "repo": REPO,
    "effective_level": "notify_only",
    "resolved_scope": "repo",
}


class TestContinuationDeliveryMode:
    def test_get_reports_mode_with_unknown_provenance(self, client: TestClient):
        with (
            _coord(
                get=AsyncMock(return_value=_mock_response(200, COORD_DELIVERY))
            ) as c,
            _patch_identity(),
        ):
            resp = client.get(
                f"{API_PREFIX}/continuation-delivery-mode", params={"repo": REPO}
            )
        assert resp.status_code == 200
        assert resp.json() == {
            "repo": REPO,
            "mode": "notify_only",
            # Coord's read is fail-open and its resolved_scope a constant, so
            # the proxy never claims the value is a stored setting.
            "provenance_known": False,
            "can_edit": True,
        }
        assert c.get.call_args.args[0].endswith("/coord/continuation-delivery-mode")

    def test_get_unrecognised_mode_is_502(self, client: TestClient):
        with (
            _coord(
                get=AsyncMock(
                    return_value=_mock_response(200, {"effective_level": "bogus"})
                )
            ),
            _patch_identity(),
        ):
            resp = client.get(
                f"{API_PREFIX}/continuation-delivery-mode", params={"repo": REPO}
            )
        assert resp.status_code == 502

    def test_put_sends_closed_body_and_reads_back(self, client: TestClient):
        put = AsyncMock(
            return_value=_mock_response(
                200, dict(COORD_DELIVERY, ok=True, effective_level="spawn_always")
            )
        )
        get = AsyncMock(
            return_value=_mock_response(
                200, dict(COORD_DELIVERY, effective_level="spawn_always")
            )
        )
        with _coord(get=get, put=put):
            resp = client.put(
                f"{API_PREFIX}/continuation-delivery-mode",
                json={"repo": REPO, "mode": "spawn_always"},
            )
        assert resp.status_code == 200
        assert put.call_args.kwargs["json"] == {"repo": REPO, "mode": "spawn_always"}
        body = resp.json()
        assert body["written_mode"] == "spawn_always"
        assert body["effective"]["mode"] == "spawn_always"
        assert body["readback_error"] is None

    def test_put_unknown_mode_is_refused_locally(self, client: TestClient):
        put = AsyncMock()
        with _coord(put=put, get=AsyncMock()):
            resp = client.put(
                f"{API_PREFIX}/continuation-delivery-mode",
                json={"repo": REPO, "mode": "always"},
            )
        assert resp.status_code == 422
        put.assert_not_awaited()

    def test_put_failed_read_back_is_unknown(self, client: TestClient):
        put = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        get = AsyncMock(side_effect=httpx.ConnectError("refused"))
        with _coord(get=get, put=put):
            resp = client.put(
                f"{API_PREFIX}/continuation-delivery-mode",
                json={"repo": REPO, "mode": "notify_only"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["effective"] is None
        assert "502" in body["readback_error"]


def test_routes_are_mounted_under_operations_in_the_real_app():
    """The router is the contract: the frontend's paths must exist on the app."""
    from app.main import app

    paths = {getattr(r, "path", None) for r in app.routes}
    assert f"{API_PREFIX}/post-merge-followup-scope" in paths
    assert f"{API_PREFIX}/continuation-delivery-mode" in paths
