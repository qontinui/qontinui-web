"""The taste inbox, end to end against real Postgres.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 23.

Layers:

* **Layer 0** — the closed vocabularies agree between the API, the models'
  CHECK lists and the tables, which land in ``web``.
* **Layer 1** — pushes: a pair is one row whichever order its images come in;
  an image the tenant does not hold answers like an unknown one; a capture
  must be a capture; an unanswered pair can be withdrawn, a labelled one not.
* **Layer 2** — the queue: its order, the skip, the weekly budget, and the
  operator's sequence (label, skip, both bad, refresh) neither dropping nor
  duplicating a row.
* **Layer 3** — labels: the labeller and the time are recorded, a second
  labeller is refused rather than overwriting, the undo, the reason
  vocabulary, an attached edit.
* **Layer 4** — the calibration batch and the budget setting.
* **Layer 5** — the taste twin's paged label read.
* **Layer 6** — the real app's wiring: routes mounted, the real tenant and
  admin dependencies live.

The dependencies are overridden at the route boundary — ``get_memory_tenant``
with a principal per tenant, ``get_labeller`` with a real user, and
``get_can_label`` with a fixed answer — because resolving real ones needs
coord. Layer 6 shows the real app routes through the real ones.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, get_args
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.deps import get_async_db
from app.api.v1.endpoints import taste as endpoints
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant
from app.crud import taste as crud
from app.middleware.error_handler import (
    http_exception_handler,
    validation_exception_handler,
)
from app.models.image_asset import ImageAsset
from app.models.taste import (
    DEFAULT_WEEKLY_BUDGET,
    TASTE_LABELS,
    TASTE_PAIR_SOURCES,
    TasteLabelClock,
    TastePair,
    TasteSettings,
)
from app.models.user import User
from app.schemas.taste import TASTE_REASONS, TasteLabel, TasteReason, TasteSource
from app.services.coord_identity import CoordIdentity, CoordTenant
from app.services.taste_calibration import PoolImage

API = "/api/v1/taste"
REPO = "qontinui-web"
SLOT = "home.hero"

pytestmark = pytest.mark.asyncio


# ===========================================================================
# Harness
# ===========================================================================


def _sha(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


async def _asset(
    db: AsyncSession,
    tenant: UUID,
    seed: str,
    *,
    kind: str = "candidate",
    provenance: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> str:
    sha = _sha(seed)
    db.add(
        ImageAsset(
            tenant_id=tenant,
            sha256=sha,
            storage_key=f"image-assets/{tenant}/sha256/{sha[:2]}/{sha}.png",
            mime_type="image/png",
            width=64,
            height=48,
            byte_size=1234,
            provenance=provenance or {},
            kind=kind,
            **({"created_at": created_at} if created_at else {}),
        )
    )
    await db.flush()
    return sha


async def _user(db: AsyncSession, name: str) -> User:
    user = User(
        email=f"{name}-{uuid4().hex[:8]}@example.com",
        username=f"{name}-{uuid4().hex[:8]}",
        full_name=name.title(),
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


class Harness:
    """One tenant's view of the taste router; ``labeller``, ``can_label`` and
    ``actor`` are swappable mid-test (a second operator, a member who may only
    look, an operator's session instead of studio's device credential)."""

    def __init__(self, db: AsyncSession, tenant: UUID, labeller: User) -> None:
        self.db = db
        self.tenant = tenant
        self.labeller = labeller
        self.can_label = True
        self.actor = "device"
        self.app = FastAPI()
        self.app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
        self.app.add_exception_handler(
            RequestValidationError,
            validation_exception_handler,  # type: ignore[arg-type]
        )

        async def _db() -> AsyncIterator[Any]:
            yield db

        self.app.dependency_overrides[get_async_db] = _db
        self.app.dependency_overrides[get_memory_tenant] = lambda: MemoryPrincipal(
            tenant_id=tenant,
            device_id=None,
            actor=self.actor,
            # A device JWT may carry a user claim too; only an operator's
            # session makes it the viewer.
            user_id=self.labeller.id,
        )
        self.app.dependency_overrides[endpoints.get_labeller] = (
            lambda: endpoints.Labeller(tenant_id=tenant, user=self.labeller)
        )
        self.app.dependency_overrides[endpoints.get_can_label] = lambda: self.can_label
        self.app.include_router(endpoints.router, prefix=API)
        self.http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"
        )

    async def push(self, a: str, b: str, **body: Any) -> httpx.Response:
        payload = {
            "asset_a_sha256": a,
            "asset_b_sha256": b,
            "source": "calibration",
            **body,
        }
        return await self.http.post(f"{API}/pairs", json=payload)

    async def pair_id(self, a: str, b: str, **body: Any) -> str:
        resp = await self.push(a, b, **body)
        assert resp.status_code in (200, 201), resp.text
        return str(resp.json()["pair"]["id"])

    async def inbox(self, **params: Any) -> dict[str, Any]:
        resp = await self.http.get(f"{API}/inbox", params={"limit": 50, **params})
        assert resp.status_code == 200, resp.text
        return dict(resp.json())

    async def label(
        self, pair_id: str, choice: str = "a", **body: Any
    ) -> httpx.Response:
        return await self.http.put(
            f"{API}/pairs/{pair_id}/label", json={"choice": choice, **body}
        )


@pytest.fixture()
def tenant_a() -> UUID:
    return uuid4()


@pytest.fixture()
def tenant_b() -> UUID:
    return uuid4()


@pytest_asyncio.fixture()
async def operator(async_db_session: AsyncSession) -> User:
    return await _user(async_db_session, "operator")


@pytest_asyncio.fixture()
async def a(
    async_db_session: AsyncSession, tenant_a: UUID, operator: User
) -> AsyncIterator[Harness]:
    harness = Harness(async_db_session, tenant_a, operator)
    async with harness.http:
        yield harness


@pytest_asyncio.fixture()
async def b(
    async_db_session: AsyncSession, tenant_b: UUID, operator: User
) -> AsyncIterator[Harness]:
    harness = Harness(async_db_session, tenant_b, operator)
    async with harness.http:
        yield harness


async def _images(h: Harness, *seeds: str, **kw: Any) -> list[str]:
    return [await _asset(h.db, h.tenant, f"{h.tenant}-{s}", **kw) for s in seeds]


def _ids(rows: list[dict[str, Any]]) -> list[str]:
    return [str(r["id"]) for r in rows]


# ===========================================================================
# Layer 0 — vocabularies and schema
# ===========================================================================


def test_the_closed_vocabularies_agree() -> None:
    assert get_args(TasteSource) == TASTE_PAIR_SOURCES
    assert get_args(TasteLabel) == TASTE_LABELS
    assert get_args(TasteReason) == TASTE_REASONS
    assert len(TASTE_REASONS) == 10  # one number key each in the inbox


def test_the_tables_live_in_web() -> None:
    assert TastePair.__table__.schema == "web"
    assert TasteSettings.__table__.schema == "web"


# ===========================================================================
# Layer 1 — pushes
# ===========================================================================


class TestPush:
    async def test_a_pair_is_one_row_whichever_order_its_images_come_in(
        self, a: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        first = await a.push(x, y, uncertainty=0.4, context={"why": "panel split"})
        assert first.status_code == 201
        body = first.json()
        assert body["created"] is True
        pair = body["pair"]
        assert pair["asset_a"]["sha256"] == x and pair["asset_b"]["sha256"] == y
        assert pair["source"] == "calibration"
        assert pair["in_situ"] is False
        assert pair["label"] is None and pair["pushed_by"] == "device"

        again = await a.push(y, x, source="active_learning", uncertainty=0.9)
        assert again.status_code == 200
        assert again.json()["created"] is False
        assert again.json()["pair"]["id"] == pair["id"]
        # A re-push changes nothing.
        assert again.json()["pair"]["source"] == "calibration"
        assert again.json()["pair"]["uncertainty"] == 0.4
        count = (
            (
                await a.db.execute(
                    select(TastePair).where(TastePair.tenant_id == a.tenant)
                )
            )
            .scalars()
            .all()
        )
        assert len(count) == 1

    async def test_the_same_images_for_another_slot_are_another_question(
        self, a: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        p1 = await a.pair_id(x, y)
        p2 = await a.pair_id(x, y, repo=REPO, slot_id=SLOT, source="active_learning")
        p3 = await a.pair_id(
            x, y, repo=REPO, slot_id="home.footer", source="active_learning"
        )
        assert len({p1, p2, p3}) == 3

    async def test_an_image_the_tenant_does_not_hold_answers_like_an_unknown_one(
        self, a: Harness, b: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        [theirs] = await _images(b, "z")
        unknown = await a.push(x, _sha("never-uploaded"))
        foreign = await a.push(x, theirs)
        assert unknown.status_code == foreign.status_code == 404
        assert (
            unknown.json()["error"]
            == foreign.json()["error"]
            == "image_asset_not_found"
        )
        assert foreign.json()["field"] == "asset_b_sha256"
        assert await a.inbox() and (await a.inbox())["pending_total"] == 0

    async def test_a_capture_must_be_a_capture_and_makes_the_pair_in_situ(
        self, a: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        cx, cy = await _images(a, "cx", "cy", kind="capture")
        wrong = await a.push(x, y, capture_a_sha256=x, capture_b_sha256=cy)
        assert wrong.status_code == 422
        assert wrong.json()["error"] == "capture_not_a_capture"
        ok = await a.push(x, y, capture_a_sha256=cx, capture_b_sha256=cy)
        assert ok.status_code == 201
        assert ok.json()["pair"]["in_situ"] is True

    @pytest.mark.parametrize(
        "body",
        [
            {"same": True},
            {"repo": REPO},
            {"slot_id": SLOT},
            {"capture_a_sha256": "c" * 64},
            {"source": "gut_feeling"},
            {"uncertainty": 1.5},
            {"surprise": 1},
        ],
    )
    async def test_malformed_pushes_are_refused(
        self, a: Harness, body: dict[str, Any]
    ) -> None:
        x, y = await _images(a, "x", "y")
        if body.pop("same", False):
            y = x
        resp = await a.push(x, y, **body)
        assert resp.status_code == 422, resp.text

    async def test_an_unanswered_pair_can_be_withdrawn_a_labelled_one_cannot(
        self, a: Harness, b: Harness
    ) -> None:
        x, y, z = await _images(a, "x", "y", "z")
        open_pair = await a.pair_id(x, y)
        answered = await a.pair_id(x, z)
        assert (await a.label(answered, "b")).status_code == 200

        assert (await b.http.delete(f"{API}/pairs/{open_pair}")).status_code == 404
        refused = await a.http.delete(f"{API}/pairs/{answered}")
        assert refused.status_code == 409
        assert refused.json()["error"] == "pair_already_labelled"
        assert (await a.http.delete(f"{API}/pairs/{open_pair}")).status_code == 204
        assert (await a.http.delete(f"{API}/pairs/{open_pair}")).status_code == 404
        # The images stay in the store.
        assert await crud.get_assets(a.db, tenant_id=a.tenant, shas=[x, y]) != {}


# ===========================================================================
# Layer 2 — the queue
# ===========================================================================


class TestQueue:
    async def test_most_uncertain_first_then_oldest_and_skipped_last(
        self, a: Harness
    ) -> None:
        imgs = await _images(a, *"abcdefgh")
        plain_old = await a.pair_id(imgs[0], imgs[1])
        plain_new = await a.pair_id(imgs[2], imgs[3])
        unsure = await a.pair_id(
            imgs[4], imgs[5], uncertainty=0.9, source="active_learning"
        )
        sure = await a.pair_id(
            imgs[6], imgs[7], uncertainty=0.1, source="active_learning"
        )
        assert _ids((await a.inbox())["pairs"]) == [unsure, sure, plain_old, plain_new]

        assert (await a.http.post(f"{API}/pairs/{unsure}/skip")).status_code == 200
        assert (await a.http.post(f"{API}/pairs/{plain_old}/skip")).status_code == 200
        order = _ids((await a.inbox())["pairs"])
        assert order == [sure, plain_new, unsure, plain_old]
        skipped = (await a.inbox())["pairs"][2]
        assert skipped["skip_count"] == 1 and skipped["skipped_at"] is not None

    async def test_label_skip_both_bad_then_refresh_neither_drops_nor_duplicates(
        self, a: Harness
    ) -> None:
        imgs = await _images(a, *"abcdefgh")
        ids = [await a.pair_id(imgs[i], imgs[i + 1]) for i in range(0, 8, 2)]
        first, second, third, fourth = ids

        assert (await a.label(first, "a", reasons=["on_style"])).status_code == 200
        assert (await a.http.post(f"{API}/pairs/{second}/skip")).status_code == 200
        assert (
            await a.label(third, "both_bad", reasons=["artifacts"])
        ).status_code == 200

        inbox = await a.inbox()  # the refresh
        pending = _ids(inbox["pairs"])
        recent = _ids(inbox["recent"])
        assert pending == [fourth, second]  # the skipped one last, not gone
        assert sorted(recent) == sorted([first, third])
        assert len(set(pending + recent)) == len(pending + recent) == 4
        assert inbox["pending_total"] == 2 and inbox["labelled_total"] == 2

    async def test_the_week_budget_hides_the_head_never_the_queue(
        self, a: Harness
    ) -> None:
        imgs = await _images(a, *"abcdef")
        ids = [await a.pair_id(imgs[i], imgs[i + 1]) for i in range(0, 6, 2)]
        assert (
            await a.http.put(f"{API}/settings", json={"weekly_budget": 1})
        ).status_code == 200

        inbox = await a.inbox()
        assert inbox["budget"]["weekly_budget"] == 1
        assert inbox["budget"]["source"] == "setting"
        assert inbox["budget"]["remaining"] == 1
        assert len(inbox["pairs"]) == 1  # one label left this week

        assert (await a.label(ids[0], "b")).status_code == 200
        spent = await a.inbox()
        assert spent["budget"]["labelled_this_week"] == 1
        assert spent["budget"]["remaining"] == 0
        assert spent["pairs"] == []
        assert spent["pending_total"] == 2  # the queue is untouched
        kept_going = await a.inbox(over_budget="true")
        assert kept_going["over_budget"] is True
        assert _ids(kept_going["pairs"]) == ids[1:]

    async def test_last_weeks_labels_do_not_spend_this_weeks_budget(
        self, a: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        assert (await a.label(pid, "a")).status_code == 200
        last_week = crud.week_start(datetime.now(UTC)) - timedelta(seconds=1)
        await a.db.execute(
            update(TastePair)
            .where(TastePair.id == UUID(pid))
            .values(labelled_at=last_week, first_labelled_at=last_week)
        )
        inbox = await a.inbox()
        assert inbox["budget"]["source"] == "default"
        assert inbox["budget"]["weekly_budget"] == DEFAULT_WEEKLY_BUDGET
        assert inbox["budget"]["labelled_this_week"] == 0
        assert inbox["labelled_total"] == 1

    def test_a_week_starts_monday_utc(self) -> None:
        sunday = datetime(2026, 10, 18, 23, 59, tzinfo=UTC)
        monday = datetime(2026, 10, 19, 0, 0, tzinfo=UTC)
        assert crud.week_start(sunday) == datetime(2026, 10, 12, tzinfo=UTC)
        assert crud.week_start(monday) == monday

    async def test_the_inbox_says_who_may_label(self, a: Harness) -> None:
        assert (await a.inbox())["can_label"] is True
        a.can_label = False
        inbox = await a.inbox()
        assert inbox["can_label"] is False
        assert inbox["reason_vocabulary"] == list(TASTE_REASONS)

    async def test_another_tenants_queue_is_invisible(
        self, a: Harness, b: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        await a.pair_id(x, y)
        theirs = await b.inbox()
        assert theirs["pending_total"] == 0 and theirs["pairs"] == []
        assert theirs["pool"]["images"] == 0


# ===========================================================================
# Layer 3 — labels
# ===========================================================================


class TestLabel:
    async def test_a_label_records_the_labeller_the_time_and_the_answer(
        self, a: Harness, operator: User
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        resp = await a.label(
            pid,
            "b",
            reasons=["off_palette", "composition"],
            comment="  B reads warmer  ",
            edit_note="crop to the subject",
        )
        assert resp.status_code == 200, resp.text
        out = resp.json()
        assert out["label"] == "b"
        assert out["reasons"] == ["off_palette", "composition"]
        assert out["comment"] == "B reads warmer"
        assert out["edit_note"] == "crop to the subject"
        assert out["labeller_user_id"] == str(operator.id)
        assert out["labeller_name"] == "Operator"
        assert out["labelled_at"] is not None

    async def test_a_second_labeller_is_refused_not_overwritten(
        self, a: Harness, operator: User
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        assert (await a.label(pid, "a")).status_code == 200
        a.labeller = await _user(a.db, "colleague")
        refused = await a.label(pid, "b")
        assert refused.status_code == 409
        assert refused.json()["error"] == "pair_already_labelled"
        assert refused.json()["current"]["label"] == "a"
        row = await crud.get_pair(a.db, tenant_id=a.tenant, pair_id=UUID(pid))
        assert (
            row is not None and row.label == "a" and row.labeller_user_id == operator.id
        )

        replaced = await a.label(pid, "b", relabel=True)
        assert replaced.status_code == 200
        assert replaced.json()["labeller_user_id"] == str(a.labeller.id)

    async def test_undo_returns_the_pair_to_the_queue(self, a: Harness) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        assert (
            await a.label(pid, "both_bad", reasons=["low_quality"])
        ).status_code == 200
        assert _ids((await a.inbox())["pairs"]) == []
        undone = await a.http.delete(f"{API}/pairs/{pid}/label")
        assert undone.status_code == 200
        assert undone.json()["label"] is None and undone.json()["reasons"] == []
        assert undone.json()["labeller_user_id"] is None
        # Nothing is erased silently: the removed answer stays on the row.
        undo = undone.json()["undo"]
        assert undo["forced"] is False
        assert undo["undone_by_user_id"] == str(a.labeller.id)
        assert undo["removed"]["label"] == "both_bad"
        assert undo["removed"]["reasons"] == ["low_quality"]
        assert undo["removed"]["labeller_user_id"] == str(a.labeller.id)
        assert undone.json()["tombstone"] is True
        assert _ids((await a.inbox())["pairs"]) == [pid]
        again = await a.http.delete(f"{API}/pairs/{pid}/label")
        assert again.status_code == 409 and again.json()["error"] == "pair_not_labelled"

    async def test_a_labelled_pair_cannot_be_skipped(self, a: Harness) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        await a.label(pid, "a")
        resp = await a.http.post(f"{API}/pairs/{pid}/skip")
        assert resp.status_code == 409

    async def test_a_label_clears_the_skip(self, a: Harness) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        await a.http.post(f"{API}/pairs/{pid}/skip")
        out = (await a.label(pid, "a")).json()
        assert out["skipped_at"] is None and out["skip_count"] == 1

    @pytest.mark.parametrize(
        "body",
        [
            {"choice": "c"},
            {"choice": "a", "reasons": ["vibes"]},
            {"choice": "a", "reasons": ["on_style", "on_style"]},
            {"choice": "a", "comment": "x" * 2001},
            {"choice": "a", "edit_note": "x" * 2001},
            {"choice": "a", "labeller": "someone else"},
        ],
    )
    async def test_malformed_labels_are_refused(
        self, a: Harness, body: dict[str, Any]
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        resp = await a.http.put(f"{API}/pairs/{pid}/label", json=body)
        assert resp.status_code == 422, resp.text
        row = await crud.get_pair(a.db, tenant_id=a.tenant, pair_id=UUID(pid))
        assert row is not None and row.label is None

    async def test_an_edited_image_is_attached_only_if_the_tenant_holds_it(
        self, a: Harness, b: Harness
    ) -> None:
        x, y, edit = await _images(a, "x", "y", "edit", kind="exemplar")
        [theirs] = await _images(b, "theirs")
        pid = await a.pair_id(x, y)
        missing = await a.label(pid, "a", edit_asset_sha256=theirs)
        assert missing.status_code == 404
        ok = await a.label(pid, "a", edit_asset_sha256=edit)
        assert ok.status_code == 200 and ok.json()["edit_asset_sha256"] == edit

    async def test_another_tenants_pair_cannot_be_labelled(
        self, a: Harness, b: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        assert (await b.label(pid, "a")).status_code == 404
        assert (await b.http.post(f"{API}/pairs/{pid}/skip")).status_code == 404
        assert (await b.http.delete(f"{API}/pairs/{pid}/label")).status_code == 404


# ===========================================================================
# Layer 4 — calibration batch and settings
# ===========================================================================


class TestCalibration:
    async def test_the_batch_pairs_across_directions_and_is_idempotent(
        self, a: Harness
    ) -> None:
        base = datetime(2026, 10, 1, tzinfo=UTC)
        for i, direction in enumerate(["warm", "warm", "cool", "cool"]):
            await _asset(
                a.db,
                a.tenant,
                f"gen-{i}",
                provenance={"direction": direction},
                created_at=base + timedelta(minutes=i),
            )
        await _asset(
            a.db, a.tenant, "ref", kind="exemplar", created_at=base + timedelta(hours=1)
        )
        # Renderings of other images are not taste options.
        await _asset(a.db, a.tenant, "der", kind="derivative")
        await _asset(a.db, a.tenant, "cap", kind="capture")

        built = await a.http.post(f"{API}/calibration-batch", json={"size": 3})
        assert built.status_code == 200, built.text
        result = built.json()
        assert result["created"] == 3 and result["shortfall"] is None
        assert result["pool"]["images"] == 5
        assert {d["direction"]: d["images"] for d in result["pool"]["directions"]} == {
            "cool": 2,
            "reference": 1,
            "warm": 2,
        }
        pairs = (await a.inbox())["pairs"]
        assert {p["source"] for p in pairs} == {"calibration"}
        assert all(p["repo"] is None and p["slot_id"] is None for p in pairs)
        spans = {frozenset(p["context"]["directions"]) for p in pairs}
        assert spans == {
            frozenset({"cool", "reference"}),
            frozenset({"cool", "warm"}),
            frozenset({"reference", "warm"}),
        }

        rebuilt = (
            await a.http.post(f"{API}/calibration-batch", json={"size": 3})
        ).json()
        assert rebuilt["already_queued"] == 3
        assert rebuilt["created"] == 3  # three NEW pairs, none repeated
        assert not set(rebuilt["pair_ids"]) & set(result["pair_ids"])

        everything = (
            await a.http.post(f"{API}/calibration-batch", json={"size": 100})
        ).json()
        assert everything["shortfall"] == "pool_exhausted"
        assert (await a.inbox(over_budget="true"))["pending_total"] == 10  # C(5, 2)

    async def test_a_pool_of_one_says_so(self, a: Harness) -> None:
        await _images(a, "only")
        result = (await a.http.post(f"{API}/calibration-batch", json={})).json()
        assert result["created"] == 0
        assert result["shortfall"] == "pool_too_small"
        assert result["requested"] == 20

    async def test_the_budget_is_bounded(self, a: Harness) -> None:
        for bad in (0, 1001, "many"):
            resp = await a.http.put(f"{API}/settings", json={"weekly_budget": bad})
            assert resp.status_code == 422
        ok = await a.http.put(f"{API}/settings", json={"weekly_budget": 12})
        assert ok.json()["weekly_budget"] == 12 and ok.json()["source"] == "setting"
        assert (await a.http.put(f"{API}/settings", json={"weekly_budget": 13})).json()[
            "weekly_budget"
        ] == 13


# ===========================================================================
# Layer 5 — the taste twin's read
# ===========================================================================


async def test_labels_page_oldest_first_with_a_cursor(a: Harness) -> None:
    imgs = await _images(a, *"abcdef")
    ids = [await a.pair_id(imgs[i], imgs[i + 1]) for i in range(0, 6, 2)]
    for pid in ids:
        assert (await a.label(pid, "a")).status_code == 200
    unanswered = await a.pair_id(imgs[0], imgs[3])

    page1 = (await a.http.get(f"{API}/labels", params={"limit": 2})).json()
    assert page1["truncated"] is True and page1["next_cursor"]
    page2 = (
        await a.http.get(
            f"{API}/labels", params={"limit": 2, "after": page1["next_cursor"]}
        )
    ).json()
    # The last page carries a cursor too, so a reader can follow the feed.
    assert page2["truncated"] is False and page2["next_cursor"]
    seen = _ids(page1["labels"]) + _ids(page2["labels"])
    assert seen == ids
    assert unanswered not in seen
    caught_up = (
        await a.http.get(f"{API}/labels", params={"after": page2["next_cursor"]})
    ).json()
    assert caught_up["labels"] == [] and caught_up["truncated"] is False
    assert caught_up["next_cursor"] == page2["next_cursor"]

    bad = await a.http.get(f"{API}/labels", params={"after": "not-a-cursor"})
    assert bad.status_code == 422 and bad.json()["error"] == "invalid_cursor"


async def test_the_label_feed_carries_undos_as_tombstones_and_moves_a_changed_pair(
    a: Harness,
) -> None:
    imgs = await _images(a, *"abcd")
    first = await a.pair_id(imgs[0], imgs[1])
    second = await a.pair_id(imgs[2], imgs[3])
    assert (await a.label(first, "a")).status_code == 200
    assert (await a.label(second, "b")).status_code == 200

    async def feed(after: str | None = None) -> dict[str, Any]:
        params = {"after": after} if after else {}
        resp = await a.http.get(f"{API}/labels", params=params)
        assert resp.status_code == 200, resp.text
        return dict(resp.json())

    before = await feed()
    assert _ids(before["labels"]) == [first, second]
    assert [r["tombstone"] for r in before["labels"]] == [False, False]

    assert (await a.http.delete(f"{API}/pairs/{first}/label")).status_code == 200
    # A follower that already read the two labels meets the undo next.
    news = await feed(before["next_cursor"])
    [tomb] = news["labels"]
    assert tomb["id"] == first and tomb["tombstone"] is True
    assert tomb["label"] is None and tomb["undo"]["removed"]["label"] == "a"

    assert (await a.label(second, "a", relabel=True)).status_code == 200
    replay = await feed()
    # Each pair once, at its latest change, in position order.
    assert _ids(replay["labels"]) == [first, second]
    assert [r["tombstone"] for r in replay["labels"]] == [True, False]
    seqs = [r["change_seq"] for r in replay["labels"]]
    assert seqs == sorted(seqs) and len(set(seqs)) == 2
    assert seqs[1] > max(r["change_seq"] for r in before["labels"])


async def test_feed_positions_are_handed_out_in_commit_order(test_engine: Any) -> None:
    """The property the twin's paging rests on: a second writer cannot take a
    position until the first writer's transaction ends, so no write can
    commit below a position a reader has already seen."""
    tenant = uuid4()
    try:
        async with test_engine.connect() as one, test_engine.connect() as two:
            await one.begin()
            await two.begin()
            first = AsyncSession(bind=one)
            second = AsyncSession(bind=two)
            seq1 = await crud._next_change_seq(first, tenant_id=tenant)
            waiter = asyncio.create_task(
                crud._next_change_seq(second, tenant_id=tenant)
            )
            await asyncio.sleep(0.5)
            assert not waiter.done(), "a second writer took a position mid-write"
            await one.commit()
            seq2 = await asyncio.wait_for(waiter, timeout=10)
            assert seq2 == seq1 + 1
            await two.commit()
    finally:
        async with test_engine.begin() as conn:
            await conn.execute(
                delete(TasteLabelClock).where(TasteLabelClock.tenant_id == tenant)
            )


async def test_a_device_credential_is_never_handed_a_labellers_email(
    a: Harness,
) -> None:
    x, y = await _images(a, "x", "y")
    pid = await a.pair_id(x, y)
    nameless = await _user(a.db, "nameless")
    nameless.full_name = None
    await a.db.flush()
    a.labeller = nameless
    assert (await a.label(pid, "a")).status_code == 200

    [feed_row] = (await a.http.get(f"{API}/labels")).json()["labels"]
    assert feed_row["labeller_user_id"] == str(nameless.id)
    assert feed_row["labeller_name"] is None
    [recent] = (await a.inbox())["recent"]
    assert recent["labeller_name"] is None

    a.actor = "operator"
    [recent] = (await a.inbox())["recent"]
    assert recent["labeller_name"] == nameless.email


# ===========================================================================
# Layer 5b — undo ownership, the withdraw gate, the labeller rule
# ===========================================================================


class TestUndoOwnership:
    async def test_undo_reaches_only_your_own_label_unless_forced_and_force_is_recorded(
        self, a: Harness, operator: User
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        mine = await a.label(pid, "a", reasons=["on_style"], comment="warmer")
        assert mine.status_code == 200

        colleague = await _user(a.db, "colleague")
        a.labeller = colleague
        refused = await a.http.delete(f"{API}/pairs/{pid}/label")
        assert refused.status_code == 409, refused.text
        assert refused.json()["error"] == "label_not_yours"
        assert refused.json()["current"]["labeller_user_id"] == str(operator.id)
        row = await crud.get_pair(a.db, tenant_id=a.tenant, pair_id=UUID(pid))
        assert row is not None and row.label == "a"
        assert row.labeller_user_id == operator.id and row.undone_at is None

        forced = await a.http.delete(
            f"{API}/pairs/{pid}/label", params={"force": "true"}
        )
        assert forced.status_code == 200, forced.text
        undo = forced.json()["undo"]
        assert undo["forced"] is True
        assert undo["undone_by_user_id"] == str(colleague.id)
        assert undo["undone_by_name"] == "Colleague"
        removed = undo["removed"]
        assert removed["label"] == "a" and removed["reasons"] == ["on_style"]
        assert removed["comment"] == "warmer"
        assert removed["labeller_user_id"] == str(operator.id)
        assert removed["labeller_name"] == "Operator"
        assert removed["labelled_at"] == mine.json()["labelled_at"]
        assert _ids((await a.inbox())["pairs"]) == [pid]

    async def test_force_on_your_own_label_is_not_recorded_as_forced(
        self, a: Harness
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        assert (await a.label(pid, "b")).status_code == 200
        out = await a.http.delete(f"{API}/pairs/{pid}/label", params={"force": "true"})
        assert out.status_code == 200 and out.json()["undo"]["forced"] is False

    async def test_the_inbox_names_its_viewer_to_an_operator_only(
        self, a: Harness, operator: User
    ) -> None:
        assert (await a.inbox())["viewer_user_id"] is None
        a.actor = "operator"
        assert (await a.inbox())["viewer_user_id"] == str(operator.id)


class TestWithdrawGate:
    async def test_an_operator_withdraws_only_when_they_may_label(
        self, a: Harness
    ) -> None:
        x, y, z = await _images(a, "x", "y", "z")
        pid = await a.pair_id(x, y)
        a.actor, a.can_label = "operator", False
        refused = await a.http.delete(f"{API}/pairs/{pid}")
        assert refused.status_code == 403, refused.text
        assert refused.json()["error"] == "not_coord_tenant_admin"
        assert await crud.get_pair(a.db, tenant_id=a.tenant, pair_id=UUID(pid))
        a.can_label = True
        assert (await a.http.delete(f"{API}/pairs/{pid}")).status_code == 204

    async def test_studios_device_path_stays_open(self, a: Harness) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        a.actor, a.can_label = "device", False
        assert (await a.http.delete(f"{API}/pairs/{pid}")).status_code == 204


class TestDeletedMidWrite:
    async def test_an_image_deleted_mid_push_is_a_404_not_a_500(
        self, a: Harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        [x] = await _images(a, "x")

        async def checked_before_the_delete(*_args: Any, **_kw: Any) -> None:
            return None

        monkeypatch.setattr(endpoints, "_require_assets", checked_before_the_delete)
        gone = await a.push(x, _sha("deleted-meanwhile"))
        assert gone.status_code == 404, gone.text
        assert gone.json()["error"] == "image_asset_not_found"
        # Only the push's savepoint rolled back: the session still writes.
        [y] = await _images(a, "y")
        assert (await a.push(x, y)).status_code == 201

    async def test_an_edit_image_deleted_mid_label_is_a_404(
        self, a: Harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        x, y = await _images(a, "x", "y")
        pid = await a.pair_id(x, y)
        ghost = _sha("edit-deleted-meanwhile")
        real = crud.get_assets

        async def still_there_when_checked(
            db: AsyncSession, *, tenant_id: UUID, shas: Any
        ) -> dict[str, Any]:
            wanted = list(shas)
            found: dict[str, Any] = dict(
                await real(db, tenant_id=tenant_id, shas=wanted)
            )
            if ghost in wanted:
                found[ghost] = object()
            return found

        monkeypatch.setattr(crud, "get_assets", still_there_when_checked)
        resp = await a.label(pid, "a", edit_asset_sha256=ghost)
        assert resp.status_code == 404, resp.text
        assert resp.json()["field"] == "edit_asset_sha256"
        row = await crud.get_pair(a.db, tenant_id=a.tenant, pair_id=UUID(pid))
        assert row is not None and row.label is None

    async def test_a_pool_image_deleted_mid_build_is_a_409(
        self, a: Harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        [x] = await _images(a, "x")

        async def pool_with_a_deleted_image(
            db: AsyncSession, *, tenant_id: UUID
        ) -> list[PoolImage]:
            return [
                PoolImage(sha256=x, direction="warm"),
                PoolImage(sha256=_sha("pool-deleted"), direction="cool"),
            ]

        monkeypatch.setattr(crud, "calibration_pool", pool_with_a_deleted_image)
        resp = await a.http.post(f"{API}/calibration-batch", json={"size": 1})
        assert resp.status_code == 409, resp.text
        assert resp.json()["error"] == "calibration_pool_changed"


class TestBudgetCharge:
    async def test_relabelling_an_older_pair_costs_nothing_this_week(
        self, a: Harness
    ) -> None:
        x, y, z = await _images(a, "x", "y", "z")
        old = await a.pair_id(x, y)
        assert (await a.label(old, "a")).status_code == 200
        last_week = crud.week_start(datetime.now(UTC)) - timedelta(seconds=1)
        await a.db.execute(
            update(TastePair)
            .where(TastePair.id == UUID(old))
            .values(labelled_at=last_week, first_labelled_at=last_week)
        )
        assert (await a.label(old, "b", relabel=True)).status_code == 200
        assert (await a.inbox())["budget"]["labelled_this_week"] == 0
        # An undo and a fresh answer are not a new question either.
        assert (await a.http.delete(f"{API}/pairs/{old}/label")).status_code == 200
        assert (await a.label(old, "a")).status_code == 200
        assert (await a.inbox())["budget"]["labelled_this_week"] == 0
        # A pair first answered this week is charged.
        new = await a.pair_id(x, z)
        assert (await a.label(new, "a")).status_code == 200
        assert (await a.inbox())["budget"]["labelled_this_week"] == 1


class TestGetCanLabel:
    """The rule ``can_label`` reports, read directly — the harness overrides
    the dependency everywhere else."""

    TENANT_A = UUID(int=1)
    TENANT_B = UUID(int=2)

    def _request(self, active: str | None, identity: CoordIdentity | None) -> Request:
        headers = (
            [] if active is None else [(b"x-qontinui-active-tenant", active.encode())]
        )
        request = Request(
            {"type": "http", "method": "GET", "path": "/", "headers": headers}
        )
        if identity is not None:
            request.state._coord_identity = identity
        return request

    def _identity(
        self, roles_a: tuple[str, ...], roles_b: tuple[str, ...]
    ) -> CoordIdentity:
        return CoordIdentity(
            operator_id=None,
            home_tenant_id=self.TENANT_A,
            email=None,
            roles=(),
            tenants=(
                CoordTenant(tenant_id=self.TENANT_A, slug="a", roles=roles_a),
                CoordTenant(tenant_id=self.TENANT_B, slug="b", roles=roles_b),
            ),
            is_admin="admin" in roles_a + roles_b,
        )

    def _principal(self, actor: str) -> MemoryPrincipal:
        return MemoryPrincipal(tenant_id=self.TENANT_A, device_id=None, actor=actor)

    @staticmethod
    def _user(superuser: bool) -> User:
        return User(email="x@example.com", username="x", is_superuser=superuser)

    async def test_a_device_or_service_credential_never_labels(self) -> None:
        for actor in ("device", "coord_service"):
            assert (
                await endpoints.get_can_label(
                    self._request(None, None), self._principal(actor), self._user(True)
                )
                is False
            )

    async def test_an_operator_session_with_no_user_does_not_label(self) -> None:
        assert (
            await endpoints.get_can_label(
                self._request(None, None), self._principal("operator"), None
            )
            is False
        )

    async def test_a_superuser_labels_without_consulting_coord(self) -> None:
        # No identity on the request: consulting coord would raise 401.
        assert (
            await endpoints.get_can_label(
                self._request(None, None), self._principal("operator"), self._user(True)
            )
            is True
        )

    @pytest.mark.parametrize(
        ("roles_a", "roles_b", "active", "expected"),
        [
            (("admin",), ("developer",), None, True),
            (("admin",), ("developer",), str(UUID(int=2)), False),
            (("developer",), ("admin",), str(UUID(int=2)), True),
            (("developer",), ("admin",), "b", True),
            (("developer",), ("admin",), None, False),
            # A selection naming no membership falls back to home.
            (("admin",), ("developer",), str(UUID(int=99)), True),
        ],
    )
    async def test_admin_is_read_in_the_effective_tenant(
        self,
        roles_a: tuple[str, ...],
        roles_b: tuple[str, ...],
        active: str | None,
        expected: bool,
    ) -> None:
        request = self._request(active, self._identity(roles_a, roles_b))
        assert (
            await endpoints.get_can_label(
                request, self._principal("operator"), self._user(False)
            )
            is expected
        )


# ===========================================================================
# Layer 6 — the real app's wiring
# ===========================================================================


@pytest.fixture()
def real_app() -> Iterator[FastAPI]:
    from app.main import app

    yield app


async def test_the_routes_are_mounted_on_the_real_app(real_app: FastAPI) -> None:
    from fastapi.routing import APIRoute

    routes = {
        (method, route.path)
        for route in real_app.routes
        if isinstance(route, APIRoute) and route.path.startswith(API)
        for method in route.methods or ()
    }
    assert routes == {
        ("GET", f"{API}/inbox"),
        ("POST", f"{API}/pairs"),
        ("DELETE", f"{API}/pairs/{{pair_id}}"),
        ("PUT", f"{API}/pairs/{{pair_id}}/label"),
        ("DELETE", f"{API}/pairs/{{pair_id}}/label"),
        ("POST", f"{API}/pairs/{{pair_id}}/skip"),
        ("POST", f"{API}/calibration-batch"),
        ("PUT", f"{API}/settings"),
        ("GET", f"{API}/labels"),
    }


async def test_the_real_app_runs_the_real_dependencies(real_app: FastAPI) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=real_app), base_url="http://test"
    ) as http:
        inbox = await http.get(f"{API}/inbox")
        label = await http.put(f"{API}/pairs/{uuid4()}/label", json={"choice": "a"})
    assert inbox.status_code == 401
    assert inbox.json()["message"] == "Authentication required."
    # The label door is an operator's session, never a bare request.
    assert label.status_code == 401


def test_the_label_door_admits_no_device_credential() -> None:
    """A taste label is a human's: the label, skip, budget and calibration
    routes depend on the admin gate, never on the device-admitting tenant
    dependency the push uses."""
    from fastapi.routing import APIRoute

    from app.core.evidence_posture import device_jwt_admitting_dependencies
    from app.main import app as real_app

    admitting = device_jwt_admitting_dependencies()

    def tree(dependant: Any) -> set[Any]:
        found = {dependant.call}
        for dep in dependant.dependencies:
            found |= tree(dep)
        return found

    human_only = {
        ("PUT", f"{API}/pairs/{{pair_id}}/label"),
        ("DELETE", f"{API}/pairs/{{pair_id}}/label"),
        ("POST", f"{API}/pairs/{{pair_id}}/skip"),
        ("POST", f"{API}/calibration-batch"),
        ("PUT", f"{API}/settings"),
    }
    checked = 0
    for route in real_app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods or ():
            if (method, route.path) in human_only:
                calls = tree(route.dependant)
                assert endpoints.get_labeller in calls
                assert not (calls & admitting), (method, route.path)
                checked += 1
    assert checked == len(human_only)
