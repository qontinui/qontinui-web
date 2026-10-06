"""The project's objectives and how each measure is doing — ``GET /objectives``.

Plan ``2026-10-06-overview-objectives-view`` Phase 1 (design decisions D3, D5–D8).
One server-side join, so the browser parses no prose and no YAML:

* the ``initiative`` and ``success_metric`` intent documents, read through
  :class:`~app.overview.intent_documents.IntentDocumentStore` (its skeleton /
  unreadable classification and its bounded fan-out — no second classifier);
* each metric's frontmatter, parsed with ``yaml.safe_load`` and served typed,
  every date normalised to an ISO string, every field nullable, a malformed
  block reported per document and never failing the page;
* the checkpoint reports, found in coord's findings by the metric document's
  resource keys (ONE read per metric, so one busy metric's notices cannot
  truncate another's) plus a by-id read of the ids the document records in its
  ``results:`` list (a by-id read serves a row past its 14-day list expiry);
* each report's ``artifact_refs.metric_checkpoint`` block, trusted only when
  the strict ``metric-checkpoint/v1`` validator passes
  (:mod:`app.overview.metric_checkpoint`).

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
    join_results,
    read_by_id,
    read_metric_findings,
)
from app.overview.objectives_models import (
    InitiativeRead,
    MetricRead,
    ObjectivesRead,
    ObjectivesSources,
    SourceRead,
)
from app.overview.permissions import OverviewAccess, get_overview_access
from app.overview.resource import StoreContext

# ===========================================================================
# Assembly
# ===========================================================================


def _group(
    initiatives: list[InitiativeRead], metrics: list[MetricRead]
) -> tuple[list[str], list[str]]:
    """Fill each objective's ``metric_names`` and each metric's
    ``serves_unknown``; return ``(initiative_named, other)``."""
    readable = [
        i
        for i in initiatives
        if i.frontmatter_error is None and i.state in ("authored", "unknown")
    ]
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
        metric.serves_unknown = [s for s in metric.serves if s not in known]
        if any(s in live_ids for s in metric.serves):
            continue
        (initiative_named if metric.name in named else other).append(metric.name)
    return initiative_named, other


def _initiative_problems(
    initiatives: list[InitiativeRead], skeletons: int, voids: int = 0
) -> list[str]:
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
        else:
            problems.append("there is no initiative document")
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
            void_hidden=0,
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
            ),
        )
    docs = [d for d in listing.items if isinstance(d, IntentDocumentRead)]

    initiatives: list[InitiativeRead] = []
    metrics: list[MetricRead] = []
    skeletons = 0
    initiative_skeletons = 0
    void = 0
    initiative_voids = 0
    for doc in docs:
        if doc.state == "skeleton":
            skeletons += 1
            if doc.kind == "initiative":
                initiative_skeletons += 1
            continue
        if doc.kind == "initiative":
            initiative, is_void_initiative = build_initiative(doc)
            if is_void_initiative:
                void += 1
                initiative_voids += 1
            else:
                initiatives.append(initiative)
            continue
        metric, is_void_doc = build_metric(doc)
        if is_void_doc:
            void += 1
        else:
            metrics.append(metric)

    initiative_named, other = _group(initiatives, metrics)
    initiatives.sort(key=lambda i: (not i.live, i.name))

    # Findings: one list read per readable metric, then by id the recorded
    # results the list reads did not already return.
    gate = asyncio.Semaphore(LIST_CONCURRENCY)
    readable = [m for m in metrics if m.state != "unreadable"]
    listed_reads = await asyncio.gather(
        *(read_metric_findings(coord, tenant_id, m.name, gate) for m in readable)
    )
    listed = dict(zip((m.name for m in readable), listed_reads, strict=True))
    # A recorded id any metric's list read already returned needs no by-id
    # read — whichever metric's page it came back on.
    listed_anywhere = {
        str(f["finding_id"]): f for r in listed_reads for f in r.findings
    }
    by_id: dict[str, ByIdResult] = {}
    wanted: list[str] = []
    for metric in readable:
        for entry in metric.results:
            fid = entry.finding_id
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
        join_results(metric, listed[metric.name], by_id, now)

    return ObjectivesRead(
        tenant_id=tenant_id,
        generated_at=now,
        initiatives=initiatives,
        earlier_initiatives_count=sum(1 for i in initiatives if not i.live),
        objectives_readable=not _initiative_problems(
            initiatives, initiative_skeletons, initiative_voids
        ),
        metrics=metrics,
        initiative_named_metrics=initiative_named,
        other_metrics=other,
        skeletons_hidden=skeletons,
        void_hidden=void,
        sources=ObjectivesSources(
            intent_documents=_documents_source(
                listing.degraded,
                initiatives,
                initiative_skeletons,
                initiative_voids,
                metrics,
            ),
            findings=_findings_source(listed),
            findings_by_id=_by_id_source(read_now, over),
        ),
    )


def _documents_source(
    degraded: str | None,
    initiatives: list[InitiativeRead],
    initiative_skeletons: int,
    initiative_voids: int,
    metrics: list[MetricRead],
) -> SourceRead:
    reasons: list[str] = []
    affected: list[str] = []
    details: dict[str, str] = {}
    if degraded:
        reasons.append(f"coord's document list is degraded: {degraded}")
    problems = _initiative_problems(initiatives, initiative_skeletons, initiative_voids)
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
            affected=sorted(truncated),
            details=details,
        )
    return SourceRead(status="ok")


def _by_id_source(by_id: dict[str, ByIdResult], over: list[str]) -> SourceRead:
    failed = {fid: r.detail for fid, r in by_id.items() if r.reason == "read_failed"}
    missing = {
        fid: r.detail for fid, r in by_id.items() if r.reason == "superseded_or_missing"
    }
    details = {**failed, **missing}
    if over:
        details.update(
            dict.fromkeys(over, f"not read: over the {MAX_RESULT_ID_READS}-id limit")
        )
        return SourceRead(
            status="truncated",
            reason=(
                f"{len(over)} recorded result(s) were not read: one request reads at "
                f"most {MAX_RESULT_ID_READS} by id."
            ),
            affected=[*failed, *missing, *over],
            details=details,
        )
    if failed:
        return SourceRead(
            status="degraded",
            reason=f"{len(failed)} recorded result(s) could not be read by id.",
            affected=[*failed, *missing],
            details=details,
        )
    if missing:
        return SourceRead(
            status="ok",
            reason=f"{len(missing)} recorded result(s) were superseded or are missing.",
            affected=list(missing),
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
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
    store: IntentDocumentStore = Depends(intent_document_store),
    findings: CoordFindings = Depends(coord_findings),
) -> ObjectivesRead:
    """What the project is aiming for, and how each measure is doing.

    Readable by any member of the active project (the same membership the
    Summary requires); coord authorizes the forwarded bearer on both upstream
    reads, so this route widens nothing. A gap upstream is a ``sources`` entry
    and an UNKNOWN on what it touches, never an error page and never a blank.
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
