/**
 * The wire contract of `GET /api/v1/overview/objectives` — `ObjectivesRead`
 * and its parts, mirrored from `backend/app/overview/objectives_models.py`
 * (plan `2026-10-06-overview-objectives-view` D3). The server does every join
 * and every YAML parse; the browser only presents what it is given.
 *
 * Hand-mirrored, like the overview's other derived reads (`timeline-api.ts`,
 * `estimate-api.ts`): overview routes are not in the generated-types set.
 */

import { httpClient } from "@/services/service-factory";
import { OVERVIEW_API } from "@/components/overview/editing/api";

export const OBJECTIVES_URL = `${OVERVIEW_API}/objectives`;

export type IntentDocState = "authored" | "skeleton" | "unknown" | "unreadable";
export type SourceQueryType =
  | "named"
  | "http"
  | "manual"
  | "untyped"
  | "absent";
export type SourceStatus = "ok" | "degraded" | "unavailable" | "truncated";
export type Verdict = "met" | "missed" | "unknown";
export type ReportShape = "structured" | "prose_only" | "unreadable_block";
export type PlacedBy = "block" | "results" | "checkpoint_key";
export type CheckpointStatus =
  | "reported"
  | "reported_prose_only"
  | "reported_unreadable"
  | "awaiting"
  | "no_report_found"
  | "possible_report_unrecorded"
  | "unreadable"
  | "not_fully_read";
export type FindingsReadState = "ok" | "truncated" | "unavailable" | "not_read";
export type UnresolvedReason =
  | "superseded_or_missing"
  | "read_failed"
  | "not_read_over_limit"
  | "invalid_id";

export interface SourceRead {
  status: SourceStatus;
  reason: string | null;
  affected: string[];
  details: Record<string, string>;
}

export interface ObjectivesSources {
  intent_documents: SourceRead;
  findings: SourceRead;
  findings_by_id: SourceRead;
}

export interface ObjectiveRead {
  id: string;
  text: string;
  metric_names: string[];
}

export interface InitiativeRead {
  name: string;
  title: string;
  state: IntentDocState;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
  error: string | null;
  status: string | null;
  live: boolean;
  starts: string | null;
  ends: string | null;
  objectives: ObjectiveRead[];
  success_metrics: string[];
  missing_metric_names: string[];
  frontmatter_error: string | null;
  field_errors: Record<string, string>;
  frontmatter_warnings: string[];
}

export interface CheckpointDeclRead {
  id: string;
  due: string | null;
  label: string | null;
}

export interface CriterionDeclRead {
  id: string;
  checkpoint: string | null;
  target: string | null;
  method: string | null;
}

export interface ResultEntryRead {
  checkpoint: string | null;
  finding_id: string | null;
  posted_at: string | null;
}

export interface ExtraFieldRead {
  key: string;
  text: string;
}

export interface ResultRowRead {
  id: string;
  verdict: Verdict;
  value: number | null;
  unit: string | null;
  value_text: string | null;
  method: string | null;
  door: string | null;
  window: { from: string; to: string } | null;
  unknown_reason: string | null;
  cause: string | null;
  action: { kind: string; ref: string } | null;
  /** False: not one of the document's criteria — shown, flagged, not counted. */
  declared: boolean;
}

export interface ReportRead {
  finding_id: string;
  title: string | null;
  topic: string | null;
  body: string | null;
  created_at: string | null;
  expires_at: string | null;
  checkpoint: string;
  placed_by: PlacedBy[];
  checkpoint_mismatch: string | null;
  shape: ReportShape;
  block_error: string | null;
  block_warnings: string[];
  measured_at: string | null;
  document_version: number | null;
  gate_id: string | null;
  rows: ResultRowRead[];
  recorded: boolean;
}

export interface TallyRead {
  met: number;
  missed: number;
  unknown: number;
}

export interface LaterReportNotice {
  finding_id: string;
  checkpoint: string;
  created_at: string | null;
  shape: ReportShape;
}

export interface EarlierVerdictRead {
  checkpoint: string;
  verdict: Verdict;
  measured_at: string | null;
  finding_id: string;
}

export interface CriterionResultRead {
  id: string;
  checkpoint: string | null;
  target: string | null;
  method: string | null;
  verdict: Verdict;
  unknown_reason: string | null;
  row: ResultRowRead | null;
  measured_at: string | null;
  reported_checkpoint: string | null;
  finding_id: string | null;
  earlier: EarlierVerdictRead[];
  out_of_date_notice: LaterReportNotice | null;
}

export interface UnresolvedResultRead {
  checkpoint: string | null;
  finding_id: string | null;
  reason: UnresolvedReason;
  detail: string;
}

export interface CheckpointResultRead {
  id: string;
  due: string | null;
  label: string | null;
  declared: boolean;
  window_closes_at: string | null;
  status: CheckpointStatus;
  status_reason: string | null;
  report: ReportRead | null;
  history: ReportRead[];
  criteria: CriterionResultRead[];
  tally: TallyRead;
  unresolved_results: UnresolvedResultRead[];
}

export interface RelatedNoteRead {
  finding_id: string;
  title: string | null;
  topic: string | null;
  created_at: string | null;
  possible_report_for: string | null;
  note: string | null;
}

export interface CurrentValueRead {
  status: "not_measured";
  source_query_type: SourceQueryType;
  reason: string;
}

export interface MetricRead {
  name: string;
  title: string;
  state: IntentDocState;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
  overview_order: number | null;
  body: string;
  error: string | null;
  frontmatter_error: string | null;
  field_errors: Record<string, string>;
  frontmatter_warnings: string[];
  metric: string | null;
  unit: string | null;
  baseline: number | null;
  baseline_text: string | null;
  baseline_as_of: string | null;
  target: number | null;
  target_text: string | null;
  ceiling: number | null;
  ceiling_text: string | null;
  floor: number | null;
  floor_text: string | null;
  direction: "increase" | "decrease" | null;
  direction_text: string | null;
  serves: string[];
  serves_unknown: string[];
  report_topic: string | null;
  structured_reporting_since: string | null;
  source_query_type: SourceQueryType;
  checkpoints: CheckpointDeclRead[];
  checkpoints_text: string | null;
  criteria: CriterionDeclRead[];
  results: ResultEntryRead[];
  extra_fields: ExtraFieldRead[];
  findings_read: FindingsReadState;
  checkpoint_results: CheckpointResultRead[];
  criteria_latest: CriterionResultRead[];
  tally_latest: TallyRead;
  related_notes: RelatedNoteRead[];
  current_value: CurrentValueRead;
}

export interface ObjectivesRead {
  tenant_id: string;
  generated_at: string;
  initiatives: InitiativeRead[];
  earlier_initiatives_count: number;
  objectives_readable: boolean;
  metrics: MetricRead[];
  initiative_named_metrics: string[];
  other_metrics: string[];
  skeletons_hidden: number;
  void_hidden: number;
  sources: ObjectivesSources;
}

export function fetchObjectives(): Promise<ObjectivesRead> {
  return httpClient.get<ObjectivesRead>(OBJECTIVES_URL);
}
