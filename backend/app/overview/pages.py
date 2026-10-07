"""Documents and wiki pages — the ``pages`` resource on the authoring contract.

Plan ``2026-09-20-overview-authoring-layer`` Phase 2 (the overview plan's
Phase 7 model). A page is markdown with a kind (``document`` or ``wiki``;
``slides`` arrive later), a per-project unique slug, optional document
metadata, and full version history.

What this module adds to the generic contract (``app.overview.router``):

* **Every content write is a version.** ``current_version`` is the contract's
  ``version``; each create/update appends the whole page to
  ``overview.page_versions``, so history can be read and any version restored.
  ``GET /pages/{id}/versions[/{n}]`` reads it; ``POST .../revert`` restores one
  by writing a NEW version (history is never rewritten).
* **Links by slug.** ``[[Page Title]]`` in a body is a wiki link, stored by the
  target's slug so a link to a page nobody has written yet still exists — and
  becomes a backlink the moment that page does. A document's ``related`` list
  names other documents the same way. ``GET /pages/{id}/backlinks`` reads them.
* **Search.** ``?q=`` is Postgres full-text over title and body (the stored
  ``search_tsv`` column and its ``ix_overview_pages_search`` GIN index), with a
  title substring match beside it so a half-typed word still finds its page.
* **Published from a repository** (plan
  ``2026-10-07-agents-publish-documents-to-the-project-overview`` D3). A page
  may name the file it mirrors (``source_repo`` + ``source_path``) and the commit
  (``source_sha``). That pair is unique per project and kind, so a re-publish
  finds the page (``?source_repo=&source_path=``) and PATCHes it, and a create
  that collides on it converges on the existing page (:meth:`PageStore.adopt_existing`).
  A PATCH naming a source refuses (409 ``source_mismatch``) a page whose
  source is absent or different, so a publish never overwrites a hand-written
  page. ``source_sha`` is content: a new sha is a new version even when the
  body is unchanged.
* **Who wrote each version.** A version records the coord device the write
  came through and the session the client reported; a page read serves both
  for its CURRENT version (``via_device``, ``via_session``).

Rendering is the frontend's; this module stores markdown verbatim and never
renders HTML. The page renderer (``MarkdownView``) has no ``rehype-raw``, so a
raw-HTML payload in a body is shown as text, never executed.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, func, literal_column, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.models.overview import Page, PageLink, PageVersion
from app.overview import change_log
from app.overview import http as contract_http
from app.overview.permissions import OverviewAccess, get_overview_access, require_edit
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)

PageKind = Literal["document", "wiki"]
#: Kinds a caller may name. ``slides`` exists in the schema for a later phase
#: and is not writable yet.
WRITABLE_KINDS: tuple[str, ...] = ("document", "wiki")

MAX_TITLE = 200
MAX_BODY_CHARS = 500_000
MAX_META = 200
MAX_RELATED = 50
EXCERPT_CHARS = 240
MAX_SOURCE_REPO = 200
MAX_SOURCE_PATH = 1000
MAX_SOURCE_SHA = 100

# ---------------------------------------------------------------------------
# Slugs and links
# ---------------------------------------------------------------------------

_NON_WORD = re.compile(r"[\W_]+", re.UNICODE)
_WIKI_LINK = re.compile(r"\[\[([^\[\]|\n]{1,200})(?:\|[^\[\]\n]{0,200})?\]\]")


def slugify(title: str) -> str:
    """The slug a title names: lowercase letters and digits of ANY script,
    joined by hyphens, accents folded (``Café`` → ``cafe``).

    Deterministic and script-preserving on purpose: a ``[[Видение]]`` link and
    a page titled ``Видение`` must reach the same slug on both sides of the
    wire, which a random fallback for non-Latin titles could not do.

    The rule, which a client resolving ``[[links]]`` itself must follow
    exactly: NFKD; drop nonspacing marks (category ``Mn``); lowercase; each run
    of anything but a letter or digit becomes one hyphen; trim hyphens; cut to
    120 code points; trim a trailing hyphen the cut exposed. Every step is
    expressible in a browser's own Unicode support, so both sides agree on
    every character both Unicode versions assign (a character newer than this
    interpreter's Unicode can differ). The two test suites pin the same
    vectors. Empty when the title has no letter or digit.
    """
    folded = unicodedata.normalize("NFKD", title)
    folded = "".join(c for c in folded if unicodedata.category(c) != "Mn")
    return _NON_WORD.sub("-", folded.lower()).strip("-")[:120].strip("-")


def wiki_targets(body: str) -> list[str]:
    """Slugs of the ``[[Title]]`` / ``[[Title|label]]`` links in a body, in
    first-seen order, each once. A link whose title has no letter or digit
    names nothing and is dropped."""
    seen: dict[str, None] = {}
    for match in _WIKI_LINK.finditer(body):
        slug = slugify(match.group(1))
        if slug:
            seen.setdefault(slug, None)
    return list(seen)


def _excerpt(body: str) -> str:
    text = re.sub(r"\s+", " ", body).strip()
    return text[:EXCERPT_CHARS] + ("…" if len(text) > EXCERPT_CHARS else "")


# ---------------------------------------------------------------------------
# Wire shapes
# ---------------------------------------------------------------------------


class PageRead(BaseModel):
    id: str
    kind: PageKind
    slug: str
    title: str
    #: The markdown. ``None`` on a LIST read — bodies are not sent in bulk —
    #: never "" standing in for "not loaded".
    body_md: str | None
    excerpt: str
    doc_number: str | None
    doc_status: str | None
    owner: str | None
    #: Slugs of the documents this one declares related (documents only).
    related: list[str]
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None
    #: The repository file this page mirrors, when it was published from one.
    source_repo: str | None
    source_path: str | None
    #: The commit the current version mirrors.
    source_sha: str | None
    #: The coord device the CURRENT version was written through (from its
    #: verified token); ``None`` for a person's own session.
    via_device: UUID | None
    #: The session the client reported for the CURRENT version
    #: (``X-Overview-Session``) — a label, never proof.
    via_session: str | None


def _meta(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


#: ``owner/name`` — the full GitHub slug, stored lowercased (GitHub's own
#: slugs are case-insensitive, so one repository has one spelling here).
_SOURCE_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
#: A git COMMIT sha — the newest commit on the published ref touching the
#: path — in SHA-1 (40) or SHA-256 (64) form, lowercase.
_SOURCE_SHA = re.compile(r"^[0-9a-f]{40}([0-9a-f]{24})?$")


def normalize_source_repo(v: str) -> str:
    """The one stored spelling of a ``source_repo``, shared by writes and the
    list filter so a lookup matches what a write stored."""
    return v.strip().lower()


def _clean_source_repo(v: str | None) -> str | None:
    if v is None:
        return None
    v = normalize_source_repo(v)
    if not v:
        return None
    if not _SOURCE_REPO.fullmatch(v):
        raise ValueError("source_repo is the repository's full owner/name slug")
    return v


def _clean_source_path(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    segments = v.split("/")
    if (
        v.startswith("/")
        or v.startswith("./")
        or "\\" in v
        or "//" in v
        or ".." in segments
    ):
        raise ValueError(
            "source_path is the file's path relative to the repository root "
            "(no leading / or ./, no backslash, no empty or .. segment)"
        )
    return v


def _clean_source_sha(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip().lower()
    if not v:
        return None
    if not _SOURCE_SHA.fullmatch(v):
        raise ValueError("source_sha is a full 40- or 64-hex git commit sha")
    return v


class _SourceFields(BaseModel):
    """The source a published page mirrors. ``source_repo`` and
    ``source_path`` are given together or not at all; ``source_sha`` only
    with them."""

    source_repo: str | None = Field(default=None, max_length=MAX_SOURCE_REPO)
    source_path: str | None = Field(default=None, max_length=MAX_SOURCE_PATH)
    source_sha: str | None = Field(default=None, max_length=MAX_SOURCE_SHA)

    @field_validator("source_repo")
    @classmethod
    def _repo(cls, v: str | None) -> str | None:
        return _clean_source_repo(v)

    @field_validator("source_path")
    @classmethod
    def _path(cls, v: str | None) -> str | None:
        return _clean_source_path(v)

    @field_validator("source_sha")
    @classmethod
    def _sha(cls, v: str | None) -> str | None:
        return _clean_source_sha(v)

    def _check_source(self) -> None:
        if (self.source_repo is None) != (self.source_path is None):
            raise ValueError("source_repo and source_path are given together")
        if self.source_sha is not None and self.source_repo is None:
            raise ValueError("source_sha needs source_repo and source_path")

    @property
    def has_source(self) -> bool:
        return self.source_repo is not None


class PageCreate(_SourceFields):
    kind: PageKind
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    #: Derived from the title when omitted.
    slug: str | None = Field(default=None, max_length=120)
    body_md: str = Field(default="", max_length=MAX_BODY_CHARS)
    doc_number: str | None = Field(default=None, max_length=MAX_META)
    doc_status: str | None = Field(default=None, max_length=MAX_META)
    owner: str | None = Field(default=None, max_length=MAX_META)
    related: list[str] = Field(default_factory=list, max_length=MAX_RELATED)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title cannot be blank")
        return v

    @field_validator("doc_number", "doc_status", "owner")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return _meta(v)

    @model_validator(mode="after")
    def _slug_and_related(self) -> PageCreate:
        slug = slugify(self.slug) if self.slug else slugify(self.title)
        if not slug:
            raise ValueError(
                "the title needs at least one letter or digit to name the page"
            )
        self.slug = slug
        if self.kind != "document" and self.related:
            raise ValueError("only documents list related documents")
        self.related = _clean_related(self.related, own=slug)
        self._check_source()
        return self


class PageUpdate(_SourceFields):
    """Absent fields are left alone; ``null`` clears the metadata fields.
    ``title`` and ``body_md`` can be changed, never cleared. The slug is fixed:
    links name it, and renaming would orphan every one of them.

    ``source_repo`` + ``source_path`` do not CHANGE a page's source: they name
    the source the writer believes the page mirrors, and a page whose source
    is absent or different refuses the write (409 ``source_mismatch``).
    ``source_sha`` is the commit the new content mirrors."""

    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE)
    body_md: str | None = Field(default=None, max_length=MAX_BODY_CHARS)
    doc_number: str | None = Field(default=None, max_length=MAX_META)
    doc_status: str | None = Field(default=None, max_length=MAX_META)
    owner: str | None = Field(default=None, max_length=MAX_META)
    related: list[str] | None = Field(default=None, max_length=MAX_RELATED)

    @field_validator("doc_number", "doc_status", "owner")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return _meta(v)

    @model_validator(mode="after")
    def _not_cleared(self) -> PageUpdate:
        fields = self.model_fields_set
        if not fields:
            raise ValueError("give at least one field to change")
        for name in ("title", "body_md", "related"):
            if name in fields and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be cleared, only changed")
        if "title" in fields and self.title is not None and not self.title.strip():
            raise ValueError("title cannot be blank")
        self._check_source()
        return self


def _clean_related(slugs: list[str], *, own: str) -> list[str]:
    out: dict[str, None] = {}
    for raw in slugs:
        slug = slugify(raw)
        if slug and slug != own:
            out.setdefault(slug, None)
    # Sorted, as they are read back: the same set in another order is no change.
    return sorted(out)


class PageVersionSummary(BaseModel):
    version: int
    title: str
    created_at: datetime
    created_by: str | None
    #: The commit this version mirrored, for a published page.
    source_sha: str | None
    #: The coord device this version was written through.
    via_device: UUID | None
    #: The session the client reported for this version — a label.
    via_session: str | None


class PageVersionRead(PageVersionSummary):
    body_md: str
    doc_number: str | None
    doc_status: str | None
    owner: str | None


class PageRef(BaseModel):
    id: str
    kind: PageKind
    slug: str
    title: str


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------


def _parse_id(record_id: str) -> UUID:
    try:
        return UUID(record_id)
    except ValueError as exc:
        raise RecordNotFound(record_id) from exc


async def _related_of(db: AsyncSession, page_id: UUID) -> list[str]:
    rows = await db.execute(
        select(PageLink.to_slug)
        .where(PageLink.from_page_id == page_id, PageLink.link_type == "related")
        .order_by(PageLink.to_slug)
    )
    return [r for (r,) in rows.all()]


#: ``(via_device, via_session)`` of a page's current version.
Provenance = tuple[UUID | None, str | None]
_NO_PROVENANCE: Provenance = (None, None)


async def _provenance_of(db: AsyncSession, pages: list[Page]) -> dict[UUID, Provenance]:
    """Who wrote each page's CURRENT version, in one query."""
    if not pages:
        return {}
    rows = await db.execute(
        select(PageVersion.page_id, PageVersion.via_device, PageVersion.via_session)
        .join(
            Page,
            (Page.id == PageVersion.page_id)
            & (Page.current_version == PageVersion.version),
        )
        .where(PageVersion.page_id.in_([p.id for p in pages]))
    )
    return {page_id: (device, session) for page_id, device, session in rows.all()}


def _to_read(
    page: Page,
    related: list[str],
    *,
    with_body: bool,
    provenance: Provenance = _NO_PROVENANCE,
) -> PageRead:
    return PageRead(
        id=str(page.id),
        kind=page.kind,  # type: ignore[arg-type]
        slug=page.slug,
        title=page.title,
        body_md=page.body_md if with_body else None,
        excerpt=_excerpt(page.body_md),
        doc_number=page.doc_number,
        doc_status=page.doc_status,
        owner=page.owner,
        related=related,
        version=page.current_version,
        created_at=page.created_at,
        updated_at=page.updated_at,
        created_by=page.created_by,
        updated_by=page.updated_by,
        source_repo=page.source_repo,
        source_path=page.source_path,
        source_sha=page.source_sha,
        via_device=provenance[0],
        via_session=provenance[1],
    )


class PageStore:
    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> Page:
        stmt = select(Page).where(
            Page.id == _parse_id(record_id),
            Page.tenant_id == ctx.access.tenant_id,
            Page.kind.in_(WRITABLE_KINDS),
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        page = (await ctx.db.execute(stmt)).scalars().first()
        if page is None:
            raise RecordNotFound(record_id)
        return page

    async def _write_links(
        self, ctx: StoreContext, page: Page, related: list[str]
    ) -> None:
        await ctx.db.execute(delete(PageLink).where(PageLink.from_page_id == page.id))
        rows = [("wiki", "wiki", slug) for slug in wiki_targets(page.body_md)]
        rows += [("related", "document", slug) for slug in related]
        for link_type, to_kind, slug in rows:
            ctx.db.add(
                PageLink(
                    tenant_id=page.tenant_id,
                    from_page_id=page.id,
                    to_kind=to_kind,
                    to_slug=slug,
                    link_type=link_type,
                )
            )

    def _snapshot(self, ctx: StoreContext, page: Page) -> Provenance:
        """Append the page as it now stands as a version; returns who wrote it."""
        provenance: Provenance = (
            ctx.access.via_device,
            change_log.reported_session(ctx.request),
        )
        ctx.db.add(
            PageVersion(
                tenant_id=page.tenant_id,
                page_id=page.id,
                version=page.current_version,
                title=page.title,
                body_md=page.body_md,
                doc_number=page.doc_number,
                doc_status=page.doc_status,
                owner=page.owner,
                source_sha=page.source_sha,
                via_device=provenance[0],
                via_session=provenance[1],
                created_by=ctx.access.actor,
            )
        )
        return provenance

    async def _by_source(
        self, ctx: StoreContext, kind: str, source_repo: str, source_path: str
    ) -> Page | None:
        stmt = select(Page).where(
            Page.tenant_id == ctx.access.tenant_id,
            Page.kind == kind,
            Page.source_repo == source_repo,
            Page.source_path == source_path,
        )
        return (await ctx.db.execute(stmt)).scalars().first()

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        kinds = [k for k in filters.get("kind", []) if k in WRITABLE_KINDS]
        scope = (
            Page.tenant_id == ctx.access.tenant_id,
            Page.kind.in_(kinds or WRITABLE_KINDS),
        )
        stmt = select(Page).where(*scope)
        slugs = [s for s in (slugify(x) for x in filters.get("slug", [])) if s]
        if slugs:
            stmt = stmt.where(Page.slug.in_(slugs))
        # Exact matches: a source is an identity, not a search term.
        repos = [normalize_source_repo(v) for v in filters.get("source_repo", [])]
        if any(repos):
            stmt = stmt.where(Page.source_repo.in_([r for r in repos if r]))
        paths = [v.strip() for v in filters.get("source_path", []) if v.strip()]
        if paths:
            stmt = stmt.where(Page.source_path.in_(paths))
        query = " ".join(q.strip() for q in filters.get("q", []) if q.strip())[:200]
        if query:
            tsquery = func.websearch_to_tsquery(
                literal_column("'simple'::regconfig"), query
            )
            escaped = (
                query.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
            )
            # Two arms, unioned: the stored vector through its GIN index, and a
            # title substring for a half-typed word. An OR of the two in one
            # WHERE would keep the planner from using the index at all.
            matched = union(
                select(Page.id).where(*scope, Page.search_tsv.op("@@")(tsquery)),
                select(Page.id).where(*scope, Page.title.ilike(f"%{escaped}%")),
            ).subquery()
            stmt = stmt.where(Page.id.in_(select(matched.c.id))).order_by(
                func.ts_rank(Page.search_tsv, tsquery).desc(), Page.title
            )
        else:
            stmt = stmt.order_by(Page.title)
        pages = list((await ctx.db.execute(stmt.limit(500))).scalars().all())
        related: dict[UUID, list[str]] = {p.id: [] for p in pages}
        if pages:
            rows = await ctx.db.execute(
                select(PageLink.from_page_id, PageLink.to_slug)
                .where(
                    PageLink.from_page_id.in_(related.keys()),
                    PageLink.link_type == "related",
                )
                .order_by(PageLink.to_slug)
            )
            for page_id, slug in rows.all():
                related[page_id].append(slug)
        provenance = await _provenance_of(ctx.db, pages)
        return ListResult(
            items=[
                _to_read(
                    p,
                    related[p.id],
                    with_body=False,
                    provenance=provenance.get(p.id, _NO_PROVENANCE),
                )
                for p in pages
            ]
        )

    async def get(self, ctx: StoreContext, record_id: str) -> PageRead:
        page = await self._load(ctx, record_id)
        return await self._read(ctx, page)

    async def _read(self, ctx: StoreContext, page: Page) -> PageRead:
        provenance = await _provenance_of(ctx.db, [page])
        return _to_read(
            page,
            await _related_of(ctx.db, page.id),
            with_body=True,
            provenance=provenance.get(page.id, _NO_PROVENANCE),
        )

    async def create(self, ctx: StoreContext, payload: PageCreate) -> PageRead:
        assert payload.slug is not None  # set by the model validator
        page = Page(
            tenant_id=ctx.access.tenant_id,
            kind=payload.kind,
            slug=payload.slug,
            title=payload.title,
            body_md=payload.body_md,
            doc_number=payload.doc_number,
            doc_status=payload.doc_status,
            owner=payload.owner,
            source_repo=payload.source_repo,
            source_path=payload.source_path,
            source_sha=payload.source_sha,
            current_version=1,
            created_by=ctx.access.actor,
            updated_by=ctx.access.actor,
        )
        try:
            async with ctx.db.begin_nested():
                ctx.db.add(page)
                await ctx.db.flush()
        except IntegrityError as exc:
            # Either unique rule — the slug, or the source — is a duplicate
            # name; both are ``name_taken``, which is what lets the router
            # offer a keyed create to :meth:`adopt_existing`.
            if payload.source_repo is not None and payload.source_path is not None:
                if await self._by_source(
                    ctx, payload.kind, payload.source_repo, payload.source_path
                ):
                    raise StoreRefused(
                        409,
                        "name_taken",
                        f"There is already a {payload.kind} mirroring "
                        f"{payload.source_repo}/{payload.source_path}; "
                        "update it instead.",
                    ) from exc
            raise StoreRefused(
                409,
                "name_taken",
                f"There is already a {payload.kind} called that "
                f"(its address would be “{payload.slug}”).",
            ) from exc
        provenance = self._snapshot(ctx, page)
        await self._write_links(ctx, page, payload.related)
        await ctx.db.flush()
        await ctx.db.refresh(page)
        return _to_read(page, payload.related, with_body=True, provenance=provenance)

    async def adopt_existing(
        self,
        ctx: StoreContext,
        payload: PageCreate,
        created_through_overview: Any,
    ) -> PageRead | None:
        """The page a keyed create refused as ``name_taken`` was really
        creating — the one with the SAME SOURCE, if the payload names one.

        A published file's identity is its source, so a create that collides
        on ``uq_overview_pages_source`` is the same publish arriving again (a
        retry whose first answer was lost, or a second publisher racing the
        first): it converges on the page already there. A slug collision with
        a page that has no source, or another source, is NOT that page —
        ``None``, and the router answers the original ``name_taken``.

        ``created_through_overview`` is unused: unlike a coord-stored resource,
        a page and its change-log row commit together, so there is no landed
        write without a log row to tell apart.
        """
        del created_through_overview
        if payload.source_repo is None or payload.source_path is None:
            return None
        page = await self._by_source(
            ctx, payload.kind, payload.source_repo, payload.source_path
        )
        if page is None:
            return None
        return await self._read(ctx, page)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: PageUpdate,
        expected_version: int,
    ) -> tuple[PageRead, PageRead]:
        page = await self._load(ctx, record_id, lock=True)
        related = await _related_of(ctx.db, page.id)
        before_provenance = await _provenance_of(ctx.db, [page])
        before = _to_read(
            page,
            related,
            with_body=True,
            provenance=before_provenance.get(page.id, _NO_PROVENANCE),
        )
        if payload.has_source and (
            page.source_repo is None
            or (page.source_repo, page.source_path)
            != (payload.source_repo, payload.source_path)
        ):
            mirrored = (
                f"mirrors {page.source_repo}/{page.source_path}"
                if page.source_repo is not None
                else "was not published from a repository"
            )
            raise StoreRefused(
                409,
                "source_mismatch",
                f"This {page.kind} {mirrored}; a publish of "
                f"{payload.source_repo}/{payload.source_path} may not overwrite it.",
            )
        if page.current_version != expected_version:
            raise StaleVersion(before)

        changes = payload.model_dump(exclude_unset=True)
        # The source identity was checked above and is never changed here;
        # ``source_sha`` stays in ``changes`` because it IS content.
        changes.pop("source_repo", None)
        changes.pop("source_path", None)
        new_related = related
        if "related" in changes:
            if page.kind != "document":
                raise StoreRefused(
                    422, "rejected", "Only documents list related documents."
                )
            new_related = _clean_related(changes.pop("related") or [], own=page.slug)
        if "title" in changes and changes["title"] is not None:
            changes["title"] = changes["title"].strip()
        content_changed = any(getattr(page, k) != v for k, v in changes.items())
        if not content_changed and new_related == related:
            return before, before

        for key, value in changes.items():
            setattr(page, key, value)
        page.current_version += 1
        page.updated_by = ctx.access.actor
        page.updated_at = func.now()  # type: ignore[assignment]
        provenance = self._snapshot(ctx, page)
        await self._write_links(ctx, page, new_related)
        await ctx.db.flush()
        await ctx.db.refresh(page)
        return before, _to_read(
            page, new_related, with_body=True, provenance=provenance
        )

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> PageRead:
        page = await self._load(ctx, record_id, lock=True)
        before = await self._read(ctx, page)
        if page.current_version != expected_version:
            raise StaleVersion(before)
        await ctx.db.delete(page)
        await ctx.db.flush()
        return before


def page_store() -> PageStore:
    """FastAPI dependency (a class instance so tests can override it)."""
    return PageStore()


# ---------------------------------------------------------------------------
# Routes beyond the contract: versions, revert, backlinks
# ---------------------------------------------------------------------------

router = APIRouter()


def _ctx(access: OverviewAccess, db: AsyncSession, request: Request) -> StoreContext:
    return StoreContext(access=access, db=db, request=request)


async def _page_or_404(ctx: StoreContext, page_id: str) -> Page:
    try:
        return await PageStore()._load(ctx, page_id)
    except RecordNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "There is no such page here."},
        ) from exc


class PageVersionList(BaseModel):
    versions: list[PageVersionSummary]
    current_version: int


@router.get("/pages/{page_id}/versions", response_model=PageVersionList)
async def list_page_versions(
    page_id: str,
    request: Request,
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> PageVersionList:
    """Every version of a page, newest first. Readable by any member."""
    page = await _page_or_404(_ctx(access, db, request), page_id)
    rows = await db.execute(
        select(PageVersion)
        .where(
            PageVersion.page_id == page.id, PageVersion.tenant_id == access.tenant_id
        )
        .order_by(PageVersion.version.desc())
    )
    return PageVersionList(
        versions=[
            PageVersionSummary(
                version=v.version,
                title=v.title,
                created_at=v.created_at,
                created_by=v.created_by,
                source_sha=v.source_sha,
                via_device=v.via_device,
                via_session=v.via_session,
            )
            for v in rows.scalars().all()
        ],
        current_version=page.current_version,
    )


async def _version_or_404(
    db: AsyncSession, tenant_id: UUID, page: Page, version: int
) -> PageVersion:
    row = (
        (
            await db.execute(
                select(PageVersion).where(
                    PageVersion.page_id == page.id,
                    PageVersion.tenant_id == tenant_id,
                    PageVersion.version == version,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "That version does not exist."},
        )
    return row


@router.get("/pages/{page_id}/versions/{version}", response_model=PageVersionRead)
async def read_page_version(
    page_id: str,
    version: int,
    request: Request,
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> PageVersionRead:
    page = await _page_or_404(_ctx(access, db, request), page_id)
    v = await _version_or_404(db, access.tenant_id, page, version)
    return PageVersionRead(
        version=v.version,
        title=v.title,
        created_at=v.created_at,
        created_by=v.created_by,
        source_sha=v.source_sha,
        via_device=v.via_device,
        via_session=v.via_session,
        body_md=v.body_md,
        doc_number=v.doc_number,
        doc_status=v.doc_status,
        owner=v.owner,
    )


class PageItem(BaseModel):
    item: PageRead
    can_edit: bool


@router.post("/pages/{page_id}/versions/{version}/revert", response_model=PageItem)
async def revert_page(
    page_id: str,
    version: int,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    access: OverviewAccess = Depends(require_edit("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """Restore an earlier version by writing it as a NEW version.

    Same contract as any write: ``If-Match`` names the version the reader saw,
    and a page that has moved on is a 409 carrying the server's copy. The
    related-documents list is not versioned (it is a link set, not content)
    and is left as it is.
    """
    expected = contract_http.parse_if_match(if_match)
    ctx = _ctx(access, db, request)
    store = PageStore()
    try:
        page = await store._load(ctx, page_id, lock=True)
    except RecordNotFound as exc:
        raise HTTPException(status_code=404, detail="not_found") from exc
    target = await _version_or_404(db, access.tenant_id, page, version)
    # A published page's version mirrored a commit; restoring its content
    # restores the sha that content came from, so the page never claims to
    # mirror a commit its body is not.
    source: dict[str, Any] = (
        {
            "source_repo": page.source_repo,
            "source_path": page.source_path,
            "source_sha": target.source_sha,
        }
        if page.source_repo is not None
        else {}
    )
    payload = PageUpdate(
        title=target.title,
        body_md=target.body_md,
        doc_number=target.doc_number,
        doc_status=target.doc_status,
        owner=target.owner,
        **source,
    )
    try:
        before, after = await store.update(ctx, page_id, payload, expected)
    except StaleVersion as exc:
        return contract_http.stale(exc)
    if after.version != before.version:
        await change_log.record(
            db,
            tenant_id=access.tenant_id,
            resource="pages",
            record_id=after.id,
            action="update",
            source=change_log.change_source(request),
            **change_log.attribution(access, request),
            before=_audit_view(before),
            after={**_audit_view(after), "reverted_to_version": version},
            version_before=before.version,
            version_after=after.version,
        )
        await db.commit()
    response.headers["ETag"] = contract_http.etag(after.version)
    return PageItem(item=after, can_edit=True)


@router.get("/pages/{page_id}/backlinks", response_model=list[PageRef])
async def page_backlinks(
    page_id: str,
    request: Request,
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> list[PageRef]:
    """Pages that link here — by wiki link or as a related document."""
    page = await _page_or_404(_ctx(access, db, request), page_id)
    rows = await db.execute(
        select(Page)
        .join(PageLink, PageLink.from_page_id == Page.id)
        .where(
            PageLink.tenant_id == access.tenant_id,
            PageLink.to_kind == page.kind,
            PageLink.to_slug == page.slug,
            Page.id != page.id,
            Page.kind.in_(WRITABLE_KINDS),
        )
        .distinct()
        .order_by(Page.title)
    )
    return [
        PageRef(id=str(p.id), kind=p.kind, slug=p.slug, title=p.title)  # type: ignore[arg-type]
        for p in rows.scalars().all()
    ]


def _audit_view(page: PageRead) -> dict[str, Any]:
    """A page as the change log records it: without its body, which
    ``page_versions`` already keeps in full for every version."""
    return page.model_dump(mode="json", exclude={"body_md"})


__all__ = [
    "PageCreate",
    "PageRead",
    "PageStore",
    "PageUpdate",
    "page_store",
    "router",
    "slugify",
    "wiki_targets",
]
