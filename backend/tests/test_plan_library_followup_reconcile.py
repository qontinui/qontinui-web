"""The ``fixing`` → ``fixed`` / ``open`` reconcile — route, core and scheduled task.

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
Phase 5 step 2 (D5). A follow-up moved to ``fixing`` must move on when its PR
settles, and "settled" is COORD's land record (``GET /coord/pr/{repo}/{n}/landed``
→ ``{verdict, land_commit, via, unknown_reason}``), never GitHub's ``merged``
flag: ``landed`` → ``fixed``; ``closed_unlanded`` → back to ``open``;
``pending`` → unchanged; ``unknown`` → unchanged and counted.

Pinned here, each against a stub coord:

* every verdict moves exactly its rows, each DISTINCT PR is read once, and a
  land with no recorded commit still reads ``fixed``;
* a coord outage moves NOTHING, trips the circuit after ONE read, and reports
  ``coord_available: false`` with every row counted unknown — never "nothing
  to settle";
* a 4xx or a malformed body is that PR's ``unknown``, not an outage;
* the route touches the caller's organization only; the scheduled task walks
  every organization;
* a row another writer moved mid-pass is left as that writer left it
  (``raced``), and the walk pages and caps honestly (``truncated``);
* ONE scheduled tick moves a landed row to ``fixed`` and reopens a
  closed-unlanded one; with the task's kill switch off nothing moves; a
  disabled service account moves nothing and counts every row unknown.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.operations import (
    CoordTransportUnavailable,
    _coord_unreachable,
)
from app.core.scheduler import ScheduledTask, SchedulerService
from app.crud import work_artifact as crud
from app.crud import work_artifact_followups as followups_crud
from app.jobs import followup_reconcile as job
from app.models.work_artifact import WorkArtifact

API_PREFIX = "/api/v1/plan-library"
REPO = "acme/widgets"
COMMIT = "0123456789abcdef0123456789abcdef01234567"

pytestmark = pytest.mark.asyncio


# ───────────────────────────── stub coord ─────────────────────────────

_LANDED_PATH = re.compile(r"^/coord/pr/(?P<repo>[^/]+)/(?P<n>\d+)/landed$")


def _landed(commit: str | None = COMMIT, via: str = "merged") -> dict[str, Any]:
    return {
        "verdict": "landed",
        "land_commit": commit,
        "via": via,
        "unknown_reason": None,
    }


def _verdict(name: str, reason: str | None = None) -> dict[str, Any]:
    return {"verdict": name, "land_commit": None, "via": None, "unknown_reason": reason}


class _StubCoord:
    """coord's ``/landed`` door, per PR number. An answer is a body (200), a
    ``(status, body)`` pair, or an exception to raise. Every call is recorded."""

    def __init__(self, answers: dict[int, Any]) -> None:
        self.answers = answers
        self.calls: list[str] = []

    def _answer(self, path: str) -> Any:
        self.calls.append(path)
        match = _LANDED_PATH.match(path)
        assert match is not None, f"unexpected coord path {path!r}"
        # coord takes owner/name as ONE path-encoded segment.
        assert match["repo"] == "acme%2Fwidgets", path
        return self.answers[int(match["n"])]

    async def proxy_get(self, path: str, **_: Any) -> Any:
        """Stands in for ``operations._proxy_coord_get`` (the route's door)."""
        answer = self._answer(path)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, tuple):
            status, body = answer
            raise HTTPException(status_code=status, detail=json.dumps(body))
        return answer

    @property
    def enabled(self) -> bool:
        return True

    async def get(self, path: str, **_: Any) -> tuple[int, object]:
        """Stands in for ``CoordServiceAccountClient.get`` (the task's door)."""
        answer = self._answer(path)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, tuple):
            return answer
        return 200, answer


class _DisabledClient:
    enabled = False

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def get(self, path: str, **_: Any) -> tuple[int, object]:
        self.calls.append(path)
        raise AssertionError("a disabled service account must not be called")


# ───────────────────────────── fixtures ─────────────────────────────


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"reconcile_{uuid4().hex[:8]}@example.com",
        username=f"reconcile_{uuid4().hex[:8]}",
        full_name="Reconcile Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def client(
    async_db_session: AsyncSession, api_user, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[httpx.AsyncClient]:
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints import plan_library_followups
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    async def _no_tenant(request, *, actor_kind):
        del request, actor_kind
        return None

    # Tenant resolution is an operator-door round trip to coord; the reconcile
    # needs only the bearer forwarding the stub replaces.
    monkeypatch.setattr(plan_library_followups, "_soft_tenant_id", _no_tenant)

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: api_user
    app.dependency_overrides[current_active_user_optional] = lambda: api_user

    async def _db_override():
        yield async_db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(plan_library_followups.router, prefix=API_PREFIX)
    app.include_router(plan_library_router, prefix=API_PREFIX)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield http


def _stub_route_coord(monkeypatch: pytest.MonkeyPatch, stub: _StubCoord) -> None:
    """The SAME seam ``/candidates``' tests use: the probe's coord GET."""
    monkeypatch.setattr(
        "app.api.v1.endpoints.plan_library._proxy_coord_get", stub.proxy_get
    )


async def _make_artifact(client: httpx.AsyncClient, stem: str) -> str:
    resp = await client.post(
        API_PREFIX,
        json={
            "kind": "plan",
            "slug": f"{stem}-{uuid4().hex[:10]}",
            "title": stem,
            "status": "VETTED",
            "body": f"# {stem}\n{uuid4().hex}",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["artifact"]["id"]


async def _fixing(
    client: httpx.AsyncClient, plan: str, note: str, pr_number: int
) -> str:
    """An open follow-up moved to ``fixing`` under ``acme/widgets#<n>``."""
    created = await client.post(
        f"{API_PREFIX}/{plan}/edges",
        json={"relation": "spawned_followup", "note": note, "to_id": None},
    )
    assert created.status_code == 201, created.text
    edge_id = created.json()["id"]
    moved = await client.post(
        f"{API_PREFIX}/edges/{edge_id}/resolution",
        json={"resolution": "fixing", "resolution_pr": f"{REPO}#{pr_number}"},
    )
    assert moved.status_code == 200, moved.text
    return edge_id


async def _state(client: httpx.AsyncClient, edge_id: str) -> dict[str, Any]:
    """The follow-up as stored, read back through the state views."""
    for state in ("open", "fixing", "resolved"):
        resp = await client.get(f"{API_PREFIX}/followups", params={"state": state})
        for item in resp.json()["items"]:
            if item["edge_id"] == edge_id:
                return item
    raise AssertionError(f"follow-up {edge_id} is in no state view")


async def _reconcile(client: httpx.AsyncClient) -> dict[str, Any]:
    resp = await client.post(f"{API_PREFIX}/followups/reconcile")
    assert resp.status_code == 200, resp.text
    return resp.json()


# ───────────────────────────── the route ─────────────────────────────


class TestReconcileRoute:
    async def test_each_verdict_moves_its_rows_and_each_pr_is_read_once(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stub = _StubCoord(
            {
                1: _landed(),
                2: _landed(commit=None, via="commits_landed_via_other_pr"),
                3: _verdict("closed_unlanded"),
                4: _verdict("pending"),
                5: _verdict("unknown", "no_repo_branches_row"),
            }
        )
        _stub_route_coord(monkeypatch, stub)
        plan = await _make_artifact(client, "verdicts")
        landed_a = await _fixing(client, plan, "landed a", 1)
        landed_b = await _fixing(client, plan, "landed b (same PR)", 1)
        no_commit = await _fixing(client, plan, "landed without commit", 2)
        unlanded = await _fixing(client, plan, "closed unlanded", 3)
        pending = await _fixing(client, plan, "still open", 4)
        unknown = await _fixing(client, plan, "coord never saw it", 5)

        body = await _reconcile(client)
        assert body == {
            "examined": 6,
            "fixed": 3,
            "reopened": 1,
            "pending": 1,
            "unknown": 1,
            "raced": 0,
            "distinct_prs": 5,
            "coord_available": True,
            "coord_unavailable_reason": None,
            "unknown_reasons": {"no_repo_branches_row": 1},
            "truncated": False,
        }
        # Two rows on one PR: ONE coord read.
        assert len(stub.calls) == 5
        assert len(set(stub.calls)) == 5

        for edge_id in (landed_a, landed_b):
            row = await _state(client, edge_id)
            assert row["state"] == "fixed"
            assert row["resolution_commit"] == COMMIT
            assert row["resolution_pr"] == f"{REPO}#1"
        row = await _state(client, no_commit)
        # A land coord holds no commit for is still a land.
        assert row["state"] == "fixed"
        assert row["resolution_commit"] is None
        assert "no land commit" in row["resolution_note"]
        assert "commits_landed_via_other_pr" in row["resolution_note"]
        row = await _state(client, unlanded)
        assert row["state"] == "open"
        last = row["resolution_history"][-1]
        assert (last["from"], last["to"]) == ("fixing", "open")
        assert last["pr"] == f"{REPO}#3"
        assert "closed without landing" in last["note"]
        assert last["by"].startswith("followup_reconcile")
        assert (await _state(client, pending))["state"] == "fixing"
        assert (await _state(client, unknown))["state"] == "fixing"

    async def test_a_coord_outage_moves_nothing_and_reads_coord_once(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Built the way `_proxy_coord_get` builds it: a typed refusal.
        down = _coord_unreachable(CoordTransportUnavailable)
        stub = _StubCoord({1: down, 2: down, 3: down})
        _stub_route_coord(monkeypatch, stub)
        plan = await _make_artifact(client, "outage")
        edges = [await _fixing(client, plan, f"row {n}", n) for n in (1, 2, 3)]

        body = await _reconcile(client)
        assert body["examined"] == 3
        assert body["unknown"] == 3
        assert body["fixed"] == body["reopened"] == body["pending"] == 0
        assert body["coord_available"] is False
        assert "502" in body["coord_unavailable_reason"]
        assert body["unknown_reasons"] == {"coord_unavailable": 3}
        # The circuit: the first transport failure answers for the rest.
        assert len(stub.calls) == 1
        for edge_id in edges:
            assert (await _state(client, edge_id))["state"] == "fixing"

    async def test_a_4xx_is_that_prs_unknown_and_does_not_trip(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stub = _StubCoord({1: (404, {"error": "no_route"}), 2: _landed()})
        _stub_route_coord(monkeypatch, stub)
        plan = await _make_artifact(client, "fourxx")
        missing = await _fixing(client, plan, "coord 404s it", 1)
        landed = await _fixing(client, plan, "coord lands it", 2)

        body = await _reconcile(client)
        assert body["coord_available"] is True
        assert body["unknown_reasons"] == {"coord_http_404": 1}
        assert body["fixed"] == 1
        assert (await _state(client, missing))["state"] == "fixing"
        assert (await _state(client, landed))["state"] == "fixed"

    @pytest.mark.parametrize(
        ("answer", "reason"),
        [
            ({"verdict": "maybe"}, "coord_verdict_unrecognised"),
            ([1, 2, 3], "coord_body_not_an_object"),
            ({"verdict": "unknown"}, "coord_unknown"),
        ],
    )
    async def test_an_unusable_answer_is_unknown_never_an_outcome(
        self,
        client: httpx.AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
        answer: Any,
        reason: str,
    ) -> None:
        _stub_route_coord(monkeypatch, _StubCoord({1: answer}))
        plan = await _make_artifact(client, "malformed")
        edge_id = await _fixing(client, plan, "odd answer", 1)
        body = await _reconcile(client)
        assert body["unknown_reasons"] == {reason: 1}
        assert (await _state(client, edge_id))["state"] == "fixing"

    async def test_nothing_fixing_reads_nothing(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stub = _StubCoord({})
        _stub_route_coord(monkeypatch, stub)
        body = await _reconcile(client)
        assert body["examined"] == 0
        assert body["coord_available"] is True
        assert stub.calls == []

    async def test_the_route_touches_only_the_callers_organization(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        stub = _StubCoord({1: _landed(), 2: _landed()})
        _stub_route_coord(monkeypatch, stub)
        plan = await _make_artifact(client, "mine")
        mine = await _fixing(client, plan, "my org", 1)
        theirs = await _foreign_fixing(async_db_session, pr_number=2)

        body = await _reconcile(client)
        assert body["examined"] == 1
        assert (await _state(client, mine))["state"] == "fixed"
        foreign = await crud.get_edge(async_db_session, theirs.id, org_id=theirs.org)
        assert foreign is not None and foreign[0].resolution == "fixing"


class _Foreign:
    def __init__(self, edge_id, org) -> None:
        self.id = edge_id
        self.org = org


async def _foreign_fixing(db: AsyncSession, *, pr_number: int) -> _Foreign:
    """A ``fixing`` follow-up in ANOTHER organization, written below the API."""
    org = uuid4()
    artifact, _, _ = await crud.upsert_artifact(
        db,
        org_id=org,
        user_id=None,
        kind="plan",
        slug=f"foreign-{uuid4().hex[:10]}",
        title="foreign",
        status="VETTED",
        body=f"# foreign\n{uuid4().hex}",
        source_path=None,
        source_repo=None,
        work_unit_slug=None,
        repos=[],
        authored_at=None,
        captured_by="agent",
        change_description=None,
        created_by="test",
    )
    edge, _ = await crud.create_edge(
        db,
        from_artifact=artifact,
        to_artifact=None,
        relation="spawned_followup",
        note="another organization's finding",
        created_by="test",
    )
    await followups_crud.transition_followup(
        db, edge.id, to="fixing", actor="test", pr=f"{REPO}#{pr_number}"
    )
    return _Foreign(edge.id, org)


# ───────────────────────────── the core ─────────────────────────────


async def _crud_fixing(db: AsyncSession, stem: str, pr_number: int) -> WorkArtifact:
    artifact, _, _ = await crud.upsert_artifact(
        db,
        org_id=None,
        user_id=None,
        kind="plan",
        slug=f"{stem}-{uuid4().hex[:10]}",
        title=stem,
        status="VETTED",
        body=f"# {stem}\n{uuid4().hex}",
        source_path=None,
        source_repo=None,
        work_unit_slug=None,
        repos=[],
        authored_at=None,
        captured_by="agent",
        change_description=None,
        created_by="test",
    )
    edge, _ = await crud.create_edge(
        db,
        from_artifact=artifact,
        to_artifact=None,
        relation="spawned_followup",
        note=f"{stem} finding",
        created_by="test",
    )
    await followups_crud.transition_followup(
        db, edge.id, to="fixing", actor="test", pr=f"{REPO}#{pr_number}"
    )
    return edge


class _Reader:
    """A :class:`LandReader` over a fixed verdict table."""

    def __init__(self, verdicts: dict[int, followups_crud.LandVerdict]) -> None:
        self.verdicts = verdicts
        self.reads: list[int] = []

    @property
    def available(self) -> bool:
        return True

    @property
    def unavailable_reason(self) -> str | None:
        return None

    async def read(self, repo: str, pr_number: int) -> followups_crud.LandVerdict:
        assert repo == REPO
        self.reads.append(pr_number)
        return self.verdicts[pr_number]


class TestReconcileCore:
    async def test_a_row_moved_under_the_pass_is_left_as_moved_and_counted_raced(
        self, async_db_session: AsyncSession
    ) -> None:
        edge = await _crud_fixing(async_db_session, "raced", 1)

        class _MovesTheRow(_Reader):
            async def read(self, repo, pr_number):
                # Another writer reopens it between the page read and the move.
                await followups_crud.transition_followup(
                    async_db_session, edge.id, to="open", actor="someone else"
                )
                return await super().read(repo, pr_number)

        reader = _MovesTheRow(
            {1: followups_crud.LandVerdict("landed", COMMIT, "merged")}
        )
        outcome = await followups_crud.reconcile_fixing_followups(
            async_db_session, reader=reader, actor="test"
        )
        assert outcome.examined == 1
        assert outcome.raced == 1
        assert outcome.fixed == 0
        await async_db_session.refresh(edge)
        assert edge.resolution is None  # the other writer's move stands

    async def test_a_stale_reopen_does_not_undo_a_dismissal_made_under_the_pass(
        self, async_db_session: AsyncSession
    ) -> None:
        """fixing(A) → open → dismissed by the operator, while the pass holds
        A's ``closed_unlanded`` verdict: the reopen arm must not reopen the
        dismissal (``dismissed → open`` is legal with a reason, so only the
        compare-and-set on ``fixing`` under A stops it)."""
        edge = await _crud_fixing(async_db_session, "dismissed-under", 1)

        class _DismissesTheRow(_Reader):
            async def read(self, repo, pr_number):
                await followups_crud.transition_followup(
                    async_db_session, edge.id, to="open", actor="someone else"
                )
                await followups_crud.transition_followup(
                    async_db_session,
                    edge.id,
                    to="dismissed",
                    actor="operator",
                    note="not worth fixing",
                )
                return await super().read(repo, pr_number)

        reader = _DismissesTheRow({1: followups_crud.LandVerdict("closed_unlanded")})
        outcome = await followups_crud.reconcile_fixing_followups(
            async_db_session, reader=reader, actor="test"
        )
        assert outcome.examined == 1
        assert outcome.raced == 1
        assert outcome.reopened == 0
        await async_db_session.refresh(edge)
        assert edge.resolution == "dismissed"  # the operator's move stands
        assert edge.resolution_note == "not worth fixing"
        assert edge.resolved_by == "operator"
        assert [h["to"] for h in edge.resolution_history] == [
            "fixing",
            "open",
            "dismissed",
        ]

    async def test_a_stale_reopen_does_not_undo_another_prs_fixing_hold(
        self, async_db_session: AsyncSession
    ) -> None:
        """fixing(A) → open → fixing(B), while the pass holds A's
        ``closed_unlanded`` verdict: B's hold must survive — the row IS
        ``fixing``, so only the PR half of the compare-and-set catches it."""
        edge = await _crud_fixing(async_db_session, "rehung-under", 1)
        other_pr = f"{REPO}#2"

        class _RehangsTheRow(_Reader):
            async def read(self, repo, pr_number):
                await followups_crud.transition_followup(
                    async_db_session, edge.id, to="open", actor="someone else"
                )
                await followups_crud.transition_followup(
                    async_db_session,
                    edge.id,
                    to="fixing",
                    actor="someone else",
                    pr=other_pr,
                )
                return await super().read(repo, pr_number)

        reader = _RehangsTheRow({1: followups_crud.LandVerdict("closed_unlanded")})
        outcome = await followups_crud.reconcile_fixing_followups(
            async_db_session, reader=reader, actor="test"
        )
        assert outcome.examined == 1
        assert outcome.raced == 1
        assert outcome.reopened == 0
        await async_db_session.refresh(edge)
        assert edge.resolution == "fixing"  # B's hold stands
        assert edge.resolution_pr == other_pr
        assert [h["to"] for h in edge.resolution_history] == [
            "fixing",
            "open",
            "fixing",
        ]

    async def test_the_compare_and_set_refuses_and_names_the_current_state(
        self, async_db_session: AsyncSession
    ) -> None:
        edge = await _crud_fixing(async_db_session, "cas", 1)
        with pytest.raises(followups_crud.FollowupTransitionConflict) as refused:
            await followups_crud.transition_followup(
                async_db_session,
                edge.id,
                to="open",
                actor="test",
                expect_state="fixing",
                expect_pr=f"{REPO}#9",
            )
        assert refused.value.current_state == "fixing"
        assert refused.value.resolution_pr == f"{REPO}#1"
        assert "fixing" in str(refused.value)
        await async_db_session.refresh(edge)
        assert edge.resolution == "fixing"
        assert edge.resolution_pr == f"{REPO}#1"

        # The precondition holding, the move goes through as before.
        _, changed = await followups_crud.transition_followup(
            async_db_session,
            edge.id,
            to="open",
            actor="test",
            expect_state="fixing",
            expect_pr=f"{REPO}#1",
        )
        assert changed is True
        await async_db_session.refresh(edge)
        assert edge.resolution is None

    async def test_the_walk_pages_and_caps_honestly(
        self, async_db_session: AsyncSession
    ) -> None:
        for n in range(1, 6):
            await _crud_fixing(async_db_session, f"page{n}", n)
        pending = {n: followups_crud.LandVerdict("pending") for n in range(1, 6)}
        full = await followups_crud.reconcile_fixing_followups(
            async_db_session, reader=_Reader(pending), actor="test", page_size=2
        )
        assert (full.examined, full.pending, full.truncated) == (5, 5, False)

        reader = _Reader(pending)
        capped = await followups_crud.reconcile_fixing_followups(
            async_db_session, reader=reader, actor="test", page_size=2, max_rows=3
        )
        assert (capped.examined, capped.truncated) == (3, True)
        assert sorted(reader.reads) == [1, 2, 3]

        exact = await followups_crud.reconcile_fixing_followups(
            async_db_session, reader=_Reader(pending), actor="test", max_rows=5
        )
        assert (exact.examined, exact.truncated) == (5, False)

    @pytest.mark.parametrize(
        ("payload", "expected"),
        [
            (
                {"verdict": "landed", "land_commit": "ABCDEF1", "via": "merged"},
                followups_crud.LandVerdict("landed", "abcdef1", "merged"),
            ),
            (
                {"verdict": "landed", "land_commit": "not-a-sha", "via": None},
                followups_crud.LandVerdict("landed", None, None),
            ),
            (
                {"verdict": "pending"},
                followups_crud.LandVerdict("pending"),
            ),
            (
                {"verdict": "unknown", "unknown_reason": "land_record_probe_failed"},
                followups_crud.LandVerdict(
                    "unknown", unknown_reason="land_record_probe_failed"
                ),
            ),
            (
                "landed",
                followups_crud.LandVerdict(
                    "unknown", unknown_reason="coord_body_not_an_object"
                ),
            ),
        ],
    )
    async def test_parse_land_verdict(self, payload: Any, expected: Any) -> None:
        assert followups_crud.parse_land_verdict(payload) == expected


# ───────────────────────────── the scheduled task ─────────────────────────────


class _FakeResult:
    def __init__(self, value: bool) -> None:
        self._value = value

    def scalar(self) -> bool:
        return self._value


class _FakeConn:
    async def execution_options(self, **_: Any) -> _FakeConn:
        return self

    async def execute(self, stmt: Any, params: Any = None) -> _FakeResult:
        del stmt, params
        return _FakeResult(True)


class _FakeLockEngine:
    """Grants every advisory lock — the lock path is ``test_scheduler``'s
    subject, not this file's."""

    @contextlib.asynccontextmanager
    async def connect(self) -> AsyncIterator[_FakeConn]:
        yield _FakeConn()


def _shared(session: AsyncSession):
    """A session factory that hands the job the TEST's session (rolled back
    after the test), so the job sees the rows the test wrote."""

    @contextlib.asynccontextmanager
    async def factory() -> AsyncIterator[AsyncSession]:
        yield session

    return factory


async def _wait_for(predicate, timeout: float = 15.0) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.05)
    return False


def _task(session: AsyncSession, client: Any) -> ScheduledTask:
    """The registered task's name and cadence, its job wired to test seams,
    due now (so the first tick fires it once; the next is 900 s away)."""
    task = ScheduledTask(
        name="followup_reconcile",
        coro=lambda: job.run_followup_reconcile(
            session_factory=_shared(session), client=client
        ),
        interval_seconds=900.0,
    )
    task.next_run_at = datetime.now(UTC) - timedelta(seconds=1)
    return task


class TestScheduledTask:
    async def test_the_module_scheduler_registers_it(self) -> None:
        from app.core.scheduler import scheduler

        status = scheduler.status()
        assert status["followup_reconcile"]["cadence"] == "interval:900.0s"
        assert scheduler._tasks["followup_reconcile"].run_at_boot is True

    async def test_one_tick_moves_a_landed_row_and_reopens_an_unlanded_one(
        self, async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv(
            "QONTINUI_SCHEDULER_FOLLOWUP_RECONCILE_ENABLED", raising=False
        )
        landed = await _crud_fixing(async_db_session, "ticklanded", 1)
        unlanded = await _crud_fixing(async_db_session, "tickunlanded", 2)
        coord = _StubCoord({1: _landed(), 2: _verdict("closed_unlanded")})

        service = SchedulerService(lock_engine=_FakeLockEngine())
        service.register(_task(async_db_session, coord))
        await service.start()
        try:
            assert await _wait_for(
                lambda: service.status()["followup_reconcile"]["last_status"]
                is not None
            )
        finally:
            await service.stop()

        assert service.status()["followup_reconcile"]["last_status"] == "ok"
        await async_db_session.refresh(landed)
        await async_db_session.refresh(unlanded)
        assert landed.resolution == "fixed"
        assert landed.resolution_commit == COMMIT
        assert landed.resolved_by == job.ACTOR
        assert unlanded.resolution is None
        assert unlanded.resolution_history[-1]["to"] == "open"
        assert len(coord.calls) == 2

    async def test_with_the_kill_switch_off_nothing_moves(
        self, async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("QONTINUI_SCHEDULER_FOLLOWUP_RECONCILE_ENABLED", "0")
        edge = await _crud_fixing(async_db_session, "killed", 1)
        coord = _StubCoord({1: _landed()})

        service = SchedulerService(lock_engine=_FakeLockEngine())
        service.register(_task(async_db_session, coord))
        await service.start()
        try:
            await asyncio.sleep(0.8)
        finally:
            await service.stop()

        status = service.status()["followup_reconcile"]
        assert status["enabled"] is False
        assert status["last_run_at"] is None
        assert coord.calls == []
        await async_db_session.refresh(edge)
        assert edge.resolution == "fixing"

    async def test_a_disabled_service_account_moves_nothing_and_counts_unknown(
        self, async_db_session: AsyncSession
    ) -> None:
        edges = [await _crud_fixing(async_db_session, f"noacct{n}", n) for n in (1, 2)]
        client = _DisabledClient()
        result = await job.run_followup_reconcile(
            session_factory=_shared(async_db_session), client=client
        )
        assert result["migration_applied"] is True
        assert result["coord_available"] is False
        assert "COORD_ADMIN_SECRET" in result["coord_unavailable_reason"]
        assert result["unknown"] == result["examined"] >= 2
        assert result["unknown_reasons"]["coord_unavailable"] >= 2
        assert client.calls == []
        for edge in edges:
            await async_db_session.refresh(edge)
            assert edge.resolution == "fixing"

    async def test_a_refused_service_credential_trips_after_one_read(
        self, async_db_session: AsyncSession
    ) -> None:
        edges = [await _crud_fixing(async_db_session, f"refused{n}", n) for n in (1, 2)]
        coord = _StubCoord({1: (401, {"error": "unauthorized"}), 2: (401, {})})
        result = await job.run_followup_reconcile(
            session_factory=_shared(async_db_session), client=coord
        )
        assert result["coord_available"] is False
        assert "401" in result["coord_unavailable_reason"]
        assert len(coord.calls) == 1
        assert result["fixed"] == 0
        for edge in edges:
            await async_db_session.refresh(edge)
            assert edge.resolution == "fixing"

    async def test_a_transport_failure_trips_and_moves_nothing(
        self, async_db_session: AsyncSession
    ) -> None:
        edge = await _crud_fixing(async_db_session, "transport", 1)
        coord = _StubCoord({1: httpx.ConnectError("refused")})
        result = await job.run_followup_reconcile(
            session_factory=_shared(async_db_session), client=coord
        )
        assert result["coord_available"] is False
        assert "unreachable" in result["coord_unavailable_reason"]
        await async_db_session.refresh(edge)
        assert edge.resolution == "fixing"

    async def test_an_unmigrated_database_is_reported_not_crashed(
        self, async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from sqlalchemy import text

        monkeypatch.setattr(job, "_MIGRATED_SQL", text("SELECT false"))
        coord = _StubCoord({})
        result = await job.run_followup_reconcile(
            session_factory=_shared(async_db_session), client=coord
        )
        assert result == {"migration_applied": False}
        assert coord.calls == []
