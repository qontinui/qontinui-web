// =============================================================================
// Execution Types
// =============================================================================

export interface PlanPhaseInput {
  name: string;
  prompt: string;
}

export interface ExecutePlanRequest {
  plan_name: string;
  plan_overview: string;
  phases: PlanPhaseInput[];
  next_steps_sweep: boolean;
  max_next_steps_iterations: number;
  timeout_seconds?: number | null;
}

export interface ShellCommand {
  id: string;
  name: string;
  command: string;
  working_directory?: string;
  timeout_seconds?: number;
  description?: string;
  category?: string;
  tags?: string[];
  fail_on_error?: boolean;
  enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}
