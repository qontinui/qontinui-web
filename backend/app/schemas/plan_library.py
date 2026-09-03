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
    #: Work this artifact SURFACED but deliberately did not do. The only
    #: relation whose ``to_id`` may be null — the follow-up has no artifact
    #: yet, which is precisely what makes it worth recording. See
    #: ``plan_library_03_spawned_followup``.
    "spawned_followup",
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
    """Create one provenance edge out of (or into) the path artifact.

    For the four two-ended relations, supply EXACTLY ONE of ``to_id``
    (outgoing) or ``from_id`` (incoming) — plus ``supersedes``, five in all.

    For ``spawned_followup`` both may be omitted: that is the one-ended form,
    ``{"relation": "spawned_followup", "note": "<text>", "to_id": null}``, and
    ``note`` is then REQUIRED. Supplying ``to_id`` alongside it is still legal
    and records a follow-up that already has an owner.
    """

    to_id: UUID | None = None
    from_id: UUID | None = None
    relation: WorkArtifactRelation
    #: Optional on a two-ended edge. **Required, and non-blank, on
    #: ``spawned_followup``** — with no far end the note is the whole payload.
    note: str | None = None


class WorkArtifactEdgeClaim(BaseModel):
    """Claim an open ``spawned_followup`` by naming the artifact that owns it.

    ``PATCH /plan-library/edges/{edge_id}``. The edge stops being an open
    follow-up and becomes an ordinary two-ended provenance link, so it drops
    out of ``GET /plan-library/followups`` while staying traceable from the
    originating artifact's edge list.
    """

    to_id: UUID


# ─────────────── coord-owned link block (shared) ───────────────
#
# Used by BOTH the single-artifact detail read and the candidates read. It
# lives here, above the response models, because the detail response embeds it
# — not because it is candidate-specific.


class CandidateLinkedPr(BaseModel):
    """A PR citation coord recorded against the linked work unit."""

    repo: str | None = None
    pr_number: int | None = None
    #: ``"merged"`` / ``"unmerged"`` — derived from coord's ``merged`` flag,
    #: which is the SAME flag coord's own ``shipped`` predicate reduces.
    #:
    #: ``"unknown"`` when coord returned a citation with no merged state, AND
    #: when coord flagged ``merged_degraded_reason``: its predicate then runs
    #: without the durable ``merge_commit_sha`` arm, so every PR coord
    #: ff-landed reads ``merged: false``. A ``false`` under that flag is
    #: UNKNOWN, not an observation — the same "absence is not zero" rule
    #: ``linked_prs_state`` applies to the list, applied to one row.
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

#: Whether this candidate has a plan DOCUMENT, and where.
#:
#: The mirror of :data:`CoordLinkState` on the other side of the join. That one
#: says whether the coord work unit could be read; this one says whether the
#: plan's BODY is in the library — and the two are independent, because
#: ``/candidates`` draws its population from the union of both layers (plan
#: ``2026-09-03-vet-imp-sweep-selects-from-the-sparse-document-layer``).
#:
#: * ``present``  — an ``agent.work_artifacts`` row backs this candidate. The
#:   row carries an ``id``, so the body is fetchable from
#:   ``GET /plan-library/{id}`` and ``…/{id}/export``.
#: * ``unsynced`` — no artifact row, but coord's work unit records a
#:   ``source_path``, so a plan FILE exists and only the body sync is missing
#:   (``QONTINUI_PLAN_LIBRARY_SYNC``, opt-in and off by default). Resolve such
#:   a plan by PATH; there is no id to export from.
#: * ``absent``   — no artifact row and no ``source_path``: coord knows of the
#:   work, and no document for it has been seen anywhere. Deliberately
#:   distinct from ``unsynced`` — a consumer must be able to tell "the body
#:   was never captured" from "there is nothing to capture", which is the
#:   subject of the neighbouring plan
#:   ``2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans``.
#:
#: ``present`` is the DEFAULT so every row that existed before the union — all
#: of which are artifact-backed by construction — keeps its shape unchanged.
DocumentState = Literal["present", "unsynced", "absent"]

#: Whether the coord half of the candidate POPULATION was read.
#:
#: Distinct from :data:`CoordLinkState`, which is per-row, and from
#: ``coord_available``, which reports the page-wide circuit: this says whether
#: the union's work-unit arm ran at all. The distinction is load-bearing —
#: coord answering the population read with a 401/403 is *coord answering*, so
#: it never trips the circuit, and ``coord_available`` would stay ``true``
#: while the route silently degraded to the document layer's ~2% view of the
#: corpus. That silent degrade IS the defect this union exists to close, so it
#: gets its own flag rather than being inferred.
#:
#: * ``included``    — coord's work-unit list was read; the population is the
#:   union of both layers.
#: * ``unavailable`` — it was not (coord unreadable, or ``include_coord=false``).
#:   The population fell back to the document layer alone, which is exactly
#:   what this route returned before the union. **UNKNOWN, not "there are no
#:   work units".**
WorkUnitPopulationState = Literal["included", "unavailable"]


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
    #: ``None`` for an OPEN ``spawned_followup`` — the surfaced work has no
    #: owning artifact yet. Every other relation always carries a target
    #: (``ck_work_artifact_edges_open_target``).
    to_id: UUID | None
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
    """Single-artifact read: body + full version log + edges BOTH ways.

    ``coord`` carries the linked work unit and its PR citations, with the same
    honesty flags ``/candidates`` uses — see :class:`CandidateCoordLink`. It is
    ALWAYS present (defaulting to ``work_unit_state: "unlinked"``) so a
    consumer never has to distinguish "the field is missing" from "there is no
    link", and it is ``unavailable`` rather than empty whenever coord could not
    be read. ``include_coord=false`` skips the fetch, which reports
    ``unavailable`` for a linked artifact — deliberately, because "we did not
    look" is not "there is nothing there".
    """

    body: str
    versions: list[WorkArtifactVersionRead]
    edges: list[WorkArtifactEdgeRead]
    coord: CandidateCoordLink = Field(default_factory=CandidateCoordLink)


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


# ─────────────────── capture health (Phase 5) ───────────────────


class CaptureDoorHealth(BaseModel):
    """One capture door's contribution to the corpus.

    ``count`` alone cannot answer "is the agent door being used?" — a door
    that fed 40 artifacts and then went quiet in March looks identical to a
    live one. ``last_touched_at`` is the field that separates them.

    It is ``max(updated_at)``, i.e. LAST TOUCHED, not last captured: a kind
    correction bumps it without any capture. Named for what it measures.
    """

    #: ``runner_scan`` / ``agent`` / ``operator`` — or an unrecognised value,
    #: if the CHECK constraint ever grows a member this build has not heard of.
    captured_by: str
    count: int
    #: ``True`` when this door is one of the three the schema knows about.
    #: A ``False`` here means the corpus contains a door this build does not
    #: recognise — worth showing rather than quietly bucketing as "other".
    known: bool = True
    first_at: IsoDatetime | None = None
    last_touched_at: IsoDatetime | None = None


class CaptureHealthResponse(BaseModel):
    """Corpus census by capture door.

    Every door in :data:`CapturedBy` appears, **including the ones with zero
    artifacts**. That is the point of the panel: "the agent door has written
    nothing" is the finding, and a door that is simply missing from the list
    reads as an absent feature rather than an unused one.
    """

    total: int
    doors: list[CaptureDoorHealth]


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


class PlanCandidate(BaseModel):
    """One unshipped plan with its ranking INPUTS attached.

    No score. See the section comment above.

    A candidate comes from EITHER layer of the corpus — an
    ``agent.work_artifacts`` row, a non-terminal ``coord.work_units`` row, or
    both — and ``document_state`` is what says which. Read it before reading
    any of the document-layer fields below: on a row that has no artifact,
    those fields are not observations.
    """

    #: The backing artifact's id, or ``None`` for a candidate that exists only
    #: as a coord work unit (``document_state`` ``unsynced``/``absent``). There
    #: is nothing to give it an id from — inventing one would make a phantom
    #: addressable — so the body routes (``GET /plan-library/{id}``,
    #: ``…/{id}/export``) simply do not apply to those rows; resolve them by
    #: ``source_path`` instead.
    id: UUID | None = None
    kind: str
    #: Always ``False`` on a work-unit-only row: ``kind_locked`` is a property
    #: of an artifact row, and there is none.
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
    #: When the library last saw a change to this artifact — or, on a
    #: work-unit-only row, coord's ``updated_at`` for the unit.
    last_touched: IsoDatetime
    #: Days since ``authored_at`` (falling back to ``created_at``) — the same
    #: timestamp the default ordering uses, exposed so the agent can weigh it.
    #: A work-unit-only row measures it from the same timestamp ITS half of the
    #: ordering uses, ``coalesce(first_in_progress_at, created_at)``.
    age_days: float
    #: Derived from the DOCUMENT layer's ``depends_on`` edges. Empty on a row
    #: with ``document_state`` other than ``present`` — there are no edges to
    #: walk, so that empty list is UNKNOWN, **not** "this plan is unblocked".
    #: coord's own ``metadata.depends_on`` is deliberately not folded in here:
    #: it names slugs, and "unmet" is a judgement about the target's status
    #: that only the artifact rows can support.
    unmet_depends_on: list[CandidateDependency] = Field(default_factory=list)
    #: Same reading as ``unmet_depends_on``: provenance edges are document-layer
    #: data, so this is empty-because-unlooked-at on a work-unit-only row.
    prompt_chain: list[CandidatePromptLink] = Field(default_factory=list)
    coord: CandidateCoordLink
    #: **Additive.** Which layer(s) this candidate came from — see
    #: :data:`DocumentState`. Defaults to ``present`` so an artifact-backed row
    #: (every row this route emitted before the union) is unchanged.
    document_state: DocumentState = "present"


# ─────────────── open follow-ups (Phase 7) ───────────────
#
# The one-ended ``spawned_followup`` edge, read back. See
# ``plan_library_03_spawned_followup`` for why the edge exists at all.


class OpenFollowup(BaseModel):
    """Work a plan SURFACED and deliberately did not do, with no owner yet.

    The row is a ``spawned_followup`` edge whose ``to_id`` is still NULL. The
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


class OpenFollowupResponse(BaseModel):
    """A page of open (unclaimed) follow-ups."""

    items: list[OpenFollowup]
    total: int
    offset: int
    limit: int
    #: Named so a consumer can assert it did not silently change. Oldest first
    #: is the useful default here, not an arbitrary one.
    ordering: Literal["oldest_first"] = "oldest_first"


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
    #: **Additive.** Whether the union's work-unit arm ran — see
    #: :data:`WorkUnitPopulationState`. ``unavailable`` means ``total`` counts
    #: the DOCUMENT layer only, which on this fleet has been a ~2% view of the
    #: addressable corpus; it is UNKNOWN, never "coord has no work units".
    work_unit_population_state: WorkUnitPopulationState = "included"
    #: Why the population arm degraded, when it did. Free-form, for the
    #: operator; ``None`` whenever the arm ran.
    work_unit_population_reason: str | None = None
    #: **Additive (Phase 7).** Work that has no plan yet — open
    #: ``spawned_followup`` edges, oldest first, bounded by the same ``limit``
    #: the candidate page uses. "What should I pick up next" is not answerable
    #: from ``items`` alone: an unwritten follow-up is not an artifact, so it
    #: can never appear there, and before this field it was invisible to the
    #: only read whose job is answering that question. ``items`` keeps its
    #: shape exactly.
    open_followups: list[OpenFollowup] = Field(default_factory=list)
    #: Unpaged count of open follow-ups, so a truncated ``open_followups``
    #: never reads as the whole queue.
    open_followup_total: int = 0


# ───────── three-way status reconciliation (Phase 4) ─────────
#
# Plan ``2026-09-03-plan-status-three-way-reconciler-surface``. Three writers
# share one fact — "is this plan done?" — and none of them reads the others:
#
#   axis A — coord ``work_units.status``, the STORED column.
#   axis B — the plan DOCUMENT's status stamp.
#   axis C — coord's DERIVED ``delivery`` verdict, re-derived per read.
#
# The classification is the vendored, digest-pinned cascade in
# ``app/services/plan_status`` — one spec shared with the qontinui-dev-notes
# reconciler. These models only carry it; they never re-derive it, and in
# particular ``evidence_complete`` is coord's own field, forwarded (D4).
#
# The ONE thing that differs between the two surfaces is where axis B came
# from, and each declares it. Here it is the ARTIFACT STORE, which is
# materially weaker than the git ref the dev-notes reconciler reads: it is
# sparse and it can be silently FROZEN (``QONTINUI_PLAN_LIBRARY_SYNC`` /
# the tenant ``plan_capture`` dial). A comparator whose document axis reads an
# empty store manufactures fleet-wide FALSE AGREEMENT — the exact defect this
# plan exists to close — so the source is stated on every response and a row
# whose document axis is incomplete can never reach an AGREE class.

#: Where axis B came from. A closed set with one member TODAY, spelled as a
#: ``Literal`` rather than a bare ``str`` so a second source (a git ref, say)
#: has to be added deliberately and shows up in the OpenAPI schema.
DocumentAxisSource = Literal["artifact_store"]

#: The three groups the twelve classes fall into.
#:
#: ``unknown`` is a FIRST-CLASS verdict, never a residual (D3): it means an
#: axis could not be read, or a joined side is absent. It is deliberately not
#: folded into ``disagree`` — "the record is wrong" and "we could not tell"
#: demand opposite responses.
ReconciliationVerdict = Literal["agree", "disagree", "unknown"]

#: Which rows had axis C computed. Settled in Phase 0.1 of the plan, not here:
#: coord's delivery door is per-unit (0.145 s median / 0.192 s p95 measured
#: over 1421 units ≈ 4.5 min), and a web request cannot make that many
#: sequential calls. So axis C is computed for the PAGE being returned, and
#: every off-page row classifies ``UNKNOWN_AXIS_UNREADABLE`` rather than being
#: silently omitted from the denominator.
AxisCScope = Literal["page"]


class ReconciliationAxisA(BaseModel):
    """Axis A — coord's STORED ``work_units.status``.

    ``present`` is "a coord work unit exists for this stem". ``status`` is as
    OPAQUE here as everywhere else in this module: coord accepts an
    off-vocabulary status deliberately (its Free transition tier), so a word in
    no vocabulary reads as OPEN rather than as an error.
    """

    readable: bool
    present: bool
    status: str | None = None
    unreadable_reason: str | None = None


class ReconciliationAxisB(BaseModel):
    """Axis B — the plan document's status stamp, **from the artifact store**.

    ``source`` is stated on the axis as well as on the response because this
    is the half that differs from the qontinui-dev-notes reconciler, which
    reads the body off ``origin/main`` of the plans repo. Here there is no git
    checkout, so the document layer is ``agent.work_artifacts``.

    ``complete`` is ``document_state == "present"`` and nothing else. When it
    is ``False`` there is no document to compare and the row is UNKNOWN — the
    route refuses to emit any other verdict for such a row.
    """

    source: DocumentAxisSource = "artifact_store"
    readable: bool
    present: bool
    #: The scanner's parsed status word, verbatim from the artifact row.
    status: str | None = None
    #: ``ok`` | ``off_vocabulary`` | ``no_status_block`` — the same three
    #: values ``lint-plan-status.py --vocab=adapter --json`` emits, derived
    #: here from the stored status because the artifact store holds the parsed
    #: word rather than the linter's verdict.
    classification: str | None = None
    #: Does any line of the body satisfy the runner adapter's byte-exact
    #: ``> **Status:`` test? Computed only for rows whose body this request
    #: actually loaded — the PAGE — and ``None`` (UNKNOWN) elsewhere. ``None``
    #: is neutral in the cascade; only an explicit ``False`` is a finding.
    adapter_readable: bool | None = None
    document_state: DocumentState
    complete: bool
    unreadable_reason: str | None = None
    #: How many artifact rows share this stem. ``>1`` is a divergent copy
    #: (``GET /plan-library/divergent`` is the surface for that); the newest is
    #: the one compared, and the count is carried so the collapse is visible
    #: rather than silent.
    variant_count: int = 1


class ReconciliationAxisC(BaseModel):
    """Axis C — coord's DERIVED ``delivery`` verdict. Never re-derived here.

    ``{shipped, evidence_complete, evidence_gaps}`` exactly as coord's by-slug
    door emitted it (D4: ONE field name, ONE predicate, ONE place — web does
    not recompute degradation from citations' ``merged`` flags).

    **Read ``evidence_complete`` BEFORE ``shipped``.** When it is ``False``,
    ``shipped: false`` means coord COULD NOT ESTABLISH delivery — UNKNOWN, not
    "undelivered". The cascade encodes that mechanically: ``EVIDENCE_INCOMPLETE``
    precedes every arm that reads ``shipped``.

    ``evidence_gaps`` is carried VERBATIM and never collapsed to a count or a
    boolean; it is the only place two of coord's three modelled gaps are
    visible at all.
    """

    readable: bool
    present: bool
    shipped: bool | None = None
    evidence_complete: bool | None = None
    evidence_gaps: list[str] = Field(default_factory=list)
    citation_count: int | None = None
    unreadable_reason: str | None = None
    #: Whether this request actually asked coord about this row. ``False`` on
    #: every off-page row — see :data:`AxisCScope`.
    computed: bool = False


class ReconciliationRow(BaseModel):
    """One plan stem, its three axis readings, and the resulting class."""

    #: The plan stem — the identifier every other surface joins on
    #: (``Depends-On:``, the ``Plan: <stem>`` PR marker, plan filenames).
    slug: str
    title: str | None = None
    #: The backing artifact's id, or ``None`` when the document layer has
    #: never captured this stem. There is nothing to give it an id from.
    artifact_id: UUID | None = None
    source_repo: str | None = None
    source_path: str | None = None
    document_state: DocumentState
    #: ``document_state == "present"``. Hoisted onto the row because it is the
    #: flag a consumer must read before trusting any comparison on it.
    document_axis_complete: bool
    axis_a: ReconciliationAxisA
    axis_b: ReconciliationAxisB
    axis_c: ReconciliationAxisC
    #: One of the twelve members of the vendored ``CLASS_ORDER``.
    classification: str
    verdict: ReconciliationVerdict
    #: A plain sentence naming the values that decided the class, so an
    #: operator does not have to re-derive the verdict from the axes.
    reason: str


class ReconciliationFacets(BaseModel):
    """The D3 honesty block: exhaustive facets, a denominator, a blind-spot flag.

    Modelled on coord's ``coord_memory_overview`` contract:

    * ``by_class`` carries **every** member of the cascade INCLUDING the zeros,
      so "no rows of class X" is a stated fact rather than an absence;
    * ``by_verdict`` likewise carries all three groups including zeros;
    * ``denominator`` is explicit and ``sum(by_class) == sum(by_verdict) ==
      denominator``;
    * ``corpus_complete`` is ``False`` for a partial read, as an explicit blind
      spot, and ``corpus_incomplete_reasons`` names each one.

    The denominator is the WHOLE population, not the page: an off-page row is
    classified ``UNKNOWN_AXIS_UNREADABLE`` and counted, never omitted.
    """

    denominator: int
    by_class: dict[str, int]
    by_verdict: dict[str, int]
    corpus_complete: bool
    #: Empty iff ``corpus_complete``. Each entry names one blind spot in plain
    #: words — an unread axis, a truncated population, a frozen document layer.
    corpus_incomplete_reasons: list[str] = Field(default_factory=list)


class ReconciliationResponse(BaseModel):
    """A page of reconciled plan stems plus the honesty flags for the read."""

    items: list[ReconciliationRow]
    #: The whole population's size — the facets' denominator, not ``len(items)``.
    total: int
    offset: int
    limit: int
    #: The stable default ordering, named so a consumer can assert it did not
    #: silently become something else. Plan stems are date-prefixed, so slug
    #: order is chronological order, and it is stable across requests in a way
    #: a mutable timestamp is not.
    ordering: Literal["slug_asc"] = "slug_asc"
    #: **Stated on every response.** Axis B here is the artifact store, not a
    #: git ref — see :class:`ReconciliationAxisB`.
    document_axis_source: DocumentAxisSource = "artifact_store"
    #: ``True`` only when EVERY row in the denominator has an artifact behind
    #: it. ``False`` is the frozen/sparse document layer showing through, and
    #: it is the flag that stops this surface from being read as agreement.
    document_axis_complete: bool
    #: How many rows in the denominator carry a document. With
    #: ``document_missing`` it says how far the store is from complete.
    document_present_count: int
    document_missing_count: int
    #: ``False`` when ANY coord read degraded on this page (the page-wide
    #: circuit). Per-row detail is in each row's axes.
    coord_available: bool = True
    #: Whether coord's work-unit list — the population's axis-A arm — was read.
    #: ``unavailable`` means axis A is UNKNOWN for every row, never "coord has
    #: no work units".
    work_unit_population_state: WorkUnitPopulationState = "included"
    work_unit_population_reason: str | None = None
    #: Which rows had axis C computed, and how many.
    axis_c_scope: AxisCScope = "page"
    axis_c_computed_count: int
    facets: ReconciliationFacets
