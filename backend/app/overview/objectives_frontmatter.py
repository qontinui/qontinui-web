"""Intent-document frontmatter, read typed for the Objectives view.

Plan ``2026-10-06-overview-objectives-view`` D3, D5 and D8: YAML read by
``yaml.SafeLoader``'s rules, every date normalised to an ISO string at any
depth, every field nullable, and a malformed block reported on its document —
never failing the page.

**Bounded.** A block is read only when it is at most
:data:`MAX_FRONTMATTER_CHARS` long, uses no anchor or alias, and nests at most
:data:`MAX_FRONTMATTER_DEPTH` levels; anything else is refused on its document
(:class:`_StrictLoader`). An alias turns the loaded value into a graph: a few
hundred bytes of aliases to aliases expand to hundreds of thousands of leaves
once copied, and a chain of them nests deeper than the stack while the parser
itself never recursed.
"""

from __future__ import annotations

import math
import re
from datetime import UTC, date, datetime
from typing import Any

import yaml
from yaml.nodes import Node

from app.overview.intent_documents import (
    IntentDocumentRead,
    split_frontmatter,
)
from app.overview.objectives_models import (
    CheckpointDeclRead,
    CriterionDeclRead,
    CurrentValueRead,
    ExtraFieldRead,
    InitiativeRead,
    MetricRead,
    ObjectiveRead,
    ResultEntryRead,
    SourceQueryType,
)

#: The frontmatter keys this read interprets. Any other SCALAR key is passed
#: through as labelled text (``extra_fields``), never in the card text.
_METRIC_KEYS = frozenset(
    {
        "metric",
        "unit",
        "direction",
        "baseline",
        "baseline_as_of",
        "target",
        "ceiling",
        "floor",
        "serves",
        "source_query",
        "checkpoints",
        "criteria",
        "report_topic",
        "structured_reporting_since",
        "results",
        "mispublished",
    }
)
_DIRECTION_ALIASES = {"higher_is_better": "increase", "lower_is_better": "decrease"}


# ===========================================================================
# The title rule — a port of ``titleOfDocument`` (frontend ``_lib/intent.ts``)
# ===========================================================================

_ATX = re.compile(r"^([ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*)(?:\r?\n|$)")
_NOT_SETEXT = re.compile(r"^[ \t]{0,3}(?:[>|<#`~\[]|[-*+][ \t]|\d+[.)][ \t])")
_SETEXT = re.compile(r"^([ \t]{0,3}(\S.*?)[ \t]*\r?\n[ \t]{0,3}={2,}[ \t]*)(?:\r?\n|$)")


def _lead_heading(prose: str) -> str | None:
    """The heading a document OPENS with (ATX or ``=`` setext), else None."""
    _, text = split_frontmatter(prose)
    atx = _ATX.match(text)
    if atx and atx.group(2):
        return atx.group(2).strip()
    if _NOT_SETEXT.match(text):
        return None
    setext = _SETEXT.match(text)
    if setext and setext.group(2):
        return setext.group(2).strip()
    return None


def _plain_text(text: str) -> str:
    words = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    words = re.sub(r"(^|[\s(])([*`]+)(?=\S)", r"\1", words)
    words = re.sub(r"(\S)([*`]+)(?=[\s).,;:!?]|$)", r"\1", words).strip()
    return words if any(ch.isalnum() for ch in words) else ""


def _slug_title(name: str) -> str:
    """A document's slug read as words: ``"dev-speed"`` → ``"Dev speed"``."""
    words = re.sub(r"[-_]+", " ", name).strip()
    return words[:1].upper() + words[1:]


def title_of_document(name: str, prose: str) -> str:
    """A document's own name for itself, from its opening heading, else its
    slug read as words — the Summary's ``titleOfDocument``."""
    heading = _lead_heading(prose)
    from_body = _plain_text(heading) if heading else ""
    if from_body:
        return from_body
    return _slug_title(name)


# ===========================================================================
# Frontmatter
# ===========================================================================

#: The longest frontmatter block (characters between the fences) this read
#: parses. The richest real document, the merge-train metric with its 17
#: criteria, is about 3,500.
MAX_FRONTMATTER_CHARS = 64_000
#: The deepest a block may nest, counting each mapping, list and value as a
#: level. That metric reaches 4 (the mapping, ``criteria``, one item, its
#: ``target``).
MAX_FRONTMATTER_DEPTH = 32


class _FrontmatterRefused(Exception):
    """A block this read declines to load; the message says why."""


class _StrictLoader(yaml.SafeLoader):
    """``yaml.SafeLoader`` that refuses every anchor and alias, and any node
    nested deeper than :data:`MAX_FRONTMATTER_DEPTH`.

    Both are checked as each node is composed, so a refused block is never
    built: an alias bomb stops at its first anchor, and deep nesting stops
    before the composer's own recursion gets deep.
    """

    def __init__(self, stream: str) -> None:
        super().__init__(stream)
        self._depth = 0

    def compose_node(self, parent: Node | None, index: int) -> Node | None:
        event = self.peek_event()
        if (
            isinstance(event, yaml.AliasEvent)
            or getattr(event, "anchor", None) is not None
        ):
            raise _FrontmatterRefused(
                "uses a YAML anchor or alias (&name / *name), which this page "
                "does not read"
            )
        self._depth += 1
        try:
            if self._depth > MAX_FRONTMATTER_DEPTH:
                raise _FrontmatterRefused(
                    f"nests deeper than {MAX_FRONTMATTER_DEPTH} levels"
                )
            return super().compose_node(parent, index)
        finally:
            self._depth -= 1


def _load(text: str) -> Any:
    """One YAML document, read by :class:`_StrictLoader` (``yaml.safe_load``'s
    construction rules: no Python objects)."""
    loader = _StrictLoader(text)
    try:
        return loader.get_single_data()
    finally:
        loader.dispose()


def _iso(value: Any) -> Any:
    """Every ``date`` / ``datetime`` at any depth → an ISO string.

    ``yaml.safe_load`` returns ``datetime.date`` for an unquoted date, which
    the typed model will not take as a string; coord's ``serde_yaml`` reads a
    string. Keys are normalised too, since YAML allows a date as a key.
    """
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(UTC)
            return value.isoformat().replace("+00:00", "Z")
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(_iso(k)): _iso(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_iso(v) for v in value]
    return value


def parse_frontmatter(block: str | None) -> tuple[dict[str, Any], str | None]:
    """``(mapping, error)``. No block is an empty mapping and no error; a block
    that is too long, uses an anchor or alias, nests too deep, fails to parse,
    or is not a mapping, is an empty mapping and the error — never an
    exception."""
    if not block:
        return {}, None
    lines = block.lstrip("﻿").splitlines()
    inner = "\n".join(lines[1:-1])
    if len(inner) > MAX_FRONTMATTER_CHARS:
        return {}, (
            f"The YAML block is {len(inner):,} characters long; this page reads "
            f"blocks of at most {MAX_FRONTMATTER_CHARS:,}."
        )
    try:
        loaded = _load(inner)
        if loaded is None:
            return {}, None
        if not isinstance(loaded, dict):
            return {}, "The YAML block is not a mapping of keys to values."
        normalised: dict[str, Any] = _iso(loaded)
    except _FrontmatterRefused as exc:
        return {}, f"The YAML block is not read: it {exc}."
    except (yaml.YAMLError, ValueError, RecursionError) as exc:
        # PyYAML raises ValueError (not YAMLError) for an impossible date such
        # as `2026-02-30`. RecursionError is the last bound: the depth limit
        # stops nesting first, so a stack that still runs out is reported on
        # this document like any other block that could not be read.
        message = " ".join(str(exc).split()) or type(exc).__name__
        return {}, f"The YAML block could not be parsed: {message[:300]}"
    return normalised, None


def as_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _text(value: Any) -> str | None:
    """A scalar as text; ``None`` for null and for a list or mapping."""
    if value is None or isinstance(value, dict | list):
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _bound(fm: dict[str, Any], key: str) -> tuple[float | None, str | None]:
    """A typed bound: the number when YAML gave one, plus the raw text."""
    value = fm.get(key)
    return as_number(value), _text(value)


def source_query_type(value: Any) -> SourceQueryType:
    """``named: …`` / ``http: …`` / ``manual: …`` (or a one-key mapping of the
    same) are typed; any other value is ``untyped``; none is ``absent``."""
    if value is None:
        return "absent"
    if isinstance(value, dict) and len(value) == 1:
        (only,) = value
        if only in ("named", "http", "manual"):
            return only  # type: ignore[no-any-return]
        return "untyped"
    if isinstance(value, str):
        prefix = value.strip().split(":", 1)[0].strip()
        if ":" in value and prefix in ("named", "http", "manual"):
            return prefix  # type: ignore[return-value]
        return "untyped" if value.strip() else "absent"
    return "untyped"


def _current_value(kind: SourceQueryType) -> CurrentValueRead:
    if kind == "manual":
        reason = "Measured by hand; no automatic reading."
    elif kind in ("untyped", "absent"):
        reason = "This measure has no source coord can run."
    else:
        reason = "Coord does not run measures yet."
    return CurrentValueRead(source_query_type=kind, reason=reason)


def _string_list(value: Any, key: str, errors: dict[str, str]) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return list(value)
    errors[key] = f"{key} must be a list of names."
    return []


def _parse_checkpoints(
    value: Any, errors: dict[str, str], warnings: list[str]
) -> tuple[list[CheckpointDeclRead], str | None]:
    if value is None:
        return [], None
    if isinstance(value, str | int | float):
        warnings.append(
            "checkpoints is free text, not a list, so no checkpoint can be "
            "matched to a report."
        )
        return [], str(value)
    if not isinstance(value, list):
        errors["checkpoints"] = "checkpoints must be a list of {id, due, label}."
        return [], None
    out: list[CheckpointDeclRead] = []
    seen: set[str] = set()
    problems: list[str] = []
    for i, item in enumerate(value):
        ident = item.get("id") if isinstance(item, dict) else None
        if not isinstance(ident, str) or not ident.strip():
            problems.append(f"item {i + 1} has no quoted id")
            continue
        if ident in seen:
            problems.append(f"{ident!r} is declared twice")
            continue
        seen.add(ident)
        due = _text(item.get("due"))
        if due is not None and parse_date(due) is None:
            problems.append(f"{ident!r} has a due that is not a date ({due!r})")
            due = None
        out.append(
            CheckpointDeclRead(id=ident, due=due, label=_text(item.get("label")))
        )
    if problems:
        errors["checkpoints"] = "; ".join(problems)
    return out, None


def _parse_criteria(value: Any, errors: dict[str, str]) -> list[CriterionDeclRead]:
    if value is None:
        return []
    if not isinstance(value, list):
        errors["criteria"] = (
            "criteria must be a list of {id, checkpoint, target, method}."
        )
        return []
    out: list[CriterionDeclRead] = []
    seen: set[str] = set()
    problems: list[str] = []
    for i, item in enumerate(value):
        ident = item.get("id") if isinstance(item, dict) else None
        if not isinstance(ident, str) or not ident.strip():
            # An unquoted `1.1` loads as a float; repairing it could turn
            # `1.10` into `1.1`, so it is refused and named instead.
            problems.append(f"item {i + 1} has no quoted string id")
            continue
        if ident in seen:
            problems.append(f"{ident!r} is declared twice")
            continue
        seen.add(ident)
        assert isinstance(item, dict)
        out.append(
            CriterionDeclRead(
                id=ident,
                checkpoint=_text(item.get("checkpoint")),
                target=_text(item.get("target")),
                method=_text(item.get("method")),
            )
        )
    if problems:
        errors["criteria"] = "; ".join(problems)
    return out


def _parse_results(value: Any, errors: dict[str, str]) -> list[ResultEntryRead]:
    if value is None:
        return []
    if not isinstance(value, list):
        errors["results"] = (
            "results must be a list of {checkpoint, finding_id, posted_at}."
        )
        return []
    out: list[ResultEntryRead] = []
    bad = 0
    problems: list[str] = []
    for i, item in enumerate(value):
        if not isinstance(item, dict):
            bad += 1
            continue
        entry = ResultEntryRead(
            checkpoint=_text(item.get("checkpoint")),
            finding_id=_text(item.get("finding_id")),
            posted_at=_text(item.get("posted_at")),
        )
        missing = [
            what
            for what, present in (
                ("no checkpoint", bool(entry.checkpoint and entry.checkpoint.strip())),
                ("no finding_id", bool(entry.finding_id and entry.finding_id.strip())),
            )
            if not present
        ]
        if missing:
            problems.append(f"entry {i + 1} has {' and '.join(missing)}")
        out.append(entry)
    if bad:
        problems.insert(
            0, f"{bad} results entr{'y is' if bad == 1 else 'ies are'} not a mapping"
        )
    if problems:
        errors["results"] = "; ".join(problems) + "."
    return out


def parse_date(text: str) -> date | None:
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def parse_time(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def is_void(fm: dict[str, Any]) -> bool:
    """A void tombstone: ``mispublished: true``."""
    return fm.get("mispublished") is True


def build_metric(doc: IntentDocumentRead) -> tuple[MetricRead, bool]:
    """The metric's document fields and typed frontmatter; ``(read, void)``."""
    base = MetricRead(
        name=doc.name,
        title=title_of_document(doc.name, doc.body),
        state=doc.state,
        version=doc.version,
        updated_at=doc.updated_at,
        updated_by=doc.updated_by,
        overview_order=doc.overview_order,
        body=doc.body,
        error=doc.error,
        current_value=_current_value("absent"),
    )
    if doc.state == "unreadable":
        return base, False
    fm, error = parse_frontmatter(doc.frontmatter)
    if error:
        base.frontmatter_error = error
        return base, False
    if is_void(fm):
        return base, True

    errors: dict[str, str] = {}
    warnings: list[str] = []
    base.metric = _text(fm.get("metric"))
    base.unit = _text(fm.get("unit"))
    base.baseline_as_of = _text(fm.get("baseline_as_of"))
    base.baseline, base.baseline_text = _bound(fm, "baseline")
    base.target, base.target_text = _bound(fm, "target")
    base.ceiling, base.ceiling_text = _bound(fm, "ceiling")
    base.floor, base.floor_text = _bound(fm, "floor")

    raw_direction = fm.get("direction")
    if raw_direction in ("increase", "decrease"):
        base.direction = raw_direction
    elif isinstance(raw_direction, str) and raw_direction in _DIRECTION_ALIASES:
        base.direction = _DIRECTION_ALIASES[raw_direction]  # type: ignore[assignment]
        warnings.append(
            f"direction {raw_direction!r} is read as {base.direction!r}; the "
            "vocabulary is increase | decrease."
        )
    elif raw_direction is not None:
        base.direction_text = _text(raw_direction) or str(raw_direction)
        warnings.append(
            "direction is not increase or decrease, so it is shown as text."
        )

    base.serves = _string_list(fm.get("serves"), "serves", errors)
    base.report_topic = _text(fm.get("report_topic"))
    base.structured_reporting_since = _text(fm.get("structured_reporting_since"))
    base.source_query_type = source_query_type(fm.get("source_query"))
    base.current_value = _current_value(base.source_query_type)
    base.checkpoints, base.checkpoints_text = _parse_checkpoints(
        fm.get("checkpoints"), errors, warnings
    )
    base.criteria = _parse_criteria(fm.get("criteria"), errors)
    base.results = _parse_results(fm.get("results"), errors)
    base.extra_fields = [
        ExtraFieldRead(key=key, text=text)
        for key, value in fm.items()
        if key not in _METRIC_KEYS and (text := _text(value)) is not None
    ]
    base.field_errors = errors
    base.frontmatter_warnings = warnings
    return base, False


def build_initiative(doc: IntentDocumentRead) -> tuple[InitiativeRead, bool]:
    """The initiative's typed frontmatter; ``(read, void)``."""
    read = InitiativeRead(
        name=doc.name,
        title=title_of_document(doc.name, doc.body),
        state=doc.state,
        version=doc.version,
        updated_at=doc.updated_at,
        updated_by=doc.updated_by,
        error=doc.error,
    )
    if doc.state in ("unreadable", "skeleton"):
        return read, False
    fm, error = parse_frontmatter(doc.frontmatter)
    if error:
        read.frontmatter_error = error
        return read, False
    if is_void(fm):
        return read, True
    read.status = _text(fm.get("status"))
    read.live = read.status == "live"
    read.starts = _text(fm.get("starts"))
    read.ends = _text(fm.get("ends"))
    read.success_metrics = _string_list(
        fm.get("success_metrics"), "success_metrics", read.field_errors
    )
    in_scope = fm.get("in_scope")
    if isinstance(in_scope, list):
        skipped = 0
        for item in in_scope:
            ident = item.get("id") if isinstance(item, dict) else None
            if not isinstance(ident, str) or not ident.strip():
                skipped += 1
                continue
            assert isinstance(item, dict)
            read.objectives.append(
                ObjectiveRead(
                    id=ident, text=_text(item.get("text")) or ident, metric_names=[]
                )
            )
        if skipped:
            read.frontmatter_warnings.append(
                f"{skipped} in_scope item(s) carry no id, so no measure can name them."
            )
    elif in_scope is not None:
        read.field_errors["in_scope"] = "in_scope must be a list of {id, text}."
    return read, False


def _read_failed(exc: Exception) -> str:
    return f"The definition could not be read ({type(exc).__name__})."


def metric_read_failed(doc: IntentDocumentRead, exc: Exception) -> MetricRead:
    """The metric when :func:`build_metric` itself crashed: shown, with the
    crash as its definition error, so its card says its figures are unknown
    and only this document is marked. Built from the document's fields alone
    (the title is the slug), so it cannot crash the same way."""
    return MetricRead(
        name=doc.name,
        title=_slug_title(doc.name),
        state=doc.state,
        version=doc.version,
        updated_at=doc.updated_at,
        updated_by=doc.updated_by,
        overview_order=doc.overview_order,
        body=doc.body,
        error=doc.error,
        frontmatter_error=_read_failed(exc),
        current_value=_current_value("absent"),
    )


def initiative_read_failed(doc: IntentDocumentRead, exc: Exception) -> InitiativeRead:
    """The initiative when :func:`build_initiative` itself crashed: listed with
    the crash as its definition error, which makes the objectives unreadable
    rather than empty."""
    return InitiativeRead(
        name=doc.name,
        title=_slug_title(doc.name),
        state=doc.state,
        version=doc.version,
        updated_at=doc.updated_at,
        updated_by=doc.updated_by,
        error=doc.error,
        frontmatter_error=_read_failed(exc),
    )
