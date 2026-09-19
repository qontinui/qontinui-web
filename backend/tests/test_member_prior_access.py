"""``_member_had_prior_access`` — the check that stops a repeated add mailing.

The route sends the member-added notice only on a definite ``False`` from
this helper. Everything here pins that decision and the direction it fails
in.

**Why it reads coord over HTTP rather than querying coord's tables.** An
earlier version answered the same question with two ``EXISTS`` against
``coord.operator_roles`` and ``coord.operator_audit`` over the request's own
database session. ``tests/test_coord_schema_boundary_guard.py`` rejected it:
web makes ZERO direct reads of coord's Postgres schema, and
``READ_BOUNDARY_CLOSED`` is deliberately the EMPTY set so that its emptiness
IS the invariant. The replacement goes through ``_proxy_coord_get``, the same
helper every other coord interaction in that module already uses, so there is
no database session on this path at all — which is also why the savepoint
this file used to test is gone: its reason went with the SQL, not because it
was wrong.

**What the check is worth, and what it is not.** "They do not currently hold
a role in this tenant." That collapses the repeated-add case, which is the
product requirement. It does not survive a revoke — revoke then re-add sends
again — and it is read-then-act with no atomicity, so concurrent submits can
all read ``False`` and all send. Neither property was better under the SQL
version.

**The one-sided degradation.** Coord's ``GET /admin/coord/operators`` is
today scoped ``WHERE o.tenant_id = $1`` (the operator's HOME tenant), so a
colleague homed elsewhere is not listed even while holding a role here; coord
PR 2224 widens it to everyone holding a role in the tenant. Until that
deploys the check UNDER-reports membership, so the worst case is a duplicate
notice. It can never wrongly suppress one. ``test_an_unlisted_operator_reads_as_new``
pins that this is the behaviour, deliberately, rather than a latent bug.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded

from app.middleware.rate_limit import rate_limit_exceeded_handler, user_limiter

API_PREFIX = "/api/v1/operations"

_SUB = "sub-9f3c"


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    user_limiter.reset()
    yield
    user_limiter.reset()


def _operator(sso_subject: str = _SUB, roles=("operator",)) -> dict:
    return {
        "operator_id": str(uuid4()),
        "email": "colleague@x.io",
        "display_name": None,
        "sso_provider": "cognito",
        "sso_subject": sso_subject,
        "last_login_at": None,
        "created_at": "2026-08-01T00:00:00Z",
        "roles": list(roles),
    }


async def _ask(payload=None, *, raises: BaseException | None = None):
    from app.api.v1.endpoints.operations import _member_had_prior_access

    proxy = AsyncMock(side_effect=raises) if raises else AsyncMock(return_value=payload)
    with patch("app.api.v1.endpoints.operations._proxy_coord_get", proxy):
        answer = await _member_had_prior_access(tenant_id=uuid4(), sso_subject=_SUB)
    return answer, proxy


class TestTheReadItself:
    @pytest.mark.asyncio
    async def test_it_narrows_by_sso_subject_on_coords_own_route(self):
        """The subject is the right key and the cheap one: it is IdP-issued
        and unique on ``(sso_provider, sso_subject)``, whereas
        ``coord.operators.email`` is neither unique nor immutable — and
        narrowing server-side returns one row instead of the tenant."""
        _, proxy = await _ask({"operators": [_operator()]})

        proxy.assert_awaited_once()
        assert proxy.await_args.args[0] == "/admin/coord/operators"
        assert proxy.await_args.kwargs["params"] == {"sso_subject": _SUB}
        # The bearer is forwarded so coord can scope the read.
        assert "tenant_id" in proxy.await_args.kwargs

    @pytest.mark.asyncio
    async def test_a_listed_operator_holding_a_role_had_access(self):
        answer, _ = await _ask({"operators": [_operator(roles=("operator",))]})
        assert answer is True

    @pytest.mark.asyncio
    async def test_any_role_counts_not_the_one_being_granted(self):
        """A colleague promoted from Developer to Administrator has already
        been told about this team, so the check must not narrow by role."""
        answer, _ = await _ask({"operators": [_operator(roles=("admin",))]})
        assert answer is True

    @pytest.mark.asyncio
    async def test_a_listed_operator_holding_no_role_is_new(self):
        """Provisioned but ungranted — coord returns the row with an empty
        ``roles`` array. They have never had access, so they get the notice."""
        answer, _ = await _ask({"operators": [_operator(roles=())]})
        assert answer is False

    @pytest.mark.asyncio
    async def test_an_unlisted_operator_reads_as_new(self):
        """The documented one-sided degradation, pinned as intended
        behaviour. Before coord PR 2224 a cross-home colleague is absent from
        this list even while holding a role here, so the check under-reports
        and the cost is a duplicate notice — never a suppressed one."""
        answer, _ = await _ask({"operators": []})
        assert answer is False

    @pytest.mark.asyncio
    async def test_a_row_for_somebody_else_is_ignored(self):
        """Guards against a coord build that ignores ``sso_subject`` and
        answers with the whole tenant: matching on the subject locally means
        a stranger's roles can never be read as this person's."""
        answer, _ = await _ask({"operators": [_operator(sso_subject="sub-other")]})
        assert answer is False


class TestItFailsTowardsSilence:
    @pytest.mark.asyncio
    async def test_a_raising_proxy_is_unknown(self):
        answer, _ = await _ask(raises=httpx.ConnectError("refused"))
        assert answer is None

    @pytest.mark.asyncio
    async def test_a_body_with_no_operators_list_is_unknown(self):
        """A 200 whose shape drifted is UNKNOWN, never an empty membership.
        Reading a missing list as "they are new here" would send the notice
        on every call the moment coord's response changed."""
        for payload in ({"unexpected": True}, {"operators": "nope"}, None, []):
            answer, _ = await _ask(payload)
            assert answer is None, payload

    @pytest.mark.asyncio
    async def test_unknown_is_not_false(self):
        """The load-bearing distinction. ``False`` sends; ``None`` does not.
        Collapsing them would send on every unreadable check, which is the
        unbounded behaviour the check exists to remove."""
        unknown, _ = await _ask(raises=RuntimeError("boom"))
        new, _ = await _ask({"operators": []})
        assert unknown is None
        assert new is False


def _app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        require_coord_tenant_admin,
        require_coord_tenant_admin_target,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    user = MagicMock()
    user.id = uuid4()
    user.is_superuser = False
    tenant = uuid4()
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[require_coord_tenant_admin] = lambda: tenant
    app.dependency_overrides[require_coord_tenant_admin_target] = lambda: tenant
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


class TestTheRouteSurvivesAnUnreadableCheck:
    def test_an_unknown_check_answers_200_and_reports_not_sent(self):
        """End to end with the REAL helper: a coord read that fails must not
        fail a grant whose two writes both committed, and must not claim an
        email went out."""
        from app.services.cognito_admin import CognitoIdentity

        with (
            patch(
                "app.services.cognito_admin.resolve_identity_for_email",
                MagicMock(
                    return_value=CognitoIdentity(
                        username="u1", sub=_SUB, status="CONFIRMED"
                    )
                ),
            ),
            patch(
                "app.api.v1.endpoints.operations._proxy_coord_get",
                AsyncMock(side_effect=httpx.ConnectError("refused")),
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

            resp = TestClient(_app()).post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "colleague@x.io", "role": "operator"},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "added"
        assert body["operator_id"] == "op-1"
        assert body["notice"] == "not_sent"
        # The grant really happened — both coord writes.
        assert instance.post.call_count == 2
        # And no email was even considered.
        composer_factory.assert_not_called()

    def test_the_check_runs_before_the_role_grant(self):
        """Order is the mechanism. Coord's own write is what makes the
        question unanswerable: after the grant the operator holds a role
        either way, so a check made afterwards answers "they already had
        access" for every caller, forever."""
        from app.services.cognito_admin import CognitoIdentity

        order: list[str] = []

        async def _prior_access(*_a, **_k):
            order.append("prior_access")
            return {"operators": []}

        with (
            patch(
                "app.services.cognito_admin.resolve_identity_for_email",
                MagicMock(
                    return_value=CognitoIdentity(
                        username="u1", sub=_SUB, status="CONFIRMED"
                    )
                ),
            ),
            patch(
                "app.api.v1.endpoints.operations._proxy_coord_get",
                AsyncMock(side_effect=_prior_access),
            ),
            patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient,
            patch("app.api.v1.endpoints.operations._member_added_notice_composer"),
        ):
            instance = AsyncMock()
            responses = [
                _mock_response({"operator_id": "op-1"}),
                _mock_response({"ok": True}),
            ]

            async def _post(url, *args, **kwargs):
                order.append("coord:" + url.rsplit("/admin/coord", 1)[-1])
                return responses.pop(0)

            instance.post.side_effect = _post
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance

            resp = TestClient(_app()).post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "colleague@x.io", "role": "operator"},
            )

        assert resp.status_code == 200, resp.text
        # The operator upsert first (it mints the id), then the check, then
        # the ROLE grant.
        assert order == [
            "coord:/operators",
            "prior_access",
            "coord:/operators/op-1/roles",
        ]
