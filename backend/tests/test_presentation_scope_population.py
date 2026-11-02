"""The presentation scope door entered the way its population enters it.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3, D3.4;
security-surface content trigger 5). The door's population is an operator's
signed-in session calling ``/api/v1/presentation/scope`` through the real app:
any member of the active project reads it (the console's presentation lens
does, while presenting), and only an admin of THAT project replaces it.

``tests/test_presentation_scope_api.py`` covers the routes in depth on a
FastAPI app of their own. These tests keep the request's path real except
where noted:

* the request goes through ``app.main.app`` -- its middleware stack and its
  router;
* the admin decision is the REAL ``require_coord_tenant_admin_target`` (and
  the ``require_coord_tenant_admin`` it depends on), over the REAL
  ``get_coord_identity``. What is stubbed is who the operator IS: the
  signed-in user (``get_current_active_user_async``, a real ``auth.users``
  row) and what coord's ``/admin/coord/me`` answers about them
  (``coord_identity._fetch_identity``, a real ``CoordIdentity``);
* coord itself is unreachable (``settings.COORD_URL`` is a closed local
  port), so the registered-repository owners read UNKNOWN, as designed --
  never an outbound call;
* only the database session is the test's own.

They import nothing this phase added, so without the phase they fail on the
missing routes, not on an import -- which is what makes them the phase's
arming tests (``qontinui-claude-config/scripts/arming-record.sh``).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.api.deps import get_async_db
from app.api.v1.endpoints import operations as operations_ep
from app.core.config import settings
from app.models.user import User
from app.services import coord_identity as coord_identity_module
from app.services.coord_identity import CoordIdentity, CoordTenant

pytestmark = pytest.mark.asyncio

SCOPE = "/api/v1/presentation/scope"
HEADER = "X-Qontinui-Active-Tenant"
BEARER = "presentation-operator"


@dataclass
class World:
    """The real app, an operator in two projects, and their per-project roles."""

    client: httpx.AsyncClient
    operator: User
    ours: UUID = field(default_factory=uuid4)
    theirs: UUID = field(default_factory=uuid4)
    roles: dict[UUID, tuple[str, ...]] = field(default_factory=dict)

    def me(self, selection: str | None) -> CoordIdentity:
        """``/admin/coord/me`` as coord answers it: re-scoped to the selected
        project when the operator belongs to it, home otherwise."""
        effective = self.theirs if selection == str(self.theirs) else self.ours
        return CoordIdentity(
            operator_id=uuid4(),
            home_tenant_id=effective,
            email=self.operator.email,
            roles=tuple(sorted({r for rs in self.roles.values() for r in rs})),
            tenants=(
                CoordTenant(
                    tenant_id=self.ours, slug="our-project", roles=self.roles[self.ours]
                ),
                CoordTenant(
                    tenant_id=self.theirs,
                    slug="their-project",
                    roles=self.roles[self.theirs],
                ),
            ),
            # The cross-project union the gate must NOT consult.
            is_admin=any("admin" in rs for rs in self.roles.values()),
        )


@pytest_asyncio.fixture()
async def world(
    async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[World]:
    from app.main import app

    operator = User(
        email=f"presenter-{uuid4().hex[:8]}@example.com",
        username=f"presenter-{uuid4().hex[:8]}",
        full_name="Presentation Operator",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    async_db_session.add(operator)
    await async_db_session.flush()

    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )
    w = World(client=client, operator=operator)

    async def _me(
        bearer: str | None, active_tenant: str | None = None
    ) -> CoordIdentity:
        assert bearer == BEARER
        return w.me(active_tenant)

    async def _db() -> AsyncIterator[AsyncSession]:
        yield async_db_session

    monkeypatch.setattr(coord_identity_module, "_fetch_identity", _me)
    monkeypatch.setattr(settings, "COORD_URL", "http://127.0.0.1:9")
    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[deps.get_current_active_user_async] = lambda: operator
    try:
        async with client:
            yield w
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)


def _headers(selection: UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {BEARER}", HEADER: str(selection)}


async def _write_target(world: World, selection: UUID) -> UUID:
    """The project a write lands in, through the admin gate the write door
    depends on -- or the gate's refusal."""
    request = Request(
        {
            "type": "http",
            "method": "PUT",
            "path": SCOPE,
            "query_string": b"",
            "headers": [
                (k.lower().encode(), v.encode()) for k, v in _headers(selection).items()
            ],
        }
    )
    admin_home = await operations_ep.require_coord_tenant_admin(
        request=request, current_user=world.operator
    )
    return await operations_ep.require_coord_tenant_admin_target(
        request=request, home_tenant_id=admin_home
    )


def _body(tenant: UUID, **fields: Any) -> dict[str, Any]:
    """A write made against ``tenant``'s scope, as the console's form sends it
    after reading that scope."""
    return {
        "first_party_owners": None,
        "confidential_terms": [],
        "expected_version": 0,
        "expected_tenant_id": str(tenant),
        **fields,
    }


# Each test's `def` line stays under 88 columns, so `ruff format` (pre-commit,
# backend CI) keeps it on ONE line: the arming check's Python reader ends a
# function at the first line indented no deeper than its `def`, so a wrapped
# signature would hide the test's body from it.


async def test_an_admin_writes_the_selected_scope_a_member_reads_it(world) -> None:
    """Admin of our project: the write lands in OUR project through the real
    gate; once the operator is only a member, the read serves that row and
    says the scope may not be edited."""
    world.roles = {world.ours: ("admin",), world.theirs: ("developer",)}
    assert await _write_target(world, world.ours) == world.ours

    written = await world.client.put(
        SCOPE,
        headers=_headers(world.ours),
        json=_body(
            world.ours,
            first_party_owners=["qontinui"],
            confidential_terms=["Acme Corp"],
        ),
    )
    assert written.status_code == 200, written.text
    assert written.json()["tenant_id"] == str(world.ours)
    assert written.json()["configured"]["version"] == 1
    assert written.json()["can_edit"] is True

    world.roles = {world.ours: ("developer",), world.theirs: ("developer",)}
    served = await world.client.get(SCOPE, headers=_headers(world.ours))
    assert served.status_code == 200, served.text
    assert served.json()["tenant_id"] == str(world.ours)
    assert served.json()["configured"]["confidential_terms"] == ["Acme Corp"]
    assert served.json()["first_party_owners"] == ["qontinui"]
    assert served.json()["can_edit"] is False


async def test_a_non_admin_of_the_selected_project_cannot_write_it(world) -> None:
    """Admin of OUR project, developer of THEIRS: the union says admin, but
    the gate checks the selected project's own roles -- the write to theirs is
    refused, nothing lands in either project, and the read says so."""
    world.roles = {world.ours: ("admin",), world.theirs: ("developer",)}
    with pytest.raises(HTTPException) as refused:
        await _write_target(world, world.theirs)
    assert refused.value.detail == "not_coord_tenant_admin"

    resp = await world.client.put(
        SCOPE,
        headers=_headers(world.theirs),
        json=_body(world.theirs, confidential_terms=["Initech"]),
    )
    assert resp.status_code == 403, resp.text
    served = await world.client.get(SCOPE, headers=_headers(world.theirs))
    assert served.status_code == 200, served.text
    assert served.json()["tenant_id"] == str(world.theirs)
    assert served.json()["can_edit"] is False
    assert served.json()["configured"]["version"] == 0
    ours = await world.client.get(SCOPE, headers=_headers(world.ours))
    assert ours.json()["configured"]["version"] == 0
