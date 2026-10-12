"""Pydantic schemas for follow-up closure and anchors (plan library).

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
Phase 3 (D1, D2) and Phase 5 step 2 (D5). A ``spawned_followup`` edge now has
a closure state of its own (``fixing`` → ``fixed``, ``already_fixed``,
``dismissed``) and structured file anchors, so a fix too small for a plan can
close, and a session editing a file can be told which follow-ups are about it.

A sibling of ``app.schemas.plan_library`` rather than a section of it: that
module serves the whole library, and this family is a unit of its own [policy:
modular-code-and-file-size]. ``plan_library`` imports from here (the queue row
:class:`~app.schemas.plan_library.OpenFollowup` IS a :class:`FollowupFacts`);
nothing here imports ``plan_library``.

Same two rules as the parent module: every closed field is a ``Literal`` (a bad
value is a 422 naming the field, never a 500 from a CHECK), and every request
model is ``extra="forbid"``.

Anchor and path rules are enforced HERE first, with a reason per refusal; the
database CHECKs (``FOLLOWUP_ANCHOR_CHECKS``) are the backstop, not the
user-facing error.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.bounded_read import BoundedReadMeta
from app.models.work_artifact import (
    FOLLOWUP_ANCHOR_PATH_MAX,
    FOLLOWUP_COMMIT_PATTERN,
    FOLLOWUP_PR_PATTERN,
    FOLLOWUP_REPO_PATTERN,
)
from app.schemas.base import IsoDatetime

# ───────────────────────── vocabularies ─────────────────────────

#: A STORED resolution — NULL (no value) is open. Mirrors
#: ``ck_work_artifact_edges_resolution``.
FollowupResolution = Literal["fixing", "fixed", "already_fixed", "dismissed"]

#: What a follow-up IS right now. ``open``: nobody owns it and nothing closed
#: it. ``claimed``: an artifact owns it (``to_id``) — it left the queue the old
#: way. The other four are its resolution.
FollowupState = Literal[
    "open", "fixing", "fixed", "already_fixed", "dismissed", "claimed"
]

#: ``GET /plan-library/followups?state=``. ``resolved`` is the three states a
#: record rests in (``fixed`` | ``already_fixed`` | ``dismissed``). A claimed
#: follow-up is not in this read at all: it is an ordinary two-ended edge on
#: its owner's edge list.
FollowupStateFilter = Literal[
    "open", "fixing", "fixed", "already_fixed", "dismissed", "resolved"
]

#: ``POST /plan-library/edges/{edge_id}/resolution`` ``resolution``. ``open``
#: moves a follow-up BACK to open: ``fixing`` → ``open`` when its PR closed
#: unlanded, and a resting state → ``open`` to correct a wrong closure.
FollowupTransitionTarget = Literal[
    "open", "fixing", "fixed", "already_fixed", "dismissed"
]

#: The expected size of the fix. Mirrors ``ck_work_artifact_edges_size_class``.
FollowupSizeClass = Literal["trivial", "small", "plan_sized"]

#: ``GET /plan-library/followups?size_class=``: a class, or ``unclassified``
#: (NULL — nobody has sized it yet).
FollowupSizeClassFilter = Literal["trivial", "small", "plan_sized", "unclassified"]

#: Who sized it. Mirrors ``ck_work_artifact_edges_size_class_source``.
FollowupSizeClassSource = Literal["declared", "sweep"]

#: Anchors one follow-up may carry. A note naming more files than this is a
#: plan, not a follow-up.
FOLLOWUP_ANCHORS_MAX = 100

#: Paths one ``POST /plan-library/followups/match`` may ask about.
FOLLOWUP_MATCH_PATHS_MAX = 500

_REPO = re.compile(FOLLOWUP_REPO_PATTERN)
_PR = re.compile(FOLLOWUP_PR_PATTERN)
_COMMIT = re.compile(FOLLOWUP_COMMIT_PATTERN)


# ───────────────────────── shared validators ─────────────────────────


def normalize_repo(value: str) -> str:
    """``owner/name``, lower-cased — or a ``ValueError`` naming the problem.

    Lower-cased because GitHub resolves ``owner/name`` case-insensitively and
    matching is an EXACT ``(repo, path)`` compare: an anchor written as
    ``Acme/Widgets`` must match a diff read as ``acme/widgets``. A path is
    never case-folded — git paths are case-sensitive.
    """
    if value != value.strip():
        raise ValueError("repo has leading or trailing whitespace")
    if len(value) > 255:
        raise ValueError("repo is longer than 255 characters")
    if not _REPO.match(value):
        raise ValueError(
            f"repo {value!r} is not 'owner/name' (letters, digits, '_', '.', '-')"
        )
    return value.lower()


def path_refusal(path: str) -> str | None:
    """Why ``path`` cannot be an anchor path, or ``None`` when it can.

    The rules mirror ``ck_work_artifact_edge_anchors_path_shape``: a
    repo-relative FILE path with forward slashes. Nothing is normalized for the
    caller — a path that is not already in this form is refused with the
    reason, because a silently rewritten anchor is one the writer cannot
    recognise when it reads it back.
    """
    if not path:
        return "path is empty"
    if len(path) > FOLLOWUP_ANCHOR_PATH_MAX:
        return f"path is longer than {FOLLOWUP_ANCHOR_PATH_MAX} characters"
    if path != path.strip():
        return "path has leading or trailing whitespace"
    if any(unicodedata.category(ch) == "Cc" for ch in path):
        return "path contains a control character"
    if "\\" in path:
        return "path contains a backslash; anchors use forward slashes"
    if path.startswith("/"):
        return "path is absolute (leading '/'); anchors are repo-relative"
    if path.endswith("/"):
        return "path names a directory (trailing '/'); an anchor names a file"
    segments = path.split("/")
    if any(segment == "" for segment in segments):
        return "path contains an empty segment ('//')"
    if any(segment in (".", "..") for segment in segments):
        return "path contains a '.' or '..' segment"
    return None


def check_path(value: str) -> str:
    """:func:`path_refusal` as a validator: the path unchanged, or a ``ValueError``."""
    reason = path_refusal(value)
    if reason is not None:
        raise ValueError(f"{reason}: {value!r}")
    return value


def check_pr(value: str | None) -> str | None:
    """``owner/name#n`` or a ``ValueError``; ``None`` passes."""
    if value is None:
        return None
    if not _PR.match(value):
        raise ValueError(
            f"resolution_pr {value!r} is not 'owner/name#<number>' "
            "(e.g. 'qontinui/qontinui-web#1234')"
        )
    return value


def check_commit(value: str | None) -> str | None:
    """A 7-64 hex commit sha, lower-cased, or a ``ValueError``; ``None`` passes."""
    if value is None:
        return None
    lowered = value.lower()
    if not _COMMIT.match(lowered):
        raise ValueError(
            f"resolution_commit {value!r} is not a commit sha (7-64 hex characters)"
        )
    return lowered


def is_blank(value: str | None) -> bool:
    """True for ``None`` or whitespace-only text."""
    return value is None or not value.strip()


# ───────────────────────── anchors ─────────────────────────


class FollowupAnchorIn(BaseModel):
    """One file a follow-up is about, as a writer declares it.

    ``repo`` + ``path`` are the match key (exact; ``repo`` is lower-cased).
    ``line_start`` / ``line_end`` / ``symbol`` are hints for whoever folds the
    fix in — lines drift, so they never take part in a match.
    """

    model_config = ConfigDict(extra="forbid")

    repo: str = Field(..., description="`owner/name` of the repository.")
    path: str = Field(
        ...,
        description="Repo-relative file path, forward slashes, no leading `/`, "
        "no `.`/`..` segment.",
    )
    line_start: int | None = Field(None, ge=1, le=2_147_483_647)
    line_end: int | None = Field(None, ge=1, le=2_147_483_647)
    symbol: str | None = Field(None, max_length=512)

    @field_validator("repo")
    @classmethod
    def _repo(cls, value: str) -> str:
        return normalize_repo(value)

    @field_validator("path")
    @classmethod
    def _path(cls, value: str) -> str:
        return check_path(value)

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str | None) -> str | None:
        if value is not None and is_blank(value):
            raise ValueError("symbol is blank; omit it instead")
        return value

    @model_validator(mode="after")
    def _lines(self) -> FollowupAnchorIn:
        if self.line_end is not None and self.line_start is None:
            raise ValueError("line_end requires line_start")
        if (
            self.line_end is not None
            and self.line_start is not None
            and self.line_end < self.line_start
        ):
            raise ValueError("line_end is before line_start")
        return self


def check_anchor_set(anchors: list[FollowupAnchorIn]) -> list[FollowupAnchorIn]:
    """Refuse two anchors with the same ``(repo, path, line_start)``.

    The store's unique index is on exactly that key; refusing it here names
    the duplicate instead of surfacing an IntegrityError as a 500.
    """
    seen: set[tuple[str, str, int | None]] = set()
    for anchor in anchors:
        key = (anchor.repo, anchor.path, anchor.line_start)
        if key in seen:
            line = f":{anchor.line_start}" if anchor.line_start is not None else ""
            raise ValueError(
                f"duplicate anchor {anchor.repo}:{anchor.path}{line} — one anchor "
                "per (repo, path, line_start)"
            )
        seen.add(key)
    return anchors


class FollowupAnchor(BaseModel):
    """One stored anchor."""

    repo: str
    path: str
    line_start: int | None = None
    line_end: int | None = None
    symbol: str | None = None


# ───────────────────────── closure facts ─────────────────────────


class FollowupHistoryEntry(BaseModel):
    """One transition, as ``resolution_history`` records it.

    ``from`` / ``to`` are states (:data:`FollowupState`'s unowned members);
    typed as plain strings so a history written by a later vocabulary still
    reads.
    """

    model_config = ConfigDict(populate_by_name=True)

    from_state: str = Field(..., alias="from")
    to_state: str = Field(..., alias="to")
    at: IsoDatetime
    by: str | None = None
    pr: str | None = None
    commit: str | None = None
    note: str | None = None


class FollowupFacts(BaseModel):
    """A follow-up's closure state and matching facts.

    ``state`` is the one field to branch on. The ``resolution_*`` fields
    describe the CURRENT state only (all null while ``open``); what happened
    before is ``resolution_history``, oldest first.
    """

    state: FollowupState
    anchors: list[FollowupAnchor] = Field(default_factory=list)
    #: ``null`` is UNCLASSIFIED — nobody has sized it, not "small".
    size_class: FollowupSizeClass | None = None
    size_class_source: FollowupSizeClassSource | None = None
    #: Why the follow-up carries no anchor. ``anchors`` empty AND this null is
    #: a follow-up written before anchors existed (the backfill's population).
    unanchored_reason: str | None = None
    resolution: FollowupResolution | None = None
    resolution_pr: str | None = None
    #: The land commit on ``fixed`` (``null`` when coord recorded none for the
    #: land), the earlier fixing commit on ``already_fixed``.
    resolution_commit: str | None = None
    resolution_note: str | None = None
    resolved_by: str | None = None
    #: When the current state was entered. A ``fixing`` row's age reads from it.
    resolved_at: IsoDatetime | None = None
    resolution_history: list[FollowupHistoryEntry] = Field(default_factory=list)


# ───────────────────────── requests ─────────────────────────


class FollowupAnchorsReplace(BaseModel):
    """``PUT /plan-library/edges/{edge_id}/anchors``.

    ``anchors`` and ``unanchored_reason`` REPLACE what is stored: an empty
    ``anchors`` must say why (``unanchored_reason``), and a non-empty one
    carries no reason (it is cleared). ``size_class`` / ``size_class_source``
    are optional and travel together: supplied, they set the class; omitted,
    the stored class is kept — a caller correcting an anchor must not erase a
    classification it never read.
    """

    model_config = ConfigDict(extra="forbid")

    anchors: list[FollowupAnchorIn] = Field(..., max_length=FOLLOWUP_ANCHORS_MAX)
    unanchored_reason: str | None = Field(None, max_length=2000)
    size_class: FollowupSizeClass | None = None
    size_class_source: FollowupSizeClassSource | None = None

    @field_validator("anchors")
    @classmethod
    def _unique(cls, value: list[FollowupAnchorIn]) -> list[FollowupAnchorIn]:
        return check_anchor_set(value)

    @model_validator(mode="after")
    def _shape(self) -> FollowupAnchorsReplace:
        if not self.anchors and is_blank(self.unanchored_reason):
            raise ValueError(
                "an empty anchor set needs a non-blank unanchored_reason — an "
                "unanchored follow-up must say why it cannot be matched"
            )
        if self.anchors and self.unanchored_reason is not None:
            raise ValueError(
                "unanchored_reason contradicts a non-empty anchors list; omit it"
            )
        if (self.size_class is None) != (self.size_class_source is None):
            raise ValueError("size_class and size_class_source travel together")
        return self


class FollowupResolutionRequest(BaseModel):
    """``POST /plan-library/edges/{edge_id}/resolution``.

    Each target accepts exactly its own fields — anything else is a 422 naming
    it, because a field the transition would silently drop is a write the
    caller believes happened:

    * ``fixing`` — ``resolution_pr`` (required: the open PR that fixes it);
    * ``fixed`` — ``resolution_commit`` (required here: a hand assertion names
      its commit; the reconcile, which acts on coord's land verdict, is the
      usual writer) and optionally ``resolution_pr``, which must be the PR the
      row is ``fixing`` under;
    * ``already_fixed`` — ``resolution_commit`` (required), ``resolution_pr``
      optional (the PR that landed it, when known);
    * ``dismissed`` — ``resolution_note`` (required, non-blank: the reason);
    * ``open`` — ``resolution_note``, required when reopening a resting state
      (``fixed`` / ``already_fixed`` / ``dismissed``: it says why the closure
      was wrong) and optional from ``fixing``.

    ``resolution_note`` is accepted on every target and lands in the history
    entry (and, on ``dismissed``, as the stored reason).
    """

    model_config = ConfigDict(extra="forbid")

    resolution: FollowupTransitionTarget
    resolution_pr: str | None = Field(None, max_length=300)
    resolution_commit: str | None = Field(None, max_length=64)
    resolution_note: str | None = Field(None, max_length=4000)

    @field_validator("resolution_pr")
    @classmethod
    def _pr(cls, value: str | None) -> str | None:
        return check_pr(value)

    @field_validator("resolution_commit")
    @classmethod
    def _commit(cls, value: str | None) -> str | None:
        return check_commit(value)

    @model_validator(mode="after")
    def _fields_for_target(self) -> FollowupResolutionRequest:
        target = self.resolution
        allowed: dict[str, set[str]] = {
            "fixing": {"resolution_pr"},
            "fixed": {"resolution_pr", "resolution_commit"},
            "already_fixed": {"resolution_pr", "resolution_commit"},
            "dismissed": set(),
            "open": set(),
        }
        supplied = {
            name
            for name in ("resolution_pr", "resolution_commit")
            if getattr(self, name) is not None
        }
        extra = sorted(supplied - allowed[target])
        if extra:
            raise ValueError(f"{', '.join(extra)} does not apply to '{target}'")
        if target == "fixing" and self.resolution_pr is None:
            raise ValueError("'fixing' requires resolution_pr (owner/name#n)")
        if target in ("fixed", "already_fixed") and self.resolution_commit is None:
            raise ValueError(f"'{target}' requires resolution_commit")
        if target == "dismissed" and is_blank(self.resolution_note):
            raise ValueError("'dismissed' requires a non-blank resolution_note")
        return self


class FollowupMatchRequest(BaseModel):
    """``POST /plan-library/followups/match``: the files a diff touches.

    A ``POST`` for its body only — up to 500 paths do not fit a query string;
    it reads and changes nothing.
    """

    model_config = ConfigDict(extra="forbid")

    repo: str = Field(..., description="`owner/name` the paths belong to.")
    paths: list[str] = Field(
        ...,
        max_length=FOLLOWUP_MATCH_PATHS_MAX,
        description="Repo-relative file paths (the diff's touched set).",
    )

    @field_validator("repo")
    @classmethod
    def _repo(cls, value: str) -> str:
        return normalize_repo(value)

    @field_validator("paths")
    @classmethod
    def _paths(cls, value: list[str]) -> list[str]:
        return [check_path(path) for path in value]


class FollowupFilters(BaseModel):
    """The filters a ``/followups`` page was read under, echoed so a consumer
    can assert the read it asked for is the read it got."""

    state: FollowupStateFilter
    repo: str | None = None
    size_class: FollowupSizeClassFilter | None = None
    anchored: bool | None = None


# ───────────────────────── the queue row ─────────────────────────


class OpenFollowup(FollowupFacts):
    """A follow-up a plan SURFACED and deliberately did not do.

    The row is a ``spawned_followup`` edge with no owning artifact
    (``to_id`` NULL). ``GET /plan-library/followups`` serves ``state: open``
    rows by default; ``?state=`` reads the ``fixing`` and resolved ones. The
    originating artifact is denormalized in so the queue renders without an
    N+1 fetch, and ``note`` carries the finding itself — with no far end there
    is nowhere else for it to live, which is why the schema requires it.
    """

    edge_id: UUID
    #: The artifact that surfaced this — normally the plan that said
    #: "worth its own plan" and moved on.
    from_id: UUID
    from_kind: str
    from_slug: str
    from_title: str
    #: The finding. Non-blank by construction
    #: (``ck_work_artifact_edges_followup_note``).
    note: str
    created_by: str | None = None
    created_at: IsoDatetime
    #: Days since the follow-up was recorded. An OLD unowned follow-up is the
    #: interesting one — it is work the fleet has known about and not picked
    #: up — which is also why the default ordering is oldest first.
    age_days: float


class OpenFollowupResponse(BoundedReadMeta):
    """A page of follow-ups in one state (``open`` by default) — a keyset walk
    over the edge's immutable ``(created_at, id)``, oldest first. The
    bounded-read keys describe ``items``; ``next_cursor`` is passed back as
    ``cursor`` and is bound to ``filters``."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    items: list[OpenFollowup]
    #: Named so a consumer can assert it did not silently change. Oldest first
    #: is the useful default here, not an arbitrary one.
    ordering: Literal["oldest_first"] = "oldest_first"
    #: The filters this page was read under.
    filters: FollowupFilters


class FollowupWriteResponse(BaseModel):
    """The follow-up after a write through one of its doors.

    ``changed`` is false when the request restated what was already stored (an
    idempotent replay) — nothing was written and no history entry appended.
    """

    changed: bool
    followup: OpenFollowup


class FollowupMatch(OpenFollowup):
    """A follow-up anchored on at least one of the requested files."""

    #: The subset of ``anchors`` the request's ``(repo, paths)`` hit.
    matched_anchors: list[FollowupAnchor]


class FollowupMatchResponse(BaseModel):
    """``POST /plan-library/followups/match`` — the follow-ups on a diff's files.

    ``items`` holds ``open`` and ``fixing`` follow-ups (a ``fixing`` one is held
    by another PR and must not be folded twice), oldest first. A zero match is
    SELF-DESCRIBING: ``repo_anchored_open_total`` says how many open
    follow-ups are anchored in this repo at all, and ``unanchored_open_total``
    how many open ones can never match any diff because they name no file.
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    repo: str
    #: Distinct paths the match ran on.
    paths_requested: int
    items: list[FollowupMatch]
    #: Every matching follow-up, ``items`` capped or not.
    matched_total: int
    #: True when ``items`` stopped at its cap below ``matched_total``.
    truncated: bool
    #: Open follow-ups with at least one anchor in ``repo`` (any path).
    repo_anchored_open_total: int
    #: Open follow-ups with no anchor at all, in any repo.
    unanchored_open_total: int


# ───────────────────────── responses ─────────────────────────


class FollowupReconcileResponse(BaseModel):
    """What one reconcile pass over ``fixing`` follow-ups did (D5).

    Each ``fixing`` row's PR is read from coord's land record
    (``GET /coord/pr/{repo}/{n}/landed``): ``landed`` → ``fixed`` (with the
    land commit when coord holds one), ``closed_unlanded`` → back to ``open``,
    ``pending`` → unchanged, ``unknown`` → unchanged and counted here.

    ``coord_available: false`` means coord could not be read for (some of)
    the pass: every row it could not read stays ``fixing`` and is counted in
    ``unknown`` — UNKNOWN, never "nothing to move".
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    #: ``fixing`` rows the pass looked at.
    examined: int
    fixed: int
    reopened: int
    #: The PR is still open (coord ``pending``).
    pending: int
    #: Rows left ``fixing`` because coord's verdict was ``unknown`` or could not
    #: be read — see ``unknown_reasons``.
    unknown: int
    #: Rows whose state moved under the pass between its read and its write
    #: (another writer transitioned them first); left as that writer left them.
    raced: int
    #: Distinct PRs read from coord (each once per pass).
    distinct_prs: int
    coord_available: bool
    coord_unavailable_reason: str | None = None
    #: ``reason → rows``, for every row counted in ``unknown``.
    unknown_reasons: dict[str, int] = Field(default_factory=dict)
    #: True when the pass stopped at its row cap with ``fixing`` rows left —
    #: the next pass continues; nothing past the cap was examined.
    truncated: bool = False
