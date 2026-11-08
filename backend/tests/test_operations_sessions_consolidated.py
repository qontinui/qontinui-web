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
* **Each half names its ceiling** — plan
  `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
  Phase 3 (U4). Both coord reads stop at 500 rows, so each half carries the
  shared bounded-read envelope: a half that came back FULL is `unknown`, never
  `complete`, and its count is what coord SERVED, before this route's own
  `device` / `status` / `q` narrowing.
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


def _lifecycle_rows(n: int, **overrides: Any) -> list[dict[str, Any]]:
    """``n`` unbridged lifecycle rows (each a `lifecycle_only` row on its own),
    every one carrying ``overrides``."""
    return [
        {**_lifecycle_row(f"s-{i:03d}", bridge=None), **overrides} for i in range(n)
    ]


def _agent_rows(n: int) -> list[dict[str, Any]]:
    """``n`` agent rows no lifecycle row bridges."""
    return [_agent_row(str(uuid4())) for _ in range(n)]


def _expected_bound(*, shown: int, complete: bool, limit: int = 500) -> dict[str, Any]:
    """One half's ``bound`` exactly as the wire must carry it.

    Spelled out key by key rather than built with ``app.core.bounded_read``, so
    a change to what the builders serialize fails here instead of passing by
    construction. Every key is present and ``null`` is a value (the envelope's
    contract — never ``exclude_none``). A FULL half is ``unknown`` with
    ``truncated`` / ``total`` null: never ``true`` (no extra row was fetched to
    prove more exist) and never ``false`` (nothing proves there are not).
    """
    return {
        "available": True,
        "bound_kind": "complete" if complete else "unknown",
        "count": shown,
        "enumerate_via": None,
        "filter_narrowed": None,
        "limit": limit,
        "next_cursor": None,
        "shown": shown,
        "total": None,
        "truncated": False if complete else None,
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
        lifecycle_payload: dict[str, Any] | None = None,
    ) -> None:
        self.lifecycle = lifecycle
        self.agents = agents
        self.agent_status = agent_status
        # When set, `/sessions` answers 200 with THIS body verbatim instead of
        # coord's envelope around `lifecycle` — for a body coord should never
        # send.
        self.lifecycle_payload = lifecycle_payload
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    async def get(self, url: str, params=None, headers=None):  # noqa: ANN001
        self.calls.append((url, dict(params) if params else None))
        if "/coord/agent-sessions" in url:
            if self.agent_status != 200:
                return _mock_response(self.agent_status, {"error": "nope"})
            return _mock_response(
                200, {"sessions": self.agents or [], "count": len(self.agents or [])}
            )
        if self.lifecycle_payload is not None:
            return _mock_response(200, self.lifecycle_payload)
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
        # Both halves answered well below coord's 500-row ceilings: complete.
        assert body["lifecycle_half"] == {
            "read": "ok",
            "bound": _expected_bound(shown=2, complete=True),
        }
        assert body["agent_half"] == {
            "read": "ok",
            "bound": _expected_bound(shown=2, complete=True),
        }

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


# ---------------------------------------------------------------------------
# Session lookup by id, name or trailer — plan
# `2026-10-19-session-lookup-by-name-shows-claude-account-in-web` Phase 3
# ---------------------------------------------------------------------------


class TestSessionLookup:
    def test_claude_code_session_id_is_a_lifecycle_query_field(self):
        from app.api.v1.endpoints.operations import _SESSION_QUERY_FIELDS

        assert "claude_code_session_id" in _SESSION_QUERY_FIELDS

    def test_a_pasted_session_id_finds_the_lifecycle_half_by_its_bridge(
        self, auth_client
    ):
        """A commit's `Session-Id:` trailer is the Claude Code session uuid —
        `coord.sessions.claude_code_session_id`, NOT `coord.sessions.id`. The
        console strips the prefix; the lifecycle half must still match it."""
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row("s-bridged", bridge=BRIDGE),
                {
                    **_lifecycle_row("s-other", bridge=None),
                    "repo": "qontinui-coord",
                    "branch": "main",
                    "intent": {"purpose": "unrelated"},
                },
            ],
            # The deployed coord's full-text search cannot match a uuid yet, so
            # the agent half returns nothing for it.
            agents=[],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(
                f"{API_PREFIX}/sessions?shape=consolidated&q={BRIDGE.upper()}"
            )
        finally:
            patcher.stop()
        rows = r.json()["sessions"]
        assert [row["id"] for row in rows] == ["s-bridged"]
        # The agent half did not carry the bridged row: UNKNOWN, never
        # `lifecycle_only` (which would claim no agent row CAN exist).
        assert rows[0]["row_class"] is None
        agent_call = next(c for c in stub.calls if "/coord/agent-sessions" in c[0])
        assert agent_call[1]["q"] == BRIDGE.upper()

    def test_a_name_only_the_agent_half_matched_keeps_its_lifecycle_twin(
        self, auth_client
    ):
        """coord matched the name (a stamped / trailer name the lifecycle row
        does not carry). Filtering the lifecycle twin out would orphan the
        agent row and emit it as `agent_only` — a fabricated "no coord.sessions
        row bridges this"."""
        stub = _CoordStub(
            lifecycle=[
                _lifecycle_row("s-linked", bridge=BRIDGE),
                {
                    **_lifecycle_row("s-other", bridge=None),
                    "intent": {"purpose": "unrelated"},
                },
            ],
            agents=[_agent_row(BRIDGE)],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(
                f"{API_PREFIX}/sessions?shape=consolidated&q=spaceship-latency"
            )
        finally:
            patcher.stop()
        body = r.json()
        assert [(row["id"], row["row_class"]) for row in body["sessions"]] == [
            ("s-linked", "linked")
        ]
        assert body["sessions"][0]["agent_session"]["id"] == BRIDGE
        assert body["row_class_counts"]["agent_only"] == 0

    def test_a_status_filtered_lifecycle_row_takes_its_agent_half_with_it(
        self, auth_client
    ):
        """`status=live` removes a CLOSED lifecycle row. Its agent half (coord's
        own status word may still read `live`) is the other half of a session
        the filter excluded — not an unbridged `agent_only` allocation."""
        stub = _CoordStub(
            lifecycle=[_lifecycle_row("s-closed", bridge=BRIDGE, state="closed")],
            agents=[_agent_row(BRIDGE)],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated&status=live")
        finally:
            patcher.stop()
        body = r.json()
        assert body["sessions"] == []
        assert body["row_class_counts"]["agent_only"] == 0
        # Hidden, but COUNTED — the session must not vanish silently.
        assert body["withheld_by_filter"] == 1
        # It is not a row of any class: the class counts still sum to `count`.
        assert sum(body["row_class_counts"].values()) == body["count"] == 0

    def test_a_name_search_narrowed_by_status_counts_the_disagreeing_session(
        self, auth_client
    ):
        """`?status=stale&q=<name>`: coord's agent half matched the name AND
        reads `stale`, while the lifecycle half reads `active`. The stale tab
        hides it — and says how many it hid."""
        stub = _CoordStub(
            lifecycle=[_lifecycle_row("s-active", bridge=BRIDGE, state="active")],
            agents=[{**_agent_row(BRIDGE), "status": "stale"}],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(
                f"{API_PREFIX}/sessions?shape=consolidated&status=stale"
                "&q=spaceship-latency"
            )
        finally:
            patcher.stop()
        body = r.json()
        assert body["sessions"] == []
        assert body["withheld_by_filter"] == 1

    def test_halves_on_different_devices_are_counted_under_a_device_filter(
        self, auth_client
    ):
        stub = _CoordStub(
            lifecycle=[_lifecycle_row("s-b", bridge=BRIDGE, device_id=DEVICE_B)],
            # coord's agent read is device-filtered on ITS device column.
            agents=[_agent_row(BRIDGE, device_id=DEVICE_A)],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(
                f"{API_PREFIX}/sessions?shape=consolidated&device={DEVICE_A}"
            )
        finally:
            patcher.stop()
        body = r.json()
        assert body["sessions"] == []
        assert body["withheld_by_filter"] == 1

    def test_nothing_is_withheld_without_a_filter_or_without_an_agent_read(
        self, auth_client
    ):
        for agents, status in (([_agent_row(BRIDGE)], 200), (None, 502)):
            stub = _CoordStub(
                lifecycle=[_lifecycle_row("s-1", bridge=BRIDGE, state="closed")],
                agents=agents,
                agent_status=status,
            )
            patcher = _with_coord(stub)
            try:
                r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
            finally:
                patcher.stop()
            assert r.json()["withheld_by_filter"] == 0

    def test_a_truly_unbridged_agent_row_is_still_agent_only_under_a_filter(
        self, auth_client
    ):
        """The guard above must not swallow a REAL `agent_only` row: one no
        lifecycle row coord served bridges at all."""
        unbridged = "dddddddd-dddd-dddd-dddd-dddddddddddd"
        stub = _CoordStub(
            lifecycle=[_lifecycle_row("s-closed", bridge=BRIDGE, state="closed")],
            agents=[_agent_row(unbridged)],
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated&status=live")
        finally:
            patcher.stop()
        body = r.json()
        assert [(row["id"], row["row_class"]) for row in body["sessions"]] == [
            (unbridged, "agent_only")
        ]
        # The closed lifecycle row's agent half was never served, so nothing
        # coord matched was hidden.
        assert body["withheld_by_filter"] == 0


# ---------------------------------------------------------------------------
# Each half names its ceiling — plan
# `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
# Phase 3 (U4)
# ---------------------------------------------------------------------------


class TestEachHalfNamesItsCeiling:
    """coord's `/sessions` stops at `LIMIT 500` (the most recently STARTED
    sessions) and `/coord/agent-sessions` at 500 (the most recently SEEN). A
    half that came back full may have more rows behind it, and nothing coord
    sends says whether it does — so that half is `unknown`, never `complete`,
    and the console can say "at least" instead of presenting a sample as the
    fleet."""

    @pytest.mark.parametrize(
        ("served", "complete"),
        [(0, True), (499, True), (500, False)],
        ids=["empty", "below-ceiling", "at-ceiling"],
    )
    def test_the_lifecycle_half_says_which_side_of_coords_ceiling_it_landed_on(
        self, auth_client, served, complete
    ):
        stub = _CoordStub(lifecycle=_lifecycle_rows(served), agents=[])
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        assert r.status_code == 200
        half = r.json()["lifecycle_half"]
        assert half["read"] == "ok"
        assert half["bound"]["bound_kind"] == ("complete" if complete else "unknown")
        # `false` only below the ceiling; at it, `null` — never `true`, which
        # would claim rows were seen beyond the page when none were fetched.
        assert half["bound"]["truncated"] is (False if complete else None)
        assert half == {
            "read": "ok",
            "bound": _expected_bound(shown=served, complete=complete),
        }

    @pytest.mark.parametrize(
        ("served", "complete"),
        [(499, True), (500, False)],
        ids=["below-join-limit", "at-join-limit"],
    )
    def test_the_agent_half_says_which_side_of_its_join_limit_it_landed_on(
        self, auth_client, served, complete
    ):
        stub = _CoordStub(lifecycle=[], agents=_agent_rows(served))
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        body = r.json()
        assert body["agent_half"]["bound"]["bound_kind"] == (
            "complete" if complete else "unknown"
        )
        assert body["agent_half"]["bound"]["truncated"] is (False if complete else None)
        assert body["agent_half"] == {
            "read": "ok",
            "bound": _expected_bound(shown=served, complete=complete),
        }
        # The agent-only class itself is unchanged: the agent half is real, so
        # its rows stay — qualifying `agent_only` is the console's job.
        assert body["row_class_counts"]["agent_only"] == served

    @pytest.mark.parametrize(
        ("query", "dropped_overrides"),
        [
            ("status=live", {"state": "closed"}),
            (f"device={DEVICE_A}", {"device_id": DEVICE_B}),
            (
                "q=console",
                {
                    "repo": "qontinui-coord",
                    "branch": "main",
                    "intent": {"purpose": "unrelated"},
                },
            ),
        ],
        ids=["status", "device", "q"],
    )
    def test_the_lifecycle_count_is_what_coord_served_not_what_the_filter_kept(
        self, auth_client, query, dropped_overrides
    ):
        """coord served its full 500; this route's own narrowing kept 40. The
        bound describes coord's READ — counted after the narrowing, a Live tab
        keeping 40 of 500 would read as a complete fleet of 40."""
        kept = _lifecycle_rows(40)  # active, on DEVICE_A, purpose "ship the console"
        dropped = [
            {**row, "id": f"x-{row['id']}"}
            for row in _lifecycle_rows(460, **dropped_overrides)
        ]
        stub = _CoordStub(lifecycle=kept + dropped, agents=[])
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated&{query}")
        finally:
            patcher.stop()
        body = r.json()
        # The narrowing still happened …
        assert body["count"] == 40
        # … and the bound still describes the 500 coord served.
        bound = body["lifecycle_half"]["bound"]
        assert bound["shown"] == bound["count"] == 500
        assert bound["bound_kind"] == "unknown"
        assert bound["truncated"] is None

    def test_a_failed_agent_read_carries_no_bound_and_the_lifecycle_half_keeps_its_own(
        self, auth_client
    ):
        """A read that failed has no page to bound. Its absence is the
        statement; a `bound` beside `read: "failed"` would describe rows that
        never arrived."""
        stub = _CoordStub(
            lifecycle=[_lifecycle_row("s1", bridge=BRIDGE)],
            agents=None,
            agent_status=502,
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        assert r.status_code == 200
        body = r.json()
        assert body["agent_half"]["read"] == "failed"
        assert "bound" not in body["agent_half"]
        assert set(body["agent_half"]) == {"read", "detail"}
        # The lifecycle half IS an answer, and still names its bound.
        assert body["lifecycle_half"] == {
            "read": "ok",
            "bound": _expected_bound(shown=1, complete=True),
        }

    def test_a_lifecycle_body_with_no_sessions_list_is_unknown_never_complete(
        self, auth_client
    ):
        """A 200 that carries no `sessions` list served nothing countable. Its
        rows render as none (as before), but its bound must not be `complete`:
        `truncated: false` would assert "you have seen everything" over a read
        that said nothing at all."""
        stub = _CoordStub(
            lifecycle=[],
            agents=[],
            lifecycle_payload={"count": 0, "scope": "all"},
        )
        patcher = _with_coord(stub)
        try:
            r = auth_client.get(f"{API_PREFIX}/sessions?shape=consolidated")
        finally:
            patcher.stop()
        body = r.json()
        assert body["sessions"] == []
        assert body["lifecycle_half"] == {
            "read": "ok",
            "bound": _expected_bound(shown=0, complete=False),
        }
