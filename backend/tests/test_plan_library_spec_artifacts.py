"""The specification family on the plan library — kinds, stable refs, lifecycle.

Phase 6 step 1 of ``2026-10-09-spec-front-end-of-the-software-factory``
(design decision D4). Three contracts, each with a DB-free half and a
DB-backed half:

* **Stable refs.** A spec artifact gets ``<PREFIX>-<NNNN>`` on create, per
  organization and per kind, from a counter that never moves backwards — so a
  ref is never handed out twice, and a re-upsert of the same artifact keeps
  the ref it was born with.
* **Lifecycle.** A spec kind's ``status`` is a closed per-kind set (422
  outside it, the first member when omitted); every other kind's status stays
  opaque and never 422s.
* **Family boundary.** A spec artifact's kind is fixed (its ref names it), and
  no other artifact can be re-kinded into the family: 409 on ``PATCH
  .../kind``. A heuristic (scanner) write of a spec kind is a 422.

The DB-backed tests use the suite's Postgres (``QONTINUI_TEST_PG_DSN``).
"""

from __future__ import annotations

import asyncio
from typing import get_args
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.crud import work_artifact as crud
from app.models.work_artifact import (
    SPEC_ARTIFACT_KINDS,
    SPEC_KIND_STATUSES,
    SPEC_REF_PREFIXES,
    WORK_ARTIFACT_KINDS,
    WorkArtifact,
    WorkArtifactSpecRefCounter,
    format_spec_ref,
)
from app.schemas.plan_library import (
    SPEC_KIND_STATUS_LITERALS,
    WorkArtifactKind,
    WorkArtifactUpsert,
    spec_kind_statuses,
)

API_PREFIX = "/api/v1/plan-library"


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


# ───────────────────────────── DB-free ─────────────────────────────


class TestVocabularyParity:
    def test_spec_kinds_are_kinds(self) -> None:
        assert set(SPEC_ARTIFACT_KINDS) <= set(WORK_ARTIFACT_KINDS)
        assert set(get_args(WorkArtifactKind)) == set(WORK_ARTIFACT_KINDS)

    def test_every_spec_kind_has_a_prefix_and_a_lifecycle(self) -> None:
        assert set(SPEC_REF_PREFIXES) == set(SPEC_ARTIFACT_KINDS)
        assert set(SPEC_KIND_STATUSES) == set(SPEC_ARTIFACT_KINDS)
        assert set(SPEC_KIND_STATUS_LITERALS) == set(SPEC_ARTIFACT_KINDS)

    def test_prefixes_are_distinct(self) -> None:
        # Distinct prefixes are what make a bare ref name its kind.
        prefixes = list(SPEC_REF_PREFIXES.values())
        assert len(prefixes) == len(set(prefixes))
        for prefix in prefixes:
            assert prefix.isupper() and prefix.isalpha()

    def test_model_lifecycles_equal_the_schema_literals(self) -> None:
        for kind, statuses in SPEC_KIND_STATUSES.items():
            assert spec_kind_statuses(kind) == statuses, kind

    def test_non_spec_kinds_have_no_lifecycle(self) -> None:
        for kind in set(WORK_ARTIFACT_KINDS) - set(SPEC_ARTIFACT_KINDS):
            assert spec_kind_statuses(kind) is None, kind


class TestFormatSpecRef:
    def test_zero_pads_to_four(self) -> None:
        assert format_spec_ref("requirement", 42) == "REQ-0042"
        assert format_spec_ref("test_case", 1) == "TC-0001"

    def test_grows_past_four_digits(self) -> None:
        assert format_spec_ref("story", 12345) == "STY-12345"


class TestUpsertSchemaRules:
    def _upsert(self, **kw) -> WorkArtifactUpsert:
        return WorkArtifactUpsert.model_validate({"slug": "s", **kw})

    @pytest.mark.parametrize("kind", SPEC_ARTIFACT_KINDS)
    def test_omitted_status_takes_the_first_lifecycle_member(self, kind: str) -> None:
        assert self._upsert(kind=kind).status == SPEC_KIND_STATUSES[kind][0]

    @pytest.mark.parametrize("kind", SPEC_ARTIFACT_KINDS)
    def test_every_lifecycle_member_is_accepted(self, kind: str) -> None:
        for status in SPEC_KIND_STATUSES[kind]:
            assert self._upsert(kind=kind, status=status).status == status

    def test_a_status_outside_the_lifecycle_is_refused(self) -> None:
        with pytest.raises(ValidationError) as excinfo:
            self._upsert(kind="requirement", status="SHIPPED")
        message = str(excinfo.value)
        assert "requirement lifecycle" in message
        assert "approved" in message  # names the accepted set

    def test_another_kinds_status_is_refused(self) -> None:
        # ``passing`` is a test_case status, not a requirement one.
        with pytest.raises(ValidationError):
            self._upsert(kind="requirement", status="passing")

    def test_status_is_case_sensitive(self) -> None:
        with pytest.raises(ValidationError):
            self._upsert(kind="story", status="Done")

    def test_a_heuristic_spec_write_is_refused(self) -> None:
        with pytest.raises(ValidationError) as excinfo:
            self._upsert(kind="requirement", kind_is_heuristic=True)
        assert "kind_is_heuristic" in str(excinfo.value)

    def test_non_spec_status_stays_opaque(self) -> None:
        for status in ("", "SHIPPED 2026-09-02", "whatever", "approved"):
            assert self._upsert(kind="plan", status=status).status == status
        # …and a heuristic plan write is still fine.
        assert self._upsert(kind="plan", kind_is_heuristic=True).kind == "plan"


# ───────────────────────────── DB-backed: crud ─────────────────────────────


async def _create(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str,
    slug: str | None = None,
    status: str = "",
    body: str = "body",
) -> WorkArtifact:
    if not status and kind in SPEC_KIND_STATUSES:
        status = SPEC_KIND_STATUSES[kind][0]
    artifact, _created, _changed = await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=None,
        kind=kind,
        slug=slug or _slug(kind),
        title="t",
        status=status,
        body=body,
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


@pytest.mark.asyncio
class TestSpecRefAllocation:
    async def test_refs_count_per_org_and_per_kind(
        self, async_db_session: AsyncSession
    ) -> None:
        org_a, org_b = uuid4(), uuid4()
        a1 = await _create(async_db_session, org_id=org_a, kind="requirement")
        a2 = await _create(async_db_session, org_id=org_a, kind="requirement")
        a_story = await _create(async_db_session, org_id=org_a, kind="story")
        b1 = await _create(async_db_session, org_id=org_b, kind="requirement")

        assert (a1.spec_ref, a2.spec_ref) == ("REQ-0001", "REQ-0002")
        # A different kind has its own counter …
        assert a_story.spec_ref == "STY-0001"
        # … and so does a different organization.
        assert b1.spec_ref == "REQ-0001"

    async def test_every_spec_kind_is_numbered_with_its_prefix(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        for kind, prefix in SPEC_REF_PREFIXES.items():
            row = await _create(async_db_session, org_id=org, kind=kind)
            assert row.spec_ref == f"{prefix}-0001", kind

    async def test_a_non_spec_kind_gets_no_ref(
        self, async_db_session: AsyncSession
    ) -> None:
        row = await _create(async_db_session, org_id=uuid4(), kind="plan")
        assert row.spec_ref is None

    async def test_a_re_upsert_keeps_the_ref(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        slug = _slug("keep")
        first = await _create(
            async_db_session, org_id=org, kind="requirement", slug=slug
        )
        revised = await _create(
            async_db_session,
            org_id=org,
            kind="requirement",
            slug=slug,
            status="approved",
            body="a revised body",
        )
        assert revised.id == first.id
        assert revised.current_version == 2
        assert revised.spec_ref == "REQ-0001"
        # And the re-upsert spent no number.
        nxt = await _create(async_db_session, org_id=org, kind="requirement")
        assert nxt.spec_ref == "REQ-0002"

    async def test_a_deleted_ref_is_never_reused(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        doomed = await _create(async_db_session, org_id=org, kind="test_case")
        assert doomed.spec_ref == "TC-0001"
        await async_db_session.delete(doomed)
        await async_db_session.commit()

        reborn = await _create(async_db_session, org_id=org, kind="test_case")
        assert reborn.spec_ref == "TC-0002"

    async def test_null_org_numbers_under_the_nil_scope(
        self, async_db_session: AsyncSession
    ) -> None:
        first = await crud.allocate_spec_ref(
            async_db_session, org_id=None, kind="doc_correction"
        )
        second = await crud.allocate_spec_ref(
            async_db_session, org_id=None, kind="doc_correction"
        )
        a = int(first.split("-")[1])
        assert first.startswith("DOC-")
        assert second == format_spec_ref("doc_correction", a + 1)


@pytest.mark.asyncio
class TestFamilyBoundary:
    async def test_a_spec_artifact_cannot_be_re_kinded(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        req = await _create(async_db_session, org_id=org, kind="requirement")
        for target in ("plan", "story"):
            with pytest.raises(crud.SpecFamilyBoundary) as excinfo:
                await crud.set_artifact_kind(
                    async_db_session, req, kind=target, org_id=org
                )
            assert excinfo.value.spec_ref == "REQ-0001"
        await async_db_session.refresh(req)
        assert req.kind == "requirement"

    async def test_nothing_can_be_re_kinded_into_the_family(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        plan = await _create(async_db_session, org_id=org, kind="plan")
        with pytest.raises(crud.SpecFamilyBoundary):
            await crud.set_artifact_kind(
                async_db_session, plan, kind="requirement", org_id=org
            )

    async def test_confirming_a_spec_kind_is_allowed(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        req = await _create(async_db_session, org_id=org, kind="requirement")
        same = await crud.set_artifact_kind(
            async_db_session, req, kind="requirement", org_id=org
        )
        assert same.kind_locked is True
        assert same.spec_ref == "REQ-0001"

    async def test_non_spec_corrections_still_work(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        plan = await _create(async_db_session, org_id=org, kind="plan")
        moved = await crud.set_artifact_kind(
            async_db_session, plan, kind="handoff", org_id=org
        )
        assert moved.kind == "handoff"
        assert moved.spec_ref is None


async def _scan_write(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    kind: str = "plan",
) -> tuple[WorkArtifact, bool, bool]:
    """A runner-scan-shaped write: heuristic kind, target resolved kind-less."""
    return await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=None,
        kind=kind,
        slug=slug,
        title="scanned title",
        status="SHIPPED",
        body="a scanned body",
        source_path="plans/scanned.md",
        source_repo=None,
        work_unit_slug=None,
        repos=[],
        authored_at=None,
        captured_by="runner_scan",
        change_description=None,
        created_by="scanner",
        kind_is_heuristic=True,
    )


@pytest.mark.asyncio
class TestScannerCannotOverwriteASpecRow:
    """A heuristic write resolves its target IGNORING kind, so a scanned plan
    that shares a spec row's ``(org, slug, source_repo)`` resolves onto it.
    ``kind_locked`` keeps the kind, but without the family check the write
    would still overwrite the row's status, title, body and source_path."""

    async def test_a_scan_onto_a_spec_row_is_refused_and_writes_nothing(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        slug = _slug("shared")
        req = await _create(
            async_db_session, org_id=org, kind="requirement", slug=slug, body="spec"
        )
        before = (req.status, req.title, req.body, req.source_path, req.current_version)

        with pytest.raises(crud.SpecFamilyBoundary) as excinfo:
            await _scan_write(async_db_session, org_id=org, slug=slug)
        assert excinfo.value.spec_ref == "REQ-0001"
        assert (excinfo.value.from_kind, excinfo.value.to_kind) == (
            "requirement",
            "plan",
        )

        await async_db_session.refresh(req)
        after = (req.status, req.title, req.body, req.source_path, req.current_version)
        assert after == before
        assert req.kind == "requirement"

    async def test_an_identical_body_scan_is_refused_too(
        self, async_db_session: AsyncSession
    ) -> None:
        """The unchanged-digest arm settles metadata only — it must be
        refused as well, or a same-body scan rewrites status and title."""
        org = uuid4()
        slug = _slug("same-body")
        req = await _create(
            async_db_session,
            org_id=org,
            kind="requirement",
            slug=slug,
            body="a scanned body",
        )
        with pytest.raises(crud.SpecFamilyBoundary):
            await _scan_write(async_db_session, org_id=org, slug=slug)
        await async_db_session.refresh(req)
        assert req.status == "draft"
        assert req.title == "t"

    async def test_a_scan_with_no_spec_row_still_lands(
        self, async_db_session: AsyncSession
    ) -> None:
        artifact, created, _ = await _scan_write(
            async_db_session, org_id=uuid4(), slug=_slug("plain")
        )
        assert created is True
        assert artifact.kind == "plan"
        assert artifact.spec_ref is None


@pytest.mark.asyncio
class TestConcurrentAllocation:
    async def test_concurrent_creates_get_distinct_contiguous_refs(
        self, test_engine
    ) -> None:
        """N allocations on N separate sessions, all in flight at once, draw N
        distinct numbers 1..N — the ``ON CONFLICT DO UPDATE`` serializes them
        on the counter row. Separate sessions (and connections) are the point:
        one session would serialize the calls itself and prove nothing."""
        n = 12
        org = uuid4()
        maker = async_sessionmaker(test_engine, expire_on_commit=False)
        start = asyncio.Event()

        async def allocate() -> str:
            async with maker() as session:
                await start.wait()
                ref = await crud.allocate_spec_ref(
                    session, org_id=org, kind="requirement"
                )
                # Hold the transaction open briefly so the others really
                # queue behind the counter row's lock.
                await asyncio.sleep(0.01)
                await session.commit()
                return ref

        tasks = [asyncio.create_task(allocate()) for _ in range(n)]
        try:
            await asyncio.sleep(0.05)
            start.set()
            refs = await asyncio.gather(*tasks)
            assert len(set(refs)) == n
            assert sorted(int(r.split("-")[1]) for r in refs) == list(range(1, n + 1))
            assert all(r.startswith("REQ-") for r in refs)
        finally:
            async with maker() as session:
                await session.execute(
                    delete(WorkArtifactSpecRefCounter).where(
                        WorkArtifactSpecRefCounter.organization_scope == org
                    )
                )
                await session.commit()


# ───────────────────────────── DB-backed: HTTP ─────────────────────────────


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    """The plan-library router with db + both auth dependencies overridden
    (see ``tests/test_plan_library_api.py::_build_app`` for why both)."""
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
async def client(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"specart_{uuid4().hex[:8]}@example.com",
        username=f"specart_{uuid4().hex[:8]}",
        full_name="Spec Artifact Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    app = _build_app(db_session=async_db_session, user=user)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http_client:
        yield http_client


def _ref_number(ref: str) -> int:
    return int(ref.split("-", 1)[1])


@pytest.mark.asyncio
class TestHttpSurface:
    async def test_create_assigns_a_ref_and_the_default_status(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            API_PREFIX,
            json={"kind": "requirement", "slug": _slug("req"), "title": "R"},
        )
        assert resp.status_code == 201, resp.text
        artifact = resp.json()["artifact"]
        assert artifact["spec_ref"].startswith("REQ-")
        assert artifact["status"] == "draft"

        second = await client.post(
            API_PREFIX,
            json={"kind": "requirement", "slug": _slug("req"), "status": "proposed"},
        )
        assert second.status_code == 201, second.text
        assert _ref_number(second.json()["artifact"]["spec_ref"]) == (
            _ref_number(artifact["spec_ref"]) + 1
        )

    async def test_a_non_spec_row_serves_a_null_ref(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            API_PREFIX,
            json={"kind": "plan", "slug": _slug("plan"), "status": "anything goes"},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["spec_ref"] is None
        assert resp.json()["artifact"]["status"] == "anything goes"

    async def test_a_bad_status_is_a_422(self, client: httpx.AsyncClient) -> None:
        resp = await client.post(
            API_PREFIX,
            json={"kind": "story", "slug": _slug("story"), "status": "SHIPPED"},
        )
        assert resp.status_code == 422, resp.text
        assert "story lifecycle" in resp.text

    async def test_a_heuristic_spec_write_is_a_422(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            API_PREFIX,
            json={
                "kind": "test_case",
                "slug": _slug("tc"),
                "kind_is_heuristic": True,
            },
        )
        assert resp.status_code == 422, resp.text

    async def test_the_list_filters_by_spec_ref(
        self, client: httpx.AsyncClient
    ) -> None:
        created = await client.post(
            API_PREFIX, json={"kind": "interface_mapping", "slug": _slug("ifm")}
        )
        assert created.status_code == 201, created.text
        ref = created.json()["artifact"]["spec_ref"]

        found = await client.get(API_PREFIX, params={"spec_ref": ref})
        assert found.status_code == 200, found.text
        items = found.json()["items"]
        assert [i["spec_ref"] for i in items] == [ref]

        missing = await client.get(API_PREFIX, params={"spec_ref": "IFM-99999999"})
        assert missing.status_code == 200
        assert missing.json()["items"] == []

    async def test_detail_serves_the_ref(self, client: httpx.AsyncClient) -> None:
        created = await client.post(
            API_PREFIX, json={"kind": "doc_correction", "slug": _slug("doc")}
        )
        artifact = created.json()["artifact"]
        detail = await client.get(f"{API_PREFIX}/{artifact['id']}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["spec_ref"] == artifact["spec_ref"]
        assert detail.json()["status"] == "proposed"

    async def test_kind_patch_across_the_family_is_a_409(
        self, client: httpx.AsyncClient
    ) -> None:
        created = await client.post(
            API_PREFIX, json={"kind": "request", "slug": _slug("rq")}
        )
        artifact = created.json()["artifact"]
        resp = await client.patch(
            f"{API_PREFIX}/{artifact['id']}/kind", json={"kind": "plan"}
        )
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "spec_family_boundary"
        assert detail["spec_ref"] == artifact["spec_ref"]

    async def test_a_scan_onto_a_spec_row_is_a_409(
        self, client: httpx.AsyncClient
    ) -> None:
        slug = _slug("collide")
        created = await client.post(
            API_PREFIX, json={"kind": "requirement", "slug": slug, "title": "R"}
        )
        assert created.status_code == 201, created.text
        artifact = created.json()["artifact"]

        scan = await client.post(
            API_PREFIX,
            json={
                "kind": "plan",
                "slug": slug,
                "title": "overwritten?",
                "status": "SHIPPED",
                "body": "scanned",
                "kind_is_heuristic": True,
                "captured_by": "runner_scan",
            },
        )
        assert scan.status_code == 409, scan.text
        assert scan.json()["detail"]["error"] == "spec_family_boundary"

        detail = (await client.get(f"{API_PREFIX}/{artifact['id']}")).json()
        assert detail["title"] == "R"
        assert detail["status"] == "draft"
        assert detail["current_version"] == 1

    async def test_trace_edges_connect_spec_artifacts(
        self, client: httpx.AsyncClient
    ) -> None:
        request = (
            await client.post(API_PREFIX, json={"kind": "request", "slug": _slug("rq")})
        ).json()["artifact"]
        requirement = (
            await client.post(
                API_PREFIX, json={"kind": "requirement", "slug": _slug("req")}
            )
        ).json()["artifact"]
        test_case = (
            await client.post(
                API_PREFIX, json={"kind": "test_case", "slug": _slug("tc")}
            )
        ).json()["artifact"]

        derives = await client.post(
            f"{API_PREFIX}/{requirement['id']}/edges",
            json={"relation": "derives_from", "to_id": request["id"]},
        )
        assert derives.status_code in (200, 201), derives.text
        verifies = await client.post(
            f"{API_PREFIX}/{test_case['id']}/edges",
            json={"relation": "verifies", "to_id": requirement["id"]},
        )
        assert verifies.status_code in (200, 201), verifies.text

        detail = (await client.get(f"{API_PREFIX}/{requirement['id']}")).json()
        relations = {(e["relation"], e["direction"]) for e in detail["edges"]}
        assert ("derives_from", "outgoing") in relations
        assert ("verifies", "incoming") in relations

    async def test_a_one_ended_trace_edge_is_refused(
        self, client: httpx.AsyncClient
    ) -> None:
        requirement = (
            await client.post(
                API_PREFIX, json={"kind": "requirement", "slug": _slug("req")}
            )
        ).json()["artifact"]
        resp = await client.post(
            f"{API_PREFIX}/{requirement['id']}/edges",
            json={"relation": "traces_to", "note": "nowhere"},
        )
        assert resp.status_code == 422, resp.text
