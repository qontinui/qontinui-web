"""The consolidated sessions list — `GET /api/v1/operations/sessions?shape=consolidated`.

Plan `2026-08-26-sessions-console-consolidation.md` Phase 1, D1/D2.

What these lock down, in the order the plan states them:

* **D1** — one list read, three row classes (`linked` / `lifecycle_only` /
  `agent_only`) assembled from TWO coord HTTP reads, never from coord's schema
  (the `2026-05-30-web-coord-schema-boundary-decoupling` boundary).
* **D2 / absence-is-not-zero** — a missing join half is UNKNOWN. A bridged row
  the agent half did not carry is `row_class: null`, never `lifecycle_only`;
  a failed agent read is `null` for EVERY row, never an empty agent set.
* **Trap 2 / trap 9** — `claude_code_session_id` carries only a non-unique
  partial index, so two `coord.sessions` rows can share one. The newest by
  `(started_at, id)` wins the agent half — coord's own
  `session_worktrees.rs:710` idiom — and the loser is UNKNOWN, not linked.
* **Trap 7** — the default (no `shape`) response is coord's payload passed
  through unchanged, so the shipped `/sessions` fat-card list is untouched.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
API_PREFIX = "/api/v1/operations"

DEVICE_A = "11111111-1111-1111-1111-111111111111"
DEVICE_B = "22222222-2222-2222-2222-222222222222"

# The Claude Code session uuid that bridges the two id spaces.
BRIDGE = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data: Any = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    return resp


def _lifecycle_row(
    session_id: str,
    *,
    bridge: str | None,
    state: str = "active",
    kind: str = "terminal_claude",
    device_id: str = DEVICE_A,
    started_at: str = "2026-08-26T10:00:00Z",
) -> dict[str, Any]:
    return {
        "id": session_id,
        "tenant_id": str(TEST_TENANT),
        "device_id": device_id,
        "session_kind": kind,
        "intent": {"purpose": "ship the console"},
        "state": state,
        "started_at": started_at,
        "last_heartbeat_at": "2026-08-26T10:05:00Z",
        "closed_at": None,
        "parent_session_id": None,
        "repo": "qontinui-web",
        "branch": "feat/sessions-console",
        "provider": "claude",
        "claude_code_session_id": bridge,
    }


def _agent_row(agent_id: str, *, device_id: str | None = DEVICE_A) -> dict[str, Any]:
    return {
        "id": agent_id,
        "user_id": None,
        "device_id": device_id,
        "first_seen": "2026-08-26T09:59:00Z",
        "last_seen": "2026-08-26T10:05:00Z",
        "label": None,
        "closed_at": None,
        "name": "brave-otter",
        "derived_name": "brave-otter",
        "summary": "brave-otter",
        "status": "live",
    }


class _CoordStub:
    """Answers `/sessions` and `/coord/agent-sessions` off one mocked client.

    Routing on the URL rather than on call order, because the two reads are
    issued sequentially today and a future reordering must not silently swap
    the halves under the assertions below.
    """

    def __init__(
        self,
        *,
        lifecycle: list[dict[str, Any]],
        agents: list[dict[str, Any]] | None,
        agent_status: int = 200,
    ) -> None:
        self.lifecycle = lifecycle
        self.agents = agents
        self.agent_status = agent_status
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    async def get(self, url: str, params=None, headers=None):  # noqa: ANN001
        self.calls.append((url, dict(params) if params else None))
        if "/coord/agent-sessions" in url:
            if self.agent_status != 200:
                return _mock_response(self.agent_status, {"error": "nope"})
            return _mock_response(
                200, {"sessions": self.agents or [], "count": len(self.agents or [])}
            )
        return _mock_response(
            200,
            {"count": len(self.lifecycle), "scope": "all", "sessions": self.lifecycle},
        )


def _with_coord(stub: _CoordStub):
    mock_instance = MagicMock()
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    mock_instance.get = stub.get
    patcher = patch("app.api.v1.endpoints.operations.httpx.AsyncClient")
    MockClient = patcher.start()
    MockClient.return_value = mock_instance
    return patcher


# ---------------------------------------------------------------------------
# The default shape is untouched (trap 7 / constraint 9)
# ---------------------------------------------------------------------------


class TestDefaultShapeUnchanged:
    def test_no_shape_param_passes_coord_payload_through(self, auth_client):
        stub = _CoordStub(lifecycle=[_lifecycle_row("s1", bridge=None)], agents=[])
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions")
        finally:
            patcher.stop()
        assert r.status_code == 200
        body = r.json()
        # Byte-for-byte coord's envelope: no `shape`, no `row_class`, and
        # crucially only ONE coord read — the agent half is not fetched.
        assert "shape" not in body
        assert "row_class" not in body["sessions"][0]
        assert len(stub.calls) == 1
        assert stub.calls[0][0].endswith("/sessions")


# ---------------------------------------------------------------------------
# D1 — the three row classes
# ---------------------------------------------------------------------------


class TestThreeRowClasses:
    def test_linked_lifecycle_only_and_agent_only_all_appear(self, auth_client):
        stub = _CoordStub(
            lifecycle=[
                # bridged AND present in the agent half → linked
                _lifecycle_row("s-linked", bridge=BRIDGE),
                # `claude_code_session_id IS NULL` — a shell session. Structural
                # absence: no agent_sessions row CAN exist. → lifecycle_only
                _lifecycle_row("s-shell", bridge=None, kind="terminal_shell"),
            ],
            agents=[
                _agent_row(BRIDGE),
                # allocate-only: coord.agent_sessions with no coord.sessions row
                _agent_row("dddddddd-dddd-dddd-dddd-dddddddddddd"),
            ],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        assert r.status_code == 200
        body = r.json()
        assert body["shape"] == "consolidated"
        by_class = {row["row_class"]: row for row in body["sessions"]}
        assert set(by_class) == {"linked", "lifecycle_only", "agent_only"}
        assert body["row_class_counts"] == {
            "linked": 1,
            "lifecycle_only": 1,
            "agent_only": 1,
            "unknown": 0,
        }
        assert body["agent_half"] == {"read": "ok"}

        # The linked row carries BOTH halves.
        assert by_class["linked"]["agent_session"]["id"] == BRIDGE
        assert by_class["linked"]["state"] == "active"

        # D2: the lifecycle_only row has no agent half, and says so with a
        # null `agent_session` — the renderer keys on `row_class`.
        assert by_class["lifecycle_only"]["agent_session"] is None

        # D2: the agent_only row's LIFECYCLE keys are ABSENT, not null/false/0.
        # Absent is what we have; a null would read as "coord wrote null".
        agent_only = by_class["agent_only"]
        for lifecycle_key in (
            "state",
            "session_kind",
            "last_heartbeat_at",
            "started_at",
            "intent",
            "provider",
        ):
            assert lifecycle_key not in agent_only, lifecycle_key
        assert agent_only["agent_session"]["status"] == "live"

    def test_consolidated_always_reads_scope_all(self, auth_client):
        """The `agent_only` class is a set difference, so it is only sound over
        the COMPLETE lifecycle set — `scope=active` would promote every closed
        session's perfectly-linked agent row to a fabricated `agent_only`."""
        stub = _CoordStub(lifecycle=[], agents=[])
        patcher = _with_coord(stub)
        try:
            auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated&scope=active")
        finally:
            patcher.stop()
        lifecycle_call = next(c for c in stub.calls if c[0].endswith("/sessions"))
        assert lifecycle_call[1]["scope"] == "all"


# ---------------------------------------------------------------------------
# D2 — a missing half is UNKNOWN, never an answer
# ---------------------------------------------------------------------------


class TestAbsenceIsNotZero:
    def test_bridged_row_absent_from_agent_half_is_unknown_not_lifecycle_only(
        self, auth_client
    ):
        """The agent list is capped and filtered. A bridged row it did not
        carry has NOT been shown to have no agent session."""
        stub = _CoordStub(
            lifecycle=[_lifecycle_row("s1", bridge=BRIDGE)],
            agents=[],  # coord answered — with nothing for this bridge
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        body = r.json()
        assert body["sessions"][0]["row_class"] is None
        assert body["row_class_counts"]["unknown"] == 1
        assert body["row_class_counts"]["lifecycle_only"] == 0

    def test_failed_agent_read_makes_every_row_unknown(self, auth_client):
        """A read that FAILED is not an answer of 'none'. Every row's join axis
        is unknown — including the ones whose bridge column is null, because
        with no agent payload there is also no `agent_only` half to report."""
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row("s1", bridge=BRIDGE),
                _lifecycle_row("s2", bridge=None),
            ],
            agents=None,
            agent_status=500,
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        assert r.status_code == 200  # the lifecycle half IS an answer
        body = r.json()
        assert [row["row_class"] for row in body["sessions"]] == [None, None]
        assert body["row_class_counts"]["unknown"] == 2
        assert body["agent_half"]["read"] == "failed"
        assert "500" in body["agent_half"]["detail"]


# ---------------------------------------------------------------------------
# Trap 2 / trap 9 — the NON-unique bridge must not fan out
# ---------------------------------------------------------------------------


class TestNonUniqueBridgeBound:
    def test_two_sessions_sharing_one_bridge_do_not_duplicate_the_agent_half(
        self, auth_client
    ):
        """`create_session` is `ON CONFLICT (id) DO NOTHING` keyed on `id`
        alone, so a re-registering session produces a SECOND `coord.sessions`
        row sharing one `claude_code_session_id`. The newest by
        `(started_at, id)` wins — coord's `session_worktrees.rs:710` idiom —
        and the older one is UNKNOWN, not handed a lineage that may belong to
        a different incarnation."""
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row(
                    "s-old", bridge=BRIDGE, started_at="2026-08-26T09:00:00Z"
                ),
                _lifecycle_row(
                    "s-new", bridge=BRIDGE, started_at="2026-08-26T11:00:00Z"
                ),
            ],
            agents=[_agent_row(BRIDGE)],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        body = r.json()
        # Exactly two rows out for two rows in — no fan-out, no third row.
        assert len(body["sessions"]) == 2
        by_id = {row["id"]: row for row in body["sessions"]}
        assert by_id["s-new"]["row_class"] == "linked"
        assert by_id["s-new"]["agent_session"]["id"] == BRIDGE
        assert by_id["s-old"]["row_class"] is None
        assert by_id["s-old"]["agent_session"] is None
        # And the agent row is NOT also emitted as `agent_only`.
        assert body["row_class_counts"]["agent_only"] == 0

    def test_started_at_ties_break_on_id_so_the_pick_is_total(self, auth_client):
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row("s-aaa", bridge=BRIDGE),
                _lifecycle_row("s-zzz", bridge=BRIDGE),
            ],
            agents=[_agent_row(BRIDGE)],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        by_id = {row["id"]: row for row in r.json()["sessions"]}
        assert by_id["s-zzz"]["row_class"] == "linked"
        assert by_id["s-aaa"]["row_class"] is None


# ---------------------------------------------------------------------------
# The param vocabulary the three redirected routes bring with them
# ---------------------------------------------------------------------------


class TestFilters:
    def test_device_filters_both_halves(self, auth_client):
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row("s-a", bridge=None, device_id=DEVICE_A),
                _lifecycle_row("s-b", bridge=None, device_id=DEVICE_B),
            ],
            agents=[],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(
                f"{API_PREFIX}/sessions?shape=consolidated&device={DEVICE_A}"
            )
        finally:
            patcher.stop()
        body = r.json()
        assert [row["id"] for row in body["sessions"]] == ["s-a"]
        agent_call = next(c for c in stub.calls if "/coord/agent-sessions" in c[0])
        assert agent_call[1]["device_id"] == DEVICE_A

    def test_status_maps_onto_coord_session_states(self, auth_client):
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row("s-active", bridge=None, state="active"),
                _lifecycle_row("s-stale", bridge=None, state="stale"),
                _lifecycle_row("s-pending", bridge=None, state="pending_resolution"),
                _lifecycle_row("s-closed", bridge=None, state="closed"),
            ],
            agents=[],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(
                f"{API_PREFIX}/sessions?shape=consolidated&status=stale"
            )
        finally:
            patcher.stop()
        assert sorted(row["id"] for row in r.json()["sessions"]) == [
            "s-pending",
            "s-stale",
        ]
        agent_call = next(c for c in stub.calls if "/coord/agent-sessions" in c[0])
        assert agent_call[1]["status"] == "stale"

    def test_unknown_status_is_rejected_by_validation(self, auth_client):
        assert (
            auth_client.get(
                f"{API_PREFIX}/sessions?shape=consolidated&status=banana"
            ).status_code
            == 422
        )

    def test_q_filters_the_lifecycle_half_and_is_forwarded_to_the_agent_half(
        self, auth_client
    ):
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row("s-web", bridge=None),
                {
                    **_lifecycle_row("s-other", bridge=None),
                    "repo": "qontinui-coord",
                    "branch": "main",
                    "intent": {"purpose": "unrelated"},
                },
            ],
            agents=[],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated&q=console")
        finally:
            patcher.stop()
        # matches `intent.purpose` ("ship the console") and the branch slug
        assert [row["id"] for row in r.json()["sessions"]] == ["s-web"]
        agent_call = next(c for c in stub.calls if "/coord/agent-sessions" in c[0])
        assert agent_call[1]["q"] == "console"
