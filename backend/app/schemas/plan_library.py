"""Pydantic schemas for the Plan & Prompt Library (``agent.work_artifacts``).

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``.

Two validation rules are deliberate and load-bearing:

* ``kind``, ``captured_by`` and ``relation`` ARE ``Literal`` unions, because
  Postgres CHECKs back them — a bad value would otherwise surface as a 500
  IntegrityError instead of a 422.
* ``status`` is **plain ``str`` with no constraint at all**. It mirrors
  free-form plan front-matter and must never 422. Do not "tidy" it into a
  Literal.

``organization_id`` appears on responses but is **absent from every request
model on purpose** — it is derived server-side from the authenticated
principal. A caller-supplied organization would be a scope-escalation bug, and
the surest way to prevent one is to give the request body nowhere to put it.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import BaseORMSchema, IsoDatetime

WorkArtifactKind = Literal[
    "investigation_prompt",
    "plan_authoring_prompt",
    "implementation_prompt",
    "investigation_report",
    "handoff",
    "plan",
]

CapturedBy = Literal["runner_scan", "agent", "operator"]

WorkArtifactRelation = Literal[
    "produced_report",
    "feeds",
    "authored_plan",
    "supersedes",
    "depends_on",
]


# ───────────────────────── requests ─────────────────────────


class WorkArtifactUpsert(BaseModel):
    """Upsert payload. Identity is ``(kind, slug, source_repo)`` + the
    server-derived organization — those three fields are the natural key,
    everything else is content or metadata that the upsert overwrites.

    NOTE the absence of ``organization_id``. See the module docstring.
    """

    kind: WorkArtifactKind
    slug: str = Field(..., min_length=1, max_length=512)
    title: str = Field("", max_length=1024)
    # Opaque. No vocabulary, no validation, never a 422.
    status: str = ""
    body: str = ""
    #: Optional caller-computed digest. When supplied it is CHECKED against
    #: the server's own sha256 of ``body`` and a mismatch is rejected — the
    #: stored value is always the server-computed one, so a client can never
    #: forge "unchanged" and suppress a real revision.
    content_sha256: str | None = Field(None, max_length=64)
    source_path: str | None = Field(None, max_length=2048)
    source_repo: str | None = Field(None, max_length=255)
    #: Soft link to a coord work-unit slug. May dangle — never resolved,
    #: never 404s.
    work_unit_slug: str | None = Field(None, max_length=255)
    repos: list[str] = Field(default_factory=list)
    authored_at: IsoDatetime | None = None
    captured_by: CapturedBy = "agent"
    #: Change note recorded on the appended version row (ignored on a no-op).
    change_description: str | None = None
    #: **The scanner's flag.** ``True`` means ``kind`` above was GUESSED from
    #: the filename/body, so the upsert resolves its target by
    #: ``(org, slug, source_repo)`` ignoring ``kind`` and refuses to move the
    #: kind of a row someone already corrected (``kind_locked``). ``False``
    #: (the default) means the caller is ASSERTING the kind: exact-identity
    #: resolution, and the write locks the kind so no later scan can undo it.
    #: Getting this backwards is what silently forks a corrected artifact into
    #: a second row — see alembic ``plan_library_02_kind_lock``.
    kind_is_heuristic: bool = False


class WorkArtifactKindPatch(BaseModel):
    """Correct one artifact's ``kind`` and lock it against future scans.

    The door Phase 5's inline kind correction needs. Sets ``kind_locked``
    unconditionally — even when the kind is unchanged — because the lock
    records that a human/agent asserted it.
    """

    kind: WorkArtifactKind


class WorkArtifactEdgeCreate(BaseModel):
    """Create one provenance edge out of (or into) the path artifact."""

    to_id: UUID | None = None
    from_id: UUID | None = None
    relation: WorkArtifactRelation
    note: str | None = None


# ───────────────────────── responses ─────────────────────────


class WorkArtifactSummary(BaseORMSchema):
    """List-row shape — everything except the (potentially huge) body."""

    id: UUID
    organization_id: UUID | None
    created_by_user_id: UUID | None
    kind: str
    #: ``True`` when ``kind`` was set deliberately (operator/agent write or the
    #: ``PATCH .../kind`` door) and a heuristic re-scan may no longer move it.
    kind_locked: bool
    slug: str
    title: str
    status: str
    content_sha256: str
    source_path: str | None
    source_repo: str | None
    work_unit_slug: str | None
    repos: list[str]
    authored_at: IsoDatetime | None
    captured_by: str
    current_version: int
    created_at: IsoDatetime
    updated_at: IsoDatetime


class WorkArtifactVersionRead(BaseORMSchema):
    """One immutable revision snapshot."""

    id: UUID
    document_id: UUID
    version_number: int
    body: str
    content_sha256: str
    change_description: str | None
    created_by: str | None
    created_at: IsoDatetime


class WorkArtifactEdgeRead(BaseORMSchema):
    """One provenance edge, with the far end's identity denormalized in."""

    id: UUID
    from_id: UUID
    to_id: UUID
    relation: str
    note: str | None
    created_by: str | None
    created_at: IsoDatetime
    #: Direction relative to the artifact being read.
    direction: Literal["outgoing", "incoming"]
    #: Identity of the artifact at the OTHER end, so a UI can render the
    #: graph without an N+1 fetch. ``None`` only if the peer vanished
    #: between the two reads.
    peer_kind: str | None = None
    peer_slug: str | None = None
    peer_title: str | None = None


class WorkArtifactDetail(WorkArtifactSummary):
    """Single-artifact read: body + full version log + edges BOTH ways."""

    body: str
    versions: list[WorkArtifactVersionRead]
    edges: list[WorkArtifactEdgeRead]


class WorkArtifactListResponse(BaseModel):
    """A page of list rows."""

    items: list[WorkArtifactSummary]
    total: int
    offset: int
    limit: int


class WorkArtifactUpsertResponse(BaseModel):
    """Upsert outcome.

    The "304-equivalent" the plan asks for: an unchanged ``content_sha256``
    returns ``changed=False`` (and the response carries the
    ``X-Artifact-Unchanged: true`` header plus an ``ETag`` of the digest).
    A literal HTTP 304 is not used because 304 must carry no body and the
    caller still wants the current row back — notably ``current_version``,
    which it can then assert did NOT move.
    """

    changed: bool
    created: bool
    artifact: WorkArtifactSummary


class DivergentVariant(BaseORMSchema):
    """One of the conflicting copies in a divergence group."""

    id: UUID
    kind: str
    kind_locked: bool
    content_sha256: str
    source_repo: str | None
    source_path: str | None
    title: str
    status: str
    current_version: int
    updated_at: IsoDatetime


class DivergentGroup(BaseModel):
    """A ``(kind, slug)`` whose copies do not agree on content."""

    kind: str
    slug: str
    variant_count: int
    variants: list[DivergentVariant]


class KindForkGroup(BaseModel):
    """A ``(slug, source_repo)`` whose copies disagree on ``kind``.

    A DIFFERENT failure from :class:`DivergentGroup`, which groups by
    ``(kind, slug)`` and therefore cannot see a fork whose whole
    distinguishing feature is that the kinds differ. This is the class the
    kind-lock fix prevents going forward and that the scan-safe upsert now
    refuses to resolve (it 409s instead of picking a winner), so it is
    reported here rather than left invisible.

    ``resolvable`` is ``True`` when exactly one variant is ``kind_locked`` —
    the scanner can then unambiguously prefer that row and the fork will heal
    itself. ``False`` means an operator must pick, via ``PATCH .../kind``.
    """

    slug: str
    source_repo: str | None
    kinds: list[str]
    variant_count: int
    resolvable: bool
    variants: list[DivergentVariant]


class DivergentResponse(BaseModel):
    """All divergence groups visible to the caller."""

    groups: list[DivergentGroup]
    total: int
    #: Same-slug/different-kind forks. Additive: ``groups``/``total`` keep
    #: their phase-1 meaning exactly.
    kind_forks: list[KindForkGroup] = Field(default_factory=list)
    kind_fork_total: int = 0


# ─────────────────── candidate selection (Phase 6) ───────────────────
#
# Design decision D6: these models carry the ranking INPUTS and NOTHING that
# ranks. There is deliberately no criticality/priority/weight/score field
# anywhere below — the plan is explicit that a hardcoded score would be "a
# guess frozen into SQL". The agent reading this payload does the ranking.


class CandidatePromptLink(BaseModel):
    """One producer in the prompt chain that led to a plan.

    Reached by walking ``authored_plan`` / ``feeds`` / ``produced_report``
    edges BACKWARDS from the plan. ``depth`` 1 is the artifact that directly
    produced it; higher numbers are further upstream.
    """

    id: UUID
    kind: str
    slug: str
    title: str
    relation: str
    depth: int


class CandidateDependency(BaseModel):
    """A ``depends_on`` target that is NOT in a terminal state."""

    id: UUID
    kind: str
    slug: str
    title: str
    status: str


class CandidateLinkedPr(BaseModel):
    """A PR citation coord recorded against the linked work unit."""

    repo: str | None = None
    pr_number: int | None = None
    #: ``"merged"`` / ``"unmerged"`` — derived from coord's ``merged`` flag,
    #: which is the SAME flag coord's own ``shipped`` predicate reduces.
    #: ``"unknown"`` when coord returned a citation with no merged state.
    state: Literal["merged", "unmerged", "unknown"] = "unknown"
    merged: bool | None = None
    branch: str | None = None
    cited_at: str | None = None
    sources: list[str] = Field(default_factory=list)


#: Whether the linked work unit could be read from coord AT ALL.
#:
#: * ``linked``      — coord returned the work unit.
#: * ``dangling``    — coord answered, and there is no such work unit. The
#:   soft link is FK-less by design and MAY dangle; this is a normal result,
#:   never a 404 on this read.
#: * ``unavailable`` — coord could not be read (down, slow, unauthorized).
#:   **This is UNKNOWN, not empty.** Never render it as "no work unit".
#: * ``unlinked``    — the artifact carries no ``work_unit_slug`` at all.
CoordLinkState = Literal["linked", "dangling", "unavailable", "unlinked"]

#: Whether ``linked_prs`` is a real answer.
#:
#: * ``available``   — coord answered; ``linked_prs`` is complete (possibly
#:   genuinely empty).
#: * ``unavailable`` — coord could not be read, or the deployed coord has no
#:   citation read route. ``linked_prs`` is ``[]`` because there is nothing to
#:   show, NOT because there are no PRs. Absence is UNKNOWN, not zero.
#: * ``unlinked``    — no work unit to hang citations off (no slug, or the
#:   slug dangles). Citations carry a hard FK to the work unit, so "no unit"
#:   really does mean "no citations" — this one IS a real zero.
CoordPrState = Literal["available", "unavailable", "unlinked"]


class CandidateCoordLink(BaseModel):
    """Everything coord-owned about a candidate, with its own honesty flags.

    Fetched over coord's HTTP API — web NEVER reads coord's Postgres schema
    (house rule; ``tests/test_coord_schema_boundary_guard.py`` enforces it).
    Each half carries its own state so an unreachable coord is distinguishable
    from a genuine empty.
    """

    work_unit_slug: str | None = None
    work_unit_state: CoordLinkState = "unlinked"
    work_unit_status: str | None = None
    work_unit_title: str | None = None
    linked_prs_state: CoordPrState = "unlinked"
    linked_prs: list[CandidateLinkedPr] = Field(default_factory=list)
    #: Why the read degraded, when it did. Free-form, for the operator.
    unavailable_reason: str | None = None


class PlanCandidate(BaseModel):
    """One unshipped plan with its ranking INPUTS attached.

    No score. See the section comment above.
    """

    id: UUID
    kind: str
    kind_locked: bool
    slug: str
    title: str
    status: str
    repos: list[str] = Field(default_factory=list)
    source_repo: str | None = None
    source_path: str | None = None
    work_unit_slug: str | None = None
    authored_at: IsoDatetime | None = None
    created_at: IsoDatetime
    #: When the library last saw a change to this artifact.
    last_touched: IsoDatetime
    #: Days since ``authored_at`` (falling back to ``created_at``) — the same
    #: timestamp the default ordering uses, exposed so the agent can weigh it.
    age_days: float
    unmet_depends_on: list[CandidateDependency] = Field(default_factory=list)
    prompt_chain: list[CandidatePromptLink] = Field(default_factory=list)
    coord: CandidateCoordLink


class PlanCandidateResponse(BaseModel):
    """A page of candidates plus the honesty flags for the whole read."""

    items: list[PlanCandidate]
    total: int
    offset: int
    limit: int
    #: The stable default ordering, named so a consumer can assert it did not
    #: silently become something else. There is no alternative ordering and no
    #: scoring pass.
    ordering: Literal["oldest_vetted_first"] = "oldest_vetted_first"
    #: ``False`` when ANY coord read degraded on this page. Per-row detail is
    #: in each item's ``coord`` block.
    coord_available: bool = True
