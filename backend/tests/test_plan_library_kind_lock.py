"""Plan & Prompt Library — the kind-lock fix (``plan_library_02_kind_lock``).

Cross-phase correctness fix for ``2026-08-10-plan-and-prompt-library-in-web``.

The bug under test
==================

Phase 1 made ``kind`` part of the artifact's IDENTITY. The plan simultaneously
requires that heuristics set an INITIAL kind only, and that a correction is
never overwritten by a later scan. Without ``kind_locked`` those two are
incompatible: a corrected row has a different identity, so the next runner
scan — which re-derives the heuristic kind from the filename/body — MISSES it
and inserts a SECOND row. Every corrected artifact silently forks.

``TestCorrectionSurvivesRescan`` is the core regression. It is written the way
the bug actually reproduces: correct the kind, then re-scan exactly as the
runner would (``kind_is_heuristic=True`` carrying the ORIGINAL guessed kind)
and assert the corpus still holds ONE row.

Layered like ``test_plan_library_api.py``: CRUD against the shared async
session, then the same behaviour over HTTP with auth/db overridden.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import work_artifact as crud
from app.models.work_artifact import WorkArtifact

API_PREFIX = "/api/v1/plan-library"

pytestmark = pytest.mark.asyncio


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


async def _upsert(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str,
    slug: str,
    body: str,
    source_repo: str | None = None,
    kind_is_heuristic: bool = False,
) -> tuple[WorkArtifact, bool, bool]:
    return await crud.upsert_artifact(
        db,
        org_id=org_id,
        user_id=None,
        kind=kind,
        slug=slug,
        title="t",
        status="VETTED",
        body=body,
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


async def _row_count(db: AsyncSession, org_id: UUID, slug: str) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(WorkArtifact)
                .where(
                    WorkArtifact.organization_id == org_id,
                    WorkArtifact.slug == slug,
                )
            )
        ).scalar_one()
    )


# ===========================================================================
# The core regression
# ===========================================================================


class TestCorrectionSurvivesRescan:
    async def test_corrected_kind_is_not_reforked_by_a_rescan(
        self, async_db_session: AsyncSession
    ) -> None:
        """THE bug: a corrected artifact must not fork on the next scan."""
        org = uuid4()
        slug = _slug("mislabelled")

        # 1. The scanner guesses `handoff` from the filename.
        scanned, created, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="handoff",
            slug=slug,
            body="# actually a plan",
            kind_is_heuristic=True,
        )
        assert created is True
        assert scanned.kind == "handoff"
        assert scanned.kind_locked is False, "a guess must stay correctable"

        # 2. An operator corrects it.
        corrected = await crud.set_artifact_kind(
            async_db_session, scanned, kind="plan", org_id=org
        )
        assert corrected.kind == "plan"
        assert corrected.kind_locked is True
        assert corrected.id == scanned.id

        # 3. The runner re-scans. It re-derives the SAME wrong heuristic kind
        #    and the body has moved on.
        rescanned, created_again, changed = await _upsert(
            async_db_session,
            org_id=org,
            kind="handoff",
            slug=slug,
            body="# actually a plan, revised",
            kind_is_heuristic=True,
        )

        assert created_again is False, "the re-scan must FIND the corrected row"
        assert changed is True
        assert rescanned.id == corrected.id
        assert rescanned.kind == "plan", "the correction must survive"
        assert rescanned.kind_locked is True
        assert rescanned.body == "# actually a plan, revised"
        assert await _row_count(async_db_session, org, slug) == 1, (
            "the corpus forked — this is exactly the failure the fix exists to prevent"
        )

    async def test_unchanged_body_rescan_also_finds_the_corrected_row(
        self, async_db_session: AsyncSession
    ) -> None:
        """The no-op path must resolve the same way (it is the common case)."""
        org = uuid4()
        slug = _slug("noop-rescan")
        body = "# stable"

        scanned, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="handoff",
            slug=slug,
            body=body,
            kind_is_heuristic=True,
        )
        await crud.set_artifact_kind(async_db_session, scanned, kind="plan", org_id=org)

        again, created, changed = await _upsert(
            async_db_session,
            org_id=org,
            kind="handoff",
            slug=slug,
            body=body,
            kind_is_heuristic=True,
        )
        assert (created, changed) == (False, False)
        assert again.kind == "plan"
        assert await _row_count(async_db_session, org, slug) == 1

    async def test_unlocked_row_lets_the_heuristic_move_the_kind(
        self, async_db_session: AsyncSession
    ) -> None:
        """Nobody corrected it, so a better guess IS allowed to win."""
        org = uuid4()
        slug = _slug("still-guessing")

        first, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="handoff",
            slug=slug,
            body="v1",
            kind_is_heuristic=True,
        )
        assert first.kind_locked is False

        second, created, changed = await _upsert(
            async_db_session,
            org_id=org,
            kind="plan",
            slug=slug,
            body="v2",
            kind_is_heuristic=True,
        )
        assert created is False
        assert changed is True
        assert second.id == first.id
        assert second.kind == "plan"
        assert second.kind_locked is False, "a guess never locks"
        assert await _row_count(async_db_session, org, slug) == 1

    async def test_explicit_write_locks_the_kind(
        self, async_db_session: AsyncSession
    ) -> None:
        """An operator/agent upsert asserts the kind — and that sticks."""
        org = uuid4()
        slug = _slug("explicit")

        row, created, _ = await _upsert(
            async_db_session, org_id=org, kind="plan", slug=slug, body="b"
        )
        assert created is True
        assert row.kind_locked is True

    async def test_explicit_write_locks_an_existing_unlocked_row(
        self, async_db_session: AsyncSession
    ) -> None:
        """Re-posting identical content still records the assertion.

        The digest is unchanged, so ``current_version`` does not move — but
        the lock is an assertion about IDENTITY, not content, and dropping it
        here would let the very next scan un-stick the correction.

        ``changed`` reads True here for a reason that is NOT the lock: the
        explicit write arrives through the ``agent`` door and the row was
        captured by ``runner_scan``, and since Phase 5 of
        ``2026-09-03-plan-library-write-door-nonce-authorized-and-body-sync-on-by-default``
        a metadata move on an unchanged body is stored and reported. The
        lock alone never flips ``changed`` — pinned below in
        :class:`TestMetadataOnUnchangedDigest`.
        """
        org = uuid4()
        slug = _slug("late-lock")
        body = "identical"

        scanned, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="plan",
            slug=slug,
            body=body,
            kind_is_heuristic=True,
        )
        assert scanned.kind_locked is False
        assert scanned.captured_by == "runner_scan"

        again, created, changed = await _upsert(
            async_db_session, org_id=org, kind="plan", slug=slug, body=body
        )
        assert created is False
        assert changed is True, "captured_by moved runner_scan -> agent"
        assert again.captured_by == "agent"
        assert again.current_version == 1
        assert again.kind_locked is True


# ===========================================================================
# Metadata on an unchanged digest (Phase 5 of
# 2026-09-03-plan-library-write-door-nonce-authorized-and-body-sync-on-by-default)
# ===========================================================================


class TestMetadataOnUnchangedDigest:
    """An accepted POST stores its metadata even when the body is already there.

    The version log is the BODY's history: an unchanged digest never bumps
    ``current_version`` or appends a snapshot. But ``title``, ``status``,
    ``repos``, ``work_unit_slug``, ``authored_at``, ``source_path`` and
    ``captured_by`` are the payload's description of the artifact, and a
    corrected one used to be silently dropped while the response claimed
    ``changed=false`` (finding 43479836). Both arms of the upsert — before and
    after the row lock — now write the same fields through one helper.
    """

    async def test_metadata_is_stored_and_reported_without_a_version(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        slug = _slug("meta")
        first, _, _ = await crud.upsert_artifact(
            async_db_session,
            org_id=org,
            user_id=None,
            kind="plan",
            slug=slug,
            title="first title",
            status="VETTED 2026-09-03",
            body="# body",
            source_path="plans/old.md",
            source_repo="qontinui-dev-notes/plans",
            work_unit_slug=None,
            repos=[],
            authored_at=None,
            captured_by="runner_scan",
            change_description=None,
            created_by="test",
            kind_is_heuristic=True,
        )
        touched_before = first.updated_at

        again, created, changed = await crud.upsert_artifact(
            async_db_session,
            org_id=org,
            user_id=None,
            kind="plan",
            slug=slug,
            title="corrected title",
            status="SHIPPED 2026-09-05",
            body="# body",
            source_path="plans/new.md",
            source_repo="qontinui-dev-notes/plans",
            work_unit_slug=slug,
            repos=["qontinui-web"],
            authored_at=None,
            captured_by="agent",
            change_description=None,
            created_by="test",
        )

        assert (created, changed) == (False, True)
        assert again.id == first.id
        assert again.current_version == 1, "metadata is not a version"
        assert len(await crud.list_versions(async_db_session, first.id)) == 1
        assert again.title == "corrected title"
        assert again.status == "SHIPPED 2026-09-05"
        assert again.source_path == "plans/new.md"
        assert again.work_unit_slug == slug
        assert again.repos == ["qontinui-web"]
        assert again.captured_by == "agent"
        assert again.updated_at > touched_before, "a metadata write is a touch"
        assert await _row_count(async_db_session, org, slug) == 1

    async def test_lock_alone_does_not_read_as_changed(
        self, async_db_session: AsyncSession
    ) -> None:
        """The kind lock is identity, not content or metadata."""
        org = uuid4()
        slug = _slug("lock-only")
        scanned, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="plan",
            slug=slug,
            body="same",
            kind_is_heuristic=True,
        )
        assert scanned.kind_locked is False

        # Identical metadata to what the scan wrote, explicit kind.
        again, created, changed = await crud.upsert_artifact(
            async_db_session,
            org_id=org,
            user_id=None,
            kind="plan",
            slug=slug,
            title="t",
            status="VETTED",
            body="same",
            source_path=None,
            source_repo=None,
            work_unit_slug=None,
            repos=[],
            authored_at=None,
            captured_by="runner_scan",
            change_description=None,
            created_by="test",
        )
        assert (created, changed) == (False, False)
        assert again.kind_locked is True

    async def test_identical_repost_moves_nothing(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        slug = _slug("identical")
        first, _, _ = await _upsert(
            async_db_session, org_id=org, kind="plan", slug=slug, body="same"
        )
        again, created, changed = await _upsert(
            async_db_session, org_id=org, kind="plan", slug=slug, body="same"
        )
        assert (created, changed) == (False, False)
        assert again.updated_at == first.updated_at

    async def test_http_changed_flag_and_unchanged_header_follow_the_metadata(
        self, client: httpx.AsyncClient
    ) -> None:
        """``X-Artifact-Unchanged`` is set from ``not changed`` — so it now
        means "this request moved nothing", not "the body was already here"."""
        payload = _payload(status="VETTED 2026-09-03")
        created = await client.post(API_PREFIX, json=payload)
        assert created.status_code == 201, created.text

        corrected = await client.post(
            API_PREFIX, json={**payload, "status": "SHIPPED 2026-09-05"}
        )
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["changed"] is True
        assert corrected.json()["artifact"]["status"] == "SHIPPED 2026-09-05"
        assert corrected.json()["artifact"]["current_version"] == 1
        assert "x-artifact-unchanged" not in corrected.headers

        identical = await client.post(
            API_PREFIX, json={**payload, "status": "SHIPPED 2026-09-05"}
        )
        assert identical.status_code == 200, identical.text
        assert identical.json()["changed"] is False
        assert identical.headers["x-artifact-unchanged"] == "true"


# ===========================================================================
# The ambiguous multi-match
# ===========================================================================


class TestAmbiguousResolution:
    async def test_two_unlocked_kinds_refuse_to_resolve(
        self, async_db_session: AsyncSession
    ) -> None:
        """A pre-existing fork must NOT be resolved by guessing.

        The two rows are inserted DIRECTLY rather than through the upsert:
        this is the corpus as it exists the moment
        ``plan_library_02_kind_lock`` runs, where every phase-1 row is backfilled
        ``kind_locked = false``. Going through the upsert cannot reproduce it
        (the very fix under test prevents the second row from being created),
        so the fixture has to be built the way history built it.
        """
        org = uuid4()
        slug = _slug("already-forked")

        rows = []
        for kind, body in (("handoff", "copy a"), ("plan", "copy b")):
            row = WorkArtifact(
                organization_id=org,
                kind=kind,
                kind_locked=False,
                slug=slug,
                title="t",
                status="VETTED",
                body=body,
                content_sha256=crud.compute_content_sha256(body),
                repos=[],
                captured_by="runner_scan",
                current_version=1,
            )
            async_db_session.add(row)
            rows.append(row)
        await async_db_session.commit()
        for row in rows:
            await async_db_session.refresh(row)
        assert await _row_count(async_db_session, org, slug) == 2

        with pytest.raises(crud.AmbiguousArtifactKind) as caught:
            await _upsert(
                async_db_session,
                org_id=org,
                kind="handoff",
                slug=slug,
                body="a scan that must not pick a winner",
                kind_is_heuristic=True,
            )

        assert set(caught.value.candidate_ids) == {rows[0].id, rows[1].id}
        assert caught.value.candidate_kinds == ["handoff", "plan"]
        assert caught.value.slug == slug

    async def test_the_rows_are_left_untouched_on_ambiguity(
        self, async_db_session: AsyncSession
    ) -> None:
        org = uuid4()
        slug = _slug("untouched")

        a, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="plan",
            slug=slug,
            body="a",
            kind_is_heuristic=True,
        )
        b, _, _ = await _upsert(
            async_db_session, org_id=org, kind="handoff", slug=slug, body="b"
        )
        # Both are locked? No — `a` came from a scan (unlocked), `b` from an
        # explicit write (locked). Lock `a` too so neither wins.
        await crud.set_artifact_kind(async_db_session, a, kind="plan", org_id=org)
        before = {a.id: a.content_sha256, b.id: b.content_sha256}

        with pytest.raises(crud.AmbiguousArtifactKind):
            await _upsert(
                async_db_session,
                org_id=org,
                kind="plan",
                slug=slug,
                body="should never land",
                kind_is_heuristic=True,
            )

        for row_id, digest in before.items():
            row = await crud.get_artifact(async_db_session, row_id, org_id=org)
            assert row is not None
            assert row.content_sha256 == digest, "an ambiguous scan wrote a row"

    async def test_a_single_locked_row_breaks_the_tie(
        self, async_db_session: AsyncSession
    ) -> None:
        """Exactly one corrected row IS an unambiguous winner."""
        org = uuid4()
        slug = _slug("one-locked")

        guessed, _, _ = await _upsert(
            async_db_session,
            org_id=org,
            kind="handoff",
            slug=slug,
            body="guess",
            kind_is_heuristic=True,
        )
        explicit, created, _ = await _upsert(
            async_db_session, org_id=org, kind="plan", slug=slug, body="explicit"
        )
        assert created is True
        assert explicit.kind_locked is True
        assert guessed.kind_locked is False

        resolved, created_again, changed = await _upsert(
            async_db_session,
            org_id=org,
            kind="handoff",
            slug=slug,
            body="a fresh scan",
            kind_is_heuristic=True,
        )
        assert created_again is False
        assert changed is True
        assert resolved.id == explicit.id
        assert resolved.kind == "plan"
        assert await _row_count(async_db_session, org, slug) == 2


class TestKindForkVisibility:
    async def test_divergent_read_surfaces_the_kind_fork(
        self, async_db_session: AsyncSession
    ) -> None:
        """The fork the scanner refused to resolve must be discoverable.

        ``find_divergent`` groups by ``(kind, slug)`` and structurally cannot
        see a fork whose distinguishing feature IS the kind, so the kind-fork
        read is a separate one.
        """
        org = uuid4()
        slug = _slug("fork-visible")

        await _upsert(
            async_db_session,
            org_id=org,
            kind="plan",
            slug=slug,
            body="a",
            kind_is_heuristic=True,
        )
        await _upsert(async_db_session, org_id=org, kind="handoff", slug=slug, body="b")

        forks = await crud.find_kind_forks(async_db_session, org_id=org)
        assert len(forks) == 1
        fork_slug, source_repo, variants = forks[0]
        assert fork_slug == slug
        assert source_repo is None
        assert sorted(v.kind for v in variants) == ["handoff", "plan"]
        # Exactly one is locked (the explicit write) → the scanner can heal it.
        assert sum(1 for v in variants if v.kind_locked) == 1

    async def test_no_fork_means_no_group(self, async_db_session: AsyncSession) -> None:
        org = uuid4()
        await _upsert(
            async_db_session, org_id=org, kind="plan", slug=_slug("clean"), body="x"
        )
        assert await crud.find_kind_forks(async_db_session, org_id=org) == []


# ===========================================================================
# HTTP
# ===========================================================================


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    # Both Cognito dependencies. ``PATCH /{id}/kind`` is the one route still on
    # the strict ``current_active_user`` (Cognito-only by design — the lock
    # exists to overrule the runner scan), while the upserts these tests drive
    # around it go through the dual-auth ``get_audit_actor_user``. See the
    # fuller note in ``tests/test_plan_library_api.py``.
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
        email=f"kindlock_{uuid4().hex[:8]}@example.com",
        username=f"kindlock_{uuid4().hex[:8]}",
        full_name="Kind Lock Tester",
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
        "slug": _slug("http-kind"),
        "title": "HTTP plan",
        "status": "VETTED",
        "body": "# plan body",
    }
    body.update(overrides)
    return body


class TestKindLockOverHttp:
    async def test_patch_kind_corrects_and_locks(
        self, client: httpx.AsyncClient
    ) -> None:
        created = await client.post(
            API_PREFIX, json=_payload(kind="handoff", kind_is_heuristic=True)
        )
        assert created.status_code == 201, created.text
        artifact = created.json()["artifact"]
        assert artifact["kind"] == "handoff"
        assert artifact["kind_locked"] is False

        patched = await client.patch(
            f"{API_PREFIX}/{artifact['id']}/kind", json={"kind": "plan"}
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["kind"] == "plan"
        assert patched.json()["kind_locked"] is True

        detail = await client.get(f"{API_PREFIX}/{artifact['id']}")
        assert detail.json()["kind"] == "plan"
        assert detail.json()["kind_locked"] is True

    async def test_patch_kind_rejects_an_unknown_kind(
        self, client: httpx.AsyncClient
    ) -> None:
        artifact = (await client.post(API_PREFIX, json=_payload())).json()["artifact"]
        resp = await client.patch(
            f"{API_PREFIX}/{artifact['id']}/kind", json={"kind": "not_a_kind"}
        )
        assert resp.status_code == 422

    async def test_patch_kind_on_a_missing_artifact_is_404(
        self, client: httpx.AsyncClient
    ) -> None:
        resp = await client.patch(f"{API_PREFIX}/{uuid4()}/kind", json={"kind": "plan"})
        assert resp.status_code == 404

    async def test_correction_then_rescan_over_http(
        self, client: httpx.AsyncClient
    ) -> None:
        """The end-to-end regression, through the real routes."""
        slug = _slug("http-rescan")
        scanned = await client.post(
            API_PREFIX,
            json=_payload(
                slug=slug,
                kind="handoff",
                body="# v1",
                kind_is_heuristic=True,
                captured_by="runner_scan",
            ),
        )
        assert scanned.status_code == 201, scanned.text
        artifact_id = scanned.json()["artifact"]["id"]

        patched = await client.patch(
            f"{API_PREFIX}/{artifact_id}/kind", json={"kind": "plan"}
        )
        assert patched.status_code == 200

        rescan = await client.post(
            API_PREFIX,
            json=_payload(
                slug=slug,
                kind="handoff",
                body="# v2",
                kind_is_heuristic=True,
                captured_by="runner_scan",
            ),
        )
        assert rescan.status_code == 200, rescan.text
        assert rescan.json()["created"] is False
        assert rescan.json()["artifact"]["id"] == artifact_id
        assert rescan.json()["artifact"]["kind"] == "plan"

        listed = await client.get(API_PREFIX, params={"limit": 200})
        matching = [i for i in listed.json()["items"] if i["slug"] == slug]
        assert len(matching) == 1, "the corpus forked over HTTP"

    async def test_ambiguous_rescan_is_a_structured_409(
        self, client: httpx.AsyncClient
    ) -> None:
        slug = _slug("http-ambiguous")
        first = await client.post(
            API_PREFIX,
            json=_payload(slug=slug, kind="plan", body="a", kind_is_heuristic=True),
        )
        assert first.status_code == 201
        second = await client.post(
            API_PREFIX, json=_payload(slug=slug, kind="handoff", body="b")
        )
        assert second.status_code == 201

        # Lock the first too, so neither is the single locked winner.
        lock = await client.patch(
            f"{API_PREFIX}/{first.json()['artifact']['id']}/kind",
            json={"kind": "plan"},
        )
        assert lock.status_code == 200

        conflict = await client.post(
            API_PREFIX,
            json=_payload(
                slug=slug, kind="plan", body="must not land", kind_is_heuristic=True
            ),
        )
        assert conflict.status_code == 409, conflict.text
        detail = conflict.json()["detail"]
        assert detail["error"] == "ambiguous_kind_resolution"
        assert detail["slug"] == slug
        assert set(detail["candidate_ids"]) == {
            first.json()["artifact"]["id"],
            second.json()["artifact"]["id"],
        }
        assert detail["candidate_kinds"] == ["handoff", "plan"]

        # And the fork is discoverable rather than silently resolved.
        divergent = await client.get(f"{API_PREFIX}/divergent")
        assert divergent.status_code == 200, divergent.text
        forks = [g for g in divergent.json()["kind_forks"] if g["slug"] == slug]
        assert len(forks) == 1
        assert forks[0]["kinds"] == ["handoff", "plan"]
        assert forks[0]["resolvable"] is False

    async def test_patch_kind_onto_an_occupied_identity_is_409(
        self, client: httpx.AsyncClient
    ) -> None:
        slug = _slug("http-occupied")
        a = (
            await client.post(API_PREFIX, json=_payload(slug=slug, kind="plan"))
        ).json()["artifact"]
        b = (
            await client.post(
                API_PREFIX, json=_payload(slug=slug, kind="handoff", body="b")
            )
        ).json()["artifact"]

        resp = await client.patch(f"{API_PREFIX}/{b['id']}/kind", json={"kind": "plan"})
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["error"] == "kind_identity_conflict"
        assert resp.json()["detail"]["existing_id"] == a["id"]
