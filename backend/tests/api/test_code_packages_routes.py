"""Discovery routes of ``code_packages`` that the marketplace frontend calls.

Phase 1 of plan ``2026-11-07-the-marketplace-shows-the-security-scan-the-api-serves``:

- ``GET /packages/by-slug/{slug}`` serves the package detail the
  ``/marketplace/[slug]`` page loads (200 for a seeded slug, 404 otherwise).
- ``GET /packages/popular`` and ``GET /packages/trending`` are declared before
  ``GET /packages/{package_id}``; while they were declared after it, the ``int``
  path parameter captured ``popular`` / ``trending`` and answered 422.

Layering mirrors ``tests/api/test_ui_bridge_states_routes.py``: the router is
mounted on a bare ``FastAPI`` at the prefix the real app uses and driven through
``httpx.AsyncClient`` over ``ASGITransport`` against the rolled-back
``async_db_session``. One DB-free test also reads the REAL app's route table, so
a later re-ordering in ``app/api/v1/api.py`` or the endpoint module is caught
even where no database is available.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterator
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.v1.endpoints import code_packages as code_packages_module
from app.models.code_package import CodePackage, PackageVersion, SecurityScanStatus
from app.models.user import User

PREFIX = "/api/v1/code-packages"


def _build_app(db: AsyncSession) -> FastAPI:
    app = FastAPI()

    async def _db_override() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(code_packages_module.router, prefix=PREFIX)
    return app


@pytest_asyncio.fixture()
async def client(async_db_session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    app = _build_app(async_db_session)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest_asyncio.fixture()
async def seeded_package(async_db_session: AsyncSession) -> CodePackage:
    """One package with one published version, under a unique slug."""
    suffix = uuid4().hex[:8]
    author = User(
        email=f"pkg_author_{suffix}@example.com",
        username=f"pkg_author_{suffix}",
        full_name="Package Author",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(author)
    await async_db_session.flush()

    package = CodePackage(
        # PackageBase validates `name` as lowercase letters, digits and hyphens.
        name=f"data-extractor-{suffix}",
        slug=f"data-extractor-{suffix}",
        description="Extracts data",
        author_id=author.id,
        tags=["extract"],
        total_downloads=3,
    )
    async_db_session.add(package)
    await async_db_session.flush()

    async_db_session.add(
        PackageVersion(
            package_id=package.id,
            version="1.0.0",
            code_content="def extract():\n    return 1\n",
            function_name="extract",
            security_scan_status=SecurityScanStatus.PASSED,
        )
    )
    await async_db_session.commit()
    await async_db_session.refresh(package)
    return package


# =============================================================================
# DB-backed behaviour
# =============================================================================


@pytest.mark.asyncio
async def test_by_slug_serves_the_seeded_package(
    client: httpx.AsyncClient, seeded_package: CodePackage
) -> None:
    resp = await client.get(f"{PREFIX}/packages/by-slug/{seeded_package.slug}")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == seeded_package.id
    assert body["slug"] == seeded_package.slug
    assert body["name"] == seeded_package.name
    assert body["total_versions"] == 1
    assert body["latest_version"]["version"] == "1.0.0"
    assert body["latest_version"]["security_scan_status"] == "passed"


@pytest.mark.asyncio
async def test_by_slug_answers_404_for_an_absent_slug(
    client: httpx.AsyncClient,
) -> None:
    resp = await client.get(f"{PREFIX}/packages/by-slug/no-such-{uuid4().hex}")

    assert resp.status_code == 404, resp.text
    assert resp.json() == {"detail": "Package not found"}


@pytest.mark.asyncio
async def test_by_id_detail_still_serves_the_package(
    client: httpx.AsyncClient, seeded_package: CodePackage
) -> None:
    resp = await client.get(f"{PREFIX}/packages/{seeded_package.id}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["slug"] == seeded_package.slug


@pytest.mark.asyncio
async def test_popular_answers_200_not_422(
    client: httpx.AsyncClient, seeded_package: CodePackage
) -> None:
    resp = await client.get(f"{PREFIX}/packages/popular")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["period"] == "all"
    assert seeded_package.slug in {p["slug"] for p in body["packages"]}


@pytest.mark.asyncio
async def test_trending_answers_200_not_422(
    client: httpx.AsyncClient, seeded_package: CodePackage
) -> None:
    resp = await client.get(f"{PREFIX}/packages/trending")

    assert resp.status_code == 200, resp.text
    assert resp.json()["period"] == "week"


# =============================================================================
# DB-free: the REAL app's route table
# =============================================================================


def _first_get_match(app: FastAPI, path: str) -> str:
    """Name of the endpoint Starlette's router would dispatch ``GET path`` to."""
    from starlette.routing import Match

    scope = {"type": "http", "method": "GET", "path": path, "root_path": ""}
    for route in app.router.routes:
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return route.name  # type: ignore[attr-defined]
    raise AssertionError(f"no GET route matches {path}")


@pytest.mark.parametrize(
    ("path", "endpoint"),
    [
        (f"{PREFIX}/packages/popular", "get_popular_packages"),
        (f"{PREFIX}/packages/trending", "get_trending_packages"),
        (f"{PREFIX}/packages/by-slug/data-extractor", "get_package_details_by_slug"),
        (f"{PREFIX}/packages/42", "get_package_details"),
    ],
)
def test_real_app_dispatches_literal_paths_before_the_id_route(
    path: str, endpoint: str
) -> None:
    from app.main import app

    assert _first_get_match(app, path) == endpoint
