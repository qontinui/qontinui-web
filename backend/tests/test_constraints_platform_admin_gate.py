"""Every ``/api/v1/constraints`` route is for ACTIVE platform admins only.

Coord finding ``5a6791e9-607c-4658-82e2-3b509e459996``: the constraints routes
depended only on ``current_active_user``, and each forwards to the runner on
the backend's own host, which admits the hop to every route with full local
trust. So any active signed-in user could ``POST /constraints/config`` a
``constraints.toml`` whose ``type = "command"`` check that runner's workflow
loop executes, read the config found from any path, and drive the runner's
other constraints routes. The router now depends on ``require_admin``.

These tests drive the PRODUCTION app (``app.main:app``) over HTTP (httpx's
ASGI transport), so the routes are reached at their mounted paths, through the
production error handler and the REAL dependency chain: the router's
``require_admin`` -> ``get_current_active_user_async`` -> fastapi-users'
``current_user(active=True)``. Only the two token verifiers are stubbed.
Cognito's maps a bearer string to a user row in real Postgres
(``QONTINUI_TEST_PG_DSN``). The device verifier accepts :data:`DEVICE_TOKEN` as
a coord device JWT paired to an active platform admin, so the device case is
the strongest one: a credential that verifies, for an admin's device, is still
not a user session. The runner is a stand-in, a real HTTP server on loopback
that records every request (``tests/_constraints_stand_in.py``), and what it
RECEIVED is the evidence: nothing at all for any refused caller, and exactly
the forwarded request for an admin.
"""

from __future__ import annotations

import tomllib
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.api.v1.endpoints import constraints
from app.models.user import User
from tests._constraints_stand_in import (
    DEFAULTS,
    RESULTS,
    StandInRunner,
    envelope,
    serving_stand_in,
)

PREFIX = "/api/v1/constraints"

#: The sentence ``require_admin`` refuses a non-admin with, as a LITERAL: the
#: frontend keys its admin-only state on exactly this text
#: (``frontend/src/lib/api/fleet.ts`` ``PLATFORM_ADMIN_REFUSAL``).
REFUSAL_SENTENCE = "Not authorized. Admin access required."

#: A device credential the stubbed device verifier accepts (see the module
#: docstring); the Cognito verifier does not know it.
DEVICE_TOKEN = "coord-device-jwt-for-an-admins-device"

#: What a non-admin could plant before the gate: a command check the runner's
#: workflow loop executes. It is laid out as the web's own generator writes one
#: (``@qontinui/workflow-utils`` ``generateConstraintToml``), with the keys the
#: runner reads: its ``CheckConfig::Command`` (qontinui-runner
#: ``src-tauri/src/constraint_engine/config.rs``) takes the command as ``cmd``,
#: and a config it cannot parse is answered ``valid: false`` and not written.
COMMAND_TOML = (
    "[[constraint]]\n"
    'id = "project:planted"\n'
    'name = "Planted"\n'
    'severity = "warn"\n'
    "\n"
    "[constraint.check]\n"
    'type = "command"\n'
    'cmd = "echo planted"\n'
)

#: A task-run id of a shape the runner mints.
TASK_RUN_ID = "trigger-wf-1700000000000-ab12cd34"


def test_the_planted_config_is_a_command_check_in_the_runners_keys() -> None:
    """:data:`COMMAND_TOML` is the payload the module says it is: one custom
    constraint whose check is a ``command`` the runner would run, spelled as
    the runner parses it (``cmd``; ``cwd`` and ``timeout_secs`` default)."""
    (constraint,) = tomllib.loads(COMMAND_TOML)["constraint"]

    assert constraint["id"].startswith("project:")
    assert constraint["check"] == {"type": "command", "cmd": "echo planted"}


@dataclass(frozen=True)
class Call:
    """One constraints route, called as the UI calls it, and what an admin's
    call must make the runner receive."""

    method: str
    #: The route's path template on the constraints router.
    route: str
    #: The request URL under :data:`PREFIX`.
    url: str
    json: dict[str, Any] | None
    #: The request target the runner must receive for an admin.
    runner_target: str
    runner_body: Any
    #: What the runner answers it with, which the proxy returns verbatim.
    answer: Any


CALLS = [
    Call(
        "GET",
        "/active",
        "/active?project_path=/srv/acme",
        None,
        "/constraints/active?project_path=%2Fsrv%2Facme",
        None,
        DEFAULTS[("GET", "/constraints/active")],
    ),
    Call(
        "GET",
        "/config",
        "/config?project_path=/srv/acme",
        None,
        "/constraints/config?project_path=%2Fsrv%2Facme",
        None,
        DEFAULTS[("GET", "/constraints/config")],
    ),
    Call(
        "POST",
        "/config",
        "/config",
        {"project_path": "/srv/acme", "toml": COMMAND_TOML},
        "/constraints/config",
        {"project_path": "/srv/acme", "toml": COMMAND_TOML},
        DEFAULTS[("POST", "/constraints/config")],
    ),
    Call(
        "POST",
        "/validate",
        "/validate",
        {"toml": COMMAND_TOML},
        "/constraints/validate",
        {"toml": COMMAND_TOML},
        DEFAULTS[("POST", "/constraints/validate")],
    ),
    Call(
        "GET",
        "/results/{task_run_id}",
        f"/results/{TASK_RUN_ID}?iteration=2",
        None,
        f"/constraints/results/{TASK_RUN_ID}?iteration=2",
        None,
        envelope(RESULTS),
    ),
]


def _call_id(call: Call) -> str:
    return f"{call.method} {call.route}"


async def _make_user(db: Any, *, superuser: bool, active: bool = True) -> User:
    user = User(
        email=f"constraints_{uuid4().hex[:12]}@example.com",
        username=f"constraints_{uuid4().hex[:8]}",
        full_name="Constraints Gate",
        cognito_sub=f"sub-{uuid4().hex[:12]}",
        is_active=active,
        is_superuser=superuser,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class _Env:
    """The production app on one client, the stand-in runner, and the users
    the stubbed Cognito verifier signs in."""

    def __init__(
        self, client: httpx.AsyncClient, db: Any, runner: StandInRunner
    ) -> None:
        self.client = client
        self.db = db
        self.runner = runner
        self.tokens: dict[str, User] = {}

    async def user(self, *, superuser: bool, active: bool = True) -> User:
        return await _make_user(self.db, superuser=superuser, active=active)

    def bearer(self, user: User) -> dict[str, str]:
        token = f"token-{uuid4().hex}"
        self.tokens[token] = user
        return {"Authorization": f"Bearer {token}"}

    async def send(self, call: Call, headers: dict[str, str]) -> httpx.Response:
        return await self.client.request(
            call.method, f"{PREFIX}{call.url}", json=call.json, headers=headers
        )


@pytest_asyncio.fixture()
async def env(
    async_db_session: Any, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[_Env]:
    from app.api import deps
    from app.api.deps import get_async_db
    from app.auth.cognito_user import CognitoAuthError
    from app.main import app

    device_owner = await _make_user(async_db_session, superuser=True)
    device_claims = {
        "device_id": str(uuid4()),
        "user_id": str(device_owner.id),
        "tenant_id": str(uuid4()),
    }

    async def _verify_device(token: str) -> tuple[dict[str, Any], User]:
        if token != DEVICE_TOKEN:
            raise HTTPException(status_code=401, detail="unknown test device token")
        return device_claims, device_owner

    monkeypatch.setattr(deps, "_verify_device_jwt", _verify_device)

    async def _db() -> AsyncIterator[Any]:
        yield async_db_session

    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = _db
    try:
        with serving_stand_in(monkeypatch) as runner:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                e = _Env(client, async_db_session, runner)

                async def _verify_cognito(token: str, _session: Any) -> User:
                    user = e.tokens.get(token)
                    if user is None:
                        raise CognitoAuthError("unknown test token")
                    return user

                monkeypatch.setattr(
                    "app.auth.cognito_user.verify_cognito_token_and_resolve_user",
                    _verify_cognito,
                )
                yield e
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)


def test_the_table_names_every_constraints_route() -> None:
    """:data:`CALLS` is every route the constraints router serves, so a route
    added to it later is driven through every case below or this fails."""
    served = {
        (method, route.path)
        for route in constraints.router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }
    assert served == {(call.method, call.route) for call in CALLS}


# ---------------------------------------------------------------------------
# Refused, and nothing reaches the runner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("call", CALLS, ids=_call_id)
async def test_a_non_admin_is_refused_and_nothing_reaches_the_runner(
    env: _Env, call: Call
) -> None:
    member = await env.user(superuser=False)

    response = await env.send(call, env.bearer(member))

    # One assertion, so a gate that let the call through reports BOTH halves.
    assert (response.status_code, env.runner.received) == (403, []), response.text
    body = response.json()
    assert body["message"] == REFUSAL_SENTENCE
    assert body["error"] == "FORBIDDEN"
    refusal = body["refusal"]
    assert (
        refusal["code"],
        refusal["discriminator"],
        refusal["next_action"]["kind"],
        refusal["detail"],
        refusal["source"],
    ) == (
        "permission_denied",
        "platform_admin_required",
        "none_terminal",
        REFUSAL_SENTENCE,
        "web_backend",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("call", CALLS, ids=_call_id)
async def test_an_inactive_platform_admin_is_refused_and_nothing_reaches_the_runner(
    env: _Env, call: Call
) -> None:
    admin = await env.user(superuser=True, active=False)

    response = await env.send(call, env.bearer(admin))

    # fastapi-users' ``current_user(active=True)`` refuses an inactive user
    # with 401 before ``require_admin`` reads ``is_superuser``.
    assert (response.status_code, env.runner.received) == (401, []), response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("call", CALLS, ids=_call_id)
async def test_a_device_jwt_is_refused_even_for_an_admins_device(
    env: _Env, call: Call
) -> None:
    response = await env.send(call, {"Authorization": f"Bearer {DEVICE_TOKEN}"})

    assert (response.status_code, env.runner.received) == (401, []), response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("call", CALLS, ids=_call_id)
async def test_no_credential_is_refused_and_nothing_reaches_the_runner(
    env: _Env, call: Call
) -> None:
    response = await env.send(call, {})

    assert (response.status_code, env.runner.received) == (401, []), response.text


# ---------------------------------------------------------------------------
# Allowed: an active platform admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("call", CALLS, ids=_call_id)
async def test_an_active_platform_admin_reaches_the_runner(
    env: _Env, call: Call
) -> None:
    admin = await env.user(superuser=True)
    headers = env.bearer(admin)

    response = await env.send(call, headers)

    assert response.status_code == 200, response.text
    assert response.json() == call.answer
    assert [(r.method, r.target, r.body) for r in env.runner.received] == [
        (call.method, call.runner_target, call.runner_body)
    ]
    # The admin's own credential stays on this side of the hop.
    forwarded = env.runner.received[0].headers
    assert "authorization" not in forwarded
    assert headers["Authorization"].split()[1] not in str(forwarded)
