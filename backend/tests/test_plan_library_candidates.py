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


#: The bare list paths ``/candidates`` reads the candidate POPULATION from —
#: one per door tier. Filtered out of the per-slug call assertions below,
#: which are about the fan-out and predate the union.
_COORD_POPULATION_PATHS = ("/coord/work-units", "/coord/agent-work-units")


def _artifacts(rows: list[crud.PlanCandidateRow]) -> list[WorkArtifact]:
    """The artifact-backed half of a candidate page.

    ``list_plan_candidates`` returns :class:`~app.crud.work_artifact.
    PlanCandidateRow` since the population became the UNION of both corpus
    layers (plan
    ``2026-09-03-vet-imp-sweep-selects-from-the-sparse-document-layer``).
    Every row is artifact-backed in the CRUD tests below, which pass no work
    units and therefore exercise the degraded, document-layer-only arm.
    """
    return [row.artifact for row in rows if row.artifact is not None]


def _coord_slug_calls(fake: AsyncMock) -> list[str]:
    """Coord paths the page fetched PER SLUG — the population read removed.

    ``/candidates`` now opens with ONE read of coord's work-unit list (the
    union's other arm), which lands on the bare ``/coord/work-units`` /
    ``/coord/agent-work-units`` path. The assertions below are about the
    per-slug hops, so the population read is filtered out rather than counted
    into them.
    """
    return [
        call.args[0]
        for call in fake.await_args_list
        if call.args[0] not in _COORD_POPULATION_PATHS
    ]


def _coord_slug_calls_with_params(
    fake: AsyncMock,
) -> list[tuple[str, dict[str, str] | None]]:
    """:func:`_coord_slug_calls`, keeping each hop's query parameters."""
    return [
        (call.args[0], call.kwargs.get("params"))
        for call in fake.await_args_list
        if call.args[0] not in _COORD_POPULATION_PATHS
    ]


def _coord_slug_call_count(fake: AsyncMock) -> int:
    """How many PER-SLUG coord hops the page paid."""
    return len(_coord_slug_calls(fake))


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
        assert [r.id for r in _artifacts(rows)] == [live.id]

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
        assert _artifacts(rows)[0].status == "in-progress"

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
        assert [r.id for r in _artifacts(rows)] == [rid for _, rid in expected]

        # Same query again → same order. Nothing here is time- or
        # insertion-order dependent.
        again, _ = await crud.list_plan_candidates(async_db_session, org_id=org)
        assert [r.id for r in _artifacts(again)] == [r.id for r in _artifacts(rows)]

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
        ordered = _artifacts(rows)
        assert [r.id for r in ordered] == sorted(r.id for r in ordered)

        page1, total = await crud.list_plan_candidates(
            async_db_session, org_id=org, offset=0, limit=2
        )
        page2, _ = await crud.list_plan_candidates(
            async_db_session, org_id=org, offset=2, limit=2
        )
        assert total == 4
        assert [r.id for r in _artifacts(page1 + page2)] == [r.id for r in ordered]

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
        called = _coord_slug_calls(fake)
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
        coord that ignores ``?with_citations=true`` (as every coord does until
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
        called = _coord_slug_calls(fake)
        assert called == [
            f"/coord/work-units/{wu}",
            f"/coord/work-units/{wu}/citations",
        ], "the operator path is where two hops genuinely happen"
        assert _coord_slug_call_count(fake) == 2
        assert not any(path in _COORD_POPULATION_PATHS for path in called)

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
        called = _coord_slug_calls(fake)
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

        called = _coord_slug_calls(fake)
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
        called = _coord_slug_calls(fake)
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
        assert _coord_slug_call_count(fake) == 1, "the inline citations were not used"
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

        Deliberately the OPERATOR client against ``_coord_ok``, which models
        a coord WITHOUT the opt-in arm: that is the only way to reach the
        SUB-RESOURCE's empty list, since an operator page against a coord that
        has the arm short-circuits on the inline one. The inline arm's own
        successful-empty case is a different code path and is pinned
        separately —
        ``TestInlineCitationErrorIsNeverAnEmptyList.test_an_empty_list_with_NO_error_is_an_observation_of_zero``
        for the operator side, ``test_the_detail_read_routes_by_principal_too``
        for the device side.
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
# D1/D4, Phase 3. coord's operator by-slug door will take
# ``?with_citations=true`` and embed the citations it otherwise omits, so an
# operator page collapses from 2N coord round-trips to N — up to 100 candidates
# a page. ``true``, not ``1``: the value is truthy under BOTH of coord's query
# parse conventions, and only one of them accepts ``1`` (see
# ``_CoordProbe._presence_params``).
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
    """A coord that HAS the opt-in arm: ``?with_citations=true`` inlines them.

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
        asked = (params or {}).get("with_citations") == "true"
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
        assert _coord_slug_calls_with_params(fake) == [
            (f"/coord/work-units/{wu}", {"with_citations": "true"})
        ], (
            "the operator presence hop must carry ?with_citations=true and be "
            "the ONLY coord call for this slug"
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
        assert _coord_slug_calls_with_params(fake) == [
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
            if path not in _COORD_POPULATION_PATHS:
                # The population read opens every page now; ``seen`` is about
                # the PRESENCE hop's parameters.
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
        assert seen[0] == {"with_citations": "true"}, (
            "the stub must actually be ignoring the parameter this phase adds "
            "— otherwise it models nothing"
        )
        assert _coord_slug_calls(fake) == [
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
    is discharged HERE. Two edits to ``_inline_citations`` would each reinstate
    the collapse, and there is a test below for each: deleting the
    ``citations_error`` READ (caught by the two principal tests), and narrowing
    the DETECTION to ``citations`` alone (caught by
    ``test_an_inline_error_with_NO_citations_key_is_still_unavailable``, since
    the principal tests send a ``citations`` key and stay green under it). The
    fourth test guards the opposite dishonesty — a guard that answered
    ``unavailable`` for every empty list would pass all three.

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
        assert _coord_slug_calls(fake) == [f"/coord/work-units/{wu}"]

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

    async def test_an_inline_error_with_NO_citations_key_is_still_unavailable(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Pins the DETECTION clause, which the two tests above do not.

        They both send ``citations: []`` beside ``citations_error``, so
        narrowing ``_inline_citations``'s detection to ``citations`` alone
        leaves them green — the key is still there. This one omits the value
        key entirely, which is the shape coord's sibling ``delivery`` /
        ``delivery_error`` pair already uses and the one the detection's
        second clause exists for.

        Narrowed, this read returns ``None``, falls through to a second hop,
        and the sub-resource's successful answer OVERWRITES a known failure
        with an observation of zero — which is why the stub serves the
        sub-resource a non-empty list: the wrong reading is ``available`` with
        a PR in it, and it is visibly wrong rather than merely absent.
        """
        wu = _slug("wu-err-no-key")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("err-no-key"),
            work_unit_slug=wu,
        )

        async def _fake(
            path: str, *, params: dict[str, str] | None = None, **_: Any
        ) -> Any:
            if path.endswith("/citations"):
                return {"citations": [_A_CITATION]}
            return {
                "work_unit": {"slug": wu, "status": "vetted"},
                "recent_history": [],
                # No ``citations`` key at all — only the error.
                "citations_error": self._ERR,
            }

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert _coord_slug_calls(fake) == [f"/coord/work-units/{wu}"], (
            "a body declaring the read did not happen must not be re-asked"
        )

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "unavailable"
        assert link["linked_prs"] == []
        assert "citation_surface_unavailable" in link["unavailable_reason"]

    async def test_an_empty_list_with_NO_error_is_an_observation_of_zero(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The other half of the contract, on the arm this phase moved.

        A guard that answered ``unavailable`` for every empty list would
        satisfy every assertion above and be just as dishonest in the other
        direction: a work unit really can have no citations, and a read that
        SUCCEEDED and found none must say so. Pinned on the OPERATOR inline
        arm specifically — the sub-resource's version of this is
        ``test_a_successful_empty_citation_list_is_available_and_empty``, and
        after coord ships the opt-in arm an operator page no longer reaches
        that one.
        """
        wu = _slug("wu-op-inline-empty")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("op-inline-empty"),
            work_unit_slug=wu,
        )

        fake = _coord_honouring_with_citations({"slug": wu, "status": "vetted"}, [])
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert _coord_slug_calls(fake) == [f"/coord/work-units/{wu}"]

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        link = row["coord"]
        assert link["linked_prs_state"] == "available"
        assert link["linked_prs"] == []
        assert link["unavailable_reason"] is None

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

        # Deliberately kept alongside the older
        # ``test_an_inline_citations_error_is_unavailable_not_empty``, which
        # asserts the same verdict on the same principal. D4's debt is
        # discharged by ONE class covering BOTH principals, and splitting its
        # evidence across two places is how a future reader concludes the
        # operator half is the whole of it. What this adds: the single-hop
        # assertion (the verdict provably came off the inline arm) and the
        # SQLSTATE, which is what tells an operator to wait for a migration
        # rather than page someone.
        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted"}, [], citations_error=self._ERR
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await device_client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert _coord_slug_calls(fake) == [f"/coord/agent-work-units/{wu}"]

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
    SELECT, rendered by coord itself — is the same class one status band down,
    and reads the same way. coord has spelled that body two ways: the wide
    ``pg_error::to_body()``, and since the crate-wide sweep
    ``to_safe_body(SafeOp::WorkUnitCitationsRead)``. Both write
    ``error: "db_error"``, which is the only field the carve-out keys on, and
    the two tests below pin it against each shape — the narrow one because it
    is what coord answers TODAY, the wide one because "landed" is not
    "everywhere".

    The device path already behaves so: the identical coord fault reaches an
    agent caller as ``200`` + ``citations_error``, so without the 500 arm one
    coord fault produced a per-slug degradation for a device caller and a
    blanked page for an operator.

    The carve-out is keyed on coord's error CODE in the body, not on which hop
    asked. The tempting argument — the citations hop runs only after the
    presence hop succeeded, so coord is provably up — does not survive the gap
    between two sequential requests: coord can go down between them (a deploy,
    an ECS rotation, an ALB target drain). The tests below pin both halves at
    both statuses: a typed 503/500 does not trip, an UNTYPED one on the same
    hop does, and a status/code pairing coord does not use fails closed.

    **The error CODE is no longer sufficient on its own, and the tests say so
    at both ends.** coord's crate-wide sweep made ``db_error`` the code EVERY
    narrowed production door writes, so ``(500, db_error)`` on this hop stopped
    meaning "the citation read failed" and started meaning "a query inside
    coord failed" — ``tenant_scope.resolve`` and ``work_unit.list`` included,
    both fleet-wide faults that must trip. The same sweep shipped ``op``, which
    names the read; ``_CITATION_ANSWERING_OPS`` uses it to REFUSE the carve-out
    and never to grant it, so the two directions need separate coverage and get
    it: a FOREIGN op trips at either status, and a body with NO op — a coord
    predating the sweep, and the hand-rolled 503 on every coord — is carved out
    exactly as before. Reverting the refusal reds only the first pair;
    requiring the field reds only the second, plus the two pre-existing arms
    whose bodies carry no ``op`` at all.

    The foreign tokens are three, and the third is not redundant. Two name
    coord operations this module never asks for; ``work_unit.read`` is the one
    it DOES — on the unguarded presence hop, one line earlier, for this same
    slug — which makes it the token the set is most likely to be widened with
    and the one whose admission would do the most damage.
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

        # coord's WIDE ``pg_error::to_body()`` with structured detail (``error``
        # + ``context`` + ``pg``), plus a ``chain`` key it does not emit — extra
        # fields only make the leak assertion below stricter, and this mirrors
        # the ``PG_ERROR_BODY`` fixture in ``TestCoordErrorBodiesDoNotEgress``.
        #
        # This is the LEGACY shape: coord's sweep moved this door onto
        # ``to_safe_body``, so what a current coord answers here is the narrow
        # body pinned by the test immediately below. Kept, not replaced — the
        # whitelist has to stay safe against a coord predating the sweep, and
        # this is the only body on this hop that carries an anyhow chain and a
        # PG DETAIL line to be safe against.
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
        assert _coord_slug_call_count(fake) == 2 * len(plans), (
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

    async def test_a_typed_500_is_per_slug_on_coords_NARROW_body_TOO(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The same carve-out, against the body coord answers with TODAY.

        The test above drives the carve-out with the wide
        ``pg_error::to_body()``. coord's crate-wide sweep moved this exact door
        onto ``citation_read_failed`` → ``to_safe_body(WorkUnitCitationsRead)``,
        so every field of that fixture except one is gone from the wire: no
        ``context``, no ``chain``, no nested ``pg`` map. The survivor is
        ``error: "db_error"`` — and it is the ONLY field ``_CITATION_ANSWERED``
        keys on, which is why the carve-out came through the narrowing
        untouched.

        That is worth an executable pin rather than an argument. The pairing is
        a live safety property: keyed on a field coord no longer wrote, every
        pairing would miss, ``_is_transport_failure`` would call a per-slug PG
        fault an outage, and the page-wide circuit would blank the work-unit
        half of every remaining row — while a suite that only ever fed it the
        retired shape stayed green. This is not hypothetical for this body:
        the SQLSTATE moved under exactly this narrowing once already, to a key
        this side did not read, and was caught by inspection rather than by a
        test.

        It is also the third arm of the ``op`` read.
        ``TestCoordsOpTokenNamesWhichReadFailed`` pins the inline arm and the
        presence hop; this is the citations SUB-RESOURCE, which is neither —
        it is the only one of the three reached through ``answered``, so
        it is the only one where rendering the reason and granting the
        carve-out are the same code path.
        """
        plans = [
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("narrow-per-slug"),
                work_unit_slug=_slug("wu-narrow-per-slug"),
            )
            for _ in range(4)
        ]

        # coord's REAL output for this door: `to_safe_body` with every optional
        # schema identifier populated, i.e. the widest narrow body this side can
        # receive. `pg_constraint` / `pg_table` / `pg_column` are coord's to
        # emit and not this side's to forward.
        narrow_body = {
            "error": "db_error",
            "pg_code": "23503",
            "op": "work_unit.citations.read",
            "pg_constraint": "work_unit_citations_tenant_id_fkey",
            "pg_table": "work_unit_citations",
            "pg_column": "tenant_id",
        }

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(status_code=500, detail=json.dumps(narrow_body))
            # No `citations` key: this coord narrowed its error bodies but does
            # not inline citations on the operator door, so hop 2 still runs and
            # the carve-out is actually reached. (A coord carrying both arms
            # answers the failure inline instead — pinned by
            # ``test_the_inline_citations_error_names_the_op``.)
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is True, (
            "coord's narrow `db_error` was read as an outage — the carve-out "
            "keys on the one field the sweep did NOT change, and missing it "
            "blanks every remaining row over one slug's PG fault"
        )
        assert _coord_slug_call_count(fake) == 2 * len(plans), (
            "the circuit short-circuited the remaining slugs, so rows whose "
            "own presence hop would have succeeded were never read"
        )
        by_id = {r["id"]: r for r in body["items"]}
        for plan in plans:
            link = by_id[str(plan.id)]["coord"]
            assert link["work_unit_state"] == "linked"
            assert link["linked_prs_state"] == "unavailable"
            assert link["linked_prs"] == []
            # Whole-string, so this is a complete control and not a needle
            # hunt: `error`, `op` and the SQLSTATE cross in that order, and
            # NOTHING else does — the three schema identifiers coord was
            # willing to name are absent because they were never whitelisted.
            assert link["unavailable_reason"] == (
                "coord returned 500: db_error: work_unit.citations.read: 23503"
            ), link["unavailable_reason"]

    async def test_a_500_naming_a_DIFFERENT_coord_read_still_trips(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A typed body is not enough — it must be typed ABOUT THIS READ.

        The carve-out keys on ``error``, and coord's crate-wide sweep took away
        that field's ability to name a door: ``to_safe_body`` writes
        ``db_error`` as a literal, the same for every operation. So
        ``(500, db_error)`` on this hop no longer means "the citation SELECT
        failed" — it means "a query somewhere inside coord failed", and the
        bodies ``tenant_scope.resolve`` and ``work_unit.list`` answer with are
        indistinguishable from the one the exception was written for.

        Granting the carve-out to those is the failure the exception's own
        docstring warns about, inverted: a genuinely coord-wide fault answers a
        typed ``500 db_error`` on every guarded hop, nothing trips, and
        ``coord_available`` reports ``true`` through an outage while the page
        pays ``2N`` round-trips to discover it row by row.

        **Not reachable on coord's ``main`` today, and this test does not claim
        it is.** Both ``/citations`` tiers route their whole 500 path through one
        handler that names ``work_unit.citations.read``, and neither tier's
        tenant resolution can answer a 5xx at all — the operator tier 403s, and
        the agent tier's ``caller_tenant`` swallows even a Postgres fault on its
        ``coord.devices`` fallback into a 400 — so the token used here cannot
        arrive from that coord. This pins the classifier against the predicate it
        DOCUMENTS rather than against one deployment's route table, the same
        reading the surrounding suite already takes of coord's shapes, in both
        directions.

        The same sweep shipped the field that separates them. ``op`` names the
        operation, from a closed set, and this read already parsed it to RENDER
        it (``_coord_error_op``, #1046) — it just never let it decide anything.
        Here it does, in the refusing direction only: an ``op`` outside
        ``_CITATION_ANSWERING_OPS`` falls through to the ordinary 5xx reading.
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("foreign-op"),
                work_unit_slug=_slug("wu-foreign-op"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                # coord's `TenantScopeError::Db` arm, verbatim: the SAME
                # constructor and the SAME `error` code the citation read uses,
                # differing only in the field that says which read it was.
                raise HTTPException(
                    status_code=500,
                    detail=json.dumps(
                        {
                            "error": "db_error",
                            "pg_code": "53300",
                            "op": "tenant_scope.resolve",
                        }
                    ),
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is False, (
            "coord answered about `tenant_scope.resolve` — a fault that is "
            "fleet-wide by construction — and the citations carve-out swallowed "
            "it, so a real outage reads as healthy"
        )
        reason = next(
            r["coord"]["unavailable_reason"]
            for r in body["items"]
            if r["coord"]["unavailable_reason"]
        )
        # The op that caused the refusal is also the op the operator is shown:
        # one parse of the body feeds the classifier and the reason alike.
        assert reason == "coord returned 500: db_error: tenant_scope.resolve: 53300", (
            reason
        )

    async def test_a_500_with_NO_op_keeps_the_carve_out_for_a_PRE_SWEEP_coord(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The fail-OPEN direction, which the op test must not take away.

        ``op`` exists only on a coord carrying the crate-wide sweep. A coord
        predating it answers this door with ``db_error`` and no such field, and
        so does the hand-rolled 503 on EVERY coord. Refusing the carve-out on a
        missing ``op`` would delete it against exactly the coord it was written
        for — reinstating the page-wide blanking, silently, in the deploy window
        where this service is ahead of the coord in front of it.

        Distinct from the wide-body test above, which also carries no ``op``:
        that one proves the whitelist stays safe against a legacy body's PG
        internals. This one isolates the classifier, on a body identical to the
        narrow one coord sends today with the single field removed — so a
        regression here is unambiguously about the op test and not about shape
        handling.
        """
        plans = [
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("no-op-500"),
                work_unit_slug=_slug("wu-no-op-500"),
            )
            for _ in range(4)
        ]

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=500,
                    detail=json.dumps({"error": "db_error", "pg_code": "23503"}),
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is True, (
            "a coord predating the sweep sends no `op`, and requiring one "
            "silently deletes the carve-out for it"
        )
        assert _coord_slug_call_count(fake) == 2 * len(plans)
        for plan in plans:
            link = next(i for i in body["items"] if i["id"] == str(plan.id))["coord"]
            assert link["work_unit_state"] == "linked"
            assert link["linked_prs_state"] == "unavailable"

    async def test_the_DELIVERY_op_is_also_an_answer_about_these_rows(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The set admits both of coord's citation-sub-resource tokens.

        ``work_unit.citations.delivery`` is coord's name for a failure deriving
        the shipped/evidence verdict FROM the citation rows. It is not reachable
        on this door today — the sub-resource reduces rows it already read, so
        its delivery arm cannot fail, and only the by-slug door still emits
        ``delivery_error`` — but a coord that grew one here would be answering
        about these rows, which is the whole predicate the carve-out tests.

        Admitting it is not a widening of the exception: without the op test
        every token was admitted. The set only ever subtracts.
        """
        plans = [
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("delivery-op"),
                work_unit_slug=_slug("wu-delivery-op"),
            )
            for _ in range(4)
        ]

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=500,
                    detail=json.dumps(
                        {
                            "error": "db_error",
                            "pg_code": None,
                            "op": "work_unit.citations.delivery",
                        }
                    ),
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        fake = AsyncMock(side_effect=_fake)
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is True
        assert _coord_slug_call_count(fake) == 2 * len(plans)
        for plan in plans:
            link = next(i for i in body["items"] if i["id"] == str(plan.id))["coord"]
            assert link["linked_prs_state"] == "unavailable"
            # `pg_code` is null on this fixture, so the op is the whole
            # diagnostic — the same property that made it worth reading.
            assert link["unavailable_reason"] == (
                "coord returned 500: db_error: work_unit.citations.delivery"
            ), link["unavailable_reason"]

    async def test_a_503_naming_a_FOREIGN_op_still_trips(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The refusal is a property of the carve-out, not of the 500 arm.

        coord's ``citation_surface_unavailable`` body is hand-rolled and has
        never carried an ``op`` — which is why the 503 arm keeps working
        untouched (pinned by the sibling test above). A 503 that DOES carry one,
        naming another operation, is therefore not that body: it is some other
        door's answer wearing this door's error code, and the conservative
        reading is the one the status/code pairing already takes.
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("foreign-op-503"),
                work_unit_slug=_slug("wu-foreign-op-503"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=503,
                    detail=json.dumps(
                        {
                            "error": "citation_surface_unavailable",
                            "pg_code": "42P01",
                            "op": "work_unit.list",
                        }
                    ),
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is False
        # The 503 arm renders the same three whitelisted identifiers the 500
        # arm does, off the same parse that refused the carve-out — asserted
        # here because the whole claim of the op test is that the operator
        # cannot be shown one token while the classifier acted on another.
        reason = next(
            r["coord"]["unavailable_reason"]
            for r in body["items"]
            if r["coord"]["unavailable_reason"]
        )
        assert reason == (
            "coord returned 503: citation_surface_unavailable: work_unit.list: 42P01"
        ), reason

    async def test_the_PRESENCE_hops_own_op_is_foreign_to_this_carve_out(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``work_unit.read`` is the token this set is most likely to grow.

        The two foreign tokens pinned above name coord operations this module
        never asks for — ``tenant_scope.resolve`` and ``work_unit.list``. The
        one it DOES ask for is ``work_unit.read``: it is what
        :meth:`_CoordProbe.link_for`'s own PRESENCE hop performs, one line
        earlier, on this very slug. That makes it the token a maintainer widens
        the set with "for consistency" — and the reading it would buy is
        exactly wrong. The presence hop is deliberately UNGUARDED (it is the
        canary that keeps a coord-wide fault tripping), so admitting its op
        here would carve out the one failure that both hops share, on the hop
        that was supposed to catch it.

        A ``work_unit.read`` 500 arriving on the ``/citations`` path is also not
        coord answering about the citations: it says the SLUG read broke, which
        this hop already got a 200 for. Whatever that is, it is not evidence
        about this sub-resource, and the set subtracts it.
        """
        for _ in range(4):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug("sibling-op"),
                work_unit_slug=_slug("wu-sibling-op"),
            )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(
                    status_code=500,
                    detail=json.dumps(
                        {
                            "error": "db_error",
                            "pg_code": "57014",
                            "op": "work_unit.read",
                        }
                    ),
                )
            return {"work_unit": {"slug": "x", "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["coord_available"] is False, (
            "`work_unit.read` is the sibling hop's op, not this sub-resource's "
            "— admitting it would carve out a fault on the one hop left "
            "unguarded to catch it"
        )
        reason = next(
            r["coord"]["unavailable_reason"]
            for r in body["items"]
            if r["coord"]["unavailable_reason"]
        )
        assert reason == "coord returned 500: db_error: work_unit.read: 57014", reason

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
        assert _coord_slug_call_count(fake) == 1, "the inline citations were not used"
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
    anything echoed there leaves this API stickily. coord's wide
    ``pg_error.to_body()`` carries the anyhow chain and structured Postgres
    fields, and ``pg.detail`` routinely names ROW VALUES, constraints and
    tables. Only the identifying fields may ride out.

    That constructor has no production caller on coord's ``main`` any more —
    the crate-wide sweep narrowed every door onto ``to_safe_body(op)`` and left
    it ``#[cfg(test)]``. These tests are therefore a control against a coord
    PREDATING the sweep, which is a live reading and not a historical one: this
    read runs against whatever coord actually answered. The narrow body coord
    emits today is pinned by ``TestCoordsOpTokenNamesWhichReadFailed``.
    """

    #: A WIDE ``pg_error.to_body()``-shaped body: the parts that identify the
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
        That hop carries no ``answered`` carve-out and never will: it is the
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

        Both bodies a CURRENT coord answers with carry ``pg_code`` at the top
        level — the hand-rolled ``citation_surface_unavailable`` one, and
        ``to_safe_body(op)``, which picked that spelling because
        ``_coord_error_code`` is the only structural reader there is. The
        nested ``pg.code`` is the wide ``to_body()``'s. Reading only one would
        drop the field that decides between "wait for the migration" and "page
        someone".
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

        This body is deliberately one coord never built: the wide
        ``pg_error::to_body()`` ALWAYS writes ``error`` and ``context``
        alongside ``pg``, and that shape is pinned by
        ``test_coords_WIDE_to_body_shape_inline_echoes_only_its_identifiers``
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

    #: coord's WIDE inline error object, as ``pg_error::PgErrorContext::
    #: to_body()`` builds it: ``error`` and ``context`` are written on EVERY
    #: call, with the structured ``pg`` map beside them. The degenerate
    #: ``{"pg": …}`` above is a shape coord never built at all; this one it
    #: built for every failed inline citation read.
    #:
    #: **No longer what production emits, and kept deliberately.** coord's
    #: crate-wide sweep (landed on coord ``main``) moved the inline
    #: ``citations_error`` onto ``citations_error_body`` →
    #: ``to_safe_body(SafeOp::WorkUnitCitationsRead)``, and left ``to_body``
    #: ``#[cfg(test)]`` with zero production callers — it cannot reach a wire
    #: at all. The narrow body that replaced it is pinned by
    #: ``TestCoordsOpTokenNamesWhichReadFailed``.
    #:
    #: This stays a CONTROL, on the same terms the two-hop citation fallback
    #: stays wired: landing is a fact about coord's ``main``, while this read
    #: runs against whatever coord actually answered — a deployment mid-roll,
    #: a pinned environment, a local coord. Retiring it would also retire this
    #: file's only coverage of the whitelist against a nested ``pg`` map on the
    #: INLINE arm — the shape whose ``pg.detail`` carries the row value the
    #: whitelist exists to stop.
    WIDE_TO_BODY = {
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

    async def test_coords_WIDE_to_body_shape_inline_echoes_only_its_identifiers(
        self, device_client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The whitelist against the WIDE body, on the device path.

        ``to_body()`` writes ``error`` AND ``context`` beside ``pg`` every
        time, so this — not the bare ``{"pg": …}`` above — is what a citation
        failure put on the device path before coord's sweep, and what one from
        a coord predating the sweep still puts there. Both identifiers are
        found (``error`` at the top level, the SQLSTATE nested at ``pg.code``),
        and every free-text field around them stays inside this service: the
        ``context`` sentence, ``pg.message``, the ROW VALUE in ``pg.detail``,
        and the constraint/table/column names that describe coord's schema.

        The narrow body a CURRENT coord puts there instead is pinned by
        ``TestCoordsOpTokenNamesWhichReadFailed``; this one keeps the pre-sweep
        reading covered.
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
                "citations_error": self.WIDE_TO_BODY,
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


class TestCoordsOpTokenNamesWhichReadFailed:
    """coord's ``op`` token crosses the whitelist; its schema names still do not.

    coord narrowed EVERY production error body onto
    ``PgErrorContext::to_safe_body(op)`` — ``{error, pg_code, op}`` plus the
    schema identifiers PG happened to name. ``op`` is drawn from a closed set of
    compile-time literals (``SafeOp``), which is why coord is willing to put it
    on the wire at all: its own test calls a free-text token "a disclosure
    surface".

    This read whitelisted ``error`` and the SQLSTATE and stopped there, which is
    the same defect the predecessor plan already fixed once at source — the
    SQLSTATE was briefly emitted at a key this side never looked at, "silently
    dropping the one field that tells an operator whether to wait for a
    migration or page someone". ``op`` is the next field along, and it matters
    most on the arm where the SQLSTATE is *absent by construction*.

    The pairing is deliberate: these tests admit ``op`` and, in the same
    fixtures, keep proving that ``pg_constraint`` / ``pg_table`` / ``pg_column``
    do NOT cross. coord judges those safe to emit and is right — they are
    schema, not row values — but this boundary is stricter than coord's on
    purpose, and a whitelist that widened whenever the producer widened would
    not be one.
    """

    #: coord's REAL ``to_safe_body`` output for a failed citation read, with
    #: every optional identifier populated — the widest shape this side can
    #: actually receive.
    SAFE_BODY = {
        "error": "db_error",
        "pg_code": "23503",
        "op": "work_unit.citations.read",
        "pg_constraint": "work_unit_citations_tenant_id_fkey",
        "pg_table": "work_unit_citations",
        "pg_column": "tenant_id",
    }

    async def test_the_inline_citations_error_names_the_op(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The arm the operator page now runs on.

        Phase 3 moved the operator path onto the flag-on-a-200, so
        ``citations_error`` — rendered by ``_citation_error_text`` — is where an
        operator meets a citation failure. It is coord's ``to_safe_body`` output
        verbatim, ``op`` included.
        """
        wu = _slug("wu-op-token-inline")
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("op-token-inline"),
            work_unit_slug=wu,
        )

        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted"}, [], citations_error=self.SAFE_BODY
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert _coord_slug_calls(fake) == [f"/coord/work-units/{wu}"], (
            "the verdict must come off the inline arm, not a second hop"
        )

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        reason = row["coord"]["unavailable_reason"]
        assert row["coord"]["linked_prs_state"] == "unavailable"
        assert "work_unit.citations.read" in reason, (
            "coord named WHICH read broke and this side dropped it"
        )
        assert "db_error" in reason
        assert "23503" in reason
        # Control — the producer widened, the whitelist did not. The op token is
        # stripped first so its own dotted spelling cannot satisfy the pg_table
        # needle.
        residue = reason.replace("work_unit.citations.read", "")
        for withheld in (
            "work_unit_citations_tenant_id_fkey",
            "work_unit_citations",
            "tenant_id",
        ):
            assert withheld not in residue, f"schema name egressed: {withheld!r}"

    async def test_the_op_is_the_ONLY_diagnostic_when_the_read_never_reached_pg(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The discriminating case, and coord's own reason for adding ``op``.

        A pool timeout or a refused connection never reaches Postgres, so there
        is no SQLSTATE — coord spells that ``pg_code: null`` deliberately, to
        state "the failure never reached PG" rather than dress an absence up as
        an answer. On that arm ``error`` is the generic ``db_error`` and ``op``
        is everything else there is.

        Without the ``op`` read, the whole line an operator gets here is
        ``coord could not read citations: db_error`` — true, and useless. That
        exact string is asserted against, so this test fails on a revert rather
        than merely losing a substring.
        """
        wu = _slug("wu-op-nopg")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("op-nopg"), work_unit_slug=wu
        )

        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted"},
            [],
            citations_error={
                "error": "db_error",
                "pg_code": None,
                "op": "work_unit.citations.read",
            },
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        reason = row["coord"]["unavailable_reason"]
        assert row["coord"]["linked_prs_state"] == "unavailable"
        assert reason != "coord could not read citations: db_error", (
            "pg_code is null on this arm, so dropping `op` leaves the operator "
            "with a bare `db_error` and nothing to act on"
        )
        assert "work_unit.citations.read" in reason

    async def test_a_presence_hop_500_names_WHICH_work_unit_read_broke(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The status-code arm — ``_safe_body_excerpt``, not the inline one.

        The presence hop is the unguarded canary: a 500 there trips the circuit
        and its reason is repeated stickily on every remaining row. coord now
        answers it through the same constructor, with ``op`` distinguishing the
        by-slug read from the history and list reads that share the ``db_error``
        code — which is the difference between "the detail read is sick" and
        "something else is".
        """
        await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("op-presence"),
            work_unit_slug=_slug("wu-op-presence"),
        )

        async def _fake(path: str, **_: Any) -> Any:
            raise HTTPException(
                status_code=500,
                detail=json.dumps(
                    {
                        "error": "db_error",
                        "pg_code": None,
                        "op": "work_unit.read",
                        "pg_table": "work_units",
                    }
                ),
            )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
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
        assert reason == "coord returned 500: db_error: work_unit.read", (
            "the whitelist admits exactly `error` and `op` here — the SQLSTATE "
            "is null and the pg_table name is not this side's to forward"
        )

    async def test_an_op_alone_is_recognised_not_described_by_field_names(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A body carrying ONLY ``op`` is recognised, not described.

        The "unrecognised coord error body (keys: …)" fallback exists for a body
        with no identifier this read knows. ``op`` is now one, so it must take
        the identifier branch — otherwise the operator is handed a list of field
        names while the field naming the failure sits inside it.
        """
        wu = _slug("wu-op-only")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("op-only"), work_unit_slug=wu
        )

        fake = _coord_honouring_with_citations(
            {"slug": wu, "status": "vetted"},
            [],
            citations_error={"op": "work_unit.citations.delivery"},
        )
        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        reason = row["coord"]["unavailable_reason"]
        assert reason == (
            "coord could not read citations: work_unit.citations.delivery"
        ), reason
        assert "keys:" not in reason

    async def test_a_pathological_op_field_is_TRUNCATED(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Naming the field is what makes it safe; the cap is still not optional.

        ``op`` is a closed set of literals in coord TODAY, and this side does
        not enforce that — it cannot, without reimplementing coord's enum and
        drifting from it. So the same reasoning that caps the whitelisted
        ``error`` field applies here: a whitelisted field is filtered, and
        ``_cap_reason`` bounds what a filtered field may carry.
        """
        tail = "ROWVALUE-9f1c2d3e"
        long_op = "x" * (_REASON_MAX_CHARS * 2) + tail
        await _plan(
            async_db_session,
            org_id=None,
            slug=_slug("op-long"),
            work_unit_slug=_slug("wu-op-long"),
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(
                side_effect=HTTPException(
                    status_code=500, detail=json.dumps({"op": long_op})
                )
            ),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        reason = next(
            r["coord"]["unavailable_reason"]
            for r in body["items"]
            if r["coord"]["unavailable_reason"]
        )
        prefix = "coord returned 500: "
        assert reason.startswith(prefix)
        excerpt = reason[len(prefix) :]
        assert len(excerpt) == _REASON_MAX_CHARS, (
            f"the whitelisted `op` field was not capped: {len(excerpt)} chars"
        )
        assert excerpt.endswith("…"), "truncation is not marked"
        assert tail not in reason


# ===========================================================================
# The UNION population — both corpus layers, not just the one with bodies
# ===========================================================================
#
# Plan ``2026-09-03-vet-imp-sweep-selects-from-the-sparse-document-layer``.
# ``/candidates`` used to select from ``agent.work_artifacts`` alone — the
# layer that holds plan BODIES, which fills only under an opt-in body sync. On
# 2026-09-03 that was 18 rows against 635 non-terminal date-slugged coord work
# units (606 of them resolving to a real plan file), so ``/vet-imp-sweep``
# truthfully reported "nothing to do" over 606 addressable plans.
#
# The coord half is mocked at the SAME ``_proxy_coord_get`` seam the rest of
# this module uses; the population read is coord's work-unit LIST door, one
# call per page rather than one per row.


def _coord_unit(
    slug: str,
    *,
    status: str = "vetted",
    title: str | None = None,
    source_path: str | None = "plans/a-plan.md",
    repo: str | None = "qontinui-dev-notes",
    created_at: str = "2026-01-01T00:00:00Z",
    first_in_progress_at: str | None = None,
) -> dict[str, Any]:
    """One row shaped like coord's ``GET /coord/…work-units`` list."""
    metadata: dict[str, Any] = {}
    if source_path is not None:
        metadata["source_path"] = source_path
    if repo is not None:
        metadata["repo"] = repo
    return {
        "id": str(uuid4()),
        "slug": slug,
        "status": status,
        "title": title if title is not None else f"Unit {slug}",
        "metadata": metadata,
        "created_at": created_at,
        "updated_at": created_at,
        "first_in_progress_at": first_in_progress_at,
        "first_shipped_at": None,
    }


def _coord_with_population(
    units: list[dict[str, Any]],
    *,
    work_unit: dict[str, Any] | None = None,
    citations: list[dict[str, Any]] | None = None,
) -> AsyncMock:
    """A coord that answers the POPULATION list door and the by-slug doors.

    The list door returns coord's real envelope, ``{work_units, limit,
    offset}``, in ONE page — a page shorter than the requested limit is the
    last one, which is coord's own paging contract.
    """

    async def _fake(path: str, **_: Any) -> Any:
        if path in _COORD_POPULATION_PATHS:
            return {"work_units": units, "limit": 500, "offset": 0}
        if path.endswith("/citations"):
            return {"citations": list(citations or [])}
        body: dict[str, Any] = {
            "work_unit": work_unit or {"slug": path.rsplit("/", 1)[-1]},
            "recent_history": [],
        }
        if path.startswith("/coord/agent-work-units/"):
            body["citations"] = list(citations or [])
        return body

    return AsyncMock(side_effect=_fake)


class TestThePopulationIsNotBoundedByTheArtifactTable:
    """Phase 3 — the guard that keeps the join direction honest.

    Everything else in this file would still pass if someone re-derived the
    candidate population from ``agent.work_artifacts``: the artifact-backed
    assertions are all satisfied by the OLD query. This class is the one that
    would not be, and it is deliberately stated as a COUNT rather than as a
    property of any particular row — ``N`` non-terminal work units, ZERO
    artifacts, ``N`` candidates. A population bounded by the document layer
    can only answer 0.
    """

    async def test_zero_artifacts_and_N_work_units_yields_N_candidates(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        # No plan artifact is created at all: the document layer is EMPTY, so
        # every row below can only have come from coord.
        units = [_coord_unit(f"2026-09-0{i % 9 + 1}-guard-{i}") for i in range(30)]

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population(units),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == len(units), (
            "the candidate population is bounded by the artifact table again — "
            "with an empty document layer this can only be 0 or N, and 0 is "
            "the regression this test exists for"
        )
        assert len(body["items"]) == len(units)
        assert {row["slug"] for row in body["items"]} == {u["slug"] for u in units}
        assert body["work_unit_population_state"] == "included"
        assert body["work_unit_population_reason"] is None

    async def test_the_population_read_is_ONE_call_not_one_per_row(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Widening the population must not multiply the coord fan-out.

        A work-unit-only row arrives FROM the list read, so it must never
        round-trip to coord again — otherwise the widened page costs one hop
        per candidate, which is the cost this change was meant to avoid
        paying.
        """
        units = [_coord_unit(f"2026-08-1{i}-fanout-{i}") for i in range(9)]
        fake = _coord_with_population(units)

        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert len(resp.json()["items"]) == len(units)
        assert _coord_slug_call_count(fake) == 0, (
            f"a work-unit-only row was re-read per slug: {_coord_slug_calls(fake)}"
        )
        assert fake.await_count == 1, "the population must be ONE list read"


class TestWorkUnitOnlyRows:
    async def test_a_work_unit_with_no_artifact_becomes_a_candidate(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        slug = "2026-09-01-only-in-coord"
        unit = _coord_unit(
            slug,
            status="vetted",
            title="Only in coord",
            source_path="plans/2026-09-01-only-in-coord.md",
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population([unit]),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        row = next(r for r in resp.json()["items"] if r["slug"] == slug)
        # No artifact, so no id — inventing one would make a phantom look
        # fetchable from the body routes.
        assert row["id"] is None
        assert row["kind"] == "plan"
        assert row["title"] == "Only in coord"
        assert row["status"] == "vetted"
        assert row["source_path"] == "plans/2026-09-01-only-in-coord.md"
        assert row["work_unit_slug"] == slug
        assert row["document_state"] == "unsynced"
        # The work-unit half came from the list read; the PR half did not,
        # and an empty list there is UNKNOWN rather than "no PRs".
        assert row["coord"]["work_unit_state"] == "linked"
        assert row["coord"]["work_unit_status"] == "vetted"
        assert row["coord"]["linked_prs_state"] == "unavailable"
        assert row["coord"]["linked_prs"] == []

    async def test_no_source_path_anywhere_reads_absent_not_unsynced(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The bodyless plan's case, and it must stay distinguishable.

        ``unsynced`` means a plan FILE exists and only the body sync is
        missing; ``absent`` means no document has been seen anywhere. Those
        demand different responses from a sweep — resolve by path, versus
        do not spawn at all — so collapsing them would hand the neighbouring
        plan's subject to this one.
        """
        with_file = _coord_unit("2026-09-02-has-a-file", source_path="plans/x.md")
        without = _coord_unit("2026-09-02-has-no-file", source_path=None)

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population([with_file, without]),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        states = {r["slug"]: r["document_state"] for r in resp.json()["items"]}
        assert states["2026-09-02-has-a-file"] == "unsynced"
        assert states["2026-09-02-has-no-file"] == "absent"

    async def test_shepherd_and_non_date_slugs_are_not_plans(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """coord's own bookkeeping is not a candidate.

        ``shepherd-*`` is one unit per Tier-3 unlandable-PR escalation — 839
        of 2,389 rows on 2026-09-03 — and a slug with no date prefix is not
        plan-shaped. The exclusion is asked for server-side as well, but a
        coord that ignored the parameter must not fill the page with them.
        """
        units = [
            _coord_unit("2026-09-03-a-real-plan"),
            _coord_unit("shepherd-qontinui-web-1234"),
            _coord_unit("not-date-prefixed-at-all"),
        ]

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population(units),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [r["slug"] for r in body["items"]] == ["2026-09-03-a-real-plan"]
        assert body["total"] == 1

    async def test_an_unrecognised_coord_status_counts_as_NOT_terminal(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """coord's status column is as opaque as the library's, and wilder.

        59 distinct strings on 2026-09-03 — ``d1``, ``fix``, ``all``,
        ``code``, ``phases`` among them, and 492 rows holding the EMPTY
        string. The artifact half's rule is that an unknown word must not
        silently hide a plan; the coord half reads the same
        ``normalize_status`` / ``TERMINAL_STATUSES`` pair, so it must behave
        identically.
        """
        units = [
            _coord_unit("2026-09-03-empty-status", status=""),
            _coord_unit("2026-09-03-unknown-word", status="d1"),
            _coord_unit("2026-09-03-backticked", status="`needs_rework`"),
            # Terminal, in three spellings the normalizer must fold.
            _coord_unit("2026-09-03-done-a", status="shipped"),
            _coord_unit("2026-09-03-done-b", status="  Superseded "),
            _coord_unit("2026-09-03-done-c", status="ABANDONED"),
        ]

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population(units),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(r["slug"] for r in body["items"]) == [
            "2026-09-03-backticked",
            "2026-09-03-empty-status",
            "2026-09-03-unknown-word",
        ]
        assert body["total"] == 3

    async def test_work_unit_rows_order_on_first_in_progress_then_created(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The documented stable default, on this arm's own timestamps.

        ``coalesce(first_in_progress_at, created_at) ASC`` — coord reports
        ``first_in_progress_at`` ABSENT rather than zero when no transition
        was recorded, so the fallback is explicit rather than left to the sort.
        """
        units = [
            # created LAST, but entered in_progress FIRST.
            _coord_unit(
                "2026-09-03-late-created",
                created_at="2026-05-01T00:00:00Z",
                first_in_progress_at="2026-01-01T00:00:00Z",
            ),
            _coord_unit(
                "2026-09-03-no-transition",
                created_at="2026-03-01T00:00:00Z",
                first_in_progress_at=None,
            ),
            _coord_unit(
                "2026-09-03-mid",
                created_at="2026-02-01T00:00:00Z",
                first_in_progress_at="2026-02-15T00:00:00Z",
            ),
        ]

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population(units),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert [r["slug"] for r in resp.json()["items"]] == [
            "2026-09-03-late-created",
            "2026-09-03-mid",
            "2026-09-03-no-transition",
        ]


class TestTheUnionDoesNotDuplicate:
    async def test_a_row_in_BOTH_layers_is_emitted_once(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The artifact wins, and keeps everything it had.

        The de-duplication key is the soft link the scanner writes — the
        plan's own stem in ``work_unit_slug`` — so a plan present in both
        layers must appear exactly once, artifact-backed, with its id, its
        body reachable and its ``coord`` block populated per-slug as before.
        """
        slug = "2026-09-03-in-both-layers"
        plan = await _plan(
            async_db_session,
            org_id=None,
            slug=slug,
            status="VETTED",
            work_unit_slug=slug,
        )
        fake = _coord_with_population(
            [_coord_unit(slug, status="in_progress", title="From coord")],
            work_unit={"slug": slug, "status": "in_progress", "title": "From coord"},
            citations=[_A_CITATION],
        )

        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1, "the union emitted the same plan twice"
        row = body["items"][0]
        assert row["id"] == str(plan.id)
        assert row["document_state"] == "present"
        assert row["status"] == "VETTED"
        # Unchanged from before the union: the per-slug hop still runs for an
        # artifact-backed row, so its citations are a real answer.
        assert row["coord"]["work_unit_state"] == "linked"
        assert row["coord"]["linked_prs_state"] == "available"
        assert [p["pr_number"] for p in row["coord"]["linked_prs"]] == [1559]

    async def test_an_artifact_with_no_soft_link_still_claims_its_slug(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``work_unit_slug`` is nullable, and the stem is the same identity.

        An artifact captured without the soft link is still the document for
        the work unit of the same stem. Joining on ``work_unit_slug`` alone
        would show that plan twice — once with a body, once without — which is
        the visible symptom the second half of the key exists to prevent.
        """
        slug = "2026-09-03-linked-by-stem-only"
        await _plan(async_db_session, org_id=None, slug=slug, work_unit_slug=None)

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population([_coord_unit(slug)]),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["document_state"] == "present"

    async def test_a_terminal_artifact_suppresses_its_work_unit_row(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The document layer's terminal filter stays the single decision.

        Emitting a second, id-less row for a plan the library says is SHIPPED
        would contradict the filter this route has always applied, and
        ``document_state`` would have to read ``present`` while carrying
        nothing to fetch the body with.
        """
        slug = "2026-09-03-shipped-in-the-library"
        await _plan(
            async_db_session,
            org_id=None,
            slug=slug,
            status="SHIPPED",
            work_unit_slug=slug,
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population([_coord_unit(slug, status="vetted")]),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == 0


class TestTheUnionDegradesRatherThanShrinks:
    """A coord that cannot be read must cost the ADDED rows, never the old ones.

    Module invariant 5 applied to the population: an unavailable coord is
    UNKNOWN, never empty. Driving the population purely from coord would have
    inverted it — an outage would empty the route instead of degrading it —
    which is why the population is a union rather than a replacement.
    """

    async def test_an_unreachable_coord_degrades_to_the_artifact_population(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        for i in range(3):
            await _plan(async_db_session, org_id=None, slug=_slug(f"local-{i}"))

        async def _coord_down(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=502, detail="coord is not reachable")

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_coord_down),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, "a coord outage must not fail this read"
        body = resp.json()
        assert body["total"] == 3, (
            "the outage cost rows the document layer already held — the union "
            "may only ever ADD"
        )
        assert all(r["document_state"] == "present" for r in body["items"])
        assert body["coord_available"] is False
        assert body["work_unit_population_state"] == "unavailable"
        assert body["work_unit_population_reason"]

    async def test_a_403_on_the_population_door_is_reported_not_silent(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The case ``coord_available`` structurally cannot report.

        A 4xx is coord ANSWERING, so it does not trip the page-wide circuit and
        ``coord_available`` stays ``true``. Without its own flag the route
        would fall back to the document layer — 2.1% of the addressable corpus
        on this fleet — while reporting coord healthy, which is precisely the
        silent shrink this plan exists to remove.
        """
        await _plan(async_db_session, org_id=None, slug=_slug("still-here"))

        async def _coord_403(path: str, **_: Any) -> Any:
            raise HTTPException(status_code=403, detail="tenant_not_resolved")

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_coord_403),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["coord_available"] is True, "a 4xx is coord answering"
        assert body["work_unit_population_state"] == "unavailable"
        assert "403" in (body["work_unit_population_reason"] or "")

    async def test_a_body_with_no_work_units_key_is_UNKNOWN_not_empty(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A coord this read cannot parse is not a coord with no work units."""
        await _plan(async_db_session, org_id=None, slug=_slug("parse"))

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(return_value={"unexpected": "shape"}),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["work_unit_population_state"] == "unavailable"
        assert body["work_unit_population_reason"]

    async def test_include_coord_false_reports_the_population_as_unavailable(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """ "We did not look" is not "there is nothing there" — here too."""
        await _plan(async_db_session, org_id=None, slug=_slug("local-only"))
        fake = AsyncMock(return_value={})

        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            resp = await client.get(
                CANDIDATES, params={"limit": 100, "include_coord": "false"}
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert fake.await_count == 0
        assert body["total"] == 1
        assert body["work_unit_population_state"] == "unavailable"
        assert body["work_unit_population_reason"] == (
            "not fetched (include_coord=false)"
        )


class TestTheUnionPagesAndCountsOverBothArms:
    async def test_total_and_paging_span_the_union(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """``total`` is the union's size and the pages tile it exactly once."""
        base = datetime(2026, 4, 1, tzinfo=UTC)
        for i in range(3):
            await _plan(
                async_db_session,
                org_id=None,
                slug=_slug(f"art-{i}"),
                authored_at=base + timedelta(days=i * 2),
            )
        units = [
            _coord_unit(
                f"2026-04-0{i + 1}-unit-{i}",
                created_at=(base + timedelta(days=i * 2 + 1)).isoformat(),
            )
            for i in range(3)
        ]
        fake = _coord_with_population(units)

        with patch("app.api.v1.endpoints.plan_library._proxy_coord_get", new=fake):
            whole = await client.get(CANDIDATES, params={"limit": 100})
            page1 = await client.get(CANDIDATES, params={"limit": 2, "offset": 0})
            page2 = await client.get(CANDIDATES, params={"limit": 2, "offset": 2})
            page3 = await client.get(CANDIDATES, params={"limit": 2, "offset": 4})

        assert whole.status_code == 200, whole.text
        assert whole.json()["total"] == 6
        ordered = [r["slug"] for r in whole.json()["items"]]
        # The two arms interleave on their own timestamps — this is the check
        # that the merge is a merge and not a concatenation.
        assert len({r["document_state"] for r in whole.json()["items"]}) == 2

        paged: list[str] = []
        for page in (page1, page2, page3):
            assert page.status_code == 200, page.text
            assert page.json()["total"] == 6
            paged.extend(r["slug"] for r in page.json()["items"])
        assert paged == ordered, "the pages do not tile the union"

    async def test_an_artifact_wins_a_tie_so_an_all_artifact_page_is_unchanged(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Ties go to the document layer, so nothing about the old page moves."""
        same = datetime(2026, 6, 6, tzinfo=UTC)
        await _plan(
            async_db_session, org_id=None, slug=_slug("tie-art"), authored_at=same
        )

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=_coord_with_population(
                [_coord_unit("2026-06-06-tie-unit", created_at=same.isoformat())]
            ),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        assert resp.status_code == 200, resp.text
        states = [r["document_state"] for r in resp.json()["items"]]
        assert states == ["present", "unsynced"]
