"""Integration tests for the coord prompt-documents proxy endpoints.

These endpoints (under ``/api/v1/operations/coord/prompt-documents``) forward
coord's versioned prompt-document CRUD (coord ``src/prompt_documents.rs``) so the
``/admin/coord/prompt-documents`` editor renders without the browser hitting
coord cross-origin.

Plan ``2026-07-17-session-autonomy-fabric.md`` Phase 9.

Mirrors the testing pattern in ``test_operations_claims_proxy.py``: a minimal
FastAPI app + a mocked ``httpx.AsyncClient``, so no live coord is needed.

The behaviours that matter here, and why:

* the ``(kind, name)`` address and the ``?kind=`` list filter reach coord intact;
* ``updated_by`` on a PATCH is stamped from the SESSION, never from the body —
  the version history is an audit trail, so a browser must not be able to forge
  the editor tag;
* coord's 4xx bodies (unknown kind, not-found, the ``degraded`` store-absent 404
  of the D1 deploy-ordering window) pass through verbatim rather than becoming
  a 500 — the UI renders coord's honest state.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Fixed operator tenant + identity so tests can assert what the proxy forwards.
TEST_TENANT_ID = uuid4()
TEST_USER_ID = uuid4()
TEST_USER_EMAIL = "editor@example.com"

API_PREFIX = "/api/v1/operations"


def _build_test_app(*, user_email: str | None = TEST_USER_EMAIL) -> FastAPI:
    """Minimal FastAPI app exposing the operations router with the coord
    identity dependencies overridden (no real DB/coord for tenant resolution)."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = TEST_USER_ID
    mock_user.email = user_email
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT_ID
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: TEST_TENANT_ID
    test_app.include_router(operations_router, prefix=API_PREFIX)
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


def _doc(**overrides):
    doc = {
        "id": "11111111-1111-1111-1111-111111111111",
        "tenant_id": str(TEST_TENANT_ID),
        "kind": "policy",
        "name": "engineering-priorities",
        "description": "Engineering Priorities",
        "body": "Prefer the stronger design.",
        "format": "markdown",
        "default_source": "prompt_doc/policy/engineering-priorities/v1",
        "current_version": 3,
        "updated_by": "editor@example.com",
        "updated_at": "2026-07-17T00:00:00Z",
    }
    doc.update(overrides)
    return doc


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-documents
# ---------------------------------------------------------------------------


class TestListPromptDocuments:
    def test_returns_documents(self, auth_client: TestClient):
        coord_payload = {"documents": [_doc()], "total": 1}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert instance.get.call_args.args[0].endswith("/coord/prompt-documents")

    def test_kind_filter_forwarded(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"documents": [], "total": 0}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents?kind=agent_playbook"
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs.get("params") == {"kind": "agent_playbook"}

    def test_no_kind_filter_sends_no_params(self, auth_client: TestClient):
        """An unfiltered list must not send ``kind=None`` — coord would 400 it
        as an unknown kind."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"documents": [], "total": 0}
            )
            _configure_mock_client(MockClient, instance)

            auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert instance.get.call_args.kwargs.get("params") is None

    def test_unknown_kind_400_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=400, text='{"error":"unknown kind `bogus`"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents?kind=bogus")

        assert resp.status_code == 400
        assert "unknown kind" in resp.json()["detail"]

    def test_degraded_envelope_passes_through(self, auth_client: TestClient):
        """Coord returns an empty list + a ``degraded`` note while the store is
        not yet provisioned (D1 window). The proxy must forward that honesty
        rather than flattening it to a bare empty list."""
        coord_payload = {
            "documents": [],
            "total": 0,
            "degraded": "prompt-document store not provisioned in this database yet",
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.json() == coord_payload

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.status_code == 502
        assert resp.json()["detail"] == "coord is not reachable"

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("slow")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.status_code == 504


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-documents/{kind}/{name}
# ---------------------------------------------------------------------------


class TestGetPromptDocument:
    def test_returns_document_with_body(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_doc())
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities"
            )

        assert resp.status_code == 200
        assert resp.json()["body"] == "Prefer the stronger design."
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities"
        )

    def test_claims_envelope_passed_through_intact(self, auth_client: TestClient):
        """The five ``claims*`` fields coord adds beside ``document`` (plan
        ``2026-09-06-domain-spec-divergences-decay-with-no-re-probe`` Phase 2)
        must reach the browser byte-for-byte.

        The proxy returns coord's JSON verbatim and declares ``-> Any``, so
        nothing whitelists keys today — this pins that a future response
        model on this route cannot silently DROP them. Each field is asserted
        individually rather than by whole-payload equality so a regression
        names the key it lost; the ``unknown`` claim with
        ``{"reason": "never_observed"}`` and the ``table_absent`` source are
        the two degrade shapes the console must be able to render, so those
        are the values chosen.
        """
        claims = [
            {
                "claim_id": "speculative-chaining-lever",
                "state": "confirmed",
                "observed_at": "2026-09-06T07:00:00Z",
                "verified_at": "2026-09-06T06:30:00Z",
                "verified_against": "qontinui-coord@a497830f",
                "anchor_type": "flag_state",
                "detail": {},
            },
            {
                "claim_id": "never-observed-claim",
                "state": "unknown",
                "observed_at": None,
                "verified_at": "2026-09-06T06:30:00Z",
                "verified_against": "qontinui-coord@a497830f",
                "anchor_type": "content",
                "detail": {"reason": "never_observed"},
            },
        ]
        coord_payload = _doc(
            kind="domain_spec",
            name="coord-merge-train",
            claims=claims,
            claims_probed=2,
            claims_malformed=1,
            claims_observed_at="2026-09-06T07:00:00Z",
            claims_state_source="table_absent",
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/domain_spec/coord-merge-train"
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["claims"] == claims
        assert body["claims_probed"] == 2
        assert body["claims_malformed"] == 1
        assert body["claims_observed_at"] == "2026-09-06T07:00:00Z"
        assert body["claims_state_source"] == "table_absent"
        # And nothing was added or renamed on the way through either.
        assert body == coord_payload

    def test_claims_envelope_absent_stays_absent(self, auth_client: TestClient):
        """An older coord serves NONE of the ``claims*`` fields. The proxy
        must not invent them (a defaulted ``claims: []`` or
        ``claims_probed: 0`` would render as "no probe blocks" — a confident
        zero where the honest state is UNKNOWN)."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_doc())
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities"
            )

        assert resp.status_code == 200
        body = resp.json()
        for key in (
            "claims",
            "claims_probed",
            "claims_malformed",
            "claims_observed_at",
            "claims_state_source",
        ):
            assert key not in body, key

    def test_not_found_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=404, text='{"error":"prompt document not found"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents/policy/nope")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /operations/coord/prompt-documents/{kind}/{name}
# ---------------------------------------------------------------------------


class TestUpdatePromptDocument:
    def test_forwards_edit_and_stamps_session_identity(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(
                json_data=_doc(body="new prose", current_version=4)
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "new prose", "change_description": "sharpen wording"},
            )

        assert resp.status_code == 200
        assert resp.json()["current_version"] == 4
        sent = instance.patch.call_args.kwargs["json"]
        assert sent["body"] == "new prose"
        assert sent["change_description"] == "sharpen wording"
        # The editing user rides along so coord tags the version row.
        assert sent["updated_by"] == TEST_USER_EMAIL

    def test_body_supplied_updated_by_is_overridden(self, auth_client: TestClient):
        """The audit trail must record the authenticated editor — a browser
        claiming someone else's name is ignored, not honoured."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(json_data=_doc())
            _configure_mock_client(MockClient, instance)

            auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "x", "updated_by": "somebody-else@evil.example"},
            )

        assert instance.patch.call_args.kwargs["json"]["updated_by"] == TEST_USER_EMAIL

    def test_identity_falls_back_to_user_id_without_email(self):
        client = TestClient(_build_test_app(user_email=None))
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(json_data=_doc())
            _configure_mock_client(MockClient, instance)

            client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "x"},
            )

        assert (
            instance.patch.call_args.kwargs["json"]["updated_by"]
            == f"user:{TEST_USER_ID}"
        )

    def test_attrs_only_patch_forwarded_with_identity(self, auth_client: TestClient):
        """An attrs-only edit (the category default-tier editor's payload) is a
        legal PATCH: the proxy is an untyped passthrough, so ``attrs`` reaches
        coord verbatim with ``updated_by`` stamped — never rejected locally for
        lacking ``description``/``body``."""
        attrs = {"default_tier": "ask-first"}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(json_data=_doc(attrs=attrs))
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"attrs": attrs},
            )

        assert resp.status_code == 200
        assert resp.json()["attrs"] == attrs
        sent = instance.patch.call_args.kwargs["json"]
        assert sent["attrs"] == attrs
        assert sent["updated_by"] == TEST_USER_EMAIL
        # attrs-only means exactly that — the proxy invents no content fields.
        assert "description" not in sent
        assert "body" not in sent

    def test_coord_400_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(
                status_code=400, text='{"error":"body must be non-empty"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "  "},
            )

        assert resp.status_code == 400
        assert "body must be non-empty" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------


class TestPromptDocumentVersions:
    def test_lists_versions(self, auth_client: TestClient):
        coord_payload = {
            "document_id": "11111111-1111-1111-1111-111111111111",
            "kind": "policy",
            "name": "engineering-priorities",
            "current_version": 2,
            "versions": [
                {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "version_number": 2,
                    "description": "sharpen wording",
                    "edited_by": TEST_USER_EMAIL,
                    "created_at": "2026-07-17T00:00:00Z",
                },
            ],
            "total": 1,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/"
                "engineering-priorities/versions"
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities/versions"
        )

    def test_gets_one_version_snapshot(self, auth_client: TestClient):
        snapshot = {
            "id": "22222222-2222-2222-2222-222222222222",
            "document_id": "11111111-1111-1111-1111-111111111111",
            "version_number": 1,
            "body": "the original prose",
            "description": None,
            "edited_by": "system",
            "created_at": "2026-07-16T00:00:00Z",
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=snapshot)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/"
                "engineering-priorities/versions/1"
            )

        assert resp.status_code == 200
        assert resp.json()["body"] == "the original prose"
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities/versions/1"
        )

    def test_non_integer_version_is_422(self, auth_client: TestClient):
        """The version path segment is typed ``int`` — a junk segment is
        rejected at the web edge rather than proxied to coord."""
        resp = auth_client.get(
            f"{API_PREFIX}/coord/prompt-documents/policy/"
            "engineering-priorities/versions/latest"
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /operations/coord/prompt-documents/{kind}/{name}/restore-default
# ---------------------------------------------------------------------------


class TestRestorePromptDocumentDefault:
    def test_proxies_restore(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data=_doc(body="the shipped default", current_version=5)
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/"
                "engineering-priorities/restore-default"
            )

        assert resp.status_code == 200
        assert resp.json()["body"] == "the shipped default"
        assert instance.post.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities/restore-default"
        )
        # Coord derives the default from the row's own default_source.
        assert instance.post.call_args.kwargs["json"] == {}

    def test_no_default_4xx_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=404, text='{"error":"prompt document not found"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/nope/restore-default"
            )

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /operations/coord/prompt-document-kind-tiers  (the PER-KIND authorship tier)
# ---------------------------------------------------------------------------
#
# The sibling lever to the per-document tier on the PATCH above, and the only
# one that can be expressed for a document that does not exist yet. What has to
# hold at this layer:
#
# * the SIBLING path reaches coord verbatim — a nested `/prompt-documents/...`
#   spelling would address a document called `kind-tiers`;
# * only `tier` is forwarded on the PUT, because coord stamps `updated_by` from
#   its own OperatorContext on this route and a forwarded client claim would be
#   another client-asserted-provenance site;
# * coord's 409 FLOOR refusal and its 503 store-unprovisioned answer pass
#   through rather than becoming a 500 or, worse, an empty list.


class TestPromptDocumentKindTiers:
    def test_list_reaches_coord_on_the_sibling_path(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={
                    "kinds": [
                        {
                            "kind": "audience_profile",
                            "tier": "allow",
                            "unreadable": False,
                            "builtin_default_tier": "allow_with_notification",
                            # The SERVER-DERIVED answer. Present in the fixture
                            # because the console renders THIS rather than
                            # re-deriving from the fields above, so a proxy
                            # that dropped it would strip the field the badge
                            # depends on.
                            "effective_tier": "allow",
                            "effective_source": "kind",
                        }
                    ],
                    "vocabulary": ["deny", "allow", "allow_with_notification"],
                    "notification_enforced": False,
                    "warning": "behaves EXACTLY as `allow`",
                }
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-document-kind-tiers")

        assert resp.status_code == 200
        # The disclosure must survive the proxy — the console renders coord's
        # own words, so dropping it here would silently remove the only notice
        # that `allow_with_notification` does not yet do what its name says.
        assert resp.json()["notification_enforced"] is False
        assert "allow" in resp.json()["warning"]
        assert resp.json()["kinds"][0]["effective_tier"] == "allow"
        assert resp.json()["kinds"][0]["effective_source"] == "kind"
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-document-kind-tiers"
        )

    def test_put_forwards_only_the_tier(self, auth_client: TestClient):
        """`updated_by` is coord's to stamp. A forwarded client claim would add
        another client-asserted-provenance site of the kind plan
        `2026-07-27-prompt-document-writes-operator-gated` exists to remove."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.put.return_value = _mock_response(
                json_data={
                    "kind": "audience_profile",
                    "tier": "allow_with_notification",
                    "updated_by": "operator:...",
                    "notification_enforced": False,
                    "warning": "behaves EXACTLY as `allow`",
                }
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.put(
                f"{API_PREFIX}/coord/prompt-document-kind-tiers/audience_profile",
                json={
                    "tier": "allow_with_notification",
                    "updated_by": "somebody-else@evil.example",
                },
            )

        assert resp.status_code == 200
        sent = instance.put.call_args.kwargs["json"]
        assert sent == {"tier": "allow_with_notification"}
        assert instance.put.call_args.args[0].endswith(
            "/coord/prompt-document-kind-tiers/audience_profile"
        )

    def test_a_body_with_no_tier_forwards_no_tier_key(self, auth_client: TestClient):
        """`{"tier": None}` is the payload that carries no meaning — the DELETE
        docstring says so. Synthesising it from an absent key would make a
        typo'd key name reach coord as an explicit null instead of a missing
        field, and coord's 400 (which names the vocabulary) is the better
        answer."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.put.return_value = _mock_response(
                status_code=400, json_data={"error": "unknown tier"}
            )
            _configure_mock_client(MockClient, instance)

            auth_client.put(
                f"{API_PREFIX}/coord/prompt-document-kind-tiers/domain_spec",
                json={"teir": "allow"},
            )

        assert instance.put.call_args.kwargs["json"] == {}

    def test_a_kind_carrying_a_slash_is_escaped_not_reshaped(self):
        """`quote(kind, safe='')` is the whole reason that call is there. Every
        other test here passes a kind for which it is a no-op, so without this
        one a proxy that dropped the escaping would look identical — while a
        kind carrying `/` silently addressed a DIFFERENT coord path.

        Driven by calling the endpoint directly rather than through
        ``TestClient``: the client normalises ``%2F`` back to ``/`` before
        routing, so the request never reaches the handler and the test would
        pass vacuously on a 404. FastAPI hands the handler the DECODED value,
        which is exactly the input this asserts about.
        """
        import asyncio

        from app.api.v1.endpoints.operations import (
            clear_prompt_document_kind_tier,
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.delete.return_value = _mock_response(
                json_data={"kind": "a/b", "tier": None, "removed": 0}
            )
            _configure_mock_client(MockClient, instance)

            asyncio.run(
                clear_prompt_document_kind_tier(kind="a/b", tenant_id=TEST_TENANT_ID)
            )

        sent = instance.delete.call_args.args[0]
        assert sent.endswith("/coord/prompt-document-kind-tiers/a%2Fb"), sent

    def test_floor_conflict_passes_through(self, auth_client: TestClient):
        """`claude_settings` is an unliftable floor and coord refuses rather
        than storing. A 500 here would read as a transient fault and invite a
        retry that can never succeed."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.put.return_value = _mock_response(
                status_code=409,
                json_data={"error": "`claude_settings` is an unliftable FLOOR"},
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.put(
                f"{API_PREFIX}/coord/prompt-document-kind-tiers/claude_settings",
                json={"tier": "allow"},
            )

        assert resp.status_code == 409
        assert "FLOOR" in str(resp.json())

    def test_store_unprovisioned_503_passes_through(self, auth_client: TestClient):
        """UNKNOWN, never an empty list. An empty list reads as "no kind has a
        setting", which is a claim about the operator's configuration nothing
        has evidence for."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=503,
                json_data={"error": "not provisioned", "degraded": "absent"},
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-document-kind-tiers")

        assert resp.status_code == 503

    def test_delete_clears_the_kind(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.delete.return_value = _mock_response(
                json_data={"kind": "domain_spec", "tier": None, "removed": 1}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.delete(
                f"{API_PREFIX}/coord/prompt-document-kind-tiers/domain_spec"
            )

        assert resp.status_code == 200
        assert resp.json()["removed"] == 1
        assert instance.delete.call_args.args[0].endswith(
            "/coord/prompt-document-kind-tiers/domain_spec"
        )
