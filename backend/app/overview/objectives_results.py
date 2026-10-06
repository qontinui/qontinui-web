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

**A read that did not answer is never "no rows".** 404, ``available: false``,
an error or an unreadable answer make the whole read ``unavailable``; a full
page makes the metrics it may have cut ``truncated``. Only a read that
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
from app.overview.objectives_frontmatter import as_number
from app.overview.objectives_models import (
    ActionRead,
    FindingsReadState,
    ResultRowRead,
    SourceRead,
    WindowRead,
)

logger = structlog.get_logger(__name__)

#: The door's page cap for one request. A page holding this many rows, or one
#: the door flags ``truncated``, is read as possibly cut short.
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
    document_version: int | None = None
    gate_id: str | None = None
    #: Set on a marker row: the report has no readable rows, and why.
    marker: MarkerKind | None = None
    marker_text: str | None = None


@dataclass
class MetricRows:
    """One metric's view of the read."""

    state: FindingsReadState
    reason: str | None = None
    by_finding: dict[str, FindingRows] = field(default_factory=dict)


@dataclass
class CheckpointRows:
    """The whole read, every metric's rows."""

    state: FindingsReadState
    reason: str | None = None
    #: metric name → finding id → its rows.
    by_metric: dict[str, dict[str, FindingRows]] = field(default_factory=dict)
    #: metric name → why its rows may be incomplete (a full page, rows coord
    #: served that could not be read).
    partial: dict[str, str] = field(default_factory=dict)
    #: The names the read asked for.
    names: list[str] = field(default_factory=list)
    #: The page came back full (or flagged ``truncated``); otherwise every
    #: ``partial`` entry is rows coord served that could not be read.
    full: bool = False

    def for_metric(self, name: str) -> MetricRows:
        if self.state == "unavailable":
            return MetricRows(state="unavailable", reason=self.reason)
        rows = self.by_metric.get(name, {})
        if name in self.partial:
            return MetricRows(
                state="truncated", reason=self.partial[name], by_finding=rows
            )
        return MetricRows(state=self.state, reason=self.reason, by_finding=rows)


def unread(reason: str) -> CheckpointRows:
    return CheckpointRows(state="unavailable", reason=reason)


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


async def read_checkpoint_results(
    coord: CoordCheckpointResults,
    tenant_id: UUID,
    names: list[str],
    gate: asyncio.Semaphore,
) -> CheckpointRows:
    """One read for every metric's rows. Never raises."""
    result = await _read(coord, tenant_id, names, gate)
    result.names = list(names)
    return result


async def _read(
    coord: CoordCheckpointResults,
    tenant_id: UUID,
    names: list[str],
    gate: asyncio.Semaphore,
) -> CheckpointRows:
    if not names:
        return CheckpointRows(state="ok", names=[])
    try:
        async with gate:
            page = await coord.list_checkpoint_results(
                tenant_id, names, CHECKPOINT_RESULTS_LIMIT
            )
    except HTTPException as exc:
        return unread(_unavailable_reason(exc))
    except Exception as exc:  # a gap is reported, never a 500
        logger.exception("overview_objectives_checkpoint_results_read_failed")
        return unread(
            "coord's checkpoint-results answer could not be read "
            f"({type(exc).__name__})."
        )
    try:
        return _parse_page(page, names)
    except Exception as exc:  # a malformed answer is a gap, never a 500
        logger.exception("overview_objectives_checkpoint_results_unparseable")
        return unread(
            "coord's checkpoint-results answer could not be read "
            f"({type(exc).__name__})."
        )


def _parse_page(page: Any, names: list[str]) -> CheckpointRows:
    if not isinstance(page, dict):
        return unread("coord's checkpoint-results answer was not an object.")
    if page.get("available") is not True:
        why = page.get("reason")
        return unread(
            "coord reports its checkpoint-results store is not provisioned "
            "(`available: false`"
            + (f": {why}" if isinstance(why, str) and why else "")
            + "), which is not the same as there being none."
        )
    raw_rows = page.get("rows")
    if not isinstance(raw_rows, list):
        return unread("coord's checkpoint-results answer carried no rows list.")

    out = CheckpointRows(state="ok", names=list(names))
    wanted = set(names)
    malformed: dict[str, int] = {}
    unattributed = 0
    order: list[str] = []
    for raw in raw_rows:
        parsed = _parse_row(raw)
        name = raw.get("name") if isinstance(raw, dict) else None
        if isinstance(name, str) and (not order or order[-1] != name):
            order.append(name)
        if parsed is None:
            if isinstance(name, str) and name in wanted:
                malformed[name] = malformed.get(name, 0) + 1
            else:
                unattributed += 1
            continue
        name, fid, item = parsed
        if name not in wanted:
            continue
        _merge(out.by_metric.setdefault(name, {}), fid, item)

    for name, count in malformed.items():
        out.partial[name] = (
            f"{count} result row(s) coord served could not be read, so this "
            "measure's results were not fully read."
        )
    if unattributed:
        for name in names:
            out.partial.setdefault(
                name,
                f"{unattributed} result row(s) coord served name no measure "
                "that could be read, so any measure's results may be incomplete.",
            )

    full = page.get("truncated") is True or len(raw_rows) >= CHECKPOINT_RESULTS_LIMIT
    if full:
        out.full = True
        # Rows come ordered by name, so every name's rows are contiguous: a
        # name whose run ended before the page's last name is complete. The
        # last name on the page, and every name that has no rows on it, may
        # have been cut — whatever the server's collation.
        complete = set(order[:-1])
        why = (
            "the checkpoint-results page came back full "
            f"({CHECKPOINT_RESULTS_LIMIT} rows), so some results may not have "
            "been read"
            if page.get("truncated") is not True
            else "coord says the checkpoint-results page is not the whole answer"
        )
        for name in names:
            if name not in complete:
                out.partial.setdefault(name, why)
    return out


def _merge(rows: dict[str, FindingRows], fid: str, item: FindingRows) -> None:
    have = rows.get(fid)
    if have is None:
        rows[fid] = item
        return
    if item.marker is None:
        # Verdict rows win over a marker for the same report.
        have.rows.extend(item.rows)
        if have.marker is not None:
            have.marker = None
            have.marker_text = None
            have.checkpoint = item.checkpoint
            have.measured_at = item.measured_at
            have.document_version = item.document_version
            have.gate_id = item.gate_id


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
    if read.state == "unavailable":
        return SourceRead(
            status="unavailable",
            reason=(
                "The checkpoint results can't be read, so every criterion reads "
                f"as unknown: {read.reason or 'coord did not answer'}"
            ),
            affected=sorted(read.names),
            details=dict.fromkeys(read.names, read.reason or "unavailable"),
        )
    if read.partial:
        cut = sorted(read.partial)
        return SourceRead(
            status="truncated" if read.full else "degraded",
            reason=(
                "The checkpoint results were not fully read for "
                + ", ".join(cut)
                + "; their unresulted criteria read as not fully read."
            ),
            affected=cut,
            details=dict(read.partial),
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
    "unread",
]
