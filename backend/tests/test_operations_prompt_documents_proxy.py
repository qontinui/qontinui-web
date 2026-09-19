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

    def test_publish_mode_passes_through_untouched(self, auth_client: TestClient):
        """``publish_mode`` needs no proxy code — the forward is wholesale — so
        what is pinned here is that nothing SHADOWS it.

        Plan ``2026-09-19-policy-publish-all-and-auto-publish`` D2. The field is
        the per-document distribution judgement: whether a document publishes
        itself to every tenant with no human in the loop. A future allowlist on
        this proxy would drop it silently, and the console would report a
        successful save for a setting coord never received — the operator would
        believe they had set ``never`` on a document that kept auto-publishing.
        The version-creating side is coord's rule, not a second copy here.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(
                json_data=_doc(current_version=4)
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={
                    "publish_mode": "never",
                    "change_description": "Publish mode set to `never` by an operator",
                },
            )

        assert resp.status_code == 200
        sent = instance.patch.call_args.kwargs["json"]
        assert sent["publish_mode"] == "never"
        assert sent["updated_by"] == TEST_USER_EMAIL
        # A mode-only PATCH means exactly that: no body is invented, so coord's
        # version snapshot carries the unchanged body beside the new mode.
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


# ---------------------------------------------------------------------------
# The MODIFIED-tenant decisions (plan 2026-09-04-cross-tenant-policy-publishing
# D4 + Phase 7): upstream-adopt, upstream-keep, upstream-merge (GET + POST)
# ---------------------------------------------------------------------------
#
# What has to hold at this layer, and why:
#
# * each path reaches coord as the SAME segment under the document address —
#   these are per-document decisions, not sibling collections;
# * the body is forwarded VERBATIM: `publication_version`, `expected_version`
#   and the merge's per-clause `resolutions` are the operator's, and this proxy
#   adds none (coord stamps the actor from its own OperatorContext);
# * coord's typed 409s (`document_moved`, `unresolved_conflicts`,
#   `already_reviewed`) and its 503 `schema_migration_pending` pass through
#   rather than becoming a 500 — the dialog branches on the code.


class TestUpstreamDecisions:
    def test_adopt_forwards_the_reviewed_publication(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={
                    "adopted": True,
                    "from_version": 3,
                    "to_version": 4,
                    "publication_version": 9,
                }
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/coordination/upstream-adopt",
                json={"publication_version": 9, "expected_version": 3},
            )

        assert resp.status_code == 200
        assert resp.json()["to_version"] == 4
        assert instance.post.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/coordination/upstream-adopt"
        )
        assert instance.post.call_args.kwargs["json"] == {
            "publication_version": 9,
            "expected_version": 3,
        }

    def test_keep_forwards_verbatim_and_already_reviewed_passes_through(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=409,
                text='{"error":"already_reviewed","tracked_publication_version":9}',
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/coordination/upstream-keep",
                json={"publication_version": 9},
            )

        assert resp.status_code == 409
        assert "already_reviewed" in str(resp.json())
        assert instance.post.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/coordination/upstream-keep"
        )
        assert instance.post.call_args.kwargs["json"] == {"publication_version": 9}

    def test_merge_preview_forwards_the_version_filter(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"mode": "clauses", "entries": [], "conflicts": []}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/coordination/upstream-merge"
                "?publication_version=9"
            )

        assert resp.status_code == 200
        assert resp.json()["mode"] == "clauses"
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/coordination/upstream-merge"
        )
        assert instance.get.call_args.kwargs["params"] == {"publication_version": 9}

    def test_merge_preview_without_a_version_sends_no_params(
        self, auth_client: TestClient
    ):
        """Absent means "the latest" on coord's side; sending an empty filter
        would be a different request shape for the same question."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"mode": "whole_body", "fallback": {"reason": "x"}}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/coordination/upstream-merge"
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] is None

    def test_merge_apply_forwards_resolutions_and_unresolved_passes_through(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=409,
                text='{"error":"unresolved_conflicts","unresolved":["scope"]}',
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/coordination/upstream-merge",
                json={
                    "publication_version": 9,
                    "expected_version": 3,
                    "resolutions": {"tempo": "upstream"},
                },
            )

        assert resp.status_code == 409
        assert "unresolved_conflicts" in str(resp.json())
        assert instance.post.call_args.kwargs["json"] == {
            "publication_version": 9,
            "expected_version": 3,
            "resolutions": {"tempo": "upstream"},
        }

    def test_schema_pending_503_passes_through(self, auth_client: TestClient):
        """A decision coord cannot record must not look like one it took."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=503, text='{"error":"schema_migration_pending"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/coordination/upstream-adopt",
                json={"publication_version": 9},
            )

        assert resp.status_code == 503


class TestUpstreamDecisionsAuthSplit:
    """The fixture above overrides BOTH tenant dependencies with the same
    lambda, so the tests in ``TestUpstreamDecisions`` cannot tell a write route
    that slipped onto the membership dependency from one on the admin gate.
    This one can: the admin dependency is made to refuse, and every write must
    refuse with it while the read still answers."""

    @staticmethod
    def _app_with_admin_refused() -> FastAPI:
        from fastapi import HTTPException

        from app.api.v1.endpoints.operations import require_coord_tenant_admin

        app = _build_test_app()

        def refuse() -> None:
            raise HTTPException(status_code=403, detail="not a tenant admin")

        app.dependency_overrides[require_coord_tenant_admin] = refuse
        return app

    def test_every_decision_write_needs_admin_and_the_preview_does_not(self):
        client = TestClient(self._app_with_admin_refused())
        base = f"{API_PREFIX}/coord/prompt-documents/policy/coordination"
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data={"mode": "clauses"})
            instance.post.return_value = _mock_response(json_data={"merged": True})
            _configure_mock_client(MockClient, instance)

            for tail in ("upstream-adopt", "upstream-keep", "upstream-merge"):
                resp = client.post(f"{base}/{tail}", json={"publication_version": 1})
                assert resp.status_code == 403, tail
            assert instance.post.call_count == 0

            resp = client.get(f"{base}/upstream-merge")

        assert resp.status_code == 200
        assert instance.get.call_count == 1


# ---------------------------------------------------------------------------
# Publish-all + the auto-publish status read
# ---------------------------------------------------------------------------
#
# Plan ``2026-09-19-policy-publish-all-and-auto-publish`` D1/D4, Phase 5. What
# has to hold at this layer, and how each would fail silently:
#
# * **The literal paths are not swallowed by the ``{kind}/{name}`` routes.**
#   ``publish-all`` is one segment and ``auto-publish/status`` is two, so the
#   parameterised siblings would match both first if they were registered
#   earlier. The failure is a coord 400/404 — indistinguishable, from the
#   browser, from "this deployment does not carry the route", which the console
#   latches by HIDING the publish controls for the rest of the visit.
# * **The body is allowlisted two levels deep.** ``published_by`` is coord's to
#   stamp from its own OperatorContext; an item-level smuggle would ride
#   through a wholesale ``{**body}`` forward unseen.
# * **``expected_version`` reaches coord verbatim, per item.** It is the whole
#   optimistic-lock guarantee: a document edited between the dry run and the
#   click must fail ``version_conflict`` rather than publish an unseen body.
# * **``dry_run`` is coord's default, not a second copy of it here.** Omitted
#   means omitted; a local ``dry_run = True`` fallback would be a second place
#   for the safe default to drift out of step.


class TestPublishAllPromptDocuments:
    def test_dry_run_body_is_optional_and_reaches_the_literal_path(
        self, auth_client: TestClient
    ):
        """No body at all is the dry run — coord defaults it, so the proxy
        forwards nothing rather than asserting a default of its own."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={
                    "dry_run": True,
                    "candidates": [
                        {
                            "kind": "policy",
                            "name": "plan-discipline",
                            "current_version": 7,
                            "next_publication_version": 1,
                            "lint": [],
                            "direction": "loosening",
                            "publish_mode": "manual",
                            "edited_by": "agent:runner",
                            "change_notes": ["retired the same-actor rule"],
                        }
                    ],
                }
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(f"{API_PREFIX}/coord/prompt-documents/publish-all")

        assert resp.status_code == 200
        assert resp.json()["candidates"][0]["name"] == "plan-discipline"
        # The literal path, NOT `/coord/prompt-documents/{kind}` reached as a
        # document creation under kind="publish-all".
        assert instance.post.call_args.args[0].endswith(
            "/coord/prompt-documents/publish-all"
        )
        assert instance.post.call_args.kwargs["json"] == {}

    def test_armed_run_forwards_each_items_expected_version(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={
                    "dry_run": False,
                    "results": [
                        {
                            "kind": "policy",
                            "name": "plan-discipline",
                            "outcome": "published",
                            "publication_version": 1,
                        },
                        {
                            "kind": "policy",
                            "name": "ux-priorities",
                            "outcome": "version_conflict",
                            "expected": 4,
                            "actual": 5,
                        },
                    ],
                }
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/publish-all",
                json={
                    "dry_run": False,
                    "release_note": "the September corpus",
                    "items": [
                        {
                            "kind": "policy",
                            "name": "plan-discipline",
                            "expected_version": 7,
                        },
                        {
                            "kind": "policy",
                            "name": "ux-priorities",
                            "expected_version": 4,
                        },
                    ],
                },
            )

        assert resp.status_code == 200
        assert resp.json()["results"][1]["outcome"] == "version_conflict"
        sent = instance.post.call_args.kwargs["json"]
        assert sent["dry_run"] is False
        assert sent["release_note"] == "the September corpus"
        assert sent["items"] == [
            {"kind": "policy", "name": "plan-discipline", "expected_version": 7},
            {"kind": "policy", "name": "ux-priorities", "expected_version": 4},
        ]

    def test_publisher_identity_is_never_taken_from_the_browser(
        self, auth_client: TestClient
    ):
        """Coord stamps ``published_by`` from its own OperatorContext. A claim
        at either level of the body is dropped, not forwarded — the item level
        matters most, because a wholesale forward would carry it through under
        a key nothing here inspects."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={"dry_run": False, "results": []}
            )
            _configure_mock_client(MockClient, instance)

            auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/publish-all",
                json={
                    "dry_run": False,
                    "published_by": "somebody-else@evil.example",
                    "tenant_id": "00000000-0000-0000-0000-000000000000",
                    "items": [
                        {
                            "kind": "policy",
                            "name": "plan-discipline",
                            "expected_version": 7,
                            "published_by": "somebody-else@evil.example",
                            "body": "a body coord never asked for",
                        }
                    ],
                },
            )

        sent = instance.post.call_args.kwargs["json"]
        assert "published_by" not in sent
        assert "tenant_id" not in sent
        assert sent["items"] == [
            {"kind": "policy", "name": "plan-discipline", "expected_version": 7}
        ]

    def test_not_system_tenant_refusal_passes_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=403, text='{"error":"not_system_tenant"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/publish-all",
                json={"dry_run": True},
            )

        assert resp.status_code == 403
        assert "not_system_tenant" in resp.json()["detail"]


class TestPromptDocumentAutoPublishStatus:
    def test_status_read_reaches_the_literal_path(self, auth_client: TestClient):
        """Two segments, so ``GET /coord/prompt-documents/{kind}/{name}`` would
        match it as ``kind="auto-publish"``/``name="status"`` if registration
        order were wrong."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={
                    "candidates": [
                        {
                            "kind": "policy",
                            "name": "plan-discipline",
                            "publish_mode": "auto",
                            "direction": "loosening",
                            "settles_at": "2026-09-21T09:00:00Z",
                            "held": False,
                            "held_tokens": [],
                            "versions": [6, 7],
                        },
                        {
                            "kind": "policy",
                            "name": "git-operations",
                            "publish_mode": "auto",
                            "direction": "other",
                            "settles_at": "2026-09-20T15:00:00Z",
                            "held": True,
                            "held_tokens": [
                                {"category": "repo_name", "token": "qontinui-coord"}
                            ],
                            "versions": [3],
                        },
                    ]
                }
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/auto-publish/status"
            )

        assert resp.status_code == 200
        assert resp.json()["candidates"][1]["held"] is True
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/auto-publish/status"
        )

    def test_store_unprovisioned_passes_through(self, auth_client: TestClient):
        """The deploy window where coord is live ahead of ``pdpub_03``: honest
        degradation, not an empty candidate list the console would render as
        'nothing is pending'."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=503,
                json_data={"error": "not provisioned", "degraded": "absent"},
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/auto-publish/status"
            )

        assert resp.status_code == 503
