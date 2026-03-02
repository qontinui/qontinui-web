import type { Workflow } from "@/lib/action-schema/action-types";

export interface TestRunSummary {
  id: string;
  run_name: string;
  status: string;
  started_at: string;
  ended_at?: string;
  workflow_name?: string;
}

export interface HistoricalResult {
  id: number;
  sequence_number: number | null;
  pattern_id: string | null;
  pattern_name: string | null;
  action_type: string;
  active_states: string[] | null;
  success: boolean;
  match_x: number | null;
  match_y: number | null;
  match_width: number | null;
  match_height: number | null;
}

export type WorkflowWithProject = Workflow & { projectName?: string };
