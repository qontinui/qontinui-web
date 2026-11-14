"""Request and response schemas for ``/api/v1/design-refs``.

Plan ``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``,
Phase 1. Closed sets are ``Literal`` types whose values equal the models'
CHECK lists (``tests/design_refs/test_vocabulary.py`` holds them equal).

Two rules shape every schema here:

* **No overall grade.** No field is named like an aggregate score; a read-time
  summary of a distribution is named ``*_median`` / ``*_spread`` / ``n`` and
  labelled as computed at read time (the schema-walk test enforces the names).
* **The rater is never the payload's to choose.** ``rater_kind`` is accepted
  on a rating or comparison body only so a caller that sends it is not refused
  — the stored value is derived from the credential arm, always.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Tier = Literal["private", "public"]
ReviewState = Literal["pending", "approved", "rejected"]
Quality = Literal["exemplar", "ok", "anti_pattern"]
PriceTier = Literal["budget", "mid", "premium", "luxury", "unknown"]
ContextState = Literal["proposed", "confirmed"]
Split = Literal["reference", "holdout"]
Level = Literal["site", "page", "flow", "component"]
JudgementTargetKind = Literal["site", "page", "component"]
RaterKind = Literal["operator", "ai"]
Confidence = Literal["low", "medium", "high"]
Winner = Literal["a", "b", "tie"]
ShownOrder = Literal["a_first", "b_first"]
PersonalityState = Literal["proposed", "confirmed"]
PrincipleStatus = Literal["proposed", "approved", "retired"]
EvidenceRole = Literal["supports", "counterexample"]
EvidenceKind = Literal["perception_rating", "comparison"]
AssetClass = Literal["image", "svg", "icon", "font", "text"]
JobScope = Literal["page", "crawl", "flow"]
JobSource = Literal["operator", "cli", "mcp", "discovery"]
JobState = Literal[
    "proposed", "rejected", "queued", "running", "done", "failed", "cancelled"
]
UploadPurpose = Literal["record", "source", "bundle"]
VocabKind = Literal["style_family", "perception_dimension", "personality_trait"]
CorrectionTargetKind = Literal[
    "site",
    "page",
    "flow",
    "component",
    "description",
    "capture_job",
    "site_personality",
    "design_principle",
]

SHA256_PATTERN = r"^[0-9a-f]{64}$"
EXT_PATTERN = r"^\.[a-z0-9]{1,10}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ═════════════════════════════ blobs ═════════════════════════════


class UploadIntent(_Strict):
    """Ask for where to put one blob. ``tier`` is the RECORD's tier; a
    ``source`` or ``bundle`` blob is stored under ``private/`` whatever it."""

    purpose: UploadPurpose
    tier: Tier
    sha256: str = Field(pattern=SHA256_PATTERN)
    size: int = Field(ge=0)
    ext: str = Field(pattern=EXT_PATTERN)
    content_type: str | None = Field(default=None, max_length=200)


class UploadTicket(BaseModel):
    key: str
    tier: Tier
    already_stored: bool
    #: ``stream``: PUT the bytes to ``stream_path`` (every backend);
    #: ``presigned_put``: PUT them to ``presigned_url`` (S3 only), then POST
    #: ``verify_path``. Neither URL is ever stored.
    method: Literal["stream", "presigned_put"]
    stream_path: str
    presigned_url: str | None = None
    #: Headers the presigned PUT must carry (the pinned SHA-256 checksum).
    required_headers: dict[str, str] = Field(default_factory=dict)
    verify_path: str | None = None


class UploadVerify(_Strict):
    key: str = Field(min_length=1, max_length=400)


class BlobOut(_Out):
    key: str
    tier: Tier
    sha256: str
    size: int
    content_type: str | None
    verified_at: datetime


# ═════════════════════════════ records ═════════════════════════════


class SiteCreate(_Strict):
    tier: Tier
    domain: str = Field(min_length=1, max_length=253)
    product_name: str | None = None
    industry: str | None = None
    business_type: str | None = None
    audience: str | None = None
    positioning: str | None = None
    price_tier: PriceTier = "unknown"
    intended_personality: str | None = None
    style_family: str | None = None
    tags: list[str] = Field(default_factory=list)


class SiteUpdate(_Strict):
    """A site edit. ``split`` is accepted only so that an attempt to change
    it is REFUSED by name (409 ``split_immutable``) rather than ignored."""

    product_name: str | None = None
    industry: str | None = None
    business_type: str | None = None
    audience: str | None = None
    positioning: str | None = None
    price_tier: PriceTier | None = None
    intended_personality: str | None = None
    style_family: str | None = None
    tags: list[str] | None = None
    split: Split | None = None


class ContextConfirm(_Strict):
    """The operator confirms the site context, optionally editing fields
    first; every edited field is written to the correction log."""

    industry: str | None = None
    business_type: str | None = None
    audience: str | None = None
    positioning: str | None = None
    price_tier: PriceTier | None = None
    intended_personality: str | None = None
    style_family: str | None = None


class SiteOut(_Out):
    id: UUID
    tier: Tier
    domain: str
    product_name: str | None
    industry: str | None
    business_type: str | None
    audience: str | None
    positioning: str | None
    price_tier: PriceTier
    intended_personality: str | None
    style_family: str | None
    context_state: ContextState
    context_confirmed_by: UUID | None
    context_confirmed_at: datetime | None
    split: Split | None
    split_assigned_at: datetime | None
    tags: list[Any]
    review_state: ReviewState
    quality: Quality | None
    created_at: datetime
    updated_at: datetime


class PageCreate(_Strict):
    site_id: UUID
    url: str = Field(min_length=1, max_length=4000)
    title: str | None = None
    page_type: str | None = None
    page_job: str | None = None
    captured_at: datetime | None = None
    viewports: list[Any] = Field(default_factory=list)
    capture_basis: dict[str, Any] = Field(default_factory=dict)
    capture_job_id: UUID | None = None
    tags: list[str] = Field(default_factory=list)


class PageUpdate(_Strict):
    title: str | None = None
    page_type: str | None = None
    page_job: str | None = None
    tags: list[str] | None = None


class PageOut(_Out):
    id: UUID
    tier: Tier
    site_id: UUID
    capture_job_id: UUID | None
    url: str
    title: str | None
    page_type: str | None
    page_job: str | None
    captured_at: datetime | None
    viewports: list[Any]
    capture_basis: dict[str, Any]
    tags: list[Any]
    review_state: ReviewState
    quality: Quality | None
    created_at: datetime
    updated_at: datetime


class FlowStep(_Strict):
    page_id: UUID
    state: str | None = None


class FlowCreate(_Strict):
    site_id: UUID
    name: str = Field(min_length=1, max_length=500)
    goal: str | None = None
    steps: list[FlowStep] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class FlowUpdate(_Strict):
    name: str | None = Field(default=None, min_length=1, max_length=500)
    goal: str | None = None
    steps: list[FlowStep] | None = None
    tags: list[str] | None = None


class FlowOut(_Out):
    id: UUID
    tier: Tier
    site_id: UUID
    name: str
    goal: str | None
    steps: list[Any]
    tags: list[Any]
    review_state: ReviewState
    quality: Quality | None
    created_at: datetime
    updated_at: datetime


class CaptureCreate(_Strict):
    page_id: UUID
    run_id: UUID
    viewport: str = Field(min_length=1, max_length=100)
    interaction_state: str = "default"
    screenshot_key: str | None = None
    structure_key: str | None = None
    styles_key: str | None = None
    a11y_key: str | None = None
    tokens: dict[str, Any] = Field(default_factory=dict)
    layout_bands: list[Any] = Field(default_factory=list)
    motion_summary: dict[str, Any] = Field(default_factory=dict)
    facets: dict[str, Any] = Field(default_factory=dict)
    element_cap_reached: str | None = None
    opt_out_signals: list[Any] = Field(default_factory=list)
    logged_in: bool = False


class CaptureOut(_Out):
    id: UUID
    tier: Tier
    page_id: UUID
    run_id: UUID
    viewport: str
    interaction_state: str
    screenshot_key: str | None
    structure_key: str | None
    styles_key: str | None
    a11y_key: str | None
    tokens: dict[str, Any]
    layout_bands: list[Any]
    motion_summary: dict[str, Any]
    facets: dict[str, Any]
    element_cap_reached: str | None
    opt_out_signals: list[Any]
    logged_in: bool
    created_at: datetime


class SourcePart(_Strict):
    key: str = Field(min_length=1, max_length=400)
    url: str | None = None
    status: int | None = None
    content_type: str | None = None


class CaptureSourceCreate(_Strict):
    page_id: UUID
    run_id: UUID
    viewport: str = Field(min_length=1, max_length=100)
    #: ``{part_name: {key, url?, status?, content_type?}}`` — every key must
    #: be a verified ``private/`` blob of the caller's tenant.
    parts: dict[str, SourcePart]
    missing: list[Any] = Field(default_factory=list)
    logged_in: bool = False

    @field_validator("parts")
    @classmethod
    def _part_names(cls, value: dict[str, SourcePart]) -> dict[str, SourcePart]:
        import re

        for name in value:
            if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", name):
                raise ValueError(f"invalid part name {name!r}")
        return value


class CaptureSourceOut(_Out):
    id: UUID
    tier: Tier
    page_id: UUID
    run_id: UUID
    viewport: str
    parts: dict[str, Any]
    missing: list[Any]
    logged_in: bool
    created_at: datetime


class ReplayBundleCreate(_Strict):
    page_id: UUID
    run_id: UUID
    bundle_key: str = Field(min_length=1, max_length=400)
    manifest: dict[str, Any] = Field(default_factory=dict)
    truncated: bool = False
    recorded_at: datetime | None = None
    worker_version: str | None = None
    replay_miss_count: int | None = Field(default=None, ge=0)
    logged_in: bool = False


class ReplayBundleOut(_Out):
    id: UUID
    tier: Tier
    page_id: UUID
    run_id: UUID
    bundle_key: str
    manifest: dict[str, Any]
    truncated: bool
    recorded_at: datetime | None
    worker_version: str | None
    replay_miss_count: int | None
    logged_in: bool
    created_at: datetime


class ComponentCreate(_Strict):
    page_id: UUID
    capture_id: UUID | None = None
    role: str | None = None
    bbox: dict[str, Any] = Field(default_factory=dict)
    structure: dict[str, Any] = Field(default_factory=dict)
    styles: dict[str, Any] = Field(default_factory=dict)
    tokens: dict[str, Any] = Field(default_factory=dict)
    states: list[Any] = Field(default_factory=list)
    crop_key: str | None = None
    tags: list[str] = Field(default_factory=list)


class ComponentUpdate(_Strict):
    role: str | None = None
    tags: list[str] | None = None


class ComponentOut(_Out):
    id: UUID
    tier: Tier
    page_id: UUID
    capture_id: UUID | None
    role: str | None
    bbox: dict[str, Any]
    structure: dict[str, Any]
    styles: dict[str, Any]
    tokens: dict[str, Any]
    states: list[Any]
    crop_key: str | None
    tags: list[Any]
    review_state: ReviewState
    quality: Quality | None
    created_at: datetime
    updated_at: datetime


class FingerprintItem(_Strict):
    asset_class: AssetClass
    source_url: str | None = None
    phash: str | None = Field(default=None, max_length=64)
    dhash: str | None = Field(default=None, max_length=64)
    canonical_hash: str | None = Field(default=None, max_length=64)
    content_hash: str | None = Field(default=None, max_length=64)
    shingles: list[Any] = Field(default_factory=list)


class FingerprintBatch(_Strict):
    capture_id: UUID
    items: list[FingerprintItem] = Field(min_length=1, max_length=5000)


class FingerprintBatchOut(BaseModel):
    capture_id: UUID
    stored: int


class DescriptionCreate(_Strict):
    level: Level
    target_id: UUID
    body: str = Field(min_length=1, max_length=32_000)
    facets: dict[str, Any] = Field(default_factory=dict)
    embedding: list[float] | None = None
    embedding_model: str | None = None
    generator: str | None = None
    evidence: list[Any] = Field(default_factory=list)

    @model_validator(mode="after")
    def _embedding_whole(self) -> DescriptionCreate:
        if (self.embedding is None) != (self.embedding_model is None):
            raise ValueError("embedding and embedding_model are sent together")
        if self.embedding is not None and len(self.embedding) != 384:
            raise ValueError("embedding must have 384 dimensions")
        return self


class DescriptionUpdate(_Strict):
    body: str | None = Field(default=None, min_length=1, max_length=32_000)
    facets: dict[str, Any] | None = None


class DescriptionOut(_Out):
    id: UUID
    tier: Tier
    level: Level
    target_id: UUID
    body: str
    facets: dict[str, Any]
    embedding_model: str | None
    generator: str | None
    evidence: list[Any]
    review_state: ReviewState
    quality: Quality | None
    created_at: datetime
    updated_at: datetime


class ReviewWrite(_Strict):
    """The operator's curation of one record: review state and quality."""

    review_state: ReviewState | None = None
    quality: Quality | None = None
    clear_quality: bool = False


class CorrectionOut(_Out):
    id: UUID
    target_kind: CorrectionTargetKind
    target_id: UUID
    field: str
    from_value: Any
    to_value: Any
    actor_kind: RaterKind
    actor_id: str
    created_at: datetime


# ═════════════════════════════ capture jobs ═════════════════════════════


class CaptureJobCreate(_Strict):
    url: str = Field(min_length=1, max_length=4000)
    scope_kind: JobScope = "page"
    crawl_depth: int | None = Field(default=None, ge=1, le=10)
    flow_goal: str | None = None
    notes: str | None = None
    source: JobSource = "operator"
    is_reproduction: bool = False

    @model_validator(mode="after")
    def _scope_whole(self) -> CaptureJobCreate:
        if (self.scope_kind == "crawl") != (self.crawl_depth is not None):
            raise ValueError("crawl_depth is sent exactly when scope_kind is crawl")
        if (self.scope_kind == "flow") != (self.flow_goal is not None):
            raise ValueError("flow_goal is sent exactly when scope_kind is flow")
        return self


class CaptureJobUpdate(_Strict):
    """A worker's or operator's move of one job."""

    state: JobState | None = None
    derived_tier: Tier | None = None
    tier_reason: dict[str, Any] | None = None
    error: str | None = None
    lease_seconds: int | None = Field(default=None, ge=10, le=3600)


class CaptureJobClaim(_Strict):
    worker: str = Field(min_length=1, max_length=200)
    lease_seconds: int = Field(default=600, ge=10, le=3600)


class CaptureJobOut(_Out):
    id: UUID
    url: str
    domain: str
    scope_kind: JobScope
    crawl_depth: int | None
    flow_goal: str | None
    notes: str | None
    source: JobSource
    submitter_kind: str
    submitter_id: str | None
    is_reproduction: bool
    state: JobState
    claimed_by: str | None
    claimed_until: datetime | None
    derived_tier: Tier | None
    tier_reason: dict[str, Any] | None
    error: str | None
    created_at: datetime
    updated_at: datetime


# ═════════════════════════════ search ═════════════════════════════


class SearchRequest(_Strict):
    level: Level
    text: str | None = Field(default=None, max_length=1000)
    #: Exact facet match (JSON containment) on the target's descriptions.
    facets: dict[str, Any] | None = None
    industry: str | None = None
    business_type: str | None = None
    price_tier: PriceTier | None = None
    style_family: str | None = None
    tier: Tier | None = None
    query_embedding: list[float] | None = None
    query_embedding_model: str | None = None
    personality_target: dict[str, int] | None = None
    personality_tolerance: int | None = Field(default=None, ge=0, le=100)
    include_unconfirmed: bool = False
    include_anti_pattern: bool = False
    #: Accepted only from an operator principal (the review UI's reads).
    include_holdout: bool = False
    limit: int = Field(default=20, ge=1, le=200)

    @model_validator(mode="after")
    def _shape(self) -> SearchRequest:
        if (self.query_embedding is None) != (self.query_embedding_model is None):
            raise ValueError(
                "query_embedding and query_embedding_model are sent together"
            )
        if self.query_embedding is not None and len(self.query_embedding) != 384:
            raise ValueError("query_embedding must have 384 dimensions")
        for trait, value in (self.personality_target or {}).items():
            if not 0 <= value <= 100:
                raise ValueError(f"personality_target[{trait}] must be 0..100")
        return self


class SearchHit(BaseModel):
    level: Level
    target_id: UUID
    site_id: UUID
    domain: str
    tier: Tier
    review_state: ReviewState
    quality: Quality | None
    #: Every facet the request named matched one of the target's descriptions.
    facet_exact: bool
    text_rank: float | None
    vector_similarity: float | None
    #: Weighted distance to ``personality_target`` (lower is closer).
    personality_distance: float | None
    personality_basis: Literal["confirmed", "unconfirmed"] | None
    #: ``holdout``, ``split_unassigned``, ``context_unconfirmed``,
    #: ``unreviewed``, ``personality_unconfirmed``.
    labels: list[str]
    snippet: str | None


class SearchResponse(BaseModel):
    vector_arm: Literal["hybrid", "skipped_no_embedding"]
    results: list[SearchHit]


class SimilarByStyleRequest(_Strict):
    level: Literal["page", "component"] = "component"
    tokens: dict[str, Any]
    role: str | None = None
    include_holdout: bool = False
    limit: int = Field(default=10, ge=1, le=100)


class StyleHit(BaseModel):
    level: Literal["page", "component"]
    target_id: UUID
    site_id: UUID
    domain: str
    role: str | None
    token_distance: float
    labels: list[str]


class SimilarByStyleResponse(BaseModel):
    style_arm: Literal["fingerprint", "tokens_only"]
    results: list[StyleHit]


class CompareSnapshot(_Strict):
    role: str | None = None
    tokens: dict[str, Any]
    structure: dict[str, Any] | None = None


class CompareRequest(_Strict):
    snapshot: CompareSnapshot
    include_holdout: bool = False
    limit: int = Field(default=5, ge=1, le=50)


class TokenDifference(BaseModel):
    token: str
    ours: Any
    reference: Any


class CompareHit(BaseModel):
    target_id: UUID
    level: Literal["page", "component"]
    site_id: UUID
    domain: str
    role: str | None
    token_distance: float
    differences: list[TokenDifference]
    labels: list[str]


class CompareResponse(BaseModel):
    fidelity_arm: Literal["design_compare", "tokens_only"]
    results: list[CompareHit]


# ═════════════════════════════ judgements ═════════════════════════════


class EvidenceItem(_Strict):
    """One pointer at a capture field path, an element id or a measured value."""

    capture_id: UUID | None = None
    field_path: str | None = None
    element_id: str | None = None
    measured_value: Any = None
    note: str | None = None

    @model_validator(mode="after")
    def _points_somewhere(self) -> EvidenceItem:
        if not (self.field_path or self.element_id or self.measured_value is not None):
            raise ValueError(
                "an evidence item points at a field path, an element id or a "
                "measured value"
            )
        return self


class RatingCreate(_Strict):
    target_kind: JudgementTargetKind
    target_id: UUID
    dimension_key: str = Field(min_length=1, max_length=64)
    score: int = Field(ge=1, le=10)
    context_page_id: UUID | None = None
    context_viewport: str | None = None
    confidence: Confidence | None = None
    positive_evidence: list[EvidenceItem] = Field(default_factory=list)
    negative_evidence: list[EvidenceItem] = Field(default_factory=list)
    explanation: str | None = Field(default=None, max_length=8000)
    answer_ms: int | None = Field(default=None, ge=0)
    #: IGNORED: the stored kind comes from the credential arm.
    rater_kind: RaterKind | None = None
    #: An AI rater's identity; ignored for an operator.
    model_id: str | None = Field(default=None, max_length=200)
    prompt_version: str | None = Field(default=None, max_length=200)


class RatingOut(_Out):
    id: UUID
    target_kind: JudgementTargetKind
    target_id: UUID
    dimension_key: str
    dimension_version: int
    score: int
    rater_kind: RaterKind
    rater_id: str
    context_page_id: UUID | None
    context_viewport: str | None
    confidence: Confidence | None
    positive_evidence: list[Any]
    negative_evidence: list[Any]
    explanation: str | None
    answer_ms: int | None
    created_at: datetime


class RatingDistribution(BaseModel):
    """Computed at READ time over each rater's latest row; never stored."""

    computed_at_read_time: Literal[True] = True
    dimension_key: str
    rater_kind: RaterKind | Literal["all"]
    n: int
    score_median: float | None
    score_spread: int | None


class RatingList(BaseModel):
    ratings: list[RatingOut]
    distributions: list[RatingDistribution]


class ComparisonCreate(_Strict):
    target_kind: JudgementTargetKind
    a_id: UUID
    b_id: UUID
    dimension_key: str = Field(min_length=1, max_length=64)
    winner: Winner
    explanation: str | None = Field(default=None, max_length=8000)
    shown_order: ShownOrder | None = None
    context_viewport: str | None = None
    trial_id: UUID | None = None
    answer_ms: int | None = Field(default=None, ge=0)
    rater_kind: RaterKind | None = None
    model_id: str | None = Field(default=None, max_length=200)
    prompt_version: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _distinct(self) -> ComparisonCreate:
        if self.a_id == self.b_id:
            raise ValueError("a comparison compares two different targets")
        return self


class ComparisonOut(_Out):
    id: UUID
    target_kind: JudgementTargetKind
    a_id: UUID
    b_id: UUID
    dimension_key: str
    dimension_version: int
    winner: Winner
    explanation: str | None
    rater_kind: RaterKind
    rater_id: str
    shown_order: ShownOrder | None
    context_viewport: str | None
    trial_id: UUID | None
    answer_ms: int | None
    created_at: datetime


class PersonalityCreate(_Strict):
    trait_key: str = Field(min_length=1, max_length=64)
    value: int = Field(ge=0, le=100)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    model_id: str | None = Field(default=None, max_length=200)
    prompt_version: str | None = Field(default=None, max_length=200)


class PersonalityConfirm(_Strict):
    """Confirm a proposed row, optionally with an edited value."""

    value: int | None = Field(default=None, ge=0, le=100)


class PersonalityOut(_Out):
    id: UUID
    site_id: UUID
    trait_key: str
    value: int
    rater_kind: RaterKind
    rater_id: str
    state: PersonalityState
    evidence: list[Any]
    created_at: datetime


class PrincipleScope(_Strict):
    industries: list[str] = Field(default_factory=list)
    page_types: list[str] = Field(default_factory=list)
    price_tiers: list[PriceTier] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    #: Personality traits the principle speaks to. Like ``dimensions``, a
    #: trait in a flagged correlation requires a counterexample at approval.
    traits: list[str] = Field(default_factory=list)


class PrincipleCreate(_Strict):
    statement: str = Field(min_length=1, max_length=4000)
    scope: PrincipleScope = Field(default_factory=PrincipleScope)


class EvidenceAttach(_Strict):
    role: EvidenceRole
    evidence_kind: EvidenceKind
    evidence_id: UUID


class PrincipleRetire(_Strict):
    reason: str = Field(min_length=1, max_length=2000)


class PrincipleEvidenceOut(_Out):
    principle_id: UUID
    role: EvidenceRole
    evidence_kind: EvidenceKind
    evidence_id: UUID
    site_ids: list[UUID]
    created_at: datetime


class PrincipleOut(_Out):
    id: UUID
    statement: str
    scope: dict[str, Any]
    status: PrincipleStatus
    proposed_by_kind: RaterKind
    proposed_by_id: str
    approved_by: UUID | None
    approved_at: datetime | None
    retired_reason: str | None
    created_at: datetime
    updated_at: datetime
    evidence: list[PrincipleEvidenceOut] = Field(default_factory=list)


class CorrelationOut(BaseModel):
    variable_kind: Literal["dimension", "trait"]
    key: str
    facet: str
    n: int
    r: float | None
    flagged: bool


class BalanceCell(BaseModel):
    style_family: str | None
    industry: str | None
    price_tier: PriceTier
    split: Split | None
    n: int


class CorpusBalance(BaseModel):
    cells: list[BalanceCell]
    correlations: list[CorrelationOut]


class JudgeBenchRunCreate(_Strict):
    model: str = Field(min_length=1, max_length=200)
    prompt_version: str = Field(min_length=1, max_length=200)
    n_pairs: int = Field(ge=0)
    pair_agreement: float | None = Field(default=None, ge=0, le=1)
    pair_agreement_ci_low: float | None = Field(default=None, ge=0, le=1)
    pair_agreement_ci_high: float | None = Field(default=None, ge=0, le=1)
    unknown_rate: float | None = Field(default=None, ge=0, le=1)
    rating_spearman: dict[str, float] = Field(default_factory=dict)
    krippendorff_alpha: float | None = None


class JudgeBenchRunOut(_Out):
    id: UUID
    model: str
    prompt_version: str
    n_pairs: int
    verdict: Literal["measured", "unknown"]
    pair_agreement: float | None
    pair_agreement_ci_low: float | None
    pair_agreement_ci_high: float | None
    unknown_rate: float | None
    rating_spearman: dict[str, Any]
    krippendorff_alpha: float | None
    created_at: datetime


# ═════════════════════════════ example read ═════════════════════════════


class ExampleOut(BaseModel):
    level: Level
    record: dict[str, Any]
    site: SiteOut
    labels: list[str]
    descriptions: list[DescriptionOut]
    captures: list[CaptureOut]
    components: list[ComponentOut]
    ratings: list[RatingOut]
    comparisons: list[ComparisonOut]
    personality: list[PersonalityOut]


# ═════════════════════════════ takedown ═════════════════════════════


class TakedownRequest(_Strict):
    """Either a whole domain (every tier) or one record."""

    domain: str | None = Field(default=None, min_length=1, max_length=253)
    target_kind: Literal["site", "page", "flow", "component"] | None = None
    target_id: UUID | None = None
    reason: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def _one_target(self) -> TakedownRequest:
        by_domain = self.domain is not None
        by_record = self.target_kind is not None or self.target_id is not None
        if by_domain == by_record:
            raise ValueError("send either domain, or target_kind with target_id")
        if by_record and (self.target_kind is None or self.target_id is None):
            raise ValueError("target_kind and target_id are sent together")
        return self


class TakedownResult(BaseModel):
    sites: int
    pages: int
    flows: int
    captures: int
    components: int
    descriptions: int
    ratings: int
    comparisons: int
    personality_rows: int
    evidence_rows: int
    corrections: int
    principles_reverted: list[UUID]
    blobs_deleted: int
    blobs_kept: int
    do_not_capture: list[str]


class DoNotCaptureOut(_Out):
    id: UUID
    domain: str
    path_prefix: str
    reason: str
    created_by: str
    created_at: datetime


# ═════════════════════════════ vocabularies ═════════════════════════════


class StyleFamilyOut(_Out):
    key: str
    label: str
    description: str | None
    active: bool


class DimensionOut(_Out):
    key: str
    pole_high: str
    pole_low: str
    anchors: dict[str, str]
    version: int
    active: bool


class TraitOut(_Out):
    key: str
    description: str
    version: int
    active: bool


class VocabOut(BaseModel):
    style_families: list[StyleFamilyOut]
    dimensions: list[DimensionOut]
    traits: list[TraitOut]


class StyleFamilyWrite(_Strict):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    label: str = Field(min_length=1, max_length=200)
    description: str | None = None
    active: bool = True


class DimensionWrite(_Strict):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    pole_high: str = Field(min_length=1, max_length=100)
    pole_low: str = Field(min_length=1, max_length=100)
    anchors: dict[Literal["1", "4", "7", "10"], str]
    active: bool = True

    @field_validator("anchors")
    @classmethod
    def _four_anchors(cls, value: dict[str, str]) -> dict[str, str]:
        if set(value) != {"1", "4", "7", "10"}:
            raise ValueError("anchors carries exactly the scores 1, 4, 7 and 10")
        return value


class TraitWrite(_Strict):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    description: str = Field(min_length=1, max_length=2000)
    active: bool = True
