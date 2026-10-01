"""Plan library soft delete — ``DELETE /plan-library/{id}`` and the read filter.

Plan ``2026-09-12-plan-library-has-no-delete-so-a-junk-row-is-permanent``,
Phases 1 and 2. Against real Postgres, through the mounted router (the same
harness as ``tests/test_plan_library_api.py``).

What is pinned:

* **Every corpus read excludes an archived row by default** — one assertion
  per route, never inferred from the list route alone (Acceptance 3) — and
  returns it under ``include_archived=true``.
* The by-id reads still return an archived row, with the stamp.
* The DELETE verb: happy path, idempotent re-delete, required reason, 404.
* The three refusals: ``file_backed``, ``file_backing_unknown`` and
  ``inbound_edges``.
* An upsert onto an archived identity un-archives it and says so.
"""

from __future__ import annotations

import asyncio
import functools
import io
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.crud import work_artifact as crud
from app.crud.plan_scan_root import judge_file_backing
from app.models.plan_scan_root import PlanScanRootObservation
from app.models.work_artifact import WorkArtifact
from app.services.plan_scan_root_health import FRESH_WITHIN_SECS
from tests.test_plan_library_api import API_PREFIX, _build_app

pytestmark = pytest.mark.asyncio

REASON = {"reason": "junk probe row, test cleanup"}


def _stem() -> str:
    return f"2026-09-27-archive-test-{uuid4().hex[:10]}"


def _payload(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "kind": "plan",
        "slug": _stem(),
        "title": "Archive test plan",
        "status": "VETTED",
        "body": f"# plan {uuid4().hex}",
    }
    body.update(overrides)
    return body


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"planarchive_{uuid4().hex[:8]}@example.com",
        username=f"planarchive_{uuid4().hex[:8]}",
        full_name="Plan Archive Tester",
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


async def _create(client: httpx.AsyncClient, **overrides: object) -> dict:
    resp = await client.post(API_PREFIX, json=_payload(**overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()["artifact"]


async def _archive(client: httpx.AsyncClient, artifact_id: str) -> httpx.Response:
    return await client.request("DELETE", f"{API_PREFIX}/{artifact_id}", json=REASON)


async def _archived(client: httpx.AsyncClient, **overrides: object) -> dict:
    """Create a plan and archive it; returns the created summary."""
    row = await _create(client, **overrides)
    resp = await _archive(client, row["id"])
    assert resp.status_code == 200, resp.text
    return row


async def _crud_upsert(
    db: AsyncSession,
    *,
    slug: str,
    kind: str = "plan",
    body: str | None = None,
    source_repo: str | None = None,
    kind_is_heuristic: bool = False,
) -> tuple[WorkArtifact, bool, bool]:
    """A direct CRUD upsert in the NULL organization bucket."""
    return await crud.upsert_artifact(
        db,
        org_id=None,
        user_id=None,
        kind=kind,
        slug=slug,
        title="crud row",
        status="VETTED",
        body=body if body is not None else f"# {slug}",
        source_path=None,
        source_repo=source_repo,
        work_unit_slug=None,
        repos=[],
        authored_at=None,
        captured_by="runner_scan" if kind_is_heuristic else "agent",
        change_description=None,
        created_by="test",
        kind_is_heuristic=kind_is_heuristic,
    )


async def _scan_upsert(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    kind: str,
    repo: str,
) -> crud.UpsertOutcome:
    """A runner scan (heuristic kind) in ``org_id`` — the write that would
    resurrect an archived row."""
    return await crud.upsert_artifact_outcome(
        db,
        org_id=org_id,
        user_id=None,
        kind=kind,
        slug=slug,
        title="scanned row",
        status="VETTED",
        body=f"# scanned {slug}",
        source_path=None,
        source_repo=repo,
        work_unit_slug=None,
        repos=[],
        authored_at=None,
        captured_by="runner_scan",
        change_description=None,
        created_by="test",
        kind_is_heuristic=True,
    )


async def _stamp_archived(db: AsyncSession, row: WorkArtifact) -> None:
    """Archive a row with no guards — a test fixture, not the verb."""
    row.archived_at = datetime.now(UTC)
    row.archived_by = "test"
    row.archive_reason = "fixture"
    await db.commit()


def _ids(items: list[dict]) -> set[str]:
    return {item["id"] for item in items if item.get("id")}


# ===========================================================================
# Phase 1 — every corpus read excludes an archived row by default
# ===========================================================================


class TestDefaultExclusion:
    async def test_list(self, client: httpx.AsyncClient) -> None:
        live = await _create(client)
        gone = await _archived(client)

        page = (await client.get(API_PREFIX, params={"limit": 200})).json()
        assert live["id"] in _ids(page["items"])
        assert gone["id"] not in _ids(page["items"])

        shown = (
            await client.get(
                API_PREFIX, params={"limit": 200, "include_archived": "true"}
            )
        ).json()
        archived_items = [i for i in shown["items"] if i["id"] == gone["id"]]
        assert len(archived_items) == 1
        assert archived_items[0]["archived_at"] is not None
        assert archived_items[0]["archive_reason"] == REASON["reason"]

    async def test_list_slug_filter(self, client: httpx.AsyncClient) -> None:
        gone = await _archived(client)
        params = {"slug": gone["slug"]}
        assert (await client.get(API_PREFIX, params=params)).json()["total"] == 0
        shown = await client.get(
            API_PREFIX, params={**params, "include_archived": "true"}
        )
        assert _ids(shown.json()["items"]) == {gone["id"]}

    async def test_list_work_unit_slug_filter(self, client: httpx.AsyncClient) -> None:
        stem = _stem()
        gone = await _archived(client, slug=stem, work_unit_slug=stem)
        params = {"work_unit_slug": stem}
        assert (await client.get(API_PREFIX, params=params)).json()["total"] == 0
        shown = await client.get(
            API_PREFIX, params={**params, "include_archived": "true"}
        )
        assert _ids(shown.json()["items"]) == {gone["id"]}

    async def test_list_q_filter(self, client: httpx.AsyncClient) -> None:
        word = f"zqx{uuid4().hex[:8]}"
        gone = await _archived(client, body=f"# plan mentioning {word}")
        params = {"q": word}
        assert (await client.get(API_PREFIX, params=params)).json()["total"] == 0
        shown = await client.get(
            API_PREFIX, params={**params, "include_archived": "true"}
        )
        assert _ids(shown.json()["items"]) == {gone["id"]}

    async def test_divergent(self, client: httpx.AsyncClient) -> None:
        """An archived mis-keyed twin stops reading as a fork."""
        stem = _stem()
        await _create(client, slug=stem, source_repo="qontinui-dev-notes/plans")
        twin = await _archived(
            client,
            slug=stem,
            source_repo="qontinui/qontinui-dev-notes",
            body="# a different body",
        )

        def _slugs(resp: httpx.Response) -> set[str]:
            return {g["slug"] for g in resp.json()["groups"]}

        assert stem not in _slugs(await client.get(f"{API_PREFIX}/divergent"))
        shown = await client.get(
            f"{API_PREFIX}/divergent", params={"include_archived": "true"}
        )
        assert stem in _slugs(shown)
        variants = next(g for g in shown.json()["groups"] if g["slug"] == stem)
        assert twin["id"] in {v["id"] for v in variants["variants"]}

    async def test_reconciliation(self, client: httpx.AsyncClient) -> None:
        gone = await _archived(client)
        params = {"include_coord": "false", "limit": 100}

        def _artifact_ids(resp: httpx.Response) -> set[str]:
            assert resp.status_code == 200, resp.text
            return {str(r["artifact_id"]) for r in resp.json()["items"]}

        assert gone["id"] not in _artifact_ids(
            await client.get(f"{API_PREFIX}/reconciliation", params=params)
        )
        assert gone["id"] in _artifact_ids(
            await client.get(
                f"{API_PREFIX}/reconciliation",
                params={**params, "include_archived": "true"},
            )
        )

    async def test_capture_health_counts_and_archived_field(
        self, client: httpx.AsyncClient
    ) -> None:
        await _create(client)
        before = (await client.get(f"{API_PREFIX}/capture-health")).json()
        row = await _create(client)
        assert (await _archive(client, row["id"])).status_code == 200

        after = (await client.get(f"{API_PREFIX}/capture-health")).json()
        assert after["total"] == before["total"]
        assert after["archived"] == before["archived"] + 1

        shown = (
            await client.get(
                f"{API_PREFIX}/capture-health", params={"include_archived": "true"}
            )
        ).json()
        assert shown["total"] == after["total"] + after["archived"]
        assert shown["archived"] == after["archived"]

    async def test_corpus_health_counts(self, client: httpx.AsyncClient) -> None:
        before = (await client.get(API_PREFIX)).json()["corpus_health"]
        await _archived(client)
        after = (await client.get(API_PREFIX)).json()["corpus_health"]
        assert after["artifact_count"] == before["artifact_count"]
        assert after["plan_count"] == before["plan_count"]
        assert after["archived_count"] == before["archived_count"] + 1
        assert after["capture"]["archived"] == after["archived_count"]

        shown = (
            await client.get(API_PREFIX, params={"include_archived": "true"})
        ).json()["corpus_health"]
        assert shown["artifact_count"] == after["artifact_count"] + 1

    async def test_export(self, client: httpx.AsyncClient) -> None:
        gone = await _archived(client)

        def _names(resp: httpx.Response) -> list[str]:
            assert resp.status_code == 200, resp.text
            with zipfile.ZipFile(io.BytesIO(resp.content)) as archive:
                return archive.namelist()

        params = {"slug": gone["slug"]}
        default = _names(await client.get(f"{API_PREFIX}/export", params=params))
        assert not any(gone["slug"] in name for name in default)
        shown = _names(
            await client.get(
                f"{API_PREFIX}/export", params={**params, "include_archived": "true"}
            )
        )
        assert any(gone["slug"] in name for name in shown)

    async def test_candidates(self, client: httpx.AsyncClient) -> None:
        live = await _create(client)
        gone = await _archived(client)
        params = {"include_coord": "false", "limit": 100}

        default = (await client.get(f"{API_PREFIX}/candidates", params=params)).json()
        assert live["id"] in _ids(default["items"])
        assert gone["id"] not in _ids(default["items"])
        shown = (
            await client.get(
                f"{API_PREFIX}/candidates",
                params={**params, "include_archived": "true"},
            )
        ).json()
        assert gone["id"] in _ids(shown["items"])

    async def test_difficulty(self, client: httpx.AsyncClient) -> None:
        gone = await _archived(client, body="# plan\n\n## Phase 1\n\nDo a thing.\n")
        default = (await client.get(f"{API_PREFIX}/difficulty")).json()
        assert gone["id"] not in _ids(default["items"])
        shown = (
            await client.get(
                f"{API_PREFIX}/difficulty", params={"include_archived": "true"}
            )
        ).json()
        assert gone["id"] in _ids(shown["items"])

    async def test_followups_from_an_archived_row(
        self, client: httpx.AsyncClient
    ) -> None:
        origin = await _create(client)
        note = f"worth its own plan {uuid4().hex[:8]}"
        edge = await client.post(
            f"{API_PREFIX}/{origin['id']}/edges",
            json={"relation": "spawned_followup", "note": note},
        )
        assert edge.status_code in (200, 201), edge.text
        # Outbound edges do not block an archive.
        assert (await _archive(client, origin["id"])).status_code == 200

        def _notes(resp: httpx.Response) -> set[str]:
            return {item["note"] for item in resp.json()["items"]}

        assert note not in _notes(await client.get(f"{API_PREFIX}/followups"))
        assert note in _notes(
            await client.get(
                f"{API_PREFIX}/followups", params={"include_archived": "true"}
            )
        )


class TestByIdReadsStillServe:
    async def test_detail_and_export_return_the_archived_row(
        self, client: httpx.AsyncClient
    ) -> None:
        gone = await _archived(client)

        detail = await client.get(
            f"{API_PREFIX}/{gone['id']}", params={"include_coord": "false"}
        )
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["archived_at"] is not None
        assert body["archived_by"]
        assert body["archive_reason"] == REASON["reason"]

        exported = await client.get(f"{API_PREFIX}/{gone['id']}/export")
        assert exported.status_code == 200
        assert exported.text.startswith("# plan")

    async def test_a_live_row_reads_null_stamps(
        self, client: httpx.AsyncClient
    ) -> None:
        live = await _create(client)
        assert live["archived_at"] is None
        assert live["archived_by"] is None
        assert live["archive_reason"] is None


# ===========================================================================
# Phase 2 — the DELETE verb
# ===========================================================================


class TestArchiveVerb:
    async def test_happy_path(self, client: httpx.AsyncClient, api_user) -> None:
        row = await _create(client)
        # An API upsert names its kind, so the row is kind_locked — and that
        # does not block archiving.
        assert row["kind_locked"] is True

        resp = await _archive(client, row["id"])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == row["id"]
        assert body["archived_at"] is not None
        assert body["archived_by"] == api_user.email
        assert body["archive_reason"] == REASON["reason"]
        assert body["already_archived"] is False

    async def test_re_delete_is_idempotent_and_keeps_the_stamp(
        self, client: httpx.AsyncClient
    ) -> None:
        row = await _create(client)
        first = (await _archive(client, row["id"])).json()

        again = await client.request(
            "DELETE", f"{API_PREFIX}/{row['id']}", json={"reason": "a second reason"}
        )
        assert again.status_code == 200, again.text
        body = again.json()
        assert body["already_archived"] is True
        assert body["archived_at"] == first["archived_at"]
        assert body["archive_reason"] == REASON["reason"]

    @pytest.mark.parametrize("payload", [{"reason": ""}, {"reason": "   "}, {}])
    async def test_reason_is_required_and_non_blank(
        self, client: httpx.AsyncClient, payload: dict
    ) -> None:
        row = await _create(client)
        resp = await client.request("DELETE", f"{API_PREFIX}/{row['id']}", json=payload)
        assert resp.status_code == 422, resp.text
        # Nothing was written.
        detail = await client.get(
            f"{API_PREFIX}/{row['id']}", params={"include_coord": "false"}
        )
        assert detail.json()["archived_at"] is None

    async def test_unknown_artifact_is_404(self, client: httpx.AsyncClient) -> None:
        resp = await _archive(client, str(uuid4()))
        assert resp.status_code == 404, resp.text


# ===========================================================================
# Phase 2 — the refusals
# ===========================================================================


def _observation(
    *,
    org_id: UUID | None,
    source_repo: str,
    ref_census: dict | None = None,
    work_tree_census: dict | None = None,
    age_secs: int = 0,
    applied: bool = True,
) -> PlanScanRootObservation:
    """One device's reading. ``org_id`` is REQUIRED: the route scopes the
    census read by the caller's resolved organization, so a test must pass
    that organization rather than lean on the NULL bucket by coincidence."""
    now = datetime.now(UTC)
    received = now - timedelta(seconds=age_secs)
    return PlanScanRootObservation(
        organization_id=org_id,
        device_id=uuid4(),
        state="measured",
        source_repo=source_repo,
        counts_are_floors=False,
        observed_at=received,
        received_at=received,
        last_report_applied=applied,
        last_report_observed_at=received,
        ref_census=ref_census,
        work_tree_census=work_tree_census,
    )


def _census(slugs: list[str] | None, *, truncated: bool = False) -> dict:
    return {
        "source": "work_tree",
        "ref_sha": None,
        "count": len(slugs or []),
        "digest": "0" * 64,
        "slugs": slugs,
        "truncated": truncated,
    }


@pytest_asyncio.fixture()
async def org_id(async_db_session: AsyncSession, api_user) -> UUID | None:
    """The organization the route resolves for ``api_user`` — the scope its
    census read uses."""
    from app.api.v1.endpoints.plan_library import _resolve_org_id

    return await _resolve_org_id(async_db_session, api_user)


class TestFileBackingRefusals:
    async def test_file_backed_is_refused(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        repo = f"repo-{uuid4().hex[:6]}/plans"
        row = await _create(client, source_repo=repo)
        obs = _observation(
            org_id=org_id,
            source_repo=repo,
            ref_census=_census([]),
            work_tree_census=_census([row["slug"], _stem()]),
        )
        async_db_session.add(obs)
        await async_db_session.commit()

        resp = await _archive(client, row["id"])
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "file_backed"
        # Never only "delete the file": the caller may be evicting a
        # wrong-kind duplicate, whose fix is upsert-then-archive.
        assert "delete the file" in detail["message"]
        assert "wrong-kind duplicate" in detail["message"]
        assert "upsert the correct kind first" in detail["message"]
        assert detail["source_repo"] == repo
        assert detail["stem"] == row["slug"]
        assert detail["listed_by"] == [
            {"device_id": str(obs.device_id), "census": "work_tree"}
        ]
        # Still live.
        page = await client.get(API_PREFIX, params={"slug": row["slug"]})
        assert page.json()["total"] == 1

    async def test_every_census_withheld_is_unknown_never_allow(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        repo = f"repo-{uuid4().hex[:6]}/plans"
        row = await _create(client, source_repo=repo)
        async_db_session.add_all(
            [
                # A NULL census on both sides …
                _observation(org_id=org_id, source_repo=repo),
                # … and a withheld (slugs: null) one.
                _observation(
                    org_id=org_id, source_repo=repo, work_tree_census=_census(None)
                ),
            ]
        )
        await async_db_session.commit()

        resp = await _archive(client, row["id"])
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "file_backing_unknown"

    async def test_one_absent_does_not_outvote_an_unreadable_side(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        repo = f"repo-{uuid4().hex[:6]}/plans"
        row = await _create(client, source_repo=repo)
        # work_tree proves absence; ref reported nothing.
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census([_stem()])
            )
        )
        await async_db_session.commit()
        resp = await _archive(client, row["id"])
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "file_backing_unknown"

    async def test_every_side_complete_and_absent_allows(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        repo = f"repo-{uuid4().hex[:6]}/plans"
        row = await _create(client, source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id,
                source_repo=repo,
                ref_census=_census([_stem()]),
                work_tree_census=_census([_stem()]),
            )
        )
        await async_db_session.commit()
        assert (await _archive(client, row["id"])).status_code == 200

    async def test_a_stale_device_alone_is_unknown(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """A source reported ONLY by a stale device: nothing fresh can say, so
        the answer is UNKNOWN — neither file_backed nor allowed."""
        repo = f"repo-{uuid4().hex[:6]}/plans"
        row = await _create(client, source_repo=repo)
        stale = _observation(
            org_id=org_id,
            source_repo=repo,
            ref_census=_census([row["slug"]]),
            work_tree_census=_census([row["slug"]]),
            age_secs=FRESH_WITHIN_SECS + 60,
        )
        async_db_session.add(stale)
        await async_db_session.commit()
        resp = await _archive(client, row["id"])
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "file_backing_unknown"
        assert "no device reporting" in detail["message"]
        assert detail["ignored"][0]["device_id"] == str(stale.device_id)
        assert detail["sides"] == []

    async def test_a_stale_listing_is_ignored_beside_a_fresh_absence(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """A dead device's old listing does not block forever: it is ignored,
        and a fresh device proving absence on both sides lets the archive
        through."""
        repo = f"repo-{uuid4().hex[:6]}/plans"
        row = await _create(client, source_repo=repo)
        async_db_session.add_all(
            [
                _observation(
                    org_id=org_id,
                    source_repo=repo,
                    ref_census=_census([row["slug"]]),
                    work_tree_census=_census([row["slug"]]),
                    age_secs=FRESH_WITHIN_SECS + 60,
                ),
                _observation(
                    org_id=org_id,
                    source_repo=repo,
                    ref_census=_census([_stem()]),
                    work_tree_census=_census([_stem()]),
                ),
            ]
        )
        await async_db_session.commit()
        assert (await _archive(client, row["id"])).status_code == 200

    async def test_the_file_guard_runs_on_the_locked_row(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """The pre-read saw the row ARCHIVED, but it was un-archived before the
        lock: the guard must still judge — and refuse — the now-live row."""
        repo = f"repo-{uuid4().hex[:6]}/plans"
        created = await _create(client, source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id,
                source_repo=repo,
                ref_census=_census([created["slug"]]),
                work_tree_census=_census([created["slug"]]),
            )
        )
        await async_db_session.commit()
        row = await async_db_session.get(WorkArtifact, UUID(created["id"]))
        assert row is not None
        # The unlocked pre-read's view: archived. The committed row is live.
        set_committed_value(row, "archived_at", datetime.now(UTC))

        resp = await _archive(client, created["id"])
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "file_backed"

    async def test_an_unreported_source_repo_is_not_scanner_backed(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """The mis-keyed ``qontinui/qontinui-dev-notes`` class: nothing scans it."""
        async_db_session.add(
            _observation(
                org_id=org_id,
                source_repo="qontinui-dev-notes/plans",
                work_tree_census=_census(None),
            )
        )
        await async_db_session.commit()
        row = await _create(client, source_repo="qontinui/qontinui-dev-notes")
        assert (await _archive(client, row["id"])).status_code == 200
        null_repo = await _create(client)
        assert (await _archive(client, null_repo["id"])).status_code == 200

    async def test_a_file_backed_wrong_kind_duplicate_is_archivable(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """The posture row's kind correction: upsert the right kind, then
        archive the wrong one — allowed although a fresh census lists the
        stem, because the scanner then resolves to the live correct row."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        wrong = await _scan_upsert(
            async_db_session, org_id=org_id, slug=slug, kind="handoff", repo=repo
        )
        assert wrong.artifact.kind_locked is False
        correct = await _create(client, slug=slug, kind="plan", source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census([slug])
            )
        )
        await async_db_session.commit()

        resp = await _archive(client, str(wrong.artifact.id))
        assert resp.status_code == 200, resp.text

        rescan = await _scan_upsert(
            async_db_session, org_id=org_id, slug=slug, kind="handoff", repo=repo
        )
        assert str(rescan.artifact.id) == correct["id"]
        assert rescan.unarchived is False
        page = await client.get(
            API_PREFIX, params={"slug": slug, "include_archived": "true"}
        )
        by_id = {item["id"]: item for item in page.json()["items"]}
        assert by_id[str(wrong.artifact.id)]["archived_at"] is not None
        assert by_id[correct["id"]]["archived_at"] is None

    async def test_an_archived_sibling_does_not_admit_a_file_backed_row(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """Only a LIVE sibling counts: with the other kind archived too, the
        scanner would fall back to this row and un-archive it."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        other = await _create(client, slug=slug, kind="handoff", source_repo=repo)
        assert (await _archive(client, other["id"])).status_code == 200
        row = await _create(client, slug=slug, kind="plan", source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census([slug])
            )
        )
        await async_db_session.commit()
        resp = await _archive(client, row["id"])
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "file_backed"

    async def test_archiving_one_of_two_locked_kinds_ends_the_ambiguity(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """Two kind-locked rows make the scan ambiguous; archiving the wrong
        one through the VERB (file-backed stem) leaves one live target."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        correct = await _create(client, slug=slug, kind="plan", source_repo=repo)
        wrong = await _create(client, slug=slug, kind="handoff", source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census([slug])
            )
        )
        await async_db_session.commit()
        with pytest.raises(crud.AmbiguousArtifactKind):
            await _scan_upsert(
                async_db_session, org_id=org_id, slug=slug, kind="plan", repo=repo
            )
        # Raised before any write, so the session needs no rollback (which
        # would also expire the route's shared user object).

        resp = await _archive(client, wrong["id"])
        assert resp.status_code == 200, resp.text

        rescan = await _scan_upsert(
            async_db_session, org_id=org_id, slug=slug, kind="plan", repo=repo
        )
        assert str(rescan.artifact.id) == correct["id"]

    async def test_file_backing_unknown_with_a_live_sibling_is_archivable(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """The exemption covers the UNKNOWN arm too: with a live sibling the
        scanner lands there whatever the file state is."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        wrong = await _scan_upsert(
            async_db_session, org_id=org_id, slug=slug, kind="handoff", repo=repo
        )
        await _create(client, slug=slug, kind="plan", source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census(None)
            )
        )
        await async_db_session.commit()
        resp = await _archive(client, str(wrong.artifact.id))
        assert resp.status_code == 200, resp.text

    async def test_the_locked_correct_row_is_not_exempt_beside_an_unlocked_guess(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """W1: the exemption is for the WRONG-kind row. Archiving the asserted
        (kind_locked) row beside an unlocked scanner guess would hand the stem
        to the guess — refused; archiving the guess is allowed."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        guess = await _scan_upsert(
            async_db_session, org_id=org_id, slug=slug, kind="handoff", repo=repo
        )
        assert guess.artifact.kind_locked is False
        correct = await _create(client, slug=slug, kind="plan", source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census([slug])
            )
        )
        await async_db_session.commit()

        resp = await _archive(client, correct["id"])
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "file_backed"
        assert detail["live_sibling_ids"] == [str(guess.artifact.id)]
        assert "CORRECT row" in detail["message"]

        resp = await _archive(client, str(guess.artifact.id))
        assert resp.status_code == 200, resp.text

    async def test_a_locked_row_beside_an_ambiguous_fork_is_refused(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """A kind_locked row whose live siblings are themselves an ambiguous
        fork (two asserted kinds) is not exempt: no single row would take the
        scan, and the refusal says the fork must be resolved — not that this
        row is the correct one."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        target = await _create(client, slug=slug, kind="plan", source_repo=repo)
        first = await _create(client, slug=slug, kind="handoff", source_repo=repo)
        second = await _create(client, slug=slug, kind="diagnostic", source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census([slug])
            )
        )
        await async_db_session.commit()

        resp = await _archive(client, target["id"])
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "file_backed"
        assert sorted(detail["live_sibling_ids"]) == sorted([first["id"], second["id"]])
        assert "ambiguous" in detail["message"]
        assert "CORRECT row" not in detail["message"]

    async def test_a_stale_in_memory_sibling_does_not_decide(
        self,
        client: httpx.AsyncClient,
        async_db_session: AsyncSession,
        org_id: UUID | None,
    ) -> None:
        """``populate_existing``: the sibling is in the session's identity map
        reading kind_locked=True, but the committed row is unlocked. The guard
        must re-read it and refuse archiving the locked correct row."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        guess = await _scan_upsert(
            async_db_session, org_id=org_id, slug=slug, kind="handoff", repo=repo
        )
        correct = await _create(client, slug=slug, kind="plan", source_repo=repo)
        async_db_session.add(
            _observation(
                org_id=org_id, source_repo=repo, work_tree_census=_census([slug])
            )
        )
        await async_db_session.commit()
        set_committed_value(guess.artifact, "kind_locked", True)

        resp = await _archive(client, correct["id"])
        assert resp.status_code == 409, resp.text
        assert guess.artifact.kind_locked is False

    async def test_inbound_edges_are_refused_and_listed(
        self, client: httpx.AsyncClient
    ) -> None:
        target = await _create(client)
        dependent = await _create(client)
        edge = await client.post(
            f"{API_PREFIX}/{dependent['id']}/edges",
            json={"relation": "depends_on", "to_id": target["id"]},
        )
        assert edge.status_code in (200, 201), edge.text
        edge_id = edge.json()["id"]

        resp = await _archive(client, target["id"])
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "inbound_edges"
        assert detail["edge_ids"] == [edge_id]
        # Nothing was written.
        detail_read = await client.get(
            f"{API_PREFIX}/{target['id']}", params={"include_coord": "false"}
        )
        assert detail_read.json()["archived_at"] is None

        # An edge from an ARCHIVED row is not live and no longer blocks.
        assert (await _archive(client, dependent["id"])).status_code == 200
        assert (await _archive(client, target["id"])).status_code == 200

    async def test_archive_write_rechecks_inbound_edges_under_the_lock(
        self, async_db_session: AsyncSession
    ) -> None:
        """The crud write re-reads inbound edges itself — a caller that skipped
        (or raced) a pre-check cannot archive past a live edge."""
        target, _, _ = await _crud_upsert(async_db_session, slug=_stem())
        source, _, _ = await _crud_upsert(async_db_session, slug=_stem())
        edge, _ = await crud.create_edge(
            async_db_session,
            from_artifact=source,
            to_artifact=target,
            relation="depends_on",
            note=None,
            created_by="test",
        )
        with pytest.raises(crud.InboundEdgesExist) as raised:
            await crud.archive_artifact(
                async_db_session, target, archived_by="test", reason="race"
            )
        assert [e.id for e in raised.value.edges] == [edge.id]


class TestTargetArchived:
    async def test_an_edge_onto_an_archived_target_is_refused(
        self, client: httpx.AsyncClient
    ) -> None:
        gone = await _archived(client)
        live = await _create(client)
        resp = await client.post(
            f"{API_PREFIX}/{live['id']}/edges",
            json={"relation": "depends_on", "to_id": gone["id"]},
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "target_archived"
        assert resp.json()["detail"]["target_id"] == gone["id"]

        # Incoming form: the path artifact is the (archived) target.
        incoming = await client.post(
            f"{API_PREFIX}/{gone['id']}/edges",
            json={"relation": "feeds", "from_id": live["id"]},
        )
        assert incoming.status_code == 409, incoming.text
        assert incoming.json()["detail"]["error"] == "target_archived"

    async def test_claiming_a_followup_onto_an_archived_target_is_refused(
        self, client: httpx.AsyncClient
    ) -> None:
        origin = await _create(client)
        followup = await client.post(
            f"{API_PREFIX}/{origin['id']}/edges",
            json={"relation": "spawned_followup", "note": "do the thing"},
        )
        assert followup.status_code in (200, 201), followup.text
        gone = await _archived(client)

        resp = await client.patch(
            f"{API_PREFIX}/edges/{followup.json()['id']}", json={"to_id": gone["id"]}
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "target_archived"


class TestJudgeFileBacking:
    """The pure verdict table, without a database."""

    def _judge(self, *obs: PlanScanRootObservation, stem: str = "b") -> str:
        return judge_file_backing(
            list(obs), source_repo="r/plans", stem=stem, now=datetime.now(UTC)
        ).verdict

    def test_truncated_floor_that_omits_the_stem_is_unknown(self) -> None:
        obs = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["a"]),
            work_tree_census=_census(["a"], truncated=True),
        )
        assert self._judge(obs) == "unknown"

    def test_truncated_floor_that_lists_the_stem_is_backed(self) -> None:
        obs = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["b"], truncated=True),
        )
        backing = judge_file_backing(
            [obs], source_repo="r/plans", stem="b", now=datetime.now(UTC)
        )
        assert backing.verdict == "file_backed"
        assert [s.side for s in backing.listing_sides] == ["ref"]

    def test_null_source_repo_is_never_scanner_backed(self) -> None:
        obs = _observation(
            org_id=None, source_repo="r/plans", ref_census=_census(["b"])
        )
        assert (
            judge_file_backing(
                [obs], source_repo=None, stem="b", now=datetime.now(UTC)
            ).verdict
            == "not_scanner_backed"
        )

    def test_mixed_absent_and_unreadable_is_unknown(self) -> None:
        absent = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["a"]),
            work_tree_census=_census(["a"]),
        )
        withheld = _observation(
            org_id=None, source_repo="r/plans", work_tree_census=_census(None)
        )
        assert self._judge(absent) == "not_listed"
        assert self._judge(absent, withheld) == "unknown"

    def test_a_stale_listing_is_ignored(self) -> None:
        stale = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["b"]),
            work_tree_census=_census(["b"]),
            age_secs=FRESH_WITHIN_SECS + 1,
        )
        fresh_absent = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["a"]),
            work_tree_census=_census(["a"]),
        )
        # Ignored — neither a listing nor an unreadable side: the fresh device
        # proving absence on both sides decides it.
        assert self._judge(stale, fresh_absent) == "not_listed"

    def test_stale_only_is_unknown_not_unscanned(self) -> None:
        stale = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["a"]),
            work_tree_census=_census(["a"]),
            age_secs=FRESH_WITHIN_SECS + 1,
        )
        backing = judge_file_backing(
            [stale], source_repo="r/plans", stem="b", now=datetime.now(UTC)
        )
        assert backing.verdict == "unknown"
        assert backing.no_fresh_reading is True
        assert backing.sides == ()
        assert [i.device_id for i in backing.ignored] == [stale.device_id]

    def test_a_fresh_unreadable_side_still_wins_over_a_stale_device(self) -> None:
        stale_absent = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["a"]),
            work_tree_census=_census(["a"]),
            age_secs=FRESH_WITHIN_SECS + 1,
        )
        fresh_withheld = _observation(
            org_id=None, source_repo="r/plans", work_tree_census=_census(None)
        )
        assert self._judge(stale_absent, fresh_withheld) == "unknown"

    def test_a_superseded_reading_is_ignored(self) -> None:
        superseded = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["b"]),
            work_tree_census=_census(["b"]),
            applied=False,
        )
        assert self._judge(superseded) == "unknown"
        # Ignored, not unreadable: beside a fresh device proving absence on
        # both sides, the superseded LISTING neither refuses nor blocks.
        fresh_absent = _observation(
            org_id=None,
            source_repo="r/plans",
            ref_census=_census(["a"]),
            work_tree_census=_census(["a"]),
        )
        assert self._judge(superseded, fresh_absent) == "not_listed"


# ===========================================================================
# Phase 2 — an upsert onto an archived identity un-archives it
# ===========================================================================


class TestUnarchiveOnUpsert:
    @pytest.mark.parametrize("body_changes", [False, True])
    async def test_upsert_unarchives_and_says_so(
        self, client: httpx.AsyncClient, body_changes: bool
    ) -> None:
        payload = _payload()
        created = await client.post(API_PREFIX, json=payload)
        artifact_id = created.json()["artifact"]["id"]
        assert (await _archive(client, artifact_id)).status_code == 200

        repost = {**payload, "body": "# revised"} if body_changes else payload
        resp = await client.post(API_PREFIX, json=repost)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["unarchived"] is True
        assert body["changed"] is True
        assert resp.headers.get("X-Artifact-Unchanged") is None
        assert body["artifact"]["id"] == artifact_id
        assert body["artifact"]["archived_at"] is None
        assert body["artifact"]["archive_reason"] is None

        page = await client.get(API_PREFIX, params={"slug": payload["slug"]})
        assert _ids(page.json()["items"]) == {artifact_id}

    async def test_upsert_of_a_live_row_reports_unarchived_false(
        self, client: httpx.AsyncClient
    ) -> None:
        payload = _payload()
        await client.post(API_PREFIX, json=payload)
        again = await client.post(API_PREFIX, json=payload)
        assert again.json()["unarchived"] is False
        assert again.json()["changed"] is False

    async def test_unarchive_reports_outbound_edges_to_archived_rows(
        self, client: httpx.AsyncClient
    ) -> None:
        """Reviving a row whose ``depends_on`` target stayed archived is allowed,
        and the dangling edge is named."""
        dependent_payload = _payload()
        dependent = (await client.post(API_PREFIX, json=dependent_payload)).json()[
            "artifact"
        ]
        target = await _create(client)
        edge = await client.post(
            f"{API_PREFIX}/{dependent['id']}/edges",
            json={"relation": "depends_on", "to_id": target["id"]},
        )
        edge_id = edge.json()["id"]
        # Archive the dependent first (no inbound), then the target (its only
        # inbound edge now comes from an archived row).
        assert (await _archive(client, dependent["id"])).status_code == 200
        assert (await _archive(client, target["id"])).status_code == 200

        revived = await client.post(API_PREFIX, json=dependent_payload)
        assert revived.status_code == 200, revived.text
        assert revived.json()["unarchived"] is True
        assert revived.json()["edges_to_archived"] == [edge_id]

    async def test_a_stale_in_memory_stamp_cannot_hide_an_unarchive(
        self, async_db_session: AsyncSession
    ) -> None:
        """The DELETE lands AFTER the upsert loaded the row: the conditional
        UPDATE's row count, not the loaded attribute, decides ``unarchived``."""
        slug = _stem()
        row, _, _ = await _crud_upsert(async_db_session, slug=slug, body="# same")
        assert row.archived_at is None
        # Archive behind the ORM's back — the identity-map copy stays "live".
        await async_db_session.execute(
            update(WorkArtifact)
            .where(WorkArtifact.id == row.id)
            .values(archived_at=datetime.now(UTC), archived_by="x", archive_reason="y")
            .execution_options(synchronize_session=False)
        )
        assert row.archived_at is None

        outcome = await crud.upsert_artifact_outcome(
            async_db_session,
            org_id=None,
            user_id=None,
            kind="plan",
            slug=slug,
            title="crud row",
            status="VETTED",
            body="# same",
            source_path=None,
            source_repo=None,
            work_unit_slug=None,
            repos=[],
            authored_at=None,
            captured_by="agent",
            change_description=None,
            created_by="test",
        )
        assert outcome.unarchived is True
        stored = (
            await async_db_session.execute(
                select(WorkArtifact.archived_at).where(WorkArtifact.id == row.id)
            )
        ).scalar_one()
        assert stored is None

    async def test_a_scanner_kind_upsert_unarchives(
        self, async_db_session: AsyncSession
    ) -> None:
        slug = _stem()
        repo = "qontinui-dev-notes/plans"
        row, _, _ = await _crud_upsert(
            async_db_session, slug=slug, source_repo=repo, kind_is_heuristic=True
        )
        await _stamp_archived(async_db_session, row)

        outcome = await crud.upsert_artifact_outcome(
            async_db_session,
            org_id=None,
            user_id=None,
            kind="plan",
            slug=slug,
            title="crud row",
            status="VETTED",
            body=f"# {slug}",
            source_path=None,
            source_repo=repo,
            work_unit_slug=None,
            repos=[],
            authored_at=None,
            captured_by="runner_scan",
            change_description=None,
            created_by="test",
            kind_is_heuristic=True,
        )
        assert outcome.artifact.id == row.id
        assert outcome.unarchived is True
        assert outcome.artifact.archived_at is None


# ===========================================================================
# Scanner resolution, kind forks and prompt chains ignore archived rows
# ===========================================================================


class TestArchivedRowsLeaveTheCorpusReads:
    async def test_scanner_resolution_prefers_the_live_row(
        self, async_db_session: AsyncSession
    ) -> None:
        """Two LOCKED rows for one (slug, source_repo) would be ambiguous; with
        one archived, the scan resolves to the live one instead of 409ing."""
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        live, _, _ = await _crud_upsert(
            async_db_session, slug=slug, kind="plan", source_repo=repo
        )
        twin, _, _ = await _crud_upsert(
            async_db_session, slug=slug, kind="handoff", source_repo=repo
        )
        assert live.kind_locked and twin.kind_locked
        with pytest.raises(crud.AmbiguousArtifactKind):
            await _crud_upsert(
                async_db_session,
                slug=slug,
                source_repo=repo,
                body="# rescanned",
                kind_is_heuristic=True,
            )
        await _stamp_archived(async_db_session, twin)

        row, created, _ = await _crud_upsert(
            async_db_session,
            slug=slug,
            source_repo=repo,
            body="# rescanned",
            kind_is_heuristic=True,
        )
        assert created is False
        assert row.id == live.id

    def test_resolve_scan_target_falls_back_to_archived(self) -> None:
        archived = WorkArtifact(
            kind="plan", slug="s", kind_locked=False, archived_at=datetime.now(UTC)
        )
        assert crud.resolve_scan_target([archived], slug="s", source_repo=None) is (
            archived
        )

    async def test_find_kind_forks_excludes_archived(
        self, async_db_session: AsyncSession
    ) -> None:
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        await _crud_upsert(async_db_session, slug=slug, kind="plan", source_repo=repo)
        twin, _, _ = await _crud_upsert(
            async_db_session, slug=slug, kind="handoff", source_repo=repo
        )

        def _slugs(forks: list) -> set[str]:
            return {fork_slug for fork_slug, _, _ in forks}

        assert slug in _slugs(await crud.find_kind_forks(async_db_session, org_id=None))
        await _stamp_archived(async_db_session, twin)
        assert slug not in _slugs(
            await crud.find_kind_forks(async_db_session, org_id=None)
        )
        assert slug in _slugs(
            await crud.find_kind_forks(
                async_db_session, org_id=None, include_archived=True
            )
        )

    async def test_load_prompt_chains_excludes_archived_producers(
        self, async_db_session: AsyncSession
    ) -> None:
        plan, _, _ = await _crud_upsert(async_db_session, slug=_stem())
        prompt, _, _ = await _crud_upsert(
            async_db_session, slug=_stem(), kind="plan_authoring_prompt"
        )
        await crud.create_edge(
            async_db_session,
            from_artifact=prompt,
            to_artifact=plan,
            relation="authored_plan",
            note=None,
            created_by="test",
        )

        def _producers(chains: dict) -> list:
            return [producer.id for producer, _, _ in chains[plan.id]]

        chains = await crud.load_prompt_chains(async_db_session, [plan.id])
        assert _producers(chains) == [prompt.id]
        await _stamp_archived(async_db_session, prompt)
        assert (
            _producers(await crud.load_prompt_chains(async_db_session, [plan.id])) == []
        )
        assert _producers(
            await crud.load_prompt_chains(
                async_db_session, [plan.id], include_archived=True
            )
        ) == [prompt.id]


# ===========================================================================
# Concurrency — the per-scan-identity advisory lock
# ===========================================================================


class TestConcurrentSiblingArchives:
    async def test_the_last_two_live_siblings_cannot_both_be_archived(
        self, test_engine, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Two sessions archive the last two live (unlocked) siblings of a
        file-backed stem at once: exactly one wins and the other is refused,
        so a live row is left for the scanner.

        Each session's sibling read is followed by a barrier that waits (up to
        a bound) for the OTHER session to have read too, forcing the
        read-read-write-write interleaving. With
        ``crud.lock_scan_identity`` the second session blocks on the advisory
        lock before its census read, the barrier times out, and it reads the
        first's committed archive. Mutation-proved: removing the
        ``pg_advisory_xact_lock`` statement makes both archives succeed.
        """
        from fastapi import HTTPException
        from sqlalchemy import delete
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from app.api.v1.endpoints.plan_library import _archive_file_guard

        maker = async_sessionmaker(test_engine, expire_on_commit=False)
        slug = _stem()
        repo = f"repo-{uuid4().hex[:6]}/plans"
        async with maker() as setup:
            rows = []
            for kind in ("plan", "handoff"):
                row, _, _ = await crud.upsert_artifact(
                    setup,
                    org_id=None,
                    user_id=None,
                    kind=kind,
                    slug=slug,
                    title="race row",
                    status="VETTED",
                    body=f"# {kind}",
                    source_path=None,
                    source_repo=repo,
                    work_unit_slug=None,
                    repos=[],
                    authored_at=None,
                    captured_by="agent",
                    change_description=None,
                    created_by="test",
                )
                rows.append(row.id)
            await setup.execute(
                update(WorkArtifact)
                .where(WorkArtifact.id.in_(rows))
                .values(kind_locked=False)
            )
            obs = _observation(
                org_id=None, source_repo=repo, work_tree_census=_census([slug])
            )
            setup.add(obs)
            await setup.commit()

        original = crud.live_scan_siblings
        arrived = 0
        both = asyncio.Event()

        async def _barrier_siblings(db, artifact):  # type: ignore[no-untyped-def]
            nonlocal arrived
            result = await original(db, artifact)
            arrived += 1
            if arrived >= 2:
                both.set()
            try:
                await asyncio.wait_for(both.wait(), timeout=1.5)
            except TimeoutError:
                pass
            return result

        monkeypatch.setattr(crud, "live_scan_siblings", _barrier_siblings)

        async def _archive_in_own_session(artifact_id: UUID) -> str:
            async with maker() as db:
                row = await db.get(WorkArtifact, artifact_id)
                assert row is not None
                try:
                    await crud.archive_artifact(
                        db,
                        row,
                        archived_by="race",
                        reason="race",
                        guard=functools.partial(_archive_file_guard, db, org_id=None),
                    )
                except HTTPException as exc:
                    assert exc.status_code == 409
                    return "409"
                return "200"

        try:
            outcomes = await asyncio.gather(
                *(_archive_in_own_session(row_id) for row_id in rows)
            )
            assert sorted(outcomes) == ["200", "409"], outcomes
            async with maker() as check:
                live = (
                    await check.execute(
                        select(WorkArtifact.id).where(
                            WorkArtifact.id.in_(rows),
                            WorkArtifact.archived_at.is_(None),
                        )
                    )
                ).all()
            assert len(live) == 1
        finally:
            async with maker() as cleanup:
                # Versions go with their artifact (ON DELETE CASCADE).
                await cleanup.execute(
                    delete(WorkArtifact).where(WorkArtifact.id.in_(rows))
                )
                await cleanup.execute(
                    delete(PlanScanRootObservation).where(
                        PlanScanRootObservation.id == obs.id
                    )
                )
                await cleanup.commit()
