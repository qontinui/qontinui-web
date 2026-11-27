"""The project's own description — coord's intent documents — as an overview
resource.

Plan ``2026-09-20-overview-authoring-layer`` §4: the Summary's text lives in
coord's prompt-document store, not in this database. Rather than special-case
it, it plugs into the resource contract through this adapter, which is what
keeps the contract honest: it has to work against a store we do not own.

What the adapter adds on top of coord's own prompt-document routes:

* **Concurrency.** ``version`` is coord's ``current_version``. A write names
  the version it was built on; the adapter re-reads the document and refuses
  with the server's copy if it has moved. That check is web-side, so a write
  landing in the few milliseconds between the re-read and the PATCH is not
  caught here; the adapter ALSO forwards ``expected_version`` so a coord that
  checks it under its row lock closes that window. (Coord's operator PATCH
  does not check it today; only its agent ``replace`` path does.)

  An ORDER-only edit does not move the version: coord stores ``attrs`` in
  place without versioning, and replaces the object wholesale. The adapter
  therefore merges the one key it owns (``overview_order``) into the attrs it
  has just re-read, rather than trusting the client's copy. That narrows,
  but does not close, the window in which a concurrent attrs write lands
  between this re-read and the PATCH and is overwritten; nothing in coord
  versions attrs, so nothing here can detect it. Closing it needs coord to
  check a version on attrs writes too.

* **Frontmatter stays out of a leader's editor.** Intent documents open with a
  YAML block that agents read (``audience:``, ``consumer_type:``…). The
  resource serves the PROSE as ``body`` and the block as a read-only
  ``frontmatter``; a write replaces the prose and re-attaches the block exactly
  as stored. A business leader never sees, and can never break, the metadata.

* **Provenance is coord's.** Coord stamps ``updated_by`` from the
  authenticated caller and ignores a body-supplied one, so the adapter sends
  none. The overview's own record of who wrote what is ``change_log``.

* **One permission answer.** Coord accepts a prompt-document write only from
  an admin of the tenant, so this resource's rule is ``coord_admin`` — the
  project's ``editing_roles`` cannot widen a store that does not read it.

* **Who outside the team may read it: the ``visibility:`` mark.** Plan
  ``2026-11-26-questions-only-another-party-can-answer-have-no-queue-no-answerer-and-no-visibility``
  Phase 5 (D5). A document's frontmatter key ``visibility: shared`` or
  ``internal`` is served as ``visibility``; no frontmatter, no key, a value
  this module does not know, or the key twice reads ``internal`` — fail
  closed. A caller WITHOUT a team role (``OverviewAccess.team_role``) is
  served only ``shared`` documents: the list leaves the rest out and says
  ``withheld`` (never how many or which), and a get of one answers 404, as for
  a document that does not exist, so its name is not confirmed either. A team
  role reads everything, as before. Coord filters the same way for that
  caller at its own doors (Phase 10); this is the second line. A tenant admin
  sets the mark with ``visibility`` on an update, which splices that one key
  into the stored frontmatter and leaves every other byte as stored.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol
from uuid import UUID

import yaml  # type: ignore[import-untyped]
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from app.api.v1.endpoints.operations import (
    _proxy_coord_get,
    _proxy_coord_patch,
    _proxy_coord_post,
)
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)

#: Coord's INTENT family — what the tenant's product is for. The behavior
#: kinds (``policy`` and the rest) are how agents must act; they belong to the
#: operator console and are deliberately not reachable from the overview.
INTENT_KINDS: tuple[str, ...] = (
    "product_intent",
    "initiative",
    "success_metric",
    "domain_spec",
    "audience_profile",
    "decision_record",
)
IntentKind = Literal[
    "product_intent",
    "initiative",
    "success_metric",
    "domain_spec",
    "audience_profile",
    "decision_record",
]
IntentState = Literal["authored", "skeleton", "unknown", "unreadable"]
#: Who may read a document. ``internal``: the operator's team only.
#: ``shared``: also a member holding only an outside role. Absent means
#: internal.
Visibility = Literal["internal", "shared"]
VISIBILITY_KEY = "visibility"

#: Coord's own name rule for a hand-authored document.
_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
#: A position on the page. Generous, and small enough that nobody mistakes it
#: for anything but a position.
MAX_ORDER = 999
#: Coord refuses nothing below this; the bound exists so a runaway client
#: cannot post a document the page then has to render.
MAX_BODY_CHARS = 200_000

#: The same leading-frontmatter shape the Summary page strips
#: (``frontend/.../overview/_lib/intent.ts`` ``stripFrontmatter``).
_FRONTMATTER = re.compile(r"^\ufeff?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)")


def split_frontmatter(raw: str) -> tuple[str | None, str]:
    """``(frontmatter block or None, prose)``. The block is returned verbatim,
    delimiters included, so re-attaching it reproduces it byte for byte."""
    match = _FRONTMATTER.match(raw)
    if not match:
        return None, raw
    return match.group(0), raw[match.end() :].lstrip()


#: A frontmatter block split into its three parts: the opening delimiter line
#: (an optional BOM included), the YAML between the delimiters, and the closing
#: delimiter with the line ending before it. The block is
#: ``opening + inner + closing``; ``inner`` has no line ending of its own on
#: its last line, because that ending belongs to ``closing``.
_BLOCK_PARTS = re.compile(
    r"\A(?P<opening>\ufeff?---[ \t]*(?P<nl>\r?\n))(?P<inner>[\s\S]*?)"
    r"(?P<closing>\r?\n---[ \t]*(?:\r?\n)?)\Z"
)

_STR_TAG = "tag:yaml.org,2002:str"

#: The longest frontmatter block the parser is asked to read. Real blocks are
#: a few hundred bytes; anything past this reads ``internal`` and is not
#: spliced, so one oversized document cannot cost every list read a parse of
#: it. (Nesting depth is bounded separately: see ``RecursionError`` below.)
MAX_FRONTMATTER_CHARS = 16_000


#: The refusal when no splice both parses and reads back.
NOT_EDITABLE_HERE = (
    "the visibility line cannot be placed in this frontmatter without breaking "
    "it — edit it by hand in the console"
)
#: The refusal for a block the parser is not asked to read, or cannot.
TOO_LARGE_OR_DEEP = "frontmatter too large or deeply nested to edit here"


class FrontmatterNotEditable(ValueError):
    """The frontmatter cannot take a ``visibility:`` key without risk of
    corrupting it: it does not parse as YAML, or it is not a block-style
    mapping. Served as 422, never written around."""


def _top_level_mapping(inner: str) -> yaml.MappingNode | None:
    """The block's YAML as a node tree, read by the YAML parser itself — so a
    ``visibility:`` that is really the second line of a multi-line quoted
    scalar is not mistaken for a key. ``None`` for an empty block (or one of
    comments only). Raises :class:`FrontmatterNotEditable` for anything that
    is not a block-style mapping, or does not parse."""
    if len(inner) > MAX_FRONTMATTER_CHARS:
        raise FrontmatterNotEditable(TOO_LARGE_OR_DEEP)
    try:
        root = yaml.compose(inner, Loader=yaml.SafeLoader)
    except yaml.YAMLError as exc:
        raise FrontmatterNotEditable(
            f"the frontmatter is not valid YAML: {exc}"
        ) from exc
    except RecursionError as exc:
        # PyYAML's composer recurses once per nesting level, so a block nested
        # a few hundred deep exhausts the stack. That is not a YAMLError, and
        # left uncaught it would 500 every list read of the tenant.
        raise FrontmatterNotEditable(TOO_LARGE_OR_DEEP) from exc
    if root is None:
        return None
    if not isinstance(root, yaml.MappingNode) or root.flow_style:
        raise FrontmatterNotEditable(
            "the frontmatter is not a block-style mapping of keys"
        )
    return root


def _visibility_entries(
    root: yaml.MappingNode | None,
) -> list[tuple[yaml.Node, yaml.Node]]:
    """Every TOP-LEVEL ``visibility`` key of the mapping, with its value node.
    Merge keys (``<<: *base``) are not expanded, so a ``visibility`` that only
    arrives through one does not count; coord's serde_yaml agrees."""
    if root is None:
        return []
    return [
        (key, value)
        for key, value in root.value
        if isinstance(key, yaml.ScalarNode)
        and key.tag == _STR_TAG
        and key.value == VISIBILITY_KEY
    ]


def _stored_visibility(frontmatter: str | None) -> tuple[int, str | None]:
    """``(how many top-level visibility keys, the value when exactly one is a
    plain string)``. An unparseable block reads as ``(0, None)`` here — the
    read fails closed; the write refuses separately."""
    if not frontmatter:
        return 0, None
    parts = _BLOCK_PARTS.match(frontmatter)
    if parts is None:
        return 0, None
    try:
        entries = _visibility_entries(_top_level_mapping(parts.group("inner")))
    except FrontmatterNotEditable:
        return 0, None
    if len(entries) != 1:
        return len(entries), None
    value = entries[0][1]
    if isinstance(value, yaml.ScalarNode) and value.tag == _STR_TAG:
        return 1, value.value
    return 1, None


def visibility_of(frontmatter: str | None) -> Visibility:
    """``shared`` only when the block parses as a YAML mapping with exactly one
    top-level ``visibility`` key whose value is the string ``shared``;
    ``internal`` otherwise — no block, a block that does not parse, no key, the
    key twice, an empty or unknown value (fail closed)."""
    count, value = _stored_visibility(frontmatter)
    return "shared" if count == 1 and value == "shared" else "internal"


def _line_span(lines: list[str], key: yaml.Node, value: yaml.Node) -> tuple[int, int]:
    """The ``[first, last)`` line indexes a top-level entry occupies: from its
    key's line through the line its value ends on, indented children of a
    nested value included. A value ending at column 0 ended on the line
    before (the mark sits at the start of the next line).

    For a nested or block-scalar value the parser's end mark lies on the NEXT
    token's line, so blank lines and comment lines between the value and the
    next key would fall inside the span. They belong to what follows, so the
    span is walked back past them and they are kept."""
    first = key.start_mark.line
    end = value.end_mark
    last = end.line if end.column == 0 and end.line > first else end.line + 1
    # An alias value (`visibility: *s`) is the anchored node itself, whose
    # marks lie where the anchor was: never less than the key's own line.
    last = min(max(last, first + 1), len(lines))
    while last - 1 > first:
        text = lines[last - 1].strip()
        if text and not text.startswith("#"):
            break
        last -= 1
    return first, last


def splice_visibility(
    frontmatter: str | None, value: Visibility, nl: str = "\n"
) -> str:
    """The frontmatter block with exactly one top-level ``visibility: <value>``
    line, every other byte as it was.

    * One or more existing top-level ``visibility`` entries: the FIRST entry's
      whole span (its line, and any indented children of a nested value) is
      replaced by the one line; every further duplicate is removed.
    * None: the line is added before the closing delimiter, in the block's own
      line ending.
    * No block at all: a new block holding only that key, in ``nl``.

    Un-sharing whose one-line splice does not take falls back to removing the
    key. Raises :class:`FrontmatterNotEditable` when the block does not parse
    as a block-style mapping, or no result both parses and reads back as
    ``value`` — e.g. the key is anchored, aliased or indented."""
    if not frontmatter:
        return f"---{nl}{VISIBILITY_KEY}: {value}{nl}---{nl}"
    parts = _BLOCK_PARTS.match(frontmatter)
    if parts is None:  # pragma: no cover — split_frontmatter only yields closed blocks
        raise FrontmatterNotEditable("the frontmatter block has no closing delimiter")
    newline = parts.group("nl")
    inner = parts.group("inner")
    closing = parts.group("closing")
    entries = _visibility_entries(_top_level_mapping(inner))
    line = f"{VISIBILITY_KEY}: {value}"
    # The inner lines WITH their endings: the last one borrows the newline
    # that opens the closing delimiter, which is given back below.
    closing_nl = "\r\n" if closing.startswith("\r\n") else "\n"
    lines = (inner + closing_nl).splitlines(keepends=True) if inner else []
    # Canonical fences on every written block: coord reads frontmatter only
    # when line 1 is exactly `---` and the closing line is exactly `---`, so a
    # BOM before the opening fence and trailing blanks on either fence go.
    opening = "---" + newline
    # The line ending after the closing fence is the fence's own, as stored.
    after_fence = closing[len(closing.rstrip("\r\n")) :]
    canonical_closing = closing_nl + "---" + after_fence

    def assemble(replacement: str | None) -> str:
        """The block with every visibility entry removed and, when
        ``replacement`` is given, that one line in the first entry's place
        (or before the closing delimiter when there was none)."""
        if entries:
            spans = [_line_span(lines, k, v) for k, v in entries]
            first_start, first_end = spans[0]
            last_line = lines[first_end - 1]
            ending = last_line[len(last_line.rstrip("\r\n")) :] or newline
            drop: set[int] = set()
            for start, end in spans:
                drop.update(range(start, end))
            rebuilt: list[str] = []
            for index, text in enumerate(lines):
                if index == first_start and replacement is not None:
                    rebuilt.append(replacement + ending)
                if index not in drop:
                    rebuilt.append(text)
            body = "".join(rebuilt)
        else:
            body = "".join(lines) + (
                replacement + closing_nl if replacement is not None else ""
            )
        trimmed = body[: -len(closing_nl)] if body.endswith(closing_nl) else body
        return opening + trimmed + canonical_closing

    result = assemble(line)
    if _parses(result) and visibility_of(result) == value:
        if _stored_visibility(result)[0] == 1:
            return result
    if value == "internal" and entries:
        # Un-sharing: when the one line does not take, remove the key (absent
        # reads internal) — but only into a block that still parses.
        removed = assemble(None)
        if _parses(removed) and visibility_of(removed) == "internal":
            return removed
    # Never a doubled key, never a block that does not parse: coord's own
    # YAML reader refuses a duplicate key on some kinds, and a doubled block
    # would grow by one key on every write.
    raise FrontmatterNotEditable(NOT_EDITABLE_HERE)


def _parses(block: str) -> bool:
    """Whether a frontmatter block reads as a block-style mapping (or is
    empty).

    This is PyYAML, i.e. YAML 1.1. Coord reads with serde_yaml 0.9 (YAML 1.2,
    duplicate keys refused), so it can still refuse a body this passes — `on`
    against `"on"`, say — and that refusal surfaces as 422
    ``rejected_by_store``."""
    parts = _BLOCK_PARTS.match(block)
    if parts is None:
        return False
    try:
        _top_level_mapping(parts.group("inner"))
    except FrontmatterNotEditable:
        return False
    return True


def check_editable(frontmatter: str | None) -> None:
    """Raise :class:`FrontmatterNotEditable` when a stored block cannot take a
    visibility write at all — it is oversized, nested too deeply, or does not
    parse. Such a block reads ``internal``, and a write of EITHER value on it
    is a 422, never a silent no-op."""
    if not frontmatter:
        return
    parts = _BLOCK_PARTS.match(frontmatter)
    if parts is None:  # pragma: no cover — split_frontmatter only yields closed blocks
        raise FrontmatterNotEditable("the frontmatter block has no closing delimiter")
    _top_level_mapping(parts.group("inner"))


def _newline_of(raw: str) -> str:
    return "\r\n" if "\r\n" in raw else "\n"


def splice_visibility_into_body(raw: str, value: Visibility) -> str:
    """A stored document body with its frontmatter's ``visibility:`` set:
    the block is spliced (:func:`splice_visibility`) and everything after it
    is kept byte for byte. A body with no block gets one, in the body's own
    line ending, followed by a blank line, as :func:`join_frontmatter` writes
    it. The block must open the body — coord reads frontmatter only when the
    first line is exactly ``---`` — so a leading BOM is dropped: before or
    after a fence it means nothing."""
    match = _FRONTMATTER.match(raw)
    if not match:
        nl = _newline_of(raw)
        rest = raw[1:] if raw.startswith("\ufeff") else raw
        return f"{splice_visibility(None, value, nl)}{nl}{rest}"
    block = match.group(0)
    return splice_visibility(block, value) + raw[match.end() :]


def join_frontmatter(frontmatter: str | None, prose: str, nl: str | None = None) -> str:
    """The block, a blank line, then the prose. ``nl`` is the line ending the
    join writes (default: the block's own). A BOM at the start of the prose is
    dropped: after a fence it means nothing, and in front of the block it
    would hide the frontmatter from coord, which reads it only when the first
    line is exactly ``---``."""
    if not frontmatter:
        return prose
    nl = nl or _newline_of(frontmatter)
    if prose.startswith("\ufeff"):
        prose = prose[1:]
    block = frontmatter if frontmatter.endswith("\n") else frontmatter + nl
    return f"{block}{nl}{prose}"


def record_id(kind: str, name: str) -> str:
    return f"{kind}:{name}"


def parse_record_id(value: str) -> tuple[str, str]:
    kind, sep, name = value.partition(":")
    if not sep or kind not in INTENT_KINDS or not _NAME.match(name):
        # Not a shape this resource can hold: 404, the same as any id that
        # does not exist.
        raise RecordNotFound(value)
    return kind, name


# ---------------------------------------------------------------------------
# Wire shapes
# ---------------------------------------------------------------------------


class IntentDocumentRead(BaseModel):
    id: str
    kind: IntentKind
    name: str
    #: coord's maintainer-facing note. Not a title — the page titles a
    #: document by its own opening heading.
    description: str | None
    #: The prose, frontmatter removed. Empty for a skeleton on a list read
    #: (its template text is never shown) and for an unreadable document.
    body: str
    #: The YAML block agents read, verbatim; read-only here.
    frontmatter: str | None
    #: Who may read it, from the frontmatter's ``visibility:`` key. Absent,
    #: unknown or repeated reads ``internal`` (:func:`visibility_of`). A
    #: skeleton or unreadable document on a list read reads ``internal``,
    #: since its frontmatter was not read.
    visibility: Visibility = "internal"
    #: The document's position in its section, 1-based. ``None``: the page's
    #: default order.
    overview_order: int | None
    #: ``skeleton`` is coord's unedited template — not the project's intent.
    #: ``unknown`` is a template edited since, on a coord that serves no
    #: verdict. ``unreadable``: listed, but its body failed to load.
    state: IntentState
    error: str | None = None
    #: A ``decision_record``'s own status, when coord parsed one.
    status: str | None = None
    withdrawn: bool = False
    version: int
    updated_at: datetime | None
    updated_by: str | None


class IntentDocumentCreate(BaseModel):
    kind: IntentKind
    name: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=MAX_BODY_CHARS)
    description: str | None = Field(default=None, max_length=2000)
    overview_order: int | None = Field(default=None, ge=1, le=MAX_ORDER)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not _NAME.match(v):
            raise ValueError(
                "name is lowercase words joined by hyphens, e.g. launch-plan"
            )
        return v

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("body cannot be blank")
        return v


class IntentDocumentUpdate(BaseModel):
    """Absent fields are left alone. ``overview_order: null`` returns the
    document to the page's default order; ``body`` cannot be cleared.
    ``visibility`` sets the frontmatter's ``visibility:`` key and nothing else
    in the block; ``visibility: null`` leaves it alone, like an absent field."""

    body: str | None = Field(default=None, min_length=1, max_length=MAX_BODY_CHARS)
    overview_order: int | None = Field(default=None, ge=1, le=MAX_ORDER)
    visibility: Visibility | None = None

    @model_validator(mode="after")
    def _something_and_no_blank_body(self) -> IntentDocumentUpdate:
        meaningful = self.model_fields_set & {"body", "overview_order"}
        if not meaningful and self.visibility is None:
            raise ValueError("give body, overview_order, visibility, or several")
        if "body" in self.model_fields_set and (
            self.body is None or not self.body.strip()
        ):
            raise ValueError("body cannot be cleared, only changed")
        return self


# ---------------------------------------------------------------------------
# Talking to coord
# ---------------------------------------------------------------------------


class CoordDocuments(Protocol):
    """The four coord calls the store makes. The default goes through the
    operations proxy (which forwards the caller's own bearer, so coord
    authorizes the real person); tests substitute a fake."""

    async def list(self, tenant_id: UUID) -> dict[str, Any]: ...

    async def get(self, tenant_id: UUID, kind: str, name: str) -> dict[str, Any]: ...

    async def patch(
        self, tenant_id: UUID, kind: str, name: str, body: dict[str, Any]
    ) -> dict[str, Any]: ...

    async def create(
        self, tenant_id: UUID, kind: str, body: dict[str, Any]
    ) -> dict[str, Any]: ...


class ProxiedCoordDocuments:
    async def list(self, tenant_id: UUID) -> dict[str, Any]:
        result: dict[str, Any] = await _proxy_coord_get(
            "/coord/prompt-documents", tenant_id=tenant_id
        )
        return result

    async def get(self, tenant_id: UUID, kind: str, name: str) -> dict[str, Any]:
        result: dict[str, Any] = await _proxy_coord_get(
            f"/coord/prompt-documents/{kind}/{name}", tenant_id=tenant_id
        )
        return result

    async def patch(
        self, tenant_id: UUID, kind: str, name: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        result: dict[str, Any] = await _proxy_coord_patch(
            f"/coord/prompt-documents/{kind}/{name}", body, tenant_id=tenant_id
        )
        return result

    async def create(
        self, tenant_id: UUID, kind: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        result: dict[str, Any] = await _proxy_coord_post(
            f"/coord/prompt-documents/{kind}", body, tenant_id=tenant_id
        )
        return result


def _unwrap(payload: dict[str, Any]) -> dict[str, Any]:
    """Coord's HTTP routes answer a flat document; some of its doors wrap it
    as ``{"document": {...}, "unedited_seed": …}``. Accept both."""
    inner = payload.get("document")
    if isinstance(inner, dict):
        return {**inner, **{k: v for k, v in payload.items() if k != "document"}}
    return payload


def _state(doc: dict[str, Any]) -> IntentState:
    """Coord's served ``unedited_seed`` verdict when present; otherwise the
    version/origin fallback coord documents for builds that predate it.
    Mirrors ``classifyIntent`` in the Summary page's ``intent.ts``."""
    seed = doc.get("unedited_seed")
    if isinstance(seed, bool):
        return "skeleton" if seed else "authored"
    if doc.get("default_source") is None:
        return "authored"
    if int(doc.get("current_version") or 0) <= 1:
        return "skeleton"
    return "unknown"


def _order(doc: dict[str, Any]) -> int | None:
    attrs = doc.get("attrs")
    if not isinstance(attrs, dict):
        return None
    value = attrs.get("overview_order")
    # bool is an int in Python; a stray `true` is not a position.
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value)


def to_read(
    doc: dict[str, Any], *, state: IntentState | None = None, error: str | None = None
) -> IntentDocumentRead:
    doc = _unwrap(doc)
    resolved = state or _state(doc)
    frontmatter, prose = split_frontmatter(doc.get("body") or "")
    return IntentDocumentRead(
        id=record_id(doc["kind"], doc["name"]),
        kind=doc["kind"],
        name=doc["name"],
        description=doc.get("description"),
        body=prose,
        frontmatter=frontmatter,
        visibility=visibility_of(frontmatter),
        overview_order=_order(doc),
        state=resolved,
        error=error,
        status=doc.get("status"),
        withdrawn=bool(doc.get("withdrawn")),
        version=int(doc.get("current_version") or 0),
        updated_at=doc.get("updated_at"),
        updated_by=doc.get("updated_by"),
    )


def _coord_error(exc: HTTPException, record: str) -> Exception:
    """Map a coord refusal onto the contract's errors. Transport failures
    (502/504) are not refusals and are re-raised unchanged by the caller."""
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    if exc.status_code == 404:
        return RecordNotFound(record)
    if exc.status_code == 403:
        return StoreRefused(
            403,
            "not_permitted",
            "Only an administrator of this project can change its description.",
        )
    if exc.status_code == 409:
        return StoreRefused(
            409, "name_taken", "A document with that name already exists."
        )
    if exc.status_code in (400, 422):
        return StoreRefused(422, "rejected_by_store", detail)
    return exc


def _visibility_changes(frontmatter: str | None, value: Visibility) -> bool:
    """Whether setting ``value`` changes what is stored. Already exactly one
    top-level key holding that string: no. ``internal`` on a document with no
    key: no — absent already reads internal, and a write would only move the
    version. Anything else (duplicates, an empty or unknown value): yes, so the
    splice leaves exactly one key. A ``shared`` mark behind non-canonical
    fences is rewritten too: coord does not read such a block as frontmatter
    (its validation and any frontmatter reader skip it), so the rewrite puts
    the block where coord sees it."""
    count, stored = _stored_visibility(frontmatter)
    if count == 1 and stored == value:
        return value == "shared" and not _fences_canonical(frontmatter)
    return not (value == "internal" and count == 0)


#: The fences exactly as coord reads them: no BOM, nothing after `---`.
_CANONICAL_CLOSING = re.compile(r"\r?\n---(?:\r?\n)?")


def _fences_canonical(frontmatter: str | None) -> bool:
    parts = _BLOCK_PARTS.match(frontmatter or "")
    if parts is None:
        return False
    return parts.group("opening") in ("---\n", "---\r\n") and bool(
        _CANONICAL_CLOSING.fullmatch(parts.group("closing"))
    )


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------


#: How long after a create its retry may still adopt it. A client retries a
#: lost answer within seconds; a person re-clicking Save within minutes.
ADOPT_WINDOW = timedelta(minutes=15)


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


#: How many document bodies the list reads from coord at once. A tenant can
#: hold dozens of intent documents; an unbounded fan-out would open that many
#: concurrent requests against coord for one page load.
LIST_CONCURRENCY = 8


class IntentDocumentStore:
    def __init__(self, coord: CoordDocuments) -> None:
        self.coord = coord

    async def _get_raw(self, ctx: StoreContext, kind: str, name: str) -> dict[str, Any]:
        try:
            return _unwrap(await self.coord.get(ctx.access.tenant_id, kind, name))
        except HTTPException as exc:
            raise _coord_error(exc, record_id(kind, name)) from exc

    async def _patch(
        self, ctx: StoreContext, kind: str, name: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """PATCH, then the document as it now stands. An empty 2xx body (which
        the write proxy maps to ``None``) is answered by re-reading, never by
        failing a write that has already landed."""
        result = await self.coord.patch(ctx.access.tenant_id, kind, name, body)
        if not result:
            return await self._get_raw(ctx, kind, name)
        return _unwrap(result)

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        wanted_kinds = [k for k in filters.get("kind", []) if k in INTENT_KINDS]
        kinds = set(wanted_kinds) if filters.get("kind") else set(INTENT_KINDS)
        team = ctx.access.team_role
        listing = await self.coord.list(ctx.access.tenant_id)
        intent_rows = [
            d
            for d in listing.get("documents") or []
            if isinstance(d, dict) and d.get("kind") in INTENT_KINDS
        ]
        rows = [d for d in intent_rows if d.get("kind") in kinds]
        # For a caller without a team role, `withheld` is judged over EVERY
        # intent kind, not just the kinds asked for: it is then one answer for
        # the tenant, so filtering by kind cannot reveal which kinds hold
        # documents that are not shared with them.
        other_rows = [d for d in intent_rows if d.get("kind") not in kinds]
        gate = asyncio.Semaphore(LIST_CONCURRENCY)

        async def one(row: dict[str, Any]) -> IntentDocumentRead:
            # An untouched skeleton's body is template text nobody should read
            # as the project's intent, so it is never fetched.
            if _state(row) == "skeleton":
                return to_read({**row, "body": ""}, state="skeleton")
            try:
                async with gate:
                    return to_read(await self._get_raw(ctx, row["kind"], row["name"]))
            except (RecordNotFound, StoreRefused, HTTPException) as exc:
                # One unreadable body marks only its own document; it never
                # blanks the list or reads as "not written".
                return to_read(
                    {**row, "body": ""},
                    state="unreadable",
                    error=str(exc) or "unreadable",
                )

        items = list(await asyncio.gather(*(one(r) for r in rows)))
        degraded = listing.get("degraded")
        withheld = False
        if not team:
            # A caller without a team role sees only what is marked for them.
            # A skeleton or an unreadable document reads internal (its
            # frontmatter was not read), so it is withheld too — never shown
            # as "not written" to someone who could not have seen it anyway.
            shared = [d for d in items if d.visibility == "shared"]
            withheld = len(shared) != len(items)
            items = shared
            # The other kinds count too. Every one of their rows is read,
            # concurrently under the same `gate` (LIST_CONCURRENCY) as the
            # list itself, with no early exit, so the answer's timing does not
            # depend on where an unshared document sits.
            if other_rows:
                others = await asyncio.gather(*(one(r) for r in other_rows))
                withheld = withheld or any(d.visibility != "shared" for d in others)
        served: list[BaseModel] = list(items)
        return ListResult(
            items=served, degraded=degraded if degraded else None, withheld=withheld
        )

    async def get(self, ctx: StoreContext, record: str) -> IntentDocumentRead:
        kind, name = parse_record_id(record)
        document = to_read(await self._get_raw(ctx, kind, name))
        if not ctx.access.team_role and document.visibility != "shared":
            # 404, as for a document that does not exist: a 403 would confirm
            # the name to someone it is not shared with.
            raise RecordNotFound(record)
        return document

    async def _place(
        self, ctx: StoreContext, doc: dict[str, Any], order: int | None
    ) -> dict[str, Any]:
        """Set ``overview_order`` on a document when it differs, merging into
        its stored attrs. Coord's create takes no attrs, so a new document's
        position is always this follow-up write (which moves no version)."""
        if order is None or _order(doc) == order:
            return doc
        attrs = dict(doc.get("attrs") or {})
        attrs["overview_order"] = order
        try:
            return await self._patch(ctx, doc["kind"], doc["name"], {"attrs": attrs})
        except HTTPException as exc:
            raise _coord_error(exc, record_id(doc["kind"], doc["name"])) from exc

    async def create(
        self, ctx: StoreContext, payload: IntentDocumentCreate
    ) -> IntentDocumentRead:
        body: dict[str, Any] = {"name": payload.name, "body": payload.body}
        if payload.description is not None:
            body["description"] = payload.description
        try:
            created = _unwrap(
                await self.coord.create(ctx.access.tenant_id, payload.kind, body)
            )
        except HTTPException as exc:
            raise _coord_error(exc, record_id(payload.kind, payload.name)) from exc
        return to_read(await self._place(ctx, created, payload.overview_order))

    async def adopt_existing(
        self,
        ctx: StoreContext,
        payload: IntentDocumentCreate,
        created_through_overview: Callable[[str], Awaitable[bool]],
    ) -> IntentDocumentRead | None:
        """The record a retried create already made, or ``None``.

        Called only for a create carrying an Idempotency-Key whose name coord
        says is taken. The usual cause is that an earlier attempt with the same
        key DID land and its answer was lost (a 504 from the proxy means "may
        have been applied"), so its change-log row — which is what a replay
        normally finds — was never written. A document at that name with
        exactly the body this create carries is that record, and adopting it is
        what an idempotent create owes the caller.

        Every condition below must hold, because adopting stamps the caller as
        the document's creator in the change log and sets its position:

        * the body is exactly this create's body;
        * it is still at version 1 — nobody has edited it since it was made;
        * it was made within :data:`ADOPT_WINDOW` — a retry follows its lost
          attempt within minutes, not days;
        * the overview has no ``create`` on record for it — a create made
          through the overview under ANOTHER key has its row, and is somebody
          else's (``created_through_overview`` asks the change log).

        Anything else is somebody else's document, and the create stays refused.
        """
        try:
            existing = await self._get_raw(ctx, payload.kind, payload.name)
        except (RecordNotFound, StoreRefused):
            return None
        if (existing.get("body") or "") != payload.body:
            return None
        if int(existing.get("current_version") or 0) != 1:
            return None
        made = _parse_time(existing.get("updated_at"))
        if made is None or datetime.now(UTC) - made > ADOPT_WINDOW:
            return None
        if await created_through_overview(record_id(payload.kind, payload.name)):
            return None
        return to_read(await self._place(ctx, existing, payload.overview_order))

    async def update(
        self,
        ctx: StoreContext,
        record: str,
        payload: IntentDocumentUpdate,
        expected_version: int,
    ) -> tuple[IntentDocumentRead, IntentDocumentRead]:
        kind, name = parse_record_id(record)
        current = await self._get_raw(ctx, kind, name)
        before = to_read(current)
        if before.version != expected_version:
            raise StaleVersion(before)

        patch: dict[str, Any] = {
            # Ignored by a coord that does not check it; closes the window
            # between the re-read above and this write on one that does.
            "expected_version": expected_version,
        }
        fields = payload.model_fields_set
        # Compared as PROSE: the stored raw text may space its frontmatter
        # differently from how it is re-joined, and a save that changes no
        # prose must not move the version or write an audit row.
        if (
            "body" in fields
            and payload.body is not None
            and payload.body != before.body
        ):
            patch["body"] = join_frontmatter(before.frontmatter, payload.body)
            patch["change_description"] = "Edited on the Project Overview"
        if (
            "overview_order" in fields
            and payload.overview_order != before.overview_order
        ):
            attrs = dict(current.get("attrs") or {})
            if payload.overview_order is None:
                attrs.pop("overview_order", None)
            else:
                attrs["overview_order"] = payload.overview_order
            patch["attrs"] = attrs
        if "visibility" in fields and payload.visibility is not None:
            # A block the parser cannot read (oversized, nested too deeply,
            # not YAML) reads internal; a write of EITHER value on it is a
            # 422, never a silent no-op that looks like it landed.
            try:
                check_editable(before.frontmatter)
            except FrontmatterNotEditable as exc:
                raise StoreRefused(422, "frontmatter_not_editable", str(exc)) from exc
        if (
            "visibility" in fields
            and payload.visibility is not None
            and _visibility_changes(before.frontmatter, payload.visibility)
        ):
            # The line ending the stored document uses, else the new prose's.
            stored = current.get("body") or ""
            nl = _newline_of(stored if "\n" in stored else payload.body or "")
            try:
                if "body" in patch:
                    # The prose changes too: re-join it to the spliced block.
                    patch["body"] = join_frontmatter(
                        splice_visibility(before.frontmatter, payload.visibility, nl),
                        payload.body or "",
                        nl,
                    )
                else:
                    # Only the mark changes: splice into the body AS STORED,
                    # so every byte outside that one key is kept.
                    patch["body"] = splice_visibility_into_body(
                        current.get("body") or "", payload.visibility
                    )
            except FrontmatterNotEditable as exc:
                raise StoreRefused(422, "frontmatter_not_editable", str(exc)) from exc
            patch["change_description"] = (
                patch.get("change_description", "Edited on the Project Overview")
                + f"; visibility set to {payload.visibility}"
            )
        if "body" not in patch and "attrs" not in patch:
            return before, before  # nothing changed; no write, no version move

        try:
            updated = await self._patch(ctx, kind, name, patch)
        except HTTPException as exc:
            if exc.status_code == 409:
                # A coord that checks `expected_version` refused: re-read so
                # the caller gets the server's copy, as the contract promises.
                raise StaleVersion(
                    to_read(await self._get_raw(ctx, kind, name))
                ) from exc
            raise _coord_error(exc, record) from exc
        return before, to_read(updated)

    async def delete(
        self, ctx: StoreContext, record: str, expected_version: int
    ) -> IntentDocumentRead:
        # Coord has no delete for prompt documents (a decision record is
        # WITHDRAWN, keeping its reasoning as evidence); the spec does not
        # offer the verb, so the router never calls this.
        raise StoreRefused(405, "not_supported", "Intent documents cannot be deleted.")


def intent_document_store() -> IntentDocumentStore:
    """FastAPI dependency. Tests override it with a fake coord."""
    return IntentDocumentStore(ProxiedCoordDocuments())
