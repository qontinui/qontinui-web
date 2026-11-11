"""The ``/operations/subprojects*`` proxies over coord's subproject doors.

Plan ``2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled``
Phase 5. Six routes under ``/api/v1/operations``:

  - ``GET   /subprojects``                → coord ``GET   /coord/subprojects``
  - ``GET   /subprojects/{id}``           → coord ``GET   /coord/subprojects/{id}``
  - ``PATCH /subprojects/{id}``           → coord ``PATCH /coord/subprojects/{id}``
  - ``POST  /subprojects/{id}/merge``     → coord ``POST  …/merge``
  - ``POST  /subprojects/{id}/members``   → coord ``POST  …/members``
  - ``POST  /subprojects/{id}/spawn``     → coord ``POST  …/spawn``

Mirrors ``test_operations_spawn_proxy.py`` — the Phase 5 gate names the spawn
proxy's tests as the template — for what the plan's arming clause asks of these
routes: an operator read returns coord's body unchanged, a non-admin write is
403 BEFORE coord is called, and coord's typed refusals (the spawn's capacity
409s above all) reach the browser as structured data rather than as a string.

Two app builders, because they prove different things. ``_build_test_app``
overrides both tenant dependencies so the proxy itself is under test.
``_build_gated_app`` overrides neither: the real ``require_coord_tenant_admin``
runs against a stubbed coord ``/admin/coord/me``, which is the only way to show
that a member who is NOT an admin is refused, rather than assuming the
dependency is wired.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"
_FIXTURE_TENANT_ID = UUID("11111111-2222-3333-4444-555555555555")
SUBPROJECT_ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
TENANT_HEADER = "X-Qontinui-Tenant-Id"


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _build_test_app(*, resolves_tenant: bool = True) -> FastAPI:
    """The operations router with both tenant dependencies overridden."""
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import (
        router as operations_router,
    )

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "tenant.user@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None

    if resolves_tenant:

        async def _resolver() -> UUID:
            return _FIXTURE_TENANT_ID

    else:

        async def _resolver() -> UUID:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_not_resolved",
            )

    test_app.dependency_overrides[get_tenant_id] = _resolver
    test_app.dependency_overrides[require_coord_tenant_admin] = _resolver
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


def _build_gated_app(user: Any) -> FastAPI:
    """The operations router with the REAL tenant dependencies.

    Only the user record is overridden, because ``require_coord_tenant_admin``
    reads ``is_superuser`` off it; the admin check itself runs against the
    stubbed coord ``/admin/coord/me``.
    """
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    test_app.dependency_overrides[get_current_active_user_async] = lambda: user
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=True))


@pytest.fixture()
def unresolved_client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=False))


# ---------------------------------------------------------------------------
# The coord transport stub
# ---------------------------------------------------------------------------


def _mock_response(
    status_code: int = 200, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data is not None else "")
    resp.content = (resp.text or "").encode()
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(mock_client_cls: MagicMock, instance: AsyncMock) -> None:
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    mock_client_cls.return_value = instance


def _assert_bearer_forwarded_without_tenant_header(call: Any) -> None:
    """The scoped proxy hands coord a headers dict (the caller's bearer, when
    one was captured) and never the retired tenant header."""
    headers = call.kwargs.get("headers")
    assert headers is not None
    assert TENANT_HEADER not in headers


def _me_payload(roles: tuple[str, ...]) -> dict[str, Any]:
    """coord ``GET /admin/coord/me`` for a member of one tenant."""
    home = str(_FIXTURE_TENANT_ID)
    return {
        "operator_id": str(uuid4()),
        "home_tenant_id": home,
        "tenant_id": home,
        "email": "op@qontinui.io",
        "roles": list(roles),
        "tenants": [{"tenant_id": home, "slug": "home-slug", "roles": list(roles)}],
        "is_admin": "admin" in roles,
    }


def _gate_transport(roles: tuple[str, ...]) -> tuple[Any, MagicMock]:
    """A process-wide ``httpx.AsyncClient`` stub: ``/admin/coord/me`` answers
    ``roles``, and every other coord call is recorded and answered ``200 {}``.

    Returned as ``(patcher, client)`` so a test can assert which coord routes
    were reached — a refused write must reach none of the subproject doors.
    """

    def _response(status_code: int, json_data: Any = None, text: str = "") -> Any:
        return _mock_response(status_code, json_data, text)

    async def _handle(url: str, *args: Any, **kwargs: Any) -> Any:
        if url.endswith("/admin/coord/me"):
            headers = kwargs.get("headers") or {}
            if not headers.get("Authorization"):
                return _response(401, text="missing bearer")
            return _response(200, _me_payload(roles))
        return _response(200, {})

    stub = MagicMock()
    stub.get = AsyncMock(side_effect=_handle)
    stub.post = AsyncMock(side_effect=_handle)
    stub.patch = AsyncMock(side_effect=_handle)
    stub.__aenter__ = AsyncMock(return_value=stub)
    stub.__aexit__ = AsyncMock(return_value=False)
    return patch("httpx.AsyncClient", return_value=stub), stub


def _coord_urls(stub: MagicMock) -> list[str]:
    calls = [*stub.get.call_args_list, *stub.post.call_args_list]
    calls += stub.patch.call_args_list
    return [str(c.args[0]) for c in calls]


# The four writes, as ``(method, route suffix, coord suffix, body)``. Each body
# is a shape the contract names, so the fixtures double as the wire's
# documentation on this side.
WRITES: list[tuple[str, str, dict[str, Any]]] = [
    ("patch", "", {"title": "Dashboards and presentation", "status": "done"}),
    ("post", "/merge", {"into_id": "0b1c2d3e-4f50-4617-8899-aabbccddeeff"}),
    (
        "post",
        "/members",
        {
            "action": "move",
            "member_kind": "session",
            "agent_session_id": "6c3e0aac-0000-4000-8000-000000000001",
        },
    ),
    (
        "post",
        "/spawn",
        {
            "effort": "high",
            "ultracode": False,
            "prompt_addendum": "Start from the failed resume gate.",
            "repos": [{"repo": "qontinui-web"}],
        },
    ),
]


def _write_ids(write: tuple[str, str, dict[str, Any]]) -> str:
    method, suffix, _ = write
    return f"{method.upper()} {suffix or '/'}"


# ---------------------------------------------------------------------------
# GET /subprojects
# ---------------------------------------------------------------------------


LIST_BODY: dict[str, Any] = {
    "items": [
        {
            "id": SUBPROJECT_ID,
            "slug": "dashboards-and-presentation",
            "title": "dashboards-and-presentation-27-10",
            "title_source": "root_session",
            "goal": None,
            "origin": "operator_prompt",
            "status": "open",
            "merged_into": None,
            "root_agent_session_id": "6c3e0aac-0000-4000-8000-000000000001",
            "created_at": "2026-10-23T09:00:00Z",
            "updated_at": "2026-11-08T10:49:00Z",
            "closed_at": None,
            "headline": "stalled",
            "top_reason": {
                "kind": "gate_dependency_unowned",
                "summary": "Waiting on qontinui/qontinui-runner#2569, whose "
                "author session closed",
                "refs": [
                    {
                        "type": "pr",
                        "id": "qontinui/qontinui-runner#2569",
                        "label": "qontinui-runner#2569",
                    }
                ],
                "detail": None,
            },
            "reasons_count": 2,
            "sessions": {"live": 0, "total": 3},
            "work_units": {"total": 2, "open": 1},
            "last_activity_at": "2026-11-08T10:49:00Z",
            "verdict_as_of": "2026-11-08T15:00:00Z",
            # A field this proxy has never heard of: it must still arrive.
            "a_field_coord_adds_later": {"nested": [1, 2]},
        }
    ],
    "next_cursor": "opaque-cursor",
    "truncated": True,
    "total": 41,
    "unattached_units": {"count": 7, "by_class": {"stalled": 3, "not_started": 4}},
    "generated_at": "2026-11-08T15:01:00Z",
}


class TestGetSubprojects:
    def test_returns_coord_body_unchanged(self, client: TestClient) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/subprojects")

        assert resp.status_code == 200
        assert resp.json() == LIST_BODY
        call = instance.get.call_args
        assert call.args[0].endswith("/coord/subprojects")
        # No query was sent, so none is invented: coord's own default
        # (`status=open`) decides.
        assert call.kwargs.get("params") is None
        _assert_bearer_forwarded_without_tenant_header(call)

    def test_forwards_exactly_the_filters_that_were_set(
        self, client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects",
                params={
                    "status": "all",
                    "headline": "stalled",
                    "exclude_headline": "done",
                    "origin": "operator_prompt",
                    "limit": 25,
                    "cursor": "opaque-cursor",
                },
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {
            "status": "all",
            "headline": "stalled",
            "exclude_headline": "done",
            "origin": "operator_prompt",
            "limit": 25,
            "cursor": "opaque-cursor",
        }

    def test_open_is_one_read_that_excludes_done(self, client: TestClient) -> None:
        """The list page reads Open as ``status=open&exclude_headline=done``.
        This router DROPS an undeclared query parameter rather than refusing
        it, so the filter reaches coord only because it is declared — the
        page's per-headline fallback depends on coord seeing it."""
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects",
                params={"status": "open", "exclude_headline": "done", "limit": 100},
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {
            "status": "open",
            "exclude_headline": "done",
            "limit": 100,
        }

    def test_a_multi_value_headline_is_forwarded_as_one_value(
        self, client: TestClient
    ) -> None:
        """coord takes ``headline=a,b``; the comma-separated value is coord's
        to split, so it is forwarded verbatim, not split or vetted here."""
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects",
                params={
                    "headline": "needs_you,stalled",
                    "exclude_headline": "done,unknown",
                },
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {
            "headline": "needs_you,stalled",
            "exclude_headline": "done,unknown",
        }

    def test_a_coord_that_does_not_know_a_parameter_says_which_as_an_object(
        self, client: TestClient
    ) -> None:
        """The page falls back to per-headline reads on exactly this answer,
        so it must reach the browser whole — the code AND the parameters
        coord named."""
        coord_body = {
            "error": "unknown_query_parameter",
            "unknown": ["exclude_headline"],
        }
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=400, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects",
                params={"status": "open", "exclude_headline": "done"},
            )

        assert resp.status_code == 400
        assert resp.json() == {"detail": coord_body}

    def test_a_filter_value_is_forwarded_as_sent_not_vetted_here(
        self, client: TestClient
    ) -> None:
        """coord owns the headline vocabulary and refuses a value it does not
        know; a second copy of the vocabulary here would drift from it."""
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects", params={"headline": "a_new_headline"}
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {"headline": "a_new_headline"}

    @pytest.mark.parametrize("limit", [0, 201])
    def test_a_limit_outside_the_contract_is_refused_before_coord(
        self, client: TestClient, limit: int
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/subprojects", params={"limit": limit})

        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_a_pending_migration_reaches_the_browser_as_an_object(
        self, client: TestClient
    ) -> None:
        """A 503 before the alembic revision applies is an UNKNOWN the page
        must name — so it arrives as coord's object, not as a string."""
        coord_body = {"error": "schema_migration_pending"}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=503, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/subprojects")

        assert resp.status_code == 503
        assert resp.json() == {"detail": coord_body}

    def test_reads_under_the_subprojects_budget(self, client: TestClient) -> None:
        from app.api.v1.endpoints.operations import _COORD_SUBPROJECTS_TIMEOUT

        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=LIST_BODY)
            _configure_mock_client(mock_client_cls, instance)
            client.get(f"{API_PREFIX}/subprojects")

        assert mock_client_cls.call_args.kwargs["timeout"] == (
            _COORD_SUBPROJECTS_TIMEOUT
        )

    def test_unresolved_tenant_is_forbidden(
        self, unresolved_client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = unresolved_client.get(f"{API_PREFIX}/subprojects")

        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"
        instance.get.assert_not_called()

    def test_coord_unreachable_returns_502(self, client: TestClient) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/subprojects")

        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# GET /subprojects/{id}
# ---------------------------------------------------------------------------


DETAIL_BODY: dict[str, Any] = {
    "subproject": {
        **LIST_BODY["items"][0],
        "next_steps_note": None,
        "next_steps_note_by": None,
        "next_steps_note_at": None,
    },
    "verdict": {
        "headline": "stalled",
        "reasons": [LIST_BODY["items"][0]["top_reason"]],
        "sources": [
            {
                "source": "gates",
                "state": "read",
                "as_of": "2026-11-08T15:02:00Z",
                "error": None,
            }
        ],
        "as_of": "2026-11-08T15:02:00Z",
    },
    "next_steps": [
        {
            "source": "remedy",
            "text": "Spawn a session to adopt qontinui/qontinui-runner#2569",
            "refs": [],
            "remedy_kind": "spawn_to_adopt_pr",
        }
    ],
    "sessions": [],
    "work_units": [],
    "gates": [],
    "prs": [],
    "history": [],
    "resolved_from": "0b1c2d3e-4f50-4617-8899-aabbccddeeff",
}


class TestGetSubproject:
    def test_returns_coord_body_unchanged(self, client: TestClient) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=DETAIL_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}")

        assert resp.status_code == 200
        assert resp.json() == DETAIL_BODY
        call = instance.get.call_args
        assert call.args[0].endswith(f"/coord/subprojects/{SUBPROJECT_ID}")
        _assert_bearer_forwarded_without_tenant_header(call)

    def test_reads_under_the_subprojects_budget(self, client: TestClient) -> None:
        """The detail door computes the verdict live (D1), so a 5 s cut-off
        would turn a slow answer into every section unknown."""
        from app.api.v1.endpoints.operations import _COORD_SUBPROJECTS_TIMEOUT

        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=DETAIL_BODY)
            _configure_mock_client(mock_client_cls, instance)
            client.get(f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}")

        assert mock_client_cls.call_args.kwargs["timeout"] == (
            _COORD_SUBPROJECTS_TIMEOUT
        )

    def test_coord_404_passes_through(self, client: TestClient) -> None:
        coord_body = {"error": "subproject_not_found"}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=404, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}")

        assert resp.status_code == 404
        assert resp.json() == {"detail": coord_body}

    @pytest.mark.parametrize("bad_id", ["not-a-uuid", "..", "%2E%2E"])
    def test_an_id_that_is_not_a_uuid_never_reaches_coord(
        self, client: TestClient, bad_id: str
    ) -> None:
        """A typed id cannot carry a segment that re-aims the forwarded path at
        another coord route under the operator's bearer."""
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(f"{API_PREFIX}/subprojects/{bad_id}")

        assert resp.status_code in (404, 422)
        instance.get.assert_not_called()

    def test_unresolved_tenant_is_forbidden(
        self, unresolved_client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = unresolved_client.get(f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}")

        assert resp.status_code == 403
        instance.get.assert_not_called()


# ---------------------------------------------------------------------------
# The four writes
# ---------------------------------------------------------------------------


class TestSubprojectWrites:
    @pytest.mark.parametrize("write", WRITES, ids=_write_ids)
    def test_the_body_reaches_coord_verbatim(
        self, client: TestClient, write: tuple[str, str, dict[str, Any]]
    ) -> None:
        method, suffix, body = write
        coord_answer = {"ok": True, "echo": body}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            getattr(instance, method).return_value = _mock_response(
                json_data=coord_answer
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.request(
                method.upper(),
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}{suffix}",
                json=body,
            )

        assert resp.status_code == 200
        assert resp.json() == coord_answer
        call = getattr(instance, method).call_args
        assert call.args[0].endswith(f"/coord/subprojects/{SUBPROJECT_ID}{suffix}")
        assert call.kwargs.get("json") == body
        _assert_bearer_forwarded_without_tenant_header(call)

    @pytest.mark.parametrize("write", WRITES, ids=_write_ids)
    def test_a_member_who_is_not_an_admin_is_refused_before_coord(
        self, write: tuple[str, str, dict[str, Any]]
    ) -> None:
        """The real ``require_coord_tenant_admin``: coord's ``/me`` says the
        caller is a member only, so the write is 403 and no subproject door is
        reached — merge and spawn included."""
        method, suffix, body = write
        member = MagicMock()
        member.id = uuid4()
        member.email = "member@example.com"
        member.is_active = True
        member.is_superuser = False

        patcher, stub = _gate_transport(roles=("member",))
        with patcher:
            resp = TestClient(_build_gated_app(member)).request(
                method.upper(),
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}{suffix}",
                json=body,
                headers={"Authorization": "Bearer tok"},
            )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "not_coord_tenant_admin"
        assert not [u for u in _coord_urls(stub) if "/coord/subprojects" in u]

    @pytest.mark.parametrize("write", WRITES, ids=_write_ids)
    def test_an_admin_passes_the_real_gate(
        self, write: tuple[str, str, dict[str, Any]]
    ) -> None:
        """The positive control for the refusal above: the same stub, with
        coord's ``/me`` naming the caller an admin, reaches the door — so the
        403 is the gate's verdict, not a broken harness."""
        method, suffix, body = write
        admin = MagicMock()
        admin.id = uuid4()
        admin.email = "admin@example.com"
        admin.is_active = True
        admin.is_superuser = False

        patcher, stub = _gate_transport(roles=("admin", "member"))
        with patcher:
            resp = TestClient(_build_gated_app(admin)).request(
                method.upper(),
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}{suffix}",
                json=body,
                headers={"Authorization": "Bearer tok"},
            )

        assert resp.status_code == 200
        assert [u for u in _coord_urls(stub) if "/coord/subprojects" in u] == [
            next(
                u
                for u in _coord_urls(stub)
                if u.endswith(f"/coord/subprojects/{SUBPROJECT_ID}{suffix}")
            )
        ]

    @pytest.mark.parametrize("write", WRITES, ids=_write_ids)
    def test_unresolved_tenant_is_forbidden(
        self,
        unresolved_client: TestClient,
        write: tuple[str, str, dict[str, Any]],
    ) -> None:
        method, suffix, body = write
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = unresolved_client.request(
                method.upper(),
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}{suffix}",
                json=body,
            )

        assert resp.status_code == 403
        getattr(instance, method).assert_not_called()

    @pytest.mark.parametrize("write", WRITES, ids=_write_ids)
    def test_coords_typed_refusal_arrives_as_an_object(
        self, client: TestClient, write: tuple[str, str, dict[str, Any]]
    ) -> None:
        method, suffix, body = write
        coord_body = {"error": "subproject_not_found", "id": SUBPROJECT_ID}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            getattr(instance, method).return_value = _mock_response(
                status_code=404, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.request(
                method.upper(),
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}{suffix}",
                json=body,
            )

        assert resp.status_code == 404
        assert resp.json() == {"detail": coord_body}

    @pytest.mark.parametrize("write", WRITES, ids=_write_ids)
    def test_a_body_that_is_not_an_object_never_reaches_coord(
        self, client: TestClient, write: tuple[str, str, dict[str, Any]]
    ) -> None:
        method, suffix, _ = write
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = client.request(
                method.upper(),
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}{suffix}",
                json=["not", "an", "object"],
            )

        assert resp.status_code == 422
        getattr(instance, method).assert_not_called()


# ---------------------------------------------------------------------------
# POST /subprojects/{id}/spawn — Continue
# ---------------------------------------------------------------------------


SPAWN_BODY: dict[str, Any] = {
    "effort": "medium",
    "target_device_id": "00000000-0000-0000-0000-deadbeefcafe",
    "repos": [{"repo": "qontinui-web"}, {"repo": "qontinui-coord"}],
    "prompt_addendum": "Pick up from the failed resume gate.",
}


class TestPostSubprojectSpawn:
    def test_the_spawn_answer_passes_through(self, client: TestClient) -> None:
        coord_answer = {
            "subproject_id": SUBPROJECT_ID,
            "allocation_agent_id": "01a1bbe4-53fb-7101-ac6b-57bc45151491",
            "target_device_id": "00000000-0000-0000-0000-deadbeefcafe",
            "placement": "pinned",
            "effort_requested": "medium",
            "ultracode_requested": False,
            "repos": ["qontinui-web", "qontinui-coord"],
            "brief_preview": "Continue subproject dashboards-and-presentation...",
        }
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=coord_answer)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.post(
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}/spawn", json=SPAWN_BODY
            )

        assert resp.status_code == 200
        assert resp.json() == coord_answer
        assert instance.post.call_args.kwargs.get("json") == SPAWN_BODY

    def test_an_automatic_spawn_is_forwarded_without_inventing_a_device(
        self, client: TestClient
    ) -> None:
        """No ``target_device_id`` means coord's pool placement (D8); the proxy
        neither requires one nor adds one."""
        body = {"effort": "high"}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data={"placement": "pool"})
            _configure_mock_client(mock_client_cls, instance)
            resp = client.post(
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}/spawn", json=body
            )

        assert resp.status_code == 200
        forwarded = instance.post.call_args.kwargs.get("json")
        assert forwarded == body
        assert "target_device_id" not in forwarded

    @pytest.mark.parametrize(
        ("status_code", "coord_body"),
        [
            (409, {"error": "no_capacity", "detail": "every device is at its cap"}),
            (
                409,
                {
                    "error": "no_eligible_device",
                    "outcome": "all_capable_at_capacity",
                    "capable_devices": 2,
                },
            ),
            (
                409,
                {
                    "error": "pin_ineligible",
                    "device_id": "00000000-0000-0000-0000-deadbeefcafe",
                    "reason": "offline",
                    "missing_capabilities": [],
                },
            ),
            (
                409,
                {
                    "error": "device_drained",
                    "device_id": "00000000-0000-0000-0000-deadbeefcafe",
                    "reason": "rebuild",
                },
            ),
            (
                422,
                {
                    "error": "subproject_has_no_repo",
                    "hint": "send repos[], or attach a work unit that names one",
                },
            ),
            (422, {"error": "invalid_effort", "effort": "ludicrous"}),
            (404, {"error": "subproject_not_found"}),
        ],
        ids=lambda v: v["error"] if isinstance(v, dict) else str(v),
    )
    def test_coords_refusal_reaches_the_browser_as_an_object(
        self, client: TestClient, status_code: int, coord_body: dict[str, Any]
    ) -> None:
        """The Continue dialog branches on these codes, so they must arrive as
        data — not stringified into a message the browser has to re-parse."""
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=status_code, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.post(
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}/spawn", json=SPAWN_BODY
            )

        assert resp.status_code == status_code
        assert resp.json() == {"detail": coord_body}

    def test_spawns_under_the_subprojects_budget(self, client: TestClient) -> None:
        from app.api.v1.endpoints.operations import _COORD_SUBPROJECTS_TIMEOUT

        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data={})
            _configure_mock_client(mock_client_cls, instance)
            client.post(
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}/spawn", json=SPAWN_BODY
            )

        assert mock_client_cls.call_args.kwargs["timeout"] == (
            _COORD_SUBPROJECTS_TIMEOUT
        )

    def test_a_timed_out_spawn_is_a_504_not_a_failure(self, client: TestClient) -> None:
        """coord may have placed the session before the answer was lost, so the
        status is the write-timeout 504 — the dialog's "may or may not have
        landed" — never a 4xx that reads as refused."""
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.post.side_effect = httpx.ReadTimeout("slow")
            _configure_mock_client(mock_client_cls, instance)
            resp = client.post(
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}/spawn", json=SPAWN_BODY
            )

        assert resp.status_code == 504

    def test_coord_unreachable_returns_502(self, client: TestClient) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.post.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(mock_client_cls, instance)
            resp = client.post(
                f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}/spawn", json=SPAWN_BODY
            )

        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# The production envelope
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "status_code", "coord_body"),
    [
        (
            "post",
            f"/subprojects/{SUBPROJECT_ID}/spawn",
            409,
            {"error": "no_capacity", "reason": "every device is at its cap"},
        ),
        ("get", "/subprojects", 503, {"error": "schema_migration_pending"}),
    ],
    ids=["spawn-409", "list-503"],
)
def test_the_refusal_envelope_splices_coords_keys_to_the_top_level(
    method: str, path: str, status_code: int, coord_body: dict[str, Any]
) -> None:
    """With the app's real HTTP-exception handler, coord's keys land at the
    TOP level of the envelope — the shape the frontend's refusal reader
    (``spawnPlacement.ts`` ``extractCoordRefusal``) reads first."""
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.middleware.error_handler import http_exception_handler

    app = _build_test_app(resolves_tenant=True)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    with _patch_httpx() as mock_client_cls:
        instance = AsyncMock()
        getattr(instance, method).return_value = _mock_response(
            status_code=status_code, json_data=coord_body
        )
        _configure_mock_client(mock_client_cls, instance)
        resp = TestClient(app).request(
            method.upper(),
            f"{API_PREFIX}{path}",
            json=SPAWN_BODY if method == "post" else None,
        )

    assert resp.status_code == status_code
    got = resp.json()
    for key, value in coord_body.items():
        assert got[key] == value


# ---------------------------------------------------------------------------
# GET /subprojects/by-sessions — the sessions console's chip lookup
# ---------------------------------------------------------------------------


BY_SESSIONS_BODY: dict[str, Any] = {
    "items": {
        "6c3e0aac-0000-4000-8000-000000000001": {
            "id": SUBPROJECT_ID,
            "title": "dashboards-and-presentation",
            "headline": "stalled",
        }
    },
    "missing": ["da200448-0000-4000-8000-000000000002"],
}


class TestGetSubprojectsBySessions:
    def test_forwards_the_ids_and_returns_coord_body_unchanged(
        self, client: TestClient
    ) -> None:
        ids = (
            "6c3e0aac-0000-4000-8000-000000000001,da200448-0000-4000-8000-000000000002"
        )
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=BY_SESSIONS_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects/by-sessions", params={"ids": ids}
            )

        assert resp.status_code == 200
        assert resp.json() == BY_SESSIONS_BODY
        call = instance.get.call_args
        assert call.args[0].endswith("/coord/subprojects/by-sessions")
        assert call.kwargs["params"] == {"ids": ids}
        _assert_bearer_forwarded_without_tenant_header(call)

    def test_is_not_taken_for_a_subproject_id(self, client: TestClient) -> None:
        """Declared before ``/subprojects/{id}``: with the order reversed, the
        literal segment would be matched as an id and refused 422."""
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=BY_SESSIONS_BODY)
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects/by-sessions",
                params={"ids": "6c3e0aac-0000-4000-8000-000000000001"},
            )

        assert resp.status_code == 200
        assert instance.get.call_args.args[0].endswith("/by-sessions")

    @pytest.mark.parametrize("count", [0, 201])
    def test_a_page_outside_coords_bound_is_refused_before_coord(
        self, client: TestClient, count: int
    ) -> None:
        ids = ",".join(str(uuid4()) for _ in range(count)) if count else " , "
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects/by-sessions", params={"ids": ids}
            )

        assert resp.status_code == 422
        assert resp.json()["detail"]["error"] == "invalid_session_ids"
        instance.get.assert_not_called()

    def test_a_pending_migration_reaches_the_browser_as_an_object(
        self, client: TestClient
    ) -> None:
        coord_body = {"error": "schema_migration_pending"}
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=503, json_data=coord_body
            )
            _configure_mock_client(mock_client_cls, instance)
            resp = client.get(
                f"{API_PREFIX}/subprojects/by-sessions",
                params={"ids": "6c3e0aac-0000-4000-8000-000000000001"},
            )

        assert resp.status_code == 503
        assert resp.json() == {"detail": coord_body}

    def test_unresolved_tenant_is_forbidden(
        self, unresolved_client: TestClient
    ) -> None:
        with _patch_httpx() as mock_client_cls:
            instance = AsyncMock()
            _configure_mock_client(mock_client_cls, instance)
            resp = unresolved_client.get(
                f"{API_PREFIX}/subprojects/by-sessions",
                params={"ids": "6c3e0aac-0000-4000-8000-000000000001"},
            )

        assert resp.status_code == 403
        instance.get.assert_not_called()


def test_a_spawn_whose_answer_was_lost_is_an_unknown_outcome_not_a_500(
    client: TestClient,
) -> None:
    """A ReadError after the POST went out — coord may have placed the session
    — is the 504 ``answer_lost`` refusal, never an unhandled 500 that the
    Continue dialog would have to read as a refusal."""
    with _patch_httpx() as mock_client_cls:
        instance = AsyncMock()
        instance.post.side_effect = httpx.ReadError("connection reset")
        _configure_mock_client(mock_client_cls, instance)
        resp = client.post(
            f"{API_PREFIX}/subprojects/{SUBPROJECT_ID}/spawn", json=SPAWN_BODY
        )

    assert resp.status_code == 504
    assert "lost in transit" in str(resp.json()["detail"])
