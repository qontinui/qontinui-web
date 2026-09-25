"""The render-logs router authenticates every route and scopes reads to the owner.

Coord finding ``966c92eb``: ``/api/v1/render-logs`` had no authentication on
any route except create (which took an *optional* user). Anyone could list and
read every tenant's stored DOM snapshots, ``DELETE ""`` with
``{"confirm": true}`` deleted every row, and ``POST /cleanup`` ran a committed
cross-tenant retention delete; coord's route observer hit it anonymously
12,063 times in 14 days, each answering 200.

These tests drive the REAL fastapi-users dependencies
(``get_current_active_user_async`` / ``get_current_superuser_async``), not
overrides of them: only the Cognito token verifier is stubbed, mapping a bearer
string to a user row. So a missing token really yields fastapi-users' 401 and a
non-superuser really yields its 403. The database is real Postgres, and every
scoping assertion reads rows that exist in it. Post-request checks are
column ``SELECT``s, which always round-trip to the database, so they see what
the route actually deleted.
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select

from app.models.render_log import RenderImage, RenderLog
from app.models.user import User

PREFIX = "/api/v1/render-logs"


# ---------------------------------------------------------------------------
# Wiring
# ---------------------------------------------------------------------------


def _build_app(db) -> FastAPI:
    from app.api.deps import get_async_db
    from app.api.v1.endpoints.render_logs import router

    app = FastAPI()
    # Only the DB session is overridden. ``get_user_db`` depends on
    # ``get_async_db`` too, so the auth path resolves users from this session.
    app.dependency_overrides[get_async_db] = lambda: db
    app.include_router(router, prefix=PREFIX)
    return app


async def _make_user(db, *, superuser: bool = False) -> User:
    user = User(
        email=f"renderlogs_{uuid4().hex[:12]}@example.com",
        username=f"renderlogs_{uuid4().hex[:8]}",
        full_name="Render Logs",
        cognito_sub=f"sub-{uuid4().hex[:12]}",
        is_active=True,
        is_superuser=superuser,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_log(
    db, owner: User | None, *, session_id: str, age: timedelta = timedelta(0)
) -> RenderLog:
    log = RenderLog(
        session_id=session_id,
        page_url="https://app.example/page",
        page_title="Page",
        trigger="initial",
        snapshot={"root": {"tag": "body"}},
        element_count=1,
        user_id=owner.id if owner else None,
        timestamp=datetime.now(UTC) - age,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log


async def _make_image(db, log: RenderLog) -> RenderImage:
    image = RenderImage(
        render_log_id=log.id,
        image_type="screenshot",
        file_path=f"missing_{uuid4().hex}.png",
        file_size_bytes=1,
        mime_type="image/png",
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return image


class _Env:
    """A client plus the users it can authenticate as, by bearer."""

    def __init__(self, client: httpx.AsyncClient, db) -> None:
        self.client = client
        self.db = db
        self.tokens: dict[str, User] = {}

    def auth(self, user: User) -> dict[str, str]:
        token = f"token-{uuid4().hex}"
        self.tokens[token] = user
        return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture()
async def env(async_db_session, tmp_path) -> AsyncIterator[_Env]:
    app = _build_app(async_db_session)
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )
    e = _Env(client, async_db_session)

    async def _verify(token: str, _session) -> User:
        from app.auth.cognito_user import CognitoAuthError

        user = e.tokens.get(token)
        if user is None:
            raise CognitoAuthError("unknown test token")
        return user

    with (
        patch(
            "app.auth.cognito_user.verify_cognito_token_and_resolve_user",
            side_effect=_verify,
        ),
        patch(
            "app.api.v1.endpoints.render_logs.settings.RENDER_LOG_IMAGE_DIR",
            str(tmp_path),
        ),
    ):
        async with client:
            yield e


# ---------------------------------------------------------------------------
# Unauthenticated: every route answers 401 and touches nothing
# ---------------------------------------------------------------------------

_CREATE_BODY = {
    "session_id": "anon",
    "page_url": "https://app.example/page",
    "trigger": "initial",
    "snapshot": {"root": {}},
}

UNAUTHENTICATED_CASES = [
    ("GET", f"{PREFIX}/stats", None),
    ("GET", f"{PREFIX}/sessions", None),
    ("GET", PREFIX, None),
    ("GET", f"{PREFIX}/1", None),
    ("POST", PREFIX, _CREATE_BODY),
    ("POST", f"{PREFIX}/1/images?image_type=screenshot", "file"),
    ("DELETE", PREFIX, {"confirm": True}),
    ("POST", f"{PREFIX}/cleanup", None),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "url", "body"),
    UNAUTHENTICATED_CASES,
    ids=[f"{m} {u.removeprefix(PREFIX) or '/'}" for m, u, _ in UNAUTHENTICATED_CASES],
)
async def test_every_route_rejects_an_anonymous_caller(env, method, url, body):
    owner = await _make_user(env.db)
    old = await _make_log(env.db, owner, session_id="s-old", age=timedelta(days=30))

    kwargs: dict = {}
    if body == "file":
        kwargs["files"] = {"file": ("x.png", b"png", "image/png")}
    elif body is not None:
        kwargs["json"] = body

    response = await env.client.request(method, url, **kwargs)

    assert response.status_code == 401, response.text
    # Neither destructive route ran: the 30-day-old row is still there.
    still = await env.db.execute(select(RenderLog.id).where(RenderLog.id == old.id))
    assert still.scalar_one_or_none() == old.id


@pytest.mark.asyncio
async def test_an_invalid_bearer_is_rejected(env):
    response = await env.client.get(
        PREFIX, headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Owner scoping for normal users
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_returns_only_the_callers_rows(env):
    alice = await _make_user(env.db)
    bob = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")
    await _make_log(env.db, bob, session_id="bob-s")
    await _make_log(env.db, None, session_id="anon-s")

    response = await env.client.get(PREFIX, headers=env.auth(alice))

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body["items"]] == [mine.id]
    assert body["total"] == 1

    # Filtering by another user's session id does not widen the scope.
    response = await env.client.get(
        PREFIX, params={"session_id": "bob-s"}, headers=env.auth(alice)
    )
    assert response.json()["items"] == []


@pytest.mark.asyncio
async def test_sessions_returns_only_the_callers_sessions(env):
    alice = await _make_user(env.db)
    bob = await _make_user(env.db)
    await _make_log(env.db, alice, session_id="alice-s")
    await _make_log(env.db, bob, session_id="bob-s")
    await _make_log(env.db, None, session_id="anon-s")

    response = await env.client.get(f"{PREFIX}/sessions", headers=env.auth(alice))

    assert response.status_code == 200, response.text
    assert [s["session_id"] for s in response.json()] == ["alice-s"]


@pytest.mark.asyncio
async def test_get_of_another_users_log_is_404(env):
    alice = await _make_user(env.db)
    bob = await _make_user(env.db)
    bobs = await _make_log(env.db, bob, session_id="bob-s")
    await _make_image(env.db, bobs)
    anon = await _make_log(env.db, None, session_id="anon-s")

    for log_id in (bobs.id, anon.id):
        response = await env.client.get(f"{PREFIX}/{log_id}", headers=env.auth(alice))
        assert response.status_code == 404, response.text

    # The owner still reads it, images included.
    response = await env.client.get(f"{PREFIX}/{bobs.id}", headers=env.auth(bob))
    assert response.status_code == 200, response.text
    assert len(response.json()["images"]) == 1


@pytest.mark.asyncio
async def test_stats_count_only_the_callers_rows_and_images(env):
    alice = await _make_user(env.db)
    bob = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")
    await _make_image(env.db, mine)
    bobs = await _make_log(env.db, bob, session_id="bob-s")
    await _make_image(env.db, bobs)
    await _make_image(env.db, bobs)
    await _make_log(env.db, None, session_id="anon-s")

    response = await env.client.get(f"{PREFIX}/stats", headers=env.auth(alice))

    assert response.status_code == 200, response.text
    stats = response.json()
    assert stats["total_snapshots"] == 1
    assert stats["total_sessions"] == 1
    assert stats["image_count"] == 1


@pytest.mark.asyncio
async def test_image_upload_to_another_users_log_is_404(env):
    alice = await _make_user(env.db)
    bob = await _make_user(env.db)
    bobs = await _make_log(env.db, bob, session_id="bob-s")

    response = await env.client.post(
        f"{PREFIX}/{bobs.id}/images",
        params={"image_type": "screenshot"},
        files={"file": ("x.png", b"png", "image/png")},
        headers=env.auth(alice),
    )

    assert response.status_code == 404, response.text
    count = await env.db.execute(
        select(RenderImage.id).where(RenderImage.render_log_id == bobs.id)
    )
    assert count.all() == []


@pytest.mark.asyncio
async def test_image_upload_filename_ignores_the_client_session_id(env, tmp_path):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="../../escape")

    response = await env.client.post(
        f"{PREFIX}/{mine.id}/images",
        params={"image_type": "screenshot"},
        files={"file": ("x.p/../ng", b"png", "image/png")},
        headers=env.auth(alice),
    )

    assert response.status_code == 201, response.text
    stored = response.json()["file_path"]
    assert "/" not in stored and "\\" not in stored and ".." not in stored
    assert (tmp_path / stored).is_file()


@pytest.mark.asyncio
async def test_create_stamps_the_caller_as_owner(env):
    alice = await _make_user(env.db)

    response = await env.client.post(PREFIX, json=_CREATE_BODY, headers=env.auth(alice))

    assert response.status_code == 201, response.text
    row = await env.db.execute(
        select(RenderLog.user_id).where(RenderLog.id == response.json()["id"])
    )
    assert row.scalar_one() == alice.id


# ---------------------------------------------------------------------------
# Destructive routes: superuser only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_normal_user_gets_403_on_delete_and_nothing_is_deleted(env):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")

    response = await env.client.request(
        "DELETE", PREFIX, json={"confirm": True}, headers=env.auth(alice)
    )

    assert response.status_code == 403, response.text
    row = await env.db.execute(select(RenderLog.id).where(RenderLog.id == mine.id))
    assert row.scalar_one_or_none() == mine.id


@pytest.mark.asyncio
async def test_normal_user_gets_403_on_cleanup_and_nothing_is_deleted(env):
    alice = await _make_user(env.db)
    old = await _make_log(env.db, alice, session_id="alice-s", age=timedelta(days=30))

    response = await env.client.post(f"{PREFIX}/cleanup", headers=env.auth(alice))

    assert response.status_code == 403, response.text
    row = await env.db.execute(select(RenderLog.id).where(RenderLog.id == old.id))
    assert row.scalar_one_or_none() == old.id


@pytest.mark.asyncio
async def test_superuser_can_run_cleanup(env):
    admin = await _make_user(env.db, superuser=True)
    alice = await _make_user(env.db)
    old = await _make_log(env.db, alice, session_id="alice-s", age=timedelta(days=30))
    fresh = await _make_log(env.db, alice, session_id="alice-s")

    response = await env.client.post(f"{PREFIX}/cleanup", headers=env.auth(admin))

    assert response.status_code == 200, response.text
    assert response.json()["deleted_snapshots"] >= 1
    remaining = await env.db.execute(
        select(RenderLog.id).where(RenderLog.id.in_([old.id, fresh.id]))
    )
    assert remaining.scalars().all() == [fresh.id]


@pytest.mark.asyncio
async def test_superuser_can_delete_by_session_and_before_together(env):
    admin = await _make_user(env.db, superuser=True)
    alice = await _make_user(env.db)
    session_id = f"s-{uuid4().hex[:8]}"
    old = await _make_log(env.db, alice, session_id=session_id, age=timedelta(days=3))
    await _make_image(env.db, old)
    fresh = await _make_log(env.db, alice, session_id=session_id)

    response = await env.client.request(
        "DELETE",
        PREFIX,
        json={
            "confirm": True,
            "session_id": session_id,
            "before": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
        },
        headers=env.auth(admin),
    )

    assert response.status_code == 200, response.text
    assert response.json()["deleted_snapshots"] == 1
    assert response.json()["deleted_images"] == 1
    remaining = await env.db.execute(
        select(RenderLog.id).where(RenderLog.session_id == session_id)
    )
    assert remaining.scalars().all() == [fresh.id]


@pytest.mark.asyncio
async def test_superuser_reads_every_row_including_ownerless_ones(env):
    admin = await _make_user(env.db, superuser=True)
    bob = await _make_user(env.db)
    bobs = await _make_log(env.db, bob, session_id="bob-s")
    anon = await _make_log(env.db, None, session_id="anon-s")

    for log_id in (bobs.id, anon.id):
        response = await env.client.get(f"{PREFIX}/{log_id}", headers=env.auth(admin))
        assert response.status_code == 200, response.text
