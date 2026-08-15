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


class DivergentResponse(BaseModel):
    """All divergence groups visible to the caller."""

    groups: list[DivergentGroup]
    total: int
