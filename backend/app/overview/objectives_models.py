"""The ``GET /objectives`` wire contract — :class:`ObjectivesRead` and its parts.

Plan ``2026-10-06-overview-objectives-view`` D3. Built by
:mod:`app.overview.objectives`; the overview's Objectives page and the Summary's
compact metric list are its clients.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.overview.intent_documents import (
    IntentState,
)

SourceQueryType = Literal["named", "http", "manual", "untyped", "absent"]
SourceStatus = Literal["ok", "degraded", "unavailable", "truncated"]
Verdict = Literal["met", "missed", "unknown"]
ReportShape = Literal["structured", "prose_only", "unreadable_block"]
PlacedBy = Literal["block", "results", "checkpoint_key"]
CheckpointStatus = Literal[
    "reported",
    "reported_prose_only",
    "reported_unreadable",
    "awaiting",
    "no_report_found",
    "possible_report_unrecorded",
    "unreadable",
    "not_fully_read",
]
FindingsReadState = Literal["ok", "truncated", "unavailable", "not_read"]
UnresolvedReason = Literal[
    "superseded_or_missing", "read_failed", "not_read_over_limit", "invalid_id"
]


# ===========================================================================
# Wire shapes — the ObjectivesRead contract
# ===========================================================================


class SourceRead(BaseModel):
    """One upstream read and whether it was complete."""

    status: SourceStatus
    #: Plain words; ``None`` only when ``status`` is ``ok``.
    reason: str | None = None
    #: The metric names (or finding ids) the status is about.
    affected: list[str] = Field(default_factory=list)
    #: ``affected`` entry → what happened to it.
    details: dict[str, str] = Field(default_factory=dict)


class ObjectivesSources(BaseModel):
    intent_documents: SourceRead
    #: The per-metric findings list reads.
    findings: SourceRead
    #: The by-id reads of the ids metric documents record in ``results:``.
    findings_by_id: SourceRead


class ObjectiveRead(BaseModel):
    """One ``in_scope`` item of an initiative."""

    id: str
    text: str
    #: The shown metrics whose ``serves:`` names this id. Empty means "No
    #: measure declared for this objective yet", never a blank group.
    metric_names: list[str]


class InitiativeRead(BaseModel):
    name: str
    title: str
    state: IntentState
    version: int
    updated_at: datetime | None
    updated_by: str | None
    #: The body could not be read (``state == "unreadable"``).
    error: str | None = None
    #: Frontmatter ``status``; only ``live`` initiatives are shown by default.
    status: str | None = None
    live: bool = False
    starts: str | None = None
    ends: str | None = None
    objectives: list[ObjectiveRead] = Field(default_factory=list)
    #: The initiative's own ``success_metrics:`` list.
    success_metrics: list[str] = Field(default_factory=list)
    #: Names in ``success_metrics`` with no shown metric document.
    missing_metric_names: list[str] = Field(default_factory=list)
    frontmatter_error: str | None = None
    field_errors: dict[str, str] = Field(default_factory=dict)
    frontmatter_warnings: list[str] = Field(default_factory=list)


class CheckpointDeclRead(BaseModel):
    id: str
    #: ISO date, as declared.
    due: str | None
    label: str | None


class CriterionDeclRead(BaseModel):
    id: str
    checkpoint: str | None
    target: str | None
    #: The document's "Measured by" text; internal vocabulary — the page
    #: shows it only inside the "How this was measured" disclosure.
    method: str | None


class ResultEntryRead(BaseModel):
    """One entry of the document's ``results:`` list."""

    checkpoint: str | None
    finding_id: str | None
    posted_at: str | None


class ExtraFieldRead(BaseModel):
    key: str
    text: str


class WindowRead(BaseModel):
    from_: str = Field(alias="from")
    to: str

    model_config = {"populate_by_name": True, "serialize_by_alias": True}


class ActionRead(BaseModel):
    kind: str
    ref: str


class ResultRowRead(BaseModel):
    """One row of a valid ``metric-checkpoint/v1`` block, as stated."""

    id: str
    verdict: Verdict
    value: float | None = None
    unit: str | None = None
    value_text: str | None = None
    method: str | None = None
    door: str | None = None
    window: WindowRead | None = None
    unknown_reason: str | None = None
    cause: str | None = None
    action: ActionRead | None = None
    #: False: the id is not one of the document's criteria — shown under its
    #: report, flagged "not in the document's list", never counted toward any
    #: declared criterion's verdict, and named in the report's
    #: ``block_warnings`` (D5; the block stays readable).
    declared: bool = True


class ReportRead(BaseModel):
    """A finding placed as a checkpoint report (D6 point 2)."""

    finding_id: str
    title: str | None
    topic: str | None
    #: The human report, rendered inline by the page.
    body: str | None
    created_at: str | None
    expires_at: str | None
    checkpoint: str
    #: Which rule placed it: (a) the block, (b) the ``results:`` list, (c)
    #: ``report_topic`` plus exactly one checkpoint-id resource key.
    placed_by: list[PlacedBy]
    #: Set when the rules disagreed about the checkpoint: (a) wins, then (b).
    checkpoint_mismatch: str | None = None
    shape: ReportShape
    #: Why the block could not be read (``unreadable_block`` only).
    block_error: str | None = None
    block_warnings: list[str] = Field(default_factory=list)
    measured_at: str | None = None
    document_version: int | None = None
    gate_id: str | None = None
    #: The block's rows, ``structured`` reports only.
    rows: list[ResultRowRead] = Field(default_factory=list)
    #: Its id is in the document's ``results:`` list.
    recorded: bool = False


class TallyRead(BaseModel):
    met: int = 0
    missed: int = 0
    unknown: int = 0


class LaterReportNotice(BaseModel):
    """D7: a later report exists without readable rows, so this verdict may be
    out of date."""

    finding_id: str
    checkpoint: str
    created_at: str | None
    shape: ReportShape


class EarlierVerdictRead(BaseModel):
    checkpoint: str
    verdict: Verdict
    measured_at: str | None
    finding_id: str


class CriterionResultRead(BaseModel):
    """One declared criterion and the verdict shown for it."""

    id: str
    checkpoint: str | None
    target: str | None
    method: str | None
    verdict: Verdict
    #: For ``unknown``: the row's own reason (``could_not_run`` …) or one of
    #: ``not_reported``, ``results_not_fully_read``, ``results_unreadable``,
    #: ``reported_prose_only``, ``report_unreadable``.
    unknown_reason: str | None = None
    row: ResultRowRead | None = None
    measured_at: str | None = None
    #: The checkpoint whose report carried the shown row.
    reported_checkpoint: str | None = None
    finding_id: str | None = None
    #: Verdicts the shown one superseded (latest wins, D7).
    earlier: list[EarlierVerdictRead] = Field(default_factory=list)
    out_of_date_notice: LaterReportNotice | None = None


class UnresolvedResultRead(BaseModel):
    """A ``results:`` entry whose finding could not be shown."""

    checkpoint: str | None
    finding_id: str | None
    reason: UnresolvedReason
    detail: str


class CheckpointResultRead(BaseModel):
    id: str
    due: str | None
    label: str | None
    #: False: named by a report or a ``results:`` entry, not by the document.
    declared: bool
    #: When "awaiting" stops: the end of the due day plus 24 h, UTC.
    window_closes_at: datetime | None
    status: CheckpointStatus
    status_reason: str | None = None
    report: ReportRead | None = None
    #: Other live reports for this checkpoint, newest first.
    history: list[ReportRead] = Field(default_factory=list)
    #: This checkpoint's declared criteria, as ITS report stated them.
    criteria: list[CriterionResultRead] = Field(default_factory=list)
    tally: TallyRead = Field(default_factory=TallyRead)
    unresolved_results: list[UnresolvedResultRead] = Field(default_factory=list)


class RelatedNoteRead(BaseModel):
    """A finding at the metric's key that is not a report."""

    finding_id: str
    title: str | None
    topic: str | None
    created_at: str | None
    #: It matches the late-path report predicate for this checkpoint but is
    #: not recorded: "a possible report, not yet recorded".
    possible_report_for: str | None = None
    note: str | None = None


class CurrentValueRead(BaseModel):
    """D8. Until coord runs metrics, always ``not_measured`` with a reason."""

    status: Literal["not_measured"] = "not_measured"
    source_query_type: SourceQueryType
    reason: str


class MetricRead(BaseModel):
    name: str
    title: str
    state: IntentState
    version: int
    updated_at: datetime | None
    updated_by: str | None
    overview_order: int | None
    #: The prose (frontmatter removed). The page keeps it inside a collapsed
    #: "Full document" disclosure.
    body: str
    error: str | None = None

    frontmatter_error: str | None = None
    field_errors: dict[str, str] = Field(default_factory=dict)
    frontmatter_warnings: list[str] = Field(default_factory=list)

    metric: str | None = None
    unit: str | None = None
    baseline: float | None = None
    baseline_text: str | None = None
    baseline_as_of: str | None = None
    target: float | None = None
    target_text: str | None = None
    ceiling: float | None = None
    ceiling_text: str | None = None
    floor: float | None = None
    floor_text: str | None = None
    direction: Literal["increase", "decrease"] | None = None
    direction_text: str | None = None
    serves: list[str] = Field(default_factory=list)
    #: ``serves:`` ids no initiative declares.
    serves_unknown: list[str] = Field(default_factory=list)
    report_topic: str | None = None
    structured_reporting_since: str | None = None
    source_query_type: SourceQueryType = "absent"
    checkpoints: list[CheckpointDeclRead] = Field(default_factory=list)
    #: A legacy free-string ``checkpoints:``, shown as text.
    checkpoints_text: str | None = None
    criteria: list[CriterionDeclRead] = Field(default_factory=list)
    results: list[ResultEntryRead] = Field(default_factory=list)
    extra_fields: list[ExtraFieldRead] = Field(default_factory=list)

    findings_read: FindingsReadState = "not_read"
    checkpoint_results: list[CheckpointResultRead] = Field(default_factory=list)
    #: Every declared criterion, latest verdict wins (D7).
    criteria_latest: list[CriterionResultRead] = Field(default_factory=list)
    tally_latest: TallyRead = Field(default_factory=TallyRead)
    related_notes: list[RelatedNoteRead] = Field(default_factory=list)
    #: ``results:`` entries that name no checkpoint and whose finding could
    #: not be shown — no checkpoint row can carry them, so the card does.
    unresolved_results: list[UnresolvedResultRead] = Field(default_factory=list)
    current_value: CurrentValueRead


class ObjectivesRead(BaseModel):
    tenant_id: UUID
    generated_at: datetime
    #: Live initiatives first; the others belong under "Earlier and other
    #: initiatives".
    initiatives: list[InitiativeRead]
    earlier_initiatives_count: int
    #: False: "The project's objectives can't be read" (reason in
    #: ``sources.intent_documents``) — never an empty objectives list.
    objectives_readable: bool
    metrics: list[MetricRead]
    #: Metrics a live initiative's ``success_metrics`` names that serve none
    #: of its objectives.
    initiative_named_metrics: list[str]
    #: Every other shown metric.
    other_metrics: list[str]
    skeletons_hidden: int
    #: Documents marked ``mispublished: true``: published to the wrong project.
    void_hidden: int
    sources: ObjectivesSources
