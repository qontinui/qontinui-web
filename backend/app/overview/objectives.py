"""The project's objectives and how each measure is doing — ``GET /objectives``.

Plan ``2026-10-06-overview-objectives-view`` Phase 1 (design decisions D3, D5–D8).
One server-side join, so the browser parses no prose and no YAML:

* the ``initiative`` and ``success_metric`` intent documents, read through
  :class:`~app.overview.intent_documents.IntentDocumentStore` (its skeleton /
  unreadable classification and its bounded fan-out — no second classifier);
* each metric's frontmatter, parsed by ``yaml.SafeLoader``'s rules within a
  size, depth and no-alias bound (:mod:`app.overview.objectives_frontmatter`)
  and served typed, every date normalised to an ISO string, every field
  nullable, a malformed block — or a crash building one document — reported
  on that document and never failing the page;
* the checkpoint reports, found in coord's findings by the metric document's
  resource keys (ONE read per metric, so one busy metric's notices cannot
  truncate another's) plus a by-id read of the ids the document records in its
  ``results:`` list and of every result row's evidence finding (a by-id read
  serves a row past its 14-day list expiry, and supplies each report's body).
  Only THIS project's findings are ever reports: coord also serves every
  project's ``scope: fleet-infra`` findings, and a row whose ``tenant_id`` is
  not the active project's is set aside and counted, never placed;
* every verdict ROW, read from coord's checkpoint results table through its
  door (:mod:`app.overview.objectives_results`, Phase 4) — never rebuilt from
  a finding's ``artifact_refs.metric_checkpoint`` block. The block is still
  checked by the strict ``metric-checkpoint/v1`` validator
  (:mod:`app.overview.metric_checkpoint`), so an invalid one says "the result
  could not be read" with the reason rather than "rows not yet recorded".

**Nothing unobserved reads as a result.** The denominator is the criteria the
document DECLARES; a declared criterion no report covers is UNKNOWN with the
reason, never MET and never blank. Every upstream gap — a findings read coord
did not answer, a page that came back full, an id that did not load — is named
in ``sources`` and on the criteria it touches, so the page can say "results
can't be read" rather than "no results".

**Attested, not recomputed.** A verdict is the one the measuring session
stated. The overview never derives MET / MISSED from a number.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.overview.intent_documents import (
    LIST_CONCURRENCY,
    IntentDocumentRead,
    IntentDocumentStore,
    intent_document_store,
)
from app.overview.metric_checkpoint import (
    is_uuid,
)
from app.overview.objectives_frontmatter import (
    build_initiative,
    build_metric,
    initiative_read_failed,
    metric_read_failed,
    parse_frontmatter,
    title_of_document,
)
from app.overview.objectives_join import (
    MAX_RESULT_ID_READS,
    ByIdResult,
    CoordFindings,
    MetricFindings,
    ProxiedCoordFindings,
    coord_findings,
    foreign_findings_note,
    join_results,
    read_by_id,
    read_metric_findings,
)
from app.overview.objectives_models import (
    CriterionResultRead,
    InitiativeRead,
    MetricRead,
    ObjectivesRead,
    ObjectivesSources,
    SourceRead,
    TallyRead,
)
from app.overview.objectives_results import (
    CheckpointRows,
    MetricRows,
    checkpoint_results_source,
    read_checkpoint_results,
)
from app.overview.permissions import OverviewAccess, require_read
from app.overview.resource import StoreContext

logger = structlog.get_logger(__name__)

# ===========================================================================
# Assembly
# ===========================================================================


def _readable(initiative: InitiativeRead) -> bool:
    """An initiative whose frontmatter was read; for any other, whether it is
    live and what it declares are unknown."""
    return initiative.frontmatter_error is None and initiative.state in (
        "authored",
        "unknown",
    )


def _group(
    initiatives: list[InitiativeRead],
    metrics: list[MetricRead],
    *,
    every_initiative_read: bool,
) -> tuple[list[str], list[str]]:
    """Fill each objective's ``metric_names`` and each metric's
    ``serves_unknown`` / ``serves_unchecked``; return ``(initiative_named,
    other)``.

    A ``serves:`` id no readable initiative declares is one NO initiative
    declares only when ``every_initiative_read``; otherwise an initiative
    nobody could read may declare it, so it can't be checked."""
    readable = [i for i in initiatives if _readable(i)]
    known = {o.id for i in readable for o in i.objectives}
    live_ids = {o.id for i in readable if i.live for o in i.objectives}
    named = {n for i in readable if i.live for n in i.success_metrics}
    shown = {m.name for m in metrics}
    for initiative in readable:
        for objective in initiative.objectives:
            objective.metric_names = [
                m.name for m in metrics if objective.id in m.serves
            ]
        initiative.missing_metric_names = [
            n for n in initiative.success_metrics if n not in shown
        ]
    initiative_named: list[str] = []
    other: list[str] = []
    for metric in metrics:
        undeclared = [s for s in metric.serves if s not in known]
        if every_initiative_read:
            metric.serves_unknown = undeclared
        else:
            metric.serves_unchecked = undeclared
        if any(s in live_ids for s in metric.serves):
            continue
        (initiative_named if metric.name in named else other).append(metric.name)
    return initiative_named, other


def _initiative_problems(
    initiatives: list[InitiativeRead],
    skeletons: int,
    voids: int = 0,
    degraded: str | None = None,
) -> list[str]:
    """Why the objectives can't be read; empty when they can.

    No initiative document at all is NOT a problem — the project simply has
    none written yet, and the page says so. But a degraded listing cannot
    vouch for that absence, so it is one."""
    problems: list[str] = []
    for i in initiatives:
        if i.state == "unreadable":
            problems.append(
                f"initiative/{i.name} could not be read ({i.error or 'unreadable'})"
            )
        elif i.frontmatter_error:
            problems.append(f"initiative/{i.name}: {i.frontmatter_error}")
    written = [i for i in initiatives if i.state in ("authored", "unknown")]
    if not written:
        if voids:
            problems.append(
                "every written initiative is marked as published to the wrong project"
            )
        elif skeletons:
            problems.append(
                "no initiative has been written yet (only coord's skeleton exists)"
            )
        elif degraded:
            problems.append(
                "coord's document list is incomplete, so whether an initiative "
                "exists is unknown"
            )
    return problems


async def build_objectives(
    ctx: StoreContext,
    store: IntentDocumentStore,
    coord: CoordFindings,
    *,
    now: datetime,
) -> ObjectivesRead:
    tenant_id = ctx.access.tenant_id
    try:
        listing = await store.list(ctx, {"kind": ["initiative", "success_metric"]})
    except Exception as exc:  # a gap is reported, never a 500
        if not isinstance(exc, HTTPException):
            logger.exception("overview_objectives_documents_read_failed")
        status = exc.status_code if isinstance(exc, HTTPException) else None
        unread = SourceRead(
            status="unavailable",
            reason="The findings were not read because the documents could not be.",
        )
        return ObjectivesRead(
            tenant_id=tenant_id,
            generated_at=now,
            initiatives=[],
            earlier_initiatives_count=0,
            objectives_readable=False,
            metrics=[],
            initiative_named_metrics=[],
            other_metrics=[],
            skeletons_hidden=0,
            void_metric_names=[],
            void_initiative_names=[],
            sources=ObjectivesSources(
                intent_documents=SourceRead(
                    status="unavailable",
                    reason=(
                        "coord did not answer the intent-document list "
                        + (
                            f"(HTTP {status})."
                            if status
                            else f"({type(exc).__name__})."
                        )
                    ),
                ),
                findings=unread,
                findings_by_id=unread,
                checkpoint_results=SourceRead(
                    status="unavailable",
                    reason=(
                        "The checkpoint results were not read because the "
                        "documents could not be."
                    ),
                ),
            ),
        )
    docs = [d for d in listing.items if isinstance(d, IntentDocumentRead)]

    initiatives: list[InitiativeRead] = []
    metrics: list[MetricRead] = []
    skeletons = 0
    initiative_skeletons = 0
    void_metric_names: list[str] = []
    void_initiative_names: list[str] = []
    for doc in docs:
        if doc.state == "skeleton":
            skeletons += 1
            if doc.kind == "initiative":
                initiative_skeletons += 1
            continue
        if doc.kind == "initiative":
            initiative, is_void_initiative = _build_one_initiative(doc)
            if is_void_initiative:
                void_initiative_names.append(doc.name)
            else:
                initiatives.append(initiative)
            continue
        metric, is_void_doc = _build_one_metric(doc)
        if is_void_doc:
            void_metric_names.append(doc.name)
        else:
            metrics.append(metric)

    problems = _initiative_problems(
        initiatives, initiative_skeletons, len(void_initiative_names), listing.degraded
    )
    initiative_named, other = _group(
        initiatives,
        metrics,
        # A degraded list may be missing an initiative, too.
        every_initiative_read=not problems and not listing.degraded,
    )
    initiatives.sort(key=lambda i: (not i.live, i.name))

    # Findings: one list read per readable metric, then by id the recorded
    # results the list reads did not already return.
    # The checkpoint results (every verdict row): one door read per metric,
    # beside them and under the same bound.
    gate = asyncio.Semaphore(LIST_CONCURRENCY)
    readable = [m for m in metrics if m.state != "unreadable"]
    listed_reads, table = await asyncio.gather(
        asyncio.gather(
            *(read_metric_findings(coord, tenant_id, m.name, gate) for m in readable)
        ),
        read_checkpoint_results(coord, tenant_id, [m.name for m in readable], gate),
    )
    listed = dict(zip((m.name for m in readable), listed_reads, strict=True))
    # A recorded id any metric's list read already returned needs no by-id
    # read — whichever metric's page it came back on.
    listed_anywhere = {
        str(f["finding_id"]): f for r in listed_reads for f in r.findings
    }
    by_id: dict[str, ByIdResult] = {}
    wanted: list[str] = []
    # Recorded ids first, then each result row's evidence finding (its body).
    candidates = [e.finding_id for m in readable for e in m.results] + [
        fid for m in readable for fid in table.for_metric(m.name).by_finding
    ]
    for fid in candidates:
        if not fid or not is_uuid(fid) or fid in by_id or fid in wanted:
            continue
        if fid in listed_anywhere:
            by_id[fid] = ByIdResult(finding=listed_anywhere[fid])
        else:
            wanted.append(fid)
    to_read, over = wanted[:MAX_RESULT_ID_READS], wanted[MAX_RESULT_ID_READS:]
    by_id_reads = await asyncio.gather(
        *(read_by_id(coord, tenant_id, fid, gate) for fid in to_read)
    )
    read_now = dict(zip(to_read, by_id_reads, strict=True))
    by_id.update(read_now)
    for metric in readable:
        _join_one(metric, listed, by_id, now, table)

    return ObjectivesRead(
        tenant_id=tenant_id,
        generated_at=now,
        initiatives=initiatives,
        earlier_initiatives_count=sum(
            1 for i in initiatives if not i.live and _readable(i)
        ),
        objectives_readable=not problems,
        metrics=metrics,
        initiative_named_metrics=initiative_named,
        other_metrics=other,
        skeletons_hidden=skeletons,
        void_metric_names=sorted(void_metric_names),
        void_initiative_names=sorted(void_initiative_names),
        sources=ObjectivesSources(
            intent_documents=_documents_source(listing.degraded, problems, metrics),
            findings=_findings_source(listed),
            findings_by_id=_by_id_source(read_now, over),
            checkpoint_results=checkpoint_results_source(table),
        ),
    )


def _build_one_metric(doc: IntentDocumentRead) -> tuple[MetricRead, bool]:
    """One metric document's read. A crash marks THAT document — shown, its
    definition unreadable — and never fails the page."""
    try:
        return build_metric(doc)
    except Exception as exc:
        logger.exception("overview_objectives_metric_build_failed", metric=doc.name)
        return metric_read_failed(doc, exc), False


def _build_one_initiative(doc: IntentDocumentRead) -> tuple[InitiativeRead, bool]:
    """One initiative document's read; a crash marks THAT document, which
    makes the objectives unreadable rather than failing the page."""
    try:
        return build_initiative(doc)
    except Exception as exc:
        logger.exception(
            "overview_objectives_initiative_build_failed", initiative=doc.name
        )
        return initiative_read_failed(doc, exc), False


def _join_one(
    metric: MetricRead,
    listed: dict[str, MetricFindings],
    by_id: dict[str, ByIdResult],
    now: datetime,
    table: CheckpointRows,
) -> None:
    """Join one metric's reports. An unexpected crash degrades THAT metric —
    its findings read as unavailable, its criteria UNKNOWN with the reason —
    and never fails the page."""
    rows = table.for_metric(metric.name)
    try:
        join_results(metric, listed[metric.name], by_id, now, rows)
        return
    except Exception as exc:
        logger.exception("overview_objectives_join_failed", metric=metric.name)
        failed = MetricFindings(
            state="unavailable",
            reason=(
                "the checkpoint reports could not be joined to this measure "
                f"({type(exc).__name__})."
            ),
        )
    listed[metric.name] = failed
    # Every recorded result reads as not read BECAUSE the join failed —
    # never as an over-the-limit skip, which an empty ``by_id`` would say.
    failed_by_id = {
        entry.finding_id: ByIdResult(reason="read_failed", detail=failed.reason or "")
        for entry in metric.results
        if entry.finding_id
    }
    try:
        join_results(
            metric,
            failed,
            failed_by_id,
            now,
            MetricRows(state=rows.state, reason=rows.reason),
        )
    except Exception:
        logger.exception("overview_objectives_join_fallback_failed", metric=metric.name)
        metric.findings_read = "unavailable"
        metric.checkpoint_results_read = rows.state
        metric.checkpoint_results = []
        metric.related_notes = []
        metric.unresolved_results = []
        metric.tally_latest = TallyRead(unknown=len(metric.criteria))
        metric.criteria_latest = [
            CriterionResultRead(
                id=c.id,
                checkpoint=c.checkpoint,
                target=c.target,
                method=c.method,
                verdict="unknown",
                unknown_reason="results_unreadable",
            )
            for c in metric.criteria
        ]


def _documents_source(
    degraded: str | None,
    problems: list[str],
    metrics: list[MetricRead],
) -> SourceRead:
    reasons: list[str] = []
    affected: list[str] = []
    details: dict[str, str] = {}
    if degraded:
        reasons.append(f"coord's document list is degraded: {degraded}")
    if problems:
        reasons.append("The project's objectives can't be read: " + "; ".join(problems))
    for metric in metrics:
        if metric.state == "unreadable":
            affected.append(metric.name)
            details[metric.name] = metric.error or "unreadable"
        elif metric.frontmatter_error:
            affected.append(metric.name)
            details[metric.name] = metric.frontmatter_error
    if affected:
        reasons.append(f"{len(affected)} measure(s) could not be fully read")
    if not reasons:
        return SourceRead(status="ok")
    return SourceRead(
        status="degraded", reason="; ".join(reasons), affected=affected, details=details
    )


def _findings_source(listed: dict[str, MetricFindings]) -> SourceRead:
    unavailable = {n: r for n, r in listed.items() if r.state == "unavailable"}
    truncated = {n: r for n, r in listed.items() if r.state == "truncated"}
    details = {n: r.reason or r.state for n, r in {**unavailable, **truncated}.items()}
    # Another project's fleet-wide findings, set aside: counted per measure,
    # never placed. Setting them aside is not a gap, so alone it leaves the
    # status ok.
    foreign = {n: r.foreign for n, r in listed.items() if r.foreign}
    for name, count in foreign.items():
        note = foreign_findings_note(count)
        details[name] = f"{details[name]}; {note}" if name in details else note
    if unavailable:
        full = (
            "; the findings read also came back full for "
            + ", ".join(sorted(truncated))
            if truncated
            else ""
        )
        return SourceRead(
            status="unavailable",
            reason=(
                "The checkpoint results can't be read for "
                + ", ".join(sorted(unavailable))
                + ": "
                + (next(iter(unavailable.values())).reason or "coord did not answer")
                + full
            ),
            affected=sorted(details),
            details=details,
        )
    if truncated:
        return SourceRead(
            status="truncated",
            reason=(
                "The findings read came back full for "
                + ", ".join(sorted(truncated))
                + "; their unreported criteria read as not fully read."
            ),
            affected=sorted(details),
            details=details,
        )
    if foreign:
        return SourceRead(
            status="ok",
            reason=(
                f"{sum(foreign.values())} finding(s) that are not this project's "
                "own (other projects' fleet-wide findings) were set aside, not "
                "read as reports."
            ),
            affected=sorted(details),
            details=details,
        )
    return SourceRead(status="ok")


def _by_id_source(by_id: dict[str, ByIdResult], over: list[str]) -> SourceRead:
    failed = {fid: r.detail for fid, r in by_id.items() if r.reason == "read_failed"}
    missing = {
        fid: r.detail for fid, r in by_id.items() if r.reason == "superseded_or_missing"
    }
    foreign = {
        fid: r.detail for fid, r in by_id.items() if r.reason == "another_project"
    }
    details = {**failed, **missing, **foreign}
    if over:
        details.update(
            dict.fromkeys(over, f"not read: over the {MAX_RESULT_ID_READS}-id limit")
        )
        return SourceRead(
            status="truncated",
            reason=(
                f"{len(over)} report(s) were not read by id: one request reads at "
                f"most {MAX_RESULT_ID_READS} by id."
            ),
            affected=[*failed, *missing, *foreign, *over],
            details=details,
        )
    if failed:
        return SourceRead(
            status="degraded",
            reason=f"{len(failed)} report(s) could not be read by id.",
            affected=[*failed, *missing, *foreign],
            details=details,
        )
    if missing or foreign:
        said: list[str] = []
        if missing:
            said.append(
                f"{len(missing)} recorded report(s) were superseded or are missing"
            )
        if foreign:
            said.append(
                f"{len(foreign)} recorded id(s) coord served as a finding that is "
                "not this project's own, so they were not read as reports"
            )
        return SourceRead(
            status="ok",
            reason="; ".join(said) + ".",
            affected=[*missing, *foreign],
            details=details,
        )
    return SourceRead(status="ok")


# ===========================================================================
# The route
# ===========================================================================

router = APIRouter()


@router.get("/objectives", response_model=ObjectivesRead)
async def read_objectives(
    request: Request,
    # The intent documents' own read rule: any member of the active project,
    # and never a device (coord serves them only behind operator routes).
    access: OverviewAccess = Depends(require_read("coord_admin")),
    db: AsyncSession = Depends(get_async_db),
    store: IntentDocumentStore = Depends(intent_document_store),
    findings: CoordFindings = Depends(coord_findings),
) -> ObjectivesRead:
    """What the project is aiming for, and how each measure is doing.

    Readable by any member of the active project (the same membership the
    Summary requires), under the ``intent_documents`` resource's own rule
    (``coord_admin``): a device principal gets the typed 403
    ``device_not_supported_for_coord_backed_resource`` before anything is
    read. Coord authorizes the forwarded bearer on every upstream read, so
    this route widens nothing. A gap upstream is a ``sources`` entry and an
    UNKNOWN on what it touches, never an error page and never a blank.
    """
    ctx = StoreContext(access=access, db=db, request=request)
    return await build_objectives(ctx, store, findings, now=datetime.now(UTC))


__all__ = [
    "CoordFindings",
    "ObjectivesRead",
    "ProxiedCoordFindings",
    "build_objectives",
    "coord_findings",
    "parse_frontmatter",
    "router",
    "title_of_document",
]
