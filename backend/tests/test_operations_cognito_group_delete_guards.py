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

Two further classes cover the INPUT all three are derived from. Guards 1 and
3 read ``coord.group_tenant_roles`` through ``_coord_group_tenant_role_rows``,
so an empty — or unattributable — return makes both vacuous, and that reader
used to answer ``[]`` for a 200 whose body was not the table, sending the
irreversible AWS delete on a check that never ran.
``mapping_check_unreadable`` is the refusal that replaced it:

* ``TestMalformedTwoHundredIsRefused`` — the ENVELOPE (body, key, list).
* ``TestUnreadableRowsAreRefused`` — the ROWS. Envelope checks alone leave
  the same defect one layer down: rows that carry none of the three fields
  the guards read attribute to no group and no tenant, so both guards go
  vacuous again on a perfectly well-formed 200.

Both classes carry a counterweight that must still SUCCEED — a well-formed
empty table, and coord's exact real row shape — because a fix that refused
everything would satisfy every negative test in them and be its own failure.

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

import json
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


#: ``body=`` sentinel: "build the body from ``rows``" (distinct from an
#: explicit ``body=None``, which is itself one of the malformed cases).
_FROM_ROWS = object()


class _Harness:
    """A DELETE run with the coord mapping read stubbed.

    ``rows`` is what coord's ``GET /admin/coord/group-tenant-roles`` returns;
    ``coord_error`` (an exception instance) makes that read fail instead.

    ``body`` overrides the whole 200 payload, which is how the malformed-200
    cases are expressed — coord's HTTP status says nothing about whether the
    body is the table. ``json_error`` makes ``resp.json()`` itself raise, the
    "200 carrying HTML from a proxy" case.
    """

    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
        coord_error: Exception | None = None,
        coord_status: int = 200,
        body: Any = _FROM_ROWS,
        json_error: Exception | None = None,
    ) -> None:
        # `body` and `json_error` each SHADOW what comes below them, so a test
        # setting two of these would silently exercise an input it did not
        # intend — the "the harness quietly used its default" hazard these
        # tests exist to catch, turned on the harness itself.
        assert rows is None or body is _FROM_ROWS, "pass rows= or body=, not both"
        assert json_error is None or body is _FROM_ROWS, (
            "json_error= shadows body=; pass one"
        )
        self.rows = rows or []
        self.coord_error = coord_error
        self.coord_status = coord_status
        self.body = body
        self.json_error = json_error
        self.deleter = _Deleter()
        self.get_calls: list[Any] = []

    def run(self, client: TestClient, path: str) -> httpx.Response:
        from app.services import cognito_admin

        resp = MagicMock(spec=httpx.Response)
        resp.status_code = self.coord_status
        if self.json_error is not None:
            resp.json.side_effect = self.json_error
        elif self.body is _FROM_ROWS:
            resp.json.return_value = {"group_tenant_roles": self.rows}
        else:
            resp.json.return_value = self.body
        resp.text = '{"error":"admin_required"}'

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
        assert _detail(resp)["error"] == "mapping_check_unavailable"
        assert h.deleter.calls == []

    def test_a_coord_403_is_reported_as_an_unverifiable_check_not_as_a_denial(
        self, admin_client: TestClient
    ):
        """coord's ``/admin/coord/group-tenant-roles`` is route-gated ``admin``,
        so a qontinui superuser holding no coord admin role gets a 403 there.

        Passing that through would tell the operator "you may not delete this
        group" — a different and false claim. The honest answer is "the check
        could not be completed, so nothing was deleted", with coord's status
        carried so they can see WHY.
        """
        h = _Harness(coord_status=403)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unavailable"
        assert detail["coord_status"] == 403
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


# ---------------------------------------------------------------------------
# V6 — a 200 whose BODY is not the table is UNKNOWN, not "no mappings"
# ---------------------------------------------------------------------------


class TestMalformedTwoHundredIsRefused:
    """The status code is not the only way the mapping read can fail.

    Guards 1 and 3 are derived entirely from
    ``_coord_group_tenant_role_rows``. When that reader answered ``[]`` for a
    malformed 200 — a non-dict body, or a ``group_tenant_roles`` that was not
    a list — BOTH guards evaluated to "nothing at risk" and the irreversible
    pool-wide AWS delete went through. The exception arm directly above it in
    the source had always said the right thing ("an unreadable mapping table
    is UNKNOWN, not 'no mappings'"); this arm did the opposite.

    Every REFUSAL case here asserts ``deleter.calls == []`` — a 502 with the
    delete already sent would be a post-mortem, not a refusal. The two
    must-succeed counterweights assert the delete WAS sent, which is the
    point of them.
    """

    @pytest.mark.parametrize(
        ("body", "label"),
        [
            (None, "null body"),
            ([], "top-level list"),
            (["acme-devs"], "top-level list of names"),
            ("group_tenant_roles", "top-level string"),
            (7, "top-level number"),
        ],
    )
    def test_a_body_that_is_not_an_object_is_refused(
        self, admin_client: TestClient, body: Any, label: str
    ):
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502, f"{label}: {resp.text}"
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == [], f"{label}: the AWS delete was still sent"

    def test_a_body_missing_the_key_is_refused(self, admin_client: TestClient):
        """An object with no ``group_tenant_roles`` at all — coord's own
        error envelope, or a route that moved — is the shape a ``.get()``
        with an implicit ``None`` default turns straight into "no mappings"."""
        h = _Harness(body={"error": "not_found", "detail": "no such route"})
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502, resp.text
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unreadable"
        assert "group_tenant_roles" in detail["reason"]
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        ("value", "label"),
        [
            (None, "explicit null"),
            ({}, "object"),
            ("acme-devs", "string"),
            (0, "number"),
        ],
    )
    def test_a_non_list_group_tenant_roles_is_refused(
        self, admin_client: TestClient, value: Any, label: str
    ):
        h = _Harness(body={"group_tenant_roles": value})
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502, f"{label}: {resp.text}"
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == [], f"{label}: the AWS delete was still sent"

    def test_a_list_holding_a_non_object_is_refused_not_filtered(
        self, admin_client: TestClient
    ):
        """Silently dropping the junk entries would narrow the guard's input,
        and the entry dropped could be the mapping that makes this delete
        strand a tenant. A partially unreadable table is still unreadable."""
        h = _Harness(
            body={
                "group_tenant_roles": [
                    _mapping("acme-devs", "acme", "operator"),
                    "acme-admins",
                ]
            }
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/scratch-group")

        assert resp.status_code == 502, resp.text
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_a_two_hundred_that_is_not_json_at_all_is_refused(
        self, admin_client: TestClient
    ):
        """``_proxy_coord_get`` ends in ``resp.json()``; an HTML error page
        from a proxy in front of coord raises ``JSONDecodeError`` there. That
        is a ``ValueError``, not an ``HTTPException``, so it fell past the
        failure arm entirely and became a bare 500 with no typed answer."""
        h = _Harness(
            json_error=json.JSONDecodeError("Expecting value", "<html>503</html>", 0)
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502, resp.text
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_the_refusal_distinguishes_itself_from_an_unreachable_coord(
        self, admin_client: TestClient
    ):
        """Two different operator responses hang off this distinction: an
        outage is waited out, a 200 that is not the table is a coord/proxy
        defect to chase. One shared code would erase that."""
        malformed = _Harness(body={"group_tenant_roles": "nope"})
        malformed_resp = malformed.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        unreachable = _Harness(coord_error=httpx.ConnectError("refused"))
        unreachable_resp = unreachable.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        # Pinned as LITERALS, not merely as "different from each other" — an
        # inequality alone would still hold if both codes changed together.
        assert _detail(malformed_resp)["error"] == "mapping_check_unreadable"
        assert _detail(unreachable_resp)["error"] == "mapping_check_unavailable"
        assert malformed.deleter.calls == []
        assert unreachable.deleter.calls == []

    def test_the_refusal_does_not_claim_a_status_it_never_saw(
        self, admin_client: TestClient
    ):
        """``_proxy_coord_get`` treats every status below 400 as success and
        discards the response, so this arm cannot know whether it was a 200, a
        204, or a 302 from a proxy in front of coord — and a 3xx carrying HTML
        is one of the realistic causes. Stamping ``coord_status: 200`` would
        send the operator to coord's handler for a fault in the hop before it.

        The sibling ``mapping_check_unavailable`` still reports its status,
        because that one genuinely has one (pinned above at the 403 case)."""
        h = _Harness(
            coord_status=302,
            json_error=json.JSONDecodeError("Expecting value", "<html>", 0),
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502, resp.text
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unreadable"
        assert "coord_status" not in detail, (
            f"the refusal reports a status it never observed: {detail}"
        )
        # Targeted at the CLAIM, not at the digits: a decode error reporting
        # "char 200" must not red this test, while "coord answered 200" must.
        assert "answered 200" not in detail["message"]
        assert h.deleter.calls == []

    def test_a_wellformed_empty_table_still_deletes(self, admin_client: TestClient):
        """The load-bearing counterpart: a real empty list is a legitimate
        "no mappings" and MUST still delete. Without this, the fix above
        could be a blanket refusal and every test in this class would still
        pass — which is its own failure, just a quieter one."""
        h = _Harness(body={"group_tenant_roles": []})
        resp = h.run(admin_client, f"{_GROUPS_URL}/scratch-group")

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}
        assert h.deleter.calls == ["scratch-group"]

    def test_a_wellformed_table_with_rows_still_refuses_on_the_mapping(
        self, admin_client: TestClient
    ):
        """And a well-formed table still reaches the ORIGINAL guards — the
        new arm must not swallow the 409 path it sits in front of."""
        h = _Harness(
            body={"group_tenant_roles": [_mapping("acme-devs", "acme", "operator")]}
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 409, resp.text
        assert _detail(resp)["error"] == "group_is_mapped"
        assert h.deleter.calls == []


# ---------------------------------------------------------------------------
# V7 — a well-formed ENVELOPE holding rows the guards cannot read is also
#      UNKNOWN. Validating the envelope alone leaves the original defect
#      intact one layer down.
# ---------------------------------------------------------------------------


class TestUnreadableRowsAreRefused:
    """``{"group_tenant_roles": [ {...} ]}`` can satisfy every envelope check
    and still be unreadable.

    ``_row_group_id`` / ``_row_tenant_slug`` / ``_row_confers_admin`` each
    coerce a missing or null value to ``""``. A row that lost its ``group_id``
    therefore matches no group — so guard 1 sees nothing mapped — while still
    landing in ``_tenants_stranded_by``'s "admin from OTHER groups" set, where
    it acts as phantom cover and suppresses guard 3, the one guard with no
    override. The sharp case is the middle one below: coord returned a mapping
    row **for the very group being deleted**, and it was deleted anyway.

    A renamed column in coord's ``SELECT``, or a renamed key in its ``json!``
    (``routes_phase3::get_group_tenant_roles``), produces exactly this — a
    200, a well-formed list, and both derived guards vacuous.
    """

    @pytest.mark.parametrize(
        ("row", "label"),
        [
            ({"foo": "bar"}, "no recognisable keys at all"),
            (
                {"groupId": "acme-devs", "tenant_slug": "acme", "role": "admin"},
                "group_id renamed camelCase — a mapping for THIS group",
            ),
            (
                {"group_id": None, "tenant_slug": "acme", "role": "admin"},
                "null group_id",
            ),
            (
                {"group_id": "", "tenant_slug": "acme", "role": "admin"},
                "empty group_id",
            ),
            (
                {"group_id": "acme-devs", "role": "admin"},
                "no tenant_slug",
            ),
            (
                {"group_id": "acme-devs", "tenant_slug": "acme"},
                "no role",
            ),
            (
                {"group_id": 17, "tenant_slug": "acme", "role": "admin"},
                "non-string group_id",
            ),
        ],
    )
    def test_a_row_missing_an_identity_field_is_refused(
        self, admin_client: TestClient, row: dict[str, Any], label: str
    ):
        h = _Harness(body={"group_tenant_roles": [row]})
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502, f"{label}: {resp.text}"
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == [], f"{label}: the AWS delete was still sent"

    def test_one_bad_row_among_good_ones_is_enough(self, admin_client: TestClient):
        """The table is refused as a whole. Skipping just the unreadable row
        would leave the readable ones deciding an irreversible delete on an
        input we already know is not what coord's contract describes."""
        h = _Harness(
            body={
                "group_tenant_roles": [
                    _mapping("other-group", "acme", "admin"),
                    {"tenant_slug": "acme", "role": "admin"},
                ]
            }
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/scratch-group")

        assert resp.status_code == 502, resp.text
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_the_reason_names_the_field_that_was_missing(
        self, admin_client: TestClient
    ):
        """ "malformed response" would not tell the operator whether to look at
        coord's SELECT, its serializer, or a proxy. The field name does."""
        h = _Harness(body={"group_tenant_roles": [{"group_id": "g", "role": "admin"}]})
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert "tenant_slug" in _detail(resp)["reason"]

    def test_coords_real_row_shape_is_accepted(self, admin_client: TestClient):
        """The counterweight: the exact six-key shape
        ``routes_phase3::get_group_tenant_roles`` emits — including its
        nullable ``tenant_id`` — must pass every check and reach the ordinary
        guards. Without this, the row validation could be arbitrarily strict
        and every test above would still pass."""
        h = _Harness(
            body={
                "group_tenant_roles": [
                    {
                        "group_id": "other-group",
                        "tenant_slug": "acme",
                        "role": "admin",
                        "auto_create_tenant": True,
                        "created_at": "2026-08-01T00:00:00Z",
                        "tenant_id": None,
                    }
                ]
            }
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/scratch-group")

        assert resp.status_code == 200, resp.text
        assert h.deleter.calls == ["scratch-group"]


# ---------------------------------------------------------------------------
# V8 — the transport failures `_proxy_coord_get` does NOT convert
# ---------------------------------------------------------------------------


class TestUnconvertedTransportFailuresAreRefused:
    """``_proxy_coord_get`` maps only ``ConnectError`` and ``TimeoutException``
    to an ``HTTPException``.

    Every other ``httpx.HTTPError`` — ``RemoteProtocolError`` from a load
    balancer cutting the response mid-flight is the realistic one — escaped the
    reader and surfaced as a bare 500. Nothing was deleted, so this was never a
    safety hole; it was an undiagnosable one, and it made the reader's "EVERY
    failure of the read" contract untrue. These pin the typed refusal.
    """

    @pytest.mark.parametrize(
        "exc",
        [
            httpx.RemoteProtocolError("server disconnected"),
            httpx.ReadError("connection reset"),
            httpx.WriteError("broken pipe"),
            httpx.ProxyError("bad gateway from proxy"),
        ],
        ids=lambda e: type(e).__name__,
    )
    def test_an_unconverted_transport_failure_refuses(
        self, admin_client: TestClient, exc: Exception
    ):
        h = _Harness(coord_error=exc)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert resp.status_code == 502, resp.text
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unavailable"
        assert type(exc).__name__ in detail["message"]
        assert h.deleter.calls == []

    def test_it_reports_no_status_because_coord_never_answered(
        self, admin_client: TestClient
    ):
        """The sibling arm carries coord's real status; this one has none to
        carry. Reporting a number here would invent an answer coord never
        gave — the same dishonesty the unreadable arm avoids by omitting the
        field entirely."""
        h = _Harness(coord_error=httpx.RemoteProtocolError("server disconnected"))
        detail = _detail(h.run(admin_client, f"{_GROUPS_URL}/acme-devs"))

        assert detail["coord_status"] is None

    @pytest.mark.parametrize(
        "exc",
        [httpx.ConnectError("refused"), httpx.ReadTimeout("too slow")],
        ids=lambda e: type(e).__name__,
    )
    def test_a_synthesized_transport_code_is_not_reported_as_coords(
        self, admin_client: TestClient, exc: Exception
    ):
        """``_proxy_coord_get`` INVENTS a 502 for a connect error and a 504 for
        a timeout. Those are qontinui-web's own numbers — coord never answered
        — so reporting them as ``coord_status`` names an answer coord never
        gave, exactly what the unreadable arm avoids by carrying no status.

        This is also the coupling guard for
        ``_COORD_SYNTHESIZED_TRANSPORT_DETAILS``: it mirrors literals in
        ``_proxy_coord_get``, and changing them there reds this."""
        h = _Harness(coord_error=exc)
        detail = _detail(h.run(admin_client, f"{_GROUPS_URL}/acme-devs"))

        assert detail["error"] == "mapping_check_unavailable"
        assert detail["coord_status"] is None, (
            f"a web-synthesized code is reported as coord's: {detail}"
        )
        assert "coord answered" not in detail["message"]
        assert h.deleter.calls == []

    def test_a_real_coord_status_is_still_reported_as_one(
        self, admin_client: TestClient
    ):
        """Counterweight to the two arms above: dropping the status when coord
        never answered must not drop it when coord DID. A coord 403 — the
        caller holding no coord admin role — still carries its 403, and still
        says coord answered."""
        h = _Harness(coord_status=403)
        detail = _detail(h.run(admin_client, f"{_GROUPS_URL}/acme-devs"))

        assert detail["coord_status"] == 403
        assert "coord answered 403" in detail["message"]
        assert h.deleter.calls == []

    def test_a_value_error_from_before_the_response_is_not_mislabelled(
        self, admin_client: TestClient
    ):
        """The decode arm catches ``JSONDecodeError``/``UnicodeDecodeError``,
        NOT the wider ``ValueError`` they subclass.

        A ``ValueError`` raised before any response exists — a malformed
        ``COORD_URL``, say — is not a body problem. Catching it would report
        "the body is not JSON" under a message asserting coord answered, i.e.
        name a cause that is not the actual one, which is exactly what these
        refusals exist to avoid. Letting it escape is fail-CLOSED (nothing is
        deleted) and honest by absence.
        """
        from app.services import cognito_admin

        deleter = _Deleter()
        instance = MagicMock()
        instance.get = AsyncMock(side_effect=ValueError("COORD_URL is malformed"))
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "app.api.v1.endpoints.operations.httpx.AsyncClient",
                return_value=instance,
            ),
            patch.object(cognito_admin, "delete_group", deleter),
            pytest.raises(ValueError, match="COORD_URL is malformed"),
        ):
            admin_client.delete(
                f"{_GROUPS_URL}/acme-devs",
                headers={"Authorization": f"Bearer {_CALLER_TOKEN}"},
            )

        assert deleter.calls == []


# ---------------------------------------------------------------------------
# V9 — the phantom-cover scenario itself, end to end
# ---------------------------------------------------------------------------


class TestPhantomAdminCoverCannotSuppressTheLastAdminGuard:
    """The scenario the row check exists for, constructed rather than described.

    V7 proves an unreadable row is refused. It does NOT prove the harm that
    makes the refusal necessary, because in every V7 case the target group has
    no valid mapping of its own — so pre-check those deleted a merely
    unattributable group. The dangerous shape is different and needs both rows:

      1. a REAL mapping making this group the only admin on a tenant, and
      2. an unreadable row whose ``group_id`` does not resolve.

    Row 2 lands in ``_tenants_stranded_by``'s "admin conferred by OTHER groups"
    set — because its coerced ``""`` is `!=` the group being deleted — and so
    stands in as cover from a group that does not exist. Guard 3 then finds
    nothing stranded, and guard 3 is the one with NO override.

    Each case here is a delete that MUST NOT happen. `409` (a guard fired) and
    `502` (the table was refused) are both acceptable outcomes; `200` is not,
    and neither is a non-empty ``deleter.calls``.
    """

    @pytest.mark.parametrize(
        ("phantom", "label"),
        [
            ({"group_id": "   ", "tenant_slug": "acme", "role": "admin"}, "whitespace"),
            ({"group_id": "", "tenant_slug": "acme", "role": "admin"}, "empty string"),
            ({"group_id": None, "tenant_slug": "acme", "role": "admin"}, "null"),
            ({"tenant_slug": "acme", "role": "admin"}, "absent"),
            (
                {"groupId": "some-other", "tenant_slug": "acme", "role": "admin"},
                "camelCase key",
            ),
            (
                {"group_id": "\t\n ", "tenant_slug": "acme", "role": "admin"},
                "tab/newline",
            ),
            # `.strip()` must reach every character Python calls whitespace,
            # not just ASCII — these two are the ones a naive `== " "` or an
            # ASCII-only strip would miss.
            (
                {"group_id": " ", "tenant_slug": "acme", "role": "admin"},
                "non-breaking space",
            ),
            (
                {"group_id": "　", "tenant_slug": "acme", "role": "admin"},
                "ideographic space",
            ),
            # The other two identity fields matter for the same reason: a blank
            # `tenant_slug` on the real mapping makes guard 3 skip the tenant
            # entirely, and a blank `role` makes it confer nothing.
            (
                {"group_id": "other-group", "tenant_slug": "  ", "role": "admin"},
                "blank tenant_slug",
            ),
            (
                {"group_id": "other-group", "tenant_slug": "acme", "role": " "},
                "blank role",
            ),
            # Below: shapes a `.strip()`-only check does NOT catch. Each is a
            # value that survives stripping and still compares unequal to the
            # identifier it imitates — which is the whole mechanism, not a
            # spelling of it.
            (
                {"group_id": " acme-devs ", "tenant_slug": "acme", "role": "admin"},
                "PADDED copy of the target group id",
            ),
            (
                {"group_id": "\tacme-devs", "tenant_slug": "acme", "role": "admin"},
                "tab-prefixed copy of the target",
            ),
            (
                {"group_id": "acme-devs\n", "tenant_slug": "acme", "role": "admin"},
                "newline-suffixed copy of the target",
            ),
            (
                {"group_id": "\u200b", "tenant_slug": "acme", "role": "admin"},
                "zero-width space (str.strip leaves it)",
            ),
            (
                {"group_id": "\ufeff", "tenant_slug": "acme", "role": "admin"},
                "BOM / zero-width no-break space",
            ),
            (
                {"group_id": "\u200c", "tenant_slug": "acme", "role": "admin"},
                "zero-width non-joiner",
            ),
            (
                {"group_id": "\u2060", "tenant_slug": "acme", "role": "admin"},
                "word joiner",
            ),
            (
                {"group_id": "\u00ad", "tenant_slug": "acme", "role": "admin"},
                "soft hyphen",
            ),
            (
                {"group_id": "acme-devs\u200b", "tenant_slug": "acme", "role": "admin"},
                "invisible-suffixed copy of the target",
            ),
        ],
    )
    def test_a_phantom_cover_row_cannot_get_the_delete_through(
        self, admin_client: TestClient, phantom: dict[str, Any], label: str
    ):
        h = _Harness(
            body={
                "group_tenant_roles": [
                    _mapping("acme-devs", "acme", "admin"),
                    phantom,
                ]
            }
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")

        assert h.deleter.calls == [], f"{label}: phantom cover got the delete through"
        # 502 per case, not `in (409, 502)`: every shape here is the table being
        # refused as unreadable, and a disjunction would let "guard 3 happened to
        # fire" pass for "the row was rejected" — two different reasons, only one
        # of which this class is about. The 409 path has its own test below.
        assert resp.status_code == 502, f"{label}: {resp.text}"
        assert _detail(resp)["error"] == "mapping_check_unreadable", label

    @pytest.mark.parametrize(
        ("group_id", "label"),
        [
            (" acme-devs ", "padded"),
            ("\t" + "acme-devs", "tab-prefixed"),
            ("acme-devs" + "\u200b", "invisible-suffixed"),
        ],
    )
    def test_a_lookalike_needs_no_override_flag_at_all(
        self, admin_client: TestClient, group_id: str, label: str
    ):
        """The sharpest shape: ONE row, no query parameters.

        A row whose ``group_id`` merely LOOKS like the group being deleted is
        not caught by guard 1 (it compares unequal, so nothing reads as
        mapped) and is counted by guard 3 as admin cover from another group.
        Both derived guards go quiet on a single row with no override — which
        makes this strictly more reachable than the phantom-cover pairs above,
        and it is one mis-pasted space away from a real mapping.
        """
        h = _Harness(body={"group_tenant_roles": [_mapping(group_id, "acme", "admin")]})
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")

        assert h.deleter.calls == [], f"{label}: a lookalike row got the delete through"
        assert resp.status_code == 502, f"{label}: {resp.text}"

    @pytest.mark.parametrize(
        ("role", "label"),
        [
            ("\u200b" + "admin", "invisible-prefixed role"),
            ("admin" + "\u200b", "invisible-suffixed role"),
        ],
    )
    def test_an_unreadable_role_on_the_REAL_row_is_refused(
        self, admin_client: TestClient, role: str, label: str
    ):
        """Same mechanism, inverted: the row that should TRIGGER guard 3 is the
        unreadable one. ``_row_confers_admin`` lowercases and matches against a
        closed vocabulary, so an invisible character makes a real admin mapping
        confer nothing — and the tenant is stranded with the guard silent.
        """
        h = _Harness(body={"group_tenant_roles": [_mapping("acme-devs", "acme", role)]})
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")

        assert h.deleter.calls == [], f"{label}: the delete went through"
        assert resp.status_code == 502, f"{label}: {resp.text}"

    def test_the_control_refuses_without_the_phantom_row(
        self, admin_client: TestClient
    ):
        """Same table minus the phantom row: guard 3 fires on its own. Without
        this the tests above could pass for the wrong reason — a delete that
        was never going to happen anyway proves nothing about cover."""
        h = _Harness(rows=[_mapping("acme-devs", "acme", "admin")])
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")

        assert resp.status_code == 409, resp.text
        detail = _detail(resp)
        assert detail["error"] == "last_admin_mapping"
        assert detail["tenants"] == ["acme"]
        assert h.deleter.calls == []

    def test_genuine_cover_from_a_real_other_group_still_permits_the_delete(
        self, admin_client: TestClient
    ):
        """And the counterweight: a REAL second group conferring admin is
        genuine cover, and the delete must still go through. Otherwise the
        check above could be satisfied by refusing every last-admin table."""
        h = _Harness(
            rows=[
                _mapping("acme-devs", "acme", "admin"),
                _mapping("acme-admins", "acme", "admin"),
            ]
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")

        assert resp.status_code == 200, resp.text
        assert h.deleter.calls == ["acme-devs"]
