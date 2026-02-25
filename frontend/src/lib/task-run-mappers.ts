/**
 * Normalizes task run data from both Runner API and Backend API
 * into a common TaskRunView type for use in the frontend.
 */

import type { TaskRun as RunnerTaskRun } from "@/lib/runner/types/task-run";

// =============================================================================
// Unified View Types
// =============================================================================

export interface TaskRunView {
  id: string;
  task_name: string;
  prompt?: string | null;
  task_type?: string;
  status: string;
  sessions_count?: number;
  max_sessions?: number | null;
  auto_continue?: boolean;
  output_summary?: string | null;
  workflow_name?: string | null;
  workflow_type?: string | null;
  phase?: string | null;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  duration_seconds?: number | null;
  goal_achieved?: boolean | null;
  remaining_work?: string | null;
  summary?: string | null;
  error_message?: string | null;
  iteration_count?: number | null;
  /** Source of this data - "runner" for live data, "backend" for PostgreSQL */
  _source: "runner" | "backend";
  /** Whether this task is currently running (live from runner) */
  _isLive: boolean;
}

export interface FindingView {
  id: string;
  task_run_id: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  file_path?: string | null;
  line_number?: number | null;
  created_at: string;
}

export interface FindingsSummaryView {
  total: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  recent: FindingView[];
}

// =============================================================================
// Backend API Response Types (matching backend schemas)
// =============================================================================

export interface BackendTaskRunResponse {
  id: string;
  project_id: string | null;
  created_by_user_id: string | null;
  runner_id: string | null;
  task_name: string;
  prompt: string | null;
  task_type: string;
  config_id: string | null;
  workflow_name: string | null;
  status: string;
  sessions_count: number;
  max_sessions: number | null;
  auto_continue: boolean;
  output_summary: string | null;
  summary: string | null;
  goal_achieved: boolean | null;
  remaining_work: string | null;
  full_output_stored: boolean;
  error_message: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface BackendTaskRunListResponse {
  task_runs: BackendTaskRunResponse[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface BackendFindingResponse {
  id: string;
  task_run_id: string;
  category: string;
  severity: string;
  status: string;
  action_type: string;
  signature_hash: string | null;
  title: string;
  description: string;
  resolution: string | null;
  file_path: string | null;
  line_number: number | null;
  column_number: number | null;
  code_snippet: string | null;
  detected_in_session: number;
  resolved_in_session: number | null;
  needs_input: boolean;
  question: string | null;
  input_options: string[] | null;
  user_response: string | null;
  detected_at: string;
  resolved_at: string | null;
  updated_at: string;
}

export interface BackendFindingsSummaryResponse {
  total: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  recent: BackendFindingResponse[];
}

// =============================================================================
// Mappers
// =============================================================================

/** Normalize a Runner API TaskRun to TaskRunView */
export function mapRunnerTaskRun(run: RunnerTaskRun): TaskRunView {
  return {
    id: run.id,
    task_name: run.task_name,
    prompt: run.prompt ?? null,
    task_type: run.task_type ?? run.workflow_type,
    status: run.status,
    sessions_count: run.sessions_count,
    max_sessions: run.max_sessions ?? null,
    auto_continue: run.auto_continue,
    output_summary: run.output_log ?? null,
    workflow_name: run.workflow_name ?? null,
    workflow_type: run.workflow_type ?? null,
    phase: run.phase ?? null,
    created_at: run.created_at,
    updated_at: run.updated_at,
    completed_at: run.completed_at ?? null,
    duration_seconds: run.duration_seconds ?? null,
    goal_achieved: run.goal_achieved ?? null,
    remaining_work: run.remaining_work ?? null,
    summary: run.summary ?? run.ai_summary ?? null,
    error_message: null,
    iteration_count: run.iteration_count ?? null,
    _source: "runner",
    _isLive: run.status === "running",
  };
}

/** Normalize a Backend API TaskRunResponse to TaskRunView */
export function mapBackendTaskRun(run: BackendTaskRunResponse): TaskRunView {
  return {
    id: run.id,
    task_name: run.task_name,
    prompt: run.prompt,
    task_type: run.task_type,
    status: normalizeBackendStatus(run.status),
    sessions_count: run.sessions_count,
    max_sessions: run.max_sessions,
    auto_continue: run.auto_continue,
    output_summary: run.output_summary,
    workflow_name: run.workflow_name,
    workflow_type: null,
    phase: null,
    created_at: run.created_at,
    updated_at: run.updated_at,
    completed_at: run.completed_at,
    duration_seconds: run.duration_seconds,
    goal_achieved: run.goal_achieved,
    remaining_work: run.remaining_work,
    summary: run.summary,
    error_message: run.error_message,
    iteration_count: null, // Backend doesn't track iteration count yet
    _source: "backend",
    _isLive: false,
  };
}

/** Normalize a Backend finding to FindingView */
export function mapBackendFinding(
  finding: BackendFindingResponse
): FindingView {
  return {
    id: finding.id,
    task_run_id: finding.task_run_id,
    category: finding.category,
    severity: finding.severity,
    status: finding.status,
    title: finding.title,
    description: finding.description,
    file_path: finding.file_path,
    line_number: finding.line_number,
    created_at: finding.detected_at,
  };
}

/**
 * Normalize backend status values.
 * Backend uses "complete" while runner uses "completed".
 */
function normalizeBackendStatus(status: string): string {
  if (status === "complete") return "completed";
  return status;
}

/**
 * Merge backend task runs with live runner task runs.
 * Runner data takes priority for running tasks (by ID match).
 * Returns deduplicated, sorted list.
 */
export function mergeTaskRunSources(
  backendRuns: BackendTaskRunResponse[],
  runnerRuns: RunnerTaskRun[] | null | undefined
): TaskRunView[] {
  const backendMap = new Map<string, TaskRunView>();

  // Add all backend runs
  for (const run of backendRuns) {
    backendMap.set(run.id, mapBackendTaskRun(run));
  }

  // Overlay runner runs (they have live data)
  if (runnerRuns) {
    for (const run of runnerRuns) {
      backendMap.set(run.id, mapRunnerTaskRun(run));
    }
  }

  // Sort by created_at descending
  return Array.from(backendMap.values()).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
