"""Plan difficulty — stored, kept current, and served.

Plan ``2026-09-18-plan-library-difficulty-field``. The rubric itself is pinned
by ``tests/test_plan_difficulty.py``; this file pins the STORAGE contract:

* every write of a plan body rates it, a non-plan is never rated, and a kind
  correction onto or away from ``plan`` rates or clears the row;
* a plan stored with no rating (every row that predates the column) or under an
  older rubric is re-rated by the read path, WITHOUT moving ``updated_at`` —
  consumers sort on that stamp, and a derived rating is not a touch;
* ``GET /plan-library/difficulty`` serves only rated plans, scoped to the
  caller, with the model-tier map beside them.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import work_artifact as crud
from app.models.work_artifact import WorkArtifact
from app.services.plan_difficulty import RUBRIC_VERSION
from tests.test_plan_library_api import API_PREFIX, _build_app

pytestmark = pytest.mark.asyncio

#: A body the rubric rates ``high`` through its own declared stamp — the
#: cheapest body whose rating differs from an empty one's.
_HIGH_BODY = "# plan\n\n**Difficulty:** high\n"
_LOW_BODY = "# plan\n\nOne small change.\n"


@pytest_asyncio.fixture()
async def http(async_db_session: AsyncSession):
    """``test_plan_library_api``'s app, authenticated as a fresh user."""
    from app.models.user import User

    user = User(
        email=f"difficulty_{uuid4().hex[:8]}@example.com",
        username=f"difficulty_{uuid4().hex[:8]}",
        full_name="Difficulty Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    app = _build_app(db_session=async_db_session, user=user)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


async def _upsert(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    body: str,
    kind: str = "plan",
) -> WorkArtifact:
    row, _created, _changed = await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=None,
        kind=kind,
        slug=slug,
        title="t",
        status="VETTED",
        body=body,
        source_path=None,
        source_repo="qontinui-dev-notes/plans",
        work_unit_slug=slug,
        repos=[],
        authored_at=None,
        captured_by="agent",
        change_description=None,
        created_by="test",
    )
    return row


class TestWritesRate:
    async def test_a_new_plan_is_rated(self, async_db_session: AsyncSession) -> None:
        row = await _upsert(
            async_db_session, org_id=uuid4(), slug=_slug("new"), body=_HIGH_BODY
        )
        assert row.difficulty == "high"
        assert row.difficulty_source == "declared"
        assert row.difficulty_conceptual == "low"
        assert row.difficulty_implementation == "low"
        assert row.difficulty_rubric_version == RUBRIC_VERSION
        assert row.difficulty_signals is not None
        assert row.difficulty_signals["computed_level"] == "low"

    async def test_a_non_plan_is_not_rated(
        self, async_db_session: AsyncSession
    ) -> None:
        row = await _upsert(
            async_db_session,
            org_id=uuid4(),
            slug=_slug("prompt"),
            body=_HIGH_BODY,
            kind="implementation_prompt",
        )
        assert row.difficulty is None
        assert row.difficulty_rubric_version is None
        assert row.difficulty_signals is None

    async def test_a_body_change_re_rates(self, async_db_session: AsyncSession) -> None:
        org, slug = uuid4(), _slug("edit")
        await _upsert(async_db_session, org_id=org, slug=slug, body=_LOW_BODY)
        row = await _upsert(async_db_session, org_id=org, slug=slug, body=_HIGH_BODY)
        assert row.current_version == 2
        assert row.difficulty == "high"

    async def test_a_kind_correction_rates_and_clears(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        row = await _upsert(
            async_db_session,
            org_id=org,
            slug=_slug("kind"),
            body=_HIGH_BODY,
            kind="handoff",
        )
        assert row.difficulty is None

        row = await crud.set_artifact_kind(
            async_db_session, row, kind="plan", org_id=org
        )
        assert row.difficulty == "high"

        row = await crud.set_artifact_kind(
            async_db_session, row, kind="handoff", org_id=org
        )
        assert row.difficulty is None
        assert row.difficulty_signals is None


class TestStaleRowsAreRerated:
    async def _make_stale(
        self, db: AsyncSession, row_id: UUID, *, rubric_version: int | None
    ) -> None:
        values: dict[str, object] = {"difficulty_rubric_version": rubric_version}
        if rubric_version is None:
            values.update(
                difficulty=None,
                difficulty_conceptual=None,
                difficulty_implementation=None,
                difficulty_source=None,
                difficulty_signals=None,
            )
        else:
            values["difficulty"] = "low"  # what an older rubric said
        await db.execute(
            update(WorkArtifact)
            .where(WorkArtifact.id == row_id)
            .values(**values, updated_at=WorkArtifact.updated_at)
        )
        await db.commit()

    @pytest.mark.parametrize("stale_version", [None, RUBRIC_VERSION - 1])
    async def test_rerating_fills_the_rating_and_keeps_updated_at(
        self, async_db_session: AsyncSession, stale_version: int | None
    ) -> None:
        org = uuid4()
        row = await _upsert(
            async_db_session, org_id=org, slug=_slug("stale"), body=_HIGH_BODY
        )
        row_id = row.id
        await self._make_stale(async_db_session, row_id, rubric_version=stale_version)
        async_db_session.expire_all()
        before = (
            await async_db_session.execute(
                select(WorkArtifact.updated_at).where(WorkArtifact.id == row_id)
            )
        ).scalar_one()

        outcome = await crud.rerate_stale_plan_difficulty(async_db_session, org_id=org)
        assert (outcome.written, outcome.pending) == (1, 0)
        # Idempotent: nothing is stale the second time.
        again = await crud.rerate_stale_plan_difficulty(async_db_session, org_id=org)
        assert (again.written, again.pending) == (0, 0)

        async_db_session.expire_all()
        after = (
            await async_db_session.execute(
                select(WorkArtifact).where(WorkArtifact.id == row_id)
            )
        ).scalar_one()
        assert after.difficulty == "high"
        assert after.difficulty_rubric_version == RUBRIC_VERSION
        assert after.updated_at == before, "a derived rating is not a touch"

    async def test_rerating_is_scoped_to_the_callers_organization(
        self, async_db_session: AsyncSession
    ) -> None:
        mine, theirs = uuid4(), uuid4()
        their_row = await _upsert(
            async_db_session, org_id=theirs, slug=_slug("theirs"), body=_HIGH_BODY
        )
        their_id = their_row.id
        await self._make_stale(async_db_session, their_id, rubric_version=None)

        outcome = await crud.rerate_stale_plan_difficulty(async_db_session, org_id=mine)
        assert (outcome.written, outcome.pending) == (0, 0)
        async_db_session.expire_all()
        still = (
            await async_db_session.execute(
                select(WorkArtifact.difficulty).where(WorkArtifact.id == their_id)
            )
        ).scalar_one()
        assert still is None

    async def test_a_pass_is_capped_and_reports_what_is_left(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        for n in range(3):
            row = await _upsert(
                async_db_session, org_id=org, slug=_slug(f"cap{n}"), body=_HIGH_BODY
            )
            await self._make_stale(async_db_session, row.id, rubric_version=None)

        first = await crud.rerate_stale_plan_difficulty(
            async_db_session, org_id=org, limit=2
        )
        assert (first.written, first.pending) == (2, 1)
        second = await crud.rerate_stale_plan_difficulty(
            async_db_session, org_id=org, limit=2
        )
        assert (second.written, second.pending) == (1, 0)

    async def test_a_rating_computed_before_a_newer_write_is_not_applied(
        self, async_db_session: AsyncSession
    ) -> None:
        """The race: a pass reads a body, a writer changes it, the pass writes.

        The writer here is one that does NOT rate — a web task still on the
        previous build during a rolling deploy — so the row is still stale when
        the pass writes, and only the digest guard stands between the OLD
        body's rating and the new body. Without it the stale rating is stamped
        at the current rubric version, and nothing ever re-rates it.
        """
        org, slug = uuid4(), _slug("race")
        row = await _upsert(async_db_session, org_id=org, slug=slug, body=_HIGH_BODY)
        row_id, old_digest = row.id, row.content_sha256
        await self._make_stale(async_db_session, row_id, rubric_version=None)

        # The pass's snapshot, taken from the OLD body...
        stale = crud.RatedSnapshot(
            id=row_id,
            kind="plan",
            content_sha256=old_digest,
            values=crud.difficulty_values("plan", _HIGH_BODY),
        )
        # ...then an old-build writer lands a new body and leaves it unrated...
        await _upsert(async_db_session, org_id=org, slug=slug, body=_LOW_BODY)
        await self._make_stale(async_db_session, row_id, rubric_version=None)
        # ...then the pass writes.
        assert await crud.apply_rated_snapshots(async_db_session, [stale]) == 0
        await async_db_session.commit()

        # The next pass rates what is actually there.
        outcome = await crud.rerate_stale_plan_difficulty(async_db_session, org_id=org)
        assert outcome.written == 1
        async_db_session.expire_all()
        now = (
            await async_db_session.execute(
                select(WorkArtifact.difficulty).where(WorkArtifact.id == row_id)
            )
        ).scalar_one()
        assert now == "low", "the stale pass overwrote the newer body's rating"

    async def test_a_pass_does_not_rewrite_a_row_a_concurrent_pass_rated(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        row = await _upsert(
            async_db_session, org_id=org, slug=_slug("twice"), body=_HIGH_BODY
        )
        snap = crud.RatedSnapshot(
            id=row.id,
            kind="plan",
            content_sha256=row.content_sha256,
            values=crud.difficulty_values("plan", _HIGH_BODY),
        )
        # The upsert already rated it at the current rubric.
        assert await crud.apply_rated_snapshots(async_db_session, [snap]) == 0

    async def test_a_rating_is_not_applied_to_a_row_whose_kind_moved(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        row = await _upsert(
            async_db_session, org_id=org, slug=_slug("moved"), body=_HIGH_BODY
        )
        row_id, digest = row.id, row.content_sha256
        await self._make_stale(async_db_session, row_id, rubric_version=None)
        stale = crud.RatedSnapshot(
            id=row_id,
            kind="plan",
            content_sha256=digest,
            values=crud.difficulty_values("plan", _HIGH_BODY),
        )
        await crud.set_artifact_kind(async_db_session, row, kind="handoff", org_id=org)
        assert await crud.apply_rated_snapshots(async_db_session, [stale]) == 0


class TestDifficultyRoute:
    async def test_it_serves_rated_plans_with_the_model_tiers(
        self, http: httpx.AsyncClient
    ) -> None:
        slug = _slug("route")
        created = await http.post(
            API_PREFIX,
            json={
                "kind": "plan",
                "slug": slug,
                "title": "Route plan",
                "status": "VETTED",
                "body": _HIGH_BODY,
                "work_unit_slug": slug,
            },
        )
        assert created.status_code == 201, created.text
        # The summary a write returns carries the rating too.
        assert created.json()["artifact"]["difficulty"] == "high"

        response = await http.get(f"{API_PREFIX}/difficulty")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["count"] == len(payload["items"])
        assert payload["rubric_version"] == RUBRIC_VERSION
        assert payload["rerate_failed_reason"] is None
        assert payload["rerate_pending"] == 0
        assert payload["model_tiers"]["high"] == "Fable 5.1"
        mine = [item for item in payload["items"] if item["slug"] == slug]
        assert len(mine) == 1
        assert mine[0]["work_unit_slug"] == slug
        assert mine[0]["difficulty"] == "high"
        assert mine[0]["difficulty_source"] == "declared"
        assert mine[0]["difficulty_signals"]["computed_level"] == "low"

    async def test_a_non_plan_is_not_served(self, http: httpx.AsyncClient) -> None:
        slug = _slug("route-prompt")
        created = await http.post(
            API_PREFIX,
            json={"kind": "handoff", "slug": slug, "title": "h", "body": _HIGH_BODY},
        )
        assert created.status_code == 201, created.text
        payload = (await http.get(f"{API_PREFIX}/difficulty")).json()
        assert all(item["slug"] != slug for item in payload["items"])

    async def test_candidates_carry_the_rating(self, http: httpx.AsyncClient) -> None:
        slug = _slug("2026-09-18-cand")
        created = await http.post(
            API_PREFIX,
            json={
                "kind": "plan",
                "slug": slug,
                "title": "Candidate plan",
                "status": "VETTED",
                "body": _HIGH_BODY,
            },
        )
        assert created.status_code == 201, created.text
        # Page through: the NULL-organization bucket this user writes into is
        # shared with every other test, so one page proves nothing.
        mine: list[dict] = []
        offset = 0
        while True:
            response = await http.get(
                f"{API_PREFIX}/candidates",
                params={"include_coord": "false", "limit": 100, "offset": offset},
            )
            assert response.status_code == 200, response.text
            page = response.json()
            mine += [c for c in page["items"] if c["slug"] == slug]
            offset += len(page["items"])
            if not page["items"] or offset >= page["total"]:
                break
        assert len(mine) == 1
        assert mine[0]["difficulty"] == "high"
        assert mine[0]["difficulty_source"] == "declared"
