"""Integration tests for the coord work-unit ("Plans") list proxy.

``GET /api/v1/operations/plans`` proxies coord ``GET /coord/work-units`` so the
``/admin/coord/plans`` console renders without the browser hitting coord
cross-origin.

Plan
``D:/qontinui-root/plans/2026-08-20-coord-work-unit-lifecycle-timestamps-and-slug-exclusion.md``
Phase 3.

What these tests are actually protecting
========================================

The proxy used to forward ``status`` and ``limit`` and drop everything else,
while coord's ``ListQuery`` had accepted ``slug_prefix`` and ``offset`` all
along. The console could therefore neither page past the first window nor ask
for a slug subset — and it needs both: measured against production on
2026-08-20 the corpus is 1105 work units, of which 454 are auto-generated
``shepherd-*`` merge-escalation records that all share one ``updated_at``. With
coord ordering ``updated_at DESC`` and the page capped at 500, a *client-side*
split would let the shepherds crowd real plans out of the window entirely. The
filter has to reach coord's ``WHERE``, which means it has to survive this
proxy.

A dropped parameter fails silently — coord returns a valid, larger page and the
console renders it — so each parameter is asserted individually rather than in
one omnibus request that a single surviving parameter could green.

Mirrors the testing pattern in ``test_operations_claims_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient``, so no live coord is needed.

The body signals (plan ``2026-09-02-bodyless-work-units-are-listed-and-
spawnable-as-plans``)
==========================================================================

This route stopped being a verbatim pass-through: it now stamps
``body_provenance``, ``has_body`` and ``body_unknown_reason`` on every row and
a ``body_signal`` block on the envelope. So the coord mock has to answer TWO
different reads — the work-unit page and the ``plan_capture`` fleet-policy
dial — and one ``return_value`` for both would have silently fed the
work-units body into the policy projection, which resolves to
``effective_level: "off"`` and would green the wrong arm. ``_call`` dispatches
on the requested path for that reason.

The derivation's own unit coverage (every provenance value, every ``unknown``
arm) is ``test_plan_body_signal.py``; what is asserted here is that the WIRE
carries it.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"

#: Sentinel — `None` is a MEANINGFUL value for the actor override, so "not
#: supplied" cannot be spelled `None`.
_UNSET = object()

#: What coord answers for ``GET /coord/fleet-policy?domain=plan_capture`` when
#: the dial is on. ``record`` + a real band is the ONLY state under which a
#: join miss is allowed to mean ``has_body: false``.
_CAPTURE_ON = {
    "domain": "plan_capture",
    "effective_level": "record",
    "master_enabled": True,
    "resolved_scope": "tenant",
}


def _build_test_app(*, actor: object | None = _UNSET) -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_audit_actor_user_optional,
        get_current_active_user_async,
    )
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    # The org-scoped principal the body-signal join runs as. OPTIONAL on the
    # route — `None` here is the real "this bearer resolves for coord but not
    # for the plan library" case, not a broken fixture.
    resolved = mock_user if actor is _UNSET else actor
    test_app.dependency_overrides[get_audit_actor_user_optional] = lambda: resolved
    # The artifact join needs a session. Every query it would run is patched
    # per-test, so this only has to exist, not work.
    test_app.dependency_overrides[get_async_db] = lambda: MagicMock()
    test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT_ID
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data) if json_data else ""
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _patch_artifact_side(*, present: set[str] | None = None, corpus: int = 1400):
    """Patch the ``agent.work_artifacts`` half of the join.

    Returns a context manager stack; the defaults describe a POPULATED org
    corpus, which is the only configuration in which a miss is ``false``.
    """
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(
        patch(
            "app.services.plan_body_signal.resolve_personal_organization",
            AsyncMock(return_value=MagicMock(id=uuid4())),
        )
    )
    stack.enter_context(
        patch(
            "app.services.plan_body_signal.crud.count_artifacts",
            AsyncMock(return_value=corpus),
        )
    )
    stack.enter_context(
        patch(
            "app.services.plan_body_signal.crud.work_unit_slugs_with_artifacts",
            AsyncMock(return_value=set(present or set())),
        )
    )
    return stack


_EMPTY = {"work_units": [], "limit": 100, "offset": 0}


def _coord_dispatch(payload, capture=None):
    """Answer each coord GET by path, not with one payload for all of them."""

    async def _get(url, *args, **kwargs):
        if "/coord/fleet-policy" in url:
            return _mock_response(
                json_data=capture if capture is not None else _CAPTURE_ON
            )
        return _mock_response(json_data=payload)

    return _get


def _call(auth_client: TestClient, query: str, payload=None, *, capture=None):
    """Issue the proxied GET; return ``(response, coord_url, coord_params)``.

    ``coord_url`` / ``coord_params`` are the WORK-UNIT read's, which is the
    first call the route makes — the dial read only happens afterwards, and
    only when the page has rows.
    """
    with _patch_httpx() as MockClient, _patch_artifact_side():
        instance = AsyncMock()
        instance.get.side_effect = _coord_dispatch(payload or _EMPTY, capture)
        _configure_mock_client(MockClient, instance)
        resp = auth_client.get(f"{API_PREFIX}/plans{query}")
    first_call = instance.get.call_args_list[0]
    called_url = first_call.args[0]
    called_params = first_call.kwargs.get("params") or {}
    return resp, called_url, called_params


class TestListCoordPlans:
    def test_proxies_to_the_work_units_route(self, auth_client: TestClient):
        """coord's fields survive verbatim; the signals are ADDITIVE.

        Asserted as "every key coord sent is unchanged" rather than as dict
        equality, which is what it used to be: the route now annotates, so
        equality would only prove the annotation exists, not that nothing
        coord sent was rewritten on the way through.
        """
        payload = {
            "work_units": [
                {
                    "slug": "2026-08-20-something",
                    "status": "in_progress",
                    "created_at": "2026-08-01T00:00:00Z",
                    "updated_at": "2026-08-20T00:00:00Z",
                }
            ],
            "limit": 100,
            "offset": 0,
        }
        resp, url, _ = _call(auth_client, "", payload)

        assert resp.status_code == 200
        assert url.endswith("/coord/work-units")
        body = resp.json()
        assert body["limit"] == 100
        assert body["offset"] == 0
        row = body["work_units"][0]
        assert row["slug"] == "2026-08-20-something"
        assert row["status"] == "in_progress"
        assert row["created_at"] == "2026-08-01T00:00:00Z"
        assert row["updated_at"] == "2026-08-20T00:00:00Z"

    def test_no_filters_sends_no_params(self, auth_client: TestClient):
        """An unfiltered call must not invent defaults.

        coord's own defaults (limit 100, offset 0) are the contract; sending
        our own would silently pin the page size if coord's ever changed.
        """
        _, _, params = _call(auth_client, "")
        assert params == {}

    @pytest.mark.parametrize(
        ("query", "key", "expected"),
        [
            ("?status=shipped", "status", "shipped"),
            ("?slug_prefix=shepherd-", "slug_prefix", "shepherd-"),
            ("?exclude_slug_prefix=shepherd-", "exclude_slug_prefix", "shepherd-"),
            ("?limit=500", "limit", 500),
            ("?offset=500", "offset", 500),
            # offset=0 is the one that survives only because the proxy tests
            # `is not None` rather than truthiness. A tidy-up to `if offset:`
            # would drop it silently and every OTHER case here stays green, so
            # this row is what pins the idiom.
            ("?offset=0", "offset", 0),
            # The corpus walk (plan 2026-09-12-admin-coord-plans-shows-a-
            # rotating-3-minute-slice-so-plans-get-lost). A dropped cursor
            # half would make the console re-read page one forever — bounded
            # only by its page cap — so each is pinned on its own.
            ("?order=authored_desc", "order", "authored_desc"),
            ("?order=updated_desc", "order", "updated_desc"),
            (
                "?after_authored_at=2026-09-10T00:00:00Z",
                "after_authored_at",
                "2026-09-10T00:00:00Z",
            ),
            ("?after_slug=2026-09-10-a-plan", "after_slug", "2026-09-10-a-plan"),
        ],
    )
    def test_each_filter_is_forwarded(
        self, auth_client: TestClient, query: str, key: str, expected
    ):
        """Each parameter individually — a dropped one fails SILENTLY.

        Asserted one at a time on purpose: an omnibus request would go green on
        a single surviving parameter while the rest were quietly discarded,
        which is exactly the defect this phase fixes.
        """
        _, _, params = _call(auth_client, query)
        assert params.get(key) == expected

    def test_all_filters_ride_together(self, auth_client: TestClient):
        """Every filter at once, asserted as an EXACT dict.

        Equality rather than per-key membership: this is the case that would
        catch the proxy inventing a parameter nobody asked for.
        """
        _, _, params = _call(
            auth_client,
            "?status=in_progress&slug_prefix=2026-"
            "&exclude_slug_prefix=shepherd-&limit=500&offset=1000",
        )
        assert params == {
            "status": "in_progress",
            "slug_prefix": "2026-",
            "exclude_slug_prefix": "shepherd-",
            "limit": 500,
            "offset": 1000,
        }

    def test_cursor_rides_with_the_order(self, auth_client: TestClient):
        """A full next-page request, asserted as an EXACT dict — and no offset.

        The walk is keyset, not offset: the proxy must not invent an
        ``offset`` alongside the cursor.
        """
        _, _, params = _call(
            auth_client,
            "?limit=500&exclude_slug_prefix=shepherd-&order=authored_desc"
            "&after_authored_at=2026-09-10T00:00:00Z&after_slug=2026-09-10-x",
        )
        assert params == {
            "limit": 500,
            "exclude_slug_prefix": "shepherd-",
            "order": "authored_desc",
            "after_authored_at": "2026-09-10T00:00:00Z",
            "after_slug": "2026-09-10-x",
        }

    def test_null_tail_cursor_sends_slug_alone(self, auth_client: TestClient):
        """Inside the NULL-authored tail the cursor is ``after_slug`` alone."""
        _, _, params = _call(
            auth_client, "?order=authored_desc&after_slug=undated-plan"
        )
        assert params == {"order": "authored_desc", "after_slug": "undated-plan"}

    def test_junk_order_is_rejected_not_forwarded(self, auth_client: TestClient):
        """An unknown ``order`` is a 422 here, never an ignored param upstream."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans?order=created_desc")
        assert resp.status_code == 422
        instance.get.assert_not_called()

    @pytest.mark.parametrize(
        "param",
        ["slug_prefix", "exclude_slug_prefix", "after_slug", "after_authored_at"],
    )
    def test_empty_prefix_is_rejected_not_forwarded(
        self, auth_client: TestClient, param: str
    ):
        """An EMPTY prefix must never reach coord.

        `exclude_slug_prefix=` would become `slug NOT LIKE '' || '%'` there —
        `NOT LIKE '%'` — which excludes every row. A console forwarding an
        empty input box would render a blank Plans list, and this endpoint's
        own docstring tells the operator to read an unexpected page as "coord
        has not caught up yet". `min_length=1` makes it a loud 422 instead.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans?{param}=")
        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_offset_rejects_negative(self, auth_client: TestClient):
        """``ge=0`` is enforced here rather than deferred to coord."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans?offset=-1")
        assert resp.status_code == 422

    def test_limit_ceiling_matches_coords_clamp(self, auth_client: TestClient):
        """``le=500`` mirrors coord's server-side clamp.

        coord clamps to ``[1, 500]`` itself, so a larger value would not be
        dangerous — but it would be a LIE: the caller would believe it had
        asked for more than one page's worth and silently receive 500.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans?limit=501")
        assert resp.status_code == 422


class TestBodySignalsOnTheWire:
    """Plan ``2026-09-02-bodyless-work-units-…``, Phases 1, 2 and 5a.

    The console calls these rows "Plans". These assertions are what stops it
    from doing so without saying which of them is one.
    """

    def _page(self):
        return {
            "work_units": [
                # Filed by a discovering session — no `source_path`, no body.
                # This is the §2.2 specimen's shape, and the row an operator
                # actually sent a session at on 2026-09-02.
                {
                    "slug": "2026-09-01-coord-post-respawn-duplicates-child",
                    "status": "in_progress",
                    "metadata": {"handler": "post_respawn", "severity": "high"},
                },
                # Scanned from a canonical plans directory.
                {
                    "slug": "2026-08-16-plan-corpus-authority",
                    "status": "shipped",
                    "metadata": {
                        "source_path": "D:/qontinui-root/qontinui-dev-notes/"
                        "plans/2026-08-16-plan-corpus-authority.md"
                    },
                },
                # Phase 5a — scanned, but only inside a session worktree.
                {
                    "slug": "2026-09-02-only-on-one-machine",
                    "status": "draft",
                    "metadata": {
                        "source_path": "/home/x/qontinui-root/agent-worktrees/"
                        "01a0/qontinui-dev-notes/plans/2026-09-02-x.md"
                    },
                },
            ],
            "limit": 100,
            "offset": 0,
        }

    def test_every_row_carries_a_provenance_value(self, auth_client: TestClient):
        resp, _, _ = _call(auth_client, "", self._page())
        rows = resp.json()["work_units"]
        assert [r["body_provenance"] for r in rows] == [
            "never_scanned",
            "scanned",
            "scanned_locally",
        ]

    def test_provenance_is_stamped_on_terminal_rows_too(self, auth_client: TestClient):
        """The console suppresses the BADGE on a shipped unit, not the FIELD.

        A shipped work unit that never had a document is not a defect
        (`plan-discipline`), so rendering a badge on it would spend the
        badge's credibility on correctly-closed work. But suppressing the
        field would block any later consumer that wants it, and a render
        decision does not belong in a wire contract.
        """
        resp, _, _ = _call(auth_client, "", self._page())
        shipped = resp.json()["work_units"][1]
        assert shipped["status"] == "shipped"
        assert shipped["body_provenance"] == "scanned"
        assert "has_body" in shipped

    def test_a_join_hit_is_true_and_a_miss_is_false_when_capture_is_live(
        self, auth_client: TestClient
    ):
        payload = self._page()
        hit = payload["work_units"][1]["slug"]
        with _patch_httpx() as MockClient, _patch_artifact_side(present={hit}):
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(payload)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans")

        rows = resp.json()["work_units"]
        assert rows[1]["has_body"] is True
        assert rows[1]["body_unknown_reason"] is None
        assert rows[0]["has_body"] is False
        assert rows[0]["body_unknown_reason"] is None
        assert resp.json()["body_signal"]["miss_reason"] is None

    def test_an_empty_org_corpus_makes_every_miss_unknown(
        self, auth_client: TestClient
    ):
        """The V4 arm. Without it the first deploy is a page of accusations."""
        payload = self._page()
        with _patch_httpx() as MockClient, _patch_artifact_side(corpus=0):
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(payload)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans")

        body = resp.json()
        assert body["body_signal"]["miss_reason"] == "empty_corpus_for_org"
        assert body["body_signal"]["org_plan_artifact_count"] == 0
        for row in body["work_units"]:
            assert row["has_body"] == "unknown"
            assert row["body_unknown_reason"] == "empty_corpus_for_org"

    def test_capture_off_makes_every_miss_unknown(self, auth_client: TestClient):
        payload = self._page()
        off = {
            "domain": "plan_capture",
            "effective_level": "off",
            "master_enabled": True,
            "resolved_scope": "tenant",
        }
        with _patch_httpx() as MockClient, _patch_artifact_side():
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(payload, capture=off)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans")

        body = resp.json()
        assert body["body_signal"]["capture_level"] == "off"
        assert body["body_signal"]["miss_reason"] == "capture_off"
        assert all(r["has_body"] == "unknown" for r in body["work_units"])

    def test_never_configured_is_not_the_same_fact_as_turned_off(
        self, auth_client: TestClient
    ):
        payload = self._page()
        never = {
            "domain": "plan_capture",
            "effective_level": "off",
            "master_enabled": False,
            "resolved_scope": "none",
        }
        with _patch_httpx() as MockClient, _patch_artifact_side():
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(payload, capture=never)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans")

        assert resp.json()["body_signal"]["miss_reason"] == "capture_never_configured"

    def test_an_unreadable_artifact_surface_does_not_500_the_page(
        self, auth_client: TestClient
    ):
        """The whole list still renders. Every row says it does not know.

        This is the worst realistic failure, and its honest answer is the
        pre-existing state — nobody knew before this shipped either.
        """
        payload = self._page()
        with (
            _patch_httpx() as MockClient,
            patch(
                "app.services.plan_body_signal.resolve_personal_organization",
                AsyncMock(side_effect=RuntimeError("statement timeout")),
            ),
        ):
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(payload)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["work_units"]) == 3
        assert body["body_signal"]["artifact_surface_readable"] is False
        # Not measured — and NEVER 0, which is a measurement.
        assert body["body_signal"]["org_plan_artifact_count"] is None
        for row in body["work_units"]:
            assert row["has_body"] == "unknown"
            assert row["body_unknown_reason"] == "artifact_surface_unavailable"
            # The corpus-independent screen survives the outage intact — that
            # is the whole reason Phase 1 does not depend on Phase 2.
            assert row["body_provenance"] in {
                "scanned",
                "scanned_locally",
                "never_scanned",
            }

    def test_an_unreachable_capture_dial_is_unknown_never_off(
        self, auth_client: TestClient
    ):
        payload = self._page()

        async def _get(url, *args, **kwargs):
            if "/coord/fleet-policy" in url:
                raise httpx.ConnectError("coord is down")
            return _mock_response(json_data=payload)

        with _patch_httpx() as MockClient, _patch_artifact_side():
            instance = AsyncMock()
            instance.get.side_effect = _get
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans")

        assert resp.status_code == 200
        body = resp.json()
        assert body["body_signal"]["capture_readable"] is False
        assert body["body_signal"]["miss_reason"] == "capture_unreadable"

    def test_an_empty_page_pays_for_no_signal_reads(self, auth_client: TestClient):
        """Nothing to annotate, nothing to explain, no round trip to spend."""
        with _patch_httpx() as MockClient, _patch_artifact_side() as _:
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans")

        assert instance.get.await_count == 1
        assert "body_signal" not in resp.json()

    def test_the_detail_route_answers_the_same_way_as_the_row(
        self, auth_client: TestClient
    ):
        """A detail page that disagreed with the row clicked to reach it would
        be worse than neither carrying the signal."""
        slug = "2026-09-01-coord-post-respawn-duplicates-child"
        detail = {
            "work_unit": {
                "slug": slug,
                "status": "in_progress",
                "metadata": {"handler": "post_respawn"},
            },
            "recent_history": [],
            "citations": [],
        }
        with _patch_httpx() as MockClient, _patch_artifact_side():
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(detail)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans/{slug}")

        body = resp.json()
        assert body["work_unit"]["body_provenance"] == "never_scanned"
        assert body["work_unit"]["has_body"] is False
        assert body["body_signal"]["miss_reason"] is None
        assert body["recent_history"] == []

    def test_no_org_scoped_principal_is_unknown_not_a_401(self):
        """`/plans` must not narrow its auth as a side effect of the signal.

        The route is gated by `get_tenant_id` — a coord-resolvable bearer —
        which is a WIDER door than the plan library's dual-auth tree. A caller
        that passes the first and not the second still gets their list; they
        just get `unknown` instead of a verdict, because scoping them to the
        shared NULL organization bucket would report someone else's corpus as
        theirs.
        """
        client = TestClient(_build_test_app(actor=None))
        payload = self._page()
        with _patch_httpx() as MockClient, _patch_artifact_side():
            instance = AsyncMock()
            instance.get.side_effect = _coord_dispatch(payload)
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/plans")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["work_units"]) == 3
        assert body["body_signal"]["miss_reason"] == "no_org_principal"
        for row in body["work_units"]:
            assert row["has_body"] == "unknown"
            assert row["body_unknown_reason"] == "no_org_principal"
            # The screen does not depend on a principal at all.
            assert row["body_provenance"] in {
                "scanned",
                "scanned_locally",
                "never_scanned",
            }


class TestCoordPlansOverview:
    def test_proxies_to_the_overview_route(self, auth_client: TestClient):
        payload = {
            "row_count": 1800,
            "distinct_status_count": 2,
            "facets": {
                "by_status_class": {},
                "by_status": {"shipped": 1700, "draft": 100},
                "by_status_truncated": False,
                "by_status_omitted": 0,
            },
            "corpus_complete": True,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=payload)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans/overview")
        assert resp.status_code == 200
        assert resp.json() == payload
        assert instance.get.call_args.args[0].endswith("/coord/work-units/overview")
        assert not instance.get.call_args.kwargs.get("params")

    def test_overview_is_declared_before_the_slug_route(self):
        """``/plans/overview`` must win over ``/plans/{slug}``.

        FastAPI matches in declaration order. Reversed, the single-unit
        handler would capture ``slug="overview"`` — and because it proxies to
        ``/coord/work-units/{slug}`` the request would still reach the same
        coord path by accident, so the URL assertion above cannot catch it.
        The order of the router's routes can.
        """
        from app.api.v1.endpoints.operations import router

        paths = [getattr(r, "path", "") for r in router.routes]
        assert paths.index("/plans/overview") < paths.index("/plans/{slug}")

    @pytest.mark.parametrize("derive_mode", ["shadow", "live"])
    def test_overview_passes_derive_mode_through(
        self, auth_client: TestClient, derive_mode: str
    ):
        """coord's deployment-wide ``derive_mode`` reaches the console verbatim.

        The proxy is unmodelled, so this pins that it STAYS that way: a model
        added later that forgot the field would drop the posture the console
        needs for its "decay detection runs in shadow mode" caveat.
        """
        payload = {"row_count": 3, "corpus_complete": True, "derive_mode": derive_mode}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=payload)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans/overview")
        assert resp.json()["derive_mode"] == derive_mode

    def test_an_older_coord_overview_carries_no_derive_mode_key(
        self, auth_client: TestClient
    ):
        """Absent stays ABSENT — never defaulted to ``live`` on the way through."""
        payload = {"row_count": 3, "corpus_complete": True}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=payload)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans/overview")
        assert "derive_mode" not in resp.json()


class TestLiveSessionFlagsOnTheList:
    """Plan ``2026-09-19-plan-library-cannot-answer-what-to-work-on-next`` 0c.

    The two flags are forwarded ONLY when given, each pinned on its own — a
    dropped flag fails silently (coord answers a page with no
    ``live_sessions``, which the console would read as UNKNOWN forever).
    """

    @pytest.mark.parametrize(
        ("query", "key", "expected"),
        [
            ("?include_live_sessions=true", "include_live_sessions", "true"),
            ("?include_live_sessions=false", "include_live_sessions", "false"),
            ("?resolve_session_names=true", "resolve_session_names", "true"),
            ("?resolve_session_names=false", "resolve_session_names", "false"),
        ],
    )
    def test_each_flag_is_forwarded(
        self, auth_client: TestClient, query: str, key: str, expected: str
    ):
        _, _, params = _call(auth_client, query)
        assert params.get(key) == expected

    def test_both_flags_ride_together_and_nothing_else_is_invented(
        self, auth_client: TestClient
    ):
        _, _, params = _call(
            auth_client, "?include_live_sessions=1&resolve_session_names=yes"
        )
        assert params == {
            "include_live_sessions": "true",
            "resolve_session_names": "true",
        }

    def test_absent_flags_are_not_sent(self, auth_client: TestClient):
        _, _, params = _call(auth_client, "?status=draft")
        assert "include_live_sessions" not in params
        assert "resolve_session_names" not in params

    def test_custody_and_the_echo_survive_the_annotation(self, auth_client: TestClient):
        """The body signals are additive; coord's custody fields pass verbatim."""
        session = {
            "device_id": str(uuid4()),
            "correlation_topic": "t",
            "intent_globs": None,
            "updated_at": "2026-10-06T00:00:00Z",
            "expires_at": "2026-10-06T00:05:00Z",
            "custody": {"state": "sole", "session_name": "plan-foo"},
        }
        payload = {
            "work_units": [
                {
                    "slug": "2026-10-06-custody",
                    "status": "in_progress",
                    "live_sessions": [session],
                }
            ],
            "limit": 100,
            "offset": 0,
            "resolve_session_names": True,
        }
        resp, _, _ = _call(
            auth_client,
            "?include_live_sessions=true&resolve_session_names=true",
            payload,
        )
        body = resp.json()
        assert body["resolve_session_names"] is True
        assert body["work_units"][0]["live_sessions"] == [session]


class TestCoordPlansThroughput:
    """``GET /operations/plans/throughput`` → coord ``/coord/work-units/throughput``."""

    _BODY = {
        "since": "2026-09-01T00:00:00Z",
        "until": "2026-10-06T00:00:00Z",
        "bucket": "day",
        "timezone": "UTC",
        "statuses": ["in_progress", "shipped"],
        "count": 1,
        "buckets": [{"day": "2026-09-02", "to_status": "shipped", "count": 4}],
    }

    def _get(self, auth_client: TestClient, query: str, *, status_code: int = 200):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=status_code, json_data=self._BODY
            )
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans/throughput{query}")
        return resp, instance

    def test_since_is_forwarded_and_the_body_passes_through(
        self, auth_client: TestClient
    ):
        resp, instance = self._get(auth_client, "?since=2026-09-01")
        assert resp.status_code == 200
        assert resp.json() == self._BODY
        assert instance.get.call_args.args[0].endswith("/coord/work-units/throughput")
        assert instance.get.call_args.kwargs["params"] == {"since": "2026-09-01"}

    def test_until_rides_with_since(self, auth_client: TestClient):
        _, instance = self._get(
            auth_client, "?since=2026-09-01T00:00:00Z&until=2026-09-15"
        )
        assert instance.get.call_args.kwargs["params"] == {
            "since": "2026-09-01T00:00:00Z",
            "until": "2026-09-15",
        }

    @pytest.mark.parametrize("query", ["", "?since=", "?until=2026-09-15"])
    def test_since_is_required_and_coord_is_never_asked(
        self, auth_client: TestClient, query: str
    ):
        """An unbounded scan is refused HERE, before any coord round trip."""
        resp, instance = self._get(auth_client, query)
        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_coords_window_rejection_is_forwarded(self, auth_client: TestClient):
        resp, _ = self._get(auth_client, "?since=1999-01-01", status_code=400)
        assert resp.status_code == 400

    def test_throughput_is_declared_before_the_slug_route(self):
        from app.api.v1.endpoints.operations import router

        paths = [getattr(r, "path", "") for r in router.routes]
        assert paths.index("/plans/throughput") < paths.index("/plans/{slug}")


class TestCoordPlanAttribution:
    """``GET /operations/plans/{slug}/attribution`` → coord's operator-only
    ``/coord/work-units/{slug}/attribution`` (plan
    ``2026-09-19-plan-library-cannot-answer-what-to-work-on-next`` Phase 0d/7).
    """

    _SLUG = "2026-09-19-plan-library-cannot-answer-what-to-work-on-next"
    _BODY = {
        "slug": _SLUG,
        "attribution_available": True,
        "shipped_by": [
            {
                "session_name": "plan-foo",
                "pr_refs": [
                    {
                        "repo": "qontinui/qontinui-web",
                        "pr_number": 12,
                        "merged": True,
                        "attribution_is_single_session": True,
                    }
                ],
            }
        ],
        "unnamed_session_count": 1,
        "unattributed_pr_count": 2,
    }

    def _get(
        self,
        client: TestClient,
        slug: str,
        *,
        status_code: int = 200,
        body: object = None,
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=status_code,
                json_data=self._BODY if body is None else body,
            )
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/plans/{slug}/attribution")
        return resp, instance

    def test_proxies_to_the_coord_attribution_door_unchanged(
        self, auth_client: TestClient
    ):
        resp, instance = self._get(auth_client, self._SLUG)
        assert resp.status_code == 200
        assert resp.json() == self._BODY
        url = instance.get.call_args.args[0]
        assert url.endswith(f"/coord/work-units/{self._SLUG}/attribution")
        # Nothing invented on the query string.
        assert not instance.get.call_args.kwargs.get("params")

    def test_the_operator_bearer_is_forwarded(self, auth_client: TestClient):
        """``tenant_id=`` is what makes ``_proxy_coord_get`` forward the
        bearer coord authorizes on; without it coord answers 401/403."""
        with patch_ops(
            "_tenant_headers",
            return_value={"Authorization": "Bearer op"},
        ) as headers:
            _, instance = self._get(auth_client, self._SLUG)
        headers.assert_called_once_with(TEST_TENANT_ID)
        assert instance.get.call_args.kwargs["headers"] == {
            "Authorization": "Bearer op"
        }

    def test_an_unavailable_attribution_passes_through_as_unknown(
        self, auth_client: TestClient
    ):
        unavailable = {
            "slug": self._SLUG,
            "attribution_available": False,
            "unavailable_reason": "lineage_tenant_column_missing",
            "shipped_by": [],
            "unnamed_session_count": None,
            "unattributed_pr_count": None,
        }
        resp, _ = self._get(auth_client, self._SLUG, body=unavailable)
        assert resp.status_code == 200
        assert resp.json() == unavailable

    @pytest.mark.parametrize("status_code", [403, 404])
    def test_coords_refusal_is_forwarded(
        self, auth_client: TestClient, status_code: int
    ):
        resp, _ = self._get(
            auth_client, self._SLUG, status_code=status_code, body={"error": "x"}
        )
        assert resp.status_code == status_code

    # Each of these REACHES the route (httpx would normalise a bare ``..``
    # segment away before sending, so it would test nothing) and is refused
    # only by the slug pattern.
    @pytest.mark.parametrize("slug", ["..x", ".hidden", "-x", "a%20b"])
    def test_a_slug_that_could_re_point_the_proxied_path_is_refused(
        self, auth_client: TestClient, slug: str
    ):
        resp, instance = self._get(auth_client, slug)
        assert resp.status_code in (404, 422)
        instance.get.assert_not_called()

    def test_a_caller_with_no_bearer_never_reaches_coord(self):
        """The REAL ``get_tenant_id`` (no override): a request carrying no
        bearer is refused by the operator-identity resolution before any coord
        call — the path a device or agent caller without a Cognito token takes.
        """
        from app.api.v1.endpoints.operations import get_tenant_id

        app = _build_test_app()
        del app.dependency_overrides[get_tenant_id]
        resp, instance = self._get(TestClient(app), self._SLUG)
        assert resp.status_code in (401, 403)
        instance.get.assert_not_called()

    def test_an_identity_with_no_operator_tenant_is_refused(self):
        """coord's ``/admin/coord/me`` resolving no tenant for the bearer (what a
        non-operator token yields) is a 403 here, and the attribution door is
        never asked."""
        from app.api.v1.endpoints.operations import get_tenant_id

        app = _build_test_app()
        del app.dependency_overrides[get_tenant_id]
        identity = MagicMock(home_tenant_id=None)
        with patch_ops(
            "get_coord_identity",
            AsyncMock(return_value=identity),
        ):
            resp, instance = self._get(TestClient(app), self._SLUG)
        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"
        instance.get.assert_not_called()

    def test_attribution_depends_on_the_operator_tenant_dependency(self):
        from app.api.v1.endpoints.operations import get_tenant_id, router

        route = next(
            r
            for r in router.routes
            if getattr(r, "path", "") == "/plans/{slug}/attribution"
        )
        calls = [d.call for d in route.dependant.dependencies]
        assert get_tenant_id in calls
