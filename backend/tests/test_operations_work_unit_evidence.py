"""The work-unit evidence proxies — the person's door for delivery evidence.

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` Phase 6.
Under ``/api/v1/operations/plans/{slug}``:

* ``POST|DELETE /phase-attestations`` -> coord ``operator-phase-attestations``
* ``POST|DELETE /citations``          -> coord ``operator-citations``
* ``GET /plans/{slug}?with_citations=1`` -> coord's own ``?with_citations=1``

The Project Overview calls a phase done only on this evidence, and it has no
entered value (plan D5), so a person must be able to record it here. What is
pinned, each able to fail on its own:

1. **The coord body is closed and assembled here.** ``by_actor`` is the
   AUTHENTICATED operator, never the browser's; keys outside the route's set
   are not forwarded; a missing required field is a 422 before any coord call.
2. **DELETE carries its body**, and the actor, to coord.
3. **Coord's typed refusals keep their status** (404 for another tenant's unit,
   422 for evidence that does not resolve).
4. **``with_citations`` is forwarded only when asked for**, so the unit read the
   rest of the console uses is byte-identical.
5. **A slug that would rewrite the coord path is refused.**
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
BASE = f"{API_PREFIX}/plans/{SLUG}"
TEST_BEARER = "test-cognito-access-token"
FINDING = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd"


def _build_test_app() -> FastAPI:
    from app.api.deps import (
        get_async_db,
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
    mock_user.email = "ops@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_audit_actor_user_optional] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: MagicMock()

    async def _tenant_override() -> UUID:
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _resp(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status_code
    r.json.return_value = json_data
    r.text = text or (str(json_data) if json_data else "")
    r.content = b"x" if json_data is not None else b""
    return r


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure(MockClient, inst):
    inst.__aenter__ = AsyncMock(return_value=inst)
    inst.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = inst


ATTEST = {
    "phase_index": 2,
    "evidence_kind": "finding",
    "evidence_ref": FINDING,
    "note": "shipped off-system",
}


class TestPhaseAttestationProxy:
    def test_post_is_closed_and_carries_the_authenticated_actor(self, client):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(return_value=_resp(200, {"created": True}))
            _configure(MockClient, inst)
            r = client.post(
                f"{BASE}/phase-attestations",
                json={**ATTEST, "by_actor": "forged", "attested_by": "forged"},
            )
        assert r.status_code == 200
        assert inst.post.call_args.args[0].endswith(
            f"/coord/work-units/{SLUG}/operator-phase-attestations"
        )
        sent = inst.post.call_args.kwargs["json"]
        assert sent["by_actor"] == "operator:ops@example.com"
        assert "attested_by" not in sent
        assert sent["phase_index"] == 2 and sent["evidence_ref"] == FINDING

    def test_a_missing_required_field_is_refused_before_coord(self, client):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock()
            _configure(MockClient, inst)
            r = client.post(
                f"{BASE}/phase-attestations",
                json={"phase_index": 2, "evidence_kind": "finding"},
            )
        assert r.status_code == 422
        inst.post.assert_not_called()

    @pytest.mark.parametrize("status", [404, 422])
    def test_coord_refusals_keep_their_status_and_typed_body(self, client, status):
        refusal = {"error": "evidence_unresolvable", "reason": "no such finding"}
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(return_value=_resp(status, refusal, text="raw"))
            _configure(MockClient, inst)
            r = client.post(f"{BASE}/phase-attestations", json=ATTEST)
        assert r.status_code == status
        assert r.json()["detail"]["error"] == "evidence_unresolvable"

    def test_delete_sends_its_body_and_actor(self, client):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.request = AsyncMock(return_value=_resp(200, {"outcome": "retracted"}))
            _configure(MockClient, inst)
            r = client.request(
                "DELETE",
                f"{BASE}/phase-attestations",
                json={
                    "phase_index": 2,
                    "evidence_kind": "finding",
                    "evidence_ref": FINDING,
                    "extra": "dropped",
                },
            )
        assert r.status_code == 200
        method, url = inst.request.call_args.args[:2]
        assert method == "DELETE"
        assert url.endswith(f"/coord/work-units/{SLUG}/operator-phase-attestations")
        sent = inst.request.call_args.kwargs["json"]
        assert sent["by_actor"] == "operator:ops@example.com"
        assert "extra" not in sent


class TestCitationProxy:
    def test_post_and_delete(self, client):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock(return_value=_resp(200, {"created": True}))
            inst.request = AsyncMock(return_value=_resp(200, {"removed": 1}))
            _configure(MockClient, inst)
            body = {"repo": "acme/widgets", "pr_number": 12, "by_actor": "forged"}
            r1 = client.post(f"{BASE}/citations", json=body)
            r2 = client.request("DELETE", f"{BASE}/citations", json=body)
        assert r1.status_code == 200 and r2.status_code == 200
        assert inst.post.call_args.args[0].endswith(
            f"/coord/work-units/{SLUG}/operator-citations"
        )
        for sent in (
            inst.post.call_args.kwargs["json"],
            inst.request.call_args.kwargs["json"],
        ):
            assert sent["by_actor"] == "operator:ops@example.com"
            assert sent["repo"] == "acme/widgets" and sent["pr_number"] == 12

    def test_a_missing_pr_number_is_refused_before_coord(self, client):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock()
            _configure(MockClient, inst)
            r = client.post(f"{BASE}/citations", json={"repo": "acme/widgets"})
        assert r.status_code == 422
        inst.post.assert_not_called()


class TestSlugAndUnitRead:
    @pytest.mark.parametrize("bad", ["a%3Fb", "a%23b", "a%2Fb"])
    def test_a_slug_that_would_rewrite_the_coord_path_is_refused(self, client, bad):
        with _patch_httpx() as MockClient:
            inst = MagicMock()
            inst.post = AsyncMock()
            inst.request = AsyncMock()
            _configure(MockClient, inst)
            r = client.post(
                f"{API_PREFIX}/plans/{bad}/citations",
                json={"repo": "a/b", "pr_number": 1},
            )
        assert r.status_code in (404, 422)
        inst.post.assert_not_called()

    def test_with_citations_is_forwarded_only_when_asked(self, client):
        unit = {
            "work_unit": {"slug": SLUG, "metadata": {}},
            "citations": [],
            "delivery": {},
        }

        def unit_read_params(inst):
            # The route also reads the plan_capture dial (a second GET); the
            # unit read is the one whose URL ends with the slug.
            calls = [
                c
                for c in inst.get.call_args_list
                if str(c.args[0]).endswith(f"/coord/work-units/{SLUG}")
            ]
            assert len(calls) == 1, inst.get.call_args_list
            return calls[0].kwargs.get("params")

        results = []
        for url in (f"{BASE}?with_citations=1", BASE):
            with _patch_httpx() as MockClient:
                inst = MagicMock()
                inst.get = AsyncMock(return_value=_resp(200, unit))
                _configure(MockClient, inst)
                client.get(url)
                results.append(unit_read_params(inst))
        assert results[0] == {"with_citations": "1"}
        assert not results[1]
