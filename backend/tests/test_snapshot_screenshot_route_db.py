"""``GET /integration-testing/snapshots/{run_id}/screenshot/{path}`` against Postgres.

The route presigns a storage key named in the URL. Before 2026-10-03 it signed
any key for any caller who could see SOME run, so another tenant's object was
one URL away. It now signs only a path recorded as one of THAT run's
``Screenshot`` rows. This pins both halves against real rows: a path that
belongs to run A, requested through run B (which the caller owns), is a 404;
the same path through run A redirects to a working signed URL.

``SnapshotRun.run_id`` is a VARCHAR column; the route used to compare it with a
``uuid.UUID`` bind parameter, which asyncpg refuses — a request against real
Postgres is the only thing that exercises that.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.storage import object_storage
from app.services.storage.local_backend import LocalBackend

pytestmark = pytest.mark.asyncio

PREFIX = "/api/v1/integration-testing"
BYTES = b"run-a-screenshot"


@pytest_asyncio.fixture()
async def owner(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"snap_{uuid4().hex[:8]}@example.com",
        username=f"snap_{uuid4().hex[:8]}",
        full_name="Snapshot Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


async def _run(db: AsyncSession, owner, screenshot_path: str | None):
    from app.models.project import Project
    from app.models.snapshot import Screenshot, SnapshotRun

    project = Project(name=f"p-{uuid4().hex[:6]}", configuration={}, owner_id=owner.id)
    db.add(project)
    await db.flush()
    run = SnapshotRun(
        run_id=str(uuid4()),
        run_name="run",
        project_id=project.id,
        timestamp=datetime.now(UTC),
    )
    db.add(run)
    await db.flush()
    if screenshot_path is not None:
        db.add(
            Screenshot(
                snapshot_run_id=run.id,
                screenshot_path=screenshot_path,
                active_states=[],
                timestamp=datetime.now(UTC),
                width=1,
                height=1,
                state_hash="0" * 64,
            )
        )
    await db.commit()
    return run


@pytest_asyncio.fixture()
async def storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> LocalBackend:
    backend = LocalBackend(base_path=tmp_path / "uploads")
    monkeypatch.setattr(object_storage, "backend", backend)
    return backend


def _app(db: AsyncSession, user) -> FastAPI:
    from app.api.deps import current_active_user, get_async_db
    from app.api.local_storage import router as local_storage_router
    from app.api.v1.endpoints.integration_testing import router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user

    async def _db():
        yield db

    app.dependency_overrides[get_async_db] = _db
    app.include_router(router, prefix=PREFIX)
    app.include_router(local_storage_router)
    return app


async def test_a_path_from_another_run_is_not_signed(
    async_db_session: AsyncSession, owner, storage: LocalBackend
) -> None:
    key = f"snapshots/{uuid4()}.png"
    storage.upload_file(io.BytesIO(BYTES), key)
    await _run(async_db_session, owner, key)  # run A owns the path
    run_b = await _run(async_db_session, owner, None)  # caller owns B too

    transport = httpx.ASGITransport(app=_app(async_db_session, owner))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        response = await c.get(f"{PREFIX}/snapshots/{run_b.run_id}/screenshot/{key}")
    assert response.status_code == 404
    assert "location" not in response.headers


async def test_the_runs_own_path_redirects_to_a_working_signed_url(
    async_db_session: AsyncSession, owner, storage: LocalBackend
) -> None:
    key = f"snapshots/{uuid4()}.png"
    storage.upload_file(io.BytesIO(BYTES), key)
    run_a = await _run(async_db_session, owner, key)

    transport = httpx.ASGITransport(app=_app(async_db_session, owner))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        response = await c.get(f"{PREFIX}/snapshots/{run_a.run_id}/screenshot/{key}")
        assert response.status_code == 307
        location = httpx.URL(response.headers["location"])
        assert "signature=" in str(location)
        fetched = await c.get(location.raw_path.decode())
    assert fetched.status_code == 200
    assert fetched.content == BYTES
