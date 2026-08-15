"""Plan & Prompt Library — CRUD + HTTP tests against real Postgres.

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``.

Two layers, mirroring ``tests/test_devenv_environments.py``:

* **Layer 1 — CRUD against the shared async session.** Covers the upsert
  contract (no-op on unchanged digest, version append on change), the
  divergence read, edge creation in both directions, opaque-status
  acceptance and a dangling ``work_unit_slug``.
* **Layer 2 — full HTTP.** ``httpx.AsyncClient`` + ``ASGITransport`` (NOT
  ``TestClient``) so the handler runs in the SAME asyncio loop as the shared
  session, with ``get_async_db`` and ``current_active_user`` overridden.

Also asserts the thing that cannot be assumed: these are the FIRST ORM models
bound to the ``agent`` schema, so ``test_agent_schema_binding_is_real``
checks the tables actually landed in ``agent`` rather than in ``public``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import work_artifact as crud
from app.models.work_artifact import WorkArtifact, WorkArtifactVersion

API_PREFIX = "/api/v1/plan-library"

pytestmark = pytest.mark.asyncio


def _slug(stem: str) -> str:
    """A unique slug — the session rolls back, but be independent anyway."""
    return f"{stem}-{uuid4().hex[:10]}"


async def _upsert(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str = "plan",
    slug: str,
    body: str,
    title: str = "A plan",
    status: str = "",
    source_repo: str | None = None,
    work_unit_slug: str | None = None,
    repos: list[str] | None = None,
    change_description: str | None = None,
) -> tuple[WorkArtifact, bool, bool]:
    return await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=None,
        kind=kind,
        slug=slug,
        title=title,
        status=status,
        body=body,
        source_path=None,
        source_repo=source_repo,
        work_unit_slug=work_unit_slug,
        repos=repos or [],
        authored_at=None,
        captured_by="agent",
        change_description=change_description,
        created_by="test",
    )


# ===========================================================================
# Layer 0 — the agent-schema binding itself
# ===========================================================================


class TestAgentSchemaBinding:
    """``__table_args__ = {"schema": "agent"}`` is new territory for the ORM."""

    async def test_agent_schema_binding_is_real(
        self, async_db_session: AsyncSession
    ) -> None:
        """The three tables exist in ``agent``, not ``public``."""
        rows = (
            (
                await async_db_session.execute(
                    text(
                        """
                    SELECT table_name
                      FROM information_schema.tables
                     WHERE table_schema = 'agent'
                       AND table_name IN (
                           'work_artifacts',
                           'work_artifact_versions',
                           'work_artifact_edges'
                       )
                     ORDER BY table_name
                    """
                    )
                )
            )
            .scalars()
            .all()
        )
        assert list(rows) == [
            "work_artifact_edges",
            "work_artifact_versions",
            "work_artifacts",
        ]

    async def test_metadata_declares_agent_schema(self) -> None:
        """Metadata agrees with the database (guards a silent rename)."""
        assert WorkArtifact.__table__.schema == "agent"
        assert WorkArtifactVersion.__table__.schema == "agent"


# ===========================================================================
# Layer 1 — the upsert contract
# ===========================================================================


class TestUpsertContract:
    async def test_first_upsert_creates_head_and_version_one(
        self, async_db_session: AsyncSession
    ) -> None:
        slug = _slug("create")
        row, created, changed = await _upsert(
            async_db_session, org_id=None, slug=slug, body="# hello"
        )

        assert created is True
        assert changed is True
        assert row.current_version == 1
        assert row.content_sha256 == crud.compute_content_sha256("# hello")

        versions = await crud.list_versions(async_db_session, row.id)
        assert len(versions) == 1
        assert versions[0].version_number == 1
        assert versions[0].body == "# hello"
        assert versions[0].content_sha256 == row.content_sha256

    async def test_unchanged_sha_is_a_noop(
        self, async_db_session: AsyncSession
    ) -> None:
        """The 304-equivalent: no version bump, no appended snapshot."""
        slug = _slug("noop")
        first, _, _ = await _upsert(
            async_db_session, org_id=None, slug=slug, body="stable body"
        )
        assert first.current_version == 1

        second, created, changed = await _upsert(
            async_db_session,
            org_id=None,
            slug=slug,
            body="stable body",
            # Metadata differs — the digest does not, so nothing moves.
            title="A DIFFERENT title",
            status="SHIPPED",
        )

        assert created is False
        assert changed is False
        assert second.id == first.id
        assert second.current_version == 1

        versions = await crud.list_versions(async_db_session, first.id)
        assert len(versions) == 1, "a no-op must not append a version row"

        count = (
            (
                await async_db_session.execute(
                    select(WorkArtifactVersion).where(
                        WorkArtifactVersion.document_id == first.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(count) == 1

    async def test_changed_sha_bumps_version_and_appends(
        self, async_db_session: AsyncSession
    ) -> None:
        slug = _slug("bump")
        first, _, _ = await _upsert(
            async_db_session, org_id=None, slug=slug, body="v1 body"
        )
        second, created, changed = await _upsert(
            async_db_session,
            org_id=None,
            slug=slug,
            body="v2 body",
            change_description="rewrote section 3",
        )

        assert created is False
        assert changed is True
        assert second.id == first.id
        assert second.current_version == 2
        assert second.body == "v2 body"
        assert second.content_sha256 == crud.compute_content_sha256("v2 body")

        versions = await crud.list_versions(async_db_session, first.id)
        assert [v.version_number for v in versions] == [1, 2]
        assert versions[0].body == "v1 body"
        assert versions[1].body == "v2 body"
        assert versions[1].change_description == "rewrote section 3"

    async def test_source_repo_is_part_of_identity(
        self, async_db_session: AsyncSession
    ) -> None:
        """Same (kind, slug) in two repos are two DISTINCT artifacts."""
        slug = _slug("mirrored")
        a, created_a, _ = await _upsert(
            async_db_session,
            org_id=None,
            slug=slug,
            body="copy A",
            source_repo="qontinui-web",
        )
        b, created_b, _ = await _upsert(
            async_db_session,
            org_id=None,
            slug=slug,
            body="copy B",
            source_repo="qontinui-runner",
        )
        assert created_a is True
        assert created_b is True
        assert a.id != b.id

    async def test_null_source_repo_collapses_to_one_row(
        self, async_db_session: AsyncSession
    ) -> None:
        """coalesce(source_repo,'') means NULL is a single bucket, not many.

        Without the functional index a plain UNIQUE would admit unlimited
        NULL-repo duplicates; this is the regression test for that.
        """
        slug = _slug("norepo")
        a, created_a, _ = await _upsert(
            async_db_session, org_id=None, slug=slug, body="one"
        )
        b, created_b, changed_b = await _upsert(
            async_db_session, org_id=None, slug=slug, body="two"
        )
        assert created_a is True
        assert created_b is False
        assert changed_b is True
        assert a.id == b.id


# ===========================================================================
# Layer 1 — opaque status, dangling work unit, org scoping
# ===========================================================================


class TestOpaqueStatus:
    @pytest.mark.parametrize(
        "value",
        [
            "VETTED",
            "IN PROGRESS",
            "shipped",
            "🚧 half-done",
            "a status nobody has ever used before",
            "",
        ],
    )
    async def test_any_status_string_is_accepted(
        self, async_db_session: AsyncSession, value: str
    ) -> None:
        """No vocabulary, no CHECK, no rejection — the store mirrors reality."""
        row, created, _ = await _upsert(
            async_db_session,
            org_id=None,
            slug=_slug("status"),
            body=f"body for {value}",
            status=value,
        )
        assert created is True
        assert row.status == value

    async def test_unknown_status_filter_returns_empty_not_error(
        self, async_db_session: AsyncSession
    ) -> None:
        rows, total = await crud.list_artifacts(
            async_db_session, org_id=None, status="NO-SUCH-STATUS-EVER"
        )
        assert rows == []
        assert total == 0


class TestDanglingWorkUnitSlug:
    async def test_read_tolerates_a_work_unit_that_does_not_exist(
        self, async_db_session: AsyncSession
    ) -> None:
        """The soft link has no FK and is never resolved — it may dangle."""
        dangling = f"no-such-work-unit-{uuid4().hex[:8]}"
        row, created, _ = await _upsert(
            async_db_session,
            org_id=None,
            slug=_slug("dangling"),
            body="plan referencing a phantom work unit",
            work_unit_slug=dangling,
        )
        assert created is True
        assert row.work_unit_slug == dangling

        fetched = await crud.get_artifact(async_db_session, row.id, org_id=None)
        assert fetched is not None
        assert fetched.work_unit_slug == dangling

        rows, total = await crud.list_artifacts(
            async_db_session, org_id=None, work_unit_slug=dangling
        )
        assert total == 1
        assert rows[0].id == row.id


class TestOrgScoping:
    async def test_rows_are_invisible_across_organization_buckets(
        self, async_db_session: AsyncSession
    ) -> None:
        org_a = uuid4()
        org_b = uuid4()
        slug = _slug("scoped")

        row_a, _, _ = await _upsert(
            async_db_session, org_id=org_a, slug=slug, body="A's plan"
        )
        row_b, created_b, _ = await _upsert(
            async_db_session, org_id=org_b, slug=slug, body="B's plan"
        )
        # Same (kind, slug) in two orgs — two distinct rows.
        assert created_b is True
        assert row_a.id != row_b.id

        assert await crud.get_artifact(async_db_session, row_b.id, org_id=org_a) is None
        rows, total = await crud.list_artifacts(async_db_session, org_id=org_a)
        assert total >= 1
        assert all(r.organization_id == org_a for r in rows)


# ===========================================================================
# Layer 1 — filters, divergence, edges
# ===========================================================================


class TestFilters:
    async def test_full_text_search_over_title_and_body(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        await _upsert(
            async_db_session,
            org_id=org,
            slug=_slug("fts-hit"),
            title="Merge train wedge",
            body="the orchestrator stalled on a candidate ref",
        )
        await _upsert(
            async_db_session,
            org_id=org,
            slug=_slug("fts-miss"),
            title="Unrelated",
            body="nothing about that subject at all",
        )

        rows, total = await crud.list_artifacts(
            async_db_session, org_id=org, q="orchestrator"
        )
        assert total == 1
        assert rows[0].title == "Merge train wedge"

        rows, total = await crud.list_artifacts(async_db_session, org_id=org, q="wedge")
        assert total == 1

    async def test_repo_filter_matches_array_or_source_repo(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        await _upsert(
            async_db_session,
            org_id=org,
            slug=_slug("via-array"),
            body="touches two repos",
            repos=["qontinui-web", "coord"],
        )
        await _upsert(
            async_db_session,
            org_id=org,
            slug=_slug("via-source"),
            body="lives in the runner",
            source_repo="qontinui-runner",
        )

        _, total_web = await crud.list_artifacts(
            async_db_session, org_id=org, repo="qontinui-web"
        )
        _, total_runner = await crud.list_artifacts(
            async_db_session, org_id=org, repo="qontinui-runner"
        )
        _, total_none = await crud.list_artifacts(
            async_db_session, org_id=org, repo="nope"
        )
        assert total_web == 1
        assert total_runner == 1
        assert total_none == 0

    async def test_since_filter(self, async_db_session: AsyncSession) -> None:
        org = uuid4()
        await _upsert(async_db_session, org_id=org, slug=_slug("recent"), body="fresh")
        future = datetime.now(UTC) + timedelta(days=1)
        past = datetime.now(UTC) - timedelta(days=1)

        _, total_future = await crud.list_artifacts(
            async_db_session, org_id=org, since=future
        )
        _, total_past = await crud.list_artifacts(
            async_db_session, org_id=org, since=past
        )
        assert total_future == 0
        assert total_past == 1

    async def test_paging(self, async_db_session: AsyncSession) -> None:
        org = uuid4()
        for i in range(5):
            await _upsert(
                async_db_session, org_id=org, slug=_slug(f"page{i}"), body=f"b{i}"
            )
        page, total = await crud.list_artifacts(
            async_db_session, org_id=org, offset=0, limit=2
        )
        assert total == 5
        assert len(page) == 2


class TestDivergence:
    async def test_same_kind_slug_with_differing_sha_is_divergent(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        slug = _slug("drifted")
        await _upsert(
            async_db_session,
            org_id=org,
            slug=slug,
            body="version living in web",
            source_repo="qontinui-web",
        )
        await _upsert(
            async_db_session,
            org_id=org,
            slug=slug,
            body="DIFFERENT version living in the runner",
            source_repo="qontinui-runner",
        )

        groups = await crud.find_divergent(async_db_session, org_id=org)
        assert len(groups) == 1
        kind, group_slug, variants = groups[0]
        assert kind == "plan"
        assert group_slug == slug
        assert len(variants) == 2
        assert len({v.content_sha256 for v in variants}) == 2

    async def test_identical_copies_are_not_divergent(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        slug = _slug("agreed")
        body = "byte-identical in both repos"
        await _upsert(
            async_db_session,
            org_id=org,
            slug=slug,
            body=body,
            source_repo="qontinui-web",
        )
        await _upsert(
            async_db_session,
            org_id=org,
            slug=slug,
            body=body,
            source_repo="qontinui-runner",
        )
        assert await crud.find_divergent(async_db_session, org_id=org) == []


class TestEdges:
    async def test_edges_are_visible_from_both_ends(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        prompt, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="investigation_prompt",
            slug=_slug("inv-prompt"),
            body="go find out why the train wedged",
        )
        report, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="investigation_report",
            slug=_slug("inv-report"),
            body="it wedged because the candidate ref already existed",
        )

        edge, created = await crud.create_edge(
            async_db_session,
            from_artifact=prompt,
            to_artifact=report,
            relation="produced_report",
            note="phase 1",
            created_by="test",
        )
        assert created is True

        from_side = await crud.list_edges(async_db_session, prompt.id)
        assert len(from_side) == 1
        assert from_side[0][1] == "outgoing"
        assert from_side[0][2] is not None
        assert from_side[0][2].id == report.id

        to_side = await crud.list_edges(async_db_session, report.id)
        assert len(to_side) == 1
        assert to_side[0][1] == "incoming"
        assert to_side[0][2] is not None
        assert to_side[0][2].id == prompt.id

        assert edge.relation == "produced_report"

    async def test_duplicate_edge_is_idempotent(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        a, _, _ = await _upsert(
            async_db_session, org_id=org, slug=_slug("edge-a"), body="a"
        )
        b, _, _ = await _upsert(
            async_db_session, org_id=org, slug=_slug("edge-b"), body="b"
        )
        first, created_first = await crud.create_edge(
            async_db_session,
            from_artifact=a,
            to_artifact=b,
            relation="supersedes",
            note=None,
            created_by="test",
        )
        second, created_second = await crud.create_edge(
            async_db_session,
            from_artifact=a,
            to_artifact=b,
            relation="supersedes",
            note=None,
            created_by="test",
        )
        assert created_first is True
        assert created_second is False
        assert first.id == second.id


# ===========================================================================
# Layer 2 — full HTTP (real DB, auth overridden)
# ===========================================================================


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    """Mount the plan-library router with db + auth dependencies overridden."""
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
    """A real ``auth.users`` row to authenticate as."""
    from app.models.user import User

    user = User(
        email=f"planlib_{uuid4().hex[:8]}@example.com",
        username=f"planlib_{uuid4().hex[:8]}",
        full_name="Plan Library Tester",
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


def _payload(**overrides) -> dict:
    body = {
        "kind": "plan",
        "slug": _slug("http"),
        "title": "HTTP plan",
        "status": "VETTED",
        "body": "# plan body",
    }
    body.update(overrides)
    return body


class TestHttpSurface:
    async def test_upsert_then_get_then_noop(self, client: httpx.AsyncClient) -> None:
        payload = _payload()

        created = await client.post(API_PREFIX, json=payload)
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["created"] is True
        assert body["changed"] is True
        assert body["artifact"]["current_version"] == 1
        artifact_id = body["artifact"]["id"]

        detail = await client.get(f"{API_PREFIX}/{artifact_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["body"] == "# plan body"
        assert len(detail.json()["versions"]) == 1
        assert detail.json()["edges"] == []

        again = await client.post(API_PREFIX, json=payload)
        assert again.status_code == 200
        assert again.json()["changed"] is False
        assert again.json()["artifact"]["current_version"] == 1
        assert again.headers.get("X-Artifact-Unchanged") == "true"
        assert again.headers.get("ETag")

        changed = await client.post(
            API_PREFIX, json={**payload, "body": "# plan body, revised"}
        )
        assert changed.status_code == 200
        assert changed.json()["changed"] is True
        assert changed.json()["artifact"]["current_version"] == 2

        detail2 = await client.get(f"{API_PREFIX}/{artifact_id}")
        assert len(detail2.json()["versions"]) == 2

    async def test_organization_id_in_the_body_is_ignored(
        self, client: httpx.AsyncClient
    ) -> None:
        """A caller-supplied org must never reach the row (scope escalation)."""
        forged = str(uuid4())
        resp = await client.post(API_PREFIX, json=_payload(organization_id=forged))
        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["organization_id"] != forged

    async def test_unknown_status_is_stored_not_rejected(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(
            API_PREFIX, json=_payload(status="SOMETHING NOBODY DEFINED")
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["status"] == "SOMETHING NOBODY DEFINED"

    async def test_unknown_kind_is_a_422_not_a_500(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(API_PREFIX, json=_payload(kind="not_a_kind"))
        assert resp.status_code == 422

    async def test_mismatched_client_digest_is_rejected(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.post(API_PREFIX, json=_payload(content_sha256="0" * 64))
        assert resp.status_code == 422
        assert "content_sha256" in resp.text

    async def test_dangling_work_unit_slug_reads_fine(
        self, client: httpx.AsyncClient
    ) -> None:
        dangling = f"phantom-{uuid4().hex[:8]}"
        created = await client.post(API_PREFIX, json=_payload(work_unit_slug=dangling))
        assert created.status_code == 201, created.text
        artifact_id = created.json()["artifact"]["id"]

        detail = await client.get(f"{API_PREFIX}/{artifact_id}")
        assert detail.status_code == 200
        assert detail.json()["work_unit_slug"] == dangling

        listed = await client.get(API_PREFIX, params={"work_unit_slug": dangling})
        assert listed.status_code == 200
        assert listed.json()["total"] == 1

    async def test_edges_both_directions_over_http(
        self, client: httpx.AsyncClient
    ) -> None:
        prompt = (
            await client.post(
                API_PREFIX,
                json=_payload(kind="investigation_prompt", body="investigate"),
            )
        ).json()["artifact"]
        report = (
            await client.post(
                API_PREFIX,
                json=_payload(kind="investigation_report", body="findings"),
            )
        ).json()["artifact"]
        plan = (await client.post(API_PREFIX, json=_payload(body="the plan"))).json()[
            "artifact"
        ]

        outgoing = await client.post(
            f"{API_PREFIX}/{prompt['id']}/edges",
            json={"to_id": report["id"], "relation": "produced_report"},
        )
        assert outgoing.status_code == 201, outgoing.text
        assert outgoing.json()["direction"] == "outgoing"
        assert outgoing.json()["peer_slug"] == report["slug"]

        incoming = await client.post(
            f"{API_PREFIX}/{plan['id']}/edges",
            json={"from_id": report["id"], "relation": "feeds"},
        )
        assert incoming.status_code == 201, incoming.text
        assert incoming.json()["direction"] == "incoming"
        assert incoming.json()["from_id"] == report["id"]
        assert incoming.json()["to_id"] == plan["id"]

        # The report sits in the middle: one incoming, one outgoing.
        detail = await client.get(f"{API_PREFIX}/{report['id']}")
        directions = sorted(e["direction"] for e in detail.json()["edges"])
        assert directions == ["incoming", "outgoing"]

    async def test_edge_requires_exactly_one_endpoint(
        self, client: httpx.AsyncClient
    ) -> None:
        a = (await client.post(API_PREFIX, json=_payload(body="a"))).json()["artifact"]
        b = (await client.post(API_PREFIX, json=_payload(body="b"))).json()["artifact"]

        neither = await client.post(
            f"{API_PREFIX}/{a['id']}/edges", json={"relation": "feeds"}
        )
        assert neither.status_code == 422

        both = await client.post(
            f"{API_PREFIX}/{a['id']}/edges",
            json={"to_id": b["id"], "from_id": b["id"], "relation": "feeds"},
        )
        assert both.status_code == 422

    async def test_edge_to_missing_artifact_is_404(
        self, client: httpx.AsyncClient
    ) -> None:
        a = (await client.post(API_PREFIX, json=_payload(body="anchor"))).json()[
            "artifact"
        ]
        resp = await client.post(
            f"{API_PREFIX}/{a['id']}/edges",
            json={"to_id": str(uuid4()), "relation": "feeds"},
        )
        assert resp.status_code == 404

    async def test_divergent_route_over_http(self, client: httpx.AsyncClient) -> None:
        slug = _slug("http-drift")
        await client.post(
            API_PREFIX,
            json=_payload(slug=slug, body="web copy", source_repo="qontinui-web"),
        )
        await client.post(
            API_PREFIX,
            json=_payload(slug=slug, body="runner copy", source_repo="qontinui-runner"),
        )

        resp = await client.get(f"{API_PREFIX}/divergent")
        assert resp.status_code == 200, resp.text
        groups = [g for g in resp.json()["groups"] if g["slug"] == slug]
        assert len(groups) == 1
        assert groups[0]["variant_count"] == 2

    async def test_get_missing_artifact_is_404(self, client: httpx.AsyncClient) -> None:
        resp = await client.get(f"{API_PREFIX}/{uuid4()}")
        assert resp.status_code == 404

    async def test_list_filters_over_http(self, client: httpx.AsyncClient) -> None:
        await client.post(
            API_PREFIX,
            json=_payload(
                kind="handoff",
                title="Handoff for the merge train",
                body="context transfer notes",
                repos=["coord"],
            ),
        )
        by_kind = await client.get(API_PREFIX, params={"kind": "handoff"})
        assert by_kind.status_code == 200
        assert by_kind.json()["total"] >= 1
        assert all(i["kind"] == "handoff" for i in by_kind.json()["items"])

        by_repo = await client.get(API_PREFIX, params={"repo": "coord"})
        assert by_repo.json()["total"] >= 1

        by_q = await client.get(API_PREFIX, params={"q": "transfer"})
        assert by_q.json()["total"] >= 1
