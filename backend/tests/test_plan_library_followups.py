"""Identified-but-unowned follow-ups — the one-ended ``spawned_followup`` edge.

Phase 7 of ``2026-08-16-plan-corpus-authority-and-run-provenance``.

A plan routinely surfaces work it deliberately does not do ("worth its own
plan"). Before this phase that lived only as prose in the plan body: no
relation expressed it, an edge needed two endpoints, and nothing could answer
"show me follow-ups with no owning plan". These tests pin the three halves of
the fix — the write, the read, and the claim — plus the regression that would
make the relaxation dangerous.

The regression, spelled out because it is the reason the phase is risky:
``GET /plan-library/candidates`` computes each plan's UNMET dependencies by
joining ``depends_on`` edges through ``to_id``. A ``depends_on`` row with a
null target would drop out of that join and a blocked plan would read as ready.
So :class:`TestNullTargetIsRejectedForEveryOtherRelation` tries each of the five
pre-existing relations INDIVIDUALLY, at the HTTP layer, where the 422 has to
come from the endpoint rather than from an IntegrityError the DB CHECK raises.

Layering mirrors ``tests/test_plan_library_api.py``: ``httpx.AsyncClient`` over
``ASGITransport`` so the handler shares the test's asyncio loop and session.
"""

from __future__ import annotations

from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import work_artifact as crud
from app.models.work_artifact import WorkArtifact

API_PREFIX = "/api/v1/plan-library"

pytestmark = pytest.mark.asyncio

#: Every relation that existed before ``plan_library_03_spawned_followup``.
#: All five must still refuse a null target.
TWO_ENDED_RELATIONS = (
    "produced_report",
    "feeds",
    "authored_plan",
    "supersedes",
    "depends_on",
)

#: Every two-ended relation, including ``refutes`` — added by
#: ``plan_library_04_diagnostic_refutes`` AFTER the one-ended relaxation, so it
#: must be shown to have inherited the fence rather than assumed to.
ALL_TWO_ENDED_RELATIONS = (*TWO_ENDED_RELATIONS, "refutes")


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    """Mount the router with the db + both auth dependencies overridden."""
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
        email=f"followup_{uuid4().hex[:8]}@example.com",
        username=f"followup_{uuid4().hex[:8]}",
        full_name="Follow-up Tester",
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


async def _make_artifact(
    client: httpx.AsyncClient, *, stem: str, kind: str = "plan"
) -> str:
    """Create one artifact through the HTTP door and return its id."""
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
    return resp.json()["artifact"]["id"]


async def _spawn(
    client: httpx.AsyncClient, artifact_id: str, note: str
) -> httpx.Response:
    """POST the one-ended form exactly as the binding contract spells it."""
    return await client.post(
        f"{API_PREFIX}/{artifact_id}/edges",
        json={"relation": "spawned_followup", "note": note, "to_id": None},
    )


# ===========================================================================
# The write
# ===========================================================================


class TestOneEndedWrite:
    async def test_spawned_followup_is_accepted_with_a_null_target(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="origin")

        created = await _spawn(client, plan, "the constraint engine needs a plan")
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["relation"] == "spawned_followup"
        assert body["to_id"] is None
        assert body["from_id"] == plan
        assert body["direction"] == "outgoing"
        assert body["note"] == "the constraint engine needs a plan"
        # There is no far end, so there is nothing to denormalize.
        assert body["peer_kind"] is None
        assert body["peer_slug"] is None

    async def test_the_edge_is_visible_on_the_originating_artifact(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="visible")
        await _spawn(client, plan, "surfaced work")

        detail = await client.get(f"{API_PREFIX}/{plan}")
        assert detail.status_code == 200, detail.text
        edges = detail.json()["edges"]
        assert len(edges) == 1
        assert edges[0]["relation"] == "spawned_followup"
        assert edges[0]["to_id"] is None

    async def test_a_plan_may_surface_several_distinct_followups(
        self, client: httpx.AsyncClient
    ) -> None:
        """Two DIFFERENT notes are two findings, not a duplicate."""
        plan = await _make_artifact(client, stem="several")

        first = await _spawn(client, plan, "first finding")
        second = await _spawn(client, plan, "second finding")
        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        assert first.json()["id"] != second.json()["id"]

        listing = await client.get(f"{API_PREFIX}/followups")
        assert listing.json()["total"] == 2

    async def test_reposting_the_same_note_is_idempotent(
        self, client: httpx.AsyncClient
    ) -> None:
        """The corpus is fed by repeatable writers; a re-post is not a row.

        Keyed on ``(from_id, relation, btrim(note))`` — the same grain as the
        partial unique index — so a whitespace-only difference folds too.
        """
        plan = await _make_artifact(client, stem="repost")

        first = await _spawn(client, plan, "one finding")
        assert first.status_code == 201, first.text

        again = await _spawn(client, plan, "  one finding  ")
        assert again.status_code == 200, again.text
        assert again.json()["id"] == first.json()["id"]

        listing = await client.get(f"{API_PREFIX}/followups")
        assert listing.json()["total"] == 1

    @pytest.mark.parametrize("note", ["", "   ", "\n\t "])
    async def test_a_blank_note_is_rejected(
        self, client: httpx.AsyncClient, note: str
    ) -> None:
        """With no far end the note IS the payload — a blank one is a dead row."""
        plan = await _make_artifact(client, stem="blanknote")
        resp = await _spawn(client, plan, note)
        assert resp.status_code == 422, resp.text
        assert "note" in resp.text

    async def test_a_missing_note_is_rejected(self, client: httpx.AsyncClient) -> None:
        plan = await _make_artifact(client, stem="nonote")
        resp = await client.post(
            f"{API_PREFIX}/{plan}/edges",
            json={"relation": "spawned_followup", "to_id": None},
        )
        assert resp.status_code == 422, resp.text

    async def test_from_id_is_rejected_because_the_relation_is_outgoing(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="wrongdir")
        other = await _make_artifact(client, stem="wrongdir-peer")
        resp = await client.post(
            f"{API_PREFIX}/{plan}/edges",
            json={
                "relation": "spawned_followup",
                "from_id": other,
                "note": "backwards",
            },
        )
        assert resp.status_code == 422, resp.text
        assert "OUTGOING" in resp.text

    async def test_a_followup_may_also_be_written_already_owned(
        self, client: httpx.AsyncClient
    ) -> None:
        """``to_id`` supplied up front is legal and is NOT an open follow-up."""
        plan = await _make_artifact(client, stem="preowned")
        owner = await _make_artifact(client, stem="preowned-target")

        resp = await client.post(
            f"{API_PREFIX}/{plan}/edges",
            json={
                "relation": "spawned_followup",
                "to_id": owner,
                "note": "already has a home",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["to_id"] == owner

        listing = await client.get(f"{API_PREFIX}/followups")
        assert listing.json()["total"] == 0


# ===========================================================================
# The regression guard — every other relation still needs a target
# ===========================================================================


class TestNullTargetIsRejectedForEveryOtherRelation:
    """One test per relation, because a failure must name the relation.

    ``depends_on`` is the one with teeth: ``/candidates`` joins it through
    ``to_id`` to compute unmet dependencies, and a null-target row would drop
    out of the join and report a blocked plan as ready. The others are checked
    for the same reason it is worth checking a fence along its whole length.
    """

    @pytest.mark.parametrize("relation", ALL_TWO_ENDED_RELATIONS)
    async def test_null_target_is_a_422(
        self, client: httpx.AsyncClient, relation: str
    ) -> None:
        plan = await _make_artifact(client, stem=f"guard-{relation}")

        resp = await client.post(
            f"{API_PREFIX}/{plan}/edges",
            json={"relation": relation, "to_id": None, "note": "no target"},
        )
        assert resp.status_code == 422, (
            f"{relation} accepted a null target: {resp.status_code} {resp.text}"
        )
        # The endpoint answers, not the database — a 500 IntegrityError would
        # also "reject" it, and that is not the same guarantee.
        assert relation in resp.text
        assert "spawned_followup" in resp.text

    @pytest.mark.parametrize("relation", ALL_TWO_ENDED_RELATIONS)
    async def test_the_two_ended_form_still_works(
        self, client: httpx.AsyncClient, relation: str
    ) -> None:
        """The negative above must not be passing because the relation broke."""
        plan = await _make_artifact(client, stem=f"ok-{relation}")
        peer = await _make_artifact(client, stem=f"ok-{relation}-peer")

        resp = await client.post(
            f"{API_PREFIX}/{plan}/edges",
            json={"relation": relation, "to_id": peer},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["to_id"] == peer


class TestRefutesEdge:
    """``refutes`` — a measurement that FALSIFIES a standing claim.

    Plan ``2026-09-06-work-artifacts-kinds-and-edges-cannot-express-a-refutation``.
    Two-ended: the refuted artifact must exist. ``supersedes`` was the near
    miss and means "a newer version of the same thing", which is why this is a
    new member of the vocabulary rather than a re-use.
    """

    async def test_a_diagnostic_can_refute_a_plan(
        self, client: httpx.AsyncClient
    ) -> None:
        diagnostic = await _make_artifact(client, stem="measured", kind="diagnostic")
        claim = await _make_artifact(client, stem="claim")

        resp = await client.post(
            f"{API_PREFIX}/{diagnostic}/edges",
            json={
                "relation": "refutes",
                "to_id": claim,
                "note": "25,253 consults, 0 dispatched — arming the flag is inert",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["relation"] == "refutes"
        assert body["from_id"] == diagnostic
        assert body["to_id"] == claim
        assert body["direction"] == "outgoing"
        assert body["peer_kind"] == "plan"

        # Visible from BOTH ends — the refuted claim can see what refuted it.
        seen_from_claim = await client.get(f"{API_PREFIX}/{claim}")
        assert seen_from_claim.status_code == 200, seen_from_claim.text
        incoming = [
            e for e in seen_from_claim.json()["edges"] if e["relation"] == "refutes"
        ]
        assert len(incoming) == 1
        assert incoming[0]["direction"] == "incoming"
        assert incoming[0]["peer_kind"] == "diagnostic"

    async def test_refutes_is_two_ended(self, client: httpx.AsyncClient) -> None:
        """A refutation with nothing to refute is a 422 from the endpoint.

        Covered by the parametrised fence above as well; stated on its own
        because it is the one property the plan asks a reviewer to verify.
        """
        diagnostic = await _make_artifact(client, stem="dangling", kind="diagnostic")
        resp = await client.post(
            f"{API_PREFIX}/{diagnostic}/edges",
            json={"relation": "refutes", "to_id": None, "note": "refutes nothing"},
        )
        assert resp.status_code == 422, resp.text
        assert "refutes" in resp.text

        # Nothing was written; the open-follow-ups queue is untouched.
        detail = await client.get(f"{API_PREFIX}/{diagnostic}")
        assert detail.json()["edges"] == []

    async def test_refutes_never_lists_as_an_open_followup(
        self, client: httpx.AsyncClient
    ) -> None:
        diagnostic = await _make_artifact(
            client, stem="not-a-followup", kind="diagnostic"
        )
        claim = await _make_artifact(client, stem="not-a-followup-claim")
        resp = await client.post(
            f"{API_PREFIX}/{diagnostic}/edges",
            json={"relation": "refutes", "to_id": claim},
        )
        assert resp.status_code == 201, resp.text

        listing = await client.get(f"{API_PREFIX}/followups")
        assert listing.status_code == 200, listing.text
        assert listing.json()["total"] == 0


# ===========================================================================
# The read
# ===========================================================================


class TestOpenFollowupRead:
    async def test_only_unclaimed_rows_are_returned(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="readopen")
        owner = await _make_artifact(client, stem="readopen-owner")

        open_edge = (await _spawn(client, plan, "still open")).json()["id"]
        claimed_edge = (await _spawn(client, plan, "about to be claimed")).json()["id"]

        claim = await client.patch(
            f"{API_PREFIX}/edges/{claimed_edge}", json={"to_id": owner}
        )
        assert claim.status_code == 200, claim.text

        listing = await client.get(f"{API_PREFIX}/followups")
        assert listing.status_code == 200, listing.text
        payload = listing.json()
        assert payload["total"] == 1
        assert [item["edge_id"] for item in payload["items"]] == [open_edge]

    async def test_the_row_carries_the_originating_artifact_and_an_age(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="rowshape")
        detail = (await client.get(f"{API_PREFIX}/{plan}")).json()
        await _spawn(client, plan, "needs its own investigation")

        item = (await client.get(f"{API_PREFIX}/followups")).json()["items"][0]
        assert item["from_id"] == plan
        assert item["from_slug"] == detail["slug"]
        assert item["from_kind"] == "plan"
        assert item["from_title"] == detail["title"]
        assert item["note"] == "needs its own investigation"
        assert item["created_by"]
        assert item["age_days"] >= 0.0

    async def test_ordering_is_oldest_first_and_declared(
        self, client: httpx.AsyncClient
    ) -> None:
        """An OLD unowned follow-up is the interesting one."""
        plan = await _make_artifact(client, stem="ordering")
        first = (await _spawn(client, plan, "older")).json()["id"]
        second = (await _spawn(client, plan, "newer")).json()["id"]

        payload = (await client.get(f"{API_PREFIX}/followups")).json()
        assert payload["ordering"] == "oldest_first"
        assert [i["edge_id"] for i in payload["items"]] == [first, second]

    async def test_paging_reports_the_unpaged_total(
        self, client: httpx.AsyncClient
    ) -> None:
        """A bounded page must never read as the whole queue."""
        plan = await _make_artifact(client, stem="paging")
        for n in range(3):
            assert (await _spawn(client, plan, f"finding {n}")).status_code == 201

        page = (await client.get(f"{API_PREFIX}/followups?limit=2")).json()
        assert len(page["items"]) == 2
        # ``count`` is THIS page's length; ``total`` the unpaged queue.
        assert page["count"] == 2
        assert page["total"] == 3
        assert page["limit"] == 2

        rest = (await client.get(f"{API_PREFIX}/followups?offset=2&limit=2")).json()
        assert len(rest["items"]) == 1
        assert rest["count"] == 1
        assert rest["total"] == 3

        empty = (await client.get(f"{API_PREFIX}/followups?offset=3&limit=2")).json()
        assert empty["items"] == []
        assert empty["count"] == 0
        assert empty["total"] == 3

    async def test_candidates_folds_in_work_that_has_no_plan_yet(
        self, client: httpx.AsyncClient
    ) -> None:
        """Additive: ``items`` keeps its shape, ``open_followups`` is new."""
        plan = await _make_artifact(client, stem="candfold")
        await _spawn(client, plan, "unowned work")

        resp = await client.get(f"{API_PREFIX}/candidates?include_coord=false")
        assert resp.status_code == 200, resp.text
        payload = resp.json()

        assert payload["open_followup_total"] == 1
        assert len(payload["open_followups"]) == 1
        assert payload["count"] == len(payload["items"]) >= 1
        assert payload["open_followups"][0]["note"] == "unowned work"
        # The existing candidate shape is untouched.
        assert payload["ordering"] == "oldest_vetted_first"
        assert any(item["id"] == plan for item in payload["items"])
        assert "spawned_followups" not in payload["items"][0]


# ===========================================================================
# The claim
# ===========================================================================


class TestClaim:
    async def test_claiming_sets_the_target_and_keeps_the_trail(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="claim")
        owner = await _make_artifact(client, stem="claim-owner")
        edge_id = (await _spawn(client, plan, "claim me")).json()["id"]

        claimed = await client.patch(
            f"{API_PREFIX}/edges/{edge_id}", json={"to_id": owner}
        )
        assert claimed.status_code == 200, claimed.text
        body = claimed.json()
        assert body["id"] == edge_id
        assert body["to_id"] == owner
        assert body["from_id"] == plan
        assert body["peer_slug"]

        # Dropped from the open list …
        assert (await client.get(f"{API_PREFIX}/followups")).json()["total"] == 0

        # … but still traceable from the artifact that surfaced it, and now
        # visible from the owner's side too. Nothing was deleted.
        origin_edges = (await client.get(f"{API_PREFIX}/{plan}")).json()["edges"]
        assert [e["id"] for e in origin_edges] == [edge_id]
        assert origin_edges[0]["to_id"] == owner
        assert origin_edges[0]["direction"] == "outgoing"

        owner_edges = (await client.get(f"{API_PREFIX}/{owner}")).json()["edges"]
        assert [e["id"] for e in owner_edges] == [edge_id]
        assert owner_edges[0]["direction"] == "incoming"

    async def test_double_claim_is_a_409(self, client: httpx.AsyncClient) -> None:
        """Not idempotent across targets — the second claim must not win."""
        plan = await _make_artifact(client, stem="double")
        first_owner = await _make_artifact(client, stem="double-a")
        second_owner = await _make_artifact(client, stem="double-b")
        edge_id = (await _spawn(client, plan, "contested")).json()["id"]

        assert (
            await client.patch(
                f"{API_PREFIX}/edges/{edge_id}", json={"to_id": first_owner}
            )
        ).status_code == 200

        conflict = await client.patch(
            f"{API_PREFIX}/edges/{edge_id}", json={"to_id": second_owner}
        )
        assert conflict.status_code == 409, conflict.text
        detail = conflict.json()["detail"]
        assert detail["error"] == "followup_already_claimed"
        assert detail["to_id"] == first_owner

        # The original claim survived.
        origin_edges = (await client.get(f"{API_PREFIX}/{plan}")).json()["edges"]
        assert origin_edges[0]["to_id"] == first_owner

    async def test_claiming_with_a_nonexistent_target_is_a_422(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="badtarget")
        edge_id = (await _spawn(client, plan, "target will not exist")).json()["id"]

        resp = await client.patch(
            f"{API_PREFIX}/edges/{edge_id}", json={"to_id": str(uuid4())}
        )
        assert resp.status_code == 422, resp.text

        # Nothing was written — it is still open.
        assert (await client.get(f"{API_PREFIX}/followups")).json()["total"] == 1

    async def test_claiming_an_unknown_edge_is_a_404(
        self, client: httpx.AsyncClient
    ) -> None:
        owner = await _make_artifact(client, stem="noedge")
        resp = await client.patch(
            f"{API_PREFIX}/edges/{uuid4()}", json={"to_id": owner}
        )
        assert resp.status_code == 404, resp.text

    async def test_a_two_ended_edge_cannot_be_claimed(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="notfollowup")
        peer = await _make_artifact(client, stem="notfollowup-peer")
        other = await _make_artifact(client, stem="notfollowup-other")

        edge_id = (
            await client.post(
                f"{API_PREFIX}/{plan}/edges",
                json={"relation": "depends_on", "to_id": peer},
            )
        ).json()["id"]

        resp = await client.patch(
            f"{API_PREFIX}/edges/{edge_id}", json={"to_id": other}
        )
        assert resp.status_code == 422, resp.text
        assert "depends_on" in resp.text

    async def test_the_origin_cannot_claim_its_own_followup(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="selfclaim")
        edge_id = (await _spawn(client, plan, "self")).json()["id"]

        resp = await client.patch(f"{API_PREFIX}/edges/{edge_id}", json={"to_id": plan})
        assert resp.status_code == 422, resp.text


# ===========================================================================
# The ORM metadata must mirror the migration
# ===========================================================================


class TestMetadataMirrorsTheMigration:
    """``conftest`` builds the test database from ``Base.metadata``, not alembic.

    So a guard that exists only in ``plan_library_03_spawned_followup`` is
    absent from every test here — and the API-level 422s above would then be
    the ONLY thing standing between a malformed edge and the store. These
    assertions read the live test database and pin that the model declares the
    same fences the migration does.
    """

    async def test_to_id_is_nullable(self, async_db_session: AsyncSession) -> None:
        nullable = (
            await async_db_session.execute(
                text(
                    """
                    SELECT is_nullable
                      FROM information_schema.columns
                     WHERE table_schema = 'agent'
                       AND table_name = 'work_artifact_edges'
                       AND column_name = 'to_id'
                    """
                )
            )
        ).scalar_one()
        assert nullable == "YES"

    async def test_both_guard_checks_exist(
        self, async_db_session: AsyncSession
    ) -> None:
        names = set(
            (
                await async_db_session.execute(
                    text(
                        """
                        SELECT con.conname
                          FROM pg_constraint con
                          JOIN pg_class rel ON rel.oid = con.conrelid
                          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                         WHERE nsp.nspname = 'agent'
                           AND rel.relname = 'work_artifact_edges'
                           AND con.contype = 'c'
                        """
                    )
                )
            )
            .scalars()
            .all()
        )
        assert "ck_work_artifact_edges_open_target" in names
        assert "ck_work_artifact_edges_followup_note" in names

    async def test_the_duplicate_guard_index_exists_and_is_partial(
        self, async_db_session: AsyncSession
    ) -> None:
        definition = (
            await async_db_session.execute(
                text(
                    """
                    SELECT indexdef
                      FROM pg_indexes
                     WHERE schemaname = 'agent'
                       AND indexname = 'uq_work_artifact_edges_open_followup'
                    """
                )
            )
        ).scalar_one()
        assert "UNIQUE" in definition.upper()
        assert "to_id IS NULL" in definition
        # The TWO-argument btrim. One-argument btrim strips spaces only, so a
        # tab-or-newline variant would slip past the guard as a distinct key.
        assert "btrim(note," in definition


# ===========================================================================
# CRUD layer — the pieces the HTTP tests cannot show directly
# ===========================================================================


class TestCrudLayer:
    async def test_claimed_followups_do_not_pollute_unmet_dependencies(
        self, async_db_session: AsyncSession
    ) -> None:
        """``load_depends_on`` must not widen to the new relation.

        A ``spawned_followup`` is NOT a dependency — the plan that surfaced the
        work is not blocked on it. If the relation leaked into the dependency
        walk, every plan that recorded a follow-up would become permanently
        unready in ``/candidates``.
        """
        origin = await _crud_artifact(async_db_session, "dep-origin")
        target = await _crud_artifact(async_db_session, "dep-target")

        await crud.create_edge(
            async_db_session,
            from_artifact=origin,
            to_artifact=None,
            relation="spawned_followup",
            note="not a dependency",
            created_by="test",
        )
        edge, _ = await crud.create_edge(
            async_db_session,
            from_artifact=origin,
            to_artifact=target,
            relation="spawned_followup",
            note="also not a dependency",
            created_by="test",
        )
        assert edge.to_id == target.id

        deps = await crud.load_depends_on(async_db_session, [origin.id])
        assert deps[origin.id] == []

    async def test_get_edge_is_scoped_by_the_originating_artifact(
        self, async_db_session: AsyncSession
    ) -> None:
        """Edges carry no org of their own; the scope is inherited.

        Without the join an edge id would be a global handle and the claim
        route's authorization would end at the artifact routes.
        """
        origin = await _crud_artifact(async_db_session, "scoped")
        edge, _ = await crud.create_edge(
            async_db_session,
            from_artifact=origin,
            to_artifact=None,
            relation="spawned_followup",
            note="scoped finding",
            created_by="test",
        )

        assert await crud.get_edge(async_db_session, edge.id, org_id=None) is not None
        assert await crud.get_edge(async_db_session, edge.id, org_id=uuid4()) is None

    async def test_claim_followup_rejects_a_second_claim(
        self, async_db_session: AsyncSession
    ) -> None:
        origin = await _crud_artifact(async_db_session, "crud-claim")
        first = await _crud_artifact(async_db_session, "crud-claim-a")
        second = await _crud_artifact(async_db_session, "crud-claim-b")

        edge, _ = await crud.create_edge(
            async_db_session,
            from_artifact=origin,
            to_artifact=None,
            relation="spawned_followup",
            note="crud contested",
            created_by="test",
        )

        claimed = await crud.claim_followup(async_db_session, edge.id, first.id)
        assert claimed.to_id == first.id

        with pytest.raises(crud.FollowupAlreadyClaimed) as excinfo:
            await crud.claim_followup(async_db_session, edge.id, second.id)
        assert excinfo.value.to_id == first.id


async def _crud_artifact(db: AsyncSession, stem: str) -> WorkArtifact:
    artifact, _, _ = await crud.upsert_artifact(
        db,
        org_id=None,
        user_id=None,
        kind="plan",
        slug=_slug(stem),
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
    return artifact
