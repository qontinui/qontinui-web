"""``GET /api/v1/agent-registry`` renders COORD's effective fold verbatim.

Regression tests for the settings-page authorization bug fixed by plan
``2026-08-03-agent-spawn-authorization-ground-truth`` §P-1b.

## The bug these pin

The endpoint used to call coord's RAW rows route ``GET /coord/agent-registry``
— which serializes ``AgentRegistryRow`` (``default_enabled``,
``allowed_dispositions``) — and then re-derive the effective view web-side::

    enabled     = bool(row.get("enabled", True))
    disposition = str(row.get("disposition") or "block")

Neither key exists on that route. Both reads therefore ALWAYS took their
fallback, so every agent the operator had disabled rendered as **enabled** and
every disposition rendered ``block``, regardless of configuration.

The fix deletes the web-side fold instead of repairing it: coord grew
``GET /coord/agent-registry/effective-for?user_id=…`` (an operator-``TenantId``
door onto the same ``resolve_effective`` the device door already served), and
web now renders what it returns.

## What "can go red" means here

Two independent gates, both verified capable of failing rather than assumed to
be:

1. :meth:`TestEffectiveViewIsCoordsFold.test_calls_the_effective_for_door_with_the_authenticated_user`
   fails the moment the endpoint is pointed back at ``/coord/agent-registry``.
2. :meth:`TestOffContractRowsAreLoud.test_missing_authz_field_is_a_502` feeds a
   row with **no** ``enabled`` key — exactly the raw-rows shape that produced
   the outage — and requires a 502. Restoring the old
   ``row.get("enabled", True)`` / ``row.get("disposition") or "block"``
   fallbacks was run against this suite and turned its parametrisations red,
   confirming the gate is not vacuous.
3. :class:`TestFoldedForIsVerified` covers the failure coord's
   ``deny_unknown_fields`` cannot: a ``user_id`` that is DROPPED rather than
   misspelled still yields a confident 200 at every registry default.
4. :class:`TestNoAgentIsSilentlyDropped` closes the three paths the rewrite
   left lenient — ``agents: null`` laundered into ``[]``, a non-object row
   skipped, and a row with no usable ``agent_name`` skipped. Reinstating the
   ``or []`` and the two ``continue`` statements turns all thirteen of its
   assertions red (the response becomes a 200 carrying a SHORT list, with
   nothing on the page saying an agent went missing).
5. :class:`TestTheResponseContractKeepsTheAuthzFieldsRequired` pins the
   published schema to what the read path enforces. Restoring the model
   defaults — ``enabled=True`` / ``disposition="block"``, i.e. the two wrong
   values the original bug produced — turns it red.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

USER_ID = uuid4()


def _user() -> MagicMock:
    u = MagicMock()
    u.id = USER_ID
    u.email = "operator@example.com"
    u.is_active = True
    u.is_verified = True
    u.is_superuser = False
    return u


def _build_app() -> FastAPI:
    from app.api.v1.endpoints.agent_registry import get_registry_user, router

    test_app = FastAPI()
    test_app.dependency_overrides[get_registry_user] = _user
    test_app.include_router(router, prefix="/api/v1/agent-registry")
    return test_app


def _effective_row(**overrides):
    """One coord ``EffectiveAgent`` row (what ``/effective-for`` serves)."""
    row = {
        "agent_name": "code-reviewer",
        "purpose": "Reviews code changes.",
        "spawn_path": "in_session_subagent",
        "model": None,
        "effort": None,
        "policy_required": True,
        "fanout_bound": 15,
        "enabled": True,
        "disposition": "degrade",
        "source": "default",
    }
    row.update(overrides)
    return row


class TestEffectiveViewIsCoordsFold:
    def test_calls_the_effective_for_door_with_the_authenticated_user(self):
        """The RAW rows route must never be called again.

        ``/coord/agent-registry`` carries neither ``enabled`` nor
        ``disposition``; calling it is the bug. ``user_id`` must come from the
        authenticated caller, never from the client.
        """
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"agents": [], "folded_for": str(USER_ID)}),
        ) as mock_req:
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 200
        (method, path) = mock_req.call_args.args
        assert method == "GET"
        assert path.startswith("/coord/agent-registry/effective-for")
        assert f"user_id={USER_ID}" in path
        # The raw door re-derived the fold web-side. It must be gone.
        assert path != "/coord/agent-registry"

    def test_a_disabled_agent_is_not_rendered_enabled(self):
        """A disabled agent must render disabled — the user-visible symptom.

        This fixture is already coord's FOLDED shape, so it pins the happy
        path rather than the bug. The test that actually goes red on a
        reinstated fallback is
        :meth:`TestOffContractRowsAreLoud.test_missing_authz_field_is_a_502`,
        whose fixture omits ``enabled`` exactly as the raw rows route does —
        verified red against a restored ``row.get("enabled", True)``.
        """
        app = _build_app()
        payload = {
            "agents": [
                _effective_row(
                    agent_name="merge_shepherd",
                    enabled=False,
                    disposition="block",
                    source="user_pref",
                )
            ],
            "folded_for": str(USER_ID),
        }
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value=payload),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 200
        (agent,) = resp.json()["agents"]
        assert agent["agent_name"] == "merge_shepherd"
        assert agent["enabled"] is False, "a disabled agent rendered as ENABLED"
        assert agent["disposition"] == "block"
        assert agent["source"] == "user_pref"

    def test_disposition_is_not_forced_to_block(self):
        """The old fallback hardcoded ``block``; coord's default is ``degrade``.

        Served policy ``production-and-cost`` ``agent-spawn-authorization``: a
        disable with no recorded disposition falls back to **degrade** — "the
        only option that both honours the cost decision and keeps the gate".
        Rendering it as ``block`` misreports the gate as hard-stopping work.
        """
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(
                return_value={
                    "agents": [_effective_row(disposition="warn_proceed")],
                    "folded_for": str(USER_ID),
                }
            ),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        (agent,) = resp.json()["agents"]
        assert agent["disposition"] == "warn_proceed"

    def test_every_coord_field_passes_through_unchanged(self):
        app = _build_app()
        row = _effective_row(
            model="opus", effort="high", fanout_bound=3, spawn_path="parallel_fanout"
        )
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"agents": [row], "folded_for": str(USER_ID)}),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        (agent,) = resp.json()["agents"]
        for key, value in row.items():
            assert agent[key] == value, f"{key} was not passed through verbatim"


class TestOffContractRowsAreLoud:
    """A missing authorization field must be a 502, never a plausible page.

    This is the anti-vacuity guard. The original bug was survivable for months
    precisely because the missing data produced a confident, well-formed,
    completely wrong page. Silence on an authorization surface is the defect.
    """

    AUTHZ_FIELDS = ["enabled", "disposition", "source", "policy_required"]

    @pytest.mark.parametrize("missing", AUTHZ_FIELDS)
    def test_missing_authz_field_is_a_502(self, missing: str):
        row = _effective_row()
        del row[missing]
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"agents": [row], "folded_for": str(USER_ID)}),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502, (
            f"a row missing {missing!r} must fail loudly — falling back to a "
            "default is the bug this endpoint was rewritten to remove"
        )
        assert missing in str(resp.json()["detail"])

    @pytest.mark.parametrize("nulled", AUTHZ_FIELDS)
    def test_null_authz_field_is_a_502(self, nulled: str):
        """Null must count as missing, not as a value.

        ``bool(None)`` is ``False`` and ``str(None)`` is ``"None"`` — a
        ``source`` of ``"None"`` renders through the settings page's *default*
        branch, misattributing coord's unknown state as "registry default".
        Coord's fields are non-optional today; when that changes it will be
        null-shaped, not absent.
        """
        row = _effective_row(**{nulled: None})
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"agents": [row], "folded_for": str(USER_ID)}),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502
        assert nulled in str(resp.json()["detail"])

    def test_a_descriptive_field_may_still_be_absent(self):
        """Only the AUTHORIZATION fields are strict.

        Descriptive metadata stays permissive so a coord that adds or drops a
        cosmetic field does not take the settings page down.
        """
        row = _effective_row()
        del row["model"]
        del row["purpose"]
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"agents": [row], "folded_for": str(USER_ID)}),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 200
        (agent,) = resp.json()["agents"]
        assert agent["model"] is None
        assert agent["purpose"] == ""


class TestFoldedForIsVerified:
    """Coord echoes which user it folded for; web must ASSERT it.

    Coord's ``deny_unknown_fields`` catches a misspelled ``user_id``, but not a
    DROPPED one — ``user_id`` is optional, so coord happily returns 200 with
    every row at ``source: "default"``. Rendering that tells a user who has
    recorded preferences that every agent is at its registry default:
    confident, well-formed, wrong — the same shape as the original bug.
    """

    @pytest.mark.parametrize(
        "folded_for",
        [None, str(uuid4())],
        ids=["query_was_dropped", "another_user"],
    )
    def test_a_fold_for_the_wrong_user_is_a_502(self, folded_for):
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(
                return_value={
                    "agents": [_effective_row()],
                    "folded_for": folded_for,
                }
            ),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502, (
            "a body folded for anyone but the authenticated caller must not "
            "render — a defaults-only page is indistinguishable from a real one"
        )

    def test_a_bare_array_is_refused(self):
        """No ``folded_for`` means the view cannot be verified, so it is not shown."""
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value=[_effective_row()]),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502


class TestNoAgentIsSilentlyDropped:
    """An empty agent list is a CLAIM, so nothing may fall out of it quietly.

    The settings page renders ``entries.length === 0`` as "No agents are
    registered for your tenant yet." Every path that could produce an empty —
    or short — list without coord actually saying so is therefore the same
    confident-and-wrong shape as the bug this module was rewritten to remove,
    and must be a 502 instead.

    Three such paths survived the rewrite: ``agents`` read as
    ``payload.get("agents") or []`` (so ``null`` laundered into "none"), a
    non-object row skipped with a warning, and a row without a usable
    ``agent_name`` skipped with a warning. Identity is not a cosmetic field:
    dropping a whole row is a LARGER misstatement than misreporting one of
    the four :data:`_AUTHZ_FIELDS`, which already 502.
    """

    @pytest.mark.parametrize(
        "agents",
        [None, {}, {"code-reviewer": {}}, "code-reviewer", 0],
        ids=["null", "empty_object", "object", "string", "zero"],
    )
    def test_a_non_list_agents_key_is_a_502(self, agents):
        """``agents: null`` is coord not answering, not a tenant with no agents."""
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"agents": agents, "folded_for": str(USER_ID)}),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502, (
            "a non-list `agents` must not render as an empty registry — the "
            "page states that as 'No agents are registered for your tenant yet.'"
        )

    def test_an_empty_list_still_renders(self):
        """The guard must not swallow the legitimate empty answer."""
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"agents": [], "folded_for": str(USER_ID)}),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 200
        assert resp.json()["agents"] == []

    @pytest.mark.parametrize(
        "row",
        ["code-reviewer", 7, None, ["code-reviewer"]],
        ids=["string", "int", "null", "list"],
    )
    def test_a_non_object_row_is_a_502(self, row):
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(
                return_value={
                    "agents": [_effective_row(), row],
                    "folded_for": str(USER_ID),
                }
            ),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502, (
            "a row that cannot be read must not be dropped from an "
            "authorization surface without saying so"
        )

    @pytest.mark.parametrize(
        "agent_name",
        [None, "", 7, {"name": "code-reviewer"}],
        ids=["null", "empty_string", "int", "object"],
    )
    def test_a_row_without_a_usable_agent_name_is_a_502(self, agent_name):
        """Identity is strict for a stronger reason than the four authz fields.

        Verified capable of going red: restoring the ``continue`` that this
        replaced turns every parametrisation here green-with-a-short-list —
        the response is a 200 carrying only ``merge_shepherd``, with
        ``code-reviewer`` gone and nothing on the page saying so.
        """
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(
                return_value={
                    "agents": [
                        _effective_row(agent_name=agent_name),
                        _effective_row(agent_name="merge_shepherd"),
                    ],
                    "folded_for": str(USER_ID),
                }
            ),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502
        assert "agent_name" in resp.json()["detail"]


class TestTheResponseContractKeepsTheAuthzFieldsRequired:
    """The published schema must say what the read path enforces.

    :func:`_render_effective` refuses to READ a row missing one of the four
    :data:`_AUTHZ_FIELDS`, but ``AgentRegistryEntry`` is also the source of
    the committed OpenAPI snapshot. While those fields carried defaults, the
    contract told every generated client that an authorization state may
    legitimately be absent — and the defaults it shipped were ``enabled=True``
    and ``disposition="block"``, i.e. exactly the two wrong values the
    original bug produced on every row (coord defaults an unset disposition
    to ``degrade``, not ``block``).

    So this is not schema pedantry: a default here is a live re-entry point
    for the same defect, one construction site away.
    """

    def test_the_four_authz_fields_are_required_with_no_default(self):
        from app.api.v1.endpoints.agent_registry import (
            _AUTHZ_FIELDS,
            AgentRegistryEntry,
        )

        for name in _AUTHZ_FIELDS:
            field = AgentRegistryEntry.model_fields[name]
            assert field.is_required(), (
                f"`{name}` asserts an authorization state; a default lets a "
                "future construction path omit it silently, and publishes it "
                "to clients as optional"
            )

    def test_the_descriptive_fields_stay_permissive(self):
        """The strict/permissive split is deliberate, so pin both halves."""
        from app.api.v1.endpoints.agent_registry import AgentRegistryEntry

        for name in ("purpose", "spawn_path", "model", "effort", "fanout_bound"):
            assert not AgentRegistryEntry.model_fields[name].is_required(), (
                f"`{name}` is cosmetic; a coord that drops it must not take "
                "the settings page down"
            )

    def test_the_openapi_schema_marks_them_required(self):
        """What a generated client actually sees."""
        from app.api.v1.endpoints.agent_registry import (
            _AUTHZ_FIELDS,
            AgentRegistryEntry,
        )

        required = set(AgentRegistryEntry.model_json_schema()["required"])
        assert set(_AUTHZ_FIELDS) <= required
        assert "agent_name" in required


class TestDeployOrderIsSelfDiagnosing:
    """An undeployed coord must say so, not look like a missing web route."""

    def test_coord_404_becomes_a_502_naming_the_missing_route(self):
        """`/effective-for` is newer than this caller.

        A coord that has not deployed it answers 404 — and registers no axum
        fallback, so the body is EMPTY. Forwarded verbatim that surfaces as
        web's own 404 with a blank reason, which reads as "this web route is
        missing" rather than "coord is behind".
        """
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(side_effect=HTTPException(status_code=404, detail="")),
        ):
            client = TestClient(app)
            resp = client.get("/api/v1/agent-registry")

        assert resp.status_code == 502
        detail = str(resp.json()["detail"])
        assert "effective-for" in detail
        assert detail.strip(), "an empty reason is what this mapping exists to remove"

    def test_other_coord_errors_are_not_swallowed(self):
        """Only 404 is re-shaped; a 403 or 504 must pass through unchanged."""
        for code in (403, 500, 504):
            app = _build_app()
            with patch(
                "app.api.v1.endpoints.agent_registry._coord_request",
                new=AsyncMock(
                    side_effect=HTTPException(status_code=code, detail="upstream")
                ),
            ):
                client = TestClient(app)
                resp = client.get("/api/v1/agent-registry")
            assert resp.status_code == code


class TestPrefWriteIgnoresClientSuppliedUserId:
    """The PUT must never let the client name the user it writes.

    This module had no tests at all before the effective-view rewrite, which
    is why the GET bug lived for months. The write path's security-relevant
    invariant is correct today (``AgentPrefUpdateRequest`` omits ``user_id``
    and pydantic drops extras) but was entirely unpinned.

    **The assertion changed shape with plan
    ``2026-08-22-agent-registry-prefs-are-admin-only-and-the-tenant-default-has-no-ui``
    and the invariant did not.** This used to assert the forwarded body
    carried ``user_id == str(USER_ID)``: the target user was derived
    server-side HERE and named on the wire to coord's admin prefs door. That
    door names the user it writes, which is exactly why coord keeps it
    admin-gated — so the page 403'd for every non-admin member. The route now
    proxies coord's SELF door, which takes the acting user from the verified
    operator token; the body carries no ``user_id`` at all, and coord's
    ``deny_unknown_fields`` makes one a 422.

    So the property "a client-supplied ``user_id`` cannot reach coord" is
    STRONGER than before (the field has no wire representation at all), and
    the fuller Phase-2 coverage lives in
    ``test_agent_registry_admin_surface.py``.
    """

    def test_a_client_supplied_user_id_never_reaches_coord(self):
        attacker = str(uuid4())
        app = _build_app()
        with patch(
            "app.api.v1.endpoints.agent_registry._coord_request",
            new=AsyncMock(return_value={"ok": True}),
        ) as mock_req:
            client = TestClient(app)
            resp = client.put(
                "/api/v1/agent-registry/prefs/code-reviewer",
                json={"enabled": False, "disposition": "degrade", "user_id": attacker},
            )

        assert resp.status_code == 200
        sent_body = mock_req.call_args.kwargs["json_body"]
        assert "user_id" not in sent_body
        assert attacker not in str(sent_body)
        # The self door, whose acting user coord derives from the token.
        (_, sent_path) = mock_req.call_args.args
        assert sent_path == "/coord/agent-registry/prefs/me/code-reviewer"
