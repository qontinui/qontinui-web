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


class TestAdminDescriptiveFieldsDegradeRatherThanCrashOrInvent:
    """The permissive half, on this route, under the same rule.

    The wrong-type sweep that reached ``default_enabled`` / ``policy_required``
    stopped at the AUTHORIZATION fields. The descriptive ones on the same row
    kept the two behaviours the strict half had just had removed — measured
    against this route:

    * ``model: 42`` / ``effort: 0`` raised ``ValidationError`` out of
      :class:`AdminAgentRegistryRow`: a **500** on the admin page.
    * ``purpose: {"a": 1}`` rendered the Python repr ``"{'a': 1}"``, and a
      non-string in ``allowed_dispositions`` became a pickable option coord
      never declared.

    ``fanout_bound`` was already guarded here — correctly, and alone. That
    carve-out is now the rule for every descriptive field rather than the one
    it happened to be spelled out for.
    """

    @pytest.mark.parametrize(
        "field,value,expected",
        [
            ("model", 42, None),
            ("model", ["opus"], None),
            ("effort", 0, None),
            ("effort", {"x": 1}, None),
            ("fanout_bound", True, None),
            ("fanout_bound", "15", None),
            ("purpose", {"a": 1}, ""),
            ("purpose", 42, ""),
            ("trigger_condition", 7, ""),
            ("spawn_path", ["subagent"], ""),
        ],
    )
    def test_a_wrong_typed_descriptive_field_degrades(self, field, value, expected):
        payload = {"agents": [_registry_row(**{field: value})], "prefs": []}
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/v1/agent-registry/admin/registry"
            )

        assert resp.status_code == 200, (
            f"`{field}` is descriptive; an off-contract value must degrade, "
            "not 500 the admin page"
        )
        assert resp.json()["agents"][0][field] == expected

    def test_a_non_string_disposition_is_dropped_not_reprd(self):
        """These are the options the page offers an admin to CHOOSE.

        ``[str(d) for d in ...]`` turned a non-string into a pickable
        disposition coord never declared — which coord's own
        ``invalid_disposition`` would then refuse on save, with the page
        having invited the choice.
        """
        payload = {
            "agents": [
                _registry_row(allowed_dispositions=["block", {"x": 1}, 7, "degrade"])
            ],
            "prefs": [],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/v1/agent-registry/admin/registry"
            )

        assert resp.status_code == 200
        assert resp.json()["agents"][0]["allowed_dispositions"] == [
            "block",
            "degrade",
        ]

    def test_the_authz_fields_on_the_same_row_are_still_loud(self):
        """Degrading the cosmetic half must not soften the strict half."""
        payload = {
            "agents": [_registry_row(model=42, default_enabled="false")],
            "prefs": [],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/v1/agent-registry/admin/registry"
            )

        assert resp.status_code == 502
        assert "default_enabled" in str(resp.json()["detail"])

    def test_correctly_typed_descriptive_fields_still_render(self):
        """The companion: degrading everything would otherwise pass."""
        payload = {
            "agents": [
                _registry_row(model="claude-opus-5", effort="high", fanout_bound=15)
            ],
            "prefs": [],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 200
        (row,) = resp.json()["agents"]
        assert row["model"] == "claude-opus-5"
        assert row["effort"] == "high"
        assert row["fanout_bound"] == 15
        assert row["purpose"] == "Reviews code changes."
        assert row["trigger_condition"] == "before opening a PR"


class TestAllowedDispositionsReportsWhatItRefused:
    """The one descriptive field whose drift was invisible.

    Every other descriptive field on this route reaches
    ``_degraded_descriptive_fields`` and gets named in a per-row warning. This
    one was filtered inline instead, so its render was correct and silent —
    measured against the route before this commit, a string, an object and
    ``null`` all rendered as ``[]`` and ``["block", 42]`` became ``["block"]``,
    four different off-contract shapes and not one log line between them.

    An emptied option list is indistinguishable on the page from an agent for
    which coord declares no dispositions, which is the "a column is empty for
    everyone and nobody notices" shape one severity down — the same reason the
    scalars are reported.
    """

    @pytest.mark.parametrize(
        "value,expected_type",
        [
            ("block,degrade", "str"),
            ({"first": "block"}, "dict"),
            (7, "int"),
            (True, "bool"),
        ],
    )
    def test_a_non_list_degrades_to_empty_and_says_so(self, value, expected_type):
        payload = {
            "agents": [_registry_row(allowed_dispositions=value)],
            "prefs": [],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/v1/agent-registry/admin/registry"
            )

        assert resp.status_code == 200, "a descriptive field must not 500 the page"
        assert resp.json()["agents"][0]["allowed_dispositions"] == []
        assert mock_warning.called, (
            "rendering no options at all is a claim about what coord declares; "
            "making it silently is how the drift survives"
        )
        logged = str(mock_warning.call_args)
        assert "allowed_dispositions" in logged
        assert expected_type in logged, "the log must name the type that arrived"

    def test_dropped_entries_are_counted_and_their_types_named(self):
        """The render was already right; only the silence was wrong."""
        payload = {
            "agents": [
                _registry_row(allowed_dispositions=["block", {"x": 1}, 7, "degrade"])
            ],
            "prefs": [],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.json()["agents"][0]["allowed_dispositions"] == ["block", "degrade"]
        logged = str(mock_warning.call_args)
        assert "allowed_dispositions" in logged
        assert "2 of 4" in logged, "say how many options the admin is not seeing"
        assert "dict" in logged and "int" in logged

    def test_the_note_joins_the_scalar_log_line_rather_than_opening_a_second(self):
        """One row, one warning.

        Two log lines about the same row is how a log comes to disagree with
        itself about that row — the defect ``_descriptive_is_usable`` was made
        a single shared predicate to prevent, in its reporting half.
        """
        payload = {
            "agents": [_registry_row(model=42, allowed_dispositions="block")],
            "prefs": [],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert mock_warning.call_count == 1
        degraded = mock_warning.call_args.kwargs["degraded"]
        assert any("model" in note for note in degraded)
        assert any("allowed_dispositions" in note for note in degraded)

    @pytest.mark.parametrize("value", [None, ["block", "degrade"]])
    def test_a_contract_abiding_value_logs_nothing(self, value):
        """The companion. Warning unconditionally would otherwise pass.

        ``null`` is not reported for the same reason the scalars are not: that
        is the permissiveness working as designed, not drift.
        """
        payload = {
            "agents": [_registry_row(allowed_dispositions=value)],
            "prefs": [],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.json()["agents"][0]["allowed_dispositions"] == (value or [])
        assert not mock_warning.called


class TestNoPrefRowIsSilentlyUncounted:
    """``pref_count`` is the page's claim, so it must not be quietly short.

    The registry rows on this route 502 when ``agent_name`` is unusable, and
    ``_admin_registry_rows`` 502s on a non-object PREF row. The pref loop in
    between checked shape and not identity — ``if isinstance(name, str) and
    name:`` — so a pref row coord could not name simply vanished from the
    counts.

    Vanishing is not cosmetic here. ``pref_count`` is what the page states as
    "changing the default does not reach N members", and it also drives the
    amber attention rail, the "Overridden" filter count and the health strip.
    Measured against the route before this commit, one readable pref row beside
    three unnameable ones reported ``pref_count=1`` — an admin reading that
    believes a change misses one member when it misses four.

    Nor can it be repaired by counting the row anyway: with no name there is no
    agent to count it against, so what is unverifiable is every count on the
    page, not one of them.
    """

    @pytest.mark.parametrize("agent_name", [None, "", 42, ["code-reviewer"], {}])
    def test_an_unattributable_pref_row_is_a_502(self, agent_name):
        payload = {
            "agents": [_registry_row()],
            "prefs": [_pref(agent_name=agent_name)],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/v1/agent-registry/admin/registry"
            )

        assert resp.status_code == 502
        detail = str(resp.json()["detail"])
        assert "agent_name" in detail
        assert "index 0" in detail, "name the row, as the registry-row 502 does"

    def test_the_index_reported_is_the_offending_row(self):
        payload = {
            "agents": [_registry_row()],
            "prefs": [_pref(), _pref(), _pref(agent_name=None)],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/api/v1/agent-registry/admin/registry"
            )

        assert "index 2" in str(resp.json()["detail"])

    def test_readable_pref_rows_still_count(self):
        """The companion: 502-ing on every pref row would otherwise pass."""
        payload = {
            "agents": [_registry_row(default_enabled=False)],
            "prefs": [_pref(enabled=True), _pref(enabled=False)],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 200
        (row,) = resp.json()["agents"]
        assert row["pref_count"] == 2
        assert row["pref_differs_from_default_count"] == 1

    def test_a_pref_row_for_an_unknown_agent_is_still_not_an_error(self):
        """A NAMEABLE row is attributable even if no registry row matches.

        Coord could serve a pref for an agent whose registry row this tenant
        does not have. That row is counted against nothing and reported
        nowhere, which is correct — the defect above is a row that cannot be
        named, not one that names an agent this page does not show.
        """
        payload = {
            "agents": [_registry_row(agent_name="code-reviewer")],
            "prefs": [_pref(agent_name="a-retired-agent")],
        }
        app = _build_app()
        with patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 200
        assert resp.json()["agents"][0]["pref_count"] == 0

    def test_an_unreadable_enabled_is_logged_and_still_not_a_disagreement(self):
        """The render was right and decided in silence.

        Not counting an unreadable ``enabled`` as contradicting the default is
        the honest reading and stays — a pref coord could not serve is unknown,
        never a fabricated disagreement. But "N of M contradict the default" is
        weaker evidence when some of the M could not be read, and nothing said
        so to whoever is asking why a number looks low.
        """
        payload = {
            "agents": [_registry_row(default_enabled=False)],
            "prefs": [
                _pref(enabled=True),
                _pref(enabled="true"),
                _pref(enabled=1),
                {"user_id": str(uuid4()), "agent_name": "code-reviewer"},
            ],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        (row,) = resp.json()["agents"]
        assert row["pref_count"] == 4
        assert row["pref_differs_from_default_count"] == 1
        assert mock_warning.called
        kwargs = mock_warning.call_args.kwargs
        assert kwargs["unreadable"] == 3
        assert kwargs["pref_count"] == 4

    def test_fully_readable_pref_rows_log_nothing(self):
        """The companion, so warning unconditionally does not pass."""
        payload = {
            "agents": [_registry_row(default_enabled=False)],
            "prefs": [_pref(enabled=True), _pref(enabled=False)],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert not mock_warning.called

    def test_a_pref_for_an_unregistered_agent_is_logged_not_dropped_in_silence(
        self,
    ):
        """The third way a pref row fails this page, and it had no treatment.

        A row with no usable ``agent_name`` is a 502 above; one whose
        ``enabled`` cannot be read warns and still renders. A row that names an
        agent the registry does not list was neither -- it simply never reached
        a count, exactly as the unattributable rows used to.

        It takes the middle treatment rather than the refusal, and the
        difference is real: the orphan's name IS known, it just matches no row,
        so every number on the page stays exactly correct and a 502 would be
        far too loud. What is wrong is the SILENCE -- a member holds a stored
        preference for an agent that appears nowhere on a page whose whole job
        is the tenant-wide consent picture.

        Representable because nothing enforces the join:
        ``coord.agent_user_prefs`` carries no foreign key to
        ``coord.agent_registry`` (its PK is ``(tenant_id, user_id,
        agent_name)``, ``agent_registry_01``) and coord's ``list_prefs``
        selects every pref row for the tenant unjoined. Coord validates the
        agent on the WRITE path (``unknown_agent``, 404), so the pref-write
        door does not create one.

        How REACHABLE it is beyond that is deliberately not claimed. A route
        census over both hosts enumerated ten ``agent-registry`` routes with no
        DELETE among them, but returned ``routes=UNKNOWN`` — a source it could
        not read completely — and an UNKNOWN census settles nothing. This
        assertion does not rest on it: the guard is defensive against a row set
        the route cannot reconcile, which is the standing every other guard in
        this module has, and none of those argues its shape is reachable today
        either.
        """
        payload = {
            "agents": [_registry_row(default_enabled=False)],
            "prefs": [
                _pref(enabled=True),
                _pref(agent_name="retired-agent", enabled=True),
                _pref(agent_name="retired-agent", enabled=False),
                _pref(agent_name="renamed-agent", enabled=True),
            ],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        # The render stands, and stands unchanged: the served agent's counts
        # are its own rows only, never the orphans'.
        (row,) = resp.json()["agents"]
        assert row["agent_name"] == "code-reviewer"
        assert row["pref_count"] == 1

        (call,) = [
            c
            for c in mock_warning.call_args_list
            if c.args
            and c.args[0] == "agent_registry_admin_prefs_for_unregistered_agents"
        ]
        assert call.kwargs["agent_names"] == ["renamed-agent", "retired-agent"], (
            "name every orphaned agent, sorted, so two reads of the same "
            "registry produce a diffable log line"
        )
        assert call.kwargs["agent_name_count"] == 2
        assert call.kwargs["agent_names_truncated"] is False
        assert call.kwargs["pref_rows"] == 3, "count the ROWS, not the names"
        assert call.kwargs["registry_rows"] == 1

    def test_the_orphan_name_list_is_capped_and_says_so(self):
        """A cap reported as a total reads as a complete list.

        ``agent_name`` is an arbitrary string arriving from coord in arbitrary
        quantity — the guards on this route refuse an unusable one but never
        bound how many usable ones there are — so the names are capped. The
        counts beside them are over the WHOLE set, and a truncation flag says
        the list is a slice, which is what keeps this from being the
        "presented the cap as the whole" shape.
        """
        from app.api.v1.endpoints.agent_registry import _ORPHAN_NAMES_LOGGED

        orphans = [f"retired-{i:03d}" for i in range(_ORPHAN_NAMES_LOGGED + 5)]
        payload = {
            "agents": [_registry_row(default_enabled=False)],
            "prefs": [_pref(enabled=True)]
            + [_pref(agent_name=n, enabled=True) for n in orphans],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 200, "a capped log is not a refusal"
        (call,) = [
            c
            for c in mock_warning.call_args_list
            if c.args
            and c.args[0] == "agent_registry_admin_prefs_for_unregistered_agents"
        ]
        assert len(call.kwargs["agent_names"]) == _ORPHAN_NAMES_LOGGED
        assert call.kwargs["agent_names"] == sorted(orphans)[:_ORPHAN_NAMES_LOGGED]
        assert call.kwargs["agent_names_truncated"] is True
        assert call.kwargs["agent_name_count"] == len(orphans), (
            "the count is over every orphan, not over the shown slice — "
            "otherwise the cap and the total are the same number and the "
            "truncation is invisible"
        )
        assert call.kwargs["pref_rows"] == len(orphans)

    def test_prefs_that_all_match_a_registry_row_log_no_orphans(self):
        """The companion, so warning unconditionally does not pass here either.

        Two agents, prefs against both: nothing is orphaned, so the orphan
        warning must be absent even though the route is otherwise identical.
        """
        payload = {
            "agents": [
                _registry_row(default_enabled=False),
                _registry_row(agent_name="debugging-specialist", default_enabled=True),
            ],
            "prefs": [
                _pref(enabled=True),
                _pref(agent_name="debugging-specialist", enabled=True),
            ],
        }
        app = _build_app()
        with (
            patch(f"{MODULE}._coord_request", new=AsyncMock(return_value=payload)),
            patch(f"{MODULE}.logger.warning") as mock_warning,
        ):
            resp = TestClient(app).get("/api/v1/agent-registry/admin/registry")

        assert resp.status_code == 200
        assert not [
            c
            for c in mock_warning.call_args_list
            if c.args
            and c.args[0] == "agent_registry_admin_prefs_for_unregistered_agents"
        ]


class TestTheAdminContractKeepsTheAuthzFieldsRequired:
    """The admin model's stated invariant, finally pinned.

    :class:`AdminAgentRegistryRow` carries a comment saying its two authz
    fields are "strict for the same reason ``_AUTHZ_FIELDS`` are on the read
    path... a default here would let a future construction path publish a wrong
    one silently". The effective route has
    :class:`TestTheResponseContractKeepsTheAuthzFieldsRequired` enforcing
    exactly that; this route had the comment and no test.

    That asymmetry is the same shape as the defect the route was just fixed
    for — the rule existed, nothing made this surface hold it.
    """

    def test_the_admin_authz_fields_are_required_with_no_default(self):
        from app.api.v1.endpoints.agent_registry import (
            _ADMIN_AUTHZ_FIELD_TYPES,
            AdminAgentRegistryRow,
        )

        for name in _ADMIN_AUTHZ_FIELD_TYPES:
            field = AdminAgentRegistryRow.model_fields[name]
            assert field.is_required(), (
                f"`{name}` asserts the tenant default; a default here lets a "
                "future construction path omit it silently and publishes it "
                "to clients as optional"
            )

    def test_the_admin_descriptive_fields_stay_permissive(self):
        """Pin both halves of the split, as the effective suite does."""
        from app.api.v1.endpoints.agent_registry import (
            _ADMIN_DESCRIPTIVE,
            AdminAgentRegistryRow,
        )

        for name in _ADMIN_DESCRIPTIVE:
            assert not AdminAgentRegistryRow.model_fields[name].is_required(), (
                f"`{name}` is cosmetic; a coord that drops it must not take "
                "the admin page down"
            )

    def test_the_openapi_schema_marks_them_required(self):
        from app.api.v1.endpoints.agent_registry import (
            _ADMIN_AUTHZ_FIELD_TYPES,
            AdminAgentRegistryRow,
        )

        required = set(AdminAgentRegistryRow.model_json_schema()["required"])
        assert set(_ADMIN_AUTHZ_FIELD_TYPES) <= required
        assert "agent_name" in required

    def test_a_routes_field_maps_are_pairwise_disjoint(self):
        """A field is read under exactly ONE rule, never two.

        The maps are the whole contract for a route; a name appearing in two of
        them means the row is read under both, and which one wins is an
        ordering accident rather than a decision.

        This assertion used to be spelled over TWO maps per route, because
        there were two. :data:`_ADMIN_STRING_LISTS` made the admin route's
        third, and adding it to the exhaustiveness assertion below without
        adding it here left the older invariant covering two thirds of the maps
        it exists to hold -- the same "the map is not wired to the rule" shape
        as the field it was introduced for.

        The gap is constructible, and it lands on exactly what
        :func:`_string_list` was written to prevent. Put
        ``allowed_dispositions`` in :data:`_ADMIN_DESCRIPTIVE` as well and both
        readers run against one field: for ``["block", 42]``,
        :func:`_degraded_descriptive_fields` reports ``expected str, got list``
        while :func:`_string_list` reports ``dropped 1 of 2 entries`` -- two
        contradictory notes about one field, on the ONE log line the whole
        function was shaped to keep them from disagreeing on.

        Two behavioural tests DO go red on that mutation, so it was not
        invisible -- but both fail as a bare ``assert not True`` about a mock
        being called, from tests named for pref rows and for a contract-abiding
        value. Neither names the cause, and the assertion whose job is to say
        "this field is read under two rules at once" was the one staying green.
        The exhaustiveness assertion cannot see it either: it UNIONS the maps,
        so a name in two of them is indistinguishable from a name in one.

        Written over ``combinations`` rather than as a hand-listed pair per
        route, so a fourth map is caught by being named in the tuple, not by
        someone remembering to add a third ``&``.
        """
        from itertools import combinations

        from app.api.v1.endpoints.agent_registry import (
            _ADMIN_AUTHZ_FIELD_TYPES,
            _ADMIN_DESCRIPTIVE,
            _ADMIN_STRING_LISTS,
            _AUTHZ_FIELD_TYPES,
            _EFFECTIVE_DESCRIPTIVE,
        )

        for route, maps in [
            (
                "effective",
                {
                    "_AUTHZ_FIELD_TYPES": set(_AUTHZ_FIELD_TYPES),
                    "_EFFECTIVE_DESCRIPTIVE": set(_EFFECTIVE_DESCRIPTIVE),
                },
            ),
            (
                "admin",
                {
                    "_ADMIN_AUTHZ_FIELD_TYPES": set(_ADMIN_AUTHZ_FIELD_TYPES),
                    "_ADMIN_DESCRIPTIVE": set(_ADMIN_DESCRIPTIVE),
                    "_ADMIN_STRING_LISTS": set(_ADMIN_STRING_LISTS),
                },
            ),
        ]:
            for (a_name, a), (b_name, b) in combinations(maps.items(), 2):
                assert not a & b, (
                    f"the {route} route reads {sorted(a & b)} under two rules "
                    f"at once ({a_name} and {b_name}); which one wins is an "
                    "ordering accident, and both report on the same field, so "
                    "one row's log line contradicts itself"
                )

    def test_every_response_field_is_classified_by_some_map(self):
        """Non-overlap was pinned; EXHAUSTIVENESS was not — and that is the gap.

        "One rule, two field maps" makes adding a name to a map the whole cost
        of getting a new field right. Nothing made adding the NAME compulsory,
        so a field could be declared on the response model and reach neither
        map — read by hand at the call site, under whatever rule that call site
        happened to spell out, which is precisely the per-route hand-rolling
        the maps exist to end.

        That was not hypothetical. ``allowed_dispositions`` was in neither map:
        it was filtered inline, and so was the one descriptive field on either
        route whose drift logged nothing at all. This assertion fails on the
        code as it stood, and is what keeps the third such field from repeating
        it.

        The two counts are named explicitly rather than waived by a rule,
        because they are the only fields on either model that coord does not
        send at all — they are aggregates :func:`_render_admin_rows` derives —
        and a rule broad enough to excuse them would excuse a real field too.

        They belong to the ADMIN model alone, so the waiver is carried PER
        MODEL. It used to be one set unioned into the admin model's classified
        names and then subtracted from the second assertion for BOTH — which
        quietly exempted those two names from the map-side check on the
        EFFECTIVE route, where they are not fields at all. Put ``pref_count``
        in :data:`_EFFECTIVE_DESCRIPTIVE` and nothing fired: assertion 1 saw it
        classified, assertion 2 subtracted it. The route would then have warned
        ``pref_count (expected ...)`` on every row of the settings page
        forever — a permanent degradation notice about a field coord never
        had, which is the log-disagrees-with-reality defect this whole family
        of assertions exists for.

        Subtracting the waiver from assertion 2 bought nothing even on the
        model that owns it: those names ARE declared there, so they never
        appear in ``classified - declared``. It only ever opened the hole.
        """
        from app.api.v1.endpoints.agent_registry import (
            _ADMIN_AUTHZ_FIELD_TYPES,
            _ADMIN_DESCRIPTIVE,
            _ADMIN_STRING_LISTS,
            _AUTHZ_FIELD_TYPES,
            _EFFECTIVE_DESCRIPTIVE,
            AdminAgentRegistryRow,
            AgentRegistryEntry,
        )

        #: Derived web-side from coord's `prefs` list; coord serves no such
        #: aggregate, so no read-contract map can carry them. Admin-only.
        admin_derived = {"pref_count", "pref_differs_from_default_count"}

        for label, model, classified in [
            (
                "AgentRegistryEntry",
                AgentRegistryEntry,
                set(_AUTHZ_FIELD_TYPES) | set(_EFFECTIVE_DESCRIPTIVE) | {"agent_name"},
            ),
            (
                "AdminAgentRegistryRow",
                AdminAgentRegistryRow,
                set(_ADMIN_AUTHZ_FIELD_TYPES)
                | set(_ADMIN_DESCRIPTIVE)
                | set(_ADMIN_STRING_LISTS)
                | {"agent_name"}
                | admin_derived,
            ),
        ]:
            declared = set(model.model_fields)
            assert not declared - classified, (
                f"{label} declares {sorted(declared - classified)}, which no "
                "field map classifies as authorization, descriptive or "
                "derived — so it is read by hand under whatever rule its call "
                "site spells out, which is the drift the maps exist to end"
            )
            assert not classified - declared, (
                f"a field map names {sorted(classified - declared)}, "
                f"which {label} does not declare — the map and the published "
                "contract have drifted apart"
            )


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
