"""Checkpoint result ROWS, read from coord's durable results table.

Plan ``2026-10-06-overview-objectives-view`` Phase 4 (web half). A checkpoint
report's verdict rows live in ``coord.success_metric_checkpoint_results``,
written by coord in the same transaction as the finding that carries a valid
``metric-checkpoint/v1`` block (and by its backfill). The web never reads
``coord.*`` directly (``tests/test_coord_schema_boundary_guard.py``): it reads
coord's door, ``GET /coord/success-metric-checkpoint-results``, through the
operations proxy with the caller's own bearer and active project.

The door's contract::

    200 {"available": true, "rows": [...], "truncated": bool}
        rows ordered name, criterion, measured_at DESC; a superseded
        report's rows are already excluded.
    200 {"available": false, "reason": ...}   the table is not provisioned
    404                                        a coord that predates the door

Marker rows carry ``criterion = "*"``, ``verdict = "unknown"`` and an
``unknown_reason`` of ``prose_only`` (a report with no block) or
``invalid_block`` (a block that failed the validator; ``value_text`` is the
validator's reason).

The door is read ONCE PER METRIC (``names=<that one name>``) under the same
concurrency bound as the findings list reads, so one busy metric's full page
cannot cut another metric's results short (D6 point 2's reasoning).

**A read that did not answer is never "no rows".** 404, ``available: false``,
an error or an unreadable answer make THAT metric's read ``unavailable``; a
full page makes it ``truncated``. Only a read that
SUCCEEDED and returned nothing for a finding lets the page say "rows not yet
recorded".
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol
from uuid import UUID

import structlog
from fastapi import HTTPException

from app.api.v1.endpoints.operations import _proxy_coord_get
from app.overview.metric_checkpoint import is_uuid
from app.overview.objectives_frontmatter import as_number, parse_time
from app.overview.objectives_models import (
    ActionRead,
    FindingsReadState,
    ResultRowRead,
    SourceRead,
    WindowRead,
)

logger = structlog.get_logger(__name__)

#: The door's page cap for one metric's read. A page holding this many rows,
#: or one the door flags ``truncated``, is read as possibly cut short.
CHECKPOINT_RESULTS_LIMIT = 500
CHECKPOINT_RESULTS_PATH = "/coord/success-metric-checkpoint-results"
#: The criterion a marker row carries — a whole report, not one criterion.
MARKER_CRITERION = "*"
MarkerKind = Literal["prose_only", "invalid_block"]
_MARKERS: frozenset[str] = frozenset({"prose_only", "invalid_block"})
_VERDICTS: frozenset[str] = frozenset({"met", "missed", "unknown"})


class CoordCheckpointResults(Protocol):
    """The one result-rows read. The default goes through the operations
    proxy; tests substitute a fake."""

    async def list_checkpoint_results(
        self, tenant_id: UUID, names: list[str], limit: int
    ) -> dict[str, Any]: ...


async def proxied_list_checkpoint_results(
    tenant_id: UUID, names: list[str], limit: int
) -> dict[str, Any]:
    # Tenant comes from the forwarded principal; coord takes no tenant param.
    result: dict[str, Any] = await _proxy_coord_get(
        CHECKPOINT_RESULTS_PATH,
        params={
            "kind": "success_metric",
            "names": ",".join(names),
            "limit": limit,
        },
        tenant_id=tenant_id,
    )
    return result


# ===========================================================================
# What the read returns
# ===========================================================================


@dataclass
class FindingRows:
    """Everything the table holds for one report (one evidence finding)."""

    finding_id: str
    checkpoint: str
    #: The verdict rows, one per criterion; empty for a marker.
    rows: list[ResultRowRead] = field(default_factory=list)
    measured_at: str | None = None
    #: When coord recorded the rows — a stub report's fallback time.
    recorded_at: str | None = None
    document_version: int | None = None
    gate_id: str | None = None
    #: Set on a marker row: the report has no readable rows, and why.
    marker: MarkerKind | None = None
    marker_text: str | None = None


@dataclass
class MetricRows:
    """One metric's read of the door."""

    state: FindingsReadState
    reason: str | None = None
    by_finding: dict[str, FindingRows] = field(default_factory=dict)
    #: ``truncated`` because the page came back full (or flagged); otherwise
    #: a ``truncated`` state means rows coord served could not be read.
    full: bool = False


@dataclass
class CheckpointRows:
    """Every metric's read, one door read per metric (so one busy metric's
    full page cannot cut another's results short — D6 point 2's reasoning)."""

    by_metric: dict[str, MetricRows] = field(default_factory=dict)

    def for_metric(self, name: str) -> MetricRows:
        return self.by_metric.get(
            name,
            MetricRows(
                state="unavailable",
                reason="this measure's checkpoint results were not read.",
            ),
        )


# ===========================================================================
# The read
# ===========================================================================


def _unavailable_reason(exc: HTTPException) -> str:
    if exc.status_code == 404:
        return (
            "coord's checkpoint-results reader is not answering (HTTP 404), so "
            "the deployed coord predates it or the route is misrouted."
        )
    return f"coord did not answer the checkpoint-results read (HTTP {exc.status_code})."


def _unread(reason: str) -> MetricRows:
    return MetricRows(state="unavailable", reason=reason)


async def read_checkpoint_results(
    coord: CoordCheckpointResults,
    tenant_id: UUID,
    names: list[str],
    gate: asyncio.Semaphore,
) -> CheckpointRows:
    """One door read per metric, bounded by ``gate``. Never raises."""
    reads = await asyncio.gather(
        *(read_metric_checkpoint_results(coord, tenant_id, n, gate) for n in names)
    )
    return CheckpointRows(by_metric=dict(zip(names, reads, strict=True)))


async def read_metric_checkpoint_results(
    coord: CoordCheckpointResults,
    tenant_id: UUID,
    name: str,
    gate: asyncio.Semaphore,
) -> MetricRows:
    """One metric's rows. Never raises: a gap is a state with its reason."""
    try:
        async with gate:
            page = await coord.list_checkpoint_results(
                tenant_id, [name], CHECKPOINT_RESULTS_LIMIT
            )
    except HTTPException as exc:
        return _unread(_unavailable_reason(exc))
    except Exception as exc:  # a gap is reported, never a 500
        logger.exception(
            "overview_objectives_checkpoint_results_read_failed", metric=name
        )
        return _unread(
            "coord's checkpoint-results answer could not be read "
            f"({type(exc).__name__})."
        )
    try:
        return _parse_page(page, name)
    except Exception as exc:  # a malformed answer is a gap, never a 500
        logger.exception(
            "overview_objectives_checkpoint_results_unparseable", metric=name
        )
        return _unread(
            "coord's checkpoint-results answer could not be read "
            f"({type(exc).__name__})."
        )


def _parse_page(page: Any, name: str) -> MetricRows:
    if not isinstance(page, dict):
        return _unread("coord's checkpoint-results answer was not an object.")
    if page.get("available") is not True:
        why = page.get("reason")
        return _unread(
            "coord reports its checkpoint-results store is not provisioned "
            "(`available: false`"
            + (f": {why}" if isinstance(why, str) and why else "")
            + "), which is not the same as there being none."
        )
    raw_rows = page.get("rows")
    if not isinstance(raw_rows, list):
        return _unread("coord's checkpoint-results answer carried no rows list.")

    out = MetricRows(state="ok")
    problems: list[str] = []
    unreadable = 0
    foreign = 0
    for raw in raw_rows:
        # A row that cannot be read, or that names another measure than the
        # one asked for, is counted — never silently dropped.
        parsed = _parse_row(raw)
        if parsed is None:
            unreadable += 1
            continue
        if parsed[0] != name:
            foreign += 1
            continue
        _, fid, item = parsed
        conflict = _merge(out.by_finding, fid, item)
        if conflict:
            problems.append(conflict)
    if foreign:
        problems.insert(
            0,
            f"{foreign} result row(s) coord served for this measure named another "
            "measure, so this measure's results were not fully read.",
        )
    if unreadable:
        problems.insert(
            0,
            f"{unreadable} result row(s) coord served could not be read, so this "
            "measure's results were not fully read.",
        )
    if page.get("truncated") is True or len(raw_rows) >= CHECKPOINT_RESULTS_LIMIT:
        out.state = "truncated"
        out.full = True
        out.reason = (
            "coord says the checkpoint-results page is not the whole answer"
            if page.get("truncated") is True
            else "the checkpoint-results page came back full "
            f"({CHECKPOINT_RESULTS_LIMIT} rows), so some results may not have "
            "been read"
        )
        if problems:
            out.reason += "; " + "; ".join(problems)
    elif problems:
        out.state = "truncated"
        out.reason = "; ".join(problems)
    return out


def _merge(rows: dict[str, FindingRows], fid: str, item: FindingRows) -> str | None:
    """Fold one served row into its report. Returns a problem when a report
    carries both verdict rows and a marker — coord should never serve that,
    so it is logged and named, never silently resolved."""
    have = rows.get(fid)
    if have is None:
        rows[fid] = item
        return None
    if (have.marker is None) == (item.marker is None):
        have.rows.extend(item.rows)  # more verdict rows (or a repeated marker)
        have.measured_at = _latest_time(have.measured_at, item.measured_at)
        return None
    logger.warning(
        "overview_objectives_checkpoint_results_rows_and_marker",
        finding_id=fid,
    )
    if item.marker is None:
        # The verdict rows are shown; the marker is named as the problem.
        have.rows.extend(item.rows)
        have.marker = None
        have.marker_text = None
        have.checkpoint = item.checkpoint
        have.measured_at = item.measured_at
        have.recorded_at = item.recorded_at
        have.document_version = item.document_version
        have.gate_id = item.gate_id
    return (
        f"coord's results table holds both verdict rows and a marker for report "
        f"{fid}; the verdict rows are shown."
    )


def _latest_time(a: str | None, b: str | None) -> str | None:
    """The later of two timestamps; an unparseable one never wins."""
    pa = parse_time(a) if a else None
    pb = parse_time(b) if b else None
    if pb is not None and (pa is None or pb > pa):
        return b
    return a if pa is not None else (b if pb is not None else a or b)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _parse_row(raw: Any) -> tuple[str, str, FindingRows] | None:
    """``(name, finding_id, rows)`` for one served row; ``None`` when it is
    not readable (counted, never silently dropped)."""
    if not isinstance(raw, dict):
        return None
    name = raw.get("name")
    fid = raw.get("evidence_finding_id")
    checkpoint = raw.get("checkpoint")
    criterion = raw.get("criterion")
    verdict = raw.get("verdict")
    measured_at = raw.get("measured_at")
    if not (
        isinstance(name, str)
        and is_uuid(fid)
        and isinstance(checkpoint, str)
        and checkpoint.strip()
        and isinstance(criterion, str)
        and criterion.strip()
        and isinstance(verdict, str)
        and verdict in _VERDICTS
        and isinstance(measured_at, str)
    ):
        return None
    assert isinstance(fid, str)
    version = raw.get("document_version")
    item = FindingRows(
        finding_id=fid,
        checkpoint=checkpoint,
        measured_at=measured_at,
        document_version=(
            version
            if isinstance(version, int) and not isinstance(version, bool)
            else None
        ),
        gate_id=_text(raw.get("gate_id")),
        recorded_at=_text(raw.get("recorded_at")),
    )
    reason = raw.get("unknown_reason")
    if criterion == MARKER_CRITERION:
        if verdict != "unknown" or reason not in _MARKERS:
            return None
        item.marker = "prose_only" if reason == "prose_only" else "invalid_block"
        item.marker_text = _text(raw.get("value_text"))
        return name, fid, item
    window_from, window_to = raw.get("window_from"), raw.get("window_to")
    action = raw.get("action")
    item.rows.append(
        ResultRowRead(
            id=criterion,
            verdict=verdict,  # type: ignore[arg-type]  # checked against _VERDICTS
            value=as_number(raw.get("value")),
            unit=_text(raw.get("unit")),
            value_text=_text(raw.get("value_text")),
            method=_text(raw.get("method")),
            door=_text(raw.get("door")),
            window=(
                WindowRead.model_validate({"from": window_from, "to": window_to})
                if isinstance(window_from, str) and isinstance(window_to, str)
                else None
            ),
            unknown_reason=_text(reason),
            cause=_text(raw.get("cause")),
            action=(
                ActionRead(kind=action["kind"], ref=action["ref"])
                if isinstance(action, dict)
                and isinstance(action.get("kind"), str)
                and isinstance(action.get("ref"), str)
                else None
            ),
        )
    )
    return name, fid, item


# ===========================================================================
# The source entry
# ===========================================================================


def checkpoint_results_source(read: CheckpointRows) -> SourceRead:
    """One entry for every metric's read, naming the metrics whose read
    failed or was cut short (the ``findings`` source's shape)."""
    by = read.by_metric
    unavailable = sorted(n for n, r in by.items() if r.state == "unavailable")
    truncated = sorted(n for n, r in by.items() if r.state == "truncated")
    details = {n: by[n].reason or by[n].state for n in [*unavailable, *truncated]}
    if unavailable:
        everyone = len(unavailable) == len(by)
        return SourceRead(
            status="unavailable",
            reason=(
                "The checkpoint results can't be read for "
                + ("every measure" if everyone else ", ".join(unavailable))
                + ", so their criteria read as unknown: "
                + (by[unavailable[0]].reason or "coord did not answer")
                + (
                    "; the results were also not fully read for " + ", ".join(truncated)
                    if truncated
                    else ""
                )
            ),
            affected=sorted(details),
            details=details,
        )
    if truncated:
        full = any(by[n].full for n in truncated)
        return SourceRead(
            status="truncated" if full else "degraded",
            reason=(
                "The checkpoint results were not fully read for "
                + ", ".join(truncated)
                + "; their unresulted criteria read as not fully read."
            ),
            affected=truncated,
            details=details,
        )
    return SourceRead(status="ok")


__all__ = [
    "CHECKPOINT_RESULTS_LIMIT",
    "CHECKPOINT_RESULTS_PATH",
    "CheckpointRows",
    "CoordCheckpointResults",
    "FindingRows",
    "MetricRows",
    "checkpoint_results_source",
    "proxied_list_checkpoint_results",
    "read_checkpoint_results",
    "read_metric_checkpoint_results",
]
