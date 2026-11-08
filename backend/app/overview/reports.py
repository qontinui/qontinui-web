"""Stakeholder reports — the ``reports`` and ``report_snapshots`` resources.

Plan ``2026-11-07-interactive-stakeholder-reports-in-the-project-overview``
Phase 1. A report is a versioned narrative plus a series of frozen data
snapshots (D1); both are registry resources on the authoring contract
(``If-Match``, ``Idempotency-Key``, ``overview.change_log``), so the overview
UI and an unattended agent write them through the same doors.

``reports`` (:class:`ReportStore`)
    A slug, a title, a one-paragraph plain-language summary and a markdown
    body, versioned like a page: every content write appends
    ``overview.report_versions``; ``GET /reports/{id}/versions[/{n}]`` reads
    them and ``POST …/versions/{n}/revert`` restores one as a NEW version. A
    report published from a repository file names it (``source_repo`` +
    ``source_path``, D7) and follows the pages' rules for it, which live in
    :mod:`app.overview.sourced`: a write naming a source refuses a report that
    mirrors another (409 ``source_mismatch``), the sha follows the content, an
    unchanged write is no write, and a keyed create colliding on the source
    converges only on identical content. The narrative is scanned at write for
    the tenant's confidential terms, email-shaped identities, IP addresses and
    account ids (422 ``report_rejected``, naming the field).

``report_snapshots`` (:class:`ReportSnapshotStore`)
    One dated stop: a ``report-snapshot/v1`` document checked against the
    allowlist contract (:mod:`app.overview.report_snapshot_contract`, D4) —
    any failure is 422 ``snapshot_rejected`` with every violation's slot and
    kind, never its value; the snapshot's ``source_path`` and a withdrawal's
    ``withdrawn_reason`` get the narrative's scans, refused the same way. A
    snapshot is never edited or deleted: the only update withdraws it (with a
    reason) or restores it, under ``If-Match``. A snapshot published from a
    file names it (``source_path``, unique per
    report): re-posting the same file with the same content is a no-op that
    answers the stored snapshot, key or not; the same file with other content
    is 409 ``snapshot_changed_at_source`` (snapshots are immutable — publish a
    new file and withdraw the old snapshot). A document carrying a GitHub link
    needs the tenant's first-party owners to check it; while they read
    UNKNOWN the write is refused 503 ``presentation_scope_unknown`` and nothing
    is written.

Reading a snapshot applies today's rules (D4): a list carries no documents; a
single read and the view serve the document after
:func:`~app.overview.report_snapshot_contract.treat_for_read`, which withholds
what the current contract or the current confidential terms would refuse. A
withdrawn snapshot's document is served to no reader: its row reads
``data: null`` with ``withheld`` naming ``data``, ``withdrawn`` (the database
keeps it, so a restore serves it again). A report's narrative is served under
the CURRENT confidential terms too
(:func:`~app.overview.report_snapshot_contract.treat_narrative`): a title,
summary or body naming a term added since the write reads ``[withheld]``, in
every read that serves it — the report, the list, the view and the versions.
The change log's copies are not rewritten.

``GET /reports/{id}/view`` (D10) serves the report and its stops in time order
with the changes between them (:mod:`app.overview.report_view`).

Who: reads are open to any member of the project, writes follow the project's
``editing_roles`` (founding plan D3), and a paired device writes as its owning
user (D6, D7).

The presentation scope (``web.presentation_scopes``) supplies the confidential
terms and the first-party owners. Only the stored row's CONFIGURED terms are
used — the terms its ``version`` tracks, which is what lets a snapshot record
the version it was checked against. The owners are the configured ones, else
the owners of the tenant's registered repositories read from coord for a
signed-in person; a device's bearer is never forwarded to coord's operator
routes, so for a device they are UNKNOWN unless configured.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import (
    BaseModel,
    Field,
    SkipValidation,
    field_validator,
    model_validator,
)
from sqlalchemy import false, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.api.deps import get_async_db
from app.crud import presentation_scope as scope_crud
from app.models.overview import Report, ReportSnapshot, ReportVersion
from app.overview import http as contract_http
from app.overview.pages import slugify
from app.overview.permissions import OverviewAccess, require_edit, require_read
from app.overview.report_snapshot_contract import (
    REPORT_ALLOWLIST_VERSION,
    WITHHELD,
    ReadScope,
    ReportSnapshotDoc,
    TermMatcher,
    Violation,
    check_snapshot,
    content_sha256,
    first_storage_difference,
    foreign_link_owners,
    narrative_violations,
    treat_for_read,
    treat_label,
    treat_logged,
    treat_narrative,
)
from app.overview.report_view import (
    PAGE_SIZE,
    SnapshotChanges,
    Stop,
    ViewSnapshot,
    WithheldEntry,
    changes_between,
    window,
)
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
    WithheldSlot,
)
from app.overview.sourced import (
    MAX_SOURCE_PATH,
    NO_PROVENANCE,
    Provenance,
    SourceFields,
    bump_version,
    changes_anything,
    clean_source_path,
    content_changes,
    current_provenance,
    holds_content,
    insert_or_refuse,
    log_revert,
    normalize_source_repo,
    refuse_source_mismatch,
    restored_source,
    version_or_404,
    versions_of,
    write_provenance,
)
from app.services.build_record_allowlist import scan_off_loop
from app.services.coord_identity import get_coord_identity
from app.services.presentation_scope import (
    normalize_owner,
    read_registered_repo_owners,
)

logger = structlog.get_logger(__name__)

MAX_TITLE = 200
MAX_SUMMARY = 2000
MAX_BODY_CHARS = 500_000
MAX_WITHDRAWN_REASON = 300
#: The most violations a refusal lists; ``violation_count`` says how many
#: there were.
MAX_LISTED_VIOLATIONS = 100

MethodKind = Literal["full_review", "light_check", "measured", "manual"]

# ---------------------------------------------------------------------------
# Wire shapes — reports
# ---------------------------------------------------------------------------


#: The text fields of a report every read serves under the project's CURRENT
#: confidential terms (the narrative and the source it mirrors). The slug is
#: not among them: blocks in other pages name the report by it, so it is
#: fixed and always served (a term added after creation that matches it is a
#: known limit).
REPORT_SERVED_TEXT: frozenset[str] = frozenset(
    {"title", "summary", "body_md", "source_repo", "source_path"}
)
#: The text fields of a snapshot row every read serves under the project's
#: current confidential terms: the labels copied out of the document (which
#: :func:`treat_label` serves) and the file path and withdrawal reason.
SNAPSHOT_SERVED_TEXT: frozenset[str] = frozenset(
    {"label", "method_label", "source_path", "withdrawn_reason"}
)


class ReportRead(BaseModel):
    id: str
    slug: str
    title: str
    #: One plain-language paragraph: what the report is about.
    summary: str
    #: The markdown. ``None`` on a LIST read — bodies are not sent in bulk.
    body_md: str | None
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None
    #: The repository file this report mirrors, when it was published from one.
    source_repo: str | None
    source_path: str | None
    #: The commit the current version mirrors.
    source_sha: str | None
    #: The coord device the CURRENT version was written through.
    via_device: UUID | None
    #: The session the client reported for the CURRENT version — a label.
    via_session: str | None
    #: The text fields this read did not serve (title, summary, body_md,
    #: source_repo, source_path): each names one of the project's CURRENT
    #: confidential terms (one added after the write) and reads
    #: ``[withheld]``. What is stored is unchanged.
    withheld: list[WithheldSlot]


def _title(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("title cannot be blank")
    return v


class ReportCreate(SourceFields):
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    #: Derived from the title when omitted. Blocks name a report by it.
    slug: str | None = Field(default=None, max_length=120)
    summary: str = Field(default="", max_length=MAX_SUMMARY)
    body_md: str = Field(default="", max_length=MAX_BODY_CHARS)

    @field_validator("title")
    @classmethod
    def _clean_title(cls, v: str) -> str:
        return _title(v)

    @model_validator(mode="after")
    def _slug(self) -> ReportCreate:
        slug = slugify(self.slug) if self.slug else slugify(self.title)
        if not slug:
            raise ValueError(
                "the title needs at least one letter or digit to name the report"
            )
        self.slug = slug
        self._check_source()
        return self


class ReportUpdate(SourceFields):
    """Absent fields are left alone. ``title``, ``summary`` and ``body_md`` can
    be changed, never cleared (``summary`` may be set to ""). The slug is
    fixed: blocks in other pages name the report by it.

    ``source_repo`` + ``source_path`` name the source the writer believes the
    report mirrors (409 ``source_mismatch`` when it does not); ``source_sha``
    is the commit the new content mirrors."""

    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE)
    summary: str | None = Field(default=None, max_length=MAX_SUMMARY)
    body_md: str | None = Field(default=None, max_length=MAX_BODY_CHARS)

    @model_validator(mode="after")
    def _not_cleared(self) -> ReportUpdate:
        fields = self.model_fields_set
        if not fields:
            raise ValueError("give at least one field to change")
        for name in ("title", "summary", "body_md"):
            if name in fields and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be cleared, only changed")
        if "title" in fields and self.title is not None and not self.title.strip():
            raise ValueError("title cannot be blank")
        self._check_source()
        self._check_sha_names_source()
        return self


class ReportVersionSummary(BaseModel):
    version: int
    title: str
    created_at: datetime
    created_by: str | None
    source_sha: str | None
    via_device: UUID | None
    via_session: str | None
    #: The narrative fields this read did not serve (each reads
    #: ``[withheld]``): they name a CURRENT confidential term.
    withheld: list[WithheldSlot]


class ReportVersionRead(ReportVersionSummary):
    summary: str
    body_md: str


class ReportVersionList(BaseModel):
    versions: list[ReportVersionSummary]
    current_version: int


class ReportItem(BaseModel):
    item: ReportRead
    can_edit: bool


# ---------------------------------------------------------------------------
# Wire shapes — snapshots
# ---------------------------------------------------------------------------


class ReportSnapshotRead(BaseModel):
    id: str
    report_id: UUID
    #: Creation order, unique per report. Timeline order is ``(as_of, seq)``.
    seq: int
    #: Moves on every withdraw or restore — the version those name.
    version: int
    label: str
    as_of: datetime
    method_kind: MethodKind
    method_label: str
    #: The file this snapshot was published from, when it was.
    source_path: str | None
    #: sha256 of the document's canonical JSON form, as the writer sent it.
    content_sha256: str
    allowlist_version: int
    scope_version: int
    withdrawn: bool
    withdrawn_at: datetime | None
    withdrawn_reason: str | None
    created_at: datetime
    created_by: str | None
    via_device: UUID | None
    via_session: str | None
    #: The ``report-snapshot/v1`` document, served only by a single read (and
    #: the report's view), after today's checks. ``None`` on a list read, on a
    #: write's answer, when the whole document is withheld, and while the
    #: snapshot is withdrawn (``withheld`` then names ``data``, ``withdrawn``):
    #: a withdrawn snapshot is kept as history, never served.
    data: dict[str, Any] | None
    #: Every slot this read withheld.
    withheld: list[WithheldSlot]


class ReportSnapshotCreate(BaseModel):
    report_id: UUID
    #: The repository file the snapshot was published from (the report's own
    #: repository), unique per report. Optional: a snapshot written by hand
    #: names none.
    source_path: str | None = Field(default=None, max_length=MAX_SOURCE_PATH)
    #: A ``report-snapshot/v1`` document. Its schema is SERVED (an agent or
    #: the editing kit can check a document before sending it), but the
    #: request layer does not validate it: the store checks it against the
    #: contract (:func:`check_snapshot`), so a refusal names each failing slot
    #: and never echoes a value or a key, and strict JSON-mode rules apply.
    data: SkipValidation[ReportSnapshotDoc] = Field(
        description=(
            "A report-snapshot/v1 document. Checked by the server against the "
            "contract; a failure is 422 snapshot_rejected listing each slot "
            "and rule, never a value."
        )
    )

    @field_validator("source_path")
    @classmethod
    def _path(cls, v: str | None) -> str | None:
        return clean_source_path(v)

    @property
    def document(self) -> Any:
        """``data`` exactly as sent — the raw JSON value, not a model, since
        validation is skipped for it here."""
        raw: Any = self.data
        return raw


class ReportSnapshotUpdate(BaseModel):
    """Withdraw (``withdrawn: true`` with a ``withdrawn_reason``) or restore
    (``withdrawn: false``, no reason) — the only change a snapshot takes."""

    withdrawn: bool
    withdrawn_reason: str | None = Field(default=None, max_length=MAX_WITHDRAWN_REASON)

    @model_validator(mode="after")
    def _reason(self) -> ReportSnapshotUpdate:
        if self.withdrawn:
            reason = (self.withdrawn_reason or "").strip()
            if not reason:
                raise ValueError("withdrawing a snapshot needs a withdrawn_reason")
            self.withdrawn_reason = reason
        elif self.withdrawn_reason is not None:
            raise ValueError("a restore takes no withdrawn_reason")
        return self


# ---------------------------------------------------------------------------
# The presentation scope a report reads and writes against
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _StoredScope:
    version: int
    terms: tuple[str, ...]
    #: The configured first-party owners, lowercased; ``None`` when the
    #: tenant configured none (the registered repositories' owners apply).
    owners: frozenset[str] | None


def _owners_of(names: Any) -> frozenset[str]:
    return frozenset(o for o in (normalize_owner(n) for n in names) if o is not None)


async def _stored_scope(ctx: StoreContext) -> _StoredScope:
    stored = await scope_crud.get_scope(ctx.db, ctx.access.tenant_id)
    if stored is None:
        return _StoredScope(version=0, terms=(), owners=None)
    return _StoredScope(
        version=stored.version,
        terms=stored.confidential_terms,
        owners=(
            None
            if stored.first_party_owners is None
            else _owners_of(stored.first_party_owners)
        ),
    )


async def current_terms(db: AsyncSession, tenant_id: UUID) -> tuple[str, ...]:
    """The project's configured confidential terms, as every report read
    applies them (:func:`_stored_scope`'s ``terms``)."""
    stored = await scope_crud.get_scope(db, tenant_id)
    return () if stored is None else tuple(stored.confidential_terms)


#: A change-log entry's two copies, as logged.
LoggedPair = tuple[dict[str, Any] | None, dict[str, Any] | None]
#: The two copies as served, and what was withheld from them.
ServedLog = tuple[dict[str, Any] | None, dict[str, Any] | None, list[WithheldSlot]]


async def withhold_logged_text(
    db: AsyncSession,
    tenant_id: UUID,
    fields: frozenset[str],
    logged: list[LoggedPair],
) -> list[ServedLog]:
    """Change-log copies (``before``, ``after``) as ``GET /change-log`` serves
    them for a resource whose reads withhold ``fields``: each field naming one
    of the project's CURRENT confidential terms reads ``[withheld]``, with a
    withheld entry naming the copy and the field (``after.title``). Off the
    event loop: a deleted report's ``before`` carries its whole body."""
    if not fields:
        return [(before, after, []) for before, after in logged]
    matcher = TermMatcher(await current_terms(db, tenant_id))
    if not matcher.active:
        return [(before, after, []) for before, after in logged]

    def treat_all() -> list[ServedLog]:
        out: list[ServedLog] = []
        for before, after in logged:
            served_before, held_before = treat_logged(before, fields, matcher, "before")
            served_after, held_after = treat_logged(after, fields, matcher, "after")
            out.append(
                (served_before, served_after, _withheld([*held_before, *held_after]))
            )
        return out

    served: list[ServedLog] = await scan_off_loop(treat_all)
    return served


async def _first_party_owners(
    ctx: StoreContext, stored: _StoredScope
) -> frozenset[str] | None:
    """The tenant's first-party owners, or ``None`` (UNKNOWN).

    Configured owners win. Otherwise a signed-in person's request reads the
    owners of the tenant's registered repositories from coord; a device's
    cannot (its bearer never reaches coord's operator routes), so it is
    UNKNOWN. The read transaction ends first, so the coord call never holds a
    pooled connection idle."""
    if stored.owners is not None:
        return stored.owners
    if ctx.access.kind == "device":
        logger.info(
            "overview_reports.owners_unknown",
            reason="device_principal_without_configured_owners",
            tenant_id=str(ctx.access.tenant_id),
        )
        return None
    await ctx.db.commit()
    try:
        identity = await get_coord_identity(ctx.request)
    except HTTPException as exc:
        logger.warning(
            "overview_reports.owners_unknown",
            reason="identity_unresolved",
            status_code=exc.status_code,
            tenant_id=str(ctx.access.tenant_id),
        )
        return None
    registered = await read_registered_repo_owners(identity, ctx.access.tenant_id)
    return None if registered.owners is None else _owners_of(registered.owners)


def _read_scope(stored: _StoredScope, owners: frozenset[str] | None) -> ReadScope:
    return ReadScope(version=stored.version, terms=stored.terms, owners=owners)


def _has_links(data: dict[str, Any]) -> bool:
    return any(item.get("links") for item in data.get("items") or [])


def _rejected(error: str, violations: list[Violation], what: str) -> StoreRefused:
    listed = violations[:MAX_LISTED_VIOLATIONS]
    return StoreRefused(
        422,
        error,
        f"The {what} breaks the report contract in {len(violations)} place(s); "
        "each is named by its slot and the rule it breaks.",
        extra={
            "violations": [v.as_dict() for v in listed],
            "violation_count": len(violations),
        },
    )


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


def _parse_id(record_id: str) -> UUID:
    try:
        return UUID(record_id)
    except ValueError as exc:
        raise RecordNotFound(record_id) from exc


async def _provenance_of(
    db: AsyncSession, reports: list[Report]
) -> dict[UUID, Provenance]:
    return await current_provenance(
        db,
        reports,
        record_model=Report,
        version_model=ReportVersion,
        record_fk=ReportVersion.report_id,
    )


#: Text fields as a reader is served them, and the ones withheld.
_ServedText = tuple[dict[str, str], list[Violation]]


def _text_fields(
    record: Report | ReportVersion, *, with_body: bool = True
) -> dict[str, str]:
    """The served text fields (:data:`REPORT_SERVED_TEXT`) of a report, or of
    one of its versions: the narrative (no body on a list read) and, for a
    report, the source it mirrors when it has one."""
    fields = {"title": record.title, "summary": record.summary}
    if with_body:
        fields["body_md"] = record.body_md
    if isinstance(record, Report):
        for name in ("source_repo", "source_path"):
            value = getattr(record, name)
            if value is not None:
                fields[name] = value
    return fields


async def _served_texts(
    ctx: StoreContext, texts: list[dict[str, str]]
) -> list[_ServedText]:
    """Each set of text fields as a reader is served it: under the project's
    CURRENT confidential terms, so a term added after the write withholds the
    field that names it (:func:`treat_narrative`). Off the event loop, since
    a body runs to :data:`MAX_BODY_CHARS`; no scan at all for a project with
    no terms."""
    matcher = TermMatcher((await _stored_scope(ctx)).terms)
    if not matcher.active:
        return [(fields, []) for fields in texts]

    def treat_all() -> list[_ServedText]:
        return [treat_narrative(fields, matcher) for fields in texts]

    served: list[_ServedText] = await scan_off_loop(treat_all)
    return served


def _report_read(
    report: Report,
    *,
    with_body: bool,
    provenance: Provenance = NO_PROVENANCE,
    served: _ServedText | None = None,
) -> ReportRead:
    """``served`` is the text as a reader is served it. Without it the stored
    text is used: the copy the change log keeps of an update's or a delete's
    ``before`` (``GET /change-log`` withholds from it as it serves it)."""
    fields, withheld = (
        served
        if served is not None
        else (_text_fields(report, with_body=with_body), [])
    )
    return ReportRead(
        id=str(report.id),
        slug=report.slug,
        title=fields["title"],
        summary=fields["summary"],
        body_md=fields.get("body_md") if with_body else None,
        version=report.current_version,
        created_at=report.created_at,
        updated_at=report.updated_at,
        created_by=report.created_by,
        updated_by=report.updated_by,
        source_repo=fields.get("source_repo"),
        source_path=fields.get("source_path"),
        source_sha=report.source_sha,
        via_device=provenance[0],
        via_session=provenance[1],
        withheld=_withheld(withheld),
    )


#: The fields a report's narrative is scanned in, and the fields a keyed
#: create must match exactly to converge on an existing report.
_NARRATIVE = ("title", "summary", "body_md")


class ReportStore:
    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> Report:
        stmt = select(Report).where(
            Report.id == _parse_id(record_id),
            Report.tenant_id == ctx.access.tenant_id,
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        report = (await ctx.db.execute(stmt)).scalars().first()
        if report is None:
            raise RecordNotFound(record_id)
        return report

    def _snapshot(self, ctx: StoreContext, report: Report) -> Provenance:
        """Append the narrative as it now stands as a version."""
        provenance = write_provenance(ctx)
        ctx.db.add(
            ReportVersion(
                tenant_id=report.tenant_id,
                report_id=report.id,
                version=report.current_version,
                title=report.title,
                summary=report.summary,
                body_md=report.body_md,
                source_sha=report.source_sha,
                via_device=provenance[0],
                via_session=provenance[1],
                created_by=ctx.access.actor,
            )
        )
        return provenance

    async def _by_source(
        self, ctx: StoreContext, source_repo: str, source_path: str
    ) -> Report | None:
        stmt = select(Report).where(
            Report.tenant_id == ctx.access.tenant_id,
            Report.source_repo == source_repo,
            Report.source_path == source_path,
        )
        return (await ctx.db.execute(stmt)).scalars().first()

    async def _refuse_narrative(
        self, ctx: StoreContext, fields: dict[str, str]
    ) -> None:
        """422 ``report_rejected`` when the narrative (or, at create, the
        slug or the source) names a confidential term, an email-shaped
        identity, an IP address or an account id, or is the ``[withheld]``
        marker a read serves."""
        stored = await _stored_scope(ctx)
        violations: list[Violation] = await scan_off_loop(
            functools.partial(narrative_violations, terms=stored.terms), fields
        )
        if violations:
            raise _rejected("report_rejected", violations, "report")

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        stmt = select(Report).where(Report.tenant_id == ctx.access.tenant_id)
        if filters.get("slug"):
            slugs = [slugify(x) for x in filters["slug"]]
            stmt = stmt.where(Report.slug.in_([s for s in slugs if s]))
        # Exact matches: a source is an identity, not a search term. A filter
        # that was given matches exactly, even when nothing of it survives
        # normalisation: an unusable value matches no report, never all.
        if filters.get("source_repo"):
            repos = [normalize_source_repo(v) for v in filters["source_repo"]]
            stmt = stmt.where(Report.source_repo.in_([r for r in repos if r]))
        if filters.get("source_path"):
            paths = [v.strip() for v in filters["source_path"]]
            stmt = stmt.where(Report.source_path.in_([p for p in paths if p]))
        reports = list(
            (await ctx.db.execute(stmt.order_by(Report.title).limit(500)))
            .scalars()
            .all()
        )
        provenance = await _provenance_of(ctx.db, reports)
        served = await _served_texts(
            ctx, [_text_fields(r, with_body=False) for r in reports]
        )
        return ListResult(
            items=[
                _report_read(
                    r,
                    with_body=False,
                    provenance=provenance.get(r.id, NO_PROVENANCE),
                    served=narrative,
                )
                for r, narrative in zip(reports, served, strict=True)
            ]
        )

    async def get(self, ctx: StoreContext, record_id: str) -> ReportRead:
        return await self._read(ctx, await self._load(ctx, record_id))

    async def _read(
        self, ctx: StoreContext, report: Report, provenance: Provenance | None = None
    ) -> ReportRead:
        """The report as a reader is served it: its text
        (:data:`REPORT_SERVED_TEXT`) under the project's CURRENT confidential
        terms. Every answer that serves a report goes through here — a read,
        the view, a write's answer, a stale write's server copy, a no-op
        write, a replayed or adopted create."""
        if provenance is None:
            provenance = (await _provenance_of(ctx.db, [report])).get(
                report.id, NO_PROVENANCE
            )
        (served,) = await _served_texts(ctx, [_text_fields(report)])
        return _report_read(
            report, with_body=True, provenance=provenance, served=served
        )

    async def _withheld_now(
        self, ctx: StoreContext, report: Report, names: set[str]
    ) -> set[str]:
        """Which of ``names`` (served text fields) a read of ``report``
        withholds right now."""
        fields = {n: t for n, t in _text_fields(report).items() if n in names}
        if not fields:
            return set()
        ((_served, withheld),) = await _served_texts(ctx, [fields])
        return {v.slot for v in withheld}

    async def _stored_read(self, ctx: StoreContext, report: Report) -> ReportRead:
        """The report exactly as stored, never served: the ``before`` the
        change log keeps of an update or a delete (a deleted report's only
        remaining copy)."""
        provenance = await _provenance_of(ctx.db, [report])
        return _report_read(
            report,
            with_body=True,
            provenance=provenance.get(report.id, NO_PROVENANCE),
        )

    async def create(self, ctx: StoreContext, payload: ReportCreate) -> ReportRead:
        assert payload.slug is not None  # set by the model validator
        # The slug and the source are served on every read and the slug is
        # fixed for good, so they get the narrative's scans too.
        source = {
            name: value
            for name in ("source_repo", "source_path")
            if (value := getattr(payload, name)) is not None
        }
        await self._refuse_narrative(
            ctx,
            {
                **{name: getattr(payload, name) for name in _NARRATIVE},
                "slug": payload.slug,
                **source,
            },
        )
        report = Report(
            tenant_id=ctx.access.tenant_id,
            slug=payload.slug,
            title=payload.title,
            summary=payload.summary,
            body_md=payload.body_md,
            source_repo=payload.source_repo,
            source_path=payload.source_path,
            source_sha=payload.source_sha,
            current_version=1,
            created_by=ctx.access.actor,
            updated_by=ctx.access.actor,
        )

        async def taken() -> StoreRefused:
            # Either unique rule — the slug, or the source — is a duplicate
            # name, which is what lets the router offer a keyed create to
            # :meth:`adopt_existing`.
            if payload.source_repo is not None and payload.source_path is not None:
                if await self._by_source(ctx, payload.source_repo, payload.source_path):
                    return StoreRefused(
                        409,
                        "name_taken",
                        "There is already a report mirroring "
                        f"{payload.source_repo}/{payload.source_path}; "
                        "update it instead.",
                    )
            return StoreRefused(
                409,
                "name_taken",
                f"There is already a report called that (its address would be "
                f"“{payload.slug}”).",
            )

        await insert_or_refuse(ctx, report, taken)
        provenance = self._snapshot(ctx, report)
        await ctx.db.flush()
        await ctx.db.refresh(report)
        return await self._read(ctx, report, provenance)

    async def adopt_existing(
        self,
        ctx: StoreContext,
        payload: ReportCreate,
        created_through_overview: Any,
    ) -> ReportRead | None:
        """The report a keyed create refused as ``name_taken`` was really
        creating: the one with the SAME SOURCE and exactly the same slug,
        narrative and commit — a retry whose first answer was lost. Anything
        else is ``None``, and the router answers ``name_taken`` ("update it
        instead"), so a second publisher never has its content dropped.
        ``created_through_overview`` is unused: a report and its change-log row
        commit together."""
        del created_through_overview
        if payload.source_repo is None or payload.source_path is None:
            return None
        report = await self._by_source(ctx, payload.source_repo, payload.source_path)
        if report is None or not holds_content(
            report, payload, ("slug", *_NARRATIVE, "source_sha")
        ):
            return None
        return await self._read(ctx, report)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: ReportUpdate,
        expected_version: int,
    ) -> tuple[ReportRead, ReportRead]:
        report = await self._load(ctx, record_id, lock=True)
        try:
            refuse_source_mismatch(report, payload, noun="report")
        except StoreRefused as refused:
            if not await self._withheld_now(
                ctx, report, {"source_repo", "source_path"}
            ):
                raise
            # The refusal would name the source the report mirrors, which
            # reads withhold right now: say so without naming it.
            raise StoreRefused(
                409,
                "source_mismatch",
                f"This report mirrors another source ({WITHHELD}); a publish of "
                f"{payload.source_repo}/{payload.source_path} may not overwrite it.",
            ) from refused
        if report.current_version != expected_version:
            raise StaleVersion(await self._read(ctx, report))
        changes = content_changes(report, payload)
        marked = {name for name in _NARRATIVE if changes.get(name) == WITHHELD}
        if marked:
            # A field sent back as the [withheld] marker a read served it as
            # stands for the stored value, left alone, while that value is
            # withheld; a marker anywhere else is refused by the scan below.
            for name in await self._withheld_now(ctx, report, marked):
                del changes[name]
                if name == "body_md" and "source_sha" not in payload.model_fields_set:
                    changes.pop("source_sha", None)  # the body did not change
        if not changes_anything(report, changes):
            served = await self._read(ctx, report)
            return served, served
        # The version being written is scanned whole: a term added since the
        # last write refuses an edit until the narrative no longer names it.
        await self._refuse_narrative(
            ctx,
            {name: changes.get(name, getattr(report, name)) for name in _NARRATIVE},
        )
        before = await self._stored_read(ctx, report)
        bump_version(report, changes, ctx.access.actor)
        provenance = self._snapshot(ctx, report)
        await ctx.db.flush()
        await ctx.db.refresh(report)
        return before, await self._read(ctx, report, provenance)

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> ReportRead:
        """The report, its versions and its snapshots go together (the
        snapshots' history ends with the report it belonged to)."""
        report = await self._load(ctx, record_id, lock=True)
        if report.current_version != expected_version:
            raise StaleVersion(await self._read(ctx, report))
        before = await self._stored_read(ctx, report)
        await ctx.db.delete(report)
        await ctx.db.flush()
        return before


def report_store() -> ReportStore:
    """FastAPI dependency (a class instance so tests can override it)."""
    return ReportStore()


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------


def _withheld(violations: list[Violation]) -> list[WithheldSlot]:
    return [WithheldSlot(slot=v.slot, reason=v.kind) for v in violations]


def _served_identity(
    row: ReportSnapshot, matcher: TermMatcher
) -> tuple[str | None, str | None, list[Violation]]:
    """A snapshot row's file path and withdrawal reason as a reader is served
    them: under the project's CURRENT confidential terms, a value naming one
    reading ``[withheld]`` whole. The stored values are unchanged (the path
    stays the snapshot's identity, and the ``source_path`` filter matches
    it)."""
    served: list[str | None] = []
    withheld: list[Violation] = []
    for slot, text in (
        ("source_path", row.source_path),
        ("withdrawn_reason", row.withdrawn_reason),
    ):
        if text is not None and matcher.matches(text):
            served.append(WITHHELD)
            withheld.append(Violation(slot, "confidential_term"))
        else:
            served.append(text)
    return served[0], served[1], withheld


def _snapshot_read(
    row: ReportSnapshot,
    *,
    label: str,
    method_label: str,
    matcher: TermMatcher,
    data: dict[str, Any] | None = None,
    withheld: list[Violation] | None = None,
) -> ReportSnapshotRead:
    """Every snapshot answer is built here, so none serves the file path or
    the withdrawal reason without the current terms' pass (``matcher``)."""
    source_path, withdrawn_reason, held = _served_identity(row, matcher)
    return ReportSnapshotRead(
        id=str(row.id),
        report_id=row.report_id,
        seq=row.seq,
        version=row.version,
        label=label,
        as_of=row.as_of,
        method_kind=row.method_kind,  # type: ignore[arg-type]
        method_label=method_label,
        source_path=source_path,
        content_sha256=row.content_sha256,
        allowlist_version=row.allowlist_version,
        scope_version=row.scope_version,
        withdrawn=row.withdrawn_at is not None,
        withdrawn_at=row.withdrawn_at,
        withdrawn_reason=withdrawn_reason,
        created_at=row.created_at,
        created_by=row.created_by,
        via_device=row.via_device,
        via_session=row.via_session,
        data=data,
        withheld=_withheld([*(withheld or []), *held]),
    )


def _row_read(
    row: ReportSnapshot, scope: ReadScope, matcher: TermMatcher
) -> ReportSnapshotRead:
    """A snapshot ROW without its document: the label and method label it
    copies out of the document are treated as the document's would be. A
    withdrawn snapshot's row names its document as withheld: it is kept as
    history and never served (D1), to a list, a single read or a write's
    answer alike."""
    withheld: list[Violation] = []
    texts: list[str] = []
    for slot, text in (("label", row.label), ("method.label", row.method_label)):
        served, slots = treat_label(
            text,
            slot=slot,
            allowlist_version=row.allowlist_version,
            scope_version=row.scope_version,
            scope=scope,
            matcher=matcher,
        )
        texts.append(served)
        withheld.extend(slots)
    if row.withdrawn_at is not None:
        withheld.append(Violation("data", "withdrawn"))
    return _snapshot_read(
        row, label=texts[0], method_label=texts[1], matcher=matcher, withheld=withheld
    )


@dataclass
class _Served:
    """One stored snapshot as a reader may see it."""

    row: ReportSnapshot
    data: dict[str, Any] | None
    withheld: list[Violation]


async def _scope_for(ctx: StoreContext, rows: list[ReportSnapshot]) -> ReadScope:
    """The scope a read of ``rows`` (their ``data`` loaded) applies. The
    first-party owners are read only when a document carries a link."""
    stored = await _stored_scope(ctx)
    owners = stored.owners
    if owners is None and any(_has_links(row.data) for row in rows):
        owners = await _first_party_owners(ctx, stored)
    return _read_scope(stored, owners)


async def _treat(rows: list[ReportSnapshot], scope: ReadScope) -> list[_Served]:
    """Apply today's contract and ``scope`` to stored snapshots, off the
    event loop (a re-scan reads every string of every document)."""
    matcher = TermMatcher(scope.terms)

    def treat_all() -> list[_Served]:
        out = []
        for row in rows:
            treated = treat_for_read(
                row.data,
                allowlist_version=row.allowlist_version,
                scope_version=row.scope_version,
                scope=scope,
                matcher=matcher,
            )
            out.append(_Served(row, treated.data, treated.withheld))
        return out

    served: list[_Served] = await scan_off_loop(treat_all)
    return served


def _served_read(served: _Served, matcher: TermMatcher) -> ReportSnapshotRead:
    """A single read: the document as served, and the labels taken from it
    (a withheld document's labels read ``[withheld]`` too)."""
    if served.data is None:
        return _snapshot_read(
            served.row,
            label=WITHHELD,
            method_label=WITHHELD,
            matcher=matcher,
            withheld=served.withheld,
        )
    return _snapshot_read(
        served.row,
        label=served.data["label"],
        method_label=served.data["method"]["label"],
        matcher=matcher,
        data=served.data,
        withheld=served.withheld,
    )


class ReportSnapshotStore:
    #: A snapshot's ``(report_id, source_path)`` is its own identity: a
    #: re-post of the same file is the same create, keyed or not.
    adopts_without_key = True

    async def _load(
        self,
        ctx: StoreContext,
        record_id: str,
        *,
        lock: bool = False,
        with_data: bool = False,
    ) -> ReportSnapshot:
        stmt = select(ReportSnapshot).where(
            ReportSnapshot.id == _parse_id(record_id),
            ReportSnapshot.tenant_id == ctx.access.tenant_id,
        )
        if with_data:
            stmt = stmt.options(undefer(ReportSnapshot.data))
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        row = (await ctx.db.execute(stmt)).scalars().first()
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def _by_source(
        self, ctx: StoreContext, report_id: UUID, source_path: str
    ) -> ReportSnapshot | None:
        stmt = select(ReportSnapshot).where(
            ReportSnapshot.tenant_id == ctx.access.tenant_id,
            ReportSnapshot.report_id == report_id,
            ReportSnapshot.source_path == source_path,
        )
        return (await ctx.db.execute(stmt)).scalars().first()

    async def _bare_read(
        self, ctx: StoreContext, row: ReportSnapshot
    ) -> ReportSnapshotRead:
        stored = await _stored_scope(ctx)
        scope = _read_scope(stored, stored.owners)
        return _row_read(row, scope, TermMatcher(scope.terms))

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        stmt = select(ReportSnapshot).where(
            ReportSnapshot.tenant_id == ctx.access.tenant_id
        )
        # Exact matches; a given filter whose values are all unusable matches
        # nothing, never everything.
        if filters.get("report_id"):
            ids: list[UUID] = []
            for raw in filters["report_id"]:
                try:
                    ids.append(UUID(raw.strip()))
                except ValueError:
                    continue
            stmt = stmt.where(ReportSnapshot.report_id.in_(ids))
        if filters.get("source_path"):
            paths = [v.strip() for v in filters["source_path"]]
            stmt = stmt.where(ReportSnapshot.source_path.in_([p for p in paths if p]))
        if filters.get("withdrawn"):
            wanted = {v.strip().lower() for v in filters["withdrawn"]}
            if wanted == {"true"}:
                stmt = stmt.where(ReportSnapshot.withdrawn_at.is_not(None))
            elif wanted == {"false"}:
                stmt = stmt.where(ReportSnapshot.withdrawn_at.is_(None))
            elif not wanted <= {"true", "false"}:
                stmt = stmt.where(false())
        rows = list(
            (
                await ctx.db.execute(
                    stmt.order_by(
                        ReportSnapshot.report_id,
                        ReportSnapshot.as_of,
                        ReportSnapshot.seq,
                    ).limit(500)
                )
            )
            .scalars()
            .all()
        )
        stored = await _stored_scope(ctx)
        scope = _read_scope(stored, stored.owners)
        matcher = TermMatcher(scope.terms)
        return ListResult(items=[_row_read(row, scope, matcher) for row in rows])

    async def get(self, ctx: StoreContext, record_id: str) -> ReportSnapshotRead:
        row = await self._load(ctx, record_id, with_data=True)
        if row.withdrawn_at is not None:
            # Withdrawn: the row is served as history, its document is not
            # (``withheld`` names ``data``). A restore needs no document.
            return await self._bare_read(ctx, row)
        scope = await _scope_for(ctx, [row])
        (served,) = await _treat([row], scope)
        return _served_read(served, TermMatcher(scope.terms))

    async def create(
        self, ctx: StoreContext, payload: ReportSnapshotCreate
    ) -> ReportSnapshotRead:
        stored = await _stored_scope(ctx)
        checked = await scan_off_loop(
            functools.partial(check_snapshot, terms=stored.terms), payload.document
        )
        # The file's path is served on every read of the snapshot, and a
        # publisher names files after what they hold: it gets the narrative
        # scans. Listed first, so a long refusal never cuts it from the list.
        violations = [
            *(
                narrative_violations(
                    {"source_path": payload.source_path}, terms=stored.terms
                )
                if payload.source_path is not None
                else []
            ),
            *checked.violations,
        ]
        if violations:
            raise _rejected("snapshot_rejected", violations, "snapshot")
        if checked.links:
            owners = await _first_party_owners(ctx, stored)
            if owners is None:
                raise StoreRefused(
                    503,
                    "presentation_scope_unknown",
                    "This snapshot carries a GitHub link, and the project's "
                    "first-party owners cannot be read right now, so the link "
                    "cannot be checked. Nothing was written; try again, or have "
                    "a project admin set the first-party owners in the "
                    "presentation scope.",
                )
            foreign = foreign_link_owners(payload.document, owners)
            if foreign:
                raise _rejected("snapshot_rejected", foreign, "snapshot")
        doc = checked.doc
        assert doc is not None  # no violations means the shape passed
        # The report is locked for the rest of the write: concurrent creates
        # on one report queue here, so each reads the seq the last one wrote.
        report = (
            (
                await ctx.db.execute(
                    select(Report)
                    .where(
                        Report.id == payload.report_id,
                        Report.tenant_id == ctx.access.tenant_id,
                    )
                    .with_for_update()
                )
            )
            .scalars()
            .first()
        )
        if report is None:
            raise StoreRefused(
                422, "unknown_report", "There is no such report in this project."
            )
        if payload.source_path is not None and await self._by_source(
            ctx, report.id, payload.source_path
        ):
            raise self._path_taken(payload.source_path)
        seq = (
            await ctx.db.execute(
                select(func.coalesce(func.max(ReportSnapshot.seq), 0)).where(
                    ReportSnapshot.report_id == report.id
                )
            )
        ).scalar_one() + 1
        provenance = write_provenance(ctx)
        row = ReportSnapshot(
            tenant_id=ctx.access.tenant_id,
            report_id=report.id,
            seq=seq,
            version=1,
            label=doc.label,
            as_of=doc.as_of,
            method_kind=doc.method.kind,
            method_label=doc.method.label,
            data=payload.document,
            content_sha256=content_sha256(payload.document),
            allowlist_version=REPORT_ALLOWLIST_VERSION,
            scope_version=stored.version,
            source_path=payload.source_path,
            created_by=ctx.access.actor,
            via_device=provenance[0],
            via_session=provenance[1],
        )
        try:
            async with ctx.db.begin_nested():
                ctx.db.add(row)
                await ctx.db.flush()
                # The stored document must re-serialize to the sha the writer
                # computed: a number the database spells differently (1e16
                # read back as an integer, -0.0 as 0.0) is refused, inside the
                # savepoint, so nothing is left behind.
                await ctx.db.refresh(row, attribute_names=["data"])
                drifted = first_storage_difference(payload.document, row.data)
                if drifted is not None:
                    raise _rejected(
                        "snapshot_rejected",
                        [Violation(drifted, "not_storable")],
                        "snapshot",
                    )
        except IntegrityError as exc:
            # Under the report's lock only a concurrent publish of the same
            # file can collide; anything else is a fault, not a refusal.
            if payload.source_path is None:
                raise
            raise self._path_taken(payload.source_path) from exc
        await ctx.db.refresh(row)
        return _snapshot_read(
            row,
            label=doc.label,
            method_label=doc.method.label,
            matcher=TermMatcher(stored.terms),
        )

    async def _refuse_reason(self, ctx: StoreContext, reason: str) -> None:
        """422 ``snapshot_rejected`` when a withdrawal's reason names a
        confidential term, an email-shaped identity, an IP address or an
        account id: the reason is served on every read of the snapshot and
        kept in the change log, so it gets the narrative scans."""
        stored = await _stored_scope(ctx)
        violations = narrative_violations(
            {"withdrawn_reason": reason}, terms=stored.terms
        )
        if violations:
            raise _rejected("snapshot_rejected", violations, "withdrawal")

    def _path_taken(self, source_path: str) -> StoreRefused:
        return StoreRefused(
            409,
            "name_taken",
            f"This report already has a snapshot published from {source_path}.",
        )

    async def adopt_existing(
        self,
        ctx: StoreContext,
        payload: ReportSnapshotCreate,
        created_through_overview: Any,
    ) -> ReportSnapshotRead | None:
        """The snapshot a create refused as ``name_taken`` names by its file:
        the same content is that snapshot published again — the stored one is
        the answer, and nothing is written. Other content is refused, 409
        ``snapshot_changed_at_source``: a snapshot is immutable, so a changed
        file is a new snapshot (a new file) and the old one is withdrawn.
        ``created_through_overview`` is unused: a snapshot and its change-log
        row commit together."""
        del created_through_overview
        if payload.source_path is None:
            return None
        row = await self._by_source(ctx, payload.report_id, payload.source_path)
        if row is None:
            return None
        if row.content_sha256 != content_sha256(payload.document):
            raise StoreRefused(
                409,
                "snapshot_changed_at_source",
                f"The snapshot published from {payload.source_path} has other "
                "content. Snapshots are never changed: publish the correction "
                "as a new file, and withdraw the old snapshot.",
            )
        return await self._bare_read(ctx, row)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: ReportSnapshotUpdate,
        expected_version: int,
    ) -> tuple[ReportSnapshotRead, ReportSnapshotRead]:
        row = await self._load(ctx, record_id, lock=True)
        before = await self._bare_read(ctx, row)
        if row.version != expected_version:
            raise StaleVersion(before)
        if payload.withdrawn:
            if row.withdrawn_reason == payload.withdrawn_reason:
                return before, before
            assert payload.withdrawn_reason is not None  # the model requires one
            await self._refuse_reason(ctx, payload.withdrawn_reason)
            row.withdrawn_at = row.withdrawn_at or datetime.now(UTC)
            row.withdrawn_reason = payload.withdrawn_reason
        else:
            if row.withdrawn_at is None:
                return before, before
            row.withdrawn_at = None
            row.withdrawn_reason = None
        row.version += 1
        await ctx.db.flush()
        await ctx.db.refresh(row)
        return before, await self._bare_read(ctx, row)


def report_snapshot_store() -> ReportSnapshotStore:
    """FastAPI dependency (a class instance so tests can override it)."""
    return ReportSnapshotStore()


# ---------------------------------------------------------------------------
# Routes beyond the contract: the view, versions, revert
# ---------------------------------------------------------------------------

router = APIRouter()


def _ctx(access: OverviewAccess, db: AsyncSession, request: Request) -> StoreContext:
    return StoreContext(access=access, db=db, request=request)


async def _report_or_404(ctx: StoreContext, report_id: str) -> Report:
    try:
        return await ReportStore()._load(ctx, report_id)
    except RecordNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "There is no such report here."},
        ) from exc


class ReportView(BaseModel):
    """A report's timeline (D10)."""

    report: ReportRead
    #: The stops a reader is shown, oldest first, in ``(as_of, seq)`` order.
    snapshots: list[ViewSnapshot]
    #: What this view did not serve (a whole stop, or a slot of one).
    withheld: list[WithheldEntry]
    #: Stops served on this page.
    shown: int
    #: Every stop of the report that is not withdrawn.
    total: int
    #: More stops come before this page (read them with ``before=``).
    truncated: bool


def _view_snapshot(
    served: _Served, changes: SnapshotChanges | None, source_path: str | None
) -> ViewSnapshot:
    """``source_path`` is the file path as served (:func:`_served_identity`)."""
    row, data = served.row, served.data
    assert data is not None
    return ViewSnapshot(
        id=str(row.id),
        seq=row.seq,
        version=row.version,
        label=data["label"],
        as_of=row.as_of,
        method_kind=row.method_kind,
        method_label=data["method"]["label"],
        source_path=source_path,
        content_sha256=row.content_sha256,
        allowlist_version=row.allowlist_version,
        scope_version=row.scope_version,
        created_at=row.created_at,
        created_by=row.created_by,
        via_device=row.via_device,
        via_session=row.via_session,
        data=data,
        changes_since_previous=changes,
    )


@router.get("/reports/{report_id}/view", response_model=ReportView)
async def read_report_view(
    report_id: str,
    request: Request,
    before: int | None = Query(
        default=None,
        ge=1,
        description="Read the stops ordered before the stop with this seq.",
    ),
    access: OverviewAccess = Depends(require_read("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> ReportView:
    """The report and its stops in time order, each with what changed since
    the previous stop a reader is shown (D10). At most the newest
    ``PAGE_SIZE`` (48) stops; ``before=<seq>`` pages back."""
    ctx = _ctx(access, db, request)
    report = await _report_or_404(ctx, report_id)
    keys = (
        await db.execute(
            select(ReportSnapshot.id, ReportSnapshot.seq, ReportSnapshot.as_of)
            .where(
                ReportSnapshot.report_id == report.id,
                ReportSnapshot.tenant_id == access.tenant_id,
                ReportSnapshot.withdrawn_at.is_(None),
            )
            .order_by(ReportSnapshot.as_of, ReportSnapshot.seq)
        )
    ).all()
    count_before = len(keys)
    if before is not None:
        anchor = (
            await db.execute(
                select(ReportSnapshot.as_of, ReportSnapshot.seq).where(
                    ReportSnapshot.report_id == report.id,
                    ReportSnapshot.tenant_id == access.tenant_id,
                    ReportSnapshot.seq == before,
                )
            )
        ).first()
        if anchor is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "not_found",
                    "message": "This report has no stop with that seq.",
                },
            )
        count_before = sum(1 for k in keys if (k.as_of, k.seq) < tuple(anchor))
    page = window(count_before)

    async def load(ids: list[UUID]) -> dict[UUID, ReportSnapshot]:
        if not ids:
            return {}
        rows = await db.execute(
            select(ReportSnapshot)
            .options(undefer(ReportSnapshot.data))
            .where(ReportSnapshot.id.in_(ids))
        )
        return {row.id: row for row in rows.scalars().all()}

    # A stop whose row is gone by the time it is loaded (its report deleted
    # between the two reads) is skipped, never a KeyError.
    loaded = await load([keys[i].id for i in page.page])
    page_rows = [loaded[keys[i].id] for i in page.page if keys[i].id in loaded]
    scope = await _scope_for(ctx, page_rows)
    served = await _treat(page_rows, scope)
    # The stop a page's first stop compares with lies before the page: the
    # nearest one a reader would be shown, withheld ones skipped. Only its
    # values and statuses are read, so the page's scope serves for it.
    previous: Stop | None = None
    for position in range(page.page.start - 1, -1, -1):
        candidate = (await load([keys[position].id])).get(keys[position].id)
        if candidate is None:
            continue
        (treated,) = await _treat([candidate], scope)
        if treated.data is not None:
            previous = Stop(treated.row.seq, treated.row.as_of, treated.data)
            break
    matcher = TermMatcher(scope.terms)
    snapshots: list[ViewSnapshot] = []
    withheld: list[WithheldEntry] = []
    for entry in served:
        withheld.extend(
            WithheldEntry(seq=entry.row.seq, slot=v.slot, reason=v.kind)
            for v in entry.withheld
        )
        if entry.data is None:
            continue
        source_path, _reason, held = _served_identity(entry.row, matcher)
        withheld.extend(
            WithheldEntry(seq=entry.row.seq, slot=v.slot, reason=v.kind) for v in held
        )
        current = Stop(entry.row.seq, entry.row.as_of, entry.data)
        snapshots.append(
            _view_snapshot(
                entry,
                None if previous is None else changes_between(previous, current),
                source_path,
            )
        )
        previous = current
    return ReportView(
        report=await ReportStore()._read(ctx, report),
        snapshots=snapshots,
        withheld=withheld,
        shown=len(snapshots),
        total=len(keys),
        truncated=page.truncated,
    )


@router.get("/reports/{report_id}/versions", response_model=ReportVersionList)
async def list_report_versions(
    report_id: str,
    request: Request,
    access: OverviewAccess = Depends(require_read("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> ReportVersionList:
    """Every version of a report's narrative, newest first. A title naming
    one of the project's current confidential terms reads ``[withheld]``."""
    ctx = _ctx(access, db, request)
    report = await _report_or_404(ctx, report_id)
    rows = await versions_of(
        db,
        tenant_id=access.tenant_id,
        version_model=ReportVersion,
        record_fk=ReportVersion.report_id,
        record_id=report.id,
    )
    served = await _served_texts(ctx, [{"title": v.title} for v in rows])
    return ReportVersionList(
        versions=[
            ReportVersionSummary(
                version=v.version,
                title=fields["title"],
                created_at=v.created_at,
                created_by=v.created_by,
                source_sha=v.source_sha,
                via_device=v.via_device,
                via_session=v.via_session,
                withheld=_withheld(withheld),
            )
            for v, (fields, withheld) in zip(rows, served, strict=True)
        ],
        current_version=report.current_version,
    )


async def _report_version(
    db: AsyncSession, tenant_id: UUID, report: Report, version: int
) -> ReportVersion:
    row: ReportVersion = await version_or_404(
        db,
        tenant_id=tenant_id,
        version_model=ReportVersion,
        record_fk=ReportVersion.report_id,
        record_id=report.id,
        version=version,
    )
    return row


@router.get("/reports/{report_id}/versions/{version}", response_model=ReportVersionRead)
async def read_report_version(
    report_id: str,
    version: int,
    request: Request,
    access: OverviewAccess = Depends(require_read("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> ReportVersionRead:
    """One version of a report's narrative. A field naming one of the
    project's current confidential terms reads ``[withheld]``."""
    ctx = _ctx(access, db, request)
    report = await _report_or_404(ctx, report_id)
    v = await _report_version(db, access.tenant_id, report, version)
    ((fields, withheld),) = await _served_texts(ctx, [_text_fields(v)])
    return ReportVersionRead(
        version=v.version,
        title=fields["title"],
        created_at=v.created_at,
        created_by=v.created_by,
        source_sha=v.source_sha,
        via_device=v.via_device,
        via_session=v.via_session,
        summary=fields["summary"],
        body_md=fields["body_md"],
        withheld=_withheld(withheld),
    )


@router.post(
    "/reports/{report_id}/versions/{version}/revert", response_model=ReportItem
)
async def revert_report(
    report_id: str,
    version: int,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    access: OverviewAccess = Depends(require_edit("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """Restore an earlier version of the narrative by writing it as a NEW
    version, under the same contract as any write: ``If-Match`` names the
    version the reader saw, and a report that has moved on is a 409 carrying
    the server's copy. The restored narrative is scanned as any write is."""
    expected = contract_http.parse_if_match(if_match)
    ctx = _ctx(access, db, request)
    store = ReportStore()
    try:
        report = await store._load(ctx, report_id, lock=True)
    except RecordNotFound as exc:
        raise contract_http.not_found() from exc
    target = await _report_version(db, access.tenant_id, report, version)
    payload = ReportUpdate(
        title=target.title,
        summary=target.summary,
        body_md=target.body_md,
        **restored_source(report, target.source_sha),
    )
    try:
        before, after = await store.update(ctx, report_id, payload, expected)
    except StaleVersion as exc:
        return contract_http.stale(exc)
    except StoreRefused as exc:
        return contract_http.refused(exc)
    await log_revert(
        db,
        access=access,
        request=request,
        resource="reports",
        before=before,
        after=after,
        reverted_to=version,
        audit_exclude=frozenset({"body_md"}),
    )
    response.headers["ETag"] = contract_http.etag(after.version)
    return ReportItem(item=after, can_edit=True)


__all__ = [
    "PAGE_SIZE",
    "ReportCreate",
    "ReportRead",
    "ReportSnapshotCreate",
    "ReportSnapshotRead",
    "ReportSnapshotStore",
    "ReportSnapshotUpdate",
    "ReportStore",
    "ReportUpdate",
    "report_snapshot_store",
    "report_store",
    "router",
]
