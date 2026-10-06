"""The ``metric-checkpoint/v1`` validator — a checkpoint result as a typed object.

Plan ``2026-10-06-overview-objectives-view`` D6 and Appendix A. A checkpoint
session attaches its measured result to the report finding as
``artifact_refs.metric_checkpoint``; the Objectives read (``objectives.py``)
trusts the rows only when this validator passes, and otherwise renders the
report as "reported, but the result could not be read" with the reason. The
rows are never partly trusted.

**Strict, never normalising.** Every rule in Appendix A is a refusal, except
the two the appendix marks as warnings (``cause`` / ``action`` missing on a
``missed`` / ``unknown`` row: an honest unknown can have no known cause) and an
undeclared row id (plan D5, which the coordinator ruled governs over Appendix
A's web-only refusal).

**Two validators, one schema.** Coord validates the same block on write (the
plan's Phase 3). The checks that need the metric document are web-only, because
coord checks shape without reading the document: the block's ``checkpoint``
must be DECLARED in the document's frontmatter (a refusal — an undeclared
checkpoint cannot be placed), and a row id that is not a declared criterion is
a WARNING, not a refusal (D5: the row is shown under its report flagged "not
in the document's list" and never counts toward a declared criterion, so one
extra re-reported row cannot blank every verdict in the report). The golden
cases in ``tests/fixtures/metric_checkpoint_v1/cases.json`` mark those cases
``web_only`` so coord can copy the rest verbatim.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

SCHEMA = "metric-checkpoint/v1"

TOP_KEYS = frozenset(
    {"schema", "document", "checkpoint", "measured_at", "gate_id", "rows", "tally"}
)
REQUIRED_TOP_KEYS = ("schema", "document", "checkpoint", "measured_at", "rows", "tally")
ROW_KEYS = frozenset(
    {
        "id",
        "verdict",
        "value",
        "unit",
        "value_text",
        "method",
        "door",
        "window",
        "unknown_reason",
        "cause",
        "action",
    }
)
DOCUMENT_KEYS = frozenset({"kind", "name", "version"})
TALLY_KEYS = frozenset({"met", "missed", "unknown"})
WINDOW_KEYS = frozenset({"from", "to"})
ACTION_KEYS = frozenset({"kind", "ref"})

VERDICTS = ("met", "missed", "unknown")
UNKNOWN_REASONS = frozenset(
    {"could_not_run", "probe_error", "no_data", "not_measurable_yet", "manual_pending"}
)
ACTION_KINDS = frozenset({"plan", "pr", "gate", "operator_ask"})

MAX_ROWS = 64
MAX_STRING = 500
MAX_BYTES = 32 * 1024

#: Coord's own name rule for a hand-authored prompt document.
_DOC_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
#: RFC 3339 in UTC, with seconds: ``2026-10-08T16:05:00Z`` (or ``+00:00``).
_UTC_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$"
)


def document_resource_key(name: str) -> str:
    """The resource key the Reporting text mandates on a checkpoint finding."""
    return f"prompt_document:success_metric/{name}"


@dataclass(frozen=True)
class Problem:
    #: A dotted path into the block (``rows[0].value_text``), or ``block``.
    field: str
    message: str


@dataclass
class ValidationResult:
    errors: list[Problem] = field(default_factory=list)
    warnings: list[Problem] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        """One line naming the first refusal, for the page's "could not be
        read" reason."""
        if not self.errors:
            return ""
        first = self.errors[0]
        more = len(self.errors) - 1
        tail = f" (and {more} more)" if more else ""
        return f"{first.field}: {first.message}{tail}"


def is_utc_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not _UTC_TIMESTAMP.match(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def is_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(_UUID.match(value))


def _is_int(value: Any) -> bool:
    # bool is an int in Python; `true` is not a count.
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _serialized_size(block: Any) -> int:
    return len(
        json.dumps(block, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


class _Checker:
    def __init__(self) -> None:
        self.result = ValidationResult()

    def error(self, path: str, message: str) -> None:
        self.result.errors.append(Problem(path, message))

    def warn(self, path: str, message: str) -> None:
        self.result.warnings.append(Problem(path, message))

    def exact_keys(
        self,
        obj: dict[str, Any],
        allowed: frozenset[str],
        path: str,
        required: Iterable[str] = (),
    ) -> None:
        for key in sorted(k for k in obj if k not in allowed):
            self.error(_join(path, key), "is not an allowed key")
        for key in required:
            if key not in obj:
                self.error(_join(path, key), "is required")

    def optional_text(self, obj: dict[str, Any], key: str, path: str) -> None:
        value = obj.get(key)
        if value is not None and not isinstance(value, str):
            self.error(_join(path, key), "must be a string or null")

    def strings_bounded(self, value: Any, path: str) -> None:
        """Every string at any depth is at most :data:`MAX_STRING` characters."""
        if isinstance(value, str):
            if len(value) > MAX_STRING:
                self.error(path or "block", f"is longer than {MAX_STRING} characters")
        elif isinstance(value, dict):
            for key, item in value.items():
                self.strings_bounded(item, _join(path, str(key)))
        elif isinstance(value, list):
            for i, item in enumerate(value):
                self.strings_bounded(item, f"{path}[{i}]")


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


def validate_metric_checkpoint(
    block: Any,
    *,
    resource_keys: Iterable[str] | None,
    declared_checkpoints: Iterable[str] | None = None,
    declared_criteria: Iterable[str] | None = None,
) -> ValidationResult:
    """Validate one ``artifact_refs.metric_checkpoint`` block.

    ``resource_keys`` is the finding's own; the block's ``document.name`` must
    appear there as ``prompt_document:success_metric/<name>``.

    ``declared_checkpoints`` / ``declared_criteria`` are the metric document's
    declarations (web-only checks). ``None`` or empty skips the check — a
    document that declares no checkpoints cannot refuse a block for naming one.
    """
    check = _Checker()
    if not isinstance(block, dict):
        check.error("block", "must be a JSON object")
        return check.result
    try:
        size = _serialized_size(block)
    except (TypeError, ValueError):
        check.error("block", "is not serializable as JSON")
        return check.result
    if size > MAX_BYTES:
        check.error("block", f"is {size} bytes serialized; the limit is {MAX_BYTES}")

    check.exact_keys(block, TOP_KEYS, "", REQUIRED_TOP_KEYS)
    check.strings_bounded(block, "")

    if "schema" in block and block["schema"] != SCHEMA:
        check.error("schema", f"must be exactly {SCHEMA}")

    # A key that is ABSENT is already "is required"; one that is present but
    # null is checked like any other wrong type — a null is not an object.
    if "document" in block:
        _check_document(check, block["document"], resource_keys)
    _check_checkpoint(check, block, declared_checkpoints)

    if "measured_at" in block and not is_utc_timestamp(block["measured_at"]):
        check.error("measured_at", "must be an RFC 3339 UTC timestamp with seconds")
    gate_id = block.get("gate_id")
    if gate_id is not None and not is_uuid(gate_id):
        check.error("gate_id", "must be a uuid or null")

    counts = (
        _check_rows(check, block["rows"], declared_criteria)
        if "rows" in block
        else None
    )
    if "tally" in block:
        _check_tally(check, block["tally"], counts)
    return check.result


def _check_document(
    check: _Checker, document: Any, resource_keys: Iterable[str] | None
) -> None:
    if not isinstance(document, dict):
        check.error("document", "must be an object {kind, name, version}")
        return
    check.exact_keys(document, DOCUMENT_KEYS, "document", sorted(DOCUMENT_KEYS))
    if "kind" in document and document["kind"] != "success_metric":
        check.error("document.kind", "must be success_metric")
    name = document.get("name")
    if "name" in document:
        if not isinstance(name, str) or not _DOC_NAME.match(name):
            check.error("document.name", "must be a document name (kebab-case)")
        elif document_resource_key(name) not in set(resource_keys or ()):
            check.error(
                "document.name",
                f"the finding's resource_keys must include {document_resource_key(name)}",
            )
    if "version" in document:
        version = document["version"]
        if not _is_int(version) or version < 1:
            check.error("document.version", "must be an integer of at least 1")


def _check_checkpoint(
    check: _Checker, block: dict[str, Any], declared: Iterable[str] | None
) -> None:
    if "checkpoint" not in block:
        return
    value = block["checkpoint"]
    if not isinstance(value, str) or not value.strip():
        check.error("checkpoint", "must be a non-empty string")
        return
    known = list(declared or ())
    if known and value not in known:
        check.error(
            "checkpoint",
            f"{value!r} is not one of the document's checkpoints ({', '.join(known)})",
        )


def _check_rows(
    check: _Checker, rows: Any, declared_criteria: Iterable[str] | None
) -> dict[str, int] | None:
    """Row checks; returns the verdict counts, or ``None`` when the rows are
    not a countable list (the tally check is then meaningless)."""
    if not isinstance(rows, list):
        check.error("rows", "must be a list")
        return None
    if not 1 <= len(rows) <= MAX_ROWS:
        check.error("rows", f"must hold 1-{MAX_ROWS} rows, not {len(rows)}")
    known = set(declared_criteria or ())
    seen: set[str] = set()
    counts = dict.fromkeys(VERDICTS, 0)
    for i, row in enumerate(rows):
        path = f"rows[{i}]"
        if not isinstance(row, dict):
            check.error(path, "must be an object")
            continue
        check.exact_keys(row, ROW_KEYS, path, ("id", "verdict"))
        row_id = row.get("id")
        if "id" in row:
            if not isinstance(row_id, str) or not row_id.strip():
                check.error(f"{path}.id", "must be a non-empty string")
            elif row_id in seen:
                check.error(f"{path}.id", f"{row_id!r} appears twice")
            else:
                seen.add(row_id)
                if known and row_id not in known:
                    # D5: flagged and shown, never counted — not a refusal.
                    check.warn(
                        f"{path}.id",
                        f"{row_id!r} is not one of the document's criteria; "
                        "shown under the report and not counted",
                    )
        verdict = row.get("verdict")
        if "verdict" in row:
            # Type-check before every membership test: an unhashable value
            # (a list, an object) is a refusal, never a TypeError.
            if isinstance(verdict, str) and verdict in counts:
                counts[verdict] += 1
            else:
                check.error(f"{path}.verdict", "must be met, missed or unknown")
        _check_row_fields(check, row, path, verdict)
    return counts


def _check_row_fields(
    check: _Checker, row: dict[str, Any], path: str, verdict: Any
) -> None:
    for key in ("unit", "value_text", "method", "door", "cause"):
        check.optional_text(row, key, path)

    value = row.get("value")
    if value is not None and not _is_number(value):
        check.error(f"{path}.value", "must be a number or null")
    unit = row.get("unit")
    if value is not None and (not isinstance(unit, str) or not unit.strip()):
        check.error(f"{path}.unit", "is required whenever value is set")

    value_text = row.get("value_text")
    if verdict in ("met", "missed") and (
        not isinstance(value_text, str) or not value_text.strip()
    ):
        check.error(f"{path}.value_text", f"a {verdict} row must carry value_text")

    reason = row.get("unknown_reason")
    known_reason = isinstance(reason, str) and reason in UNKNOWN_REASONS
    if verdict == "unknown" and not known_reason:
        check.error(
            f"{path}.unknown_reason",
            "an unknown row needs one of " + ", ".join(sorted(UNKNOWN_REASONS)),
        )
    elif reason is not None and not known_reason:
        check.error(f"{path}.unknown_reason", "is not a known reason")

    window = row.get("window")
    if window is not None:
        if not isinstance(window, dict):
            check.error(f"{path}.window", "must be {from, to} or null")
        else:
            check.exact_keys(window, WINDOW_KEYS, f"{path}.window", ("from", "to"))
            for key in ("from", "to"):
                if key in window and not is_utc_timestamp(window[key]):
                    check.error(
                        f"{path}.window.{key}",
                        "must be an RFC 3339 UTC timestamp with seconds",
                    )

    action = row.get("action")
    if action is not None:
        if not isinstance(action, dict):
            check.error(f"{path}.action", "must be {kind, ref} or null")
        else:
            check.exact_keys(action, ACTION_KEYS, f"{path}.action", ("kind", "ref"))
            kind = action.get("kind")
            if "kind" in action and not (
                isinstance(kind, str) and kind in ACTION_KINDS
            ):
                check.error(
                    f"{path}.action.kind",
                    "must be one of " + ", ".join(sorted(ACTION_KINDS)),
                )
            ref = action.get("ref")
            if "ref" in action and (not isinstance(ref, str) or not ref.strip()):
                check.error(f"{path}.action.ref", "must be a non-empty string")

    if verdict in ("missed", "unknown"):
        if row.get("cause") is None:
            check.warn(f"{path}.cause", f"a {verdict} row is expected to give a cause")
        if row.get("action") is None:
            check.warn(
                f"{path}.action", f"a {verdict} row is expected to name an action"
            )


def _check_tally(check: _Checker, tally: Any, counts: dict[str, int] | None) -> None:
    if not isinstance(tally, dict):
        check.error("tally", "must be an object {met, missed, unknown}")
        return
    check.exact_keys(tally, TALLY_KEYS, "tally", sorted(TALLY_KEYS))
    for key in sorted(TALLY_KEYS):
        if key in tally and (not _is_int(tally[key]) or tally[key] < 0):
            check.error(f"tally.{key}", "must be a non-negative integer")
    if counts is None:
        return
    if any(tally.get(k) != counts[k] for k in VERDICTS):
        stated = ", ".join(f"{k} {tally.get(k)!r}" for k in VERDICTS)
        actual = ", ".join(f"{k} {counts[k]}" for k in VERDICTS)
        check.error("tally", f"states {stated} but the rows hold {actual}")


__all__ = [
    "ACTION_KINDS",
    "SCHEMA",
    "UNKNOWN_REASONS",
    "Problem",
    "ValidationResult",
    "document_resource_key",
    "is_utc_timestamp",
    "is_uuid",
    "validate_metric_checkpoint",
]
