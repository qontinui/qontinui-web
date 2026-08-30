"""Audit rows and rate limits on the mutating Cognito group routes.

Plan ``2026-08-27-members-page-delete-paths-authorization-and-blast-radius``
Phase 3, items 8 and 10.

**Item 8 — the actor.** All six routes bound ``current_user`` through
``require_admin`` and then never referenced it. The only trace that somebody
had deleted a group from the SHARED Cognito pool — irreversible, felt by
every tenant keyed off that pool, and deferred to each affected operator's
next login — was a service-layer structlog line carrying no actor at all.
The four mutating routes now write ``auth.cognito_group_admin_events``,
mirroring ``auth/identities.py``'s ``_write_audit``, which does the same job
for a strictly LOWER-privilege operation.

**Item 10 — the pace.** ``operations.py`` carried no limiter, and this app
installs no ``SlowAPIMiddleware``, so ``default_limits`` never applied
either: slowapi here is per-decorator only. Nothing stopped a scripted loop
walking the pool deleting every group.

The audit tests use a recording session rather than a database. What they
pin is the contract the endpoint owns — that a row is attempted, that it
carries the acting superuser, and that a failure to write it never turns a
completed AWS mutation into an error the caller would retry. The column list
is cross-checked against the migration so the two cannot drift apart into a
constraint failure at runtime.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded

from app.middleware.rate_limit import rate_limit_exceeded_handler, user_limiter
from app.services import cognito_admin

API_PREFIX = "/api/v1/operations"
_GROUPS_URL = f"{API_PREFIX}/coord/cognito/groups"
_AUTH = {"Authorization": "Bearer caller-cognito-token"}


class _RecordingSession:
    """An ``AsyncSession`` stand-in that records ``execute`` calls.

    Only the two methods ``_write_cognito_group_audit`` uses are
    implemented; anything else would be a silent widening of what the audit
    writer is allowed to do to the session.
    """

    def __init__(self, fail: Exception | None = None) -> None:
        self.executed: list[tuple[str, dict[str, Any]]] = []
        self.savepoints = 0
        self.savepoint_rollbacks = 0
        self.rollbacks = 0
        self._fail = fail

    async def execute(self, statement: Any, params: Any = None) -> Any:
        self.executed.append((str(statement), params or {}))
        if self._fail is not None:
            raise self._fail
        return MagicMock()

    def begin_nested(self) -> Any:
        """Stand-in for the SAVEPOINT the audit writer wraps its INSERT in.

        Recording the savepoint separately from a session-wide ``rollback``
        is the point: a session-wide one would also expire ``current_user``,
        which was loaded through this very session.
        """
        session = self

        class _Savepoint:
            async def __aenter__(self) -> Any:
                session.savepoints += 1
                return self

            async def __aexit__(self, exc_type: Any, *_: Any) -> bool:
                if exc_type is not None:
                    session.savepoint_rollbacks += 1
                return False

        return _Savepoint()

    async def rollback(self) -> None:
        self.rollbacks += 1


def _build_app(session: Any, actor_id: UUID) -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = actor_id
    mock_user.email = "staff@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: session
    test_app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    user_limiter.reset()
    yield
    user_limiter.reset()


@pytest.fixture(autouse=True)
def _no_coord_mappings():
    with patch(
        "app.api.v1.endpoints.operations._coord_group_tenant_role_rows",
        AsyncMock(return_value=[]),
    ):
        yield


@pytest.fixture()
def actor_id() -> UUID:
    return uuid4()


@pytest.fixture()
def session() -> _RecordingSession:
    return _RecordingSession()


@pytest.fixture()
def client(session: _RecordingSession, actor_id: UUID) -> TestClient:
    return TestClient(_build_app(session, actor_id))


def _audit_rows(session: _RecordingSession) -> list[dict[str, Any]]:
    return [
        params
        for sql, params in session.executed
        if "cognito_group_admin_events" in sql
    ]


def _ok_resolver(username: str = "u1"):
    def _resolve(_email: str) -> str:
        return username

    return _resolve


# ---------------------------------------------------------------------------
# Item 8 — every mutating route records WHO did it
# ---------------------------------------------------------------------------


class TestTheActorIsRecorded:
    def test_delete_writes_an_audit_row_naming_the_actor(
        self, client: TestClient, session: _RecordingSession, actor_id: UUID
    ):
        """The whole point of item 8. Before it, the answer to "who deleted
        the group that broke SSO for this tenant?" was nowhere in the
        system."""
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 200, resp.text
        rows = _audit_rows(session)
        assert len(rows) == 1
        assert rows[0]["actor_user_id"] == str(actor_id)
        assert rows[0]["action"] == "delete_group"
        assert rows[0]["group_name"] == "acme-devs"

    def test_the_delete_row_records_the_overrides_that_were_used(
        self, client: TestClient, session: _RecordingSession
    ):
        """``allow_mapped`` / ``allow_home_group`` are the record of a
        blast-radius guard being consciously stepped over — the single fact a
        reviewer of an irreversible pool-wide delete most needs."""
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            resp = client.delete(
                f"{_GROUPS_URL}/acme-home?allow_home_group=true", headers=_AUTH
            )

        assert resp.status_code == 200, resp.text
        details = json.loads(_audit_rows(session)[0]["details"])
        assert details == {"allow_mapped": False, "allow_home_group": True}

    def test_create_writes_an_audit_row(
        self, client: TestClient, session: _RecordingSession, actor_id: UUID
    ):
        with patch.object(
            cognito_admin,
            "create_group",
            lambda name, description=None: {"group_name": name},
        ):
            resp = client.post(
                _GROUPS_URL,
                json={"group_name": "acme-devs", "description": "devs"},
                headers=_AUTH,
            )

        assert resp.status_code == 200, resp.text
        row = _audit_rows(session)[0]
        assert row["action"] == "create_group"
        assert row["actor_user_id"] == str(actor_id)
        assert json.loads(row["details"]) == {"description": "devs"}

    def test_add_member_records_the_email_and_the_resolved_username(
        self, client: TestClient, session: _RecordingSession
    ):
        """The email is what the operator typed; the username is what
        Cognito acted on. An audit row that carried only one of them cannot
        be reconciled against the pool afterwards."""
        with (
            patch.object(
                cognito_admin, "resolve_username_for_email", _ok_resolver("u-42")
            ),
            patch.object(cognito_admin, "add_user_to_group", lambda u, g: None),
        ):
            resp = client.post(
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "a@example.com"},
                headers=_AUTH,
            )

        assert resp.status_code == 200, resp.text
        row = _audit_rows(session)[0]
        assert row["action"] == "add_user_to_group"
        assert row["target_email"] == "a@example.com"
        assert row["target_username"] == "u-42"

    def test_remove_member_records_the_email_and_the_resolved_username(
        self, client: TestClient, session: _RecordingSession
    ):
        with (
            patch.object(
                cognito_admin, "resolve_username_for_email", _ok_resolver("u-42")
            ),
            patch.object(cognito_admin, "remove_user_from_group", lambda u, g: None),
        ):
            resp = client.request(
                "DELETE",
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "a@example.com"},
                headers=_AUTH,
            )

        assert resp.status_code == 200, resp.text
        row = _audit_rows(session)[0]
        assert row["action"] == "remove_user_from_group"
        assert row["target_email"] == "a@example.com"


class TestNothingIsAuditedThatDidNotHappen:
    def test_a_refused_delete_writes_no_row(
        self, session: _RecordingSession, actor_id: UUID
    ):
        """A Phase 2 guard refusal never touched AWS, so there is nothing to
        record. An audit table that logged attempts as if they were changes
        would be worse than none."""
        rows = [
            {
                "group_id": "acme-devs",
                "tenant_slug": "acme",
                "role": "operator",
            }
        ]
        client = TestClient(_build_app(session, actor_id))
        with (
            patch(
                "app.api.v1.endpoints.operations._coord_group_tenant_role_rows",
                AsyncMock(return_value=rows),
            ),
            patch.object(cognito_admin, "delete_group", lambda name: None),
        ):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 409, resp.text
        assert _audit_rows(session) == []

    def test_a_failed_aws_delete_writes_no_row(
        self, client: TestClient, session: _RecordingSession
    ):
        def _boom(_name: str) -> None:
            raise cognito_admin.CognitoAdminError("DeleteGroup failed: boom")

        with patch.object(cognito_admin, "delete_group", _boom):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 502, resp.text
        assert _audit_rows(session) == []

    def test_the_read_only_routes_write_no_rows(
        self, client: TestClient, session: _RecordingSession
    ):
        with patch.object(cognito_admin, "list_groups", lambda: []):
            assert client.get(_GROUPS_URL, headers=_AUTH).status_code == 200
        with patch.object(cognito_admin, "list_users_in_group", lambda g: []):
            assert (
                client.get(f"{_GROUPS_URL}/acme-devs/users", headers=_AUTH).status_code
                == 200
            )
        assert _audit_rows(session) == []


class TestAnUnwritableAuditDoesNotUndoTheDelete:
    def test_the_request_still_succeeds(self, actor_id: UUID):
        """The pool has already changed by the time the row is written and
        Cognito has no undelete. Raising here would report a failure that
        did not happen and invite the operator to retry a delete that
        already landed — strictly worse than an audit gap."""
        session = _RecordingSession(fail=RuntimeError("relation does not exist"))
        client = TestClient(_build_app(session, actor_id))
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}

    def test_the_failed_write_is_contained_in_a_savepoint(self, actor_id: UUID):
        """A failed INSERT poisons the session's transaction and
        ``get_async_db`` commits on teardown, so an audit problem would
        otherwise turn a completed mutation into a 500 after the fact.

        A SAVEPOINT rather than a session-wide ``rollback()``: ``db`` is the
        same session ``require_admin`` loaded ``current_user`` from, and a
        session-wide rollback expires that instance — a live trap for the
        next handler that reads ``current_user`` after the audit call."""
        session = _RecordingSession(fail=RuntimeError("relation does not exist"))
        client = TestClient(_build_app(session, actor_id))
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert session.savepoints == 1
        assert session.savepoint_rollbacks == 1
        assert session.rollbacks == 0

    def test_a_successful_write_also_uses_the_savepoint(self, actor_id: UUID):
        session = _RecordingSession()
        client = TestClient(_build_app(session, actor_id))
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert session.savepoints == 1
        assert session.savepoint_rollbacks == 0

    def test_the_failure_is_logged_with_the_row(self, actor_id: UUID):
        """Best-effort must not mean silent — the row has to be recoverable
        from the application log."""
        session = _RecordingSession(fail=RuntimeError("relation does not exist"))
        client = TestClient(_build_app(session, actor_id))
        with (
            patch.object(cognito_admin, "delete_group", lambda name: None),
            patch("app.api.v1.endpoints.operations.logger") as mock_logger,
        ):
            client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        errors = list(mock_logger.error.call_args_list)
        assert any(
            c.args and c.args[0] == "cognito_group_audit_write_failed" for c in errors
        )
        failure = next(
            c for c in errors if c.args[0] == "cognito_group_audit_write_failed"
        )
        assert failure.kwargs["actor_user_id"] == str(actor_id)
        assert failure.kwargs["group_name"] == "acme-devs"


class TestTheAuditRowMatchesTheMigration:
    """The INSERT and the table are authored in different files; a drift
    between them is a runtime constraint failure on the audit path, i.e. on
    the one path that is deliberately allowed to fail quietly."""

    MIGRATION = Path("alembic/versions/cgaudit_01_cognito_group_admin_events.py")

    def _migration_module(self) -> Any:
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "_cgaudit_migration_under_test", self.MIGRATION
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_the_action_vocabulary_matches(self):
        """The endpoint's ``action`` values and the table's CHECK constraint
        are authored in two files. A value in one and not the other makes
        every audit write for it fail a constraint — on the one path that is
        deliberately allowed to fail quietly."""
        from app.api.v1.endpoints.operations import _COGNITO_AUDIT_ACTIONS

        assert _COGNITO_AUDIT_ACTIONS == set(self._migration_module()._ACTIONS)

    def test_every_inserted_column_exists_in_the_table(
        self, client: TestClient, session: _RecordingSession
    ):
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        sql, params = next(
            (s, p) for s, p in session.executed if "cognito_group_admin_events" in s
        )
        declared = set(
            re.findall(r'sa\.Column\(\s*"(\w+)"', self.MIGRATION.read_text())
        )
        inserted = set(params)
        assert inserted <= declared, inserted - declared
        # ...and the INSERT names exactly the parameters it binds.
        named = set(re.findall(r":(\w+)", sql))
        assert named == inserted

    def test_the_revision_graph_stays_single_headed(self):
        """What matters is that this branch adds no FORK —
        ``alembic-graph-pr.yml`` fails a PR that does.

        Asserting the literal ``down_revision`` would be worse than useless:
        coord re-points it at the live merged head when the PR lands, so a
        literal assertion is a test written to break on the merge commit.
        Ask the graph instead.

        That reasoning applies to the HEAD identity too, and this test used to
        assert ``get_heads() == ["cgaudit_01"]`` — which fails the moment any
        later revision stacks on this one, exactly as `pdann_01` does. Being
        the head is not a property this migration owns; a revision stops being
        the head as soon as the next one lands, and that is the normal case,
        not a regression. The invariants that actually belong here are that the
        graph has ONE head and that this revision is on the chain leading to
        it — both strictly stronger than the identity check, and neither
        breaks when somebody stacks on top."""
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(Config("alembic.ini"))
        heads = script.get_heads()
        assert len(heads) == 1, f"revision graph forked: {heads}"
        # ...this revision is on that single chain, not stranded on a branch
        # the head cannot reach...
        chain = {rev.revision for rev in script.iterate_revisions(heads[0], "base")}
        assert "cgaudit_01" in chain
        # ...and it is genuinely reachable from the base, not an island.
        assert script.get_revision("cgaudit_01").down_revision is not None

    def test_the_migration_is_reversible(self):
        module = self._migration_module()
        assert callable(module.downgrade)
        source = self.MIGRATION.read_text()
        # An unconditional DROP TABLE beside two guarded DROP INDEXes is the
        # asymmetry that bites after an upgrade which skipped.
        assert "DROP TABLE IF EXISTS" in source


# ---------------------------------------------------------------------------
# Item 10 — the mutating routes are rate-limited
# ---------------------------------------------------------------------------


class TestRateLimits:
    def test_the_delete_route_stops_a_loop(
        self, client: TestClient, session: _RecordingSession
    ):
        """A scripted loop deleting every group in the pool is exactly what
        was unbounded. The cap is per minute, so the loop stalls after five
        rather than emptying the pool."""
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            codes = [
                client.delete(f"{_GROUPS_URL}/g{i}", headers=_AUTH).status_code
                for i in range(7)
            ]

        assert codes[:5] == [200] * 5
        assert codes[5:] == [429, 429]

    def test_the_429_body_says_it_is_a_rate_limit(self, client: TestClient):
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            for i in range(5):
                client.delete(f"{_GROUPS_URL}/g{i}", headers=_AUTH)
            resp = client.delete(f"{_GROUPS_URL}/g9", headers=_AUTH)

        assert resp.status_code == 429
        assert resp.json()["error"] == "RATE_LIMIT_EXCEEDED"
        assert resp.headers["Retry-After"]

    def test_a_throttled_delete_never_reaches_aws(self, client: TestClient):
        """The limit has to be checked BEFORE the handler, or it would only
        be counting damage it had already allowed."""
        calls: list[str] = []

        with patch.object(cognito_admin, "delete_group", calls.append):
            for i in range(7):
                client.delete(f"{_GROUPS_URL}/g{i}", headers=_AUTH)

        assert len(calls) == 5

    def test_distinct_group_names_share_one_bucket(self, client: TestClient):
        """slowapi's default ``key_style`` is ``"url"``, so a plain
        ``@limiter.limit`` on a route with a path parameter counts each
        group NAME separately — and the loop this limit exists to stop uses
        a different name every call. The explicit ``shared_limit`` scope is
        what makes the six calls below one budget rather than six."""
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            codes = [
                client.delete(
                    f"{_GROUPS_URL}/entirely-different-{i}", headers=_AUTH
                ).status_code
                for i in range(6)
            ]

        assert codes.count(429) == 1

    def test_the_membership_routes_have_more_headroom_than_the_delete(self):
        """Onboarding a team by hand is a legitimate burst; deleting groups
        from a shared pool is not. The two limits must not be the same
        number, or one of the two is wrong."""
        from app.api.v1.endpoints import operations

        assert operations._DELETE_GROUP_RATE_LIMIT == "5 per minute"
        assert operations._CREATE_GROUP_RATE_LIMIT == "10 per minute"
        assert operations._GROUP_MEMBER_RATE_LIMIT == "30 per minute"

    def test_the_bucket_is_per_caller_not_per_ip(
        self, client: TestClient, session: _RecordingSession
    ):
        """Behind Vercel/ALB every operator arrives from a handful of source
        IPs — the failure ``_get_refresh_token_subject`` was written for. An
        IP key would let one operator's cleanup run throttle everybody
        else's."""
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            for i in range(5):
                client.delete(f"{_GROUPS_URL}/g{i}", headers=_AUTH)
            exhausted = client.delete(f"{_GROUPS_URL}/g9", headers=_AUTH)
            other = client.delete(
                f"{_GROUPS_URL}/g9", headers={"Authorization": "Bearer somebody-else"}
            )

        assert exhausted.status_code == 429
        assert other.status_code == 200, other.text

    def test_the_read_only_routes_are_not_limited(self, client: TestClient):
        """Listing changes nothing and the dashboard polls it; a limit there
        would break the page without bounding any blast radius."""
        with patch.object(cognito_admin, "list_groups", lambda: []):
            codes = [
                client.get(_GROUPS_URL, headers=_AUTH).status_code for _ in range(12)
            ]

        assert codes == [200] * 12

    def test_the_kill_switch_exempts_the_routes(self, client: TestClient):
        """``user_limiter`` is built without ``enabled=``, so unlike
        ``auth_limiter`` it does not read ``RATE_LIMIT_ENABLED`` itself.
        These decorators read it per request instead, keeping the same
        operational off-ramp every other limited route has."""
        from app.core.config import settings

        with (
            patch.object(cognito_admin, "delete_group", lambda name: None),
            patch.object(settings, "RATE_LIMIT_ENABLED", False),
        ):
            codes = [
                client.delete(f"{_GROUPS_URL}/g{i}", headers=_AUTH).status_code
                for i in range(8)
            ]

        assert codes == [200] * 8


class TestTheRateLimitKeyDoesNotLeakTheBearer:
    def test_the_token_is_hashed_not_embedded(self):
        """The key ends up in a Redis key and in slowapi's log line. A raw
        bearer in either is a credential leak."""
        from app.middleware.rate_limit import get_authorization_identifier

        request = MagicMock()
        request.headers = {"authorization": "Bearer super-secret-token"}
        key = get_authorization_identifier(request)

        assert key.startswith("bearer:")
        assert "super-secret-token" not in key

    def test_the_same_token_maps_to_the_same_bucket(self):
        from app.middleware.rate_limit import get_authorization_identifier

        def _req(header: str) -> Any:
            request = MagicMock()
            request.headers = {"authorization": header}
            return request

        a = get_authorization_identifier(_req("Bearer tok-1"))
        b = get_authorization_identifier(_req("Bearer tok-1"))
        c = get_authorization_identifier(_req("Bearer tok-2"))
        assert a == b
        assert a != c

    def test_it_falls_back_to_the_client_ip(self):
        from app.middleware.rate_limit import get_authorization_identifier

        request = MagicMock()
        request.headers = {}
        request.client.host = "203.0.113.7"
        assert get_authorization_identifier(request) == "ip:203.0.113.7"
