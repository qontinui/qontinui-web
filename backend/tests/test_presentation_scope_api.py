"""``/api/v1/presentation/scope`` end to end against real Postgres.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3, D3.4). The
door that tells the console's presentation lens which titles it may show.

Layers:

* **Layer 1 — the read**: any member of the active project reads it; with
  nothing stored the defaults apply (registered-repository owners, the
  viewer's other projects' names); an unreadable repository list is UNKNOWN,
  never empty; ``can_edit`` follows the write's own rule. No project
  resolving is ONE typed refusal on both of its arms (coord refusing the
  operator, an identity naming no project); every other identity failure
  keeps its own answer.
* **Layer 2 — the write**: an admin of the active project (or qontinui staff)
  replaces the stored row as a compare-and-set on its version; a member is
  refused; a stale version is refused and changes nothing; the viewer's other
  projects' names are never written into the row.
* **Layer 3 — isolation (D3.4)**: one project's scope is neither readable nor
  writable from another; the Project selector picks the row, and a selection
  naming a project the caller does not belong to degrades to their home
  project; admin is checked in the SELECTED project's own roles, never the
  union across projects; a caller can name no tenant at all.
* **Layer 4 — the real app's wiring**: routes mounted, anonymous refused, no
  device credential admitted.

Coord is faked at its two seams — ``get_coord_identity`` (the operator's
memberships, re-scoped by the Project selector the way coord's
``apply_active_tenant_override`` does) and the registered-repository read —
so the REAL tenant resolution and the REAL admin gate
(``require_coord_tenant_admin_target``) run. The tests of coord failing the
identity read go one seam lower (:func:`_real_identity_read`): the REAL
``get_coord_identity`` runs against a fake coord transport, so what the
route converts is checked against what production raises, not against what
the fake assumes it raises.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.deps import get_async_db
from app.api.v1.endpoints import operations
from app.api.v1.endpoints import presentation as endpoints
from app.auth.config import current_active_user
from app.core.error_codes import get_default_error_code
from app.middleware.error_handler import (
    http_exception_handler,
    validation_exception_handler,
)
from app.models.presentation_scope import PresentationScope
from app.models.user import User
from app.services import coord_identity
from app.services import presentation_scope as rules
from app.services.coord_identity import CoordIdentity, CoordTenant
from tests._ops_patch import setattr_ops

API = "/api/v1/presentation/scope"
HEADER = "X-Qontinui-Active-Tenant"

# ===========================================================================
# Harness
# ===========================================================================


@dataclass(frozen=True)
class Member:
    """One project membership of the fake operator."""

    tenant_id: UUID
    slug: str
    display_name: str | None
    roles: tuple[str, ...]


@dataclass
class FakeCoord:
    """The operator coord answers for, and each project's registered repos."""

    home: UUID | None = None
    memberships: list[Member] = field(default_factory=list)
    #: What the identity read raises instead of answering, when set.
    identity_error: HTTPException | None = None
    repos: dict[UUID, list[str]] = field(default_factory=dict)
    repo_error: BaseException | None = None
    repo_calls: list[UUID | None] = field(default_factory=list)
    #: What the coord proxy would have sent with each repository read: the
    #: caller's bearer and Project-selector value, as the request captured them
    #: (``operations._tenant_headers`` reads exactly these two).
    forwarded: list[tuple[str | None, str | None]] = field(default_factory=list)

    def effective(self, selection: UUID | str | None) -> UUID | None:
        """The project a request carrying ``selection`` resolves to: the
        selected one when the operator belongs to it, home otherwise."""
        chosen = "" if selection is None else str(selection).strip()
        for m in self.memberships:
            if str(m.tenant_id) == chosen or m.slug == chosen:
                return m.tenant_id
        return self.home

    def identity(self, request: Request) -> CoordIdentity:
        """``/admin/coord/me`` as coord answers it: re-scoped to the selected
        project when the operator belongs to it, home otherwise."""
        if self.identity_error is not None:
            raise self.identity_error
        effective = self.effective(request.headers.get(HEADER))
        return CoordIdentity(
            operator_id=None,
            home_tenant_id=effective,
            email="operator@example.com",
            roles=tuple(sorted({r for m in self.memberships for r in m.roles})),
            tenants=tuple(
                CoordTenant(
                    tenant_id=m.tenant_id,
                    slug=m.slug,
                    roles=m.roles,
                    display_name=m.display_name,
                )
                for m in self.memberships
            ),
            # The cross-tenant union the gate must NOT consult.
            is_admin=any("admin" in m.roles for m in self.memberships),
        )

    async def registered_repos(
        self, path: str, *, tenant_id: UUID | None = None, **_: Any
    ) -> Any:
        assert path == rules.REGISTERED_REPOS_PATH
        self.repo_calls.append(tenant_id)
        self.forwarded.append(
            (operations._caller_bearer.get(), operations._caller_active_tenant.get())
        )
        if self.repo_error is not None:
            raise self.repo_error
        assert tenant_id is not None
        return {
            "repos": [
                {"repo": repo, "role": "owner"}
                for repo in self.repos.get(tenant_id, [])
            ],
            "total": len(self.repos.get(tenant_id, [])),
        }


class Harness:
    """The presentation router with the real dependencies and a fake coord."""

    def __init__(
        self,
        db: AsyncSession,
        coord: FakeCoord,
        user: User,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self.db = db
        self.coord = coord
        self.user = user
        self.app = FastAPI()
        self.app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
        self.app.add_exception_handler(
            RequestValidationError,
            validation_exception_handler,  # type: ignore[arg-type]
        )

        async def _db() -> AsyncIterator[Any]:
            yield db

        async def _identity(request: Request) -> CoordIdentity:
            return coord.identity(request)

        self.app.dependency_overrides[get_async_db] = _db
        self.app.dependency_overrides[current_active_user] = lambda: self.user
        setattr_ops(monkeypatch, "get_coord_identity", _identity)
        monkeypatch.setattr(endpoints, "get_coord_identity", _identity)
        monkeypatch.setattr(rules, "_proxy_coord_get", coord.registered_repos)
        self.app.include_router(endpoints.router, prefix="/api/v1/presentation")
        self.http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"
        )

    def _headers(
        self, active: UUID | str | None, bearer: str | None = None
    ) -> dict[str, str]:
        headers = {} if active is None else {HEADER: str(active)}
        if bearer is not None:
            headers["Authorization"] = f"Bearer {bearer}"
        return headers

    async def read(
        self, active: UUID | str | None = None, *, bearer: str | None = None
    ) -> httpx.Response:
        return await self.http.get(API, headers=self._headers(active, bearer))

    async def write(
        self,
        *,
        owners: list[str] | None = None,
        terms: list[str] | None = None,
        version: int = 0,
        active: UUID | str | None = None,
        tenant: UUID | str | None = None,
        bearer: str | None = None,
        **extra: Any,
    ) -> httpx.Response:
        """PUT a scope. ``tenant`` is the body's ``expected_tenant_id`` -- by
        default the project the request resolves to, as a client that read
        the scope under the same selection sends."""
        expected = tenant if tenant is not None else self.coord.effective(active)
        body = {
            "first_party_owners": owners,
            "confidential_terms": terms or [],
            "expected_version": version,
            "expected_tenant_id": None if expected is None else str(expected),
            **extra,
        }
        return await self.http.put(
            API, json=body, headers=self._headers(active, bearer)
        )


async def _user(db: AsyncSession, name: str, *, superuser: bool = False) -> User:
    user = User(
        email=f"{name}-{uuid4().hex[:8]}@example.com",
        username=f"{name}-{uuid4().hex[:8]}",
        full_name=name.title(),
        is_active=True,
        is_verified=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.flush()
    return user


async def _row(db: AsyncSession, tenant: UUID) -> PresentationScope | None:
    """The stored row for ONE tenant (fresh per test), read past the
    identity map."""
    return (
        await db.execute(
            select(PresentationScope)
            .where(PresentationScope.tenant_id == tenant)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


@dataclass(frozen=True)
class Projects:
    """Three fresh projects per test: ours, a client's, another client's."""

    ours: UUID
    acme: UUID
    globex: UUID


@pytest.fixture()
def projects() -> Projects:
    return Projects(ours=uuid4(), acme=uuid4(), globex=uuid4())


def _member(tenant: UUID, slug: str, display: str | None, *roles: str) -> Member:
    return Member(tenant, slug, display, roles or ("developer",))


@pytest_asyncio.fixture()
async def admin(async_db_session: AsyncSession) -> User:
    return await _user(async_db_session, "admin")


@pytest_asyncio.fixture()
async def harness(
    async_db_session: AsyncSession,
    projects: Projects,
    admin: User,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[Harness]:
    """An operator who is ADMIN of our project and a member of Acme's."""
    coord = FakeCoord(
        home=projects.ours,
        memberships=[
            _member(projects.ours, "our-project", "Our Project", "admin"),
            _member(projects.acme, "acme-corp", "Acme Corp"),
        ],
        repos={
            projects.ours: [
                "qontinui/qontinui-web",
                "Qontinui/qontinui-coord",
                "qontinui-labs/site",
            ],
            projects.acme: ["acme-corp/website"],
        },
    )
    h = Harness(async_db_session, coord, admin, monkeypatch)
    async with h.http:
        yield h


#: The sentence the read's tenant-not-resolved refusal carries.
TENANT_NOT_RESOLVED_SENTENCE = (
    "No project could be resolved for this request: select a project you "
    "belong to, or ask a project admin to add you."
)

#: The ONE body the read serves when no project resolves, on either arm, less
#: what varies per request (see :func:`_refusal_body`). The token is in
#: ``error`` and ``refusal.discriminator``; ``message`` is the sentence.
TENANT_NOT_RESOLVED_BODY: dict[str, Any] = {
    "error": "tenant_not_resolved",
    "message": TENANT_NOT_RESOLVED_SENTENCE,
    "refusal": {
        "code": "permission_denied",
        "discriminator": "tenant_not_resolved",
        "next_action": {"kind": "fix_request"},
        "glossary_terms": [],
        "detail": TENANT_NOT_RESOLVED_SENTENCE,
        "source": "web_backend",
    },
}


def _refusal_body(resp: httpx.Response) -> dict[str, Any]:
    """A 403's body less ``timestamp``, ``path`` and ``refusal.observed_at``,
    which vary per request and must each be present."""
    assert resp.status_code == 403, resp.text
    body = dict(resp.json())
    for key in ("timestamp", "path"):
        assert key in body, key
        del body[key]
    refusal = dict(body["refusal"])
    assert refusal.pop("observed_at")
    body["refusal"] = refusal
    return body


#: Where the identity read's fake coord lives: a reserved name that never
#: resolves, whatever ``COORD_URL`` the environment running the tests sets.
FAKE_COORD_URL = "http://coord.test"


def _real_identity_read(
    monkeypatch: pytest.MonkeyPatch,
    coord: Callable[[httpx.Request], httpx.Response],
) -> list[httpx.Request]:
    """Put the REAL ``get_coord_identity`` back on the route, with coord's
    ``/admin/coord/me`` answered by ``coord``. Returns what coord received."""
    seen: list[httpx.Request] = []
    client_class = httpx.AsyncClient

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return coord(request)

    def client(**kwargs: Any) -> httpx.AsyncClient:
        return client_class(transport=httpx.MockTransport(answer), **kwargs)

    monkeypatch.setattr(coord_identity.settings, "COORD_URL", FAKE_COORD_URL)
    monkeypatch.setattr(coord_identity.httpx, "AsyncClient", client)
    monkeypatch.setattr(
        endpoints, "get_coord_identity", coord_identity.get_coord_identity
    )
    return seen


def _coord_unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("coord is down", request=request)


def _coord_slow(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("coord is slow", request=request)


# ===========================================================================
# Layer 1 — the read
# ===========================================================================


@pytest.mark.asyncio
async def test_with_nothing_stored_the_defaults_apply_presentation(
    harness: Harness, projects: Projects
) -> None:
    resp = await harness.read()
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["tenant_id"] == str(projects.ours)
    assert body["first_party_owners"] == ["qontinui", "qontinui-labs"]
    assert body["first_party_owners_source"] == "registered_repos"
    assert body["first_party_owners_unknown_reason"] is None
    # The viewer's other project, display name and slug folded into one.
    assert body["confidential_terms"] == ["Acme Corp"]
    assert body["configured"] == {
        "first_party_owners": None,
        "confidential_terms": [],
        "version": 0,
        "updated_at": None,
        "updated_by": None,
    }
    assert body["defaults"] == {
        "registered_repo_owners": ["qontinui", "qontinui-labs"],
        "registered_repo_owners_unknown_reason": None,
        "viewer_other_tenant_names": ["Acme Corp"],
    }
    assert body["can_edit"] is True
    # The registered repositories were read for OUR project.
    assert harness.coord.repo_calls == [projects.ours]


@pytest.mark.asyncio
async def test_the_read_forwards_the_callers_bearer_to_coord_presentation(
    harness: Harness, projects: Projects
) -> None:
    """Coord scopes ``/pr-merge/repos`` to the operator's own bearer and
    Project selection. Without the capture the read reaches coord with neither,
    coord answers 401, and the registered-repository default never applies —
    which a fake that ignores headers would never notice."""
    resp = await harness.read(projects.ours, bearer="operator-bearer-1")
    assert resp.status_code == 200, resp.text
    assert harness.coord.forwarded == [("operator-bearer-1", str(projects.ours))]


@pytest.mark.asyncio
async def test_the_write_forwards_the_callers_bearer_to_coord_presentation(
    harness: Harness, projects: Projects
) -> None:
    resp = await harness.write(
        owners=None, active=projects.ours, bearer="operator-bearer-2"
    )
    assert resp.status_code == 200, resp.text
    assert harness.coord.forwarded == [("operator-bearer-2", str(projects.ours))]


@pytest.mark.asyncio
async def test_a_member_reads_but_may_not_edit_presentation(
    harness: Harness, projects: Projects
) -> None:
    harness.coord.memberships[0] = _member(projects.ours, "our-project", "Our Project")
    harness.user = await _user(harness.db, "member")
    resp = await harness.read()
    assert resp.status_code == 200, resp.text
    assert resp.json()["can_edit"] is False


@pytest.mark.asyncio
async def test_staff_may_edit_presentation(
    harness: Harness, projects: Projects
) -> None:
    harness.coord.memberships[0] = _member(projects.ours, "our-project", "Our Project")
    harness.user = await _user(harness.db, "staff", superuser=True)
    assert (await harness.read()).json()["can_edit"] is True


@pytest.mark.asyncio
async def test_an_unreadable_repository_list_is_unknown_not_empty_presentation(
    harness: Harness,
) -> None:
    harness.coord.repo_error = operations._coord_unreachable(
        operations.CoordTransportUnavailable
    )
    body = (await harness.read()).json()
    assert body["first_party_owners"] is None
    assert body["first_party_owners_unknown_reason"] == "coord_unreachable"
    assert body["defaults"]["registered_repo_owners"] is None
    # The terms do not depend on that read and are still served.
    assert body["confidential_terms"] == ["Acme Corp"]


@pytest.mark.asyncio
async def test_an_operator_coord_does_not_know_is_refused_presentation(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Coord's ``/admin/coord/me`` answers 403, as it does for an operator it
    links to no project, read through the REAL identity read. The answer is
    the same typed refusal as the arm below: not the bare shape the shared
    gates serve for this condition (``error: FORBIDDEN`` with the token in
    ``message``), which this arm served before. One condition, one shape."""
    seen = _real_identity_read(
        monkeypatch, lambda request: httpx.Response(403, text="forbidden")
    )
    resp = await harness.read(bearer="operator-bearer")
    assert _refusal_body(resp) == TENANT_NOT_RESOLVED_BODY
    # Refused on coord's answer, before any tenant-keyed read.
    assert [str(r.url) for r in seen] == [f"{FAKE_COORD_URL}/admin/coord/me"]
    assert harness.coord.repo_calls == []


@pytest.mark.asyncio
async def test_an_identity_naming_no_project_is_refused_presentation(
    harness: Harness,
) -> None:
    """Coord answers, but the operator has no home project and the selection
    names none they belong to: the read is refused before any tenant-keyed
    read, rather than reading the scope of no tenant, with the SAME body as
    the arm above. A typed refusal: the D4 ratchet counts bare-string error
    responses."""
    harness.coord.home = None
    harness.coord.memberships = []
    resp = await harness.read(uuid4())
    assert _refusal_body(resp) == TENANT_NOT_RESOLVED_BODY
    assert harness.coord.repo_calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("coord", "bearer", "status_code", "message"),
    [
        # No coord runs in the hermetic Spec CI stack, and the crawl waiver
        # for this route (frontend/tests/spec-ci/crawl-baseline.ts) covers
        # exactly these two statuses: a coord outage is not a missing project.
        pytest.param(
            _coord_unreachable, "b", 502, "coord is not reachable", id="unreachable"
        ),
        pytest.param(_coord_slow, "b", 504, "timeout waiting for coord", id="timeout"),
        # The status is half of the match: coord's 401 (an expired session)
        # stays a 401, whatever its text says.
        pytest.param(
            lambda request: httpx.Response(401, text="tenant_not_resolved"),
            "b",
            401,
            "tenant_not_resolved",
            id="coord-401",
        ),
        # No bearer at all: refused before coord is asked.
        pytest.param(
            _coord_unreachable, None, 401, "not_authenticated", id="no-bearer"
        ),
    ],
)
async def test_an_identity_failure_that_is_not_the_condition_keeps_its_answer_presentation(
    harness: Harness,
    monkeypatch: pytest.MonkeyPatch,
    coord: Callable[[httpx.Request], httpx.Response],
    bearer: str | None,
    status_code: int,
    message: str,
) -> None:
    _real_identity_read(monkeypatch, coord)
    resp = await harness.read(bearer=bearer)
    assert resp.status_code == status_code, resp.text
    body = resp.json()
    assert "refusal" not in body
    assert body["error"] == get_default_error_code(status_code).value
    assert body["message"] == message
    assert harness.coord.repo_calls == []


@pytest.mark.asyncio
async def test_another_403_from_the_identity_read_keeps_its_answer_presentation(
    harness: Harness,
) -> None:
    """The detail is the other half of the match: a 403 the identity read
    raises for any other reason is not relabelled a missing project."""
    harness.coord.identity_error = HTTPException(status_code=403, detail="another_403")
    resp = await harness.read()
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert "refusal" not in body
    assert (body["error"], body["message"]) == ("FORBIDDEN", "another_403")
    assert harness.coord.repo_calls == []


# ===========================================================================
# Layer 2 — the write
# ===========================================================================


@pytest.mark.asyncio
async def test_an_admin_writes_and_every_member_reads_it_back_presentation(
    harness: Harness, projects: Projects, admin: User
) -> None:
    resp = await harness.write(owners=[" @Qontinui "], terms=["Initech"], version=0)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["first_party_owners"] == ["qontinui"]
    assert body["first_party_owners_source"] == "configured"
    assert body["confidential_terms"] == ["Initech", "Acme Corp"]
    assert body["configured"]["version"] == 1
    assert body["configured"]["first_party_owners"] == ["qontinui"]
    assert body["configured"]["confidential_terms"] == ["Initech"]
    assert body["configured"]["updated_by"] == admin.email

    row = await _row(harness.db, projects.ours)
    assert row is not None
    assert row.first_party_owners == ["qontinui"]
    # The viewer's other projects' names are applied, never stored.
    assert row.confidential_terms == ["Initech"]
    assert row.version == 1
    assert row.updated_by_user_id == admin.id

    harness.coord.memberships[0] = _member(projects.ours, "our-project", "Our Project")
    harness.user = await _user(harness.db, "member")
    read = (await harness.read()).json()
    assert read["configured"]["version"] == 1
    assert read["configured"]["updated_by"] == admin.email
    assert read["first_party_owners"] == ["qontinui"]


@pytest.mark.asyncio
async def test_null_owners_return_to_the_registered_repositories_presentation(
    harness: Harness,
) -> None:
    assert (await harness.write(owners=["acme-corp"], version=0)).status_code == 200
    resp = await harness.write(owners=None, terms=[], version=1)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["first_party_owners"] == ["qontinui", "qontinui-labs"]
    assert body["first_party_owners_source"] == "registered_repos"
    assert body["configured"]["version"] == 2


@pytest.mark.asyncio
async def test_an_empty_owner_list_is_a_real_choice_presentation(
    harness: Harness,
) -> None:
    body = (await harness.write(owners=[], version=0)).json()
    assert body["first_party_owners"] == []
    assert body["first_party_owners_source"] == "configured"


@pytest.mark.asyncio
async def test_a_stale_write_is_refused_and_changes_nothing_presentation(
    harness: Harness, projects: Projects
) -> None:
    assert (await harness.write(terms=["Initech"], version=0)).status_code == 200
    for stale in (0, 2):
        resp = await harness.write(terms=["Hooli"], version=stale)
        assert resp.status_code == 409, resp.text
        assert resp.json()["error"] == "presentation_scope_conflict"
        assert resp.json()["current_version"] == 1
    row = await _row(harness.db, projects.ours)
    assert row is not None and row.confidential_terms == ["Initech"]
    assert row.version == 1
    fresh = await harness.write(terms=["Initech", "Hooli"], version=1)
    assert fresh.status_code == 200
    assert fresh.json()["configured"]["version"] == 2


@pytest.mark.asyncio
async def test_a_version_for_a_row_that_does_not_exist_is_refused_presentation(
    harness: Harness, projects: Projects
) -> None:
    resp = await harness.write(terms=["Initech"], version=3)
    assert resp.status_code == 409
    assert resp.json()["current_version"] == 0
    assert await _row(harness.db, projects.ours) is None


@pytest.mark.asyncio
async def test_a_member_may_not_write_presentation(
    harness: Harness, projects: Projects
) -> None:
    harness.coord.memberships[0] = _member(projects.ours, "our-project", "Our Project")
    harness.user = await _user(harness.db, "member")
    resp = await harness.write(terms=["Initech"], version=0)
    assert resp.status_code == 403
    assert resp.json()["message"] == "not_coord_tenant_admin"
    assert await _row(harness.db, projects.ours) is None


@pytest.mark.asyncio
async def test_staff_may_write_presentation(
    harness: Harness, projects: Projects
) -> None:
    harness.coord.memberships[0] = _member(projects.ours, "our-project", "Our Project")
    harness.user = await _user(harness.db, "staff", superuser=True)
    resp = await harness.write(terms=["Initech"], version=0)
    assert resp.status_code == 200, resp.text
    row = await _row(harness.db, projects.ours)
    assert row is not None and row.updated_by_user_id == harness.user.id


@pytest.mark.asyncio
async def test_an_invalid_write_is_refused_presentation(
    harness: Harness, projects: Projects
) -> None:
    for resp in (
        await harness.write(owners=["not an owner"], version=0),
        await harness.write(terms=["--"], version=0),
        await harness.write(terms=["Initech"], version=0, tenant_id=str(projects.acme)),
        await harness.http.put(
            API,
            json={
                "confidential_terms": [],
                "expected_version": 0,
                "expected_tenant_id": str(projects.ours),
            },
        ),
        # A write that names no project it was made for.
        await harness.http.put(
            API,
            json={
                "first_party_owners": None,
                "confidential_terms": [],
                "expected_version": 0,
            },
        ),
        # Past what the INTEGER column holds: a 422, not a driver error.
        await harness.write(terms=["Initech"], version=2**31),
    ):
        assert resp.status_code == 422, resp.text
    assert await _row(harness.db, projects.ours) is None
    assert await _row(harness.db, projects.acme) is None


@pytest.mark.asyncio
async def test_a_term_postgres_cannot_store_is_refused_unechoed_presentation(
    harness: Harness, projects: Projects
) -> None:
    """A NUL, or an unpaired surrogate (which has no UTF-8 form), passes the
    letter-or-digit check -- the match key drops both -- and would reach the
    database, which refuses it with a 500 whose error text carries every
    submitted term. The schema refuses it first, and names the term by its
    position: the terms are the names presentation mode keeps off screen."""
    for term in ("Acme\x00Corp", "Acme\ud800Corp"):
        body = json.dumps(
            {
                "first_party_owners": None,
                "confidential_terms": ["Globex Holdings", term],
                "expected_version": 0,
                "expected_tenant_id": str(projects.ours),
            }
        )
        resp = await harness.http.put(
            API, content=body, headers={"Content-Type": "application/json"}
        )
        assert resp.status_code == 422, resp.text
        assert "confidential term 2" in resp.text
        assert "Acme" not in resp.text and "Globex" not in resp.text
    assert await _row(harness.db, projects.ours) is None


# ===========================================================================
# Layer 3 — isolation
# ===========================================================================


@pytest.mark.asyncio
async def test_another_project_can_neither_read_nor_write_ours_presentation(
    harness: Harness, projects: Projects, admin: User
) -> None:
    assert (
        await harness.write(owners=["qontinui"], terms=["Initech"], version=0)
    ).status_code == 200

    # An admin of Globex who belongs to nothing else.
    harness.coord.home = projects.globex
    harness.coord.memberships = [_member(projects.globex, "globex", "Globex", "admin")]
    harness.coord.repos[projects.globex] = ["globex/site"]
    harness.user = await _user(harness.db, "globex-admin")

    # Naming our project in the selector degrades to Globex, never widens.
    for active in (None, projects.ours, "our-project"):
        read = await harness.read(active)
        assert read.status_code == 200, read.text
        body = read.json()
        assert body["tenant_id"] == str(projects.globex)
        assert body["configured"]["version"] == 0
        assert "Initech" not in body["confidential_terms"]
        assert body["first_party_owners"] == ["globex"]

    written = await harness.write(terms=["Hooli"], version=0, active=projects.ours)
    assert written.status_code == 200, written.text
    assert written.json()["tenant_id"] == str(projects.globex)
    # Ours is untouched; Globex got its own row.
    ours = await _row(harness.db, projects.ours)
    assert ours is not None
    assert ours.confidential_terms == ["Initech"] and ours.version == 1
    assert ours.updated_by_user_id == admin.id
    theirs = await _row(harness.db, projects.globex)
    assert theirs is not None and theirs.confidential_terms == ["Hooli"]
    # Globex's write could not overwrite ours even naming our version.
    again = await harness.write(terms=["Hooli"], version=1, active=projects.ours)
    assert again.json()["tenant_id"] == str(projects.globex)
    ours = await _row(harness.db, projects.ours)
    assert ours is not None and ours.confidential_terms == ["Initech"]
    # Nor by naming our project as the one the edit was made for.
    named = await harness.write(
        terms=["Hooli"], version=1, active=projects.ours, tenant=projects.ours
    )
    assert named.status_code == 409, named.text
    assert named.json()["error"] == "presentation_scope_tenant_mismatch"
    ours = await _row(harness.db, projects.ours)
    assert ours is not None and ours.confidential_terms == ["Initech"]
    assert ours.version == 1


@pytest.mark.asyncio
async def test_the_project_selector_picks_the_row_presentation(
    harness: Harness, projects: Projects
) -> None:
    harness.coord.memberships[1] = _member(
        projects.acme, "acme-corp", "Acme Corp", "admin"
    )
    resp = await harness.write(terms=["Initech"], version=0, active=projects.acme)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["tenant_id"] == str(projects.acme)
    assert body["first_party_owners"] == ["acme-corp"]
    # From Acme, OUR project is the viewer's other project.
    assert body["confidential_terms"] == ["Initech", "Our Project"]
    assert await _row(harness.db, projects.ours) is None
    acme = await _row(harness.db, projects.acme)
    assert acme is not None and acme.confidential_terms == ["Initech"]
    by_slug = (await harness.read("acme-corp")).json()
    assert by_slug["tenant_id"] == str(projects.acme)
    assert by_slug["configured"]["version"] == 1


@pytest.mark.asyncio
async def test_an_edit_made_for_another_project_is_never_saved_here_presentation(
    harness: Harness, projects: Projects
) -> None:
    """An admin of BOTH projects with a form open on ours while another tab
    switched the selection to Acme's: the save now resolves to Acme, and the
    body says the edit was made for ours. Refused, nothing written anywhere --
    even though both rows sit at version 0, where a version check alone would
    let our confidential terms land in Acme's row, which every Acme member
    reads."""
    harness.coord.memberships[1] = _member(
        projects.acme, "acme-corp", "Acme Corp", "admin"
    )
    resp = await harness.write(
        owners=["qontinui"],
        terms=["Initech"],
        version=0,
        active=projects.acme,
        tenant=projects.ours,
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"] == "presentation_scope_tenant_mismatch"
    assert "Initech" not in resp.text
    assert await _row(harness.db, projects.acme) is None
    assert await _row(harness.db, projects.ours) is None

    # A non-member selection degrades to home; an edit made for Acme is then
    # refused in ours too.
    assert (await harness.write(terms=["Initech"], version=0)).status_code == 200
    resp = await harness.write(
        terms=["Hooli"], version=1, active=uuid4(), tenant=projects.acme
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"] == "presentation_scope_tenant_mismatch"
    ours = await _row(harness.db, projects.ours)
    assert ours is not None and ours.confidential_terms == ["Initech"]
    assert ours.version == 1


@pytest.mark.asyncio
async def test_admin_is_checked_in_the_selected_project_not_the_union_presentation(
    harness: Harness, projects: Projects
) -> None:
    """Admin of our project, developer of Acme's: `is_admin` (the union across
    projects, what the frontend calls `isCoordAdmin`) says admin — the write to
    Acme must still be refused, and `can_edit` must say so."""
    assert harness.coord.identity(_request(projects.acme)).is_admin is True
    read = (await harness.read(projects.acme)).json()
    assert read["tenant_id"] == str(projects.acme)
    assert read["can_edit"] is False
    resp = await harness.write(terms=["Initech"], version=0, active=projects.acme)
    assert resp.status_code == 403
    assert await _row(harness.db, projects.acme) is None
    assert await _row(harness.db, projects.ours) is None


@pytest.mark.asyncio
async def test_the_viewer_names_follow_the_viewer_presentation(
    harness: Harness, projects: Projects
) -> None:
    """One viewer's other projects never reach another viewer."""
    assert (await harness.write(terms=["Initech"], version=0)).status_code == 200
    harness.coord.memberships = [
        _member(projects.ours, "our-project", "Our Project"),
        _member(projects.globex, "globex", "Globex"),
    ]
    harness.user = await _user(harness.db, "other-viewer")
    body = (await harness.read()).json()
    assert body["confidential_terms"] == ["Initech", "Globex"]
    assert "Acme Corp" not in body["confidential_terms"]
    assert body["defaults"]["viewer_other_tenant_names"] == ["Globex"]


@pytest.mark.asyncio
async def test_a_caller_cannot_name_a_tenant_presentation(
    harness: Harness, projects: Projects
) -> None:
    """The tenant comes from the caller's identity alone; a query key naming
    one is refused rather than ignored."""
    resp = await harness.http.get(API, params={"tenant_id": str(projects.acme)})
    assert resp.status_code == 422, resp.text
    assert harness.coord.repo_calls == []


def _request(active: UUID) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": API,
            "headers": [(HEADER.lower().encode(), str(active).encode())],
            "query_string": b"",
        }
    )


# ===========================================================================
# Layer 4 — the real app's wiring
# ===========================================================================


@pytest.fixture()
def real_app() -> FastAPI:
    from app.main import app

    return app


@pytest.mark.asyncio
async def test_the_routes_are_mounted_on_the_real_app_presentation(
    real_app: FastAPI,
) -> None:
    from fastapi.routing import APIRoute

    routes = {
        (method, route.path)
        for route in real_app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/v1/presentation")
        for method in route.methods or ()
    }
    assert routes == {("GET", API), ("PUT", API)}


@pytest.mark.asyncio
async def test_the_real_app_refuses_an_anonymous_caller_presentation(
    real_app: FastAPI,
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=real_app), base_url="http://test"
    ) as http:
        read = await http.get(API)
        write = await http.put(
            API,
            json={
                "first_party_owners": None,
                "confidential_terms": [],
                "expected_version": 0,
            },
        )
    assert read.status_code == 401
    assert write.status_code == 401


def test_no_device_credential_reaches_either_route_presentation() -> None:
    """Both routes are an operator's session: the write depends on the
    per-tenant admin gate, the read on the membership-validated caller, and
    neither on a dependency that admits a coord device JWT."""
    from fastapi.routing import APIRoute

    from app.core.evidence_posture import device_jwt_admitting_dependencies
    from app.main import app as real_app

    admitting = device_jwt_admitting_dependencies()

    def tree(dependant: Any) -> set[Any]:
        found = {dependant.call}
        for dep in dependant.dependencies:
            found |= tree(dep)
        return found

    required = {
        "GET": endpoints.get_presentation_caller,
        "PUT": operations.require_coord_tenant_admin_target,
    }
    checked = 0
    for route in real_app.routes:
        if not isinstance(route, APIRoute) or route.path != API:
            continue
        for method in route.methods or ():
            calls = tree(route.dependant)
            assert required[method] in calls, method
            assert current_active_user in calls, method
            assert not (calls & admitting), method
            checked += 1
    assert checked == 2
