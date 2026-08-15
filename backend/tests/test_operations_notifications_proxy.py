"""Tests for the ``/api/v1/operations/notifications*`` coord proxy.

Change 4 of ``plans/2026-08-05-coord-notifications-type-and-tab.md``.

Two routes with deliberately OPPOSITE postures, and both are pinned here:

* ``GET /notifications`` forwards its paging/filter params **verbatim** and
  validates nothing. Coord owns the default and the clamp; a proxy that
  swallowed ``limit`` would re-create, one layer up, the ignored-paging defect
  the plan exists to fix.
* ``POST /notifications/mark-read`` is the opposite, because it is the only
  destructive and un-undoable operation on this surface. Coord review
  2026-08-15 found that its previous ``Option<Json<..>>`` signature mapped
  EVERY deserialization failure to ``None``, which the SQL read as "mark the
  entire tenant read" — so a wrong ``Content-Type``, a non-UUID id, or the
  natural TypeScript spelling ``{"notificationIds": [...]}`` silently
  destroyed 90 days of read state. The two operations are now disjoint and
  explicit, and this hop rejects the same shapes coord does rather than
  forwarding them.

Coord is mocked throughout — no live coord, no DB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

PROXY_GET = "app.api.v1.endpoints.operations._proxy_coord_get"
PROXY_POST = "app.api.v1.endpoints.operations._proxy_coord_post"

TENANT = UUID("11111111-2222-3333-4444-555555555555")


def _member_user() -> MagicMock:
    """An ordinary authenticated tenant member — read state is per-principal,
    so this surface is deliberately NOT operator-gated."""
    u = MagicMock()
    u.id = uuid4()
    u.email = "dev@example.com"
    u.is_active = True
    u.is_verified = True
    u.is_superuser = False
    return u


def _build_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id, router

    test_app = FastAPI()
    test_app.dependency_overrides[get_current_active_user_async] = _member_user
    test_app.dependency_overrides[get_tenant_id] = lambda: TENANT
    test_app.include_router(router, prefix="/api/v1/operations")
    return test_app


class TestListProxy:
    def test_forwards_every_paging_param_verbatim(self):
        app = _build_app()
        with patch(PROXY_GET, new=AsyncMock(return_value={})) as mock_get:
            TestClient(app).get(
                "/api/v1/operations/notifications"
                "?limit=1&cursor=opaque&kind=policy_change&unread_only=true"
            )
        path, kwargs = mock_get.call_args[0], mock_get.call_args[1]
        assert path[0] == "/coord/notifications"
        assert kwargs["params"] == {
            "limit": 1,
            "cursor": "opaque",
            "kind": "policy_change",
            "unread_only": True,
        }
        assert kwargs["tenant_id"] == TENANT

    def test_limit_is_not_clamped_here(self):
        # Bounds live in coord — one clamp, one place. A second clamp here
        # would be invisible to the operator and impossible to reason about.
        app = _build_app()
        with patch(PROXY_GET, new=AsyncMock(return_value={})) as mock_get:
            TestClient(app).get("/api/v1/operations/notifications?limit=100000")
        assert mock_get.call_args[1]["params"]["limit"] == 100000

    def test_sends_no_params_when_the_caller_set_none(self):
        app = _build_app()
        with patch(PROXY_GET, new=AsyncMock(return_value={})) as mock_get:
            TestClient(app).get("/api/v1/operations/notifications")
        assert mock_get.call_args[1]["params"] is None

    def test_passes_the_envelope_through_untouched(self):
        envelope = {
            "notifications": [{"notification_id": str(uuid4())}],
            "next_cursor": "c1",
            "total": 900,
            "unread_count": 137,
        }
        app = _build_app()
        with patch(PROXY_GET, new=AsyncMock(return_value=envelope)):
            resp = TestClient(app).get("/api/v1/operations/notifications")
        assert resp.status_code == 200
        # `total` / `unread_count` are the scalars every consumer must read
        # instead of counting the page; they must survive the hop.
        assert resp.json() == envelope


class TestMarkReadProxy:
    def test_marks_specific_rows(self):
        nid = uuid4()
        app = _build_app()
        with patch(
            PROXY_POST, new=AsyncMock(return_value={"marked": 1, "unread_count": 0})
        ) as mock_post:
            resp = TestClient(app).post(
                "/api/v1/operations/notifications/mark-read",
                json={"notification_ids": [str(nid)]},
            )
        assert resp.status_code == 200
        args = mock_post.call_args[0]
        assert args[0] == "/coord/notifications/mark-read"
        # UUIDs render back to strings (httpx cannot serialize UUID objects),
        # and the unused arm never reaches the wire.
        assert args[1] == {"notification_ids": [str(nid)]}

    def test_empty_id_list_is_a_no_op_not_a_mark_all(self):
        app = _build_app()
        with patch(
            PROXY_POST, new=AsyncMock(return_value={"marked": 0, "unread_count": 5})
        ) as mock_post:
            resp = TestClient(app).post(
                "/api/v1/operations/notifications/mark-read",
                json={"notification_ids": []},
            )
        assert resp.status_code == 200
        assert mock_post.call_args[0][1] == {"notification_ids": []}

    def test_marks_everything_only_on_an_explicit_all_true(self):
        app = _build_app()
        with patch(
            PROXY_POST, new=AsyncMock(return_value={"marked": 9, "unread_count": 0})
        ) as mock_post:
            resp = TestClient(app).post(
                "/api/v1/operations/notifications/mark-read", json={"all": True}
            )
        assert resp.status_code == 200
        assert mock_post.call_args[0][1] == {"all": True}

    def test_rejects_the_shapes_that_used_to_mean_mark_everything(self):
        """The regression net for the coord defect.

        Each of these previously arrived at coord as ``None`` and was read as
        "mark the entire tenant read". None of them may now reach coord at all.
        """
        app = _build_app()
        client = TestClient(app)
        cases = [
            {},  # empty object — no selection
            {"notification_ids": None},  # the old "null means all" spelling
            {"all": False},  # `all` present but not true
            {"notification_ids": [str(uuid4())], "all": True},  # both arms
        ]
        with patch(PROXY_POST, new=AsyncMock()) as mock_post:
            for body in cases:
                resp = client.post(
                    "/api/v1/operations/notifications/mark-read", json=body
                )
                assert resp.status_code == 400, (body, resp.status_code)
            # An absent body is a hard reject too (FastAPI 422), never a
            # mark-all.
            assert (
                client.post("/api/v1/operations/notifications/mark-read").status_code
                == 422
            )
            mock_post.assert_not_called()

    def test_rejects_a_camelcase_field_name(self):
        # The exact spelling a TypeScript caller reaches for. `extra="forbid"`
        # turns it into a loud reject instead of a silently-ignored key that
        # leaves the body looking like the dangerous empty one.
        app = _build_app()
        with patch(PROXY_POST, new=AsyncMock()) as mock_post:
            resp = TestClient(app).post(
                "/api/v1/operations/notifications/mark-read",
                json={"notificationIds": [str(uuid4())]},
            )
        assert resp.status_code == 422
        mock_post.assert_not_called()

    def test_rejects_a_non_uuid_id(self):
        app = _build_app()
        with patch(PROXY_POST, new=AsyncMock()) as mock_post:
            resp = TestClient(app).post(
                "/api/v1/operations/notifications/mark-read",
                json={"notification_ids": ["not-a-uuid"]},
            )
        assert resp.status_code == 422
        mock_post.assert_not_called()

    def test_forwards_the_tenant_for_bearer_forwarding(self):
        # Coord derives `actor_key` solely from the forwarded bearer, so read
        # state can never be steered by a body field.
        app = _build_app()
        with patch(PROXY_POST, new=AsyncMock(return_value={})) as mock_post:
            TestClient(app).post(
                "/api/v1/operations/notifications/mark-read", json={"all": True}
            )
        assert mock_post.call_args[1]["tenant_id"] == TENANT
