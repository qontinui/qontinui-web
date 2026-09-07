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

import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.strict_query import StrictQueryRoute, accepted_query_keys
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
    intent_refs: list[str] | None = None,
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
        intent_refs=intent_refs or [],
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

    async def test_identical_repost_is_a_noop(
        self, async_db_session: AsyncSession
    ) -> None:
        """The 304-equivalent: no version bump, no appended snapshot."""
        slug = _slug("noop")
        first, _, _ = await _upsert(
            async_db_session, org_id=None, slug=slug, body="stable body"
        )
        assert first.current_version == 1
        touched = first.updated_at

        second, created, changed = await _upsert(
            async_db_session, org_id=None, slug=slug, body="stable body"
        )

        assert created is False
        assert changed is False
        assert second.id == first.id
        assert second.current_version == 1
        assert second.updated_at == touched, "a no-op must not touch the row"

        versions = await crud.list_versions(async_db_session, first.id)
        assert len(versions) == 1, "a no-op must not append a version row"

    async def test_unchanged_sha_still_stores_the_metadata(
        self, async_db_session: AsyncSession
    ) -> None:
        """Same body, corrected metadata: stored, reported, NOT versioned.

        Phase 5 of ``2026-09-03-plan-library-write-door-nonce-authorized-and-body-sync-on-by-default``.
        The version log is the BODY's history, so ``current_version`` stays
        put and no snapshot is appended — but a ``status`` correction POSTed
        against an already-stored body used to be dropped on the floor while
        the response said ``changed=false``, which was true of the body and
        false of the request (finding 43479836).
        """
        slug = _slug("meta")
        first, _, _ = await _upsert(
            async_db_session, org_id=None, slug=slug, body="stable body"
        )
        assert first.current_version == 1

        second, created, changed = await _upsert(
            async_db_session,
            org_id=None,
            slug=slug,
            body="stable body",
            # Metadata differs — the digest does not.
            title="A DIFFERENT title",
            status="SHIPPED 2026-09-05",
        )

        assert created is False
        assert changed is True, "the request moved the row; say so"
        assert second.id == first.id
        assert second.title == "A DIFFERENT title"
        assert second.status == "SHIPPED 2026-09-05"
        assert second.current_version == 1, "metadata is not a version"

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
        assert len(count) == 1, "metadata must not append a version row"

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

    async def test_intent_ref_filter_is_exact_containment(
        self, async_db_session: AsyncSession
    ) -> None:
        """``?intent_ref=`` returns exactly the rows whose ``intent_refs``
        contain it — zero, one and many, enumerated.

        Plan ``2026-09-06-work-artifacts-kinds-and-edges-cannot-express-a-refutation``:
        the query the GIN index exists to serve. Containment, not prefix —
        ``success_metric/dev`` must NOT match ``success_metric/development-speed``.
        """
        org = uuid4()
        shared = "success_metric/development-speed"
        only_on_one = "domain_spec/merge-train"
        await _upsert(
            async_db_session,
            org_id=org,
            kind="diagnostic",
            slug=_slug("diag-a"),
            body="pr_fix is inert",
            intent_refs=[shared, only_on_one],
        )
        await _upsert(
            async_db_session,
            org_id=org,
            kind="diagnostic",
            slug=_slug("diag-b"),
            body="red_main_fix is inert",
            intent_refs=[shared],
        )
        await _upsert(
            async_db_session,
            org_id=org,
            slug=_slug("plain-plan"),
            body="cites nothing",
        )

        rows_many, total_many = await crud.list_artifacts(
            async_db_session, org_id=org, intent_ref=shared
        )
        assert total_many == 2
        assert all(shared in r.intent_refs for r in rows_many)

        rows_one, total_one = await crud.list_artifacts(
            async_db_session, org_id=org, intent_ref=only_on_one
        )
        assert total_one == 1
        assert rows_one[0].intent_refs == [shared, only_on_one]

        _, total_zero = await crud.list_artifacts(
            async_db_session, org_id=org, intent_ref="success_metric/nothing-cites-me"
        )
        assert total_zero == 0

        # Exact member, not a prefix.
        _, total_prefix = await crud.list_artifacts(
            async_db_session, org_id=org, intent_ref="success_metric/dev"
        )
        assert total_prefix == 0

        # Unfiltered, all three are there — the filter is what narrowed it.
        _, total_all = await crud.list_artifacts(async_db_session, org_id=org)
        assert total_all == 3

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
    """Mount the plan-library router with db + auth dependencies overridden.

    BOTH Cognito dependencies are overridden, because the routes no longer
    share one. All of them except ``PATCH /{id}/kind`` resolve their principal
    through ``get_audit_actor_user`` (dual-auth: Cognito OR the runner's coord
    device JWT), which reads ``current_active_user_optional``; the kind
    correction stays on the strict ``current_active_user``. Overriding only the
    strict one would 401 every other route here and turn this whole file into a
    test of the auth wiring instead of the handlers. The wiring itself is
    tested in ``tests/test_plan_library_device_auth.py``.
    """
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

    async def test_organization_id_in_the_body_is_refused(
        self, client: httpx.AsyncClient
    ) -> None:
        """A caller-supplied org must never reach the row (scope escalation).

        Until plan ``2026-09-03-wrong-key-reads-cannot-yield-a-silent-zero``
        Phase 4 the key was silently DROPPED and the write returned 201 under
        the caller's real organization; now ``extra="forbid"`` refuses it by
        name, so a caller that thought it was writing into another
        organization learns that it was not, instead of reading a 201.
        """
        forged = str(uuid4())
        resp = await client.post(API_PREFIX, json=_payload(organization_id=forged))
        assert resp.status_code == 422, resp.text
        locs = [
            tuple(err["loc"])
            for err in resp.json()["detail"]
            if err["type"] == "extra_forbidden"
        ]
        assert locs == [("body", "organization_id")]

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

        # `include_coord=false` keeps this a local read — the coord-resolution
        # behaviour has its own tests below, with the probe stubbed.
        detail = await client.get(
            f"{API_PREFIX}/{artifact_id}", params={"include_coord": "false"}
        )
        assert detail.status_code == 200
        assert detail.json()["work_unit_slug"] == dangling

        listed = await client.get(API_PREFIX, params={"work_unit_slug": dangling})
        assert listed.status_code == 200
        assert listed.json()["total"] == 1
        assert listed.json()["count"] == len(listed.json()["items"]) == 1

    async def test_list_page_count_is_the_page_length_not_the_total(
        self, client: httpx.AsyncClient
    ) -> None:
        """``count`` is ``len(items)`` for THIS page (plan
        ``2026-09-03-wrong-key-reads-cannot-yield-a-silent-zero`` D4);
        ``total`` stays the unpaged total. A bounded page must say how long
        it is, and an empty page must say ``0``."""
        stem = _slug("count")
        for n in range(3):
            resp = await client.post(
                API_PREFIX, json=_payload(slug=f"{stem}-{n}", work_unit_slug=stem)
            )
            assert resp.status_code == 201, resp.text

        page = await client.get(
            API_PREFIX, params={"work_unit_slug": stem, "limit": "2"}
        )
        assert page.status_code == 200, page.text
        body = page.json()
        assert body["count"] == len(body["items"]) == 2
        assert body["total"] == 3

        rest = await client.get(
            API_PREFIX, params={"work_unit_slug": stem, "limit": "2", "offset": "2"}
        )
        assert rest.json()["count"] == len(rest.json()["items"]) == 1
        assert rest.json()["total"] == 3

        empty = await client.get(
            API_PREFIX, params={"work_unit_slug": f"{stem}-absent"}
        )
        assert empty.status_code == 200, empty.text
        assert empty.json()["count"] == 0
        assert empty.json()["items"] == []

    @pytest.mark.parametrize(
        ("method", "path", "body", "extra"),
        [
            ("POST", "", _payload(), "organisation_id"),
            ("POST", "", _payload(), "work_unit_slig"),
            ("PATCH", "/{id}/kind", {"kind": "plan"}, "kind_locked"),
            (
                "POST",
                "/{id}/edges",
                {"to_id": str(uuid4()), "relation": "feeds"},
                "notes",
            ),
            ("PATCH", "/edges/{id}", {"to_id": str(uuid4())}, "from_id"),
        ],
    )
    async def test_every_write_body_refuses_an_unknown_key(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        body: dict,
        extra: str,
    ) -> None:
        """Every request model carries ``extra="forbid"``: an unknown body
        key is a 422 whose ``loc`` names the key, never a field that is
        silently dropped on the way into the row. ``{id}`` is a random UUID
        because the refusal must happen BEFORE any lookup."""
        resp = await client.request(
            method,
            f"{API_PREFIX}{path.replace('{id}', str(uuid4()))}",
            json={**body, extra: "anything"},
        )
        assert resp.status_code == 422, resp.text
        locs = [
            tuple(err["loc"])
            for err in resp.json()["detail"]
            if err["type"] == "extra_forbidden"
        ]
        assert locs == [("body", extra)]

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

    async def test_edge_to_itself_is_refused(self, client: httpx.AsyncClient) -> None:
        """A self-edge makes a plan its own permanently-unmet dependency.

        ``/candidates`` walks ``depends_on`` to decide readiness, so
        ``A depends_on A`` removes A from every candidate page forever with no
        visible cause. Both spellings are refused — the outgoing one and the
        incoming one, which produce the identical row.
        """
        a = (await client.post(API_PREFIX, json=_payload(body="self"))).json()[
            "artifact"
        ]

        outgoing = await client.post(
            f"{API_PREFIX}/{a['id']}/edges",
            json={"to_id": a["id"], "relation": "depends_on"},
        )
        assert outgoing.status_code == 422, outgoing.text
        assert "itself" in outgoing.text

        incoming = await client.post(
            f"{API_PREFIX}/{a['id']}/edges",
            json={"from_id": a["id"], "relation": "depends_on"},
        )
        assert incoming.status_code == 422, incoming.text

        # And nothing was written by either attempt.
        detail = await client.get(
            f"{API_PREFIX}/{a['id']}", params={"include_coord": "false"}
        )
        assert detail.json()["edges"] == []

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

    async def test_diagnostic_kind_and_intent_refs_round_trip(
        self, client: httpx.AsyncClient
    ) -> None:
        """A ``diagnostic`` upsert is a 201 and ``intent_refs`` echoes back.

        Plan ``2026-09-06-work-artifacts-kinds-and-edges-cannot-express-a-refutation``.
        Before ``plan_library_04_diagnostic_refutes`` the kind was a 422 at the
        ``Literal`` and a CHECK violation beneath it, and there was no column
        to put the citation in.
        """
        ref = "success_metric/development-speed"
        created = await client.post(
            API_PREFIX,
            json=_payload(
                kind="diagnostic",
                title="pr_fix / red_main_fix are inert",
                body="25,253 consults, 0 dispatched",
                intent_refs=[ref, "domain_spec/merge-train"],
            ),
        )
        assert created.status_code == 201, created.text
        artifact = created.json()["artifact"]
        assert artifact["kind"] == "diagnostic"
        assert artifact["intent_refs"] == [ref, "domain_spec/merge-train"]
        # An explicit (non-heuristic) write locks the kind, as for every kind.
        assert artifact["kind_locked"] is True

        detail = await client.get(f"{API_PREFIX}/{artifact['id']}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["kind"] == "diagnostic"
        assert detail.json()["intent_refs"] == [ref, "domain_spec/merge-train"]

        listed = await client.get(API_PREFIX, params={"intent_ref": ref})
        assert listed.status_code == 200, listed.text
        assert [i["id"] for i in listed.json()["items"]] == [artifact["id"]]
        assert listed.json()["items"][0]["intent_refs"] == [
            ref,
            "domain_spec/merge-train",
        ]

        none = await client.get(
            API_PREFIX, params={"intent_ref": "success_metric/uncited"}
        )
        assert none.status_code == 200, none.text
        assert none.json()["total"] == 0

    async def test_intent_refs_are_metadata_and_move_without_a_version(
        self, client: httpx.AsyncClient
    ) -> None:
        """Correcting the citation on an unchanged body is stored, not versioned.

        ``intent_refs`` rides in the same metadata tuple as ``repos``: a
        re-post with the same body and a different citation answers
        ``changed=true`` with ``current_version`` untouched, and a byte-identical
        re-post (same citation) is the full no-op.
        """
        payload = _payload(
            kind="diagnostic", body="stable body", intent_refs=["success_metric/a"]
        )
        first = await client.post(API_PREFIX, json=payload)
        assert first.status_code == 201, first.text
        artifact_id = first.json()["artifact"]["id"]

        corrected = await client.post(
            API_PREFIX, json={**payload, "intent_refs": ["success_metric/b"]}
        )
        # 200, not 201: the row already existed and was updated in place.
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["changed"] is True
        assert corrected.json()["artifact"]["id"] == artifact_id
        assert corrected.json()["artifact"]["intent_refs"] == ["success_metric/b"]
        assert corrected.json()["artifact"]["current_version"] == 1

        same = await client.post(
            API_PREFIX, json={**payload, "intent_refs": ["success_metric/b"]}
        )
        assert same.status_code == 200, same.text
        assert same.json()["changed"] is False
        assert same.headers.get("x-artifact-unchanged") == "true"

        moved_to_b = await client.get(
            API_PREFIX, params={"intent_ref": "success_metric/b"}
        )
        assert [i["id"] for i in moved_to_b.json()["items"]] == [artifact_id]
        left_a = await client.get(API_PREFIX, params={"intent_ref": "success_metric/a"})
        assert left_a.json()["total"] == 0

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


class TestWorkUnitSlugIsExact:
    """``work_unit_slug=`` is exact equality, pinned over HTTP.

    Phase 4 of ``2026-09-03-coord-agent-doors-honour-or-refuse-every-parameter``.
    The dossier (``agent-door-filters-silently-ignored``) recorded an absurd
    stem returning ONE row on 2026-08-28. That did not reproduce on the
    deployed build (``total: 0`` on 2026-09-03), and ``crud/work_artifact.py``
    filters ``WorkArtifact.work_unit_slug == work_unit_slug`` — but a live
    zero on a frozen corpus is only *consistent with* exactness. This is the
    proof: two artifacts whose stems share a prefix (``abc`` / ``abc-longer``),
    and the shorter one must select exactly one row on every route that takes
    the filter (the list and ``/export`` — ``/candidates`` does not implement
    it, which the strict-query contract now says out loud with a 422 instead
    of returning an unfiltered page; see ``tests/test_strict_query.py``).
    """

    @staticmethod
    async def _two_prefixed_stems(db: AsyncSession) -> tuple[str, str]:
        """Two plans on stems ``<abc>`` and ``<abc>-longer``.

        Returns ``(short_stem, short_slug)`` — the stem a test filters on and
        the artifact slug that filter must select alone. The longer stem's
        artifact exists only to be the row a prefix or LIKE match would also
        return.
        """
        short_stem = _slug("abc")
        short_slug = _slug("exact-short")
        await _upsert(
            db,
            org_id=None,
            slug=short_slug,
            body="# the short stem",
            work_unit_slug=short_stem,
        )
        await _upsert(
            db,
            org_id=None,
            slug=_slug("exact-long"),
            body="# the longer stem",
            work_unit_slug=f"{short_stem}-longer",
        )
        return short_stem, short_slug

    async def test_list_selects_only_the_exact_stem(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        short_stem, short_slug = await self._two_prefixed_stems(async_db_session)

        resp = await client.get(
            API_PREFIX, params={"kind": "plan", "work_unit_slug": short_stem}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["slug"] for i in body["items"]] == [short_slug]
        assert body["items"][0]["work_unit_slug"] == short_stem

    async def test_list_absurd_stem_is_zero_rows(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        await self._two_prefixed_stems(async_db_session)

        resp = await client.get(
            API_PREFIX,
            params={
                "kind": "plan",
                "work_unit_slug": f"absurd-stem-that-cannot-exist-{uuid4().hex}",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "items": [],
            "count": 0,
            "total": 0,
            "offset": 0,
            "limit": 50,
        }

    async def test_export_manifest_selects_only_the_exact_stem(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        short_stem, short_slug = await self._two_prefixed_stems(async_db_session)

        resp = await client.get(
            f"{API_PREFIX}/export",
            params={"kind": "plan", "work_unit_slug": short_stem},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["x-export-artifact-count"] == "1"
        manifest = json.loads(
            zipfile.ZipFile(io.BytesIO(resp.content)).read("manifest.json")
        )
        assert [a["slug"] for a in manifest["artifacts"]] == [short_slug]
        assert manifest["truncated"] is False

    async def test_export_absurd_stem_is_an_empty_manifest(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        await self._two_prefixed_stems(async_db_session)

        resp = await client.get(
            f"{API_PREFIX}/export",
            params={
                "kind": "plan",
                "work_unit_slug": f"absurd-stem-that-cannot-exist-{uuid4().hex}",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["x-export-artifact-count"] == "0"
        manifest = json.loads(
            zipfile.ZipFile(io.BytesIO(resp.content)).read("manifest.json")
        )
        assert manifest["artifacts"] == []
        assert manifest["truncated"] is False


class TestStrictQueryKeepsEveryDeclaredKey:
    """The strict route class refuses UNKNOWN keys only — never a declared one.

    The refusal half (422, body shape, alias handling) is DB-free and lives in
    ``tests/test_strict_query.py``. This half needs the handlers to actually
    run, so it is here with the real database: every GET route on the router
    is called with EVERY query key its own dependant declares, and must not
    422. The keys are read from the mounted route, not retyped, so declaring
    a new ``Query(...)`` on a handler without exercising it here fails this
    test rather than silently narrowing coverage.
    """

    @staticmethod
    def _get_routes(app: FastAPI) -> dict[str, APIRoute]:
        routes: dict[str, APIRoute] = {}
        for route in app.routes:
            if isinstance(route, APIRoute) and "GET" in route.methods:
                assert isinstance(route, StrictQueryRoute), route.path
                routes[route.path] = route
        return routes

    async def test_every_declared_key_is_still_accepted(
        self, async_db_session: AsyncSession, api_user
    ) -> None:
        app = _build_app(db_session=async_db_session, user=api_user)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            await self._exercise_every_route(app, client)

    async def _exercise_every_route(
        self, app: FastAPI, client: httpx.AsyncClient
    ) -> None:
        created = await client.post(API_PREFIX, json=_payload(body="strict keys"))
        assert created.status_code == 201, created.text
        artifact_id = created.json()["artifact"]["id"]

        # Real values for every declared key, per route. ``since`` is a
        # datetime, the ints have bounds, ``include_coord`` is a bool — a
        # single generic value would 422 on TYPE, not on the key.
        since = (datetime.now(UTC) - timedelta(days=1)).isoformat()
        corpus_filter = {
            "kind": "plan",
            "status": "VETTED",
            "repo": "qontinui-web",
            "q": "strict",
            "since": since,
            "work_unit_slug": "any-stem",
        }
        sent: dict[str, dict[str, str]] = {
            f"{API_PREFIX}": {
                **corpus_filter,
                "intent_ref": "success_metric/development-speed",
                "offset": "0",
                "limit": "5",
            },
            f"{API_PREFIX}/divergent": {"kind": "plan"},
            f"{API_PREFIX}/capture-health": {},
            f"{API_PREFIX}/export": {**corpus_filter, "limit": "5"},
            f"{API_PREFIX}/candidates": {
                "offset": "0",
                "limit": "5",
                "include_coord": "false",
            },
            f"{API_PREFIX}/reconciliation": {
                "offset": "0",
                "limit": "5",
                "include_coord": "false",
            },
            f"{API_PREFIX}/followups": {"offset": "0", "limit": "5"},
            f"{API_PREFIX}/{{artifact_id}}": {"include_coord": "false"},
            f"{API_PREFIX}/{{artifact_id}}/export": {"version_number": "1"},
        }

        routes = self._get_routes(app)
        assert set(routes) == set(sent), "a GET route was added; exercise it here"
        for path, route in routes.items():
            params = sent[path]
            declared = accepted_query_keys(route.dependant)
            assert set(params) == set(declared), (path, declared)
            resp = await client.get(
                path.replace("{artifact_id}", artifact_id), params=params
            )
            assert resp.status_code == 200, (path, resp.status_code, resp.text)


class TestOrgScopeFailsClosed:
    """A broken org lookup must not degrade into the shared NULL bucket.

    ``organization_id = NULL`` is a REAL scope here — the bucket unprovisioned
    principals write into — so "the lookup returned nothing" and "the lookup
    blew up" cannot be allowed to produce the same answer. A statement timeout
    on a fully-provisioned operator would otherwise file their artifact in a
    bucket shared with every other principal that degraded the same way, and
    the two causes emit an identical log line.
    """

    async def test_a_failed_org_lookup_is_503_not_the_null_bucket(
        self, client: httpx.AsyncClient
    ) -> None:
        with patch(
            "app.api.v1.endpoints.plan_library.resolve_personal_organization",
            new=AsyncMock(side_effect=OperationalError("SELECT 1", {}, Exception())),
        ):
            resp = await client.post(API_PREFIX, json=_payload(body="scoped write"))

        assert resp.status_code == 503, resp.text
        assert "organization scope" in resp.text

    async def test_a_failed_org_lookup_fails_reads_too(
        self, client: httpx.AsyncClient
    ) -> None:
        """Reads share the scope, so a silent fall-through would show the
        NULL bucket's rows to a caller who owns an organization."""
        with patch(
            "app.api.v1.endpoints.plan_library.resolve_personal_organization",
            new=AsyncMock(side_effect=OperationalError("SELECT 1", {}, Exception())),
        ):
            resp = await client.get(API_PREFIX)

        assert resp.status_code == 503, resp.text

    async def test_genuine_absence_still_scopes_to_the_null_bucket(
        self, client: httpx.AsyncClient
    ) -> None:
        """The degenerate case is unchanged: no org row is not an error."""
        with patch(
            "app.api.v1.endpoints.plan_library.resolve_personal_organization",
            new=AsyncMock(return_value=None),
        ):
            resp = await client.post(API_PREFIX, json=_payload(body="null bucket"))

        assert resp.status_code == 201, resp.text
        assert resp.json()["artifact"]["organization_id"] is None


class TestCaptureHealth:
    """`GET /plan-library/capture-health` — which door is feeding the store.

    The panel exists to answer one question: is the agent write door being
    used, or is the deterministic scan the only thing writing? So the read
    must report an UNUSED door as an explicit zero. A door that is simply
    absent from the list reads as a feature that does not exist, which is a
    different (and wrong) claim.
    """

    async def test_every_known_door_appears_even_at_zero(
        self, client: httpx.AsyncClient
    ) -> None:
        await client.post(API_PREFIX, json=_payload(captured_by="runner_scan"))

        resp = await client.get(f"{API_PREFIX}/capture-health")
        assert resp.status_code == 200, resp.text
        doors = {d["captured_by"]: d for d in resp.json()["doors"]}
        assert set(doors) >= {"runner_scan", "agent", "operator"}
        assert doors["runner_scan"]["count"] >= 1
        # The load-bearing assertion: the unused doors are present, at zero.
        assert doors["operator"]["count"] == 0
        assert doors["operator"]["known"] is True
        assert doors["operator"]["last_touched_at"] is None

    async def test_counts_and_recency_split_by_door(
        self, client: httpx.AsyncClient
    ) -> None:
        await client.post(API_PREFIX, json=_payload(captured_by="runner_scan"))
        await client.post(API_PREFIX, json=_payload(captured_by="runner_scan"))
        await client.post(API_PREFIX, json=_payload(captured_by="agent"))

        body = (await client.get(f"{API_PREFIX}/capture-health")).json()
        doors = {d["captured_by"]: d for d in body["doors"]}
        assert doors["runner_scan"]["count"] >= 2
        assert doors["agent"]["count"] >= 1
        # A door with rows must date itself — "40 artifacts, none since March"
        # and "40 artifacts, one an hour ago" are different findings. The field
        # is `last_touched_at` (max(updated_at)), not a last-capture stamp: a
        # kind correction bumps it, so it is named for what it measures.
        assert doors["agent"]["last_touched_at"] is not None
        assert doors["agent"]["first_at"] is not None
        assert body["total"] == sum(d["count"] for d in body["doors"])

    async def test_capture_health_is_not_swallowed_by_the_id_route(
        self, client: httpx.AsyncClient
    ) -> None:
        """The literal path must beat `/{artifact_id}` — else this is a 422."""
        resp = await client.get(f"{API_PREFIX}/capture-health")
        assert resp.status_code == 200


class TestDetailCoordBlock:
    """The detail read's `coord` block — four states, never collapsed.

    This is where the page can most easily lie to an operator. "No linked work
    unit", "coord doesn't have that unit", "coord couldn't be reached" and
    "coord has no route to list citations" are four different facts, and three
    of them are routinely rendered as an innocuous empty state by code that
    treats absence as zero.
    """

    async def test_no_slug_is_unlinked_not_an_error(
        self, client: httpx.AsyncClient
    ) -> None:
        created = await client.post(API_PREFIX, json=_payload())
        artifact_id = created.json()["artifact"]["id"]

        detail = await client.get(f"{API_PREFIX}/{artifact_id}")
        assert detail.status_code == 200, detail.text
        coord = detail.json()["coord"]
        # A first-class normal state. Most artifacts have no work unit.
        assert coord["work_unit_state"] == "unlinked"
        assert coord["linked_prs_state"] == "unlinked"
        assert coord["unavailable_reason"] is None

    async def test_include_coord_false_reports_unavailable_not_unlinked(
        self, client: httpx.AsyncClient
    ) -> None:
        """ "We did not look" is not the same answer as "there is nothing"."""
        slug = f"phantom-{uuid4().hex[:8]}"
        created = await client.post(API_PREFIX, json=_payload(work_unit_slug=slug))
        artifact_id = created.json()["artifact"]["id"]

        detail = await client.get(
            f"{API_PREFIX}/{artifact_id}", params={"include_coord": "false"}
        )
        coord = detail.json()["coord"]
        assert coord["work_unit_state"] == "unavailable"
        assert coord["linked_prs_state"] == "unavailable"
        assert "include_coord=false" in coord["unavailable_reason"]

    async def test_a_404_from_coord_is_dangling_and_prs_are_a_real_zero(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.api.v1.endpoints import plan_library as endpoint

        async def _404(path, **kwargs):
            raise HTTPException(status_code=404, detail="no such work unit")

        monkeypatch.setattr(endpoint, "_proxy_coord_get", _404)

        slug = f"phantom-{uuid4().hex[:8]}"
        created = await client.post(API_PREFIX, json=_payload(work_unit_slug=slug))
        artifact_id = created.json()["artifact"]["id"]

        coord = (await client.get(f"{API_PREFIX}/{artifact_id}")).json()["coord"]
        # The link is FK-less by design and MAY dangle — normal, never a 404.
        assert coord["work_unit_state"] == "dangling"
        # Citations hang off the unit by a HARD FK, so no unit really is no
        # citations. This is the ONE case where empty is a genuine zero.
        assert coord["linked_prs_state"] == "unlinked"

    async def test_an_unreachable_coord_is_unavailable_not_empty(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.api.v1.endpoints import plan_library as endpoint

        async def _boom(path, **kwargs):
            raise HTTPException(status_code=502, detail="coord is not reachable")

        monkeypatch.setattr(endpoint, "_proxy_coord_get", _boom)

        slug = f"unit-{uuid4().hex[:8]}"
        created = await client.post(API_PREFIX, json=_payload(work_unit_slug=slug))
        artifact_id = created.json()["artifact"]["id"]

        resp = await client.get(f"{API_PREFIX}/{artifact_id}")
        # A coord outage must not fail the whole read of a LOCAL artifact.
        assert resp.status_code == 200, resp.text
        coord = resp.json()["coord"]
        assert coord["work_unit_state"] == "unavailable"
        assert coord["linked_prs_state"] == "unavailable"
        assert coord["unavailable_reason"]

    async def test_a_missing_citation_route_is_unavailable_not_no_prs(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Today's deployed coord has no HTTP citation LIST route (MCP-only)."""
        from app.api.v1.endpoints import plan_library as endpoint

        async def _unit_ok_citations_404(path, **kwargs):
            if path.endswith("/citations"):
                raise HTTPException(status_code=404, detail="no such route")
            return {"work_unit": {"status": "vetted", "title": "The unit"}}

        monkeypatch.setattr(endpoint, "_proxy_coord_get", _unit_ok_citations_404)

        slug = f"unit-{uuid4().hex[:8]}"
        created = await client.post(API_PREFIX, json=_payload(work_unit_slug=slug))
        artifact_id = created.json()["artifact"]["id"]

        coord = (await client.get(f"{API_PREFIX}/{artifact_id}")).json()["coord"]
        assert coord["work_unit_state"] == "linked"
        assert coord["work_unit_status"] == "vetted"
        # The load-bearing assertion: an unaskable question is NOT a zero.
        assert coord["linked_prs_state"] == "unavailable"
        assert coord["linked_prs"] == []

    async def test_citations_are_projected_with_their_merged_state(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.api.v1.endpoints import plan_library as endpoint

        async def _both_ok(path, **kwargs):
            if path.endswith("/citations"):
                return {
                    "citations": [
                        {
                            "repo": "qontinui-web",
                            "pr_number": 1425,
                            "merged": True,
                            "branch": "feat/x",
                        },
                        {"repo": "qontinui-coord", "pr_number": 900, "merged": False},
                    ]
                }
            return {"work_unit": {"status": "in_progress", "title": "The unit"}}

        monkeypatch.setattr(endpoint, "_proxy_coord_get", _both_ok)

        slug = f"unit-{uuid4().hex[:8]}"
        created = await client.post(API_PREFIX, json=_payload(work_unit_slug=slug))
        artifact_id = created.json()["artifact"]["id"]

        coord = (await client.get(f"{API_PREFIX}/{artifact_id}")).json()["coord"]
        assert coord["linked_prs_state"] == "available"
        assert [pr["state"] for pr in coord["linked_prs"]] == ["merged", "unmerged"]
