"""Plan & Prompt Library — ``GET /plan-library/candidates`` (Phase 6).

Plan ``2026-08-10-plan-and-prompt-library-in-web``, design decision D6: the
read exposes the ranking INPUTS and the AGENT ranks. These tests hold that
line — ``test_no_criticality_score_is_emitted`` scans the whole serialized
payload for any scoring-shaped key, so a well-meaning "just add a priority
column" cannot slip in later.

The coord half is mocked at ``_proxy_coord_get`` — the SAME seam
``test_agent_sessions_coord_proxy.py`` mocks — so no live coord is needed and
each degradation mode can be reproduced exactly:

* coord answers                → ``work_unit_state="linked"`` + real citations
* coord 404s the work unit     → ``"dangling"``; a normal result, never a 404
* coord is unreachable         → ``"unavailable"``, and the read still returns
                                 the local signals. **Unavailable is UNKNOWN,
                                 not empty** — the assertion that the two are
                                 distinguishable is the point of the test.

The coord-schema boundary itself is guarded by
``tests/test_coord_schema_boundary_guard.py``; nothing here reads coord's
Postgres tables.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.plan_library import (
    _COORD_FANOUT,
    _REASON_MAX_CHARS,
    _coord_links,
    _CoordProbe,
)
from app.crud import work_artifact as crud
from app.models.work_artifact import WorkArtifact

API_PREFIX = "/api/v1/plan-library"
CANDIDATES = f"{API_PREFIX}/candidates"

pytestmark = pytest.mark.asyncio

#: Any key shaped like a ranking verdict. D6 forbids all of them.
_SCORE_SHAPED = re.compile(
    r"(score|criticality|priority|weight|ranking|rank_|_rank|urgency)",
    re.IGNORECASE,
)


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


async def _plan(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    status: str = "VETTED",
    kind: str = "plan",
    body: str | None = None,
    work_unit_slug: str | None = None,
    repos: list[str] | None = None,
    authored_at: datetime | None = None,
) -> WorkArtifact:
    row, _, _ = await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=None,
        kind=kind,
        slug=slug,
        title=f"Plan {slug}",
        status=status,
        body=body if body is not None else f"# {slug}",
        source_path=None,
        source_repo=None,
        work_unit_slug=work_unit_slug,
        repos=repos or [],
        authored_at=authored_at,
        captured_by="agent",
        change_description=None,
        created_by="test",
    )
    return row


# ===========================================================================
# Layer 1 — the local signals (CRUD)
# ===========================================================================


class TestCandidateSelection:
    async def test_only_unshipped_plans_are_candidates(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        live = await _plan(async_db_session, org_id=org, slug=_slug("live"))
        await _plan(async_db_session, org_id=org, slug=_slug("done"), status="SHIPPED")
        await _plan(
            async_db_session, org_id=org, slug=_slug("gone"), status="ABANDONED"
        )
        # Not a plan at all.
        await _plan(async_db_session, org_id=org, slug=_slug("prompt"), kind="handoff")

        rows, total = await crud.list_plan_candidates(async_db_session, org_id=org)
        assert total == 1
        assert [r.id for r in rows] == [live.id]

    async def test_terminal_status_matching_is_normalized(
        self, async_db_session: AsyncSession
    ) -> None:
        """``status`` is opaque free-form text, so the reading must normalize."""
        org = uuid4()
        for spelling in ("shipped", "Shipped", "SHIPPED ", "in-progress"):
            await _plan(
                async_db_session,
                org_id=org,
                slug=_slug("spell"),
                status=spelling,
            )
        rows, total = await crud.list_plan_candidates(async_db_session, org_id=org)
        assert total == 1
        assert rows[0].status == "in-progress"

    async def test_unknown_status_counts_as_unshipped(
        self, async_db_session: AsyncSession
    ) -> None:
        """An unrecognised word must never silently hide a plan."""
        org = uuid4()
        await _plan(
            async_db_session,
            org_id=org,
            slug=_slug("weird"),
            status="MARINATING",
        )
        _, total = await crud.list_plan_candidates(async_db_session, org_id=org)
        assert total == 1

    async def test_ordering_is_oldest_vetted_first_and_stable(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        base = datetime(2026, 1, 1, tzinfo=UTC)
        expected = []
        # Insert out of order; the read must sort them.
        for offset in (5, 1, 9, 3):
            row = await _plan(
                async_db_session,
                org_id=org,
                slug=_slug(f"aged{offset}"),
                authored_at=base + timedelta(days=offset),
            )
            expected.append((offset, row.id))
        expected.sort()

        rows, _ = await crud.list_plan_candidates(async_db_session, org_id=org)
        assert [r.id for r in rows] == [rid for _, rid in expected]

        # Same query again → same order. Nothing here is time- or
        # insertion-order dependent.
        again, _ = await crud.list_plan_candidates(async_db_session, org_id=org)
        assert [r.id for r in again] == [r.id for r in rows]

    async def test_ordering_ties_break_on_id(
        self, async_db_session: AsyncSession
    ) -> None:
        """Identical timestamps must still page deterministically."""
        org = uuid4()
        same = datetime(2026, 2, 2, tzinfo=UTC)
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=org,
                slug=_slug("tied"),
                authored_at=same,
            )
        rows, _ = await crud.list_plan_candidates(async_db_session, org_id=org)
        assert [r.id for r in rows] == sorted(r.id for r in rows)

        page1, total = await crud.list_plan_candidates(
            async_db_session, org_id=org, offset=0, limit=2
        )
        page2, _ = await crud.list_plan_candidates(
            async_db_session, org_id=org, offset=2, limit=2
        )
        assert total == 4
        assert [r.id for r in page1 + page2] == [r.id for r in rows]

    async def test_unmet_depends_on_excludes_shipped_targets(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        plan = await _plan(async_db_session, org_id=org, slug=_slug("dependent"))
        blocker = await _plan(
            async_db_session, org_id=org, slug=_slug("blocker"), status="IN PROGRESS"
        )
        landed = await _plan(
            async_db_session, org_id=org, slug=_slug("landed"), status="SHIPPED"
        )
        for target in (blocker, landed):
            await crud.create_edge(
                async_db_session,
                from_artifact=plan,
                to_artifact=target,
                relation="depends_on",
                note=None,
                created_by="test",
            )

        deps = await crud.load_depends_on(async_db_session, [plan.id])
        unmet = [d for d in deps[plan.id] if not crud.is_terminal_status(d.status)]
        assert [d.id for d in unmet] == [blocker.id]

    async def test_prompt_chain_walks_back_through_the_provenance(
        self, async_db_session: AsyncSession
    ) -> None:
        """investigation_prompt → report → authoring prompt → plan."""
        org = uuid4()
        inv_prompt = await _plan(
            async_db_session,
            org_id=org,
            slug=_slug("inv-prompt"),
            kind="investigation_prompt",
        )
        report = await _plan(
            async_db_session,
            org_id=org,
            slug=_slug("inv-report"),
            kind="investigation_report",
        )
        authoring = await _plan(
            async_db_session,
            org_id=org,
            slug=_slug("authoring"),
            kind="plan_authoring_prompt",
        )
        plan = await _plan(async_db_session, org_id=org, slug=_slug("the-plan"))

        for src, dst, relation in (
            (inv_prompt, report, "produced_report"),
            (report, authoring, "feeds"),
            (authoring, plan, "authored_plan"),
        ):
            await crud.create_edge(
                async_db_session,
                from_artifact=src,
                to_artifact=dst,
                relation=relation,
                note=None,
                created_by="test",
            )

        chains = await crud.load_prompt_chains(async_db_session, [plan.id])
        walked = chains[plan.id]
        assert [(p.id, rel, depth) for p, rel, depth in walked] == [
            (authoring.id, "authored_plan", 1),
            (report.id, "feeds", 2),
            (inv_prompt.id, "produced_report", 3),
        ]

    async def test_prompt_chain_survives_a_cycle(
        self, async_db_session: AsyncSession
    ) -> None:
        """The graph is user-authored; a cycle must terminate, not hang."""
        org = uuid4()
        a = await _plan(async_db_session, org_id=org, slug=_slug("cyc-a"))
        b = await _plan(async_db_session, org_id=org, slug=_slug("cyc-b"))
        for src, dst in ((a, b), (b, a)):
            await crud.create_edge(
                async_db_session,
                from_artifact=src,
                to_artifact=dst,
                relation="feeds",
                note=None,
                created_by="test",
            )
        chains = await crud.load_prompt_chains(async_db_session, [a.id])
        assert [p.id for p, _, _ in chains[a.id]] == [b.id]


# ===========================================================================
# Layer 2 — HTTP, with coord mocked
# ===========================================================================


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    # Both Cognito dependencies: the reads here resolve their principal through
    # the dual-auth ``get_audit_actor_user`` (which reads the OPTIONAL one), so
    # overriding only the strict one would 401 every request. See the fuller
    # note in ``tests/test_plan_library_api.py``.
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user
    app.dependency_overrides[current_active_user_optional] = lambda: user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(plan_library_router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"cand_{uuid4().hex[:8]}@example.com",
        username=f"cand_{uuid4().hex[:8]}",
        full_name="Candidate Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def client(async_db_session: AsyncSession, api_user):
    app = _build_app(db_session=async_db_session, user=api_user)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as http_client:
        yield http_client


@pytest.fixture(autouse=True)
def _no_live_tenant_resolution():
    """Never let the tenant resolver reach out to a real coord in tests.

    ``_soft_tenant_id`` already swallows a failure, but letting it try would
    cost a real 5s network timeout per test run.
    """
    with patch(
        "app.api.v1.endpoints.plan_library._soft_tenant_id",
        new=AsyncMock(return_value=uuid4()),
    ):
        yield


def _coord_ok(work_unit: dict[str, Any], citations: list[dict[str, Any]]):
    """A coord that answers — on each door tier the way coord ACTUALLY does.

    The two by-slug doors do not return the same body, and a fixture that
    pretends they do lets a test pin a call sequence coord cannot produce:

    * ``/coord/agent-work-units/{slug}`` ALWAYS embeds ``citations`` — rows, or
      ``[]`` beside ``citations_error``. So a device caller short-circuits on
      the inline list (:meth:`_CoordProbe._inline_citations`) and the citations
      sub-resource is NEVER reached on that path.
    * ``/coord/work-units/{slug}`` — the operator twin — deliberately omits the
      key to keep the dashboard payload lean, so an operator caller really does
      make two hops.

    Modelling both doors without ``citations`` (which this helper used to do)
    made a device-path two-hop assertion pass against a shape production never
    emits. The two-hop sequence is pinned on the operator path, where it
    genuinely occurs.
    """

    async def _fake(path: str, **_: Any) -> Any:
        if path.endswith("/citations"):
            return {"citations": citations}
        body: dict[str, Any] = {"work_unit": work_unit, "recent_history": []}
        if path.startswith("/coord/agent-work-units/"):
            body["citations"] = citations
        return body

    return AsyncMock(side_effect=_fake)


class TestCandidatesHttp:
    async def test_returns_the_local_signals(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession, api_user
    ) -> None:
        org = None  # the test user has no personal organization → NULL bucket
        plan = await _plan(
            async_db_session,
            org_id=org,
            slug=_slug("signals"),
            status="VETTED",
            repos=["qontinui-web", "coord"],
            authored_at=datetime.now(UTC) - timedelta(days=12),
        )
        blocker = await _plan(
            async_db_session, org_id=org, slug=_slug("blk"), status="IN PROGRESS"
        )
        await crud.create_edge(
            async_db_session,
            from_artifact=plan,
            to_artifact=blocker,
            relation="depends_on",
            note=None,
            created_by="test",
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(return_value={}),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ordering"] == "oldest_vetted_first"
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        assert row["status"] == "VETTED"
        assert sorted(row["repos"]) == ["coord", "qontinui-web"]
        assert 11.9 < row["age_days"] < 12.1
        assert row["last_touched"]
        assert [d["id"] for d in row["unmet_depends_on"]] == [str(blocker.id)]
        # No work_unit_slug → nothing to ask coord about.
        assert row["coord"]["work_unit_state"] == "unlinked"
        assert row["coord"]["linked_prs_state"] == "unlinked"

    async def test_coord_linked_work_unit_and_prs(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        wu = _slug("wu")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("linked"), work_unit_slug=wu
        )

        fake = _coord_ok(
            {"slug": wu, "status": "in_progress", "title": "The unit"},
            [
                {
                    "repo": "qontinui-web",
                    "pr_number": 1234,
                    "merged": True,
                    "branch": "feat/x",
                    "cited_at": "2026-08-01T00:00:00+00:00",
                    "sources": ["pr_body"],
                },
                {
                    "repo": "qontinui-coord",
                    "pr_number": 99,
                    "merged": False,
                    "branch": "feat/y",
                    "cited_at": "2026-08-02T00:00:00+00:00",
                    "sources": ["commit"],
                },
            ],
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is True
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked"
        assert link["work_unit_status"] == "in_progress"
        assert link["work_unit_title"] == "The unit"
        assert link["linked_prs_state"] == "available"
        assert [(p["pr_number"], p["state"]) for p in link["linked_prs"]] == [
            (1234, "merged"),
            (99, "unmerged"),
        ]

        # Both hops go over coord's HTTP API — never a coord.* SQL read.
        called = [c.args[0] for c in fake.await_args_list]
        assert f"/coord/work-units/{wu}" in called
        assert f"/coord/work-units/{wu}/citations" in called

    async def test_dangling_work_unit_slug_is_a_normal_result(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A soft link with no work unit must NEVER 404 or error the read."""
        wu = f"phantom-{uuid4().hex[:8]}"
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("dangler"), work_unit_slug=wu
        )

        async def _coord_404(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=404, detail="no work-unit with that slug")

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_coord_404),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        # A 404 is coord ANSWERING, so the read is not degraded.
        assert body["coord_available"] is True
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_slug"] == wu
        assert link["work_unit_state"] == "dangling"
        assert link["work_unit_status"] is None
        # Citations carry a hard FK to the unit, so no unit IS a real zero.
        assert link["linked_prs_state"] == "unlinked"
        assert link["linked_prs"] == []
        # The local signals are all still there.
        assert row["status"] == "VETTED"

    async def test_unreachable_coord_is_unavailable_not_empty(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The whole point: UNKNOWN must be distinguishable from zero."""
        wu = _slug("wu-down")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("coord-down"), work_unit_slug=wu
        )

        async def _coord_down(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=502, detail="coord is not reachable")

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_coord_down),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, f"a coord outage must not 502 this: {resp.text}"
        body = resp.json()
        assert body["coord_available"] is False
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "unavailable"
        assert link["linked_prs_state"] == "unavailable"
        assert link["unavailable_reason"]
        # The list is empty ONLY because there is nothing to show. The state
        # field is what says so — an "available" + [] would mean no PRs.
        assert link["linked_prs"] == []
        assert link["linked_prs_state"] != "available"
        # The local signals survived the outage.
        assert row["slug"] == plan.slug
        assert row["status"] == "VETTED"

    async def test_a_transport_failure_does_not_pay_a_timeout_per_row(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The circuit trips once; the rest of the page is marked, not retried."""
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("many"),
                work_unit_slug=_slug("wu-many"),
            )

        async def _coord_down(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=504, detail="timeout waiting for coord")

        fake = AsyncMock(side_effect=_coord_down)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        assert resp.json()["coord_available"] is False
        assert fake.await_count < 4, (
            "every row paid its own coord timeout — the circuit did not trip"
        )

    async def test_the_circuit_is_observed_by_tasks_already_queued_on_the_gate(
        self,
    ) -> None:
        """Fail-fast has to be checked INSIDE the semaphore, not before it.

        With the check outside, every task in a ``gather`` passes it during the
        synchronous prelude — before any of them has awaited coord even once —
        so tasks beyond the concurrency limit are already committed by the time
        the first failure trips the circuit. They then each pay their own
        timeout, and the trip shortens nothing: a hung coord with 100 linked
        slugs costs ceil(100/6) × 5s ≈ 85s for one request, holding the
        request-scoped session and six httpx connections throughout, against
        the 5s the class docstring promises.

        This test drives ``_CoordProbe`` directly because that is where the
        ordering lives; the HTTP-level test above cannot distinguish 6 awaits
        from 24 when the page only has 4 rows.
        """
        slug_count = _COORD_FANOUT * 4

        async def _coord_down(path: str, **_: Any) -> Any:
            # Yield first, so the failure lands only after every task has had a
            # chance to run its prelude — the exact interleaving the bug needs.
            await asyncio.sleep(0)
            raise HTTPException(status_code=504, detail="timeout waiting for coord")

        fake = AsyncMock(side_effect=_coord_down)
        probe = _CoordProbe(None, actor_kind="operator")
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            links = await _coord_links(
                [_slug(f"gate-{i}") for i in range(slug_count)], probe
            )

        assert probe.degraded is True
        assert len(links) == slug_count
        assert all(link.work_unit_state == "unavailable" for link in links.values())
        assert fake.await_count <= _COORD_FANOUT, (
            f"{fake.await_count} coord calls for {slug_count} slugs — the "
            f"tasks queued on the semaphore did not see the trip, so the "
            f"circuit cannot short-circuit anything (expected at most "
            f"{_COORD_FANOUT}, the tasks already in flight when it tripped)"
        )

    @pytest.mark.parametrize(
        ("cite_status", "why"),
        [
            # Coord registers `post` + `delete` on the citations path, so a GET
            # is a method mismatch once the caller clears the auth layer.
            (405, "method not allowed"),
            # ...and the path sits behind `require_jwt`, so a forwarded Cognito
            # bearer is rejected by the layer BEFORE the method is considered.
            (401, "unauthorized"),
            # Kept for the hypothetical coord that simply has no such path.
            (404, "not found"),
        ],
    )
    async def test_citations_route_absent_reads_as_unavailable(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        cite_status: int,
        why: str,
    ) -> None:
        """A coord without the citation read route is UNKNOWN, not 'no PRs'.

        And — the half this test used to miss — it is not a coord OUTAGE
        either. The circuit must stay closed, because a per-route 4xx is coord
        answering about that route. Modelling only 404 hid a bug where every
        other status tripped the circuit: since a GET on the real citations
        path can never actually 404 (it 401/403s at the `require_jwt` layer or
        405s on the method), `coord_available` was false on every single
        request that carried one linked candidate, which is precisely the
        flag's one job made impossible.
        """
        wu = _slug("wu-nocite")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("nocite"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(status_code=cite_status, detail=why)
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        body = resp.json()
        assert body["coord_available"] is True, (
            f"a {cite_status} on ONE route tripped the page-wide circuit — "
            "coord answered, so `coord_available` must stay true or the flag "
            "can never report a genuine outage"
        )
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        assert row["coord"]["work_unit_state"] == "linked"
        assert row["coord"]["linked_prs_state"] == "unavailable"
        assert row["coord"]["linked_prs"] == []

    @pytest.mark.parametrize("http_status", [500, 502, 503, 504])
    async def test_only_transport_class_failures_trip_the_circuit(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        http_status: int,
    ) -> None:
        """The other half: 5xx IS coord being unreachable/broken, so it trips."""
        wu = _slug("wu-5xx")
        await _plan(
            async_db_session, org_id=None, slug=_slug("boom"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=http_status, detail="boom")

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        assert resp.json()["coord_available"] is False

    async def test_a_403_on_the_work_unit_read_does_not_trip_the_circuit(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Per-row UNKNOWN without claiming coord is down.

        The row is honestly ``unavailable`` (the read established nothing),
        but the credential being refused for one route is not evidence about
        coord's reachability, so the page-level flag stays true.
        """
        wu = _slug("wu-403")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("forbidden"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=403, detail="forbidden")

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        body = resp.json()
        assert body["coord_available"] is True
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        assert row["coord"]["work_unit_state"] == "unavailable"
        assert row["coord"]["linked_prs_state"] == "unavailable"
        assert row["coord"]["unavailable_reason"]

    async def test_include_coord_false_skips_coord_entirely(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("local-only"),
            work_unit_slug=_slug("wu-skip"),
        )
        fake = AsyncMock(return_value={})
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(
                CANDIDATES, params={"limit": 100, "include_coord": "false"}
            )
        assert resp.status_code == 200
        assert fake.await_count == 0
        row = resp.json()["items"][0]
        # Not fetched is still UNKNOWN — never rendered as "no PRs".
        assert row["coord"]["linked_prs_state"] == "unavailable"

    async def test_prompt_chain_over_http(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        authoring = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("http-authoring"),
            kind="plan_authoring_prompt",
        )
        plan = await _plan(async_db_session, org_id=None, slug=_slug("http-plan"))
        await crud.create_edge(
            async_db_session,
            from_artifact=authoring,
            to_artifact=plan,
            relation="authored_plan",
            note=None,
            created_by="test",
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(return_value={}),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        assert row["prompt_chain"] == [
            {
                "id": str(authoring.id),
                "kind": "plan_authoring_prompt",
                "slug": authoring.slug,
                "title": authoring.title,
                "relation": "authored_plan",
                "depth": 1,
            }
        ]

    async def test_no_criticality_score_is_emitted(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """D6: the read exposes signals; the AGENT ranks.

        Scans every key in the serialized payload, at every depth, for
        anything shaped like a ranking verdict. A hardcoded score would be a
        guess frozen into SQL — this is the test that keeps one from landing.
        """
        await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("scoreless"),
            work_unit_slug=_slug("wu-score"),
        )
        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_ok({"slug": "x", "status": "vetted"}, []),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        payload = resp.json()
        assert payload["items"], "the assertion below is vacuous on an empty page"

        offenders: list[str] = []

        def _walk(node: Any, path: str) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if _SCORE_SHAPED.search(key):
                        offenders.append(f"{path}.{key}")
                    _walk(value, f"{path}.{key}")
            elif isinstance(node, list):
                for idx, value in enumerate(node):
                    _walk(value, f"{path}[{idx}]")

        _walk(payload, "$")
        assert not offenders, (
            "candidates emitted a ranking-shaped field: "
            + ", ".join(offenders)
            + " — design decision D6 says the read exposes the INPUTS and the "
            "agent ranks."
        )

        # And the OpenAPI schema does not declare one either, so it cannot be
        # emitted only when populated.
        from app.schemas.plan_library import PlanCandidateResponse

        schema = json.dumps(PlanCandidateResponse.model_json_schema())
        for field in ("criticality", "priority_score", "urgency"):
            assert field not in schema

    async def test_paging_is_reported(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        for _ in range(3):
            await _plan(async_db_session, org_id=None, slug=_slug("paged"))
        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(return_value={}),
        ):
            resp = await client.get(CANDIDATES, params={"offset": 1, "limit": 1})
        body = resp.json()
        assert body["offset"] == 1
        assert body["limit"] == 1
        assert len(body["items"]) == 1
        assert body["total"] >= 3


# ===========================================================================
# Layer 3 — WHICH coord door the reads go to (the principal decides)
# ===========================================================================
#
# Plan ``2026-08-16-coord-work-unit-citation-http-read`` D1. Coord has two door
# tiers over the same rows and each rejects the other's credential: the
# ``/coord/work-units/...`` reads resolve their tenant from a Cognito
# ``OperatorContext`` (403 ``tenant_not_resolved`` for a device JWT), and the
# ``/coord/agent-work-units/...`` twins lift it from a verified device JWT (and
# reject a Cognito bearer). ``/candidates`` forwards the CALLER'S bearer
# verbatim, and its callers are both principals — the operator page holds a
# Cognito token, ``mcp/plan_library.rs`` holds the runner's device JWT. Sending
# both to one tier is why a runner-originated read reported ``unavailable`` on
# every linked row.
#
# What is asserted below is the PATH, not just the outcome: an assertion that
# only checked ``linked_prs_state`` would pass just as well against a probe
# that asked the wrong door and got lucky with a mock.

DEVICE_BEARER = "a-coord-issued-device-jwt"


def _build_device_app(*, db_session: AsyncSession):
    """Mount the router with NO Cognito user — only a device bearer resolves.

    ``current_active_user_optional`` is pinned to ``None`` rather than left
    live: the point of these tests is which ARM of the dual-auth dependency
    answers, so the Cognito arm's verdict has to be the test's input.
    """
    from app.api.deps import current_active_user_optional, get_async_db
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    app = FastAPI()
    app.dependency_overrides[current_active_user_optional] = lambda: None

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(plan_library_router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def device_client(async_db_session: AsyncSession, api_user, monkeypatch):
    """A client holding ONLY the runner's device bearer.

    ``deps._verify_device_jwt`` is stubbed — coord's JWKS is not under test
    here, the door choice is. Any OTHER token raises the same 401 the real
    verifier raises, so a test that authenticated on a token it did not mean to
    present fails loudly instead of passing for the wrong reason.
    """
    from app.api import deps

    async def _fake_verify(token: str):
        if token != DEVICE_BEARER:
            raise HTTPException(status_code=401, detail="Invalid device token.")
        return ({"device_id": str(uuid4()), "user_id": str(api_user.id)}, api_user)

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)

    app = _build_device_app(db_session=async_db_session)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {DEVICE_BEARER}"},
    ) as http_client:
        yield http_client


class TestCoordDoorTierFollowsThePrincipal:
    async def test_an_operator_principal_reads_the_operator_doors(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A Cognito caller must NOT be routed to the agent doors.

        The agent tier rejects a Cognito bearer, so getting this backwards
        breaks the operator page in exactly the way the device caller is broken
        today — which is why the path itself is asserted, in both directions.

        The two hops here are the FALLBACK sequence: ``_coord_ok`` models a
        coord that ignores ``?with_citations=1`` (as every coord does until
        the opt-in arm ships), so its operator by-slug body carries no
        ``citations`` key and the sub-resource hop genuinely runs. Its agent
        twin always carries one, so the device path short-circuits and a
        two-hop assertion there would describe a coord that does not exist.
        What the fallback GUARANTEES — that this page keeps working against
        such a coord — is asserted head-on in
        :class:`TestOperatorPresenceHopAsksForTheCitationsInline`.
        """
        wu = _slug("wu-op")
        await _plan(async_db_session, org_id=None, slug=_slug("op"), work_unit_slug=wu)

        fake = _coord_ok({"slug": wu, "status": "vetted"}, [])
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        called = [c.args[0] for c in fake.await_args_list]
        assert called == [
            f"/coord/work-units/{wu}",
            f"/coord/work-units/{wu}/citations",
        ], "the operator path is where two hops genuinely happen"
        assert fake.await_count == 2
        assert not any("agent-work-units" in path for path in called)

    async def test_a_device_principal_reads_the_agent_doors(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The strand this plan exists to cut.

        The runner forwards its coord DEVICE JWT, which coord's operator tier
        403s. The BASE PATH is what this test discriminates, and it is the half
        that matters: routing the by-slug read to the operator tier leaves
        every row reading ``work_unit_state: "unavailable"`` — the same bug one
        level up — while routing it to the agent tier resolves the unit AND its
        citations in one hop.

        Only ONE call is expected, and that is coord's own shape rather than an
        optimisation this test tolerates: the agent by-slug door ALWAYS embeds
        ``citations``, so the sub-resource hop is unreachable on this path. The
        two-hop sequence is asserted on the operator path above, where the
        by-slug body carries no ``citations`` key and both hops really run.
        """
        wu = _slug("wu-dev")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("dev"), work_unit_slug=wu
        )

        fake = _coord_ok(
            {"slug": wu, "status": "in_progress", "title": "The unit"},
            [
                {
                    "repo": "qontinui-web",
                    "pr_number": 994,
                    "merged": True,
                    "branch": "feat/x",
                    "cited_at": "2026-08-01T00:00:00+00:00",
                    "sources": ["manual_backfill"],
                }
            ],
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        called = [c.args[0] for c in fake.await_args_list]
        assert called == [f"/coord/agent-work-units/{wu}"], (
            "the device path must read the AGENT by-slug door — and only it: "
            "that door embeds the citations, so a second hop is a shape coord "
            "never produces"
        )
        assert not any(path.startswith("/coord/work-units") for path in called)

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked"
        assert link["work_unit_title"] == "The unit"
        assert link["linked_prs_state"] == "available"
        assert [
            (p["repo"], p["pr_number"], p["state"]) for p in link["linked_prs"]
        ] == [("qontinui-web", 994, "merged")]

    async def test_both_agent_hops_are_routed_when_a_coord_omits_the_inline_key(
        self,
    ) -> None:
        """Restores the guard the single-hop assertion above cannot carry.

        ``_coord_base`` is applied to BOTH hops on purpose, and the test above
        can no longer prove the citations half of that: against current coord
        the device path makes one call, so pinning the citations hop to the
        OPERATOR door is invisible to it.

        The hop is not dead code, though — :meth:`_CoordProbe.link_for`
        documents the inline read as an opportunistic short-circuit and not a
        contract, precisely so this read works against a coord that has not yet
        shipped the inline key (the same older-coord compatibility
        ``test_citations_route_absent_reads_as_unavailable`` assumes). This
        drives ``_CoordProbe`` directly with exactly that payload — no
        ``citations``, no ``citations_error`` — so the second hop really runs,
        and asserts BOTH hops stay on the agent tier. It claims nothing about
        what CURRENT coord emits: the fixture is labelled as the older shape,
        and the shape current coord emits is asserted in the test above.
        """
        slug = _slug("wu-both-hops")

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                return {"citations": []}
            # An older coord's agent by-slug body: no inline citation key at
            # all, so `_inline_citations` returns None and hop 2 is required.
            return {"work_unit": {"slug": slug, "status": "vetted"}}

        fake = AsyncMock(side_effect=_fake)
        probe = _CoordProbe(None, actor_kind="device")
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            link = await probe.link_for(slug)

        called = [c.args[0] for c in fake.await_args_list]
        assert called == [
            f"/coord/agent-work-units/{slug}",
            f"/coord/agent-work-units/{slug}/citations",
        ], "a device caller's SECOND hop left the agent tier — coord 403s it"
        assert link.linked_prs_state == "available"

    async def test_the_detail_read_routes_by_principal_too(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``GET /{id}`` builds its own probe — it needs the same routing."""
        wu = _slug("wu-detail")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("detail"), work_unit_slug=wu
        )

        fake = _coord_ok({"slug": wu, "status": "vetted"}, [])
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await device_client.get(f"{API_PREFIX}/{plan.id}")

        assert resp.status_code == 200, resp.text
        called = [c.args[0] for c in fake.await_args_list]
        assert all(path.startswith("/coord/agent-work-units/") for path in called), (
            called
        )
        assert resp.json()["coord"]["linked_prs_state"] == "available"

    async def test_inline_citations_on_the_agent_door_skip_the_second_hop(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """coord's agent by-slug read already carries its citations.

        Its operator twin deliberately does not (the dashboard payload stays
        lean), so this is an opportunistic saving, not a contract: one
        round-trip per slug instead of two, and it works against a coord that
        has not yet shipped the dedicated sub-resource.
        """
        wu = _slug("wu-inline")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("inline"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            assert not path.endswith("/citations"), f"the second hop ran anyway: {path}"
            return {
                "work_unit": {"slug": wu, "status": "shipped"},
                "recent_history": [],
                "citations": [
                    {
                        "repo": "qontinui-runner",
                        "pr_number": 1044,
                        "merged": True,
                        "branch": "feat/y",
                        "cited_at": "2026-08-02T00:00:00+00:00",
                        "sources": ["manual_backfill"],
                    }
                ],
                "delivery": {"shipped": True, "evidence_complete": True},
            }

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert fake.await_count == 1, "the inline citations were not used"
        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "available"
        assert [p["pr_number"] for p in link["linked_prs"]] == [1044]

    async def test_an_inline_citations_error_is_unavailable_not_empty(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``citations_error`` beside an EMPTY list is UNKNOWN, never zero.

        coord emits exactly that shape during the pre-migration window, and
        reading the empty list as "this plan has no PRs" is the single collapse
        the whole honest-degradation posture exists to prevent.
        """
        wu = _slug("wu-inline-err")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("inline-err"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            return {
                "work_unit": {"slug": wu, "status": "vetted"},
                "recent_history": [],
                "citations": [],
                "citations_error": {
                    "error": "citation_surface_unavailable",
                    "pg_code": "42P01",
                    "message": "citation surface unavailable: a relation backing "
                    "the citation join is absent.",
                },
            }

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        body = resp.json()
        assert body["coord_available"] is True, (
            "coord ANSWERED — a typed citation error is not an outage"
        )
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked"
        assert link["linked_prs_state"] == "unavailable"
        assert link["linked_prs"] == []
        assert "citation_surface_unavailable" in link["unavailable_reason"]

    async def test_a_successful_empty_citation_list_is_available_and_empty(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The other side of the same coin: a read that SUCCEEDED and found
        nothing is an observation, and must be reported as one.

        Deliberately the OPERATOR client: this is the SUB-RESOURCE's empty
        list, and only the operator path reaches it. On the device path the
        same assertion would be about the inline empty list instead — a
        different code path, already covered by
        ``test_the_detail_read_routes_by_principal_too``.
        """
        wu = _slug("wu-empty")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("empty"), work_unit_slug=wu
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_ok({"slug": wu, "status": "vetted"}, []),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "available"
        assert link["linked_prs"] == []
        assert link["unavailable_reason"] is None


# ===========================================================================
# Layer 4 — the operator presence hop asks for the citations INLINE
# ===========================================================================
#
# Plan ``2026-08-20-coord-work-unit-read-door-inline-citations-and-safe-error-bodies``
# D1/D4, Phase 3. coord's operator by-slug door takes ``?with_citations=1`` and
# embeds the citations it otherwise omits, so an operator page collapses from
# 2N coord round-trips to N — up to 100 candidates a page.
#
# Two properties are pinned below, and the SECOND is the load-bearing one:
#
# 1. Against a coord that HONOURS the parameter, one hop per slug.
# 2. Against a coord that IGNORES it — every coord, until the arm ships —
#    the sub-resource fallback still resolves the citations and still reports
#    ``available``. The parameter is an optimisation, never a contract, and
#    this service is deliberately shipping AHEAD of coord's half.


def _coord_honouring_with_citations(
    work_unit: dict[str, Any],
    citations: list[dict[str, Any]],
    *,
    citations_error: dict[str, Any] | None = None,
):
    """A coord that HAS the opt-in arm: ``?with_citations=1`` inlines them.

    Both doors are modelled the way coord answers them once Phase 1 lands: the
    agent by-slug body always embeds ``citations``, and the operator twin does
    so exactly when the query parameter asked. The sub-resource is still
    served — it must be, or these tests would discriminate on an exception
    rather than on the call sequence, and "one hop" would be indistinguishable
    from "the second hop blew up".

    ``citations_error`` swaps the payload for coord's ``Err`` arm: an EMPTY
    list beside the typed error, which is the shape D4's regression test pins.
    """

    async def _fake(
        path: str, *, params: dict[str, str] | None = None, **_: Any
    ) -> Any:
        if path.endswith("/citations"):
            return {"citations": citations}
        body: dict[str, Any] = {"work_unit": work_unit, "recent_history": []}
        asked = (params or {}).get("with_citations") == "1"
        if path.startswith("/coord/agent-work-units/") or asked:
            if citations_error is not None:
                body["citations"] = []
                body["citations_error"] = citations_error
            else:
                body["citations"] = citations
        return body

    return AsyncMock(side_effect=_fake)


_A_CITATION = {
    "repo": "qontinui-coord",
    "pr_number": 1559,
    "merged": False,
    "branch": "feat/safe-body",
    "cited_at": "2026-08-16T00:00:00+00:00",
    "sources": ["manual_backfill"],
}


class TestOperatorPresenceHopAsksForTheCitationsInline:
    async def test_an_operator_page_makes_ONE_coord_call_per_slug(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Gate (a). The whole point of the phase, asserted as a SEQUENCE.

        A bare call COUNT would also pass for a page that made one hop to the
        wrong door, or one hop with no parameter against a stub that inlined
        unconditionally. What is pinned is the path AND the query parameter
        that rode with it — the parameter is the entire mechanism, so a change
        that dropped it while keeping the count would be the regression this
        test exists to catch.
        """
        wu = _slug("wu-one-hop")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("one-hop"), work_unit_slug=wu
        )

        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted", "title": "The unit"}, [_A_CITATION]
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert [(c.args[0], c.kwargs.get("params")) for c in fake.await_args_list] == [
            (f"/coord/work-units/{wu}", {"with_citations": "1"})
        ], (
            "the operator presence hop must carry ?with_citations=1 and be the "
            "ONLY coord call for this slug"
        )

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked"
        assert link["linked_prs_state"] == "available"
        assert [p["pr_number"] for p in link["linked_prs"]] == [1559]

    async def test_the_device_presence_hop_does_NOT_carry_the_parameter(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The device request stays byte-identical to what it sends today.

        coord's agent by-slug door passes ``with_citations = true``
        unconditionally, so the parameter buys nothing there — and a probe
        that sent it everywhere would make the operator-only opt-in look like
        a global default, which is precisely what D1 declined to make it.
        """
        wu = _slug("wu-dev-noparam")
        await _plan(
            async_db_session, org_id=None, slug=_slug("dev-noparam"), work_unit_slug=wu
        )

        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted"}, [_A_CITATION]
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert [(c.args[0], c.kwargs.get("params")) for c in fake.await_args_list] == [
            (f"/coord/agent-work-units/{wu}", None)
        ]

    async def test_a_coord_that_IGNORES_the_parameter_still_reports_available(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Gate (b) — the fallback EXERCISED, not merely asserted to exist.

        This is the coord that is actually deployed while this change ships:
        coord's half of the plan (Phases 1–2) is unlanded, so the operator
        by-slug door drops the unknown query key on the floor and answers its
        ordinary lean body. That body carries no ``citations`` key,
        ``_inline_citations`` returns ``None``, and hop 2 runs — which is the
        EXACT test that makes either deploy order safe.

        The stub asserts it RECEIVED the parameter before ignoring it, so this
        test cannot quietly degrade into "the probe never sent one".

        The failure this guards against is not a crash. It is a page that
        reports ``linked_prs: []`` — an assertion of zero PRs — for every
        candidate, everywhere, until coord catches up.
        """
        wu = _slug("wu-ignored-param")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("ignored-param"),
            work_unit_slug=wu,
        )
        seen: list[dict[str, str] | None] = []

        async def _coord_without_the_arm(
            path: str, *, params: dict[str, str] | None = None, **_: Any
        ) -> Any:
            seen.append(params)
            if path.endswith("/citations"):
                return {"citations": [_A_CITATION]}
            # Today's coord: the query key is unknown to the handler, so the
            # body is byte-identical to one requested without it. No
            # ``citations``, no ``citations_error`` — nothing to short-circuit
            # on.
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        fake = AsyncMock(side_effect=_coord_without_the_arm)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert seen[0] == {"with_citations": "1"}, (
            "the stub must actually be ignoring the parameter this phase adds "
            "— otherwise it models nothing"
        )
        assert [c.args[0] for c in fake.await_args_list] == [
            f"/coord/work-units/{wu}",
            f"/coord/work-units/{wu}/citations",
        ], "the sub-resource fallback must still run against a coord without the arm"

        body = resp.json()
        assert body["coord_available"] is True
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked"
        assert link["linked_prs_state"] == "available"
        assert [p["pr_number"] for p in link["linked_prs"]] == [1559]
        assert link["unavailable_reason"] is None


class TestInlineCitationErrorIsNeverAnEmptyList:
    """D4's regression test — the honesty contract's enforcement, bought back.

    The sub-resource answers an unreadable citation relation with a typed
    ``503``: a STATUS CODE, which a caller cannot reach past by ignoring a
    field. The inline arm answers the same fault with ``200`` + ``citations:
    []`` + ``citations_error``: a FLAG ON A 200. Phase 3 moves the operator
    path onto the second, so what stops a page reporting "this plan has no
    PRs" during a ``42P01`` window is no longer a status line — it is
    ``_CoordProbe._inline_citations`` remembering to check ``citations_error``
    before it trusts the list beside it.

    That is a strictly weaker guarantee, and the plan takes it deliberately
    (scalability over robustness on the hop count) on condition that the debt
    is discharged HERE. Simplify ``_inline_citations`` to key on ``citations``
    alone and both tests below go red; without them, that edit renders every
    candidate ``available`` with an empty list and nothing notices.

    Both principals, because after Phase 3 both take the inline arm and the
    two coord doors build this body in different handlers.
    """

    _ERR = {
        "error": "citation_surface_unavailable",
        "pg_code": "42P01",
        "message": "citation surface unavailable: a relation backing the "
        "citation join is absent.",
    }

    async def test_the_OPERATOR_inline_arm_reports_unavailable_not_empty(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        wu = _slug("wu-op-inline-err")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("op-inline-err"),
            work_unit_slug=wu,
        )

        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted"}, [], citations_error=self._ERR
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        # ONE call: the verdict came off the flag on the 200, not off a status
        # code from a second hop. Pinning that is the point — it is the arm
        # whose enforcement weakened.
        assert [c.args[0] for c in fake.await_args_list] == [f"/coord/work-units/{wu}"]

        body = resp.json()
        assert body["coord_available"] is True, (
            "coord ANSWERED — a typed citation error is not an outage"
        )
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked"
        assert link["linked_prs_state"] == "unavailable", (
            "an EMPTY list beside citations_error is UNKNOWN, never zero"
        )
        assert link["linked_prs"] == []
        assert "citation_surface_unavailable" in link["unavailable_reason"]
        assert "42P01" in link["unavailable_reason"]

    async def test_the_DEVICE_inline_arm_reports_unavailable_not_empty(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        wu = _slug("wu-dev-inline-err")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("dev-inline-err"),
            work_unit_slug=wu,
        )

        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted"}, [], citations_error=self._ERR
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert [c.args[0] for c in fake.await_args_list] == [
            f"/coord/agent-work-units/{wu}"
        ]

        body = resp.json()
        assert body["coord_available"] is True
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked"
        assert link["linked_prs_state"] == "unavailable"
        assert link["linked_prs"] == []
        assert "citation_surface_unavailable" in link["unavailable_reason"]
        assert "42P01" in link["unavailable_reason"]


class TestCoordServiceUnavailableOnTheCitationRead:
    """coord's typed ``503 citation_surface_unavailable`` is coord ANSWERING
    about one sub-resource — the unit is yours and the citation relation is
    unreadable. It must land as a per-slug ``unavailable`` and must NOT trip
    the page-wide circuit: a schema-migration window would otherwise report the
    whole of coord as down and blank the work-unit half of every remaining row,
    which reads fine.

    Its ``500 db_error`` — a transient PG failure on THIS slug's citation
    SELECT, rendered by ``pg_error::to_body()`` — is the same class one status
    band down, and reads the same way. The device path already behaves so: the
    identical coord fault reaches an agent caller as ``200`` +
    ``citations_error``, so without the 500 arm one coord fault produced a
    per-slug degradation for a device caller and a blanked page for an
    operator.

    The carve-out is keyed on coord's error CODE in the body, not on which hop
    asked. The tempting argument — the citations hop runs only after the
    presence hop succeeded, so coord is provably up — does not survive the gap
    between two sequential requests: coord can go down between them (a deploy,
    an ECS rotation, an ALB target drain). The tests below pin both halves at
    both statuses: a typed 503/500 does not trip, an UNTYPED one on the same
    hop does, and a status/code pairing coord does not use fails closed.
    """

    async def test_a_503_on_the_citations_hop_is_per_slug_not_a_circuit_trip(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        wu = _slug("wu-503")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("surface"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=503,
                    detail=json.dumps(
                        {
                            "error": "citation_surface_unavailable",
                            "pg_code": "42P01",
                            "message": "citation surface unavailable: retry once "
                            "the alembic migration has applied.",
                        }
                    ),
                )
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is True, (
            "a typed 503 about ONE sub-resource tripped the page-wide circuit "
            "— coord answered, so the outage flag must stay true or it can "
            "never report a real outage"
        )
        row = next(i for i in body["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["work_unit_state"] == "linked", (
            "the presence hop succeeded; only the citation half is unknown"
        )
        assert link["linked_prs_state"] == "unavailable"
        assert link["linked_prs"] == []
        assert "503" in link["unavailable_reason"]

    async def test_a_503_on_the_PRESENCE_hop_still_trips_the_circuit(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The half the exception must NOT swallow.

        Nothing has answered yet at that point, so a 503 there is the ordinary
        "coord is unreachable" reading and the circuit has to trip — otherwise
        an LB with no healthy target would report ``coord_available: true``.
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("down"),
                work_unit_slug=_slug("wu-down-503"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=503, detail="no healthy upstream")

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        body = resp.json()
        assert body["coord_available"] is False
        assert fake.await_count < 4, "the circuit did not trip on a presence-hop 503"
        for row in body["items"]:
            if row["coord"]["work_unit_slug"]:
                assert row["coord"]["linked_prs_state"] == "unavailable"
                assert row["coord"]["linked_prs"] == []

    async def test_a_200_whose_body_reports_a_citation_error_is_unavailable(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The sub-resource may carry the honesty flag inside a 200 too.

        A body that says the read did not happen still means it did not happen,
        whatever the status line says.
        """
        wu = _slug("wu-200err")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("bodyerr"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                return {
                    "citations": [],
                    "citations_error": {"error": "db_error", "pg": "42P01"},
                }
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "unavailable"
        assert link["linked_prs"] == []
        assert "db_error" in link["unavailable_reason"]

    async def test_an_UNTYPED_503_on_the_citations_hop_still_trips(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The half that keeps the carve-out narrow.

        coord going down BETWEEN the two hops is a real window — the presence
        hop succeeding is evidence coord was up then, not now. A load balancer
        with no healthy target answers 503 with no coord error code in it, and
        that must still read as an outage: otherwise ``coord_available`` would
        report true straight through a total outage, which is the one thing
        that flag exists to say.
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("mid-outage"),
                work_unit_slug=_slug("wu-mid-outage"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=503,
                    detail="<html><body>503 Service Unavailable</body></html>",
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        body = resp.json()
        assert body["coord_available"] is False, (
            "an untyped 503 — the shape a load balancer with no healthy target "
            "returns — was read as coord ANSWERING, so a total outage would "
            "report coord_available: true"
        )

    async def test_a_typed_500_on_the_citations_hop_is_per_slug_not_a_trip(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """coord's ``500 db_error`` on ONE slug's citation SELECT.

        A transient PG failure on the citation read is coord ANSWERING about
        one sub-resource, exactly as its 503 is — one status band down and one
        error code over. Read as a transport failure it trips the page-wide
        circuit, and every REMAINING row's ``work_unit_state`` collapses to
        ``unavailable`` even though its own presence hop had already succeeded,
        with the first row's reason repeated stickily across the page.

        It is also the parity half: the SAME coord fault reaches a DEVICE
        caller as ``200`` + ``citations_error``, i.e. already per-slug. Two
        principals must not get materially different pages out of one fault.
        """
        plans = [
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("pg-per-slug"),
                work_unit_slug=_slug("wu-pg-per-slug"),
            )
            for _ in range(4)
        ]

        # coord's ``pg_error::to_body()`` with structured detail (``error`` +
        # ``context`` + ``pg``), plus a ``chain`` key it does not emit — extra
        # fields only make the leak assertion below stricter, and this mirrors
        # the ``PG_ERROR_BODY`` fixture in ``TestCoordErrorBodiesDoNotEgress``.
        pg_body = {
            "error": "db_error",
            "context": "listing citations for work unit",
            "chain": "query failed: connection pool: relation lookup",
            "pg": {
                "code": "23503",
                "detail": "Key (tenant_id)=(9f1c2d3e-0000-4444-8888-abcdefabcdef) "
                "is not present in table tenants.",
                "constraint": "work_unit_citations_tenant_id_fkey",
                "table": "work_unit_citations",
            },
        }

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(status_code=500, detail=json.dumps(pg_body))
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is True, (
            "a typed 500 about ONE slug's citation SELECT tripped the "
            "page-wide circuit — coord answered, and its presence hop had just "
            "served a query for this same request"
        )
        assert fake.await_count == 2 * len(plans), (
            "the circuit short-circuited the remaining slugs, so rows whose "
            "own presence hop would have succeeded were never read"
        )
        by_id = {r["id"]: r for r in body["items"]}
        for plan in plans:
            link = by_id[str(plan.id)]["coord"]
            assert link["work_unit_state"] == "linked", (
                "the presence hop succeeded; only the citation half is unknown"
            )
            assert link["linked_prs_state"] == "unavailable"
            assert link["linked_prs"] == []
            reason = link["unavailable_reason"]
            assert "500" in reason
            assert "db_error" in reason
            assert "23503" in reason
            for leaked in (
                "9f1c2d3e",
                "tenant_id",
                "work_unit_citations",
                "connection pool",
                "listing citations",
            ):
                assert leaked not in reason, f"coord internals egressed: {leaked!r}"

    async def test_an_UNTYPED_500_on_the_citations_hop_still_trips(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The half that keeps the 500 carve-out as narrow as the 503's.

        Nothing between this service and coord can produce coord's declared
        error field: a load balancer answers HTML, a proxy answers a plain-text
        line, and ``_proxy_coord_get``'s own transport mapping raises a bare
        string. None parse to an object with an ``error`` field, so none match
        — and a 500 from one of them is an outage, not an answer.
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("untyped-500"),
                work_unit_slug=_slug("wu-untyped-500"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=500,
                    detail="<html><body>500 Internal Server Error</body></html>",
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        assert resp.json()["coord_available"] is False, (
            "an untyped 500 was read as coord ANSWERING, so an infrastructure "
            "failure between the two hops would report coord_available: true"
        )

    async def test_an_unexpected_status_code_pairing_fails_CLOSED(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The carve-out pins each coord error code to the status coord uses.

        coord answers ``citation_surface_unavailable`` with 503 and
        ``db_error`` with 500. A pairing this read has not observed is not
        granted the carve-out — it keeps the ordinary transport reading, which
        is the conservative direction: an unexpected pairing degrades to
        today's behaviour rather than silently widening what counts as "coord
        answered".
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("pairing"),
                work_unit_slug=_slug("wu-pairing"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=500,
                    detail=json.dumps(
                        {"error": "citation_surface_unavailable", "pg_code": "42P01"}
                    ),
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        assert resp.json()["coord_available"] is False

    async def test_the_reason_carries_coords_own_words(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``unavailable_reason`` is the only breadcrumb this read leaves.

        A bare "coord returned 503" cannot tell an operator whether to wait for
        a migration or to page someone, and the body that answers it is already
        in hand.
        """
        wu = _slug("wu-reason")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("reason"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=503,
                    detail=json.dumps(
                        {
                            "error": "citation_surface_unavailable",
                            "message": "retry once the alembic migration has applied.",
                        }
                    ),
                )
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        reason = row["coord"]["unavailable_reason"]
        assert "503" in reason
        assert "citation_surface_unavailable" in reason


class TestUnknownIsNotAnObservation:
    """The same discipline one level down — on a single citation row.

    ``linked_prs_state: "available"`` says the LIST is a real answer. It says
    nothing about whether each row's ``merged`` flag is one, and coord is
    explicit that sometimes it is not.
    """

    async def test_a_degraded_merged_predicate_reads_unknown_not_unmerged(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``merged_degraded_reason`` means ``merged: false`` is UNKNOWN.

        coord's degraded predicate drops the durable ``merge_commit_sha`` arm,
        so every PR it ff-landed reads ``merged: false`` — and coord ff-lands
        routinely. Rendering those as the fact "unmerged" would assert the
        opposite of what coord just said, which is the exact defect class this
        whole read is careful about, applied to a row instead of a list.
        """
        wu = _slug("wu-degraded")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("degraded"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                return {
                    "work_unit_id": str(uuid4()),
                    "citations": [
                        {"repo": "qontinui-web", "pr_number": 1, "merged": False},
                        {"repo": "qontinui-web", "pr_number": 2, "merged": True},
                    ],
                    "merged_degraded_reason": {
                        "error": "merged_predicate_degraded",
                        "missing_column": "merge_commit_sha",
                        "message": "a merged: false on these rows is UNKNOWN.",
                    },
                }
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        # The LIST is still a real answer — the caveat is per row.
        assert link["linked_prs_state"] == "available"
        by_number = {p["pr_number"]: p for p in link["linked_prs"]}
        assert by_number[1]["state"] == "unknown", (
            "a degraded `merged: false` was rendered as the fact 'unmerged'"
        )
        assert by_number[1]["merged"] is None
        # A `true` is unaffected: the degraded arm narrows the disjunction, so
        # it can only produce false NEGATIVES.
        assert by_number[2]["state"] == "merged"
        assert by_number[2]["merged"] is True

    async def test_without_the_flag_a_false_is_still_an_observation(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The guard must not swallow the normal case."""
        wu = _slug("wu-nodegrade")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("nodegrade"), work_unit_slug=wu
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_ok(
                {"slug": wu, "status": "vetted"},
                [{"repo": "qontinui-web", "pr_number": 7, "merged": False}],
            ),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        pr = row["coord"]["linked_prs"][0]
        assert pr["state"] == "unmerged"
        assert pr["merged"] is False

    async def test_a_citations_field_that_is_not_a_list_is_unavailable(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """An unrecognised shape is UNKNOWN, never an observation of zero.

        The inline fast path shape-sniffs by design, so the one thing it must
        never do with a shape it does not recognise is report it as "this plan
        has no PRs".
        """
        wu = _slug("wu-shape")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("shape"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            return {
                "work_unit": {"slug": wu, "status": "vetted"},
                "citations": {"unexpected": "envelope"},
            }

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "unavailable"
        assert link["linked_prs"] == []
        assert "shape" in link["unavailable_reason"]

    async def test_a_degraded_merged_predicate_on_the_INLINE_device_path(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The half that actually matters, and the half that was untested.

        A DEVICE caller short-circuits on the citations coord attaches to the
        by-slug payload and never makes the sub-resource hop — so a guard that
        only reads ``merged_degraded_reason`` off the sub-resource protects
        nobody on this path, and this is the higher-stakes consumer: an agent
        reading every ff-landed PR as "unmerged" during a degraded window is
        exactly the wrong answer for the caller most likely to act on it.

        coord emits the field on the by-slug response on the SAME terms as on
        the sub-resource — same name, same body, present only when degraded —
        so one predicate serves both.
        """
        wu = _slug("wu-inline-degraded")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("inline-degraded"),
            work_unit_slug=wu,
        )

        async def _fake(path: str, **_: Any) -> Any:
            assert not path.endswith("/citations"), f"the second hop ran: {path}"
            return {
                "work_unit": {"slug": wu, "status": "shipped"},
                "recent_history": [],
                "citations": [
                    {"repo": "qontinui-coord", "pr_number": 1554, "merged": False},
                    {"repo": "qontinui-web", "pr_number": 1021, "merged": True},
                ],
                "merged_degraded_reason": {
                    "error": "merged_predicate_degraded",
                    "missing_column": "merge_commit_sha",
                    "message": "a merged: false on these rows is UNKNOWN.",
                },
            }

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert fake.await_count == 1, "the inline citations were not used"
        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        # The LIST is still a real answer — the caveat is per row.
        assert link["linked_prs_state"] == "available"
        by_number = {p["pr_number"]: p for p in link["linked_prs"]}
        assert by_number[1554]["state"] == "unknown", (
            "a degraded `merged: false` reached a DEVICE caller as the fact "
            "'unmerged' — the inline path skipped the guard"
        )
        assert by_number[1554]["merged"] is None
        # A `true` is unaffected: the degraded arm narrows the disjunction, so
        # it can only produce false NEGATIVES.
        assert by_number[1021]["state"] == "merged"
        assert by_number[1021]["merged"] is True

    async def test_the_inline_path_without_the_flag_keeps_false_an_observation(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The guard must not swallow the normal case on the device path either.

        This is also the compatibility assertion for a coord that has not
        deployed the by-slug field yet: no field, no caveat, and a ``false``
        stays the observation it is today.
        """
        wu = _slug("wu-inline-plain")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("inline-plain"),
            work_unit_slug=wu,
        )

        async def _fake(path: str, **_: Any) -> Any:
            return {
                "work_unit": {"slug": wu, "status": "in_progress"},
                "recent_history": [],
                "citations": [
                    {"repo": "qontinui-coord", "pr_number": 1554, "merged": False}
                ],
            }

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        pr = row["coord"]["linked_prs"][0]
        assert pr["state"] == "unmerged"
        assert pr["merged"] is False


class TestCoordErrorBodiesDoNotEgress:
    """``unavailable_reason`` is a breadcrumb, not a pipe for coord's internals.

    The reason built from a coord error becomes ``_CoordProbe.reason`` on a
    circuit trip, and is then repeated on every remaining row of the page — so
    anything echoed there leaves this API stickily. coord's generic
    ``pg_error.to_body()`` carries the anyhow chain and structured Postgres
    fields, and ``pg.detail`` routinely names ROW VALUES, constraints and
    tables. Only the identifying fields may ride out.
    """

    #: A ``pg_error.to_body()``-shaped body: the parts that identify the
    #: failure, and the parts that must never leave this service.
    PG_ERROR_BODY = {
        "error": "db_error",
        "context": "listing citations for work unit",
        "chain": "query failed: connection pool: relation lookup",
        "pg": {
            "code": "23503",
            "message": "insert or update violates foreign key constraint",
            "detail": "Key (tenant_id)=(9f1c2d3e-0000-4444-8888-abcdefabcdef) "
            "is not present in table tenants.",
            "constraint": "work_unit_citations_tenant_id_fkey",
            "table": "work_unit_citations",
        },
    }

    async def test_a_pg_error_body_echoes_only_its_identifiers(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The whitelist, on a ``pg_error::to_body()`` 500.

        The fake fails EVERY path, so the 500 lands on the PRESENCE hop — the
        first read of the first slug, before anything of coord's has answered.
        That hop carries no ``answered_codes`` and never will: it is the
        unguarded canary that keeps a coord-wide fault tripping the circuit, so
        ``coord_available`` is false here for a reason that survives the
        per-slug carve-out on the citations hop. The citations hop's own typed
        500 does NOT trip, and is pinned in
        ``TestCoordServiceUnavailableOnTheCitationRead``.
        """
        await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("pgleak"),
            work_unit_slug=_slug("wu-pgleak"),
        )

        async def _fake(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=500, detail=json.dumps(self.PG_ERROR_BODY))

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is False, (
            "a 500 on the PRESENCE hop is still an outage — nothing of coord's "
            "has answered at that point, so there is no per-slug reading to "
            "prefer, and the citations-hop carve-out must not reach here"
        )
        reason = next(
            r["coord"]["unavailable_reason"]
            for r in body["items"]
            if r["coord"]["unavailable_reason"]
        )
        # Useful: the operator can tell a constraint violation from a missing
        # relation without opening coord's logs.
        assert "500" in reason
        assert "db_error" in reason
        assert "23503" in reason
        # Never: row values, constraint/table names, the anyhow chain, or the
        # free-text ``context``/``message`` — free text is exactly where
        # Postgres puts the parts that are not safe to forward.
        for leaked in (
            "9f1c2d3e",
            "tenant_id",
            "work_unit_citations",
            "connection pool",
            "foreign key constraint",
            "listing citations",
        ):
            assert leaked not in reason, f"coord internals egressed: {leaked!r}"

    async def test_a_top_level_pg_code_is_read_too(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """coord puts the SQLSTATE in two different places.

        The hand-rolled ``citation_surface_unavailable`` body carries
        ``pg_code`` at the top level; ``pg_error.to_body()`` nests it at
        ``pg.code``. Reading only one would drop the field that decides between
        "wait for the migration" and "page someone".
        """
        wu = _slug("wu-topcode")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("topcode"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=503,
                    detail=json.dumps(
                        {
                            "error": "citation_surface_unavailable",
                            "pg_code": "42P01",
                            "message": "retry once the alembic migration applied.",
                        }
                    ),
                )
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        reason = row["coord"]["unavailable_reason"]
        assert "citation_surface_unavailable" in reason
        assert "42P01" in reason
        assert "alembic" not in reason, (
            "coord's free-text `message` was forwarded — the whitelist is "
            "the structured identifiers only"
        )

    async def test_a_503_that_merely_QUOTES_the_marker_still_trips(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The carve-out matches coord's declared error, not any mention of it.

        A substring test over the raw body is satisfied by a body that only
        NAMES the code — coord's Postgres error text quoting the failing query,
        for instance. That is a genuine coord failure wearing the marker's
        words, and reading it as "coord answered" would leave
        ``coord_available`` true through it.
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("quoted"),
                work_unit_slug=_slug("wu-quoted"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=503,
                    detail=json.dumps(
                        {
                            "error": "db_error",
                            "pg": {
                                "code": "42601",
                                "message": "syntax error at or near "
                                "citation_surface_unavailable",
                            },
                        }
                    ),
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200
        assert resp.json()["coord_available"] is False, (
            "a 503 that merely QUOTED coord's marker was read as coord "
            "answering — the carve-out must match the declared `error` field"
        )

    async def test_an_unparseable_body_is_described_never_echoed(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The whitelist has no fallback that forwards free text.

        A body with no structured identifiers has nothing to lift, and capping
        it would not make it safe — whatever a body carries, it carries in its
        first characters. So it is described by its size, not excerpted. The
        status code beside it already says what an operator needs.
        """
        await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("alb"),
            work_unit_slug=_slug("wu-alb"),
        )

        blob = "<html><body>502 Bad Gateway - no healthy upstream. " + "x" * 500
        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=HTTPException(status_code=502, detail=blob)),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        body = resp.json()
        assert body["coord_available"] is False
        reason = next(
            r["coord"]["unavailable_reason"]
            for r in body["items"]
            if r["coord"]["unavailable_reason"]
        )
        assert "502" in reason
        assert "no healthy upstream" not in reason, "the raw body was echoed"
        assert "<html>" not in reason
        assert "bytes" in reason, "the size breadcrumb is gone too"

    async def test_a_DEGENERATE_inline_citations_error_body_is_still_whitelisted(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The same discipline on a DEGENERATE inline body: a bare ``{"pg": …}``.

        ``citations_error`` is coord's own error object embedded in a 200, so
        it never passes through the status-code branch — it is rendered by
        ``_citation_error_text``, which shape-PROBES rather than assuming.

        This body is deliberately one coord does not emit today:
        ``pg_error::to_body()`` ALWAYS writes ``error`` and ``context``
        alongside ``pg``, and that real shape is pinned by
        ``test_coords_REAL_to_body_shape_inline_echoes_only_its_identifiers``
        below. Keeping this one is the point — the probe exists to survive a
        body it does not recognise, and a partial object carrying no ``error``
        field is the only coverage of that half. Even here the SQLSTATE is
        lifted from ``pg.code`` and the free text around it is not.
        """
        wu = _slug("wu-inline-pg")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("inline-pg"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            return {
                "work_unit": {"slug": wu, "status": "vetted"},
                "citations": [],
                "citations_error": {
                    "pg": {
                        "code": "23503",
                        "detail": "Key (tenant_id)=(9f1c2d3e-0000-4444-8888-"
                        "abcdefabcdef) is not present in table tenants.",
                        "constraint": "work_unit_citations_tenant_id_fkey",
                        "table": "work_unit_citations",
                    }
                },
            }

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "unavailable"
        assert link["linked_prs"] == []
        reason = link["unavailable_reason"]
        assert "23503" in reason
        for leaked in ("9f1c2d3e", "work_unit_citations", "not present in table"):
            assert leaked not in reason, f"coord internals egressed: {leaked!r}"

    #: coord's ACTUAL inline error object, as ``pg_error::PgErrorContext::
    #: to_body()`` builds it: ``error`` and ``context`` are written on EVERY
    #: call, with the structured ``pg`` map beside them. The degenerate
    #: ``{"pg": …}`` above never reaches production; this shape does.
    #:
    #: coord PR #1559 narrows what coord's CITATION doors emit to
    #: ``{error, code}`` — but it is open, not landed, and it does not reach
    #: the inline ``citations_error`` on the by-slug door, which keeps this
    #: wide shape. So this read must stay safe against it on either coord
    #: version, which is why the narrowing does not retire this test.
    REAL_TO_BODY = {
        "error": "db_error",
        "context": "listing citations for work unit wu-real-tobody",
        "pg": {
            "code": "23503",
            "message": "insert or update on table work_unit_citations "
            "violates foreign key constraint",
            "detail": "Key (tenant_id)=(9f1c2d3e-0000-4444-8888-abcdefabcdef) "
            "is not present in table tenants.",
            "constraint": "work_unit_citations_tenant_id_fkey",
            "table": "work_unit_citations",
            "column": "tenant_id",
        },
    }

    async def test_coords_REAL_to_body_shape_inline_echoes_only_its_identifiers(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The whitelist against the body coord ACTUALLY emits inline.

        ``to_body()`` writes ``error`` AND ``context`` beside ``pg`` every
        time, so this — not the bare ``{"pg": …}`` above — is what a real
        citation failure puts on the device path. Both identifiers are found
        (``error`` at the top level, the SQLSTATE nested at ``pg.code``), and
        every free-text field around them stays inside this service: the
        ``context`` sentence, ``pg.message``, the ROW VALUE in ``pg.detail``,
        and the constraint/table/column names that describe coord's schema.
        """
        wu = _slug("wu-real-tobody")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("real-tobody"),
            work_unit_slug=wu,
        )

        async def _fake(path: str, **_: Any) -> Any:
            return {
                "work_unit": {"slug": wu, "status": "vetted"},
                "citations": [],
                "citations_error": self.REAL_TO_BODY,
            }

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "unavailable", (
            "`citations_error` beside an empty list is UNKNOWN, never zero"
        )
        assert link["linked_prs"] == []
        reason = link["unavailable_reason"]

        # The identifiers an operator acts on, from both places coord puts them.
        assert "db_error" in reason
        assert "23503" in reason

        # Never: the free-text context, the message, the ROW VALUE in `detail`,
        # or the constraint/table/column names that describe coord's schema.
        for leaked in (
            "listing citations",
            "9f1c2d3e",
            "not present in table",
            "work_unit_citations_tenant_id_fkey",
            "work_unit_citations",
            "violates foreign key constraint",
            "tenant_id",
        ):
            assert leaked not in reason, f"coord internals egressed: {leaked!r}"

    async def test_a_pathological_error_field_is_TRUNCATED(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The whitelist is a filter, not a length bound — so a cap is needed too.

        ``error`` is the field the whitelist admits unconditionally, and it is
        not a closed set of short codes: coord builds it as free text at many
        call sites (``json!({"error": format!("PG: {e}")})`` and friends), any
        of which can carry a whole Postgres chain. None sits on the two routes
        this read calls TODAY, so this is latent rather than live — but without
        the cap the whitelist's safety rests on a property of OTHER coord
        handlers that nothing on this side enforces.

        The reason is STICKY (``_CoordProbe._trip`` repeats it on every
        remaining row of the page), so an unbounded field is unbounded once per
        row. The status-code path caps at ``_REASON_MAX_CHARS`` exactly as the
        inline path already did.
        """
        await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("longerr"),
            work_unit_slug=_slug("wu-longerr"),
        )

        tail = "TAILSENTINELdb4f7a"
        long_error = "PG: " + ("relation lookup failed; " * 200) + tail
        assert len(long_error) > 2 * _REASON_MAX_CHARS

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(
                side_effect=HTTPException(
                    status_code=500, detail=json.dumps({"error": long_error})
                )
            ),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is False
        reason = next(
            r["coord"]["unavailable_reason"]
            for r in body["items"]
            if r["coord"]["unavailable_reason"]
        )
        prefix = "coord returned 500: "
        assert reason.startswith(prefix)
        excerpt = reason[len(prefix) :]
        assert len(excerpt) == _REASON_MAX_CHARS, (
            f"the whitelisted `error` field was not capped: {len(excerpt)} chars"
        )
        assert excerpt.endswith("…"), "truncation is not marked"
        assert tail not in reason, (
            "the tail of a multi-kilobyte `error` field egressed verbatim"
        )
