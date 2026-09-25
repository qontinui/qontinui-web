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
from pathlib import Path
from unittest.mock import MagicMock, patch
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


async def _make_image(
    db, log: RenderLog, *, file_path: str | None = None
) -> RenderImage:
    image = RenderImage(
        render_log_id=log.id,
        image_type="screenshot",
        file_path=file_path or f"missing_{uuid4().hex}.png",
        file_size_bytes=1,
        mime_type="image/png",
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return image


class _Env:
    """A client plus the users it can authenticate as, by bearer."""

    def __init__(self, client: httpx.AsyncClient, db, image_dir: Path) -> None:
        self.client = client
        self.db = db
        # A subdirectory, so a test can place a file just OUTSIDE it.
        self.image_dir = image_dir
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
    e = _Env(client, async_db_session, tmp_path / "images")

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
            "app.jobs.render_log_retention.settings.RENDER_LOG_IMAGE_DIR",
            str(e.image_dir),
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
async def test_image_upload_filename_ignores_the_client_session_id(env):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="../../escape")

    response = await _upload(env, alice, mine, "x.png")

    assert response.status_code == 201, response.text
    stored = response.json()["file_path"]
    assert "/" not in stored and "\\" not in stored and ".." not in stored
    assert (env.image_dir / stored).is_file()


async def _upload(
    env,
    user: User,
    log: RenderLog,
    filename: str,
    *,
    content: bytes = b"png",
    content_type: str = "image/png",
):
    return await env.client.post(
        f"{PREFIX}/{log.id}/images",
        params={"image_type": "screenshot"},
        files={"file": (filename, content, content_type)},
        headers=env.auth(user),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("filename", ["x.html", "x.png.", "x", "x.svg", "x.png.exe"])
async def test_image_upload_rejects_a_non_allowlisted_extension(env, filename):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")

    response = await _upload(env, alice, mine, filename)

    assert response.status_code == 422, response.text
    rows = await env.db.execute(
        select(RenderImage.id).where(RenderImage.render_log_id == mine.id)
    )
    assert rows.all() == []
    assert not env.image_dir.exists() or not any(env.image_dir.iterdir())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filename", "expected_mime"),
    [
        ("x.png", "image/png"),
        ("x.JPG", "image/jpeg"),
        ("x.jpeg", "image/jpeg"),
        ("x.webp", "image/webp"),
        ("x.gif", "image/gif"),
    ],
)
async def test_image_upload_mime_type_is_derived_from_the_extension(
    env, filename, expected_mime
):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")

    # The client's Content-Type is a lie; it must not be what gets stored.
    response = await _upload(env, alice, mine, filename, content_type="text/html")

    assert response.status_code == 201, response.text
    assert response.json()["mime_type"] == expected_mime
    assert response.json()["file_path"].endswith(Path(filename).suffix.lower())


@pytest.mark.asyncio
async def test_image_upload_over_the_size_cap_is_413_in_the_handler(env):
    """The handler's bounded read: the body passes the Content-Length check
    (framing allowance) but the file part itself is over the cap."""
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")

    with patch("app.api.v1.endpoints.render_logs.MAX_RENDER_IMAGE_BYTES", 4):
        at_cap = await _upload(env, alice, mine, "x.png", content=b"1234")
        over = await _upload(env, alice, mine, "x.png", content=b"12345")

    assert at_cap.status_code == 201, at_cap.text
    assert over.status_code == 413, over.text
    assert over.json()["detail"].startswith("Image too large"), over.text
    rows = await env.db.execute(
        select(RenderImage.id).where(RenderImage.render_log_id == mine.id)
    )
    assert len(rows.all()) == 1


@pytest.mark.asyncio
async def test_superuser_cannot_upload_to_another_users_log(env):
    admin = await _make_user(env.db, superuser=True)
    bob = await _make_user(env.db)
    bobs = await _make_log(env.db, bob, session_id="bob-s")

    response = await _upload(env, admin, bobs, "x.png")

    assert response.status_code == 404, response.text
    rows = await env.db.execute(
        select(RenderImage.id).where(RenderImage.render_log_id == bobs.id)
    )
    assert rows.all() == []


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


@pytest.mark.asyncio
async def test_superuser_sees_every_row_on_list_sessions_and_stats(env):
    admin = await _make_user(env.db, superuser=True)
    alice = await _make_user(env.db)
    bob = await _make_user(env.db)
    tag = uuid4().hex[:8]
    alices = await _make_log(env.db, alice, session_id=f"alice-{tag}")
    bobs = await _make_log(env.db, bob, session_id=f"bob-{tag}")
    anon = await _make_log(env.db, None, session_id=f"anon-{tag}")
    await _make_image(env.db, bobs)

    listed = await env.client.get(
        PREFIX, params={"page_size": 200}, headers=env.auth(admin)
    )
    assert listed.status_code == 200, listed.text
    ids = {item["id"] for item in listed.json()["items"]}
    assert {alices.id, bobs.id, anon.id} <= ids

    sessions = await env.client.get(
        f"{PREFIX}/sessions", params={"limit": 200}, headers=env.auth(admin)
    )
    assert sessions.status_code == 200, sessions.text
    names = {s["session_id"] for s in sessions.json()}
    assert {f"alice-{tag}", f"bob-{tag}", f"anon-{tag}"} <= names

    admin_stats = (
        await env.client.get(f"{PREFIX}/stats", headers=env.auth(admin))
    ).json()
    alice_stats = (
        await env.client.get(f"{PREFIX}/stats", headers=env.auth(alice))
    ).json()
    assert alice_stats["total_snapshots"] == 1
    assert alice_stats["image_count"] == 0
    assert admin_stats["total_snapshots"] >= 3
    assert admin_stats["total_sessions"] >= 3
    assert admin_stats["image_count"] >= 1


# ---------------------------------------------------------------------------
# Deleting image files never leaves the storage directory
# ---------------------------------------------------------------------------


def _outside_victim(env: _Env) -> Path:
    """A file just outside the image dir, which a ``../`` row value names."""
    env.image_dir.mkdir(parents=True, exist_ok=True)
    victim = env.image_dir.parent / f"victim_{uuid4().hex}.png"
    victim.write_bytes(b"do not delete")
    return victim


@pytest.mark.asyncio
async def test_superuser_delete_skips_an_image_path_outside_storage(env):
    admin = await _make_user(env.db, superuser=True)
    alice = await _make_user(env.db)
    session_id = f"s-{uuid4().hex[:8]}"
    log = await _make_log(env.db, alice, session_id=session_id)
    victim = _outside_victim(env)
    inside = env.image_dir / "inside.png"
    inside.write_bytes(b"png")
    await _make_image(env.db, log, file_path=f"../{victim.name}")
    await _make_image(env.db, log, file_path="inside.png")

    response = await env.client.request(
        "DELETE",
        PREFIX,
        json={"confirm": True, "session_id": session_id},
        headers=env.auth(admin),
    )

    assert response.status_code == 200, response.text
    assert response.json()["deleted_images"] == 2
    assert response.json()["deleted_files"] == 1
    assert victim.is_file(), "a ../ file_path unlinked a file outside storage"
    assert not inside.exists()


# ---------------------------------------------------------------------------
# The scheduled retention job
# ---------------------------------------------------------------------------


def test_render_log_retention_is_scheduled_hourly_and_at_boot():
    from app.core.scheduler import (
        SchedulerService,
        _job_render_log_retention,
        install_default_tasks,
    )

    service = SchedulerService()
    install_default_tasks(service)

    task = service._tasks["render_log_retention"]
    assert task.coro is _job_render_log_retention
    assert task.interval_seconds == 3600.0
    assert task.run_at_boot


@pytest.mark.asyncio
async def test_scheduled_retention_job_deletes_expired_rows_and_files_only(env):
    """Drive the REAL scheduler job coroutine end to end.

    ``_run_committed`` opens ``AsyncSessionLocal()``; it is pointed at this
    test's session so the job's delete and commit land where the assertions
    read, and roll back with the test.
    """
    from app.core.scheduler import _job_render_log_retention

    alice = await _make_user(env.db)
    old = await _make_log(env.db, alice, session_id="alice-s", age=timedelta(days=30))
    fresh = await _make_log(env.db, alice, session_id="alice-s")
    orphan_old = await _make_log(
        env.db, None, session_id="anon-s", age=timedelta(days=8)
    )
    victim = _outside_victim(env)
    old_file = env.image_dir / "old.png"
    old_file.write_bytes(b"png")
    fresh_file = env.image_dir / "fresh.png"
    fresh_file.write_bytes(b"png")
    await _make_image(env.db, old, file_path="old.png")
    await _make_image(env.db, old, file_path=f"../{victim.name}")
    await _make_image(env.db, fresh, file_path="fresh.png")

    class _SessionCtx:
        async def __aenter__(self):
            return env.db

        async def __aexit__(self, *exc):
            return False

    with patch("app.db.session.AsyncSessionLocal", lambda: _SessionCtx()):
        result = await _job_render_log_retention()

    assert result["deleted_images"] >= 2
    assert result["deleted_files"] == 1
    assert result["deleted_snapshots"] >= 2
    remaining = await env.db.execute(
        select(RenderLog.id).where(RenderLog.id.in_([old.id, fresh.id, orphan_old.id]))
    )
    assert remaining.scalars().all() == [fresh.id]
    assert not old_file.exists()
    assert fresh_file.is_file()
    assert victim.is_file(), "a ../ file_path unlinked a file outside storage"


# ---------------------------------------------------------------------------
# Pre-parse Content-Length check on the upload route
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_over_content_length_is_refused_before_the_form_is_parsed(env):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")
    # If the form were parsed, this raises and the response is a 500, not 413.
    form_spy = MagicMock(side_effect=AssertionError("form was parsed"))

    with (
        patch("app.api.v1.endpoints.render_logs.MAX_RENDER_IMAGE_BYTES", 4),
        patch("app.api.v1.endpoints.render_logs.MULTIPART_OVERHEAD_BYTES", 0),
        patch("starlette.requests.Request.form", form_spy),
    ):
        response = await _upload(env, alice, mine, "x.png", content=b"12345")

    assert response.status_code == 413, response.text
    assert response.json()["detail"].startswith("Request body too large")
    form_spy.assert_not_called()


@pytest.mark.asyncio
async def test_upload_without_content_length_is_411(env):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")

    async def _chunked():
        yield b"--b\r\n"
        yield b"--b--\r\n"

    response = await env.client.post(
        f"{PREFIX}/{mine.id}/images",
        params={"image_type": "screenshot"},
        content=_chunked(),
        headers={"content-type": "multipart/form-data; boundary=b", **env.auth(alice)},
    )

    assert response.status_code == 411, response.text


@pytest.mark.asyncio
async def test_upload_with_a_traversal_filename_stays_in_storage(env):
    alice = await _make_user(env.db)
    mine = await _make_log(env.db, alice, session_id="alice-s")

    response = await _upload(env, alice, mine, "../../evil.png")

    assert response.status_code == 201, response.text
    stored = response.json()["file_path"]
    assert ".." not in stored and "evil" not in stored
    assert (env.image_dir / stored).is_file()
    assert not (env.image_dir.parent / "evil.png").exists()
    assert not (env.image_dir.parent.parent / "evil.png").exists()


# ---------------------------------------------------------------------------
# unlink_stored_images: containment and per-file failure tolerance
# ---------------------------------------------------------------------------


def test_unlink_skips_an_absolute_path_outside_storage(tmp_path):
    from app.jobs.render_log_retention import unlink_stored_images

    storage = tmp_path / "images"
    storage.mkdir()
    victim = tmp_path / "victim.png"
    victim.write_bytes(b"do not delete")
    inside = storage / "inside.png"
    inside.write_bytes(b"png")

    deleted = unlink_stored_images(storage, [str(victim.resolve()), "inside.png"])

    assert deleted == 1
    assert victim.is_file()
    assert not inside.exists()


def test_unlink_skips_a_path_whose_resolution_fails(tmp_path):
    """A symlink loop makes resolve() raise; that entry is skipped, not fatal."""
    from app.jobs.render_log_retention import unlink_stored_images

    storage = tmp_path / "images"
    storage.mkdir()
    ok = storage / "ok.png"
    ok.write_bytes(b"png")
    real_resolve = Path.resolve

    def _resolve(self, strict=False):
        if self.name == "loop.png":
            raise RuntimeError(f"Symlink loop from {self!r}")
        return real_resolve(self, strict=strict)

    with patch.object(Path, "resolve", _resolve):
        deleted = unlink_stored_images(storage, ["loop.png", "ok.png"])

    assert deleted == 1
    assert not ok.exists()


def test_unlink_tolerates_a_missing_file(tmp_path):
    from app.jobs.render_log_retention import unlink_stored_images

    storage = tmp_path / "images"
    storage.mkdir()

    assert unlink_stored_images(storage, ["never-existed.png"]) == 0


def _unlink_denied_for(name: str):
    real_unlink = Path.unlink

    def _unlink(self, missing_ok=False):
        if self.name == name:
            raise PermissionError(13, "Permission denied", str(self))
        return real_unlink(self, missing_ok=missing_ok)

    return patch.object(Path, "unlink", _unlink)


@pytest.mark.asyncio
async def test_retention_survives_an_unlink_permission_error(env):
    """One undeletable file must not abort the row DELETE or the other files."""
    from app.jobs.render_log_retention import delete_render_logs_older_than_retention

    alice = await _make_user(env.db)
    old = await _make_log(env.db, alice, session_id="alice-s", age=timedelta(days=30))
    env.image_dir.mkdir(parents=True, exist_ok=True)
    locked = env.image_dir / "locked.png"
    locked.write_bytes(b"png")
    other = env.image_dir / "other.png"
    other.write_bytes(b"png")
    await _make_image(env.db, old, file_path="locked.png")
    await _make_image(env.db, old, file_path="other.png")

    with _unlink_denied_for("locked.png"):
        outcome = await delete_render_logs_older_than_retention(env.db)

    assert outcome.deleted_files == 1
    assert locked.is_file()
    assert not other.exists()
    gone = await env.db.execute(select(RenderLog.id).where(RenderLog.id == old.id))
    assert gone.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_superuser_delete_survives_an_unlink_permission_error(env):
    admin = await _make_user(env.db, superuser=True)
    alice = await _make_user(env.db)
    session_id = f"s-{uuid4().hex[:8]}"
    log = await _make_log(env.db, alice, session_id=session_id)
    env.image_dir.mkdir(parents=True, exist_ok=True)
    (env.image_dir / "locked.png").write_bytes(b"png")
    await _make_image(env.db, log, file_path="locked.png")

    with _unlink_denied_for("locked.png"):
        response = await env.client.request(
            "DELETE",
            PREFIX,
            json={"confirm": True, "session_id": session_id},
            headers=env.auth(admin),
        )

    assert response.status_code == 200, response.text
    assert response.json()["deleted_snapshots"] == 1
    assert response.json()["deleted_files"] == 0


@pytest.mark.asyncio
async def test_retention_deletes_in_committed_id_ordered_chunks(env):
    from app.jobs import render_log_retention as retention

    alice = await _make_user(env.db)
    olds = [
        await _make_log(env.db, alice, session_id="alice-s", age=timedelta(days=30))
        for _ in range(3)
    ]

    with (
        patch.object(retention, "RETENTION_CHUNK_ROWS", 1),
        patch.object(env.db, "commit", wraps=env.db.commit) as commit_spy,
    ):
        outcome = await retention.delete_render_logs_older_than_retention(env.db)

    assert outcome.deleted_snapshots >= 3
    # One commit per one-row chunk, at least for the three rows made here.
    assert commit_spy.await_count >= 3
    assert commit_spy.await_count == outcome.deleted_snapshots
    left = await env.db.execute(
        select(RenderLog.id).where(RenderLog.id.in_([o.id for o in olds]))
    )
    assert left.all() == []


# ---------------------------------------------------------------------------
# RENDER_LOG_RETENTION_DAYS validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("days", [0, -1])
def test_retention_days_below_one_is_rejected(days):
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="RENDER_LOG_RETENTION_DAYS"):
        Settings(RENDER_LOG_RETENTION_DAYS=days)


def test_retention_days_of_one_is_accepted():
    from app.core.config import Settings

    assert Settings(RENDER_LOG_RETENTION_DAYS=1).RENDER_LOG_RETENTION_DAYS == 1
