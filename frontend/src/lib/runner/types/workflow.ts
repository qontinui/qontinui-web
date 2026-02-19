// =============================================================================
// Workflow Types
// =============================================================================

import type { UnifiedWorkflow } from "@/types/unified-workflow";

export type { UnifiedWorkflow } from "@/types/unified-workflow";

/** Record of a single discovery tool execution during workflow generation. */
export interface DiscoveryCall {
  tool_name: string;
  input_summary: string;
  success: boolean;
  duration_ms: number;
}

export interface GenerateWorkflowRequest {
  description: string;
  category?: string;
  tags?: string[];
  context_ids?: string[];
  inline_context?: string;
  max_iterations?: number;
  provider?: string;
  model?: string;
  skip_ai_summary?: boolean;
  auto_include_contexts?: boolean;
  /** Maximum verification->fix iterations (default: 3, 0 = skip verification) */
  max_fix_iterations?: number;
  /** Generation mode: "standard" (default) or "plan" */
  generation_mode?: "standard" | "plan";
  /** Discovery mode: "auto" (default), "enabled" (always), "disabled" (never) */
  discovery_mode?: "auto" | "enabled" | "disabled";
}

/** One pass of the verification->fix loop during workflow generation. */
export interface VerificationIteration {
  /** 1-based iteration number */
  iteration: number;
  /** Issues found by the verification agent */
  issues: string[];
  /** Whether the fixer agent was invoked */
  fix_applied: boolean;
  /** Error message if the fixer agent failed */
  fix_error?: string;
}

export interface GenerateWorkflowResponse {
  workflow: UnifiedWorkflow | null;
  validation_errors: string[];
  success: boolean;
  error: string | null;
  model_used: string | null;
  /** Details of each verification->fix iteration (empty when skipped) */
  verification_iterations?: VerificationIteration[];
  /** Discovery tool calls made during generation */
  discovery_calls?: DiscoveryCall[];
}

/** Response from async workflow generation */
export interface GenerateWorkflowAsyncResponse {
  task_run_id: string;
  meta_workflow_id: string;
}

export interface CreateContextFromFileRequest {
  file_path: string;
  name?: string;
  category?: string;
  tags?: string[];
}
