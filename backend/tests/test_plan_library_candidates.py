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
    from app.api.deps import current_active_user, get_async_db
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user

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
    """A coord that answers both hops."""

    async def _fake(path: str, **_: Any) -> Any:
        if path.endswith("/citations"):
            return {"citations": citations}
        return {"work_unit": work_unit, "recent_history": []}

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

    async def test_citations_route_absent_reads_as_unavailable(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """A coord without the citation read route is UNKNOWN, not 'no PRs'."""
        wu = _slug("wu-nocite")
        plan = await _plan(
            async_db_session, org_id=None, slug=_slug("nocite"), work_unit_slug=wu
        )

        async def _fake(path: str, **_: Any) -> Any:
            if path.endswith("/citations"):
                raise HTTPException(status_code=404, detail="Not Found")
            return {"work_unit": {"slug": wu, "status": "vetted"}}

        with patch(
            "app.api.v1.endpoints.plan_library._proxy_coord_get",
            new=AsyncMock(side_effect=_fake),
        ):
            resp = await client.get(CANDIDATES, params={"limit": 100})

        row = next(i for i in resp.json()["items"] if i["id"] == str(plan.id))
        assert row["coord"]["work_unit_state"] == "linked"
        assert row["coord"]["linked_prs_state"] == "unavailable"
        assert row["coord"]["linked_prs"] == []

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
