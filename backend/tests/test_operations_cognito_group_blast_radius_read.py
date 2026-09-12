"""``GET /coord/cognito/groups/{group_name}/blast-radius`` — the delete's own
verdict, read ahead of the click.

Post-merge follow-up to qontinui-web#1114 (plan
``2026-08-28-pool-wide-blast-radius-read-for-group-delete``, open question 2).
That PR moved the DELETE's guards from coord's tenant-scoped mappings LIST to
the pool-wide blast-radius verdict — and left the dashboard's confirmation
dialog deriving its preview from the list. So the preview under-reported in
exactly the way the guards used to: it said "no coord tenant mappings
reference this group" and the delete then 409'd. This route is what the
dialog reads instead, and what these tests pin about it:

* it asks coord the SAME pool-wide question, through the SAME reader the
  delete runs (``_coord_group_blast_radius``) — a preview with its own
  reader could drift from the guard it previews;
* it returns the verdict with the same partial disclosure the 409s carry —
  own-tenant slugs named, every other tenant an integer — and the TOTALS
  beside them, so nothing in the body can be read as "the list is the whole
  blast radius";
* it fails CLOSED like the delete: a coord failure or an unreadable verdict is
  a 502 the dialog renders as UNKNOWN, never a zeroed verdict it would render
  as "breaks nothing".

The coord read is stubbed at ``httpx.AsyncClient``, the seam the delete-guard
tests use; the verdict builders and the admin app are imported from there so
the two files cannot disagree about coord's wire shape.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.test_operations_cognito_group_delete_guards import (
    _BLAST_RADIUS_PATH,
    _CALLER_TOKEN,
    _GROUPS_URL,
    _build_admin_app,
    _own,
    _verdict,
)

_GROUP = "acme-devs"


def _preview_url(group_name: str = _GROUP) -> str:
    return f"{_GROUPS_URL}/{group_name}/blast-radius"


class _Read:
    """One GET of the preview route with the coord read stubbed.

    ``verdict`` is what coord's blast-radius route returns; ``coord_error``
    makes the read raise instead; ``coord_status`` makes coord answer a
    non-2xx (its body is irrelevant to this route — every non-2xx is one
    refusal).
    """

    def __init__(
        self,
        verdict: dict[str, Any] | None = None,
        coord_error: Exception | None = None,
        coord_status: int = 200,
    ) -> None:
        self.verdict = verdict if verdict is not None else _verdict()
        self.coord_error = coord_error
        self.coord_status = coord_status
        self.get_calls: list[Any] = []

    def run(self, client: TestClient, url: str) -> httpx.Response:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = self.coord_status
        resp.json.return_value = self.verdict
        resp.text = '{"error":"admin_required"}'

        instance = MagicMock()
        if self.coord_error is not None:
            instance.get = AsyncMock(side_effect=self.coord_error)
        else:
            instance.get = AsyncMock(return_value=resp)
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "app.api.v1.endpoints.operations.httpx.AsyncClient",
            return_value=instance,
        ):
            out = client.get(url, headers={"Authorization": f"Bearer {_CALLER_TOKEN}"})
        self.get_calls = instance.get.call_args_list
        return out


@pytest.fixture()
def admin_client() -> TestClient:
    return TestClient(_build_admin_app())


def _detail(resp: httpx.Response) -> dict[str, Any]:
    detail = resp.json()["detail"]
    assert isinstance(detail, dict), f"expected a structured detail, got {detail!r}"
    return detail


# ---------------------------------------------------------------------------
# It asks the pool-wide question, the way the delete does
# ---------------------------------------------------------------------------


class TestThePreviewAsksCoordThePoolWideQuestion:
    def test_it_reads_the_blast_radius_route_with_the_group_as_a_query_param(
        self, admin_client: TestClient
    ) -> None:
        r = _Read(verdict=_verdict(group_id="acme#devs"))
        out = r.run(admin_client, _preview_url("acme%23devs"))
        assert out.status_code == 200, out.text
        url = r.get_calls[0].args[0]
        assert url.endswith(_BLAST_RADIUS_PATH), url
        # The tenant-scoped list is a PREFIX of the verdict route, so the
        # `endswith` above would also pass on a reader pointed back at the
        # list with a trailing segment; say the regression directly.
        assert not url.endswith("/admin/coord/group-tenant-roles"), url
        assert r.get_calls[0].kwargs["params"] == {"group_id": "acme#devs"}
        assert "acme#devs" not in url

    def test_the_caller_bearer_is_forwarded(self, admin_client: TestClient) -> None:
        # The group routes are `require_admin`-gated and resolve no coord
        # tenant, so the only thing that authenticates the coord read is the
        # captured caller bearer. Without `capture_caller_bearer` the header
        # dict carries no Authorization and coord answers 401 — which this
        # route would then report as a 502, not as a verdict.
        r = _Read()
        r.run(admin_client, _preview_url())
        headers = r.get_calls[0].kwargs["headers"]
        assert headers.get("Authorization") == f"Bearer {_CALLER_TOKEN}", headers

    def test_the_preview_and_the_delete_share_one_reader(
        self, admin_client: TestClient
    ) -> None:
        """The preview MUST go through ``_coord_group_blast_radius``.

        This is the property the route exists for: a preview with a reader of
        its own could accept a verdict the delete refuses (or vice versa), and
        the dialog would once again show something the guard contradicts. The
        httpx-level tests above cannot tell one reader from another; this one
        can.
        """
        from app.api.v1.endpoints.operations import _BlastRadius

        radius = _BlastRadius(
            mapped_total=1,
            mapped_own_tenant_slugs=("acme",),
            mapped_other_tenant_rows=0,
            mapped_unmaterialized_rows=0,
            strands_own_tenant=(),
            strands_other_tenant_count=0,
        )
        with patch(
            "app.api.v1.endpoints.operations._coord_group_blast_radius",
            new=AsyncMock(return_value=radius),
        ) as reader:
            out = admin_client.get(
                _preview_url(), headers={"Authorization": f"Bearer {_CALLER_TOKEN}"}
            )
        assert out.status_code == 200, out.text
        reader.assert_awaited_once_with(_GROUP)
        assert out.json()["mapped_own_tenant"] == ["acme"]


# ---------------------------------------------------------------------------
# What it returns
# ---------------------------------------------------------------------------


class TestTheVerdictIsReturnedHonestly:
    def test_partial_disclosure_carries_the_totals_beside_it(
        self, admin_client: TestClient
    ) -> None:
        r = _Read(
            verdict=_verdict(
                own=[_own("beta-corp"), _own("acme"), _own("acme", role="admin")],
                other=2,
                unmaterialized=1,
                strands_own=["acme"],
                strands_other=3,
            )
        )
        out = r.run(admin_client, _preview_url())
        assert out.status_code == 200, out.text
        body = out.json()
        assert body["group_name"] == _GROUP
        # Named: sorted and DEDUPLICATED (one group holds several rows in one
        # tenant — `(group_id, tenant_slug, role)` is coord's PK) …
        assert body["mapped_own_tenant"] == ["acme", "beta-corp"]
        # … while the count beside it stays the honest ROW total: 3 own rows
        # + 2 other + 1 unmaterialised, not the 2 names.
        assert body["mapped_total"] == 6
        assert body["mapped_other_tenant_rows"] == 2
        assert body["mapped_unmaterialized_rows"] == 1
        assert body["strands_own_tenant"] == ["acme"]
        assert body["strands_other_tenant_count"] == 3
        assert body["strands_total"] == 4

    def test_an_all_zero_verdict_is_returned_not_refused(
        self, admin_client: TestClient
    ) -> None:
        # The counterweight: "breaks nothing" is a legitimate answer and the
        # dialog needs to be able to say so — when coord SAID so.
        r = _Read(verdict=_verdict())
        out = r.run(admin_client, _preview_url())
        assert out.status_code == 200, out.text
        body = out.json()
        assert body["mapped_total"] == 0
        assert body["strands_total"] == 0
        assert body["mapped_own_tenant"] == []
        assert body["strands_own_tenant"] == []

    def test_the_body_never_carries_another_tenants_slug(
        self, admin_client: TestClient
    ) -> None:
        # Coord names no tenant the caller does not administer; this route
        # must not grow a field that would. Pin the key set so a future
        # "helpful" addition has to come through here.
        r = _Read(verdict=_verdict(other=4, strands_other=2))
        out = r.run(admin_client, _preview_url())
        assert set(out.json()) == {
            "group_name",
            "mapped_total",
            "mapped_own_tenant",
            "mapped_other_tenant_rows",
            "mapped_unmaterialized_rows",
            "strands_total",
            "strands_own_tenant",
            "strands_other_tenant_count",
        }


# ---------------------------------------------------------------------------
# Fail-closed, like the delete
# ---------------------------------------------------------------------------


class TestAnUnreadableBlastRadiusIsUnknownNotEmpty:
    def test_a_coord_non_2xx_is_502_carrying_coords_own_status(
        self, admin_client: TestClient
    ) -> None:
        # 404 is the one that matters: a coord deployment predating the
        # verdict route. A preview that rendered that as "breaks nothing"
        # would be the old defect with a newer route name.
        r = _Read(coord_status=404)
        out = r.run(admin_client, _preview_url())
        assert out.status_code == 502, out.text
        detail = _detail(out)
        assert detail["error"] == "mapping_check_unavailable"
        assert detail["coord_status"] == 404

    def test_a_transport_failure_is_502_with_no_status(
        self, admin_client: TestClient
    ) -> None:
        r = _Read(coord_error=httpx.ConnectError("refused"))
        out = r.run(admin_client, _preview_url())
        assert out.status_code == 502, out.text
        detail = _detail(out)
        assert detail["error"] == "mapping_check_unavailable"
        assert detail["coord_status"] is None

    def test_a_verdict_about_another_group_is_502_unreadable(
        self, admin_client: TestClient
    ) -> None:
        r = _Read(verdict=_verdict(group_id="someone-else"))
        out = r.run(admin_client, _preview_url())
        assert out.status_code == 502, out.text
        assert _detail(out)["error"] == "mapping_check_unreadable"

    def test_a_broken_sum_invariant_is_502_unreadable(
        self, admin_client: TestClient
    ) -> None:
        r = _Read(verdict=_verdict(own=[_own("acme")], mapped_total=0))
        out = r.run(admin_client, _preview_url())
        assert out.status_code == 502, out.text
        assert _detail(out)["error"] == "mapping_check_unreadable"


# ---------------------------------------------------------------------------
# Gates in front of the read
# ---------------------------------------------------------------------------


class TestTheGatesRunBeforeCoordIsAsked:
    def test_a_malformed_name_is_400_and_costs_no_coord_round_trip(
        self, admin_client: TestClient
    ) -> None:
        r = _Read()
        out = r.run(admin_client, _preview_url("acme%20devs"))
        assert out.status_code == 400, out.text
        assert r.get_calls == []

    def test_a_non_superuser_is_403_and_costs_no_coord_round_trip(self) -> None:
        from app.api.deps import (
            get_async_db,
            get_current_active_user_async,
            get_current_user_async,
        )
        from app.api.v1.endpoints.operations import router as operations_router

        app = FastAPI()
        user = MagicMock()
        user.id = uuid4()
        user.is_active = True
        user.is_verified = True
        user.is_superuser = False
        app.dependency_overrides[get_current_active_user_async] = lambda: user
        app.dependency_overrides[get_current_user_async] = lambda: user
        app.dependency_overrides[get_async_db] = lambda: None
        app.include_router(operations_router, prefix="/api/v1/operations")

        r = _Read()
        out = r.run(TestClient(app), _preview_url())
        assert out.status_code == 403, out.text
        assert r.get_calls == []
