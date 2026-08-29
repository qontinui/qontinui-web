"""The agent-registry pref SELF door and the tenant-default ADMIN surface.

Covers Phases 2 and 3 of plan
``2026-08-22-agent-registry-prefs-are-admin-only-and-the-tenant-default-has-no-ui``.

## Phase 2 — the page was true only for admins

``PUT /api/v1/agent-registry/prefs/{agent}`` proxied coord's door
``PUT /coord/agent-registry/prefs/:agent_name``, which NAMES the ``user_id`` it
writes and therefore sits on coord's ADMIN router — any tenant member could
otherwise rewrite any other member's prefs. The consequence was a
``/settings/agents`` page every member could open and no non-admin could use:
the toggle 403'd for exactly the population it exists for.

Coord grew a SELF door (``PUT /coord/agent-registry/prefs/me/:agent_name``)
that derives the acting user from the verified operator token. Its request
struct is ``deny_unknown_fields``, so a leftover ``user_id`` in the forwarded
body is a **422**, not a harmless extra — which is why
:meth:`TestPrefWriteTargetsTheSelfDoor.test_forwarded_body_carries_no_user_id`
is a correctness gate and not a tidiness assertion.

## Phase 3 — the tenant default had no UI

The seed writes ``default_enabled: false`` for ``code-reviewer``. Until this
plan the only ways to change it were re-running a seeder that explicitly
refuses to, or hand-rolling a ``PUT`` with an admin bearer. Two new proxies
back the ``/admin/coord/agent-registry`` page.

## What "can go red" means here

Each gate below was checked against the mutation it exists to catch:

1. :meth:`TestPrefWriteTargetsTheSelfDoor.test_targets_the_self_door` fails the
   moment the URL is pointed back at the admin door — the Phase-2 bug itself.
2. :meth:`TestPrefWriteTargetsTheSelfDoor.test_forwarded_body_carries_no_user_id`
   fails if ``user_id`` is reinstated, which coord answers 422 in production.
3. :class:`TestDeployOrderIsSelfDiagnosing` pins BOTH arms of the 404 fork: an
   empty-bodied 404 (coord behind) becomes a 502 naming the route, and a
   structured ``unknown_agent`` 404 passes through UNCHANGED. Translating every
   404 — the shape the extracted block had before it was shared with a door
   that has an application 404 — turns the second half red.
4. :class:`TestTheAdminSurfaceIsAdminGated` fails if either new route loses its
   ``require_coord_tenant_admin`` dependency, and asserts the denial happens in
   the WEB tier (no coord call is made at all).
5. :meth:`TestTheTenantDefaultWrite.test_body_is_minimal` fails if the write
   grows into a full-row echo — the shape that once reset a seeded row's
   ``purpose`` and its ``fanout_bound``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

USER_ID = uuid4()
TENANT_ID = uuid4()

MODULE = "app.api.v1.endpoints.agent_registry"


def _user() -> MagicMock:
    u = MagicMock()
    u.id = USER_ID
    u.email = "member@example.com"
    u.is_active = True
    u.is_verified = True
    u.is_superuser = False
    return u


def _build_app(*, admin: bool = True) -> FastAPI:
    """Mount the router with both gates overridden.

    ``admin=False`` makes the shared admin dependency raise the same 403 the
    real one raises for a non-admin member, so the assertion is about what the
    ROUTE does with a denial — the real gate's own logic is pinned by
    ``test_active_tenant_transport.py`` and is not re-tested here.
    """
    from app.api.coord_proxy import require_coord_tenant_admin
    from app.api.v1.endpoints.agent_registry import get_registry_user, router

    test_app = FastAPI()
    test_app.dependency_overrides[get_registry_user] = _user

    def _admin_gate():
        if not admin:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")
        return TENANT_ID

    test_app.dependency_overrides[require_coord_tenant_admin] = _admin_gate
    test_app.include_router(router, prefix="/api/v1/agent-registry")
    return test_app


def _registry_row(**overrides):
    """One raw ``AgentRegistryRow`` as coord's ``GET /coord/agent-registry``
    serializes it — ``default_enabled``, NOT the folded ``enabled``."""
    row = {
        "id": str(uuid4()),
        "agent_name": "code-reviewer",
        "purpose": "Reviews code changes.",
        "trigger_condition": "before opening a PR",
        "spawn_path": "in_session_subagent",
        "model": None,
        "effort": None,
        "default_enabled": False,
        "policy_required": True,
        "allowed_dispositions": ["block", "degrade", "warn_proceed"],
        "fanout_bound": 15,
        "definition_body": "# code-reviewer\n",
    }
    row.update(overrides)
    return row


def _pref(**overrides):
    """One ``AgentUserPref`` row as the raw door serializes it."""
    row = {
        "user_id": str(uuid4()),
        "agent_name": "code-reviewer",
        "enabled": True,
        "disposition": None,
    }
    row.update(overrides)
    return row


# ── Phase 2 ───────────────────────────────────────────────────────────────


class TestPrefWriteTargetsTheSelfDoor:
    def test_targets_the_self_door(self):
        """The ADMIN prefs door must never be called again.

        It is the door that 403s every non-admin member, which is the entire
        defect Phase 2 closes.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(return_value={"effective": {}}),
        ) as mock_req:
            resp = TestClient(app).put(
                "/api/v1/agent-registry/prefs/code-reviewer",
                json={"enabled": False, "disposition": "degrade"},
            )

        assert resp.status_code == 200
        method, path = mock_req.call_args.args
        assert method == "PUT"
        assert path == "/coord/agent-registry/prefs/me/code-reviewer"
        # The admin door, verbatim. Pointing back at it reintroduces the bug.
        assert path != "/coord/agent-registry/prefs/code-reviewer"

    def test_forwarded_body_carries_no_user_id(self):
        """`user_id` is a 422 on the self door, not a harmless extra.

        Coord's `UpsertSelfPrefRequest` is `deny_unknown_fields`. Dropping the
        field is therefore part of the repoint, not tidying.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(return_value={"effective": {}}),
        ) as mock_req:
            TestClient(app).put(
                "/api/v1/agent-registry/prefs/code-reviewer",
                json={"enabled": False, "disposition": "degrade"},
            )

        body = mock_req.call_args.kwargs["json_body"]
        assert "user_id" not in body
        assert body == {"enabled": False, "disposition": "degrade"}

    def test_a_client_supplied_user_id_is_still_refused(self):
        """The client cannot smuggle a target user back in.

        The request model has never accepted `user_id`; pin it, because the
        server-derived-identity property now lives one hop further away (in
        coord) and is easier to lose sight of here.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(return_value={"effective": {}}),
        ) as mock_req:
            TestClient(app).put(
                "/api/v1/agent-registry/prefs/code-reviewer",
                json={"enabled": True, "user_id": str(uuid4())},
            )

        assert "user_id" not in mock_req.call_args.kwargs["json_body"]

    def test_disposition_is_omitted_when_not_chosen(self):
        """An absent disposition must not become an explicit `null`.

        Coord distinguishes "no disposition chosen" (422
        `disposition_required` on a policy-required disable) from a stored
        one; sending `null` where the key belongs absent is a different
        request.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(return_value={"effective": {}}),
        ) as mock_req:
            TestClient(app).put(
                "/api/v1/agent-registry/prefs/code-reviewer",
                json={"enabled": True},
            )

        assert mock_req.call_args.kwargs["json_body"] == {"enabled": True}

    @pytest.mark.parametrize(
        "code",
        ["not_authorized", "operator_not_provisioned_in_web"],
    )
    def test_coord_403s_reach_the_client_structured(self, code: str):
        """Both 403 codes pass through as structured JSON.

        The frontend renders them as two DIFFERENT explanatory states — a
        permissions problem and an account-linking problem — so flattening
        either into a string here would take that distinction away.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(
                side_effect=HTTPException(
                    status_code=403,
                    detail={"error": code, "message": "denied"},
                )
            ),
        ):
            resp = TestClient(app).put(
                "/api/v1/agent-registry/prefs/code-reviewer",
                json={"enabled": True},
            )

        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == code


class TestDeployOrderIsSelfDiagnosing:
    """The 404 fork: coord behind vs. an application 404.

    Both arms matter. The extracted block is now shared with a door that has
    a genuine application 404 (`unknown_agent`), so translating every 404
    would confidently misdiagnose a routine typo as a deploy-order problem.
    """

    def test_empty_404_on_the_self_door_becomes_a_502(self):
        """Coord has not deployed `/prefs/me` yet.

        Coord registers no axum fallback, so a route-absent 404 has an EMPTY
        body. Passed through it reads as "this WEB route is missing".
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(side_effect=HTTPException(status_code=404, detail="")),
        ):
            resp = TestClient(app).put(
                "/api/v1/agent-registry/prefs/code-reviewer",
                json={"enabled": True},
            )

        assert resp.status_code == 502
        detail = resp.json()["detail"]
        assert "/coord/agent-registry/prefs/me/" in detail
        assert "deploy qontinui-coord first" in detail

    def test_structured_404_passes_through_unchanged(self):
        """`unknown_agent` is a typo, not a deploy-order problem."""
        app = _build_app()
        body = {"error": "unknown_agent", "message": "no registry row for `nope`"}
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(side_effect=HTTPException(status_code=404, detail=body)),
        ):
            resp = TestClient(app).put(
                "/api/v1/agent-registry/prefs/nope",
                json={"enabled": True},
            )

        assert resp.status_code == 404
        assert resp.json()["detail"] == body

    def test_the_effective_read_keeps_its_own_502(self):
        """The extraction must not have changed `GET ""`'s behaviour.

        Its 404→502 block is what `_coord_request_deploy_order_aware` was
        extracted FROM; the addendum is part of the message it always
        carried.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(side_effect=HTTPException(status_code=404, detail="")),
        ):
            resp = TestClient(app).get("/api/v1/agent-registry")

        assert resp.status_code == 502
        detail = resp.json()["detail"]
        assert "GET /coord/agent-registry/effective-for" in detail
        assert "re-deriving the effective view web-side" in detail


# ── Phase 3 ───────────────────────────────────────────────────────────────


class TestTheAdminSurfaceIsAdminGated:
    """Both new proxies gate in the WEB tier.

    Coord's own gate would 403 a non-admin anyway; failing here is what makes
    the denial RENDERABLE (`not_coord_tenant_admin`, the code every other
    admin console surface already knows) instead of an opaque passed-through
    coord body.
    """

    @pytest.mark.parametrize(
        ("method", "path", "json_body"),
        [
            ("GET", "/api/v1/agent-registry/admin/registry", None),
            (
                "PUT",
                "/api/v1/agent-registry/admin/registry/code-reviewer",
                {"default_enabled": True},
            ),
        ],
    )
    def test_non_admin_is_refused_without_calling_coord(
        self, method: str, path: str, json_body
    ):
        app = _build_app(admin=False)
        with patch(f"{MODULE}._coord_request", new=AsyncMock()) as mock_req:
            resp = TestClient(app).request(method, path, json=json_body)

        assert resp.status_code == 403
        assert resp.json()["detail"] == "not_coord_tenant_admin"
        # The point of gating web-side: coord is never reached at all.
        mock_req.assert_not_called()

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            # Router-relative — the `/api/v1/agent-registry` prefix is applied
            # at include_router time and is not on the APIRoute's own `path`.
            ("GET", "/admin/registry"),
            ("PUT", "/admin/registry/{agent_name}"),
        ],
    )
    def test_the_route_really_depends_on_the_shared_admin_gate(
        self, method: str, path: str
    ):
        """Structural, so the override above cannot be testing a strawman.

        A dependency_overrides test passes just as happily against a route
        with no gate at all — nothing would look up the override. This
        asserts the real dependency is wired.
        """
        from app.api.coord_proxy import require_coord_tenant_admin
        from app.api.v1.endpoints.agent_registry import router

        matches = [
            r
            for r in router.routes
            if getattr(r, "path", None) == path and method in getattr(r, "methods", ())
        ]
        assert matches, f"no {method} {path} route on the agent-registry router"
        calls = [d.call for d in matches[0].dependant.dependencies]
        assert require_coord_tenant_admin in calls


class TestTheRawRowsAreRenderedWithOverrideCounts:
    def test_calls_the_raw_door_and_counts_prefs(self):
        """The RAW door, not the effective fold.

        `default_enabled` is the tenant decision this page edits;
        `effective-for` would answer with one user's folded view instead.
        """
        app = _build_app()
        payload = {
            "agents": [
                _registry_row(agent_name="code-reviewer", default_enabled=False),
                _registry_row(agent_name="merge_shepherd", default_enabled=True),
            ],
            "prefs": [
                # Two members override code-reviewer's `false` with `true`,
                # one member recorded the default itself.
                _pref(agent_name="code-reviewer", enabled=True),
                _pref(agent_name="code-reviewer", enabled=True),
                _pref(agent_name="code-reviewer", enabled=False),
            ],
        }
        with patch(
            f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)
        ) as mock_req:
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 200
        method, path = mock_req.call_args.args
        assert (method, path) == ("GET", "/coord/agent-registry")

        rows = {r["agent_name"]: r for r in resp.json()["agents"]}
        assert rows["code-reviewer"]["default_enabled"] is False
        assert rows["code-reviewer"]["policy_required"] is True
        # Every recorded pref counts: a member who explicitly recorded the
        # CURRENT default is still immune to a change of it, which is the
        # question the admin is asking.
        assert rows["code-reviewer"]["pref_count"] == 3
        assert rows["code-reviewer"]["pref_differs_from_default_count"] == 2
        # An agent nobody has touched reports zero, not a missing key.
        assert rows["merge_shepherd"]["pref_count"] == 0
        assert rows["merge_shepherd"]["pref_differs_from_default_count"] == 0

    def test_no_other_members_user_id_reaches_the_browser(self):
        """The page needs "how many", never "who".

        Coord's raw door returns every pref row in the tenant. Folding to a
        count web-side is a strictly narrower disclosure than forwarding it.
        """
        other = str(uuid4())
        payload = {
            "agents": [_registry_row()],
            "prefs": [_pref(user_id=other, enabled=True)],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert other not in resp.text

    def test_definition_body_is_not_forwarded(self):
        """A per-agent markdown blob the page never renders."""
        payload = {
            "agents": [_registry_row(definition_body="SECRET-MARKER")],
            "prefs": [],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert "SECRET-MARKER" not in resp.text

    def test_a_pref_row_with_no_enabled_is_not_counted_as_disagreeing(self):
        """Unknown lands in the SMALLER count, never as a fabricated one."""
        payload = {
            "agents": [_registry_row(default_enabled=False)],
            "prefs": [{"user_id": str(uuid4()), "agent_name": "code-reviewer"}],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        row = resp.json()["agents"][0]
        assert row["pref_count"] == 1
        assert row["pref_differs_from_default_count"] == 0

    @pytest.mark.parametrize(
        "payload",
        [
            {"agents": None, "prefs": []},
            {"agents": [], "prefs": None},
            {"prefs": []},
            {"agents": [_registry_row()]},
            [],
            {"agents": ["not-an-object"], "prefs": []},
            {"agents": [_registry_row(agent_name="")], "prefs": []},
            {"agents": [_registry_row(default_enabled=None)], "prefs": []},
            {"agents": [_registry_row(policy_required=None)], "prefs": []},
        ],
    )
    def test_an_off_contract_payload_is_a_502(self, payload):
        """Same strictness as the effective read, for the same reason.

        Laundering any of these into an empty list would put "no agents
        registered" — or "nobody has overridden this" — on a page whose whole
        job is a tenant-wide consent decision. Both are claims, not shrugs.
        """
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 502

    @pytest.mark.parametrize(
        "field,value",
        [
            ("default_enabled", "false"),
            ("default_enabled", "no"),
            ("default_enabled", 0),
            ("default_enabled", 1),
            ("policy_required", "false"),
            ("policy_required", 0),
        ],
    )
    def test_a_wrong_typed_authz_field_is_a_502(self, field: str, value):
        """The TYPE half of the rule, which this route shipped without.

        ``test_an_off_contract_payload_is_a_502`` already pins ``None`` for
        both fields — and the route's guard was written to exactly that
        shape: ``row.get(k) is None``, then ``bool(...)``. ``bool`` cannot
        fail, so every case here returned **200**: ``default_enabled:
        "false"`` rendered as ``true``, badging an agent the tenant had
        defaulted OFF as on, on the page whose whole job is that decision.

        This is the same defect the effective route was fixed for twice
        (#1042, then the wrong-type follow-up), reappearing on a route added
        afterwards — which is why both paths now read through one function.
        """
        payload = {"agents": [_registry_row(**{field: value})], "prefs": []}
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 502, (
            f"{field}={value!r} must fail loudly — coercing it states a "
            "tenant default that is not the system's"
        )
        detail = str(resp.json()["detail"])
        assert field in detail
        assert type(value).__name__ in detail

    def test_a_correctly_typed_row_still_renders(self):
        """Companion: strictness must not cost the legitimate row.

        ``default_enabled=False`` is the value a naive falsiness check breaks,
        and it is the seeded default for ``code-reviewer``, so without this the
        class above would pass against a route that refused everything.
        """
        payload = {"agents": [_registry_row()], "prefs": []}
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 200
        (row,) = resp.json()["agents"]
        assert row["default_enabled"] is False
        assert row["policy_required"] is True

    def test_empty_404_from_the_raw_door_becomes_a_502(self):
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(side_effect=HTTPException(status_code=404, detail="")),
        ):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 502
        assert "GET /coord/agent-registry" in resp.json()["detail"]


class TestTheTenantDefaultWrite:
    def test_body_is_minimal(self):
        """Never a full row.

        Coord's upsert is `COALESCE`-preserving and its request struct is
        `deny_unknown_fields`. An earlier shape REPLACED every unnamed column,
        which is how following the documented re-enable lever once reset a
        seeded row's `purpose` and dropped its `fanout_bound` from 1 to 15.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(return_value={"agent": _registry_row()}),
        ) as mock_req:
            resp = TestClient(app).put(
                "/api/v1/agent-registry/admin/registry/code-reviewer",
                json={"default_enabled": True, "policy_required": True},
            )

        assert resp.status_code == 200
        method, path = mock_req.call_args.args
        assert (method, path) == ("PUT", "/coord/agent-registry/code-reviewer")
        assert mock_req.call_args.kwargs["json_body"] == {
            "default_enabled": True,
            "policy_required": True,
        }

    def test_policy_required_is_omitted_when_unset(self):
        """Omitted means PRESERVED, which is not the same as sending `false`."""
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(return_value={"agent": _registry_row()}),
        ) as mock_req:
            TestClient(app).put(
                "/api/v1/agent-registry/admin/registry/code-reviewer",
                json={"default_enabled": True},
            )

        assert mock_req.call_args.kwargs["json_body"] == {"default_enabled": True}

    def test_default_enabled_is_required(self):
        """Coord makes it the one required field — defaulting it would let a
        typo silently flip a tenant's autonomy. The web model must not soften
        that: editing `policy_required` alone still means sending the current
        `default_enabled` back."""
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock()) as mock_req:
            resp = TestClient(app).put(
                "/api/v1/agent-registry/admin/registry/code-reviewer",
                json={"policy_required": False},
            )

        assert resp.status_code == 422
        mock_req.assert_not_called()

    def test_the_agent_name_is_url_quoted(self):
        """The path segment is re-quoted, never interpolated raw.

        Coord's `validate_agent_name` would refuse this name, but the refusal
        has to be coord's 422 — a raw interpolation reshapes the URL before
        coord ever sees it.
        """
        app = _build_app()
        with patch(
            f"{MODULE}._coord_request",
            new=AsyncMock(return_value={"agent": _registry_row()}),
        ) as mock_req:
            TestClient(app).put(
                "/api/v1/agent-registry/admin/registry/odd%20name",
                json={"default_enabled": True},
            )

        _, path = mock_req.call_args.args
        assert path == "/coord/agent-registry/odd%20name"
