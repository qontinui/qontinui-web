"""CRUD for the Plan & Prompt Library (``agent.work_artifacts``).

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``.

Scoping contract
----------------
Every function takes ``org_id: UUID | None`` — the organization derived from
the authenticated principal by the endpoint layer, NEVER from a request body.
Rows are matched with the same NULL-collapsing expression the functional
unique index uses (``coalesce(organization_id, nil) = coalesce(:org, nil)``),
so a principal with no personal organization reads and writes the NULL
bucket consistently instead of seeing everything or nothing.

Upsert contract
---------------
``content_sha256`` is ALWAYS computed server-side from ``body``. When it
matches the stored digest the BODY is a no-op: ``current_version`` does not
move and no version row is appended — the version log is the body's history
and nothing else. The head row's metadata (``title``, ``status``, ``repos``,
``intent_refs``, ``work_unit_slug``, ``authored_at``, ``source_path``,
``captured_by``) is
still written when any of it differs, and ``changed`` reports that honestly
(Phase 5 of ``2026-09-03-plan-library-write-door-nonce-authorized-and-body-sync-on-by-default``:
an accepted POST used to drop a corrected ``status`` on the floor whenever the
body was already stored). When the digest differs, the head row is updated and
a snapshot is appended in the SAME transaction.

Terminal-status contract
------------------------
``status`` is opaque free-form text. The single "done" reading is
:func:`is_terminal_status`: the FIRST token of the normalized status against
:data:`app.models.work_artifact.TERMINAL_STATUSES`, so the fleet's dated
stamps (``SHIPPED 2026-09-02``, ``shipped (PR #12)``) read as done while
``IN PROGRESS`` / ``NOT STARTED`` do not. :func:`_terminal_token_sql` is the
SQL twin the candidate read uses, and the two MUST stay in step.

Kind-lock contract (``plan_library_02_kind_lock``)
--------------------------------------------------
``upsert_artifact`` has TWO resolution modes, selected by
``kind_is_heuristic``:

* ``False`` (default — operator/agent/API writes): phase-1 behaviour. The
  target row is the EXACT identity ``(org, kind, slug, source_repo)``, and the
  write additionally sets ``kind_locked = True``, because a caller that names
  a kind is asserting it.
* ``True`` (the runner scanner, whose kind is a filename/body heuristic): the
  target row is resolved by ``(org, slug, source_repo)`` **ignoring kind**, so
  a corrected artifact is FOUND rather than forked into a second row. A locked
  row keeps its kind; an unlocked one lets the heuristic move it.

When the kind-less key matches more than one row (a corpus that already forked
before this fix), the resolver prefers the single ``kind_locked`` row if there
is exactly one, and otherwise raises :class:`AmbiguousArtifactKind` — the
scanner must NOT pick a winner silently. The endpoint turns that into a
structured 409 naming the candidate ids so ``/plan-library/divergent``
surfaces the fork instead.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import typing
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid5

from sqlalchemy import (
    ColumnElement,
    DateTime,
    Select,
    Text,
    Uuid,
    cast,
    false,
    func,
    literal,
    or_,
    select,
    text,
    true,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, load_only

from app.core.bounded_read import KeysetPosition, SortKey
from app.models.work_artifact import (
    NIL_ORGANIZATION_ID,
    NOTE_TRIM_CHARS,
    SEARCH_TSVECTOR_SQL,
    SPAWNED_FOLLOWUP_RELATION,
    SPEC_ARTIFACT_KINDS,
    TERMINAL_STATUSES,
    WorkArtifact,
    WorkArtifactEdge,
    WorkArtifactSpecRefCounter,
    WorkArtifactVersion,
    format_spec_ref,
)
from app.services.plan_difficulty import RUBRIC_VERSION, compute_difficulty

#: The only kind the difficulty rubric rates. It was calibrated on plans; a
#: prompt or a report is not a unit of implementation work.
DIFFICULTY_RATED_KIND = "plan"

#: Bodies loaded per round trip when re-rating stale rows — bounds the memory
#: one re-rating pass holds (a plan body runs to ~100 KB at the tail).
_DIFFICULTY_RERATE_BATCH = 100

#: Plans one request re-rates at most — ~2 s of CPU in a worker thread. The
#: backlog a deploy leaves is worked through by the reads that follow.
_DIFFICULTY_RERATE_LIMIT = 300

#: Relations traversed BACKWARDS to reconstruct the prompt chain that produced
#: a plan: ``investigation_prompt --produced_report--> report --feeds-->
#: plan_authoring_prompt --authored_plan--> plan``. ``supersedes`` and
#: ``depends_on`` are deliberately excluded — they relate peer artifacts, not
#: producers.
PROMPT_CHAIN_RELATIONS: tuple[str, ...] = (
    "authored_plan",
    "feeds",
    "produced_report",
)

#: Hard stop for the backwards prompt-chain walk. The graph is user-authored
#: and may contain cycles; the visited set already breaks them, this bounds a
#: pathological long chain as well.
_PROMPT_CHAIN_MAX_DEPTH = 10

_NON_ALNUM = re.compile(r"[^A-Z0-9]+")

# ── keyset sort keys (plan ``2026-09-05-every-bounded-read-…`` Phase 4) ──
#
# Every one walks an IMMUTABLE ``created_at`` with the row's unique id as the
# tiebreak (D8): ``agent.work_artifacts.created_at`` and
# ``agent.work_artifact_edges.created_at`` have no UPDATE site anywhere, which
# ``tests/test_plan_library_keyset.py`` pins by grepping the backend for one.
# ``authored_at`` is NOT eligible even though D8 names it: the upsert rewrites
# it from whatever the scanner re-derives (:func:`_assign_head_metadata`).

#: ``GET /plan-library`` — newest captured first.
ARTIFACT_LIST_SORT_KEY = SortKey("agent.work_artifacts:created_at,id")

#: ``GET /plan-library/candidates`` — oldest first over BOTH arms of the
#: union: an artifact's ``(created_at, id)`` and a coord work unit's own
#: immutable ``(created_at, id)``, compared as one total order.
CANDIDATE_SORT_KEY = SortKey("plan-candidates:created_at,id asc")

#: ``GET /plan-library/followups`` (and ``/candidates``' ``open_followups``)
#: — oldest first.
FOLLOWUP_SORT_KEY = SortKey("agent.work_artifact_edges:created_at,id asc")

#: ``GET /plan-library/reconciliation`` — its rows are STEMS, a union of two
#: stores with no row of their own, so the position is derived from the stem
#: alone (:func:`stem_position`): immutable by construction, because a stem
#: is an identity and never changes.
RECONCILIATION_SORT_KEY = SortKey("plan-stems:stem-date,stem-uuid5 asc")

#: The namespace of :func:`stem_position`'s uuid5 tiebreak.
_STEM_NAMESPACE = UUID("8a3d1f0e-5c2b-5e7a-9b4d-6f1e2c3a4b5d")

_STEM_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")

_UNDATED_STEM = datetime(1970, 1, 1, tzinfo=UTC)


def _keyset_cut(
    at_column: InstrumentedAttribute[datetime],
    id_column: InstrumentedAttribute[UUID],
    after: KeysetPosition,
    *,
    descending: bool,
) -> ColumnElement[bool]:
    """The row comparison that resumes a keyset walk strictly after ``after``.

    ``(at, id) < (k, i)`` for a ``DESC`` walk, ``>`` for ``ASC`` — the SAME
    columns, in the same order, as the statement's ``ORDER BY`` (SortKey
    clause 3), so the cut and the sort can never disagree.
    """
    columns = tuple_(at_column, id_column)
    position = tuple_(
        literal(after.at, DateTime(timezone=True)),
        literal(after.id, Uuid()),
    )
    return columns < position if descending else columns > position


def stem_position(stem: str) -> KeysetPosition:
    """A plan stem's :data:`RECONCILIATION_SORT_KEY` position.

    ``at`` is the stem's own ``YYYY-MM-DD`` prefix (midnight UTC) — plan stems
    are date-prefixed, so the walk is chronological by authoring day; a stem
    with no valid date prefix sorts first, at the Unix epoch. ``id`` is a
    uuid5 of the stem, the unique tiebreak (distinct stems never share one).
    Both are pure functions of the stem, so no write anywhere can move a
    stem's position (D8) — the property ``slug_asc`` paging under ``OFFSET``
    never had, because every stem added ahead of the window shifted it.
    """
    at = _UNDATED_STEM
    match = _STEM_DATE.match(stem)
    if match is not None:
        try:
            year, month, day = (int(part) for part in match.groups())
            at = datetime(year, month, day, tzinfo=UTC)
        except ValueError:
            at = _UNDATED_STEM
    return KeysetPosition(at=at, id=uuid5(_STEM_NAMESPACE, stem))


class AmbiguousArtifactKind(Exception):
    """A kind-less resolution matched several rows with no locked winner.

    Raised by the scan-safe upsert path instead of picking one arbitrarily.
    Carries the candidate ids so the caller can name them in a 409 and the
    operator can fix the fork through ``/plan-library/divergent``.
    """

    def __init__(
        self,
        *,
        slug: str,
        source_repo: str | None,
        candidates: list[WorkArtifact],
    ) -> None:
        self.slug = slug
        self.source_repo = source_repo
        self.candidate_ids = [row.id for row in candidates]
        self.candidate_kinds = sorted({row.kind for row in candidates})
        super().__init__(
            f"slug={slug!r} source_repo={source_repo!r} resolves to "
            f"{len(candidates)} rows with kinds {self.candidate_kinds} and no "
            "single kind_locked row to prefer"
        )


class SpecFamilyBoundary(Exception):
    """A kind change would move an artifact into or out of the spec family.

    A specification artifact's ``spec_ref`` prefix names its kind
    (``REQ-0042`` is a requirement), and the ref is the artifact's stable
    identity — so its kind is fixed for life, and a non-spec artifact cannot
    become one either (it has no ref, and minting one for a re-kind would make
    "created" and "relabelled" indistinguishable). A different kind of thing
    is a NEW artifact linked by ``derives_from`` / ``refines``. Raised before
    anything is written; surfaced as a 409.
    """

    def __init__(self, *, from_kind: str, to_kind: str, spec_ref: str | None) -> None:
        self.from_kind = from_kind
        self.to_kind = to_kind
        self.spec_ref = spec_ref
        super().__init__(
            f"cannot change kind {from_kind!r} -> {to_kind!r}: a specification "
            "artifact's kind is fixed by its stable spec_ref"
            + (f" ({spec_ref})" if spec_ref else "")
            + ", and no other artifact can become one; create a new artifact "
            "and link it with derives_from or refines instead"
        )


def is_spec_kind(kind: str) -> bool:
    """Whether ``kind`` is in the specification family."""
    return kind in SPEC_ARTIFACT_KINDS


def _check_spec_family_boundary(row: WorkArtifact, kind: str) -> None:
    """Raise :class:`SpecFamilyBoundary` for a kind change the family forbids.

    Unchanged kinds always pass. Between two non-spec kinds — the scanner's
    heuristic correction space — always passes. Anything touching a spec kind
    on either side is refused.
    """
    if row.kind == kind:
        return
    if is_spec_kind(row.kind) or is_spec_kind(kind):
        raise SpecFamilyBoundary(
            from_kind=row.kind, to_kind=kind, spec_ref=row.spec_ref
        )


async def allocate_spec_ref(db: AsyncSession, *, org_id: UUID | None, kind: str) -> str:
    """Hand out the next ``spec_ref`` for ``kind`` in ``org_id``'s scope.

    One atomic statement — ``INSERT … ON CONFLICT (organization_scope, kind)
    DO UPDATE SET last_number = last_number + 1 RETURNING last_number`` — so
    two concurrent creates serialize on the counter row and can never draw
    the same number. The counter only moves forward, which is what makes a
    ref never reused: a deleted ``REQ-0042`` leaves 42 spent. It runs in the
    CALLER's transaction, so a create that rolls back un-spends its number
    along with everything else (a later commit-then-delete does not).
    """
    scope = org_id if org_id is not None else NIL_ORGANIZATION_ID
    counter = WorkArtifactSpecRefCounter.__table__
    stmt = (
        pg_insert(counter)
        .values(organization_scope=scope, kind=kind, last_number=1)
        .on_conflict_do_update(
            index_elements=[counter.c.organization_scope, counter.c.kind],
            set_={"last_number": counter.c.last_number + 1},
        )
        .returning(counter.c.last_number)
    )
    number = int((await db.execute(stmt)).scalar_one())
    return format_spec_ref(kind, number)


class ArtifactKindConflict(Exception):
    """Setting a kind would collide with an existing row's identity.

    ``uq_work_artifacts_identity`` covers ``kind``, so re-kinding a row onto a
    ``(org, kind, slug, source_repo)`` that another row already occupies is a
    unique violation. Surfaced as a 409 naming the occupant rather than a 500.
    """

    def __init__(self, *, kind: str, slug: str, existing_id: UUID | None) -> None:
        self.kind = kind
        self.slug = slug
        self.existing_id = existing_id
        super().__init__(
            f"another artifact already occupies kind={kind!r} slug={slug!r}"
            + (f" (id={existing_id})" if existing_id is not None else "")
        )


def normalize_status(status: str | None) -> str:
    """Fold an opaque status onto its comparison form.

    Uppercase, every run of non-alphanumerics collapsed to ``_``, edges
    trimmed — so ``"IN PROGRESS"``, ``"in-progress"`` and ``"In_Progress"``
    all compare equal. Mirrors the SQL expression :func:`_normalized_status`
    builds, and the two MUST stay in step.
    """
    return _NON_ALNUM.sub("_", (status or "").upper()).strip("_")


def _normalized_status() -> ColumnElement[str]:
    """The SQL twin of :func:`normalize_status`, over ``WorkArtifact.status``."""
    return func.btrim(
        func.regexp_replace(func.upper(WorkArtifact.status), "[^A-Z0-9]+", "_", "g"),
        "_",
    )


def terminal_token(status: str | None) -> str:
    """The FIRST ``_``-separated token of :func:`normalize_status`.

    The fleet stamps a plan ``Status: SHIPPED 2026-09-02`` — a verb followed
    by a date, a PR number or a parenthetical — and the runner scanner stores
    that stamp opaquely (``body_push.rs``
    ``a_stamped_prompt_keeps_its_opaque_status``). Whole-string membership
    therefore read EVERY dated stamp as not-done: ``unmet_depends_on`` kept a
    landed dependency unmet and ``/candidates`` kept listing shipped plans.
    The terminal reading is the leading word alone; the remainder is
    provenance, not state. ``""`` for an empty or ``None`` status, which is
    in no vocabulary and so reads as not-yet-done. Mirrors
    :func:`_terminal_token_sql`, and the two MUST stay in step.
    """
    return normalize_status(status).split("_", 1)[0]


def _terminal_token_sql() -> ColumnElement[str]:
    """The SQL twin of :func:`terminal_token`, over ``WorkArtifact.status``.

    ``split_part(x, '_', 1)`` returns the whole string when there is no
    ``_`` and ``''`` for ``''`` — the same two edges Python's
    ``split("_", 1)[0]`` has.
    """
    return func.split_part(_normalized_status(), "_", 1)


def is_terminal_status(status: str | None) -> bool:
    """True when this opaque status reads as "done".

    ``SHIPPED 2026-09-02``, ``SHIPPED_2026_09_02`` and ``shipped (PR #12)``
    are all done; ``IN PROGRESS`` and ``NOT STARTED`` are not (``IN`` and
    ``NOT`` are in no vocabulary). Read via :func:`terminal_token` so the
    candidate read's SQL arm (:func:`_plan_candidate_filters`) and every
    Python caller — ``unmet_depends_on``, the work-unit arm of the candidate
    union — share one reading.
    """
    return terminal_token(status) in TERMINAL_STATUSES


def compute_content_sha256(body: str) -> str:
    """The canonical digest for an artifact body.

    Hex sha256 of the UTF-8 bytes. Named for the algorithm (see the model's
    ``content_sha256`` comment) so no reader has to guess which digest a
    ``checksum``/``content_hash`` column holds.
    """
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _org_scope(org_id: UUID | None):
    """The NULL-collapsing organization predicate.

    Mirrors ``uq_work_artifacts_identity``'s leading expression exactly.
    """
    return func.coalesce(
        WorkArtifact.organization_id, NIL_ORGANIZATION_ID
    ) == func.coalesce(org_id, NIL_ORGANIZATION_ID)


#: Characters that glue words into one identifier — ``-``, ``_``, ``/``,
#: ``\`` — plus whitespace, folded to a single space for the full-text arm.
_Q_WORD_GLUE = re.compile(r"[-_/\\\s]+")

#: A trailing ``.md``, so a pasted filename reads as its stem.
_Q_MD_SUFFIX = re.compile(r"\.md$", re.IGNORECASE)

#: The escape character of the slug arm's ``ILIKE``.
_LIKE_ESCAPE = "\\"


def _full_text_query(q: str) -> str:
    """``q`` as the words ``plainto_tsquery`` should AND together.

    The ``english`` parser reads ``devops-unfiltered-push-trigger`` as ONE
    compound token and emits the whole-compound lexeme AND-ed with its parts,
    so the query matches only a document carrying that exact hyphenated
    string — prose saying "unfiltered push trigger" misses. Folding the glue
    characters to spaces first means only the part-words are ever asked for.
    ``""`` when nothing but glue is left.
    """
    return _Q_WORD_GLUE.sub(" ", _Q_MD_SUFFIX.sub("", q.strip())).strip()


#: The shortest needle the slug arm will take. Below this, a substring match
#: stops being an identifier lookup and becomes a corpus-wide sweep: every
#: plan slug is date-prefixed, so ``-``, ``2`` and ``a`` each appear in
#: nearly every row.
_SLUG_NEEDLE_MIN_LEN = 3

#: A needle must carry at least one letter or digit. Pure punctuation is glue,
#: never an identifier. (``[^\W_]`` is "alphanumeric", underscore excluded.)
_HAS_ALNUM = re.compile(r"[^\W_]", re.UNICODE)


def _slug_needle(q: str) -> str:
    """``q`` as the slug substring a pasted identifier denotes, or ``""``.

    Trimmed, minus a trailing ``.md`` and any leading directory, so
    ``plans/2026-08-31-some-plan.md`` reads as ``2026-08-31-some-plan``.

    Returns ``""`` — i.e. NO slug arm — for anything not identifier-shaped:
    nothing left after trimming, no alphanumeric character at all, or fewer
    than :data:`_SLUG_NEEDLE_MIN_LEN` characters. That guard is the whole
    reason this is a function and not an expression. A slug substring match
    is unanchored at both ends and every plan slug opens with
    ``YYYY-MM-DD-``, so a one-character needle is not a weak query — ``q="-"``
    is ``slug ILIKE '%-%'``, which matches EVERY row, and the same predicate
    backs ``/export``, so it would export the corpus. Short and
    punctuation-only inputs therefore fall back to the full-text arm alone,
    which drops them (``plainto_tsquery`` yields nothing for glue or a
    stopword) and so correctly matches nothing.
    """
    stem = _Q_MD_SUFFIX.sub("", q.strip())
    needle = re.split(r"[/\\]", stem)[-1].strip()
    if len(needle) < _SLUG_NEEDLE_MIN_LEN or not _HAS_ALNUM.search(needle):
        return ""
    return needle


def _escape_like(value: str) -> str:
    """Escape LIKE metacharacters so user text matches literally."""
    return (
        value.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", f"{_LIKE_ESCAPE}%")
        .replace("_", f"{_LIKE_ESCAPE}_")
    )


def _search_predicate(q: str) -> ColumnElement[bool]:
    """The ``q`` filter: full text over title/body OR a substring of ``slug``.

    Two arms, because ``q`` gets two kinds of input and the vector serves only
    one of them. Prose goes to the full-text arm, normalized by
    :func:`_full_text_query`. A pasted slug or filename is an IDENTIFIER
    lookup the vector cannot answer — ``slug`` is not indexed text, and a
    plan's body need not repeat its own filename — so the raw ``q`` is also
    matched as a case-insensitive substring of ``slug``, with LIKE
    metacharacters escaped so ``%`` and ``_`` match themselves rather than
    everything.

    The slug arm is unindexed, and it is gated on :func:`_slug_needle`
    judging the input identifier-shaped — which is not only about matching
    too much. A leading-wildcard ``ILIKE`` that no index can serve, OR-ed
    with the full-text arm, leaves the planner nothing to combine and costs
    the GIN arm its index too; the gate is what keeps an ordinary prose query
    on the indexed path.

    A ``q`` that leaves neither arm anything to ask for — whitespace, bare
    glue, or a needle too short to be an identifier — matches NOTHING, the
    reading ``plainto_tsquery`` of an empty string always had. Never
    everything: :func:`_slug_needle` says why that distinction is the
    load-bearing one.
    """
    arms: list[ColumnElement[bool]] = []
    words = _full_text_query(q)
    if words:
        # Spelled to match ix_work_artifacts_search's indexed expression.
        # A ``TextClause`` is a boolean SQL expression here, which the stubs
        # cannot know; ``or_`` accepts it at runtime exactly as ``where`` does.
        # (`typing.cast`, not the bare name — `cast` is SQLAlchemy's in this
        # module.) The OR list is parenthesised by ``BooleanClauseList`` when
        # it is AND-ed with the other filters, not by anything asked for here.
        full_text = text(
            f"{SEARCH_TSVECTOR_SQL} @@ plainto_tsquery('english', :plan_lib_q)"
        ).bindparams(plan_lib_q=words)
        arms.append(typing.cast("ColumnElement[bool]", full_text))
    needle = _slug_needle(q)
    if needle:
        arms.append(
            WorkArtifact.slug.ilike(f"%{_escape_like(needle)}%", escape=_LIKE_ESCAPE)
        )
    if not arms:
        return false()
    return or_(*arms)


def _apply_filters(
    stmt: Select,
    *,
    org_id: UUID | None,
    kind: str | None,
    status: str | None,
    repo: str | None,
    q: str | None,
    since: datetime | None,
    work_unit_slug: str | None,
    intent_ref: str | None = None,
    slug: str | None = None,
    spec_ref: str | None = None,
) -> Select:
    """Apply the shared list/count filters to a statement.

    ``slug`` and ``work_unit_slug`` are DIFFERENT columns with different
    write rules, and a consumer has to know which to ask for
    (``2026-08-27-plan-corpus-read-path-is-dark`` D4 / Phase 3):

    * ``slug`` is the artifact's OWN identifier — part of the unique key,
      never null, written by every door. The scanner writes the file stem
      into it and a hand-``POST`` writes whatever it sends.
    * ``work_unit_slug`` is a SOFT LINK to a coord work unit — nullable, no
      FK. The scanner writes the plan's stem into it for ``kind == plan``
      only (``body_push.rs``); a hand-``POST``ed row carries it only when the
      caller thought to send it, and is null otherwise.

    So ``?slug=<stem>`` is the exact by-stem door that finds a plan whoever
    wrote it, and ``?work_unit_slug=<stem>`` finds the rows that DECLARE a
    link to that unit. Both are exact equality; neither is a prefix or a
    full-text match. ``q`` is the one free-text filter, and it is two arms
    OR-ed together — full text over ``title || body`` and a case-insensitive
    substring match on ``slug`` — so a pasted filename finds its plan; see
    :func:`_search_predicate`. It never reads ``work_unit_slug``.
    """
    stmt = stmt.where(_org_scope(org_id))
    if kind is not None:
        stmt = stmt.where(WorkArtifact.kind == kind)
    if status is not None:
        # Opaque comparison — whatever string the caller sends is matched
        # verbatim. An unknown status yields an empty page, never a 422.
        stmt = stmt.where(WorkArtifact.status == status)
    if repo is not None:
        # A repo matches either the repos[] array or the originating repo.
        # Spelled as the array-containment operator ``@>`` rather than
        # ``= ANY(repos)``: ``@>`` is the one GIN can serve from
        # ix_work_artifacts_repos, ``= ANY`` forces a sequential scan.
        stmt = stmt.where(
            or_(
                WorkArtifact.repos.op("@>")(cast([repo], ARRAY(Text))),
                WorkArtifact.source_repo == repo,
            )
        )
    if q:
        stmt = stmt.where(_search_predicate(q))
    if since is not None:
        stmt = stmt.where(WorkArtifact.updated_at >= since)
    if work_unit_slug is not None:
        stmt = stmt.where(WorkArtifact.work_unit_slug == work_unit_slug)
    if intent_ref is not None:
        # "Which artifacts bear on this Intent?" — the query the column exists
        # to serve. Containment (``@>``) so ix_work_artifacts_intent_refs (GIN)
        # answers it, exactly as the ``repo`` filter above is spelled.
        stmt = stmt.where(
            WorkArtifact.intent_refs.op("@>")(cast([intent_ref], ARRAY(Text)))
        )
    if slug is not None:
        stmt = stmt.where(WorkArtifact.slug == slug)
    if spec_ref is not None:
        # Exact; ``uq_work_artifacts_spec_ref`` makes it at most one row per
        # organization scope.
        stmt = stmt.where(WorkArtifact.spec_ref == spec_ref)
    return stmt


async def list_artifacts(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str | None = None,
    status: str | None = None,
    repo: str | None = None,
    q: str | None = None,
    since: datetime | None = None,
    work_unit_slug: str | None = None,
    intent_ref: str | None = None,
    slug: str | None = None,
    spec_ref: str | None = None,
    after: KeysetPosition | None = None,
    limit: int = 50,
) -> tuple[list[WorkArtifact], int]:
    """A filtered page of artifacts, newest-CAPTURED first, plus the exact
    count of matching rows from the page's start position onward.

    A keyset walk over :data:`ARTIFACT_LIST_SORT_KEY` — ``(created_at, id)
    DESC`` — resumed strictly after ``after`` (plan
    ``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus``
    Phase 4, which deleted the ``OFFSET`` this used to page with: an offset
    over a live corpus skips a row for every row deleted ahead of it). The
    order used to be ``updated_at DESC``, which a keyset cannot walk — every
    upsert moves the key (D8) — so the walk is on the immutable capture time
    and "recently updated" is a client-side sort over what it read.

    The count carries the same keyset predicate, so it is the bounded-read
    ``total`` (``truncated`` ⇔ ``total > len(rows)``); on the first page it is
    the whole filtered corpus.
    """
    base = _apply_filters(
        select(WorkArtifact),
        org_id=org_id,
        kind=kind,
        status=status,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
        intent_ref=intent_ref,
        slug=slug,
        spec_ref=spec_ref,
    )

    count_stmt = _apply_filters(
        select(func.count()).select_from(WorkArtifact),
        org_id=org_id,
        kind=kind,
        status=status,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
        intent_ref=intent_ref,
        slug=slug,
        spec_ref=spec_ref,
    )
    if after is not None:
        # The row comparison IS the sort: ``(created_at, id) < (k, i)`` under
        # ``ORDER BY created_at DESC, id DESC`` (SortKey clause 3).
        before = _keyset_cut(
            WorkArtifact.created_at, WorkArtifact.id, after, descending=True
        )
        base = base.where(before)
        count_stmt = count_stmt.where(before)
    total = int((await db.execute(count_stmt)).scalar_one())

    rows = (
        (
            await db.execute(
                base.order_by(
                    WorkArtifact.created_at.desc(), WorkArtifact.id.desc()
                ).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows), total


async def count_artifacts(
    db: AsyncSession, *, org_id: UUID | None, kind: str | None = None
) -> int:
    """How many artifacts this organization holds, optionally of one kind.

    Exists for the callers that need the CORPUS SIZE and no rows —
    ``/operations/plans``' body-signal join asks "does this org hold any
    ``plan`` artifact at all?", and answering it through
    :func:`list_artifacts` would pay for a page of rows it discards. Zero here
    is a measurement, which is the whole point: it is what distinguishes "this
    slug has no body" from "this principal's org has no corpus to miss in".
    """
    stmt = select(func.count()).select_from(WorkArtifact).where(_org_scope(org_id))
    if kind is not None:
        stmt = stmt.where(WorkArtifact.kind == kind)
    return int((await db.execute(stmt)).scalar_one())


async def work_unit_slugs_with_artifacts(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slugs: Sequence[str],
    kind: str,
) -> set[str]:
    """Which of ``slugs`` have an artifact of ``kind`` in this org's bucket.

    ONE bounded query over a whole page of work units, never one lookup per
    row: the ``/plans`` console fetches up to coord's 500-row clamp, and 500
    round trips per render is not a join, it is a loop.

    ``work_unit_slug`` is populated only for ``kind == "plan"`` (the runner's
    ``body_push`` writes the stem for that kind and NULL for every other), so
    the kind filter is what makes the answer mean "has a plan document"
    rather than "is mentioned by some artifact".

    Returns the slugs that MATCHED. A slug absent from the result is a miss,
    which is not the same claim as "has no body" — see
    :mod:`app.services.plan_body_signal` for the three-valued reading the
    caller must apply on top of it.
    """
    if not slugs:
        return set()
    stmt = (
        select(WorkArtifact.work_unit_slug)
        .where(
            _org_scope(org_id),
            WorkArtifact.kind == kind,
            WorkArtifact.work_unit_slug.in_(list(slugs)),
        )
        .distinct()
    )
    return {s for s in (await db.execute(stmt)).scalars().all() if s}


async def get_artifact(
    db: AsyncSession, artifact_id: UUID, *, org_id: UUID | None
) -> WorkArtifact | None:
    """One artifact, scoped to the caller's organization bucket."""
    stmt = select(WorkArtifact).where(
        WorkArtifact.id == artifact_id, _org_scope(org_id)
    )
    return (await db.execute(stmt)).scalars().first()


async def get_by_identity(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str,
    slug: str,
    source_repo: str | None,
) -> WorkArtifact | None:
    """Look a row up by the functional unique key."""
    stmt = select(WorkArtifact).where(
        _org_scope(org_id),
        WorkArtifact.kind == kind,
        WorkArtifact.slug == slug,
        func.coalesce(WorkArtifact.source_repo, "") == (source_repo or ""),
    )
    return (await db.execute(stmt)).scalars().first()


async def list_by_scan_identity(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    source_repo: str | None,
) -> list[WorkArtifact]:
    """Every row matching ``(org, slug, source_repo)`` — ``kind`` IGNORED.

    This is the scanner's resolution key. Phase 1's identity index includes
    ``kind``, so a corrected artifact is invisible to a re-scan that
    re-derives the heuristic kind; keying without ``kind`` finds it.

    Returns a list, not one row, because an already-forked corpus legitimately
    has several. Ordered ``kind_locked`` first (the preferred winner), then
    oldest-first so the ordering is stable for the ambiguity report.
    """
    stmt = (
        select(WorkArtifact)
        .where(
            _org_scope(org_id),
            WorkArtifact.slug == slug,
            func.coalesce(WorkArtifact.source_repo, "") == (source_repo or ""),
        )
        .order_by(
            WorkArtifact.kind_locked.desc(),
            WorkArtifact.created_at,
            WorkArtifact.id,
        )
    )
    return list((await db.execute(stmt)).scalars().all())


def resolve_scan_target(
    matches: list[WorkArtifact], *, slug: str, source_repo: str | None
) -> WorkArtifact | None:
    """Pick the single row a heuristic-kind scan should update.

    * no match          → ``None`` (the caller inserts).
    * exactly one match → that row.
    * several matches   → the ONE ``kind_locked`` row if there is exactly one;
      otherwise :class:`AmbiguousArtifactKind`.

    The "several matches" case is a corpus that forked before the kind-lock
    fix landed (or a genuine same-slug/different-kind pair). Picking
    arbitrarily would let the scanner silently overwrite whichever copy it
    happened to sort first, so it refuses — the fork stays visible in
    ``/plan-library/divergent`` and the rows are left untouched.
    """
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    locked = [row for row in matches if row.kind_locked]
    if len(locked) == 1:
        return locked[0]
    raise AmbiguousArtifactKind(slug=slug, source_repo=source_repo, candidates=matches)


async def list_versions(
    db: AsyncSession, artifact_id: UUID
) -> list[WorkArtifactVersion]:
    """Every snapshot of an artifact, oldest first."""
    stmt = (
        select(WorkArtifactVersion)
        .where(WorkArtifactVersion.document_id == artifact_id)
        .order_by(WorkArtifactVersion.version_number)
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_version(
    db: AsyncSession, artifact_id: UUID, version_number: int
) -> WorkArtifactVersion | None:
    """One specific snapshot of an artifact, or ``None`` if it does not exist.

    Plan ``2026-08-16-plan-corpus-authority-and-run-provenance`` Phase 4 — the
    export can address a historical ``version_number``, not just head. Callers
    MUST scope the parent artifact to the caller's organization before calling
    this: ``document_id`` alone is not an authorization boundary.
    """
    stmt = select(WorkArtifactVersion).where(
        WorkArtifactVersion.document_id == artifact_id,
        WorkArtifactVersion.version_number == version_number,
    )
    return (await db.execute(stmt)).scalars().first()


async def list_for_export(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str | None = None,
    status: str | None = None,
    repo: str | None = None,
    q: str | None = None,
    since: datetime | None = None,
    work_unit_slug: str | None = None,
    slug: str | None = None,
    limit: int,
) -> tuple[list[WorkArtifact], bool]:
    """Rows for a bulk export, plus whether ``limit`` truncated the result.

    Plan ``2026-08-16-plan-corpus-authority-and-run-provenance`` Phase 4.

    Shares :func:`_apply_filters` with :func:`list_artifacts` on purpose, so
    "export what I am looking at" is literally the same predicate as the list
    the operator page renders — an export whose filter grammar drifted from the
    list's would silently omit rows the caller believed were selected.

    Returns ``(rows, truncated)``. The bound is reported rather than applied
    silently: a bulk export that quietly stopped at N looks exactly like a
    corpus of N, and the caller cannot tell the difference. The route turns
    ``truncated`` into an explicit response header.
    """
    base = _apply_filters(
        select(WorkArtifact),
        org_id=org_id,
        kind=kind,
        status=status,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
        slug=slug,
    )
    # Fetch one MORE than asked for: the presence of row limit+1 is what proves
    # truncation. A separate COUNT would race the SELECT on a live corpus.
    rows = list(
        (
            await db.execute(
                base.order_by(
                    WorkArtifact.kind, WorkArtifact.slug, WorkArtifact.id
                ).limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    truncated = len(rows) > limit
    return rows[:limit], truncated


async def list_edges(
    db: AsyncSession, artifact_id: UUID
) -> list[tuple[WorkArtifactEdge, str, WorkArtifact | None]]:
    """Edges touching ``artifact_id`` in BOTH directions.

    Returns ``(edge, direction, peer)`` triples where ``direction`` is
    ``"outgoing"`` when the artifact is the edge's ``from_id`` and
    ``"incoming"`` when it is the ``to_id``, and ``peer`` is the artifact at
    the far end (``None`` should not happen — the FKs cascade — but the read
    tolerates it rather than 500ing).
    """
    stmt = (
        select(WorkArtifactEdge)
        .where(
            or_(
                WorkArtifactEdge.from_id == artifact_id,
                WorkArtifactEdge.to_id == artifact_id,
            )
        )
        .order_by(WorkArtifactEdge.created_at, WorkArtifactEdge.id)
    )
    edges = list((await db.execute(stmt)).scalars().all())
    if not edges:
        return []

    # ``to_id`` is nullable since ``plan_library_03_spawned_followup`` — an
    # OPEN follow-up has no far end at all. Filter the Nones out before the
    # IN-list: ``id IN (NULL)`` matches nothing but emits a SAWarning, and the
    # peer lookup below would then hand back ``None`` anyway.
    peer_ids = {
        peer
        for peer in (
            (e.to_id if e.from_id == artifact_id else e.from_id) for e in edges
        )
        if peer is not None
    }
    peers = {
        row.id: row
        for row in (
            await db.execute(select(WorkArtifact).where(WorkArtifact.id.in_(peer_ids)))
        )
        .scalars()
        .all()
    }

    out: list[tuple[WorkArtifactEdge, str, WorkArtifact | None]] = []
    for edge in edges:
        if edge.from_id == artifact_id:
            # ``to_id`` is None on an OPEN follow-up — there is no peer to
            # denormalize, which the caller renders as a one-ended edge.
            peer = peers.get(edge.to_id) if edge.to_id is not None else None
            out.append((edge, "outgoing", peer))
        else:
            out.append((edge, "incoming", peers.get(edge.from_id)))
    return out


#: The six columns :func:`difficulty_values` fills.
DIFFICULTY_COLUMNS: tuple[str, ...] = (
    "difficulty",
    "difficulty_conceptual",
    "difficulty_implementation",
    "difficulty_source",
    "difficulty_rubric_version",
    "difficulty_signals",
)


def difficulty_values(kind: str, body: str | None) -> dict[str, object]:
    """The ``difficulty*`` column values for an artifact of ``kind``/``body``.

    A ``plan`` is rated by
    :func:`app.services.plan_difficulty.compute_difficulty`; any other kind
    gets NULL in every column (unrated) — which is also what a plan whose kind
    a later correction moves away from ``plan`` needs.
    """
    if kind != DIFFICULTY_RATED_KIND:
        return dict.fromkeys(DIFFICULTY_COLUMNS)
    rating = compute_difficulty(body or "")
    return {
        "difficulty": rating.level,
        "difficulty_conceptual": rating.conceptual,
        "difficulty_implementation": rating.implementation,
        "difficulty_source": rating.source,
        "difficulty_rubric_version": rating.rubric_version,
        "difficulty_signals": rating.signals,
    }


def assign_difficulty(row: WorkArtifact) -> bool:
    """Rate ``row`` from its current ``kind`` and ``body``; ``True`` if moved.

    The ORM-side writer every upsert arm and the kind correction share; the
    stale-row re-rating writes the same :func:`difficulty_values` through a
    Core UPDATE instead (see :func:`rerate_stale_plan_difficulty`).
    """
    moved = False
    for field, value in difficulty_values(row.kind, row.body).items():
        if getattr(row, field) != value:
            setattr(row, field, value)
            moved = True
    return moved


@dataclass(frozen=True)
class _HeadMetadata:
    """The head row's payload-described metadata — everything a POST says
    about an artifact OTHER than its body and its identity.

    One value object so the unchanged-digest arm and the full-replace arm of
    :func:`upsert_artifact` write the SAME fields through the SAME assignment;
    two hand-written blocks is how the first one silently lost ``status``.
    ``kind`` / ``kind_locked`` are identity (the kind-lock contract) and
    ``body`` / ``content_sha256`` / ``current_version`` are content, so none
    of them belongs here.
    """

    title: str
    status: str
    source_path: str | None
    work_unit_slug: str | None
    repos: list[str]
    intent_refs: list[str]
    authored_at: datetime | None
    captured_by: str


def _assign_head_metadata(existing: WorkArtifact, metadata: _HeadMetadata) -> bool:
    """Write ``metadata`` onto the head row; ``True`` when any field moved.

    Fields that already hold the incoming value are not re-assigned, so an
    identical re-post leaves the row clean — the caller reads the return
    value, not the session's dirty state, and does not commit for nothing.
    ``captured_by`` is among them on purpose: it records the door that last
    ASSERTED this metadata, which is exactly what a metadata-only write is.
    """
    moved = False
    for field, value in (
        ("title", metadata.title),
        ("status", metadata.status),
        ("source_path", metadata.source_path),
        ("work_unit_slug", metadata.work_unit_slug),
        ("repos", metadata.repos),
        ("intent_refs", metadata.intent_refs),
        ("authored_at", metadata.authored_at),
        ("captured_by", metadata.captured_by),
    ):
        if getattr(existing, field) != value:
            setattr(existing, field, value)
            moved = True
    return moved


async def _settle_unchanged_digest(
    db: AsyncSession,
    existing: WorkArtifact,
    *,
    metadata: _HeadMetadata,
    kind_is_heuristic: bool,
) -> tuple[WorkArtifact, bool, bool]:
    """Finish an upsert whose body already matches the stored digest.

    No version bump and no snapshot — the version log is the body's history.
    Two things ARE written:

    * the head metadata, when any of it differs (this is the ``changed`` the
      caller reports, and the ``X-Artifact-Unchanged`` header follows it);
    * ``kind_locked``, False → True, on an explicit (non-heuristic) write.
      The lock records that a caller ASSERTED this kind; that assertion is
      independent of whether the body changed, and dropping it on a re-post
      would let the very next scan un-stick a correction. It is identity,
      not content, so it does NOT flip ``changed``.

    ``updated_at`` is stamped explicitly when metadata moved, the same way
    the full-replace arm stamps it; the column's ``onupdate`` stamps it on
    a lock-only write as well, because that is still an UPDATE of the row.
    An identical re-post issues no UPDATE at all and leaves it alone.
    """
    metadata_moved = _assign_head_metadata(existing, metadata)
    if metadata_moved:
        existing.updated_at = datetime.now(UTC)
    lock_asserted = not kind_is_heuristic and not existing.kind_locked
    if lock_asserted:
        existing.kind_locked = True
    # The rating is NOT refreshed here: an unchanged body cannot move it, and a
    # stale one (an older rubric) is healed by ``rerate_stale_plan_difficulty``,
    # which — unlike an ORM write here — leaves ``updated_at`` alone.
    if metadata_moved or lock_asserted:
        await db.commit()
        await db.refresh(existing)
    return existing, False, metadata_moved


async def upsert_artifact(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    user_id: UUID | None,
    kind: str,
    slug: str,
    title: str,
    status: str,
    body: str,
    source_path: str | None,
    source_repo: str | None,
    work_unit_slug: str | None,
    repos: list[str],
    authored_at: datetime | None,
    captured_by: str,
    change_description: str | None,
    created_by: str | None = None,
    kind_is_heuristic: bool = False,
    intent_refs: list[str] | None = None,
) -> tuple[WorkArtifact, bool, bool]:
    """Insert-or-update by the functional unique key.

    Returns ``(artifact, created, changed)``.

    * A brand-new key inserts the head row AND its version-1 snapshot →
      ``(row, True, True)``.
    * An existing key whose body hashes to the stored digest keeps its
      version log: ``current_version`` is untouched and no snapshot is
      appended — the log is the BODY's history. The head row's metadata
      (:func:`_assign_head_metadata`'s fields) is still written when any of
      it differs, and ``changed`` says whether it did →
      ``(row, False, changed_metadata)``. A byte-identical re-post is a
      full no-op → ``(row, False, False)``. ``kind_locked`` (see below) is
      written on this arm too, but it is an assertion about identity rather
      than content and does NOT count as ``changed``.
    * An existing key with different content bumps ``current_version``,
      rewrites the head row's metadata and appends a snapshot in the same
      transaction → ``(row, False, True)``.

    Both arms write the metadata through ONE helper so they cannot drift:
    the incident this repairs was a corrected ``status`` POSTed against an
    unchanged body and silently dropped (finding 43479836).

    ``kind_is_heuristic``
        ``False`` (default) — an operator/agent write. Target resolution is
        the phase-1 EXACT identity, and the write SETS ``kind_locked`` because
        the caller is asserting the kind. That is what makes a correction
        survive later scans.

        ``True`` — a runner scan whose kind came from a filename/body
        heuristic. Target resolution IGNORES ``kind`` (see
        :func:`list_by_scan_identity`); a ``kind_locked`` row keeps its kind,
        an unlocked one lets the heuristic move it, and a missing row is
        inserted unlocked. Raises :class:`AmbiguousArtifactKind` rather than
        guessing when the kind-less key matches several rows.
    """
    digest = compute_content_sha256(body)

    if kind_is_heuristic:
        matches = await list_by_scan_identity(
            db, org_id=org_id, slug=slug, source_repo=source_repo
        )
        # Raises AmbiguousArtifactKind on an unresolvable fork — deliberately
        # NOT caught here: no row is touched and the endpoint 409s.
        existing = resolve_scan_target(matches, slug=slug, source_repo=source_repo)
    else:
        existing = await get_by_identity(
            db, org_id=org_id, kind=kind, slug=slug, source_repo=source_repo
        )

    if existing is None:
        artifact = WorkArtifact(
            organization_id=org_id,
            created_by_user_id=user_id,
            kind=kind,
            # Spent BEFORE the flush, in this transaction: the race arm below
            # rolls back and so returns the number along with the row.
            spec_ref=(
                await allocate_spec_ref(db, org_id=org_id, kind=kind)
                if is_spec_kind(kind)
                else None
            ),
            # A heuristic kind is a guess and must stay correctable; an
            # explicit one is an assertion and locks immediately.
            kind_locked=not kind_is_heuristic,
            slug=slug,
            title=title,
            status=status,
            body=body,
            content_sha256=digest,
            source_path=source_path,
            source_repo=source_repo,
            work_unit_slug=work_unit_slug,
            repos=list(repos),
            intent_refs=list(intent_refs or []),
            authored_at=authored_at,
            captured_by=captured_by,
            current_version=1,
        )
        assign_difficulty(artifact)
        db.add(artifact)
        try:
            await db.flush()
        except IntegrityError:
            # A concurrent writer won the race on uq_work_artifacts_identity.
            # Roll back to a clean session and fall through to the update
            # path against the row they inserted.
            await db.rollback()
            if kind_is_heuristic:
                existing = resolve_scan_target(
                    await list_by_scan_identity(
                        db, org_id=org_id, slug=slug, source_repo=source_repo
                    ),
                    slug=slug,
                    source_repo=source_repo,
                )
            else:
                existing = await get_by_identity(
                    db, org_id=org_id, kind=kind, slug=slug, source_repo=source_repo
                )
            if existing is None:  # pragma: no cover — the row must exist now
                raise
        else:
            db.add(
                WorkArtifactVersion(
                    document_id=artifact.id,
                    version_number=1,
                    body=body,
                    content_sha256=digest,
                    change_description=change_description or "initial capture",
                    created_by=created_by,
                )
            )
            await db.commit()
            await db.refresh(artifact)
            return artifact, True, True

    assert existing is not None  # narrowed by both branches above

    metadata = _HeadMetadata(
        title=title,
        status=status,
        source_path=source_path,
        work_unit_slug=work_unit_slug,
        repos=list(repos),
        intent_refs=list(intent_refs or []),
        authored_at=authored_at,
        captured_by=captured_by,
    )

    if existing.content_sha256 == digest:
        # The body's 304-equivalent: no version bump, no snapshot. The
        # metadata and the kind lock are still settled — see the helper.
        return await _settle_unchanged_digest(
            db, existing, metadata=metadata, kind_is_heuristic=kind_is_heuristic
        )

    # Content differs, so a version row is about to be appended. Take a row
    # lock and re-read first: two writers that both saw current_version=1
    # would both try to insert version 2 and one would die on
    # uq_work_artifact_versions_doc_version. Under the lock the loser sees
    # the winner's digest and either settles metadata-only or bumps to 3.
    await db.refresh(existing, with_for_update=True)
    if existing.content_sha256 == digest:
        return await _settle_unchanged_digest(
            db, existing, metadata=metadata, kind_is_heuristic=kind_is_heuristic
        )

    # Whether this write may move ``kind``. Evaluated AFTER the row lock, not
    # before: a concurrent correction that landed while we were resolving is
    # visible only in the re-read, and honouring the pre-lock value would let
    # this scan overwrite it.
    may_move_kind = not (kind_is_heuristic and existing.kind_locked)

    if may_move_kind and existing.kind != kind:
        # A spec row is created locked and a heuristic write of a spec kind is
        # refused at the schema, so this is a backstop — but it is the one
        # place the kind of a stored row moves on this path, and a spec row's
        # kind is fixed by its ref.
        _check_spec_family_boundary(existing, kind)
        # Only reachable on the heuristic path against an UNLOCKED row: the
        # exact-identity lookup can never hand back a differing kind. Moving
        # onto a kind another row already occupies would violate
        # uq_work_artifacts_identity — report it rather than 500.
        clash = await get_by_identity(
            db, org_id=org_id, kind=kind, slug=slug, source_repo=source_repo
        )
        if clash is not None and clash.id != existing.id:
            raise ArtifactKindConflict(kind=kind, slug=slug, existing_id=clash.id)
        existing.kind = kind
    if not kind_is_heuristic:
        existing.kind_locked = True

    existing.current_version += 1
    _assign_head_metadata(existing, metadata)
    existing.body = body
    existing.content_sha256 = digest
    # After the body AND the kind are final: both are the rating's inputs.
    assign_difficulty(existing)
    # The body moved, so the row was touched whether or not the metadata did.
    existing.updated_at = datetime.now(UTC)

    db.add(
        WorkArtifactVersion(
            document_id=existing.id,
            version_number=existing.current_version,
            body=body,
            content_sha256=digest,
            change_description=change_description,
            created_by=created_by,
        )
    )
    await db.commit()
    await db.refresh(existing)
    return existing, False, True


@dataclass(frozen=True)
class RerateOutcome:
    """What one re-rating pass did. ``pending`` is how many plans in scope are
    STILL stale afterwards — non-zero while a capped pass works through a
    backlog (the first reads after a deploy or a rubric bump)."""

    written: int
    pending: int


@dataclass(frozen=True)
class RatedSnapshot:
    """A rating computed from a body read at ``content_sha256``/``kind``.

    The write is conditional on both still holding, which is what stops a
    pass that raced a newer write from stamping the OLD body's rating onto the
    new body at the current rubric version — a rating nothing would ever
    re-rate again.
    """

    id: UUID
    kind: str
    content_sha256: str
    values: dict[str, object]


def _stale_rating(org_id: UUID | None) -> tuple[ColumnElement[bool], ...]:
    return (
        _org_scope(org_id),
        WorkArtifact.kind == DIFFICULTY_RATED_KIND,
        WorkArtifact.difficulty_rubric_version.is_distinct_from(RUBRIC_VERSION),
    )


async def apply_rated_snapshots(
    db: AsyncSession, snapshots: Sequence[RatedSnapshot]
) -> int:
    """Write each snapshot's rating IF its row is unchanged; returns rows written.

    Guarded on the digest and kind the rating was computed from, and on the
    row still being stale (a concurrent pass that already rated it is not
    re-written). ``updated_at`` is assigned to itself, which is what
    suppresses the column's ``onupdate``: a rating derived from an unchanged
    body is not a touch, and consumers sort on that stamp. Does not commit.
    """
    written = 0
    for snap in snapshots:
        result = await db.execute(
            update(WorkArtifact)
            .where(
                WorkArtifact.id == snap.id,
                WorkArtifact.content_sha256 == snap.content_sha256,
                WorkArtifact.kind == snap.kind,
                WorkArtifact.difficulty_rubric_version.is_distinct_from(RUBRIC_VERSION),
            )
            .values(**snap.values, updated_at=WorkArtifact.updated_at)
            .execution_options(synchronize_session=False)
        )
        written += int(getattr(result, "rowcount", 0) or 0)
    return written


def _rate_rows(rows: Sequence[tuple[UUID, str, str, str]]) -> list[RatedSnapshot]:
    """CPU-bound half of a batch — run off the event loop."""
    return [
        RatedSnapshot(
            id=row_id,
            kind=kind,
            content_sha256=digest,
            values=difficulty_values(kind, body),
        )
        for row_id, kind, body, digest in rows
    ]


async def rerate_stale_plan_difficulty(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    limit: int = _DIFFICULTY_RERATE_LIMIT,
) -> RerateOutcome:
    """Rate up to ``limit`` plans in scope whose rating predates the rubric.

    Bounded so one request never pays for the whole corpus: rating is ~7 ms
    of CPU per plan, and a deploy leaves every plan unrated. Newest-written
    plans go first, so the plans being worked on are rated on the first read;
    the rest are rated by the reads that follow, and ``pending`` says how
    many remain. Scoring runs in a worker thread (``asyncio.to_thread``) so
    the event loop keeps serving other requests, and each write is guarded by
    :func:`apply_rated_snapshots` — two concurrent passes waste CPU but can
    never write a stale rating.
    """
    stale_ids = list(
        (
            await db.execute(
                select(WorkArtifact.id)
                .where(*_stale_rating(org_id))
                .order_by(WorkArtifact.updated_at.desc(), WorkArtifact.id)
                .limit(limit)
            )
        ).scalars()
    )
    written = 0
    for start in range(0, len(stale_ids), _DIFFICULTY_RERATE_BATCH):
        batch = stale_ids[start : start + _DIFFICULTY_RERATE_BATCH]
        rows = [
            (row_id, kind, body, digest)
            for row_id, kind, body, digest in (
                await db.execute(
                    select(
                        WorkArtifact.id,
                        WorkArtifact.kind,
                        WorkArtifact.body,
                        WorkArtifact.content_sha256,
                    ).where(WorkArtifact.id.in_(batch))
                )
            ).all()
        ]
        snapshots = await asyncio.to_thread(_rate_rows, rows)
        written += await apply_rated_snapshots(db, snapshots)
        await db.commit()
    pending = int(
        (
            await db.execute(
                select(func.count())
                .select_from(WorkArtifact)
                .where(*_stale_rating(org_id))
            )
        ).scalar_one()
    )
    return RerateOutcome(written=written, pending=pending)


async def list_plan_difficulties(
    db: AsyncSession, *, org_id: UUID | None
) -> list[WorkArtifact]:
    """Every plan row in scope, for the difficulty map — no bodies loaded.

    Ordered by ``updated_at DESC`` so that, when two artifacts carry the same
    ``work_unit_slug`` (a fork across ``source_repo``), a consumer keeping the
    FIRST row per slug keeps the most recently written copy.
    """
    stmt = (
        select(WorkArtifact)
        .options(
            load_only(
                WorkArtifact.id,
                WorkArtifact.kind,
                WorkArtifact.slug,
                WorkArtifact.work_unit_slug,
                WorkArtifact.source_repo,
                WorkArtifact.updated_at,
                WorkArtifact.difficulty,
                WorkArtifact.difficulty_conceptual,
                WorkArtifact.difficulty_implementation,
                WorkArtifact.difficulty_source,
                WorkArtifact.difficulty_rubric_version,
                WorkArtifact.difficulty_signals,
            )
        )
        .where(_org_scope(org_id), WorkArtifact.kind == DIFFICULTY_RATED_KIND)
        .order_by(WorkArtifact.updated_at.desc(), WorkArtifact.id)
    )
    return list((await db.execute(stmt)).scalars())


async def set_artifact_kind(
    db: AsyncSession, artifact: WorkArtifact, *, kind: str, org_id: UUID | None
) -> WorkArtifact:
    """Correct an artifact's ``kind`` and LOCK it against future scans.

    The lock is set unconditionally — even when ``kind`` is unchanged — because
    the point of this door is to record that a human/agent asserted the kind,
    which is exactly what stops the next heuristic scan from moving it.

    Raises :class:`ArtifactKindConflict` when another row already occupies
    ``(org, kind, slug, source_repo)``; that is a genuine identity collision
    (``uq_work_artifacts_identity`` covers ``kind``) and merging the two rows
    is an operator decision, not something this write may guess at.
    """
    # Lock and re-read first. The caller loaded ``artifact`` earlier, and the
    # difficulty re-rater may have written its rating since; without the
    # re-read, ``assign_difficulty`` below compares against the stale
    # in-memory NULLs, writes nothing, and leaves that rating on a row that
    # is no longer a plan. The lock also serializes this against an upsert.
    await db.refresh(artifact, with_for_update=True)
    # Before the identity check: a forbidden move is refused whatever the
    # target identity holds.
    _check_spec_family_boundary(artifact, kind)
    if artifact.kind != kind:
        clash = await get_by_identity(
            db,
            org_id=org_id,
            kind=kind,
            slug=artifact.slug,
            source_repo=artifact.source_repo,
        )
        if clash is not None and clash.id != artifact.id:
            raise ArtifactKindConflict(
                kind=kind, slug=artifact.slug, existing_id=clash.id
            )
        artifact.kind = kind

    # The kind is a rating input: a correction onto ``plan`` rates the row, a
    # correction away from it clears the rating.
    assign_difficulty(artifact)
    artifact.kind_locked = True
    artifact.updated_at = datetime.now(UTC)
    try:
        await db.commit()
    except IntegrityError as exc:
        # A concurrent writer took the target identity between the check and
        # the commit. Same conflict, reported the same way.
        await db.rollback()
        raise ArtifactKindConflict(
            kind=kind, slug=artifact.slug, existing_id=None
        ) from exc
    await db.refresh(artifact)
    return artifact


async def create_edge(
    db: AsyncSession,
    *,
    from_artifact: WorkArtifact,
    to_artifact: WorkArtifact | None,
    relation: str,
    note: str | None,
    created_by: str | None,
) -> tuple[WorkArtifactEdge, bool]:
    """Create one edge, or return the existing identical one.

    Returns ``(edge, created)``. Re-posting the same
    ``(from, to, relation)`` triple is idempotent rather than a 409 — the
    library is fed by repeatable scans.

    ``to_artifact`` may be ``None`` for :data:`SPAWNED_FOLLOWUP_RELATION`, the
    ONE-ENDED edge that records work a plan surfaced but did not do
    (``plan_library_03_spawned_followup``). The DB CHECK
    ``ck_work_artifact_edges_open_target`` refuses a null target on every other
    relation; the endpoint checks it first so the caller gets a 422 naming the
    relation rather than an IntegrityError 500.

    **Idempotency for the one-ended form is keyed on the NOTE.** The shipped
    ``UNIQUE (from_id, to_id, relation)`` cannot see these rows — SQL NULLs are
    distinct, so every open follow-up is unique to it whatever it says. Keying
    the dedup on ``(from_id, relation, btrim(note))`` — matching the partial
    index ``uq_work_artifact_edges_open_followup`` exactly — keeps two DIFFERENT
    follow-ups off one plan legal (a plan can surface several) while collapsing
    a re-post of the same finding onto the existing row.
    """
    if to_artifact is None:
        # The note is the identity here, so it is also the dedup key. BOTH
        # sides are trimmed in SQL with :data:`NOTE_TRIM_CHARS` — the exact
        # expression ``uq_work_artifact_edges_open_followup`` indexes — rather
        # than trimming the incoming note in Python. Two trims that disagree
        # (Python's ``str.strip()`` also eats unicode whitespace; one-argument
        # ``btrim`` eats only spaces) would let the lookup miss a row the index
        # then refuses to insert, turning an idempotent re-post into a 500.
        stmt = select(WorkArtifactEdge).where(
            WorkArtifactEdge.from_id == from_artifact.id,
            WorkArtifactEdge.to_id.is_(None),
            WorkArtifactEdge.relation == relation,
            func.btrim(WorkArtifactEdge.note, NOTE_TRIM_CHARS)
            == func.btrim(note or "", NOTE_TRIM_CHARS),
        )
    else:
        stmt = select(WorkArtifactEdge).where(
            WorkArtifactEdge.from_id == from_artifact.id,
            WorkArtifactEdge.to_id == to_artifact.id,
            WorkArtifactEdge.relation == relation,
        )
    found = (await db.execute(stmt)).scalars().first()
    if found is not None:
        return found, False

    edge = WorkArtifactEdge(
        from_id=from_artifact.id,
        to_id=to_artifact.id if to_artifact is not None else None,
        relation=relation,
        note=note,
        created_by=created_by,
    )
    db.add(edge)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        found = (await db.execute(stmt)).scalars().first()
        if found is None:  # pragma: no cover — the row must exist now
            raise
        return found, False
    await db.refresh(edge)
    return edge, True


# ===========================================================================
# Open follow-ups (Phase 7) — the ONE-ENDED edge, read back
# ===========================================================================


class FollowupAlreadyClaimed(Exception):
    """Someone already named the artifact that owns this follow-up.

    Claiming is a one-way transition (open → owned) and it is NOT idempotent
    across different targets: silently re-pointing a claimed follow-up at a
    second artifact would erase the first claim with no trace, and the two
    callers would each believe they own the work. Surfaced as a 409 naming the
    current owner so the loser can look at it and decide.
    """

    def __init__(self, *, edge_id: UUID, to_id: UUID) -> None:
        self.edge_id = edge_id
        self.to_id = to_id
        super().__init__(
            f"follow-up edge {edge_id} is already claimed by artifact {to_id}"
        )


async def get_edge(
    db: AsyncSession, edge_id: UUID, *, org_id: UUID | None
) -> tuple[WorkArtifactEdge, WorkArtifact] | None:
    """One edge plus its originating artifact, scoped to the caller's org.

    Edges carry no ``organization_id`` of their own, so the scope is inherited
    from ``from_id``'s artifact — the same NULL-collapsing bucket every other
    read in this module uses. Without the join an edge id would be a global
    handle and the org boundary would end at the artifact routes.
    """
    stmt = (
        select(WorkArtifactEdge, WorkArtifact)
        .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
        .where(WorkArtifactEdge.id == edge_id, _org_scope(org_id))
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        return None
    return row[0], row[1]


async def list_open_followups(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    after: KeysetPosition | None = None,
    limit: int = 50,
) -> tuple[list[tuple[WorkArtifactEdge, WorkArtifact]], int]:
    """Unclaimed ``spawned_followup`` edges + their originating artifact.

    "Open" is exactly ``to_id IS NULL``: work that was identified and has no
    artifact owning it. A claimed follow-up is an ordinary two-ended
    provenance edge and drops out of this read while staying visible on the
    originating artifact's edge list — nothing is deleted by claiming.

    Ordered OLDEST FIRST — a keyset walk over :data:`FOLLOWUP_SORT_KEY`,
    ``(created_at, id) ASC``, resumed strictly after ``after``. That is the
    useful default rather than an arbitrary one: an old unowned follow-up is
    work the fleet has known about and repeatedly not picked up, which is the
    interesting row. Returns the page plus the exact count of open follow-ups
    from the page's start position onward (the whole queue on the first page),
    so a bounded page can never read as the whole queue.
    """
    filters: list[ColumnElement[bool]] = [
        _org_scope(org_id),
        WorkArtifactEdge.relation == SPAWNED_FOLLOWUP_RELATION,
        WorkArtifactEdge.to_id.is_(None),
    ]
    if after is not None:
        filters.append(
            _keyset_cut(
                WorkArtifactEdge.created_at,
                WorkArtifactEdge.id,
                after,
                descending=False,
            )
        )
    base = (
        select(WorkArtifactEdge, WorkArtifact)
        .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
        .where(*filters)
    )

    count_stmt = (
        select(func.count())
        .select_from(WorkArtifactEdge)
        .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
        .where(*filters)
    )
    total = int((await db.execute(count_stmt)).scalar_one())

    rows = (
        await db.execute(
            base.order_by(
                WorkArtifactEdge.created_at.asc(), WorkArtifactEdge.id.asc()
            ).limit(limit)
        )
    ).all()
    return [(row[0], row[1]) for row in rows], total


async def claim_followup(
    db: AsyncSession, edge_id: UUID, to_id: UUID
) -> WorkArtifactEdge:
    """Name the artifact that owns an open follow-up.

    The edge stops being open and becomes an ordinary two-ended provenance
    link. Nothing is created and nothing is deleted — the ORIGINAL row is
    updated, which is what keeps the claim traceable back to the plan that
    surfaced the work.

    Raises :class:`FollowupAlreadyClaimed` when ``to_id`` is already set. The
    check is made under a row lock rather than from the caller's earlier read:
    two agents claiming the same follow-up concurrently would otherwise both
    see ``to_id IS NULL``, both write, and the second would overwrite the first
    with no record. Callers MUST have resolved ``edge_id`` through
    :func:`get_edge` first — this function is not an authorization boundary,
    and it does not validate that ``to_id`` exists (the FK does, and the
    endpoint 422s on it beforehand so the message is actionable).
    """
    edge = (
        (
            await db.execute(
                select(WorkArtifactEdge)
                .where(WorkArtifactEdge.id == edge_id)
                .with_for_update()
            )
        )
        .scalars()
        .first()
    )
    if edge is None:  # pragma: no cover — the caller resolved it a moment ago
        raise FollowupAlreadyClaimed(edge_id=edge_id, to_id=to_id)

    if edge.to_id is not None:
        raise FollowupAlreadyClaimed(edge_id=edge_id, to_id=edge.to_id)

    edge.to_id = to_id
    try:
        await db.commit()
    except IntegrityError as exc:
        # ``uq_work_artifact_edges_from_to_relation`` already holds this
        # (from, to, relation) triple — the same link was recorded directly as
        # a two-ended edge. Reported as a claim conflict rather than a 500:
        # the follow-up genuinely IS owned by that artifact, the row just is
        # not this one.
        await db.rollback()
        raise FollowupAlreadyClaimed(edge_id=edge_id, to_id=to_id) from exc
    await db.refresh(edge)
    return edge


@dataclass(frozen=True)
class CaptureDoorCensus:
    """One ``captured_by`` door's slice of the corpus census.

    ``plan_count`` is the ``kind == 'plan'`` subset of ``count``; summed over
    the doors it is the corpus-wide plan count the list read reports beside
    every page (``2026-08-27-plan-corpus-read-path-is-dark`` D1 / Phase 2),
    derived from the SAME query as ``/capture-health`` so the two cannot
    disagree.
    """

    captured_by: str
    count: int
    plan_count: int
    first_at: datetime | None
    last_touched_at: datetime | None


def corpus_totals(
    rows: Sequence[CaptureDoorCensus],
) -> tuple[int, int, datetime | None]:
    """``(artifact_count, plan_count, newest_updated_at)`` folded from the census.

    ``newest_updated_at`` is ``max(updated_at)`` over the whole scope — the
    same LAST-TOUCHED reading as each door's ``last_touched_at`` — and
    ``None`` on an empty corpus: there is no newest row to date, and a
    fabricated epoch would read as "frozen since 1970" rather than "empty".
    """
    touched = [row.last_touched_at for row in rows if row.last_touched_at is not None]
    return (
        sum(row.count for row in rows),
        sum(row.plan_count for row in rows),
        max(touched) if touched else None,
    )


async def capture_health(
    db: AsyncSession, *, org_id: UUID | None
) -> list[CaptureDoorCensus]:
    """Per-``captured_by`` corpus census.

    The question this answers is "is the AGENT door being used, or is the
    scanner the only thing feeding the store?" — so the count alone is not
    enough. Three artifacts captured by an agent in March and none since is a
    door that WAS used, not one that is; recency is what separates the two,
    and ``first`` dates the door's opening.

    ⚠️ The recency figure is ``max(updated_at)``, which is a LAST-TOUCHED
    timestamp, not a last-captured one: any later mutation bumps it, so an
    operator's kind correction on a scanner-captured row moves the
    ``runner_scan`` door's date without the scanner having written anything.
    It is named ``last_touched`` all the way to the UI for exactly that reason
    — calling it "last write" would overstate what the column knows.

    Returns only the doors actually present in the data. Folding in the
    never-used ones (as explicit zeros, which is the honest rendering) is the
    endpoint's job — the vocabulary lives in the schema layer, not here.
    """
    stmt = (
        select(
            WorkArtifact.captured_by,
            # NOT labelled ``count``: ``Row`` is a tuple, so ``row.count`` would
            # resolve to ``tuple.count`` (the method) rather than the column.
            func.count().label("artifact_count"),
            func.count().filter(WorkArtifact.kind == "plan").label("plan_count"),
            func.min(WorkArtifact.created_at).label("first_at"),
            func.max(WorkArtifact.updated_at).label("last_touched_at"),
        )
        .where(_org_scope(org_id))
        .group_by(WorkArtifact.captured_by)
        .order_by(WorkArtifact.captured_by)
    )
    return [
        CaptureDoorCensus(
            captured_by=row.captured_by,
            count=int(row.artifact_count),
            plan_count=int(row.plan_count),
            first_at=row.first_at,
            last_touched_at=row.last_touched_at,
        )
        for row in (await db.execute(stmt)).all()
    ]


@dataclass(frozen=True)
class CapturedPlanCorpus:
    """The CORPUS side of the coverage set difference, for one organization.

    Phase 3 of ``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``.
    Two facts, and the second is what makes a >100% coverage reading
    unconstructible:

    * ``slugs_by_source_repo`` — the ``kind == 'plan'`` stems the corpus holds
      under each ``source_repo`` key that was ASKED for. A key with no rows is
      present with an empty set, so a caller never has to tell "no rows" from
      "not asked".
    * ``plan_row_count`` — EVERY ``kind == 'plan'`` row in the organization,
      whatever its ``source_repo`` (including ``null``). A key's out-of-scope
      count is this minus that key's own, which names the rows a naive
      numerator swept in rather than letting them inflate a ratio.

    The stems come back as sets rather than counts because the answer the plan
    needs is a set DIFFERENCE: how many stems that exist have no row is not
    derivable from two totals.
    """

    slugs_by_source_repo: dict[str, frozenset[str]]
    plan_row_count: int


async def captured_plan_corpus(
    db: AsyncSession, *, org_id: UUID | None, source_repos: Iterable[str]
) -> CapturedPlanCorpus:
    """The plan stems this organization's corpus holds, per asked-for key.

    ``source_repos`` is the set of keys a coverage read has a denominator for
    — the scan sources devices reported. Only those are enumerated: the stem
    query is the expensive half (the fleet's corpus is ~1800 plan rows), and a
    key nobody can measure against needs no set.

    ``plan_row_count`` is counted over the WHOLE organization, so it stays
    correct when ``source_repos`` is empty — which is exactly the case where
    an out-of-scope count matters most and a caller deriving the total by
    summing the returned sets would get 0.

    ⚠️ **Both facts come from ONE statement, and that is a correctness
    requirement rather than a round-trip saving.** The two used to be separate
    ``execute`` calls on one session, and under the default READ COMMITTED
    isolation each got its OWN snapshot. The runner's body sync inserts plan
    rows continuously (a ~68 s cycle, and in bulk on a first-start backfill),
    so a row landing between the two reads made
    ``len(slugs_by_source_repo[key])`` exceed ``plan_row_count`` — and the
    caller's ``plan_row_count - len(captured)`` then served a NEGATIVE
    ``out_of_scope_artifact_count`` on a ``measured`` coverage entry, with
    "captured" larger than every plan row the organization has. That is the
    same class of impossible number (the 101.8%) this whole feature exists to
    make unconstructible, so it is fixed at the source rather than clamped:
    ``max(0, ...)`` would turn an impossible number into a plausible wrong one
    and hide the torn read entirely.

    The single statement is a ``count(*)`` CTE LEFT JOINed to the stem select
    ``ON true``. The join preserves the aggregate's one row when no stem
    matches (including when ``source_repos`` is empty), so the total is always
    present, and both facts are read at one snapshot by construction rather
    than by isolation level.

    Matching is on ``source_repo`` EXACTLY, including case: it is the
    scanner's own two-component form (``<repo>/<dir relative to the repo
    root>``), and a near-miss key is a different row that belongs in the
    out-of-scope count rather than being folded in.
    """
    wanted = sorted(set(source_repos))

    total_cte = (
        select(func.count().label("plan_row_count"))
        .select_from(WorkArtifact)
        .where(_org_scope(org_id), WorkArtifact.kind == "plan")
        .cte("plan_row_total")
    )
    stems = (
        select(
            WorkArtifact.source_repo.label("source_repo"),
            WorkArtifact.slug.label("slug"),
        )
        .where(
            _org_scope(org_id),
            WorkArtifact.kind == "plan",
            # An empty ``wanted`` renders as a false constant, so the join
            # contributes no rows and the aggregate's row survives alone.
            WorkArtifact.source_repo.in_(wanted),
        )
        .subquery("captured_stems")
    )
    stmt = select(
        total_cte.c.plan_row_count,
        stems.c.source_repo,
        stems.c.slug,
    ).select_from(total_cte.outerjoin(stems, true()))

    rows = (await db.execute(stmt)).all()
    if not rows:  # pragma: no cover — ``count(*)`` always yields exactly one row
        raise RuntimeError(
            "captured_plan_corpus read no rows: a count(*) aggregate always "
            "yields one, and the LEFT JOIN preserves it. Returning 0 here "
            "would publish an unmeasured total as a measured one."
        )

    slugs: dict[str, set[str]] = {key: set() for key in wanted}
    for row in rows:
        # ``source_repo`` is NULL only on the join's no-match row — ``IN``
        # never matches a NULL key — so the bucket always exists.
        if row.source_repo is not None:
            slugs[row.source_repo].add(row.slug)

    return CapturedPlanCorpus(
        slugs_by_source_repo={key: frozenset(value) for key, value in slugs.items()},
        plan_row_count=int(rows[0].plan_row_count),
    )


async def find_divergent(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str | None = None,
) -> list[tuple[str, str, list[WorkArtifact]]]:
    """``(kind, slug)`` groups whose copies disagree on ``content_sha256``.

    A plan mirrored into two repos, or scanned from two checkouts, produces
    two rows sharing ``(kind, slug)`` but with different digests — that is
    the drift the library exists to surface.
    """
    group_stmt = (
        select(WorkArtifact.kind, WorkArtifact.slug)
        .where(_org_scope(org_id))
        .group_by(WorkArtifact.kind, WorkArtifact.slug)
        .having(func.count(func.distinct(WorkArtifact.content_sha256)) > 1)
        .order_by(WorkArtifact.kind, WorkArtifact.slug)
    )
    if kind is not None:
        group_stmt = group_stmt.where(WorkArtifact.kind == kind)

    groups = list((await db.execute(group_stmt)).all())
    if not groups:
        return []

    keys = {(g.kind, g.slug) for g in groups}
    rows_stmt = (
        select(WorkArtifact)
        .where(
            _org_scope(org_id),
            WorkArtifact.kind.in_({k for k, _ in keys}),
            WorkArtifact.slug.in_({s for _, s in keys}),
        )
        .order_by(WorkArtifact.kind, WorkArtifact.slug, WorkArtifact.updated_at.desc())
    )
    rows = (await db.execute(rows_stmt)).scalars().all()

    buckets: dict[tuple[str, str], list[WorkArtifact]] = {k: [] for k in keys}
    for row in rows:
        # The IN x IN product can pull in a (kind, slug) pair that is not
        # itself divergent; keep only the real groups.
        bucket = buckets.get((row.kind, row.slug))
        if bucket is not None:
            bucket.append(row)

    return [(g.kind, g.slug, buckets[(g.kind, g.slug)]) for g in groups]


async def find_kind_forks(
    db: AsyncSession, *, org_id: UUID | None
) -> list[tuple[str, str | None, list[WorkArtifact]]]:
    """``(slug, source_repo)`` keys carrying MORE THAN ONE ``kind``.

    The fork class the kind-lock fix exists to prevent, and the one a scanner
    now refuses to resolve (:class:`AmbiguousArtifactKind`). Reported
    separately from :func:`find_divergent` — which groups by ``(kind, slug)``
    and therefore cannot see a fork whose whole distinguishing feature is that
    the kinds differ.

    Returns ``(slug, source_repo, rows)`` with ``rows`` ordered locked-first so
    the operator can see immediately whether a winner already exists.
    """
    # ONE Label object reused across SELECT / GROUP BY / ORDER BY. Spelling
    # ``coalesce(source_repo, '')`` three times instead would emit three
    # DIFFERENT bind parameters ($4, $5, $6), and PostgreSQL compares grouped
    # expressions node-by-node — so the ORDER BY copy would not match the
    # GROUP BY copy and the query fails with "source_repo must appear in the
    # GROUP BY clause". (Observed, not theorised.)
    repo_key = func.coalesce(WorkArtifact.source_repo, "").label("repo_key")
    group_stmt = (
        select(WorkArtifact.slug, repo_key)
        .where(_org_scope(org_id))
        .group_by(WorkArtifact.slug, repo_key)
        .having(func.count(func.distinct(WorkArtifact.kind)) > 1)
        .order_by(WorkArtifact.slug, repo_key)
    )
    groups = list((await db.execute(group_stmt)).all())
    if not groups:
        return []

    keys = {(g.slug, g.repo_key) for g in groups}
    rows_stmt = (
        select(WorkArtifact)
        .where(
            _org_scope(org_id),
            WorkArtifact.slug.in_({s for s, _ in keys}),
        )
        .order_by(
            WorkArtifact.slug,
            WorkArtifact.kind_locked.desc(),
            WorkArtifact.kind,
            WorkArtifact.id,
        )
    )
    rows = (await db.execute(rows_stmt)).scalars().all()

    buckets: dict[tuple[str, str], list[WorkArtifact]] = {k: [] for k in keys}
    for row in rows:
        # The slug IN-list can pull in a (slug, repo) pair that is not itself
        # forked; keep only the real groups.
        bucket = buckets.get((row.slug, row.source_repo or ""))
        if bucket is not None:
            bucket.append(row)

    return [(g.slug, g.repo_key or None, buckets[(g.slug, g.repo_key)]) for g in groups]


# ===========================================================================
# Candidate selection (Phase 6) — SIGNALS ONLY, no score
# ===========================================================================
#
# Design decision D6: this read exposes the ranking INPUTS and the AGENT
# ranks. No criticality score, no weighting, no "priority" column — a
# hardcoded score would be a guess frozen into SQL, and every consumer would
# then be arguing with the guess instead of with the evidence.
#
# The POPULATION is a union of both corpus layers, and that is plan
# ``2026-09-03-vet-imp-sweep-selects-from-the-sparse-document-layer``. It used
# to be ``agent.work_artifacts`` alone — the layer that holds plan BODIES —
# while the question this read answers, *which plan still needs work?*, is
# answered by fields the OPERATIONAL layer owns. Measured 2026-09-03: 18 plan
# artifacts against 635 non-terminal date-slugged coord work units, 606 of
# them resolving to a real plan file, so selection saw 2.1% of the addressable
# corpus and ``/vet-imp-sweep`` truthfully reported "nothing to do" over it.
#
# The remedy is the join DIRECTION, not a body backfill. Copying ~1,469 plan
# files into a second store was scoped and rejected by the operator: selection
# needs identity and status, not prose, and the two layers already overlap on
# identity alone.


#: The slug prefix coord uses for the work units IT generates — one
#: ``shepherd-<owner>-<repo>-<pr>`` unit per Tier-3 unlandable-PR escalation.
#: They are merge bookkeeping, never plans (839 of 2,389 units on 2026-09-03),
#: and coord's own list door takes this as ``exclude_slug_prefix`` so the
#: exclusion is server-side — it has to be, because the list is
#: ``updated_at DESC`` under a page cap and the shepherd rows share an
#: ``updated_at``.
COORD_SHEPHERD_SLUG_PREFIX = "shepherd-"

#: The shape of a plan slug: ``YYYY-MM-DD-<stem>``, the fleet's plan filename
#: convention and the identifier every other surface joins on (``Depends-On:``,
#: the ``Plan: <stem>`` PR marker, ``$QONTINUI_PLANS_DIR`` filenames).
#:
#: A SHAPE test, not a vocabulary: ``coord.work_units`` also holds units that
#: were never plans at all, and this is the one structural property that
#: separates them without asking coord to classify its own rows.
_PLAN_SLUG_DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}-")


def is_plan_shaped_slug(slug: str) -> bool:
    """Could this coord work-unit slug be a plan?

    Date-slugged and not one of coord's own ``shepherd-*`` escalations. Both
    halves are necessary: the date prefix admits the plan corpus, and the
    shepherd exclusion removes the largest single class of non-plan units.

    Deliberately permissive about everything else — a slug that LOOKS like a
    plan and is not costs one extra candidate row an agent can dismiss, while
    a slug wrongly rejected is invisible, which is the failure this whole
    union exists to remove.
    """
    if slug.startswith(COORD_SHEPHERD_SLUG_PREFIX):
        return False
    return _PLAN_SLUG_DATE_PREFIX.match(slug) is not None


@dataclass(frozen=True, slots=True)
class CandidateWorkUnit:
    """One ``coord.work_units`` row, projected onto the candidate arm.

    Built by the endpoint layer from coord's HTTP work-unit list — web never
    reads coord's Postgres (module invariant 4 of
    ``app/api/v1/endpoints/plan_library.py``, enforced by
    ``tests/test_coord_schema_boundary_guard.py``), so this type is the shape
    the coord half crosses into the CRUD layer as, and nothing here knows how
    it was fetched.

    Only the fields selection actually uses. ``status`` is as OPAQUE here as
    it is on an artifact: coord carried 59 distinct status strings on
    2026-09-03 — ``d1``, ``fix``, ``all``, ``code``, ``phases`` and a
    backtick-quoted ``needs_rework`` among them, and 492 rows holding the
    empty string — and it is read through the same :func:`is_terminal_status`
    the artifact half uses, so an unrecognised word counts as NOT-yet-terminal.
    """

    #: coord's ``work_units.id`` — the unit's unique, immutable identity and
    #: the keyset tiebreak of :data:`CANDIDATE_SORT_KEY`. The candidate
    #: projection REJECTS a row without one (it could not be placed in the
    #: walk); the reconciliation projection keys on the stem and keeps it.
    id: UUID | None
    slug: str
    status: str
    title: str | None
    #: coord's ``metadata.source_path`` — the plan FILE this unit was scanned
    #: from, when there was one. Its presence is the only evidence this read
    #: has that a document exists at all, and it is what separates a candidate
    #: whose body merely was not synced from one that has no document
    #: anywhere.
    source_path: str | None
    #: coord's ``metadata.repo``, as a list so it lines up with the artifact
    #: half's ``repos``. Empty when coord recorded none.
    repos: tuple[str, ...]
    created_at: datetime
    updated_at: datetime
    #: ``coalesce(first_in_progress_at, created_at)`` — the anchor the row's
    #: ``age_days`` is measured from. DISPLAY ONLY: ``first_in_progress_at``
    #: moves when coord records a transition, so it can never be a keyset sort
    #: key (D8); the walk is on ``(created_at, id)``. ``first_in_progress_at``
    #: is coord's own derivation from its status history and is ABSENT rather
    #: than zero when no transition was recorded, which is why the fallback is
    #: explicit here.
    order_key: datetime


@dataclass(frozen=True, slots=True)
class PlanCandidateRow:
    """One row of the candidate population, from whichever layer holds it.

    EXACTLY ONE of the two is set. A row carrying an ``artifact`` is what this
    read has always returned — the document layer's row, with a body behind an
    id. A row carrying a ``work_unit`` is a plan coord knows about and the
    library has never captured: it has no id, and its ``source_path`` (when
    coord recorded one) is the only handle on its body.

    A frozen pair rather than a widened ``WorkArtifact`` because the two are
    genuinely different rows from different stores; making one impersonate the
    other is how a null-filled artifact ends up looking like a captured one.
    """

    artifact: WorkArtifact | None = None
    work_unit: CandidateWorkUnit | None = None


def _plan_candidate_filters(org_id: UUID | None) -> tuple[ColumnElement[bool], ...]:
    """The document layer's arm of the population, unchanged since Phase 6.

    Non-terminal ``kind='plan'`` artifacts in the caller's org scope, reading
    the OPAQUE ``status`` through the SQL twin of :func:`terminal_token`
    (its FIRST normalized word, so a dated ``SHIPPED 2026-09-02`` stamp reads
    as shipped) against :data:`app.models.work_artifact.TERMINAL_STATUSES`.
    An unrecognised status counts as not-yet-shipped — the library mirrors
    what the fleet wrote and an unknown word must not silently hide a plan.

    Returned as the predicates rather than as a statement because the union
    path selects the SAME rows twice with different column lists (the sort
    keys, then the bodies of whatever survived the merge), and the one thing
    that must not drift between those two reads is which rows they are over.
    """
    return (
        _org_scope(org_id),
        WorkArtifact.kind == "plan",
        _terminal_token_sql().not_in(tuple(sorted(TERMINAL_STATUSES))),
    )


def _aware(moment: datetime) -> datetime:
    """Force a timestamp onto UTC so the two arms are comparable.

    Both columns are ``timestamptz`` and coord serialises RFC 3339, so a naive
    value should be impossible — but the merge below SORTS across the two
    arms, and Python raises rather than degrading when it compares an aware
    datetime with a naive one. Normalising is cheaper than a page-500 that
    only reproduces against one store's data.
    """
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


async def _slugs_claimed_by_plan_artifacts(
    db: AsyncSession, *, org_id: UUID | None, slugs: Sequence[str]
) -> set[str]:
    """Which of these coord slugs already have a plan artifact — ANY status.

    The de-duplication key for the union. Matched against BOTH ``work_unit_slug``
    (the declared soft link, which the runner scanner writes with the plan's own
    stem) and ``slug`` (the stem itself), because an artifact captured without
    the link still IS the document for that work unit and a page showing it
    twice — once with a body, once without — would be the visible symptom.

    Deliberately NOT restricted to the non-terminal arm. A coord unit whose
    artifact reads ``SHIPPED`` is suppressed, which keeps the document layer's
    terminal filter — the one this route has always applied — the single place
    that decision is made. The alternative emits a second, id-less row for a
    plan the library says is done, and ``document_state`` would have to call it
    ``present`` while carrying nothing to fetch the body with.
    """
    if not slugs:
        return set()
    wanted = set(slugs)
    stmt = select(WorkArtifact.slug, WorkArtifact.work_unit_slug).where(
        _org_scope(org_id),
        WorkArtifact.kind == "plan",
        or_(
            WorkArtifact.slug.in_(wanted),
            WorkArtifact.work_unit_slug.in_(wanted),
        ),
    )
    claimed: set[str] = set()
    for slug, work_unit_slug in (await db.execute(stmt)).all():
        if slug in wanted:
            claimed.add(slug)
        if work_unit_slug in wanted:
            claimed.add(work_unit_slug)
    return claimed


def _unclaimed_work_units(
    work_units: Iterable[CandidateWorkUnit], claimed: set[str]
) -> list[CandidateWorkUnit]:
    """The work-unit arm: plan-shaped, non-terminal, and NOT already a row.

    Sorted on this arm's half of :data:`CANDIDATE_SORT_KEY` — the unit's own
    immutable ``(created_at, id)`` ASC. No re-weighting and no cap: open
    question 2 of the plan settles that a ``vetted``-first ordering would be
    exactly the "guess frozen into SQL" design decision D6 forbids, and 411 of
    the 635 units carried an empty status, which would make it a guess over the
    least-known rows.
    """
    return sorted(
        (
            unit
            for unit in work_units
            if unit.slug not in claimed
            and is_plan_shaped_slug(unit.slug)
            and not is_terminal_status(unit.status)
        ),
        key=_unit_key,
    )


def _unit_key(unit: CandidateWorkUnit) -> tuple[datetime, UUID]:
    """A work unit's :data:`CANDIDATE_SORT_KEY` position."""
    if unit.id is None:  # pragma: no cover — the candidate projection refuses it
        raise ValueError(f"work unit {unit.slug!r} has no id to place in the walk")
    return _aware(unit.created_at), unit.id


def candidate_position(row: PlanCandidateRow) -> KeysetPosition:
    """The :data:`CANDIDATE_SORT_KEY` position of one candidate row, whichever
    arm produced it — what the route mints ``next_cursor`` from."""
    if row.artifact is not None:
        return KeysetPosition(at=_aware(row.artifact.created_at), id=row.artifact.id)
    if row.work_unit is None:  # pragma: no cover — PlanCandidateRow sets one
        raise ValueError("a PlanCandidateRow carries neither arm")
    at, unit_id = _unit_key(row.work_unit)
    return KeysetPosition(at=at, id=unit_id)


async def list_plan_candidates(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    after: KeysetPosition | None = None,
    limit: int = 25,
    work_units: Sequence[CandidateWorkUnit] | None = None,
) -> tuple[list[PlanCandidateRow], int]:
    """The candidate population — the UNION of both corpus layers.

    ::

        candidates := artifacts(kind='plan', ¬terminal)
                    ∪ work_units(date-slugged, ¬terminal, ¬shepherd-*)
                      minus those an artifact already claims

    ``work_units`` is coord's half, already fetched by the endpoint layer in
    ONE list read (web never reads coord's Postgres). Pass ``None`` — which is
    what a coord outage, and ``include_coord=false``, both produce — and this
    degrades to the document-layer-only population. **The union can only ever
    ADD rows**, which is what keeps the route's own invariant 5 ("an
    unavailable coord is UNKNOWN, never empty") true of the population as well
    as of the per-row fields.

    Terminal classification is the SAME on both arms — :func:`terminal_token`
    against :data:`app.models.work_artifact.TERMINAL_STATUSES`, in SQL for the
    artifacts and in Python for the work units — so an unrecognised status
    counts as not-yet-terminal on either side.

    **Ordering is a keyset walk, and nothing more** (plan
    ``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus``
    Phase 4). Both arms sort on their row's IMMUTABLE ``(created_at, id)``,
    compared as ONE total order — an artifact's id and a work unit's id are
    both uuids, ordered as PostgreSQL orders them (big-endian bytes, which is
    Python's ``UUID`` ordering too) — and the page resumes strictly after
    ``after``. The order used to be ``coalesce(authored_at, created_at)`` /
    ``coalesce(first_in_progress_at, created_at)`` under ``OFFSET``; both
    keys move (the upsert rewrites ``authored_at``, a status transition sets
    ``first_in_progress_at``), and a keyset over a moving key drops rows
    silently (D8). There is no scoring pass on either side.

    Returns ``(page, total)``: ``total`` is the exact count of candidates from
    the page's start position onward across both arms, so ``total > len(page)``
    is exactly "more exist". Only the first ``limit`` rows of EITHER arm past
    ``after`` can land on the page, so the artifact arm is read as
    ``(id, created_at)`` pairs to that bound — no bodies — and only the ids
    that survive the merge are hydrated.
    """
    filters = list(_plan_candidate_filters(org_id))
    if after is not None:
        filters.append(
            _keyset_cut(
                WorkArtifact.created_at, WorkArtifact.id, after, descending=False
            )
        )
    order = (WorkArtifact.created_at.asc(), WorkArtifact.id.asc())

    count_stmt = select(func.count()).select_from(WorkArtifact).where(*filters)
    artifact_total = int((await db.execute(count_stmt)).scalar_one())

    if work_units is None:
        rows = (
            (
                await db.execute(
                    select(WorkArtifact).where(*filters).order_by(*order).limit(limit)
                )
            )
            .scalars()
            .all()
        )
        return [PlanCandidateRow(artifact=row) for row in rows], artifact_total

    claimed = await _slugs_claimed_by_plan_artifacts(
        db, org_id=org_id, slugs=[unit.slug for unit in work_units]
    )
    extra = _unclaimed_work_units(work_units, claimed)
    if after is not None:
        extra = [unit for unit in extra if _unit_key(unit) > (after.at, after.id)]
    total = artifact_total + len(extra)

    key_stmt = (
        select(WorkArtifact.id, WorkArtifact.created_at)
        .where(*filters)
        .order_by(*order)
        .limit(limit)
    )
    entries: list[tuple[tuple[datetime, UUID], UUID | CandidateWorkUnit]] = [
        ((_aware(row.created_at), row.id), row.id)
        for row in (await db.execute(key_stmt))
    ]
    entries.extend((_unit_key(unit), unit) for unit in extra[:limit])
    entries.sort(key=lambda entry: entry[0])
    merged = [entry for _, entry in entries[:limit]]

    page_ids = [entry for entry in merged if isinstance(entry, UUID)]
    hydrated: dict[UUID, WorkArtifact] = {}
    if page_ids:
        rows = (
            (
                await db.execute(
                    select(WorkArtifact).where(WorkArtifact.id.in_(page_ids))
                )
            )
            .scalars()
            .all()
        )
        hydrated = {row.id: row for row in rows}

    page: list[PlanCandidateRow] = []
    for entry in merged:
        if isinstance(entry, UUID):
            artifact = hydrated.get(entry)
            # Absent only if the row vanished between the two reads, which is
            # a shorter page rather than a 500 — the same reading the detail
            # route gives a peer that disappeared mid-request.
            if artifact is not None:
                page.append(PlanCandidateRow(artifact=artifact))
        else:
            page.append(PlanCandidateRow(work_unit=entry))
    return page, total


async def load_depends_on(
    db: AsyncSession, artifact_ids: list[UUID]
) -> dict[UUID, list[WorkArtifact]]:
    """``depends_on`` edge TARGETS per artifact, keyed by the dependent's id.

    Every target is returned; the caller filters to the UNMET ones with
    :func:`is_terminal_status` so the "met" reading stays in one place.
    """
    if not artifact_ids:
        return {}

    stmt = (
        select(WorkArtifactEdge.from_id, WorkArtifact)
        .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.to_id)
        .where(
            WorkArtifactEdge.from_id.in_(artifact_ids),
            WorkArtifactEdge.relation == "depends_on",
        )
        .order_by(WorkArtifactEdge.from_id, WorkArtifact.slug, WorkArtifact.id)
    )
    out: dict[UUID, list[WorkArtifact]] = {aid: [] for aid in artifact_ids}
    for from_id, target in (await db.execute(stmt)).all():
        out.setdefault(from_id, []).append(target)
    return out


async def load_prompt_chains(
    db: AsyncSession, artifact_ids: list[UUID]
) -> dict[UUID, list[tuple[WorkArtifact, str, int]]]:
    """Walk :data:`PROMPT_CHAIN_RELATIONS` BACKWARDS from each artifact.

    A plan's provenance runs ``investigation_prompt --produced_report-->
    investigation_report --feeds--> plan_authoring_prompt --authored_plan-->
    plan``, so reconstructing "what produced this plan" means following those
    edges from ``to_id`` toward ``from_id``.

    Returns ``{artifact_id: [(producer, relation, depth), ...]}`` ordered
    nearest-first (depth 1 = the artifact that directly produced the plan).
    Cycles are broken by a per-root visited set and the walk is capped at
    :data:`_PROMPT_CHAIN_MAX_DEPTH` levels — the graph is user-authored, so
    neither guarantee can be assumed away.

    Implemented as one query per LEVEL (not per artifact): every root advances
    together, so a page of N candidates with a chain of depth D costs D
    queries, not N*D.
    """
    if not artifact_ids:
        return {}

    chains: dict[UUID, list[tuple[WorkArtifact, str, int]]] = {
        aid: [] for aid in artifact_ids
    }
    # Per ROOT, the ids already emitted (plus the root itself) — a shared
    # visited set would let one root's traversal starve another's.
    seen: dict[UUID, set[UUID]] = {aid: {aid} for aid in artifact_ids}
    # The frontier: node id → the roots still expanding through it.
    frontier: dict[UUID, set[UUID]] = {aid: {aid} for aid in artifact_ids}

    for depth in range(1, _PROMPT_CHAIN_MAX_DEPTH + 1):
        if not frontier:
            break
        stmt = (
            select(WorkArtifactEdge.to_id, WorkArtifactEdge.relation, WorkArtifact)
            .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
            .where(
                WorkArtifactEdge.to_id.in_(list(frontier)),
                WorkArtifactEdge.relation.in_(PROMPT_CHAIN_RELATIONS),
            )
            .order_by(WorkArtifactEdge.to_id, WorkArtifact.kind, WorkArtifact.id)
        )
        next_frontier: dict[UUID, set[UUID]] = {}
        for child_id, relation, producer in (await db.execute(stmt)).all():
            for root in frontier.get(child_id, ()):
                if producer.id in seen[root]:
                    continue
                seen[root].add(producer.id)
                chains[root].append((producer, relation, depth))
                next_frontier.setdefault(producer.id, set()).add(root)
        frontier = next_frontier

    return chains


# ═══════════ three-way status reconciliation (plan-library Phase 4) ═══════════
#
# ``GET /plan-library/reconciliation`` compares the document layer against
# coord's stored status and its derived delivery verdict, so its population is
# the WHOLE plan corpus — not the unshipped slice ``list_plan_candidates``
# selects. A plan whose document says ``draft`` while coord stored ``shipped``
# is the headline finding, and every status filter here would hide it.

#: Hard ceiling on plan artifacts pulled into one reconciliation read.
#:
#: Generous rather than binding (the document layer held 18 plan rows on
#: 2026-09-03 against ~1500 addressable stems), and NEVER applied silently: the
#: reader reports truncation and the route turns it into ``corpus_complete:
#: false`` with a named reason. A denominator that quietly stopped counting is
#: the defect class this whole surface exists to close.
RECONCILE_MAX_ARTIFACTS = 5000


@dataclass(frozen=True, slots=True)
class ReconcileArtifact:
    """One plan artifact, projected onto the columns reconciliation reads.

    Deliberately NOT a :class:`~app.models.work_artifact.WorkArtifact`: the
    population is the whole corpus, and ``body`` is a ``Text`` column on the
    same table, so loading ORM rows would pull every plan BODY into memory to
    answer a question that needs a status word. Bodies are fetched separately
    and only for the page (:func:`load_artifact_bodies`).
    """

    id: UUID
    slug: str
    title: str
    #: The scanner's parsed status word, verbatim and OPAQUE.
    status: str
    source_repo: str | None
    source_path: str | None
    work_unit_slug: str | None
    updated_at: datetime


async def list_plan_artifacts_for_reconciliation(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    limit: int = RECONCILE_MAX_ARTIFACTS,
) -> tuple[list[ReconcileArtifact], bool]:
    """Every ``kind='plan'`` artifact in the caller's org scope.

    Returns ``(rows, truncated)``. ``truncated`` is ``True`` when the corpus
    is larger than ``limit`` — read one row past the cap to tell "exactly at
    the cap" from "more than the cap", because those are different facts and
    only the second is a blind spot.

    Ordered by ``(slug, id)`` so the reconciliation page is stable: plan stems
    are date-prefixed, which makes slug order chronological, and unlike
    ``updated_at`` it does not move under a re-scan mid-page.
    """
    stmt = (
        select(
            WorkArtifact.id,
            WorkArtifact.slug,
            WorkArtifact.title,
            WorkArtifact.status,
            WorkArtifact.source_repo,
            WorkArtifact.source_path,
            WorkArtifact.work_unit_slug,
            WorkArtifact.updated_at,
        )
        .where(_org_scope(org_id), WorkArtifact.kind == "plan")
        .order_by(WorkArtifact.slug.asc(), WorkArtifact.id.asc())
        .limit(limit + 1)
    )
    rows = (await db.execute(stmt)).all()
    truncated = len(rows) > limit
    return (
        [
            ReconcileArtifact(
                id=row.id,
                slug=row.slug,
                title=row.title,
                status=row.status,
                source_repo=row.source_repo,
                source_path=row.source_path,
                work_unit_slug=row.work_unit_slug,
                updated_at=_aware(row.updated_at),
            )
            for row in rows[:limit]
        ],
        truncated,
    )


async def load_artifact_bodies(
    db: AsyncSession, ids: Sequence[UUID]
) -> dict[UUID, str]:
    """The bodies of the named artifacts, keyed by id.

    Bounded by the caller — reconciliation asks only for the page it is about
    to return — because ``body`` is the one column on this table with no upper
    size and pulling the corpus's worth of it would dwarf the read.
    """
    if not ids:
        return {}
    stmt = select(WorkArtifact.id, WorkArtifact.body).where(
        WorkArtifact.id.in_(list(ids))
    )
    return {row.id: row.body for row in (await db.execute(stmt)).all()}


def stem_matches_q(q: str, stem: str) -> bool:
    """Does ``q``'s SLUG arm match this plan stem?

    The in-memory twin of :func:`_search_predicate`'s ``slug ILIKE`` arm, for a
    population that is not one table — reconciliation's stems are coord units
    ∪ artifacts, and a coord-only stem has no row for the SQL arm to read. It
    uses the SAME :func:`_slug_needle` gate (so a short or punctuation-only
    ``q`` matches nothing here, exactly as there) and the same semantics: a
    case-insensitive, LITERAL substring — ``%`` and ``_`` are ordinary
    characters, never wildcards.
    """
    needle = _slug_needle(q)
    return bool(needle) and needle.lower() in stem.lower()


async def plan_artifact_ids_matching_q(
    db: AsyncSession, *, org_id: UUID | None, q: str
) -> set[UUID]:
    """The ids of every ``kind='plan'`` artifact in scope that ``q`` matches.

    Through :func:`_search_predicate` — the list route's own ``q`` — so the
    reconciliation filter inherits its hyphen normalization and its slug arm
    rather than growing a second, drifting definition of "matches". Ids only:
    the caller already holds the projected rows.
    """
    stmt = select(WorkArtifact.id).where(
        _org_scope(org_id), WorkArtifact.kind == "plan", _search_predicate(q)
    )
    return set((await db.execute(stmt)).scalars().all())
