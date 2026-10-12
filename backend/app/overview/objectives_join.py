"""Checkpoint reports: the findings reads and the result join.

Plan ``2026-10-06-overview-objectives-view`` D5–D7: which findings at a metric's
key are checkpoint REPORTS (rules (a)/(b)/(c) and the late path), which report
is each checkpoint's live head, and which verdict each declared criterion shows.

Since Phase 4 a report's verdict ROWS come only from coord's checkpoint
results table (:mod:`app.overview.objectives_results`); a finding's
``artifact_refs.metric_checkpoint`` block is never turned into rows here. The
block is still VALIDATED, so a report whose block cannot be read says so with
the reason instead of "rows not yet recorded".
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import UUID

import structlog
from fastapi import HTTPException

from app.api.v1.endpoints.operations import _proxy_coord_get
from app.overview.metric_checkpoint import (
    Problem,
    ValidationResult,
    is_uuid,
    validate_metric_checkpoint,
)
from app.overview.objectives_frontmatter import (
    parse_date,
    parse_time,
)
from app.overview.objectives_models import (
    CheckpointDeclRead,
    CheckpointResultRead,
    CheckpointStatus,
    CriterionDeclRead,
    CriterionResultRead,
    EarlierVerdictRead,
    FindingsReadState,
    LaterReportNotice,
    MetricRead,
    PlacedBy,
    RelatedNoteRead,
    ReportRead,
    ReportShape,
    ResultRowRead,
    TallyRead,
    UnresolvedReason,
    UnresolvedResultRead,
)
from app.overview.objectives_results import (
    CoordCheckpointResults,
    FindingRows,
    MetricRows,
    proxied_list_checkpoint_results,
)

logger = structlog.get_logger(__name__)

#: Coord's findings page cap. A page holding exactly this many rows is read as
#: possibly truncated: coord ``main`` serves no truncation flag yet.
FINDINGS_PAGE_LIMIT = 100
#: How many ``results:`` ids one request reads by id. Past this the by-id
#: source is ``truncated`` and the ids not read are named.
MAX_RESULT_ID_READS = 32
#: The due day plus a 24-hour grace for the measuring session (D5).
DUE_WINDOW = timedelta(days=2)
#: The title a checkpoint report was asked for before the document required a
#: checkpoint key (the late path, Phase 0's reconciliation). Auxiliary findings
#: are barred from this title, so a notice never matches it.
LATE_PATH_TITLE = re.compile(r"^Merge-train checkpoint (\d+)\b")
#: A resource key shaped like a checkpoint id (``checkpoint-<n>``).
_CHECKPOINT_KEY = re.compile(r"^checkpoint-\d+$")

# ===========================================================================
# Talking to coord's findings
# ===========================================================================


class CoordFindings(CoordCheckpointResults, Protocol):
    """The two findings reads the join makes, plus the checkpoint results
    read. The default goes through the operations proxy (the caller's own
    bearer and active project); tests substitute a fake."""

    async def list_for_keys(
        self, tenant_id: UUID, resource_keys: list[str], limit: int
    ) -> dict[str, Any]: ...

    async def get_by_id(self, tenant_id: UUID, finding_id: str) -> dict[str, Any]: ...


class ProxiedCoordFindings:
    async def list_for_keys(
        self, tenant_id: UUID, resource_keys: list[str], limit: int
    ) -> dict[str, Any]:
        # `resource_keys` only: coord ORs it with `topic`, so a topic would
        # widen the read. No `cursor`: coord main answers it with a 400.
        result: dict[str, Any] = await _proxy_coord_get(
            "/coord/findings",
            params={"resource_keys": resource_keys, "limit": limit},
            tenant_id=tenant_id,
        )
        return result

    async def get_by_id(self, tenant_id: UUID, finding_id: str) -> dict[str, Any]:
        result: dict[str, Any] = await _proxy_coord_get(
            "/coord/findings", params={"finding_id": finding_id}, tenant_id=tenant_id
        )
        return result

    async def list_checkpoint_results(
        self, tenant_id: UUID, names: list[str], limit: int
    ) -> dict[str, Any]:
        return await proxied_list_checkpoint_results(tenant_id, names, limit)


def coord_findings() -> CoordFindings:
    """FastAPI dependency. Tests override it with a fake coord."""
    return ProxiedCoordFindings()


def metric_resource_keys(name: str) -> list[str]:
    """The two spellings coord accepts for a notification on the document."""
    return [f"prompt_document:success_metric/{name}", f"success_metric/{name}"]


@dataclass
class MetricFindings:
    state: FindingsReadState
    reason: str | None = None
    findings: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ByIdResult:
    finding: dict[str, Any] | None = None
    reason: UnresolvedReason | None = None
    detail: str = ""


def _unavailable_reason(exc: HTTPException) -> str:
    if exc.status_code == 404:
        return (
            "coord's findings reader is not answering (HTTP 404), so the "
            "deployed coord predates it or the route is misrouted."
        )
    return f"coord did not answer the findings read (HTTP {exc.status_code})."


def _unreadable_reason(exc: Exception) -> str:
    return f"coord's findings answer could not be read ({type(exc).__name__})."


def _page_findings(page: Any) -> tuple[list[dict[str, Any]] | None, str | None]:
    """The rows of a coord findings page, or ``(None, reason)`` when the page
    says it cannot see its store — never an empty list for that."""
    if not isinstance(page, dict):
        return None, "coord's findings answer was not an object."
    if page.get("available") is False:
        return None, (
            "coord reports its findings store is not provisioned "
            "(`available: false`), which is not the same as there being none."
        )
    rows = page.get("findings")
    if not isinstance(rows, list):
        return None, "coord's findings answer carried no findings list."
    return [r for r in rows if isinstance(r, dict) and r.get("finding_id")], None


async def read_metric_findings(
    coord: CoordFindings, tenant_id: UUID, name: str, gate: asyncio.Semaphore
) -> MetricFindings:
    try:
        async with gate:
            page = await coord.list_for_keys(
                tenant_id, metric_resource_keys(name), FINDINGS_PAGE_LIMIT
            )
    except HTTPException as exc:
        return MetricFindings(state="unavailable", reason=_unavailable_reason(exc))
    except Exception as exc:  # a gap is reported, never a 500
        logger.exception("overview_objectives_findings_read_failed", metric=name)
        return MetricFindings(state="unavailable", reason=_unreadable_reason(exc))
    rows, reason = _page_findings(page)
    if rows is None:
        return MetricFindings(state="unavailable", reason=reason)
    count = page.get("count")
    applied = page.get("limit")
    limit = applied if isinstance(applied, int) and applied > 0 else FINDINGS_PAGE_LIMIT
    full = (count if isinstance(count, int) else len(rows)) >= limit
    narrowed = (
        page.get("resource_keys_truncated") is True or page.get("truncated") is True
    )
    if full or narrowed:
        return MetricFindings(
            state="truncated",
            reason=(
                f"the findings page came back full ({limit} rows), so older "
                "reports may not have been read"
                if full
                else "coord says the page is not the whole answer"
            ),
            findings=rows,
        )
    return MetricFindings(state="ok", findings=rows)


async def read_by_id(
    coord: CoordFindings, tenant_id: UUID, finding_id: str, gate: asyncio.Semaphore
) -> ByIdResult:
    try:
        async with gate:
            page = await coord.get_by_id(tenant_id, finding_id)
    except HTTPException as exc:
        return ByIdResult(reason="read_failed", detail=_unavailable_reason(exc))
    except Exception as exc:  # a gap is reported, never a 500
        logger.exception("overview_objectives_by_id_read_failed", finding_id=finding_id)
        return ByIdResult(reason="read_failed", detail=_unreadable_reason(exc))
    rows, reason = _page_findings(page)
    if rows is None:
        return ByIdResult(reason="read_failed", detail=reason or "")
    for row in rows:
        if row.get("finding_id") == finding_id:
            return ByIdResult(finding=row)
    # A by-id read hides a row a later finding supersedes, and answers an id
    # it does not hold with an empty page — both read as this.
    return ByIdResult(
        reason="superseded_or_missing",
        detail="coord served no finding for this id: it was superseded or does not exist.",
    )


# ===========================================================================
# The join — reports, checkpoints, criteria
# ===========================================================================


def _ts(text: Any) -> datetime:
    """Sort key for an ISO timestamp; unparseable sorts first."""
    parsed = parse_time(text) if isinstance(text, str) else None
    return parsed or datetime.min.replace(tzinfo=UTC)


def _report_time(report: ReportRead, rows: MetricRows) -> datetime:
    """When a report was made, for ordering (head, D7 tie-break, the
    out-of-date notice). Its finding's ``created_at``; for a stub whose
    finding could not be read, its rows' latest ``measured_at``. A row's
    ``recorded_at`` is when coord inserted it — a backfill can record a report
    days after it was made — so it is used ONLY when no ``measured_at`` can be
    read, and never the oldest possible time for a report that has rows."""
    created = parse_time(report.created_at) if report.created_at else None
    if created is not None:
        return created
    table = rows.by_finding.get(report.finding_id)
    if table is not None:
        for text in (table.measured_at, table.recorded_at):
            parsed = parse_time(text) if text else None
            if parsed is not None:
                return parsed
    return datetime.min.replace(tzinfo=UTC)


def _addressed_block(finding: dict[str, Any], name: str) -> tuple[Any, bool]:
    """``(block, names_this)``: the finding's ``metric_checkpoint`` block
    unless it is absent or addressed to another metric (then ``None``), and
    whether its ``document.name`` actually names THIS document."""
    refs = finding.get("artifact_refs")
    if not isinstance(refs, dict) or "metric_checkpoint" not in refs:
        return None, False
    block = refs["metric_checkpoint"]
    document = block.get("document") if isinstance(block, dict) else None
    doc_name = document.get("name") if isinstance(document, dict) else None
    if doc_name == name:
        return block, True
    if isinstance(doc_name, str):
        return None, False  # another metric's result
    # A block with no readable document name cannot be said to be another
    # metric's — but it does not name this one either, so it never places a
    # report by rule (a). Rules (b)/(c) may still place it, as an unreadable
    # block; otherwise it is a Related note.
    return block, False


def _str(value: Any) -> str | None:
    """A coord row field as a string, or None — a malformed row never fails
    the page."""
    return value if isinstance(value, str) else None


def _keys(finding: dict[str, Any]) -> list[str]:
    keys = finding.get("resource_keys")
    return [k for k in keys if isinstance(k, str)] if isinstance(keys, list) else []


@dataclass
class _Placed:
    report: ReportRead
    created: datetime


#: A stub finding's key: the report's rows are in coord's table, but the
#: finding itself could not be read by id — why.
BODY_UNAVAILABLE = "_body_unavailable"


def _table_checkpoint(table: FindingRows | None, declared_cps: list[str]) -> str | None:
    """The checkpoint coord's table files a report under, when the document
    declares it (or declares none). An undeclared one cannot be placed — the
    same rule rule (a) applies to a block."""
    if table is None:
        return None
    cp = table.checkpoint
    if not cp.strip() or (declared_cps and cp not in declared_cps):
        return None
    return cp


def _place(
    finding: dict[str, Any],
    metric: MetricRead,
    declared_cps: list[str],
    declared_criteria: set[str],
    recorded: dict[str, str | None],
    rows: MetricRows,
) -> ReportRead | None:
    """D6 point 2: a report if coord's table, rule (a), (b) or (c) places it;
    else None. Its verdict rows come only from the table (Phase 4)."""
    fid = str(finding["finding_id"])
    table = rows.by_finding.get(fid)
    t_cp = _table_checkpoint(table, declared_cps)
    block, names_this = _addressed_block(finding, metric.name)
    validation: ValidationResult | None = None
    a_cp: str | None = None
    if block is not None:
        validation = _validate(block, finding, declared_cps, declared_criteria)
        cp = block.get("checkpoint") if isinstance(block, dict) else None
        if (
            names_this
            and isinstance(cp, str)
            and cp.strip()
            and (not declared_cps or cp in declared_cps)
        ):
            a_cp = cp
    b_cp = recorded.get(fid) if fid in recorded else None
    c_cp: str | None = None
    if metric.report_topic and _str(finding.get("topic")) == metric.report_topic:
        hits = sorted({k for k in _keys(finding) if k in declared_cps})
        if len(hits) == 1:
            c_cp = hits[0]

    checkpoint = t_cp or a_cp or b_cp or c_cp
    if checkpoint is None:
        return None
    # The rules that AGREE with the placement; a disagreeing one is named in
    # `checkpoint_mismatch` instead.
    rules: list[tuple[PlacedBy, str | None]] = [
        ("table", t_cp),
        ("block", a_cp),
        ("results", b_cp),
        ("checkpoint_key", c_cp),
    ]
    placed_by = [rule for rule, cp in rules if cp == checkpoint]
    others = {cp for cp in (a_cp, b_cp, c_cp) if cp}
    mismatch = None
    if len(others | {checkpoint}) > 1:
        rule = (
            "coord's results table"
            if t_cp
            else "its result block"
            if a_cp
            else "the document's results list"
        )
        mismatch = (
            f"Placed under {checkpoint} by {rule}; another rule names "
            + ", ".join(sorted(others - {checkpoint}))
            + "."
        )

    report = ReportRead(
        finding_id=fid,
        title=_str(finding.get("title")),
        topic=_str(finding.get("topic")),
        body=_str(finding.get("body")),
        created_at=_str(finding.get("created_at")),
        expires_at=_str(finding.get("expires_at")),
        checkpoint=checkpoint,
        placed_by=placed_by,
        checkpoint_mismatch=mismatch,
        shape="prose_only",
        recorded=fid in recorded,
        body_unavailable=_str(finding.get(BODY_UNAVAILABLE)),
    )
    if validation is not None:
        report.block_warnings = [f"{w.field}: {w.message}" for w in validation.warnings]

    if table is not None and t_cp is not None:
        if table.rows:
            return _structured(report, table, declared_criteria, validation)
        if table.marker == "invalid_block":
            report.shape = "unreadable_block"
            report.block_error = table.marker_text or (
                "coord recorded the result block as invalid and gave no reason"
            )
            return report
        if table.marker == "prose_only":
            return report  # prose only, as coord's table files it

    if validation is None:
        return report  # no block: prose only
    if not validation.ok:
        report.shape = "unreadable_block"
        report.block_error = validation.summary()
        return report
    # A valid block and no rows in the table. Only a read that SUCCEEDED can
    # say "not yet recorded"; any other read leaves the rows unvouched for.
    report.shape = "rows_not_recorded" if rows.state == "ok" else "rows_unread"
    return report


def _structured(
    report: ReportRead,
    table: FindingRows,
    declared_criteria: set[str],
    validation: ValidationResult | None,
) -> ReportRead:
    report.shape = "structured"
    report.measured_at = table.measured_at
    report.document_version = table.document_version
    report.gate_id = table.gate_id
    report.rows = [
        row.model_copy(update={"declared": row.id in declared_criteria})
        for row in table.rows
    ]
    if validation is None and declared_criteria:
        # No block to check (the finding could not be read): flag an
        # undeclared row id the way the validator would.
        report.block_warnings = [
            f"{row.id!r} is not one of the document's criteria; shown under "
            "the report and not counted"
            for row in report.rows
            if not row.declared
        ]
    return report


def _crash_reason(what: str, exc: Exception) -> str:
    return f"block: {what} ({type(exc).__name__})"


def _validate(
    block: Any,
    finding: dict[str, Any],
    declared_cps: list[str],
    declared_criteria: set[str],
) -> ValidationResult:
    """The validator, with any unexpected exception turned into a refusal: a
    block that crashes the check is a block that could not be read."""
    try:
        return validate_metric_checkpoint(
            block,
            resource_keys=_keys(finding),
            declared_checkpoints=declared_cps,
            declared_criteria=declared_criteria,
        )
    except Exception as exc:
        logger.exception(
            "overview_objectives_block_validation_crashed",
            finding_id=finding.get("finding_id"),
        )
        result = ValidationResult()
        result.errors.append(
            Problem("block", f"could not be checked ({type(exc).__name__})")
        )
        return result


def _unknown_reason_for(
    status: CheckpointStatus,
    shape: ReportShape | None,
    has_report: bool,
    findings_read: FindingsReadState,
    rows_read: FindingsReadState,
) -> str:
    """Why a declared criterion with no row reads UNKNOWN."""
    if rows_read == "unavailable":
        # Every verdict row comes from the results table: with it unread, no
        # criterion of any metric can say more than "can't be read".
        return "checkpoint_results_unreadable"
    if has_report:
        if shape == "prose_only":
            return "reported_prose_only"
        if shape == "unreadable_block":
            return "report_unreadable"
        if shape == "rows_not_recorded":
            return "rows_not_recorded"
        if shape == "rows_unread" or rows_read == "truncated":
            return "results_not_fully_read"
        return "not_reported"
    if status == "unreadable":
        return "results_unreadable"
    if (
        status == "not_fully_read"
        or findings_read == "truncated"
        or rows_read == "truncated"
    ):
        # Only THIS metric's page was full; other metrics are unaffected.
        return "results_not_fully_read"
    return "not_reported"


def _tally(items: Iterable[CriterionResultRead]) -> TallyRead:
    tally = TallyRead()
    for item in items:
        setattr(tally, item.verdict, getattr(tally, item.verdict) + 1)
    return tally


def _criterion(
    decl: CriterionDeclRead,
    *,
    row: ResultRowRead | None,
    report: ReportRead | None,
    unknown_reason: str,
) -> CriterionResultRead:
    if row is None or report is None:
        return CriterionResultRead(
            id=decl.id,
            checkpoint=decl.checkpoint,
            target=decl.target,
            method=decl.method,
            verdict="unknown",
            unknown_reason=unknown_reason,
        )
    return CriterionResultRead(
        id=decl.id,
        checkpoint=decl.checkpoint,
        target=decl.target,
        method=decl.method,
        verdict=row.verdict,
        unknown_reason=row.unknown_reason if row.verdict == "unknown" else None,
        row=row,
        measured_at=report.measured_at,
        reported_checkpoint=report.checkpoint,
        finding_id=report.finding_id,
    )


def join_results(
    metric: MetricRead,
    listed: MetricFindings,
    by_id: dict[str, ByIdResult],
    now: datetime,
    rows: MetricRows,
) -> None:
    """Fill ``checkpoint_results``, ``criteria_latest``, ``related_notes``."""
    metric.findings_read = listed.state
    metric.checkpoint_results_read = rows.state
    declared_cps = [c.id for c in metric.checkpoints]
    declared_criteria = {c.id for c in metric.criteria}
    recorded: dict[str, str | None] = {}
    for entry in metric.results:
        if entry.finding_id and entry.finding_id not in recorded:
            recorded[entry.finding_id] = entry.checkpoint

    # The pool: listed findings plus the recorded ones served by id, one copy
    # per id, minus any a pooled finding supersedes.
    pool: dict[str, dict[str, Any]] = {}
    for finding in listed.findings:
        pool.setdefault(str(finding["finding_id"]), finding)
    for fid in recorded:
        hit = by_id.get(fid)
        if hit is not None and hit.finding is not None:
            pool.setdefault(fid, hit.finding)
    # Every report coord's table holds rows (or a marker) for: its body by
    # id, or — when that read failed — a stub that still carries the rows.
    for fid in rows.by_finding:
        if fid in pool:
            continue
        hit = by_id.get(fid)
        if hit is not None and hit.finding is not None:
            pool[fid] = hit.finding
        else:
            pool[fid] = {"finding_id": fid, BODY_UNAVAILABLE: _stub_reason(hit)}
    superseded = {str(f["supersedes"]) for f in pool.values() if f.get("supersedes")}
    listed_ids = {str(f["finding_id"]) for f in listed.findings}

    by_checkpoint: dict[str, list[_Placed]] = {}
    notes: list[RelatedNoteRead] = []
    #: Notes carrying a checkpoint-id key: never late-path candidates.
    keyed: set[str] = set()
    for fid, finding in pool.items():
        if fid in superseded:
            continue
        try:
            report = _place(
                finding, metric, declared_cps, declared_criteria, recorded, rows
            )
        except Exception as exc:  # one finding degrades, never the page
            logger.exception(
                "overview_objectives_placement_crashed",
                metric=metric.name,
                finding_id=fid,
            )
            notes.append(_unplaceable_note(fid, finding, exc))
            keyed.add(fid)  # never a late-path candidate either
            continue
        if report is not None:
            by_checkpoint.setdefault(report.checkpoint, []).append(
                _Placed(report, _report_time(report, rows))
            )
        elif fid in listed_ids or fid in recorded or fid in rows.by_finding:
            note = None
            if fid in rows.by_finding:
                note = (
                    "coord's results table files it under "
                    f"{rows.by_finding[fid].checkpoint}, a checkpoint this "
                    "document does not declare."
                )
            elif fid in recorded:
                note = (
                    "Recorded in the document's results list, but nothing "
                    "places it under a checkpoint."
                )
            elif _addressed_block(finding, metric.name)[0] is not None:
                note = (
                    "Carries a result block that names no checkpoint this "
                    "document declares."
                )
            # ANY checkpoint-id-shaped key bars the late path, declared or not:
            # the finding names a checkpoint, just not one this rule reads.
            if any(_CHECKPOINT_KEY.match(k) for k in _keys(finding)):
                keyed.add(fid)
            notes.append(
                RelatedNoteRead(
                    finding_id=fid,
                    title=_str(finding.get("title")),
                    topic=_str(finding.get("topic")),
                    created_at=_str(finding.get("created_at")),
                    note=note,
                )
            )
    for placed in by_checkpoint.values():
        placed.sort(key=lambda p: p.created, reverse=True)

    unresolved = _unresolved(metric, recorded, pool, superseded, by_id)
    _mark_late_path(metric, notes, keyed, by_checkpoint, recorded, declared_cps)

    order = list(declared_cps)
    for cp in [*by_checkpoint, *(u.checkpoint for u in unresolved)]:
        if cp and cp not in order:
            order.append(cp)
    decls = {c.id: c for c in metric.checkpoints}
    results: list[CheckpointResultRead] = []
    for cp in order:
        results.append(
            _checkpoint_result(
                metric,
                cp,
                decls.get(cp),
                by_checkpoint.get(cp, []),
                [u for u in unresolved if u.checkpoint == cp],
                notes,
                listed,
                rows,
                now,
            )
        )
    metric.checkpoint_results = results
    metric.criteria_latest = _latest(metric, results, order, rows)
    metric.tally_latest = _tally(metric.criteria_latest)
    notes.sort(key=lambda n: _ts(n.created_at), reverse=True)
    metric.related_notes = notes
    # An unresolved entry naming no checkpoint has no checkpoint row to sit
    # on; the card shows it at metric level instead of nowhere.
    metric.unresolved_results = [u for u in unresolved if not u.checkpoint]


def _stub_reason(hit: ByIdResult | None) -> str:
    if hit is None:
        return (
            f"The report's text was not read: one request reads at most "
            f"{MAX_RESULT_ID_READS} reports by id."
        )
    return f"The report's text could not be read: {hit.detail or hit.reason}"


def _unplaceable_note(
    fid: str, finding: dict[str, Any], exc: Exception
) -> RelatedNoteRead:
    return RelatedNoteRead(
        finding_id=fid,
        title=_str(finding.get("title")),
        topic=_str(finding.get("topic")),
        created_at=_str(finding.get("created_at")),
        note=(
            "This finding could not be read as a report "
            f"({type(exc).__name__}), so it is listed here."
        ),
    )


def _unresolved(
    metric: MetricRead,
    recorded: dict[str, str | None],
    pool: dict[str, dict[str, Any]],
    superseded: set[str],
    by_id: dict[str, ByIdResult],
) -> list[UnresolvedResultRead]:
    out: list[UnresolvedResultRead] = []
    for entry in metric.results:
        fid = entry.finding_id
        if fid and fid in pool and fid not in superseded:
            continue
        if not fid or not is_uuid(fid):
            out.append(
                UnresolvedResultRead(
                    checkpoint=entry.checkpoint,
                    finding_id=fid,
                    reason="invalid_id",
                    detail="The recorded finding id is not a uuid.",
                )
            )
            continue
        if fid in superseded:
            out.append(
                UnresolvedResultRead(
                    checkpoint=entry.checkpoint,
                    finding_id=fid,
                    reason="superseded_or_missing",
                    detail="A later finding supersedes the recorded one.",
                )
            )
            continue
        hit = by_id.get(fid)
        if hit is None:
            out.append(
                UnresolvedResultRead(
                    checkpoint=entry.checkpoint,
                    finding_id=fid,
                    reason="not_read_over_limit",
                    detail=(
                        f"Not read: one request reads at most {MAX_RESULT_ID_READS} "
                        "recorded results by id."
                    ),
                )
            )
        elif hit.reason is not None:
            out.append(
                UnresolvedResultRead(
                    checkpoint=entry.checkpoint,
                    finding_id=fid,
                    reason=hit.reason,
                    detail=hit.detail,
                )
            )
    return out


def _mark_late_path(
    metric: MetricRead,
    notes: list[RelatedNoteRead],
    keyed: set[str],
    by_checkpoint: dict[str, list[_Placed]],
    recorded: dict[str, str | None],
    declared_cps: list[str],
) -> None:
    """Phase 0's late path: for a checkpoint nothing else places and nothing
    records, a finding on ``report_topic`` with no checkpoint key, created
    before ``structured_reporting_since``, titled ``Merge-train checkpoint
    <n>``, is a POSSIBLE report — listed under Related notes, never placed."""
    cutoff = parse_time(metric.structured_reporting_since)
    if cutoff is None or not metric.report_topic:
        return
    recorded_cps = {cp for cp in recorded.values() if cp}
    for note in notes:
        if (
            note.topic != metric.report_topic
            or not note.title
            or note.finding_id in keyed
        ):
            continue
        created = parse_time(note.created_at)
        if created is None or created >= cutoff:
            continue
        match = LATE_PATH_TITLE.match(note.title)
        if not match:
            continue
        cp = f"checkpoint-{match.group(1)}"
        if cp in declared_cps and cp not in by_checkpoint and cp not in recorded_cps:
            note.possible_report_for = cp


_SHAPE_STATUS: dict[ReportShape, CheckpointStatus] = {
    "structured": "reported",
    "prose_only": "reported_prose_only",
    "unreadable_block": "reported_unreadable",
    "rows_not_recorded": "reported_rows_not_recorded",
    "rows_unread": "not_fully_read",
}


def _window_close(due: str | None) -> datetime | None:
    day = parse_date(due) if due else None
    if day is None:
        return None
    return datetime(day.year, day.month, day.day, tzinfo=UTC) + DUE_WINDOW


def _checkpoint_result(
    metric: MetricRead,
    cp: str,
    decl: CheckpointDeclRead | None,
    placed: list[_Placed],
    unresolved: list[UnresolvedResultRead],
    notes: list[RelatedNoteRead],
    listed: MetricFindings,
    rows: MetricRows,
    now: datetime,
) -> CheckpointResultRead:
    due = decl.due if decl else None
    closes = _window_close(due)
    head = placed[0].report if placed else None
    result = CheckpointResultRead(
        id=cp,
        due=due,
        label=decl.label if decl else None,
        declared=decl is not None,
        window_closes_at=closes,
        status="no_report_found",
        report=head,
        history=[p.report for p in placed[1:]],
        unresolved_results=unresolved,
    )
    if head is not None:
        result.status = _SHAPE_STATUS[head.shape]
        if head.shape == "unreadable_block":
            result.status_reason = head.block_error
        elif head.shape == "rows_unread":
            if rows.state == "unavailable":
                result.status = "checkpoint_results_unreadable"
            result.status_reason = rows.reason
        elif head.shape == "rows_not_recorded":
            result.status_reason = (
                "The report carries a readable result, but coord's results "
                "table holds no rows for it yet."
            )
    elif any(u.reason != "superseded_or_missing" for u in unresolved):
        result.status = "unreadable"
        result.status_reason = "; ".join(u.detail for u in unresolved)
    elif unresolved:
        result.status = "unreadable"
        result.status_reason = (
            "The recorded report was superseded or is missing, and no live "
            "report was found in its place."
        )
    elif listed.state == "unavailable":
        result.status = "unreadable"
        result.status_reason = listed.reason
    elif rows.state == "unavailable":
        # The table also finds reports the 14-day list read cannot: with it
        # unread, "no report found" would be a claim nobody checked.
        result.status = "checkpoint_results_unreadable"
        result.status_reason = rows.reason
    elif any(n.possible_report_for == cp for n in notes):
        result.status = "possible_report_unrecorded"
        result.status_reason = (
            "A possible report is listed under Related notes; not yet recorded."
        )
    elif listed.state == "truncated" or rows.state == "truncated":
        result.status = "not_fully_read"
        result.status_reason = (
            listed.reason if listed.state == "truncated" else rows.reason
        )
    elif closes is not None and now < closes:
        result.status = "awaiting"
    else:
        result.status = "no_report_found"
        result.status_reason = (
            "No report found in the findings of the last 14 days; a report "
            "recorded in the document's results list is found at any age."
        )

    reason = _unknown_reason_for(
        result.status,
        head.shape if head else None,
        head is not None,
        listed.state,
        rows.state,
    )
    stated = {r.id: r for r in head.rows} if head and head.shape == "structured" else {}
    result.criteria = [
        _criterion(
            decl_c, row=stated.get(decl_c.id), report=head, unknown_reason=reason
        )
        for decl_c in metric.criteria
        if decl_c.checkpoint == cp
    ]
    result.tally = _tally(result.criteria)
    return result


def _latest(
    metric: MetricRead,
    results: list[CheckpointResultRead],
    order: list[str],
    rows: MetricRows,
) -> list[CriterionResultRead]:
    """D7: per declared criterion, the newest table row across every
    checkpoint's report (by ``measured_at``, then the later checkpoint, then
    the later finding); a later report with no readable rows marks it
    possibly stale."""
    index = {cp: i for i, cp in enumerate(order)}
    heads = [r.report for r in results if r.report is not None]
    candidates: dict[
        str, list[tuple[tuple[datetime, int, datetime], ResultRowRead, ReportRead]]
    ] = {}
    for report in heads:
        if report.shape != "structured":
            continue
        for row in report.rows:
            key = (
                _ts(report.measured_at),
                index.get(report.checkpoint, len(order)),
                _report_time(report, rows),
            )
            candidates.setdefault(row.id, []).append((key, row, report))
    by_cp = {r.id: r for r in results}

    out: list[CriterionResultRead] = []
    for decl in metric.criteria:
        found = sorted(candidates.get(decl.id, []), key=lambda c: c[0], reverse=True)
        if not found:
            own = by_cp.get(decl.checkpoint or "")
            reason = "not_reported"
            if rows.state == "unavailable":
                reason = "checkpoint_results_unreadable"
            elif own is not None:
                match = next((c for c in own.criteria if c.id == decl.id), None)
                reason = (match.unknown_reason if match else None) or reason
            elif metric.findings_read == "unavailable":
                reason = "results_unreadable"
            elif metric.findings_read == "truncated" or rows.state == "truncated":
                reason = "results_not_fully_read"
            out.append(_criterion(decl, row=None, report=None, unknown_reason=reason))
            continue
        _, row, report = found[0]
        item = _criterion(decl, row=row, report=report, unknown_reason="")
        item.earlier = [
            EarlierVerdictRead(
                checkpoint=r.checkpoint,
                verdict=w.verdict,
                measured_at=r.measured_at,
                finding_id=r.finding_id,
            )
            for _, w, r in found[1:]
        ]
        shown_at = _report_time(report, rows)
        later = [
            h
            for h in heads
            if h.shape != "structured" and _report_time(h, rows) > shown_at
        ]
        if later:
            newest = max(later, key=lambda h: _report_time(h, rows))
            item.out_of_date_notice = LaterReportNotice(
                finding_id=newest.finding_id,
                checkpoint=newest.checkpoint,
                created_at=newest.created_at,
                shape=newest.shape,
            )
        out.append(item)
    return out
