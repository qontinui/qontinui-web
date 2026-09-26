"""Documents, wiki and files — the Phase 2 resources, end to end against Postgres.

Phase 2 of ``2026-09-20-overview-authoring-layer``. Pins:

* **pages**: the contract (If-Match, 409 with the server's copy, idempotent
  create), a version per write, reading and reverting versions, wiki links and
  related documents as backlinks (including to a page written later), search,
  script-preserving slugs, and tenant isolation.
* **files**: the type allowlist confirmed against the bytes, the per-file and
  per-project caps, filename cleaning, attaching to a document, an
  authenticated download served as an attachment, delete removing the stored
  bytes only after the commit, and tenant isolation.

As in ``test_overview_authoring.py``, only the coord caller is stubbed.
"""

from __future__ import annotations

import io
import zipfile
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-0000000000d1")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-0000000000d2")


# ===========================================================================
# Harness
# ===========================================================================


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"docs_{uuid4().hex[:8]}@example.com",
        username=f"docs_{uuid4().hex[:8]}",
        full_name="Docs Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


def _app(db: AsyncSession, user, tenant: UUID, roles: tuple[str, ...]) -> FastAPI:
    from app.api.deps import current_active_user, get_async_db
    from app.api.v1.endpoints.overview import router as overview_router
    from app.middleware.security_headers import SecurityHeadersMiddleware
    from app.overview.permissions import OverviewCaller, get_overview_caller
    from app.overview.router import router as authoring_router

    app = FastAPI()
    # As in production, so a route's own headers are tested against it.
    app.add_middleware(SecurityHeadersMiddleware)
    app.dependency_overrides[current_active_user] = lambda: user

    async def _db():
        yield db

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
        tenant_id=tenant, roles=roles
    )
    app.include_router(overview_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Overview-Source": "ui"},
    )


@pytest_asyncio.fixture()
async def admin(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_A, ("admin",))) as c:
        yield c


@pytest_asyncio.fixture()
async def operator(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_A, ("operator",))) as c:
        yield c


@pytest_asyncio.fixture()
async def other_project(async_db_session, api_user):
    async with _client(_app(async_db_session, api_user, TENANT_B, ("admin",))) as c:
        yield c


async def _page(client: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    payload = {"kind": "document", "title": "Delivery plan", "body_md": "# Plan"}
    payload.update(body)
    response = await client.post(f"{API}/pages", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["item"]


async def _log(db: AsyncSession, resource: str) -> list[Any]:
    from app.models.overview import ChangeLog

    rows = await db.execute(
        select(ChangeLog)
        .where(ChangeLog.tenant_id == TENANT_A, ChangeLog.resource == resource)
        .order_by(ChangeLog.created_at)
    )
    return list(rows.scalars().all())


# ===========================================================================
# Slugs and links (pure)
# ===========================================================================


class TestSlugs:
    async def test_titles_fold_to_one_slug_in_any_script(self) -> None:
        from app.overview.pages import slugify

        assert slugify("Café — Q4 Launch!") == "cafe-q4-launch"
        assert slugify("Видение проекта") == "видение-проекта"
        assert slugify("snake_case  title") == "snake-case-title"
        assert slugify("***") == ""

    async def test_wiki_links_are_read_once_each_in_order(self) -> None:
        from app.overview.pages import wiki_targets

        body = "See [[Getting Started]], [[Budget|the budget]] and [[getting started]]. [[***]]"
        assert wiki_targets(body) == ["getting-started", "budget"]


# ===========================================================================
# Pages
# ===========================================================================


class TestPages:
    async def test_create_derives_the_slug_and_records_version_one(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        from app.models.overview import PageVersion

        page = await _page(admin, title="Delivery Plan v0.1", doc_number="DP-001")
        assert page["slug"] == "delivery-plan-v0-1"
        assert page["version"] == 1 and page["body_md"] == "# Plan"
        versions = (
            (
                await async_db_session.execute(
                    select(PageVersion).where(PageVersion.page_id == UUID(page["id"]))
                )
            )
            .scalars()
            .all()
        )
        assert [v.version for v in versions] == [1]
        (row,) = await _log(async_db_session, "pages")
        # The body lives in page_versions; the change log does not copy it.
        assert "body_md" not in row.after and row.after["doc_number"] == "DP-001"

    async def test_each_write_is_a_version_and_any_can_be_read(
        self, admin: httpx.AsyncClient
    ) -> None:
        page = await _page(admin)
        url = f"{API}/pages/{page['id']}"
        edited = await admin.patch(
            url, json={"body_md": "# Plan\n\nRevised."}, headers={"If-Match": '"1"'}
        )
        assert edited.status_code == 200 and edited.headers["ETag"] == '"2"'
        listing = (await admin.get(f"{url}/versions")).json()
        assert [v["version"] for v in listing["versions"]] == [2, 1]
        v1 = (await admin.get(f"{url}/versions/1")).json()
        assert v1["body_md"] == "# Plan"

    async def test_a_stale_write_is_refused_with_the_servers_copy(
        self, admin: httpx.AsyncClient
    ) -> None:
        page = await _page(admin)
        url = f"{API}/pages/{page['id']}"
        await admin.patch(url, json={"title": "Plan B"}, headers={"If-Match": '"1"'})
        stale = await admin.patch(
            url, json={"title": "Plan C"}, headers={"If-Match": '"1"'}
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["title"] == "Plan B"

    async def test_revert_writes_a_new_version_copying_the_old_one(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        page = await _page(admin)
        url = f"{API}/pages/{page['id']}"
        await admin.patch(url, json={"body_md": "wrong"}, headers={"If-Match": '"1"'})
        reverted = await admin.post(
            f"{url}/versions/1/revert", headers={"If-Match": '"2"'}
        )
        assert reverted.status_code == 200, reverted.text
        item = reverted.json()["item"]
        assert item["version"] == 3 and item["body_md"] == "# Plan"
        rows = await _log(async_db_session, "pages")
        assert rows[-1].after["reverted_to_version"] == 1
        # A stale revert is refused like any write.
        stale = await admin.post(
            f"{url}/versions/1/revert", headers={"If-Match": '"2"'}
        )
        assert stale.status_code == 409

    async def test_a_list_carries_no_bodies_and_a_get_does(
        self, admin: httpx.AsyncClient
    ) -> None:
        page = await _page(admin, body_md="# Plan\n\n" + "word " * 100)
        listed = (await admin.get(f"{API}/pages", params={"kind": "document"})).json()
        (item,) = listed["items"]
        assert item["body_md"] is None and item["excerpt"].startswith("# Plan")
        got = (await admin.get(f"{API}/pages/{page['id']}")).json()["item"]
        assert got["body_md"].startswith("# Plan")

    async def test_wiki_links_become_backlinks_even_to_pages_written_later(
        self, admin: httpx.AsyncClient
    ) -> None:
        linking = await _page(
            admin, kind="wiki", title="Home", body_md="Start at [[Getting Started]]."
        )
        target = await _page(admin, kind="wiki", title="Getting Started", body_md="Hi")
        backlinks = (await admin.get(f"{API}/pages/{target['id']}/backlinks")).json()
        assert [b["id"] for b in backlinks] == [linking["id"]]

    async def test_related_documents_are_backlinks_too(
        self, admin: httpx.AsyncClient
    ) -> None:
        other = await _page(admin, title="Contract")
        plan = await _page(admin, title="Plan", related=["Contract", "plan"])
        assert plan["related"] == ["contract"]  # itself dropped
        backlinks = (await admin.get(f"{API}/pages/{other['id']}/backlinks")).json()
        assert [b["slug"] for b in backlinks] == ["plan"]

    async def test_related_order_is_not_a_change(
        self, admin: httpx.AsyncClient
    ) -> None:
        page = await _page(admin, title="Plan", related=["Zeta", "Alpha"])
        assert page["related"] == ["alpha", "zeta"]
        same = await admin.patch(
            f"{API}/pages/{page['id']}",
            json={"related": ["zeta", "alpha"]},
            headers={"If-Match": '"1"'},
        )
        assert same.status_code == 200 and same.json()["item"]["version"] == 1

    async def test_a_link_in_another_script_resolves(
        self, admin: httpx.AsyncClient
    ) -> None:
        home = await _page(admin, kind="wiki", title="Главная", body_md="[[Видение]]")
        target = await _page(admin, kind="wiki", title="Видение")
        assert target["slug"] == "видение"
        found = (
            await admin.get(f"{API}/pages", params={"kind": "wiki", "slug": "видение"})
        ).json()
        assert [p["id"] for p in found["items"]] == [target["id"]]
        backlinks = (await admin.get(f"{API}/pages/{target['id']}/backlinks")).json()
        assert [b["id"] for b in backlinks] == [home["id"]]

    async def test_search_matches_words_in_the_body_and_part_of_a_title(
        self, admin: httpx.AsyncClient
    ) -> None:
        await _page(admin, title="Budget", body_md="Licences for twelve seats.")
        await _page(admin, title="Onboarding", body_md="Nothing relevant.")
        by_body = (await admin.get(f"{API}/pages", params={"q": "licences"})).json()
        assert [p["title"] for p in by_body["items"]] == ["Budget"]
        by_prefix = (await admin.get(f"{API}/pages", params={"q": "onboar"})).json()
        assert [p["title"] for p in by_prefix["items"]] == ["Onboarding"]

    async def test_a_taken_slug_is_a_409_and_a_keyed_retry_replays(
        self, admin: httpx.AsyncClient
    ) -> None:
        body = {"kind": "document", "title": "Plan", "body_md": "x"}
        first = await admin.post(
            f"{API}/pages", json=body, headers={"Idempotency-Key": "k1"}
        )
        assert first.status_code == 201
        retry = await admin.post(
            f"{API}/pages", json=body, headers={"Idempotency-Key": "k1"}
        )
        assert (
            retry.status_code == 200 and retry.headers["Idempotent-Replayed"] == "true"
        )
        clash = await admin.post(f"{API}/pages", json=body)
        assert clash.status_code == 409 and clash.json()["error"] == "name_taken"

    async def test_a_document_and_a_wiki_page_may_share_a_slug(
        self, admin: httpx.AsyncClient
    ) -> None:
        await _page(admin, kind="document", title="Budget")
        await _page(admin, kind="wiki", title="Budget")

    @pytest.mark.parametrize(
        "body",
        [
            {"kind": "slides", "title": "Deck"},
            {"kind": "document", "title": "***"},
            {"kind": "document", "title": "   "},
            {"kind": "wiki", "title": "W", "related": ["x"]},
            {"kind": "document", "title": "T", "body_md": "x" * 500_001},
        ],
    )
    async def test_invalid_pages_are_422(
        self, admin: httpx.AsyncClient, body: dict[str, Any]
    ) -> None:
        response = await admin.post(f"{API}/pages", json=body)
        assert response.status_code == 422, response.text

    async def test_title_and_body_cannot_be_cleared(
        self, admin: httpx.AsyncClient
    ) -> None:
        page = await _page(admin)
        for patch in ({"title": None}, {"body_md": None}, {}):
            response = await admin.patch(
                f"{API}/pages/{page['id']}", json=patch, headers={"If-Match": '"1"'}
            )
            assert response.status_code == 422, patch

    async def test_delete_takes_the_history_and_logs_the_body(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        page = await _page(admin, body_md="Keep me in the log")
        url = f"{API}/pages/{page['id']}"
        assert (await admin.delete(url, headers={"If-Match": '"1"'})).status_code == 204
        assert (await admin.get(url)).status_code == 404
        assert (await admin.get(f"{url}/versions")).status_code == 404
        rows = await _log(async_db_session, "pages")
        assert rows[-1].action == "delete"
        assert rows[-1].before["body_md"] == "Keep me in the log"

    async def test_an_operator_reads_but_cannot_write(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        page = await _page(admin)
        assert (await operator.get(f"{API}/pages/{page['id']}")).status_code == 200
        denied = await operator.post(
            f"{API}/pages", json={"kind": "wiki", "title": "Mine"}
        )
        assert denied.status_code == 403
        await admin.put(
            f"{API}/settings", json={"editing_roles": ["admin", "operator"]}
        )
        allowed = await operator.post(
            f"{API}/pages", json={"kind": "wiki", "title": "Mine"}
        )
        assert allowed.status_code == 201

    async def test_another_project_sees_nothing(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        page = await _page(admin)
        url = f"{API}/pages/{page['id']}"
        assert (await other_project.get(f"{API}/pages")).json()["items"] == []
        for response in (
            await other_project.get(url),
            await other_project.get(f"{url}/versions"),
            await other_project.get(f"{url}/versions/1"),
            await other_project.get(f"{url}/backlinks"),
            await other_project.patch(
                url, json={"title": "x"}, headers={"If-Match": '"1"'}
            ),
            await other_project.post(
                f"{url}/versions/1/revert", headers={"If-Match": '"1"'}
            ),
            await other_project.delete(url, headers={"If-Match": '"1"'}),
        ):
            assert response.status_code == 404, response.text


# ===========================================================================
# Files
# ===========================================================================

PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _ooxml(folder: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr(f"{folder}document.xml", "<doc/>")
    return buf.getvalue()


async def _upload(
    client: httpx.AsyncClient,
    name: str,
    data: bytes,
    *,
    page_id: str | None = None,
    key: str | None = None,
) -> httpx.Response:
    files = {"file": (name, data, "application/octet-stream")}
    form = {"page_id": page_id} if page_id else None
    headers = {"Idempotency-Key": key} if key else None
    return await client.post(f"{API}/files", files=files, data=form, headers=headers)


class TestFiles:
    async def test_an_upload_is_typed_by_the_allowlist_and_downloads_as_an_attachment(
        self, admin: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        import hashlib

        response = await _upload(admin, "Contract.pdf", PDF)
        assert response.status_code == 201, response.text
        item = response.json()["item"]
        assert item["content_type"] == "application/pdf"
        assert item["sha256"] == hashlib.sha256(PDF).hexdigest()
        assert item["size_bytes"] == len(PDF)
        assert item["download_path"] == f"{API}/files/{item['id']}/content"
        body = await admin.get(item["download_path"])
        assert body.status_code == 200
        assert body.content == PDF
        assert body.headers["content-disposition"].startswith("attachment;")
        assert body.headers["x-content-type-options"] == "nosniff"
        # The route's sandboxing policy survives the app-wide middleware.
        csp = body.headers["content-security-policy"]
        assert "default-src 'none'" in csp and "sandbox" in csp
        # Passed through, never gzipped, and sized.
        assert body.headers["content-encoding"] == "identity"
        assert body.headers["content-length"] == str(len(PDF))
        (row,) = await _log(async_db_session, "files")
        assert row.action == "create" and row.source == "ui"

    async def test_images_alone_may_be_shown_inline(
        self, admin: httpx.AsyncClient
    ) -> None:
        png = (await _upload(admin, "diagram.png", PNG)).json()["item"]
        pdf = (await _upload(admin, "doc.pdf", PDF)).json()["item"]
        shown = await admin.get(
            f"{API}/files/{png['id']}/content", params={"inline": 1}
        )
        assert shown.headers["content-disposition"].startswith("inline;")
        forced = await admin.get(
            f"{API}/files/{pdf['id']}/content", params={"inline": 1}
        )
        assert forced.headers["content-disposition"].startswith("attachment;")

    @pytest.mark.parametrize(
        ("name", "data", "error"),
        [
            ("tool.exe", b"MZ\x90\x00", "unsupported_type"),
            ("renamed.pdf", b"MZ\x90\x00this is not a pdf", "content_mismatch"),
            ("sheet.docx", _ooxml("xl/"), "content_mismatch"),
            ("notes.md", b"\xff\xfe\x00binary", "content_mismatch"),
            ("noextension", PDF, "unsupported_type"),
        ],
    )
    async def test_a_file_must_be_what_its_name_says(
        self, admin: httpx.AsyncClient, name: str, data: bytes, error: str
    ) -> None:
        response = await _upload(admin, name, data)
        assert response.status_code == 415, response.text
        assert response.json()["detail"]["error"] == error

    async def test_office_files_are_recognised(self, admin: httpx.AsyncClient) -> None:
        for name, folder in (
            ("a.docx", "word/"),
            ("b.xlsx", "xl/"),
            ("c.pptx", "ppt/"),
        ):
            response = await _upload(admin, name, _ooxml(folder))
            assert response.status_code == 201, (name, response.text)

    async def test_an_oversized_file_is_refused_without_storing_it(
        self, admin: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.overview import files

        monkeypatch.setattr(files, "MAX_FILE_BYTES", 16)
        response = await _upload(admin, "big.pdf", PDF)
        assert response.status_code == 413
        assert response.json()["detail"]["error"] == "file_too_large"
        assert (await admin.get(f"{API}/files")).json()["items"] == []

    async def test_the_project_quota_is_enforced(
        self, admin: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.overview import files

        monkeypatch.setattr(files, "MAX_PROJECT_BYTES", len(PDF) + 10)
        assert (await _upload(admin, "one.pdf", PDF)).status_code == 201
        full = await _upload(admin, "two.pdf", PDF)
        assert full.status_code == 413
        assert full.json()["detail"]["error"] == "project_storage_full"

    async def test_a_path_in_the_filename_is_dropped(
        self, admin: httpx.AsyncClient
    ) -> None:
        response = await _upload(admin, "../../etc/passwd.pdf", PDF)
        assert response.json()["item"]["filename"] == "passwd.pdf"

    async def test_filenames_lose_control_characters_and_keep_their_extension(
        self,
    ) -> None:
        # Pure: a multipart client percent-encodes control characters, so the
        # upload path cannot deliver one to pin this.
        from app.overview.files import MAX_FILENAME, clean_filename

        assert clean_filename("..\\a\\pass\x01wd\x7f.pdf") == "passwd.pdf"
        # A right-to-left override would show "report‮fdp.exe" as "...exe.pdf".
        assert clean_filename("report\u202efdp.exe") == "reportfdp.exe"
        long = clean_filename("x" * 400 + ".docx")
        assert len(long) == MAX_FILENAME and long.endswith(".docx")

    async def test_attaching_to_a_document_and_listing_by_it(
        self, admin: httpx.AsyncClient
    ) -> None:
        page = await _page(admin)
        attached = await _upload(admin, "a.pdf", PDF, page_id=page["id"])
        assert attached.status_code == 201
        await _upload(admin, "loose.pdf", PDF)
        listed = (
            await admin.get(f"{API}/files", params={"page_id": page["id"]})
        ).json()
        assert [f["filename"] for f in listed["items"]] == ["a.pdf"]

    async def test_a_file_cannot_be_attached_to_another_projects_document(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        page = await _page(admin)
        response = await _upload(other_project, "a.pdf", PDF, page_id=page["id"])
        assert response.status_code == 404

    async def test_a_keyed_retry_replays_the_upload(
        self, admin: httpx.AsyncClient
    ) -> None:
        first = await _upload(admin, "a.pdf", PDF, key="u-1")
        again = await _upload(admin, "a.pdf", PDF, key="u-1")
        assert again.status_code == 200
        assert again.json()["item"]["id"] == first.json()["item"]["id"]
        assert len((await admin.get(f"{API}/files")).json()["items"]) == 1

    async def test_delete_removes_the_row_then_the_stored_bytes(
        self, admin: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.overview import files

        removed: list[str] = []
        original = files.object_storage.delete_file

        def spy(key: str) -> bool:
            removed.append(key)
            return original(key)

        monkeypatch.setattr(files.object_storage, "delete_file", spy)
        item = (await _upload(admin, "a.pdf", PDF)).json()["item"]
        url = f"{API}/files/{item['id']}"
        assert (await admin.delete(url, headers={"If-Match": '"1"'})).status_code == 204
        assert (await admin.get(url)).status_code == 404
        assert (await admin.get(f"{url}/content")).status_code == 404
        assert len(removed) == 1

    async def test_another_project_cannot_list_read_or_download(
        self, admin: httpx.AsyncClient, other_project: httpx.AsyncClient
    ) -> None:
        item = (await _upload(admin, "a.pdf", PDF)).json()["item"]
        assert (await other_project.get(f"{API}/files")).json()["items"] == []
        for response in (
            await other_project.get(f"{API}/files/{item['id']}"),
            await other_project.get(f"{API}/files/{item['id']}/content"),
            await other_project.delete(
                f"{API}/files/{item['id']}", headers={"If-Match": '"1"'}
            ),
        ):
            assert response.status_code == 404

    async def test_an_operator_downloads_but_cannot_upload(
        self, admin: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        item = (await _upload(admin, "a.pdf", PDF)).json()["item"]
        assert (
            await operator.get(f"{API}/files/{item['id']}/content")
        ).status_code == 200
        assert (await _upload(operator, "b.pdf", PDF)).status_code == 403

    async def test_a_racing_upload_under_the_same_key_is_answered_as_a_replay(
        self, admin: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The race: the second request's replay lookup ran before the first
        # committed. Forced here by hiding the first upload from that lookup.
        from app.overview import change_log, files

        first = await _upload(admin, "a.pdf", PDF, key="race-1")
        real = change_log.find_by_idempotency_key
        calls = 0

        async def late(*args: Any, **kwargs: Any) -> Any:
            nonlocal calls
            calls += 1
            return None if calls == 1 else await real(*args, **kwargs)

        removed: list[str] = []
        original = files.object_storage.delete_file

        def spy(key: str) -> bool:
            removed.append(key)
            return original(key)

        monkeypatch.setattr(change_log, "find_by_idempotency_key", late)
        monkeypatch.setattr(files.object_storage, "delete_file", spy)
        again = await _upload(admin, "a.pdf", PDF, key="race-1")
        assert again.status_code == 200, again.text
        assert again.headers["idempotent-replayed"] == "true"
        assert again.json()["item"]["id"] == first.json()["item"]["id"]
        # The loser's stored bytes were taken back.
        assert len(removed) == 1


# ===========================================================================
# The upload body cap (middleware)
# ===========================================================================


class TestBodyLimit:
    def _app(self, reached: list[bool]) -> FastAPI:
        from app.middleware.body_limit import BodyLimit, BodyLimitMiddleware

        app = FastAPI()

        @app.post("/up")
        async def up(file: UploadFile) -> dict[str, int]:
            reached.append(True)
            return {"size": len(await file.read())}

        app.add_middleware(
            BodyLimitMiddleware,
            limits={("POST", "/up"): BodyLimit(300, "file_too_large", "Too big.")},
        )
        return app

    async def test_a_declared_length_over_the_cap_is_refused_unread(self) -> None:
        reached: list[bool] = []
        transport = httpx.ASGITransport(app=self._app(reached))
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            small = await c.post("/up", files={"file": ("a.txt", b"x" * 10)})
            big = await c.post("/up", files={"file": ("a.txt", b"x" * 1000)})
        assert small.status_code == 200
        assert big.status_code == 413
        assert big.json()["detail"]["error"] == "file_too_large"
        assert reached == [True]

    async def test_an_undeclared_length_is_counted_as_it_arrives(self) -> None:
        reached: list[bool] = []
        boundary = "b0undary"
        head = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
            'filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n'
        ).encode()

        async def chunked():
            yield head
            for _ in range(10):
                yield b"x" * 100

        transport = httpx.ASGITransport(app=self._app(reached))
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            response = await c.post(
                "/up",
                content=chunked(),
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            )
        assert response.status_code == 413
        assert response.json()["detail"]["error"] == "file_too_large"
        assert reached == []
