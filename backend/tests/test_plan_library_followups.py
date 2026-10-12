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

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
Phase 3 extends the follow-up with a closure state and file anchors, and the
second half of this file pins it: the new write fields are optional and stored
(the note-only shape is still accepted until Phase 6 step 6), anchor paths are
refused with a reason when not normalized, every (state, target) pair of the
transition table is either legal or a 409 naming the state, a claim on a
resolved row is a 409, ``match`` returns exactly the rows anchored on the
requested paths, a resolved row leaves the open queue (and its total), each
state view reads its own rows, and the four new doors are not captured by
``/{artifact_id}`` through the REAL ``api_router``.

Layering mirrors ``tests/test_plan_library_api.py``: ``httpx.AsyncClient`` over
``ASGITransport`` so the handler shares the test's asyncio loop and session.
"""

from __future__ import annotations

from collections.abc import Mapping
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
    """Mount both plan-library routers — the follow-up doors FIRST, exactly as
    ``app/api/v1/api.py`` orders them — with the db + both auth dependencies
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
        # ``count`` is THIS page's length; ``total`` counts from the page's
        # start, which on the first page is the whole queue.
        assert page["count"] == 2
        assert page["total"] == 3
        assert page["limit"] == 2
        assert page["truncated"] is True

        rest = (
            await client.get(
                f"{API_PREFIX}/followups",
                params={"limit": 2, "cursor": page["next_cursor"]},
            )
        ).json()
        assert len(rest["items"]) == 1
        assert rest["count"] == 1
        assert rest["total"] == 1
        assert rest["truncated"] is False
        assert rest["next_cursor"] is None
        assert {i["edge_id"] for i in page["items"]}.isdisjoint(
            {i["edge_id"] for i in rest["items"]}
        )

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
        assert payload["ordering"] == "oldest_captured_first"
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


# ===========================================================================
# Closure states and anchors — plan
# 2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down Phase 3
# ===========================================================================

REPO = "acme/widgets"
OTHER_REPO = "acme/gadgets"

#: Every follow-up state a resolution can put a row in.
_STATES = ("open", "fixing", "fixed", "already_fixed", "dismissed")

#: D1's forward transitions plus the correction verb (a resting state back to
#: open, with a reason). Everything else is a 409.
_LEGAL = {
    ("open", "fixing"),
    ("open", "already_fixed"),
    ("open", "dismissed"),
    ("fixing", "fixed"),
    ("fixing", "open"),
    ("fixed", "open"),
    ("already_fixed", "open"),
    ("dismissed", "open"),
}

#: A VALID body for each target — valid as a request; whether it is legal
#: depends only on the row's current state. Its values differ from the ones
#: ``_drive`` uses, so restating a state with them CONTRADICTS what is stored.
_BODY: dict[str, dict[str, object]] = {
    "open": {"resolution": "open", "resolution_note": "reopened by the test"},
    "fixing": {"resolution": "fixing", "resolution_pr": f"{REPO}#2"},
    "fixed": {"resolution": "fixed", "resolution_commit": "def5678"},
    "already_fixed": {"resolution": "already_fixed", "resolution_commit": "def5678"},
    "dismissed": {"resolution": "dismissed", "resolution_note": "another reason"},
}


def _anchor(path: str, repo: str = REPO, **hints: object) -> dict[str, object]:
    return {"repo": repo, "path": path, **hints}


async def _spawn_with(
    client: httpx.AsyncClient, artifact_id: str, note: str, **fields: object
) -> httpx.Response:
    return await client.post(
        f"{API_PREFIX}/{artifact_id}/edges",
        json={"relation": "spawned_followup", "note": note, "to_id": None, **fields},
    )


async def _resolve(
    client: httpx.AsyncClient, edge_id: str, body: Mapping[str, object]
) -> httpx.Response:
    return await client.post(f"{API_PREFIX}/edges/{edge_id}/resolution", json=body)


async def _drive(client: httpx.AsyncClient, edge_id: str, state: str) -> None:
    """Move an OPEN follow-up into ``state`` through the door itself."""
    steps: dict[str, list[dict[str, object]]] = {
        "open": [],
        "fixing": [{"resolution": "fixing", "resolution_pr": f"{REPO}#1"}],
        "fixed": [
            {"resolution": "fixing", "resolution_pr": f"{REPO}#1"},
            {"resolution": "fixed", "resolution_commit": "abc1234"},
        ],
        "already_fixed": [
            {"resolution": "already_fixed", "resolution_commit": "abc1234"}
        ],
        "dismissed": [{"resolution": "dismissed", "resolution_note": "not worth it"}],
    }
    for body in steps[state]:
        resp = await _resolve(client, edge_id, body)
        assert resp.status_code == 200, resp.text
        assert resp.json()["changed"] is True


async def _followups(client: httpx.AsyncClient, **params: str | int) -> dict:
    resp = await client.get(f"{API_PREFIX}/followups", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestNewFieldsAreOptionalOnTheWriteDoor:
    """D3, re-vet: ``anchors`` / ``size_class`` / ``unanchored_reason`` are
    ACCEPTED and STORED now, and the note-only shape is still accepted — the
    refusal is Phase 6 step 6, after every writer sends the new shape."""

    async def test_note_only_is_still_accepted_and_reads_unanchored(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="noteonly")
        resp = await _spawn(client, plan, "a finding with no file")
        assert resp.status_code == 201, resp.text
        followup = resp.json()["followup"]
        assert followup["state"] == "open"
        assert followup["anchors"] == []
        assert followup["size_class"] is None
        assert followup["unanchored_reason"] is None
        assert followup["resolution_history"] == []

    async def test_anchors_and_size_class_are_stored_and_read_back(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="anchored")
        resp = await _spawn_with(
            client,
            plan,
            "fix the docstring",
            anchors=[
                _anchor("backend/app/a.py", line_start=10, line_end=12, symbol="A.run"),
                # Repo is case-folded: GitHub resolves owner/name case-insensitively.
                _anchor("frontend/src/b.ts", repo="Acme/Gadgets"),
            ],
            size_class="trivial",
        )
        assert resp.status_code == 201, resp.text
        followup = resp.json()["followup"]
        assert followup["size_class"] == "trivial"
        assert followup["size_class_source"] == "declared"
        assert {(a["repo"], a["path"]) for a in followup["anchors"]} == {
            (REPO, "backend/app/a.py"),
            (OTHER_REPO, "frontend/src/b.ts"),
        }
        a = next(x for x in followup["anchors"] if x["path"] == "backend/app/a.py")
        assert (a["line_start"], a["line_end"], a["symbol"]) == (10, 12, "A.run")

        # The queue row and the artifact's edge list carry the same facts.
        item = (await _followups(client))["items"][0]
        assert item["edge_id"] == resp.json()["id"]
        assert len(item["anchors"]) == 2
        detail = (await client.get(f"{API_PREFIX}/{plan}")).json()
        assert detail["edges"][0]["followup"]["size_class"] == "trivial"

    async def test_unanchored_reason_is_stored(self, client: httpx.AsyncClient) -> None:
        plan = await _make_artifact(client, stem="unanchored")
        resp = await _spawn_with(
            client, plan, "a process finding", unanchored_reason="no file is involved"
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["followup"]["unanchored_reason"] == "no file is involved"

    async def test_a_two_ended_edge_carries_no_followup_block(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="noblock")
        peer = await _make_artifact(client, stem="noblock-peer")
        resp = await client.post(
            f"{API_PREFIX}/{plan}/edges", json={"relation": "depends_on", "to_id": peer}
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["followup"] is None

    @pytest.mark.parametrize(
        ("path", "reason"),
        [
            ("/abs/path.py", "absolute"),
            ("dir/", "directory"),
            ("a//b.py", "empty segment"),
            ("a\\b.py", "backslash"),
            ("../escape.py", "'..'"),
            ("a/./b.py", "'.'"),
            (" lead.py", "whitespace"),
            ("new\nline.py", "control character"),
            ("", "empty"),
        ],
    )
    async def test_an_unnormalized_anchor_path_is_refused_with_its_reason(
        self, client: httpx.AsyncClient, path: str, reason: str
    ) -> None:
        plan = await _make_artifact(client, stem="badpath")
        resp = await _spawn_with(client, plan, "bad path", anchors=[_anchor(path)])
        assert resp.status_code == 422, resp.text
        assert reason in resp.text
        # Nothing was written.
        assert (await _followups(client))["total"] == 0

    async def test_a_bare_repo_name_is_refused(self, client: httpx.AsyncClient) -> None:
        plan = await _make_artifact(client, stem="barerepo")
        resp = await _spawn_with(
            client, plan, "bare", anchors=[_anchor("a.py", repo="widgets")]
        )
        assert resp.status_code == 422, resp.text
        assert "owner/name" in resp.text

    async def test_contradictory_or_misplaced_facts_are_refused(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="contradict")
        peer = await _make_artifact(client, stem="contradict-peer")
        both = await _spawn_with(
            client,
            plan,
            "both",
            anchors=[_anchor("a.py")],
            unanchored_reason="but also none",
        )
        assert both.status_code == 422, both.text
        blank = await _spawn_with(client, plan, "blank", unanchored_reason=" \t")
        assert blank.status_code == 422, blank.text
        duplicate = await _spawn_with(
            client, plan, "dup", anchors=[_anchor("a.py"), _anchor("a.py")]
        )
        assert duplicate.status_code == 422, duplicate.text
        assert "duplicate anchor" in duplicate.text
        wrong_relation = await client.post(
            f"{API_PREFIX}/{plan}/edges",
            json={"relation": "depends_on", "to_id": peer, "size_class": "small"},
        )
        assert wrong_relation.status_code == 422, wrong_relation.text
        assert "spawned_followup" in wrong_relation.text
        assert (await _followups(client))["total"] == 0

    async def test_a_repost_fills_what_the_row_lacks_and_overwrites_nothing(
        self, client: httpx.AsyncClient
    ) -> None:
        """Before anchors existed every follow-up was note-only; a writer
        re-posting one WITH anchors is how they arrive — not silently dropped.
        A row that already has anchors keeps them (PUT is the replace door)."""
        plan = await _make_artifact(client, stem="repostfill")
        first = await _spawn(client, plan, "a finding")
        edge_id = first.json()["id"]

        filled = await _spawn_with(
            client, plan, "a finding", anchors=[_anchor("x.py")], size_class="small"
        )
        assert filled.status_code == 200, filled.text
        assert filled.json()["id"] == edge_id
        assert [a["path"] for a in filled.json()["followup"]["anchors"]] == ["x.py"]
        assert filled.json()["followup"]["size_class"] == "small"

        again = await _spawn_with(
            client, plan, "a finding", anchors=[_anchor("y.py")], size_class="trivial"
        )
        assert again.status_code == 200, again.text
        assert [a["path"] for a in again.json()["followup"]["anchors"]] == ["x.py"]
        assert again.json()["followup"]["size_class"] == "small"

    async def test_reposting_a_resolved_followups_note_returns_it_resolved(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="repostresolved")
        edge_id = (await _spawn(client, plan, "resolved finding")).json()["id"]
        await _drive(client, edge_id, "dismissed")

        again = await _spawn(client, plan, "resolved finding")
        assert again.status_code == 200, again.text
        assert again.json()["id"] == edge_id
        assert again.json()["followup"]["state"] == "dismissed"
        assert (await _followups(client))["total"] == 0


class TestTransitions:
    @pytest.mark.parametrize("current", _STATES)
    @pytest.mark.parametrize("target", _STATES)
    async def test_the_transition_matrix(
        self, client: httpx.AsyncClient, current: str, target: str
    ) -> None:
        """Every (state, target) pair: legal → moved; restating ``open`` → a
        no-op; anything else → 409 naming the state the row is in."""
        plan = await _make_artifact(client, stem=f"mx-{current}-{target}")
        edge_id = (await _spawn(client, plan, f"{current}->{target}")).json()["id"]
        await _drive(client, edge_id, current)

        resp = await _resolve(client, edge_id, _BODY[target])
        if (current, target) in _LEGAL:
            assert resp.status_code == 200, resp.text
            assert resp.json()["changed"] is True
            assert resp.json()["followup"]["state"] == target
        elif current == target == "open":
            assert resp.status_code == 200, resp.text
            assert resp.json()["changed"] is False
        else:
            assert resp.status_code == 409, resp.text
            detail = resp.json()["detail"]
            assert detail["error"] == "followup_transition_conflict"
            assert detail["current_state"] == current
            assert detail["requested"] == target
            assert current in detail["message"]

    async def test_a_replay_is_idempotent_and_appends_no_history(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="replay")
        edge_id = (await _spawn(client, plan, "replayed")).json()["id"]
        body = {"resolution": "fixing", "resolution_pr": f"{REPO}#7"}
        assert (await _resolve(client, edge_id, body)).json()["changed"] is True
        again = await _resolve(client, edge_id, body)
        assert again.status_code == 200, again.text
        assert again.json()["changed"] is False
        assert len(again.json()["followup"]["resolution_history"]) == 1

    async def test_history_records_every_move_in_order(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="history")
        edge_id = (await _spawn(client, plan, "tracked")).json()["id"]
        for body in (
            {"resolution": "fixing", "resolution_pr": f"{REPO}#1"},
            {"resolution": "open", "resolution_note": "PR closed unlanded"},
            {"resolution": "fixing", "resolution_pr": f"{REPO}#2"},
            {"resolution": "fixed", "resolution_commit": "ABC1234"},
        ):
            assert (await _resolve(client, edge_id, body)).status_code == 200

        followup = (await _followups(client, state="fixed"))["items"][0]
        assert followup["state"] == "fixed"
        assert followup["resolution_pr"] == f"{REPO}#2"
        # A commit is stored lower-cased.
        assert followup["resolution_commit"] == "abc1234"
        assert followup["resolved_by"]
        assert followup["resolved_at"]
        history = followup["resolution_history"]
        assert [(h["from"], h["to"]) for h in history] == [
            ("open", "fixing"),
            ("fixing", "open"),
            ("open", "fixing"),
            ("fixing", "fixed"),
        ]
        # The reopen entry keeps the PR it left, and its reason.
        assert history[1]["pr"] == f"{REPO}#1"
        assert history[1]["note"] == "PR closed unlanded"
        assert history[3]["commit"] == "abc1234"
        assert all(h["by"] for h in history)

    async def test_reopen_clears_the_current_state_columns(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="reopen")
        edge_id = (await _spawn(client, plan, "reopen me")).json()["id"]
        await _drive(client, edge_id, "already_fixed")
        resp = await _resolve(
            client,
            edge_id,
            {"resolution": "open", "resolution_note": "that commit did not fix it"},
        )
        assert resp.status_code == 200, resp.text
        followup = resp.json()["followup"]
        assert followup["state"] == "open"
        for column in (
            "resolution",
            "resolution_pr",
            "resolution_commit",
            "resolution_note",
            "resolved_by",
            "resolved_at",
        ):
            assert followup[column] is None, column
        assert (await _followups(client))["total"] == 1

    @pytest.mark.parametrize(
        ("body", "needle"),
        [
            ({"resolution": "fixing"}, "resolution_pr"),
            ({"resolution": "already_fixed"}, "resolution_commit"),
            ({"resolution": "fixed"}, "resolution_commit"),
            ({"resolution": "dismissed", "resolution_note": "  "}, "resolution_note"),
            ({"resolution": "fixing", "resolution_pr": "widgets#1"}, "owner/name"),
            ({"resolution": "already_fixed", "resolution_commit": "xyz"}, "sha"),
            (
                {
                    "resolution": "fixing",
                    "resolution_pr": f"{REPO}#1",
                    "resolution_commit": "abc1234",
                },
                "does not apply",
            ),
            ({"resolution": "claimed"}, "resolution"),
        ],
    )
    async def test_an_incomplete_or_malformed_request_is_a_422(
        self, client: httpx.AsyncClient, body: dict[str, object], needle: str
    ) -> None:
        plan = await _make_artifact(client, stem="badbody")
        edge_id = (await _spawn(client, plan, "bad body")).json()["id"]
        resp = await _resolve(client, edge_id, body)
        assert resp.status_code == 422, resp.text
        assert needle in resp.text

    async def test_reopening_a_resting_state_needs_a_reason(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="reopenreason")
        edge_id = (await _spawn(client, plan, "dismissed one")).json()["id"]
        await _drive(client, edge_id, "dismissed")
        resp = await _resolve(client, edge_id, {"resolution": "open"})
        assert resp.status_code == 422, resp.text
        assert "why the closure was wrong" in resp.text

    async def test_fixed_must_name_the_pr_it_is_fixing_under(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="fixedpr")
        edge_id = (await _spawn(client, plan, "under one pr")).json()["id"]
        await _drive(client, edge_id, "fixing")
        resp = await _resolve(
            client,
            edge_id,
            {
                "resolution": "fixed",
                "resolution_pr": f"{REPO}#99",
                "resolution_commit": "abc1234",
            },
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["resolution_pr"] == f"{REPO}#1"

    async def test_a_claimed_followup_has_no_closure_state(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="claimedclose")
        owner = await _make_artifact(client, stem="claimedclose-owner")
        edge_id = (await _spawn(client, plan, "owned")).json()["id"]
        assert (
            await client.patch(f"{API_PREFIX}/edges/{edge_id}", json={"to_id": owner})
        ).status_code == 200
        resp = await _resolve(client, edge_id, _BODY["dismissed"])
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["current_state"] == "claimed"

    async def test_a_two_ended_edge_and_an_unknown_edge(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="notfu")
        peer = await _make_artifact(client, stem="notfu-peer")
        edge_id = (
            await client.post(
                f"{API_PREFIX}/{plan}/edges",
                json={"relation": "depends_on", "to_id": peer},
            )
        ).json()["id"]
        resp = await _resolve(client, edge_id, _BODY["dismissed"])
        assert resp.status_code == 422, resp.text
        assert "depends_on" in resp.text
        missing = await _resolve(client, str(uuid4()), _BODY["dismissed"])
        assert missing.status_code == 404, missing.text

    @pytest.mark.parametrize("state", ["fixing", "fixed", "already_fixed", "dismissed"])
    async def test_a_resolved_followup_cannot_be_claimed(
        self, client: httpx.AsyncClient, state: str
    ) -> None:
        plan = await _make_artifact(client, stem=f"claimres-{state}")
        owner = await _make_artifact(client, stem=f"claimres-{state}-owner")
        edge_id = (await _spawn(client, plan, f"resolved {state}")).json()["id"]
        await _drive(client, edge_id, state)
        resp = await client.patch(
            f"{API_PREFIX}/edges/{edge_id}", json={"to_id": owner}
        )
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "followup_resolved"
        assert detail["resolution"] == state
        # Still unclaimed.
        origin_edges = (await client.get(f"{API_PREFIX}/{plan}")).json()["edges"]
        assert origin_edges[0]["to_id"] is None


class TestResolvedRowsLeaveTheOpenQueue:
    async def test_a_fixed_row_leaves_the_open_queue_and_the_total_drops(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="dropsout")
        keep = (await _spawn(client, plan, "stays open")).json()["id"]
        move = (await _spawn(client, plan, "gets fixed")).json()["id"]

        before = await client.get(f"{API_PREFIX}/candidates?include_coord=false")
        assert before.json()["open_followup_total"] == 2
        await _drive(client, move, "fixed")

        after = await client.get(f"{API_PREFIX}/candidates?include_coord=false")
        assert after.json()["open_followup_total"] == 1
        assert [f["edge_id"] for f in after.json()["open_followups"]] == [keep]
        assert [i["edge_id"] for i in (await _followups(client))["items"]] == [keep]
        fixed = await _followups(client, state="fixed")
        assert [i["edge_id"] for i in fixed["items"]] == [move]
        assert fixed["items"][0]["state"] == "fixed"

    async def test_each_state_view_reads_its_own_rows(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="views")
        ids = {}
        for state in _STATES:
            ids[state] = (await _spawn(client, plan, f"in {state}")).json()["id"]
            await _drive(client, ids[state], state)

        for state in _STATES:
            page = await _followups(client, state=state)
            assert [i["edge_id"] for i in page["items"]] == [ids[state]], state
            assert page["filters"]["state"] == state
        resolved = await _followups(client, state="resolved")
        assert {i["edge_id"] for i in resolved["items"]} == {
            ids["fixed"],
            ids["already_fixed"],
            ids["dismissed"],
        }

    async def test_an_unknown_state_is_a_422(self, client: httpx.AsyncClient) -> None:
        resp = await client.get(f"{API_PREFIX}/followups", params={"state": "claimed"})
        assert resp.status_code == 422, resp.text


class TestFollowupFilters:
    async def test_repo_size_class_and_anchored_filters(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="filters")
        in_repo = (
            await _spawn_with(
                client, plan, "in repo", anchors=[_anchor("a.py")], size_class="trivial"
            )
        ).json()["id"]
        other = (
            await _spawn_with(
                client, plan, "other repo", anchors=[_anchor("b.py", repo=OTHER_REPO)]
            )
        ).json()["id"]
        bare = (await _spawn(client, plan, "no anchor")).json()["id"]

        def ids(page: dict) -> set[str]:
            return {i["edge_id"] for i in page["items"]}

        assert ids(await _followups(client, repo=REPO)) == {in_repo}
        # The repo filter is case-folded like the stored anchors.
        assert ids(await _followups(client, repo="ACME/Widgets")) == {in_repo}
        assert ids(await _followups(client, anchored="true")) == {in_repo, other}
        assert ids(await _followups(client, anchored="false")) == {bare}
        assert ids(await _followups(client, size_class="trivial")) == {in_repo}
        assert ids(await _followups(client, size_class="unclassified")) == {
            other,
            bare,
        }
        page = await _followups(
            client, repo=REPO, size_class="trivial", anchored="true"
        )
        assert ids(page) == {in_repo}
        assert page["filters"] == {
            "state": "open",
            "repo": REPO,
            "size_class": "trivial",
            "anchored": True,
        }

    async def test_a_cursor_is_bound_to_its_filters(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="cursorbind")
        for n in range(3):
            assert (await _spawn(client, plan, f"finding {n}")).status_code == 201
        first = await _followups(client, limit=1)
        assert first["next_cursor"]
        replayed = await client.get(
            f"{API_PREFIX}/followups",
            params={"limit": 1, "cursor": first["next_cursor"], "state": "fixing"},
        )
        assert replayed.status_code == 400, replayed.text
        assert "cursor_malformed" in replayed.text

    async def test_a_malformed_repo_filter_is_a_422(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.get(f"{API_PREFIX}/followups", params={"repo": "widgets"})
        assert resp.status_code == 422, resp.text


class TestReplaceAnchors:
    async def test_put_replaces_the_set_and_a_restatement_changes_nothing(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="putset")
        edge_id = (
            await _spawn_with(client, plan, "put me", anchors=[_anchor("old.py")])
        ).json()["id"]
        body = {"anchors": [_anchor("new.py", line_start=4), _anchor("two.py")]}
        resp = await client.put(f"{API_PREFIX}/edges/{edge_id}/anchors", json=body)
        assert resp.status_code == 200, resp.text
        assert resp.json()["changed"] is True
        assert {a["path"] for a in resp.json()["followup"]["anchors"]} == {
            "new.py",
            "two.py",
        }
        again = await client.put(f"{API_PREFIX}/edges/{edge_id}/anchors", json=body)
        assert again.status_code == 200, again.text
        assert again.json()["changed"] is False

    async def test_a_lineless_and_a_lined_anchor_on_one_path_put_cleanly(
        self, client: httpx.AsyncClient
    ) -> None:
        """One path carrying a line-less anchor beside a lined one: the stored
        and requested sets hold ``None`` and an ``int`` in the same tuple slot,
        which a sorted comparison cannot order — every PUT 500ed."""
        plan = await _make_artifact(client, stem="putmixed")
        mixed = [_anchor("mixed.py"), _anchor("mixed.py", line_start=7, line_end=9)]
        created = await _spawn_with(client, plan, "mixed lines", anchors=mixed)
        assert created.status_code == 201, created.text
        edge_id = created.json()["id"]

        # The row as POST stored it already holds the pair; a PUT must read it.
        body = {"anchors": [*mixed, _anchor("mixed.py", line_start=20)]}
        resp = await client.put(f"{API_PREFIX}/edges/{edge_id}/anchors", json=body)
        assert resp.status_code == 200, resp.text
        assert resp.json()["changed"] is True
        stored = resp.json()["followup"]["anchors"]
        assert sorted(
            (a["line_start"] is None, a["line_start"] or 0) for a in stored
        ) == [(False, 7), (False, 20), (True, 0)]

        again = await client.put(f"{API_PREFIX}/edges/{edge_id}/anchors", json=body)
        assert again.status_code == 200, again.text
        assert again.json()["changed"] is False

    async def test_an_empty_set_needs_a_reason_and_a_set_clears_it(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="putempty")
        edge_id = (
            await _spawn_with(client, plan, "empty me", anchors=[_anchor("a.py")])
        ).json()["id"]
        bare = await client.put(
            f"{API_PREFIX}/edges/{edge_id}/anchors", json={"anchors": []}
        )
        assert bare.status_code == 422, bare.text
        assert "unanchored_reason" in bare.text

        emptied = await client.put(
            f"{API_PREFIX}/edges/{edge_id}/anchors",
            json={"anchors": [], "unanchored_reason": "the file was deleted"},
        )
        assert emptied.status_code == 200, emptied.text
        followup = emptied.json()["followup"]
        assert followup["anchors"] == []
        assert followup["unanchored_reason"] == "the file was deleted"

        refilled = await client.put(
            f"{API_PREFIX}/edges/{edge_id}/anchors",
            json={"anchors": [_anchor("b.py")]},
        )
        assert refilled.json()["followup"]["unanchored_reason"] is None
        contradiction = await client.put(
            f"{API_PREFIX}/edges/{edge_id}/anchors",
            json={"anchors": [_anchor("b.py")], "unanchored_reason": "none"},
        )
        assert contradiction.status_code == 422, contradiction.text

    async def test_size_class_travels_with_its_source_and_is_kept_when_omitted(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="putclass")
        edge_id = (
            await _spawn_with(
                client,
                plan,
                "class me",
                anchors=[_anchor("a.py")],
                size_class="trivial",
            )
        ).json()["id"]
        half = await client.put(
            f"{API_PREFIX}/edges/{edge_id}/anchors",
            json={"anchors": [_anchor("a.py")], "size_class": "small"},
        )
        assert half.status_code == 422, half.text
        swept = await client.put(
            f"{API_PREFIX}/edges/{edge_id}/anchors",
            json={
                "anchors": [_anchor("a.py")],
                "size_class": "plan_sized",
                "size_class_source": "sweep",
            },
        )
        assert swept.status_code == 200, swept.text
        assert swept.json()["followup"]["size_class"] == "plan_sized"
        assert swept.json()["followup"]["size_class_source"] == "sweep"
        kept = await client.put(
            f"{API_PREFIX}/edges/{edge_id}/anchors",
            json={"anchors": [_anchor("c.py")]},
        )
        assert kept.json()["followup"]["size_class"] == "plan_sized"

    async def test_put_refuses_a_two_ended_edge_and_an_unknown_one(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="putnotfu")
        peer = await _make_artifact(client, stem="putnotfu-peer")
        edge_id = (
            await client.post(
                f"{API_PREFIX}/{plan}/edges",
                json={"relation": "depends_on", "to_id": peer},
            )
        ).json()["id"]
        body = {"anchors": [_anchor("a.py")]}
        resp = await client.put(f"{API_PREFIX}/edges/{edge_id}/anchors", json=body)
        assert resp.status_code == 422, resp.text
        missing = await client.put(f"{API_PREFIX}/edges/{uuid4()}/anchors", json=body)
        assert missing.status_code == 404, missing.text


class TestMatch:
    async def test_match_on_two_paths_returns_exactly_the_anchored_rows(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="match")
        on_a = (
            await _spawn_with(
                client,
                plan,
                "about a",
                anchors=[_anchor("src/a.py", line_start=3), _anchor("src/z.py")],
                size_class="trivial",
            )
        ).json()["id"]
        on_b = (
            await _spawn_with(client, plan, "about b", anchors=[_anchor("src/b.py")])
        ).json()["id"]
        on_c = (
            await _spawn_with(client, plan, "about c", anchors=[_anchor("src/c.py")])
        ).json()["id"]
        elsewhere = (
            await _spawn_with(
                client,
                plan,
                "same path, other repo",
                anchors=[_anchor("src/a.py", repo=OTHER_REPO)],
            )
        ).json()["id"]
        await _spawn(client, plan, "names no file")
        fixed = (
            await _spawn_with(
                client, plan, "already done", anchors=[_anchor("src/a.py")]
            )
        ).json()["id"]
        await _drive(client, fixed, "fixed")

        resp = await client.post(
            f"{API_PREFIX}/followups/match",
            json={"repo": REPO, "paths": ["src/a.py", "src/b.py", "src/b.py"]},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [i["edge_id"] for i in body["items"]] == [on_a, on_b]
        assert body["matched_total"] == 2
        assert body["truncated"] is False
        assert body["paths_requested"] == 2
        a = body["items"][0]
        # Only the anchor the request hit is a MATCHED anchor.
        assert [(m["path"], m["line_start"]) for m in a["matched_anchors"]] == [
            ("src/a.py", 3)
        ]
        assert len(a["anchors"]) == 2
        assert a["size_class"] == "trivial"
        # The zero-is-self-describing totals: a, b and c are open and anchored
        # in this repo (the fixed one is not open); one names no file.
        assert body["repo_anchored_open_total"] == 3
        assert body["unanchored_open_total"] == 1
        assert on_c not in {i["edge_id"] for i in body["items"]}
        assert elsewhere not in {i["edge_id"] for i in body["items"]}

    async def test_a_fixing_followup_still_matches_and_says_so(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="matchfixing")
        edge_id = (
            await _spawn_with(client, plan, "held by a pr", anchors=[_anchor("f.py")])
        ).json()["id"]
        await _drive(client, edge_id, "fixing")
        body = (
            await client.post(
                f"{API_PREFIX}/followups/match",
                json={"repo": REPO, "paths": ["f.py"]},
            )
        ).json()
        assert [i["edge_id"] for i in body["items"]] == [edge_id]
        assert body["items"][0]["state"] == "fixing"
        assert body["items"][0]["resolution_pr"] == f"{REPO}#1"

    async def test_an_empty_or_missing_match_is_self_describing(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="matchnone")
        await _spawn_with(client, plan, "elsewhere", anchors=[_anchor("e.py")])
        await _spawn(client, plan, "no file")
        for paths in ([], ["nothing/here.py"]):
            body = (
                await client.post(
                    f"{API_PREFIX}/followups/match",
                    json={"repo": REPO, "paths": paths},
                )
            ).json()
            assert body["items"] == []
            assert body["matched_total"] == 0
            assert body["repo_anchored_open_total"] == 1
            assert body["unanchored_open_total"] == 1

    async def test_a_malformed_match_request_is_a_422(
        self, client: httpx.AsyncClient
    ) -> None:
        bad_path = await client.post(
            f"{API_PREFIX}/followups/match", json={"repo": REPO, "paths": ["/abs.py"]}
        )
        assert bad_path.status_code == 422, bad_path.text
        too_many = await client.post(
            f"{API_PREFIX}/followups/match",
            json={"repo": REPO, "paths": [f"f{n}.py" for n in range(501)]},
        )
        assert too_many.status_code == 422, too_many.text


class TestArming:
    """Phase 3's Arming, end to end: a follow-up recorded with an anchor on
    ``owner/repo:path`` is returned by ``/followups/match`` for that path, and
    moving it to ``fixing`` removes it from ``GET /followups``."""

    async def test_anchor_match_then_fixing_leaves_the_open_queue(
        self, client: httpx.AsyncClient
    ) -> None:
        plan = await _make_artifact(client, stem="arming")
        edge_id = (
            await _spawn_with(
                client, plan, "reword the docstring", anchors=[_anchor("pkg/mod.py")]
            )
        ).json()["id"]
        matched = await client.post(
            f"{API_PREFIX}/followups/match",
            json={"repo": REPO, "paths": ["pkg/mod.py"]},
        )
        assert [i["edge_id"] for i in matched.json()["items"]] == [edge_id]
        assert (await _followups(client))["total"] == 1

        moved = await _resolve(
            client, edge_id, {"resolution": "fixing", "resolution_pr": f"{REPO}#42"}
        )
        assert moved.status_code == 200, moved.text
        assert (await _followups(client))["total"] == 0
        fixing = await _followups(client, state="fixing")
        assert [i["edge_id"] for i in fixing["items"]] == [edge_id]


class TestRouteOrder:
    """The follow-up doors are registered BEFORE ``plan_library``'s
    ``/{artifact_id}`` routes, through the REAL ``api_router``."""

    def test_the_followup_routes_precede_the_artifact_id_routes(self) -> None:
        from app.api.v1.api import api_router

        paths = [getattr(r, "path", None) for r in api_router.routes]
        first_artifact_route = min(
            i
            for i, p in enumerate(paths)
            if isinstance(p, str) and p.startswith("/plan-library/{artifact_id}")
        )
        for path in (
            "/plan-library/edges/{edge_id}/anchors",
            "/plan-library/edges/{edge_id}/resolution",
            "/plan-library/followups/match",
            "/plan-library/followups/reconcile",
        ):
            assert paths.index(path) < first_artifact_route, path

    async def test_each_door_reaches_its_handler_through_api_router(
        self, async_db_session: AsyncSession, api_user, monkeypatch
    ) -> None:
        from app.api.deps import (
            current_active_user,
            current_active_user_optional,
            get_async_db,
        )
        from app.api.v1 import api as api_module
        from app.api.v1.endpoints import plan_library_followups

        async def _no_tenant(request, *, actor_kind):
            del request, actor_kind
            return None

        monkeypatch.setattr(plan_library_followups, "_soft_tenant_id", _no_tenant)

        app = FastAPI()
        app.dependency_overrides[current_active_user] = lambda: api_user
        app.dependency_overrides[current_active_user_optional] = lambda: api_user

        async def _db_override():
            yield async_db_session

        app.dependency_overrides[get_async_db] = _db_override
        app.include_router(api_module.api_router, prefix="/api/v1")

        missing = uuid4()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as http:
            match = await http.post(
                f"{API_PREFIX}/followups/match", json={"repo": REPO, "paths": []}
            )
            reconcile = await http.post(f"{API_PREFIX}/followups/reconcile")
            anchors = await http.put(
                f"{API_PREFIX}/edges/{missing}/anchors",
                json={"anchors": [_anchor("a.py")]},
            )
            resolution = await http.post(
                f"{API_PREFIX}/edges/{missing}/resolution", json=_BODY["dismissed"]
            )

        # A 405, or a 422 naming artifact_id, would be /{artifact_id} answering.
        assert match.status_code == 200, match.text
        assert "unanchored_open_total" in match.json()
        assert reconcile.status_code == 200, reconcile.text
        assert reconcile.json()["examined"] == 0
        for resp in (anchors, resolution):
            assert resp.status_code == 404, resp.text
            assert "Work artifact edge not found" in resp.text


class TestClosureMetadataMirrorsTheMigration:
    """``conftest`` builds this database from ``Base.metadata``; the closure
    fences and indexes must be in the MODEL, not only in
    ``plan_library_11_followup_anchors_and_closure`` (whose own test proves the
    two declare the same predicates)."""

    async def test_every_closure_check_exists(
        self, async_db_session: AsyncSession
    ) -> None:
        from app.models.work_artifact import (
            FOLLOWUP_ANCHOR_CHECKS,
            FOLLOWUP_EDGE_CHECKS,
        )

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
                           AND rel.relname IN
                               ('work_artifact_edges', 'work_artifact_edge_anchors')
                           AND con.contype = 'c'
                        """
                    )
                )
            )
            .scalars()
            .all()
        )
        expected = {
            name for name, _ in (*FOLLOWUP_EDGE_CHECKS, *FOLLOWUP_ANCHOR_CHECKS)
        }
        assert expected <= names, sorted(expected - names)

    async def test_the_open_queue_index_is_partial_on_the_open_predicate(
        self, async_db_session: AsyncSession
    ) -> None:
        definition = (
            await async_db_session.execute(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'agent' "
                    "AND indexname = "
                    "'ix_work_artifact_edges_open_followup_queue_created_id'"
                )
            )
        ).scalar_one()
        assert "(created_at, id)" in definition
        assert "resolution IS NULL" in definition
        assert "to_id IS NULL" in definition
