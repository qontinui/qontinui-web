"""Agents publish to the Project Overview — device principals and upsert-by-source.

Plan ``2026-10-07-agents-publish-documents-to-the-project-overview``:

* **Phase 1.3** — a coord DEVICE JWT acts as its owning user, with that user's
  roles, in a project the device is bound to and NAMES; it is refused anywhere
  else, refused on coord-backed resources, and an unusable bearer is a 401.
  The Cognito path is pinned by the existing overview suites, unchanged.
* **Phase 2.3** — a page published from a repository file is identified by its
  source: re-publishing updates it in place, the same sha is a no-op, a
  mismatched source is refused, a lost answer converges, and every write says
  which device and which reported session made it.

Nothing here stubs the overview's own resolution. What is stood in for is
exactly what lives outside this process: coord's JWKS verdict
(``deps._verify_device_jwt``, or ``coord_jwks_client`` for the verifier's own
refusals), and coord's HTTP doors — the device-membership door (contract C1,
built in qontinui-coord in parallel) and the operator ``/admin/coord/me``,
which must never see a device bearer.
"""

from __future__ import annotations

import types
from collections.abc import AsyncIterator, Callable
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio

TENANT_T = UUID("aaaaaaaa-0000-4000-8000-0000000000e1")
TENANT_T2 = UUID("bbbbbbbb-0000-4000-8000-0000000000e2")
DEVICE = UUID("dddddddd-0000-4000-8000-0000000000d1")
SESSION = "1d390724-33f3-42f8-98d4-a17ff7621116"

ADMIN_TOKEN = "device-token-admin"
VIEWER_TOKEN = "device-token-viewer"
UNLINKED_TOKEN = "device-token-unlinked"

REPO = "qontinui/qontinui-dev-notes"
PATH = "runbooks/2026-10-06-first-purpose-bought-ci-server-and-the-scale-out-path.md"


# ===========================================================================
# Coord, as seen from this process
# ===========================================================================


class FakeCoord:
    """Coord's two identity doors, on a mock transport.

    ``memberships`` maps a device bearer to the door's answer: a list of
    ``(tenant_id, roles)`` for a 200, or ``(status, error)`` for a refusal.
    Every request is kept, so a test can assert what was — and was not —
    sent where.
    """

    def __init__(self) -> None:
        self.memberships: dict[str, Any] = {}
        self.requests: list[httpx.Request] = []
        #: Who the door says it answered for; the verified token's own
        #: device and user unless a test says otherwise.
        self.device_id: str = str(DEVICE)
        self.user_id: str | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        bearer = request.headers.get("Authorization", "").removeprefix("Bearer ")
        if request.url.path == "/coord/devices/me/memberships":
            answer = self.memberships.get(bearer)
            if answer is None:
                return httpx.Response(403, json={"error": "device_token_required"})
            if isinstance(answer, tuple):
                status, error = answer
                return httpx.Response(status, json={"error": error})
            return httpx.Response(
                200,
                json={
                    "device_id": self.device_id,
                    "user_id": self.user_id,
                    "memberships": [
                        {"tenant_id": str(t), "slug": f"t-{str(t)[:4]}", "roles": r}
                        for t, r in answer
                    ],
                },
            )
        if request.url.path == "/admin/coord/me":
            # Only a Cognito bearer may ever reach the operator door.
            return httpx.Response(
                200,
                json={
                    "operator_id": str(uuid4()),
                    "home_tenant_id": str(TENANT_T),
                    "email": "operator@example.com",
                    "roles": ["admin"],
                    "tenants": [
                        {"tenant_id": str(TENANT_T), "slug": "t", "roles": ["admin"]}
                    ],
                    "is_admin": True,
                },
            )
        return httpx.Response(404, json={"error": "not_found"})

    def calls_to(self, path: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path == path]


def _patch_httpx(
    monkeypatch: pytest.MonkeyPatch, module: Any, coord: FakeCoord
) -> None:
    """Point ONE module's ``httpx.AsyncClient`` at the fake coord, leaving the
    real ``httpx`` (which this suite's own client uses) untouched."""
    real = httpx.AsyncClient

    def client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(coord.handler)
        return real(*args, **kwargs)

    fake = types.SimpleNamespace(**{k: getattr(httpx, k) for k in dir(httpx)})
    fake.AsyncClient = client
    monkeypatch.setattr(module, "httpx", fake)


@pytest.fixture()
def coord(monkeypatch: pytest.MonkeyPatch, owner) -> FakeCoord:
    from app.services import coord_device_memberships, coord_identity

    fake = FakeCoord()
    fake.user_id = str(owner.id)
    fake.memberships[ADMIN_TOKEN] = [(TENANT_T, ["admin"])]
    fake.memberships[VIEWER_TOKEN] = [(TENANT_T, ["viewer"])]
    fake.memberships[UNLINKED_TOKEN] = (403, "no_linked_operator")
    _patch_httpx(monkeypatch, coord_device_memberships, fake)
    _patch_httpx(monkeypatch, coord_identity, fake)
    return fake


# ===========================================================================
# Harness
# ===========================================================================


async def _user(db: AsyncSession, label: str):
    from app.models.user import User

    user = User(
        email=f"{label}_{uuid4().hex[:8]}@example.com",
        username=f"{label}_{uuid4().hex[:8]}",
        full_name="Agent Owner",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture()
async def owner(async_db_session: AsyncSession):
    return await _user(async_db_session, "agentowner")


@pytest.fixture()
def verified_devices(
    monkeypatch: pytest.MonkeyPatch, owner
) -> Callable[[dict[str, Any]], None]:
    """Stand in for coord's JWKS verdict: each known token verifies as a
    device JWT of ``owner``; anything else is the verifier's 401."""
    from app.api import deps

    tokens: dict[str, dict[str, Any]] = {
        token: {
            "sub_type": "device",
            "device_id": str(DEVICE),
            "user_id": str(owner.id),
            "tenant_id": str(TENANT_T2),  # never consulted for the tenant
        }
        for token in (ADMIN_TOKEN, VIEWER_TOKEN, UNLINKED_TOKEN)
    }
    calls: list[str] = []

    async def _verify(token: str) -> tuple[dict, Any]:
        calls.append(token)
        claims = tokens.get(token)
        if claims is None:
            raise HTTPException(status_code=401, detail="Invalid token.")
        return claims, owner

    monkeypatch.setattr(deps, "_verify_device_jwt", _verify)

    def add(extra: dict[str, Any]) -> None:
        tokens.update(extra)

    add.calls = calls  # type: ignore[attr-defined]
    return add


def _app(db: AsyncSession) -> FastAPI:
    from app.api.deps import current_active_user_optional, get_async_db
    from app.api.v1.endpoints.overview import router as overview_router
    from app.overview.router import router as authoring_router

    app = FastAPI()
    # No Cognito user on any request here: the device arm is what is tested.
    app.dependency_overrides[current_active_user_optional] = lambda: None

    async def _db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_async_db] = _db
    app.include_router(overview_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


def _client(
    app: FastAPI,
    *,
    token: str | None = ADMIN_TOKEN,
    tenant: UUID | str | None = TENANT_T,
    session: str | None = SESSION,
) -> httpx.AsyncClient:
    headers = {"X-Overview-Source": "api"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if tenant is not None:
        headers["X-Qontinui-Active-Tenant"] = str(tenant)
    if session is not None:
        headers["X-Overview-Session"] = session
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    )


@pytest_asyncio.fixture()
async def agent(async_db_session, coord, verified_devices):
    async with _client(_app(async_db_session)) as client:
        yield client


def _publish(
    *,
    sha: str = "a" * 40,
    body: str = "# CI server runbook\n\nBuy one box first.\n",
    title: str = "CI server runbook",
    path: str = PATH,
) -> dict[str, Any]:
    return {
        "kind": "document",
        "title": title,
        "body_md": body,
        "source_repo": REPO,
        "source_path": path,
        "source_sha": sha,
    }


async def _create(
    client: httpx.AsyncClient, payload: dict[str, Any], *, key: str | None = None
) -> httpx.Response:
    headers = {"Idempotency-Key": key or uuid4().hex}
    return await client.post(f"{API}/pages", json=payload, headers=headers)


async def _log(db: AsyncSession, tenant: UUID = TENANT_T) -> list[Any]:
    from app.models.overview import ChangeLog

    rows = await db.execute(
        select(ChangeLog)
        .where(ChangeLog.tenant_id == tenant, ChangeLog.resource == "pages")
        .order_by(ChangeLog.created_at, ChangeLog.id)
    )
    return list(rows.scalars().all())


def _code(response: httpx.Response) -> str | None:
    body = response.json()
    detail = body.get("detail", body)
    if isinstance(detail, dict):
        return detail.get("code") or detail.get("error")
    return None


# ===========================================================================
# Phase 1.3 — device principals
# ===========================================================================


class TestDevicePrincipal:
    async def test_a_device_whose_user_administers_t_creates_a_page_in_t(
        self, agent: httpx.AsyncClient, coord: FakeCoord, owner, async_db_session
    ) -> None:
        response = await _create(agent, _publish())
        assert response.status_code == 201, response.text
        item = response.json()["item"]
        assert item["created_by"] == owner.email
        assert item["via_device"] == str(DEVICE)
        assert item["via_session"] == SESSION

        # The device's own bearer went to the device door, and nowhere else.
        door = coord.calls_to("/coord/devices/me/memberships")
        assert door and all(
            r.headers["Authorization"] == f"Bearer {ADMIN_TOKEN}" for r in door
        )
        assert coord.calls_to("/admin/coord/me") == []

        rows = await _log(async_db_session)
        assert [r.action for r in rows] == ["create"]
        assert rows[0].actor == owner.email and rows[0].actor_user_id == owner.id

    async def test_the_device_jwt_is_verified_once_and_coord_asked_once_per_request(
        self, agent: httpx.AsyncClient, coord: FakeCoord, verified_devices
    ) -> None:
        response = await _create(agent, _publish())
        assert response.status_code == 201, response.text
        assert verified_devices.calls == [ADMIN_TOKEN]  # type: ignore[attr-defined]
        assert len(coord.calls_to("/coord/devices/me/memberships")) == 1

    async def test_the_same_device_is_refused_in_a_project_it_is_not_bound_to(
        self, async_db_session, coord: FakeCoord, verified_devices
    ) -> None:
        async with _client(_app(async_db_session), tenant=TENANT_T2) as client:
            response = await _create(client, _publish())
        assert response.status_code == 403, response.text
        assert _code(response) == "tenant_not_bound"

    @pytest.mark.parametrize("tenant", [None, "", "not-a-uuid", "t-aaaa"])
    async def test_a_device_that_names_no_valid_project_is_refused_not_degraded(
        self, async_db_session, coord: FakeCoord, verified_devices, tenant
    ) -> None:
        """Absent, blank, malformed, or a slug: never the home tenant, never
        the token's own ``tenant_id`` claim — and no coord round-trip."""
        async with _client(_app(async_db_session), tenant=tenant) as client:
            response = await client.get(f"{API}/pages")
        assert response.status_code == 403, response.text
        assert _code(response) == "tenant_not_bound"
        assert coord.requests == []

    async def test_a_device_of_a_non_editor_may_read_but_not_write(
        self, async_db_session, coord: FakeCoord, verified_devices
    ) -> None:
        async with _client(_app(async_db_session), token=VIEWER_TOKEN) as client:
            listing = await client.get(f"{API}/pages")
            assert listing.status_code == 200, listing.text
            assert listing.json()["can_edit"] is False
            response = await _create(client, _publish())
        assert response.status_code == 403, response.text
        assert response.json()["detail"]["error"] == "not_permitted"

    async def test_a_device_whose_user_has_no_linked_operator_is_refused(
        self, async_db_session, coord: FakeCoord, verified_devices
    ) -> None:
        async with _client(_app(async_db_session), token=UNLINKED_TOKEN) as client:
            response = await _create(client, _publish())
        assert response.status_code == 403, response.text
        assert _code(response) == "no_linked_operator"

    async def test_an_unmeasurable_binding_read_is_a_503_never_an_empty_grant(
        self, async_db_session, coord: FakeCoord, verified_devices
    ) -> None:
        coord.memberships[ADMIN_TOKEN] = (503, "bindings_unavailable")
        async with _client(_app(async_db_session)) as client:
            response = await client.get(f"{API}/pages")
        assert response.status_code == 503, response.text
        assert _code(response) == "bindings_unavailable"

    @pytest.mark.parametrize("field", ["device_id", "user_id"])
    async def test_an_answer_about_another_device_or_user_is_a_502(
        self, async_db_session, coord: FakeCoord, verified_devices, field: str
    ) -> None:
        setattr(coord, field, str(uuid4()))
        async with _client(_app(async_db_session)) as client:
            response = await _create(client, _publish())
        assert response.status_code == 502, response.text
        assert _code(response) == "coord_memberships_malformed"

    async def test_a_coord_without_the_door_is_a_502_never_an_empty_grant(
        self, async_db_session, coord: FakeCoord, verified_devices
    ) -> None:
        coord.memberships[ADMIN_TOKEN] = (404, "not_found")
        async with _client(_app(async_db_session)) as client:
            response = await client.get(f"{API}/pages")
        assert response.status_code == 502, response.text

    async def test_an_agent_token_without_user_id_is_a_401(
        self, async_db_session, coord: FakeCoord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The REAL verifier: coord's JWKS accepts the signature, and the
        missing ``user_id`` is what refuses it."""
        from app.services import coord_jwks

        async def _verify_token(_token: str) -> dict[str, Any]:
            return {"sub_type": "agent", "device_id": str(DEVICE)}

        monkeypatch.setattr(coord_jwks.coord_jwks_client, "verify_token", _verify_token)
        async with _client(_app(async_db_session), token="agent-token") as client:
            response = await _create(client, _publish())
        assert response.status_code == 401, response.text
        assert "user_id" in response.json()["detail"]
        assert coord.requests == []

    async def test_an_unparseable_bearer_is_a_401(
        self, async_db_session, coord: FakeCoord, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import coord_jwks

        async def _jwks() -> dict[str, Any]:
            return {"keys": []}

        monkeypatch.setattr(coord_jwks.coord_jwks_client, "get_jwks", _jwks)
        async with _client(_app(async_db_session), token="not.a.jwt") as client:
            response = await _create(client, _publish())
        assert response.status_code == 401, response.text
        assert coord.requests == []

    async def test_no_credential_at_all_is_a_401(
        self, async_db_session, coord: FakeCoord, verified_devices
    ) -> None:
        async with _client(_app(async_db_session), token=None) as client:
            response = await client.get(f"{API}/pages")
        assert response.status_code == 401, response.text

    async def test_a_cognito_user_wins_over_a_device_bearer_beside_it(
        self, async_db_session, coord: FakeCoord, verified_devices, owner
    ) -> None:
        """Cognito first: the operator path runs and the device door is not
        asked, even with a device bearer on the request."""
        from app.api.deps import current_active_user_optional

        app = _app(async_db_session)
        app.dependency_overrides[current_active_user_optional] = lambda: owner
        async with _client(app) as client:
            response = await _create(client, _publish())
        assert response.status_code == 201, response.text
        assert response.json()["item"]["via_device"] is None
        assert coord.calls_to("/coord/devices/me/memberships") == []
        assert len(coord.calls_to("/admin/coord/me")) == 1
        assert verified_devices.calls == []  # type: ignore[attr-defined]


class TestCoordBackedResources:
    @pytest.fixture()
    def untouchable_store(self, async_db_session):
        """The intent-document store must never run for a device."""
        from app.overview.intent_documents import intent_document_store

        class _Refuse:
            def __getattr__(self, name: str) -> Any:
                raise AssertionError(f"the coord store ran for a device: {name}")

        return intent_document_store, _Refuse

    async def test_the_catalog_says_a_device_cannot_edit_them(
        self, agent: httpx.AsyncClient
    ) -> None:
        catalog = (await agent.get(f"{API}/resources")).json()
        by_name = {r["name"]: r for r in catalog["resources"]}
        assert by_name["intent_documents"]["can_edit"] is False
        assert by_name["pages"]["can_edit"] is True

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("GET", "/intent-documents", None),
            ("GET", "/intent-documents/initiative:launch", None),
            (
                "POST",
                "/intent-documents",
                {"kind": "initiative", "name": "launch", "body": "# Launch\n"},
            ),
            ("PATCH", "/intent-documents/initiative:launch", {"body": "# Again\n"}),
            ("GET", "/change-log?resource=intent_documents", None),
        ],
    )
    async def test_every_request_is_refused_before_the_store_runs(
        self,
        async_db_session,
        coord: FakeCoord,
        verified_devices,
        untouchable_store,
        method: str,
        path: str,
        body: dict[str, Any] | None,
    ) -> None:
        dependency, refuse = untouchable_store
        app = _app(async_db_session)
        app.dependency_overrides[dependency] = refuse
        async with _client(app) as client:
            response = await client.request(
                method,
                f"{API}{path}",
                json=body,
                headers={"If-Match": '"1"'} if method == "PATCH" else None,
            )
        assert response.status_code == 403, response.text
        assert _code(response) == "device_not_supported_for_coord_backed_resource"
        # Only the device door was asked — no operator route saw the bearer.
        assert {r.url.path for r in coord.requests} == {"/coord/devices/me/memberships"}


class TestDeviceFiles:
    async def test_a_device_uploads_a_file_through_the_same_door(
        self, agent: httpx.AsyncClient
    ) -> None:
        pdf = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
        response = await agent.post(
            f"{API}/files",
            files={"file": ("runbook.pdf", pdf, "application/pdf")},
            headers={"Idempotency-Key": uuid4().hex},
        )
        assert response.status_code == 201, response.text


class TestSettingsReadsStayCognitoOnly:
    async def test_a_device_cannot_read_the_settings_route(
        self, agent: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await agent.get(f"{API}/settings")
        assert response.status_code == 401, response.text
        assert coord.requests == []


# ===========================================================================
# Phase 2.3 — provenance and upsert-by-source
# ===========================================================================


class TestUpsertBySource:
    async def _find(self, client: httpx.AsyncClient, path: str = PATH) -> list[dict]:
        listing = await client.get(
            f"{API}/pages", params={"source_repo": REPO, "source_path": path}
        )
        assert listing.status_code == 200, listing.text
        items: list[dict] = listing.json()["items"]
        return items

    async def test_republishing_the_same_source_updates_in_place(
        self, agent: httpx.AsyncClient
    ) -> None:
        made = (await _create(agent, _publish(sha="a" * 40))).json()["item"]
        found = await self._find(agent)
        assert [p["id"] for p in found] == [made["id"]]
        assert found[0]["source_sha"] == "a" * 40

        updated = await agent.patch(
            f"{API}/pages/{made['id']}",
            json={
                "source_repo": REPO,
                "source_path": PATH,
                "source_sha": "b" * 40,
                "body_md": "# CI server runbook\n\nBuy one box, then scale out.\n",
            },
            headers={"If-Match": '"1"'},
        )
        assert updated.status_code == 200, updated.text
        item = updated.json()["item"]
        assert item["version"] == 2
        assert item["source_sha"] == "b" * 40
        assert [p["id"] for p in await self._find(agent)] == [made["id"]]

        versions = (await agent.get(f"{API}/pages/{made['id']}/versions")).json()
        assert [(v["version"], v["source_sha"]) for v in versions["versions"]] == [
            (2, "b" * 40),
            (1, "a" * 40),
        ]

    async def test_the_list_filter_is_exact(self, agent: httpx.AsyncClient) -> None:
        await _create(agent, _publish())
        assert await self._find(agent, path=PATH[:-3]) == []
        assert len(await self._find(agent)) == 1

    async def test_the_same_sha_is_a_no_op(
        self, agent: httpx.AsyncClient, async_db_session
    ) -> None:
        payload = _publish()
        made = (await _create(agent, payload)).json()["item"]
        again = await agent.patch(
            f"{API}/pages/{made['id']}",
            json={k: payload[k] for k in ("source_repo", "source_path", "source_sha")}
            | {"title": payload["title"], "body_md": payload["body_md"]},
            headers={"If-Match": '"1"'},
        )
        assert again.status_code == 200, again.text
        assert again.json()["item"]["version"] == 1
        assert [r.action for r in await _log(async_db_session)] == ["create"]

    async def test_a_new_sha_is_content_even_when_the_body_is_unchanged(
        self, agent: httpx.AsyncClient
    ) -> None:
        payload = _publish(sha="a" * 40)
        made = (await _create(agent, payload)).json()["item"]
        moved = await agent.patch(
            f"{API}/pages/{made['id']}",
            json={
                "source_repo": REPO,
                "source_path": PATH,
                "source_sha": "c" * 40,
                "body_md": payload["body_md"],
            },
            headers={"If-Match": '"1"'},
        )
        assert moved.status_code == 200, moved.text
        assert moved.json()["item"]["version"] == 2
        assert moved.json()["item"]["source_sha"] == "c" * 40

    async def test_a_patch_naming_a_source_is_refused_on_a_handwritten_document(
        self, agent: httpx.AsyncClient
    ) -> None:
        handwritten = await agent.post(
            f"{API}/pages",
            json={"kind": "document", "title": "Notes", "body_md": "mine"},
        )
        assert handwritten.status_code == 201, handwritten.text
        page = handwritten.json()["item"]
        response = await agent.patch(
            f"{API}/pages/{page['id']}",
            json={"source_repo": REPO, "source_path": PATH, "body_md": "theirs"},
            headers={"If-Match": '"1"'},
        )
        assert response.status_code == 409, response.text
        assert response.json()["error"] == "source_mismatch"
        kept = (await agent.get(f"{API}/pages/{page['id']}")).json()["item"]
        assert kept["body_md"] == "mine" and kept["version"] == 1

    async def test_a_patch_naming_another_source_is_refused(
        self, agent: httpx.AsyncClient
    ) -> None:
        made = (await _create(agent, _publish())).json()["item"]
        response = await agent.patch(
            f"{API}/pages/{made['id']}",
            json={
                "source_repo": REPO,
                "source_path": "runbooks/other.md",
                "body_md": "x",
            },
            headers={"If-Match": '"1"'},
        )
        assert response.status_code == 409, response.text
        assert response.json()["error"] == "source_mismatch"

    async def test_a_patch_without_a_source_still_edits_a_mirrored_document(
        self, agent: httpx.AsyncClient
    ) -> None:
        """The source rule binds a PUBLISH. A person's edit names no source."""
        made = (await _create(agent, _publish())).json()["item"]
        response = await agent.patch(
            f"{API}/pages/{made['id']}",
            json={"doc_status": "Draft"},
            headers={"If-Match": '"1"'},
        )
        assert response.status_code == 200, response.text
        assert response.json()["item"]["source_repo"] == REPO

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("source_repo", "qontinui-dev-notes"),
            ("source_repo", "qontinui/dev notes"),
            ("source_repo", "a/b/c"),
            ("source_sha", "abc123"),
            ("source_sha", "g" * 40),
            ("source_sha", "a" * 41),
            ("source_path", "/runbooks/ci.md"),
            ("source_path", "./runbooks/ci.md"),
            ("source_path", "runbooks\\ci.md"),
            ("source_path", "runbooks//ci.md"),
            ("source_path", "runbooks/../secrets.md"),
            ("source_path", ".."),
        ],
    )
    async def test_a_malformed_source_is_a_422(
        self, agent: httpx.AsyncClient, field: str, value: str
    ) -> None:
        payload = _publish()
        payload[field] = value
        response = await _create(agent, payload)
        assert response.status_code == 422, response.text

    async def test_the_repo_and_sha_are_stored_lowercased_and_the_filter_matches(
        self, agent: httpx.AsyncClient
    ) -> None:
        payload = _publish(sha="A" * 64)
        payload["source_repo"] = "Qontinui/Qontinui-Dev-Notes"
        made = await _create(agent, payload)
        assert made.status_code == 201, made.text
        item = made.json()["item"]
        assert (item["source_repo"], item["source_sha"]) == (REPO, "a" * 64)
        listing = await agent.get(
            f"{API}/pages",
            params={"source_repo": "QONTINUI/qontinui-dev-notes", "source_path": PATH},
        )
        assert [p["id"] for p in listing.json()["items"]] == [item["id"]]
        # A PATCH spelling the repo in another case is the same source.
        patched = await agent.patch(
            f"{API}/pages/{item['id']}",
            json={
                "source_repo": "QONTINUI/QONTINUI-DEV-NOTES",
                "source_path": PATH,
                "source_sha": "b" * 40,
                "body_md": "moved on",
            },
            headers={"If-Match": '"1"'},
        )
        assert patched.status_code == 200, patched.text

    async def test_half_a_source_is_rejected(self, agent: httpx.AsyncClient) -> None:
        payload = _publish()
        del payload["source_path"]
        response = await _create(agent, payload)
        assert response.status_code == 422, response.text

    async def test_a_slug_collision_with_a_handwritten_document_is_name_taken(
        self, agent: httpx.AsyncClient
    ) -> None:
        handwritten = await agent.post(
            f"{API}/pages",
            json={"kind": "document", "title": "CI server runbook", "body_md": "mine"},
        )
        assert handwritten.status_code == 201, handwritten.text
        response = await _create(agent, _publish(title="CI server runbook"))
        assert response.status_code == 409, response.text
        assert response.json()["error"] == "name_taken"

    async def test_a_lost_answer_retry_converges_on_one_document(
        self, agent: httpx.AsyncClient, async_db_session
    ) -> None:
        """The first publish landed; the tool never saw the answer and runs
        again (a new invocation, a new key). The create collides on the source
        and is answered with the page already there."""
        first = await _create(agent, _publish(), key="first-invocation")
        assert first.status_code == 201, first.text
        retry = await _create(agent, _publish(), key="second-invocation")
        assert retry.status_code == 200, retry.text
        assert retry.headers["Idempotent-Replayed"] == "true"
        assert retry.json()["item"]["id"] == first.json()["item"]["id"]
        # And a retry under the SAME key is a plain replay.
        replay = await _create(agent, _publish(), key="first-invocation")
        assert replay.status_code == 200, replay.text
        assert replay.json()["item"]["id"] == first.json()["item"]["id"]
        assert len(await self._find(agent)) == 1
        # The adopt wrote nothing: the one create row is the real create.
        rows = await _log(async_db_session)
        assert [(r.action, r.idempotency_key) for r in rows] == [
            ("create", "first-invocation")
        ]

    async def test_delete_then_republish_the_same_sha_makes_a_new_record(
        self, agent: httpx.AsyncClient
    ) -> None:
        made = (await _create(agent, _publish())).json()["item"]
        gone = await agent.delete(
            f"{API}/pages/{made['id']}", headers={"If-Match": '"1"'}
        )
        assert gone.status_code == 204, gone.text
        assert (await agent.get(f"{API}/pages/{made['id']}")).status_code == 404
        again = await _create(agent, _publish())
        assert again.status_code == 201, again.text
        assert again.json()["item"]["id"] != made["id"]
        assert again.json()["item"]["version"] == 1


class TestProvenance:
    async def test_the_change_log_carries_the_device_and_the_reported_session(
        self, agent: httpx.AsyncClient, async_db_session
    ) -> None:
        made = (await _create(agent, _publish(sha="a" * 40))).json()["item"]
        await agent.patch(
            f"{API}/pages/{made['id']}",
            json={
                "source_repo": REPO,
                "source_path": PATH,
                "source_sha": "b" * 40,
                "body_md": "changed",
            },
            headers={"If-Match": '"1"'},
        )
        rows = await _log(async_db_session)
        assert [(r.action, r.source) for r in rows] == [
            ("create", "api"),
            ("update", "api"),
        ]
        assert all(r.via_device == DEVICE for r in rows)
        assert all(r.via_session == SESSION for r in rows)

        served = (
            await agent.get(
                f"{API}/change-log",
                params={"resource": "pages", "record_id": made["id"], "source": "api"},
            )
        ).json()["entries"]
        assert [e["action"] for e in served] == ["update", "create"]
        assert {e["via_device"] for e in served} == {str(DEVICE)}
        assert {e["via_session"] for e in served} == {SESSION}

        none_from_ui = (
            await agent.get(
                f"{API}/change-log", params={"resource": "pages", "source": "ui"}
            )
        ).json()["entries"]
        assert none_from_ui == []

    @pytest.mark.parametrize(
        "session", ["not-a-uuid", SESSION.upper(), f"{SESSION}x", ""]
    )
    async def test_a_malformed_session_is_ignored_never_refused(
        self, async_db_session, coord, verified_devices, session: str
    ) -> None:
        async with _client(_app(async_db_session), session=session) as client:
            response = await _create(client, _publish())
        assert response.status_code == 201, response.text
        assert response.json()["item"]["via_session"] is None
        rows = await _log(async_db_session)
        assert rows[-1].via_session is None
        assert rows[-1].via_device == DEVICE

    async def test_a_page_read_serves_who_wrote_its_current_version(
        self, async_db_session, coord, verified_devices, owner
    ) -> None:
        """A device publishes; a person then edits. The read follows the
        CURRENT version: the device's line goes when the person's edit lands."""
        from app.api.deps import current_active_user_optional

        async with _client(_app(async_db_session)) as client:
            made = (await _create(client, _publish())).json()["item"]
            read = (await client.get(f"{API}/pages/{made['id']}")).json()["item"]
            assert (read["via_device"], read["via_session"]) == (str(DEVICE), SESSION)
            listed = (await client.get(f"{API}/pages")).json()["items"]
            assert (listed[0]["via_device"], listed[0]["via_session"]) == (
                str(DEVICE),
                SESSION,
            )

        from app.overview.permissions import OverviewCaller, get_overview_caller

        person = _app(async_db_session)
        person.dependency_overrides[current_active_user_optional] = lambda: owner
        person.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
            tenant_id=TENANT_T, roles=("admin",)
        )
        async with _client(person, token=None, session=None) as client:
            edited = await client.patch(
                f"{API}/pages/{made['id']}",
                json={"body_md": "edited by hand"},
                headers={"If-Match": '"1"'},
            )
            assert edited.status_code == 200, edited.text
            assert edited.json()["item"]["via_device"] is None
            read = (await client.get(f"{API}/pages/{made['id']}")).json()["item"]
            assert (read["via_device"], read["via_session"]) == (None, None)
