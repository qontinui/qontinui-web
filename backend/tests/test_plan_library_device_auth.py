"""Plan & Prompt Library — the corpus routes accept the RUNNER'S device JWT.

The library's deterministic capture backbone does not live in a browser. It
lives in the runner: ``plan_workunit_adapter/body_push.rs`` POSTs the upsert and
its provenance edges during a scan, and ``mcp/plan_library.rs`` is the agent
write door that POSTs the same two and reads the list + ``/candidates``. Both
authenticate with the runner's coord device JWT (``attach_device_auth``) and
neither has, or can get, a Cognito user token.

Phase 1 shipped these routes on ``current_active_user``, which is
Cognito-only — so every one of those calls 401'd and the corpus could only ever
fill from a human clicking in the browser. That is the failure this module
pins, and it is a SILENT one: an empty library reads exactly like a library
nobody wrote to, so no assertion anywhere else would have caught it.

What is asserted here
---------------------
1. A device bearer can POST an artifact and POST an edge.
2. A Cognito user still can — the widening is purely additive.
3. An unauthenticated call still 401s. There is no anonymous door.
4. ``organization_id`` still comes from the resolved PRINCIPAL, never the
   request body — for the device caller too, which is the whole reason the org
   must be derived from a credential the runner owns.
5. ``PATCH /{id}/kind`` still refuses a device bearer. That route sets
   ``kind_locked`` to overrule the scan's heuristic; a door the scan could use
   to lock in its own guess would cancel out the only thing constraining it.

Layering matches ``tests/test_plan_library_api.py``: ``httpx.AsyncClient`` +
``ASGITransport`` (NOT ``TestClient``) so handlers run in the SAME asyncio loop
as the shared session. The device JWT itself is stubbed at
``deps._verify_device_jwt`` — coord's JWKS is not under test here, the
dependency wiring is.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

API_PREFIX = "/api/v1/plan-library"

pytestmark = pytest.mark.asyncio

DEVICE_BEARER = "a-coord-issued-device-jwt"


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


def _payload(**overrides: Any) -> dict:
    body = {
        "kind": "plan",
        "slug": _slug("device"),
        "title": "Captured by the runner scan",
        "status": "VETTED",
        "body": "# a plan the scan found on disk",
    }
    body.update(overrides)
    return body


async def _make_user(db: AsyncSession, stem: str):
    """A real ``auth.users`` row — the device's paired operator."""
    from app.models.user import User

    user = User(
        email=f"{stem}_{uuid4().hex[:8]}@example.com",
        username=f"{stem}_{uuid4().hex[:8]}",
        full_name="Plan Library Device Owner",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_personal_org(db: AsyncSession, user):
    """The personal organization ``_resolve_org_id`` derives the scope from.

    Created explicitly so the org assertions compare against a REAL id rather
    than against ``None`` — a test where both the expected and the forged value
    are falsy would pass without proving anything.
    """
    from app.models.organization import Organization

    org = Organization(
        name=f"Personal {uuid4().hex[:6]}",
        slug=f"personal-{uuid4().hex[:10]}",
        owner_id=user.id,
        settings={"is_personal": True},
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


def _build_app(*, db_session: AsyncSession, cognito_user=None) -> FastAPI:
    """Mount the router with the DB overridden and the Cognito arm pinned.

    ``current_active_user_optional`` is overridden rather than left live: the
    point of each test is which arm of the dual-auth dependency answers, so the
    Cognito arm's verdict has to be the test's input, not fastapi-users'
    opinion about a request that carries no cookie.

    ``current_active_user`` (the strict one, still used by ``PATCH /kind``) is
    overridden only when a Cognito user is supplied; left alone it does what it
    does in production and rejects the caller.
    """
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    app = FastAPI()
    app.dependency_overrides[current_active_user_optional] = lambda: cognito_user
    if cognito_user is not None:
        app.dependency_overrides[current_active_user] = lambda: cognito_user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(plan_library_router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def device_owner(async_db_session: AsyncSession):
    """The operator a device token resolves to, with a personal org."""
    user = await _make_user(async_db_session, "planlib_device")
    org = await _make_personal_org(async_db_session, user)
    return user, org


@pytest.fixture()
def stub_device_jwt(monkeypatch, device_owner):
    """Make ``DEVICE_BEARER`` verify to the paired operator, nothing else.

    Any OTHER token raises the same 401 the real verifier raises, so a test
    that accidentally authenticates on a token it did not mean to present
    fails loudly instead of passing for the wrong reason.
    """
    from app.api import deps

    user, _org = device_owner
    seen: list[str] = []

    async def _fake_verify(token: str):
        seen.append(token)
        if token != DEVICE_BEARER:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired device token.",
            )
        return ({"device_id": str(uuid4()), "user_id": str(user.id)}, user)

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)
    return seen


@pytest_asyncio.fixture()
async def device_client(async_db_session: AsyncSession, stub_device_jwt):
    """A client holding ONLY a device bearer — no Cognito user resolves."""
    app = _build_app(db_session=async_db_session, cognito_user=None)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {DEVICE_BEARER}"},
    ) as client:
        yield client


@pytest_asyncio.fixture()
async def anon_client(async_db_session: AsyncSession):
    """No Cognito user, no bearer at all."""
    app = _build_app(db_session=async_db_session, cognito_user=None)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


@pytest_asyncio.fixture()
async def cognito_client(async_db_session: AsyncSession):
    """A browser operator — the pre-existing path, which must be unchanged."""
    user = await _make_user(async_db_session, "planlib_cognito")
    org = await _make_personal_org(async_db_session, user)
    app = _build_app(db_session=async_db_session, cognito_user=user)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        client.qontinui_user = user  # type: ignore[attr-defined]
        client.qontinui_org = org  # type: ignore[attr-defined]
        yield client


# ===========================================================================
# The blocker itself — a device bearer can WRITE
# ===========================================================================


class TestDeviceBearerCanWrite:
    async def test_device_bearer_can_upsert_an_artifact(
        self, device_client: httpx.AsyncClient, stub_device_jwt: list[str]
    ) -> None:
        """The scan's POST — the one that used to 401 on every call."""
        resp = await device_client.post(API_PREFIX, json=_payload())
        assert resp.status_code == 201, resp.text
        assert resp.json()["created"] is True
        assert resp.json()["changed"] is True
        # The bearer really did go through device verification, rather than
        # some other arm quietly answering.
        assert stub_device_jwt == [DEVICE_BEARER]

    async def test_device_bearer_can_create_an_edge(
        self, device_client: httpx.AsyncClient
    ) -> None:
        """The provenance edge — the half only the agent that ran the chain
        knows, and the half a scan structurally cannot reconstruct."""
        prompt = (
            await device_client.post(
                API_PREFIX,
                json=_payload(kind="plan_authoring_prompt", body="write me a plan"),
            )
        ).json()["artifact"]
        plan = (
            await device_client.post(API_PREFIX, json=_payload(body="the plan"))
        ).json()["artifact"]

        edge = await device_client.post(
            f"{API_PREFIX}/{prompt['id']}/edges",
            json={"to_id": plan["id"], "relation": "authored_plan"},
        )
        assert edge.status_code == 201, edge.text
        assert edge.json()["direction"] == "outgoing"
        assert edge.json()["peer_slug"] == plan["slug"]

    async def test_device_bearer_can_read_the_routes_the_runner_reads(
        self, device_client: httpx.AsyncClient
    ) -> None:
        """``mcp/plan_library.rs`` forwards a list read and a candidates read.

        Both are device-authenticated too, so a write-only widening would still
        leave the agent door half-broken.
        """
        created = await device_client.post(API_PREFIX, json=_payload())
        assert created.status_code == 201, created.text

        listed = await device_client.get(API_PREFIX)
        assert listed.status_code == 200, listed.text
        assert listed.json()["total"] >= 1

        candidates = await device_client.get(
            f"{API_PREFIX}/candidates", params={"include_coord": "false"}
        )
        assert candidates.status_code == 200, candidates.text

    async def test_an_invalid_device_bearer_is_401_not_a_silent_pass(
        self, async_db_session: AsyncSession, stub_device_jwt: list[str]
    ) -> None:
        """A bearer that FAILS verification must not fall through to success.

        This is the assertion that keeps "accepts a device JWT" from decaying
        into "accepts any string in the Authorization header".
        """
        app = _build_app(db_session=async_db_session, cognito_user=None)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer not-the-real-token"},
        ) as client:
            resp = await client.post(API_PREFIX, json=_payload())
        assert resp.status_code == 401, resp.text


# ===========================================================================
# The Cognito path is untouched, and anonymous is still closed
# ===========================================================================


class TestCognitoAndAnonymousUnchanged:
    async def test_cognito_user_can_still_write(
        self, cognito_client: httpx.AsyncClient
    ) -> None:
        resp = await cognito_client.post(API_PREFIX, json=_payload())
        assert resp.status_code == 201, resp.text
        assert resp.json()["created"] is True

    async def test_cognito_user_wins_over_a_presented_device_bearer(
        self, async_db_session: AsyncSession, device_owner, monkeypatch
    ) -> None:
        """Precedence: a resolved Cognito user is used and the device path is
        never consulted, even when a bearer is ALSO on the request. Without
        this, a forwarded device token could re-attribute a browser user's
        write to somebody else."""
        from app.api import deps

        browser_user = await _make_user(async_db_session, "planlib_browser")
        browser_org = await _make_personal_org(async_db_session, browser_user)

        def _boom(_token):  # pragma: no cover - must not be called
            raise AssertionError(
                "_verify_device_jwt must not run when a Cognito user resolves"
            )

        monkeypatch.setattr(deps, "_verify_device_jwt", _boom)

        app = _build_app(db_session=async_db_session, cognito_user=browser_user)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {DEVICE_BEARER}"},
        ) as client:
            resp = await client.post(API_PREFIX, json=_payload())

        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["organization_id"] == str(browser_org.id)

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("POST", "", {"kind": "plan", "slug": "x", "title": "t", "body": "b"}),
            ("GET", "", None),
            ("GET", "/divergent", None),
            ("GET", "/capture-health", None),
        ],
    )
    async def test_unauthenticated_is_still_401(
        self, anon_client: httpx.AsyncClient, method: str, path: str, body
    ) -> None:
        """No Cognito user and no bearer — 401 on reads and writes alike."""
        resp = await anon_client.request(
            method, f"{API_PREFIX}{path}", json=body if body else None
        )
        assert resp.status_code == 401, resp.text


# ===========================================================================
# The org still comes from the principal — including for a device
# ===========================================================================


class TestOrganizationComesFromThePrincipal:
    async def test_device_write_is_scoped_to_the_paired_operators_org(
        self, device_client: httpx.AsyncClient, device_owner
    ) -> None:
        """The device inherits its scope from the user that owns it.

        This is the property that makes widening safe: a device does not get a
        scope of its own, it gets its operator's.
        """
        _user, org = device_owner
        resp = await device_client.post(API_PREFIX, json=_payload())
        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["organization_id"] == str(org.id)

    async def test_a_forged_org_in_the_body_is_ignored_for_a_device_caller(
        self, device_client: httpx.AsyncClient, device_owner
    ) -> None:
        """Invariant 1 holds on the device arm too — scope escalation.

        The Cognito arm already has this test; repeating it here is deliberate,
        because the widening added a SECOND way to become a principal and an
        invariant only proven on one arm is not proven.
        """
        _user, org = device_owner
        forged = str(uuid4())
        resp = await device_client.post(
            API_PREFIX, json=_payload(organization_id=forged)
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["organization_id"] != forged
        assert resp.json()["artifact"]["organization_id"] == str(org.id)

    async def test_a_device_cannot_read_another_principals_artifacts(
        self, async_db_session: AsyncSession, device_client: httpx.AsyncClient
    ) -> None:
        """Org scoping is real, not decorative: a row written under a DIFFERENT
        org must not appear in the device's list or resolve by id."""
        from app.crud import work_artifact as crud

        stranger = await _make_user(async_db_session, "planlib_stranger")
        stranger_org = await _make_personal_org(async_db_session, stranger)
        theirs, _, _ = await crud.upsert_artifact(
            async_db_session,
            org_id=stranger_org.id,
            user_id=stranger.id,
            kind="plan",
            slug=_slug("stranger"),
            title="Not yours",
            status="VETTED",
            body="# private",
            source_path=None,
            source_repo=None,
            work_unit_slug=None,
            repos=[],
            authored_at=None,
            captured_by="agent",
            change_description=None,
            created_by="stranger",
        )

        listed = await device_client.get(API_PREFIX)
        assert listed.status_code == 200
        assert all(item["id"] != str(theirs.id) for item in listed.json()["items"])

        direct = await device_client.get(
            f"{API_PREFIX}/{theirs.id}", params={"include_coord": "false"}
        )
        assert direct.status_code == 404, direct.text


# ===========================================================================
# The one route that stays Cognito-only
# ===========================================================================


class TestKindPatchStaysOperatorOnly:
    async def test_a_device_bearer_cannot_lock_a_kind(
        self, device_client: httpx.AsyncClient
    ) -> None:
        """``PATCH /{id}/kind`` refuses the runner BY DESIGN.

        ``kind_locked`` exists to stop the next scan from reinstating its
        heuristic guess. If the scan could set the lock itself, the lock would
        constrain nothing. So the 401 here is the feature, and this test is the
        thing that will notice if a later refactor "helpfully" widens the last
        route along with the rest.
        """
        # Captured with ``kind_is_heuristic=True`` — the scan's own posture,
        # which is what leaves ``kind_locked`` False and therefore makes "the
        # device could not set the lock" an assertion with something to prove.
        created = await device_client.post(
            API_PREFIX, json=_payload(kind_is_heuristic=True)
        )
        assert created.status_code == 201, created.text
        artifact_id = created.json()["artifact"]["id"]
        assert created.json()["artifact"]["kind_locked"] is False

        patched = await device_client.patch(
            f"{API_PREFIX}/{artifact_id}/kind", json={"kind": "investigation_report"}
        )
        assert patched.status_code == 401, patched.text

        # And neither the kind nor the lock moved.
        after = await device_client.get(
            f"{API_PREFIX}/{artifact_id}", params={"include_coord": "false"}
        )
        assert after.json()["kind"] == "plan"
        assert after.json()["kind_locked"] is False

    async def test_a_cognito_operator_still_can(
        self, cognito_client: httpx.AsyncClient
    ) -> None:
        """The other half of the same claim: narrowing did not break the
        operator's own correction door."""
        created = await cognito_client.post(API_PREFIX, json=_payload())
        assert created.status_code == 201, created.text
        artifact_id = created.json()["artifact"]["id"]

        patched = await cognito_client.patch(
            f"{API_PREFIX}/{artifact_id}/kind", json={"kind": "investigation_report"}
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["kind"] == "investigation_report"
        assert patched.json()["kind_locked"] is True
