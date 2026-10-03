"""The costs reads beyond the authoring contract, on ``/api/v1/overview``.

``GET /costs/summary``  every figure in the base currency, the KPIs, the
                        labour line, the spend limit, the FX applied, and the
                        estimate comparison (:mod:`app.costs.summary`).
``GET /costs/ledger``   every cost and hour, paged JSON or a CSV export
                        (:mod:`app.costs.ledger`).

The writes are the registry resources ``costs/entries`` and
``costs/effort-entries`` (``app.overview.registry``) — no hand-written CRUD
here. Both reads are open to any member of the ACTIVE project.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.costs.ledger import (
    DEFAULT_PAGE,
    MAX_EXPORT_ROWS,
    MAX_PAGE,
    LedgerKind,
    LedgerPage,
    LedgerQuery,
    ledger_rows,
    to_csv,
)
from app.costs.summary import (
    CostsSummary,
    EstimateNotFound,
    GroupBy,
    build_costs_summary,
    month_bounds,
)
from app.overview.permissions import OverviewAccess, get_overview_access
from app.spend.recurring import View

router = APIRouter(prefix="/costs", tags=["overview:costs"])

#: The longest window one summary or ledger read covers. The all-time
#: figures (total to date, the comparison) are not bounded by it.
MAX_WINDOW_DAYS = 800


def _now() -> datetime:
    return datetime.now(UTC)


def _window(start: date, end: date) -> None:
    if start > end:
        raise HTTPException(
            status_code=422,
            detail={"error": "bad_window", "message": "from is after to."},
        )
    if (end - start).days > MAX_WINDOW_DAYS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "bad_window",
                "message": f"The window is longer than {MAX_WINDOW_DAYS} days.",
            },
        )


@router.get(
    "/summary",
    response_model=CostsSummary,
    response_model_by_alias=True,
)
async def read_costs_summary(
    from_: date | None = Query(
        default=None,
        alias="from",
        description="First day of the window; default the first day of the "
        "month eleven months before `to` (twelve months).",
    ),
    to: date | None = Query(default=None, description="Last day; default today."),
    group_by: GroupBy = Query(default="month"),
    view: View = Query(default="amortized"),
    estimate_id: UUID | None = Query(
        default=None,
        description="The estimate to compare with; default the baseline.",
    ),
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> CostsSummary:
    """Actual cost in the base currency, and the estimate beside it.

    Unknown is ``null`` with a reason, never 0; every conversion applied is
    listed under ``fx``."""
    now = _now()
    end = to or now.astimezone(UTC).date()
    if from_ is None:
        first, _ = month_bounds(end)
        index = first.year * 12 + first.month - 1 - 11
        start = date(index // 12, index % 12 + 1, 1)
    else:
        start = from_
    _window(start, end)
    try:
        return await build_costs_summary(
            db,
            access.tenant_id,
            start=start,
            end=end,
            group_by=group_by,
            view=view,
            estimate_id=estimate_id,
            now=now,
        )
    except EstimateNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "There is no such estimate here."},
        ) from exc


_KINDS: dict[str, frozenset[LedgerKind]] = {
    "all": frozenset({"cost", "recurring", "effort"}),
    "money": frozenset({"cost", "recurring"}),
    "cost": frozenset({"cost"}),
    "recurring": frozenset({"recurring"}),
    "effort": frozenset({"effort"}),
}


@router.get(
    "/ledger",
    response_model=LedgerPage,
    response_model_by_alias=True,
    responses={200: {"content": {"text/csv": {}}}},
)
async def read_ledger(
    from_: date | None = Query(
        default=None, alias="from", description="Default: 365 days before `to`."
    ),
    to: date | None = Query(default=None, description="Default: today."),
    kind: Literal["all", "money", "cost", "recurring", "effort"] = Query(default="all"),
    vendor_id: UUID | None = Query(default=None),
    category: str | None = Query(default=None, max_length=50),
    phase_id: str | None = Query(
        default=None, description="A phase id, or `none` for rows naming no phase."
    ),
    source: Literal["manual", "connector", "recurring", "effort"] | None = Query(
        default=None
    ),
    format: Literal["json", "csv"] = Query(default="json"),
    limit: int = Query(default=DEFAULT_PAGE, ge=1, le=MAX_PAGE),
    offset: int = Query(
        default=0,
        ge=0,
        description=f"At most {MAX_EXPORT_ROWS:,}: deeper than that, narrow the "
        "window or the filters (422 offset_too_large).",
    ),
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> LedgerPage | Response:
    """Every cost entry, recurring charge and time entry in the window,
    newest first. JSON is paged (``limit``/``offset``, offset at most
    100,000 — 422 ``offset_too_large`` beyond); ``format=csv``
    exports every matching row (up to 100,000, ``X-Ledger-Truncated`` when
    there were more)."""
    if offset > MAX_EXPORT_ROWS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "offset_too_large",
                "message": (
                    f"offset is at most {MAX_EXPORT_ROWS:,}; narrow the window "
                    "(from/to) or the filters to reach older rows."
                ),
            },
        )
    end = to or _now().astimezone(UTC).date()
    start = from_ or end - timedelta(days=365)
    _window(start, end)
    if phase_id is not None and phase_id != "none":
        try:
            UUID(phase_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "bad_filter",
                    "message": "phase_id is a phase id or 'none'.",
                },
            ) from exc
    query = LedgerQuery(
        start=start,
        end=end,
        kinds=_KINDS[kind],
        vendor_id=vendor_id,
        category=category,
        phase=phase_id,
        source=source,
    )
    if format == "csv":
        exported, total, _fx, base_currency, _billing = await ledger_rows(
            db, access, query, limit=MAX_EXPORT_ROWS
        )
        headers = {
            "Content-Disposition": (
                f'attachment; filename="ledger-{start.isoformat()}-'
                f'{end.isoformat()}.csv"'
            ),
            "X-Ledger-Rows": str(len(exported)),
        }
        if total > len(exported):
            headers["X-Ledger-Truncated"] = str(total - len(exported))
        return Response(
            content=to_csv(exported, base_currency),
            media_type="text/csv; charset=utf-8",
            headers=headers,
        )
    rows, total, fx, base_currency, billing = await ledger_rows(
        db, access, query, limit=limit, offset=offset
    )
    return LedgerPage(
        base_currency=base_currency,
        labour_billing=billing,
        **{"from": start},
        to=end,
        rows=rows,
        total_rows=total,
        offset=offset,
        limit=limit,
        fx_applied=fx.applied(),
        fx_missing=fx.missing(),
    )
