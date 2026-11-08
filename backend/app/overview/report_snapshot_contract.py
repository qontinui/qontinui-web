"""The ``report-snapshot/v1`` contract: the allowlist a report snapshot passes.

Plan ``2026-11-07-interactive-stakeholder-reports-in-the-project-overview``
D4. A field renders only if this contract names it ("explicit, not implied",
the build records' D3): a snapshot is stakeholder-facing data frozen at one
moment, so what it may carry is decided here, once, and checked on every write
and again on a read whenever the rules or the tenant's confidential terms have
moved since.

The shape
=========

:class:`ReportSnapshotDoc` and its parts are Pydantic models with
``extra="forbid"`` at every level, ``strict`` (no coercion: ``"3"`` is not a
number and ``true`` is not one either), typed leaves, and a cap on every string
length and list size. Every key is REQUIRED — a null is spelled ``null``, never
defaulted — so a valid body round-trips unchanged: the document stored is the
document received, and its canonical form (:func:`canonical_bytes`: sorted
keys, compact separators, ``ensure_ascii=False``) hashes to the same
:func:`content_sha256` the publisher computes from its file. Validation reads
the document as JSON (``model_validate_json``), which is what admits ISO date
and timestamp strings without admitting any other coercion. The canonical form
is at most :data:`MAX_SNAPSHOT_BYTES`.

The cross-field rules
=====================

Each is a violation naming its slot (:func:`check_snapshot`):

* every ``cells`` key is a declared column id, every row (and summary row)
  carries a cell for EVERY declared column — a missing cell is refused, never
  an implicit null — and ids are unique within their list (tables, columns,
  rows with summary rows, figures, groups and items: a change is keyed by id,
  so a duplicate would make one ambiguous);
* a scale's ``min`` is below its ``max``, its ``target`` (when set) lies within
  it, and every cell ``value`` is within it or null;
* ``value: null`` requires an ``unknown_reason``, and a non-null value forbids
  one — for cells and figures alike;
* ``verdict: met | missed`` requires a non-null ``value``: a verdict without a
  measurement is UNKNOWN;
* ``items[].group`` names a declared group.

The link rule
=============

A link is one of exactly two forms: ``https://github.com/<owner>/<repo>/pull/<n>``
or ``…/commit/<sha>``, where ``<owner>`` is one of the tenant's first-party
owners (the presentation scope's effective owners, configured or registered);
or an in-app path beginning ``/overview/``. The FORM is checked here; the
OWNER needs the tenant's scope (:func:`foreign_link_owners`), and a write whose
owners are UNKNOWN cannot evaluate it, so the store refuses that write (503
``presentation_scope_unknown``) rather than guess.

The string scans
================

Every string is scanned (:func:`check_snapshot`), on the stripped form
:func:`~app.services.text_scan.normalize_for_scan` produces:

* a hidden, control or overlay character (newlines and tabs excepted);
* a UUID and an email-shaped identity (the build record's scanners, shared
  through :mod:`app.services.text_scan`);
* an IPv4 or IPv6 address (:data:`IPV4_RE`, :data:`IPV6_RE`);
* a 12-digit AWS account id, bare or written ``1234-5678-9012``
  (:data:`ACCOUNT_ID_RE`);
* any of the tenant's configured confidential terms, folded with the
  presentation scope's ``match_key`` — the frontend's ``normalizeForMatch`` —
  so ``NORTHWIND-mutual`` and ``Nörthwind Mutual`` are the same term
  (:class:`TermMatcher`).

A violation names the SLOT and the kind of failure, never the value; an
unlisted key is reported as ``<unlisted key>`` and a cell key that is not a
declared column as ``<undeclared>``, because a key's NAME can be the leak.

Reading a stored snapshot again
===============================

:func:`treat_for_read` serves a stored snapshot under today's rules: one stored
under another :data:`REPORT_ALLOWLIST_VERSION` is checked again and withheld
WHOLE when it no longer passes — never served half-trusted; one stored under
another allowlist version, or checked against another presentation scope
version, has its strings scanned for the current terms, and a newly matching
string is replaced by :data:`WITHHELD`; and the link rule's owner check runs on
every read, with every link withheld while the owners are UNKNOWN. A report's
own narrative is served the same way (:func:`treat_narrative`): a field naming
a current confidential term reads :data:`WITHHELD`.

Report narratives (the report's own title, summary and body) get the
confidential-term, email, IP and account-id scans at write
(:func:`narrative_violations`), and so do a snapshot's file path and a
withdrawal's reason; a UUID there is allowed, since block arguments are slugs,
not ids.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any, Final, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
)

from app.services.presentation_scope import match_key, normalize_owner
from app.services.text_scan import (
    EMAIL_RE,
    UUID_RE,
    has_hidden_characters,
    normalize_for_scan,
)

#: The one schema id this contract describes.
REPORT_SNAPSHOT_SCHEMA: Final = "report-snapshot/v1"

#: The version of THIS contract and its scanners. A snapshot stores the
#: version it was validated under; a read validates again any snapshot stored
#: under another. BUMP IT on any change to the key set, a cap, a cross-field
#: rule, the link rule, a scanner, or :mod:`app.services.text_scan`.
REPORT_ALLOWLIST_VERSION: Final = 1

#: Largest canonical form accepted (UTF-8 JSON).
MAX_SNAPSHOT_BYTES: Final = 256 * 1024

#: What a withheld string is served as: never a blank, never the value.
WITHHELD: Final = "[withheld]"

#: Longest link a snapshot may carry; the GitHub forms are far shorter.
MAX_URL: Final = 500

#: Characters a report string may carry that the hidden-character scan
#: otherwise refuses: multi-line text keeps its newlines and tabs.
_ALLOWED_CONTROLS: Final = frozenset("\n\t")

# ---------------------------------------------------------------------------
# The shape
# ---------------------------------------------------------------------------

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")]
Text24 = Annotated[str, StringConstraints(max_length=24)]
Text40 = Annotated[str, StringConstraints(max_length=40)]
Text80 = Annotated[str, StringConstraints(max_length=80)]
Text120 = Annotated[str, StringConstraints(max_length=120)]
Text160 = Annotated[str, StringConstraints(max_length=160)]
Text200 = Annotated[str, StringConstraints(max_length=200)]
Text300 = Annotated[str, StringConstraints(max_length=300)]
Text400 = Annotated[str, StringConstraints(max_length=400)]
Text600 = Annotated[str, StringConstraints(max_length=600)]
Text2000 = Annotated[str, StringConstraints(max_length=2000)]
Text4000 = Annotated[str, StringConstraints(max_length=4000)]
Label80 = Annotated[str, StringConstraints(min_length=1, max_length=80)]
Label120 = Annotated[str, StringConstraints(min_length=1, max_length=120)]
Url = Annotated[str, StringConstraints(max_length=MAX_URL)]

Better = Literal["higher", "lower"]
MethodKind = Literal["full_review", "light_check", "measured", "manual"]
Verdict = Literal["met", "missed", "unknown"]
ItemStatus = Literal["planned", "in_progress", "done", "blocked", "unknown", "dropped"]


class _Part(BaseModel):
    """Every level of the contract: no key it does not name, no coercion, no
    non-finite number."""

    model_config = ConfigDict(
        extra="forbid", strict=True, allow_inf_nan=False, frozen=True
    )


class SnapshotMethod(_Part):
    kind: MethodKind
    label: Label120
    note: Text600 | None


class SnapshotGroup(_Part):
    id: Slug
    label: Text80
    help: Text300 | None
    due: date | None


class SnapshotScale(_Part):
    min: float
    max: float
    target: float | None
    better: Better


class SnapshotColumn(_Part):
    id: Slug
    label: Text40
    help: Text300


class SnapshotCell(_Part):
    value: float | None
    unknown_reason: Text200 | None


class SnapshotRow(_Part):
    id: Slug
    label: Text80
    help: Text300 | None
    #: Keyed by column id; every key a declared column and every declared
    #: column present (a cross-field rule).
    cells: dict[str, SnapshotCell]


class SnapshotSummaryRow(_Part):
    id: Slug
    label: Text80
    cells: dict[str, SnapshotCell]


class SnapshotTable(_Part):
    id: Slug
    title: Text120
    caption: Text600
    row_header: Text40
    scale: SnapshotScale
    columns: list[SnapshotColumn] = Field(max_length=12)
    rows: list[SnapshotRow] = Field(max_length=80)
    summary_rows: list[SnapshotSummaryRow] = Field(max_length=4)


class SnapshotFigure(_Part):
    id: Slug
    label: Text80
    help: Text300
    unit: Text24
    value: float | None
    unknown_reason: Text200 | None
    baseline: float | None
    target: float | None
    better: Better
    verdict: Verdict
    source: Text160
    measured_at: AwareDatetime | None


class SnapshotEvent(_Part):
    at: date
    label: Text160


class SnapshotLink(_Part):
    label: Text80
    url: Url


class SnapshotItem(_Part):
    id: Slug
    group: Slug | None
    label: Text160
    help: Text400 | None
    status: ItemStatus
    status_note: Text300 | None
    events: list[SnapshotEvent] = Field(max_length=20)
    links: list[SnapshotLink] = Field(max_length=10)


class SnapshotNote(_Part):
    title: Text120
    #: Rendered by ``MarkdownView``, which renders no raw HTML.
    body_md: Text4000


class ReportSnapshotDoc(_Part):
    """One ``report-snapshot/v1`` document."""

    schema_: Literal["report-snapshot/v1"] = Field(alias="schema")
    label: Label80
    #: When the state was measured.
    as_of: AwareDatetime
    method: SnapshotMethod
    #: Plain language: what this stop says.
    summary: Text2000 | None
    groups: list[SnapshotGroup] = Field(max_length=24)
    tables: list[SnapshotTable] = Field(max_length=8)
    figures: list[SnapshotFigure] = Field(max_length=32)
    items: list[SnapshotItem] = Field(max_length=300)
    notes: list[SnapshotNote] = Field(max_length=10)


def _field_names(model: type[BaseModel], seen: set[str]) -> set[str]:
    """Every key the contract names, at any depth (aliases as written)."""
    names: set[str] = set()
    if model.__name__ in seen:
        return names
    seen.add(model.__name__)
    for name, info in model.model_fields.items():
        names.add(info.alias or name)
        for part in _models_in(info.annotation):
            names |= _field_names(part, seen)
    return names


def _models_in(annotation: Any) -> Iterator[type[BaseModel]]:
    """The contract models an annotation holds (``list[SnapshotGroup]`` → ``SnapshotGroup``)."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        yield annotation
        return
    for arg in getattr(annotation, "__args__", ()) or ():
        yield from _models_in(arg)


#: Every key name the contract allows, at any depth — the only words a
#: violation's slot may contain besides indices and column references.
CONTRACT_KEYS: Final[frozenset[str]] = frozenset(_field_names(ReportSnapshotDoc, set()))


def _paths(model: type[BaseModel], prefix: str) -> list[str]:
    out: list[str] = []
    for name, info in model.model_fields.items():
        key = info.alias or name
        path = f"{prefix}.{key}" if prefix else key
        out.append(path)
        annotation = info.annotation
        origin = getattr(annotation, "__origin__", None)
        inner = list(_models_in(annotation))
        if not inner:
            continue
        if origin is list:
            out.extend(_paths(inner[0], f"{path}[]"))
        elif origin is dict:
            out.extend(_paths(inner[0], f"{path}{{}}"))
        else:
            out.extend(_paths(inner[0], path))
    return out


#: Every allowed key as a dotted path — ``[]`` for a list item, ``{}`` for a
#: ``cells`` entry keyed by column id. The flat form the key-set pin test in
#: ``tests/test_overview_reports.py`` writes out by hand.
REPORT_SNAPSHOT_PATHS: Final[frozenset[str]] = frozenset(_paths(ReportSnapshotDoc, ""))

# ---------------------------------------------------------------------------
# Scanners beyond the shared ones
# ---------------------------------------------------------------------------

_OCTET = r"(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])"
#: A dotted-quad IPv4 address, not inside a longer run of digits.
IPV4_RE: Final = re.compile(rf"(?<![0-9])(?:{_OCTET}\.){{3}}{_OCTET}(?![0-9])")
_H16 = r"[0-9A-Fa-f]{1,4}"
#: An IPv6 address: eight groups, or a ``::`` compression with at least one
#: group beside it. Not inside a longer word, so ``std::vector`` and a time
#: (``12:30:45``) or a MAC address (six groups) are not addresses. A colon
#: BEFORE it is no guard: ``IPv6:2001:db8::5`` and ``IP:2001:db8::1`` are
#: addresses behind a label.
IPV6_RE: Final = re.compile(
    r"(?<![0-9A-Za-z.])"
    rf"(?:(?:{_H16}:){{7}}{_H16}"
    rf"|(?:{_H16}:){{1,7}}:(?:{_H16}(?::{_H16}){{0,5}})?"
    rf"|::{_H16}(?::{_H16}){{0,6}})"
    r"(?![0-9A-Za-z:])"
)
#: A 12-digit AWS account id, bare or as the console writes it
#: (``1234-5678-9012``), each form with its own guards. The bare form is not
#: inside a longer word or run of digits, but a dash beside it is no guard:
#: account ids sit between dashes in bucket names
#: (``cdk-hnb659fds-assets-123456789012-us-east-1``). The dashed form is not
#: inside a longer dash-joined run, so ``1234-5678-9012-3456`` is not one.
ACCOUNT_ID_RE: Final = re.compile(
    r"(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])"
    r"|(?<![0-9A-Za-z-])[0-9]{4}-[0-9]{4}-[0-9]{4}(?![0-9A-Za-z-])"
)


class TermMatcher:
    """The tenant's confidential terms, matched the way the presentation lens
    matches them: each term and each string folded by
    :func:`~app.services.presentation_scope.match_key` (accents dropped,
    lowercased, everything but letters and digits removed), then a substring
    test. Both are ALSO folded from their stripped scan form, so a Cyrillic
    lookalike or an invisible character cannot hide a term either."""

    def __init__(self, terms: Iterable[str]) -> None:
        needles: set[str] = set()
        for term in terms:
            for form in (term, normalize_for_scan(term)):
                key = match_key(form)
                if key:
                    needles.add(key)
        self._pattern: re.Pattern[str] | None = (
            re.compile(
                "|".join(re.escape(n) for n in sorted(needles, key=len, reverse=True))
            )
            if needles
            else None
        )

    @property
    def active(self) -> bool:
        """Whether there is any term to match (a tenant with none matches
        nothing, and a read need not scan at all)."""
        return self._pattern is not None

    def matches(self, text: str, normalized: str | None = None) -> bool:
        if self._pattern is None:
            return False
        stripped = normalize_for_scan(text) if normalized is None else normalized
        return any(
            self._pattern.search(match_key(form)) is not None
            for form in (text, stripped)
        )


def contains_ip_address(normalized: str) -> bool:
    return (
        IPV4_RE.search(normalized) is not None or IPV6_RE.search(normalized) is not None
    )


# ---------------------------------------------------------------------------
# The link rule
# ---------------------------------------------------------------------------

_GITHUB_LINK = re.compile(
    r"https://github\.com/"
    r"(?P<owner>[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})/"
    r"(?P<repo>[A-Za-z0-9._-]{1,100})/"
    r"(?:pull/[1-9][0-9]{0,9}|commit/[0-9a-f]{7,64})"
)
_SEGMENT = r"[A-Za-z0-9_~-][A-Za-z0-9._~-]*"
_IN_APP_LINK = re.compile(
    rf"/overview/(?:{_SEGMENT}(?:/{_SEGMENT})*/?)?"
    r"(?:\?[A-Za-z0-9._~=&+-]*)?"
    r"(?:#[A-Za-z0-9._~-]*)?"
)


def github_link_owner(url: str) -> str | None:
    """The owner a GitHub pull-request or commit link names (lowercased), or
    ``None`` when ``url`` is not one of those two forms."""
    match = _GITHUB_LINK.fullmatch(url)
    if match is None or match.group("repo") in (".", ".."):
        return None
    return normalize_owner(match.group("owner"))


def is_in_app_link(url: str) -> bool:
    return _IN_APP_LINK.fullmatch(url) is not None


def _link_slots(data: dict[str, Any]) -> Iterator[tuple[str, int, int, str]]:
    """``(slot, item index, link index, url)`` for every link."""
    for i, item in enumerate(data.get("items") or []):
        for k, link in enumerate(item.get("links") or []):
            yield f"items[{i}].links[{k}].url", i, k, link["url"]


def github_links(data: dict[str, Any]) -> list[tuple[str, str]]:
    """``(slot, owner)`` for every GitHub link in a validated document — the
    links whose owner only the tenant's scope can vouch for."""
    out: list[tuple[str, str]] = []
    for slot, _i, _k, url in _link_slots(data):
        owner = github_link_owner(url)
        if owner is not None:
            out.append((slot, owner))
    return out


def foreign_link_owners(
    data: dict[str, Any], owners: frozenset[str]
) -> list[Violation]:
    """A violation for every GitHub link whose owner is not first-party."""
    return [
        Violation(slot, "link_owner_not_first_party")
        for slot, owner in github_links(data)
        if owner not in owners
    ]


# ---------------------------------------------------------------------------
# Violations and slots
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Violation:
    """One way a document breaks the contract: WHERE (the slot) and WHAT
    rule — never the value."""

    slot: str
    kind: str

    def as_dict(self) -> dict[str, str]:
        return {"slot": self.slot, "kind": self.kind}


def _declared_columns(data: Any, table_index: int) -> list[Any]:
    """Column ids of ``tables[table_index]`` in a possibly malformed document."""
    try:
        columns = data["tables"][table_index]["columns"]
    except (KeyError, IndexError, TypeError):
        return []
    if not isinstance(columns, list):
        return []
    return [c.get("id") for c in columns if isinstance(c, dict)]


def column_ref(columns: Sequence[Any], key: Any) -> str:
    """How a slot names the cell for ``key``: by the declared column's index
    (``columns[2]``), never by the key a writer chose."""
    for index, column_id in enumerate(columns):
        if column_id == key:
            return f"columns[{index}]"
    return "<undeclared>"


def _slot_of(loc: Sequence[Any], data: Any, *, unlisted_last: bool) -> str:
    """A Pydantic error location as a slot, naming only contract keys,
    indices and column references."""
    out = ""
    table_index: int | None = None
    previous: Any = None
    for position, part in enumerate(loc):
        last = position == len(loc) - 1
        if isinstance(part, int):
            out += f"[{part}]"
            if previous == "tables":
                table_index = part
        elif previous == "cells":
            columns = (
                _declared_columns(data, table_index) if table_index is not None else []
            )
            out += f"[{column_ref(columns, part)}]"
        elif (last and unlisted_last) or part not in CONTRACT_KEYS:
            out += f"{'.' if out else ''}<unlisted key>"
        else:
            out += f"{'.' if out else ''}{part}"
        previous = part
    return out or "<root>"


def _structure(data: Any) -> tuple[ReportSnapshotDoc | None, list[Violation]]:
    """The document against the shape: every key, type and cap."""
    if not isinstance(data, dict):
        return None, [Violation("<root>", "not_an_object")]
    try:
        # As JSON: a lone surrogate becomes an escape the parser refuses, a
        # non-finite number reaches the finite check at its own slot, and
        # dates and timestamps arrive as the strings strict JSON mode admits.
        text = json.dumps(data, ensure_ascii=True)
    except (TypeError, ValueError, RecursionError):
        return None, [Violation("<root>", "not_json")]
    try:
        return ReportSnapshotDoc.model_validate_json(text, strict=True), []
    except ValidationError as exc:
        violations: list[Violation] = []
        for error in exc.errors():
            extra = error["type"] == "extra_forbidden"
            violations.append(
                Violation(
                    _slot_of(error["loc"], data, unlisted_last=extra),
                    "unlisted_key" if extra else str(error["type"]),
                )
            )
        return None, violations


def _unique(items: Iterable[Any], slot: str, out: list[Violation]) -> None:
    seen: set[str] = set()
    for index, item in enumerate(items):
        if item.id in seen:
            out.append(Violation(f"{slot}[{index}].id", "duplicate_id"))
        seen.add(item.id)


def _check_value(
    cell: SnapshotCell | SnapshotFigure, slot: str, out: list[Violation]
) -> None:
    has_reason = cell.unknown_reason is not None and bool(cell.unknown_reason.strip())
    if cell.value is None and not has_reason:
        out.append(Violation(f"{slot}.unknown_reason", "unknown_reason_required"))
    if cell.value is not None and cell.unknown_reason is not None:
        out.append(Violation(f"{slot}.unknown_reason", "unknown_reason_forbidden"))


def _cross_field(doc: ReportSnapshotDoc) -> list[Violation]:
    out: list[Violation] = []
    _unique(doc.groups, "groups", out)
    _unique(doc.tables, "tables", out)
    _unique(doc.figures, "figures", out)
    _unique(doc.items, "items", out)
    for t, table in enumerate(doc.tables):
        slot = f"tables[{t}]"
        scale = table.scale
        scale_ok = scale.min < scale.max
        if not scale_ok:
            out.append(Violation(f"{slot}.scale", "scale_inverted"))
        elif scale.target is not None and not scale.min <= scale.target <= scale.max:
            out.append(Violation(f"{slot}.scale.target", "target_out_of_scale"))
        _unique(table.columns, f"{slot}.columns", out)
        columns = [c.id for c in table.columns]
        seen_rows: set[str] = set()
        every_row: list[tuple[str, int, SnapshotRow | SnapshotSummaryRow]] = [
            *(("rows", r, row) for r, row in enumerate(table.rows)),
            *(("summary_rows", r, row) for r, row in enumerate(table.summary_rows)),
        ]
        for kind, r, row in every_row:
            row_slot = f"{slot}.{kind}[{r}]"
            if row.id in seen_rows:
                out.append(Violation(f"{row_slot}.id", "duplicate_id"))
            seen_rows.add(row.id)
            for key in row.cells:
                if key not in columns:
                    out.append(
                        Violation(
                            f"{row_slot}.cells[<undeclared>]", "undeclared_column"
                        )
                    )
            for index, column_id in enumerate(columns):
                cell_slot = f"{row_slot}.cells[columns[{index}]]"
                cell = row.cells.get(column_id)
                if cell is None:
                    out.append(Violation(cell_slot, "missing_cell"))
                    continue
                _check_value(cell, cell_slot, out)
                if (
                    scale_ok
                    and cell.value is not None
                    and not scale.min <= cell.value <= scale.max
                ):
                    out.append(Violation(f"{cell_slot}.value", "out_of_scale"))
    for f, figure in enumerate(doc.figures):
        slot = f"figures[{f}]"
        _check_value(figure, slot, out)
        if figure.verdict in ("met", "missed") and figure.value is None:
            out.append(Violation(f"{slot}.verdict", "verdict_needs_value"))
    groups = {g.id for g in doc.groups}
    for i, item in enumerate(doc.items):
        if item.group is not None and item.group not in groups:
            out.append(Violation(f"items[{i}].group", "undeclared_group"))
        for k, link in enumerate(item.links):
            if github_link_owner(link.url) is None and not is_in_app_link(link.url):
                out.append(Violation(f"items[{i}].links[{k}].url", "link_not_allowed"))
    return out


# ---------------------------------------------------------------------------
# Strings
# ---------------------------------------------------------------------------


def iter_strings(data: dict[str, Any]) -> Iterator[tuple[str, Any, Any]]:
    """``(slot, container, key)`` for every string in a validated document
    except the fixed ``schema`` literal — so a caller can read
    ``container[key]`` or replace it. A cell is named by its column's index."""
    for key, value in data.items():
        if key == "schema":
            continue
        yield from _strings_at(value, key, data, key, None)


def _strings_at(
    value: Any, slot: str, container: Any, key: Any, columns: list[Any] | None
) -> Iterator[tuple[str, Any, Any]]:
    if isinstance(value, str):
        yield slot, container, key
    elif isinstance(value, list):
        for index, item in enumerate(value):
            item_columns = columns
            if slot == "tables" and isinstance(item, dict):
                item_columns = [
                    c.get("id") for c in item.get("columns", []) if isinstance(c, dict)
                ]
            yield from _strings_at(item, f"{slot}[{index}]", value, index, item_columns)
    elif isinstance(value, dict):
        for child_key, child in value.items():
            if child_key == "cells" and isinstance(child, dict):
                for column_id, cell in child.items():
                    cell_slot = f"{slot}.cells[{column_ref(columns or [], column_id)}]"
                    yield from _strings_at(cell, cell_slot, child, column_id, columns)
            else:
                yield from _strings_at(
                    child, f"{slot}.{child_key}", value, child_key, columns
                )


def _scan(text: str, matcher: TermMatcher) -> list[str]:
    """The kinds of every scanner ``text`` trips, in a fixed order."""
    if has_hidden_characters(text, allowed=_ALLOWED_CONTROLS):
        kinds = ["hidden_character"]
    else:
        kinds = []
    normalized = normalize_for_scan(text)
    if UUID_RE.search(normalized):
        kinds.append("uuid")
    if EMAIL_RE.search(normalized):
        kinds.append("email")
    if contains_ip_address(normalized):
        kinds.append("ip_address")
    if ACCOUNT_ID_RE.search(normalized):
        kinds.append("account_id")
    if matcher.matches(text, normalized):
        kinds.append("confidential_term")
    return kinds


# ---------------------------------------------------------------------------
# Writing: the whole check
# ---------------------------------------------------------------------------


def canonical_bytes(data: Any) -> bytes:
    """The canonical JSON form: sorted keys, compact separators, UTF-8."""
    return json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def content_sha256(data: Any) -> str:
    return hashlib.sha256(canonical_bytes(data)).hexdigest()


@dataclass(frozen=True)
class Checked:
    """A document's verdict under this contract and the given terms."""

    doc: ReportSnapshotDoc | None
    violations: list[Violation]
    #: ``(slot, owner)`` of every GitHub link: the owner check the store runs
    #: once it has the tenant's first-party owners.
    links: list[tuple[str, str]] = field(default_factory=list)


def check_snapshot(data: Any, *, terms: Iterable[str]) -> Checked:
    """Every way ``data`` breaks the contract that needs no presentation
    scope beyond the confidential ``terms``: the shape, the size, the
    cross-field rules, the link FORMS and every string scan. Empty violations
    means only the link owners are left to check.

    The shape is checked first (Pydantic's validator is native code, so even
    an oversized document costs little there) and the size second, both
    before the string scans, which are the expensive part."""
    doc, violations = _structure(data)
    if doc is None:
        return Checked(None, violations)
    try:
        size = len(canonical_bytes(data))
    except (TypeError, ValueError, RecursionError, UnicodeEncodeError):
        return Checked(None, [Violation("<root>", "not_json")])
    if size > MAX_SNAPSHOT_BYTES:
        return Checked(None, [Violation("<root>", "too_large")])
    violations = _cross_field(doc)
    matcher = TermMatcher(terms)
    for slot, container, key in iter_strings(data):
        violations.extend(
            Violation(slot, kind) for kind in _scan(container[key], matcher)
        )
    return Checked(doc, violations, github_links(data))


def _account_id_outside_uuids(normalized: str) -> bool:
    """An account id that is not part of a UUID. Where UUIDs are allowed, a
    UUID whose last group happens to be twelve digits
    (``…-8000-000000000123``) is still a UUID, not an account id."""
    uuids = [match.span() for match in UUID_RE.finditer(normalized)]
    return any(
        not any(start <= found.start() and found.end() <= end for start, end in uuids)
        for found in ACCOUNT_ID_RE.finditer(normalized)
    )


def narrative_violations(
    fields: dict[str, str], *, terms: Iterable[str]
) -> list[Violation]:
    """The scans free text beside the contract gets at write — a report's own
    narrative, a snapshot's file path, a withdrawal's reason: confidential
    terms, email-shaped identities, IP addresses and account ids. A UUID is
    allowed there (block arguments are slugs, not ids), so twelve digits that
    are a UUID's last group are not an account id."""
    matcher = TermMatcher(terms)
    out: list[Violation] = []
    for slot, text in fields.items():
        normalized = normalize_for_scan(text)
        if matcher.matches(text, normalized):
            out.append(Violation(slot, "confidential_term"))
        if EMAIL_RE.search(normalized):
            out.append(Violation(slot, "email"))
        if contains_ip_address(normalized):
            out.append(Violation(slot, "ip_address"))
        if _account_id_outside_uuids(normalized):
            out.append(Violation(slot, "account_id"))
    return out


def first_storage_difference(
    sent: Any,
    stored: Any,
    slot: str = "",
    columns: Sequence[Any] | None = None,
) -> str | None:
    """The first slot whose value did not survive storage unchanged, compared
    leaf by leaf in canonical JSON (so ``1e16`` read back as an integer, or
    ``-0.0`` as ``0.0``, is a difference although Python calls them equal).
    A cell is named by its declared column's position, as every other slot
    names it (``cells[columns[1]]``), never by the key a writer chose;
    ``columns`` carries the enclosing table's column ids down to it."""
    if isinstance(sent, dict) and isinstance(stored, dict):
        if set(sent) != set(stored):
            return slot or "<root>"
        for key in sent:
            if key == "cells" and isinstance(sent[key], dict):
                found = _cells_difference(sent[key], stored[key], slot, columns)
            else:
                child = f"{slot}.{key}" if slot else str(key)
                found = first_storage_difference(sent[key], stored[key], child, columns)
            if found is not None:
                return found
        return None
    if isinstance(sent, list) and isinstance(stored, list):
        if len(sent) != len(stored):
            return slot or "<root>"
        for index, (a, b) in enumerate(zip(sent, stored, strict=True)):
            item_columns = columns
            if slot == "tables" and isinstance(a, dict):
                item_columns = [
                    c.get("id") for c in a.get("columns", []) if isinstance(c, dict)
                ]
            found = first_storage_difference(a, b, f"{slot}[{index}]", item_columns)
            if found is not None:
                return found
        return None
    if json.dumps(sent, ensure_ascii=False) != json.dumps(stored, ensure_ascii=False):
        return slot or "<root>"
    return None


def _cells_difference(
    sent: dict[str, Any], stored: Any, slot: str, columns: Sequence[Any] | None
) -> str | None:
    """:func:`first_storage_difference` over one row's ``cells``, each cell
    named by its column's position (:func:`column_ref`)."""
    cells = f"{slot}.cells" if slot else "cells"
    if not isinstance(stored, dict) or set(sent) != set(stored):
        return cells
    for key in sent:
        found = first_storage_difference(
            sent[key],
            stored[key],
            f"{cells}[{column_ref(columns or [], key)}]",
            columns,
        )
        if found is not None:
            return found
    return None


# ---------------------------------------------------------------------------
# Reading: today's rules over a stored snapshot
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReadScope:
    """The presentation scope a read applies."""

    #: ``web.presentation_scopes.version``; 0 for a tenant with no row.
    version: int
    #: The tenant's configured confidential terms.
    terms: tuple[str, ...]
    #: The first-party owners, lowercased; ``None`` is UNKNOWN.
    owners: frozenset[str] | None


#: The keys whose value is free text a reader is shown, so a string there that
#: newly matches a confidential term can be replaced by :data:`WITHHELD` and
#: the document still holds together. Every other string is structure — an id
#: or a group reference that changes and cells are keyed by, a date, an enum
#: value — and a match there withholds the snapshot whole.
FREE_TEXT_KEYS: Final[frozenset[str]] = frozenset(
    {
        "label",
        "note",
        "summary",
        "help",
        "title",
        "caption",
        "row_header",
        "unit",
        "source",
        "unknown_reason",
        "status_note",
        "body_md",
        "url",
    }
)


@dataclass
class Treated:
    """A stored snapshot as a reader may see it."""

    #: The document after withholding; ``None`` when it is withheld whole.
    data: dict[str, Any] | None
    #: Every slot withheld, and why (a violation kind, or a link reason).
    withheld: list[Violation]


def treat_for_read(
    data: dict[str, Any],
    *,
    allowlist_version: int,
    scope_version: int,
    scope: ReadScope,
    matcher: TermMatcher | None = None,
) -> Treated:
    """Serve ``data`` under today's contract and scope.

    * Stored under another :data:`REPORT_ALLOWLIST_VERSION`: checked again
      (everything but the scope); any failure withholds it WHOLE.
    * Stored under another allowlist version, OR checked against another
      scope version (D4: strings are scanned again "when the allowlist
      version or the tenant's confidential terms changed"): every string is
      scanned for the current confidential terms. A match in free text
      (:data:`FREE_TEXT_KEYS`) is replaced by :data:`WITHHELD`; a match in
      structure (an id, a group reference, a date, an enum value) withholds
      the snapshot whole, since it cannot be served without that value.
    * Every read: a link is withheld when its owner is not first-party, and
      EVERY link is withheld while the owners are UNKNOWN (fail closed).
    """
    revalidate = allowlist_version != REPORT_ALLOWLIST_VERSION
    if revalidate:
        checked = check_snapshot(data, terms=())
        if checked.violations:
            return Treated(None, checked.violations)
    served = copy.deepcopy(data)
    withheld: list[Violation] = []
    if revalidate or scope_version != scope.version:
        terms = matcher if matcher is not None else TermMatcher(scope.terms)
        matched = [
            (slot, container, key)
            for slot, container, key in iter_strings(served)
            if terms.matches(container[key])
        ]
        structural = [
            Violation(slot, "confidential_term")
            for slot, _container, key in matched
            if key not in FREE_TEXT_KEYS
        ]
        if structural:
            return Treated(None, structural)
        for slot, container, key in matched:
            container[key] = WITHHELD
            withheld.append(Violation(slot, "confidential_term"))
    for i, item in enumerate(served.get("items") or []):
        kept = []
        for k, link in enumerate(item.get("links") or []):
            url = link.get("url")
            slot = f"items[{i}].links[{k}].url"
            if scope.owners is None:
                withheld.append(Violation(slot, "presentation_scope_unknown"))
                continue
            owner = github_link_owner(url) if isinstance(url, str) else None
            if owner is not None and owner not in scope.owners:
                withheld.append(Violation(slot, "link_owner_not_first_party"))
                continue
            if url == WITHHELD:
                # Its text matched a term above; a marker is not a link.
                continue
            kept.append(link)
        if "links" in item:
            item["links"] = kept
    return Treated(served, withheld)


def treat_label(
    text: str,
    *,
    slot: str,
    allowlist_version: int,
    scope_version: int,
    scope: ReadScope,
    matcher: TermMatcher,
) -> tuple[str, list[Violation]]:
    """A string a snapshot ROW copies out of its document (the label, the
    method's label), treated as :func:`treat_for_read` would treat it inside
    the document — for the reads that serve the row without the document."""
    revalidate = allowlist_version != REPORT_ALLOWLIST_VERSION
    if revalidate:
        kinds = _scan(text, TermMatcher(()))
        if kinds:
            return WITHHELD, [Violation(slot, kind) for kind in kinds]
    if (revalidate or scope_version != scope.version) and matcher.matches(text):
        return WITHHELD, [Violation(slot, "confidential_term")]
    return text, []


def treat_narrative(
    fields: dict[str, str], matcher: TermMatcher
) -> tuple[dict[str, str], list[Violation]]:
    """A report's narrative (its title, summary and body, as stored in the
    report or in one of its versions) served under the tenant's CURRENT
    confidential terms: a field that names one is served as :data:`WITHHELD`
    — the whole field, since over-withholding is the safer error — and listed
    by its name, never its value. The narrative was scanned at write, so this
    catches a term added since; what is stored is never changed."""
    served: dict[str, str] = {}
    withheld: list[Violation] = []
    for slot, text in fields.items():
        if matcher.matches(text):
            served[slot] = WITHHELD
            withheld.append(Violation(slot, "confidential_term"))
        else:
            served[slot] = text
    return served, withheld
