"""Deactivating a web user must revoke their coord access, loudly.

Plan: ``2026-07-24-web-deactivation-must-revoke-coord-membership``, Phase 3.

Since web#845, ``operations.get_tenant_id`` no longer takes ``current_user``,
so the 118 coord-proxy routes hanging off it never read web's local
``is_active`` flag — coord tenant membership is the sole authority. A
web-only deactivation therefore revoked NOTHING. These tests pin the fix on
BOTH deactivation writers:

* ``PUT /api/v1/users/{user_id}``          (``users.py::update_user_by_id``,
  which persists via ``crud.user.update_user_privileged``)
* ``PATCH /api/v1/auth/users/{id}``        (the mounted fastapi-users users
  router → ``UserManager.update(..., safe=False)``) — exercised BOTH through
  the real mounted router and directly against the manager.

Mocking follows the established proxy-suite idiom: patch
``app.api.v1.endpoints.operations.httpx.AsyncClient``. That patch target is
load-bearing — the proxy implementations deliberately live in ``operations``
so ``httpx`` resolves in THAT module's namespace (see the docstring in
``app/api/coord_proxy.py``).
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TARGET_SUB = "cognito-sub-target"
TARGET_EMAIL = "target@example.com"
TARGET_OPERATOR_ID = "6b1a0a3e-1111-4222-8333-444455556666"


# --------------------------------------------------------------------------
# Shared fixtures / helpers
# --------------------------------------------------------------------------


def _make_user(*, is_active: bool = True, cognito_sub: str | None = TARGET_SUB):
    """A stand-in for the target ``User`` row (no DB needed)."""
    now = datetime(2026, 7, 24, 12, 0, 0, tzinfo=UTC)
    return SimpleNamespace(
        id=uuid4(),
        email=TARGET_EMAIL,
        username="target",
        is_active=is_active,
        is_superuser=False,
        is_verified=True,
        cognito_sub=cognito_sub,
        # Required by the ``UserRead`` response model on both write routes.
        subscription_tier="free",
        created_at=now,
        updated_at=now,
    )


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.content = b"x" if json_data is not None else b""
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _operator_list(**overrides):
    """Coord's ``GET /admin/coord/operators`` payload for the target user."""
    entry = {
        "operator_id": TARGET_OPERATOR_ID,
        "email": TARGET_EMAIL,
        "display_name": "Target",
        "sso_provider": "cognito",
        "sso_subject": TARGET_SUB,
        "roles": ["operator"],
    }
    entry.update(overrides)
    return {"operators": [entry]}


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _coord_client(
    *,
    list_payload=None,
    list_error: Exception | None = None,
    post_response=None,
    post_error: Exception | None = None,
) -> AsyncMock:
    """A stubbed ``httpx.AsyncClient`` for the lookup GET + the write POST."""
    instance = AsyncMock()
    if list_error is not None:
        instance.get.side_effect = list_error
    else:
        payload = _operator_list() if list_payload is None else list_payload
        instance.get.return_value = _mock_response(json_data=payload)
    if post_error is not None:
        instance.post.side_effect = post_error
    else:
        instance.post.return_value = post_response or _mock_response(
            json_data={"ok": True}
        )
    return instance


def _admin():
    return SimpleNamespace(
        id=uuid4(),
        email="admin@example.com",
        is_active=True,
        is_superuser=True,
        is_verified=True,
    )


# --------------------------------------------------------------------------
# Writer 1 — PUT /api/v1/users/{user_id}
# --------------------------------------------------------------------------


def _build_users_app(target, admin):
    """Minimal app exposing ``users.py``'s superuser update route."""
    from app.api.deps import (
        current_active_user,
        get_async_db,
        get_current_active_user_async,
        get_current_superuser_async,
    )
    from app.api.v1.endpoints.users import router as users_router

    db = MagicMock()
    db.commit = AsyncMock()

    app = FastAPI()
    app.dependency_overrides[get_current_superuser_async] = lambda: admin
    app.dependency_overrides[get_current_active_user_async] = lambda: admin
    app.dependency_overrides[current_active_user] = lambda: admin
    app.dependency_overrides[get_async_db] = lambda: db
    app.include_router(users_router, prefix="/api/v1/users")
    app.state.target = target
    return app


@pytest.fixture()
def users_ctx():
    """TestClient for writer 1 with the DB/audit side effects stubbed out."""
    target = _make_user()

    async def _fake_get_user(db, user_id):
        return target

    applied: dict = {}

    async def _fake_update_user_privileged(db, user, user_update):
        # Mirror the real helper's field policy (``create_update_dict_superuser``
        # — excludes ``id``, and ``UserUpdate`` also drops ``password``), so this
        # double is never MORE permissive than what it stands in for.
        applied["update"] = user_update.create_update_dict_superuser()
        for field, value in applied["update"].items():
            setattr(user, field, value)
        return user

    audit = MagicMock()
    audit.log_account_modification = AsyncMock()
    audit.log_pii_access = AsyncMock()

    with (
        patch("app.api.v1.endpoints.users.get_user", _fake_get_user),
        patch(
            "app.api.v1.endpoints.users.update_user_privileged",
            _fake_update_user_privileged,
        ),
        patch("app.api.v1.endpoints.users.audit_logger", audit),
    ):
        client = TestClient(_build_users_app(target, _admin()))
        yield SimpleNamespace(client=client, target=target, applied=applied)


def _put(client, body):
    return client.put(
        f"/api/v1/users/{uuid4()}",
        json=body,
        headers={"Authorization": "Bearer caller-token"},
    )


class TestUsersPutWriter:
    def test_deactivation_calls_coord_disable_with_operator_id(self, users_ctx):
        instance = _coord_client()
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 200, resp.text
        # Resolution read went to coord's operator directory...
        assert instance.get.call_args.args[0].endswith("/admin/coord/operators")
        # ...and the write used coord's operator_id UUID, not the email/sub.
        assert instance.post.call_args.args[0].endswith(
            f"/coord/operators/{TARGET_OPERATOR_ID}/disable"
        )
        body = instance.post.call_args.kwargs.get("json")
        assert "reason" in body and "admin@example.com" in body["reason"]
        # The caller's bearer is forwarded so coord authorizes on the acting
        # superuser's identity.
        headers = instance.post.call_args.kwargs.get("headers") or {}
        assert headers.get("Authorization") == "Bearer caller-token"
        # And the local flip did happen, after the coord call.
        assert users_ctx.applied["update"] == {"is_active": False}

    def test_operator_lookup_sends_the_sso_subject_filter(self, users_ctx):
        """The directory read is narrowed server-side by the Cognito subject.

        coord's ``GET /admin/coord/operators`` accepts an exact-match
        ``?sso_subject=`` filter (coord PR #1293), ANDed with its tenant scope.
        Sending it means this resolution does not depend on coord serving the
        list unpaginated. Pinned as a test because the coupling is invisible
        until a tenant grows large enough for a default page size to truncate
        the match — at which point deactivation would start failing.
        """
        instance = _coord_client()
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 200, resp.text
        params = instance.get.call_args.kwargs.get("params") or {}
        assert params.get("sso_subject") == TARGET_SUB

    def test_wrong_subject_in_filtered_response_is_still_rejected(self, users_ctx):
        """The server-side filter is an optimization, NOT a trust boundary.

        If coord ignored, mis-parsed, or widened the filter and returned some
        other principal, we must refuse rather than disable whoever came back.
        """
        instance = _coord_client(
            list_payload=_operator_list(sso_subject="a-different-principal")
        )
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        assert resp.json()["detail"]["error"] == "coord_operator_not_found"
        # Nothing was disabled and nothing was persisted locally.
        instance.post.assert_not_called()
        assert "update" not in users_ctx.applied

    def test_reactivation_calls_coord_enable(self, users_ctx):
        users_ctx.target.is_active = False
        instance = _coord_client()
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": True})

        assert resp.status_code == 200, resp.text
        assert instance.post.call_args.args[0].endswith(
            f"/coord/operators/{TARGET_OPERATOR_ID}/enable"
        )
        # Enable carries no body — coord's handler takes no request body.
        assert instance.post.call_args.kwargs.get("json") is None
        assert users_ctx.applied["update"] == {"is_active": True}

    def test_unchanged_is_active_makes_no_coord_call(self, users_ctx):
        instance = _coord_client()
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": True, "full_name": "New Name"})

        assert resp.status_code == 200, resp.text
        instance.get.assert_not_called()
        instance.post.assert_not_called()

    def test_update_without_is_active_makes_no_coord_call(self, users_ctx):
        instance = _coord_client()
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"full_name": "New Name"})

        assert resp.status_code == 200, resp.text
        instance.get.assert_not_called()
        instance.post.assert_not_called()
        assert users_ctx.applied["update"] == {"full_name": "New Name"}

    def test_coord_403_passes_through_and_fails_the_deactivation(self, users_ctx):
        """A 403 is an actionable answer about the CALLER — surfaced verbatim."""
        instance = _coord_client(
            post_response=_mock_response(
                status_code=403, text='{"error":"admin_required"}'
            )
        )
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 403
        detail = resp.json()["detail"]
        assert detail["error"] == "coord_operator_disable_failed"
        assert detail["coord_status"] == 403
        # The local flip must NOT have happened.
        assert "update" not in users_ctx.applied
        assert users_ctx.target.is_active is True

    @pytest.mark.parametrize("coord_status", [404, 500, 503], ids=["404", "500", "503"])
    def test_other_coord_failures_become_502(self, users_ctx, coord_status):
        """Coord's 404/5xx must not masquerade as this route's own status —
        they become a 502 that still carries coord's code."""
        instance = _coord_client(
            post_response=_mock_response(
                status_code=coord_status, text='{"error":"column_not_present"}'
            )
        )
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        detail = resp.json()["detail"]
        assert detail["error"] == "coord_operator_disable_failed"
        assert detail["coord_status"] == coord_status
        assert "update" not in users_ctx.applied

    def test_coord_timeout_fails_the_deactivation(self, users_ctx):
        instance = _coord_client(post_error=httpx.ReadTimeout("slow"))
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        assert resp.json()["detail"]["coord_status"] == 504
        assert "update" not in users_ctx.applied

    def test_coord_unreachable_fails_the_deactivation(self, users_ctx):
        instance = _coord_client(list_error=httpx.ConnectError("refused"))
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        assert resp.json()["detail"]["error"] == "coord_operator_lookup_failed"
        instance.post.assert_not_called()
        assert "update" not in users_ctx.applied

    def test_unmappable_user_fails_the_deactivation(self, users_ctx):
        """No coord operator for this user → loud failure, never a silent skip."""
        instance = _coord_client(list_payload={"operators": []})
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        assert resp.json()["detail"]["error"] == "coord_operator_not_found"
        instance.post.assert_not_called()
        assert "update" not in users_ctx.applied

    def test_email_match_alone_is_never_enough(self, users_ctx):
        """The match key is the Cognito subject ONLY.

        ``email`` is user-settable (fastapi-users' ``create_update_dict()``
        does not exclude it) and is not unique in ``coord.operators``, so an
        email-keyed match would let a user steer a privileged cross-principal
        disable at a victim by renaming themselves. An entry that matches only
        on email must therefore NOT be disabled.
        """
        payload = _operator_list(sso_subject="somebody-elses-sub")
        instance = _coord_client(list_payload=payload)
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        assert resp.json()["detail"]["error"] == "coord_operator_not_found"
        instance.post.assert_not_called()

    def test_operator_without_sso_subject_is_never_matched(self, users_ctx):
        """Pre-`sso_subject` coord builds fail loudly rather than guessing."""
        payload = _operator_list()
        payload["operators"][0].pop("sso_subject")
        instance = _coord_client(list_payload=payload)
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        assert resp.json()["detail"]["error"] == "coord_operator_not_found"
        instance.post.assert_not_called()

    def test_subject_match_wins_when_another_operator_shares_the_email(self, users_ctx):
        payload = {
            "operators": [
                {"operator_id": str(uuid4()), "email": TARGET_EMAIL},
                {
                    "operator_id": TARGET_OPERATOR_ID,
                    "email": "renamed@example.com",
                    "sso_subject": TARGET_SUB,
                },
            ]
        }
        instance = _coord_client(list_payload=payload)
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 200, resp.text
        assert instance.post.call_args.args[0].endswith(
            f"/coord/operators/{TARGET_OPERATOR_ID}/disable"
        )

    def test_ambiguous_subject_match_fails_the_deactivation(self, users_ctx):
        payload = _operator_list()
        payload["operators"].append(
            {
                "operator_id": str(uuid4()),
                "email": "other@example.com",
                "sso_provider": "github",
                "sso_subject": TARGET_SUB,
            }
        )
        instance = _coord_client(list_payload=payload)
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 409
        assert resp.json()["detail"]["error"] == "coord_operator_ambiguous"
        instance.post.assert_not_called()

    def test_user_without_cognito_sub_fails_the_deactivation(self, users_ctx):
        users_ctx.target.cognito_sub = None
        instance = _coord_client()
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = _put(users_ctx.client, {"is_active": False})

        assert resp.status_code == 502
        assert resp.json()["detail"]["error"] == "coord_operator_subject_missing"
        instance.post.assert_not_called()
        assert "update" not in users_ctx.applied

    def test_missing_caller_bearer_fails_the_deactivation(self, users_ctx):
        instance = _coord_client()
        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = users_ctx.client.put(
                f"/api/v1/users/{uuid4()}", json={"is_active": False}
            )

        assert resp.status_code == 401
        assert resp.json()["detail"]["error"] == "coord_bearer_missing"
        instance.get.assert_not_called()
        assert "update" not in users_ctx.applied


# --------------------------------------------------------------------------
# Writer 2 — the mounted fastapi-users users router
# --------------------------------------------------------------------------


def _manager_and_db(target=None):
    from app.auth.config import UserManager

    user_db = MagicMock()
    user_db.get = AsyncMock(return_value=target)
    user_db.update = AsyncMock(side_effect=lambda user, data: user)
    manager = UserManager(user_db)
    manager.on_after_update = AsyncMock()
    return manager, user_db


def _build_fastapi_users_app(manager, admin):
    """Mount the REAL fastapi-users users router.

    This is what pins that ``PATCH /{id}`` reaches ``UserManager.update`` with
    ``safe=False`` AND a live ``Request`` — a fastapi-users bump that changed
    either would silently drop the deactivation guard, so it must not be
    assumed from reading the library.
    """
    from app.auth.config import (
        auth_backend,
        fastapi_users,
        get_jwt_strategy,
        get_user_manager,
    )
    from app.schemas.user import UserRead, UserUpdate

    class _StubStrategy:
        async def read_token(self, token, user_manager):
            return admin

        async def write_token(self, user):  # pragma: no cover - unused
            return "stub"

        async def destroy_token(self, token, user):  # pragma: no cover - unused
            return None

    app = FastAPI()
    app.dependency_overrides[get_user_manager] = lambda: manager
    app.dependency_overrides[get_jwt_strategy] = lambda: _StubStrategy()
    app.dependency_overrides[auth_backend.get_strategy] = lambda: _StubStrategy()
    app.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate),
        prefix="/api/v1/auth/users",
    )
    return app


class TestFastAPIUsersRouter:
    """End-to-end through the mounted ``PATCH /api/v1/auth/users/{id}``."""

    def test_superuser_patch_deactivation_calls_coord_disable(self):
        target = _make_user()
        manager, user_db = _manager_and_db(target)
        client = TestClient(_build_fastapi_users_app(manager, _admin()))
        instance = _coord_client()

        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = client.patch(
                f"/api/v1/auth/users/{target.id}",
                json={"is_active": False},
                headers={"Authorization": "Bearer caller-token"},
            )

        assert resp.status_code == 200, resp.text
        assert instance.post.call_args.args[0].endswith(
            f"/coord/operators/{TARGET_OPERATOR_ID}/disable"
        )
        user_db.update.assert_awaited_once()

    def test_coord_403_aborts_the_patch(self):
        target = _make_user()
        manager, user_db = _manager_and_db(target)
        client = TestClient(_build_fastapi_users_app(manager, _admin()))
        instance = _coord_client(
            post_response=_mock_response(
                status_code=403, text='{"error":"admin_required"}'
            )
        )

        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = client.patch(
                f"/api/v1/auth/users/{target.id}",
                json={"is_active": False},
                headers={"Authorization": "Bearer caller-token"},
            )

        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "coord_operator_disable_failed"
        user_db.update.assert_not_awaited()

    def test_self_service_patch_me_never_calls_coord(self):
        """``PATCH /me`` runs ``safe=True``; fastapi-users'
        ``create_update_dict()`` drops ``is_active`` entirely."""
        admin = _admin()
        manager, user_db = _manager_and_db(admin)
        client = TestClient(_build_fastapi_users_app(manager, admin))
        instance = _coord_client()
        admin.subscription_tier = "free"
        admin.username = "admin"
        admin.created_at = datetime(2026, 7, 24, tzinfo=UTC)
        admin.updated_at = admin.created_at

        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            resp = client.patch(
                "/api/v1/auth/users/me",
                json={"is_active": False},
                headers={"Authorization": "Bearer caller-token"},
            )

        assert resp.status_code == 200, resp.text
        instance.get.assert_not_called()
        instance.post.assert_not_called()


def _request_with_bearer(token: str | None = "caller-token"):
    """A Starlette ``Request`` carrying only what the sync path reads."""
    from starlette.requests import Request

    headers = []
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    return Request({"type": "http", "headers": headers, "method": "PATCH", "path": "/"})


@pytest.mark.asyncio
class TestUserManagerUpdate:
    """Direct unit coverage of the manager override's remaining arms."""

    async def test_reactivation_calls_coord_enable(self):
        from app.schemas.user import UserUpdate

        manager, user_db = _manager_and_db()
        target = _make_user(is_active=False)
        instance = _coord_client()

        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            await manager.update(
                UserUpdate(is_active=True),
                target,
                safe=False,
                request=_request_with_bearer(),
            )

        assert instance.post.call_args.args[0].endswith(
            f"/coord/operators/{TARGET_OPERATOR_ID}/enable"
        )
        # Reactivation persists FIRST so web is never more permissive than
        # coord if the coord call then fails.
        user_db.update.assert_awaited_once()

    async def test_reactivation_persists_before_coord(self):
        """A failing coord enable still leaves the user coord-DISABLED."""
        from fastapi import HTTPException

        from app.schemas.user import UserUpdate

        manager, user_db = _manager_and_db()
        target = _make_user(is_active=False)
        instance = _coord_client(
            post_response=_mock_response(status_code=500, text="boom")
        )

        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            with pytest.raises(HTTPException) as excinfo:
                await manager.update(
                    UserUpdate(is_active=True),
                    target,
                    safe=False,
                    request=_request_with_bearer(),
                )

        assert excinfo.value.status_code == 502
        assert excinfo.value.detail["error"] == "coord_operator_enable_failed"
        user_db.update.assert_awaited_once()

    async def test_patch_without_is_active_makes_no_coord_call(self):
        from app.schemas.user import UserUpdate

        manager, user_db = _manager_and_db()
        target = _make_user()
        instance = _coord_client()

        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            await manager.update(
                UserUpdate(full_name="New Name"),
                target,
                safe=False,
                request=_request_with_bearer(),
            )

        instance.get.assert_not_called()
        instance.post.assert_not_called()
        user_db.update.assert_awaited_once()

    async def test_unchanged_is_active_makes_no_coord_call(self):
        from app.schemas.user import UserUpdate

        manager, user_db = _manager_and_db()
        target = _make_user(is_active=True)
        instance = _coord_client()

        with _patch_httpx() as MockClient:
            _configure_mock_client(MockClient, instance)
            await manager.update(
                UserUpdate(is_active=True),
                target,
                safe=False,
                request=_request_with_bearer(),
            )

        instance.get.assert_not_called()
        instance.post.assert_not_called()
        user_db.update.assert_awaited_once()

    async def test_no_request_fails_loudly(self):
        """A programmatic ``is_active`` flip has no bearer → loud failure,
        never a silent web-only deactivation."""
        from fastapi import HTTPException

        from app.schemas.user import UserUpdate

        manager, user_db = _manager_and_db()
        target = _make_user()

        with pytest.raises(HTTPException) as excinfo:
            await manager.update(
                UserUpdate(is_active=False), target, safe=False, request=None
            )

        assert excinfo.value.status_code == 401
        assert excinfo.value.detail["error"] == "coord_bearer_missing"
        user_db.update.assert_not_awaited()
