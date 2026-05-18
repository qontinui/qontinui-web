"""Integration tests for ``/api/v1/admin/agent-sessions`` endpoints.

Side D / Phase 4 of ``coord-agent-session-id-tracking.md``. Covers:

* GET /admin/agent-sessions (list, with filters)
* GET /admin/agent-sessions/{id}/lineage (UNION ALL timeline)

Pattern mirrors ``test_operations_claims_proxy.py``: minimal FastAPI
app, dependency overrides for auth + DB. The DB session is mocked
at the SQLAlchemy ``AsyncSession`` level so no live PG is needed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _admin_user() -> MagicMock:
    u = MagicMock()
    u.id = uuid4()
    u.email = "admin@example.com"
    u.is_active = True
    u.is_verified = True
    u.is_superuser = True
    return u


def _build_test_app(
    *,
    list_rows: list[dict] | None = None,
    lineage_rows: list[dict] | None = None,
    authenticated: bool = True,
) -> tuple[FastAPI, MagicMock]:
    """Build a FastAPI app with the agent_sessions router mounted.

    Returns the app + a MagicMock recording the SQL statements
    executed (so tests can assert on the bound params).
    """
    from app.api.admin_deps import require_admin
    from app.api.deps import get_async_db
    from app.api.v1.endpoints.agent_sessions import router

    test_app = FastAPI()

    if authenticated:
        test_app.dependency_overrides[require_admin] = _admin_user

    # Build a fake AsyncSession that intercepts .execute() and returns
    # either the list_rows or lineage_rows depending on the SQL.
    fake_session = MagicMock()
    last_call = MagicMock()

    async def fake_execute(stmt, params=None):  # noqa: ANN001
        last_call.stmt = str(stmt)
        last_call.params = params or {}
        sql_lower = str(stmt).lower()
        result = MagicMock()
        mappings = MagicMock()
        if "from coord.agent_sessions" in sql_lower and "union all" not in sql_lower:
            mappings.all.return_value = list_rows or []
        else:
            mappings.all.return_value = lineage_rows or []
        result.mappings.return_value = mappings
        return result

    fake_session.execute = AsyncMock(side_effect=fake_execute)

    async def fake_db():
        yield fake_session

    test_app.dependency_overrides[get_async_db] = fake_db
    test_app.include_router(router, prefix="/api/v1/admin")
    return test_app, last_call


# ---------------------------------------------------------------------------
# GET /admin/agent-sessions
# ---------------------------------------------------------------------------


class TestListAgentSessions:
    def test_returns_empty_list_when_no_rows(self):
        app, _ = _build_test_app(list_rows=[])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"sessions": [], "count": 0}

    def test_returns_rows_with_iso_timestamps(self):
        sid = uuid4()
        uid = uuid4()
        did = uuid4()
        now = datetime(2026, 5, 18, 12, 0, 0, tzinfo=UTC)
        row = {
            "id": sid,
            "user_id": uid,
            "device_id": did,
            "first_seen": now,
            "last_seen": now,
            "label": "ufix-2026-05-18",
            "closed_at": None,
        }
        app, _ = _build_test_app(list_rows=[row])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions?live=true")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert body["sessions"][0]["id"] == str(sid)
        assert body["sessions"][0]["user_id"] == str(uid)
        assert body["sessions"][0]["device_id"] == str(did)
        assert body["sessions"][0]["label"] == "ufix-2026-05-18"
        assert body["sessions"][0]["closed_at"] is None
        assert body["sessions"][0]["first_seen"].startswith("2026-05-18")

    def test_handles_null_user_and_device(self):
        sid = uuid4()
        now = datetime(2026, 5, 18, tzinfo=UTC)
        row = {
            "id": sid,
            "user_id": None,
            "device_id": None,
            "first_seen": now,
            "last_seen": now,
            "label": None,
            "closed_at": None,
        }
        app, _ = _build_test_app(list_rows=[row])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 200
        body = resp.json()
        assert body["sessions"][0]["user_id"] is None
        assert body["sessions"][0]["device_id"] is None
        assert body["sessions"][0]["label"] is None

    def test_live_filter_appears_in_sql(self):
        app, last_call = _build_test_app(list_rows=[])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions?live=true")
        assert resp.status_code == 200
        assert "closed_at is null" in last_call.stmt.lower()

    def test_user_id_filter_binds_param(self):
        uid = uuid4()
        app, last_call = _build_test_app(list_rows=[])
        client = TestClient(app)
        resp = client.get(f"/api/v1/admin/agent-sessions?user_id={uid}")
        assert resp.status_code == 200
        assert "user_id = :user_id" in last_call.stmt
        assert str(last_call.params["user_id"]) == str(uid)

    def test_since_filter_binds_param(self):
        app, last_call = _build_test_app(list_rows=[])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions?since=2026-05-18T00:00:00Z")
        assert resp.status_code == 200
        assert "last_seen >= :since" in last_call.stmt
        assert "since" in last_call.params

    def test_limit_capped_at_500(self):
        app, _ = _build_test_app(list_rows=[])
        client = TestClient(app)
        # Above-cap is a 422 from FastAPI's Query(le=500) validation.
        resp = client.get("/api/v1/admin/agent-sessions?limit=10000")
        assert resp.status_code == 422

    def test_limit_floor_at_1(self):
        app, _ = _build_test_app(list_rows=[])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions?limit=0")
        assert resp.status_code == 422

    def test_default_limit_is_100(self):
        app, last_call = _build_test_app(list_rows=[])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 200
        assert last_call.params["limit"] == 100

    def test_orders_by_last_seen_desc(self):
        app, last_call = _build_test_app(list_rows=[])
        client = TestClient(app)
        client.get("/api/v1/admin/agent-sessions")
        assert "order by last_seen desc" in last_call.stmt.lower()

    def test_unauth_blocked(self):
        # Mount without overriding require_admin → default raises 403.
        from app.api.deps import get_async_db, get_current_user_async
        from app.api.v1.endpoints.agent_sessions import router

        test_app = FastAPI()

        async def fake_db():
            yield MagicMock()

        # Override only get_current_user_async to return a non-superuser
        non_admin = MagicMock()
        non_admin.is_superuser = False
        test_app.dependency_overrides[get_async_db] = fake_db
        test_app.dependency_overrides[get_current_user_async] = lambda: non_admin
        test_app.include_router(router, prefix="/api/v1/admin")
        client = TestClient(test_app)
        resp = client.get("/api/v1/admin/agent-sessions")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /admin/agent-sessions/{id}/lineage
# ---------------------------------------------------------------------------


class TestGetSessionLineage:
    def test_empty_lineage_returns_200(self):
        sid = uuid4()
        app, _ = _build_test_app(lineage_rows=[])
        client = TestClient(app)
        resp = client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"session_id": str(sid), "actions": []}

    def test_returns_mixed_kinds(self):
        sid = uuid4()
        agent_id = uuid4()
        claim_id = uuid4()
        build_id = uuid4()
        proposal_id = uuid4()
        t = datetime(2026, 5, 18, 12, 0, 0, tzinfo=UTC)
        rows = [
            {"kind": "merge_proposal", "handle": str(proposal_id), "occurred_at": t},
            {"kind": "build_event", "handle": str(build_id), "occurred_at": t},
            {"kind": "claim_event", "handle": str(claim_id), "occurred_at": t},
            {"kind": "agent_worktree", "handle": str(agent_id), "occurred_at": t},
        ]
        app, _ = _build_test_app(lineage_rows=rows)
        client = TestClient(app)
        resp = client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"] == str(sid)
        assert len(body["actions"]) == 4
        kinds = [a["kind"] for a in body["actions"]]
        assert set(kinds) == {
            "merge_proposal",
            "build_event",
            "claim_event",
            "agent_worktree",
        }

    def test_binds_session_id_param(self):
        sid = uuid4()
        app, last_call = _build_test_app(lineage_rows=[])
        client = TestClient(app)
        client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        assert "agent_session_id = :session_id" in last_call.stmt
        assert str(last_call.params["session_id"]) == str(sid)

    def test_caps_at_500_rows(self):
        sid = uuid4()
        app, last_call = _build_test_app(lineage_rows=[])
        client = TestClient(app)
        client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        assert last_call.params["limit"] == 500

    def test_union_all_includes_all_four_tables(self):
        sid = uuid4()
        app, last_call = _build_test_app(lineage_rows=[])
        client = TestClient(app)
        client.get(f"/api/v1/admin/agent-sessions/{sid}/lineage")
        sql = last_call.stmt.lower()
        assert "coord.agent_worktrees" in sql
        assert "coord.claims_audit" in sql
        assert "coord.build_events" in sql
        assert "coord.merge_proposals" in sql
        assert sql.count("union all") == 3

    def test_invalid_session_id_rejected_as_422(self):
        app, _ = _build_test_app(lineage_rows=[])
        client = TestClient(app)
        resp = client.get("/api/v1/admin/agent-sessions/not-a-uuid/lineage")
        assert resp.status_code == 422
