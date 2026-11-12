"""DELETE /api/v1/devices/{device_id} refuses a CI-registrar row (coord finding
``98118771``; plan
``2026-11-07-a-pre-registered-ci-registrar-row-keeps-the-squatters-owner-and-home``).

A ``coord.devices`` row whose ``capabilities`` carry ``"ci_runner"`` belongs to
coord's CI-runner registrar. It has an owner (``user_id``) only once it has been
squatted and claimed, and that owner could delete it through this door. The
delete cascades away the registrar's own ``coord.tenant_devices`` owner edge
until the registrar's next tick re-creates the row. Pinned here, through the
served route against the test Postgres:

* the owner of a marked row gets 409 ``device_is_ci_runner`` and the row is
  byte-identical afterwards;
* the same row without the marker is deleted (204), as before;
* a caller who does not own a marked row still gets 403 and a missing row still
  404, so the 409 tells nobody but the row's owner that an id is a registrar
  row;
* the decision is taken under the row's lock, so the registrar cannot mark the
  row between the delete's read and its DELETE.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from qontinui_schemas.common import utc_now
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.device import Device
from app.models.user import User

pytestmark = pytest.mark.asyncio

API_PREFIX = "/api/v1/devices"
_REFUSAL = "device_is_ci_runner"


async def _new_user(maker: Any, tag: str) -> User:
    async with maker() as db:
        user = User(
            email=f"cidel_{tag}_{uuid4()}@example.com",
            username=f"cidel_{tag}_{uuid4().hex[:8]}",
            full_name="CI Runner Delete Test",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


@pytest_asyncio.fixture
async def env(test_engine) -> AsyncGenerator[SimpleNamespace, None]:
    """Two committed users (the row's owner and someone else) and a device id.

    Committed, not held in ``async_db_session``'s rolled-back transaction: the
    route opens its own session, and the lock test needs a second connection.
    """
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    owner = await _new_user(maker, "owner")
    other = await _new_user(maker, "other")
    device_id = uuid4()
    try:
        yield SimpleNamespace(
            maker=maker, owner=owner, other=other, device_id=device_id
        )
    finally:
        async with maker() as db:
            await db.execute(
                text("DELETE FROM coord.devices WHERE device_id = :d"),
                {"d": str(device_id)},
            )
            for user in (owner, other):
                await db.execute(
                    text("DELETE FROM auth.users WHERE id = :u"), {"u": str(user.id)}
                )
            await db.commit()


async def _seed(env: SimpleNamespace, *, marked: bool) -> None:
    """The squatted, claimed shape: the owner holds it, paired, and the registrar
    may since have marked it."""
    async with env.maker() as db:
        db.add(
            Device(
                device_id=env.device_id,
                user_id=env.owner.id,
                name="gh-runner-merytshost",
                hostname="gh-runner-merytshost@qontinui/qontinui-coord",
                os="linux",
                capabilities=["os:linux", "ci_runner"] if marked else ["os:linux"],
                capability_user_paired=True,
                paired_at=utc_now(),
                state="healthy",
                derived_status="offline",
                ci_runner_status="idle",
                ci_runner_labels=["self-hosted", "linux", "x64"],
                last_seen_at=utc_now(),
            )
        )
        await db.commit()


async def _row_image(env: SimpleNamespace) -> str | None:
    """The whole stored row as Postgres renders it, or None when it is gone."""
    async with env.maker() as db:
        return (
            await db.execute(
                text(
                    "SELECT to_jsonb(d.*)::text FROM coord.devices d "
                    "WHERE d.device_id = :d"
                ),
                {"d": str(env.device_id)},
            )
        ).scalar_one_or_none()


def _app(
    env: SimpleNamespace,
    caller: User,
    on_session: Callable[[AsyncSession], None] | None = None,
) -> FastAPI:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.devices import router

    app = FastAPI()
    app.dependency_overrides[get_current_active_user_async] = lambda: caller

    async def _db() -> AsyncGenerator[AsyncSession, None]:
        async with env.maker() as session:
            if on_session is not None:
                on_session(session)
            yield session

    app.dependency_overrides[get_async_db] = _db
    app.include_router(router, prefix=API_PREFIX)
    return app


async def _delete(
    env: SimpleNamespace,
    caller: User,
    on_session: Callable[[AsyncSession], None] | None = None,
) -> httpx.Response:
    transport = httpx.ASGITransport(app=_app(env, caller, on_session))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.delete(f"{API_PREFIX}/{env.device_id}")


async def test_the_owner_of_a_ci_runner_row_cannot_delete_it(env) -> None:
    await _seed(env, marked=True)
    before = await _row_image(env)

    response = await _delete(env, env.owner)

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == _REFUSAL
    assert detail["error"] == _REFUSAL
    assert await _row_image(env) == before, "the marked row was deleted or changed"


async def test_the_same_row_without_the_marker_is_deleted(env) -> None:
    """The control: an unmarked row its owner deletes is gone, as before."""
    await _seed(env, marked=False)

    response = await _delete(env, env.owner)

    assert response.status_code == 204, response.text
    assert await _row_image(env) is None


async def test_a_caller_who_does_not_own_a_ci_runner_row_still_gets_403(env) -> None:
    """Ownership is decided first, so the marker is disclosed only to the row's
    owner, who can already see the row."""
    await _seed(env, marked=True)
    before = await _row_image(env)

    response = await _delete(env, env.other)

    assert response.status_code == 403, response.text
    assert _REFUSAL not in response.text
    assert await _row_image(env) == before


async def test_a_missing_row_is_still_404(env) -> None:
    response = await _delete(env, env.owner)

    assert response.status_code == 404, response.text


#: PostgreSQL's ``lock_not_available``: what a statement that ``lock_timeout``
#: cancelled raises.
_LOCK_NOT_AVAILABLE = "55P03"


def _is_lock_timeout(exc: DBAPIError) -> bool:
    """Whether ``exc`` is a ``lock_timeout`` cancellation, and not some other
    failure that could pass for one. asyncpg's own exception carries the
    SQLSTATE; it is the cause of the driver error that SQLAlchemy wraps."""
    cause = getattr(exc.orig, "__cause__", None)
    return getattr(cause, "sqlstate", None) == _LOCK_NOT_AVAILABLE


async def test_a_mark_cannot_land_while_the_delete_decides(env) -> None:
    """The row is unmarked when the delete reads it. The registrar then tries to
    mark it before the DELETE runs. Under the row's lock that write has to wait,
    and here it gives up after 300 ms with a lock timeout, so the delete removes
    the row it decided on. Without the lock the mark would commit, and the
    DELETE would remove a marked row. Only a lock timeout counts as blocked: any
    other failure of the mark fails the test instead of passing it."""
    await _seed(env, marked=False)
    outcome: list[str] = []

    def mark_before_the_delete(session: AsyncSession) -> None:
        real_delete = session.delete

        async def delete(instance: Any) -> None:
            try:
                async with env.maker() as registrar:
                    await registrar.execute(text("SET LOCAL lock_timeout = '300ms'"))
                    await registrar.execute(
                        text(
                            "UPDATE coord.devices SET capabilities = "
                            "CAST('[\"ci_runner\"]' AS jsonb) WHERE device_id = :d"
                        ),
                        {"d": str(env.device_id)},
                    )
                    await registrar.commit()
                outcome.append("marked")
            except DBAPIError as exc:
                outcome.append(
                    "blocked" if _is_lock_timeout(exc) else f"failed: {exc!r}"
                )
            await real_delete(instance)

        session.delete = delete  # type: ignore[method-assign]

    response = await _delete(env, env.owner, mark_before_the_delete)

    assert outcome == ["blocked"], f"the mark was not held off by the lock: {outcome}"
    assert response.status_code == 204, response.text
    assert await _row_image(env) is None
