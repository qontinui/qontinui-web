"""A report's timeline as a reader sees it — the D10 view, computed server-side.

Plan ``2026-11-07-interactive-stakeholder-reports-in-the-project-overview``
D10. ``GET /api/v1/overview/reports/{id}/view`` answers with the report, its
stops and, for each stop, what changed since the one before it. The diff is
computed here rather than in the browser because every overview resource is an
API contract first: an unattended agent reads the same changes the page shows.

* **Order is ``(as_of, seq)``**, never ``seq`` alone: a missed checkpoint may
  be backfilled after a later one is already published, so creation order is
  not time order. A stop inserted out of order takes its place, and its
  neighbours' changes are recomputed on the next read — nothing is stored.
* **"Previous" is the previous stop a reader is shown**: withdrawn stops are
  hidden, and a stop withheld whole (it failed today's contract) cannot be
  compared against, so both are skipped.
* **A page holds at most :data:`PAGE_SIZE` stops**, the newest; ``total``,
  ``shown`` and ``truncated`` say so, and ``before=<seq>`` reads the stops
  ordered before that one. A capped list says it was capped.
* **Unknown is not zero**: a cell or figure moving between a number and
  ``null`` is a change, and a cell, figure or item the previous stop did not
  have is ``new`` — never a move from zero.

This module only computes; :mod:`app.overview.reports` loads, withholds and
serves.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

#: The most stops one view answers with.
PAGE_SIZE = 48


class CellChange(BaseModel):
    table_id: str
    row_id: str
    column_id: str
    from_: float | None = Field(alias="from")
    to: float | None
    #: The previous stop had no such cell (its table, row or column is new).
    new: bool


class FigureChange(BaseModel):
    figure_id: str
    from_: float | None = Field(alias="from")
    to: float | None
    verdict_from: str | None
    verdict_to: str
    new: bool


class ItemChange(BaseModel):
    item_id: str
    from_status: str | None
    to_status: str
    new: bool


class EventInInterval(BaseModel):
    """An item event dated after the previous stop and up to this one."""

    item_id: str
    at: date
    label: str


class SnapshotChanges(BaseModel):
    """What changed since the previous stop a reader is shown."""

    previous_seq: int
    #: The two stops were measured differently (``method.kind``): compare
    #: with care.
    method_changed: bool
    cells: list[CellChange]
    figures: list[FigureChange]
    items: list[ItemChange]
    events: list[EventInInterval]


class ViewSnapshot(BaseModel):
    id: str
    seq: int
    version: int
    label: str
    as_of: datetime
    method_kind: str
    method_label: str
    source_path: str | None
    content_sha256: str
    allowlist_version: int
    scope_version: int
    created_at: datetime
    created_by: str | None
    via_device: UUID | None
    via_session: str | None
    #: The ``report-snapshot/v1`` document after today's checks: a string a
    #: newer confidential term matches reads ``[withheld]``, and a link whose
    #: owner is not first-party (or every link, while the owners are UNKNOWN)
    #: is gone. ``withheld`` on the view names each such slot.
    data: dict[str, Any]
    #: ``None`` for the first stop a reader is shown.
    changes_since_previous: SnapshotChanges | None


class WithheldEntry(BaseModel):
    """A slot the view did not serve. When ``seq`` is absent from
    ``snapshots`` the whole stop was withheld, and ``slot`` names why."""

    seq: int
    slot: str
    reason: str


@dataclass
class Stop:
    """One served stop, as the diff reads it."""

    seq: int
    as_of: datetime
    data: dict[str, Any]


def _by_id(entries: Sequence[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {entry["id"]: entry for entry in entries}


def _rows(table: dict[str, Any]) -> list[dict[str, Any]]:
    return [*table.get("rows", []), *table.get("summary_rows", [])]


def _as_of_date(moment: datetime) -> date:
    return moment.astimezone(UTC).date()


def changes_between(previous: Stop, current: Stop) -> SnapshotChanges:
    """What changed from ``previous`` to ``current`` (D10)."""
    before, after = previous.data, current.data
    cells: list[CellChange] = []
    old_tables = _by_id(before.get("tables", []))
    for table in after.get("tables", []):
        old_table = old_tables.get(table["id"])
        old_rows = _by_id(_rows(old_table)) if old_table is not None else {}
        old_columns = (
            {c["id"] for c in old_table.get("columns", [])} if old_table else set()
        )
        for row in _rows(table):
            old_row = old_rows.get(row["id"])
            for column in table.get("columns", []):
                column_id = column["id"]
                to = row["cells"][column_id]["value"]
                old_cell = (
                    old_row["cells"].get(column_id)
                    if old_row is not None and column_id in old_columns
                    else None
                )
                if old_cell is None:
                    change: dict[str, Any] = {"from": None, "new": True}
                elif old_cell["value"] == to:
                    continue
                else:
                    change = {"from": old_cell["value"], "new": False}
                cells.append(
                    CellChange(
                        table_id=table["id"],
                        row_id=row["id"],
                        column_id=column_id,
                        to=to,
                        **change,
                    )
                )
    figures: list[FigureChange] = []
    old_figures = _by_id(before.get("figures", []))
    for figure in after.get("figures", []):
        old = old_figures.get(figure["id"])
        if old is not None and (old["value"], old["verdict"]) == (
            figure["value"],
            figure["verdict"],
        ):
            continue
        figures.append(
            FigureChange(
                figure_id=figure["id"],
                to=figure["value"],
                verdict_from=None if old is None else old["verdict"],
                verdict_to=figure["verdict"],
                new=old is None,
                **{"from": None if old is None else old["value"]},
            )
        )
    items: list[ItemChange] = []
    events: list[EventInInterval] = []
    old_items = _by_id(before.get("items", []))
    since, until = _as_of_date(previous.as_of), _as_of_date(current.as_of)
    for item in after.get("items", []):
        old = old_items.get(item["id"])
        if old is None or old["status"] != item["status"]:
            items.append(
                ItemChange(
                    item_id=item["id"],
                    from_status=None if old is None else old["status"],
                    to_status=item["status"],
                    new=old is None,
                )
            )
        for event in item.get("events", []):
            at = date.fromisoformat(event["at"])
            if since < at <= until:
                events.append(
                    EventInInterval(item_id=item["id"], at=at, label=event["label"])
                )
    events.sort(key=lambda e: (e.at, e.item_id))
    return SnapshotChanges(
        previous_seq=previous.seq,
        method_changed=before["method"]["kind"] != after["method"]["kind"],
        cells=cells,
        figures=figures,
        items=items,
        events=events,
    )


@dataclass(frozen=True)
class Window:
    """Which stops, of a report's ordered series, one view answers with."""

    #: Positions in the ordered series (``(as_of, seq)``) of the page's stops.
    page: range
    #: More stops exist before the page than it holds.
    truncated: bool


def window(count_before: int) -> Window:
    """The page over the first ``count_before`` stops of the ordered series:
    the newest :data:`PAGE_SIZE` of them."""
    start = max(count_before - PAGE_SIZE, 0)
    return Window(page=range(start, count_before), truncated=start > 0)
