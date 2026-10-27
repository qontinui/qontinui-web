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

The refusal SENTENCE is a wire contract. The fleet UI renders its "limited to
platform administrators" state only for this refusal, matched by strict
equality against ``frontend/src/lib/api/fleet.ts`` ``PLATFORM_ADMIN_REFUSAL``,
so a rewording of ``ADMIN_REQUIRED_DETAIL`` on this side alone would show every
non-admin a generic load error instead. It is pinned three ways: the 403 tests
compare the body with the LITERAL :data:`REFUSAL_SENTENCE` (never with the
constant the route sends, which would follow a rewording), in both wire shapes
the UI reads (a bare app's ``detail``, production's ``message``);
:func:`test_the_fleet_ui_keys_on_the_sentence_this_backend_sends` reads
``fleet.ts`` and checks it declares exactly ``ADMIN_REQUIRED_DETAIL``, so a
rewording of the constant and the literal together is still red here; and the
frontend's ``src/lib/api/fleet.test.ts`` checks ``app/api/admin_deps.py`` from
its side, so a frontend-only rewording is red there. Each side's CI is
path-filtered, so each file the other side reads is in that side's filters:
``fleet.ts`` in ``backend-ci.yml``
(:func:`test_backend_ci_runs_this_module_on_a_fleet_ts_only_change`) and
``admin_deps.py`` in ``frontend-ci.yml`` (asserted in ``fleet.test.ts``). A
change to either file alone then runs the check that reads it, in its own PR.
"""

import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
import yaml  # type: ignore[import-untyped]
from fastapi import FastAPI
from sqlalchemy import select
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.admin_deps import ADMIN_REQUIRED_DETAIL
from app.middleware.error_handler import http_exception_handler
from app.models.app_registry import App
from app.models.user import User

PREFIX = "/api/v1/fleet"

#: The refusal sentence, as a LITERAL. ``frontend/src/lib/api/fleet.ts``
#: ``PLATFORM_ADMIN_REFUSAL`` keys on exactly this text, so changing it is a
#: wire change for both sides, made in both files and both tests at once.
REFUSAL_SENTENCE = "Not authorized. Admin access required."

#: The two shapes a refusal reaches the fleet UI in, by the key carrying the
#: sentence: a bare FastAPI app's ``{"detail": ...}``, and the production
#: envelope ``app.main`` serves through ``http_exception_handler``.
WIRES = ["detail", "message"]

# backend/tests/x.py -> parents[2] is the repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_FLEET_UI_API = _REPO_ROOT / "frontend" / "src" / "lib" / "api" / "fleet.ts"
_BACKEND_CI = _REPO_ROOT / ".github" / "workflows" / "backend-ci.yml"
_PLATFORM_ADMIN_REFUSAL_DECL = re.compile(
    r'^export const PLATFORM_ADMIN_REFUSAL = "(?P<sentence>[^"\\]*)";$',
    re.MULTILINE,
)

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


def _build_app(db: Any, *, wire: str) -> FastAPI:
    from app.api.deps import get_async_db
    from app.api.v1.endpoints.fleet_targets import router

    app = FastAPI()
    # Only the DB session is overridden. ``get_user_db`` depends on
    # ``get_async_db`` too, so the auth path resolves users from this session.
    app.dependency_overrides[get_async_db] = lambda: db
    app.include_router(router, prefix=PREFIX)
    if wire == "message":
        # ``app.main``'s handler: the error envelope production serves. The
        # ignore is ``app.main``'s own: Starlette types the handler slot as
        # taking ``Exception``, and this handler is narrowed to HTTPException.
        app.add_exception_handler(
            StarletteHTTPException,
            http_exception_handler,  # type: ignore[arg-type]
        )
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
    """One client per wire shape, plus the users they authenticate as."""

    def __init__(self, clients: dict[str, httpx.AsyncClient], db: Any) -> None:
        self.clients = clients
        self.db = db
        self.tokens: dict[str, User] = {}

    def auth(self, user: User) -> dict[str, str]:
        token = f"token-{uuid4().hex}"
        self.tokens[token] = user
        return {"Authorization": f"Bearer {token}"}

    async def call(
        self, method: str, app_id: str, user: User, *, wire: str = "detail"
    ) -> httpx.Response:
        """``GET /apps`` or ``PATCH /apps/{app_id}`` (with :data:`REWRITE`)."""
        client = self.clients[wire]
        if method == "GET":
            return await client.get(f"{PREFIX}/apps", headers=self.auth(user))
        return await client.patch(
            f"{PREFIX}/apps/{app_id}", json=REWRITE, headers=self.auth(user)
        )


def _assert_admin_refusal(response: httpx.Response, wire: str) -> None:
    """The whole body: the sentence the frontend keys on, and no registry row.

    Production's envelope also nests ``require_admin``'s typed refusal under
    ``refusal`` (``app.core.refusal``); a bare app serves the sentence alone.
    """
    body = response.json()
    if wire == "detail":
        assert body == {"detail": REFUSAL_SENTENCE}
    else:
        assert set(body) == {"error", "message", "timestamp", "path", "refusal"}, body
        assert (body["error"], body["message"]) == ("FORBIDDEN", REFUSAL_SENTENCE)
        refusal = body["refusal"]
        assert (
            refusal["code"],
            refusal["discriminator"],
            refusal["next_action"],
            refusal["detail"],
        ) == (
            "permission_denied",
            "platform_admin_required",
            {"kind": "none_terminal"},
            REFUSAL_SENTENCE,
        )


@pytest_asyncio.fixture()
async def env(async_db_session: Any) -> AsyncIterator[_Env]:
    clients = {
        wire: httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_build_app(async_db_session, wire=wire)),
            base_url="http://testserver",
        )
        for wire in WIRES
    }
    e = _Env(clients, async_db_session)

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
        async with clients["detail"], clients["message"]:
            yield e


# ---------------------------------------------------------------------------
# Refused: an active user who is not a platform admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("wire", WIRES)
async def test_a_non_superuser_cannot_read_the_registry(env: _Env, wire: str) -> None:
    member = await _make_user(env.db, superuser=False)
    app_id = await _make_app(env.db)

    response = await env.call("GET", app_id, member, wire=wire)

    assert response.status_code == 403, response.text
    _assert_admin_refusal(response, wire)


@pytest.mark.asyncio
@pytest.mark.parametrize("wire", WIRES)
async def test_a_non_superuser_cannot_rewrite_commands_and_the_row_is_unchanged(
    env: _Env, wire: str
) -> None:
    member = await _make_user(env.db, superuser=False)
    app_id = await _make_app(env.db)

    response = await env.call("PATCH", app_id, member, wire=wire)

    # One assertion, so a gate that let the write through reports BOTH halves:
    # the status it answered and the columns it changed.
    assert (response.status_code, await _config_of(env.db, app_id)) == (
        403,
        ORIGINAL,
    ), response.text
    _assert_admin_refusal(response, wire)


def test_the_fleet_ui_keys_on_the_sentence_this_backend_sends() -> None:
    """``fleet.ts`` declares ``PLATFORM_ADMIN_REFUSAL`` as exactly this sentence.

    The 403 tests above pin the literal, which a rewording of BOTH the constant
    and :data:`REFUSAL_SENTENCE` would get past; the frontend would then still
    compare against the old sentence and show every non-admin a generic error.
    This reads the consumer's declaration and fails closed when it cannot.
    """
    if not _FLEET_UI_API.is_file():
        pytest.fail(
            f"{_FLEET_UI_API} is missing, so the frontend's copy of the refusal "
            "sentence cannot be checked; fail rather than pass on nothing."
        )
    match = _PLATFORM_ADMIN_REFUSAL_DECL.search(
        _FLEET_UI_API.read_text(encoding="utf-8")
    )
    assert match is not None, (
        f"{_FLEET_UI_API} no longer declares "
        '`export const PLATFORM_ADMIN_REFUSAL = "...";` on one line. If it moved '
        "or changed shape, retarget this check; do not delete it."
    )
    assert match.group("sentence") == ADMIN_REQUIRED_DETAIL, (
        "The fleet UI keys its platform-admin state on "
        f"{match.group('sentence')!r}, but require_admin refuses with "
        f"{ADMIN_REQUIRED_DETAIL!r}. Change both together."
    )


def test_backend_ci_runs_this_module_on_a_fleet_ts_only_change() -> None:
    """A frontend-only PR that reshapes ``PLATFORM_ADMIN_REFUSAL`` must run the
    check above in ITS OWN CI.

    Backend CI is path-filtered. Without ``fleet.ts`` in both filters, such a
    PR runs no Backend CI at all, and the check first fails on a later,
    unrelated backend PR or on the nightly run (the path-scoped-gate trap
    ``backend-ci.yml`` documents).
    """
    workflow = yaml.safe_load(_BACKEND_CI.read_text(encoding="utf-8"))
    # PyYAML reads the bare key ``on`` as the boolean True (YAML 1.1).
    triggers = workflow.get("on", workflow.get(True))
    relative = _FLEET_UI_API.relative_to(_REPO_ROOT).as_posix()
    for trigger in ("pull_request", "push"):
        paths = triggers[trigger]["paths"]
        assert relative in paths, (
            f"{relative} is not in backend-ci.yml `on.{trigger}.paths`, so a "
            "change to it alone never runs "
            "test_the_fleet_ui_keys_on_the_sentence_this_backend_sends."
        )


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
