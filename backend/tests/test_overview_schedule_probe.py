"""Unit tests for scripts/probe_overview_schedule.py (plan 2026-11-25 Phase 1).

Fixtures are synthetic and shaped like the live coord reads of 2026-11-25; no tenant
data is copied here. Each test can fail: the census must miscount or raise when the
parser is wrong.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "scripts" / "probe_overview_schedule.py"
_spec = importlib.util.spec_from_file_location("probe_overview_schedule", _PATH)
assert _spec and _spec.loader
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)

INITIATIVE = """---
status: live
starts: 2026-10-19
ends: 2027-01-22
---
# Initiative

## Milestones in this cycle

| Target date | Milestone | Shown by |
|---|---|---|
| 2026-11-16 | **V0** first slice | a demo |
| 2026-12-01 | V1 account module | demo |
| 2026-12-01 | Customer showing | meeting |
| soon | V9 undated | nothing |
"""


def _unit(slug, **meta):
    return {"slug": slug, "status": "shipped", "metadata": meta}


def _prog(slug="prog", phases=3, **extra):
    return _unit(
        slug,
        intent_initiative="initiative/current-initiative",
        phases=[{"index": i, "name": f"P{i}"} for i in range(1, phases + 1)],
        **extra,
    )


def _delivery(delivered, remaining, complete=False, scope=False):
    return {
        "delivery": {
            "evidence_complete": complete,
            "phases_delivered": delivered,
            "phases_remaining": remaining,
            "phases_attested": [],
            "phases_complete_scope": scope,
        }
    }


def test_milestone_table_parses_rows_and_lists_unparseable() -> None:
    fm, body = probe.parse_flat_frontmatter(INITIATIVE)
    assert fm["starts"] == "2026-10-19" and fm["ends"] == "2027-01-22"
    rows, unparsed = probe.parse_milestone_table(body)
    assert [(r["id"], r["date"]) for r in rows] == [
        ("V0", "2026-11-16"),
        ("V1", "2026-12-01"),
        (None, "2026-12-01"),
    ]
    assert len(unparsed) == 1 and "V9 undated" in unparsed[0]  # listed, not dropped


def test_no_programme_and_two_programmes_are_counted_not_picked() -> None:
    none = probe.build_census([_unit("a")], 1, None, None, [], 0)
    assert none["programme_count"] == 0 and "programme" not in none
    two = probe.build_census([_prog("p1"), _prog("p2")], 2, None, None, [], 0)
    assert two["programme_count"] == 2 and "programme" not in two


def test_phase_states_follow_delivery_view_and_remaining_is_not_planned() -> None:
    c = probe.build_census([_prog()], 1, _delivery([1], [2, 3]), None, [], 0)
    states = {p["index"]: p["state"] for p in c["programme"]["phases"]}
    assert states == {1: "delivered", 2: "remaining", 3: "remaining"}
    assert c["programme"]["evidence_complete"] is False


def test_complete_scope_marks_every_declared_phase_delivered() -> None:
    c = probe.build_census(
        [_prog()], 1, _delivery([], [], complete=True, scope=True), None, [], 0
    )
    assert {p["state"] for p in c["programme"]["phases"]} == {"delivered"}


def test_null_remaining_is_unknown_not_delivered() -> None:
    c = probe.build_census([_prog()], 1, _delivery([1], None), None, [], 0)
    states = {p["index"]: p["state"] for p in c["programme"]["phases"]}
    assert states[2] == "unknown" and states[3] == "unknown"


def test_link_census_counts_parent_and_phase_units() -> None:
    units = [
        _prog(phase_units={"2": ["c1"]}),
        _unit("c1", parent="prog"),
        _unit("c2", parent="other"),
    ]
    links = probe.link_census(units, "prog")
    assert links["children_of_programme"] == ["c1"]
    assert (
        links["units_with_parent"] == 2 and links["programme_has_phase_units"] is True
    )


def test_gate_filter_reads_the_nested_rest_predicate_and_fails_closed() -> None:
    gates = [
        {
            "predicate": {"kind": "pr_merged"},
            "gate_class": "routine-review",
            "verdict": "cleared",
        },
        {
            "predicate": {"kind": "operator_approval"},
            "gate_class": "security-surface",
            "verdict": "open",
        },
        {
            "predicate": {"kind": "operator_approval"},
            "gate_class": "ops-confirm",
            "verdict": "open",
        },
        {
            "predicate": {"kind": "operator_approval"},
            "gate_class": "routine-review",
            "verdict": "withdrawn",
        },
        {
            "predicate": {"kind": "operator_approval"},
            "gate_class": None,
            "verdict": "open",
        },
        {
            "predicate_kind": "operator_approval",
            "gate_class": "routine-review",
            "verdict": "cleared",
        },
        {"predicate": {"kind": "brand_new_kind"}, "verdict": "open"},
    ]
    cen = probe.gate_census(gates)
    assert (
        cen["passing_d3_filter"] == 2
    )  # the unclassed open one and the flat MCP-shaped one
    assert cen["unseen_predicate_kinds"] == ["brand_new_kind"]
    assert cen["by_predicate_kind"]["operator_approval"] == 5


def test_gate_census_flags_truncation() -> None:
    assert (
        probe.gate_census([{"predicate": {"kind": "pr_merged"}}], total_expected=3)[
            "truncated"
        ]
        is True
    )


def test_truncated_unit_list_is_unknown_never_an_empty_census() -> None:
    with pytest.raises(probe.Unknown):
        probe.build_census([_unit("a")], 5, None, None, [], 0)


def test_unit_scan_stops_on_short_page_and_is_unknown_at_the_page_bound() -> None:
    def short(path):  # one short page: complete
        return {"count": 3, "work_units": [_unit(f"u{i}") for i in range(3)]}

    units, total = probe.read_all_units(short)
    assert total == 3 and len(units) == 3

    def endless(
        path,
    ):  # coord's `count` is the page size, so full pages never end the list
        return {"count": probe.PAGE, "work_units": [_unit("x")] * probe.PAGE}

    with pytest.raises(probe.Unknown, match="truncated"):
        probe.read_all_units(endless)


def test_tenant_refusal_exits_2_without_reading(tmp_path, capsys) -> None:
    import base64

    claims = (
        base64.urlsafe_b64encode(json.dumps({"tenant_id": "tenant-a"}).encode())
        .decode()
        .rstrip("=")
    )
    hdr = tmp_path / "hdr"
    hdr.write_text(f"Authorization: Bearer aaa.{claims}.sig\n", encoding="utf-8")
    rc = probe.main(
        [
            "--tenant",
            "tenant-b",
            "--header-file",
            str(hdr),
            "--base",
            "http://127.0.0.1:1",
        ]
    )
    assert rc == 2
    assert "REFUSED" in capsys.readouterr().err


def test_failed_read_prints_unknown_and_exits_3(tmp_path, capsys) -> None:
    import base64

    claims = (
        base64.urlsafe_b64encode(json.dumps({"tenant_id": "t"}).encode())
        .decode()
        .rstrip("=")
    )
    hdr = tmp_path / "hdr"
    hdr.write_text(f"Authorization: Bearer aaa.{claims}.sig\n", encoding="utf-8")
    rc = probe.main(
        ["--tenant", "t", "--header-file", str(hdr), "--base", "http://127.0.0.1:1"]
    )
    assert rc == 3
    assert capsys.readouterr().out.strip() == "UNKNOWN"
