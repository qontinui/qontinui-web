"""The work-unit schedule-metadata proxy — the person's door for phases and links.

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` Phase 5.
``PATCH /api/v1/operations/plans/{slug}/schedule-metadata`` proxies coord
``POST /coord/work-units/{slug}/operator-schedule-metadata``.

Why this proxy exists at all: the Project Overview is DERIVED ONLY from coord
(plan D5), so every datum it shows must be enterable by a person on the coord
page that already holds sibling data. A unit's declared phases, its
phase-to-unit links and its milestone link per phase had no person-facing
write door; this is it.

What is pinned here (each could fail on its own):

1. **The wire body is assembled here.** ``by_actor`` is the AUTHENTICATED
   operator (``operator:<email>``), never a value the browser supplies, and an
   unknown top-level key of the browser's body is not forwarded.
2. **Coord owns the closed key set, and its typed 422 survives the hop.** A
   foreign key is refused by coord naming the key; the proxy forwards that
   object verbatim rather than flattening it into a string.
3. **A non-object ``metadata_patch`` is refused before any coord call.**
4. **Another tenant's refusal (404) and a stale ``from_updated_at`` (409)
   arrive with their own status**, so the page can say which it was.

Same minimal-app + mocked-``httpx`` shape as ``test_operations_fleet_drain_proxy``.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
SLUG = "2026-11-25-some-programme"
ROUTE = f"{API_PREFIX}/plans/{SLUG}/schedule-metadata"
COORD_PATH = f"/coord/work-units/{SLUG}/operator-schedule-metadata"
TEST_BEARER = "test-cognito-access-token"


def _build_test_app(*, actor_email: str | None = "ops@example.com") -> FastAPI:
    from app.api.deps import (
        get_audit_actor_user_optional,
        get_current_active_user_async,
    )
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = actor_email
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_audit_actor_user_optional] = (
        lambda: mock_user if actor_email else None
    )

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: see the fleet-drain proxy test.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
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


PATCH_BODY = {
    "metadata_patch": {
        "phases": [{"index": 1, "name": "F1", "milestone": "V1"}],
        "phase_units": {"1": ["child-unit"]},
    }
}


class TestScheduleMetadataProxy:
    def test_forwards_to_the_operator_door_with_the_authenticated_actor(
        self, auth_client: TestClient
    ):
        ok = {"ok": True, "slug": SLUG, "keys": ["phase_units", "phases"]}
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(return_value=_mock_response(200, ok))
            _configure_mock_client(MockClient, inst)
            resp = auth_client.patch(
                ROUTE,
                json={**PATCH_BODY, "by_actor": "someone-else", "extra": 1},
            )
        assert resp.status_code == 200
        assert resp.json() == ok
        url = inst.post.call_args.args[0]
        assert url.endswith(COORD_PATH)
        sent = inst.post.call_args.kwargs["json"]
        assert sent["metadata_patch"] == PATCH_BODY["metadata_patch"]
        assert sent["by_actor"] == "operator:ops@example.com", (
            "the actor is the authenticated operator, never the browser's claim"
        )
        assert set(sent) == {"metadata_patch", "by_actor"}, "nothing else is forwarded"

    def test_falls_back_to_the_generic_actor_when_no_user_resolves(self):
        client = TestClient(_build_test_app(actor_email=None))
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(return_value=_mock_response(200, {"ok": True}))
            _configure_mock_client(MockClient, inst)
            resp = client.patch(ROUTE, json=PATCH_BODY)
        assert resp.status_code == 200
        assert inst.post.call_args.kwargs["json"]["by_actor"] == "operator:web-admin"

    def test_passes_the_optimistic_lock_through(self, auth_client: TestClient):
        stamp = "2026-11-25T10:00:00Z"
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(return_value=_mock_response(200, {"ok": True}))
            _configure_mock_client(MockClient, inst)
            auth_client.patch(ROUTE, json={**PATCH_BODY, "from_updated_at": stamp})
        assert inst.post.call_args.kwargs["json"]["from_updated_at"] == stamp

    def test_a_foreign_key_is_coords_typed_422_and_survives_the_hop(
        self, auth_client: TestClient
    ):
        refusal = {
            "error": "metadata_key_not_allowed",
            "key": "status",
            "message": "`status` is not a schedule key",
            "allowed_keys": ["phases"],
        }
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(return_value=_mock_response(422, refusal, text="raw"))
            _configure_mock_client(MockClient, inst)
            resp = auth_client.patch(
                ROUTE, json={"metadata_patch": {"status": "shipped"}}
            )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["error"] == "metadata_key_not_allowed"
        assert detail["key"] == "status", "the refusal names the key"

    @pytest.mark.parametrize("status", [404, 409])
    def test_tenant_and_lock_refusals_keep_their_own_status(
        self, auth_client: TestClient, status: int
    ):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(
                return_value=_mock_response(status, {"error": "refused"})
            )
            _configure_mock_client(MockClient, inst)
            resp = auth_client.patch(ROUTE, json=PATCH_BODY)
        assert resp.status_code == status

    @pytest.mark.parametrize("bad", [None, [], "phases", 3])
    def test_a_non_object_patch_is_refused_before_any_coord_call(
        self, auth_client: TestClient, bad
    ):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock()
            _configure_mock_client(MockClient, inst)
            resp = auth_client.patch(ROUTE, json={"metadata_patch": bad})
        assert resp.status_code == 422
        inst.post.assert_not_called()

    def test_an_unreachable_coord_is_a_502_never_a_success(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(side_effect=httpx.ConnectError("down"))
            _configure_mock_client(MockClient, inst)
            resp = auth_client.patch(ROUTE, json=PATCH_BODY)
        assert resp.status_code == 502


class TestSlugConstraint:
    """The slug is interpolated into the coord path, so what it may contain is
    pinned directly: the HTTP client normalizes ``..`` before a request can
    carry it, so a route-level request could not exercise this."""

    @pytest.mark.parametrize("slug", ["2026-11-25-a-plan", "a.b_c-1", "shepherd-42"])
    def test_a_real_slug_is_accepted(self, slug: str):
        import re

        from app.api.v1.endpoints.operations import PlanSlug

        assert re.fullmatch(_pattern_of(PlanSlug), slug)

    @pytest.mark.parametrize("slug", [".", "..", "...", "a?b", "a#b", "a/b", "a b", ""])
    def test_a_path_rewriting_slug_is_refused(self, slug: str):
        import re

        from app.api.v1.endpoints.operations import PlanSlug

        assert not re.fullmatch(_pattern_of(PlanSlug), slug)


def _pattern_of(annotated) -> str:
    meta = annotated.__metadata__[0]
    pattern = getattr(meta, "pattern", None)
    if pattern is None:
        for m in getattr(meta, "metadata", []):
            pattern = getattr(m, "pattern", pattern)
    assert pattern, "PlanSlug carries no pattern"
    return pattern
