"""Reading the Project Overview's schedule out of coord (plan
``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` Phase 2).

Two halves, kept apart so the rules can be tested without a network:

* **Doors** — :class:`CoordScheduleSource` and its two implementations. A
  person reaches coord's operator routes through the existing bearer proxy
  (:class:`OperatorSource`); a device reaches the ``/coord/agent-*`` read doors
  with its own bearer (:class:`DeviceSource`). Never one door with the other's
  credential (plan D1).
* **Rules** — the D2 mapping as pure functions: initiative frontmatter and
  milestone table parsing, declared phases, the phase-state truth table, the D3
  gate filter and the D7 tenant check.

The device bearer's reach is a CLOSED list, :data:`DEVICE_READ_DOORS`: the
three read doors this module sends it to. ``tests/test_overview_schedule.py``
asserts no other path is ever requested with it. This code issues only GETs; the
device document door (``/coord/agent-prompt-documents``) may record a policy read in
coord as a side effect of serving one, so "read-only" here means no write verb is
sent, not that coord keeps no trace.

``parse_milestone_table`` is a port of the Phase 1 probe's parser
(``backend/scripts/probe_overview_schedule.py``); a parity test runs both over
the same fixtures so the two cannot drift.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException

from app.api.v1.endpoints.operations import _proxy_coord_get
from app.overview.intent_documents import split_frontmatter

logger = structlog.get_logger(__name__)

#: The initiative document a tenant's schedule is declared in (the probe's default).
DEFAULT_INITIATIVE = ("initiative", "current-initiative")

#: Page size and bounds (plan D8, Phase 1 correction 2).
UNIT_PAGE = 200
MAX_UNIT_PAGES = 5
GATE_PAGE = 100
MAX_GATE_PAGES = 10
#: Units whose gates (and direct reads) are fetched, and the concurrency (D8).
SCHEDULE_UNIT_CAP = 12
READ_CONCURRENCY = 4
DECISION_RECORD_CAP = 5

# D3: an overview gate records a person's decision. A constant on purpose: a new
# predicate kind is a visible decision, never a silent inclusion.
OVERVIEW_GATE_PREDICATE_KINDS = frozenset({"operator_approval"})
EXCLUDED_GATE_CLASSES = frozenset({"ops-confirm", "security-surface"})
#: Every predicate kind the Phase 1 census saw, plus the ones coord's registry
#: names. A kind outside this set is reported (``unseen``) rather than guessed.
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

#: The ONLY coord read doors a device bearer is sent to (plan D1, amended
#: ``OverviewPrincipal.token``). Path prefixes; everything is a GET.
DEVICE_READ_DOORS: tuple[str, ...] = (
    "/coord/agent-work-units",
    "/coord/agent-gates",
    "/coord/agent-prompt-documents",
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class CoordReadError(Exception):
    """A coord read failed. ``reason`` is the D4 unknown reason it maps to."""

    def __init__(
        self, reason: Literal["coord_unreachable", "coord_denied"], detail: str
    ) -> None:
        super().__init__(detail)
        self.reason = reason


class CoordNotFound(Exception):
    """coord answered 404: the thing is not there (not the same as a failure)."""


class TenantMismatch(Exception):
    """A coord row did not prove it belongs to the active tenant (plan D7)."""


# ---------------------------------------------------------------------------
# Doors
# ---------------------------------------------------------------------------


class CoordScheduleSource(Protocol):
    """The six reads the schedule makes. Both doors return coord's JSON as-is."""

    door: Literal["operator", "device"]

    async def work_unit_page(self, limit: int, offset: int) -> dict[str, Any]: ...

    async def work_unit(self, slug: str) -> dict[str, Any]: ...

    async def delivery(self, slug: str) -> dict[str, Any]: ...

    async def gates_page(
        self, slug: str, limit: int, offset: int
    ) -> dict[str, Any]: ...

    async def document(self, kind: str, name: str) -> dict[str, Any]: ...


_SAFE_SEGMENT = re.compile(r"[A-Za-z0-9._-]+")


def _safe_segment(segment: str) -> bool:
    """A path segment that cannot climb out of the door it is appended to."""
    return segment not in (".", "..") and _SAFE_SEGMENT.fullmatch(segment) is not None


def _q(segment: str) -> str:
    """A data-derived value as ONE path segment. Anything outside
    ``[A-Za-z0-9._-]+``, and ``.`` / ``..``, is refused as a unit coord does not
    hold (:class:`CoordNotFound`), so a hostile slug cannot reach another route."""
    if not _safe_segment(segment):
        raise CoordNotFound(f"unsafe path segment {segment!r}")
    return segment


def _assert_door_path(path: str, prefixes: tuple[str, ...] | None) -> None:
    """Every segment after the door prefix is safe, and (device) the path stays
    inside the closed door list."""
    if prefixes is not None and not any(
        path == door or path.startswith(door + "/") for door in prefixes
    ):
        raise RuntimeError(f"the device bearer must not reach {path}")
    if not all(_safe_segment(seg) for seg in path.split("/")[1:]):
        raise RuntimeError(f"unsafe coord path {path!r}")


async def _guarded_get(
    path: str, *, params: dict[str, Any] | None, **kwargs: Any
) -> dict[str, Any]:
    """One coord GET, with every failure mapped to a typed error.

    A transport error, a 5xx, a non-JSON body or a payload that is not an object
    is ``coord_unreachable``; 401/403 is ``coord_denied``; 404 is
    :class:`CoordNotFound`. Never an empty result."""
    try:
        payload = await _proxy_coord_get(path, params=params, **kwargs)
    except HTTPException as exc:
        if exc.status_code == 404:
            raise CoordNotFound(path) from exc
        if exc.status_code in (401, 403):
            raise CoordReadError(
                "coord_denied", f"{path}: HTTP {exc.status_code}"
            ) from exc
        raise CoordReadError(
            "coord_unreachable", f"{path}: HTTP {exc.status_code}"
        ) from exc
    except (httpx.HTTPError, ValueError, OSError) as exc:
        raise CoordReadError(
            "coord_unreachable", f"{path}: {type(exc).__name__}"
        ) from exc
    if not isinstance(payload, dict):
        raise CoordReadError(
            "coord_unreachable", f"{path}: payload was {type(payload).__name__}"
        )
    return payload


class OperatorSource:
    """A person's door: coord's operator routes, the caller's own bearer.

    The bearer and active tenant are captured per request by
    ``capture_caller_bearer`` (called by ``get_overview_caller`` before this is
    built); ``forward_bearer=True`` puts them on the wire."""

    door: Literal["operator", "device"] = "operator"

    def __init__(self, tenant_id: UUID) -> None:
        self._tenant_id = tenant_id

    async def _get(
        self, path: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        _assert_door_path(path, None)
        return await _guarded_get(
            path, params=params, tenant_id=self._tenant_id, forward_bearer=True
        )

    async def work_unit_page(self, limit: int, offset: int) -> dict[str, Any]:
        return await self._get("/coord/work-units", {"limit": limit, "offset": offset})

    async def work_unit(self, slug: str) -> dict[str, Any]:
        return await self._get(f"/coord/work-units/{_q(slug)}")

    async def delivery(self, slug: str) -> dict[str, Any]:
        return await self._get(f"/coord/work-units/{_q(slug)}/citations")

    async def gates_page(self, slug: str, limit: int, offset: int) -> dict[str, Any]:
        return await self._get(
            "/coord/gates",
            {"work_unit_slug": slug, "limit": limit, "offset": offset},
        )

    async def document(self, kind: str, name: str) -> dict[str, Any]:
        return await self._get(f"/coord/prompt-documents/{_q(kind)}/{_q(name)}")


class DeviceSource:
    """A device's door: the three ``/coord/agent-*`` read doors, the device
    bearer in an explicit header. coord resolves the tenant from the JWT; the
    active-tenant header is deliberately not sent, and D7's row check is what
    catches a request that named another tenant."""

    door: Literal["operator", "device"] = "device"

    def __init__(self, token: str) -> None:
        self._headers = {"Authorization": f"Bearer {token}"}

    async def _get(
        self, path: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        _assert_door_path(path, DEVICE_READ_DOORS)
        return await _guarded_get(path, params=params, headers=self._headers)

    async def work_unit_page(self, limit: int, offset: int) -> dict[str, Any]:
        return await self._get(
            "/coord/agent-work-units", {"limit": limit, "offset": offset}
        )

    async def work_unit(self, slug: str) -> dict[str, Any]:
        return await self._get(f"/coord/agent-work-units/{_q(slug)}")

    async def delivery(self, slug: str) -> dict[str, Any]:
        return await self._get(f"/coord/agent-work-units/{_q(slug)}/citations")

    async def gates_page(self, slug: str, limit: int, offset: int) -> dict[str, Any]:
        return await self._get(
            "/coord/agent-gates",
            {"work_unit_slug": slug, "limit": limit, "offset": offset},
        )

    async def document(self, kind: str, name: str) -> dict[str, Any]:
        return await self._get(f"/coord/agent-prompt-documents/{_q(kind)}/{_q(name)}")


# ---------------------------------------------------------------------------
# D7 — tenant check
# ---------------------------------------------------------------------------


def assert_rows_in_tenant(
    rows: list[dict[str, Any]], tenant_id: UUID, *, what: str, require: bool = True
) -> None:
    """Refuse a row coord attributes to another tenant, or cannot attribute.

    ``require=True`` (work units, gates): a row whose ``tenant_id`` is absent or
    null is unprovable and refused too (``WorkUnitRow.tenant_id`` is an
    ``Option<Uuid>`` in coord). ``require=False`` (documents): only a row that
    names a DIFFERENT tenant is refused, since a document's tenant scoping is
    the door's. Raises :class:`TenantMismatch`."""
    expected = str(tenant_id).lower()
    for row in rows:
        raw = row.get("tenant_id")
        if raw is None:
            if require:
                raise TenantMismatch(f"{what}: a row carries no tenant_id")
            continue
        if str(raw).lower() != expected:
            raise TenantMismatch(f"{what}: a row belongs to another tenant")


# ---------------------------------------------------------------------------
# Frontmatter and milestones (D2)
# ---------------------------------------------------------------------------

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_FLOW_SPLIT = re.compile(r",(?=(?:[^\"']|\"[^\"]*\"|'[^']*')*$)")


def valid_date(text: object) -> str | None:
    """``text`` as one ISO date, else ``None`` (a range or ``~date`` is not one)."""
    if isinstance(text, dt.date):
        return text.isoformat()
    if not isinstance(text, str):
        return None
    cell = re.sub(r"[*_`]", "", text).strip()
    if not _DATE.fullmatch(cell):
        return None
    try:
        dt.date.fromisoformat(cell)
    except ValueError:
        return None
    return cell


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _split_kv(line: str) -> tuple[str, str] | None:
    match = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line.strip())
    return (match.group(1), _unquote(match.group(2))) if match else None


@dataclass
class InitiativeFacts:
    """What the initiative document declares. ``frontmatter_found`` False means
    the document carries no frontmatter block (different from an empty one)."""

    frontmatter_found: bool = False
    scalars: dict[str, str] = field(default_factory=dict)
    #: ``milestones:`` entries (flat string maps) when the key is present, else ``None``.
    milestone_entries: list[dict[str, str]] | None = None
    #: ``milestones:`` items that could not be read, verbatim.
    unparsed_entries: list[str] = field(default_factory=list)
    body: str = ""


def parse_initiative(text: str) -> InitiativeFacts:
    """Parse the initiative document's frontmatter and keep its prose.

    A deliberately small grammar: flat ``key: value`` lines, plus a
    ``milestones:`` block list whose items are flow maps (``- {id: V1, ...}``)
    or ``- key: value`` followed by indented ``key: value`` lines. Anything else
    inside the list is returned in ``unparsed_entries``, never dropped."""
    block, prose = split_frontmatter(text)
    facts = InitiativeFacts(body=prose)
    if block is None:
        return facts
    facts.frontmatter_found = True
    lines = block.splitlines()[1:]
    in_list = False
    current: dict[str, str] | None = None
    current_raw: list[str] = []

    def finish() -> None:
        nonlocal current, current_raw
        if current is not None and facts.milestone_entries is not None:
            facts.milestone_entries.append(current)
        current, current_raw = None, []

    for raw in lines:
        if raw.strip() == "---":
            break
        if not raw.strip():
            continue
        top_level = not raw[0].isspace() and not raw.lstrip().startswith("- ")
        if top_level:
            finish()
            in_list = False
            kv = _split_kv(raw)
            if kv is None:
                continue
            key, value = kv
            if key == "milestones" and value == "":
                in_list = True
                facts.milestone_entries = []
            else:
                facts.scalars[key] = value
            continue
        if not in_list:
            continue
        stripped = raw.strip()
        if stripped.startswith("- "):
            finish()
            item = stripped[2:].strip()
            if item.startswith("{") and item.endswith("}"):
                parts = [p for p in _FLOW_SPLIT.split(item[1:-1]) if p.strip()]
                parsed: dict[str, str] = {}
                ok = True
                for part in parts:
                    kv = _split_kv(part)
                    if kv is None:
                        ok = False
                        break
                    parsed[kv[0]] = kv[1]
                if ok and parsed:
                    if facts.milestone_entries is None:
                        raise ValueError("milestones list opened without a list")
                    facts.milestone_entries.append(parsed)
                else:
                    facts.unparsed_entries.append(stripped)
                continue
            kv = _split_kv(item)
            if kv is None:
                facts.unparsed_entries.append(stripped)
                continue
            current = {kv[0]: kv[1]}
            current_raw = [stripped]
        elif current is not None:
            kv = _split_kv(stripped)
            if kv is None:
                facts.unparsed_entries.append("\n".join([*current_raw, stripped]))
                current = None
            else:
                current[kv[0]] = kv[1]
                current_raw.append(stripped)
        else:
            facts.unparsed_entries.append(stripped)
    finish()
    return facts


@dataclass(frozen=True)
class MilestoneFacts:
    id: str | None
    name: str
    target_date: str
    shown_by: str = ""
    work_unit: str | None = None
    gate: str | None = None
    decision_record: str | None = None


def milestone_id(name: str) -> str | None:
    token = re.match(r"^([A-Z][A-Z0-9-]*)\b", name)
    return token.group(1) if token else None


def parse_milestone_table(body: str) -> tuple[list[MilestoneFacts], list[str], bool]:
    """Parse the ``Target date | Milestone | Shown by`` markdown table.

    Returns ``(rows, unparsed, header_found)``. A row that does not parse is
    returned in ``unparsed`` with its text, never dropped. ``header_found`` is
    False when no such table exists, which is different from an empty table.
    Same grammar as the Phase 1 probe's ``parse_milestone_table`` (a parity
    test holds the two together)."""
    rows: list[MilestoneFacts] = []
    unparsed: list[str] = []
    header_found = False
    in_table = False
    for ln in body.splitlines():
        s = ln.strip()
        if not s.startswith("|"):
            if s.startswith("#"):  # a heading ends the table; blank/prose lines do not
                in_table = False
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        low = [c.lower() for c in cells]
        if (
            len(cells) >= 2
            and low[0].startswith("target date")
            and "milestone" in low[1]
        ):
            in_table = header_found = True
            continue
        if not in_table:
            if header_found and cells and _DATE.search(cells[0]):
                unparsed.append(s)
            continue
        if any(cells) and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        date = valid_date(cells[0]) if cells else None
        if date and len(cells) >= 2 and cells[1]:
            name = re.sub(r"[*_`]", "", cells[1]).strip()
            rows.append(
                MilestoneFacts(
                    id=milestone_id(name),
                    name=name,
                    target_date=date,
                    shown_by=cells[2] if len(cells) > 2 else "",
                )
            )
        else:
            unparsed.append(s)
    return rows, unparsed, header_found


def parse_milestones(
    facts: InitiativeFacts,
) -> tuple[list[MilestoneFacts], list[str]]:
    """The initiative's milestones: the frontmatter list when present (it wins),
    else the markdown table (the tolerated legacy form). Returns the rows and the
    text of every row that could not be read."""
    unparsed = list(facts.unparsed_entries)
    if facts.milestone_entries is not None:
        rows: list[MilestoneFacts] = []
        for entry in facts.milestone_entries:
            date = valid_date(
                entry.get("date") or entry.get("target_date") or entry.get("target")
            )
            name = (entry.get("name") or "").strip()
            if date and name:
                rows.append(
                    MilestoneFacts(
                        id=entry.get("id") or milestone_id(name),
                        name=name,
                        target_date=date,
                        shown_by=entry.get("shown_by", ""),
                        work_unit=entry.get("work_unit") or None,
                        gate=entry.get("gate") or None,
                        decision_record=entry.get("decision_record") or None,
                    )
                )
            else:
                unparsed.append(", ".join(f"{k}: {v}" for k, v in entry.items()))
        return rows, unparsed
    rows_t, bad, _found = parse_milestone_table(facts.body)
    return rows_t, unparsed + bad


# ---------------------------------------------------------------------------
# Work units, phases and their state (D2)
# ---------------------------------------------------------------------------


def unit_of(payload: dict[str, Any]) -> dict[str, Any]:
    """A work-unit read answers flat or wrapped as ``{"work_unit": {...}}``."""
    inner = payload.get("work_unit")
    return inner if isinstance(inner, dict) else payload


def metadata_of(unit: dict[str, Any]) -> dict[str, Any]:
    meta = unit.get("metadata")
    return meta if isinstance(meta, dict) else {}


def find_programmes(units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Units whose metadata names an initiative document (plan D2)."""
    return [u for u in units if metadata_of(u).get("intent_initiative")]


@dataclass(frozen=True)
class DeclaredPhase:
    index: int
    name: str
    code: str
    milestone: str | None


_CODE = re.compile(r"^[A-Z][A-Z0-9-]*$")


def phase_code(index: int, name: str) -> str:
    """The name's leading token when it looks like a code (``F1``, ``M1``,
    ``CP11``), else the index (plan D2)."""
    first = name.strip().split(None, 1)[0].rstrip(":.,;") if name.strip() else ""
    return first if _CODE.fullmatch(first) else str(index)


def declared_phases(unit: dict[str, Any]) -> tuple[list[DeclaredPhase], list[str]]:
    """The programme's declared phases, in coord's order, plus the entries that
    could not be read (verbatim, never dropped)."""
    raw = metadata_of(unit).get("phases")
    phases: list[DeclaredPhase] = []
    bad: list[str] = []
    if not isinstance(raw, list):
        return phases, bad
    for entry in raw:
        index = entry.get("index") if isinstance(entry, dict) else None
        name = entry.get("name") if isinstance(entry, dict) else None
        if (
            isinstance(entry, dict)
            and isinstance(index, int)
            and not isinstance(index, bool)
            and isinstance(name, str)
            and name.strip()
        ):
            milestone = entry.get("milestone")
            phases.append(
                DeclaredPhase(
                    index=index,
                    name=name.strip(),
                    code=phase_code(index, name),
                    milestone=milestone
                    if isinstance(milestone, str) and milestone
                    else None,
                )
            )
        else:
            bad.append(str(entry))
    return phases, bad


def phase_links(
    programme: dict[str, Any], units: list[dict[str, Any]]
) -> dict[int, list[str]]:
    """``{phase index: [unit slug, ...]}`` from either link form (D2): the
    programme's ``metadata.phase_units`` and a child's ``metadata.parent`` +
    ``metadata.parent_phase``. Order-stable, duplicates removed."""
    links: dict[int, list[str]] = {}

    def add(index: object, slug: object) -> None:
        try:
            key = int(index)  # type: ignore[call-overload]
        except (TypeError, ValueError):
            return
        if isinstance(slug, str) and slug and slug not in links.setdefault(key, []):
            links[key].append(slug)

    declared = metadata_of(programme).get("phase_units")
    if isinstance(declared, dict):
        for index, slugs in declared.items():
            for slug in slugs if isinstance(slugs, list) else []:
                add(index, slug)
    prog_slug = programme.get("slug")
    for unit in units:
        meta = metadata_of(unit)
        if meta.get("parent") == prog_slug and meta.get("parent_phase") is not None:
            add(meta["parent_phase"], unit.get("slug"))
    return links


def parse_instant(value: object) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.UTC)


@dataclass(frozen=True)
class UnitFacts:
    """What the schedule reads off one work unit."""

    slug: str
    status: str | None
    status_class: str | None
    first_in_progress_at: dt.datetime | None
    first_shipped_at: dt.datetime | None
    last_shipped_retracted_at: dt.datetime | None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> UnitFacts:
        status = row.get("status")
        klass = row.get("status_class")
        return cls(
            slug=str(row.get("slug") or ""),
            status=status if isinstance(status, str) else None,
            status_class=klass if isinstance(klass, str) else None,
            first_in_progress_at=parse_instant(row.get("first_in_progress_at")),
            first_shipped_at=parse_instant(row.get("first_shipped_at")),
            last_shipped_retracted_at=parse_instant(
                row.get("last_shipped_retracted_at")
            ),
        )

    @property
    def shipped(self) -> bool:
        """``shipped`` as coord's DERIVED status class, not the string alone: an
        off-vocabulary or unclassified ``shipped`` is not a ship."""
        return self.status == "shipped" and self.status_class == "derived"

    @property
    def started(self) -> bool:
        return (
            self.status == "in_progress"
            or self.first_in_progress_at is not None
            or self.shipped
        )

    @property
    def retracted(self) -> bool:
        if self.last_shipped_retracted_at is None:
            return False
        return (
            self.first_shipped_at is None
            or self.last_shipped_retracted_at > self.first_shipped_at
        )


@dataclass(frozen=True)
class AttestationFact:
    """One row of coord's ``phases_attested_detail``: who attested a phase, when,
    and what that attestation reads as now (``resolved`` is the only value that
    counts; ``retracted`` stays readable as retracted)."""

    attested_at: dt.datetime | None
    attested_by: str | None
    resolution: str


@dataclass(frozen=True)
class DeliveryFacts:
    """The programme's delivery axis: a floor, not a ceiling (D2)."""

    delivered: frozenset[int]
    attested: frozenset[int]
    complete_scope: bool
    evidence_complete: bool | None
    #: Attestation rows by phase index. ``None`` means coord served NO
    #: ``phases_attested_detail`` at all (an older coord): who and when are then
    #: unknown, which is not the same as an empty mapping ("no attestations").
    attestations: dict[int, tuple[AttestationFact, ...]] | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> DeliveryFacts:
        d = payload.get("delivery")
        d = d if isinstance(d, dict) else payload

        def ints(key: str) -> frozenset[int]:
            raw = d.get(key)
            return (
                frozenset(i for i in raw if isinstance(i, int))
                if isinstance(raw, list)
                else frozenset()
            )

        ec = d.get("evidence_complete")
        return cls(
            delivered=ints("phases_delivered"),
            attested=ints("phases_attested"),
            complete_scope=d.get("phases_complete_scope") is True,
            evidence_complete=ec if isinstance(ec, bool) else None,
            attestations=_attestation_detail(d.get("phases_attested_detail")),
        )

    def is_done(self, index: int) -> bool:
        return self.complete_scope or index in self.delivered or index in self.attested

    def attested_end(self, index: int) -> tuple[dt.datetime | None, str | None]:
        """``(confirmed_at, reason)`` for a phase's attestation(s).

        The date is when a person recorded the attestation ("Confirmed done
        on"), never when the work finished. ``reason`` explains an absent date:
        ``attestation_retracted`` (the only attestations are retracted),
        ``not_recorded`` (coord serves no detail, or none with a time) or
        ``None`` when there is no attestation to speak of."""
        if self.attestations is None:
            return None, "not_recorded" if index in self.attested else None
        rows = self.attestations.get(index, ())
        live = [r for r in rows if r.resolution == "resolved"]
        if live:
            times = [r.attested_at for r in live if r.attested_at is not None]
            return (max(times), None) if times else (None, "not_recorded")
        if any(r.resolution == "retracted" for r in rows):
            return None, "attestation_retracted"
        return None, None


def _attestation_detail(
    raw: object,
) -> dict[int, tuple[AttestationFact, ...]] | None:
    """Parse ``phases_attested_detail``; ``None`` when the key is absent or not a
    list, so a coord that predates it is never read as "no attestations"."""
    if not isinstance(raw, list):
        return None
    by_phase: dict[int, list[AttestationFact]] = {}
    for row in raw:
        if not isinstance(row, dict):
            continue
        idx = row.get("phase_index")
        if not isinstance(idx, int) or isinstance(idx, bool):
            continue
        by = row.get("attested_by")
        by_phase.setdefault(idx, []).append(
            AttestationFact(
                attested_at=parse_instant(row.get("attested_at")),
                attested_by=by if isinstance(by, str) and by else None,
                resolution=str(row.get("resolution") or ""),
            )
        )
    return {i: tuple(rows) for i, rows in by_phase.items()}


PhaseStateValue = Literal["planned", "in_progress", "done", "not_confirmed"]


@dataclass(frozen=True)
class PhaseOutcome:
    """``state`` and the dates a phase derives, with the reason a date is absent."""

    state: PhaseStateValue
    actual_start: dt.datetime | None
    actual_end: dt.datetime | None
    start_reason: str | None
    end_reason: str | None
    #: What ``actual_end`` is the date of: ``shipped`` (a linked unit's first
    #: shipped time) or ``attested`` (when a person confirmed the phase done,
    #: never when the work finished). ``None`` when there is no end.
    end_basis: Literal["shipped", "attested"] | None = None


def phase_state(
    index: int,
    linked: list[UnitFacts] | None,
    delivery: DeliveryFacts | None,
) -> PhaseOutcome:
    """The D2 truth table for one phase.

    ``linked`` is the facts of every unit linked to the phase (``None`` or empty:
    unlinked). With links: **done** iff every linked unit is shipped,
    **in progress** iff any is started and not all are shipped, else **planned**.
    Without: **done** iff the delivery axis says so; otherwise ``not_confirmed``,
    never ``planned`` (``phases_remaining`` is a floor, so "not done" is not
    knowable from it). ``delivery`` of ``None`` with no links reads
    ``not_confirmed`` too; the caller marks the Resolved unknown when the read
    itself failed.

    Dates: start is the earliest ``first_in_progress_at`` over linked units; end
    is the latest ``first_shipped_at``, only for a done phase whose every linked
    unit has one, and unknown (``ship_retracted``) when any linked unit's ship
    was later retracted. A null is "not recorded", never ``created_at``."""
    units = list(linked or [])
    if not units:
        if delivery is not None and delivery.is_done(index):
            # An attestation dates the end only when it is the SOLE evidence the
            # phase is done: beside a landed PR (or a complete delivery scope) it
            # is redundant, and the PR is the stronger evidence, whose end this
            # read does not have ("not recorded"). A retracted attestation says
            # nothing then, because the phase is still done on the other evidence.
            attestation_only = (
                index in delivery.attested
                and index not in delivery.delivered
                and not delivery.complete_scope
            )
            confirmed_at, why = (
                delivery.attested_end(index) if attestation_only else (None, None)
            )
            if confirmed_at is not None:
                return PhaseOutcome(
                    "done", None, confirmed_at, "not_declared", None, "attested"
                )
            return PhaseOutcome(
                "done", None, None, "not_declared", why or "not_recorded"
            )
        # Not done by anything coord holds. A RETRACTED attestation is the one
        # thing worth saying about the end: it was once confirmed, and is not now.
        _, why = delivery.attested_end(index) if delivery is not None else (None, None)
        return PhaseOutcome(
            "not_confirmed",
            None,
            None,
            "not_declared",
            "attestation_retracted"
            if why == "attestation_retracted"
            else "not_declared",
        )
    done = all(u.shipped for u in units)
    started = any(u.started for u in units)
    state: PhaseStateValue = "done" if done else "in_progress" if started else "planned"
    starts = [u.first_in_progress_at for u in units if u.first_in_progress_at]
    start = min(starts) if starts else None
    end: dt.datetime | None = None
    end_reason: str | None = "not_declared"
    if done:
        if any(u.retracted for u in units):
            end_reason = "ship_retracted"
        elif all(u.first_shipped_at for u in units):
            end = max(u.first_shipped_at for u in units if u.first_shipped_at)
            end_reason = None
        else:
            end_reason = "not_recorded"
    return PhaseOutcome(
        state,
        start,
        end,
        None if start else "not_recorded",
        end_reason,
        "shipped" if end is not None else None,
    )


# ---------------------------------------------------------------------------
# Gates (D3)
# ---------------------------------------------------------------------------


def predicate_kind(gate: dict[str, Any]) -> str | None:
    """The REST agent door nests it (``predicate.kind``); the MCP list flattens it."""
    nested = gate.get("predicate")
    if isinstance(nested, dict) and nested.get("kind"):
        return str(nested["kind"])
    flat = gate.get("predicate_kind")
    return str(flat) if flat else None


def _gate_id(gate: dict[str, Any]) -> str | None:
    raw = gate.get("gate_id") or gate.get("id")
    return str(raw) if raw else None


@dataclass(frozen=True)
class GateClassification:
    shown: list[dict[str, Any]]
    #: Gates that are execution plumbing (or whose kind is not allowlisted).
    other: int
    withdrawn: int
    #: Predicate kinds outside :data:`KNOWN_PREDICATE_KINDS`, sorted.
    unseen_kinds: list[str]


def classify_gates(gates: list[dict[str, Any]]) -> GateClassification:
    """Apply the D3 filter. A shown gate records a person's decision:
    ``operator_approval``, or ``gate_cleared`` anchored on such a gate; class is
    neither ``ops-confirm`` nor ``security-surface``. ``withdrawn`` is not a
    decision (counted apart); a ``misconfigured`` verdict is not guessed at and
    joins the not-shown count; so does any kind outside the allowlist."""
    decision_ids = {
        _gate_id(g)
        for g in gates
        if predicate_kind(g) in OVERVIEW_GATE_PREDICATE_KINDS
        and g.get("gate_class") not in EXCLUDED_GATE_CLASSES
    }
    shown: list[dict[str, Any]] = []
    other = 0
    withdrawn = 0
    unseen: set[str] = set()
    for gate in gates:
        kind = predicate_kind(gate)
        if kind is not None and kind not in KNOWN_PREDICATE_KINDS:
            unseen.add(kind)
        qualifies = kind in OVERVIEW_GATE_PREDICATE_KINDS or (
            kind == "gate_cleared"
            and str((gate.get("predicate") or {}).get("gate_id")) in decision_ids
        )
        if not qualifies or gate.get("gate_class") in EXCLUDED_GATE_CLASSES:
            other += 1
        elif gate.get("verdict") == "withdrawn":
            withdrawn += 1
        elif gate.get("verdict") in ("open", "cleared", "failed"):
            shown.append(gate)
        else:
            other += 1
    return GateClassification(shown, other, withdrawn, sorted(unseen))


GATE_VERDICTS: dict[str, Literal["pending", "passed", "failed"]] = {
    "open": "pending",
    "cleared": "passed",
    "failed": "failed",
}
