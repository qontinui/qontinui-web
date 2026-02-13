// =============================================================================
// Error Monitor Types
// =============================================================================

export interface ErrorMonitorEntry {
  id: number;
  log_source_id: number | null;
  log_source_name: string;
  task_run_id: string | null;
  workflow_step_id: string | null;
  log_timestamp: string | null;
  captured_at: string;
  severity: string;
  error_type: string | null;
  error_code: string | null;
  message: string;
  stack_trace: string | null;
  context_lines: string | null;
  raw_entry: string | null;
  location: { file?: string; line?: number; column?: number } | null;
  signature_hash: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  finding_id: number | null;
  resolved_by_task_run_id: string | null;
  resolution_notes: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
}
