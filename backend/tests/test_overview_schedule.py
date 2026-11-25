"""``GET /overview/schedule`` — phases, milestones and gates derived from coord.

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` Phase 2.
Every fixture is synthetic, shaped like the live coord reads the Phase 1 probe
recorded (14 declared phases, one delivered, a five-row milestone table, plumbing
gates only); no tenant's data is copied here. Each test can fail: it asserts a
specific value a wrong rule would not produce.

The fake coord is ONE callable standing in for ``_proxy_coord_get``: it serves
the operator routes and the ``/coord/agent-*`` routes from the same fixture, so
the two doors are exercised through their real source classes and parity is a
property of the fixture, not of two hand-kept fakes.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import importlib.util
import re
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import OverviewScheduleLastKnown
from app.overview import coord_schedule as cs
from app.overview.coord_schedule import (
    DEVICE_READ_DOORS,
    DeliveryFacts,
    DeviceSource,
    OperatorSource,
    UnitFacts,
    assert_rows_in_tenant,
    classify_gates,
    parse_initiative,
    parse_milestone_table,
    parse_milestones,
    phase_state,
)
from app.services import overview_schedule as svc
from app.services.overview_schedule import (
    ScheduleService,
    TypedInputs,
    TypedMilestone,
    TypedPhase,
    apply_entered,
    build_coord_schedule,
    mark_stale,
)

API = "/api/v1/overview"
TENANT = UUID("aaaaaaaa-0000-4000-8000-0000000000a9")
OTHER_TENANT = UUID("bbbbbbbb-0000-4000-8000-0000000000b9")
NOW = dt.datetime(2026, 11, 25, 12, 0, tzinfo=dt.UTC)


# ===========================================================================
# Fixture: a synthetic coord
# ===========================================================================

INITIATIVE_BODY = """---
status: live
starts: 2026-10-19
ends: 2027-01-22
---
# Initiative

## Milestones in this cycle

| Target date | Milestone | Shown by |
|---|---|---|
| 2026-11-16 | **V0** first slice | a demo |
| 2026-12-01 | V1 account module | a demo |
| 2026-12-01 | Customer showing | a meeting |
| 2026-12-18 | V2 checkout | a demo |
| 2027-01-22 | V3 launch | go-live |
"""


def _unit(slug: str, status: str = "ready", tenant: UUID | None = TENANT, **extra: Any):
    row: dict[str, Any] = {
        "slug": slug,
        "tenant_id": str(tenant) if tenant else None,
        "status": status,
        "status_class": "derived",
        "title": slug,
        "metadata": {},
        "first_in_progress_at": None,
        "first_shipped_at": None,
        "last_shipped_retracted_at": None,
    }
    row.update(extra)
    return row


def _gate(
    n: int,
    slug: str,
    kind: str,
    verdict: str = "cleared",
    gate_class: str = "routine-review",
    tenant: UUID = TENANT,
    **predicate: Any,
):
    return {
        "gate_id": f"00000000-0000-4000-8000-{n:012d}",
        "tenant_id": str(tenant),
        "work_unit_slug": slug,
        "phase_name": f"anchor {n}",
        "verdict": verdict,
        "gate_class": gate_class,
        "cleared_at": "2026-11-20T10:00:00Z" if verdict == "cleared" else None,
        "predicate": {"kind": kind, **predicate},
    }


def make_coord_data(
    *,
    linked: bool = False,
    tenant: UUID = TENANT,
    phases: int = 14,
    initiative: str = INITIATIVE_BODY,
) -> dict[str, Any]:
    """A bauhaus-SHAPED programme: ``phases`` declared phases, one delivered,
    plumbing gates only. With ``linked`` phase 1 and 2 link to child units."""
    meta: dict[str, Any] = {
        "intent_initiative": "initiative/current-initiative",
        "phases": [
            {"index": i, "name": f"P{i} Phase {i}"} for i in range(1, phases + 1)
        ],
    }
    if linked:
        meta["phase_units"] = {"1": ["child-a"], "2": ["child-b"]}
        meta["phases"][0]["milestone"] = "V1"
    units = [
        _unit("prog-plan", "ready", tenant, metadata=meta),
        _unit(
            "child-a",
            "shipped",
            tenant,
            first_in_progress_at="2026-10-20T08:00:00Z",
            first_shipped_at="2026-11-10T09:00:00Z",
            metadata={"parent": "prog-plan"},
        ),
        _unit(
            "child-b",
            "in_progress",
            tenant,
            first_in_progress_at="2026-11-12T08:00:00Z",
            metadata={"parent": "prog-plan"},
        ),
    ] + [_unit(f"other-{i}", "ready", tenant) for i in range(5)]
    delivery = {
        "work_unit_id": str(uuid4()),
        "count": 0,
        "citations": [],
        "delivery": {
            "phases_declared_indices": list(range(1, phases + 1)),
            "phases_delivered": [1],
            "phases_attested": [],
            "phases_remaining": list(range(2, phases + 1)),
            "phases_complete_scope": False,
            "evidence_complete": False,
        },
    }
    gates = {
        "prog-plan": [
            _gate(1, "prog-plan", "pr_merged", tenant=tenant),
            _gate(2, "prog-plan", "content_matches", tenant=tenant),
            _gate(3, "prog-plan", "time_elapsed", verdict="open", tenant=tenant),
        ],
        "child-a": [_gate(4, "child-a", "pr_ci_green", tenant=tenant)],
        "child-b": [],
    }
    return {
        "units": units,
        "delivery": {"prog-plan": delivery},
        "gates": gates,
        "documents": {
            ("initiative", "current-initiative"): {
                "kind": "initiative",
                "name": "current-initiative",
                "current_version": 4,
                "body": initiative,
            }
        },
    }


class FakeCoord:
    """Stands in for ``_proxy_coord_get`` and records every call."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.calls: list[tuple[str, dict[str, Any] | None, dict[str, Any]]] = []
        self.fail: Exception | None = None
        self.delay = 0.0

    async def __call__(
        self, path: str, *, params: dict[str, Any] | None = None, **kwargs: Any
    ) -> Any:
        self.calls.append((path, params, kwargs))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail is not None:
            raise self.fail
        return self._answer(path, params or {})

    def paths(self) -> list[str]:
        return [c[0] for c in self.calls]

    def _answer(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        route = re.sub(r"^/coord/(agent-)?", "/", path)
        if route == "/work-units":
            lo = params["offset"]
            return {"work_units": self.data["units"][lo : lo + params["limit"]]}
        if route == "/gates":
            rows = self.data["gates"].get(params["work_unit_slug"])
            if rows is None:
                raise HTTPException(404, "work_unit_slug_not_found")
            lo, n = params["offset"], params["limit"]
            return {"gates": rows[lo : lo + n], "total": len(rows)}
        if route.startswith("/work-units/"):
            rest = route[len("/work-units/") :]
            slug, _, tail = rest.partition("/")
            if tail == "citations":
                if slug not in self.data["delivery"]:
                    raise HTTPException(404, "no such unit")
                return self.data["delivery"][slug]
            for row in self.data["units"]:
                if row["slug"] == slug:
                    return {"work_unit": row}
            raise HTTPException(404, "no such unit")
        if route.startswith("/prompt-documents/"):
            _, kind, name = route.split("/")[1:4]
            doc = self.data["documents"].get((kind, name))
            if doc is None:
                raise HTTPException(404, "no such document")
            return {"document": doc}
        raise AssertionError(f"unexpected coord path {path}")


@pytest.fixture()
def coord(monkeypatch: pytest.MonkeyPatch) -> FakeCoord:
    fake = FakeCoord(make_coord_data())
    monkeypatch.setattr(cs, "_proxy_coord_get", fake)
    return fake


def _operator() -> OperatorSource:
    return OperatorSource(TENANT)


def _device() -> DeviceSource:
    return DeviceSource("device-bearer-123")


class Clock:
    def __init__(self, at: dt.datetime = NOW) -> None:
        self.at = at

    def __call__(self) -> dt.datetime:
        return self.at

    def advance(self, **kwargs: float) -> None:
        self.at += dt.timedelta(**kwargs)


@pytest.fixture(autouse=True)
def _reset_state():
    svc.metrics.reset()
    svc._first_failed.clear()
    yield
    svc._first_failed.clear()


async def build(source: Any = None, now: dt.datetime = NOW):
    return await build_coord_schedule(source or _operator(), TENANT, now)


# ===========================================================================
# Parsers
# ===========================================================================


class TestParsers:
    def test_table_rows_parse_with_ids_and_unparsed_rows_are_listed(self):
        body = (
            "| Target date | Milestone | Shown by |\n|---|---|---|\n"
            "| 2026-11-16 | **V0** first slice | a demo |\n"
            "| soon | V9 undated | nobody |\n"
            "| 2026-13-45 | V8 impossible date | nobody |\n"
        )
        rows, unparsed, found = parse_milestone_table(body)
        assert found is True
        assert [(r.id, r.target_date, r.name) for r in rows] == [
            ("V0", "2026-11-16", "V0 first slice")
        ]
        assert unparsed == [
            "| soon | V9 undated | nobody |",
            "| 2026-13-45 | V8 impossible date | nobody |",
        ]

    def test_no_table_is_not_an_empty_table(self):
        rows, unparsed, found = parse_milestone_table("# no table here\n")
        assert (rows, unparsed, found) == ([], [], False)

    def test_frontmatter_list_wins_over_the_table(self):
        text = (
            "---\nstarts: 2026-10-19\nmilestones:\n"
            "  - {id: M1, name: Pilot live, date: 2026-12-01, work_unit: child-a}\n"
            "  - id: M2\n    name: Launch\n    date: 2027-01-22\n"
            "    gate: 00000000-0000-4000-8000-000000000009\n"
            "    decision_record: decision_record/pilot-decision\n"
            "  - {id: M3, name: No date at all}\n"
            "---\n| Target date | Milestone |\n|---|---|\n| 2026-01-01 | Old table row |\n"
        )
        facts = parse_initiative(text)
        rows, unparsed = parse_milestones(facts)
        assert [(r.id, r.name, r.target_date, r.work_unit, r.gate) for r in rows] == [
            ("M1", "Pilot live", "2026-12-01", "child-a", None),
            (
                "M2",
                "Launch",
                "2027-01-22",
                None,
                "00000000-0000-4000-8000-000000000009",
            ),
        ]
        assert rows[1].decision_record == "decision_record/pilot-decision"
        # The unreadable list item is listed with its text, not dropped; the legacy
        # table is not consulted when the list is present.
        assert unparsed == ["id: M3, name: No date at all"]
        assert all(r.name != "Old table row" for r in rows)

    def test_a_document_with_no_frontmatter_says_so(self):
        facts = parse_initiative("# just prose\n")
        assert facts.frontmatter_found is False
        assert facts.scalars == {}

    def test_scalars_and_programme_key(self):
        facts = parse_initiative(
            "---\nstarts: 2026-10-19\nprogramme: prog-plan\n---\nx"
        )
        assert facts.scalars == {"starts": "2026-10-19", "programme": "prog-plan"}

    def test_the_table_parser_matches_the_phase_1_probe(self):
        """The app's parser is a port of the probe's; one fixture, same rows."""
        path = (
            Path(__file__).resolve().parents[1]
            / "scripts"
            / "probe_overview_schedule.py"
        )
        spec = importlib.util.spec_from_file_location("probe_for_parity", path)
        assert spec and spec.loader
        probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(probe)
        body = INITIATIVE_BODY + "\n| soon | V9 undated | nobody |\n"
        mine, mine_bad, mine_found = parse_milestone_table(body)
        theirs, theirs_bad, theirs_found = probe.parse_milestone_table(body)
        assert mine_found == theirs_found
        assert mine_bad == theirs_bad
        assert [
            {"date": r.target_date, "name": r.name, "id": r.id, "shown_by": r.shown_by}
            for r in mine
        ] == theirs
        assert len(mine) == 5

    def test_declared_phases_codes_and_unreadable_entries(self):
        unit = _unit(
            "p",
            metadata={
                "phases": [
                    {"index": 1, "name": "F1 Foundation"},
                    {"index": 2, "name": "Rollout planning"},
                    {"index": 3, "name": "CP11: checkout"},
                    {"name": "no index"},
                    "garbage",
                ]
            },
        )
        phases, bad = cs.declared_phases(unit)
        assert [(p.index, p.code) for p in phases] == [(1, "F1"), (2, "2"), (3, "CP11")]
        assert len(bad) == 2


# ===========================================================================
# Phase state — the D2 truth table
# ===========================================================================


def _facts(**kw: Any) -> UnitFacts:
    base: dict[str, Any] = {
        "slug": "u",
        "status": "ready",
        "status_class": "derived",
        "first_in_progress_at": None,
        "first_shipped_at": None,
        "last_shipped_retracted_at": None,
    }
    base.update(kw)
    return UnitFacts(**base)


D1 = dt.datetime(2026, 10, 20, tzinfo=dt.UTC)
D2 = dt.datetime(2026, 11, 10, tzinfo=dt.UTC)
D3 = dt.datetime(2026, 11, 20, tzinfo=dt.UTC)
SHIPPED = _facts(status="shipped", first_in_progress_at=D1, first_shipped_at=D2)
STARTED = _facts(status="in_progress", first_in_progress_at=D1)
NOTHING = _facts()
RETRACTED = _facts(
    status="shipped",
    first_in_progress_at=D1,
    first_shipped_at=D2,
    last_shipped_retracted_at=D3,
)
DELIVERED = DeliveryFacts(frozenset({1}), frozenset(), False, False)
NOT_DELIVERED = DeliveryFacts(frozenset(), frozenset(), False, False)


class TestPhaseState:
    @pytest.mark.parametrize(
        ("linked", "expected"),
        [
            ([SHIPPED], "done"),
            ([SHIPPED, SHIPPED], "done"),
            ([SHIPPED, STARTED], "in_progress"),
            ([SHIPPED, NOTHING], "in_progress"),
            ([STARTED], "in_progress"),
            ([NOTHING], "planned"),
            ([NOTHING, NOTHING], "planned"),
            ([RETRACTED], "done"),
        ],
    )
    def test_linked_units_decide_the_state(self, linked, expected):
        assert phase_state(1, linked, NOT_DELIVERED).state == expected

    def test_a_shipped_word_that_is_not_the_derived_class_is_not_a_ship(self):
        off = _facts(status="shipped", status_class="off_vocabulary")
        unclassified = _facts(status="shipped", status_class=None)
        assert phase_state(1, [off], None).state == "planned"
        assert phase_state(1, [unclassified], None).state == "planned"

    def test_dates_come_from_linked_units_only(self):
        out = phase_state(
            1,
            [
                SHIPPED,
                _facts(status="shipped", first_in_progress_at=D2, first_shipped_at=D3),
            ],
            None,
        )
        assert (out.actual_start, out.actual_end) == (D1, D3)

    def test_a_done_phase_whose_unit_has_no_ship_date_has_no_end(self):
        out = phase_state(1, [_facts(status="shipped")], None)
        assert out.state == "done"
        assert out.actual_end is None and out.end_reason == "not_recorded"
        assert out.actual_start is None and out.start_reason == "not_recorded"

    def test_a_retraction_makes_the_end_unknown(self):
        out = phase_state(1, [RETRACTED], None)
        assert out.actual_end is None and out.end_reason == "ship_retracted"

    def test_an_unlinked_remaining_phase_is_not_confirmed_never_planned(self):
        # evidence_complete is False: `phases_remaining` is a floor, so "not done"
        # is not knowable from it.
        out = phase_state(2, None, NOT_DELIVERED)
        assert out.state == "not_confirmed"
        assert phase_state(2, [], NOT_DELIVERED).state == "not_confirmed"

    def test_an_unlinked_delivered_phase_is_done_with_no_date(self):
        out = phase_state(1, None, DELIVERED)
        assert out.state == "done"
        assert (out.actual_start, out.actual_end) == (None, None)
        assert out.end_reason == "not_recorded"

    def test_attested_or_complete_scope_is_done(self):
        assert (
            phase_state(
                3, None, DeliveryFacts(frozenset(), frozenset({3}), False, False)
            ).state
            == "done"
        )
        assert (
            phase_state(
                3, None, DeliveryFacts(frozenset(), frozenset(), True, True)
            ).state
            == "done"
        )


# ===========================================================================
# D3 — the gate filter
# ===========================================================================

#: The predicate kinds the Phase 1 census saw on the bauhaus-shaped programme.
PHASE_1_CENSUS_KINDS = {
    "pr_merged": 46,
    "content_matches": 11,
    "pr_ci_green": 6,
    "gate_cleared": 4,
    "time_elapsed": 4,
    "pr_ci_red": 2,
    "commit_live": 1,
    "file_exists": 1,
    "pr_conflicting": 1,
}


class TestGateFilter:
    def _census_gates(self) -> list[dict[str, Any]]:
        gates = []
        n = 0
        for kind, count in PHASE_1_CENSUS_KINDS.items():
            for _ in range(count):
                n += 1
                gates.append(_gate(n, "u", kind, gate_id="not-a-decision-gate"))
        return gates

    def test_the_phase_1_census_shows_no_decision_gate(self):
        gates = self._census_gates()
        out = classify_gates(gates)
        assert out.shown == []
        assert out.other == sum(PHASE_1_CENSUS_KINDS.values()) == 76
        assert out.unseen_kinds == []

    def test_every_phase_1_kind_is_a_known_kind(self):
        assert set(PHASE_1_CENSUS_KINDS) <= cs.KNOWN_PREDICATE_KINDS
        # and the allowlist is exactly the one person-decision kind
        assert cs.OVERVIEW_GATE_PREDICATE_KINDS == {"operator_approval"}

    def test_an_operator_approval_is_shown_with_its_verdict_mapped(self):
        gates = [
            _gate(1, "u", "operator_approval", verdict="open"),
            _gate(2, "u", "operator_approval", verdict="cleared"),
            _gate(3, "u", "operator_approval", verdict="failed"),
        ]
        out = classify_gates(gates)
        assert [cs.GATE_VERDICTS[g["verdict"]] for g in out.shown] == [
            "pending",
            "passed",
            "failed",
        ]

    def test_withdrawn_is_counted_apart_and_misconfigured_is_not_guessed_at(self):
        out = classify_gates(
            [
                _gate(1, "u", "operator_approval", verdict="withdrawn"),
                _gate(2, "u", "operator_approval", verdict="misconfigured"),
            ]
        )
        assert out.shown == []
        assert out.withdrawn == 1
        assert out.other == 1

    @pytest.mark.parametrize("klass", ["ops-confirm", "security-surface"])
    def test_excluded_classes_never_show(self, klass):
        out = classify_gates([_gate(1, "u", "operator_approval", gate_class=klass)])
        assert out.shown == [] and out.other == 1

    def test_gate_cleared_counts_only_when_anchored_on_a_decision_gate(self):
        decision = _gate(1, "u", "operator_approval", verdict="cleared")
        anchored = _gate(2, "u", "gate_cleared", gate_id=decision["gate_id"])
        plumbing = _gate(
            3, "u", "gate_cleared", gate_id="00000000-0000-4000-8000-0000000000ff"
        )
        out = classify_gates([decision, anchored, plumbing])
        assert {g["gate_id"] for g in out.shown} == {
            decision["gate_id"],
            anchored["gate_id"],
        }
        assert out.other == 1

    def test_an_unseen_kind_is_reported_and_never_shown(self):
        out = classify_gates([_gate(1, "u", "brand_new_kind")])
        assert out.shown == [] and out.unseen_kinds == ["brand_new_kind"]

    def test_the_flat_mcp_spelling_is_read_too(self):
        flat = {
            "gate_id": "g",
            "predicate_kind": "operator_approval",
            "verdict": "open",
        }
        assert classify_gates([flat]).shown == [flat]


# ===========================================================================
# The envelope from a coord fixture (bauhaus-shaped, no typed rows)
# ===========================================================================


class TestEnvelope:
    @pytest.mark.asyncio
    async def test_the_bauhaus_shaped_schedule(self, coord):
        env, degraded = await build()
        assert degraded is False
        assert env.programme.value.slug == "prog-plan"
        phases = env.phases.value
        assert phases is not None and len(phases) == 14
        first = phases[0]
        assert (first.code, first.state.value, first.state.state) == (
            "P1",
            "done",
            "known",
        )
        assert first.actual_end.state == "unknown"
        assert first.actual_end.unknown_reason == "not_recorded"  # "date not recorded"
        assert {p.state.value for p in phases[1:]} == {"not_confirmed"}
        assert env.initiative.starts.value == dt.date(2026, 10, 19)
        assert env.initiative.ends.value == dt.date(2027, 1, 22)
        ms = env.milestones.items.value
        assert ms is not None
        assert [(m.id, m.target_date.value.isoformat()) for m in ms] == [
            ("V0", "2026-11-16"),
            ("V1", "2026-12-01"),
            (None, "2026-12-01"),
            ("V2", "2026-12-18"),
            ("V3", "2027-01-22"),
        ]
        # unlinked milestones: dated, and "not confirmed" (never met, never late)
        assert {m.status.value for m in ms} == {"not_confirmed"}
        assert env.gates.items.value == []
        assert env.gates.other_checks_not_shown.total == 3
        assert env.gates.items.state == "known"

    @pytest.mark.asyncio
    async def test_linked_units_give_dates_and_state(self, monkeypatch):
        fake = FakeCoord(make_coord_data(linked=True))
        monkeypatch.setattr(cs, "_proxy_coord_get", fake)
        env, _ = await build()
        p1, p2, p3 = env.phases.value[:3]
        assert p1.linked and p1.state.value == "done"
        assert p1.actual_start.value == dt.date(2026, 10, 20)
        assert p1.actual_end.value == dt.date(2026, 11, 10)
        assert p2.state.value == "in_progress"
        assert p2.actual_end.unknown_reason == "not_declared"
        assert p3.state.value == "not_confirmed" and not p3.linked
        # phase 1 names milestone V1, so its planned end is that row's date
        assert p1.planned_end.value == dt.date(2026, 12, 1)
        assert p2.planned_end.unknown_reason == "not_declared"

    @pytest.mark.asyncio
    async def test_a_milestone_linked_to_a_unit_is_met_when_it_shipped(
        self, monkeypatch
    ):
        data = make_coord_data(
            initiative=(
                "---\nstarts: 2026-10-19\nmilestones:\n"
                "  - {id: A, name: A first slice, date: 2026-11-16, work_unit: child-a}\n"
                "  - {id: B, name: B account, date: 2026-12-01, work_unit: child-b}\n"
                "  - {id: C, name: C ghost, date: 2026-12-02, work_unit: no-such-unit}\n"
                "---\nbody"
            )
        )
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        a, b, c = env.milestones.items.value
        assert (a.status.value, a.met_at.value) == ("met", dt.date(2026, 11, 10))
        assert (b.status.value, b.met_at.state) == ("not_met", "unknown")
        # a link to a unit coord does not hold is unknown, not "not met"
        assert c.status.state == "unknown" and c.status.unknown_reason == "not_recorded"

    @pytest.mark.asyncio
    async def test_a_milestone_linked_to_a_gate_is_met_when_cleared(self, monkeypatch):
        data = make_coord_data(
            initiative=(
                "---\nstarts: 2026-10-19\nmilestones:\n"
                "  - {id: G, name: G approval, date: 2026-11-16, "
                "gate: 00000000-0000-4000-8000-000000000001}\n"
                "  - {id: H, name: H approval, date: 2026-11-16, "
                "gate: 00000000-0000-4000-8000-000000000003}\n"
                "---\nbody"
            )
        )
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        g, h = env.milestones.items.value
        assert (g.status.value, g.met_at.value) == ("met", dt.date(2026, 11, 20))
        assert h.status.value == "not_met"  # gate 3 is open

    @pytest.mark.asyncio
    async def test_unreadable_rows_and_phases_are_listed_not_dropped(self, monkeypatch):
        data = make_coord_data(
            initiative=INITIATIVE_BODY + "| soon | V9 undated | nobody |\n"
        )
        data["units"][0]["metadata"]["phases"].append({"name": "no index"})
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        assert env.milestones.unreadable_rows == ["| soon | V9 undated | nobody |"]
        assert env.unreadable_phases == ["{'name': 'no index'}"]

    @pytest.mark.asyncio
    async def test_a_decision_gate_on_the_programme_is_shown(self, monkeypatch):
        data = make_coord_data()
        data["gates"]["prog-plan"].append(
            _gate(9, "prog-plan", "operator_approval", verdict="open")
        )
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        (gate,) = env.gates.items.value
        assert (gate.verdict, gate.title) == ("pending", "anchor 9")
        assert env.gates.other_checks_not_shown.total == 3

    @pytest.mark.asyncio
    async def test_no_programme_and_two_programmes_are_unknown_with_reasons(
        self, monkeypatch
    ):
        none = make_coord_data()
        none["units"][0]["metadata"].pop("intent_initiative")
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(none))
        env, _ = await build()
        assert env.programme.unknown_reason == "no_programme"
        assert env.phases.value is None and env.phases.state == "unknown"

        two = make_coord_data()
        two["units"][1]["metadata"]["intent_initiative"] = (
            "initiative/current-initiative"
        )
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(two))
        env, _ = await build()
        assert env.programme.unknown_reason == "ambiguous_programme"
        assert env.phases.value is None

    @pytest.mark.asyncio
    async def test_a_truncated_scan_is_truncated_not_no_programme(self, monkeypatch):
        data = make_coord_data()
        data["units"] = data["units"][1:] + [
            _unit(f"filler-{i}") for i in range(cs.UNIT_PAGE * cs.MAX_UNIT_PAGES)
        ]  # the programme is not in the first 5 pages
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        assert env.programme.unknown_reason == "truncated"
        assert env.work_units.truncated is True

    @pytest.mark.asyncio
    async def test_the_programme_key_resolves_a_large_tenant_directly(
        self, monkeypatch
    ):
        data = make_coord_data(
            initiative=INITIATIVE_BODY.replace(
                "status: live", "status: live\nprogramme: prog-plan"
            )
        )
        data["units"] = data["units"][1:] + [
            _unit(f"filler-{i}") for i in range(cs.UNIT_PAGE * cs.MAX_UNIT_PAGES)
        ]
        data["units"].append(make_coord_data()["units"][0])  # reachable by slug only
        fake = FakeCoord(data)
        # keep the programme out of the scanned window but reachable by a direct read
        monkeypatch.setattr(cs, "_proxy_coord_get", fake)
        env, _ = await build()
        assert env.programme.value.slug == "prog-plan"
        assert any(p.endswith("/work-units/prog-plan") for p in fake.paths())

    @pytest.mark.asyncio
    async def test_a_failed_gate_read_is_unknown_never_an_empty_list(self, monkeypatch):
        data = make_coord_data(linked=True)  # child-a and child-b are schedule units
        del data["gates"]["child-a"]  # coord answers 404 for that unit's gates
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        assert env.gates.items.state == "unknown"
        assert env.gates.items.value is None
        assert env.gates.items.unknown_reason == "coord_unreachable"
        # the rest of the schedule is unaffected
        assert len(env.phases.value) == 14

    @pytest.mark.asyncio
    async def test_gate_rows_of_another_unit_are_refused(self, coord):
        coord.data["gates"]["prog-plan"][0]["work_unit_slug"] = "someone-else"
        env, _ = await build()
        assert env.gates.items.state == "unknown"

    @pytest.mark.asyncio
    async def test_gate_reads_are_capped_and_the_cap_is_reported(self, monkeypatch):
        data = make_coord_data()
        meta = data["units"][0]["metadata"]
        slugs = [f"kid-{i}" for i in range(20)]
        meta["phase_units"] = {"1": slugs}
        for s in slugs:
            data["units"].append(_unit(s, "ready", metadata={"parent": "prog-plan"}))
            data["gates"][s] = []
        fake = FakeCoord(data)
        monkeypatch.setattr(cs, "_proxy_coord_get", fake)
        env, _ = await build()
        gate_calls = [c for c in fake.calls if c[0].endswith("/gates")]
        assert len(gate_calls) == cs.SCHEDULE_UNIT_CAP
        assert env.gates.read.truncated is True
        assert env.gates.read.read == cs.SCHEDULE_UNIT_CAP
        assert env.gates.read.total == 21

    @pytest.mark.asyncio
    async def test_the_delivery_view_failing_makes_unlinked_phases_unknown(self, coord):
        coord.data["delivery"].clear()  # 404 for the programme's citations
        env, _ = await build()
        assert env.phases.state == "known"  # the phase LIST came from the unit
        assert env.phases.value[0].state.state == "unknown"
        assert env.phases.value[0].state.unknown_reason == "not_recorded"


# ===========================================================================
# D4 — unknown is not zero
# ===========================================================================


class TestUnknown:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "failure",
        [
            HTTPException(504, "timed out"),
            HTTPException(502, "bad gateway"),
            httpx.ReadTimeout("slow"),
        ],
    )
    async def test_a_coord_failure_is_unknown_never_empty_phases(self, coord, failure):
        coord.fail = failure
        env, degraded = await build()
        assert degraded is True
        assert env.phases.state == "unknown" and env.phases.value is None
        assert env.phases.unknown_reason == "coord_unreachable"
        assert env.programme.unknown_reason == "coord_unreachable"
        assert env.milestones.items.value is None
        assert env.gates.items.value is None
        assert env.forecast.state == "unknown"

    @pytest.mark.asyncio
    async def test_a_denied_read_is_coord_denied_and_does_not_degrade(self, coord):
        coord.fail = HTTPException(403, "no")
        env, degraded = await build()
        assert env.phases.unknown_reason == "coord_denied"
        assert degraded is False  # a denial is not an outage a stale copy should hide

    @pytest.mark.asyncio
    async def test_a_missing_initiative_leaves_the_phases_and_marks_the_milestones(
        self, coord
    ):
        coord.data["documents"].clear()
        env, _ = await build()
        assert env.milestones.items.unknown_reason == "not_declared"
        assert env.initiative.starts.unknown_reason == "not_declared"
        assert len(env.phases.value) == 14

    @pytest.mark.asyncio
    async def test_a_malformed_page_is_unreachable_not_empty(self, coord):
        coord.data["units"] = "oops"
        env, degraded = await build()
        assert degraded is True
        assert env.programme.unknown_reason == "coord_unreachable"
        assert env.phases.value is None

    @pytest.mark.asyncio
    async def test_a_row_of_a_shape_this_reader_does_not_know_is_unparseable(
        self, coord
    ):
        coord.data["units"][0]["title"] = {"not": "a title"}
        env, degraded = await build()
        assert degraded is False
        assert env.phases.unknown_reason == "unparseable"
        assert env.phases.value is None


# ===========================================================================
# D7 — tenant refusal
# ===========================================================================


class TestTenantRefusal:
    @pytest.mark.asyncio
    async def test_a_row_of_another_tenant_makes_the_whole_envelope_unknown(
        self, monkeypatch
    ):
        data = make_coord_data()
        data["units"].append(_unit("intruder", tenant=OTHER_TENANT))
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, degraded = await build()
        assert degraded is False
        for res in (
            env.programme,
            env.phases,
            env.milestones.items,
            env.gates.items,
            env.forecast,
        ):
            assert res.state == "unknown" and res.unknown_reason == "tenant_mismatch"
            assert res.value is None
        assert svc.metrics.tenant_mismatch == 1

    @pytest.mark.asyncio
    async def test_a_null_tenant_row_is_unprovable_and_refused_too(self, monkeypatch):
        data = make_coord_data()
        data["units"].append(_unit("orphan", tenant=None))
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        assert env.phases.unknown_reason == "tenant_mismatch"
        assert svc.metrics.tenant_mismatch == 1

    @pytest.mark.asyncio
    async def test_a_gate_row_of_another_tenant_is_refused(self, monkeypatch):
        data = make_coord_data()
        data["gates"]["prog-plan"].append(
            _gate(8, "prog-plan", "pr_merged", tenant=OTHER_TENANT)
        )
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        env, _ = await build()
        assert env.gates.items.unknown_reason == "tenant_mismatch"
        assert env.phases.unknown_reason == "tenant_mismatch"

    @pytest.mark.asyncio
    async def test_a_device_bound_to_one_tenant_asking_for_another_reads_nothing(
        self, monkeypatch
    ):
        """The JWT names tenant A, so every row coord returns is A's; the request
        is for tenant B. The row check is the defence that fires."""
        monkeypatch.setattr(
            cs, "_proxy_coord_get", FakeCoord(make_coord_data(tenant=TENANT))
        )
        env, _ = await build_coord_schedule(_device(), OTHER_TENANT, NOW)
        assert env.phases.unknown_reason == "tenant_mismatch"
        assert env.phases.value is None

    def test_assert_rows_in_tenant_directly(self):
        assert_rows_in_tenant([{"tenant_id": str(TENANT).upper()}], TENANT, what="x")
        with pytest.raises(cs.TenantMismatch):
            assert_rows_in_tenant([{"tenant_id": str(OTHER_TENANT)}], TENANT, what="x")
        with pytest.raises(cs.TenantMismatch):
            assert_rows_in_tenant([{"tenant_id": None}], TENANT, what="x")
        with pytest.raises(cs.TenantMismatch):
            assert_rows_in_tenant([{}], TENANT, what="x")
        # a document that carries no tenant is the door's to scope
        assert_rows_in_tenant([{}], TENANT, what="doc", require=False)
        with pytest.raises(cs.TenantMismatch):
            assert_rows_in_tenant(
                [{"tenant_id": str(OTHER_TENANT)}], TENANT, what="d", require=False
            )


# ===========================================================================
# D1 — two doors, one envelope
# ===========================================================================


def _comparable(env: Any) -> dict[str, Any]:
    """The envelope with the fields that legitimately differ by door removed."""
    dump = env.model_dump(mode="json")
    dump.pop("door")

    def scrub(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: scrub(v) for k, v in node.items() if k != "observed_at"}
        if isinstance(node, list):
            return [scrub(v) for v in node]
        return node

    return scrub(dump)


class TestDoors:
    @pytest.mark.asyncio
    async def test_operator_and_device_sources_return_equal_envelopes(
        self, monkeypatch
    ):
        fake = FakeCoord(make_coord_data(linked=True))
        monkeypatch.setattr(cs, "_proxy_coord_get", fake)
        op, _ = await build(_operator())
        dev, _ = await build(_device())
        assert op.door == "operator" and dev.door == "device"
        assert _comparable(op) == _comparable(dev)
        # ... and the comparison is not vacuous: the envelope has real content
        assert len(op.phases.value) == 14 and len(op.milestones.items.value) == 5

    @pytest.mark.asyncio
    async def test_each_door_reads_its_own_routes(self, coord):
        await build(_operator())
        operator_paths = set(coord.paths())
        coord.calls.clear()
        await build(_device())
        device_paths = set(coord.paths())
        assert operator_paths and device_paths
        assert all("/coord/agent-" not in p for p in operator_paths)
        assert all(p.startswith(DEVICE_READ_DOORS) for p in device_paths)
        assert any(p == "/coord/work-units" for p in operator_paths)
        assert any(p == "/coord/gates" for p in operator_paths)
        assert any(p.startswith("/coord/prompt-documents/") for p in operator_paths)

    @pytest.mark.asyncio
    async def test_the_operator_door_forwards_the_callers_bearer_and_no_explicit_header(
        self, coord
    ):
        await build(_operator())
        assert coord.calls
        for _path, _params, kwargs in coord.calls:
            assert kwargs["forward_bearer"] is True
            assert kwargs["tenant_id"] == TENANT
            assert "headers" not in kwargs  # the ContextVar bearer is the credential

    @pytest.mark.asyncio
    async def test_the_device_token_reaches_only_the_three_read_doors(self, coord):
        """The invariant ``OverviewPrincipal.token`` documents, as a test."""
        await build(_device())
        assert coord.calls
        for path, _params, kwargs in coord.calls:
            assert kwargs["headers"] == {"Authorization": "Bearer device-bearer-123"}
            assert kwargs.get("forward_bearer", False) is False
            assert any(
                path == d or path.startswith(d + "/") for d in DEVICE_READ_DOORS
            ), path
        assert set(DEVICE_READ_DOORS) == {
            "/coord/agent-work-units",
            "/coord/agent-gates",
            "/coord/agent-prompt-documents",
        }

    @pytest.mark.asyncio
    async def test_the_device_source_refuses_any_other_path(self, coord):
        with pytest.raises(RuntimeError, match="must not reach"):
            await _device()._get("/coord/work-units")  # an operator route
        with pytest.raises(RuntimeError, match="must not reach"):
            await _device()._get("/coord/agent-work-units-evil")
        assert coord.calls == []

    def test_the_device_token_is_used_only_where_the_docstring_says(self):
        """``principal.token`` appears in the permissions module (memberships door)
        and the schedule route (the device source), and nowhere else in the
        overview, so a new use is a visible change to this test and to the
        ``OverviewPrincipal.token`` comment."""
        root = Path(__file__).resolve().parents[1] / "app"
        users = {
            str(p.relative_to(root)).replace("\\", "/")
            for p in list((root / "overview").glob("*.py"))
            + list((root / "services").glob("overview*.py"))
            if re.search(r"principal\.token", p.read_text(encoding="utf-8"))
        }
        assert users == {"overview/permissions.py", "overview/schedule_routes.py"}
        perms = (root / "overview" / "permissions.py").read_text(encoding="utf-8")
        for door in DEVICE_READ_DOORS:
            assert door in perms  # the docstring names every door
        assert "/coord/devices/me/memberships" in perms

    def test_no_write_verb_exists_on_the_sources(self):
        for cls in (OperatorSource, DeviceSource):
            names = {n for n in dir(cls) if not n.startswith("_")}
            assert not names & {"post", "put", "patch", "delete", "write", "upsert"}
        src = Path(cs.__file__).read_text(encoding="utf-8")
        assert "_proxy_coord_post" not in src and "_proxy_coord_patch" not in src


# ===========================================================================
# D8 — cache, single-flight, stale-while-error
# ===========================================================================


class TestCache:
    @pytest.mark.asyncio
    async def test_concurrent_views_share_one_fan_out(self, coord):
        coord.delay = 0.01
        service = ScheduleService(clock=Clock())
        key = (TENANT, "operator")
        calls = 0

        async def loader():
            nonlocal calls
            calls += 1
            return await build_coord_schedule(_operator(), TENANT, NOW)

        results = await asyncio.gather(*(service.get(key, loader) for _ in range(8)))
        assert calls == 1
        unit_pages = [p for p in coord.paths() if p == "/coord/work-units"]
        assert len(unit_pages) == 2  # one page + the empty page that ends the scan
        assert all(r.phases.value is not None for r in results)
        # a follow-up within the TTL reads nothing
        before = len(coord.calls)
        await service.get(key, loader)
        assert len(coord.calls) == before and calls == 1

    @pytest.mark.asyncio
    async def test_a_view_after_the_ttl_reads_again(self, coord):
        clock = Clock()
        service = ScheduleService(clock=clock)
        key = (TENANT, "operator")
        loads = 0

        async def loader():
            nonlocal loads
            loads += 1
            return await build_coord_schedule(_operator(), TENANT, clock())

        await service.get(key, loader)
        clock.advance(seconds=59)
        await service.get(key, loader)
        assert loads == 1
        clock.advance(seconds=2)
        await service.get(key, loader)
        assert loads == 2

    @pytest.mark.asyncio
    async def test_keys_are_per_tenant_and_per_door(self, coord):
        service = ScheduleService(clock=Clock())
        loads: list[tuple[UUID, str]] = []

        def loader_for(key):
            async def loader():
                loads.append(key)
                return await build_coord_schedule(_operator(), TENANT, NOW)

            return loader

        for key in (
            (TENANT, "operator"),
            (TENANT, "device"),
            (OTHER_TENANT, "operator"),
        ):
            await service.get(key, loader_for(key))
        assert len(loads) == 3

    @pytest.mark.asyncio
    async def test_stale_at_nine_minutes_unknown_at_eleven(self, coord):
        clock = Clock()
        service = ScheduleService(clock=clock)
        key = (TENANT, "operator")

        async def loader():
            return await build_coord_schedule(_operator(), TENANT, clock())

        good = await service.get(key, loader)
        t0 = good.observed_at
        assert good.stale is False and good.phases.state == "known"

        coord.fail = HTTPException(504, "down")
        clock.advance(minutes=9)
        stale = await service.get(key, loader)
        assert stale.stale is True
        assert stale.observed_at == t0  # never renewed
        assert stale.phases.state == "known" and stale.phases.stale is True
        assert len(stale.phases.value) == 14
        assert stale.phases.observed_at == t0

        # the failure is probed once per TTL, not once per view
        reads = len(coord.calls)
        clock.advance(seconds=30)
        await service.get(key, loader)
        assert len(coord.calls) == reads

        clock.advance(minutes=2, seconds=-30)  # 11 minutes after the good read
        gone = await service.get(key, loader)
        assert gone.stale is False
        assert gone.phases.state == "unknown" and gone.phases.value is None
        assert gone.phases.unknown_reason == "coord_unreachable"

    @pytest.mark.asyncio
    async def test_recovery_replaces_the_stale_copy(self, coord):
        clock = Clock()
        service = ScheduleService(clock=clock)
        key = (TENANT, "operator")

        async def loader():
            return await build_coord_schedule(_operator(), TENANT, clock())

        await service.get(key, loader)
        coord.fail = HTTPException(504, "down")
        clock.advance(seconds=61)
        assert (await service.get(key, loader)).stale is True
        coord.fail = None
        clock.advance(seconds=61)
        back = await service.get(key, loader)
        assert back.stale is False and back.observed_at == clock()

    @pytest.mark.asyncio
    async def test_a_degraded_first_read_is_served_as_unknown(self, coord):
        coord.fail = HTTPException(504, "down")
        service = ScheduleService(clock=Clock())

        async def loader():
            return await build_coord_schedule(_operator(), TENANT, NOW)

        env = await service.get((TENANT, "operator"), loader)
        assert env.stale is False and env.phases.value is None

    @pytest.mark.asyncio
    async def test_one_cancelled_view_does_not_cancel_the_shared_fan_out(self, coord):
        coord.delay = 0.02
        service = ScheduleService(clock=Clock())
        key = (TENANT, "operator")

        async def loader():
            return await build_coord_schedule(_operator(), TENANT, NOW)

        first = asyncio.ensure_future(service.get(key, loader))
        second = asyncio.ensure_future(service.get(key, loader))
        await asyncio.sleep(0.005)
        first.cancel()
        env = await second
        assert env.phases.value is not None

    @pytest.mark.asyncio
    async def test_mark_stale_flags_known_figures_only(self, coord):
        env, _ = await build()
        stale = mark_stale(env)
        assert stale.stale and env.stale is False  # the cached copy is untouched
        assert stale.programme.stale is True
        assert stale.phases.value[0].actual_end.state == "unknown"
        assert stale.phases.value[0].actual_end.stale is False


# ===========================================================================
# D5 — precedence of coord over what a person entered
# ===========================================================================

ENTERED_AT = dt.datetime(2026, 11, 3, 9, 0, tzinfo=dt.UTC)


def _typed_phase(code: str, n: int, **kw: Any) -> TypedPhase:
    base: dict[str, Any] = {
        "id": str(uuid4()),
        "code": code,
        "name": f"Phase {code}",
        "sort_order": n,
        "planned_start": dt.date(2026, 10, 19) + dt.timedelta(weeks=4 * (n - 1)),
        "planned_end": dt.date(2026, 10, 19) + dt.timedelta(weeks=4 * (n - 1), days=25),
        "actual_start": None,
        "actual_end": None,
        "gate_status": "pending",
        "gate_criteria": None,
        "updated_by": "Maria",
        "updated_at": ENTERED_AT,
    }
    base.update(kw)
    return TypedPhase(**base)


def _typed(
    *phases: TypedPhase, milestones: list[TypedMilestone] | None = None
) -> TypedInputs:
    return TypedInputs(
        phases=list(phases),
        breaks=[],
        working_day_factor=Decimal("1"),
        milestones=milestones or [],
    )


TODAY = dt.date(2026, 11, 25)


class TestPrecedence:
    @pytest.mark.asyncio
    async def test_coord_known_and_entered_differ_coord_is_shown_with_the_disagreement(
        self, monkeypatch
    ):
        monkeypatch.setattr(
            cs, "_proxy_coord_get", FakeCoord(make_coord_data(linked=True))
        )
        base, _ = await build()
        typed = _typed(
            _typed_phase(
                "P1",
                1,
                actual_start=dt.date(2026, 10, 20),
                actual_end=dt.date(2026, 11, 14),
            ),
            _typed_phase("P2", 2),
            _typed_phase("P3", 3),
        )
        env = apply_entered(base, typed, today=TODAY, now=NOW)
        p1 = env.phases.value[0]
        assert p1.actual_end.state == "known"
        assert p1.actual_end.value == dt.date(2026, 11, 10)  # coord's
        assert p1.actual_end.disagrees.coord_value == dt.date(2026, 11, 10)
        assert p1.actual_end.disagrees.entered_value == dt.date(2026, 11, 14)
        assert (p1.actual_end.entered.by, p1.actual_end.entered.at) == (
            "Maria",
            ENTERED_AT,
        )
        # the start agrees, so no disagreement is invented
        assert p1.actual_start.disagrees is None
        assert env.disagreement_count == 1

    @pytest.mark.asyncio
    async def test_the_entered_value_does_not_feed_the_forecast(self, monkeypatch):
        monkeypatch.setattr(
            cs, "_proxy_coord_get", FakeCoord(make_coord_data(linked=True))
        )
        base, _ = await build()

        def forecast_with(entered_end: dt.date):
            typed = _typed(
                _typed_phase(
                    "P1", 1, actual_start=dt.date(2026, 10, 20), actual_end=entered_end
                ),
                _typed_phase("P2", 2),
                _typed_phase("P3", 3),
            )
            return apply_entered(base, typed, today=TODAY, now=NOW)

        late = forecast_with(dt.date(2027, 3, 1))  # entered says P1 ended months later
        agrees = forecast_with(dt.date(2026, 11, 10))  # entered == coord
        assert late.forecast.state == "known"
        assert late.forecast.value == agrees.forecast.value
        assert late.basis == "coord"

    @pytest.mark.asyncio
    async def test_coord_unknown_the_entered_value_stands_in_labelled(self, coord):
        coord.fail = HTTPException(504, "down")
        base, _ = await build()
        typed = _typed(
            _typed_phase(
                "P1",
                1,
                actual_start=dt.date(2026, 10, 20),
                actual_end=dt.date(2026, 11, 14),
            ),
            _typed_phase("P2", 2),
        )
        env = apply_entered(base, typed, today=TODAY, now=NOW)
        # coord gave no phases, so nothing to overlay on the phase list ...
        assert env.phases.value is None
        # ... but the forecast still runs on the entered rows and says so
        assert env.forecast.state == "known"
        assert env.basis == "entered"

    @pytest.mark.asyncio
    async def test_a_phase_coord_cannot_confirm_takes_the_entered_value_labelled(
        self, coord
    ):
        base, _ = await build()  # unlinked phases: state not_confirmed, dates unknown
        typed = _typed(
            _typed_phase("P2", 2, actual_start=dt.date(2026, 11, 2)),
            _typed_phase("P1", 1),
        )
        env = apply_entered(base, typed, today=TODAY, now=NOW)
        p2 = env.phases.value[1]
        assert p2.actual_start.state == "entered"
        assert p2.actual_start.value == dt.date(2026, 11, 2)
        assert p2.actual_start.entered.by == "Maria"
        assert "not confirmed by coord" in p2.actual_start.source.label
        assert (
            p2.actual_start.unknown_reason == "not_declared"
        )  # why coord could not say
        assert p2.state.state == "entered" and p2.state.value == "in_progress"
        assert p2.actual_end.state == "unknown"
        # and the figure carries NO disagreement: coord said nothing to disagree with
        assert p2.actual_start.disagrees is None and env.disagreement_count == 0
        assert env.basis == "entered"

    @pytest.mark.asyncio
    async def test_milestones_collapse_on_name_and_date_and_flag_a_date_disagreement(
        self, coord
    ):
        base, _ = await build()
        typed = _typed(
            milestones=[
                TypedMilestone(
                    "m1",
                    "v1 account module",
                    dt.date(2026, 12, 1),
                    "planned",
                    None,
                    "Maria",
                    ENTERED_AT,
                ),
                TypedMilestone(
                    "m2",
                    "V2 checkout",
                    dt.date(2026, 12, 20),
                    "planned",
                    None,
                    "Maria",
                    ENTERED_AT,
                ),
                TypedMilestone(
                    "m3",
                    "Entered only",
                    dt.date(2027, 2, 1),
                    "planned",
                    None,
                    "Maria",
                    ENTERED_AT,
                ),
            ]
        )
        env = apply_entered(base, typed, today=TODAY, now=NOW)
        items = {m.name: m for m in env.milestones.items.value}
        same = items["V1 account module"]
        assert (
            same.sources == ["coord", "entered"] and same.target_date.disagrees is None
        )
        differ = items["V2 checkout"]
        assert differ.target_date.value == dt.date(2026, 12, 18)  # coord's
        assert differ.target_date.disagrees.entered_value == dt.date(2026, 12, 20)
        assert items["V0 first slice"].sources == ["coord"]
        assert [m.name for m in env.milestones.entered_only] == ["Entered only"]
        assert env.disagreement_count == 1

    @pytest.mark.asyncio
    async def test_when_coord_cannot_read_milestones_every_entered_one_stands_in(
        self, coord
    ):
        coord.data["documents"].clear()
        base, _ = await build()
        typed = _typed(
            milestones=[
                TypedMilestone(
                    "m1",
                    "Pilot",
                    dt.date(2026, 12, 1),
                    "done",
                    dt.date(2026, 12, 2),
                    "Maria",
                    ENTERED_AT,
                )
            ]
        )
        env = apply_entered(base, typed, today=TODAY, now=NOW)
        assert env.milestones.items.state == "unknown"
        (pilot,) = env.milestones.entered_only
        assert pilot.target_date.state == "entered"
        assert pilot.status.value == "met" and pilot.met_at.value == dt.date(
            2026, 12, 2
        )

    @pytest.mark.asyncio
    async def test_apply_entered_never_mutates_the_cached_envelope(self, monkeypatch):
        monkeypatch.setattr(
            cs, "_proxy_coord_get", FakeCoord(make_coord_data(linked=True))
        )
        base, _ = await build()
        snapshot = base.model_dump(mode="json")
        apply_entered(
            base,
            _typed(
                _typed_phase("P1", 1, actual_end=dt.date(2027, 1, 1)),
                _typed_phase("P2", 2),
            ),
            today=TODAY,
            now=NOW,
        )
        assert base.model_dump(mode="json") == snapshot


class TestForecast:
    @pytest.mark.asyncio
    async def test_bauhaus_shape_with_no_typed_rows_is_phase_dates_missing(self, coord):
        base, _ = await build()
        env = apply_entered(base, TypedInputs(), today=TODAY, now=NOW)
        assert env.forecast.state == "unknown"
        assert env.forecast.unknown_reason == "phase_dates_missing"
        assert env.forecast.value is None and env.basis is None

    @pytest.mark.asyncio
    async def test_fully_dated_coord_phases_without_an_estimate_say_no_calendar(
        self, monkeypatch
    ):
        data = make_coord_data(phases=2)
        data["units"][0]["metadata"]["phases"] = [
            {"index": 1, "name": "P1 One", "milestone": "V1"},
            {"index": 2, "name": "P2 Two", "milestone": "V2"},
        ]
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        base, _ = await build()
        env = apply_entered(base, TypedInputs(), today=TODAY, now=NOW)
        assert env.forecast.unknown_reason == "no_calendar"

    @pytest.mark.asyncio
    async def test_an_estimate_forecast_matches_compute_forecast_unchanged(self, coord):
        from app.services.overview_forecast import compute_forecast

        base, _ = await build()
        phases = [
            _typed_phase(
                "P1",
                1,
                actual_start=dt.date(2026, 10, 20),
                actual_end=dt.date(2026, 11, 14),
            ),
            _typed_phase("P2", 2, actual_start=dt.date(2026, 11, 20)),
            _typed_phase("P3", 3),
        ]
        env = apply_entered(base, _typed(*phases), today=TODAY, now=NOW)
        direct = compute_forecast(
            [
                svc._ForecastPhase(
                    **{
                        k: getattr(p, k)
                        for k in svc._ForecastPhase.__dataclass_fields__
                    }
                )
                for p in phases
            ],  # type: ignore[arg-type]
            [],
            working_day_factor=Decimal("1"),
            today=TODAY,
        )
        assert env.forecast.value.forecast_finish == direct["forecast_finish"]
        assert env.forecast.value.slip_days == direct["slip_days"]
        assert env.forecast.value.position == direct["position"] == "in_progress"
        assert env.forecast.value.current_phase.code == "P2"

    @pytest.mark.asyncio
    async def test_the_basis_is_mixed_when_both_sources_feed_it(self, monkeypatch):
        monkeypatch.setattr(
            cs, "_proxy_coord_get", FakeCoord(make_coord_data(linked=True))
        )
        base, _ = await build()
        typed = _typed(
            _typed_phase("P1", 1),
            _typed_phase("P2", 2),
            _typed_phase(
                "P3", 3, actual_start=dt.date(2026, 11, 20)
            ),  # coord has no P3 dates
        )
        env = apply_entered(base, typed, today=TODAY, now=NOW)
        assert env.basis == "mixed"

    @pytest.mark.asyncio
    async def test_an_undated_estimate_phase_withholds_the_forecast(self, coord):
        base, _ = await build()
        env = apply_entered(
            base,
            _typed(_typed_phase("P1", 1, planned_end=None), _typed_phase("P2", 2)),
            today=TODAY,
            now=NOW,
        )
        assert env.forecast.state == "unknown"
        assert env.forecast.unknown_reason == "phase_dates_missing"


# ===========================================================================
# The route, through the mounted router — both principal kinds
# ===========================================================================


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"schedule_{uuid4().hex[:8]}@example.com",
        username=f"schedule_{uuid4().hex[:8]}",
        full_name="Schedule Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


def _app(
    db: AsyncSession,
    user: Any,
    tenant: UUID,
    *,
    kind: str,
    service: ScheduleService,
) -> FastAPI:
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.overview import router as overview_router
    from app.overview.permissions import (
        OverviewCaller,
        OverviewPrincipal,
        get_overview_caller,
        get_overview_principal,
    )
    from app.overview.router import router as authoring_router
    from app.overview.schedule_routes import get_schedule_service

    app = FastAPI()
    app.dependency_overrides[current_active_user] = app.dependency_overrides[
        current_active_user_optional
    ] = lambda: user

    async def _db():
        yield db

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[get_overview_caller] = lambda: OverviewCaller(
        tenant_id=tenant, roles=("viewer",)
    )
    if kind == "device":
        app.dependency_overrides[get_overview_principal] = lambda: OverviewPrincipal(
            kind="device",
            user=user,
            device_id=uuid4(),
            claims={"sub_type": "device"},
            token="device-bearer-123",
        )
    app.dependency_overrides[get_schedule_service] = lambda: service
    app.include_router(overview_router, prefix=API)
    app.include_router(authoring_router, prefix=API)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Overview-Source": "ui"},
    )


@pytest.mark.asyncio
class TestRoute:
    async def _get(self, db, user, tenant, kind, coord, service=None):
        app = _app(db, user, tenant, kind=kind, service=service or ScheduleService())
        async with _client(app) as c:
            return await c.get(f"{API}/schedule")

    @pytest.mark.parametrize("kind", ["user", "device"])
    async def test_any_member_of_either_principal_kind_reads_the_schedule(
        self, async_db_session, api_user, coord, kind
    ):
        resp = await self._get(async_db_session, api_user, TENANT, kind, coord)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["door"] == ("device" if kind == "device" else "operator")
        assert body["tenant_id"] == str(TENANT)
        assert len(body["phases"]["value"]) == 14
        assert body["programme"]["value"]["slug"] == "prog-plan"
        assert body["forecast"]["unknown_reason"] == "phase_dates_missing"
        # the door really used: device bearer vs forwarded bearer
        if kind == "device":
            assert all(
                c[0].startswith(DEVICE_READ_DOORS) and "headers" in c[2]
                for c in coord.calls
            )
        else:
            assert all(c[2].get("forward_bearer") for c in coord.calls)

    async def test_both_doors_serve_the_same_body_over_http(
        self, async_db_session, api_user, coord
    ):
        a = (await self._get(async_db_session, api_user, TENANT, "user", coord)).json()
        b = (
            await self._get(async_db_session, api_user, TENANT, "device", coord)
        ).json()
        assert _scrub_http(a) == _scrub_http(b)

    async def test_a_cross_tenant_row_yields_tenant_mismatch_through_the_router(
        self, async_db_session, api_user, monkeypatch
    ):
        data = make_coord_data()
        data["units"].append(_unit("intruder", tenant=OTHER_TENANT))
        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(data))
        resp = await self._get(async_db_session, api_user, TENANT, "device", None)
        assert resp.status_code == 200
        body = resp.json()
        assert body["phases"]["unknown_reason"] == "tenant_mismatch"
        assert body["phases"]["value"] is None
        assert svc.metrics.tenant_mismatch == 1

    async def test_a_coord_outage_is_a_200_with_unknown_figures_not_an_error(
        self, async_db_session, api_user, coord
    ):
        coord.fail = HTTPException(504, "down")
        resp = await self._get(async_db_session, api_user, TENANT, "user", coord)
        assert resp.status_code == 200
        body = resp.json()
        assert body["phases"]["state"] == "unknown"
        assert body["phases"]["value"] is None

    async def test_typed_rows_overlay_over_http_and_stay_in_their_tenant(
        self, async_db_session, api_user, monkeypatch
    ):
        from app.models.overview import Milestone

        monkeypatch.setattr(cs, "_proxy_coord_get", FakeCoord(make_coord_data()))
        for tenant, title in (
            (TENANT, "Entered here"),
            (OTHER_TENANT, "Entered elsewhere"),
        ):
            async_db_session.add(
                Milestone(
                    tenant_id=tenant,
                    title=title,
                    target_date=dt.date(2027, 2, 1),
                    updated_by="Maria",
                )
            )
        await async_db_session.commit()
        body = (
            await self._get(async_db_session, api_user, TENANT, "user", None)
        ).json()
        names = [m["name"] for m in body["milestones"]["entered_only"]]
        assert names == ["Entered here"]  # tenant B's row never appears

    async def test_the_route_has_no_write_verb(self, async_db_session, api_user, coord):
        app = _app(
            async_db_session, api_user, TENANT, kind="user", service=ScheduleService()
        )
        async with _client(app) as c:
            for method in ("post", "put", "patch", "delete"):
                resp = await getattr(c, method)(f"{API}/schedule")
                assert resp.status_code == 405, method

    async def test_last_known_stamps_are_written_and_age_an_unknown_figure(
        self, async_db_session, api_user, coord
    ):
        clock = Clock(NOW)
        service = ScheduleService(clock=clock)
        ok = await self._get(async_db_session, api_user, TENANT, "user", coord, service)
        assert ok.status_code == 200
        rows = (
            (
                await async_db_session.execute(
                    select(OverviewScheduleLastKnown).where(
                        OverviewScheduleLastKnown.tenant_id == TENANT
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {r.figure for r in rows} == {
            "programme",
            "phases",
            "milestones",
            "gates",
        }
        assert all(r.last_known_at == NOW for r in rows)
        assert not [r for r in rows if r.tenant_id != TENANT]

        # coord goes away for good: past the stale window the figures are unknown,
        # and each says since WHEN it was last known
        coord.fail = HTTPException(504, "down")
        clock.advance(minutes=11)
        down = (
            await self._get(async_db_session, api_user, TENANT, "user", coord, service)
        ).json()
        assert down["phases"]["state"] == "unknown"
        for figure in ("phases", "programme"):
            since = dt.datetime.fromisoformat(
                down[figure]["unknown_since"].replace("Z", "+00:00")
            )
            assert since == NOW

    async def test_a_failing_stamp_write_never_fails_the_read(
        self, async_db_session, api_user, coord, monkeypatch
    ):
        def boom(*_a: Any, **_k: Any) -> None:
            raise RuntimeError("stamp store down")

        monkeypatch.setattr(svc, "pg_insert", boom)
        resp = await self._get(async_db_session, api_user, TENANT, "user", coord)
        assert resp.status_code == 200
        assert resp.json()["phases"]["state"] == "known"

    async def test_the_schedule_route_is_in_the_openapi_schema(
        self, async_db_session, api_user
    ):
        app = _app(
            async_db_session, api_user, TENANT, kind="user", service=ScheduleService()
        )
        spec = app.openapi()
        op = spec["paths"][f"{API}/schedule"]
        assert set(op) == {"get"}
        assert "ScheduleEnvelope" in str(op["get"]["responses"]["200"])


def _scrub_http(body: dict[str, Any]) -> dict[str, Any]:
    def scrub(node: Any) -> Any:
        if isinstance(node, dict):
            return {
                k: scrub(v)
                for k, v in node.items()
                if k not in ("observed_at", "unknown_since")
            }
        if isinstance(node, list):
            return [scrub(v) for v in node]
        return node

    out = scrub(body)
    out.pop("door")
    return out
