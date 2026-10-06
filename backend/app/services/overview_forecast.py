"""Where the delivery actually stands against its plan — computed on read.

Plan ``2026-09-19-project-overview-for-business-leaders`` ("Derived values":
*Forecast finish — the remaining phases' planned durations laid after the
current phase's actual/forecast end*) and Phase 4 of
``2026-09-20-overview-authoring-layer`` (the Timeline's header facts).

Pure, like :mod:`app.services.overview_rollup`: loaded rows in, a dict out, and
the only clock is the injected ``today``. Nothing here is stored.

The model, stated so a reader can check a number by hand
=========================================================

Each phase is in one of three states, read from its recorded progress alone:

* **done** — it has an ``actual_end``. It ran from its actual start (its
  planned start when none was recorded) to that end.
* **in progress** — it has an ``actual_start`` and no end. It is forecast to
  take its planned length from the day it started, and to run at least until
  today: a phase still open past its forecast end has not ended.
* **not started** — no actual dates. It starts on its planned start moved by
  the delay carried so far, and never before today.

The **delay carried** is the largest finish slip of any earlier phase, never
less than zero. Moving every later phase by the same amount keeps the plan's
own overlaps (two phases planned to run side by side still do), and a phase
finishing early does not pull the next one in: what starts a phase is usually
outside the project's control, so an early finish is reported, not assumed to
be banked.

The **forecast finish** is the latest forecast end, and the **slip** is the
calendar days between it and the planned finish: positive late, negative
early. Both are ``None`` — with the reason in ``unavailable`` — whenever a
phase lacks planned dates, because a forecast that silently skipped one
phase would be a confident wrong answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from app.models.overview import CalendarBreak, Phase
from app.services.overview_rollup import (
    Unavailable,
    calendar_weeks,
    working_days,
    working_weeks,
)


@dataclass(frozen=True)
class _PhaseForecast:
    state: str
    start: date | None
    end: date | None


def _phase_forecast(phase: Phase, *, today: date, delay_days: int) -> _PhaseForecast:
    if phase.actual_end is not None:
        return _PhaseForecast(
            "done", phase.actual_start or phase.planned_start, phase.actual_end
        )
    state = "in_progress" if phase.actual_start is not None else "not_started"
    if phase.planned_start is None or phase.planned_end is None:
        return _PhaseForecast(state, phase.actual_start, None)
    length = timedelta(days=(phase.planned_end - phase.planned_start).days)
    if phase.actual_start is not None:
        return _PhaseForecast(
            state, phase.actual_start, max(phase.actual_start + length, today)
        )
    start = max(phase.planned_start + timedelta(days=delay_days), today)
    return _PhaseForecast(state, start, start + length)


def _slip(actual: date | None, planned: date | None) -> int | None:
    if actual is None or planned is None:
        return None
    return (actual - planned).days


def _ref(phase: Phase) -> dict[str, Any]:
    return {"id": phase.id, "code": phase.code, "name": phase.name}


def compute_forecast(
    phases: list[Phase],
    breaks: list[CalendarBreak],
    *,
    working_day_factor: Decimal,
    today: date,
) -> dict[str, Any]:
    """The Timeline's derived figures for one estimate's phases.

    ``phases`` need no children loaded; nothing here queries.
    """
    unavailable: list[Unavailable] = []
    ordered = sorted(phases, key=lambda p: (p.sort_order, p.code))
    breaks = sorted(breaks, key=lambda b: b.start_date)

    # ── The plan ────────────────────────────────────────────────────────
    starts = [p.planned_start for p in ordered if p.planned_start]
    ends = [p.planned_end for p in ordered if p.planned_end]
    planned_start = min(starts) if starts else None
    planned_finish = max(ends) if ends else None
    cal_weeks: Decimal | None = None
    work_weeks: Decimal | None = None
    if planned_start and planned_finish:
        cal_weeks = calendar_weeks(planned_start, planned_finish)
        work_weeks = working_weeks(
            working_days(planned_start, planned_finish, breaks, working_day_factor)
        )

    # ── Each phase, in order, carrying the delay forward ────────────────
    undated = [p for p in ordered if p.planned_start is None or p.planned_end is None]
    delay = 0
    rows: list[dict[str, Any]] = []
    for phase in ordered:
        fc = _phase_forecast(phase, today=today, delay_days=delay)
        finish_slip = _slip(fc.end, phase.planned_end)
        if finish_slip is not None:
            delay = max(delay, finish_slip)
        rows.append(
            {
                **_ref(phase),
                "state": fc.state,
                "forecast_start": fc.start,
                "forecast_end": fc.end,
                # Calendar days later (+) or earlier (-) than planned. For a
                # done phase these are what happened; otherwise the forecast.
                "start_slip_days": _slip(fc.start, phase.planned_start),
                "finish_slip_days": finish_slip,
            }
        )

    # ── Where the project is now ────────────────────────────────────────
    in_progress = [
        p for p, r in zip(ordered, rows, strict=True) if r["state"] == "in_progress"
    ]
    not_started = [
        p for p, r in zip(ordered, rows, strict=True) if r["state"] == "not_started"
    ]
    if not ordered:
        position = "no_phases"
    elif in_progress:
        position = "in_progress"
    elif not not_started:
        position = "finished"
    elif len(not_started) == len(ordered):
        position = "not_started"
    else:
        position = "between_phases"
    pending_gate = next((p for p in ordered if p.gate_status == "pending"), None)

    # ── The forecast finish, only when every phase can be forecast ──────
    forecast_finish: date | None = None
    slip_days: int | None = None
    if not ordered:
        unavailable.append(
            Unavailable("forecast", "no_phases", "This estimate has no phases yet.")
        )
    elif undated:
        unavailable.append(
            Unavailable(
                "forecast",
                "phase_dates_missing",
                "No forecast while "
                + ", ".join(f"{p.code} ({p.name})" for p in undated)
                + (" has" if len(undated) == 1 else " have")
                + " no planned start and end.",
            )
        )
    else:
        forecast_finish = max(r["forecast_end"] for r in rows)
        assert planned_finish is not None  # every phase is dated
        slip_days = (forecast_finish - planned_finish).days

    return {
        "today": today,
        "planned_start": planned_start,
        "planned_finish": planned_finish,
        "calendar_weeks": cal_weeks,
        "working_weeks": work_weeks,
        "position": position,
        "current_phase": _ref(in_progress[0]) if in_progress else None,
        "next_phase": _ref(not_started[0]) if not_started else None,
        "next_gate": (
            {**_ref(pending_gate), "criteria": pending_gate.gate_criteria}
            if pending_gate
            else None
        ),
        "forecast_finish": forecast_finish,
        "slip_days": slip_days,
        "phases": rows,
        "unavailable": [
            {"figure": u.figure, "reason": u.reason, "detail": u.detail}
            for u in unavailable
        ],
    }


__all__ = ["compute_forecast"]
