"""Plan & Prompt Library — the export routes (DB → markdown).

Phase 4 of ``2026-08-16-plan-corpus-authority-and-run-provenance``.

The export exists to pay for design decision D2. Making the DB authoritative for
reads silently drops the distributed durability git gave for free — git keeps N
copies, a database keeps one plus whatever backups exist — and before this phase
there was **no export path at all** (zero markdown-emitting exporters across
qontinui-coord and this backend, verified at vet). D5 calls the replacement
non-optional, so these tests treat it as load-bearing rather than convenience.

What is actually asserted, and why each one matters:

* **Byte-verbatim bodies.** The phase's own gate is a round trip: export a plan,
  re-scan it, and its ``content_sha256`` must be unchanged. Any transformation —
  a re-rendered status block, normalized headings, a stripped trailing newline —
  breaks that, so the tests compare BYTES and recompute the digest rather than
  eyeballing the text.
* **Provenance travels beside the bytes, never inside them.** Headers and
  ``manifest.json`` carry it. A test that only checked "the body is in there"
  would pass on an implementation that also injected a header comment.
* **Version addressing.** ``?version_number=`` reaches the shipped version log,
  and a bad one is a 404 that NAMES what exists.
* **Truncation is reported.** A bulk export that stopped at N reads exactly like
  a corpus of N. ``X-Export-Truncated`` must be present on BOTH branches.
* **Divergent same-slug artifacts BOTH survive the archive.** D7 keeps both
  copies of a forked plan deliberately; six such forks exist in this fleet's
  corpus. An archive that collapsed them onto one entry would silently discard
  the exact divergence an operator is meant to review.
* **Org scoping.** Export is a read, and a read that leaks across the
  organization boundary is a read that should not have shipped.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import work_artifact as crud

from .test_plan_library_api import _build_app, _slug, _upsert

API_PREFIX = "/api/v1/plan-library"

pytestmark = pytest.mark.asyncio


# A body chosen to break a naive implementation: CRLF, a trailing blank line,
# non-ASCII, a fenced block and markdown that a "helpful" renderer would want to
# normalize. If the export is genuinely verbatim, none of it matters.
TRICKY_BODY = (
    "# Plan: corpus authority\r\n"
    "\r\n"
    "> **Status: VETTED 2026-08-16.** Ünïcödé — em dash, ≥, ✔.\r\n"
    "\r\n"
    "## Phases\r\n"
    "\r\n"
    "```bash\r\n"
    "echo 'trailing spaces below'   \r\n"
    "```\r\n"
    "\r\n"
    "\r\n"
)


async def _make(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    body: str,
    kind: str = "plan",
    title: str = "A plan",
    status: str = "VETTED",
    source_repo: str | None = None,
):
    """Create/update one artifact through the SAME helper the API tests use.

    Reusing ``_upsert`` rather than calling ``crud.upsert_artifact`` directly
    keeps the version-append behaviour these tests depend on identical to what
    the rest of the suite exercises.
    """
    row, _, _ = await _upsert(
        db,
        org_id=org_id,
        kind=kind,
        slug=slug,
        title=title,
        status=status,
        body=body,
        source_repo=source_repo,
    )
    await db.commit()
    return row


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"planexp_{uuid4().hex[:8]}@example.com",
        username=f"planexp_{uuid4().hex[:8]}",
        full_name="Plan Export Tester",
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


# ───────────────────────── single-artifact export ─────────────────────────


class TestSingleExport:
    async def test_body_is_byte_verbatim_and_digest_round_trips(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        """THE Phase 4 gate: what comes out re-hashes to what went in.

        Compared as bytes, and the digest is recomputed here rather than trusted
        from the header — otherwise a broken export that also reported a broken
        digest would agree with itself and pass.
        """
        row = await _make(
            async_db_session, org_id=None, slug=_slug("verbatim"), body=TRICKY_BODY
        )

        resp = await client.get(f"{API_PREFIX}/{row.id}/export")
        assert resp.status_code == 200
        assert resp.content == TRICKY_BODY.encode("utf-8")
        assert hashlib.sha256(resp.content).hexdigest() == row.content_sha256
        assert resp.headers["x-content-sha256"] == row.content_sha256
        assert crud.compute_content_sha256(resp.text) == row.content_sha256

    async def test_provenance_is_in_headers_not_in_the_body(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        """A "helpful" injected header comment would break the round trip."""
        slug = _slug("headers")
        row = await _make(
            async_db_session, org_id=None, slug=slug, body="# just this\n"
        )

        resp = await client.get(f"{API_PREFIX}/{row.id}/export")
        assert resp.status_code == 200
        assert resp.text == "# just this\n"
        assert resp.headers["x-artifact-kind"] == "plan"
        assert resp.headers["x-artifact-slug"] == slug
        assert resp.headers["x-artifact-version"] == str(row.current_version)
        assert "text/markdown" in resp.headers["content-type"]
        assert slug in resp.headers["content-disposition"]

    async def test_version_number_reaches_the_shipped_version_log(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        slug = _slug("versioned")
        await _make(async_db_session, org_id=None, slug=slug, body="v1 body\n")
        row = await _make(async_db_session, org_id=None, slug=slug, body="v2 body\n")
        assert row.current_version >= 2

        head = await client.get(f"{API_PREFIX}/{row.id}/export")
        assert head.text == "v2 body\n"

        old = await client.get(f"{API_PREFIX}/{row.id}/export?version_number=1")
        assert old.status_code == 200
        assert old.text == "v1 body\n"
        assert old.headers["x-artifact-version"] == "1"
        # The historical snapshot's own digest, not head's.
        assert old.headers["x-content-sha256"] == crud.compute_content_sha256(
            "v1 body\n"
        )

    async def test_unknown_version_404s_and_names_what_exists(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        """A bare 404 would leave the caller guessing which versions are real."""
        row = await _make(
            async_db_session, org_id=None, slug=_slug("noversion"), body="only one\n"
        )
        resp = await client.get(f"{API_PREFIX}/{row.id}/export?version_number=99")
        assert resp.status_code == 404
        detail = resp.json()["detail"]
        assert "99" in detail
        assert "head is" in detail

    async def test_unknown_artifact_404s(self, client: httpx.AsyncClient) -> None:
        resp = await client.get(f"{API_PREFIX}/{uuid4()}/export")
        assert resp.status_code == 404

    async def test_export_is_org_scoped(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        """Another org's artifact is not exportable — 404, not 200.

        The fixture user resolves to the NULL organization bucket, so an
        artifact created under a concrete org id must be invisible to it.
        """
        other = await _make(
            async_db_session,
            org_id=uuid4(),
            slug=_slug("otherorg"),
            body="not yours\n",
        )
        resp = await client.get(f"{API_PREFIX}/{other.id}/export")
        assert resp.status_code == 404


# ───────────────────────────── bulk export ─────────────────────────────


def _open_archive(content: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(content))


class TestBulkExport:
    async def test_archive_carries_verbatim_bodies_and_a_manifest(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        slug = _slug("bulk")
        row = await _make(async_db_session, org_id=None, slug=slug, body=TRICKY_BODY)

        resp = await client.get(f"{API_PREFIX}/export?q=&kind=plan")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"

        archive = _open_archive(resp.content)
        entry = f"plan/{slug}.md"
        assert entry in archive.namelist()
        assert archive.read(entry) == TRICKY_BODY.encode("utf-8")

        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["truncated"] is False
        mine = [a for a in manifest["artifacts"] if a["slug"] == slug]
        assert len(mine) == 1
        assert mine[0]["content_sha256"] == row.content_sha256
        assert mine[0]["file"] == entry

    async def test_truncation_is_reported_on_both_branches(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        """A silently short export is indistinguishable from a short corpus."""
        for i in range(3):
            await _make(
                async_db_session,
                org_id=None,
                slug=_slug(f"trunc{i}"),
                body=f"body {i}\n",
            )

        cut = await client.get(f"{API_PREFIX}/export?limit=1")
        assert cut.status_code == 200
        assert cut.headers["x-export-truncated"] == "true"
        assert cut.headers["x-export-artifact-count"] == "1"
        assert json.loads(_open_archive(cut.content).read("manifest.json"))["truncated"]

        # The header must be present — and false — when nothing was cut.
        whole = await client.get(f"{API_PREFIX}/export?limit=500")
        assert whole.headers["x-export-truncated"] == "false"

    async def test_same_slug_from_two_repos_both_survive(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        """D7 keeps both copies of a forked plan; the archive must too.

        Identity is ``(org, kind, slug, source_repo)``, so one slug can
        legitimately appear twice with DIFFERENT bodies. Collapsing them onto one
        archive entry would discard exactly the divergence the operator review
        list exists to surface — six such forks are live in this fleet today.
        """
        slug = _slug("forked")
        await _make(
            async_db_session,
            org_id=None,
            slug=slug,
            body="copy A\n",
            source_repo="qontinui-dev-notes",
        )
        await _make(
            async_db_session,
            org_id=None,
            slug=slug,
            body="copy B\n",
            source_repo="workspace-plans",
        )

        resp = await client.get(f"{API_PREFIX}/export?limit=500")
        archive = _open_archive(resp.content)
        entries = [n for n in archive.namelist() if slug in n]
        assert len(entries) == 2, f"both forks must be archived, got {entries}"
        bodies = sorted(archive.read(n) for n in entries)
        assert bodies == [b"copy A\n", b"copy B\n"]

    async def test_filters_match_the_list_routes_grammar(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        """ "Export what I am looking at" must not drift from what the page showed."""
        plan_slug = _slug("filtered-plan")
        await _make(async_db_session, org_id=None, slug=plan_slug, body="a plan\n")
        prompt_slug = _slug("filtered-prompt")
        await _make(
            async_db_session,
            org_id=None,
            slug=prompt_slug,
            body="a prompt\n",
            kind="prompt",
        )

        resp = await client.get(f"{API_PREFIX}/export?kind=prompt&limit=500")
        names = _open_archive(resp.content).namelist()
        assert any(prompt_slug in n for n in names)
        assert not any(plan_slug in n for n in names)

    async def test_other_orgs_artifacts_are_not_archived(
        self, async_db_session: AsyncSession, client: httpx.AsyncClient
    ) -> None:
        foreign = _slug("foreign")
        await _make(async_db_session, org_id=uuid4(), slug=foreign, body="not yours\n")
        resp = await client.get(f"{API_PREFIX}/export?limit=500")
        assert not any(foreign in n for n in _open_archive(resp.content).namelist())


# ──────────────────────────── filename safety ────────────────────────────


class TestExportFilenames:
    """``slug`` is opaque TEXT with no write-side validation.

    So a slug carrying path separators or ``..`` must not be able to place a
    file outside its archive directory when the zip is extracted (zip-slip).

    These three are pure and synchronous, so the module-level ``asyncio`` mark
    is cleared here — pytest-asyncio warns on a sync test carrying it, and a
    standing warning trains readers to ignore the warning channel.
    """

    pytestmark: list = []

    def test_path_traversal_is_folded_out(self) -> None:
        from app.api.v1.endpoints.plan_library import _export_filename

        name = _export_filename("../../etc/passwd")
        assert "/" not in name
        assert "\\" not in name
        assert ".." not in name
        assert name.endswith(".md")

    def test_empty_or_unsafe_slug_still_yields_a_name(self) -> None:
        from app.api.v1.endpoints.plan_library import _export_filename

        assert _export_filename("").endswith(".md")
        assert _export_filename("///").endswith(".md")
        assert _export_filename("!!!").endswith(".md")

    def test_long_slug_is_bounded(self) -> None:
        from app.api.v1.endpoints.plan_library import _export_filename

        assert len(_export_filename("x" * 5000)) <= 210
