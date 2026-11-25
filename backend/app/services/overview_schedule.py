"""The Project Overview schedule: phases, milestones and gates derived from coord.

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` Phase 2
(D1-D8). Three layers, each testable without the others:

1. :func:`build_coord_schedule` reads coord through a
   :class:`~app.overview.coord_schedule.CoordScheduleSource` and returns the
   envelope coord ALONE supports, plus whether a coord failure degraded it. It
   issues no write to coord and consults no hand-entered row (the device
   document door may record a policy read in coord as a side effect of serving it).
2. :class:`ScheduleService` caches that envelope per ``(tenant, door)`` for
   :data:`TTL_SECONDS` with single-flight, and serves the last good one,
   marked stale, for up to :data:`STALE_LIMIT_SECONDS` after a coord failure (D8).
3. :func:`apply_entered` lays the project's hand-entered progress and milestones
   over it (D5: coord wins, a differing entered value is shown beside it, an
   entered value stands in only where coord is unknown) and computes the forecast
   through :func:`~app.services.overview_forecast.compute_forecast` unchanged.

A coord value never becomes a typed row and a typed row never becomes a coord
value: nothing here writes either. The only write is the best-effort,
non-blocking last-known stamp (:func:`stamp_figures`), written by this read path
alone and never able to fail a read.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal, cast
from uuid import UUID

import structlog
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import OverviewScheduleLastKnown, Phase
from app.overview.coord_schedule import (
    DECISION_RECORD_CAP,
    DEFAULT_INITIATIVE,
    GATE_PAGE,
    GATE_VERDICTS,
    MAX_GATE_PAGES,
    MAX_UNIT_PAGES,
    READ_CONCURRENCY,
    SCHEDULE_UNIT_CAP,
    UNIT_PAGE,
    CoordNotFound,
    CoordReadError,
    CoordScheduleSource,
    DeclaredPhase,
    DeliveryFacts,
    InitiativeFacts,
    MilestoneFacts,
    TenantMismatch,
    UnitFacts,
    assert_rows_in_tenant,
    classify_gates,
    declared_phases,
    find_programmes,
    metadata_of,
    parse_initiative,
    parse_instant,
    parse_milestones,
    phase_links,
    phase_state,
    unit_of,
    valid_date,
)
from app.schemas.overview_schedule import (
    Disagrees,
    Entered,
    ForecastBasis,
    ForecastValue,
    GatesSection,
    GateView,
    InitiativeView,
    MilestonesSection,
    MilestoneView,
    OtherChecks,
    PhaseView,
    ReadExtent,
    Resolved,
    ResolvedSource,
    ScheduleEnvelope,
    SchedulePhaseRef,
    SourceKind,
    SourceStamp,
    UnitRef,
    UnknownReason,
)
from app.services.overview_forecast import compute_forecast

logger = structlog.get_logger(__name__)

#: Plan D8: how long a coord read is reused, and how long a failure may be
#: papered over by the last good one.
TTL_SECONDS = 60
STALE_LIMIT_SECONDS = 600

Clock = Callable[[], dt.datetime]


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class ScheduleMetrics:
    """Counters the route bumps; read by tests and by whoever wires metrics."""

    def __init__(self) -> None:
        self.tenant_mismatch = 0

    def reset(self) -> None:
        self.tenant_mismatch = 0


metrics = ScheduleMetrics()


# ---------------------------------------------------------------------------
# Resolved constructors
# ---------------------------------------------------------------------------


def _src(kind: SourceKind, label: str, version: int | None = None) -> ResolvedSource:
    return ResolvedSource(kind=kind, label=label, version=version)


def _known(value: Any, source: ResolvedSource, now: dt.datetime) -> Resolved[Any]:
    return Resolved(value=value, state="known", source=source, observed_at=now)


def _unknown(
    reason: UnknownReason, source: ResolvedSource, now: dt.datetime
) -> Resolved[Any]:
    return Resolved(
        value=None,
        state="unknown",
        source=source,
        observed_at=now,
        unknown_reason=reason,
    )


def _date_of(instant: dt.datetime) -> dt.date:
    return instant.astimezone(dt.UTC).date()


def _norm(text: str) -> str:
    return " ".join(text.casefold().split())


# ---------------------------------------------------------------------------
# Layer 1 — read coord
# ---------------------------------------------------------------------------

PROGRAMME_SRC = ("coord_work_unit", "The project's programme plan")
UNITS_SRC = ("coord_work_unit", "Linked work units")
DELIVERY_SRC = ("coord_delivery", "The programme's delivery record")
DOC_SRC = ("coord_document", "The current initiative")
GATES_SRC = ("coord_gates", "Decision gates")


def _s(spec: tuple[str, str], version: int | None = None) -> ResolvedSource:
    return _src(cast(SourceKind, spec[0]), spec[1], version)


@dataclass
class _Reads:
    """Everything one fan-out learned, before it is shaped into the envelope."""

    now: dt.datetime
    door: Literal["operator", "device"]
    tenant_id: UUID
    rows: list[dict[str, Any]] = field(default_factory=list)
    scan_truncated: bool = False
    scan_failure: UnknownReason | None = None
    extra_units: dict[str, UnitFacts | UnknownReason] = field(default_factory=dict)
    direct_reads: int = 0
    degraded: bool = False

    def fail(self, exc: CoordReadError) -> UnknownReason:
        # Any failed read (outage OR denial) means this is not a real coord
        # answer, so the cache keeps the last good envelope instead of replacing it.
        self.degraded = True
        return exc.reason


async def _scan_units(source: CoordScheduleSource, reads: _Reads) -> None:
    """Page the work-unit list. coord's ``count`` is the PAGE size, so only an
    EMPTY page ends the list (Phase 1 correction 2); hitting the page bound
    without one is a truncated scan, never "no programme"."""
    offset = 0
    for _ in range(MAX_UNIT_PAGES):
        page = await source.work_unit_page(UNIT_PAGE, offset)
        batch = page.get("work_units")
        if not isinstance(batch, list):
            raise CoordReadError("coord_unreachable", "work-unit page had no list")
        rows = [r for r in batch if isinstance(r, dict)]
        if not batch:
            return
        assert_rows_in_tenant(rows, reads.tenant_id, what="work units")
        reads.rows.extend(rows)
        offset += len(batch)
    reads.scan_truncated = True


def _units_by_slug(reads: _Reads) -> dict[str, dict[str, Any]]:
    return {str(r.get("slug")): r for r in reads.rows if r.get("slug")}


async def _unit_facts(
    source: CoordScheduleSource, reads: _Reads, slug: str
) -> UnitFacts | UnknownReason | None:
    """Facts of one unit: from the scan, else (bounded) a direct read. ``None``
    means coord says the unit does not exist; a reason means the read failed."""
    by_slug = _units_by_slug(reads)
    if slug in by_slug:
        return UnitFacts.from_row(by_slug[slug])
    if slug in reads.extra_units:
        got = reads.extra_units[slug]
        return got
    if not reads.scan_truncated:
        return None  # a COMPLETE scan did not find it: it is not there
    if reads.direct_reads >= SCHEDULE_UNIT_CAP:
        return "truncated"
    reads.direct_reads += 1
    try:
        row = unit_of(await source.work_unit(slug))
        assert_rows_in_tenant([row], reads.tenant_id, what="work unit")
    except CoordNotFound:
        return None
    except CoordReadError as exc:
        reads.extra_units[slug] = reads.fail(exc)
        return reads.extra_units[slug]
    facts = UnitFacts.from_row(row)
    reads.extra_units[slug] = facts
    return facts


async def _read_gates(
    source: CoordScheduleSource,
    reads: _Reads,
    slugs: list[str],
) -> tuple[list[dict[str, Any]], ReadExtent]:
    """Every gate of each schedule unit, paged, at most
    :data:`SCHEDULE_UNIT_CAP` units with :data:`READ_CONCURRENCY` in flight. A
    unit left out by the cap, or a unit whose pages hit the bound, is reported
    as truncated. A failed page raises: a failed read is never an empty list."""
    chosen = slugs[:SCHEDULE_UNIT_CAP]
    gate = asyncio.Semaphore(READ_CONCURRENCY)
    truncated = len(slugs) > len(chosen)

    async def one(slug: str) -> tuple[list[dict[str, Any]], bool]:
        async with gate:
            got: list[dict[str, Any]] = []
            total: int | None = None
            for _ in range(MAX_GATE_PAGES):
                try:
                    page = await source.gates_page(slug, GATE_PAGE, len(got))
                except CoordNotFound as exc:
                    raise CoordReadError(
                        "coord_unreachable", f"gates for {slug}: not found"
                    ) from exc
                rows = page.get("gates")
                total = (
                    page.get("total") if isinstance(page.get("total"), int) else None
                )
                if not isinstance(rows, list) or total is None:
                    raise CoordReadError(
                        "coord_unreachable", f"gate page for {slug} was malformed"
                    )
                typed = [r for r in rows if isinstance(r, dict)]
                if any(r.get("work_unit_slug") not in (None, slug) for r in typed):
                    raise CoordReadError(
                        "coord_unreachable",
                        f"gate page for {slug} held another unit's rows",
                    )
                assert_rows_in_tenant(typed, reads.tenant_id, what="gates")
                got.extend(typed)
                if len(got) >= total or not rows:
                    break
            return got, total is None or len(got) < total

    results = await asyncio.gather(*(one(s) for s in chosen), return_exceptions=True)
    gates: list[dict[str, Any]] = []
    for result in results:
        if isinstance(result, BaseException):
            raise result
        rows, cut = result
        gates.extend(rows)
        truncated = truncated or cut
    return gates, ReadExtent(read=len(chosen), total=len(slugs), truncated=truncated)


def _milestone_status(
    m: MilestoneFacts,
    units: dict[str, UnitFacts | UnknownReason | None],
    gates_by_id: dict[str, dict[str, Any]],
    gates_ok: bool,
    now: dt.datetime,
    gates_truncated: bool = False,
) -> tuple[Resolved[Any], Resolved[Any]]:
    """``(status, met_at)`` per D2 "Milestone met": a linked unit is met iff
    shipped, at its ``first_shipped_at``; a linked gate iff cleared, at
    ``cleared_at``; neither link is ``not_confirmed``, never met and never late."""
    src_u, src_g = _s(UNITS_SRC), _s(GATES_SRC)
    if m.work_unit:
        got = units.get(m.work_unit)
        if got is None or isinstance(got, str):
            reason: UnknownReason = got if isinstance(got, str) else "not_recorded"  # type: ignore[assignment]
            return _unknown(reason, src_u, now), _unknown(reason, src_u, now)
        if got.shipped:
            if got.first_shipped_at is None or got.retracted:
                why: UnknownReason = (
                    "ship_retracted" if got.retracted else "not_recorded"
                )
                return _known("met", src_u, now), _unknown(why, src_u, now)
            return _known("met", src_u, now), _known(
                _date_of(got.first_shipped_at), src_u, now
            )
        return _known("not_met", src_u, now), _unknown("not_recorded", src_u, now)
    if m.gate:
        if not gates_ok:
            return _unknown("coord_unreachable", src_g, now), _unknown(
                "coord_unreachable", src_g, now
            )
        gate = gates_by_id.get(m.gate)
        if gate is None:
            # Absent from a read that was cut short is not absent from coord.
            gate_why: UnknownReason = "truncated" if gates_truncated else "not_recorded"
            return _unknown(gate_why, src_g, now), _unknown(gate_why, src_g, now)
        if gate.get("verdict") == "cleared":
            at = _instant(gate.get("cleared_at"))
            return (
                _known("met", src_g, now),
                _known(_date_of(at), src_g, now)
                if at
                else _unknown("not_recorded", src_g, now),
            )
        return _known("not_met", src_g, now), _unknown("not_recorded", src_g, now)
    return (
        _known("not_confirmed", _s(DOC_SRC), now),
        _unknown("not_declared", _s(DOC_SRC), now),
    )


def _instant(value: object) -> dt.datetime | None:
    return parse_instant(value)


def _unknown_envelope(
    tenant_id: UUID,
    door: Literal["operator", "device"],
    reason: UnknownReason,
    now: dt.datetime,
    *,
    unreadable: ReadExtent | None = None,
) -> ScheduleEnvelope:
    """Every figure unknown for ONE reason, with no list standing in for "none"."""
    doc = _s(DOC_SRC)
    return ScheduleEnvelope(
        tenant_id=tenant_id,
        door=door,
        observed_at=now,
        programme=_unknown(reason, _s(PROGRAMME_SRC), now),
        initiative=InitiativeView(
            name="/".join(DEFAULT_INITIATIVE),
            starts=_unknown(reason, doc, now),
            ends=_unknown(reason, doc, now),
        ),
        phases=_unknown(reason, _s(PROGRAMME_SRC), now),
        milestones=MilestonesSection(items=_unknown(reason, doc, now)),
        gates=GatesSection(
            items=_unknown(reason, _s(GATES_SRC), now),
            other_checks_not_shown=OtherChecks(total=0),
            read=unreadable or ReadExtent(read=0),
        ),
        forecast=_unknown(reason, _src("derived", "Computed from the schedule"), now),
        work_units=unreadable or ReadExtent(read=0),
    )


async def build_coord_schedule(
    source: CoordScheduleSource, tenant_id: UUID, now: dt.datetime
) -> tuple[ScheduleEnvelope, bool]:
    """Read coord and shape what it says. Returns ``(envelope, degraded)``;
    ``degraded`` is true when a read failed for want of coord (the cache then
    prefers the last good envelope, D8). Never raises for a coord failure:
    each figure degrades to ``unknown`` with the reason, and a tenant mismatch
    (D7) turns the whole envelope ``unknown``."""
    reads = _Reads(now=now, door=source.door, tenant_id=tenant_id)
    try:
        return await _build(source, reads), reads.degraded
    except (KeyError, TypeError, AttributeError, ValueError) as exc:
        # A payload of a shape this reader does not know is unreadable, which is
        # not the same as empty and not a coord outage (nothing to fall back to).
        logger.warning(
            "overview_schedule_unparseable", tenant_id=str(tenant_id), error=repr(exc)
        )
        return _unknown_envelope(tenant_id, source.door, "unparseable", now), True
    except TenantMismatch as exc:
        metrics.tenant_mismatch += 1
        logger.warning(
            "overview_schedule_tenant_mismatch",
            tenant_id=str(tenant_id),
            door=source.door,
            detail=str(exc),
        )
        return _unknown_envelope(tenant_id, source.door, "tenant_mismatch", now), False


async def _build(source: CoordScheduleSource, reads: _Reads) -> ScheduleEnvelope:
    now, tenant_id = reads.now, reads.tenant_id
    kind, name = DEFAULT_INITIATIVE

    # -- the initiative document -------------------------------------------
    doc_failure: UnknownReason | None = None
    initiative_version: int | None = None
    facts = InitiativeFacts()
    try:
        facts, initiative_version = await _read_initiative(source, reads, kind, name)
    except CoordNotFound:
        doc_failure = "not_declared"
    except CoordReadError as exc:
        doc_failure = reads.fail(exc)

    # -- the work units, and the programme ---------------------------------
    programme_row: dict[str, Any] | None = None
    programme_failure: UnknownReason | None = None
    programme_key = facts.scalars.get("programme")
    try:
        await _scan_units(source, reads)
    except CoordNotFound:
        # coord answering 404 for the list door is not "no units": it is a scan
        # that could not be made.
        reads.scan_failure = reads.fail(
            CoordReadError("coord_unreachable", "work-unit list answered 404")
        )
        reads.rows = []
    except CoordReadError as exc:
        reads.scan_failure = reads.fail(exc)
        reads.rows = []
    if programme_key:
        by_slug = _units_by_slug(reads)
        if programme_key in by_slug:
            programme_row = by_slug[programme_key]
        else:
            try:
                programme_row = unit_of(await source.work_unit(programme_key))
                assert_rows_in_tenant([programme_row], tenant_id, what="programme")
            except CoordNotFound:
                programme_failure = "no_programme"
            except CoordReadError as exc:
                programme_failure = reads.fail(exc)
    elif reads.scan_failure is not None:
        programme_failure = reads.scan_failure
    else:
        found = find_programmes(reads.rows)
        if len(found) >= 2:
            programme_failure = "ambiguous_programme"
        elif reads.scan_truncated:
            programme_failure = "truncated"
        elif found:
            programme_row = found[0]
        else:
            programme_failure = "no_programme"

    extent = ReadExtent(
        read=len(reads.rows), total=None, truncated=reads.scan_truncated
    )
    doc_src = _s(DOC_SRC, initiative_version)

    # -- the initiative's own figures --------------------------------------
    initiative = _initiative_view(
        facts, doc_failure, doc_src, name, kind, now, initiative_version
    )
    milestone_rows, unreadable_rows = (
        parse_milestones(facts) if doc_failure is None else ([], [])
    )
    if (
        doc_failure == "not_declared"
        and programme_row is not None
        and programme_key is None
    ):
        named = str(metadata_of(programme_row).get("intent_initiative") or "")
        n_kind, _, n_name = named.partition("/")
        if n_name and (n_kind, n_name) != DEFAULT_INITIATIVE:
            try:
                facts, initiative_version = await _read_initiative(
                    source, reads, n_kind, n_name
                )
                doc_failure = None
                doc_src = _s(DOC_SRC, initiative_version)
                initiative = _initiative_view(
                    facts, None, doc_src, n_name, n_kind, now, initiative_version
                )
                milestone_rows, unreadable_rows = parse_milestones(facts)
            except CoordNotFound:
                pass
            except CoordReadError as exc:
                doc_failure = reads.fail(exc)

    if programme_row is None:
        reason = programme_failure or "no_programme"
        return _assemble_without_programme(
            reads,
            reason,
            initiative,
            doc_failure,
            doc_src,
            milestone_rows,
            unreadable_rows,
            extent,
        )
    return await _assemble(
        source,
        reads,
        programme_row,
        initiative,
        doc_failure,
        doc_src,
        milestone_rows,
        unreadable_rows,
        extent,
        facts,
    )


def _document_of(payload: dict[str, Any]) -> dict[str, Any]:
    """A prompt-document read answers flat or wrapped as ``{"document": {...}}``.
    A ``document`` key that is not an object is a payload of a shape this reader
    does not know: ``ValueError``, which the build maps to an ``unparseable``
    envelope (never an assertion, which would 500 the route)."""
    if "document" in payload:
        inner = payload["document"]
        if not isinstance(inner, dict):
            raise ValueError("document payload was not an object")
        return inner
    return payload


async def _read_initiative(
    source: CoordScheduleSource, reads: _Reads, kind: str, name: str
) -> tuple[InitiativeFacts, int | None]:
    doc = _document_of(await source.document(kind, name))
    # A document must prove its tenant on either door (coord's document row
    # carries a non-null tenant_id), or it is refused (plan D7).
    assert_rows_in_tenant([doc], reads.tenant_id, what="initiative")
    body = doc.get("body")
    if not isinstance(body, str):
        raise CoordReadError("coord_unreachable", "initiative document carried no body")
    version = doc.get("current_version")
    return parse_initiative(body), version if isinstance(version, int) else None


def _initiative_view(
    facts: InitiativeFacts,
    failure: UnknownReason | None,
    src: ResolvedSource,
    name: str,
    kind: str,
    now: dt.datetime,
    version: int | None,
) -> InitiativeView:
    def one(key: str) -> Resolved[Any]:
        if failure is not None:
            return _unknown(failure, src, now)
        raw = facts.scalars.get(key)
        if raw is None:
            return _unknown("not_declared", src, now)
        iso = valid_date(raw)
        if iso is None:
            return _unknown("unparseable", src, now)
        return _known(dt.date.fromisoformat(iso), src, now)

    return InitiativeView(
        name=f"{kind}/{name}",
        version=version,
        starts=one("starts"),
        ends=one("ends"),
    )


def _milestone_section(
    rows: list[MilestoneFacts],
    unreadable: list[str],
    failure: UnknownReason | None,
    src: ResolvedSource,
    now: dt.datetime,
    statuses: dict[int, tuple[Resolved[Any], Resolved[Any]]],
    records: dict[str, int | None],
) -> MilestonesSection:
    if failure is not None:
        return MilestonesSection(items=_unknown(failure, src, now))
    views: list[MilestoneView] = []
    for index, row in enumerate(rows):
        status, met_at = statuses[index]
        views.append(
            MilestoneView(
                id=row.id,
                name=row.name,
                shown_by=row.shown_by,
                target_date=_known(dt.date.fromisoformat(row.target_date), src, now),
                status=status,
                met_at=met_at,
                sources=["coord"],
                decision_record=row.decision_record,
                decision_record_version=records.get(row.decision_record or ""),
            )
        )
    return MilestonesSection(items=_known(views, src, now), unreadable_rows=unreadable)


def _assemble_without_programme(
    reads: _Reads,
    reason: UnknownReason,
    initiative: InitiativeView,
    doc_failure: UnknownReason | None,
    doc_src: ResolvedSource,
    milestone_rows: list[MilestoneFacts],
    unreadable_rows: list[str],
    extent: ReadExtent,
) -> ScheduleEnvelope:
    now = reads.now
    # Milestones are the initiative's own: a missing programme does not make
    # their DATES unknown, only whether they are met (linked units are unreadable).
    statuses = {
        i: (
            _known("not_confirmed", doc_src, now)
            if not (m.work_unit or m.gate)
            else _unknown(reason, _s(PROGRAMME_SRC), now),
            _unknown(
                "not_declared" if not (m.work_unit or m.gate) else reason,
                _s(PROGRAMME_SRC),
                now,
            ),
        )
        for i, m in enumerate(milestone_rows)
    }
    return ScheduleEnvelope(
        tenant_id=reads.tenant_id,
        door=reads.door,
        observed_at=now,
        programme=_unknown(reason, _s(PROGRAMME_SRC), now),
        initiative=initiative,
        phases=_unknown(reason, _s(PROGRAMME_SRC), now),
        milestones=_milestone_section(
            milestone_rows, unreadable_rows, doc_failure, doc_src, now, statuses, {}
        ),
        gates=GatesSection(
            items=_unknown(reason, _s(GATES_SRC), now),
            other_checks_not_shown=OtherChecks(total=0),
            read=ReadExtent(read=0, total=0),
        ),
        forecast=_unknown(reason, _src("derived", "Computed from the schedule"), now),
        work_units=extent,
        sources=_sources(now, doc_src if doc_failure is None else None, None),
    )


def _sources(
    now: dt.datetime, doc: ResolvedSource | None, programme: ResolvedSource | None
) -> list[SourceStamp]:
    out: list[SourceStamp] = []
    for src in (doc, programme):
        if src is not None:
            out.append(
                SourceStamp(
                    kind=src.kind, label=src.label, version=src.version, observed_at=now
                )
            )
    return out


async def _assemble(
    source: CoordScheduleSource,
    reads: _Reads,
    programme_row: dict[str, Any],
    initiative: InitiativeView,
    doc_failure: UnknownReason | None,
    doc_src: ResolvedSource,
    milestone_rows: list[MilestoneFacts],
    unreadable_rows: list[str],
    extent: ReadExtent,
    facts: InitiativeFacts,
) -> ScheduleEnvelope:
    now = reads.now
    prog_slug = str(programme_row.get("slug"))
    prog_src = _s(PROGRAMME_SRC)
    programme = _known(
        UnitRef(slug=prog_slug, title=programme_row.get("title") or None), prog_src, now
    )
    phases_declared, unreadable_phases = declared_phases(programme_row)

    # -- delivery axis ------------------------------------------------------
    delivery: DeliveryFacts | None = None
    delivery_failure: UnknownReason | None = None
    try:
        delivery = DeliveryFacts.from_payload(await source.delivery(prog_slug))
    except CoordNotFound:
        delivery_failure = "not_recorded"
    except CoordReadError as exc:
        delivery_failure = reads.fail(exc)

    # -- linked units -------------------------------------------------------
    links = phase_links(programme_row, reads.rows)
    unit_state: dict[str, UnitFacts | UnknownReason | None] = {}
    linked_slugs = list(dict.fromkeys(s for slugs in links.values() for s in slugs))
    milestone_unit_slugs = [m.work_unit for m in milestone_rows if m.work_unit]
    for slug in dict.fromkeys([*linked_slugs, *milestone_unit_slugs]):
        unit_state[slug] = await _unit_facts(source, reads, slug)

    # -- gates --------------------------------------------------------------
    schedule_slugs = list(dict.fromkeys([prog_slug, *linked_slugs]))
    gates_rows: list[dict[str, Any]] = []
    gates_failure: UnknownReason | None = None
    gates_extent = ReadExtent(read=0, total=len(schedule_slugs))
    try:
        gates_rows, gates_extent = await _read_gates(source, reads, schedule_slugs)
    except CoordReadError as exc:
        gates_failure = reads.fail(exc)
    gates_by_id = {
        str(g.get("gate_id") or g.get("id")): g
        for g in gates_rows
        if g.get("gate_id") or g.get("id")
    }

    # -- decision records the milestones cite --------------------------------
    record_versions: dict[str, int | None] = {}
    for cited in list(
        dict.fromkeys(m.decision_record for m in milestone_rows if m.decision_record)
    )[:DECISION_RECORD_CAP]:
        r_kind, _, r_name = cited.partition("/")
        if not r_name:
            continue
        try:
            doc = _document_of(await source.document(r_kind, r_name))
            assert_rows_in_tenant([doc], reads.tenant_id, what="decision record")
            v = doc.get("current_version")
            record_versions[cited] = v if isinstance(v, int) else None
        except (CoordNotFound, CoordReadError) as exc:
            if isinstance(exc, CoordReadError):
                reads.fail(exc)
            record_versions[cited] = None

    # -- milestones ---------------------------------------------------------
    statuses = {
        i: _milestone_status(
            m,
            unit_state,
            gates_by_id,
            gates_failure is None,
            now,
            gates_extent.truncated,
        )
        for i, m in enumerate(milestone_rows)
    }
    milestones = _milestone_section(
        milestone_rows,
        unreadable_rows,
        doc_failure,
        doc_src,
        now,
        statuses,
        record_versions,
    )

    # -- phases -------------------------------------------------------------
    by_key = {
        _norm(k): m.target_date
        for m in milestone_rows
        for k in ([m.id] if m.id else []) + [m.name]
    }
    phase_views: list[PhaseView] = []
    for d in phases_declared:
        phase_views.append(
            _phase_view(
                d,
                links.get(d.index, []),
                unit_state,
                delivery,
                delivery_failure,
                reads.scan_truncated,
                reads.scan_failure,
                by_key,
                doc_failure,
                doc_src,
                now,
            )
        )
    phases = _known(phase_views, prog_src, now)

    # -- gates section ------------------------------------------------------
    classified = classify_gates(gates_rows)
    if gates_failure is not None:
        gates_section = GatesSection(
            items=_unknown(gates_failure, _s(GATES_SRC), now),
            other_checks_not_shown=OtherChecks(total=0, truncated=True),
            read=gates_extent,
        )
    else:
        views = [
            GateView(
                id=str(g.get("gate_id") or g.get("id")),
                title=str(g.get("phase_name") or ""),
                verdict=GATE_VERDICTS[str(g.get("verdict"))],
                decided_at=_instant(g.get("cleared_at")),
                unit_slug=g.get("work_unit_slug"),
            )
            for g in classified.shown
        ]
        gates_section = GatesSection(
            items=_known(views, _s(GATES_SRC), now),
            other_checks_not_shown=OtherChecks(
                total=classified.other, truncated=gates_extent.truncated
            ),
            withdrawn_not_shown=classified.withdrawn,
            read=gates_extent,
        )

    return ScheduleEnvelope(
        tenant_id=reads.tenant_id,
        door=reads.door,
        observed_at=now,
        programme=programme,
        initiative=initiative,
        phases=phases,
        unreadable_phases=unreadable_phases,
        milestones=milestones,
        gates=gates_section,
        forecast=_unknown(
            "no_calendar", _src("derived", "Computed from the schedule"), now
        ),
        work_units=extent,
        sources=_sources(now, doc_src if doc_failure is None else None, prog_src),
    )


def _phase_view(
    d: DeclaredPhase,
    linked_slugs: list[str],
    unit_state: dict[str, UnitFacts | UnknownReason | None],
    delivery: DeliveryFacts | None,
    delivery_failure: UnknownReason | None,
    scan_truncated: bool,
    scan_failure: UnknownReason | None,
    milestone_dates: dict[str, str],
    doc_failure: UnknownReason | None,
    doc_src: ResolvedSource,
    now: dt.datetime,
) -> PhaseView:
    facts: list[UnitFacts] = []
    failure: UnknownReason | None = None
    for slug in linked_slugs:
        got = unit_state.get(slug)
        if isinstance(got, UnitFacts):
            facts.append(got)
        elif isinstance(got, str):
            failure = got  # type: ignore[assignment]
        # None: coord says the unit is not there; the link is dropped.
    linked = bool(facts)
    units_src, delivery_src = _s(UNITS_SRC), _s(DELIVERY_SRC)
    src = units_src if linked else delivery_src
    outcome = phase_state(d.index, facts or None, delivery)

    state: Resolved[Any]
    if failure is not None:
        state = _unknown(failure, units_src, now)
    elif not linked and delivery is None and delivery_failure is not None:
        state = _unknown(delivery_failure, delivery_src, now)
    elif (
        not linked
        and outcome.state == "not_confirmed"
        and (scan_truncated or scan_failure)
    ):
        # Links may exist beyond what the bounded scan could see.
        state = _unknown(scan_failure or "truncated", units_src, now)
    else:
        state = _known(outcome.state, src, now)

    def when(value: dt.datetime | None, reason: str | None) -> Resolved[Any]:
        if value is not None:
            return _known(_date_of(value), units_src, now)
        return _unknown(cast(UnknownReason, reason or "not_recorded"), src, now)

    if state.state == "unknown":
        start = _unknown(cast(UnknownReason, state.unknown_reason), src, now)
        end = _unknown(cast(UnknownReason, state.unknown_reason), src, now)
    else:
        start = when(outcome.actual_start, outcome.start_reason)
        end = when(outcome.actual_end, outcome.end_reason)

    planned: Resolved[Any]
    if doc_failure is not None:
        planned = _unknown(doc_failure, doc_src, now)
    else:
        target = None
        if d.milestone:
            target = milestone_dates.get(_norm(d.milestone))
        planned = (
            _known(dt.date.fromisoformat(target), doc_src, now)
            if target
            else _unknown("not_declared", doc_src, now)
        )
    return PhaseView(
        index=d.index,
        code=d.code,
        name=d.name,
        linked=linked,
        state=state,
        actual_start=start,
        actual_end=end,
        planned_end=planned,
        milestone_id=d.milestone,
    )


# ---------------------------------------------------------------------------
# Layer 2 — cache, single-flight, last-good (D8)
# ---------------------------------------------------------------------------

Loader = Callable[[], Awaitable[tuple[ScheduleEnvelope, bool]]]


@dataclass
class _Entry:
    attempt_at: dt.datetime
    attempt: ScheduleEnvelope
    degraded: bool
    good: ScheduleEnvelope | None
    good_at: dt.datetime | None
    #: This attempt was a denial for the caller: served as is, never cached.
    denied: bool = False


def _is_denied(envelope: ScheduleEnvelope) -> bool:
    """Any figure coord refused THIS caller (``coord_denied``)."""
    found = False

    def walk(node: object) -> None:
        nonlocal found
        if isinstance(node, Resolved):
            if node.unknown_reason == "coord_denied":
                found = True
            walk(node.value)
        elif isinstance(node, BaseModel):
            for name in type(node).model_fields:
                walk(getattr(node, name))
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(envelope)
    return found


def mark_stale(envelope: ScheduleEnvelope) -> ScheduleEnvelope:
    """A deep copy with ``stale`` set on the envelope and on every KNOWN figure.
    ``observed_at`` is left at the old read's: never renewed."""
    copy = envelope.model_copy(deep=True)
    copy.stale = True

    def walk(node: object) -> None:
        if isinstance(node, Resolved):
            if node.state == "known":
                node.stale = True
            walk(node.value)
        elif isinstance(node, BaseModel):
            for name in type(node).model_fields:
                walk(getattr(node, name))
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(copy)
    return copy


class ScheduleService:
    """Per-instance cache of the coord-derived envelope, keyed ``(tenant, door)``.

    * A read within ``ttl`` of the last ATTEMPT reuses it (success or failure),
      so a coord outage is probed once per TTL, not once per page view.
    * Concurrent refreshes of one key share ONE fan-out (single-flight).
    * After a degraded refresh the last good envelope is served, marked stale
      with its original ``observed_at``, for up to ``stale_limit`` from when it
      was read; past that the degraded (unknown) envelope is served.

    The read budget is per backend instance per tenant, not fleet-wide."""

    def __init__(
        self,
        *,
        clock: Clock = utcnow,
        ttl_seconds: int = TTL_SECONDS,
        stale_limit_seconds: int = STALE_LIMIT_SECONDS,
    ) -> None:
        self._clock = clock
        self._ttl = dt.timedelta(seconds=ttl_seconds)
        self._stale_limit = dt.timedelta(seconds=stale_limit_seconds)
        self._entries: dict[tuple[UUID, str], _Entry] = {}
        self._flights: dict[tuple[UUID, str], asyncio.Future[_Entry]] = {}

    def reset(self) -> None:
        self._entries.clear()
        self._flights.clear()

    def now(self) -> dt.datetime:
        return self._clock()

    async def get(self, key: tuple[UUID, str], loader: Loader) -> ScheduleEnvelope:
        entry = self._entries.get(key)
        now = self._clock()
        if entry is None or now - entry.attempt_at >= self._ttl:
            entry = await self._refresh(key, loader, entry)
            now = self._clock()
        return self._respond(entry, now)

    def _respond(self, entry: _Entry, now: dt.datetime) -> ScheduleEnvelope:
        if entry.denied or not entry.degraded:
            return entry.attempt
        if (
            entry.good is not None
            and entry.good_at is not None
            and now - entry.good_at <= self._stale_limit
        ):
            return mark_stale(entry.good)
        return entry.attempt

    async def _refresh(
        self, key: tuple[UUID, str], loader: Loader, prior: _Entry | None
    ) -> _Entry:
        flight = self._flights.get(key)
        if flight is None:
            flight = asyncio.ensure_future(self._load(key, loader, prior))
            self._flights[key] = flight

            def _done(_f: asyncio.Future[_Entry]) -> None:
                self._flights.pop(key, None)

            flight.add_done_callback(_done)
        # shield: one cancelled request must not cancel the fan-out the others share.
        return await asyncio.shield(flight)

    async def _load(
        self, key: tuple[UUID, str], loader: Loader, prior: _Entry | None
    ) -> _Entry:
        started = self._clock()
        envelope, degraded = await loader()
        if _is_denied(envelope):
            # A denial is about THIS caller, not about coord's availability: it is
            # neither stored nor served from, and the existing good entry (other
            # callers' view of the tenant) is left exactly as it was.
            return _Entry(
                attempt_at=started,
                attempt=envelope,
                degraded=False,
                good=None,
                good_at=None,
                denied=True,
            )
        good, good_at = (
            (prior.good, prior.good_at) if prior is not None else (None, None)
        )
        if envelope.programme.unknown_reason == "tenant_mismatch":
            # A tenant mismatch is a refusal, never papered over: forget the last
            # good copy so no stale envelope can be served across it.
            good, good_at = None, None
        elif not degraded:
            good, good_at = envelope, started
        entry = _Entry(
            attempt_at=started,
            attempt=envelope,
            degraded=degraded,
            good=good,
            good_at=good_at,
        )
        self._entries[key] = entry
        return entry


# ---------------------------------------------------------------------------
# Layer 3 — the hand-entered overlay and the forecast (D5)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TypedPhase:
    id: str
    code: str
    name: str
    sort_order: int
    planned_start: dt.date | None
    planned_end: dt.date | None
    actual_start: dt.date | None
    actual_end: dt.date | None
    gate_status: str
    gate_criteria: str | None
    updated_by: str | None
    updated_at: dt.datetime | None


@dataclass(frozen=True)
class TypedMilestone:
    id: str
    title: str
    target_date: dt.date
    status: str
    completed_date: dt.date | None
    updated_by: str | None
    updated_at: dt.datetime | None


@dataclass(frozen=True)
class TypedInputs:
    """The project's hand-entered rows (``phase_progress`` / ``milestones``)."""

    phases: list[TypedPhase] = field(default_factory=list)
    breaks: list[Any] = field(default_factory=list)
    working_day_factor: Decimal = Decimal("1")
    milestones: list[TypedMilestone] = field(default_factory=list)


@dataclass(frozen=True)
class _ForecastPhase:
    """The attributes :func:`compute_forecast` reads off a ``Phase`` row."""

    id: str
    code: str
    name: str
    sort_order: int
    planned_start: dt.date | None
    planned_end: dt.date | None
    actual_start: dt.date | None
    actual_end: dt.date | None
    gate_status: str
    gate_criteria: str | None


def _entered(by: str | None, at: dt.datetime | None) -> Entered:
    return Entered(by=by, at=at)


def _entered_label(by: str | None, at: dt.datetime | None) -> str:
    who = f"Entered by {by}" if by else "Entered by a team member"
    return (
        f"{who}{f' on {at.date().isoformat()}' if at else ''}, not confirmed by coord"
    )


def overlay_value(
    res: Resolved[Any],
    entered: Any,
    by: str | None,
    at: dt.datetime | None,
) -> Resolved[Any]:
    """D5 for one figure. Coord known: coord's value stays and a differing
    entered value rides beside it as ``disagrees``. Coord unknown: the entered
    value stands in, labelled ``entered``, keeping why coord could not answer.
    No entered value: unchanged."""
    if entered is None:
        return res
    if res.state == "known":
        if res.value == entered:
            return res
        return res.model_copy(
            update={
                "disagrees": Disagrees(coord_value=res.value, entered_value=entered),
                "entered": _entered(by, at),
            }
        )
    return res.model_copy(
        update={
            "value": entered,
            "state": "entered",
            "source": _src("entered", _entered_label(by, at)),
            "entered": _entered(by, at),
            "stale": False,
        }
    )


def _implied_state(t: TypedPhase) -> str | None:
    if t.actual_end is not None:
        return "done"
    if t.actual_start is not None:
        return "in_progress"
    return None


def _overlay_phase(p: PhaseView, t: TypedPhase) -> PhaseView:
    start = overlay_value(p.actual_start, t.actual_start, t.updated_by, t.updated_at)
    end = overlay_value(p.actual_end, t.actual_end, t.updated_by, t.updated_at)
    implied = _implied_state(t)
    state = p.state
    if implied is not None:
        # "Not confirmed" is coord declining to say, so an entered state fills it.
        coord_silent = state.state == "unknown" or state.value == "not_confirmed"
        if coord_silent:
            state = state.model_copy(
                update={
                    "value": implied,
                    "state": "entered",
                    "source": _src(
                        "entered", _entered_label(t.updated_by, t.updated_at)
                    ),
                    "entered": _entered(t.updated_by, t.updated_at),
                }
            )
        elif state.value != implied:
            state = state.model_copy(
                update={
                    "disagrees": Disagrees(
                        coord_value=state.value, entered_value=implied
                    ),
                    "entered": _entered(t.updated_by, t.updated_at),
                }
            )
    return p.model_copy(
        update={"actual_start": start, "actual_end": end, "state": state}
    )


def _typed_milestone_view(m: TypedMilestone, now: dt.datetime) -> MilestoneView:
    src = _src("entered", _entered_label(m.updated_by, m.updated_at))
    ent = _entered(m.updated_by, m.updated_at)
    done = m.status == "done" and m.completed_date is not None
    return MilestoneView(
        id=None,
        name=m.title,
        target_date=Resolved(
            value=m.target_date,
            state="entered",
            source=src,
            observed_at=now,
            entered=ent,
        ),
        status=Resolved(
            value="met" if done else "not_met",
            state="entered",
            source=src,
            observed_at=now,
            entered=ent,
        ),
        met_at=(
            Resolved(
                value=m.completed_date,
                state="entered",
                source=src,
                observed_at=now,
                entered=ent,
            )
            if done
            else _unknown("not_recorded", src, now)
        ),
        sources=["entered"],
    )


def _overlay_milestones(
    section: MilestonesSection, typed: list[TypedMilestone], now: dt.datetime
) -> MilestonesSection:
    coord_items = section.items.value
    if coord_items is None:
        # Coord could not answer: every entered milestone stands in (D5.2).
        return section.model_copy(
            update={"entered_only": [_typed_milestone_view(m, now) for m in typed]}
        )
    by_name = {_norm(m.title): m for m in typed}
    matched: set[str] = set()
    out: list[MilestoneView] = []
    for item in coord_items:
        t = by_name.get(_norm(item.name))
        if t is None:
            out.append(item)
            continue
        matched.add(_norm(t.title))
        target = overlay_value(
            item.target_date, t.target_date, t.updated_by, t.updated_at
        )
        status, met_at = item.status, item.met_at
        if (
            t.status == "done"
            and t.completed_date is not None
            and (status.value == "not_confirmed" or status.state == "unknown")
        ):
            ent = _entered(t.updated_by, t.updated_at)
            src = _src("entered", _entered_label(t.updated_by, t.updated_at))
            status = status.model_copy(
                update={
                    "value": "met",
                    "state": "entered",
                    "source": src,
                    "entered": ent,
                }
            )
            met_at = met_at.model_copy(
                update={
                    "value": t.completed_date,
                    "state": "entered",
                    "source": src,
                    "entered": ent,
                }
            )
        out.append(
            item.model_copy(
                update={
                    "target_date": target,
                    "status": status,
                    "met_at": met_at,
                    "sources": ["coord", "entered"],
                }
            )
        )
    leftovers = [
        _typed_milestone_view(m, now) for m in typed if _norm(m.title) not in matched
    ]
    return section.model_copy(
        update={
            "items": section.items.model_copy(update={"value": out}),
            "entered_only": leftovers,
        }
    )


def _count_disagreements(env: ScheduleEnvelope) -> int:
    total = 0

    def walk(node: object) -> None:
        nonlocal total
        if isinstance(node, Resolved):
            if node.disagrees is not None:
                total += 1
            walk(node.value)
        elif isinstance(node, BaseModel):
            for name in type(node).model_fields:
                walk(getattr(node, name))
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(env.phases)
    walk(env.milestones)
    return total


def _forecast_source() -> ResolvedSource:
    return _src("derived", "Computed from the schedule")


def compute_schedule_forecast(
    env: ScheduleEnvelope, typed: TypedInputs, today: dt.date, now: dt.datetime
) -> tuple[Resolved[Any], ForecastBasis | None]:
    """The forecast for an overlaid envelope, through the unchanged
    :func:`compute_forecast`.

    With an estimate its phases are the plan; each takes coord's actual dates when
    coord knows them, else the entered ones (D5), and the basis says which. With
    no estimate the plan is coord's own phases, which carry only a planned END, so
    there is nothing for the function to run on: the figure is unknown, saying
    why (``no_phases``, ``phase_dates_missing``, then ``no_calendar``, never a
    guessed calendar)."""
    src = _forecast_source()
    coord_phases = env.phases.value
    if not typed.phases:
        if coord_phases is None:
            reason = cast(
                UnknownReason, env.phases.unknown_reason or "coord_unreachable"
            )
            return _unknown(reason, src, now), None
        if not coord_phases:
            return _unknown("no_phases", src, now), None
        if any(p.planned_end.state == "unknown" for p in coord_phases):
            return _unknown("phase_dates_missing", src, now), None
        return _unknown("no_calendar", src, now), None

    by_code = {p.code: p for p in coord_phases or []}
    used: set[str] = set()
    rows: list[_ForecastPhase] = []
    for t in sorted(typed.phases, key=lambda x: (x.sort_order, x.code)):
        counterpart = by_code.get(t.code)
        values: dict[str, dt.date | None] = {}
        for attr in ("actual_start", "actual_end"):
            res = getattr(counterpart, attr) if counterpart is not None else None
            if res is not None and res.state in ("known", "entered") and res.value:
                values[attr] = res.value
                used.add("coord" if res.state == "known" else "entered")
            else:
                typed_value = getattr(t, attr)
                values[attr] = typed_value
                if typed_value is not None:
                    used.add("entered")
        rows.append(
            _ForecastPhase(
                id=t.id,
                code=t.code,
                name=t.name,
                sort_order=t.sort_order,
                planned_start=t.planned_start,
                planned_end=t.planned_end,
                actual_start=values["actual_start"],
                actual_end=values["actual_end"],
                gate_status=t.gate_status,
                gate_criteria=t.gate_criteria,
            )
        )
    basis: ForecastBasis = (
        "mixed"
        if used == {"coord", "entered"}
        else "coord"
        if used == {"coord"}
        else "entered"
    )
    figures = compute_forecast(
        # compute_forecast reads attributes only; _ForecastPhase carries exactly those.
        cast(list[Phase], rows),
        typed.breaks,
        working_day_factor=typed.working_day_factor,
        today=today,
    )
    if figures["forecast_finish"] is None:
        reason = (
            figures["unavailable"][0]["reason"]
            if figures["unavailable"]
            else "no_phases"
        )
        return _unknown(cast(UnknownReason, reason), src, now), basis

    def ref(raw: dict[str, Any] | None) -> SchedulePhaseRef | None:
        return SchedulePhaseRef(code=raw["code"], name=raw["name"]) if raw else None

    value = ForecastValue(
        planned_finish=figures["planned_finish"],
        forecast_finish=figures["forecast_finish"],
        slip_days=figures["slip_days"],
        position=figures["position"],
        current_phase=ref(figures["current_phase"]),
        next_phase=ref(figures["next_phase"]),
    )
    return _known(value, src, now), basis


def apply_entered(
    envelope: ScheduleEnvelope, typed: TypedInputs, *, today: dt.date, now: dt.datetime
) -> ScheduleEnvelope:
    """Lay the project's hand-entered rows over the coord envelope (D5). Pure:
    the cached ``envelope`` is copied, never mutated."""
    env = envelope.model_copy(deep=True)
    phases = env.phases.value
    if phases is not None and typed.phases:
        by_code = {t.code: t for t in typed.phases}
        env.phases = env.phases.model_copy(
            update={
                "value": [
                    _overlay_phase(p, by_code[p.code]) if p.code in by_code else p
                    for p in phases
                ]
            }
        )
    env.milestones = _overlay_milestones(env.milestones, typed.milestones, now)
    forecast, basis = compute_schedule_forecast(env, typed, today, now)
    if env.stale and forecast.state == "known" and basis != "entered":
        # Computed (at least partly) from a stale read: served, not current. A
        # forecast built only from hand-entered phases does not depend on coord's
        # envelope, so staleness of that envelope is not its own.
        forecast = forecast.model_copy(update={"stale": True})
    env.forecast = forecast
    env.basis = basis
    env.disagreement_count = _count_disagreements(env)
    return env


# ---------------------------------------------------------------------------
# Last-known stamps (D4/D8): best-effort, written only by this read path
# ---------------------------------------------------------------------------

#: The figures stamped, one row per ``(tenant, figure)``.
FIGURES = ("programme", "phases", "milestones", "gates", "forecast")


def _figure_resolved(env: ScheduleEnvelope) -> dict[str, Resolved[Any]]:
    return {
        "programme": env.programme,
        "phases": env.phases,
        "milestones": env.milestones.items,
        "gates": env.gates.items,
        "forecast": env.forecast,
    }


async def load_stamps(db: AsyncSession, tenant_id: UUID) -> dict[str, dt.datetime]:
    """The tenant's last-known stamps, or ``{}`` when they cannot be read (the
    read then falls back to its own first-failure time)."""
    try:
        rows = (
            await db.execute(
                select(OverviewScheduleLastKnown).where(
                    OverviewScheduleLastKnown.tenant_id == tenant_id
                )
            )
        ).scalars()
        return {r.figure: r.last_known_at for r in rows}
    except Exception:  # noqa: BLE001 - a stamp is garnish; its failure never fails a read
        logger.warning("overview_schedule_stamp_read_failed", exc_info=True)
        await _rollback(db)
        return {}


async def _rollback(db: AsyncSession) -> None:
    try:
        await db.rollback()
    except Exception:  # noqa: BLE001
        logger.warning("overview_schedule_stamp_rollback_failed", exc_info=True)


def fill_unknown_since(
    env: ScheduleEnvelope,
    tenant_id: UUID,
    stamps: dict[str, dt.datetime],
    now: dt.datetime,
) -> list[str]:
    """Set ``unknown_since`` on each unknown figure to the last time that figure
    WAS known (the stored stamp), and return the figures coord answered for.

    With no stamp ``unknown_since`` stays null: there is no durable record of when
    it was last known, and a process-local guess would read as a fact after a
    restart. Only coord's own, current answer counts as known: a stale or
    hand-entered figure is not coord having answered, and a forecast counts only
    when every progress input was coord's (``basis == "coord"``)."""
    known: list[str] = []
    for figure, res in _figure_resolved(env).items():
        if res.state == "unknown":
            res.unknown_since = stamps.get(figure)
        elif res.state == "known" and not res.stale:
            if figure == "forecast" and env.basis != "coord":
                continue
            known.append(figure)
    return known


async def stamp_figures(
    db: AsyncSession,
    tenant_id: UUID,
    figures: list[str],
    now: dt.datetime,
    stamps: dict[str, dt.datetime],
) -> None:
    """Upsert ``last_known_at = now`` for each figure whose stored stamp is older
    than ``now`` (the coord read's own ``observed_at``, never the request time).
    A cache hit carries the same ``observed_at`` as the stored stamp and so writes
    nothing. Best-effort and non-blocking: any failure is logged and rolled back,
    never raised."""
    figures = [f for f in figures if stamps.get(f) is None or stamps[f] < now]
    if not figures:
        return
    try:
        for figure in figures:
            stmt = pg_insert(OverviewScheduleLastKnown).values(
                tenant_id=tenant_id, figure=figure, last_known_at=now
            )
            await db.execute(
                stmt.on_conflict_do_update(
                    index_elements=["tenant_id", "figure"],
                    set_={"last_known_at": now},
                    # A stamp never moves backwards (a stale view must not undo
                    # a newer one written by a concurrent read).
                    where=OverviewScheduleLastKnown.last_known_at < now,
                )
            )
        await db.commit()
    except Exception:  # noqa: BLE001 - see load_stamps
        logger.warning("overview_schedule_stamp_write_failed", exc_info=True)
        await _rollback(db)


# ---------------------------------------------------------------------------
# The whole read
# ---------------------------------------------------------------------------


async def resolve_schedule(
    service: ScheduleService,
    source: CoordScheduleSource,
    tenant_id: UUID,
    typed: TypedInputs,
    db: AsyncSession,
) -> ScheduleEnvelope:
    """One schedule read: the cached coord envelope, the hand-entered overlay,
    the forecast, and the last-known stamps (D1-D8)."""
    key = (tenant_id, source.door)

    async def loader() -> tuple[ScheduleEnvelope, bool]:
        return await build_coord_schedule(source, tenant_id, service.now())

    base = await service.get(key, loader)
    now = service.now()
    env = apply_entered(base, typed, today=now.date(), now=now)
    stamps = await load_stamps(db, tenant_id)
    known = fill_unknown_since(env, tenant_id, stamps, now)
    await stamp_figures(db, tenant_id, known, base.observed_at, stamps)
    return env
