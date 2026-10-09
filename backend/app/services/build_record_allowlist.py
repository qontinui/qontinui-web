"""The D3 allowlist for a public build record, and the validator that enforces it.

Plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``, design
decision D3 ("public redaction is explicit, not implied") and Phase 1.

coord's ``coord_build_record`` composer applies this allowlist at its one exit.
qontinui-web applies it AGAIN before a document is frozen into
``web.build_record_snapshots``, and once more every time the public route
serves one — defence in depth, so a coord regression cannot reach the
unauthenticated reader. The key set is the binding cross-repo contract's
``build-record/1`` schema, key for key; ``tests/test_build_records.py`` pins it.

What the validator refuses
==========================

**Shape.** Any key not in :data:`BUILD_RECORD_ALLOWLIST`, at any depth; a
container where a scalar belongs and the reverse.

**Per-slot value types.** Every leaf has a declared kind (:class:`Slot`):

* counts and the PR number — ``int`` or ``null`` (``bool`` refused, since it
  is an ``int`` subclass in Python);
* timestamps — an RFC 3339 string, or ``null`` where the contract allows it;
* statuses — coord's canonical work-unit vocabulary
  (:data:`WORK_UNIT_STATUSES`, ``WorkUnitStatus::from_wire`` in qontinui-coord
  ``work_unit_registry.rs``); a legacy opaque status is refused, never passed;
* repos — ``owner/name``; the product slug — the product slug pattern;
  work-unit slugs — :data:`WORK_UNIT_SLUG_RE` (plan stems are longer);
* PR and work-unit titles — any string or ``null`` (coord nulls a title that
  would fail the scan below and records ``<path>: not_established``);
* timestamps are PARSED, not only pattern-matched;
* ``unknowns[]`` and ``sessions.unknown_reason`` — ONLY the constrained form
  ``<allowlisted path>: <reason code>`` with a reason from
  :data:`UNKNOWN_REASON_CODES`. Free text is refused: it is the one slot an
  unvetted sentence (a device name, an operator, a findings body) would ride.

**Content, in every string anywhere** (titles included), read after NFKC
normalisation with lookalike slashes mapped to ``/`` and spaces around ``/``
removed (:func:`normalize_for_scan`):

* an ``owner/name`` token that is not one of ``product.repos`` — a private
  repo name leaking through a title, a slug or an unknown;
* a UUID-shaped substring, dashed or as a bare 32-hex run (device,
  session, user and tenant ids);
* an email-shaped substring, ``user@host`` included (operator identities).

A string carrying a format (``Cf``) or control (``Cc``) character, or a
combining overlay (U+0334–U+0338, U+20D2/3, U+20E5/6), is refused outright:
those split a token for every check above while rendering as nothing.

:func:`names_token` is the token-bounded check the publish route also runs
for the NAMES of repos coord excluded (defined but not in the document).

**Cross-field.** A ``schema`` other than :data:`BUILD_RECORD_SCHEMA`; a PR
whose ``repo`` is not one of ``product.repos`` (coord lists only repos
POSITIVELY known public there).

A key the allowlist names but the document omits is not a violation: absence
leaks nothing. Violation messages name the SLOT, never the offending value
(an unlisted key is reported as ``<unlisted key>``), so a refusal cannot
itself leak what it refused.

Known false-positive class, accepted fail-closed: a title containing a
non-repo ``a/b`` token (``CI/CD``) is refused. Two all-digit segments
(``2026/10``) are exempt.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from enum import Enum
from typing import Any, Final

#: The one schema id this allowlist describes.
BUILD_RECORD_SCHEMA: Final = "build-record/1"

#: coord's canonical work-unit lifecycle (``WorkUnitStatus::from_wire``).
WORK_UNIT_STATUSES: Final[frozenset[str]] = frozenset(
    {
        "draft",
        "in_progress",
        "blocked",
        "vetted",
        "ready",
        "shipped",
        "superseded",
        "obsolete",
    }
)

#: Why a field could not be established — the only words an unknown may use.
UNKNOWN_REASON_CODES: Final[frozenset[str]] = frozenset(
    {
        "not_established",
        "door_unavailable",
        "excluded_not_known_public",
        "census_provisional",
        "not_applicable",
    }
)

SLUG_RE: Final = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
#: A work-unit slug. ``coord.work_units.slug`` is unconstrained ``TEXT``
#: (``coord_workunits_01_work_units``), and real plan stems run past 140
#: characters and carry upper case, ``.`` and ``_`` (``PLAN_2026_06_17_…``,
#: ``….VETTED-INPROGRESS``) — so this is wider than the product slug. It still
#: forbids ``/`` and whitespace, and the content scan below still applies.
WORK_UNIT_SLUG_RE: Final = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$")
REPO_RE: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$")
RFC3339_RE: Final = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"
)
#: A dashed UUID, or the same 128 bits as a bare 32-hex run. A 40-hex commit
#: sha is NOT matched (the run must be exactly 32 hex characters long).
_UUID_RE: Final = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    r"|(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])"
)
#: ``user@host`` is enough — an internal host needs no dot to identify a person.
_EMAIL_RE: Final = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+")
#: Characters that render as ``/`` but are not it (NFKC already folds U+FF0F).
_LOOKALIKE_SLASHES: Final = dict.fromkeys(
    map(ord, "\u2215\u2044\u29f8\u2571\u1735"), "/"
)
_SPACED_SLASH_RE: Final = re.compile(r"\s*/\s*")
#: Combining marks that draw a stroke THROUGH the previous character, so
#: ``a\u0338b`` can render like ``a/b`` while scanning as two letters.
_OVERLAY_MARKS: Final = frozenset(
    "\u0334\u0335\u0336\u0337\u0338\u20d2\u20d3\u20e5\u20e6"
)
_PATH_RUN_RE: Final = re.compile(r"[A-Za-z0-9._/-]+")
_UNKNOWN_RE: Final = re.compile(r"^([a-z_][a-z0-9_.\[\]]*): ([a-z_]+)$")
_INDEX_RE: Final = re.compile(r"\[\d+\]")


class Slot(Enum):
    """The declared kind of one leaf."""

    SCHEMA = "schema"
    TIMESTAMP = "timestamp"
    TIMESTAMP_OR_NULL = "timestamp_or_null"
    COUNT = "count"
    REPO = "repo"
    SLUG = "slug"
    WORK_UNIT_SLUG = "work_unit_slug"
    STATUS = "status"
    STATUS_OR_NULL = "status_or_null"
    TEXT = "text"
    TEXT_OR_NULL = "text_or_null"
    UNKNOWN = "unknown"
    UNKNOWN_OR_NULL = "unknown_or_null"


#: The allowlist as a shape: a dict maps each allowed key to the shape of its
#: value, a one-element list means "a list whose items all have this shape",
#: and a :class:`Slot` is a leaf.
BUILD_RECORD_ALLOWLIST: Final[dict[str, Any]] = {
    "schema": Slot.SCHEMA,
    "generated_at": Slot.TIMESTAMP,
    "product": {
        "slug": Slot.SLUG,
        "title": Slot.TEXT,
        "repos": [Slot.REPO],
        "window_start": Slot.TIMESTAMP_OR_NULL,
        "window_end": Slot.TIMESTAMP_OR_NULL,
    },
    "work_units": [
        {
            "slug": Slot.WORK_UNIT_SLUG,
            "title": Slot.TEXT_OR_NULL,
            "status": Slot.STATUS,
            "vetted_at": Slot.TIMESTAMP_OR_NULL,
            "shipped_at": Slot.TIMESTAMP_OR_NULL,
        }
    ],
    "timeline": [
        {
            "at": Slot.TIMESTAMP,
            "work_unit": Slot.WORK_UNIT_SLUG,
            "from_status": Slot.STATUS_OR_NULL,
            "to_status": Slot.STATUS,
        }
    ],
    "prs": [
        {
            "repo": Slot.REPO,
            "number": Slot.COUNT,
            "title": Slot.TEXT_OR_NULL,
            "opened_at": Slot.TIMESTAMP_OR_NULL,
            "landed_at": Slot.TIMESTAMP_OR_NULL,
            "ci_duration_secs": Slot.COUNT,
            "attempts": Slot.COUNT,
        }
    ],
    "gates": {"registered": Slot.COUNT, "cleared": Slot.COUNT},
    "sessions": {"count": Slot.COUNT, "unknown_reason": Slot.UNKNOWN_OR_NULL},
    "wall_clock_secs": Slot.COUNT,
    "self_corrections": {
        "red_ci_fixed": Slot.COUNT,
        "review_findings_fixed": Slot.COUNT,
        "gate_reopens": Slot.COUNT,
    },
    "unknowns": [Slot.UNKNOWN],
}


def _key_paths(shape: Any, prefix: str) -> list[str]:
    if isinstance(shape, dict):
        paths: list[str] = []
        for key, sub in shape.items():
            path = f"{prefix}.{key}" if prefix else key
            paths.append(path)
            paths.extend(_key_paths(sub, path))
        return paths
    if isinstance(shape, list):
        return _key_paths(shape[0], f"{prefix}[]")
    return []


#: Every allowed key, as a dotted path with ``[]`` for list items
#: (``prs[].repo``). The flat form a test pins against the contract.
BUILD_RECORD_ALLOWED_PATHS: Final[frozenset[str]] = frozenset(
    _key_paths(BUILD_RECORD_ALLOWLIST, "")
)


class BuildRecordRejected(ValueError):
    """The document failed the D3 allowlist. ``violations`` names every failure."""

    def __init__(self, violations: list[str]) -> None:
        super().__init__("; ".join(violations))
        self.violations = violations


def _is_count(value: Any) -> bool:
    return value is None or (
        isinstance(value, int) and not isinstance(value, bool) and value >= 0
    )


def _is_unknown(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    match = _UNKNOWN_RE.fullmatch(value)
    if match is None:
        return False
    path, reason = match.groups()
    return (
        _INDEX_RE.sub("[]", path) in BUILD_RECORD_ALLOWED_PATHS
        and reason in UNKNOWN_REASON_CODES
    )


def _is_timestamp(value: str) -> bool:
    """RFC 3339 by shape AND by value: ``2026-13-40T…`` matches the regex and
    is still refused, because it does not parse."""
    if RFC3339_RE.fullmatch(value) is None:
        return False
    try:
        return datetime.fromisoformat(value).tzinfo is not None
    except ValueError:
        return False


def _slot_ok(slot: Slot, value: Any) -> bool:
    if slot is Slot.SCHEMA:
        return isinstance(value, str) and value == BUILD_RECORD_SCHEMA
    if slot is Slot.COUNT:
        return _is_count(value)
    if slot is Slot.UNKNOWN:
        return _is_unknown(value)
    if slot is Slot.UNKNOWN_OR_NULL:
        return value is None or _is_unknown(value)
    if slot is Slot.TIMESTAMP_OR_NULL and value is None:
        return True
    if slot in (Slot.STATUS_OR_NULL, Slot.TEXT_OR_NULL) and value is None:
        return True
    if not isinstance(value, str):
        return False
    if slot in (Slot.TIMESTAMP, Slot.TIMESTAMP_OR_NULL):
        return _is_timestamp(value)
    if slot in (Slot.STATUS, Slot.STATUS_OR_NULL):
        return value in WORK_UNIT_STATUSES
    if slot is Slot.REPO:
        return REPO_RE.fullmatch(value) is not None
    if slot is Slot.SLUG:
        return SLUG_RE.fullmatch(value) is not None
    if slot is Slot.WORK_UNIT_SLUG:
        return WORK_UNIT_SLUG_RE.fullmatch(value) is not None
    return True  # TEXT / TEXT_OR_NULL — the content scan below still applies


def _walk(
    value: Any, shape: Any, path: str, out: list[str], strings: list[tuple[str, str]]
) -> None:
    where = path or "<root>"
    if isinstance(shape, dict):
        if not isinstance(value, dict):
            out.append(f"{where}: expected an object, got {type(value).__name__}")
            return
        for key, sub in value.items():
            child = f"{path}.{key}" if path else str(key)
            if key not in shape:
                # Never echo the key itself: an unlisted key's NAME can be the
                # leak (a hostname, an email used as a map key).
                parent = f"{path}." if path else ""
                out.append(
                    f"{parent}<unlisted key>: key is not in the build-record allowlist"
                )
                continue
            _walk(sub, shape[key], child, out, strings)
        return
    if isinstance(shape, list):
        if not isinstance(value, list):
            out.append(f"{where}: expected a list, got {type(value).__name__}")
            return
        for index, item in enumerate(value):
            _walk(item, shape[0], f"{path}[{index}]", out, strings)
        return
    if isinstance(value, dict | list):
        out.append(f"{where}: expected a scalar, got {type(value).__name__}")
        return
    if not _slot_ok(shape, value):
        out.append(f"{where}: not a valid {shape.value} value")
        return
    # The schema id is a fixed literal (``build-record/1`` has the shape of an
    # owner/name pair), already checked exactly; every other string is scanned.
    if isinstance(value, str) and shape is not Slot.SCHEMA:
        strings.append((where, value))


def normalize_for_scan(text: str) -> str:
    """The form every content check reads: NFKC (folds fullwidth and other
    compatibility forms to ASCII), lookalike slashes mapped to ``/``, and
    whitespace around ``/`` removed — so ``acme ∕ secret`` scans as
    ``acme/secret``."""
    folded = unicodedata.normalize("NFKC", text).translate(_LOOKALIKE_SLASHES)
    return _SPACED_SLASH_RE.sub("/", folded)


def _repo_tokens(text: str) -> list[str]:
    """Every ``a/b`` pair in ``text``, lowercased (GitHub names are case-blind)."""
    pairs: list[str] = []
    for run in _PATH_RUN_RE.findall(normalize_for_scan(text)):
        segments = [s.strip(".-") for s in run.split("/")]
        for left, right in zip(segments, segments[1:], strict=False):
            if not left or not right or (left.isdigit() and right.isdigit()):
                continue
            pairs.append(f"{left}/{right}".lower())
    return pairs


def _has_hidden_characters(text: str) -> bool:
    """Format (``Cf``: zero-width space, soft hyphen, word joiner, bidi marks…)
    and control (``Cc``) characters split a token for a regex while rendering
    as nothing, and overlay marks draw a slash that is not one. Every scanned
    string carrying any of them is refused outright — no scan can be trusted
    on it."""
    return any(
        unicodedata.category(ch) in ("Cf", "Cc") or ch in _OVERLAY_MARKS for ch in text
    )


def scanned_strings(document: Any) -> list[tuple[str, str]]:
    """``(slot, value)`` for every string the content scan reads — every
    allowlisted string except the fixed ``schema`` literal."""
    strings: list[tuple[str, str]] = []
    _walk(document, BUILD_RECORD_ALLOWLIST, "", [], strings)
    return strings


def names_token(text: str, name: str) -> bool:
    """Whether normalised ``text`` contains ``name`` as a whole token
    (case-insensitive; bounded by anything that is not a letter or digit)."""
    pattern = rf"(?<![a-z0-9]){re.escape(name.lower())}(?![a-z0-9])"
    return re.search(pattern, normalize_for_scan(text).lower()) is not None


def build_record_violations(document: Any) -> list[str]:
    """Every way ``document`` breaks the allowlist; empty when it is publishable."""
    out: list[str] = []
    strings: list[tuple[str, str]] = []
    _walk(document, BUILD_RECORD_ALLOWLIST, "", out, strings)
    if not isinstance(document, dict):
        return out
    if "schema" not in document:
        out.append(f"schema: required, must be {BUILD_RECORD_SCHEMA!r}")

    product = document.get("product")
    repos = product.get("repos") if isinstance(product, dict) else None
    public_repos = (
        {r.lower() for r in repos if isinstance(r, str)}
        if isinstance(repos, list)
        else set()
    )

    for where, text in strings:
        if _has_hidden_characters(text):
            out.append(f"{where}: contains an invisible, control or overlay character")
            continue
        normalized = normalize_for_scan(text)
        if any(token not in public_repos for token in _repo_tokens(text)):
            out.append(f"{where}: names an owner/name not in product.repos")
        if _UUID_RE.search(normalized):
            out.append(f"{where}: contains a UUID-shaped identifier")
        if _EMAIL_RE.search(normalized):
            out.append(f"{where}: contains an email-shaped identity")

    prs = document.get("prs")
    if isinstance(prs, list):
        for index, pr in enumerate(prs):
            if isinstance(pr, dict) and str(pr.get("repo", "")).lower() not in (
                public_repos
            ):
                out.append(
                    f"prs[{index}].repo: not one of product.repos, so not known public"
                )
    return out


def validate_build_record(document: Any) -> dict[str, Any]:
    """Return ``document`` unchanged when it passes; raise :class:`BuildRecordRejected`."""
    violations = build_record_violations(document)
    if violations:
        raise BuildRecordRejected(violations)
    assert isinstance(document, dict)  # guaranteed by an empty violation list
    return document
