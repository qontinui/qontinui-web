"""``/api/v1/fleet/apps`` is for ACTIVE platform admins only.

Coord finding ``b27adf71-4de5-49bc-ad89-7a8acd372035``: ``PATCH
/api/v1/fleet/apps/{app_id}`` (``update_app_config``) and ``GET
/api/v1/fleet/apps`` (``list_apps``) depended only on
``get_current_active_user_async``. So ANY signed-in user could rewrite ANY
app's ``build_command`` / ``start_command`` / ``update_strategy`` in
``project.apps`` — commands the runner's auto-fresh engine runs with
``sh -c`` / ``cmd /C`` on every fleet machine that auto-freshes the app
(qontinui-runner ``fleet.rs`` ``run_build_command`` /
``execute_build_and_restart``) — and read the whole unpartitioned registry,
commands included. Both routes now depend on ``require_admin``.

These tests drive the REAL dependency chain (``require_admin`` →
``get_current_active_user_async`` → fastapi-users'
``current_user(active=True)``), not overrides of it: only the Cognito token
verifier is stubbed, mapping a bearer string to a user row. So an inactive
superuser really meets fastapi-users' 401, and a non-superuser really meets
``require_admin``'s 403. The database is real Postgres (``QONTINUI_TEST_PG_DSN``),
and "the row is unchanged" is read back with a column ``SELECT``, which always
round-trips to the database (autoflushing anything a handler staged first), so
it observes what the route actually wrote.

The 403 body is pinned exactly: the fleet UI renders its "limited to platform
administrators" state only for THIS refusal (``frontend/src/lib/api/fleet.ts``
``PLATFORM_ADMIN_REFUSAL``), so rewording ``ADMIN_REQUIRED_DETAIL`` without the
frontend would turn that state into a generic error.
"""

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select

from app.api.admin_deps import ADMIN_REQUIRED_DETAIL
from app.models.app_registry import App
from app.models.user import User

PREFIX = "/api/v1/fleet"

#: The row every test starts from: (update_strategy, build_command, start_command).
ORIGINAL = ("pull_build", "npm run build", "npm start")

#: A rewrite of all three columns, so a refused PATCH that leaked through on any
#: one of them is visible in the read-back.
REWRITE = {
    "update_strategy": "pull_only",
    "build_command": "echo rewritten-build",
    "start_command": "echo rewritten-start",
}
REWRITTEN = ("pull_only", "echo rewritten-build", "echo rewritten-start")


# ---------------------------------------------------------------------------
# Wiring
# ---------------------------------------------------------------------------


def _build_app(db: Any) -> FastAPI:
    from app.api.deps import get_async_db
    from app.api.v1.endpoints.fleet_targets import router

    app = FastAPI()
    # Only the DB session is overridden. ``get_user_db`` depends on
    # ``get_async_db`` too, so the auth path resolves users from this session.
    app.dependency_overrides[get_async_db] = lambda: db
    app.include_router(router, prefix=PREFIX)
    return app


async def _make_user(db: Any, *, superuser: bool, active: bool = True) -> User:
    user = User(
        email=f"fleetapps_{uuid4().hex[:12]}@example.com",
        username=f"fleetapps_{uuid4().hex[:8]}",
        full_name="Fleet Apps",
        cognito_sub=f"sub-{uuid4().hex[:12]}",
        is_active=active,
        is_superuser=superuser,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_app(db: Any) -> str:
    """Register one app with the :data:`ORIGINAL` config; return its id."""
    app_id = f"fleet-apps-{uuid4().hex[:8]}"
    strategy, build, start = ORIGINAL
    db.add(
        App(
            app_id=app_id,
            repo_root="/code/acme",
            ui_bridge_url="http://127.0.0.1:9999",
            display_name="Acme App",
            created_at_ms=0,
            last_seen_at_ms=0,
            update_strategy=strategy,
            build_command=build,
            start_command=start,
        )
    )
    await db.commit()
    return app_id


async def _config_of(db: Any, app_id: str) -> tuple[str, str | None, str | None]:
    """The row's three fleet-config columns, read from the database."""
    row = (
        await db.execute(
            select(App.update_strategy, App.build_command, App.start_command).where(
                App.app_id == app_id
            )
        )
    ).one()
    return (row.update_strategy, row.build_command, row.start_command)


class _Env:
    """A client plus the users it can authenticate as, by bearer."""

    def __init__(self, client: httpx.AsyncClient, db: Any) -> None:
        self.client = client
        self.db = db
        self.tokens: dict[str, User] = {}

    def auth(self, user: User) -> dict[str, str]:
        token = f"token-{uuid4().hex}"
        self.tokens[token] = user
        return {"Authorization": f"Bearer {token}"}

    async def call(self, method: str, app_id: str, user: User) -> httpx.Response:
        """``GET /apps`` or ``PATCH /apps/{app_id}`` (with :data:`REWRITE`)."""
        if method == "GET":
            return await self.client.get(f"{PREFIX}/apps", headers=self.auth(user))
        return await self.client.patch(
            f"{PREFIX}/apps/{app_id}", json=REWRITE, headers=self.auth(user)
        )


@pytest_asyncio.fixture()
async def env(async_db_session: Any) -> AsyncIterator[_Env]:
    app = _build_app(async_db_session)
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )
    e = _Env(client, async_db_session)

    async def _verify(token: str, _session: Any) -> User:
        from app.auth.cognito_user import CognitoAuthError

        user = e.tokens.get(token)
        if user is None:
            raise CognitoAuthError("unknown test token")
        return user

    with patch(
        "app.auth.cognito_user.verify_cognito_token_and_resolve_user",
        side_effect=_verify,
    ):
        async with client:
            yield e


# ---------------------------------------------------------------------------
# Refused: an active user who is not a platform admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_non_superuser_cannot_read_the_registry(env: _Env) -> None:
    member = await _make_user(env.db, superuser=False)
    app_id = await _make_app(env.db)

    response = await env.call("GET", app_id, member)

    assert response.status_code == 403, response.text
    # The whole body: the refusal the frontend keys on, and no registry row.
    assert response.json() == {"detail": ADMIN_REQUIRED_DETAIL}


@pytest.mark.asyncio
async def test_a_non_superuser_cannot_rewrite_commands_and_the_row_is_unchanged(
    env: _Env,
) -> None:
    member = await _make_user(env.db, superuser=False)
    app_id = await _make_app(env.db)

    response = await env.call("PATCH", app_id, member)

    # One assertion, so a gate that let the write through reports BOTH halves:
    # the status it answered and the columns it changed.
    assert (response.status_code, await _config_of(env.db, app_id)) == (
        403,
        ORIGINAL,
    ), response.text
    assert response.json() == {"detail": ADMIN_REQUIRED_DETAIL}


# ---------------------------------------------------------------------------
# Refused: a superuser whose account is deactivated
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["GET", "PATCH"])
async def test_an_inactive_superuser_is_refused(env: _Env, method: str) -> None:
    admin = await _make_user(env.db, superuser=True, active=False)
    app_id = await _make_app(env.db)

    response = await env.call(method, app_id, admin)

    # fastapi-users' ``current_user(active=True)`` refuses an inactive user
    # with 401 before ``require_admin`` reads ``is_superuser``.
    assert (response.status_code, await _config_of(env.db, app_id)) == (
        401,
        ORIGINAL,
    ), response.text
    assert "build_command" not in response.text


# ---------------------------------------------------------------------------
# Allowed: an active platform admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_active_superuser_reads_the_registry(env: _Env) -> None:
    admin = await _make_user(env.db, superuser=True)
    app_id = await _make_app(env.db)

    response = await env.call("GET", app_id, admin)

    assert response.status_code == 200, response.text
    rows = {row["app_id"]: row for row in response.json()}
    strategy, build, start = ORIGINAL
    assert rows[app_id] == {
        "app_id": app_id,
        "display_name": "Acme App",
        "repo_root": "/code/acme",
        "update_strategy": strategy,
        "build_command": build,
        "start_command": start,
    }


@pytest.mark.asyncio
async def test_an_active_superuser_rewrites_the_config(env: _Env) -> None:
    admin = await _make_user(env.db, superuser=True)
    app_id = await _make_app(env.db)

    response = await env.call("PATCH", app_id, admin)

    assert response.status_code == 200, response.text
    assert await _config_of(env.db, app_id) == REWRITTEN
    body = response.json()
    assert (body["update_strategy"], body["build_command"], body["start_command"]) == (
        REWRITTEN
    )
