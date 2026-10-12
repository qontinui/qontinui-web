"""Follow-up closure and anchors — the CRUD family of the plan library.

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
Phase 3 step 3 (D1, D2) and Phase 5 step 2 (D5).

A sibling of :mod:`app.crud.work_artifact` rather than a section of it: that
module is the library's hub and is past the size where a new family belongs in
it [policy: modular-code-and-file-size]. The dependency runs ONE way — this
module reuses the hub's org scope and keyset cut; the hub never imports this.
The two follow-up reads that already lived in the hub stay there
(``list_open_followups``, ``claim_followup``), now aware of the closure state.

What lives here
---------------
* :func:`write_followup_facts` — a new follow-up's anchors and size class,
  written inside ``create_edge``'s own transaction.
* :func:`replace_anchors` — ``PUT /plan-library/edges/{edge_id}/anchors``.
* :func:`transition_followup` — every closure-state change: row lock, the
  legal-transition table (:data:`LEGAL_TRANSITIONS`), the history append, and
  :class:`FollowupTransitionConflict` naming the current state.
* :func:`match_followups` — ``POST /plan-library/followups/match``.
* :func:`reconcile_fixing_followups` — the ONE reconcile core (D5): walks
  ``fixing`` rows in bounded pages, reads each distinct PR once from coord's
  land record, moves rows. Its two callers (the route and the scheduled task)
  differ only in the coord reader they hand it.

Closure state
-------------
A follow-up is OPEN iff no artifact owns it and nothing closed it
(``app.models.work_artifact.OPEN_FOLLOWUP_SQL``). Its state is
:func:`followup_state`. The current-state columns (``resolution_pr`` …
``resolved_at``) describe the CURRENT state only; every transition appends a
``{from, to, at, by, pr, commit, note}`` entry to ``resolution_history``.
"""

from __future__ import annotations

import asyncio
import re
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import UUID

from sqlalchemy import ColumnElement, delete, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.bounded_read import KeysetPosition
from app.crud.work_artifact import (
    FOLLOWUP_STATE_SQL,
    _keyset_cut,
    _org_scope,
    sql_predicate,
)
from app.models.work_artifact import (
    FOLLOWUP_COMMIT_PATTERN,
    FOLLOWUP_PR_PATTERN,
    FOLLOWUP_TERMINAL_RESOLUTIONS,
    OPEN_FOLLOWUP_SQL,
    SPAWNED_FOLLOWUP_RELATION,
    UNCLAIMED_FOLLOWUP_SQL,
    WorkArtifact,
    WorkArtifactEdge,
    WorkArtifactEdgeAnchor,
)

# ───────────────────────── state ─────────────────────────

#: ``current state → the states it may move to``. D1's forward transitions —
#: open → ``fixing`` | ``already_fixed`` | ``dismissed``; ``fixing`` → ``fixed``
#: | back to ``open`` (its PR closed unlanded) — plus ONE correction verb: a
#: resting state (``fixed`` / ``already_fixed`` / ``dismissed``) may be
#: reopened, with a reason. Without it a wrong closure through an
#: agent-writable door would be permanent, which is the defect class
#: ``app.core.evidence_posture`` exists to refuse; the reason goes in the
#: history, which keeps the closure that was corrected. Anything else is a
#: :class:`FollowupTransitionConflict` (409).
LEGAL_TRANSITIONS: dict[str, frozenset[str]] = {
    "open": frozenset({"fixing", "already_fixed", "dismissed"}),
    "fixing": frozenset({"fixed", "open"}),
    "fixed": frozenset({"open"}),
    "already_fixed": frozenset({"open"}),
    "dismissed": frozenset({"open"}),
}

#: ``Resolves-Followup`` PRs are cited as ``owner/name#n``.
_PR_CITATION = re.compile(FOLLOWUP_PR_PATTERN)
_COMMIT = re.compile(FOLLOWUP_COMMIT_PATTERN)


def followup_state(edge: WorkArtifactEdge) -> str | None:
    """``open`` | ``claimed`` | the resolution — ``None`` on any other relation."""
    if edge.relation != SPAWNED_FOLLOWUP_RELATION:
        return None
    if edge.to_id is not None:
        return "claimed"
    return edge.resolution or "open"


class FollowupTransitionConflict(Exception):
    """The requested transition is not legal from the follow-up's CURRENT state.

    Raised under the row lock, so ``current_state`` is what the row held at the
    moment the write was refused — not what the caller read earlier. Surfaced
    as a 409 naming the state, the requested target and the legal ones.
    """

    def __init__(
        self,
        *,
        edge_id: UUID,
        current_state: str,
        requested: str,
        legal: Iterable[str],
        resolution_pr: str | None = None,
        detail: str | None = None,
    ) -> None:
        self.edge_id = edge_id
        self.current_state = current_state
        self.requested = requested
        self.legal = sorted(legal)
        self.resolution_pr = resolution_pr
        message = detail or (
            f"follow-up {edge_id} is '{current_state}'; '{requested}' is not "
            f"a legal next state (legal: {', '.join(self.legal) or 'none'})"
        )
        super().__init__(message)


class FollowupTransitionInvalid(Exception):
    """The request is legal in shape but incomplete for THIS row's state —
    e.g. reopening a resting state without a reason. Surfaced as a 422."""


# ───────────────────────── anchors ─────────────────────────


@dataclass(frozen=True)
class AnchorSpec:
    """One anchor to write — already validated and normalized by the API."""

    repo: str
    path: str
    line_start: int | None = None
    line_end: int | None = None
    symbol: str | None = None

    def key(self) -> tuple[str, str, int | None, int | None, str | None]:
        return (self.repo, self.path, self.line_start, self.line_end, self.symbol)


def _anchor_key(
    anchor: WorkArtifactEdgeAnchor,
) -> tuple[str, str, int | None, int | None, str | None]:
    return (
        anchor.repo,
        anchor.path,
        anchor.line_start,
        anchor.line_end,
        anchor.symbol,
    )


async def load_anchors(
    db: AsyncSession, edge_ids: Iterable[UUID]
) -> dict[UUID, list[WorkArtifactEdgeAnchor]]:
    """Every anchor of ``edge_ids``, grouped by edge, in a stable order
    (repo, path, line, id). An edge with no anchor maps to ``[]``."""
    ids = list(dict.fromkeys(edge_ids))
    out: dict[UUID, list[WorkArtifactEdgeAnchor]] = {edge_id: [] for edge_id in ids}
    if not ids:
        return out
    rows = (
        (
            await db.execute(
                select(WorkArtifactEdgeAnchor)
                .where(WorkArtifactEdgeAnchor.edge_id.in_(ids))
                .order_by(
                    WorkArtifactEdgeAnchor.edge_id,
                    WorkArtifactEdgeAnchor.repo,
                    WorkArtifactEdgeAnchor.path,
                    WorkArtifactEdgeAnchor.line_start.asc().nulls_first(),
                    WorkArtifactEdgeAnchor.id,
                )
            )
        )
        .scalars()
        .all()
    )
    for anchor in rows:
        out.setdefault(anchor.edge_id, []).append(anchor)
    return out


def _add_anchors(
    db: AsyncSession, edge_id: UUID, anchors: Sequence[AnchorSpec]
) -> None:
    for spec in anchors:
        db.add(
            WorkArtifactEdgeAnchor(
                edge_id=edge_id,
                repo=spec.repo,
                path=spec.path,
                line_start=spec.line_start,
                line_end=spec.line_end,
                symbol=spec.symbol,
            )
        )


async def write_followup_facts(
    db: AsyncSession,
    edge: WorkArtifactEdge,
    *,
    created: bool,
    anchors: Sequence[AnchorSpec] | None,
    size_class: str | None,
    unanchored_reason: str | None,
) -> bool:
    """A follow-up's matching facts, as ``POST /{artifact_id}/edges`` declared
    them — run by ``create_edge`` inside its own transaction. Returns whether
    it wrote anything.

    On a NEW follow-up everything supplied is stored (``size_class_source``
    ``declared``). On an idempotent RE-POST that landed on an existing row,
    only a blank is filled: anchors (or a reason for having none) when the row
    has neither, a size class when it has none. Nothing stored is ever
    overwritten here — ``PUT …/anchors`` is the door that replaces — and a
    re-post that carried new facts the row then lacked is not silently
    dropped either: before anchors existed, every follow-up was note-only, and
    a writer re-posting one with anchors is exactly how they arrive.
    """
    wrote = False
    if created:
        if anchors:
            _add_anchors(db, edge.id, anchors)
            wrote = True
        if unanchored_reason is not None and not anchors:
            edge.unanchored_reason = unanchored_reason
            wrote = True
        if size_class is not None:
            edge.size_class = size_class
            edge.size_class_source = "declared"
            wrote = True
        return wrote

    if edge.unanchored_reason is None and (anchors or unanchored_reason is not None):
        has_anchor = (
            await db.execute(
                select(exists().where(WorkArtifactEdgeAnchor.edge_id == edge.id))
            )
        ).scalar_one()
        if not has_anchor:
            if anchors:
                _add_anchors(db, edge.id, anchors)
            else:
                edge.unanchored_reason = unanchored_reason
            wrote = True
    if size_class is not None and edge.size_class is None:
        edge.size_class = size_class
        edge.size_class_source = "declared"
        wrote = True
    return wrote


async def _lock_followup(db: AsyncSession, edge_id: UUID) -> WorkArtifactEdge:
    """``SELECT … FOR UPDATE`` the edge. The caller resolved ``edge_id``
    through ``get_edge`` (the org boundary) a moment ago; this is the
    concurrency boundary, not an authorization one.

    A refusal (or a no-op replay) raises/returns WITHOUT rolling back: the
    lock is released when the CALLER's transaction ends (a request's session
    closing, the reconcile's next commit). Rolling back here would also undo
    whatever else the caller's transaction held — and under a session joined
    to an outer transaction, that is the whole outer transaction."""
    edge = (
        (
            await db.execute(
                select(WorkArtifactEdge)
                .where(WorkArtifactEdge.id == edge_id)
                .with_for_update()
                # The session may already hold this edge (the route's
                # ``get_edge``; ``expire_on_commit=False``): without this the
                # locked read hands back the CACHED attributes, and every
                # state check below — the compare-and-set included — would
                # judge what the caller read, not what the row holds.
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .first()
    )
    if edge is None:  # pragma: no cover — the caller resolved it a moment ago
        raise LookupError(f"follow-up edge {edge_id} vanished")
    if edge.relation != SPAWNED_FOLLOWUP_RELATION:
        raise FollowupTransitionInvalid(
            f"edge {edge_id} has relation '{edge.relation}'; only "
            f"'{SPAWNED_FOLLOWUP_RELATION}' carries anchors and a closure state"
        )
    return edge


async def replace_anchors(
    db: AsyncSession,
    edge_id: UUID,
    *,
    anchors: Sequence[AnchorSpec],
    unanchored_reason: str | None,
    size_class: str | None = None,
    size_class_source: str | None = None,
) -> tuple[WorkArtifactEdge, bool]:
    """Replace a follow-up's whole anchor set (``PUT …/anchors``).

    ``anchors`` and ``unanchored_reason`` REPLACE what is stored (the API has
    already required a reason for an empty set and none for a non-empty one).
    ``size_class`` / ``size_class_source`` set the class when supplied and
    leave it alone when not. Row-locked; one transaction, so a reader never
    sees the set half-replaced. Returns ``(edge, changed)`` — ``changed`` is
    false when the request restated what was stored, and nothing was written.
    """
    edge = await _lock_followup(db, edge_id)
    current = await load_anchors(db, [edge.id])
    # Compared as MULTISETS, never sorted: one path may carry a line-less
    # anchor beside a lined one, and ordering ``None`` against an ``int``
    # raises — a 500 on every PUT to a row stored that way.
    stored = Counter(_anchor_key(a) for a in current[edge.id])
    requested = Counter(spec.key() for spec in anchors)
    reason = None if anchors else unanchored_reason
    class_change = size_class is not None and (
        size_class != edge.size_class or size_class_source != edge.size_class_source
    )
    if stored == requested and reason == edge.unanchored_reason and not class_change:
        return edge, False

    if stored != requested:
        await db.execute(
            delete(WorkArtifactEdgeAnchor).where(
                WorkArtifactEdgeAnchor.edge_id == edge.id
            )
        )
        _add_anchors(db, edge.id, anchors)
    edge.unanchored_reason = reason
    if class_change:
        edge.size_class = size_class
        edge.size_class_source = size_class_source
    await db.commit()
    await db.refresh(edge)
    return edge, True


# ───────────────────────── transitions ─────────────────────────


def _blank(value: str | None) -> bool:
    return value is None or not value.strip()


def _replay_matches(
    edge: WorkArtifactEdge,
    to: str,
    *,
    pr: str | None,
    commit: str | None,
    note: str | None,
) -> bool | None:
    """For ``to == current state``: ``True`` when the request restates the
    stored facts (an idempotent replay), ``False`` when it contradicts them,
    ``None`` when ``to`` is not the current state at all."""
    if followup_state(edge) != to:
        return None
    if to == "open":
        return True
    if to == "fixing":
        return pr == edge.resolution_pr
    if to in ("fixed", "already_fixed"):
        return (pr is None or pr == edge.resolution_pr) and (
            commit is None or commit == edge.resolution_commit
        )
    # dismissed
    return (note or "").strip() == (edge.resolution_note or "").strip()


async def transition_followup(
    db: AsyncSession,
    edge_id: UUID,
    *,
    to: str,
    actor: str,
    pr: str | None = None,
    commit: str | None = None,
    note: str | None = None,
    now: datetime | None = None,
    expect_state: str | None = None,
    expect_pr: str | None = None,
) -> tuple[WorkArtifactEdge, bool]:
    """Move a follow-up to ``to`` — the ONLY writer of the closure columns.

    Row-locked (two writers racing one follow-up both see the state the first
    left, never the one they read before), checked against
    :data:`LEGAL_TRANSITIONS`, and recorded: the current-state columns are
    rewritten for ``to`` and one ``{from, to, at, by, pr, commit, note}``
    entry is appended to ``resolution_history`` in the same commit.

    Per target:

    * ``fixing`` — ``pr`` is required (``owner/name#n``);
    * ``fixed`` — from ``fixing`` only; ``pr``, when given, must be the PR the
      row is ``fixing`` under; ``commit`` is the land commit and MAY be
      ``None`` (coord can report a land it holds no commit for);
    * ``already_fixed`` — ``commit`` is required;
    * ``dismissed`` — a non-blank ``note`` (the reason) is required;
    * ``open`` — from ``fixing``, or reopening a resting state, which needs a
      non-blank ``note`` saying why the closure was wrong.

    A request that restates the current state's facts is an idempotent replay:
    ``(edge, False)``, nothing written. One that contradicts them (``fixing``
    under a different PR, say) is a :class:`FollowupTransitionConflict`, as is
    any illegal move and any claimed follow-up.

    ``expect_state`` / ``expect_pr`` are an optional compare-and-set
    precondition, checked under the row lock BEFORE anything else: when given,
    the row must still be in ``expect_state`` (and, for ``expect_pr``, held
    under that PR) or the call raises :class:`FollowupTransitionConflict`
    naming the current state, and writes nothing. A caller acting on a state
    it read earlier (the reconcile, which read a page of ``fixing`` rows)
    passes what it read, so a row another writer moved in between — even
    through a path back to a state the transition table would accept, e.g.
    ``fixing(A) → open → dismissed`` — is left as that writer left it.
    """
    edge = await _lock_followup(db, edge_id)
    current = followup_state(edge) or "open"

    def conflict(detail: str | None = None) -> FollowupTransitionConflict:
        return FollowupTransitionConflict(
            edge_id=edge_id,
            current_state=current,
            requested=to,
            legal=LEGAL_TRANSITIONS.get(current, frozenset()),
            resolution_pr=edge.resolution_pr,
            detail=detail,
        )

    if current == "claimed":
        raise conflict(
            f"follow-up {edge_id} is claimed by artifact {edge.to_id}; a claimed "
            "follow-up has no closure state of its own"
        )

    if (expect_state is not None and current != expect_state) or (
        expect_pr is not None and edge.resolution_pr != expect_pr
    ):
        held = f"'{current}'" + (
            f" under {edge.resolution_pr}" if edge.resolution_pr else ""
        )
        wanted = f"'{expect_state or current}'" + (
            f" under {expect_pr}" if expect_pr else ""
        )
        raise conflict(
            f"follow-up {edge_id} is {held}, not {wanted} as the caller read it; "
            "another writer moved it, and its move stands"
        )

    replay = _replay_matches(edge, to, pr=pr, commit=commit, note=note)
    if replay is True:
        return edge, False
    if replay is False:
        raise conflict(
            f"follow-up {edge_id} is already '{current}'"
            + (f" under {edge.resolution_pr}" if edge.resolution_pr else "")
            + "; the request contradicts what is stored"
        )
    if to not in LEGAL_TRANSITIONS.get(current, frozenset()):
        raise conflict()

    if to == "fixing" and pr is None:
        raise FollowupTransitionInvalid("'fixing' requires the PR (owner/name#n)")
    if to == "fixed" and pr is not None and pr != edge.resolution_pr:
        raise conflict(
            f"follow-up {edge_id} is fixing under {edge.resolution_pr}, not {pr}"
        )
    if to == "already_fixed" and commit is None:
        raise FollowupTransitionInvalid("'already_fixed' requires the commit")
    if to == "dismissed" and _blank(note):
        raise FollowupTransitionInvalid("'dismissed' requires a non-blank reason")
    if to == "open" and current in FOLLOWUP_TERMINAL_RESOLUTIONS and _blank(note):
        raise FollowupTransitionInvalid(
            f"reopening a '{current}' follow-up requires a non-blank "
            "resolution_note saying why the closure was wrong"
        )

    at = now or datetime.now(UTC)
    previous_pr = edge.resolution_pr
    previous_commit = edge.resolution_commit
    if to == "open":
        entry_pr, entry_commit = previous_pr, previous_commit
        edge.resolution = None
        edge.resolution_pr = None
        edge.resolution_commit = None
        edge.resolution_note = None
        edge.resolved_by = None
        edge.resolved_at = None
    else:
        if to == "fixing":
            edge.resolution_pr = pr
            edge.resolution_commit = None
        elif to == "fixed":
            edge.resolution_commit = commit
        elif to == "already_fixed":
            edge.resolution_pr = pr
            edge.resolution_commit = commit
        else:  # dismissed
            edge.resolution_pr = None
            edge.resolution_commit = None
        edge.resolution = to
        edge.resolution_note = note
        edge.resolved_by = actor
        edge.resolved_at = at
        entry_pr, entry_commit = edge.resolution_pr, edge.resolution_commit

    edge.resolution_history = [
        *(edge.resolution_history or []),
        {
            "from": current,
            "to": to,
            "at": at.isoformat(),
            "by": actor,
            "pr": entry_pr,
            "commit": entry_commit,
            "note": note,
        },
    ]
    await db.commit()
    await db.refresh(edge)
    return edge, True


# ───────────────────────── match ─────────────────────────

#: Follow-ups one match returns at most; ``matched_total`` counts the rest.
MATCH_ITEM_CAP = 500

#: Open, or held by an open PR — what a diff's author must be told about.
_MATCHABLE_SQL = (
    f"{UNCLAIMED_FOLLOWUP_SQL} AND (resolution IS NULL OR resolution = 'fixing')"
)


@dataclass
class MatchResult:
    """What :func:`match_followups` found — rows, their anchors, and the
    totals that make a zero self-describing."""

    rows: list[tuple[WorkArtifactEdge, WorkArtifact]]
    anchors: dict[UUID, list[WorkArtifactEdgeAnchor]]
    matched_total: int
    truncated: bool
    repo_anchored_open_total: int
    unanchored_open_total: int


async def match_followups(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    repo: str,
    paths: Sequence[str],
    cap: int = MATCH_ITEM_CAP,
) -> MatchResult:
    """Open and ``fixing`` follow-ups with an anchor on ``(repo, path ∈ paths)``.

    Exact on ``(repo, path)`` — served by ``ix_work_artifact_edge_anchors_repo_path``
    for any number of paths in one query. Oldest first, capped at ``cap``.
    """
    path_set = sorted(set(paths))
    on_paths = exists().where(
        WorkArtifactEdgeAnchor.edge_id == WorkArtifactEdge.id,
        WorkArtifactEdgeAnchor.repo == repo,
        WorkArtifactEdgeAnchor.path.in_(path_set),
    )
    scope = _org_scope(org_id)

    async def count(*filters: ColumnElement[bool]) -> int:
        stmt = (
            select(func.count())
            .select_from(WorkArtifactEdge)
            .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
            .where(scope, *filters)
        )
        return int((await db.execute(stmt)).scalar_one())

    in_repo = exists().where(
        WorkArtifactEdgeAnchor.edge_id == WorkArtifactEdge.id,
        WorkArtifactEdgeAnchor.repo == repo,
    )
    any_anchor = exists().where(WorkArtifactEdgeAnchor.edge_id == WorkArtifactEdge.id)
    repo_anchored_open_total = await count(sql_predicate(OPEN_FOLLOWUP_SQL), in_repo)
    unanchored_open_total = await count(sql_predicate(OPEN_FOLLOWUP_SQL), ~any_anchor)

    if not path_set:
        return MatchResult(
            rows=[],
            anchors={},
            matched_total=0,
            truncated=False,
            repo_anchored_open_total=repo_anchored_open_total,
            unanchored_open_total=unanchored_open_total,
        )

    matchable = sql_predicate(_MATCHABLE_SQL)
    matched_total = await count(matchable, on_paths)
    rows = (
        await db.execute(
            select(WorkArtifactEdge, WorkArtifact)
            .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
            .where(scope, matchable, on_paths)
            .order_by(WorkArtifactEdge.created_at.asc(), WorkArtifactEdge.id.asc())
            .limit(cap)
        )
    ).all()
    pairs = [(row[0], row[1]) for row in rows]
    return MatchResult(
        rows=pairs,
        anchors=await load_anchors(db, (edge.id for edge, _ in pairs)),
        matched_total=matched_total,
        truncated=matched_total > len(pairs),
        repo_anchored_open_total=repo_anchored_open_total,
        unanchored_open_total=unanchored_open_total,
    )


# ───────────────────────── reconcile (D5) ─────────────────────────

LandVerdictName = Literal["landed", "closed_unlanded", "pending", "unknown"]

#: ``fixing`` rows read per page of the walk.
RECONCILE_PAGE_SIZE = 200
#: Rows one pass examines at most; the rest wait for the next pass.
RECONCILE_MAX_ROWS = 5000
#: coord reads in flight at once.
RECONCILE_FANOUT = 6


@dataclass(frozen=True)
class LandVerdict:
    """coord's answer for one PR (``GET /coord/pr/{repo}/{n}/landed``) — or,
    with ``verdict: unknown``, the reason no answer could be used."""

    verdict: LandVerdictName
    land_commit: str | None = None
    via: str | None = None
    unknown_reason: str | None = None


_VERDICTS: frozenset[str] = frozenset(
    {"landed", "closed_unlanded", "pending", "unknown"}
)


def parse_land_verdict(payload: object) -> LandVerdict:
    """coord's ``/landed`` body → :class:`LandVerdict`, defensively.

    Anything that is not the contract's shape is ``unknown`` with a reason —
    never read as either outcome. A ``land_commit`` that is not a commit sha
    is dropped (the land still stands; the commit was unusable).
    """
    if not isinstance(payload, dict):
        return LandVerdict("unknown", unknown_reason="coord_body_not_an_object")
    verdict = payload.get("verdict")
    if not isinstance(verdict, str) or verdict not in _VERDICTS:
        return LandVerdict("unknown", unknown_reason="coord_verdict_unrecognised")
    raw_commit = payload.get("land_commit")
    commit = (
        raw_commit.lower()
        if isinstance(raw_commit, str) and _COMMIT.match(raw_commit.lower())
        else None
    )
    via = payload.get("via")
    reason = payload.get("unknown_reason")
    return LandVerdict(
        verdict,  # type: ignore[arg-type]  # narrowed by the membership test
        land_commit=commit,
        via=via if isinstance(via, str) else None,
        unknown_reason=(
            (reason if isinstance(reason, str) and reason else "coord_unknown")
            if verdict == "unknown"
            else None
        ),
    )


def parse_pr_citation(citation: str) -> tuple[str, int] | None:
    """``owner/name#n`` → ``("owner/name", n)``; ``None`` when malformed."""
    if not _PR_CITATION.match(citation):
        return None
    repo, _, number = citation.partition("#")
    return repo, int(number)


class LandReader(Protocol):
    """Where a reconcile reads coord's land record from.

    ``read`` never raises: a failure is a :class:`LandVerdict` with
    ``verdict: unknown`` and the reason. A reader that has decided coord is
    unreachable (a tripped circuit, a disabled credential) answers every later
    ``read`` that way at once and reports it through ``available`` /
    ``unavailable_reason``.
    """

    @property
    def available(self) -> bool: ...

    @property
    def unavailable_reason(self) -> str | None: ...

    async def read(self, repo: str, pr_number: int) -> LandVerdict: ...


@dataclass
class ReconcileOutcome:
    """What one pass did — see ``FollowupReconcileResponse`` for each field."""

    examined: int = 0
    fixed: int = 0
    reopened: int = 0
    pending: int = 0
    unknown: int = 0
    raced: int = 0
    distinct_prs: int = 0
    coord_available: bool = True
    coord_unavailable_reason: str | None = None
    unknown_reasons: Counter[str] = field(default_factory=Counter)
    truncated: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "examined": self.examined,
            "fixed": self.fixed,
            "reopened": self.reopened,
            "pending": self.pending,
            "unknown": self.unknown,
            "raced": self.raced,
            "distinct_prs": self.distinct_prs,
            "coord_available": self.coord_available,
            "coord_unavailable_reason": self.coord_unavailable_reason,
            "unknown_reasons": dict(self.unknown_reasons),
            "truncated": self.truncated,
        }


async def _read_verdicts(
    reader: LandReader, citations: Sequence[str]
) -> dict[str, LandVerdict]:
    """Each citation read ONCE, at most :data:`RECONCILE_FANOUT` at a time."""
    gate = asyncio.Semaphore(RECONCILE_FANOUT)

    async def one(citation: str) -> tuple[str, LandVerdict]:
        parsed = parse_pr_citation(citation)
        if parsed is None:
            return citation, LandVerdict(
                "unknown", unknown_reason="unparseable_resolution_pr"
            )
        async with gate:
            return citation, await reader.read(*parsed)

    return dict(await asyncio.gather(*(one(c) for c in citations)))


async def _settle_one(
    db: AsyncSession,
    outcome: ReconcileOutcome,
    edge_id: UUID,
    citation: str | None,
    verdicts: dict[str, LandVerdict],
    actor: str,
) -> None:
    """Apply one ``fixing`` row's verdict and count it."""
    verdict = (
        verdicts[citation]
        if citation
        else LandVerdict("unknown", unknown_reason="no_resolution_pr")
    )
    if verdict.verdict == "pending":
        outcome.pending += 1
        return
    if verdict.verdict == "unknown":
        outcome.unknown += 1
        outcome.unknown_reasons[verdict.unknown_reason or "unknown"] += 1
        return
    try:
        if verdict.verdict == "landed":
            _, changed = await transition_followup(
                db,
                edge_id,
                to="fixed",
                actor=actor,
                pr=citation,
                commit=verdict.land_commit,
                expect_state="fixing",
                expect_pr=citation,
                note=(
                    f"coord land record: {citation} landed via "
                    f"{verdict.via or 'an unstated path'}"
                    + (
                        ""
                        if verdict.land_commit
                        else "; coord holds no land commit for it"
                    )
                ),
            )
            if changed:
                outcome.fixed += 1
            else:
                outcome.raced += 1
        else:  # closed_unlanded
            _, changed = await transition_followup(
                db,
                edge_id,
                to="open",
                actor=actor,
                expect_state="fixing",
                expect_pr=citation,
                note=f"coord land record: {citation} closed without landing",
            )
            if changed:
                outcome.reopened += 1
            else:
                outcome.raced += 1
    except (FollowupTransitionConflict, FollowupTransitionInvalid):
        # Another writer moved the row between the page read and the lock —
        # the compare-and-set on ``fixing`` under ``citation`` refused it, or
        # the move is otherwise no longer legal; its move stands.
        outcome.raced += 1


async def reconcile_fixing_followups(
    db: AsyncSession,
    *,
    reader: LandReader,
    actor: str,
    org_id: UUID | None = None,
    all_organizations: bool = False,
    page_size: int = RECONCILE_PAGE_SIZE,
    max_rows: int = RECONCILE_MAX_ROWS,
) -> ReconcileOutcome:
    """Move every ``fixing`` follow-up whose PR coord has settled (D5).

    ``landed`` → ``fixed`` (stamped with coord's land commit when it holds
    one); ``closed_unlanded`` → back to ``open``, with history; ``pending`` →
    unchanged; ``unknown`` (coord's own verdict, or no usable answer) →
    unchanged and counted with its reason. Never a guess: a row whose PR
    could not be read stays exactly as it was.

    Scope: the caller's organization, or — for the scheduled task —
    ``all_organizations``. The walk is a keyset over the immutable
    ``(created_at, id)``, ``page_size`` rows at a time, so rows this pass
    moves out of ``fixing`` cannot shift the pages still ahead; each DISTINCT
    PR is read once per pass. Every move goes through
    :func:`transition_followup` under a compare-and-set precondition
    (``expect_state="fixing"``, ``expect_pr=<the citation read>``, checked
    under the row lock), so a row another writer moved in the meantime — even
    one that came back through ``open`` to ``dismissed`` or to ``fixing``
    under another PR — is left as that writer left it and counted ``raced``.
    """
    if max_rows < 1:
        raise ValueError("max_rows must be at least 1")
    outcome = ReconcileOutcome()
    verdicts: dict[str, LandVerdict] = {}
    after: KeysetPosition | None = None

    while True:
        filters: list[ColumnElement[bool]] = [
            sql_predicate(FOLLOWUP_STATE_SQL["fixing"])
        ]
        if not all_organizations:
            filters.append(_org_scope(org_id))
        if after is not None:
            filters.append(
                _keyset_cut(
                    WorkArtifactEdge.created_at,
                    WorkArtifactEdge.id,
                    after,
                    descending=False,
                )
            )
        take = min(page_size, max_rows - outcome.examined)
        # One row past the page says whether another page exists, read BEFORE
        # this page's moves (which can only remove rows behind the cursor).
        page = (
            await db.execute(
                select(
                    WorkArtifactEdge.id,
                    WorkArtifactEdge.created_at,
                    WorkArtifactEdge.resolution_pr,
                )
                .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
                .where(*filters)
                .order_by(WorkArtifactEdge.created_at.asc(), WorkArtifactEdge.id.asc())
                .limit(take + 1)
            )
        ).all()
        if not page:
            break
        has_more = len(page) > take
        page = page[:take]

        unread = sorted(
            {row.resolution_pr for row in page if row.resolution_pr} - set(verdicts)
        )
        verdicts.update(await _read_verdicts(reader, unread))

        for edge_id, _created_at, citation in page:
            outcome.examined += 1
            await _settle_one(db, outcome, edge_id, citation, verdicts, actor)

        if not has_more:
            break
        last_id, last_at, _ = page[-1]
        after = KeysetPosition(at=last_at, id=last_id)
        if outcome.examined >= max_rows:
            outcome.truncated = True
            break

    outcome.distinct_prs = len(verdicts)
    outcome.coord_available = reader.available
    outcome.coord_unavailable_reason = reader.unavailable_reason
    return outcome


async def count_fixing_followups(
    db: AsyncSession, *, org_id: UUID | None = None, all_organizations: bool = False
) -> int:
    """How many ``fixing`` follow-ups are in scope — what a pass that could not
    read coord at all reports as UNKNOWN, rather than claiming nothing to do."""
    filters: list[ColumnElement[bool]] = [sql_predicate(FOLLOWUP_STATE_SQL["fixing"])]
    if not all_organizations:
        filters.append(_org_scope(org_id))
    stmt = (
        select(func.count())
        .select_from(WorkArtifactEdge)
        .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
        .where(*filters)
    )
    return int((await db.execute(stmt)).scalar_one())
