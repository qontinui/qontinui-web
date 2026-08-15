"""Tests for the generic fleet-policy proxy (`/api/v1/operations/fleet-policy`).

Phase 5 of ``2026-08-10-plan-and-prompt-library-in-web``. The proxy is thin,
but three things about coord's wire contract are easy to get wrong in a way
that is silent rather than loud, and those are what this file pins:

1. **Coord's GET leaks another domain's data into the answer.** Asking for
   ``domain=plan_capture`` also returns ``controls`` / ``drain`` /
   ``current_version`` read from the unrelated ``fleet_resources`` row (coord's
   ``read_controls`` does this deliberately — the controls are a property of
   the fleet, not of the domain that happens to share the table). Rendering
   those as ``plan_capture``'s own values would misreport the fleet, so the
   proxy strips them and *names* what it stripped.

2. **Coord's PUT body is ``#[serde(deny_unknown_fields)]``.** One extra key is
   a 422 for the whole write. The body is therefore assembled from a closed
   model rather than forwarded from the browser, and ``updated_by`` — which
   coord stamps from its own operator context — must never appear on the wire.

3. **A write landing is not the same fact as a value resolving.** The PUT does
   a second, fresh GET; when that read-back fails the response says so instead
   of echoing the written level as though it were effective.

Mirrors ``test_operations_merge_proxy.py``: a minimal FastAPI app plus a mocked
``httpx.AsyncClient``, so no live coord is needed.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"

#: What coord returns for a domain that HAS a tenant-band row, including the
#: five blocks that actually belong to the `fleet_resources` controls row.
COORD_GET_WITH_FOREIGN_BLOCKS = {
    "domain": "plan_capture",
    "effective_level": "record",
    "master_enabled": True,
    "resolved_scope": "tenant",
    "controls_available": True,
    "controls": {"max_concurrent_agents": 4},
    "current_version": 12,
    "drain": {"machine-a": {"until": "2026-08-16T00:00:00Z"}},
    "drain_effective": {"machine-a": {"until": "2026-08-16T00:00:00Z"}},
}


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "operator@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    # NOT a superuser by default: the superuser bypass would mask whether
    # `can_edit` reads the effective-tenant roles at all.
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    resolved = uuid4()
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    return resp


@contextmanager
def _patch_identity(is_admin: bool = True, effective_roles=("admin",)):
    """Stub coord's `/admin/coord/me` plus the effective-tenant role lookup.

    `is_admin` and `effective_roles` are deliberately SEPARATE knobs. Coord's
    `is_admin` is a UNION across every tenant; the PUT gate
    (`require_coord_tenant_admin`) uses the operator's roles in the EFFECTIVE
    tenant. `can_edit` must follow the latter, so these tests set them in
    opposition to prove which one it reads.
    """
    identity = MagicMock()
    identity.is_admin = is_admin
    with (
        patch(
            "app.api.v1.endpoints.operations.get_coord_identity",
            AsyncMock(return_value=identity),
        ),
        patch(
            "app.api.v1.endpoints.operations._effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


def _patch_httpx(mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    patcher = patch("app.api.v1.endpoints.operations.httpx.AsyncClient")
    MockClient = patcher.start()
    MockClient.return_value = mock_instance
    return patcher


class TestGetFleetPolicy:
    def test_strips_the_unrelated_fleet_resources_blocks_and_names_them(
        self, client: TestClient
    ):
        """The trap: coord answers `plan_capture` with `fleet_resources` data."""
        instance = MagicMock()
        instance.get = AsyncMock(
            return_value=_mock_response(200, COORD_GET_WITH_FOREIGN_BLOCKS)
        )
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity():
                resp = client.get(f"{API_PREFIX}/fleet-policy?domain=plan_capture")
        finally:
            patcher.stop()

        assert resp.status_code == 200
        body = resp.json()
        assert body["domain"] == "plan_capture"
        assert body["effective_level"] == "record"
        assert body["resolved_scope"] == "tenant"
        assert body["can_edit"] is True
        # None of the foreign blocks may appear as this domain's own values.
        for key in ("controls", "drain", "drain_effective", "current_version"):
            assert key not in body
        # And they are NAMED, not silently dropped.
        assert sorted(body["keys_not_shown"]) == [
            "controls",
            "controls_available",
            "current_version",
            "drain",
            "drain_effective",
        ]
        assert body["keys_not_shown_source"] == "fleet_resources_row"

    def test_names_the_dropped_blocks_even_when_the_domain_owns_them(
        self, client: TestClient
    ):
        """`fleet_resources` owns them — but this view still cannot show them.

        Reporting `[]` here would claim nothing was withheld while withholding
        five blocks. What changes for this domain is the SOURCE, not the fact
        of the drop.
        """
        payload = dict(COORD_GET_WITH_FOREIGN_BLOCKS, domain="fleet_resources")
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, payload))
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity():
                resp = client.get(f"{API_PREFIX}/fleet-policy?domain=fleet_resources")
        finally:
            patcher.stop()

        body = resp.json()
        assert sorted(body["keys_not_shown"]) == [
            "controls",
            "controls_available",
            "current_version",
            "drain",
            "drain_effective",
        ]
        assert body["keys_not_shown_source"] == "this_domain"

    def test_no_row_resolves_off_with_scope_none(self, client: TestClient):
        """ "Off because nobody wrote a row" is distinguishable from "turned off"."""
        instance = MagicMock()
        instance.get = AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "domain": "plan_capture",
                    "effective_level": "off",
                    "master_enabled": False,
                    "resolved_scope": "none",
                    "controls_available": False,
                },
            )
        )
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity():
                resp = client.get(f"{API_PREFIX}/fleet-policy?domain=plan_capture")
        finally:
            patcher.stop()

        body = resp.json()
        assert body["effective_level"] == "off"
        assert body["resolved_scope"] == "none"

    def test_a_coord_answer_missing_the_level_fails_safe_to_off(
        self, client: TestClient
    ):
        """Silence about a capability toggle is `off`, never "assume enabled"."""
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, {"unexpected": 1}))
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity():
                resp = client.get(f"{API_PREFIX}/fleet-policy?domain=plan_capture")
        finally:
            patcher.stop()

        body = resp.json()
        assert body["effective_level"] == "off"
        assert body["master_enabled"] is False
        assert body["resolved_scope"] == "none"

    def test_can_edit_follows_the_effective_tenant_not_the_admin_union(
        self, client: TestClient
    ):
        """The exact case coord's own `is_admin` gets wrong.

        An Administrator of tenant A who is only a Developer of the ACTIVE
        tenant B has `is_admin: true` (it is a union) but would be 403'd by
        `require_coord_tenant_admin`. An enabled button plus a 403 is worse
        than a disabled one.
        """
        instance = MagicMock()
        instance.get = AsyncMock(
            return_value=_mock_response(200, COORD_GET_WITH_FOREIGN_BLOCKS)
        )
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity(is_admin=True, effective_roles=("developer",)):
                resp = client.get(f"{API_PREFIX}/fleet-policy?domain=plan_capture")
        finally:
            patcher.stop()

        assert resp.json()["can_edit"] is False

    def test_can_edit_is_true_for_an_admin_of_the_effective_tenant(
        self, client: TestClient
    ):
        instance = MagicMock()
        instance.get = AsyncMock(
            return_value=_mock_response(200, COORD_GET_WITH_FOREIGN_BLOCKS)
        )
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity(is_admin=False, effective_roles=("admin",)):
                resp = client.get(f"{API_PREFIX}/fleet-policy?domain=plan_capture")
        finally:
            patcher.stop()

        assert resp.json()["can_edit"] is True

    def test_a_superuser_can_edit_even_without_a_coord_admin_role(self):
        """The other direction: `require_coord_tenant_admin` lets superusers
        through, so a disabled button there would refuse a write that works."""
        superuser_client = TestClient(_build_test_app(is_superuser=True))
        instance = MagicMock()
        instance.get = AsyncMock(
            return_value=_mock_response(200, COORD_GET_WITH_FOREIGN_BLOCKS)
        )
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity(is_admin=False, effective_roles=()):
                resp = superuser_client.get(
                    f"{API_PREFIX}/fleet-policy?domain=plan_capture"
                )
        finally:
            patcher.stop()

        assert resp.json()["can_edit"] is True

    def test_coord_unreachable_returns_502(self, client: TestClient):
        instance = MagicMock()
        instance.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
        patcher = _patch_httpx(instance)
        try:
            with _patch_identity():
                resp = client.get(f"{API_PREFIX}/fleet-policy?domain=plan_capture")
        finally:
            patcher.stop()

        assert resp.status_code == 502


class TestPutFleetPolicy:
    def test_sends_exactly_the_keys_coord_accepts(self, client: TestClient):
        """`deny_unknown_fields` makes one stray key a 422 for the whole write."""
        instance = MagicMock()
        instance.put = AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "ok": True,
                    "domain": "plan_capture",
                    "effective_level": "record",
                    "master_enabled": True,
                    "resolved_scope": "tenant",
                    "versioned": True,
                    "version": 3,
                    "updated_by": "operator@example.com",
                },
            )
        )
        instance.get = AsyncMock(
            return_value=_mock_response(200, COORD_GET_WITH_FOREIGN_BLOCKS)
        )
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "tenant",
                    "level": "record",
                    "master_enabled": True,
                    "change_note": "operator enabled capture",
                },
            )
        finally:
            patcher.stop()

        assert resp.status_code == 200
        sent = instance.put.call_args.kwargs["json"]
        assert set(sent) == {
            "domain",
            "scope_band",
            "scope_key",
            "level",
            "master_enabled",
            "change_note",
        }
        # `controls` is coord-optional and belongs to a different row — a domain
        # toggle has no business authoring it.
        assert "controls" not in sent
        # An audit trail whose author is client-asserted is not an audit trail.
        assert "updated_by" not in sent
        assert sent["scope_key"] is None

    def test_reads_back_the_effective_value_after_writing(self, client: TestClient):
        """The operator asked what devices resolve, not what we hoped to write."""
        instance = MagicMock()
        instance.put = AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "ok": True,
                    "domain": "plan_capture",
                    "effective_level": "record",
                    "versioned": True,
                    "version": 4,
                },
            )
        )
        # Coord resolves `off` despite the write: a system-band row wins.
        instance.get = AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "domain": "plan_capture",
                    "effective_level": "off",
                    "master_enabled": False,
                    "resolved_scope": "system",
                },
            )
        )
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "tenant",
                    "level": "record",
                    "master_enabled": True,
                },
            )
        finally:
            patcher.stop()

        body = resp.json()
        assert instance.get.await_count == 1, "the read-back must be its own GET"
        assert body["written_level"] == "record"
        # The load-bearing assertion: the resolved value is NOT the written one.
        assert body["effective"]["effective_level"] == "off"
        assert body["effective"]["resolved_scope"] == "system"
        assert body["readback_error"] is None

    def test_a_failed_read_back_is_unknown_not_the_written_value(
        self, client: TestClient
    ):
        instance = MagicMock()
        instance.put = AsyncMock(
            return_value=_mock_response(
                200, {"ok": True, "domain": "plan_capture", "effective_level": "record"}
            )
        )
        instance.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "tenant",
                    "level": "record",
                    "master_enabled": True,
                },
            )
        finally:
            patcher.stop()

        assert resp.status_code == 200, "the WRITE succeeded — don't lose that"
        body = resp.json()
        assert body["ok"] is True
        # UNKNOWN, explicitly. Never a silent echo of `written_level`.
        assert body["effective"] is None
        assert "502" in body["readback_error"]

    def test_an_extra_key_is_rejected_locally_without_a_round_trip(
        self, client: TestClient
    ):
        instance = MagicMock()
        instance.put = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        instance.get = AsyncMock(return_value=_mock_response(200, {}))
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "tenant",
                    "level": "record",
                    "master_enabled": True,
                    "updated_by": "attacker@example.com",
                },
            )
        finally:
            patcher.stop()

        assert resp.status_code == 422
        instance.put.assert_not_awaited()

    def test_an_invalid_scope_band_is_rejected_before_the_round_trip(
        self, client: TestClient
    ):
        instance = MagicMock()
        instance.put = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "galaxy",
                    "level": "record",
                    "master_enabled": True,
                },
            )
        finally:
            patcher.stop()

        assert resp.status_code == 422
        instance.put.assert_not_awaited()

    def test_a_blank_scope_key_is_normalised_to_null(self, client: TestClient):
        """Coord's unique index is on COALESCE(scope_key, '') — same row."""
        instance = MagicMock()
        instance.put = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        instance.get = AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "domain": "plan_capture",
                    "effective_level": "off",
                    "master_enabled": False,
                    "resolved_scope": "none",
                },
            )
        )
        patcher = _patch_httpx(instance)
        try:
            client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "tenant",
                    "scope_key": "",
                    "level": "off",
                    "master_enabled": False,
                },
            )
        finally:
            patcher.stop()

        assert instance.put.call_args.kwargs["json"]["scope_key"] is None

    def test_coord_403_admin_required_passes_through(self, client: TestClient):
        instance = MagicMock()
        instance.put = AsyncMock(
            return_value=_mock_response(403, {"error": "admin_required"})
        )
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "tenant",
                    "level": "record",
                    "master_enabled": True,
                },
            )
        finally:
            patcher.stop()

        assert resp.status_code == 403
        assert "admin_required" in resp.json()["detail"]

    def test_a_repo_band_write_reads_back_with_the_repo_scope(self, client: TestClient):
        """The read-back must ask coord the SAME question the write answered.

        Coord's GET matches repo-band rows only when `?repo=` is supplied (its
        query struct is `{domain, repo}`; there is no `scope_key` param).
        Omitting it after a repo-band write resolves a DIFFERENT question and
        then reports that answer as this write's confirmed effect — a
        `readback_error` of `None` on a read-back that never happened.
        """
        instance = MagicMock()
        instance.put = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        instance.get = AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "domain": "install_interception",
                    "effective_level": "record",
                    "master_enabled": True,
                    "resolved_scope": "repo",
                },
            )
        )
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "install_interception",
                    "scope_band": "repo",
                    "scope_key": "qontinui-web",
                    "level": "record",
                    "master_enabled": True,
                },
            )
        finally:
            patcher.stop()

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {
            "domain": "install_interception",
            "repo": "qontinui-web",
        }

    def test_written_level_is_what_we_wrote_not_coords_resolved_echo(
        self, client: TestClient
    ):
        """The two halves must not both come from `effective_level`."""
        instance = MagicMock()
        instance.put = AsyncMock(
            return_value=_mock_response(
                200,
                # Coord echoes the RESOLVED value, which here is `off` because
                # something more specific wins.
                {"ok": True, "effective_level": "off", "resolved_scope": "repo"},
            )
        )
        instance.get = AsyncMock(
            return_value=_mock_response(
                200,
                {
                    "domain": "plan_capture",
                    "effective_level": "off",
                    "master_enabled": True,
                    "resolved_scope": "repo",
                },
            )
        )
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "plan_capture",
                    "scope_band": "tenant",
                    "level": "record",
                    "master_enabled": True,
                },
            )
        finally:
            patcher.stop()

        body = resp.json()
        assert body["written_level"] == "record"
        assert body["effective"]["effective_level"] == "off"

    def test_the_controls_domain_is_refused_before_any_round_trip(
        self, client: TestClient
    ):
        """`fleet_resources` carries control + drain values this body cannot
        express, and coord cannot distinguish an omitted `controls` from an
        explicit default — so the write would silently reset them."""
        instance = MagicMock()
        instance.put = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        patcher = _patch_httpx(instance)
        try:
            resp = client.put(
                f"{API_PREFIX}/fleet-policy",
                json={
                    "domain": "fleet_resources",
                    "scope_band": "tenant",
                    "level": "on",
                    "master_enabled": True,
                },
            )
        finally:
            patcher.stop()

        assert resp.status_code == 422
        instance.put.assert_not_awaited()
