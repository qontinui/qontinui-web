// =============================================================================
// Hooks Configuration Types
// =============================================================================

export type HookTrigger =
  | "pre_execution"
  | "post_execution"
  | "on_error"
  | "on_verification_fail"
  | "on_complete"
  | "pre_iteration"
  | "post_iteration";

export type HookActionType = "command" | "webhook" | "log" | "notification";

export interface HookCondition {
  variable: string;
  operator: string;
  value: unknown;
}

export interface Hook {
  id: string;
  name: string;
  description?: string;
  trigger: HookTrigger;
  action_type: HookActionType;
  action_config: Record<string, unknown>;
  enabled: boolean;
  execution_order: number;
  continue_on_failure: boolean;
  conditions: HookCondition[];
  task_run_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateHookRequest {
  name: string;
  description?: string;
  trigger: HookTrigger;
  action_type: HookActionType;
  action_config: Record<string, unknown>;
  enabled?: boolean;
  execution_order?: number;
  continue_on_failure?: boolean;
  conditions?: HookCondition[];
}

export interface UpdateHookRequest {
  name?: string;
  description?: string | null;
  trigger?: HookTrigger;
  action_type?: HookActionType;
  action_config?: Record<string, unknown>;
  enabled?: boolean;
  execution_order?: number;
  continue_on_failure?: boolean;
  conditions?: HookCondition[];
}

export interface TestHookResponse {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms: number;
}
