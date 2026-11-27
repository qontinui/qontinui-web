"""Correcting a recorded provenance edge — ``DELETE`` / ``PUT /plan-library/edges/{id}``.

Phase 5 of
``2026-09-20-a-recorded-delivery-scope-is-permanent-so-a-mis-declared-phase-is-uncorrectable``
(adopting qontinui-web#1459). Before it, ``POST /{id}/edges`` was the only
verb an edge had, so a wrong ``supersedes`` could only be buried beside a right
one. What is pinned:

* **Retract** stamps who / when / why, keeps the row, and removes the edge from
  EVERY reader: the detail and edges reads (unless ``include_retracted``), the
  create dedup (the same triple re-records as a NEW live edge), the follow-up
  queue, every resolved view, ``/followups/match``, the reconcile walk and the
  follow-up write doors, ``/candidates``' ``depends_on`` join and the
  prompt-chain walk. A second retraction is a 409 carrying the first, and a
  retraction committed after a write door's read is still seen under its lock.
  A retracted follow-up reads ``state: "retracted"``.
* **Correct** replaces relation / to_id / note in place, stamps
  ``source: "corrected"``, and keeps the replaced claim — a second correction
  nests the first. Restating the claim writes nothing (``changed: false``); a
  collision with a live edge (pre-checked, and backstopped on the unique
  index), a retracted edge, and follow-up state the new claim cannot hold are
  each a distinct 409.
* A ``POST`` re-post locks the row its dedup finds — the follow-up re-post
  that fills facts onto it and a plain two-ended one — so a peer's retraction
  or re-note in flight is waited for and then seen: the re-post records a
  fresh live edge instead.
* **GET /{id}/edges** exists (it used to 405) and serves the detail's edges;
  **GET /edges/{id}** reads one edge by id, retracted ones included.

Real Postgres via the shared ``async_db_session``; HTTP through
``httpx.ASGITransport`` so the handler shares the session's loop.
"""

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.crud import work_artifact as crud
from app.crud import work_artifact_followups as followups_crud
from app.models.work_artifact import WorkArtifact, WorkArtifactEdge

API_PREFIX = "/api/v1/plan-library"
REPO = "qontinui/qontinui-web"

pytestmark = pytest.mark.asyncio


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    """Both plan-library routers, the follow-up doors FIRST as
    ``app/api/v1/api.py`` mounts them, with db + both auth dependencies
    overridden."""
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.plan_library import router as plan_library_router
    from app.api.v1.endpoints.plan_library_followups import (
        router as followups_router,
    )

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user
    app.dependency_overrides[current_active_user_optional] = lambda: user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(followups_router, prefix=API_PREFIX)
    app.include_router(plan_library_router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"edgefix_{uuid4().hex[:8]}@example.com",
        username=f"edgefix_{uuid4().hex[:8]}",
        full_name="Edge Correction Tester",
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
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http_client:
        yield http_client


async def _artifact(client: httpx.AsyncClient, stem: str, kind: str = "plan") -> str:
    resp = await client.post(
        API_PREFIX,
        json={
            "kind": kind,
            "slug": _slug(stem),
            "title": f"{stem} title",
            "status": "VETTED",
            "body": f"# {stem}\n\n{uuid4().hex}",
        },
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["artifact"]["id"])


async def _edge(
    client: httpx.AsyncClient,
    from_id: str,
    *,
    relation: str,
    to_id: str | None,
    note: str | None = None,
    **extra: object,
) -> dict:
    resp = await client.post(
        f"{API_PREFIX}/{from_id}/edges",
        json={"relation": relation, "to_id": to_id, "note": note, **extra},
    )
    assert resp.status_code in (200, 201), resp.text
    return dict(resp.json())


async def _retract(
    client: httpx.AsyncClient, edge_id: str, reason: str = "recorded by mistake"
) -> httpx.Response:
    return await client.request(
        "DELETE", f"{API_PREFIX}/edges/{edge_id}", json={"reason": reason}
    )


async def _correct(
    client: httpx.AsyncClient,
    edge_id: str,
    *,
    relation: str,
    to_id: str | None,
    note: str | None,
    reason: str = "the claim was wrong",
) -> httpx.Response:
    return await client.put(
        f"{API_PREFIX}/edges/{edge_id}",
        json={"relation": relation, "to_id": to_id, "note": note, "reason": reason},
    )


async def _detail_edge_ids(
    client: httpx.AsyncClient, artifact_id: str, **params: str
) -> list[str]:
    resp = await client.get(f"{API_PREFIX}/{artifact_id}", params=params)
    assert resp.status_code == 200, resp.text
    return [e["id"] for e in resp.json()["edges"]]


async def _edges_read(
    client: httpx.AsyncClient, artifact_id: str, **params: str
) -> dict:
    resp = await client.get(f"{API_PREFIX}/{artifact_id}/edges", params=params)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


# ═══════════════════════════════ retract ═══════════════════════════════


class TestRetract:
    async def test_a_retracted_edge_leaves_the_reads_and_keeps_its_provenance(
        self, client: httpx.AsyncClient, api_user
    ) -> None:
        a = await _artifact(client, "retract-a")
        b = await _artifact(client, "retract-b")
        edge = await _edge(client, a, relation="supersedes", to_id=b)
        assert edge["retracted_at"] is None and edge["source"] is None

        resp = await _retract(client, edge["id"], "b is a follow-up, not a predecessor")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == edge["id"]
        assert body["retracted_at"] is not None
        assert body["retracted_by"] == api_user.email
        assert body["retracted_reason"] == "b is a follow-up, not a predecessor"

        # Gone from both ends' ordinary reads …
        for artifact in (a, b):
            assert await _detail_edge_ids(client, artifact) == []
            assert await _edges_read(client, artifact) == {"items": [], "count": 0}
        # … and still there, stamped, for an audit read.
        kept = await _edges_read(client, a, include_retracted="true")
        assert kept["count"] == 1
        assert kept["items"][0]["retracted_reason"] == body["retracted_reason"]
        assert await _detail_edge_ids(client, b, include_retracted="true") == [
            edge["id"]
        ]

    async def test_a_second_retraction_is_a_409_carrying_the_first(
        self, client: httpx.AsyncClient
    ) -> None:
        a = await _artifact(client, "twice-a")
        b = await _artifact(client, "twice-b")
        edge = await _edge(client, a, relation="feeds", to_id=b)
        assert (await _retract(client, edge["id"], "first reason")).status_code == 200

        again = await _retract(client, edge["id"], "second reason")
        assert again.status_code == 409, again.text
        detail = again.json()["detail"]
        assert detail["error"] == "edge_retracted"
        assert detail["edge_id"] == edge["id"]
        assert detail["retracted_reason"] == "first reason"
        kept = await _edges_read(client, a, include_retracted="true")
        assert kept["items"][0]["retracted_reason"] == "first reason"

    @pytest.mark.parametrize(
        "body",
        [{}, {"reason": ""}, {"reason": "   "}, {"reason": "x", "extra": 1}],
        ids=["missing", "empty", "blank", "unknown-key"],
    )
    async def test_a_retraction_needs_a_reason(
        self, client: httpx.AsyncClient, body: dict
    ) -> None:
        a = await _artifact(client, "reason-a")
        b = await _artifact(client, "reason-b")
        edge = await _edge(client, a, relation="feeds", to_id=b)
        resp = await client.request(
            "DELETE", f"{API_PREFIX}/edges/{edge['id']}", json=body
        )
        assert resp.status_code == 422, resp.text
        assert await _detail_edge_ids(client, a) == [edge["id"]]

    async def test_an_unknown_edge_is_404(self, client: httpx.AsyncClient) -> None:
        resp = await _retract(client, str(uuid4()))
        assert resp.status_code == 404, resp.text

    async def test_another_orgs_edge_is_404(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """Edges carry no org; the scope is the originating artifact's."""
        other_org = uuid4()
        a, _, _ = await crud.upsert_artifact(
            async_db_session,
            org_id=other_org,
            user_id=None,
            kind="plan",
            slug=_slug("foreign-a"),
            title="t",
            status="",
            body=uuid4().hex,
            source_path=None,
            source_repo=None,
            work_unit_slug=None,
            repos=[],
            intent_refs=[],
            authored_at=None,
            captured_by="agent",
            change_description=None,
            created_by="test",
        )
        edge, _ = await crud.create_edge(
            async_db_session,
            from_artifact=a,
            to_artifact=None,
            relation="spawned_followup",
            note="someone else's follow-up",
            created_by="test",
        )
        assert (await _retract(client, str(edge.id))).status_code == 404
        correct = await _correct(
            client, str(edge.id), relation="spawned_followup", to_id=None, note="x"
        )
        assert correct.status_code == 404
        read = await client.get(f"{API_PREFIX}/edges/{edge.id}")
        assert read.status_code == 404, read.text
        # Re-read from the database: none of the refused writes touched it.
        stored = (
            await async_db_session.execute(
                select(WorkArtifactEdge)
                .where(WorkArtifactEdge.id == edge.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert (stored.retracted_at, stored.source, stored.note) == (
            None,
            None,
            "someone else's follow-up",
        )

    async def test_replace_is_retract_then_create(
        self, client: httpx.AsyncClient
    ) -> None:
        """The partial unique index admits the same triple again once the first
        is retracted — and the create dedup must not hand back the dead row."""
        a = await _artifact(client, "rerecord-a")
        b = await _artifact(client, "rerecord-b")
        first = await _edge(client, a, relation="depends_on", to_id=b)
        assert (await _retract(client, first["id"])).status_code == 200

        resp = await client.post(
            f"{API_PREFIX}/{a}/edges", json={"relation": "depends_on", "to_id": b}
        )
        assert resp.status_code == 201, resp.text
        second = resp.json()
        assert second["id"] != first["id"] and second["retracted_at"] is None
        assert await _detail_edge_ids(client, a) == [second["id"]]
        assert set(await _detail_edge_ids(client, a, include_retracted="true")) == {
            first["id"],
            second["id"],
        }

    async def test_a_retracted_dependency_stops_blocking_and_a_retracted_link_produced_nothing(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        plan = await _artifact(client, "dep-plan")
        prereq = await _artifact(client, "dep-prereq")
        report = await _artifact(client, "dep-report", kind="investigation_report")
        dep = await _edge(client, plan, relation="depends_on", to_id=prereq)
        feed = await _edge(client, report, relation="feeds", to_id=plan)

        plan_id = UUID(plan)
        assert [
            t.id
            for t in (await crud.load_depends_on(async_db_session, [plan_id]))[plan_id]
        ] == [UUID(prereq)]
        chain = (await crud.load_prompt_chains(async_db_session, [plan_id]))[plan_id]
        assert [p.id for p, _, _ in chain] == [UUID(report)]

        assert (await _retract(client, dep["id"])).status_code == 200
        assert (await _retract(client, feed["id"])).status_code == 200
        assert (await crud.load_depends_on(async_db_session, [plan_id]))[plan_id] == []
        assert (await crud.load_prompt_chains(async_db_session, [plan_id]))[
            plan_id
        ] == []


class TestRetractedFollowup:
    async def test_a_retracted_followup_leaves_the_queue_and_refuses_every_write(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _artifact(client, "fu-plan")
        owner = await _artifact(client, "fu-owner")
        note = f"follow-up {uuid4().hex[:6]}"
        followup = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note=note
        )

        def _queued(body: dict) -> bool:
            return any(item["edge_id"] == followup["id"] for item in body["items"])

        queue = await client.get(f"{API_PREFIX}/followups", params={"limit": "200"})
        assert queue.status_code == 200 and _queued(queue.json()), queue.text

        assert (await _retract(client, followup["id"])).status_code == 200
        queue = await client.get(f"{API_PREFIX}/followups", params={"limit": "200"})
        assert queue.status_code == 200 and not _queued(queue.json())
        dismissed = await client.get(
            f"{API_PREFIX}/followups", params={"state": "dismissed", "limit": "200"}
        )
        assert dismissed.status_code == 200 and not _queued(dismissed.json())

        writes = [
            await client.post(
                f"{API_PREFIX}/edges/{followup['id']}/resolution",
                json={"resolution": "dismissed", "resolution_note": "no"},
            ),
            await client.put(
                f"{API_PREFIX}/edges/{followup['id']}/anchors",
                json={"anchors": [{"repo": REPO, "path": "backend/app/x.py"}]},
            ),
            await client.patch(
                f"{API_PREFIX}/edges/{followup['id']}", json={"to_id": owner}
            ),
        ]
        for resp in writes:
            assert resp.status_code == 409, resp.text
            assert resp.json()["detail"]["error"] == "edge_retracted", resp.text

        # The same note may be surfaced again — as a new, live follow-up.
        again = await client.post(
            f"{API_PREFIX}/{plan}/edges",
            json={"relation": "spawned_followup", "to_id": None, "note": note},
        )
        assert again.status_code == 201, again.text
        assert again.json()["id"] != followup["id"]

    async def test_a_retraction_committed_after_the_routes_read_is_seen_under_the_lock(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        """The doors pre-check, but every write re-checks under its row lock.
        The retraction lands through raw SQL, AFTER the route-style
        ``get_edge`` read cached the row live — so this passes only if each
        locked select re-reads the row rather than trusting the session's
        identity map (``populate_existing``)."""
        plan = await _artifact(client, "lock-plan")
        owner = await _artifact(client, "lock-owner")
        org_id = (await client.get(f"{API_PREFIX}/{plan}")).json()["organization_id"]
        org = UUID(org_id) if org_id else None

        async def _cached_then_retracted(note: str) -> WorkArtifactEdge:
            followup = await _edge(
                client, plan, relation="spawned_followup", to_id=None, note=note
            )
            found = await crud.get_edge(
                async_db_session, UUID(followup["id"]), org_id=org
            )
            assert found is not None
            edge = found[0]
            assert edge.retracted_at is None  # the caller's read: live
            await async_db_session.execute(
                text(
                    "UPDATE agent.work_artifact_edges SET retracted_at = now(), "
                    "retracted_by = 'peer', retracted_reason = 'raced' "
                    "WHERE id = :id"
                ),
                {"id": edge.id},
            )
            assert edge.retracted_at is None  # the identity map did not see it
            return edge

        # No rollback anywhere: this harness's session joins an outer
        # transaction, and a rollback would discard the rows themselves.
        edge = await _cached_then_retracted("raced claim")
        with pytest.raises(crud.EdgeRetracted):
            await crud.claim_followup(async_db_session, edge.id, UUID(owner))
        assert edge.to_id is None

        edge = await _cached_then_retracted("raced transition")
        with pytest.raises(crud.EdgeRetracted):
            await followups_crud.transition_followup(
                async_db_session, edge.id, to="dismissed", actor="t", note="n"
            )

        edge = await _cached_then_retracted("raced correction")
        with pytest.raises(crud.EdgeRetracted):
            await crud.correct_edge(
                async_db_session,
                edge.id,
                relation="spawned_followup",
                to_id=None,
                note="rewritten",
                reason="r",
                actor="t",
            )

        edge = await _cached_then_retracted("raced retraction")
        with pytest.raises(crud.EdgeRetracted) as second:
            await crud.retract_edge(async_db_session, edge.id, reason="r", actor="t")
        # The 409 carries the retraction that won, not the caller's.
        assert second.value.retracted_reason == "raced"

    async def test_a_followup_re_related_after_the_routes_read_is_refused_under_the_lock(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """``PUT /edges/{id}`` can re-relate a bare follow-up, so the claim and
        anchor doors re-check ``relation`` under the lock too. The re-relate
        lands through raw SQL right AFTER each route's own read (the claim
        route's ``get_edge``, the anchor route's ``_resolve_followup``), so it
        reaches the lock rather than the route's pre-check. The answer is the
        route's own 422 "not a follow-up", never "already claimed" by the new
        ``to_id``."""
        from app.api.v1.endpoints import plan_library_followups as followups_route

        plan = await _artifact(client, "rerelate-plan")
        owner = await _artifact(client, "rerelate-owner")
        # One target per follow-up: two re-related rows from one plan to one
        # target would collide on the live (from, to, relation) index.
        targets = [
            UUID(await _artifact(client, "rerelate-target-a")),
            UUID(await _artifact(client, "rerelate-target-b")),
        ]
        rerelated: list[UUID] = []

        async def _rerelate(edge_id: UUID) -> None:
            await async_db_session.execute(
                text(
                    "UPDATE agent.work_artifact_edges SET relation = 'depends_on', "
                    "to_id = :to WHERE id = :id"
                ),
                {"id": edge_id, "to": targets[len(rerelated)]},
            )
            rerelated.append(edge_id)

        real_get_edge = crud.get_edge

        async def _get_edge_then_rerelate(db, edge_id, *, org_id):
            found = await real_get_edge(db, edge_id, org_id=org_id)
            await _rerelate(edge_id)
            return found

        followup = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="claimed"
        )
        monkeypatch.setattr(crud, "get_edge", _get_edge_then_rerelate)
        claim = await client.patch(
            f"{API_PREFIX}/edges/{followup['id']}", json={"to_id": owner}
        )
        monkeypatch.setattr(crud, "get_edge", real_get_edge)
        assert claim.status_code == 422, claim.text
        assert "already two-ended" in claim.json()["detail"], claim.text

        real_resolve = followups_route._resolve_followup

        async def _resolve_then_rerelate(db, edge_id, user):
            found = await real_resolve(db, edge_id, user)
            await _rerelate(edge_id)
            return found

        followup = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="anchored"
        )
        monkeypatch.setattr(
            followups_route, "_resolve_followup", _resolve_then_rerelate
        )
        anchors = await client.put(
            f"{API_PREFIX}/edges/{followup['id']}/anchors",
            json={"anchors": [{"repo": REPO, "path": "backend/app/x.py"}]},
        )
        monkeypatch.setattr(followups_route, "_resolve_followup", real_resolve)
        assert anchors.status_code == 422, anchors.text
        assert "spawned_followup" in anchors.json()["detail"], anchors.text
        assert len(rerelated) == 2

    async def test_a_retracted_followup_drops_out_of_every_resolved_view(
        self, client: httpx.AsyncClient
    ) -> None:
        """``UNCLAIMED_FOLLOWUP_SQL``'s liveness clause — the only one the
        resolved views read — not just the open queue's."""
        plan = await _artifact(client, "resolved-plan")
        followup = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="gone"
        )
        dismissed = await client.post(
            f"{API_PREFIX}/edges/{followup['id']}/resolution",
            json={"resolution": "dismissed", "resolution_note": "not needed"},
        )
        assert dismissed.status_code == 200, dismissed.text

        async def _in_view(state: str) -> bool:
            resp = await client.get(
                f"{API_PREFIX}/followups", params={"state": state, "limit": "200"}
            )
            assert resp.status_code == 200, resp.text
            return any(i["edge_id"] == followup["id"] for i in resp.json()["items"])

        # Non-vacuous: it IS in both views before the retraction.
        assert await _in_view("dismissed") and await _in_view("resolved")
        assert (await _retract(client, followup["id"])).status_code == 200
        assert not await _in_view("dismissed")
        assert not await _in_view("resolved")

        read = await client.get(f"{API_PREFIX}/edges/{followup['id']}")
        assert read.status_code == 200, read.text
        facts = read.json()["followup"]
        # Its old resolution is history; what it IS now is retracted.
        assert (facts["state"], facts["resolution"]) == ("retracted", "dismissed")

    async def test_a_retracted_fixing_followup_is_neither_matched_nor_reconciled(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        plan = await _artifact(client, "fixing-plan")
        org_id = (await client.get(f"{API_PREFIX}/{plan}")).json()["organization_id"]
        path = f"backend/app/retracted_{uuid4().hex[:8]}.py"
        pr_number = 40_000 + int(uuid4().int % 10_000)
        followup = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="held"
        )
        anchored = await client.put(
            f"{API_PREFIX}/edges/{followup['id']}/anchors",
            json={"anchors": [{"repo": REPO, "path": path}]},
        )
        assert anchored.status_code == 200, anchored.text
        moved = await client.post(
            f"{API_PREFIX}/edges/{followup['id']}/resolution",
            json={"resolution": "fixing", "resolution_pr": f"{REPO}#{pr_number}"},
        )
        assert moved.status_code == 200, moved.text

        async def _matched() -> bool:
            resp = await client.post(
                f"{API_PREFIX}/followups/match", json={"repo": REPO, "paths": [path]}
            )
            assert resp.status_code == 200, resp.text
            return any(i["edge_id"] == followup["id"] for i in resp.json()["items"])

        class _Reader:
            available = True
            unavailable_reason = None

            def __init__(self) -> None:
                self.reads: list[tuple[str, int]] = []

            async def read(
                self, repo: str, pr_number: int
            ) -> followups_crud.LandVerdict:
                self.reads.append((repo, pr_number))
                return followups_crud.LandVerdict("landed", "a" * 40, "merged")

        async def _reconciled_prs() -> list[tuple[str, int]]:
            reader = _Reader()
            await followups_crud.reconcile_fixing_followups(
                async_db_session,
                reader=reader,
                actor="test",
                org_id=UUID(org_id) if org_id else None,
            )
            return reader.reads

        # Non-vacuous: the match sees it while it is live. (The reconcile is
        # only asked AFTER the retraction — before it, a landed verdict would
        # move the row to ``fixed`` and the test would prove nothing.)
        assert await _matched()
        assert (await _retract(client, followup["id"])).status_code == 200
        assert not await _matched()
        assert (REPO, pr_number) not in await _reconciled_prs()
        edge = (
            await async_db_session.execute(
                select(WorkArtifactEdge)
                .where(WorkArtifactEdge.id == UUID(followup["id"]))
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert edge.resolution == "fixing"  # the reconcile wrote nothing to it


# ═══════════════════════════════ correct ═══════════════════════════════


class TestCorrect:
    async def test_a_correction_replaces_the_claim_and_keeps_the_old_one(
        self, client: httpx.AsyncClient, api_user
    ) -> None:
        a = await _artifact(client, "fix-a")
        b = await _artifact(client, "fix-b")
        c = await _artifact(client, "fix-c")
        edge = await _edge(client, a, relation="supersedes", to_id=b, note="v1")

        resp = await _correct(
            client,
            edge["id"],
            relation="depends_on",
            to_id=c,
            note="v2",
            reason="it was a prerequisite",
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["id"], body["from_id"], body["created_at"]) == (
            edge["id"],
            edge["from_id"],
            edge["created_at"],
        )
        assert (body["relation"], body["to_id"], body["note"]) == (
            "depends_on",
            c,
            "v2",
        )
        assert body["source"] == "corrected"
        assert body["changed"] is True
        assert body["corrected_by"] == api_user.email
        assert body["corrected_reason"] == "it was a prerequisite"
        assert body["corrected_at"] is not None
        assert body["peer_slug"] is not None
        first = body["corrected_replaced"]
        assert first == {
            "relation": "supersedes",
            "to_id": b,
            "note": "v1",
            "source": None,
            "corrected_at": None,
            "corrected_by": None,
            "corrected_reason": None,
            "replaced": None,
        }

        # A second correction nests the first — the chain survives.
        resp = await _correct(
            client,
            edge["id"],
            relation="depends_on",
            to_id=c,
            note="v3",
            reason="note wording",
        )
        assert resp.status_code == 200, resp.text
        second = resp.json()["corrected_replaced"]
        assert (second["note"], second["source"]) == ("v2", "corrected")
        assert second["corrected_reason"] == "it was a prerequisite"
        assert second["replaced"] == first

        # Both reads render the corrected edge, and only it.
        detail = await client.get(f"{API_PREFIX}/{a}")
        (rendered,) = detail.json()["edges"]
        assert rendered["note"] == "v3" and rendered["source"] == "corrected"
        assert (await _edges_read(client, a))["items"] == detail.json()["edges"]
        assert await _detail_edge_ids(client, b) == []
        assert await _detail_edge_ids(client, c) == [edge["id"]]

    async def test_correcting_only_the_note(self, client: httpx.AsyncClient) -> None:
        """The shape of the post-deploy fix this phase owes: a count in a note."""
        a = await _artifact(client, "note-a")
        b = await _artifact(client, "note-b")
        edge = await _edge(
            client, a, relation="produced_report", to_id=b, note="1 of 117"
        )
        resp = await _correct(
            client,
            edge["id"],
            relation="produced_report",
            to_id=b,
            note="1 of 119",
            reason="retraction v2 corrected the count",
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["note"] == "1 of 119"
        assert resp.json()["corrected_replaced"]["note"] == "1 of 117"
        # Verified by reading it back, not by the write's own 200.
        read = await client.get(f"{API_PREFIX}/edges/{edge['id']}")
        assert read.status_code == 200, read.text
        assert (read.json()["note"], read.json()["source"]) == ("1 of 119", "corrected")

    async def test_restating_the_claim_writes_nothing(
        self, client: httpx.AsyncClient
    ) -> None:
        a = await _artifact(client, "same-a")
        b = await _artifact(client, "same-b")
        edge = await _edge(client, a, relation="feeds", to_id=b, note="n")
        resp = await _correct(client, edge["id"], relation="feeds", to_id=b, note="n")
        assert resp.status_code == 200, resp.text
        assert resp.json()["changed"] is False
        assert resp.json()["source"] is None
        assert resp.json()["corrected_replaced"] is None
        assert resp.json()["corrected_reason"] is None  # this reason: not recorded

    async def test_a_correction_onto_a_live_edges_claim_is_a_409_naming_it(
        self, client: httpx.AsyncClient
    ) -> None:
        a = await _artifact(client, "clash-a")
        b = await _artifact(client, "clash-b")
        c = await _artifact(client, "clash-c")
        held = await _edge(client, a, relation="depends_on", to_id=b)
        moving = await _edge(client, a, relation="depends_on", to_id=c)
        resp = await _correct(
            client, moving["id"], relation="depends_on", to_id=b, note=None
        )
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "edge_correction_conflict"
        assert detail["existing_edge_id"] == held["id"]
        # Nothing moved.
        rows = (await _edges_read(client, a))["items"]
        assert {(e["id"], e["to_id"]) for e in rows} == {
            (held["id"], b),
            (moving["id"], c),
        }

    async def test_a_retracted_claim_does_not_block_a_correction_onto_it(
        self, client: httpx.AsyncClient
    ) -> None:
        a = await _artifact(client, "dead-a")
        b = await _artifact(client, "dead-b")
        c = await _artifact(client, "dead-c")
        dead = await _edge(client, a, relation="depends_on", to_id=b)
        assert (await _retract(client, dead["id"])).status_code == 200
        moving = await _edge(client, a, relation="depends_on", to_id=c)
        resp = await _correct(
            client, moving["id"], relation="depends_on", to_id=b, note=None
        )
        assert resp.status_code == 200, resp.text

    async def test_a_retracted_edge_cannot_be_corrected(
        self, client: httpx.AsyncClient
    ) -> None:
        a = await _artifact(client, "corr-dead-a")
        b = await _artifact(client, "corr-dead-b")
        edge = await _edge(client, a, relation="feeds", to_id=b)
        assert (await _retract(client, edge["id"], "withdrawn")).status_code == 200
        resp = await _correct(
            client, edge["id"], relation="supersedes", to_id=b, note=None
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "edge_retracted"
        assert resp.json()["detail"]["retracted_reason"] == "withdrawn"

    async def test_the_claim_is_validated_like_a_create(
        self, client: httpx.AsyncClient
    ) -> None:
        a = await _artifact(client, "valid-a")
        b = await _artifact(client, "valid-b")
        edge = await _edge(client, a, relation="feeds", to_id=b)
        url = f"{API_PREFIX}/edges/{edge['id']}"

        cases = [
            # a two-ended relation needs a target
            ({"relation": "feeds", "to_id": None, "note": None, "reason": "r"}, 422),
            # a follow-up needs a note
            (
                {
                    "relation": "spawned_followup",
                    "to_id": None,
                    "note": " ",
                    "reason": "r",
                },
                422,
            ),
            # no self-edge
            ({"relation": "feeds", "to_id": a, "note": None, "reason": "r"}, 422),
            # a full replace: every claim key is required
            ({"relation": "feeds", "reason": "r"}, 422),
            ({"relation": "feeds", "to_id": b, "note": None}, 422),
            ({"relation": "feeds", "to_id": b, "note": None, "reason": " "}, 422),
            ({"relation": "nonsense", "to_id": b, "note": None, "reason": "r"}, 422),
            # an unknown target
            (
                {
                    "relation": "feeds",
                    "to_id": str(uuid4()),
                    "note": None,
                    "reason": "r",
                },
                404,
            ),
        ]
        for body, expected in cases:
            resp = await client.put(url, json=body)
            assert resp.status_code == expected, (body, resp.text)
        rows = (await _edges_read(client, a))["items"]
        assert [(e["relation"], e["source"]) for e in rows] == [("feeds", None)]


class TestCorrectFollowup:
    async def test_follow_up_state_refuses_a_relation_that_cannot_hold_it(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _artifact(client, "fu-state-plan")
        other = await _artifact(client, "fu-state-other")
        resolved = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="resolved one"
        )
        resp = await client.post(
            f"{API_PREFIX}/edges/{resolved['id']}/resolution",
            json={"resolution": "dismissed", "resolution_note": "not worth it"},
        )
        assert resp.status_code == 200, resp.text
        anchored = await _edge(
            client,
            plan,
            relation="spawned_followup",
            to_id=None,
            note="anchored one",
            anchors=[{"repo": REPO, "path": "backend/app/x.py"}],
        )

        for edge in (resolved, anchored):
            resp = await _correct(
                client, edge["id"], relation="depends_on", to_id=other, note=None
            )
            assert resp.status_code == 409, resp.text
            assert resp.json()["detail"]["error"] == "edge_correction_refused"

        # A resolved follow-up gets no owner through the correction either.
        resp = await _correct(
            client,
            resolved["id"],
            relation="spawned_followup",
            to_id=other,
            note="resolved one",
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "edge_correction_refused"

    async def test_an_unresolved_followups_note_is_correctable(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _artifact(client, "fu-note-plan")
        followup = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="typo'd"
        )
        resp = await _correct(
            client,
            followup["id"],
            relation="spawned_followup",
            to_id=None,
            note="fixed wording",
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["followup"]["state"] == "open"
        assert resp.json()["note"] == "fixed wording"

    async def test_a_correction_onto_an_open_followups_note_is_a_409(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _artifact(client, "fu-clash-plan")
        held = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="one"
        )
        moving = await _edge(
            client, plan, relation="spawned_followup", to_id=None, note="two"
        )
        resp = await _correct(
            client, moving["id"], relation="spawned_followup", to_id=None, note=" one "
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["existing_edge_id"] == held["id"]


# ═══════════════════════════════ GET /{id}/edges ═══════════════════════════════


class TestEdgesRead:
    async def test_it_serves_the_details_edges_both_ways(
        self, client: httpx.AsyncClient
    ) -> None:
        a = await _artifact(client, "read-a")
        b = await _artifact(client, "read-b")
        out = await _edge(client, a, relation="feeds", to_id=b)
        inc = await _edge(client, b, relation="depends_on", to_id=a)
        body = await _edges_read(client, a)
        assert body["count"] == 2
        assert {(e["id"], e["direction"]) for e in body["items"]} == {
            (out["id"], "outgoing"),
            (inc["id"], "incoming"),
        }
        detail = await client.get(f"{API_PREFIX}/{a}")
        assert body["items"] == detail.json()["edges"]

    async def test_an_unknown_artifact_is_404_not_an_empty_list(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.get(f"{API_PREFIX}/{uuid4()}/edges")
        assert resp.status_code == 404, resp.text


class TestCorrectionBackstop:
    """``correct_edge``'s IntegrityError arm: a holder committed BETWEEN the
    pre-write lookup and the write. It rolls back, so it runs on its own
    connection with ``join_transaction_mode="create_savepoint"`` — there a
    rollback returns to the last savepoint, where the shared
    ``async_db_session`` would discard the whole outer transaction."""

    async def test_a_holder_the_precheck_missed_is_a_409_naming_it(
        self, test_engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        org = uuid4()

        async def _crud_artifact(db: AsyncSession, stem: str):
            artifact, _, _ = await crud.upsert_artifact(
                db,
                org_id=org,
                user_id=None,
                kind="plan",
                slug=_slug(stem),
                title=stem,
                status="",
                body=uuid4().hex,
                source_path=None,
                source_repo=None,
                work_unit_slug=None,
                repos=[],
                intent_refs=[],
                authored_at=None,
                captured_by="agent",
                change_description=None,
                created_by="test",
            )
            return artifact

        async with test_engine.connect() as connection:
            outer = await connection.begin()
            db = AsyncSession(
                bind=connection,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            )
            try:
                a = await _crud_artifact(db, "backstop-a")
                b = await _crud_artifact(db, "backstop-b")
                c = await _crud_artifact(db, "backstop-c")
                held, _ = await crud.create_edge(
                    db,
                    from_artifact=a,
                    to_artifact=b,
                    relation="depends_on",
                    note=None,
                    created_by="test",
                )
                moving, _ = await crud.create_edge(
                    db,
                    from_artifact=a,
                    to_artifact=c,
                    relation="depends_on",
                    note=None,
                    created_by="test",
                )

                # Plain ids: the backstop's rollback expires every instance.
                held_id, moving_id, b_id, c_id = held.id, moving.id, b.id, c.id
                real = crud._correction_holder
                calls: list[UUID | None] = []

                async def _misses_the_first_time(*args, **kwargs):
                    # The race: the holder is invisible to the pre-write probe
                    # (committed after it), visible to the backstop's re-probe.
                    found = await real(*args, **kwargs)
                    calls.append(found)
                    return None if len(calls) == 1 else found

                monkeypatch.setattr(crud, "_correction_holder", _misses_the_first_time)
                with pytest.raises(crud.EdgeCorrectionConflict) as conflict:
                    await crud.correct_edge(
                        db,
                        moving_id,
                        relation="depends_on",
                        to_id=b_id,
                        note=None,
                        reason="r",
                        actor="t",
                    )
                assert calls == [held_id, held_id]  # probed, then re-probed
                assert isinstance(conflict.value.__cause__, IntegrityError)
                assert conflict.value.existing_edge_id == held_id

                # The rollback undid the stamps: the edge holds its old claim.
                row = (
                    await db.execute(
                        select(WorkArtifactEdge)
                        .where(WorkArtifactEdge.id == moving_id)
                        .execution_options(populate_existing=True)
                    )
                ).scalar_one()
                assert (row.to_id, row.source, row.corrected_replaced) == (
                    c_id,
                    None,
                    None,
                )
            finally:
                await db.close()
                await outer.rollback()


class TestEdgeById:
    async def test_it_reads_the_claim_a_put_must_restate_and_a_retraction(
        self, client: httpx.AsyncClient
    ) -> None:
        """A caller holding only an edge id can read the full claim, and a
        retracted edge is served stamped — never as not-found."""
        a = await _artifact(client, "byid-a")
        b = await _artifact(client, "byid-b")
        edge = await _edge(client, a, relation="feeds", to_id=b, note="n")

        read = await client.get(f"{API_PREFIX}/edges/{edge['id']}")
        assert read.status_code == 200, read.text
        body = read.json()
        assert (body["relation"], body["to_id"], body["note"]) == ("feeds", b, "n")
        assert (body["from_id"], body["direction"], body["peer_slug"]) == (
            a,
            "outgoing",
            edge["peer_slug"],
        )

        assert (await _retract(client, edge["id"], "withdrawn")).status_code == 200
        read = await client.get(f"{API_PREFIX}/edges/{edge['id']}")
        assert read.status_code == 200, read.text
        assert read.json()["retracted_reason"] == "withdrawn"
        assert read.json()["retracted_at"] is not None

    async def test_an_unknown_edge_is_404(self, client: httpx.AsyncClient) -> None:
        resp = await client.get(f"{API_PREFIX}/edges/{uuid4()}")
        assert resp.status_code == 404, resp.text


class TestRepostLocksTheRow:
    """``create_edge``'s dedup lookup LOCKS the row it finds — on the ``POST``
    re-post that fills anchors and a size class onto an existing follow-up
    (``on_write``) and on a plain two-ended re-post alike. A peer's retraction,
    re-note or re-relate, uncommitted when the lookup runs, makes the lookup wait; once
    the peer commits, Postgres re-checks the WHERE against the committed row,
    which no longer matches, and the re-post records a fresh live edge.
    Unlocked, the lookup reads the stale live row: it fills facts onto a
    withdrawn or re-noted follow-up, or answers "existing" with a withdrawn
    claim. Real commits on separate connections, so the rows are deleted by org
    afterwards."""

    @pytest.mark.parametrize(
        ("peer_set", "two_ended"),
        [
            (
                "retracted_at = now(), retracted_by = 'peer', "
                "retracted_reason = 'raced'",
                False,
            ),
            ("note = 'moved to another finding'", False),
            (
                "retracted_at = now(), retracted_by = 'peer', "
                "retracted_reason = 'raced'",
                True,
            ),
            ("relation = 'feeds'", True),
        ],
        ids=[
            "followup-retract",
            "followup-renote",
            "two-ended-retract",
            "two-ended-rerelate",
        ],
    )
    async def test_a_peer_write_in_flight_is_waited_for_then_seen(
        self, test_engine: AsyncEngine, peer_set: str, two_ended: bool
    ) -> None:
        org = uuid4()
        maker = async_sessionmaker(test_engine, expire_on_commit=False)
        seen: list[tuple[UUID, bool]] = []
        relation = "depends_on" if two_ended else "spawned_followup"
        note = None if two_ended else "the finding"

        async def record(edge: WorkArtifactEdge, created: bool) -> bool:
            seen.append((edge.id, created))
            return False

        async def plan(db: AsyncSession, stem: str) -> WorkArtifact:
            artifact, _, _ = await crud.upsert_artifact(
                db,
                org_id=org,
                user_id=None,
                kind="plan",
                slug=_slug(stem),
                title=stem,
                status="",
                body=uuid4().hex,
                source_path=None,
                source_repo=None,
                work_unit_slug=None,
                repos=[],
                intent_refs=[],
                authored_at=None,
                captured_by="agent",
                change_description=None,
                created_by="test",
            )
            return artifact

        async def repost(
            source: WorkArtifact, target: WorkArtifact | None
        ) -> tuple[WorkArtifactEdge, bool]:
            async with maker() as db:
                return await crud.create_edge(
                    db,
                    from_artifact=source,
                    to_artifact=target,
                    relation=relation,
                    note=note,
                    created_by="test",
                    on_write=None if two_ended else record,
                )

        try:
            async with maker() as db:
                source = await plan(db, "repost-lock")
                target = await plan(db, "repost-lock-to") if two_ended else None
                existing, _ = await crud.create_edge(
                    db,
                    from_artifact=source,
                    to_artifact=target,
                    relation=relation,
                    note=note,
                    created_by="test",
                )
                existing_id = existing.id

            async with test_engine.connect() as peer:
                peer_tx = await peer.begin()
                peer_pid = (
                    await peer.execute(text("SELECT pg_backend_pid()"))
                ).scalar_one()
                await peer.execute(
                    text(
                        f"UPDATE agent.work_artifact_edges SET {peer_set} WHERE id = :id"
                    ),
                    {"id": existing_id},
                )
                task = asyncio.create_task(repost(source, target))
                waiting = 0
                async with test_engine.connect() as probe:
                    for _ in range(400):
                        # Backends the PEER blocks — only the re-post can be one.
                        waiting = (
                            await probe.execute(
                                text(
                                    "SELECT count(*) FROM pg_stat_activity "
                                    "WHERE :peer = ANY(pg_blocking_pids(pid))"
                                ),
                                {"peer": peer_pid},
                            )
                        ).scalar_one()
                        if waiting or task.done():
                            break
                        await asyncio.sleep(0.05)
                # The re-post is parked on the peer's row lock, not done.
                assert (waiting, task.done()) == (1, False)
                await peer_tx.commit()

            edge, created = await asyncio.wait_for(task, timeout=30)
            assert created is True
            assert edge.id != existing_id
            assert seen == ([] if two_ended else [(edge.id, True)])
            async with maker() as db:
                rows = {
                    row.id: row
                    for row in (
                        await db.execute(
                            select(WorkArtifactEdge).where(
                                WorkArtifactEdge.from_id == source.id
                            )
                        )
                    ).scalars()
                }
            assert set(rows) == {existing_id, edge.id}
            assert (rows[edge.id].note, rows[edge.id].retracted_at) == (note, None)
        finally:
            async with maker() as db:
                await db.execute(
                    delete(WorkArtifact).where(WorkArtifact.organization_id == org)
                )
                await db.commit()
