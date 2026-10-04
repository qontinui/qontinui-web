"""The per-device worktree-cap proxy — its wire body and its refusals.

Amendment A3 / Phase 4 of plan
``2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate``. Three
routes under ``/api/v1/operations``:

* ``GET  /fleet/worktree-cap``        — which devices carry an operator cap
* ``POST /fleet/worktree-cap``        — set one device's cap
* ``POST /fleet/worktree-cap/clear``  — remove it

The properties under test are the ones that make the surface honest rather than
merely working, and each is a rule this proxy would otherwise be free to break
silently:

1. **The write body is CLOSED and assembled here.** Coord's request structs are
   ``#[serde(deny_unknown_fields)]``, so one extra key is a 422 for the whole
   write. The browser's dict is never forwarded verbatim, and ``set_by`` in
   particular can never reach the wire — coord stamps the author from its
   authenticated operator context, and an audit trail with a client-asserted
   author is not an audit trail.
2. **Zero is refused at this door, with the reason.** A cap of 0 refuses every
   allocation on that device INCLUDING the worktree an operator would need in
   order to set it back. Coord rejects it too; naming it here turns a 400
   carrying a Rust string into a typed 422 whose message says what a zero would
   DO.
3. **There is no upper bound, deliberately.** A no-build worktree costs disk
   rather than memory and coord's own disk gate carries that, so a ceiling
   invented at this hop would be a second policy nobody decided.
4. **Coord's status codes and typed refusals survive the hop.**
   ``admin_required``, ``device_not_in_tenant`` and ``schema_pending`` are three
   different facts calling for three different next steps; collapsing them into
   "failed" leaves an operator unable to tell "you are not an admin" from "the
   migration has not been applied yet".
5. **A failed READ is never dressed up as an empty one.** Coord distinguishes
   "the read succeeded and nothing is capped" from "coord could not find out" in
   a ``state`` field, and this hop adds no default that would undo it — the
   browser renders UNKNOWN on a 404/5xx, which is only possible because the
   status arrives. For this feature the 404 window is GUARANTEED rather than
   hypothetical: the alembic revision lands first, this console second, coord
   third.

Same minimal-app + mocked-``httpx`` shape as
``test_operations_fleet_drain_proxy.py``; no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
READ_ROUTE = f"{API_PREFIX}/fleet/worktree-cap"
SET_ROUTE = f"{API_PREFIX}/fleet/worktree-cap"
CLEAR_ROUTE = f"{API_PREFIX}/fleet/worktree-cap/clear"

TEST_BEARER = "test-cognito-access-token"
DEVICE_ID = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: FastAPI runs a SYNC dependency in a
        # worker thread whose ContextVar writes never reach the request task,
        # and `_tenant_headers` reads the bearer back out of that ContextVar.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    # Setup, so every other test in this file reaches the proxy. The gate ITSELF
    # is pinned by `test_both_writes_are_admin_gated_before_any_coord_call`
    # below — not, as this comment used to claim, by
    # `test_operations_coord_dashboard_proxy.py`, which overrides the same
    # dependency with the same passing resolver and asserts nothing about it. On
    # that claim both writes could have been downgraded to `get_tenant_id` with
    # the whole suite still green.
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


# ---------------------------------------------------------------------------
# GET /fleet/worktree-cap
# ---------------------------------------------------------------------------


class TestReadWorktreeCap:
    def test_proxies_coords_read_route_untouched(self, auth_client: TestClient):
        body = {
            "state": "known",
            "count": 1,
            "overrides": [
                {
                    "device_id": DEVICE_ID,
                    "max_worktrees": 4,
                    "reason": "winding this box down",
                    "set_by": "jspinak@gmail.com",
                    "set_at": "2026-09-30T12:00:00Z",
                }
            ],
            "detail": None,
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=_mock_response(200, body))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        assert resp.status_code == 200
        called_url = mock_instance.get.call_args[0][0]
        assert called_url.endswith("/coord/fleet/worktree-cap")
        # Passed through untouched — no `response_model` filters a field a newer
        # coord adds, and the provenance is exactly what the console renders as
        # "capped at 4 by X, reason Y".
        row = resp.json()["overrides"][0]
        assert row["max_worktrees"] == 4
        assert row["set_by"] == "jspinak@gmail.com"
        assert row["reason"] == "winding this box down"

    def test_an_unknown_state_survives_the_hop(self, auth_client: TestClient):
        # The distinction the whole surface exists for. `overrides: null` — not
        # `[]` — is coord's deliberate choice so a consumer that ignores `state`
        # gets nothing rather than a silent "no device is capped". Nothing here
        # may normalise it to an empty list.
        body = {
            "state": "unknown",
            "count": None,
            "overrides": None,
            "detail": "coord could not read max_worktrees_by_device",
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=_mock_response(200, body))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        payload = resp.json()
        assert payload["state"] == "unknown"
        assert payload["overrides"] is None
        assert payload["count"] is None

    def test_a_404_from_coord_arrives_as_a_404(self, auth_client: TestClient):
        # The deploy window, which for this feature is GUARANTEED: the alembic
        # revision lands first, this console second, coord third. The STATUS is
        # what lets the browser render UNKNOWN instead of "nothing is capped",
        # so it must not be swallowed into a 200 with an empty body.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(404, None, text="not found")
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /fleet/worktree-cap
# ---------------------------------------------------------------------------


class TestSetWorktreeCap:
    def test_forwards_exactly_three_fields(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(
                    200,
                    {"device_id": DEVICE_ID, "max_worktrees": 40, "changed": True},
                )
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                SET_ROUTE,
                json={
                    "device_id": DEVICE_ID,
                    "max_worktrees": 40,
                    "reason": "  holding it here while the sweep runs  ",
                },
            )

        assert resp.status_code == 200
        sent = mock_instance.post.call_args.kwargs["json"]
        # EXACTLY these three. Coord's struct is `deny_unknown_fields`, so a
        # fourth key would 422 the whole write.
        assert set(sent) == {"device_id", "max_worktrees", "reason"}
        assert sent["max_worktrees"] == 40
        # Trimmed, so a reason of trailing whitespace cannot reach coord's
        # non-blank check as something it accepts and an operator cannot read.
        assert sent["reason"] == "holding it here while the sweep runs"

    def test_set_by_can_never_reach_the_wire(self, auth_client: TestClient):
        # `extra="forbid"`: the author comes from the authenticated context, and
        # the strongest guarantee is a wire with no such field.
        resp = auth_client.post(
            SET_ROUTE,
            json={
                "device_id": DEVICE_ID,
                "max_worktrees": 40,
                "reason": "why",
                "set_by": "somebody-else@example.com",
            },
        )
        assert resp.status_code == 422

    def test_zero_is_refused_here_and_the_message_says_what_it_would_do(
        self, auth_client: TestClient
    ):
        resp = auth_client.post(
            SET_ROUTE,
            json={"device_id": DEVICE_ID, "max_worktrees": 0, "reason": "why"},
        )
        assert resp.status_code == 422
        detail = str(resp.json())
        # Not merely the bound restated: the trap is that a zero locks the
        # operator out of undoing it, and "must be >= 1" does not say that.
        assert "set it back" in detail
        assert "drain" in detail

    def test_a_negative_cap_is_refused_and_the_message_quotes_what_was_SENT(
        self, auth_client: TestClient
    ):
        resp = auth_client.post(
            SET_ROUTE,
            json={"device_id": DEVICE_ID, "max_worktrees": -4, "reason": "why"},
        )
        assert resp.status_code == 422
        detail = str(resp.json())
        # Not "A cap of 0": this door's audience is a direct API caller, and a
        # message describing a mistake they did not make sends them looking for a
        # different one. The frontend's `belowFloorMessage` interpolates the typed
        # value for the same reason; this asserts the backend does too.
        assert "A cap of -4" in detail
        assert "A cap of 0" not in detail
        assert "set it back" in detail

    def test_the_floor_itself_is_ACCEPTED(self, auth_client: TestClient):
        # The other side of a boundary that was pinned only from below: every
        # accepting case in this file uses 4, 100_000 or 2**63-1, so turning
        # `v < _MIN_WORKTREE_CAP` into `<=` would refuse a legitimate cap of 1
        # and nothing here would fail. A cap of 1 is a real operator choice —
        # "let this box hold exactly one worktree" is how a machine is wound
        # down without draining it.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(200, {"changed": True})
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                SET_ROUTE,
                json={"device_id": DEVICE_ID, "max_worktrees": 1, "reason": "why"},
            )
        assert resp.status_code == 200

    def test_the_schema_publishes_the_floor_and_NO_maximum(
        self, auth_client: TestClient
    ):
        # The floor is a policy bound a generated client should see. The i64
        # range is NOT published, and that is deliberate: through JSON Schema's
        # number type `2**63 - 1` round-trips as 9.223372036854776e+18, i.e.
        # `2**63`, which is strictly ABOVE what this door accepts. A published
        # maximum that admits a value the validator refuses is worse than none.
        schema = auth_client.app.openapi()["components"]["schemas"][
            "WorktreeCapRequestBody"
        ]["properties"]["max_worktrees"]
        assert schema["minimum"] == 1
        assert "maximum" not in schema

    def test_a_blank_reason_is_refused_before_the_round_trip(
        self, auth_client: TestClient
    ):
        # `min_length=1` alone admits "   ", which coord then refuses. The reason
        # is shown in every refusal this cap produces, so a blank one defeats the
        # record the write exists to leave.
        resp = auth_client.post(
            SET_ROUTE,
            json={"device_id": DEVICE_ID, "max_worktrees": 4, "reason": "   "},
        )
        assert resp.status_code == 422

    def test_there_is_no_upper_bound(self, auth_client: TestClient):
        # Deliberate: a no-build worktree costs disk rather than memory, and
        # coord's disk gate carries that. A ceiling invented at this hop would be
        # a second policy nobody decided.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(200, {"changed": True})
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                SET_ROUTE,
                json={
                    "device_id": DEVICE_ID,
                    "max_worktrees": 100_000,
                    "reason": "why",
                },
            )
        assert resp.status_code == 200

    def test_past_i64_is_refused_as_a_RANGE_and_not_as_a_ceiling(
        self, auth_client: TestClient
    ):
        # Sits deliberately beside `test_there_is_no_upper_bound`, because the
        # two look contradictory and are not. 100_000 is accepted: there is no
        # POLICY ceiling on the cap. 2**63 is refused: that is coord's integer
        # RANGE, and a value past it is a serde deserialize failure producing a
        # 400 with a Rust string. Converting it here is the whole point of the
        # guard, so the message must say which of the two it is — otherwise the
        # next reader deletes the guard as the ceiling the other test forbids.
        #
        # Asserted with no httpx patch: a value this validator refuses must
        # never reach coord at all, and an unpatched client would fail loudly if
        # the request were forwarded.
        for over in (2**63, 2**63 + 1, 2**70):
            resp = auth_client.post(
                SET_ROUTE,
                json={
                    "device_id": DEVICE_ID,
                    "max_worktrees": over,
                    "reason": "why",
                },
            )
            assert resp.status_code == 422, over
            detail = str(resp.json())
            assert "integer range" in detail, over
            assert "not a policy ceiling" in detail, over

        # The boundary itself is INSIDE the range and is accepted — the guard is
        # `>`, not `>=`, and an off-by-one here would invent the ceiling the
        # message denies being.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(200, {"changed": True})
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                SET_ROUTE,
                json={
                    "device_id": DEVICE_ID,
                    "max_worktrees": 2**63 - 1,
                    "reason": "why",
                },
            )
        assert resp.status_code == 200

    @pytest.mark.parametrize(
        ("status", "error"),
        [
            (403, "admin_required"),
            (403, "device_not_in_tenant"),
            (503, "schema_pending"),
        ],
    )
    def test_coords_typed_refusals_survive_with_their_status(
        self, auth_client: TestClient, status: int, error: str
    ):
        # Three different facts, three different next steps. Collapsing them into
        # "failed" leaves an operator unable to tell "you are not an admin" from
        # "the migration has not been applied yet".
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(status, {"error": error})
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                SET_ROUTE,
                json={"device_id": DEVICE_ID, "max_worktrees": 4, "reason": "why"},
            )

        assert resp.status_code == status
        assert error in resp.text


# ---------------------------------------------------------------------------
# POST /fleet/worktree-cap/clear
# ---------------------------------------------------------------------------


class TestClearWorktreeCap:
    def test_forwards_exactly_two_fields(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(200, {"changed": True})
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                CLEAR_ROUTE,
                json={"device_id": DEVICE_ID, "reason": "sweep finished"},
            )

        assert resp.status_code == 200
        called_url = mock_instance.post.call_args[0][0]
        assert called_url.endswith("/coord/fleet/worktree-cap/clear")
        sent = mock_instance.post.call_args.kwargs["json"]
        assert set(sent) == {"device_id", "reason"}

    def test_a_reason_is_required_to_clear_too(self, auth_client: TestClient):
        # Removing a cap is as much an operator decision as setting one, and
        # coord records both.
        resp = auth_client.post(CLEAR_ROUTE, json={"device_id": DEVICE_ID})
        assert resp.status_code == 422

    def test_changed_false_is_passed_through_not_dressed_up(
        self, auth_client: TestClient
    ):
        # "I removed it" and "there was nothing to remove" are different
        # outcomes, and the operator is entitled to tell them apart.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(
                    200, {"device_id": DEVICE_ID, "changed": False}
                )
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                CLEAR_ROUTE, json={"device_id": DEVICE_ID, "reason": "why"}
            )

        assert resp.json()["changed"] is False

    def test_a_whitespace_only_reason_is_refused_to_clear_too(
        self, auth_client: TestClient
    ):
        # `min_length=1` admits "   ", so the only clear-side reason test above —
        # which OMITS the field — passes without `_reason_not_blank` existing at
        # all. Deleting that validator from `WorktreeCapClearRequestBody` left the
        # whole suite green. The set side was already covered with this input; the
        # clear side records the same decision and deserves the same floor.
        resp = auth_client.post(
            CLEAR_ROUTE, json={"device_id": DEVICE_ID, "reason": "   "}
        )
        assert resp.status_code == 422


def test_both_writes_are_admin_gated_before_any_coord_call() -> None:
    """Both POSTs gate on ``require_coord_tenant_admin`` at THIS tier.

    Coord re-checks with ``rbac::is_tenant_admin`` plus a ``coord.tenant_devices``
    ownership floor, but a proxy that forwarded any member's request would make
    coord the only gate — and a cap decides how much work a shared machine
    accepts, so "who may change it" is the authorization question this surface
    exists to answer.

    Every other test in this file overrides that dependency with a PASSING
    resolver, which is why this case is needed: without it, swapping either route
    to ``get_tenant_id`` would keep the suite green.
    """
    from fastapi import HTTPException

    from app.api.v1.endpoints.operations import require_coord_tenant_admin

    def _deny() -> None:
        raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

    app = _build_test_app()
    app.dependency_overrides[require_coord_tenant_admin] = _deny
    client = TestClient(app)

    with _patch_httpx() as MockClient:
        mock_instance = MagicMock()
        mock_instance.post = AsyncMock(
            return_value=_mock_response(200, {"changed": True})
        )
        _configure_mock_client(MockClient, mock_instance)
        set_resp = client.post(
            SET_ROUTE,
            json={"device_id": DEVICE_ID, "max_worktrees": 4, "reason": "why"},
        )
        clear_resp = client.post(
            CLEAR_ROUTE, json={"device_id": DEVICE_ID, "reason": "why"}
        )
        # BEFORE any coord call: a 403 that still reached coord would mean the
        # refusal came from coord rather than from this gate.
        assert mock_instance.post.await_count == 0

    assert set_resp.status_code == 403
    assert clear_resp.status_code == 403
    assert "not_coord_tenant_admin" in set_resp.text
