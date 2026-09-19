"""A failed prior-access read must not turn a successful grant into a 500.

``_member_had_prior_access`` runs inside the REQUEST's ambient transaction.
Without a savepoint, any failed statement — a missing column on a database
that has not taken ``membernotice_01_operator_audit_grant_lookup`` yet, a
permissions problem, a dropped connection — leaves the ``AsyncSession`` in
must-rollback state. The helper swallows the error and answers UNKNOWN, the
grant proceeds and both coord writes commit, and THEN ``get_async_db``'s
teardown ``commit()`` raises ``PendingRollbackError``. The operator reads a
500 for a grant that succeeded, and retries it.

That is the exact failure mode the notice exists to prevent, arriving by a
different door, and the route tests could not see it: they override the
session with a plain ``MagicMock`` (so no teardown commit ever runs) and
patch the helper out entirely (so the statement never executes).

This module closes both gaps:

* the helper is exercised for REAL, against a session that fails, and
* the whole route is driven through a session that records whether a
  savepoint was opened and whether it was rolled back.

``app.services.email.email_composers`` is never reached here — the UNKNOWN
answer suppresses the send before a composer is looked up — so no transport
is stubbed.
"""

from __future__ import annotations

import contextlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded

from app.middleware.rate_limit import rate_limit_exceeded_handler, user_limiter

API_PREFIX = "/api/v1/operations"


class FakeSession:
    """An ``AsyncSession`` stand-in that records savepoint use.

    ``execute`` raises whatever ``failure`` is set to. ``begin_nested`` is an
    async context manager, exactly as SQLAlchemy's is, and records entry and
    exit so a test can prove the statement was wrapped rather than run bare.
    """

    def __init__(self, failure: BaseException | None = None, row=None):
        self.failure = failure
        self.row = row
        self.savepoints_opened = 0
        self.savepoints_exited_with_error = 0
        self.executed = 0
        self.session_wide_rollbacks = 0

    def begin_nested(self):
        session = self

        @contextlib.asynccontextmanager
        async def _cm():
            session.savepoints_opened += 1
            try:
                yield
            except BaseException:
                session.savepoints_exited_with_error += 1
                raise

        return _cm()

    async def execute(self, _statement, _params=None):
        self.executed += 1
        if self.failure is not None:
            raise self.failure
        result = MagicMock()
        result.one.return_value = self.row
        return result

    async def rollback(self):
        # Never expected: a session-wide rollback would expire the
        # `current_user` instance this same session loaded.
        self.session_wide_rollbacks += 1


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    user_limiter.reset()
    yield
    user_limiter.reset()


class TestTheHelperIsWrappedInASavepoint:
    @pytest.mark.asyncio
    async def test_a_failed_read_uses_a_savepoint_and_answers_unknown(self):
        from app.api.v1.endpoints.operations import _member_had_prior_access

        db = FakeSession(failure=RuntimeError("relation does not exist"))

        answer = await _member_had_prior_access(
            db, tenant_id=uuid4(), operator_id=str(uuid4())
        )

        # UNKNOWN, not False — answering False would send the notice on an
        # unreadable check, restoring the unbounded behaviour.
        assert answer is None
        # The statement ran inside a SAVEPOINT, which is what keeps the
        # ambient transaction usable for the teardown commit.
        assert db.savepoints_opened == 1
        assert db.savepoints_exited_with_error == 1
        # And NOT via a session-wide rollback, which would expire
        # `current_user` mid-request.
        assert db.session_wide_rollbacks == 0

    @pytest.mark.asyncio
    async def test_a_successful_read_also_uses_the_savepoint(self):
        from app.api.v1.endpoints.operations import _member_had_prior_access

        db = FakeSession(row=SimpleNamespace(holds_role_now=True, granted_before=False))

        answer = await _member_had_prior_access(
            db, tenant_id=uuid4(), operator_id=str(uuid4())
        )

        assert answer is True
        assert db.savepoints_opened == 1
        assert db.savepoints_exited_with_error == 0

    @pytest.mark.asyncio
    async def test_either_signal_alone_is_enough(self):
        from app.api.v1.endpoints.operations import _member_had_prior_access

        for holds, granted in ((True, False), (False, True), (True, True)):
            db = FakeSession(
                row=SimpleNamespace(holds_role_now=holds, granted_before=granted)
            )
            assert (
                await _member_had_prior_access(
                    db, tenant_id=uuid4(), operator_id=str(uuid4())
                )
                is True
            )

        db = FakeSession(
            row=SimpleNamespace(holds_role_now=False, granted_before=False)
        )
        assert (
            await _member_had_prior_access(
                db, tenant_id=uuid4(), operator_id=str(uuid4())
            )
            is False
        )


def _app_with(db) -> FastAPI:
    """The route, with the REAL prior-access helper and a failing session."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        require_coord_tenant_admin,
        require_coord_tenant_admin_target,
    )
    from app.api.v1.endpoints.operations import router as operations_router
    from app.db.session import get_async_db

    app = FastAPI()
    user = MagicMock()
    user.id = uuid4()
    user.is_superuser = False
    tenant = uuid4()
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[require_coord_tenant_admin] = lambda: tenant
    app.dependency_overrides[require_coord_tenant_admin_target] = lambda: tenant
    app.dependency_overrides[get_async_db] = lambda: db
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    app.include_router(operations_router, prefix=API_PREFIX)
    return app


def _mock_response(json_data):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = json_data
    resp.content = b"x"
    resp.text = str(json_data)
    return resp


class TestTheRouteSurvivesAFailedRead:
    def test_the_grant_still_answers_200_and_reports_not_sent(self):
        """End to end with the real helper: a database that fails the check
        must not fail the grant, and must not claim an email went out."""
        from app.services.cognito_admin import CognitoIdentity

        db = FakeSession(failure=RuntimeError("column does not exist"))

        with (
            patch(
                "app.services.cognito_admin.resolve_identity_for_email",
                MagicMock(
                    return_value=CognitoIdentity(
                        username="u1", sub="s-1", status="CONFIRMED"
                    )
                ),
            ),
            patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient,
            patch(
                "app.api.v1.endpoints.operations._member_added_notice_composer"
            ) as composer_factory,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [
                _mock_response({"operator_id": "op-1"}),
                _mock_response({"ok": True}),
            ]
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance

            resp = TestClient(_app_with(db)).post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "colleague@x.io", "role": "operator"},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "added"
        assert body["operator_id"] == "op-1"
        # UNKNOWN reads as "nothing was sent, tell them yourself".
        assert body["notice"] == "not_sent"
        # The grant really happened — both coord writes.
        assert instance.post.call_count == 2
        # The real statement was attempted, inside a savepoint.
        assert db.executed == 1
        assert db.savepoints_opened == 1
        # No email was even considered.
        composer_factory.assert_not_called()
