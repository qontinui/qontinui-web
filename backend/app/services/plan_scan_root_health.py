"""The read-side verdict over per-device plan-scan-source readings.

Plan ``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``,
Revised Phase 2. The runner measures how far the directory its body sync scans
is from its default branch and reports it (``POST /plan-library/scan-roots``);
this module turns the stored rows into what a corpus READER may claim.

Two readers, one function. ``GET /plan-library/scan-roots`` and the
``corpus_health.scan_roots`` block on every ``GET /plan-library`` page and on
``/candidates`` both render through :func:`scan_roots_health`, so the three
renderings of one set of rows cannot disagree — the same pattern as the
capture census, which ``/capture-health`` and the list page share.

Why this lives in a service and not in the scan-roots endpoint module: that
module imports ``plan_library._resolve_org_id``, so ``plan_library`` importing
the verdict back from it would be a cycle.

Invariants (the route docstring in ``plan_library_scan_roots.py`` restates the
first three from the reader's side, numbered there 3, 3a and 3c):

1. **Silence is UNKNOWN, never "current".** No rows reads top-level
   ``state: "unknown"``; a row this server has not heard from within
   :data:`FRESH_WITHIN_SECS` reads ``state: "unknown"`` with an
   ``observation_stale:`` detail.
2. **"0 behind" against a stale ref is UNKNOWN, never "in step".**
3. **A contradicted reading is UNKNOWN.** Precedence: ``observation_stale`` >
   ``reading_superseded`` > ``ref_stale``.
4. **The roll-up is taken over VERDICTS, never over reported values.** A
   source's minimum ``behind`` is drawn only from rows whose verdict is
   ``measured`` — so a device that went quiet, was contradicted, or reported a
   0-behind floor contributes no number. Any feeder can add a plan to the
   corpus, so the least-behind CURRENT feeder bounds what the corpus lacks;
   a stale feeder's old low number would understate it.
5. **The minimum is exact only against ONE fresh ref.** A device's ``behind``
   counts commits on ITS remote-tracking ref, and the default branch only
   moves forward, so its distance to the newest branch is at least what it
   reported: ``min_behind`` is always a true lower bound. It is exact only when
   every measured device counted against the SAME ``ref_sha`` and at least one
   of them fetched that ref within the runner's freshness window — then that
   commit was the branch tip, and every count is against it.
6. **A device is named least-behind or lagging only when the readings PROVE
   it — and counts against different refs prove nothing.** A device exactly 3
   behind a five-hour-old ref can be 13 behind the ref another device is
   exactly 5 behind, so comparing the numbers would name the wrong feeder.
   Placement therefore happens only when every measured device shares one
   non-null ``ref_sha``: all counts are then against the same commit and
   order the devices exactly, whatever each device's floor flag says about
   that commit's age. Otherwise every measured device is
   ``lag_unknown_device_ids``. The four id lists partition the feeders.
7. **A failed read is UNKNOWN, never "no drift".** The block rides on reads
   whose purpose is the corpus, not the drift report, so a scan-root read
   failure there is served as :func:`scan_roots_read_failed` rather than
   failing the page — and never as an empty, agreeable list.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from app.models.plan_scan_root import PlanScanRootObservation
from app.schemas.plan_library_scan_roots import (
    ScanRootListResponse,
    ScanRootRow,
    ScanRootSourceRollup,
)

#: A device not heard from for longer than this (by ``received_at``, this
#: server's clock) is rendered ``unknown``: three 15-minute runner
#: heartbeats. The runner re-posts an unchanged reading at least every 15 min,
#: so one missed heartbeat is jitter and three is a feeder that went quiet.
FRESH_WITHIN_SECS = 2700

#: Top-level ``detail`` for an organization no device has reported for.
NO_OBSERVATION_DETAIL = (
    "no_observation: no device has reported a plan-scan-source reading for "
    "this organization, so whether the corpus's feeders are current is not "
    "established. An empty list is not 'every feeder is current' — a runner "
    "whose build predates the report, or whose body sync is off, sends none."
)

#: ``detail`` for a fresh ``measured`` floor reading 0 behind and 0 ahead.
REF_STALE_ZERO_FLOOR_DETAIL = (
    "ref_stale: 0/0 counts against a ref that is stale or of unknown age are "
    "a lower bound, not agreement"
)


def ref_stale_zero_behind_detail(ahead: int) -> str:
    """``detail`` for a fresh ``measured`` floor reading 0 behind, N > 0 ahead."""
    return (
        "ref_stale: 0 behind against a ref that is stale or of unknown age is a "
        f"lower bound, not agreement (ahead {ahead} is also as of that ref)"
    )


def no_measured_reading_detail(device_count: int) -> str:
    """A roll-up's ``detail`` when none of its devices has a ``measured`` verdict."""
    return (
        f"no_measured_reading: none of the {device_count} device(s) reporting "
        "this scan source has a reading that supports a claim about now (each "
        "row's state and detail say why), so how far behind the corpus's "
        "least-behind feeder is is not established — not 0"
    )


def scan_roots_read_failed(error: BaseException) -> ScanRootListResponse:
    """The block when the readings could not be READ — UNKNOWN, with no rows.

    Names only the error's class: its message can carry SQL and parameters,
    which have no business on a corpus page.
    """
    return ScanRootListResponse(
        state="unknown",
        detail=(
            f"read_failed: the plan-scan-source readings could not be read "
            f"({type(error).__name__}), so whether the corpus's feeders are "
            "current is not established. The empty list is not 'no drift'."
        ),
        fresh_within_secs=FRESH_WITHIN_SECS,
        count=0,
        fresh_count=0,
        rows=[],
        by_source_repo=[],
    )


def observation_age_secs(row: PlanScanRootObservation, *, now: datetime) -> int:
    """Seconds since this server last heard from the device, never negative.

    Judged from ``received_at`` ONLY — this server's clock, the one clock we
    can trust. ``observed_at`` is the runner's and orders readings, but a
    runner clock running behind would age a live device out, and one running
    ahead would keep a silent one fresh, so it has no say in liveness. A skew
    is surfaced as ``observed_skew_secs`` instead.
    """
    return max(0, int((now - row.received_at).total_seconds()))


def observed_skew_secs(row: PlanScanRootObservation) -> int:
    """``received_at - observed_at``, in whole seconds (may be negative)."""
    return int((row.received_at - row.observed_at).total_seconds())


def superseded_detail(row: PlanScanRootObservation) -> str | None:
    """The ``reading_superseded:`` verdict when the latest report was declined.

    A declined report was observed BEFORE the stored reading. This server
    cannot tell why — the runner's clock stepped back, or a report was
    delivered late — so the detail names both and asserts neither. Either way
    the stored reading may not be what the device says now, so serving it as
    current (the defect this closes) could present a contradicted number as
    the truth. N is ``observed_at - last_report_observed_at``: how far before
    the stored reading the latest report was observed, fixed per report.
    """
    if row.last_report_applied:
        return None
    earlier_by = int((row.observed_at - row.last_report_observed_at).total_seconds())
    return (
        "reading_superseded: the device's latest report was observed "
        f"~{earlier_by} s before the stored reading (a clock step-back or a "
        "late-delivered report), so the stored reading may not be what it "
        "reports now"
    )


def zero_behind_floor_detail(row: PlanScanRootObservation) -> str | None:
    """The ``ref_stale:`` verdict for a ``measured`` floor that is 0 behind.

    "0 behind" against a ref that is stale or of unknown age establishes
    nothing — the ref may have moved on since — whatever ``ahead`` says, and
    ``ahead`` is as of that same ref. ``None`` when the rule does not apply:
    not ``measured``, not a floor, or a non-zero ``behind`` (a floor of "at
    least N behind" is a true claim and stays ``measured``).
    """
    if not (row.state == "measured" and row.counts_are_floors and row.behind == 0):
        return None
    if not row.ahead:
        return REF_STALE_ZERO_FLOOR_DETAIL
    return ref_stale_zero_behind_detail(row.ahead)


def render_row(row: PlanScanRootObservation, *, now: datetime) -> ScanRootRow:
    """One stored reading, with the verdict a reader is owed on top.

    Precedence: ``observation_stale`` (a device this server has not heard from
    within the window says nothing about now) > ``reading_superseded`` (the
    device's latest report contradicts the stored reading) > ``ref_stale`` (a
    0-behind floor). Otherwise the verdict is what the device reported.
    """
    age = observation_age_secs(row, now=now)
    fresh = age <= FRESH_WITHIN_SECS
    superseded = superseded_detail(row)
    floor_detail = zero_behind_floor_detail(row)
    state: str
    detail: str | None
    if not fresh:
        state = "unknown"
        detail = (
            f"observation_stale: last report received {age} s ago, past the "
            f"{FRESH_WITHIN_SECS} s freshness window; it reported "
            f"state '{row.state}', which says nothing about now"
        )
    elif superseded is not None:
        state = "unknown"
        detail = superseded
    elif floor_detail is not None:
        state = "unknown"
        detail = floor_detail
    else:
        state = row.state
        detail = row.detail
    return ScanRootRow(
        device_id=row.device_id,
        state=state,  # type: ignore[arg-type]  # CHECK-constrained TEXT
        detail=detail,
        reported_state=row.state,  # type: ignore[arg-type]
        reported_detail=row.detail,
        plans_dir=row.plans_dir,
        repo_root=row.repo_root,
        source_repo=row.source_repo,
        default_ref=row.default_ref,
        ref_sha=row.ref_sha,
        head_sha=row.head_sha,
        behind=row.behind,
        ahead=row.ahead,
        ref_age_secs=row.ref_age_secs,
        counts_are_floors=row.counts_are_floors,
        observed_at=row.observed_at,
        received_at=row.received_at,
        last_report_applied=row.last_report_applied,
        last_report_observed_at=row.last_report_observed_at,
        observed_skew_secs=observed_skew_secs(row),
        observation_age_secs=age,
        observation_fresh=fresh,
    )


def _device_ids(rows: Sequence[ScanRootRow]) -> list[UUID]:
    """Stable, so two reads of the same rows serialize identically."""
    return sorted((row.device_id for row in rows), key=str)


def rollup_source(
    source_repo: str | None, rows: Sequence[ScanRootRow]
) -> ScanRootSourceRollup:
    """The per-scan-source roll-up over ``rows``, which all share ``source_repo``.

    Only a row whose VERDICT is ``measured`` contributes a number (invariant
    4): the verdict already folds in staleness, supersession and the 0-behind
    floor, so reading ``reported_state`` here would let exactly the rows the
    verdict disowns set the minimum. Every row lands in exactly one of the four
    id lists (invariant 6) — the roll-up names every feeder, because a lagging
    or silent one can still write (and regress) the corpus.

    A ``measured`` verdict with no ``behind`` is counted unmeasured. The write
    door refuses such a report, so a stored one is a corrupted row, and a
    count nobody measured must not reach the minimum.
    """
    measured: list[tuple[ScanRootRow, int]] = []
    unmeasured: list[ScanRootRow] = []
    for row in rows:
        if row.state == "measured" and row.behind is not None:
            measured.append((row, row.behind))
        else:
            unmeasured.append(row)
    if not measured:
        return ScanRootSourceRollup(
            source_repo=source_repo,
            state="unknown",
            detail=no_measured_reading_detail(len(rows)),
            device_count=len(rows),
            measured_count=0,
            min_behind=None,
            min_behind_is_floor=None,
            least_behind_device_ids=[],
            lagging_device_ids=[],
            lag_unknown_device_ids=[],
            unmeasured_device_ids=_device_ids(unmeasured),
        )
    min_behind = min(behind for _, behind in measured)
    refs = {row.ref_sha for row, _ in measured}
    # Invariant 6: counts order devices only when they are all against one
    # known commit.
    shared_ref = len(refs) == 1 and None not in refs
    # Invariant 5: exact only when that one commit was fetched fresh by someone.
    min_behind_is_floor = not (
        shared_ref and any(not row.counts_are_floors for row, _ in measured)
    )
    if shared_ref:
        least = [row for row, behind in measured if behind == min_behind]
        lagging = [row for row, behind in measured if behind > min_behind]
        lag_unknown: list[ScanRootRow] = []
    else:
        least, lagging = [], []
        lag_unknown = [row for row, _ in measured]
    return ScanRootSourceRollup(
        source_repo=source_repo,
        state="measured",
        detail=None,
        device_count=len(rows),
        measured_count=len(measured),
        min_behind=min_behind,
        min_behind_is_floor=min_behind_is_floor,
        least_behind_device_ids=_device_ids(least),
        lagging_device_ids=_device_ids(lagging),
        lag_unknown_device_ids=_device_ids(lag_unknown),
        unmeasured_device_ids=_device_ids(unmeasured),
    )


def rollup_by_source_repo(rows: Sequence[ScanRootRow]) -> list[ScanRootSourceRollup]:
    """One roll-up per distinct ``source_repo``, named sources first, then null.

    Grouped on the stored reading's ``source_repo`` — the artifact upsert's
    own form, so a roll-up joins to the artifacts its feeders write. A reading
    with no ``source_repo`` (a runner that is not scanning names none) gets its
    own ``null`` group rather than being folded into a named one.
    """
    groups: dict[str | None, list[ScanRootRow]] = {}
    for row in rows:
        groups.setdefault(row.source_repo, []).append(row)
    ordered = sorted(groups, key=lambda key: (key is None, key or ""))
    return [rollup_source(key, groups[key]) for key in ordered]


def scan_roots_health(
    observations: Sequence[PlanScanRootObservation], *, now: datetime
) -> ScanRootListResponse:
    """Every device's reading, judged, plus the per-source roll-up.

    The one rendering behind ``GET /plan-library/scan-roots`` and
    ``corpus_health.scan_roots``. No rows answers ``state: "unknown"`` with
    :data:`NO_OBSERVATION_DETAIL`, never an empty "all current".
    """
    rows = [render_row(obs, now=now) for obs in observations]
    if not rows:
        return ScanRootListResponse(
            state="unknown",
            detail=NO_OBSERVATION_DETAIL,
            fresh_within_secs=FRESH_WITHIN_SECS,
            count=0,
            fresh_count=0,
            rows=[],
            by_source_repo=[],
        )
    return ScanRootListResponse(
        state="reported",
        detail=None,
        fresh_within_secs=FRESH_WITHIN_SECS,
        count=len(rows),
        fresh_count=sum(1 for r in rows if r.observation_fresh),
        rows=rows,
        by_source_repo=rollup_by_source_repo(rows),
    )
