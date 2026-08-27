"""Blast-radius guards on ``DELETE /coord/cognito/groups/{group_name}``.

Plan ``2026-08-27-members-page-delete-paths-authorization-and-blast-radius``
Phase 2. The route deletes a **pool-wide** Cognito group: irreversible, not
scoped to a tenant, and — before this phase — one unconfirmed click away
from taking coord's SSO mappings down with it. ``require_admin`` bounds who
may call it; these tests pin what it now refuses to do.

Three guards, one test class each:

* ``group_is_mapped`` — coord maps the group to a tenant (409, tenants
  named). No FK backs this (``group_id`` is bare TEXT in
  ``coord_group_claim_provisioning``), so the handler is the only place it
  can be enforced.
* ``home_group_requires_override`` — a ``<slug>-home`` group pins its
  members' home tenant (409 without ``allow_home_group=true``).
* ``last_admin_mapping`` — the delete would leave a tenant with no other
  admin-conferring mapping (409, **no override**).

The coord read is stubbed at ``httpx.AsyncClient`` — the same seam
``test_operations_tenants_proxy.py`` uses — so nothing here needs a live
coord, and ``cognito_admin.delete_group`` is patched so a guard that fails
open is caught by ``assert not deleted`` rather than by an AWS bill.

One assertion recurs deliberately: **the refusal messages must not claim an
immediate sweep.** Deleting a Cognito group writes none of the inputs to
coord's 300s ``reconcile_home_tenant_drift`` (that sweep reads
``coord.operator_membership_sync``, written only by the LOGIN path), so the
damage is deferred to each operator's next login. Copy that says otherwise
would send an operator looking for a sweep that never runs.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"
_GROUPS_URL = f"{API_PREFIX}/coord/cognito/groups"
_CALLER_TOKEN = "caller-cognito-token"


def _build_admin_app() -> FastAPI:
    """A minimal app whose user is a superuser (what ``require_admin`` asks).

    The real ``require_admin`` still runs — only the user resolution is
    overridden — so the superuser gate itself stays under test.
    """
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "staff@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def admin_client() -> TestClient:
    return TestClient(_build_admin_app())


def _mapping(group_id: str, tenant_slug: str, role: str) -> dict[str, Any]:
    return {
        "group_id": group_id,
        "tenant_slug": tenant_slug,
        "role": role,
        "auto_create_tenant": True,
        "created_at": "2026-08-01T00:00:00Z",
        "tenant_id": None,
    }


class _Deleter:
    """Stand-in for ``cognito_admin.delete_group`` that records its calls."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, group_name: str) -> None:
        self.calls.append(group_name)


class _Harness:
    """A DELETE run with the coord mapping read stubbed.

    ``rows`` is what coord's ``GET /admin/coord/group-tenant-roles`` returns;
    ``coord_error`` (an exception instance) makes that read fail instead.
    """

    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        coord_error: Exception | None = None,
    ) -> None:
        self.rows = rows or []
        self.coord_error = coord_error
        self.deleter = _Deleter()
        self.get_calls: list[Any] = []

    def run(self, client: TestClient, path: str) -> httpx.Response:
        from app.services import cognito_admin

        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = {"group_tenant_roles": self.rows}
        resp.text = ""

        instance = MagicMock()
        if self.coord_error is not None:
            instance.get = AsyncMock(side_effect=self.coord_error)
        else:
            instance.get = AsyncMock(return_value=resp)
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "app.api.v1.endpoints.operations.httpx.AsyncClient",
                return_value=instance,
            ),
            patch.object(cognito_admin, "delete_group", self.deleter),
        ):
            out = client.delete(
                path, headers={"Authorization": f"Bearer {_CALLER_TOKEN}"}
            )
        self.get_calls = instance.get.call_args_list
        return out


def _detail(resp: httpx.Response) -> dict[str, Any]:
    detail = resp.json()["detail"]
    assert isinstance(detail, dict), f"expected a structured detail, got {detail!r}"
    return detail


# ---------------------------------------------------------------------------
# V3 — a group coord maps is refused, with the tenants NAMED
# ---------------------------------------------------------------------------


class TestMappedGroupIsRefused:
    def test_mapped_group_is_409_naming_the_tenants(self, admin_client: TestClient):
        """The whole point of the 409 is that it says WHAT it would break.

        "This group is in use" would leave the operator with nowhere to go;
        the tenant slugs are the thing they need in order to remove the
        mapping first.
        """
        h = _Harness(
            rows=[
                _mapping("acme-devs", "acme", "operator"),
                _mapping("acme-devs", "beta-corp", "operator"),
                _mapping("other-group", "acme", "admin"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "group_is_mapped"
        assert detail["tenants"] == ["acme", "beta-corp"]
        assert "acme" in detail["message"]
        assert "beta-corp" in detail["message"]
        # The guard must run BEFORE AWS — a refusal after the delete is not a
        # refusal, it is a post-mortem.
        assert h.deleter.calls == []

    def test_the_refusal_does_not_promise_an_immediate_sweep(
        self, admin_client: TestClient
    ):
        """coord's home-drift sweep reads the LOGIN path's records, not
        Cognito, so nothing reconciles on delete. The copy must say the
        effect is deferred rather than invent a sweep."""
        h = _Harness(rows=[_mapping("acme-devs", "acme", "operator")])
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        message = _detail(resp)["message"].lower()
        assert "next login" in message
        assert "sweep" not in message

    def test_unmapped_group_deletes(self, admin_client: TestClient):
        """The guard must not become a blanket refusal — a group coord has
        never heard of still deletes on the first call."""
        h = _Harness(rows=[_mapping("other-group", "acme", "admin")])
        resp = h.run(admin_client, f"{_GROUPS_URL}/scratch-group")

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}
        assert h.deleter.calls == ["scratch-group"]

    def test_allow_mapped_override_reaches_aws(self, admin_client: TestClient):
        """The override exists so the last-admin guard below is reachable —
        and so an operator with a genuine reason is not sent to the AWS
        console. It is NOT offered by the dashboard."""
        h = _Harness(
            rows=[
                _mapping("acme-devs", "acme", "operator"),
                _mapping("acme-admins", "acme", "admin"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")

        assert resp.status_code == 200, resp.text
        assert h.deleter.calls == ["acme-devs"]

    def test_the_caller_bearer_is_forwarded_on_the_coord_read(
        self, admin_client: TestClient
    ):
        """``require_admin`` resolves no coord tenant, so nothing captures the
        bearer unless the handler does it itself. Without the capture coord
        answers 401 and EVERY delete 502s — a guard that fails closed on
        every call is indistinguishable from a broken endpoint."""
        h = _Harness(rows=[])
        h.run(admin_client, f"{_GROUPS_URL}/scratch-group")

        assert h.get_calls, "coord was never read"
        headers = h.get_calls[0].kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"

    def test_an_unreadable_coord_refuses_rather_than_assuming_no_mappings(
        self, admin_client: TestClient
    ):
        """An unreadable mapping table is UNKNOWN, not "no mappings"."""
        h = _Harness(coord_error=httpx.ConnectError("refused"))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502
        assert h.deleter.calls == []


# ---------------------------------------------------------------------------
# V4 — a `<slug>-home` group needs an explicit override
# ---------------------------------------------------------------------------


class TestHomeGroupRequiresOverride:
    def test_home_group_is_refused_without_the_override(self, admin_client: TestClient):
        h = _Harness(rows=[])
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home")

        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "home_group_requires_override"
        assert detail["tenant_slug"] == "acme"
        assert h.deleter.calls == []

    def test_the_refusal_says_the_effect_is_deferred_to_next_login(
        self, admin_client: TestClient
    ):
        """An earlier draft of the plan claimed coord's 300s
        ``reconcile_home_tenant_drift`` fires here. It does not: that sweep
        reads ``coord.operator_membership_sync``, written only by
        ``reconcile_group_memberships`` on login. Telling an operator to
        watch for a sweep would send them looking for an event that never
        arrives."""
        h = _Harness(rows=[])
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home")

        message = _detail(resp)["message"].lower()
        assert "next login" in message
        assert "deferred" in message

    def test_the_override_lets_it_through(self, admin_client: TestClient):
        h = _Harness(rows=[])
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home?allow_home_group=true")

        assert resp.status_code == 200, resp.text
        assert h.deleter.calls == ["acme-home"]

    def test_a_mapped_home_group_reports_the_mapping_first(
        self, admin_client: TestClient
    ):
        """Guard order is the harm order: the mapping is the concrete,
        already-provable breakage, so it is what the operator is told about
        even when both guards would fire."""
        h = _Harness(
            rows=[
                _mapping("acme-home", "acme", "operator"),
                _mapping("acme-admins", "acme", "admin"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home")

        assert resp.status_code == 409
        assert _detail(resp)["error"] == "group_is_mapped"

    def test_the_suffix_is_exact_not_a_substring(self, admin_client: TestClient):
        """``home-team`` and ``acme-homes`` are ordinary groups. Coord's
        ``HOME_GROUP_SUFFIX`` match is an exact suffix, and a looser match
        here would refuse deletes coord never treats as home pins."""
        for name in ("home-team", "acme-homes"):
            h = _Harness(rows=[])
            resp = h.run(admin_client, f"{_GROUPS_URL}/{name}")
            assert resp.status_code == 200, f"{name}: {resp.text}"
            assert h.deleter.calls == [name]


# ---------------------------------------------------------------------------
# V5 — the last admin-conferring mapping is refused, with no way around it
# ---------------------------------------------------------------------------


class TestLastAdminGuard:
    def test_last_admin_mapping_is_refused_even_with_allow_mapped(
        self, admin_client: TestClient
    ):
        """Stranding a tenant has no repair path inside the product: coord's
        ``POST /admin/coord/group-tenant-roles`` requires an admin in the
        target tenant, which is precisely who this delete would erase."""
        h = _Harness(
            rows=[
                _mapping("acme-admins", "acme", "admin"),
                _mapping("acme-devs", "acme", "operator"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-admins?allow_mapped=true")

        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "last_admin_mapping"
        assert detail["tenants"] == ["acme"]
        assert h.deleter.calls == []

    def test_no_override_gets_past_it(self, admin_client: TestClient):
        """Both overrides together must still not delete a last-admin group.

        If either one let it through, the guard would only be a speed bump on
        the exact path that needs the AWS console to undo."""
        h = _Harness(rows=[_mapping("acme-home", "acme", "admin")])
        resp = h.run(
            admin_client,
            f"{_GROUPS_URL}/acme-home?allow_mapped=true&allow_home_group=true",
        )

        assert resp.status_code == 409
        assert _detail(resp)["error"] == "last_admin_mapping"
        assert h.deleter.calls == []

    def test_another_group_conferring_admin_makes_it_safe(
        self, admin_client: TestClient
    ):
        h = _Harness(
            rows=[
                _mapping("acme-admins", "acme", "admin"),
                _mapping("acme-staff", "acme", "admin"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-admins?allow_mapped=true")

        assert resp.status_code == 200, resp.text
        assert h.deleter.calls == ["acme-admins"]

    def test_a_second_row_on_the_SAME_group_does_not_count_as_cover(
        self, admin_client: TestClient
    ):
        """The delete takes every row of this group at once, so its own
        duplicate admin mapping into the same tenant is not a second source.
        Counting rows instead of distinct groups is the obvious way to get
        this wrong."""
        h = _Harness(
            rows=[
                _mapping("acme-admins", "acme", "admin"),
                _mapping("acme-admins", "acme", "operator"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-admins?allow_mapped=true")

        assert resp.status_code == 409
        assert _detail(resp)["error"] == "last_admin_mapping"

    def test_owner_elsewhere_is_not_treated_as_admin_cover(
        self, admin_client: TestClient
    ):
        """coord's repair gate is ``rbac::is_tenant_admin``, which asks for
        the bare ``'admin'`` literal — an ``owner`` mapping does NOT satisfy
        it. Widening this vocabulary would let the stranding through under
        the belief that someone could still repair it."""
        h = _Harness(
            rows=[
                _mapping("acme-admins", "acme", "admin"),
                _mapping("acme-owners", "acme", "owner"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-admins?allow_mapped=true")

        assert resp.status_code == 409
        assert _detail(resp)["error"] == "last_admin_mapping"

    def test_a_non_admin_mapping_does_not_trip_the_guard(
        self, admin_client: TestClient
    ):
        """Deleting an operator-only group strands nobody's admin."""
        h = _Harness(
            rows=[
                _mapping("acme-devs", "acme", "operator"),
                _mapping("acme-admins", "acme", "admin"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")

        assert resp.status_code == 200, resp.text
        assert h.deleter.calls == ["acme-devs"]

    def test_every_stranded_tenant_is_named(self, admin_client: TestClient):
        h = _Harness(
            rows=[
                _mapping("multi-admins", "acme", "admin"),
                _mapping("multi-admins", "beta-corp", "admin"),
                _mapping("multi-admins", "gamma", "admin"),
                _mapping("gamma-admins", "gamma", "admin"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/multi-admins?allow_mapped=true")

        assert resp.status_code == 409
        # `gamma` has independent admin cover and must NOT be listed —
        # over-reporting would train operators to ignore the list.
        assert _detail(resp)["tenants"] == ["acme", "beta-corp"]
