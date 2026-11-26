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
    rows, unparsed, header_found = probe.parse_milestone_table(body)
    assert header_found is True
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


def _offset(path: str) -> int:
    return int(path.split("offset=")[1])


def test_unit_scan_ends_only_on_an_empty_page_and_is_unknown_at_the_bound() -> None:
    def pages(path):  # one short page, then the empty page that ends the list
        rows = [_unit(f"u{i}") for i in range(3)] if _offset(path) == 0 else []
        return {"count": len(rows), "limit": probe.PAGE, "work_units": rows}

    units, total = probe.read_all_units(pages)
    assert total == 3 and len(units) == 3

    def endless(path):  # `count` is the page size, so full pages never end the list
        return {"count": probe.PAGE, "work_units": [_unit("x")] * probe.PAGE}

    with pytest.raises(probe.Unknown, match="truncated"):
        probe.read_all_units(endless)


def test_clamped_page_that_echoes_the_requested_limit_is_still_read_in_full() -> None:
    data = [_unit("a"), _unit("b"), _unit("c")]

    def clamped(path):  # the server serves 2 rows a page but echoes limit=200
        o = _offset(path)
        return {"limit": probe.PAGE, "work_units": data[o : o + 2]}

    units, _ = probe.read_all_units(clamped)
    assert [u["slug"] for u in units] == ["a", "b", "c"]


def test_page_without_a_work_units_list_is_unknown() -> None:
    with pytest.raises(probe.Unknown):
        probe.read_all_units(lambda path: {"limit": 200})


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


def _hdr(tmp_path, tenant="t", secret="SECRETSIG"):
    import base64

    claims = (
        base64.urlsafe_b64encode(json.dumps({"tenant_id": tenant}).encode())
        .decode()
        .rstrip("=")
    )
    hdr = tmp_path / "hdr"
    hdr.write_text(f"Authorization: Bearer aaa.{claims}.{secret}\n", encoding="utf-8")
    return hdr


def test_link_census_with_no_single_programme_claims_no_children() -> None:
    links = probe.link_census([_unit("a"), _unit("b", parent="x")], None)
    assert links["children_of_programme"] == []
    assert links["units_with_parent"] == 1


def test_gate_reads_page_through_and_fail_closed_on_truncation() -> None:
    row = {"predicate": {"kind": "pr_merged"}}

    def two_pages(path):
        offset = int(path.split("offset=")[1])
        n = probe.GATE_PAGE if offset == 0 else 5
        return {"gates": [row] * n, "total": probe.GATE_PAGE + 5}

    gates, total = probe.read_gates(two_pages, ["u"])
    assert len(gates) == probe.GATE_PAGE + 5 and total == probe.GATE_PAGE + 5

    with pytest.raises(probe.Unknown, match="truncated"):
        probe.read_gates(
            lambda path: {"gates": [row] if "offset=0" in path else [], "total": 9},
            ["u"],
        )
    with pytest.raises(probe.Unknown):
        probe.read_gates(lambda path: {"gates": [row]}, ["u"])  # no total
    with pytest.raises(probe.Unknown):
        probe.read_gates(lambda path: [row], ["u"])  # not an object


def test_milestone_parser_reports_missing_table_empty_cells_and_bad_dates() -> None:
    assert probe.parse_milestone_table("no table here") == ([], [], False)
    body = (
        "| Target date | Milestone | Shown by |\n|---|---|---|\n"
        "| | | |\n| 2026-13-45 | V1 impossible | x |\n| 2026-12-01 | V2 ok | y |\n"
    )
    rows, unparsed, found = probe.parse_milestone_table(body)
    assert found and [r["id"] for r in rows] == ["V2"]
    assert len(unparsed) == 2  # the empty row and the impossible date are listed


def test_jwt_tenant_is_none_for_malformed_credentials() -> None:
    assert probe.jwt_tenant("Authorization: Bearer notajwt") is None
    assert probe.jwt_tenant("Authorization: Bearer a.@@@.c") is None
    assert probe.jwt_tenant("Authorization: Bearer a.W10.c") is None  # json list


def test_base_must_be_https_or_loopback_and_header_shape_is_checked(tmp_path) -> None:
    hdr = _hdr(tmp_path)
    with pytest.raises(ValueError, match="https"):
        probe.make_getter("http://example.com", str(hdr))
    bad = tmp_path / "bad"
    bad.write_text("rawtokenwithnocolon", encoding="utf-8")
    with pytest.raises(ValueError, match="Authorization"):
        probe.make_getter("https://coord.qontinui.io", str(bad))
    missing = probe.main(
        [
            "--tenant",
            "t",
            "--header-file",
            str(tmp_path / "nope"),
            "--base",
            "https://x.invalid",
        ]
    )
    assert missing == 2


def test_happy_path_prints_census_and_never_the_credential(
    tmp_path, capsys, monkeypatch
) -> None:
    hdr = _hdr(tmp_path)
    prog = _prog("prog", phases=2)

    def fake_get(path):
        if path.startswith("/coord/agent-work-units?"):
            rows = [prog, _unit("c1", parent="prog")] if _offset(path) == 0 else []
            return {"limit": probe.PAGE, "work_units": rows}
        if path.endswith("/citations"):
            return _delivery([1], [2])
        if path.startswith("/coord/agent-prompt-documents/"):
            return {"body": INITIATIVE}
        if path.startswith("/coord/agent-gates"):
            return {"gates": [], "total": 0}
        raise AssertionError(path)

    monkeypatch.setattr(
        probe,
        "make_getter",
        lambda base, header_file: (fake_get, hdr.read_text().strip()),
    )
    rc = probe.main(["--tenant", "t", "--header-file", str(hdr)])
    out = capsys.readouterr()
    assert rc == 0
    census = json.loads(out.out)
    assert census["programme_count"] == 1 and census["links"][
        "children_of_programme"
    ] == ["c1"]
    assert census["initiative"]["milestone_table_found"] is True
    assert "SECRETSIG" not in out.out + out.err


def test_failed_initiative_read_is_unknown_not_a_partial_census(
    tmp_path, capsys, monkeypatch
) -> None:
    hdr = _hdr(tmp_path)

    def fake_get(path):
        if path.startswith("/coord/agent-work-units?"):
            rows = [_unit("a")] if _offset(path) == 0 else []
            return {"limit": probe.PAGE, "work_units": rows}
        raise probe.Unknown("GET document -> HTTP 404")

    monkeypatch.setattr(
        probe, "make_getter", lambda b, h: (fake_get, hdr.read_text().strip())
    )
    rc = probe.main(["--tenant", "t", "--header-file", str(hdr)])
    assert rc == 3 and capsys.readouterr().out.strip() == "UNKNOWN"


def test_no_programme_reads_no_gates_and_says_so(tmp_path, capsys, monkeypatch) -> None:
    hdr = _hdr(tmp_path)

    def fake_get(path):
        if path.startswith("/coord/agent-work-units?"):
            rows = [_unit("a"), _unit("b")] if _offset(path) == 0 else []
            return {"limit": probe.PAGE, "work_units": rows}
        if path.startswith("/coord/agent-prompt-documents/"):
            return {"body": INITIATIVE}
        raise AssertionError(path)  # no gate read may happen

    monkeypatch.setattr(
        probe, "make_getter", lambda b, h: (fake_get, hdr.read_text().strip())
    )
    assert probe.main(["--tenant", "t", "--header-file", str(hdr)]) == 0
    census = json.loads(capsys.readouterr().out)
    assert census["gates"]["state"] == "not_read"


def test_milestone_rows_after_a_blank_line_or_comment_are_still_read() -> None:
    body = (
        "| Target date | Milestone | Shown by |"
        + chr(10)
        + "|---|---|---|"
        + chr(10)
        + "| 2026-12-01 | V1 first | a |"
        + chr(10)
        + chr(10)
        + "<!-- note -->"
        + chr(10)
        + "| 2026-12-18 | V2 second | b |"
        + chr(10)
        + "| 2026-03-01 to 2026-04-01 | V3 range | c |"
        + chr(10)
        + "## Next section"
        + chr(10)
        + "| 2027-01-01 | stray | d |"
        + chr(10)
    )
    rows, unparsed, found = probe.parse_milestone_table(body)
    assert found and [r["id"] for r in rows] == ["V1", "V2"]
    assert any("V3 range" in u for u in unparsed)  # a range is listed, not truncated
    assert any("stray" in u for u in unparsed)  # a dated row after the table is listed


def test_jwt_decode_failure_paths() -> None:
    import base64

    def tok(payload: bytes) -> str:
        seg = base64.urlsafe_b64encode(payload).decode().rstrip("=")
        return f"Authorization: Bearer a.{seg}.c"

    assert probe.jwt_tenant(tok(b"\xff\xfe")) is None  # not UTF-8
    assert probe.jwt_tenant(tok(b'{"tenant_id": 5}')) is None  # non-string claim
    assert probe.jwt_tenant(tok(b"{not json")) is None
    assert probe.jwt_tenant(tok(b'{"tenant_id": "x"}')) == "x"  # unpadded segment


def test_over_cap_children_mark_the_gate_census_truncated(
    tmp_path, capsys, monkeypatch
) -> None:
    hdr = _hdr(tmp_path)
    children = [
        _unit(f"c{i}", parent="prog") for i in range(probe.SCHEDULE_UNIT_CAP + 3)
    ]
    units = [_prog("prog", phases=2), *children]

    def fake_get(path):
        if path.startswith("/coord/agent-work-units?"):
            rows = units if _offset(path) == 0 else []
            return {"limit": probe.PAGE, "work_units": rows}
        if path.endswith("/citations"):
            return _delivery([1], [2])
        if path.startswith("/coord/agent-prompt-documents/"):
            return {"body": INITIATIVE}
        return {"gates": [], "total": 0}

    monkeypatch.setattr(
        probe, "make_getter", lambda b, h: (fake_get, hdr.read_text().strip())
    )
    assert probe.main(["--tenant", "t", "--header-file", str(hdr)]) == 0
    gates = json.loads(capsys.readouterr().out)["gates"]
    assert gates["truncated"] is True and gates["units_not_read_over_cap"] == 4


def test_malformed_unit_payload_is_unknown_exit_3(
    tmp_path, capsys, monkeypatch
) -> None:
    hdr = _hdr(tmp_path)
    monkeypatch.setattr(
        probe,
        "make_getter",
        lambda b, h: (
            lambda path: {"limit": 200, "work_units": [{"metadata": None}, "x"]},
            hdr.read_text().strip(),
        ),
    )
    assert probe.main(["--tenant", "t", "--header-file", str(hdr)]) == 3
    assert capsys.readouterr().out.strip() == "UNKNOWN"


def _serve(handler_cls):
    import http.server
    import threading

    srv = http.server.HTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_real_getter_sends_the_bearer_refuses_redirects_and_never_echoes_it(
    tmp_path,
) -> None:
    import http.server

    seen: list[tuple[str, str | None]] = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append((self.path, self.headers.get("Authorization")))
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/elsewhere")
                self.end_headers()
                return
            body = b"not json" if self.path == "/bad" else b'{"ok": true}'
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = _serve(H)
    try:
        hdr = _hdr(tmp_path, secret="SECRETSIG")
        get, _ = probe.make_getter(f"http://127.0.0.1:{srv.server_port}", str(hdr))
        assert get("/fine") == {"ok": True}
        assert (
            seen[0][1]
            and seen[0][1].startswith("Bearer aaa.")
            and "SECRETSIG" in seen[0][1]
        )
        with pytest.raises(probe.Unknown) as redirect:
            get("/redirect")
        assert all(
            path != "/elsewhere" for path, _ in seen
        )  # the redirect was not followed
        with pytest.raises(probe.Unknown) as bad_json:
            get("/bad")
        for err in (redirect.value, bad_json.value):
            assert "SECRETSIG" not in str(err)
    finally:
        srv.shutdown()


def test_gate_rows_of_another_work_unit_are_unknown() -> None:
    page = {"gates": [{"work_unit_slug": "other"}], "total": 1}
    with pytest.raises(probe.Unknown, match="another work unit"):
        probe.read_gates(lambda path: page, ["u"])


def test_missing_frontmatter_is_reported_not_null_dates() -> None:
    c = probe.build_census([_unit("a")], 1, None, "# no frontmatter", None, None)
    assert c["initiative"]["frontmatter_found"] is False
