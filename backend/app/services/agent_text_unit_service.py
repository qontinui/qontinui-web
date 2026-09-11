"""
Agent text-unit service — CRUD + append-only version history for the fleet's
``.claude/`` corpus, stored as one kind-discriminated bundle of text files.

A unit is ``(kind, name)`` plus a ``files`` map of *relative path → text*. A
``command`` is the degenerate single-entry case; a ``skill`` carries
``SKILL.md`` plus siblings. See ``app.models.agent_text_unit`` for the shape and
for why the unique key is a partial-index pair rather than a three-column
``UNIQUE``.

Three layers live in one table and this service addresses them by the
``organization_id`` it is handed plus the ``published_by_version`` discriminator:

* ``organization_id is None`` — the **fleet default** layer. Fleet-wide, so the
  API gates writes to it on superuser; reads are open to any member (that is
  what "fleet default" means).
* ``organization_id is not None`` and ``published_by_version IS NULL`` — that
  **account's override**. Every query is filtered by it, so one account can
  never read or write another's row.
* ``organization_id is not None`` and ``published_by_version IS NOT NULL`` —
  the **embedded default** the account's runner published
  (``publish_defaults`` / ``get_defaults``). Org-scoped like an override, but
  a DISPLAY baseline rather than a provisioning input: the list projections
  the runner reads never fold it in, and the layer-addressed CRUD above never
  sees it. ``get_unit`` alone falls through to it, as the last rung of the
  resolved read, and reports ``source="embedded"`` when it does.

Every layer-addressed query carries ``_stored_layer`` — the predicate that
excludes the embedded rows. An override lookup that forgot it would find the
published default of the same name and edit THAT.

Version semantics mirror ``version_history_service.py`` unchanged from the
agent-command original: every write APPENDS a version with
``version_number = latest + 1`` (or 1) and moves the head; a revert writes a NEW
version whose ``files`` equal the target's, stamped with ``restored_from``.
History rows are never mutated or deleted.

Write-boundary validation lives here
------------------------------------

``validate_unit_name`` / ``validate_kind`` / ``validate_files`` /
``validate_provenance`` run before anything is persisted. The runner validates
again when it writes the map to disk, but that is a second line: **a corpus
store that accepts a traversal path is itself the defect**, so the store
refuses one.

Importing a corpus
------------------

``import_units`` loads a whole ``.claude/`` tree into one layer and is the ONLY
write path that can decide *not* to write: it compares the canonical
``files``-map digest on both sides and appends a version only for a unit whose
text actually changed. Everything else here appends unconditionally, which is
correct for an editor and would be a wall of noise for a re-run importer. The
CLI over it is ``backend/scripts/import_agent_text_units.py``.
"""

import hashlib
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from packaging.version import InvalidVersion, Version
from pydantic import BaseModel, ConfigDict, Field
from qontinui_schemas.generated.per_type.agent_text_unit_default import (
    AgentTextUnitDefault,
    AgentTextUnitKind,
)
from sqlalchemy import ColumnElement, Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.agent_text_unit import (
    KIND_COMMAND,
    AgentTextUnit,
    AgentTextUnitVersion,
    entrypoint_path,
)

# =============================================================================
# Write-boundary limits
# =============================================================================
#
# Grounded in the corpus these bounds have to carry (measured 2026-08-22 over
# `qontinui-claude-config/.claude/`): 79 commands / 1.61 MB, largest single body
# `merge-train-steward.md` at 154 KB; 9 skills / 12 files / 193 KB, largest
# single file `coord-revive/coord-revive.sh` at 54.5 KB, largest skill 3 files.
# Never hardcode those counts as expectations — they are a timestamp — but the
# limits below are sized with real headroom over them.

#: Per-file cap. Matches the runner's `agent_commands::MAX_BODY_BYTES` so a unit
#: that this store accepts cannot be one the runner then refuses.
MAX_FILE_BYTES = 1024 * 1024

#: Cap across the whole map. Per-file caps alone do not bound a bundle.
MAX_UNIT_BYTES = 4 * 1024 * 1024

MAX_FILES_PER_UNIT = 64
MAX_PATH_BYTES = 255
MAX_PATH_SEGMENTS = 8
MAX_NAME_LENGTH = 64

#: Reserved device stems on Windows — a file named `con.md` or `aux` is not
#: creatable there. Byte-identical to `WINDOWS_RESERVED_STEMS` in
#: `qontinui-schemas/rust/src/agent_commands.rs`.
WINDOWS_RESERVED_STEMS = frozenset(
    {
        "con",
        "prn",
        "aux",
        "nul",
        *(f"com{i}" for i in range(1, 10)),
        *(f"lpt{i}" for i in range(1, 10)),
    }
)

#: Cap on `source_path`. It is a repo-relative path, so it is bounded by the
#: same order of magnitude as a file path, with headroom.
MAX_SOURCE_PATH_BYTES = 1024

#: Cap on the `names` selector both list projections accept. Matches the list
#: routes' own `limit` ceiling: a caller cannot name more units than one page
#: could return them, so the selector can never quietly widen a request past
#: the pagination the client already agreed to.
MAX_NAMES_PER_QUERY = 500

#: Bounds on ONE publish of the embedded layer (`publish_defaults`). The
#: per-file and per-unit caps above still apply to every unit in the roster;
#: these bound the roster itself, which the per-unit caps alone do not. Sized
#: against the measurement in the plan's Risk 3: the seven embedded commands
#: total ~323 KB, and the whole shipped corpus — commands, skills AND agents,
#: should the other two bundles ever be published — is 87 units / 1.92 MB. Both
#: bounds leave that headroom so publishing skills later is adding a source,
#: not re-negotiating the endpoint.
MAX_PUBLISH_UNITS = 512
MAX_PUBLISH_BYTES = 8 * 1024 * 1024

_NAME_RE = re.compile(r"^_?[a-z0-9][a-z0-9-]*$")
_KIND_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_DRIVE_LETTER_RE = re.compile(r"^[A-Za-z]:")
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class AgentTextUnitValidationError(ValueError):
    """A write was refused at the corpus boundary."""


class AgentTextUnitDefaultsRejected(AgentTextUnitValidationError):
    """A publish of the embedded layer was refused, with a TYPED reason.

    ``reason`` is a stable token a client can branch on
    (``checksum_mismatch``, ``version_mismatch``, ``invalid_unit``, …) and
    ``unit`` names the ``kind/name`` it applies to when there is one. This is
    the malformed-publish arm; the *older-than-stored* case is deliberately not
    an error — an old device is not a fault — and is answered as a normal
    ``accepted: false`` by ``publish_defaults`` instead.
    """

    def __init__(self, reason: str, message: str, unit: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason
        self.unit = unit
        self.message = message

    def detail(self) -> dict[str, str | None]:
        """The response body shape the API returns for this refusal."""
        return {"reason": self.reason, "unit": self.unit, "message": self.message}


# =============================================================================
# Validation
# =============================================================================


def validate_kind(kind: str) -> None:
    """``kind`` is a widenable discriminator, not an enum — but it is still a
    path-adjacent identifier, so it is constrained to a lowercase slug."""
    if not (1 <= len(kind) <= MAX_NAME_LENGTH) or not _KIND_RE.match(kind):
        raise AgentTextUnitValidationError(
            f"Invalid kind {kind!r}: expected 1-{MAX_NAME_LENGTH} chars matching "
            "[a-z][a-z0-9_]*"
        )


def validate_unit_name(name: str) -> None:
    """Validate a unit slug before it is persisted or turned into a path.

    Same shape as ``validate_agent_command_name`` in
    ``qontinui-schemas/rust/src/agent_commands.rs`` — 1-64 chars, lowercase
    ASCII letters / digits / hyphens, and no Windows reserved device stem —
    with **one deliberate widening**: a single leading underscore is allowed.

    That underscore is the corpus's own marker for a copy-source spec
    (``_gate-registration``, ``_loop-control``): text the corpus must carry
    because other units paste from it, but which is not an invocable slash
    command. The model refuses to mark such a unit invocable (see
    ``ck_agent_text_unit_underscore_not_invocable``), so widening the name rule
    here does not widen what can be invoked.
    """
    if not (1 <= len(name) <= MAX_NAME_LENGTH) or not _NAME_RE.match(name):
        raise AgentTextUnitValidationError(
            f"Invalid unit name {name!r}: expected 1-{MAX_NAME_LENGTH} chars of "
            "[a-z0-9-] with an optional leading underscore"
        )
    if name.lstrip("_").lower() in WINDOWS_RESERVED_STEMS:
        raise AgentTextUnitValidationError(
            f"Invalid unit name {name!r}: reserved device name on Windows"
        )


def validate_names_selector(names: Sequence[str]) -> None:
    """Validate the ``names`` READ selector both list projections accept.

    Every stored name passed ``validate_unit_name`` on write, so a selector
    entry that fails it can match nothing — refusing it is strictly more useful
    than returning a silently short list, which a client would read as "that
    unit is gone from the corpus" and act on.
    """
    if len(names) > MAX_NAMES_PER_QUERY:
        raise AgentTextUnitValidationError(
            f"Too many names selected ({len(names)} > {MAX_NAMES_PER_QUERY})"
        )
    for name in names:
        validate_unit_name(name)


def validate_relative_path(path: str) -> None:
    """Refuse anything that is not a plain relative path inside the unit dir.

    Rejected, each because it lets a write escape ``<target>/<name>/``:
    absolute paths, drive letters (``C:``), UNC-ish leading separators,
    backslashes (a Windows separator that ``..\\x`` would otherwise smuggle
    through a forward-slash-only check), ``.``/``..`` segments, empty segments,
    NUL and control characters, and segments Windows silently rewrites (a
    trailing dot or space, a reserved device stem).
    """
    if not path:
        raise AgentTextUnitValidationError("Empty file path")
    encoded = path.encode("utf-8")
    if len(encoded) > MAX_PATH_BYTES:
        raise AgentTextUnitValidationError(
            f"File path too long ({len(encoded)} > {MAX_PATH_BYTES} bytes): {path!r}"
        )
    if "\\" in path:
        raise AgentTextUnitValidationError(
            f"File path must use '/' separators, not '\\': {path!r}"
        )
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in path):
        raise AgentTextUnitValidationError(
            f"File path contains a control character: {path!r}"
        )
    if path.startswith("/"):
        raise AgentTextUnitValidationError(f"File path must be relative: {path!r}")
    if _DRIVE_LETTER_RE.match(path):
        raise AgentTextUnitValidationError(
            f"File path must not carry a drive letter: {path!r}"
        )

    segments = path.split("/")
    if len(segments) > MAX_PATH_SEGMENTS:
        raise AgentTextUnitValidationError(
            f"File path is nested too deeply (> {MAX_PATH_SEGMENTS} segments): {path!r}"
        )
    for segment in segments:
        if not segment:
            raise AgentTextUnitValidationError(
                f"File path has an empty segment: {path!r}"
            )
        if segment in (".", ".."):
            raise AgentTextUnitValidationError(
                f"File path has a '{segment}' segment: {path!r}"
            )
        if segment != segment.strip():
            raise AgentTextUnitValidationError(
                f"File path segment has leading/trailing whitespace: {path!r}"
            )
        if segment.endswith("."):
            raise AgentTextUnitValidationError(
                f"File path segment ends with '.': {path!r}"
            )
        if segment.split(".", 1)[0].lower() in WINDOWS_RESERVED_STEMS:
            raise AgentTextUnitValidationError(
                f"File path segment is a reserved device name on Windows: {path!r}"
            )


def validate_provenance(source_path: str | None, source_commit: str | None) -> None:
    """Validate the two IMPORT-provenance fields.

    ⚠️ **Neither is the ``source`` field on ``AgentTextUnitResponse``.** That one
    names the resolution LAYER a row was served from (``"user"`` / ``"fleet"``)
    and is computed, never supplied. These two name the config repo the text was
    imported FROM, and they are supplied by whoever wrote the row. The names are
    adjacent because ``source_path`` is already this backend's word for exactly
    this concept (``agent.work_artifacts.source_path``); the canonical Rust type
    (``qontinui-schemas`` ``agent_text_units.rs``) carries the same warning at
    the same two fields.

    ``source_path`` must be **repo-relative** — an absolute path or a drive
    letter would pin one machine's disk layout into account data, and a
    traversal segment would make the value unusable as a display path. It is a
    provenance label, never opened, so this is a shape rule rather than a
    filesystem boundary; it still refuses the shapes that could be mistaken for
    one.

    ``source_commit`` is a full 40-char lowercase SHA or ``None``. NOT an
    abbreviation and NOT a sentinel: "the text does not correspond to a commit"
    is spelled ``None`` (a console-authored unit, or an import from a dirty
    tree), so a consumer never has to parse a magic string. The DB CHECK
    ``ck_agent_text_unit_source_commit_sha`` enforces the same rule one layer
    down.
    """
    if source_path is not None:
        if not source_path.strip():
            raise AgentTextUnitValidationError(
                "source_path must be a path or omitted, not blank"
            )
        if len(source_path.encode("utf-8")) > MAX_SOURCE_PATH_BYTES:
            raise AgentTextUnitValidationError(
                f"source_path too long (> {MAX_SOURCE_PATH_BYTES} bytes)"
            )
        if any(ord(c) < 0x20 or ord(c) == 0x7F for c in source_path):
            raise AgentTextUnitValidationError(
                f"source_path contains a control character: {source_path!r}"
            )
        if source_path.startswith("/") or _DRIVE_LETTER_RE.match(source_path):
            raise AgentTextUnitValidationError(
                f"source_path must be repo-relative, not absolute: {source_path!r}"
            )
        if "\\" in source_path:
            raise AgentTextUnitValidationError(
                f"source_path must use '/' separators, not '\\': {source_path!r}"
            )
        if any(seg in (".", "..") for seg in source_path.split("/")):
            raise AgentTextUnitValidationError(
                f"source_path has a '.' or '..' segment: {source_path!r}"
            )

    if source_commit is not None and not _COMMIT_RE.match(source_commit):
        raise AgentTextUnitValidationError(
            f"source_commit must be a full 40-char lowercase SHA or omitted; "
            f"got {source_commit!r}"
        )


def validate_files(kind: str, name: str, files: Mapping[str, str]) -> None:
    """Validate the whole map: paths, per-file size, total size, and that the
    unit's entrypoint is actually present."""
    if not files:
        raise AgentTextUnitValidationError("A text unit must carry at least one file")
    if len(files) > MAX_FILES_PER_UNIT:
        raise AgentTextUnitValidationError(
            f"Too many files ({len(files)} > {MAX_FILES_PER_UNIT})"
        )

    total = 0
    for path, content in files.items():
        validate_relative_path(path)
        if not isinstance(content, str):
            raise AgentTextUnitValidationError(
                f"File content must be text: {path!r} is {type(content).__name__}"
            )
        # Mirrors the runner's `validate_override` empty-body rejection: a blank
        # file in a corpus is indistinguishable from a truncation bug, and a
        # blank override that shadowed a working default is the exact failure
        # the fail-soft chain exists to avoid.
        if not content.strip():
            raise AgentTextUnitValidationError(f"File is blank: {path!r}")
        size = len(content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise AgentTextUnitValidationError(
                f"File too large ({size} > {MAX_FILE_BYTES} bytes): {path!r}"
            )
        total += size

    if total > MAX_UNIT_BYTES:
        raise AgentTextUnitValidationError(
            f"Text unit too large ({total} > {MAX_UNIT_BYTES} bytes)"
        )

    entrypoint = entrypoint_path(kind, name)
    if entrypoint not in files:
        raise AgentTextUnitValidationError(
            f"A {kind!r} unit must carry its entrypoint {entrypoint!r}; "
            f"got {sorted(files)}"
        )


# =============================================================================
# Checksums
# =============================================================================


def compute_body_checksum(body: str) -> str:
    """Canonical **single-body** checksum: ``"sha256-<hex>"`` over the
    LF-normalized body.

    This MUST stay byte-identical to ``agent_command_checksum`` in
    ``qontinui-schemas/rust/src/agent_commands.rs`` — the canonical definition
    for the legacy ``/api/v1/agent-commands`` wire, which a not-yet-rebuilt
    runner still reads. Two things are load-bearing and neither is the obvious
    default:

    * **CR-stripping.** The body crosses Postgres, JSON and a Windows
      filesystem before any two checksums are compared. A single CRLF hop
      would report an unchanged command as changed — which is the only thing
      this field exists to detect.
    * **The ``sha256-`` prefix.** It names the algorithm inline, so a future
      change is distinguishable rather than silently reinterpreted.

    Deliberately NOT the bare ``hashlib.sha256(body).hexdigest()`` used by
    ``memory_store._content_hash`` — that rule is for a different content type
    that never crosses a Windows filesystem.

    This is **not** what a unit's stored ``checksum`` column holds; see
    ``compute_files_checksum``. It survives because the legacy wire shape does.
    """
    normalized = body.replace("\r", "")
    return f"sha256-{hashlib.sha256(normalized.encode('utf-8')).hexdigest()}"


def compute_files_checksum(files: Mapping[str, str]) -> str:
    """Canonical checksum over a whole ``files`` map: ``"sha256-<hex>"``.

    A map has no inherent key order, so a digest over it is only meaningful
    once a canonical serialization is *defined*. If it is not, Phase 5's
    idempotent re-import — which keys "did the text change?" off this value —
    writes a spurious version bump on every run.

    ``agent-text-unit-files/v1`` — the canonical form, stated precisely so any
    other writing surface can reproduce it byte for byte:

    1. Take the entries as ``(path, text)`` pairs.
    2. ``text`` is CR-stripped (every ``\\r`` removed) then UTF-8 encoded, for
       exactly the reason ``compute_body_checksum`` gives. ``path`` is UTF-8
       encoded as-is — it can contain no ``\\r`` because
       ``validate_relative_path`` rejects control characters.
    3. Sort the pairs by the **raw UTF-8 bytes of ``path``**, ascending. Not by
       a locale collation, not by a Unicode normalization: byte order, which is
       total and identical in every language. (Paths are unique within a map,
       so the order is total without a tiebreaker.)
    4. Concatenate, for each pair in that order::

           ascii_decimal(len(path_bytes)) b"\\n" path_bytes
           ascii_decimal(len(text_bytes)) b"\\n" text_bytes

    5. The digest is ``"sha256-" + hex(sha256(that byte stream))``.

    Length-framing is what makes the encoding **injective**: every field is a
    decimal length, a newline, then exactly that many bytes, so the stream
    parses back to exactly one sorted pair list and no two distinct maps can
    collide. A naive ``"\\n".join(f"{p}\\n{t}")`` does not have that property —
    a path or a body containing the separator forges another map's stream.

    Note this does **not** reduce to ``compute_body_checksum`` for a
    single-entry map, and must not: ``{"a.md": X}`` and ``{"b.md": X}`` are
    different units and a digest that conflated them would defeat the point.

    **Phase 1 reconciliation.** As of 2026-08-24 ``qontinui-schemas`` carries no
    ``AgentTextUnit`` type yet (grepped: zero hits across the crate, its TS and
    its Python bindings), so this is the *first* statement of the canonical
    form. A Rust ``agent_text_unit_files_checksum`` must match the five steps
    above exactly; the conformance vectors in
    ``backend/tests/test_agent_text_units_db.py`` are the fixture to port.
    """
    hasher = hashlib.sha256()
    for path in sorted(files, key=lambda p: p.encode("utf-8")):
        path_bytes = path.encode("utf-8")
        text_bytes = files[path].replace("\r", "").encode("utf-8")
        hasher.update(str(len(path_bytes)).encode("ascii"))
        hasher.update(b"\n")
        hasher.update(path_bytes)
        hasher.update(str(len(text_bytes)).encode("ascii"))
        hasher.update(b"\n")
        hasher.update(text_bytes)
    return f"sha256-{hasher.hexdigest()}"


# =============================================================================
# Pydantic Schemas
# =============================================================================


class AgentTextUnitCreate(BaseModel):
    """Request to create (or replace) a text unit."""

    kind: str = KIND_COMMAND
    name: str
    files: dict[str, str]
    change_description: str | None = None
    is_shared: bool = False
    is_invocable: bool = True
    #: Import provenance — see ``validate_provenance``. Omitted by the console
    #: (which authors text rather than importing it), which is exactly why a
    #: console save CLEARS whatever an earlier import recorded: the stored text
    #: is no longer a copy of that source.
    source_path: str | None = None
    source_commit: str | None = None


class RevertRequest(BaseModel):
    """Revert a unit to the content of an earlier version.

    Defined once and shared by both the text-unit API and the legacy
    ``/agent-commands`` alias — two identical models under one name would fork
    the published OpenAPI component into two qualified names for no gain.
    """

    version_number: int = Field(..., ge=1)


class AgentTextUnitUpdate(BaseModel):
    """Request to update a text unit. All fields optional."""

    files: dict[str, str] | None = None
    change_description: str | None = None
    is_shared: bool | None = None
    is_invocable: bool | None = None


class AgentTextUnitResponse(BaseModel):
    """Response for one text unit."""

    id: str
    organization_id: str | None = None
    created_by_user_id: str | None = None
    kind: str
    name: str
    files: dict[str, str]
    entrypoint: str
    checksum: str | None = None
    is_shared: bool = False
    is_invocable: bool = True
    current_version: int
    #: Which layer this row came from — ``"user"`` (account override),
    #: ``"fleet"`` (the ``organization_id IS NULL`` default) or ``"embedded"``
    #: (the runner-published default; only ``get_unit`` ever serves one, as the
    #: last rung of a resolved read).
    #:
    #: ⚠️ **Unrelated to ``source_path`` / ``source_commit`` below despite the
    #: shared prefix.** This is the resolution LAYER; those two are the config
    #: repo the text was imported FROM. Adjacent names, different concepts —
    #: the same warning the canonical Rust type carries.
    source: str = "user"
    #: Import provenance: repo-relative path in the config repo, or ``None``
    #: for text authored in the console.
    source_path: str | None = None
    #: Import provenance: full 40-char commit, or ``None`` when no commit
    #: honestly describes the bytes (console-authored, or a dirty-tree import).
    source_commit: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AgentTextUnitMetadata(BaseModel):
    """One unit WITHOUT its ``files`` map — the corpus **index** row.

    This exists because the full listing does not fit the client that needs it.
    The runner resolves the corpus on the **spawn critical path** inside a 4 s
    budget (``agent_commands/mod.rs`` ``FETCH_TIMEOUT``), and resolution is
    fail-soft: a link too slow to finish the fetch degrades to cache and then to
    the runner's embedded defaults, so the served corpus *silently vanishes*
    rather than erroring. Sizing that budget against the real payload is what
    plan ``2026-08-20-fleet-served-agent-skills`` Phase 5 requires, and the real
    payload is dominated almost entirely by ``files`` — measured over the fleet
    corpus (87 units, measured 2026-08-25), dropping it takes the list response
    from 1,988,661 bytes to 47,093 — 2.4%. Everything else here is small enough
    that the numbers do not move.

    ``checksum`` is the point of the projection, not decoration: it is the same
    canonical ``files``-map digest the full response carries, so a warm client
    fetches this index alone and pulls bodies only for the units whose digest
    moved. ``file_paths`` and ``byte_count`` describe the map without carrying
    it — enough to notice a file that was REMOVED from a unit, and to budget the
    body fetch that follows, before spending a byte on text.

    Deliberately NOT ``AgentTextUnitResponse`` with an optional ``files``.
    Making that field nullable would weaken the single-unit ``GET`` and the full
    listing for every consumer in order to describe a shape neither of them ever
    returns; two models keep both wires honestly typed.
    """

    id: str
    organization_id: str | None = None
    kind: str
    name: str
    entrypoint: str
    #: The cache key — the canonical ``files``-map digest, identical to the one
    #: on ``AgentTextUnitResponse`` for the same row.
    checksum: str | None = None
    #: Sorted relative paths the ``files`` map holds, without their text.
    file_paths: list[str]
    #: UTF-8 size of the omitted ``files`` map, so a client can budget the body
    #: fetch this index tells it to make.
    byte_count: int
    is_shared: bool = False
    is_invocable: bool = True
    current_version: int
    #: The resolution LAYER — ``"user"`` or ``"fleet"``. See the same field on
    #: ``AgentTextUnitResponse`` for why this is not ``source_path``.
    source: str = "user"
    source_path: str | None = None
    source_commit: str | None = None
    created_at: datetime
    updated_at: datetime


class AgentTextUnitVersionResponse(BaseModel):
    """Response for one row of the append-only version chain."""

    id: str
    agent_text_unit_id: str
    version_number: int
    files: dict[str, str]
    checksum: str | None = None
    created_by_user_id: str | None = None
    change_description: str | None = None
    restored_from: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# Import (Phase 5 of `2026-08-20-fleet-served-agent-skills`)
# =============================================================================


class ImportOutcome(StrEnum):
    """What an import decided about ONE unit.

    ``CREATED`` and ``UPDATED`` each append exactly one version; ``UNCHANGED``
    appends none, and it is the outcome that makes the importer re-runnable. It
    is a first-class result rather than a silent skip precisely so a run can be
    read as "87 unchanged" instead of as an empty log.
    """

    CREATED = "created"
    UPDATED = "updated"
    UNCHANGED = "unchanged"


class AgentTextUnitImportItem(BaseModel):
    """One unit as read from a corpus, before it is compared with the store.

    Deliberately NOT ``AgentTextUnitCreate``: that model is a *request to write*
    and every field on it is applied. This one is a *candidate*, and the whole
    point of ``import_units`` is that a candidate may turn out to need no write
    at all.
    """

    kind: str = KIND_COMMAND
    name: str
    files: dict[str, str]
    is_invocable: bool = True
    is_shared: bool = False
    source_path: str | None = None
    source_commit: str | None = None


class AgentTextUnitImportResult(BaseModel):
    """What happened to one candidate."""

    kind: str
    name: str
    outcome: ImportOutcome
    file_count: int
    byte_count: int
    checksum: str
    is_invocable: bool
    #: True when the text was identical but the recorded provenance was not, so
    #: the columns were refreshed in place. Never appends a version — provenance
    #: is metadata about the text, not the text.
    provenance_refreshed: bool = False
    #: Head version before and after. Equal on ``UNCHANGED``; ``None`` before a
    #: ``CREATED``.
    previous_version: int | None = None
    new_version: int


class AgentTextUnitImportReport(BaseModel):
    """The whole run, per unit plus the counts an operator actually reads."""

    dry_run: bool
    #: The layer that was written — ``None`` is the fleet-default layer, which
    #: is the one that makes "all users in a fleet have the same tools" true.
    organization_id: str | None
    results: list[AgentTextUnitImportResult]

    def count(self, outcome: ImportOutcome) -> int:
        return sum(1 for r in self.results if r.outcome is outcome)

    @property
    def created(self) -> int:
        return self.count(ImportOutcome.CREATED)

    @property
    def updated(self) -> int:
        return self.count(ImportOutcome.UPDATED)

    @property
    def unchanged(self) -> int:
        return self.count(ImportOutcome.UNCHANGED)

    @property
    def provenance_refreshed(self) -> int:
        return sum(1 for r in self.results if r.provenance_refreshed)

    @property
    def versions_written(self) -> int:
        """Versions this run appended. **Zero is the idempotency property**: a
        re-import over an unchanged corpus must write none."""
        return self.created + self.updated

    @property
    def total_bytes(self) -> int:
        return sum(r.byte_count for r in self.results)


class Pagination(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


class AgentTextUnitListResponse(BaseModel):
    items: list[AgentTextUnitResponse]
    pagination: Pagination


class AgentTextUnitIndexResponse(BaseModel):
    """The same listing as ``AgentTextUnitListResponse``, minus every body."""

    items: list[AgentTextUnitMetadata]
    pagination: Pagination


class AgentTextUnitVersionListResponse(BaseModel):
    items: list[AgentTextUnitVersionResponse]
    pagination: Pagination


# =============================================================================
# The embedded layer's wire (Phase 4b of
# `2026-08-31-runner-publishes-embedded-command-defaults`)
# =============================================================================
#
# The unit itself is the GENERATED binding `AgentTextUnitDefault` from
# `qontinui_schemas`, not a hand-written Pydantic twin. That is the whole point
# of the shared type: the runner serializes the Rust `AgentTextUnitDefault` and
# this side deserializes the Python binding generated from the same schema, so
# the two cannot drift silently. Only the ENVELOPES around it are declared here.


class AgentTextUnitDefaultsPublishRequest(BaseModel):
    """``PUT /defaults`` — the COMPLETE embedded roster of one runner build.

    Complete, because the publish is a full-set replace (Design decision 3): a
    name absent from ``units`` is deleted from the account's embedded layer. A
    partial roster is therefore not an incremental update, it is a deletion.
    """

    #: The publishing runner's version. Every unit's own
    #: ``published_by_version`` must equal it — one roster, one build.
    runner_version: str
    units: list[AgentTextUnitDefault]


class AgentTextUnitDefaultsPublishResponse(BaseModel):
    """What ``PUT /defaults`` decided.

    ``accepted: false`` with ``rejected_reason="older_than_stored"`` is a normal
    ``200``: an org whose devices run different builds sends older publishes
    all the time, and an old device is not a fault. ``stored_version`` then
    names the build whose roster stands. Malformed publishes are ``422``s with a
    typed reason (``AgentTextUnitDefaultsRejected``), not this shape.
    """

    accepted: bool
    rejected_reason: str | None = None
    #: The version whose roster the account holds after this call — the
    #: publisher's own on accept, the incumbent's on ``older_than_stored``.
    stored_version: str | None = None
    #: Units written by THIS call. Zero when nothing was.
    count: int


class AgentTextUnitDefaultsResponse(BaseModel):
    """``GET /defaults`` — the account's baseline.

    Empty ``units`` with ``published_by_version: null`` means NO baseline: a
    web-only account, an org whose devices never ran a publishing build, or a
    runner that held no token. The frontend renders that as its honest
    "unavailable" state (Design decision 7) — it must never be turned into an
    empty or fabricated default side.
    """

    units: list[AgentTextUnitDefault]
    #: The newest build among the stored rows — after a full-set replace they
    #: all agree, but it is computed rather than assumed.
    published_by_version: str | None = None
    #: RFC 3339, the latest ``published_at`` among the rows.
    published_at: str | None = None


# =============================================================================
# Helpers
# =============================================================================


def _layer_source(unit: AgentTextUnit) -> str:
    """The resolution LAYER a row belongs to, for the response's ``source``."""
    if unit.published_by_version is not None:
        return "embedded"
    return "user" if unit.organization_id is not None else "fleet"


def _stored_layer(organization_id: UUID | None) -> ColumnElement[bool]:
    """Predicate for the fleet or override layer — NEVER the embedded one.

    Every layer-addressed query goes through this. The embedded rows share the
    table and, for an account, share the ``organization_id``; only
    ``published_by_version`` tells them apart.
    """
    org = (
        AgentTextUnit.organization_id.is_(None)
        if organization_id is None
        else AgentTextUnit.organization_id == organization_id
    )
    return and_(org, AgentTextUnit.published_by_version.is_(None))


def _embedded_layer(organization_id: UUID) -> ColumnElement[bool]:
    """Predicate for one account's runner-published embedded rows."""
    return and_(
        AgentTextUnit.organization_id == organization_id,
        AgentTextUnit.published_by_version.is_not(None),
    )


def _rfc3339(moment: datetime) -> str:
    """The wire convention the schemas module documents for timestamps."""
    return moment.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_version(text: str, *, reason: str) -> Version:
    """``packaging.version.Version`` or a typed refusal — never a string compare."""
    try:
        return Version(text)
    except InvalidVersion as exc:
        raise AgentTextUnitDefaultsRejected(
            reason, f"Not a parseable version: {text!r}"
        ) from exc


def _parse_published_at(text: str, unit_label: str) -> datetime:
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AgentTextUnitDefaultsRejected(
            "invalid_published_at",
            f"published_at is not an RFC 3339 timestamp: {text!r}",
            unit_label,
        ) from exc
    if moment.tzinfo is None:
        raise AgentTextUnitDefaultsRejected(
            "invalid_published_at",
            f"published_at must carry a UTC offset: {text!r}",
            unit_label,
        )
    return moment


def _embedded_to_default(unit: AgentTextUnit) -> AgentTextUnitDefault:
    """Project one stored embedded row back onto the generated wire type."""
    files = dict(unit.files or {})
    assert unit.published_by_version is not None and unit.published_at is not None
    return AgentTextUnitDefault(
        kind=AgentTextUnitKind(unit.kind),
        name=unit.name,
        files=files,
        # The stored column is the same canonical digest; recompute only when a
        # row somehow lacks one, so the wire never carries a NULL checksum.
        checksum=unit.checksum or compute_files_checksum(files),
        published_by_version=unit.published_by_version,
        published_at=_rfc3339(unit.published_at),
    )


def _unit_to_response(unit: AgentTextUnit) -> AgentTextUnitResponse:
    return AgentTextUnitResponse(
        id=str(unit.id),
        organization_id=(str(unit.organization_id) if unit.organization_id else None),
        created_by_user_id=(
            str(unit.created_by_user_id) if unit.created_by_user_id else None
        ),
        kind=unit.kind,
        name=unit.name,
        files=dict(unit.files or {}),
        entrypoint=entrypoint_path(unit.kind, unit.name),
        checksum=unit.checksum,
        is_shared=unit.is_shared if unit.is_shared is not None else False,
        is_invocable=unit.is_invocable if unit.is_invocable is not None else True,
        current_version=unit.current_version or 1,
        source=_layer_source(unit),
        source_path=unit.source_path,
        source_commit=unit.source_commit,
        created_at=unit.created_at,
        updated_at=unit.updated_at,
    )


def _unit_to_metadata(unit: AgentTextUnit) -> AgentTextUnitMetadata:
    """Project one unit onto the index row.

    Derived from the SAME loaded entity ``_unit_to_response`` renders, so every
    field the two share is the same value by construction rather than by a
    second query that could resolve a different row.
    """
    files = dict(unit.files or {})
    return AgentTextUnitMetadata(
        id=str(unit.id),
        organization_id=(str(unit.organization_id) if unit.organization_id else None),
        kind=unit.kind,
        name=unit.name,
        entrypoint=entrypoint_path(unit.kind, unit.name),
        checksum=unit.checksum,
        file_paths=sorted(files),
        byte_count=sum(len(text.encode("utf-8")) for text in files.values()),
        is_shared=unit.is_shared if unit.is_shared is not None else False,
        is_invocable=unit.is_invocable if unit.is_invocable is not None else True,
        current_version=unit.current_version or 1,
        source=_layer_source(unit),
        source_path=unit.source_path,
        source_commit=unit.source_commit,
        created_at=unit.created_at,
        updated_at=unit.updated_at,
    )


def _version_to_response(version: AgentTextUnitVersion) -> AgentTextUnitVersionResponse:
    return AgentTextUnitVersionResponse(
        id=str(version.id),
        agent_text_unit_id=str(version.agent_text_unit_id),
        version_number=version.version_number,
        files=dict(version.files or {}),
        checksum=version.checksum,
        created_by_user_id=(
            str(version.created_by_user_id) if version.created_by_user_id else None
        ),
        change_description=version.change_description,
        restored_from=version.restored_from,
        created_at=version.created_at,
    )


# =============================================================================
# Service
# =============================================================================


class AgentTextUnitService:
    """Service for agent text-unit CRUD and version history."""

    def _resolved_query(
        self,
        organization_id: UUID | None,
        kind: str | None,
        include_fleet_defaults: bool,
        invocable_only: bool,
        names: Sequence[str] | None,
    ) -> tuple[Select[tuple[AgentTextUnit]], type[AgentTextUnit]]:
        """Build the layer-resolved SELECT, and the entity to order/count by.

        ONE builder behind both list projections. ``list_units`` and
        ``list_unit_index`` differ only in what they RENDER from the rows they
        are handed, never in which rows those are — so the index cannot drift
        from the full listing, and the three branches below (fleet-only,
        account-only, and the ``union_all`` resolved view) cannot disagree
        between the two. That property is asserted directly in
        ``tests/test_agent_text_units_db.py``; it is load-bearing, because a
        client that cached off a *disagreeing* index would skip a body fetch it
        needed and quietly serve stale text.

        Every filter is applied to each arm of the union before it is combined,
        not to the combined subquery: an ``EXISTS``-shadowed fleet row must be
        filtered by the same predicate as the override that shadows it.

        **The embedded layer is never part of either projection**, and that is
        a property, not an omission. The runner reads the resolved view on the
        spawn critical path and provisions whatever it returns; the published
        default is the runner's OWN embedded copy, and folding it in would put
        the network back on the out-of-the-box path the plan's Risk 5 declares
        non-negotiable (and pay the ~323 KB roster on every fetch). It is a
        display baseline, served by ``get_defaults``.
        """

        def narrow(
            query: Select[tuple[AgentTextUnit]],
        ) -> Select[tuple[AgentTextUnit]]:
            if kind is not None:
                query = query.where(AgentTextUnit.kind == kind)
            if invocable_only:
                query = query.where(AgentTextUnit.is_invocable.is_(True))
            if names is not None:
                query = query.where(AgentTextUnit.name.in_(names))
            return query

        if organization_id is None:
            query = narrow(select(AgentTextUnit).where(_stored_layer(None)))
            entity: type[AgentTextUnit] = AgentTextUnit
        else:
            account_q = select(AgentTextUnit).where(_stored_layer(organization_id))
            if not include_fleet_defaults:
                query = narrow(account_q)
                entity = AgentTextUnit
            else:
                override = aliased(AgentTextUnit)
                shadowed = (
                    select(override.id)
                    .where(
                        override.organization_id == organization_id,
                        # A published default of the same name does NOT shadow
                        # a fleet default — only a real override does.
                        override.published_by_version.is_(None),
                        override.kind == AgentTextUnit.kind,
                        override.name == AgentTextUnit.name,
                    )
                    .exists()
                )
                fleet_q = select(AgentTextUnit).where(
                    _stored_layer(None),
                    ~shadowed,
                )
                combined = narrow(account_q).union_all(narrow(fleet_q)).subquery()
                resolved = aliased(AgentTextUnit, combined)
                query = select(resolved)
                entity = resolved  # type: ignore[assignment]

        return query, entity

    async def _page(
        self,
        db: AsyncSession,
        query: Select[tuple[AgentTextUnit]],
        entity: type[AgentTextUnit],
        offset: int,
        limit: int,
    ) -> tuple[list[AgentTextUnit], Pagination]:
        """Count, order and slice one page — shared, so both projections
        paginate identically."""
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        page = (
            query.order_by(entity.kind.asc(), entity.name.asc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(page)
        return list(result.scalars().all()), Pagination(
            total=total,
            limit=limit,
            offset=offset,
            has_more=(offset + limit) < total,
        )

    async def list_units(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str | None = None,
        include_fleet_defaults: bool = True,
        invocable_only: bool = False,
        names: Sequence[str] | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> AgentTextUnitListResponse:
        """List the units this layer resolves to, bodies included.

        For an account (``organization_id`` set) with
        ``include_fleet_defaults``, this is the RESOLVED view: every override
        the account holds, plus every fleet default whose ``(kind, name)`` the
        account has not overridden. That is the ``account override → fleet
        default`` half of the runner's resolution chain, computed once here
        rather than re-derived by each client.

        ``invocable_only`` drops the non-invocable units — the underscore-
        prefixed copy-source specs (``_gate-registration``, ``_loop-control``).
        They are real corpus members an operator edits, so the console lists
        them; but a *provisioning* client writes every unit it is handed into
        ``.claude/commands/``, where a ``_gate-registration.md`` becomes an
        invocable ``/_gate-registration``. Any caller that provisions to disk
        must pass ``True``, and the legacy ``/agent-commands`` alias hardcodes
        it: that wire shape has no field to carry ``is_invocable``, so filtering
        server-side is the ONLY way an unrebuilt runner can stay correct.

        ``names`` restricts the listing to a named set. That is how a client
        that has already read ``list_unit_index`` fetches bodies for exactly the
        units whose ``checksum`` moved, in ONE request rather than one round
        trip per unit — which matters because the caller doing it is on a spawn
        critical path with a 4 s budget for the whole exchange. Names are
        matched inside the ``kind`` filter, so pass ``kind`` as well when a name
        exists under more than one.
        """
        if names is not None:
            validate_names_selector(names)
        query, entity = self._resolved_query(
            organization_id, kind, include_fleet_defaults, invocable_only, names
        )
        units, pagination = await self._page(db, query, entity, offset, limit)
        return AgentTextUnitListResponse(
            items=[_unit_to_response(u) for u in units],
            pagination=pagination,
        )

    async def list_unit_index(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str | None = None,
        include_fleet_defaults: bool = True,
        invocable_only: bool = False,
        names: Sequence[str] | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> AgentTextUnitIndexResponse:
        """The same listing as ``list_units``, projected onto metadata only.

        Same rows, same order, same pagination — see ``_resolved_query``. The
        only difference is on the WIRE: ``files`` is replaced by its paths, its
        byte count, and the digest over it, which is what takes the fleet corpus
        from ~1.9 MB to ~47 KB and puts a cold resolve back inside the runner's
        fetch budget. See ``AgentTextUnitMetadata`` for why that budget is the
        thing under pressure.

        The projection is on the response, not on the SELECT: rows are read
        whole and narrowed here. Keeping one query is what makes "the index
        agrees with the listing" true by construction rather than by a second
        query hand-kept in sync, and the app-to-Postgres hop it costs is a local
        socket — never the link the 4 s budget is actually spent on.
        """
        if names is not None:
            validate_names_selector(names)
        query, entity = self._resolved_query(
            organization_id, kind, include_fleet_defaults, invocable_only, names
        )
        units, pagination = await self._page(db, query, entity, offset, limit)
        return AgentTextUnitIndexResponse(
            items=[_unit_to_metadata(u) for u in units],
            pagination=pagination,
        )

    async def get_unit(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str,
        name: str,
        include_fleet_defaults: bool = True,
    ) -> AgentTextUnitResponse:
        """Get one unit, resolving ``account override → fleet default →
        embedded default``.

        The embedded rung is the one place outside ``get_defaults`` that serves
        a published default, and the response says so (``source="embedded"``).
        It is a single-unit DISPLAY read; the list projections deliberately do
        not fall through the same way — see ``_resolved_query``.
        """
        unit = await self._load_unit(db, organization_id, kind, name)
        if unit is None and include_fleet_defaults and organization_id is not None:
            unit = await self._load_unit(db, None, kind, name)
        if unit is None and include_fleet_defaults and organization_id is not None:
            unit = await self._load_embedded(db, organization_id, kind, name)
        if not unit:
            raise ValueError(f"Agent text unit not found: {kind}/{name}")
        return _unit_to_response(unit)

    async def upsert_unit(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        data: AgentTextUnitCreate,
        user_id: UUID | None,
    ) -> AgentTextUnitResponse:
        """Create the unit, or update it in place, appending a version.

        The write is keyed on ``(organization_id, kind, name)`` — the pair of
        partial unique indexes enforces at most one row per layer.

        **Provenance follows the text, unconditionally.** ``source_path`` /
        ``source_commit`` are set to whatever this call carries — which for a
        console save is nothing, so a console save CLEARS an earlier import's
        provenance. That is the honest outcome: once the text has been edited
        here it is no longer a copy of that path at that commit, and a stale
        provenance is worse than none. **Every call appends a version**, even
        one whose ``files`` are byte-identical; a caller that must not bump an
        unchanged unit compares digests first — that is what ``import_units``
        does, and why it exists.
        """
        validate_kind(data.kind)
        validate_unit_name(data.name)
        validate_files(data.kind, data.name, data.files)
        validate_provenance(data.source_path, data.source_commit)
        is_invocable = data.is_invocable
        if data.name.startswith("_") and is_invocable:
            raise AgentTextUnitValidationError(
                f"{data.name!r} is a copy-source spec (leading underscore) and "
                "cannot be marked invocable"
            )

        files = dict(data.files)
        checksum = compute_files_checksum(files)
        unit = await self._load_unit(db, organization_id, data.kind, data.name)

        if unit is None:
            unit = AgentTextUnit(
                organization_id=organization_id,
                created_by_user_id=user_id,
                kind=data.kind,
                name=data.name,
                files=files,
                checksum=checksum,
                is_shared=data.is_shared,
                is_invocable=is_invocable,
                source_path=data.source_path,
                source_commit=data.source_commit,
                current_version=1,
            )
            db.add(unit)
            await db.flush()
            await self._append_version(
                db,
                unit,
                version_number=1,
                files=files,
                checksum=checksum,
                user_id=user_id,
                change_description=data.change_description,
                restored_from=None,
            )
        else:
            next_number = await self._next_version_number(db, unit.id)
            unit.files = files
            unit.checksum = checksum
            unit.is_shared = data.is_shared
            unit.is_invocable = is_invocable
            unit.source_path = data.source_path
            unit.source_commit = data.source_commit
            unit.current_version = next_number
            unit.updated_at = datetime.now(UTC)
            await self._append_version(
                db,
                unit,
                version_number=next_number,
                files=files,
                checksum=checksum,
                user_id=user_id,
                change_description=data.change_description,
                restored_from=None,
            )

        await db.commit()
        await db.refresh(unit)
        return _unit_to_response(unit)

    async def update_unit(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str,
        name: str,
        data: AgentTextUnitUpdate,
        user_id: UUID | None,
    ) -> AgentTextUnitResponse:
        """Patch an existing unit. A ``files`` change appends a version.

        A ``files`` change also **clears import provenance**, for the same
        reason ``upsert_unit`` overwrites it: the stored text is no longer a
        copy of the path and commit that were recorded. The other fields
        (``is_shared`` / ``is_invocable``) do not touch the text, so they leave
        provenance alone.
        """
        unit = await self._load_unit(db, organization_id, kind, name)
        if not unit:
            raise ValueError(f"Agent text unit not found: {kind}/{name}")

        if data.is_shared is not None:
            unit.is_shared = data.is_shared

        if data.is_invocable is not None:
            if name.startswith("_") and data.is_invocable:
                raise AgentTextUnitValidationError(
                    f"{name!r} is a copy-source spec (leading underscore) and "
                    "cannot be marked invocable"
                )
            unit.is_invocable = data.is_invocable

        if data.files is not None:
            validate_files(kind, name, data.files)
            files = dict(data.files)
            checksum = compute_files_checksum(files)
            next_number = await self._next_version_number(db, unit.id)
            unit.files = files
            unit.checksum = checksum
            unit.source_path = None
            unit.source_commit = None
            unit.current_version = next_number
            await self._append_version(
                db,
                unit,
                version_number=next_number,
                files=files,
                checksum=checksum,
                user_id=user_id,
                change_description=data.change_description,
                restored_from=None,
            )

        unit.updated_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(unit)
        return _unit_to_response(unit)

    async def list_versions(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str,
        name: str,
        offset: int = 0,
        limit: int = 100,
    ) -> AgentTextUnitVersionListResponse:
        """List a unit's version chain, newest first."""
        unit = await self._load_unit(db, organization_id, kind, name)
        if not unit:
            raise ValueError(f"Agent text unit not found: {kind}/{name}")

        query = select(AgentTextUnitVersion).where(
            AgentTextUnitVersion.agent_text_unit_id == unit.id
        )

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = (
            query.order_by(AgentTextUnitVersion.version_number.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(query)
        versions = list(result.scalars().all())

        return AgentTextUnitVersionListResponse(
            items=[_version_to_response(v) for v in versions],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def revert_to_version(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str,
        name: str,
        version_number: int,
        user_id: UUID | None,
    ) -> AgentTextUnitResponse:
        """Revert by APPENDING a new head whose files equal an older version's.

        History is never mutated or deleted — the target version stays exactly
        where it was and a new version is written on top of the chain.

        Import provenance is CLEARED, like any other text change. Versions do
        not carry provenance (see the model docstring), so a revert cannot
        restore the one that was current when the target was written; claiming
        the provenance that happens to be on the unit right now would attach it
        to text it never described. The next import re-establishes it if the
        reverted text does match the source again.
        """
        unit = await self._load_unit(db, organization_id, kind, name)
        if not unit:
            raise ValueError(f"Agent text unit not found: {kind}/{name}")

        target_result = await db.execute(
            select(AgentTextUnitVersion).where(
                AgentTextUnitVersion.agent_text_unit_id == unit.id,
                AgentTextUnitVersion.version_number == version_number,
            )
        )
        target = target_result.scalar_one_or_none()
        if not target:
            raise ValueError(
                f"Version {version_number} not found for agent text unit {kind}/{name}"
            )

        next_number = await self._next_version_number(db, unit.id)
        files = dict(target.files or {})
        checksum = target.checksum or compute_files_checksum(files)

        unit.files = files
        unit.checksum = checksum
        unit.source_path = None
        unit.source_commit = None
        unit.current_version = next_number
        unit.updated_at = datetime.now(UTC)

        await self._append_version(
            db,
            unit,
            version_number=next_number,
            files=files,
            checksum=checksum,
            user_id=user_id,
            change_description=f"Restored from version {version_number}",
            restored_from=version_number,
        )

        await db.commit()
        await db.refresh(unit)
        return _unit_to_response(unit)

    async def delete_override(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str,
        name: str,
    ) -> bool:
        """Delete this layer's row so the next layer down applies again.

        For an account that means the fleet default — or, absent one, the
        runner's embedded default. ``_load_unit`` addresses stored layers only,
        so this can never delete a published default: the baseline survives the
        reset it previews. The version chain goes with the row via the FK's
        ``ON DELETE CASCADE``.
        """
        unit = await self._load_unit(db, organization_id, kind, name)
        if not unit:
            return False

        await db.delete(unit)
        await db.commit()
        return True

    # -------------------------------------------------------------------
    # Internals
    # -------------------------------------------------------------------

    async def import_units(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        items: Sequence[AgentTextUnitImportItem],
        user_id: UUID | None = None,
        *,
        change_description: str | None = None,
        dry_run: bool = False,
    ) -> AgentTextUnitImportReport:
        """Load a corpus into ONE layer, **idempotently**.

        Phase 5 of ``2026-08-20-fleet-served-agent-skills``. This is the method
        that makes the importer re-runnable, and the property it guarantees is
        exactly one sentence:

            **A re-import appends a version only when the text actually
            changed.**

        Without that, every run bumps every unit and the version log — the thing
        an operator uses to see what changed and when — becomes noise that
        hides the one edit that mattered.

        How "changed?" is decided
        -------------------------

        By the canonical digest, ``agent-text-unit-files/v1``
        (``compute_files_checksum``), computed over BOTH sides:

        * the candidate's ``files`` map, and
        * **the stored row's own ``files`` map, recomputed** — not its stored
          ``checksum`` column.

        Recomputing is the load-bearing choice. The stored column can be NULL
        (the ``atu_01`` migration nulls it, because the meaning of the field
        changed from "digest of one body" to "digest of a files map" and
        Postgres cannot recompute a sha256 without pgcrypto), and it can have
        been written by some other surface. Comparing digest-to-digest over the
        content itself means the answer depends on the text and nothing else. A
        row whose stored checksum is merely absent or stale is therefore
        ``UNCHANGED`` with its checksum quietly corrected, not a spurious bump.

        Both digests are order-independent by construction — ``v1`` sorts by the
        raw UTF-8 bytes of the path — which matters here because the two maps
        arrive in genuinely different orders: the candidate's in corpus-scan
        order, the stored one in the key order JSONB chose. A digest that did
        not sort would report every multi-file skill as changed on every run.

        Provenance
        ----------

        ``source_path`` / ``source_commit`` are metadata ABOUT the text, not
        text, so a change to them alone refreshes the columns in place and
        appends nothing (reported as ``provenance_refreshed``). That is what
        makes a re-import after an unrelated commit in the source repo still a
        zero-version run.

        Transaction
        -----------

        Every candidate is validated BEFORE anything is written, and the whole
        run is one transaction with a single commit. A corpus import is not 87
        independent writes: a half-applied corpus is a state nobody asked for
        and nothing reports. ``dry_run=True`` does the full comparison, writes
        nothing, and rolls back.
        """
        for item in items:
            validate_kind(item.kind)
            validate_unit_name(item.name)
            validate_files(item.kind, item.name, item.files)
            validate_provenance(item.source_path, item.source_commit)
            if item.name.startswith("_") and item.is_invocable:
                raise AgentTextUnitValidationError(
                    f"{item.name!r} is a copy-source spec (leading underscore) "
                    "and cannot be marked invocable"
                )

        seen: set[tuple[str, str]] = set()
        for item in items:
            key = (item.kind, item.name)
            if key in seen:
                raise AgentTextUnitValidationError(
                    f"Duplicate unit in the import set: {item.kind}/{item.name}"
                )
            seen.add(key)

        results: list[AgentTextUnitImportResult] = []
        for item in items:
            files = dict(item.files)
            checksum = compute_files_checksum(files)
            byte_count = sum(len(v.encode("utf-8")) for v in files.values())
            unit = await self._load_unit(db, organization_id, item.kind, item.name)

            if unit is None:
                results.append(
                    AgentTextUnitImportResult(
                        kind=item.kind,
                        name=item.name,
                        outcome=ImportOutcome.CREATED,
                        file_count=len(files),
                        byte_count=byte_count,
                        checksum=checksum,
                        is_invocable=item.is_invocable,
                        previous_version=None,
                        new_version=1,
                    )
                )
                if dry_run:
                    continue
                unit = AgentTextUnit(
                    organization_id=organization_id,
                    created_by_user_id=user_id,
                    kind=item.kind,
                    name=item.name,
                    files=files,
                    checksum=checksum,
                    is_shared=item.is_shared,
                    is_invocable=item.is_invocable,
                    source_path=item.source_path,
                    source_commit=item.source_commit,
                    current_version=1,
                )
                db.add(unit)
                await db.flush()
                await self._append_version(
                    db,
                    unit,
                    version_number=1,
                    files=files,
                    checksum=checksum,
                    user_id=user_id,
                    change_description=change_description,
                    restored_from=None,
                )
                continue

            current_version = unit.current_version or 1
            stored_checksum = compute_files_checksum(dict(unit.files or {}))

            if stored_checksum == checksum:
                provenance_stale = (
                    unit.source_path != item.source_path
                    or unit.source_commit != item.source_commit
                )
                results.append(
                    AgentTextUnitImportResult(
                        kind=item.kind,
                        name=item.name,
                        outcome=ImportOutcome.UNCHANGED,
                        file_count=len(files),
                        byte_count=byte_count,
                        checksum=checksum,
                        is_invocable=unit.is_invocable,
                        provenance_refreshed=provenance_stale,
                        previous_version=current_version,
                        new_version=current_version,
                    )
                )
                if dry_run:
                    continue
                # Metadata only: no version is appended and no text moves. Both
                # writes below are self-healing rather than editorial — the
                # checksum one repairs a NULL or stale column (see the
                # docstring), and neither can happen twice, so the steady state
                # of a re-run is a row nobody touches. When one DOES fire, the
                # model's `onupdate` moves `updated_at`; that is accurate (the
                # row changed) and it is not a new version.
                if provenance_stale:
                    unit.source_path = item.source_path
                    unit.source_commit = item.source_commit
                if unit.checksum != checksum:
                    unit.checksum = checksum
                continue

            # What a dry run can honestly say: the head pointer plus one. The
            # write path below reads the chain's real next number — which can
            # differ if a version was appended without moving the head — and
            # corrects the result it just recorded.
            predicted_version = current_version + 1
            results.append(
                AgentTextUnitImportResult(
                    kind=item.kind,
                    name=item.name,
                    outcome=ImportOutcome.UPDATED,
                    file_count=len(files),
                    byte_count=byte_count,
                    checksum=checksum,
                    is_invocable=item.is_invocable,
                    previous_version=current_version,
                    new_version=predicted_version,
                )
            )
            if dry_run:
                continue
            next_number = await self._next_version_number(db, unit.id)
            unit.files = files
            unit.checksum = checksum
            # `is_invocable` is corpus-derived (the leading-underscore rule), so
            # the import owns it. `is_shared` is NOT — nothing on disk expresses
            # it, it is an operator's choice in the console, and overwriting it
            # here would silently undo that choice on every import.
            unit.is_invocable = item.is_invocable
            unit.source_path = item.source_path
            unit.source_commit = item.source_commit
            unit.current_version = next_number
            unit.updated_at = datetime.now(UTC)
            results[-1].new_version = next_number
            await self._append_version(
                db,
                unit,
                version_number=next_number,
                files=files,
                checksum=checksum,
                user_id=user_id,
                change_description=change_description,
                restored_from=None,
            )

        if dry_run:
            await db.rollback()
        else:
            await db.commit()

        return AgentTextUnitImportReport(
            dry_run=dry_run,
            organization_id=(str(organization_id) if organization_id else None),
            results=results,
        )

    async def _load_unit(
        self,
        db: AsyncSession,
        organization_id: UUID | None,
        kind: str,
        name: str,
    ) -> AgentTextUnit | None:
        """Load one unit from EXACTLY the stored layer named.

        Never falls back: a caller that is about to revert or delete must act
        on the account's own row, not on a fleet default it merely reads — and
        never on the published default of the same name, which
        ``_stored_layer`` excludes.
        """
        result = await db.execute(
            select(AgentTextUnit).where(
                _stored_layer(organization_id),
                AgentTextUnit.kind == kind,
                AgentTextUnit.name == name,
            )
        )
        return result.scalar_one_or_none()

    async def _load_embedded(
        self,
        db: AsyncSession,
        organization_id: UUID,
        kind: str,
        name: str,
    ) -> AgentTextUnit | None:
        """Load one account's published default for ``(kind, name)``."""
        result = await db.execute(
            select(AgentTextUnit).where(
                _embedded_layer(organization_id),
                AgentTextUnit.kind == kind,
                AgentTextUnit.name == name,
            )
        )
        return result.scalar_one_or_none()

    async def _embedded_rows(
        self, db: AsyncSession, organization_id: UUID
    ) -> list[AgentTextUnit]:
        """Every published default one account holds, in ``(kind, name)`` order."""
        result = await db.execute(
            select(AgentTextUnit)
            .where(_embedded_layer(organization_id))
            .order_by(AgentTextUnit.kind.asc(), AgentTextUnit.name.asc())
        )
        return list(result.scalars().all())

    # -------------------------------------------------------------------
    # The embedded layer (Phase 4 of
    # `2026-08-31-runner-publishes-embedded-command-defaults`)
    # -------------------------------------------------------------------

    async def get_defaults(
        self, db: AsyncSession, organization_id: UUID
    ) -> AgentTextUnitDefaultsResponse:
        """The account's baseline — every default its runner(s) published.

        Empty with ``published_by_version: None`` when nothing was ever
        published. That is a real state (a web-only account, no publishing
        build, no token), and the frontend renders it as "unavailable" rather
        than as an empty default; this method never fabricates a row.
        """
        rows = await self._embedded_rows(db, organization_id)
        if not rows:
            return AgentTextUnitDefaultsResponse(units=[])
        units = [_embedded_to_default(row) for row in rows]
        newest = max(units, key=lambda u: Version(u.published_by_version))
        latest_at = max(
            row.published_at for row in rows if row.published_at is not None
        )
        return AgentTextUnitDefaultsResponse(
            units=units,
            published_by_version=newest.published_by_version,
            published_at=_rfc3339(latest_at),
        )

    async def publish_defaults(
        self,
        db: AsyncSession,
        organization_id: UUID,
        runner_version: str,
        units: Sequence[AgentTextUnitDefault],
    ) -> AgentTextUnitDefaultsPublishResponse:
        """Replace the account's embedded layer with ONE runner build's roster.

        Semantics, each traceable to a design decision of the plan:

        * **Per-org, never fleet-wide** (decision 2). ``organization_id`` is
          the caller's resolved org; nothing here can write the
          ``organization_id IS NULL`` layer.
        * **Full-set replace** (decision 3). ``units`` is the whole roster; a
          ``(kind, name)`` the account holds that is absent from it is deleted.
          A default row that outlives its bundle entry is exactly the stale
          baseline the plan exists to remove.
        * **Server-side checksum** (decision 8). Every unit's ``checksum`` is
          recomputed with the canonical files-map digest and a mismatch is
          refused as ``checksum_mismatch``. A client-asserted digest is not
          evidence, and a default digested with the wrong function would never
          compare equal to its override — an always-drifted baseline, worse
          than no baseline.
        * **Monotonic guard, compared as VERSIONS** (decision 4). A publish
          older than the stored ``published_by_version`` answers a normal
          ``accepted: false`` / ``older_than_stored``; an old device is not a
          fault. ``packaging.version.Version`` on both sides — ``"0.10.0"`` is
          older than ``"0.9.0"`` as strings, which would invert the guard
          exactly when it matters, silently. **Equal versions: last writer
          wins.** The guard is a mitigation, not a fix: a genuine downgrade
          still wins and the tie-break is last-writer, and the UI must not
          describe the baseline as authoritative.

        Every unit is validated with the SAME rules an override must satisfy
        (name, kind, paths, the 1 MiB per-file cap, the entrypoint) — a
        baseline that could not be stored as a unit is not one anything can be
        diffed against. Malformed input raises ``AgentTextUnitDefaultsRejected``
        before anything is written; the whole replace is one transaction.

        Embedded rows carry NO version chain: a published default is content
        plus provenance, not a corpus row with an edit history (the shared
        type's own docs). ``current_version`` stays at its default.
        """
        incoming = _parse_version(runner_version, reason="invalid_runner_version")
        if len(units) > MAX_PUBLISH_UNITS:
            raise AgentTextUnitDefaultsRejected(
                "too_many_units",
                f"Roster carries {len(units)} units (> {MAX_PUBLISH_UNITS})",
            )

        # ---- validate the whole roster before writing any of it -------------
        seen: set[tuple[str, str]] = set()
        parsed: list[tuple[AgentTextUnitDefault, str, dict[str, str], datetime]] = []
        total_bytes = 0
        for unit in units:
            kind = unit.kind.root
            label = f"{kind}/{unit.name}"
            try:
                validate_kind(kind)
                validate_unit_name(unit.name)
                validate_files(kind, unit.name, unit.files)
            except AgentTextUnitValidationError as exc:
                raise AgentTextUnitDefaultsRejected(
                    "invalid_unit", str(exc), label
                ) from exc
            if (kind, unit.name) in seen:
                raise AgentTextUnitDefaultsRejected(
                    "duplicate_unit", f"Duplicate unit in the roster: {label}", label
                )
            seen.add((kind, unit.name))
            if unit.published_by_version != runner_version:
                raise AgentTextUnitDefaultsRejected(
                    "version_mismatch",
                    f"{label} says published_by_version="
                    f"{unit.published_by_version!r} but the roster is "
                    f"runner_version={runner_version!r}; one roster, one build",
                    label,
                )
            files = dict(unit.files)
            checksum = compute_files_checksum(files)
            if unit.checksum != checksum:
                raise AgentTextUnitDefaultsRejected(
                    "checksum_mismatch",
                    f"{label} carries checksum {unit.checksum!r} but its files "
                    f"digest to {checksum!r} under agent-text-unit-files/v1",
                    label,
                )
            published_at = _parse_published_at(unit.published_at, label)
            total_bytes += sum(len(v.encode("utf-8")) for v in files.values())
            parsed.append((unit, checksum, files, published_at))

        if total_bytes > MAX_PUBLISH_BYTES:
            raise AgentTextUnitDefaultsRejected(
                "payload_too_large",
                f"Roster totals {total_bytes} bytes (> {MAX_PUBLISH_BYTES})",
            )

        # ---- the monotonic guard, against what the account already holds ----
        existing = await self._embedded_rows(db, organization_id)
        stored_versions = [
            Version(row.published_by_version)
            for row in existing
            if row.published_by_version is not None
        ]
        if stored_versions:
            stored = max(stored_versions)
            if incoming < stored:
                return AgentTextUnitDefaultsPublishResponse(
                    accepted=False,
                    rejected_reason="older_than_stored",
                    stored_version=str(stored),
                    count=0,
                )
            # incoming >= stored. Equal: LAST WRITER WINS — two devices on the
            # same build carry the same bodies, and when they do not (a dirty
            # local build) there is no principled tie-break, so the newest
            # publish stands and the response says which version that is.

        # ---- full-set replace ------------------------------------------------
        by_key = {(row.kind, row.name): row for row in existing}
        roster_keys = {(unit.kind.root, unit.name) for unit, _, _, _ in parsed}
        for key, row in by_key.items():
            if key not in roster_keys:
                await db.delete(row)

        for unit, checksum, files, published_at in parsed:
            kind = unit.kind.root
            current = by_key.get((kind, unit.name))
            # The corpus's own rule: an underscore-prefixed unit is a copy-source
            # spec and the DB CHECK refuses to mark it invocable.
            is_invocable = not unit.name.startswith("_")
            if current is None:
                db.add(
                    AgentTextUnit(
                        organization_id=organization_id,
                        kind=kind,
                        name=unit.name,
                        files=files,
                        checksum=checksum,
                        is_invocable=is_invocable,
                        published_by_version=runner_version,
                        published_at=published_at,
                    )
                )
                continue
            current.files = files
            current.checksum = checksum
            current.is_invocable = is_invocable
            current.published_by_version = runner_version
            current.published_at = published_at
            current.updated_at = datetime.now(UTC)

        await db.commit()
        return AgentTextUnitDefaultsPublishResponse(
            accepted=True,
            rejected_reason=None,
            stored_version=runner_version,
            count=len(parsed),
        )

    async def _next_version_number(
        self,
        db: AsyncSession,
        agent_text_unit_id: UUID,
    ) -> int:
        """``latest + 1``, or 1 — the same rule ``VersionHistoryService`` uses.

        Application-side monotonicity only; ``uq_agent_text_unit_version`` is
        what actually rejects two concurrent appends that both read the same
        latest number.
        """
        result = await db.execute(
            select(func.max(AgentTextUnitVersion.version_number)).where(
                AgentTextUnitVersion.agent_text_unit_id == agent_text_unit_id
            )
        )
        latest = result.scalar()
        return (latest + 1) if latest else 1

    async def _append_version(
        self,
        db: AsyncSession,
        unit: AgentTextUnit,
        *,
        version_number: int,
        files: dict[str, str],
        checksum: str,
        user_id: UUID | None,
        change_description: str | None,
        restored_from: int | None,
    ) -> AgentTextUnitVersion:
        """Append one immutable row to the chain."""
        version = AgentTextUnitVersion(
            agent_text_unit_id=unit.id,
            version_number=version_number,
            files=files,
            checksum=checksum,
            created_by_user_id=user_id,
            change_description=change_description,
            restored_from=restored_from,
        )
        db.add(version)
        await db.flush()
        return version


__all__ = [
    "MAX_FILES_PER_UNIT",
    "MAX_FILE_BYTES",
    "MAX_PATH_BYTES",
    "MAX_PATH_SEGMENTS",
    "MAX_PUBLISH_BYTES",
    "MAX_PUBLISH_UNITS",
    "MAX_SOURCE_PATH_BYTES",
    "MAX_UNIT_BYTES",
    "AgentTextUnitCreate",
    "AgentTextUnitDefault",
    "AgentTextUnitDefaultsPublishRequest",
    "AgentTextUnitDefaultsPublishResponse",
    "AgentTextUnitDefaultsRejected",
    "AgentTextUnitDefaultsResponse",
    "AgentTextUnitImportItem",
    "AgentTextUnitImportReport",
    "AgentTextUnitImportResult",
    "AgentTextUnitListResponse",
    "AgentTextUnitResponse",
    "AgentTextUnitService",
    "AgentTextUnitUpdate",
    "AgentTextUnitValidationError",
    "AgentTextUnitVersionListResponse",
    "AgentTextUnitVersionResponse",
    "ImportOutcome",
    "Pagination",
    "RevertRequest",
    "compute_body_checksum",
    "compute_files_checksum",
    "validate_files",
    "validate_kind",
    "validate_provenance",
    "validate_relative_path",
    "validate_unit_name",
]
