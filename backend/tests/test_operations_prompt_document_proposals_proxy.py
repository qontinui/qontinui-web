"""Integration tests for the policy-edit proposal + landed-write proxy endpoints.

Plan ``2026-07-28-migrate-claude-md-into-qontinui.md`` Phase 5. These endpoints
(under ``/api/v1/operations/coord/prompt-document-proposals`` and
``…/coord/prompt-document-writes``) back the ``/admin/coord/prompt-document-proposals``
operator review feed.

Mirrors ``test_operations_prompt_documents_proxy.py``: a minimal FastAPI app +
a mocked ``httpx.AsyncClient``, so no live coord is needed.

The behaviours that matter here, and why:

* ``decided_by`` is stamped from the SESSION and the client body is reduced to
  ``decision_note`` alone — a browser must not be able to choose who a decision
  is attributed to, nor smuggle ``status``/``tenant_id`` past the proxy;
* the LIST route degrades to an explicit ``unavailable`` note while coord's
  Phase 5 half is undeployed (its route 404s), because an unreadable queue
  rendered as an empty one is the exact failure the review feed exists to
  prevent;
* approve/reject deliberately do NOT degrade — a decision that silently no-ops
  is worse than an error;
* the landed-write feed aggregates the EXISTING per-document versions route,
  orders newest-first across documents, and reports partial results rather than
  failing wholesale when one document's history is unreadable;
* that feed carries coord's two OPTIONAL per-write annotations — ``loosening``
  and ``notification_ref`` (plan
  ``2026-08-27-tenant-level-agent-authorable-stores.md``) — through per ROW, and
  keeps **absent distinct from ``false``**. ``false`` is a verdict — the
  classifier ran and found no widening — and it is what the shipped page counts
  to say "coord classified these writes and none was a loosening"; absent means
  no verdict exists, whatever the cause. A key coord did not send is therefore
  omitted rather than defaulted, since a defaulted ``false`` would invent that
  verdict on every historical write at once.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
TEST_USER_ID = uuid4()
TEST_USER_EMAIL = "operator@example.com"

API_PREFIX = "/api/v1/operations"
PROPOSALS = f"{API_PREFIX}/coord/prompt-document-proposals"
WRITES = f"{API_PREFIX}/coord/prompt-document-writes"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = TEST_USER_ID
    mock_user.email = TEST_USER_EMAIL
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


def _proposal(**overrides):
    row = {
        "id": "22222222-2222-2222-2222-222222222222",
        "doc_kind": "policy",
        "doc_name": "production-and-cost",
        "clause_id": "agent-spawn-authorization",
        "proposed_content": "Agents may spawn fan-outs without asking.",
        "direction": "loosening",
        "from_tier": "ask-first",
        "to_tier": "proceed",
        "rationale": "The ask-first round trip dominates wall-clock.",
        "proposed_by": "agent:merge-shepherd",
        "base_version": 4,
        "status": "pending",
        "created_at": "2026-07-28T10:00:00Z",
    }
    row.update(overrides)
    return row


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-document-proposals
# ---------------------------------------------------------------------------


class TestListProposals:
    def test_returns_proposals_and_forwards_status_filter(
        self, auth_client: TestClient
    ):
        coord_payload = {"proposals": [_proposal()], "total": 1}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{PROPOSALS}?status=approved")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-document-proposals"
        )
        assert instance.get.call_args.kwargs["params"] == {"status": "approved"}

    def test_defaults_to_pending(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"proposals": [], "total": 0}
            )
            _configure_mock_client(MockClient, instance)

            auth_client.get(PROPOSALS)

        assert instance.get.call_args.kwargs["params"] == {"status": "pending"}

    def test_coord_404_degrades_to_unavailable_not_empty_queue(
        self, auth_client: TestClient
    ):
        """Before coord's Phase 5 deploy the route 404s. The page must be able to
        say "cannot see" rather than "nothing pending"."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(404, text="not found")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(PROPOSALS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["proposals"] == []
        assert "unavailable" in body and body["unavailable"]

    def test_coord_unreachable_degrades(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("no route")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(PROPOSALS)

        assert resp.status_code == 200
        assert "unavailable" in resp.json()

    def test_coord_400_still_surfaces(self, auth_client: TestClient):
        """Only absence degrades. A real coord rejection stays an error."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(400, text="unknown status")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{PROPOSALS}?status=bogus")

        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST …/{id}/approve  |  …/{id}/reject
# ---------------------------------------------------------------------------


class TestDecideProposal:
    @pytest.mark.parametrize("action", ["approve", "reject"])
    def test_decided_by_is_session_identity_and_body_is_reduced(
        self, auth_client: TestClient, action: str
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={"current_version": 5}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{PROPOSALS}/{_proposal()['id']}/{action}",
                json={
                    "decision_note": "Agreed after review.",
                    # Everything below is a forgery attempt and must be dropped.
                    "decided_by": "someone-else@example.com",
                    "status": "approved",
                    "tenant_id": str(uuid4()),
                },
            )

        assert resp.status_code == 200
        forwarded = instance.post.call_args.kwargs["json"]
        assert forwarded == {
            "decision_note": "Agreed after review.",
            "decided_by": TEST_USER_EMAIL,
        }
        assert instance.post.call_args.args[0].endswith(f"/{action}")

    def test_missing_body_is_allowed(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data={})
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(f"{PROPOSALS}/{_proposal()['id']}/reject")

        assert resp.status_code == 200
        assert instance.post.call_args.kwargs["json"] == {
            "decision_note": None,
            "decided_by": TEST_USER_EMAIL,
        }

    def test_coord_404_does_not_degrade(self, auth_client: TestClient):
        """A decision that silently no-ops would be worse than an error."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(404, text="no such proposal")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(f"{PROPOSALS}/{_proposal()['id']}/approve")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-document-writes
# ---------------------------------------------------------------------------


def _versions_payload(current_version: int, versions: list[dict]) -> dict:
    return {"current_version": current_version, "versions": versions}


class TestListWrites:
    def test_merges_and_orders_newest_first(self, auth_client: TestClient):
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                },
                {
                    "kind": "policy",
                    "name": "beta",
                    "description": None,
                    "updated_at": "2026-07-27T12:00:00Z",
                },
            ],
            "total": 2,
        }
        alpha = _versions_payload(
            2,
            [
                {
                    "version_number": 2,
                    "description": "agent append",
                    "edited_by": "agent:x",
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )
        beta = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": "operator@example.com",
                    "created_at": "2026-07-29T12:00:00Z",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=alpha),
                _mock_response(json_data=beta),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert [w["name"] for w in body["writes"]] == ["beta", "alpha"]
        # Label falls back to the slug when the document has no description.
        assert body["writes"][0]["label"] == "beta"
        assert body["writes"][1]["label"] == "Alpha"
        assert body["writes"][1]["current_version"] == 2
        assert "partial" not in body

    def test_one_bad_document_reports_partial_rather_than_failing(
        self, auth_client: TestClient
    ):
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                },
                {
                    "kind": "policy",
                    "name": "beta",
                    "description": "Beta",
                    "updated_at": "2026-07-27T12:00:00Z",
                },
            ],
            "total": 2,
        }
        ok = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=ok),
                _mock_response(500, text="boom"),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["writes"]) == 1
        assert "partial" in body

    def test_ceiling_is_reported_not_applied_silently(self, auth_client: TestClient):
        """Crossing the fan-out ceiling drops documents, so it must be SAID.

        The tempting "newest ``updated_at`` first, then cap" shortcut is unsound
        — coord's attrs-only PATCH bumps ``updated_at`` without inserting a
        version — so a dropped document really can own a newer write. The one
        thing that must never happen is dropping it quietly.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": f"doc-{i}",
                    "description": None,
                    "updated_at": f"2026-07-2{i}T12:00:00Z",
                }
                for i in range(2)
            ],
            "total": 2,
        }
        one = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )

        with (
            patch(
                "app.api.v1.endpoints.operations._WRITE_FEED_DOCUMENT_CEILING",
                1,
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=one),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["writes"]) == 1
        assert "truncated" in body and "1 document " in body["truncated"]

    def test_unexpected_exception_degrades_one_document_not_the_feed(
        self, auth_client: TestClient
    ):
        """Totality: the fan-out must survive an exception it did not anticipate.

        ``httpx.InvalidURL`` and ``httpx.StreamError`` are NOT ``HTTPError``
        subclasses, so a narrow ``except`` would let them blank the whole feed —
        contradicting the route's own "one bad document cannot blank the page"
        contract.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                },
                {
                    "kind": "policy",
                    "name": "beta",
                    "description": "Beta",
                    "updated_at": "2026-07-27T12:00:00Z",
                },
            ],
            "total": 2,
        }
        ok = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=ok),
                RuntimeError("something nobody predicted"),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["writes"]) == 1
        assert "partial" in body

    def test_deadline_keeps_the_documents_that_did_answer(
        self, auth_client: TestClient
    ):
        """A slow document must not discard its fast siblings' results.

        Wrapping the gather in ``asyncio.timeout`` would cancel the whole
        fan-out and blank the feed; ``asyncio.wait`` keeps what arrived and
        cancels only the stragglers.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "fast",
                    "description": "Fast",
                    "updated_at": "2026-07-28T12:00:00Z",
                },
                {
                    "kind": "policy",
                    "name": "slow",
                    "description": "Slow",
                    "updated_at": "2026-07-27T12:00:00Z",
                },
            ],
            "total": 2,
        }
        fast = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )

        async def _responses(*args, **kwargs):
            url = args[0] if args else ""
            if url.endswith("/coord/prompt-documents"):
                return _mock_response(json_data=documents)
            if "/fast/" in url:
                return _mock_response(json_data=fast)
            await asyncio.sleep(30)  # never answers within the deadline
            return _mock_response(json_data={})

        with (
            patch(
                "app.api.v1.endpoints.operations._WRITE_FEED_DEADLINE_SECONDS",
                0.2,
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.get.side_effect = _responses
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        # The fast document's write survived the slow one's cancellation.
        assert [w["name"] for w in body["writes"]] == ["fast"]
        assert "partial" in body

    def test_limit_slice_is_reported(self, auth_client: TestClient):
        """The ``limit`` slice drops writes, so it must say so.

        Otherwise it is indistinguishable, from the operator's seat, from the
        ceiling case that does get a banner.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                }
            ],
            "total": 1,
        }
        alpha = _versions_payload(
            2,
            [
                {
                    "version_number": 2,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                },
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-27T12:00:00Z",
                },
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=alpha),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{WRITES}?limit=1")

        body = resp.json()
        assert len(body["writes"]) == 1
        assert "limited" in body and "of 2" in body["limited"]

    def test_no_documents_returns_an_empty_feed_not_a_500(
        self, auth_client: TestClient
    ):
        """Zero documents is ORDINARY, and must not crash the fan-out.

        ``asyncio.wait`` raises ``ValueError`` on an empty set, so the empty
        case needs an explicit early return. It is reachable on a fresh tenant
        AND on coord's store-unprovisioned answer — the very case ``degraded``
        exists to report, which would otherwise 500 instead of rendering its
        caveat and take the whole write feed down with it.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={
                    "documents": [],
                    "total": 0,
                    "degraded": "coord.prompt_documents is not provisioned",
                }
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert body["writes"] == []
        assert body["total"] == 0
        # The degraded caveat still reaches the page.
        assert body["degraded"] == "coord.prompt_documents is not provisioned"
        # Nothing failed, so no failure caveats are invented.
        assert "partial" not in body
        assert "truncated" not in body

    def test_malformed_document_list_returns_an_empty_feed(
        self, auth_client: TestClient
    ):
        """A non-list ``documents`` also lands on the empty path — same guard."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"documents": "not a list"}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        assert resp.json()["writes"] == []

    def test_document_list_404_degrades(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(404, text="not found")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert body["writes"] == []
        assert "unavailable" in body

    def test_annotations_are_carried_through_when_coord_sends_them(
        self, auth_client: TestClient
    ):
        """``loosening`` and ``notification_ref`` reach the page verbatim.

        Both are OPTIONAL coord-side additions (plan
        ``2026-08-27-tenant-level-agent-authorable-stores.md``, Phases 2-4). The
        write dict used to be a fixed literal that simply had no slot for them,
        so coord could serve them and the shipped frontend would still render
        dark forever.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "operating-rules",
                    "description": "Operating rules",
                    "updated_at": "2026-08-29T12:00:00Z",
                }
            ],
            "total": 1,
        }
        versions = _versions_payload(
            6,
            [
                {
                    "version_number": 6,
                    "description": "agent-authorship-is-the-default",
                    "edited_by": "device:c79a07d5-7e40-49b4-87fa-554c749f9644",
                    "created_at": "2026-08-29T12:00:00Z",
                    "loosening": True,
                    "notification_ref": "e510cf9d-1c79-4667-b206-b00b90fde90f",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=versions),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        write = resp.json()["writes"][0]
        assert write["loosening"] is True
        assert write["notification_ref"] == "e510cf9d-1c79-4667-b206-b00b90fde90f"

    def test_loosening_false_is_passed_through_not_dropped(
        self, auth_client: TestClient
    ):
        """``false`` is a VERDICT and must survive as one.

        It is the whole basis of the frontend's ``looseningClassificationPresent``
        (``_lib/writes.ts``), which distinguishes "coord classified these writes
        and none was a loosening" from "coord never classified them". A
        passthrough that only forwarded truthy values would collapse the first
        case into the second and the surface could never say "nothing on this
        page is flagged".
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-08-29T12:00:00Z",
                }
            ],
            "total": 1,
        }
        versions = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": "agent:x",
                    "created_at": "2026-08-29T12:00:00Z",
                    "loosening": False,
                    "notification_ref": None,
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=versions),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        write = resp.json()["writes"][0]
        assert "loosening" in write, "a served `false` must not be dropped"
        assert write["loosening"] is False
        # A served value is forwarded verbatim whatever it is — the proxy does
        # not re-encode coord's vocabulary. `null` is not a state coord actually
        # emits (the field is `Option<bool>` / `Option<Uuid>` with
        # `skip_serializing_if = "Option::is_none"`, so it sends the key or
        # nothing), and no consumer tells it from absent; this pins the
        # passthrough branch, not a fourth meaning.
        assert "notification_ref" in write
        assert write["notification_ref"] is None

    def test_absent_annotations_stay_absent_never_null_and_never_false(
        self, auth_client: TestClient
    ):
        """An older coord build omits both keys, and so must this feed.

        Emitting ``false`` would invent a verdict the classifier never gave, on
        every write that predates it. Emitting ``null`` would not mislead any
        consumer — nothing distinguishes it from absent — but it would put a key
        in the response that coord never sent, which is the shape a later
        default gets attached to. The frontend's optional types
        (``loosening?: boolean | null``) exist so the page can tell a real
        verdict from the absence of one; this test pins the absence.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-08-29T12:00:00Z",
                }
            ],
            "total": 1,
        }
        versions = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": "agent:x",
                    "created_at": "2026-08-29T12:00:00Z",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=versions),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        write = resp.json()["writes"][0]
        assert "loosening" not in write
        assert "notification_ref" not in write
        # The rest of the row is unaffected — an absent annotation is ORDINARY,
        # not a read failure, so it must not push the document into `partial`.
        assert write["version_number"] == 1
        assert "partial" not in resp.json()

    def test_mixed_feed_keeps_each_rows_own_annotation_state(
        self, auth_client: TestClient
    ):
        """Per-ROW, not per-response: the two states coexist in one feed.

        Reachable in the ordinary case — versions written before the coord
        classifier deployed sit in the same document's history as ones written
        after it — so a passthrough that decided once for the whole response
        (say, from the first row it saw) would mislabel the other half.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "classified",
                    "description": "Classified",
                    "updated_at": "2026-08-29T12:00:00Z",
                },
                {
                    "kind": "audience_profile",
                    "name": "unclassified",
                    "description": "Unclassified",
                    "updated_at": "2026-08-28T12:00:00Z",
                },
            ],
            "total": 2,
        }
        classified = _versions_payload(
            2,
            [
                {
                    "version_number": 2,
                    "description": None,
                    "edited_by": "agent:x",
                    "created_at": "2026-08-29T12:00:00Z",
                    "loosening": True,
                    "notification_ref": "11111111-1111-1111-1111-111111111111",
                },
                {
                    # Same document, older write, written before the classifier.
                    "version_number": 1,
                    "description": None,
                    "edited_by": "agent:x",
                    "created_at": "2026-08-27T12:00:00Z",
                },
            ],
        )
        unclassified = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": "operator:1:op@example.com",
                    "created_at": "2026-08-28T12:00:00Z",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=classified),
                _mock_response(json_data=unclassified),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        writes = {(w["name"], w["version_number"]): w for w in resp.json()["writes"]}
        assert len(writes) == 3
        flagged = writes[("classified", 2)]
        assert flagged["loosening"] is True
        assert flagged["notification_ref"] == "11111111-1111-1111-1111-111111111111"
        for key in (("classified", 1), ("unclassified", 1)):
            assert "loosening" not in writes[key]
            assert "notification_ref" not in writes[key]

    def test_wrong_typed_annotation_is_dropped_without_faking_a_failure(
        self, auth_client: TestClient
    ):
        """A coord-side type defect must not reach — or blank — the page.

        ``notificationHref`` calls ``.trim()`` on the ref, so a number would
        throw in the browser and take the feed down. Dropping it degrades to the
        absent case, which the surface already renders correctly. It is
        deliberately NOT counted in ``partial``: the document's history WAS
        returned, and reporting an unreadable document would misdescribe a feed
        that is otherwise complete.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-08-29T12:00:00Z",
                }
            ],
            "total": 1,
        }
        versions = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": "agent:x",
                    "created_at": "2026-08-29T12:00:00Z",
                    "loosening": "yes",
                    "notification_ref": 12345,
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=versions),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        body = resp.json()
        write = body["writes"][0]
        assert "loosening" not in write
        assert "notification_ref" not in write
        assert "partial" not in body

    def test_limit_truncates_after_ordering(self, auth_client: TestClient):
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                }
            ],
            "total": 1,
        }
        alpha = _versions_payload(
            3,
            [
                {
                    "version_number": 3,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                },
                {
                    "version_number": 2,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-27T12:00:00Z",
                },
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=alpha),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{WRITES}?limit=1")

        body = resp.json()
        assert len(body["writes"]) == 1
        assert body["writes"][0]["version_number"] == 3
        # `total` reports what was collected, not what was returned.
        assert body["total"] == 2
