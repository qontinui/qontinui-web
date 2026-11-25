#!/usr/bin/env python3
"""Read-only census of the coord data the Project Overview schedule would derive from.

Phase 1 of plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord``.
It reads coord's device-authed ``/coord/agent-*`` doors for ONE tenant and prints:

* the programme work unit (0 / 1 / many), its declared phases and each phase's
  delivered / attested / remaining state, and ``evidence_complete``;
* units that link themselves to a parent (``metadata.parent``) or carry
  ``metadata.phase_units``;
* the initiative document's ``starts`` / ``ends`` and the milestone rows it parses
  (rows that do not parse are listed, never dropped);
* a gate census by predicate kind x gate class x clearance audience x verdict, and
  how many gates would pass the D3 "a person's decision" filter.

It only reads. The credential comes from a 0600 header file (``curl -H @file``
shape, never argv). Any failed or truncated read prints ``UNKNOWN`` and exits 3;
an empty census is never printed in place of a failed read. ``--tenant`` must equal
the ``tenant_id`` claim of the credential, otherwise it exits 2 without reading.

Exit codes: 0 census printed, 2 tenant refusal / usage, 3 UNKNOWN.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from typing import Any

DEFAULT_BASE = "https://coord.qontinui.io"
PAGE = 200
SCHEDULE_UNIT_CAP = 12  # plan D8: gate reads per schedule unit are capped

# D3: an overview gate records a person's decision. A constant on purpose: a new
# predicate kind is a visible decision, never a silent inclusion.
OVERVIEW_GATE_PREDICATE_KINDS = frozenset({"operator_approval"})
EXCLUDED_GATE_CLASSES = frozenset({"ops-confirm", "security-surface"})
KNOWN_PREDICATE_KINDS = frozenset(
    {
        "pr_merged",
        "ci_green",
        "branch_reapable",
        "time_elapsed",
        "claim_terminal",
        "operator_approval",
        "unit_ready",
        "unit_status",
        "gate_cleared",
        "commit_live",
        "deploy_healthy",
        "pr_ci_green",
        "pr_ci_red",
        "pr_conflicting",
        "ref_exists",
        "metric_threshold",
        "migration_at_head",
        "infra_drift_clear",
        "file_exists",
        "content_matches",
        "sql_count",
        "release_in_sync",
        "runner_served_sha",
        "alert_open",
        "schema_object_exists",
        "pr_head_first_verdict",
        "question_answered",
    }
)


class Unknown(Exception):
    """A read could not be made or was truncated: the census must say UNKNOWN."""


# ---------------------------------------------------------------- pure parsers


def parse_flat_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Return (flat key: value frontmatter, body). No frontmatter -> ({}, text)."""
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            fm: dict[str, str] = {}
            for ln in lines[1:i]:
                m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", ln)
                if m:
                    fm[m.group(1)] = m.group(2).strip().strip("\"'")
            return fm, "\n".join(lines[i + 1 :])
    return {}, text


_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_milestone_table(body: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Parse the ``Target date | Milestone | Shown by`` markdown table.

    Returns (rows, unparsed). A row that does not parse is returned in ``unparsed``
    with its text so it can be shown, never dropped.
    """
    rows: list[dict[str, Any]] = []
    unparsed: list[str] = []
    in_table = False
    for ln in body.splitlines():
        s = ln.strip()
        if not s.startswith("|"):
            if in_table and rows + unparsed:  # table ended after at least one row
                in_table = False
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        low = [c.lower() for c in cells]
        if (
            len(cells) >= 2
            and low[0].startswith("target date")
            and "milestone" in low[1]
        ):
            in_table = True
            continue
        if not in_table:
            continue
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        m = _DATE.search(cells[0]) if cells else None
        if m and len(cells) >= 2 and cells[1]:
            name = re.sub(r"[*_`]", "", cells[1]).strip()
            tok = re.match(r"^([A-Z][A-Z0-9-]*)\b", name)
            rows.append(
                {
                    "date": m.group(0),
                    "name": name,
                    "id": tok.group(1) if tok else None,
                    "shown_by": cells[2] if len(cells) > 2 else "",
                }
            )
        else:
            unparsed.append(s)
    return rows, unparsed


def declared_phases(unit: dict[str, Any]) -> list[dict[str, Any]]:
    phases = (unit.get("metadata") or {}).get("phases")
    return (
        [p for p in phases if isinstance(p, dict)] if isinstance(phases, list) else []
    )


def find_programmes(units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Units whose metadata names an initiative document (plan D2)."""
    return [u for u in units if (u.get("metadata") or {}).get("intent_initiative")]


def phase_state_rows(
    detail: dict[str, Any], phases: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Per declared phase: delivered / attested / remaining, straight off the delivery view."""
    d = detail.get("delivery") or detail
    delivered = set(d.get("phases_delivered") or [])
    attested = set(d.get("phases_attested") or [])
    remaining = d.get("phases_remaining")
    remaining_set = set(remaining) if isinstance(remaining, list) else None
    out = []
    for p in phases:
        idx = p.get("index")
        if idx in delivered or d.get("phases_complete_scope") is True:
            state = "delivered"
        elif idx in attested:
            state = "attested"
        elif remaining_set is not None and idx in remaining_set:
            state = "remaining"
        else:
            state = "unknown"
        out.append({"index": idx, "name": p.get("name"), "state": state})
    return out


def link_census(
    units: list[dict[str, Any]], programme_slug: str | None
) -> dict[str, Any]:
    child_of_programme = [
        u["slug"]
        for u in units
        if (u.get("metadata") or {}).get("parent") == programme_slug
    ]
    any_parent = [u["slug"] for u in units if (u.get("metadata") or {}).get("parent")]
    with_parent_phase = [
        u["slug"] for u in units if (u.get("metadata") or {}).get("parent_phase")
    ]
    return {
        "units_with_parent": len(any_parent),
        "children_of_programme": child_of_programme,
        "units_with_parent_phase": len(with_parent_phase),
        "programme_has_phase_units": bool(
            programme_slug
            and any(
                (u.get("metadata") or {}).get("phase_units")
                for u in units
                if u.get("slug") == programme_slug
            )
        ),
    }


def predicate_kind(g: dict[str, Any]) -> str | None:
    """The REST agent door nests it (``predicate.kind``); the MCP list flattens it."""
    nested = g.get("predicate")
    if isinstance(nested, dict) and nested.get("kind"):
        return str(nested["kind"])
    flat = g.get("predicate_kind")
    return str(flat) if flat else None


def gate_passes_d3(g: dict[str, Any]) -> bool:
    kind = predicate_kind(g)
    if kind not in OVERVIEW_GATE_PREDICATE_KINDS:
        return False
    if g.get("gate_class") in EXCLUDED_GATE_CLASSES:
        return False
    return g.get("verdict") != "withdrawn"


def gate_census(
    gates: list[dict[str, Any]], total_expected: int | None = None
) -> dict[str, Any]:
    cells: Counter[str] = Counter()
    kinds: Counter[str] = Counter()
    for g in gates:
        kinds[str(predicate_kind(g))] += 1
        cells[
            "|".join(
                [str(predicate_kind(g))]
                + [
                    str(g.get(k))
                    for k in ("gate_class", "clearance_audience", "verdict")
                ]
            )
        ] += 1
    return {
        "gates_read": len(gates),
        "gates_total": total_expected if total_expected is not None else len(gates),
        "truncated": total_expected is not None and total_expected > len(gates),
        "by_predicate_kind": dict(sorted(kinds.items())),
        "unseen_predicate_kinds": sorted(
            k for k in kinds if k not in KNOWN_PREDICATE_KINDS
        ),
        "kind_class_audience_verdict": dict(sorted(cells.items())),
        "passing_d3_filter": sum(1 for g in gates if gate_passes_d3(g)),
    }


def build_census(
    units: list[dict[str, Any]],
    units_total: int,
    programme_detail: dict[str, Any] | None,
    initiative_text: str | None,
    gates: list[dict[str, Any]],
    gates_total: int | None,
) -> dict[str, Any]:
    if len(units) != units_total:
        raise Unknown(
            f"work-unit list inconsistent: read {len(units)}, expected {units_total}"
        )
    programmes = find_programmes(units)
    prog_slug = programmes[0]["slug"] if len(programmes) == 1 else None
    census: dict[str, Any] = {
        "units_read": len(units),
        "programme_count": len(programmes),
        "programme_slugs": [p["slug"] for p in programmes],
    }
    if len(programmes) == 1 and programme_detail is not None:
        phases = declared_phases(programmes[0])
        d = programme_detail.get("delivery") or programme_detail
        census["programme"] = {
            "slug": prog_slug,
            "declared_phase_count": len(phases),
            "evidence_complete": d.get("evidence_complete"),
            "phases_delivered": d.get("phases_delivered"),
            "phases_remaining": d.get("phases_remaining"),
            "phases": phase_state_rows(programme_detail, phases),
        }
    census["links"] = link_census(units, prog_slug)
    if initiative_text is not None:
        fm, body = parse_flat_frontmatter(initiative_text)
        rows, unparsed = parse_milestone_table(body)
        census["initiative"] = {
            "starts": fm.get("starts"),
            "ends": fm.get("ends"),
            "milestone_rows_parsed": rows,
            "milestone_rows_unparsed": unparsed,
        }
    census["gates"] = gate_census(gates, gates_total)
    return census


# ----------------------------------------------------------------------- reads


def jwt_tenant(auth_header_line: str) -> str | None:
    m = re.search(r"Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)", auth_header_line)
    if not m:
        return None
    seg = m.group(1).split(".")[1]
    seg += "=" * (-len(seg) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(seg)).get("tenant_id")
    except Exception:
        return None


def make_getter(base: str, header_file: str, timeout: float = 45.0):
    with open(header_file, encoding="utf-8") as f:
        raw = f.read().strip()
    name, _, value = raw.partition(":")
    headers = {name.strip(): value.strip(), "Accept": "application/json"}

    def get(path: str) -> Any:
        req = urllib.request.Request(base + path, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https base
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise Unknown(f"GET {path.split('?')[0]} -> HTTP {e.code}") from e
        except Exception as e:  # network, timeout, bad JSON
            raise Unknown(f"GET {path.split('?')[0]} failed: {type(e).__name__}") from e

    return get, raw


MAX_UNIT_PAGES = 5  # plan D8: a programme scan is bounded; hitting the bound is UNKNOWN


def read_all_units(get) -> tuple[list[dict[str, Any]], int]:
    """Page the work-unit list. coord's ``count`` is the PAGE size, not a total (measured
    2026-11-25: ``count`` 200 at offsets 0, 200 and 400), so the only end-of-list signal is
    a short page. A full last page at the page bound means the scan was truncated."""
    units: list[dict[str, Any]] = []
    for page_no in range(MAX_UNIT_PAGES):
        page = get(f"/coord/agent-work-units?limit={PAGE}&offset={page_no * PAGE}")
        batch = page.get("work_units")
        if not isinstance(batch, list):
            raise Unknown("work-unit page had no work_units list")
        units.extend(batch)
        if len(batch) < PAGE:
            return units, len(units)
    raise Unknown(
        f"work-unit scan hit the {MAX_UNIT_PAGES}-page bound ({len(units)} units read): truncated"
    )


def read_gates(get, slugs: list[str]) -> tuple[list[dict[str, Any]], int]:
    gates: list[dict[str, Any]] = []
    total = 0
    for slug in slugs:
        q = urllib.parse.quote(slug, safe="")
        page = get(f"/coord/agent-gates?work_unit_slug={q}&limit=100")
        rows = page.get("gates")
        if not isinstance(rows, list):
            raise Unknown(f"gate page for {slug} had no gates list")
        gates.extend(rows)
        total += int(page.get("total", len(rows)))
    return gates, total


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--tenant", required=True, help="tenant uuid the credential must belong to"
    )
    ap.add_argument(
        "--header-file",
        required=True,
        help="0600 file holding one 'Authorization: Bearer ...' line",
    )
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--initiative", default="initiative/current-initiative")
    args = ap.parse_args(argv)
    try:
        get, raw = make_getter(args.base, args.header_file)
        claimed = jwt_tenant(raw)
        if claimed != args.tenant:
            print(
                f"REFUSED: credential tenant {claimed!r} != --tenant {args.tenant!r}; nothing read",
                file=sys.stderr,
            )
            return 2
        units, total = read_all_units(get)
        programmes = find_programmes(units)
        detail = None
        if len(programmes) == 1:
            detail = get(
                f"/coord/agent-work-units/{urllib.parse.quote(programmes[0]['slug'], safe='')}/citations"
            )
        init_text = None
        kind, _, name = args.initiative.partition("/")
        try:
            doc = get(f"/coord/agent-prompt-documents/{kind}/{name}")
            init_text = doc.get("body") or (doc.get("document") or {}).get("body")
        except Unknown as e:
            print(f"initiative document: UNKNOWN ({e})", file=sys.stderr)
        slugs = [p["slug"] for p in programmes][:SCHEDULE_UNIT_CAP]
        child_slugs = link_census(
            units, programmes[0]["slug"] if len(programmes) == 1 else None
        )["children_of_programme"]
        slugs += child_slugs[: SCHEDULE_UNIT_CAP - len(slugs)]
        gates, gates_total = read_gates(get, slugs)
        census = build_census(units, total, detail, init_text, gates, gates_total)
        census["initiative_read"] = init_text is not None
        print(json.dumps(census, indent=2, sort_keys=True))
        return 0
    except Unknown as e:
        print(f"UNKNOWN: {e}", file=sys.stderr)
        print("UNKNOWN")
        return 3


if __name__ == "__main__":
    sys.exit(main())
