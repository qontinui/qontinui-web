"""Every plan-library row states the currency of its own ``status``.

Plan ``2026-09-20-the-plan-library-serves-a-status-with-no-way-to-tell-whether-
it-is-current``, Phase 1 (D3/D4, as corrected by the 2026-09-29 vet).

Two layers:

* **DB-free** — :func:`status_currency_for` over rows RENDERED by the real
  :func:`scan_roots_health` from in-memory ``PlanScanRootObservation``s, so the
  verdict is judged against exactly what ``corpus_health.scan_roots`` serves.
  One case per D4 state, plus the vet's regression case: a fresh ``measured``
  reading ``behind: 1991`` with ``counts_are_floors: false`` is a feeder IN
  STEP — ``behind`` measures the parked checkout's HEAD, not the ref the body
  sync reads, and must not move the verdict.
* **HTTP** — the routes carry the block on every artifact row (list, detail,
  upsert, PATCH kind, candidates), keyed per row, and a failed scan-root read
  (inner savepoint) or a nulled corpus-health block (``/candidates``' outer
  savepoint) maps to ``unknown`` on every row while the route stays 200.

Mutation-proved when written: making the lookup ignore ``source_repo`` (serve
any key's rows) turns ``test_a_fresh_feeder_for_another_key_is_unfed_key`` red.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import work_artifact as crud
from app.models.plan_scan_root import PlanScanRootObservation
from app.models.work_artifact import WorkArtifact
from app.schemas.plan_library import (
    PlanCandidate,
    StatusCurrency,
    WorkArtifactDetail,
    WorkArtifactSummary,
)
from app.services.plan_scan_root_health import (
    FRESH_WITHIN_SECS,
    RETIRE_AFTER_SECS,
    scan_roots_health,
    scan_roots_read_failed,
    status_currency_for,
    status_currency_inputs,
)

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
KEY = "qontinui-dev-notes/plans"
OTHER_KEY = "qontinui-claude-config/plans"
REF = "c0ffee" + "0" * 34


# ───────────────────────────── DB-free ─────────────────────────────


def _obs(**overrides: object) -> PlanScanRootObservation:
    """The live 2026-09-29 shape: fresh, applied, ``measured``, parked 1991
    commits behind — against a ref fetched 5 s earlier (not a floor)."""
    fields: dict[str, object] = {
        "device_id": uuid4(),
        "organization_id": None,
        "state": "measured",
        "detail": None,
        "plans_dir": "/w/qontinui-dev-notes/plans",
        "repo_root": "/w/qontinui-dev-notes",
        "source_repo": KEY,
        "default_ref": "origin/main",
        "ref_sha": REF,
        "head_sha": "0d2390c07",
        "behind": 1991,
        "ahead": 0,
        "ref_age_secs": 5,
        "counts_are_floors": False,
        "observed_at": NOW,
        "received_at": NOW,
        "last_report_applied": True,
        "last_report_observed_at": NOW,
    }
    fields.update(overrides)
    return PlanScanRootObservation(**fields)


def _artifact(
    *, captured_by: str = "runner_scan", source_repo: str | None = KEY
) -> SimpleNamespace:
    return SimpleNamespace(
        captured_by=captured_by,
        source_repo=source_repo,
        updated_at=NOW - timedelta(hours=3),
    )


def _judge(
    artifact: SimpleNamespace,
    *observations: PlanScanRootObservation,
    include_retired: bool = False,
) -> StatusCurrency:
    """Render the readings exactly as ``corpus_health`` does, then judge."""
    block = scan_roots_health(observations, now=NOW, include_retired=include_retired)
    grouped, failed = status_currency_inputs(block)
    return status_currency_for(artifact, grouped, read_failed_detail=failed)


class TestStatesFromRenderedRows:
    def test_parked_primary_behind_1991_on_a_fresh_ref_is_fed_in_step(self) -> None:
        """The vet's regression case: ``behind`` is not a property of the body."""
        obs = _obs()
        currency = _judge(_artifact(), obs)
        assert currency.state == "fed_in_step"
        assert currency.as_of == NOW
        assert currency.ref_sha == REF
        assert currency.ref_age_secs == 5
        assert "behind" not in StatusCurrency.model_fields

    def test_every_reading_a_floor_is_fed_stale_ref(self) -> None:
        currency = _judge(
            _artifact(),
            _obs(counts_are_floors=True, ref_age_secs=None),
            # A 0-behind floor renders VERDICT unknown (``ref_stale:``) but is
            # still a fresh measured reading of a stale ref — the same arm.
            _obs(counts_are_floors=True, ref_age_secs=30_000, behind=0),
        )
        assert currency.state == "fed_stale_ref"
        assert currency.as_of == NOW
        # The freshest KNOWN ref age wins; an unknown age sorts last.
        assert currency.ref_age_secs == 30_000
        assert currency.detail is not None and currency.detail.startswith("ref_stale:")

    def test_one_in_step_reading_beside_floors_is_fed_in_step(self) -> None:
        currency = _judge(
            _artifact(),
            _obs(counts_are_floors=True, ref_age_secs=None),
            _obs(ref_age_secs=40, received_at=NOW - timedelta(seconds=60)),
        )
        assert currency.state == "fed_in_step"
        assert currency.ref_age_secs == 40
        assert currency.as_of == NOW - timedelta(seconds=60)

    def test_a_fresh_feeder_for_another_key_is_unfed_key(self) -> None:
        currency = _judge(_artifact(), _obs(source_repo=OTHER_KEY))
        assert currency.state == "unfed_key"
        assert currency.as_of is None
        assert currency.ref_sha is None
        assert currency.detail is not None and KEY in currency.detail

    def test_a_stale_in_step_reading_is_unknown(self) -> None:
        stale_at = NOW - timedelta(seconds=FRESH_WITHIN_SECS + 1)
        currency = _judge(_artifact(), _obs(received_at=stale_at))
        assert currency.state == "unknown"
        assert currency.as_of is None
        assert currency.detail is not None
        assert "observation_stale:" in currency.detail

    def test_the_freshness_window_is_inclusive(self) -> None:
        edge = NOW - timedelta(seconds=FRESH_WITHIN_SECS)
        assert _judge(_artifact(), _obs(received_at=edge)).state == "fed_in_step"

    def test_a_superseded_reading_is_unknown(self) -> None:
        currency = _judge(
            _artifact(),
            _obs(
                last_report_applied=False,
                last_report_observed_at=NOW - timedelta(seconds=90),
            ),
        )
        assert currency.state == "unknown"
        assert currency.detail is not None
        assert "reading_superseded:" in currency.detail

    def test_an_unmeasured_reading_is_unknown(self) -> None:
        currency = _judge(
            _artifact(),
            _obs(
                state="not_a_git_work_tree",
                detail="the plans dir is not inside a git work tree",
                behind=None,
                ahead=None,
                ref_age_secs=None,
            ),
        )
        assert currency.state == "unknown"
        assert currency.detail is not None
        assert "not inside a git work tree" in currency.detail

    def test_runner_scan_and_agent_rows_under_one_in_step_key_differ(self) -> None:
        obs = _obs()
        scanned = _judge(_artifact(captured_by="runner_scan"), obs)
        asserted = _judge(_artifact(captured_by="agent"), obs)
        by_operator = _judge(_artifact(captured_by="operator"), obs)
        assert scanned.state == "fed_in_step"
        assert asserted.state == "asserted_once"
        assert by_operator.state == "asserted_once"
        # ``as_of`` for a door write is the row's own last write.
        assert asserted.as_of == NOW - timedelta(hours=3)
        assert asserted.ref_sha is None

    def test_a_read_block_with_no_readings_is_unfed_key_not_unknown(self) -> None:
        """No rows in a table that WAS read is positive evidence — not a failure."""
        assert _judge(_artifact()).state == "unfed_key"

    def test_a_row_with_no_source_repo_is_unfed_key(self) -> None:
        """Never matched to readings that named no source either."""
        currency = _judge(_artifact(source_repo=None), _obs(source_repo=None))
        assert currency.state == "unfed_key"

    def test_a_retired_reading_vouches_for_nothing(self) -> None:
        gone = NOW - timedelta(seconds=RETIRE_AFTER_SECS + 60)
        currency = _judge(
            _artifact(),
            _obs(received_at=gone, observed_at=gone, last_report_observed_at=gone),
            include_retired=True,
        )
        assert currency.state == "unfed_key"

    def test_a_failed_scan_root_read_is_unknown_with_its_detail(self) -> None:
        block = scan_roots_read_failed(RuntimeError("boom"))
        grouped, failed = status_currency_inputs(block)
        currency = status_currency_for(_artifact(), grouped, read_failed_detail=failed)
        assert currency.state == "unknown"
        assert currency.detail == block.detail
        assert currency.detail is not None and currency.detail.startswith(
            "read_failed:"
        )

    def test_a_nulled_corpus_health_block_is_unknown_with_its_reason(self) -> None:
        reason = "read_failed: the corpus health block could not be read (X)"
        grouped, failed = status_currency_inputs(None, unavailable_reason=reason)
        currency = status_currency_for(_artifact(), grouped, read_failed_detail=failed)
        assert currency.state == "unknown"
        assert currency.detail == reason

    def test_asserted_once_precedes_a_failed_read(self) -> None:
        """``captured_by`` alone decides it — no reading is consulted."""
        currency = status_currency_for(
            _artifact(captured_by="agent"),
            {},
            read_failed_detail="read_failed: x",
        )
        assert currency.state == "asserted_once"


class TestSchemaHasNoDefault:
    """A default here would be a verdict nobody computed — the defect itself."""

    def test_summary_status_currency_is_required(self) -> None:
        field = WorkArtifactSummary.model_fields["status_currency"]
        assert field.is_required()
        assert WorkArtifactDetail.model_fields["status_currency"].is_required()

    def test_candidate_fields_are_required_keys(self) -> None:
        assert PlanCandidate.model_fields["status_currency"].is_required()
        assert PlanCandidate.model_fields["content_sha256"].is_required()

    def test_a_summary_without_it_does_not_validate(self) -> None:
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="status_currency"):
            WorkArtifactSummary.model_validate(
                {
                    "id": uuid4(),
                    "organization_id": None,
                    "created_by_user_id": None,
                    "kind": "plan",
                    "kind_locked": False,
                    "slug": "s",
                    "title": "t",
                    "status": "draft",
                    "content_sha256": "0" * 64,
                    "source_path": None,
                    "source_repo": KEY,
                    "work_unit_slug": None,
                    "repos": [],
                    "intent_refs": [],
                    "authored_at": None,
                    "captured_by": "runner_scan",
                    "current_version": 1,
                    "created_at": NOW,
                    "updated_at": NOW,
                }
            )

    def test_a_work_unit_only_candidate_carries_null_currency(self) -> None:
        from app.api.v1.endpoints.plan_library import _work_unit_candidate

        unit = crud.CandidateWorkUnit(
            slug="2026-09-29-x",
            status="",
            title=None,
            source_path="plans/2026-09-29-x.md",
            repos=("qontinui-web",),
            created_at=NOW,
            updated_at=NOW,
            order_key=NOW,
        )
        candidate = _work_unit_candidate(unit, NOW)
        assert candidate.status_currency is None
        assert candidate.content_sha256 is None
        dumped = candidate.model_dump()
        assert "status_currency" in dumped and "content_sha256" in dumped


# ───────────────────────────── HTTP ─────────────────────────────

API_PREFIX = "/api/v1/plan-library"


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    """Both Cognito dependencies overridden — see ``test_plan_library_api.py``."""
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
        email=f"currency_{uuid4().hex[:8]}@example.com",
        username=f"currency_{uuid4().hex[:8]}",
        full_name="Status Currency Tester",
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


@pytest.fixture(autouse=True)
def _no_live_tenant_resolution(monkeypatch: pytest.MonkeyPatch):
    """Never let ``_soft_tenant_id`` reach a real coord from these tests."""
    from app.api.v1.endpoints import plan_library as endpoint

    async def _none(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(endpoint, "_soft_tenant_id", _none)


async def _seed_reading(
    db: AsyncSession, *, source_repo: str, behind: int = 1991
) -> UUID:
    """One fresh, exact ``measured`` reading in the NULL organization bucket."""
    from app.crud import plan_scan_root as scan_root_crud

    device_id = uuid4()
    await scan_root_crud.upsert_observation(
        db,
        org_id=None,
        device_id=device_id,
        fields={
            "state": "measured",
            "plans_dir": f"/w/{source_repo}",
            "repo_root": "/w/repo",
            "source_repo": source_repo,
            "default_ref": "origin/main",
            "ref_sha": REF,
            "head_sha": "b" * 40,
            "behind": behind,
            "ahead": 0,
            "ref_age_secs": 5,
            "counts_are_floors": False,
            "detail": None,
            "observed_at": datetime.now(UTC),
        },
    )
    return device_id


async def _row(
    db: AsyncSession,
    *,
    source_repo: str | None,
    captured_by: str = "runner_scan",
    stem: str = "cur",
) -> WorkArtifact:
    row, _, _ = await crud.upsert_artifact(
        db,
        org_id=None,
        user_id=None,
        kind="plan",
        slug=f"{stem}-{uuid4().hex[:10]}",
        title="A plan",
        status="draft",
        body=f"# {stem} {uuid4().hex}",
        source_path=None,
        source_repo=source_repo,
        work_unit_slug=None,
        repos=[],
        authored_at=None,
        captured_by=captured_by,
        change_description=None,
        created_by="test",
    )
    return row


async def _break_scan_root_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """A REAL failing statement inside the inner savepoint."""
    from app.api.v1.endpoints import plan_library as endpoint

    async def _broken(db: AsyncSession, **_kwargs: object) -> None:
        await db.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(endpoint.scan_root_crud, "list_observations", _broken)


@pytest.mark.asyncio
class TestRoutesCarryTheBlock:
    async def test_list_keys_each_row_on_its_own_source_repo(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY, behind=1991)
        fed = await _row(async_db_session, source_repo=KEY)
        door = await _row(async_db_session, source_repo=KEY, captured_by="agent")
        unfed = await _row(async_db_session, source_repo=OTHER_KEY)

        resp = await client.get(API_PREFIX, params={"limit": 200})
        assert resp.status_code == 200, resp.text
        by_id = {item["id"]: item for item in resp.json()["items"]}
        assert by_id[str(fed.id)]["status_currency"]["state"] == "fed_in_step"
        assert by_id[str(fed.id)]["status_currency"]["ref_sha"] == REF
        assert by_id[str(door.id)]["status_currency"]["state"] == "asserted_once"
        assert by_id[str(unfed.id)]["status_currency"]["state"] == "unfed_key"
        # Every row carries the key — no response may omit it.
        assert all("status_currency" in item for item in by_id.values())

    async def test_detail_upsert_and_kind_patch_carry_it(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY)
        fed = await _row(async_db_session, source_repo=KEY)

        detail = await client.get(
            f"{API_PREFIX}/{fed.id}", params={"include_coord": "false"}
        )
        assert detail.status_code == 200, detail.text
        assert detail.json()["status_currency"]["state"] == "fed_in_step"

        posted = await client.post(
            API_PREFIX,
            json={
                "kind": "plan",
                "slug": f"posted-{uuid4().hex[:10]}",
                "title": "Posted",
                "status": "draft",
                "body": "# posted",
                "source_repo": KEY,
                "captured_by": "runner_scan",
            },
        )
        assert posted.status_code == 201, posted.text
        assert posted.json()["artifact"]["status_currency"]["state"] == "fed_in_step"

        patched = await client.patch(
            f"{API_PREFIX}/{fed.id}/kind", json={"kind": "plan"}
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["status_currency"]["state"] == "fed_in_step"

    async def test_a_failed_scan_root_read_is_unknown_on_every_list_row(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY)
        await _row(async_db_session, source_repo=KEY)
        await _row(async_db_session, source_repo=OTHER_KEY)
        await _break_scan_root_read(monkeypatch)

        resp = await client.get(API_PREFIX, params={"limit": 200})
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert items
        for item in items:
            if item["captured_by"] != "runner_scan":
                continue
            assert item["status_currency"]["state"] == "unknown"
            assert item["status_currency"]["detail"].startswith("read_failed:")

    async def test_candidates_carry_it_with_the_body_digest(
        self, client: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY)
        fed = await _row(async_db_session, source_repo=KEY)
        unfed = await _row(async_db_session, source_repo=OTHER_KEY)

        resp = await client.get(
            f"{API_PREFIX}/candidates",
            params={"include_coord": "false", "limit": 100},
        )
        assert resp.status_code == 200, resp.text
        by_id = {item["id"]: item for item in resp.json()["items"]}
        assert by_id[str(fed.id)]["status_currency"]["state"] == "fed_in_step"
        assert by_id[str(fed.id)]["content_sha256"] == fed.content_sha256
        assert by_id[str(unfed.id)]["status_currency"]["state"] == "unfed_key"

    async def test_candidates_scan_root_read_failure_is_unknown_and_200(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY)
        fed = await _row(async_db_session, source_repo=KEY)
        await _break_scan_root_read(monkeypatch)

        resp = await client.get(
            f"{API_PREFIX}/candidates",
            params={"include_coord": "false", "limit": 100},
        )
        assert resp.status_code == 200, resp.text
        by_id = {item["id"]: item for item in resp.json()["items"]}
        currency = by_id[str(fed.id)]["status_currency"]
        assert currency["state"] == "unknown"
        assert currency["detail"].startswith("read_failed:")

    async def test_candidates_nulled_corpus_health_is_unknown_with_its_reason(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The OUTER savepoint: the whole block is null, and so is no row's
        currency — each reads ``unknown`` with the block's own reason."""
        from app.api.v1.endpoints import plan_library as endpoint

        await _seed_reading(async_db_session, source_repo=KEY)
        fed = await _row(async_db_session, source_repo=KEY)

        async def _broken(db: AsyncSession, **_kwargs: object) -> None:
            await db.execute(text("SELECT 1 / 0"))

        monkeypatch.setattr(endpoint.crud, "capture_health", _broken)

        resp = await client.get(
            f"{API_PREFIX}/candidates",
            params={"include_coord": "false", "limit": 100},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["corpus_health"] is None
        reason = body["corpus_health_unavailable_reason"]
        currency = {item["id"]: item for item in body["items"]}[str(fed.id)][
            "status_currency"
        ]
        assert currency["state"] == "unknown"
        assert currency["detail"] == reason


def _break_scan_root_render(monkeypatch: pytest.MonkeyPatch) -> None:
    """A NON-SQL failure: the readings are read, then rendering raises."""
    from app.api.v1.endpoints import plan_library as endpoint

    def _raises(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("renderer defect")

    monkeypatch.setattr(endpoint, "scan_roots_health", _raises)


async def _break(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    if mode == "sql_read":
        await _break_scan_root_read(monkeypatch)
    else:
        _break_scan_root_render(monkeypatch)


@pytest.mark.asyncio
class TestSingleRowRoutesDegradeRatherThanFail:
    """A failed scan-root read OR rendering is ``unknown`` on the single-row
    routes, with the route still 200 — and on the write routes, which judge the
    currency AFTER the write, the write has still landed."""

    @pytest.mark.parametrize("mode", ["sql_read", "render"])
    async def test_get_detail(
        self,
        mode: str,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY)
        fed = await _row(async_db_session, source_repo=KEY)
        await _break(mode, monkeypatch)

        resp = await client.get(
            f"{API_PREFIX}/{fed.id}", params={"include_coord": "false"}
        )
        assert resp.status_code == 200, resp.text
        currency = resp.json()["status_currency"]
        assert currency["state"] == "unknown"
        assert currency["detail"].startswith("read_failed:")
        assert "renderer defect" not in currency["detail"]

    @pytest.mark.parametrize("mode", ["sql_read", "render"])
    async def test_upsert(
        self,
        mode: str,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY)
        await _break(mode, monkeypatch)
        slug = f"posted-{uuid4().hex[:10]}"

        resp = await client.post(
            API_PREFIX,
            json={
                "kind": "plan",
                "slug": slug,
                "title": "Posted",
                "status": "draft",
                "body": "# posted",
                "source_repo": KEY,
                "captured_by": "runner_scan",
            },
        )
        assert resp.status_code == 201, resp.text
        currency = resp.json()["artifact"]["status_currency"]
        assert currency["state"] == "unknown"
        assert currency["detail"].startswith("read_failed:")

        # The write landed.
        rows, total = await crud.list_artifacts(
            async_db_session, org_id=None, slug=slug, offset=0, limit=10
        )
        assert total == 1
        assert rows[0].title == "Posted"

    @pytest.mark.parametrize("mode", ["sql_read", "render"])
    async def test_patch_kind(
        self,
        mode: str,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _seed_reading(async_db_session, source_repo=KEY)
        fed = await _row(async_db_session, source_repo=KEY)
        await _break(mode, monkeypatch)

        resp = await client.patch(
            f"{API_PREFIX}/{fed.id}/kind", json={"kind": "handoff"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kind"] == "handoff"
        assert body["kind_locked"] is True
        assert body["status_currency"]["state"] == "unknown"
        assert body["status_currency"]["detail"].startswith("read_failed:")

        # The write landed.
        stored = await crud.get_artifact(async_db_session, fed.id, org_id=None)
        assert stored is not None
        assert stored.kind == "handoff"
        assert stored.kind_locked is True

    async def test_a_render_failure_degrades_the_list_route_too(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Consistent across routes: the list page degrades the same way."""
        await _seed_reading(async_db_session, source_repo=KEY)
        fed = await _row(async_db_session, source_repo=KEY)
        _break_scan_root_render(monkeypatch)

        resp = await client.get(API_PREFIX, params={"limit": 200})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["corpus_health"]["scan_roots"]["detail"].startswith("read_failed:")
        by_id = {item["id"]: item for item in body["items"]}
        assert by_id[str(fed.id)]["status_currency"]["state"] == "unknown"
