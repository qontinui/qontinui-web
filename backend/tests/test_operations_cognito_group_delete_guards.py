"""Blast-radius guards on ``DELETE /coord/cognito/groups/{group_name}``.

Plans ``2026-08-27-members-page-delete-paths-authorization-and-blast-radius``
Phase 2 and ``2026-08-28-pool-wide-blast-radius-read-for-group-delete``. The
route deletes a **pool-wide** Cognito group: irreversible, not scoped to a
tenant, and — before Phase 2 — one unconfirmed click away from taking coord's
SSO mappings down with it. ``require_admin`` bounds who may call it; these
tests pin what it refuses to do.

Three guards, one test class each:

* ``group_is_mapped`` — coord maps the group to at least one tenant (409). No
  FK backs this (``group_id`` is bare TEXT in
  ``coord_group_claim_provisioning``), so the handler is the only place it can
  be enforced.
* ``home_group_requires_override`` — a ``<slug>-home`` group pins its members'
  home tenant (409 without ``allow_home_group=true``).
* ``last_admin_mapping`` — the delete would leave a tenant with no admin at all
  (409, **no override**).

WHAT CHANGED, AND WHY THE SHAPE OF THIS FILE CHANGED WITH IT
------------------------------------------------------------

Guards 1 and 3 used to be derived from coord's mappings LIST
(``GET /admin/coord/group-tenant-roles``) through a reader whose docstring
claimed "every ``coord.group_tenant_roles`` row". It was not: that route is
TENANT-SCOPED and INNER-joined, so a mapping into ANOTHER tenant, or into a
tenant not materialised yet, never reached the guards. Both went vacuous and
the pool-wide delete proceeded — on a well-formed 200 carrying a well-formed
list of well-formed rows. Every envelope and row check passed, because it was
not a malformed answer to the right question; it was a correct answer to the
WRONG one.

They now read ``GET /admin/coord/group-tenant-roles/blast-radius``, which
returns a VERDICT: counts plus, for the caller's own tenant only, slugs. So:

* the two regression tests for that defect are
  ``test_a_mapping_in_another_tenant_is_still_mapped`` and
  ``test_a_mapping_into_an_unmaterialised_tenant_is_still_mapped`` — both
  DELETE successfully on ``origin/main`` before this change;
* ``TestUnreadableRowsAreRefused`` becomes
  :class:`TestUnreadableVerdictFieldsAreRefused` — same discipline (validate
  past the envelope, refuse rather than default), applied to the fields that
  now arrive, plus the SUM INVARIANT, which is the verdict's own version of
  "a bucket went missing";
* the role-vocabulary classes that used to live here —
  ``TestAdminCoverMatchesCoordsOwnComparison`` (case-variant ``admin``) and
  most of ``TestPhantomAdminCoverCannotSuppressTheLastAdminGuard`` — did not
  disappear, they **moved across the repo boundary**. Roles and group ids no
  longer cross the wire, so this process cannot get their comparison wrong any
  more; coord decides, and pins it in
  ``routes_phase3::tests::blast_radius_admin_is_byte_exact_and_excludes_owner``
  and its siblings. What survives here is the part still carried on the wire:
  a tenant slug that LOOKS like a real one — :class:`TestLookalikeSlugsAreRefused`.

Every negative class carries a counterweight that must still SUCCEED — an
all-zero verdict deletes — because a fix that refused everything would satisfy
every negative test in the file and be its own failure.

The coord read is stubbed at ``httpx.AsyncClient`` — the same seam
``test_operations_tenants_proxy.py`` uses — so nothing here needs a live coord,
and ``cognito_admin.delete_group`` is patched so a guard that fails open is
caught by ``assert not deleted`` rather than by an AWS bill.

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
_BLAST_RADIUS_PATH = "/admin/coord/group-tenant-roles/blast-radius"


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


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    """Give every test its own rate-limit bucket.

    Phase 3 item 10 put a 5-per-minute cap on this route (it is the only
    irreversible one of the four mutating group routes). slowapi's memory
    storage is process-wide and these tests share a bucket — the TestClient
    sends no distinguishing bearer on most of them — so without a reset the
    sixth DELETE in this module would 429 and every assertion after it would
    be testing the limiter instead of the guards.

    Resetting the STORAGE rather than disabling the limiter keeps the
    decorator on the code path, so a regression that breaks it (slowapi
    requires a ``request: Request`` parameter, for instance) still fails
    here rather than in production.
    """
    from app.middleware.rate_limit import user_limiter

    user_limiter.reset()
    yield
    user_limiter.reset()


@pytest.fixture()
def admin_client() -> TestClient:
    return TestClient(_build_admin_app())


def _own(tenant_slug: str, role: str = "operator") -> dict[str, Any]:
    """One ``mapped_own_tenant`` entry, in coord's exact serialized shape."""
    return {
        "tenant_slug": tenant_slug,
        "role": role,
        "auto_create_tenant": True,
    }


#: The group every fixture is about unless it says otherwise. Named so the
#: `group_id` echo and the URL under test cannot drift apart silently.
_GROUP = "acme-devs"


def _verdict(
    *,
    group_id: str = _GROUP,
    own: list[dict[str, Any]] | None = None,
    other: int = 0,
    unmaterialized: int = 0,
    strands_own: list[str] | None = None,
    strands_other: int = 0,
    mapped_total: int | None = None,
) -> dict[str, Any]:
    """Coord's blast-radius body.

    ``mapped_total`` defaults to the SUM of the three buckets — the invariant
    coord asserts and the reader re-checks — so a test that wants to break the
    invariant has to say so explicitly rather than breaking it by accident.
    """
    own = own or []
    return {
        "group_id": group_id,
        "mapped_total": (
            len(own) + other + unmaterialized if mapped_total is None else mapped_total
        ),
        "mapped_own_tenant": own,
        "mapped_other_tenant_rows": other,
        "mapped_unmaterialized_rows": unmaterialized,
        "strands_own_tenant": strands_own or [],
        "strands_other_tenant_count": strands_other,
    }


class _Deleter:
    """Stand-in for ``cognito_admin.delete_group`` that records its calls."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __call__(self, group_name: str) -> None:
        self.calls.append(group_name)


#: ``body=`` sentinel: "use ``verdict``" (distinct from an explicit
#: ``body=None``, which is itself one of the malformed cases).
_FROM_VERDICT = object()


class _Harness:
    """A DELETE run with the coord blast-radius read stubbed.

    ``verdict`` is what coord's
    ``GET /admin/coord/group-tenant-roles/blast-radius`` returns;
    ``coord_error`` (an exception instance) makes that read fail instead.

    ``body`` overrides the whole 200 payload, which is how the malformed-200
    cases are expressed — coord's HTTP status says nothing about whether the
    body is the verdict. ``json_error`` makes ``resp.json()`` itself raise, the
    "200 carrying HTML from a proxy" case.
    """

    def __init__(
        self,
        verdict: dict[str, Any] | None = None,
        coord_error: Exception | None = None,
        coord_status: int = 200,
        body: Any = _FROM_VERDICT,
        json_error: Exception | None = None,
        coord_text: str = '{"error":"admin_required"}',
    ) -> None:
        # `body` and `json_error` each SHADOW what comes below them, so a test
        # setting two of these would silently exercise an input it did not
        # intend — the "the harness quietly used its default" hazard these
        # tests exist to catch, turned on the harness itself.
        assert verdict is None or body is _FROM_VERDICT, (
            "pass verdict= or body=, not both"
        )
        assert json_error is None or body is _FROM_VERDICT, (
            "json_error= shadows body=; pass one"
        )
        self.verdict = verdict if verdict is not None else _verdict()
        self.coord_error = coord_error
        self.coord_status = coord_status
        self.body = body
        self.json_error = json_error
        self.coord_text = coord_text
        self.deleter = _Deleter()
        self.get_calls: list[Any] = []

    def run(self, client: TestClient, path: str) -> httpx.Response:
        from app.services import cognito_admin

        resp = MagicMock(spec=httpx.Response)
        resp.status_code = self.coord_status
        if self.json_error is not None:
            resp.json.side_effect = self.json_error
        elif self.body is _FROM_VERDICT:
            resp.json.return_value = self.verdict
        else:
            resp.json.return_value = self.body
        resp.text = self.coord_text

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
# The coord CALL ITSELF — which route, with which query
# ---------------------------------------------------------------------------


class TestTheGuardsAskCoordThePoolWideQuestion:
    """The guards must ask the POOL-WIDE route, with the group as a QUERY param.

    Nothing else in this file would catch calling the wrong coord route: the
    stub answers any URL, so a guard pointed back at the tenant-scoped mappings
    list would pass every other test here while being exactly the defect this
    change removes. There was no URL assertion in this file before, and its
    absence is why that was possible.
    """

    def test_it_reads_the_blast_radius_route_not_the_mappings_list(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict())
        h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        url = h.get_calls[0].args[0]
        assert url.endswith(_BLAST_RADIUS_PATH), url
        # Belt and braces: the tenant-scoped list is a PREFIX of the new path,
        # so `endswith` alone would not catch a regression to it — but an exact
        # tail match on the list route would. State it directly.
        assert not url.endswith("/admin/coord/group-tenant-roles"), url

    def test_the_group_rides_as_a_query_param_not_in_the_path(
        self, admin_client: TestClient
    ) -> None:
        # Cognito group names are drawn from `\p{L}\p{M}\p{S}\p{N}\p{P}`,
        # which includes `#` and `?`. Interpolated into a URL those truncate it
        # or start a query string, and the guard would be answered about a
        # different group — or about no group at all.
        #
        # `#` rather than `/`: a literal slash cannot reach this endpoint's
        # `{group_name}` path param at all (it is a segment separator, so the
        # request never routes here), which makes it untestable from the
        # outside and NOT the case worth pinning.
        h = _Harness(verdict=_verdict(group_id="acme#devs"))
        h.run(admin_client, f"{_GROUPS_URL}/acme%23devs")
        assert h.get_calls[0].kwargs["params"] == {"group_id": "acme#devs"}
        assert "acme#devs" not in h.get_calls[0].args[0]

    def test_the_caller_bearer_is_forwarded_on_the_coord_read(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict())
        h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert h.get_calls, "coord must be read before the delete"
        headers = h.get_calls[0].kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"


# ---------------------------------------------------------------------------
# Guard 1 — a group coord maps is refused
# ---------------------------------------------------------------------------


class TestMappedGroupIsRefused:
    def test_mapped_group_is_409_naming_the_tenants_it_may_name(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict(own=[_own("acme"), _own("beta-corp")]))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "group_is_mapped"
        assert detail["tenants"] == ["acme", "beta-corp"]
        assert detail["mapped_total"] == 2
        assert "acme" in detail["message"] and "beta-corp" in detail["message"]
        assert h.deleter.calls == []

    def test_a_mapping_in_another_tenant_is_still_mapped(
        self, admin_client: TestClient
    ) -> None:
        """REGRESSION for blind spot 1.

        On ``origin/main`` before this change the tenant-scoped read returned
        an empty list for this exact situation, guard 1 saw nothing mapped, and
        the irreversible pool-wide delete went through. The caller may not be
        told WHICH tenant, so the refusal counts it — but it must refuse.
        """
        h = _Harness(verdict=_verdict(other=1))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "group_is_mapped"
        assert detail["tenants"] == []
        assert detail["mapped_total"] == 1
        assert detail["other_tenant_rows"] == 1
        assert h.deleter.calls == []

    def test_a_mapping_into_an_unmaterialised_tenant_is_still_mapped(
        self, admin_client: TestClient
    ) -> None:
        """REGRESSION for blind spot 2.

        An ``auto_create_tenant`` mapping — the row the Members page's own
        workflow creates, and the default — was dropped by the INNER join and
        so was invisible to guard 1. Deleting the group silently cancels that
        planned onboarding.
        """
        h = _Harness(verdict=_verdict(unmaterialized=1))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "group_is_mapped"
        assert detail["unmaterialized_rows"] == 1
        assert "do not exist yet" in detail["message"]
        assert h.deleter.calls == []

    def test_the_refusal_does_not_promise_an_immediate_sweep(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict(own=[_own("acme")]))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        message = _detail(resp)["message"]
        assert "next login" in message.lower()
        assert "sweep" not in message.lower()

    def test_unmapped_group_deletes(self, admin_client: TestClient) -> None:
        h = _Harness(verdict=_verdict())
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        assert h.deleter.calls == ["acme-devs"]

    def test_allow_mapped_override_reaches_aws(self, admin_client: TestClient) -> None:
        h = _Harness(verdict=_verdict(own=[_own("acme")]))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        assert resp.status_code == 200
        assert h.deleter.calls == ["acme-devs"]


class TestTheVerdictMustBeAboutThisGroup:
    """A verdict about a DIFFERENT group is not this group's clean bill of health.

    The row-shaped reader this replaced got the property for free: it
    re-attributed every row client-side (`_row_group_id(r) == group_name`), so a
    table about some other group produced an empty mapped set for THIS one. A
    verdict is pre-aggregated — nothing is left to re-attribute — so an
    all-zero answer about the wrong group is well-formed, sum-consistent, and
    indistinguishable from "this group breaks nothing", in front of an
    irreversible pool-wide delete.

    The realistic channel is not a malicious coord: it is a cache or proxy that
    keys on path and ignores the query string (the group rides in `params`), or
    a future coord regression binding the wrong parameter.
    """

    def test_a_verdict_about_another_group_is_refused(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict(group_id="some-other-group"))
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unreadable"
        assert "some-other-group" in detail["reason"]
        assert h.deleter.calls == []

    def test_an_all_zero_verdict_about_another_group_is_still_refused(
        self, admin_client: TestClient
    ) -> None:
        """The dangerous shape: nothing about it looks wrong."""
        h = _Harness(verdict=_verdict(group_id="some-other-group"))
        assert h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}").status_code == 502
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "echo",
        [None, "", "   ", " acme-devs", "acme-devs ", "acme\u200bdevs", 7],
        ids=["null", "empty", "blank", "lead-space", "trail-space", "zwsp", "number"],
    )
    def test_an_unusable_group_id_echo_is_refused(
        self, admin_client: TestClient, echo: Any
    ) -> None:
        body = _verdict()
        body["group_id"] = echo
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_a_missing_group_id_echo_is_refused(self, admin_client: TestClient) -> None:
        body = _verdict()
        del body["group_id"]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        assert resp.status_code == 502
        assert "group_id" in _detail(resp)["reason"]
        assert h.deleter.calls == []

    def test_the_matching_echo_is_the_control(self, admin_client: TestClient) -> None:
        """Without this the class above proves only that SOMETHING refuses."""
        h = _Harness(verdict=_verdict(group_id=_GROUP))
        assert h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}").status_code == 200
        assert h.deleter.calls == [_GROUP]


# ---------------------------------------------------------------------------
# Partial disclosure has to be HONEST
# ---------------------------------------------------------------------------


class TestPartialDisclosureIsHonest:
    """``detail["tenants"]`` is partial by design; the message must say so.

    Coord cannot verify this endpoint's superuser gate, so it names no tenant
    the caller does not administer. A refusal that listed only the nameable
    ones and stopped would read as a SMALLER blast radius than the one that
    stopped the operator — the same under-report, moved from the data layer to
    the copy. So every refusal carries the true total beside the partial list.
    """

    def test_guard_one_states_the_true_total_beside_the_partial_list(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict(own=[_own("acme")], other=3, unmaterialized=2))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        detail = _detail(resp)
        assert detail["tenants"] == ["acme"]
        assert detail["mapped_total"] == 6
        message = detail["message"]
        assert "acme" in message
        # MAPPINGS, not tenants: coord counts rows in these two buckets, and
        # three roles in one tenant must not read as "3 other tenants".
        assert "3 further mappings in tenants you do not administer" in message, (
            "'further' because a tenant WAS named before it"
        )
        assert "2 mappings into tenants that do not exist yet" in message
        assert "6 mappings in all" in message

    def test_guard_three_states_the_true_total_beside_the_partial_list(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(
            verdict=_verdict(
                own=[_own("acme", "admin")], strands_own=["acme"], strands_other=2
            )
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        detail = _detail(resp)
        assert detail["error"] == "last_admin_mapping"
        assert detail["tenants"] == ["acme"]
        assert detail["strands_total"] == 3
        # TENANTS here, not mappings: `strands_other_tenant_count` is a
        # distinct-tenant count, because stranding is a property of a tenant.
        assert "2 further tenants you do not administer" in detail["message"]
        assert "3 tenants in all" in detail["message"]

    def test_the_named_tenants_are_sorted_and_deduplicated(
        self, admin_client: TestClient
    ) -> None:
        """Coord emits one entry per ROW, and `(group_id, tenant_slug, role)` is
        the PK — so one group legitimately carries several rows in one tenant.
        Rendering them raw gives "mapped to acme, acme". `mapped_total` stays
        the honest size; the NAMES are a set."""
        # FIVE distinct slugs, supplied in reverse order. Deduplication alone
        # would pass with three; the count matters because `set` iteration
        # order is hash-based and randomised per process, so a `sorted()` that
        # was dropped could still come out ordered by chance. With five the
        # chance of that is 1/120 per run rather than 1/2.
        h = _Harness(
            verdict=_verdict(
                own=[
                    _own("zeta", "operator"),
                    _own("mu", "operator"),
                    _own("kappa", "operator"),
                    _own("beta", "operator"),
                    _own("acme", "admin"),
                    _own("acme", "operator"),
                ]
            )
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        detail = _detail(resp)
        assert detail["tenants"] == ["acme", "beta", "kappa", "mu", "zeta"], (
            "sorted AND deduplicated"
        )
        assert detail["mapped_total"] == 6, "the row count stays honest"
        assert "acme, beta, kappa, mu, zeta" in detail["message"]

    def test_every_stranded_tenant_the_caller_may_see_is_named(
        self, admin_client: TestClient
    ) -> None:
        """Carried over from the old `test_every_stranded_tenant_is_named`.

        Coord returns at most one own-tenant strand today, but this side parses
        and renders N — so N stays pinned here rather than resting on a
        property of the producer that this process cannot check.
        """
        h = _Harness(
            verdict=_verdict(
                own=[_own("acme", "admin"), _own("beta-corp", "admin")],
                strands_own=["beta-corp", "acme"],
            )
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}?allow_mapped=true")
        detail = _detail(resp)
        assert detail["error"] == "last_admin_mapping"
        assert detail["tenants"] == ["acme", "beta-corp"]
        assert detail["strands_total"] == 2
        assert "acme, beta-corp" in detail["message"]

    def test_singular_and_plural_read_correctly(self, admin_client: TestClient) -> None:
        h = _Harness(verdict=_verdict(other=1))
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        message = _detail(resp)["message"]
        # "1 mapping in tenants" -- the MAPPINGS are counted and singular; the
        # tenants are not counted at all, so that noun stays plural-agnostic.
        # No "further": nothing was named before it.
        assert "1 mapping in tenants you do not administer" in message
        assert "1 mappings" not in message
        assert "further" not in message
        assert "1 mapping in all" in message
        assert "1 mappings in all" not in message


# ---------------------------------------------------------------------------
# Guard 2 — `<slug>-home` pins a home tenant
# ---------------------------------------------------------------------------


class TestHomeGroupRequiresOverride:
    def test_home_group_is_refused_without_the_override(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict(group_id="acme-home"))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home")
        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "home_group_requires_override"
        assert detail["tenant_slug"] == "acme"
        assert h.deleter.calls == []

    def test_the_refusal_says_the_effect_is_deferred_to_next_login(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(verdict=_verdict(group_id="acme-home"))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home")
        message = _detail(resp)["message"]
        assert "next login" in message.lower()
        assert "deferred" in message.lower()

    def test_the_override_lets_it_through(self, admin_client: TestClient) -> None:
        h = _Harness(verdict=_verdict(group_id="acme-home"))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home?allow_home_group=true")
        assert resp.status_code == 200
        assert h.deleter.calls == ["acme-home"]

    def test_a_mapped_home_group_reports_the_mapping_first(
        self, admin_client: TestClient
    ) -> None:
        """Guard ordering: "remove the mapping first" outranks the home pin."""
        h = _Harness(verdict=_verdict(group_id="acme-home", own=[_own("acme")]))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-home")
        assert resp.status_code == 409
        assert _detail(resp)["error"] == "group_is_mapped"
        assert h.deleter.calls == []

    @pytest.mark.parametrize("group", ["home-team", "acme-homes"])
    def test_the_suffix_is_exact_not_a_substring(
        self, admin_client: TestClient, group: str
    ) -> None:
        h = _Harness(verdict=_verdict(group_id=group))
        resp = h.run(admin_client, f"{_GROUPS_URL}/{group}")
        assert resp.status_code == 200
        assert h.deleter.calls == [group]


# ---------------------------------------------------------------------------
# Guard 3 — the last admin, NO override
# ---------------------------------------------------------------------------


class TestLastAdminGuard:
    def test_last_admin_is_refused_even_with_allow_mapped(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(
            verdict=_verdict(own=[_own("acme", "admin")], strands_own=["acme"])
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "last_admin_mapping"
        assert detail["tenants"] == ["acme"]
        assert "no override" in detail["message"].lower()
        assert h.deleter.calls == []

    def test_no_combination_of_overrides_gets_past_it(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(
            verdict=_verdict(
                group_id="acme-home", own=[_own("acme", "admin")], strands_own=["acme"]
            )
        )
        resp = h.run(
            admin_client,
            f"{_GROUPS_URL}/acme-home?allow_mapped=true&allow_home_group=true",
        )
        assert resp.status_code == 409
        assert _detail(resp)["error"] == "last_admin_mapping"
        assert h.deleter.calls == []

    def test_stranding_another_tenant_is_refused(
        self, admin_client: TestClient
    ) -> None:
        """REGRESSION: guard 3 could never fire for another tenant before.

        Both its stranded-candidate set and its cover set came from the
        tenant-scoped rows, so a group that was the last admin cover for a
        DIFFERENT tenant read as harmless. The caller may not be told which
        tenant; the refusal counts it, and still has no override.
        """
        h = _Harness(verdict=_verdict(other=1, strands_other=1))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        assert resp.status_code == 409
        detail = _detail(resp)
        assert detail["error"] == "last_admin_mapping"
        assert detail["tenants"] == []
        assert detail["strands_total"] == 1
        assert h.deleter.calls == []

    def test_a_mapped_group_that_also_strands_reports_the_mapping_first(
        self, admin_client: TestClient
    ) -> None:
        """Guard ORDER, pinned. Both guards would refuse, so nothing but this
        says which one the operator is told about — and the module comment
        calls the order deliberate: "remove the mapping first" is an action the
        operator can take, while "this is the last admin" is a dead end until
        they do."""
        h = _Harness(
            verdict=_verdict(own=[_own("acme", "admin")], strands_own=["acme"])
        )
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        assert resp.status_code == 409
        assert _detail(resp)["error"] == "group_is_mapped"
        assert h.deleter.calls == []

    def test_a_mapped_group_that_strands_nobody_deletes_under_the_override(
        self, admin_client: TestClient
    ) -> None:
        """The counterweight for this class.

        Guard 3 must not become a second copy of guard 1: a mapped group with
        real admin cover elsewhere is exactly what ``allow_mapped`` is for.
        """
        h = _Harness(verdict=_verdict(own=[_own("acme", "admin")]))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        assert resp.status_code == 200
        assert h.deleter.calls == ["acme-devs"]

    def test_an_all_zero_verdict_deletes(self, admin_client: TestClient) -> None:
        """The counterweight for the whole file: refusing everything is its own
        failure, and it would satisfy every negative test here."""
        h = _Harness(verdict=_verdict())
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 200
        assert h.deleter.calls == ["acme-devs"]


# ---------------------------------------------------------------------------
# The ENVELOPE — a 200 whose body is not the verdict
# ---------------------------------------------------------------------------


class TestMalformedTwoHundredIsRefused:
    @pytest.mark.parametrize(
        "body",
        [None, [], ["acme-devs"], "group_tenant_roles", 7],
        ids=["null", "empty-list", "list-of-names", "string", "number"],
    )
    def test_a_body_that_is_not_an_object_is_refused(
        self, admin_client: TestClient, body: Any
    ) -> None:
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_a_two_hundred_that_is_not_json_at_all_is_refused(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(json_error=json.JSONDecodeError("Expecting value", "<html>", 0))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unreadable"
        assert "not JSON" in detail["reason"]
        assert h.deleter.calls == []

    def test_the_refusal_distinguishes_itself_from_an_unreachable_coord(
        self, admin_client: TestClient
    ) -> None:
        """The two codes are pinned as LITERALS on purpose.

        "coord never answered" and "coord answered with something that is not
        the verdict" send the operator to different places — an outage to wait
        out versus a coord/proxy defect to chase.
        """
        unreadable = _Harness(body=None)
        assert (
            _detail(unreadable.run(admin_client, f"{_GROUPS_URL}/acme-devs"))["error"]
            == "mapping_check_unreadable"
        )
        unavailable = _Harness(coord_error=httpx.ConnectError("refused"))
        assert (
            _detail(unavailable.run(admin_client, f"{_GROUPS_URL}/acme-devs"))["error"]
            == "mapping_check_unavailable"
        )

    def test_the_refusal_does_not_claim_a_status_it_never_saw(
        self, admin_client: TestClient
    ) -> None:
        """``_proxy_coord_get`` discards the response object below 400, so this
        arm cannot know whether it was a 200, a 204 or a 302 from a proxy in
        front of coord. Naming one would point the operator at coord's handler
        when the fault is the hop before it."""
        h = _Harness(body=None)
        detail = _detail(h.run(admin_client, f"{_GROUPS_URL}/acme-devs"))
        assert "coord_status" not in detail
        assert "answered 200" not in detail["message"]


# ---------------------------------------------------------------------------
# The FIELDS — a well-formed object that is not the verdict
# ---------------------------------------------------------------------------


class TestUnreadableVerdictFieldsAreRefused:
    """Envelope checks alone leave the original defect one layer down.

    A well-formed object missing a count, or carrying a bucket that is not a
    number, is not a verdict — and a reader that defaulted it to zero would
    hand the guards a clean bill of health nobody issued.
    """

    @pytest.mark.parametrize(
        "key",
        [
            "mapped_total",
            "mapped_other_tenant_rows",
            "mapped_unmaterialized_rows",
            "strands_other_tenant_count",
        ],
    )
    def test_a_missing_count_is_refused_not_defaulted_to_zero(
        self, admin_client: TestClient, key: str
    ) -> None:
        body = _verdict()
        del body[key]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unreadable"
        assert key in detail["reason"]
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "value",
        [True, False, "1", 1.0, None, [], {}],
        ids=["true", "false", "str", "float", "null", "list", "dict"],
    )
    @pytest.mark.parametrize(
        "key",
        [
            "mapped_other_tenant_rows",
            "mapped_unmaterialized_rows",
            "strands_other_tenant_count",
        ],
    )
    def test_a_count_that_is_not_an_integer_is_refused(
        self, admin_client: TestClient, value: Any, key: str
    ) -> None:
        """``True`` and ``False`` are the sharp ones.

        ``isinstance(True, int)`` is ``True`` in Python, so a plain int check
        accepts them and ``mapped_total = True`` then compares equal to ``1``:
        a verdict that reads as "one mapping" when coord sent a boolean. That
        is the complete-looking-but-wrong shape this whole module refuses.
        """
        # Every count key, not one. The check lives in a single helper, so a
        # per-key escape is not reachable today -- but a test named for a class
        # that covers one member of it is how a later per-key special case gets
        # in unnoticed.
        #
        # `mapped_total` is deliberately EXCLUDED from `key`: a boolean there is
        # caught by the SUM invariant instead, so including it would let this
        # test pass while proving nothing about the bool rejection it is named
        # for. It is covered by `test_a_broken_sum_invariant_is_refused`.
        body = _verdict()
        body[key] = value
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_a_negative_strand_count_cannot_cancel_a_real_strand(
        self, admin_client: TestClient
    ) -> None:
        """The case the negative check exists for, and the one the sibling test
        below does NOT reach.

        `strands_total` is a SUM of two fields. With `strands_own_tenant` empty
        a negative makes the total truthy and guard 3 fires anyway — so that
        fixture proves nothing about cancellation. Here the two sides cancel to
        exactly zero, and without the negative check the delete would proceed
        past a real, named strand.
        """
        body = _verdict(own=[_own("acme", "admin")], strands_own=["acme"])
        body["strands_other_tenant_count"] = -1
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}?allow_mapped=true")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    @pytest.mark.parametrize("key", ["mapped_total", "strands_other_tenant_count"])
    def test_a_negative_count_is_refused(
        self, admin_client: TestClient, key: str
    ) -> None:
        """A negative cannot be produced by counting anything, so its presence
        means the body is not the verdict — and on the strand side it could
        cancel a real strand out to zero, silencing the guard with no
        override."""
        body = _verdict(own=[_own("acme")])
        body[key] = -1
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unreadable"
        assert "negative" in detail["reason"]
        assert h.deleter.calls == []

    @pytest.mark.parametrize("key", ["mapped_own_tenant", "strands_own_tenant"])
    def test_a_missing_list_is_refused(
        self, admin_client: TestClient, key: str
    ) -> None:
        body = _verdict()
        del body[key]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert key in _detail(resp)["reason"]
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "value", [None, "acme", {}, 3], ids=["null", "string", "dict", "number"]
    )
    def test_a_non_list_where_a_list_belongs_is_refused(
        self, admin_client: TestClient, value: Any
    ) -> None:
        body = _verdict()
        body["strands_own_tenant"] = value
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "entry",
        [None, 7, [], True, "acme"],
        ids=["null", "number", "list", "bool", "bare-string"],
    )
    def test_a_mapped_own_tenant_entry_that_is_not_an_object_is_refused(
        self, admin_client: TestClient, entry: Any
    ) -> None:
        """`bare-string` is the interesting one. Coord emits row OBJECTS here
        and bare STRINGS in `strands_own_tenant`; accepting either everywhere
        would make this parser looser than the contract it validates, which is
        the wrong direction for a module whose whole job is refusing answers
        that are not the answer."""
        body = _verdict(mapped_total=1)
        body["mapped_own_tenant"] = [entry]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "entry",
        [None, 7, [], True, {"tenant_slug": "acme"}],
        ids=["null", "number", "list", "bool", "object"],
    )
    def test_a_strands_own_tenant_entry_that_is_not_a_string_is_refused(
        self, admin_client: TestClient, entry: Any
    ) -> None:
        body = _verdict(own=[_own("acme", "admin")])
        body["strands_own_tenant"] = [entry]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}?allow_mapped=true")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "value", [None, "acme", {}, 3], ids=["null", "string", "dict", "number"]
    )
    def test_a_non_list_mapped_own_tenant_is_refused(
        self, admin_client: TestClient, value: Any
    ) -> None:
        body = _verdict()
        body["mapped_own_tenant"] = value
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/{_GROUP}")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_an_own_tenant_entry_with_no_slug_is_refused_not_skipped(
        self, admin_client: TestClient
    ) -> None:
        """Skipping it would silently narrow the guard's input — and the entry
        skipped could be the one that makes this delete strand a tenant."""
        body = _verdict(mapped_total=2)
        body["mapped_own_tenant"] = [_own("acme"), {"role": "admin"}]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert "tenant_slug" in _detail(resp)["reason"]
        assert h.deleter.calls == []

    def test_a_broken_sum_invariant_is_refused(self, admin_client: TestClient) -> None:
        """The verdict's own version of "a bucket went missing".

        A well-formed verdict whose buckets do not add up means something was
        lost between coord's SQL and this parse — and a missing bucket is
        exactly how "mapped in another tenant" became "mapped nowhere".
        """
        body = _verdict(own=[_own("acme")], other=2, mapped_total=1)
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unreadable"
        assert "sum" in detail["reason"]
        assert h.deleter.calls == []

    def test_coords_real_verdict_shape_is_accepted(
        self, admin_client: TestClient
    ) -> None:
        """The counterweight: coord's exact serialized body must pass.

        Keyed on the shape ``get_group_tenant_roles_blast_radius`` actually
        emits — extra keys and all — so a validator that got stricter than
        coord is caught here rather than in production.
        """
        body = {
            "group_id": "acme-devs",
            "mapped_total": 1,
            "mapped_own_tenant": [
                {
                    "tenant_slug": "acme",
                    "role": "operator",
                    "auto_create_tenant": True,
                }
            ],
            "mapped_other_tenant_rows": 0,
            "mapped_unmaterialized_rows": 0,
            "strands_own_tenant": [],
            "strands_other_tenant_count": 0,
        }
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        assert resp.status_code == 200
        assert h.deleter.calls == ["acme-devs"]


# ---------------------------------------------------------------------------
# Lookalike slugs
# ---------------------------------------------------------------------------


class TestLookalikeSlugsAreRefused:
    """What survives here of the old phantom-cover class.

    Roles and group ids no longer cross the wire, so the comparisons that used
    to be forgeable are now coord's and are pinned there. Tenant SLUGS still
    cross, and they still reach an operator-facing refusal message. A slug
    carrying a zero-width space renders identically to a real one and is a
    different value, so it is refused rather than displayed.
    """

    @pytest.mark.parametrize(
        "slug",
        [
            " acme",
            "acme ",
            "\tacme",
            "acme\n",
            "",
            "   ",
            "ac​me",  # ZWSP
            "﻿acme",  # BOM
            "ac‌me",  # ZWNJ
            "ac⁠me",  # word joiner
            "ac­me",  # soft hyphen
            "acme ",  # NBSP — str.strip() DOES remove this one
        ],
    )
    def test_a_lookalike_slug_in_the_strand_list_is_refused(
        self, admin_client: TestClient, slug: str
    ) -> None:
        body = _verdict(own=[_own("acme", "admin")])
        body["strands_own_tenant"] = [slug]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        assert resp.status_code == 502, (
            "a lookalike slug is UNKNOWN, not a strand and not an absence"
        )
        assert _detail(resp)["error"] == "mapping_check_unreadable"
        assert h.deleter.calls == []

    def test_a_lookalike_slug_in_the_mapped_list_is_refused(
        self, admin_client: TestClient
    ) -> None:
        body = _verdict(mapped_total=1)
        body["mapped_own_tenant"] = [_own("ac​me")]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert h.deleter.calls == []

    def test_a_null_slug_is_refused(self, admin_client: TestClient) -> None:
        body = _verdict(mapped_total=1)
        body["mapped_own_tenant"] = [{"tenant_slug": None, "role": "admin"}]
        h = _Harness(body=body)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert h.deleter.calls == []

    def test_the_control_passes_without_the_lookalike(
        self, admin_client: TestClient
    ) -> None:
        """Without this the class above proves only that SOMETHING refuses."""
        body = _verdict(own=[_own("acme", "admin")])
        body["strands_own_tenant"] = ["acme"]
        h = _Harness(body=body)
        # `allow_mapped=true` so guard 1 stands aside and guard 3 is what
        # answers — the same override the lookalike cases above pass through.
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs?allow_mapped=true")
        assert resp.status_code == 409
        assert _detail(resp)["error"] == "last_admin_mapping"
        assert h.deleter.calls == []


# ---------------------------------------------------------------------------
# The READ failing — every arm is UNKNOWN, and UNKNOWN refuses
# ---------------------------------------------------------------------------


class TestUnreachableCoordIsRefused:
    def test_an_unreadable_coord_refuses_rather_than_assuming_no_mappings(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(coord_error=httpx.ConnectError("connection refused"))
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        assert _detail(resp)["error"] == "mapping_check_unavailable"
        assert h.deleter.calls == []

    @pytest.mark.parametrize("status", [403, 404, 500, 503])
    def test_a_coord_status_is_reported_as_coords_own(
        self, admin_client: TestClient, status: int
    ) -> None:
        """404 is the one that matters most.

        It is what a coord deployment PREDATING the blast-radius route
        returns. A web release that reaches production ahead of coord's must
        refuse group deletes, not fail open — and self-heal the moment coord
        deploys.
        """
        h = _Harness(coord_status=status)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unavailable"
        assert detail["coord_status"] == status
        assert h.deleter.calls == []

    def test_the_message_names_the_predeployed_coord_case(
        self, admin_client: TestClient
    ) -> None:
        h = _Harness(coord_status=404)
        message = _detail(h.run(admin_client, f"{_GROUPS_URL}/acme-devs"))["message"]
        assert "404" in message
        assert "not yet deployed" in message

    @pytest.mark.parametrize(
        "exc",
        [
            httpx.RemoteProtocolError("server disconnected"),
            httpx.ReadError("read failed"),
            httpx.WriteError("write failed"),
            httpx.ProxyError("proxy failed"),
        ],
        ids=["remote-protocol", "read", "write", "proxy"],
    )
    def test_an_unconverted_transport_failure_refuses(
        self, admin_client: TestClient, exc: Exception
    ) -> None:
        """``_proxy_coord_get`` converts only ``ConnectError`` and
        ``TimeoutException``; the rest of ``httpx.HTTPError`` used to escape as
        a bare 500 — safe, but undiagnosable."""
        h = _Harness(coord_error=exc)
        resp = h.run(admin_client, f"{_GROUPS_URL}/acme-devs")
        assert resp.status_code == 502
        detail = _detail(resp)
        assert detail["error"] == "mapping_check_unavailable"
        assert type(exc).__name__ in detail["message"]
        assert detail["coord_status"] is None
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "exc",
        [httpx.ConnectError("refused"), httpx.ConnectTimeout("timed out")],
        ids=["connect", "timeout"],
    )
    def test_a_synthesized_transport_code_is_not_reported_as_coords(
        self, admin_client: TestClient, exc: Exception
    ) -> None:
        """The 502/504 ``_proxy_coord_get`` invents are OURS, not coord's.

        The discriminator is the ``CoordTransportUnavailable`` TYPE. Matching
        the detail string instead would demote a genuine coord 5xx whose body
        happens to read like our transport text — ``_proxy_coord_get`` passes
        ``resp.text`` straight through as the detail, so that body is
        attacker- or proxy-controlled.
        """
        h = _Harness(coord_error=exc)
        detail = _detail(h.run(admin_client, f"{_GROUPS_URL}/acme-devs"))
        assert detail["coord_status"] is None
        assert "coord answered" not in detail["message"]
        assert h.deleter.calls == []

    @pytest.mark.parametrize(
        "text",
        ["coord is not reachable", "timeout waiting for coord"],
    )
    def test_a_coord_error_body_cannot_forge_a_transport_failure(
        self, admin_client: TestClient, text: str
    ) -> None:
        h = _Harness(coord_status=503, coord_text=text)
        detail = _detail(h.run(admin_client, f"{_GROUPS_URL}/acme-devs"))
        assert detail["coord_status"] == 503
        assert "coord answered 503" in detail["message"]
        assert h.deleter.calls == []

    def test_a_value_error_from_before_the_response_is_not_mislabelled(
        self, admin_client: TestClient
    ) -> None:
        """Only ``JSONDecodeError`` / ``UnicodeDecodeError`` are caught, not the
        wider ``ValueError`` they subclass.

        A ``ValueError`` raised BEFORE the response exists (a malformed
        ``COORD_URL``, say) reported as "the body is not JSON" would name a
        cause that is not the actual one, under a message asserting coord
        answered — the exact dishonesty these refusals exist to avoid. It
        escapes instead. Nothing is deleted either way, which is the property
        that matters.
        """
        from app.services import cognito_admin

        deleter = _Deleter()
        instance = MagicMock()
        instance.get = AsyncMock(side_effect=ValueError("bad COORD_URL"))
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        with (
            patch(
                "app.api.v1.endpoints.operations.httpx.AsyncClient",
                return_value=instance,
            ),
            patch.object(cognito_admin, "delete_group", deleter),
            pytest.raises(ValueError),
        ):
            admin_client.delete(
                f"{_GROUPS_URL}/acme-devs",
                headers={"Authorization": f"Bearer {_CALLER_TOKEN}"},
            )
        assert deleter.calls == []
