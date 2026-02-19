/**
 * Unified Workflow Types
 *
 * Type definitions for the unified Workflow Builder system.
 * All automation is organized into four phases: Setup, Verification, Agentic, Completion.
 *
 * Execution Order:
 *   Setup (once) -> [Verification <-> Agentic]* -> Completion (once)
 *
 * The Verification/Agentic loop continues until all required checks pass or max iterations.
 * Setup and Completion run exactly once - at the beginning and end respectively.
 *
 * Step Types (4 core types):
 *   command  - Shell commands, checks, check groups
 *   test     - Verification tests (playwright, vision, python, repository, custom)
 *   ui_bridge - UI Bridge SDK interactions (navigate, execute, assert, snapshot)
 *   prompt   - AI task instructions
 *
 * Ported from qontinui-runner/src/types/unified-workflow.ts
 */

// =============================================================================
// Phases
// =============================================================================

export type WorkflowPhase = "setup" | "verification" | "agentic" | "completion";

// =============================================================================
// Log Source Selection
// =============================================================================

export type LogSourceSelection =
  | "default"
  | "ai"
  | "all"
  | { profile_id: string };

// =============================================================================
// Health Check Configuration
// =============================================================================

export interface HealthCheckUrl {
  name: string;
  url: string;
  expected_status?: number;
  timeout_seconds?: number;
  is_critical?: boolean;
}

// =============================================================================
// Step Types
// =============================================================================

export interface BaseStep {
  id: string;
  name: string;
  fail_on_console_errors?: boolean;
  inputs?: Record<string, string>;
  extract?: Record<string, string>;
  depends_on?: string[];
  required?: boolean;
  retry?: { count: number; delay_ms: number };
}

// -----------------------------------------------------------------------------
// API Request Builder Types (used by the API request builder tab, not workflow steps)
// -----------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiContentType =
  | "application/json"
  | "application/x-www-form-urlencoded"
  | "text/plain"
  | "none";

export interface ApiVariableExtraction {
  variable_name: string;
  json_path: string;
  default_value?: string;
}

export interface ApiAssertion {
  type:
    | "status_code"
    | "json_path"
    | "header"
    | "body_contains"
    | "response_time";
  expected: string | number;
  json_path?: string;
  header_name?: string;
  operator?: "equals" | "contains" | "matches" | "greater_than" | "less_than";
}

// -----------------------------------------------------------------------------
// Test Steps
// -----------------------------------------------------------------------------

export type TestType =
  | "playwright"
  | "qontinui_vision"
  | "python"
  | "repository"
  | "custom_command";

export type PlaywrightExecutionMode = "independent" | "chained";

export interface TestStep extends BaseStep {
  type: "test";
  phase: "setup" | "verification" | "completion";
  test_type: TestType;
  command?: string;
  working_directory?: string;
  code?: string;
  test_id?: string;
  timeout_seconds?: number;
  description?: string;
  script_id?: string;
  script_content?: string;
  target_url?: string;
  fused_script_id?: string;
  execution_mode?: PlaywrightExecutionMode;
}

// -----------------------------------------------------------------------------
// Check Types (used by command steps)
// -----------------------------------------------------------------------------

export type CheckType =
  | "lint"
  | "format"
  | "typecheck"
  | "analyze"
  | "security"
  | "custom_command"
  | "http_status"
  | "ai_review"
  | "ci_cd";

// -----------------------------------------------------------------------------
// Command Steps (unified: shell_command + check + check_group)
// -----------------------------------------------------------------------------

export interface CommandStep extends BaseStep {
  type: "command";
  phase: "setup" | "verification" | "completion";
  command?: string;
  working_directory?: string;
  timeout_seconds?: number;
  fail_on_error?: boolean;
  run_on_subsequent_iterations?: boolean;
  shell_command_id?: string;

  // Check-specific fields (when check_type is set)
  check_type?: CheckType;
  tool?: string;
  check_id?: string;
  config_path?: string;
  auto_fix?: boolean;
  fail_on_warning?: boolean;
  repository?: string;
  workflow_name?: string;
  branch?: string;
  wait_for_completion?: boolean;

  // Check group fields (when check_group_id is set)
  check_group_id?: string;
}

// -----------------------------------------------------------------------------
// Prompt Steps
// -----------------------------------------------------------------------------

export interface PromptStep extends BaseStep {
  type: "prompt";
  phase: "setup" | "verification" | "agentic" | "completion";
  content: string;
  prompt_id?: string;
  provider?: string;
  model?: string;
  is_summary_step?: boolean;
}

// -----------------------------------------------------------------------------
// UI Bridge Steps
// -----------------------------------------------------------------------------

export interface UiBridgeStep extends BaseStep {
  type: "ui_bridge";
  phase: "setup" | "verification" | "completion";
  action: "navigate" | "execute" | "assert" | "snapshot";
  url?: string;
  instruction?: string;
  target?: string;
  assert_type?: "exists" | "text_equals" | "contains" | "visible" | "enabled";
  expected?: string;
  timeout_ms?: number;
}

// =============================================================================
// Step Type Names
// =============================================================================

export type StepTypeName = "command" | "test" | "ui_bridge" | "prompt";

// =============================================================================
// Unified Step Type
// =============================================================================

export type UnifiedStep = CommandStep | PromptStep | TestStep | UiBridgeStep;

export type SetupStep = CommandStep | PromptStep | TestStep | UiBridgeStep;

export type VerificationStep =
  | CommandStep
  | PromptStep
  | TestStep
  | UiBridgeStep;

export type AgenticStep = PromptStep;

export type CompletionStep = CommandStep | PromptStep | TestStep | UiBridgeStep;

// =============================================================================
// Workflow
// =============================================================================

export interface UnifiedWorkflow {
  id: string;
  name: string;
  description: string;
  setup_steps: SetupStep[];
  verification_steps: VerificationStep[];
  agentic_steps: AgenticStep[];
  completion_steps: CompletionStep[];
  max_iterations?: number;
  timeout_seconds?: number | null;
  provider?: string;
  model?: string;
  log_source_selection?: LogSourceSelection;
  context_ids?: string[];
  disabled_context_ids?: string[];
  auto_include_contexts?: boolean;
  skip_ai_summary?: boolean;
  log_watch_enabled?: boolean;
  health_check_enabled?: boolean;
  health_check_urls?: HealthCheckUrl[];
  prompt_template?: string | null;
  category: string;
  tags: string[];
  created_at: string;
  modified_at: string;
}

// =============================================================================
// Feature Detection
// =============================================================================

export interface WorkflowFeatures {
  hasSetup: boolean;
  hasVerification: boolean;
  hasAgentic: boolean;
  hasCompletion: boolean;
  hasUiBridge: boolean;
  showIterationSettings: boolean;
  hasAiPrompts: boolean;
}

export function detectWorkflowFeatures(
  workflow: UnifiedWorkflow,
): WorkflowFeatures {
  const allSteps: UnifiedStep[] = [
    ...workflow.setup_steps,
    ...workflow.verification_steps,
    ...workflow.agentic_steps,
    ...(workflow.completion_steps ?? []),
  ];

  const hasSetup = workflow.setup_steps.length > 0;
  const hasVerification = workflow.verification_steps.length > 0;
  const hasAgentic = workflow.agentic_steps.length > 0;
  const hasCompletion = (workflow.completion_steps ?? []).length > 0;

  const hasUiBridge = allSteps.some((s) => s.type === "ui_bridge");
  const hasAiPrompts = allSteps.some((s) => s.type === "prompt");

  return {
    hasSetup,
    hasVerification,
    hasAgentic,
    hasCompletion,
    hasUiBridge,
    showIterationSettings: hasAgentic,
    hasAiPrompts,
  };
}

// =============================================================================
// Step Type Constants
// =============================================================================

export interface StepTypeInfo {
  type: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  phase: WorkflowPhase | "setup" | "verification";
}

/**
 * Fetch step types from the backend API, which in turn syncs from the runner.
 * Returns null on failure so callers can fall back to STEP_TYPES.
 */
export async function fetchStepTypes(): Promise<Record<
  WorkflowPhase,
  StepTypeInfo[]
> | null> {
  try {
    const API_BASE_URL =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const response = await fetch(
      `${API_BASE_URL}/api/v1/workflow-config/step-types`,
      { credentials: "include" },
    );
    if (!response.ok) return null;

    const data = await response.json();
    const items: Array<{
      step_type: string;
      phase: WorkflowPhase;
      label: string;
      description: string;
      icon: string;
      color: string;
      enabled: boolean;
    }> = data.items ?? [];

    const result: Record<WorkflowPhase, StepTypeInfo[]> = {
      setup: [],
      verification: [],
      agentic: [],
      completion: [],
    };

    for (const item of items) {
      if (!item.enabled) continue;
      result[item.phase]?.push({
        type: item.step_type,
        label: item.label,
        description: item.description,
        icon: item.icon,
        color: item.color,
        phase: item.phase,
      });
    }

    // Validate we got reasonable data
    if (result.setup.length < 2 || result.verification.length < 2) return null;

    return result;
  } catch {
    return null;
  }
}

/**
 * All step types organized by phase.
 * 4 core types available in setup, verification, and completion.
 * Agentic phase is restricted to AI Prompt only.
 */
export const STEP_TYPES: Record<WorkflowPhase, StepTypeInfo[]> = {
  setup: [
    {
      type: "command",
      label: "Command",
      description: "Run shell commands or checks",
      icon: "Terminal",
      color: "gray",
      phase: "setup",
    },
    {
      type: "test",
      label: "Test",
      description: "Run verification tests",
      icon: "TestTube2",
      color: "green",
      phase: "setup",
    },
    {
      type: "ui_bridge",
      label: "UI Bridge",
      description: "Interact with UI via UI Bridge SDK",
      icon: "Monitor",
      color: "emerald",
      phase: "setup",
    },
    {
      type: "prompt",
      label: "AI Task",
      description: "AI-driven task",
      icon: "Bot",
      color: "violet",
      phase: "setup",
    },
  ],
  verification: [
    {
      type: "command",
      label: "Command",
      description: "Run commands for verification",
      icon: "Terminal",
      color: "gray",
      phase: "verification",
    },
    {
      type: "test",
      label: "Test",
      description: "Run verification tests",
      icon: "TestTube2",
      color: "green",
      phase: "verification",
    },
    {
      type: "ui_bridge",
      label: "UI Bridge",
      description: "Verify UI state via UI Bridge",
      icon: "Monitor",
      color: "emerald",
      phase: "verification",
    },
    {
      type: "prompt",
      label: "AI Verification",
      description: "AI-evaluated criteria",
      icon: "Bot",
      color: "violet",
      phase: "verification",
    },
  ],
  agentic: [
    {
      type: "prompt",
      label: "Prompt",
      description: "AI task instructions",
      icon: "MessageSquare",
      color: "amber",
      phase: "agentic",
    },
  ],
  completion: [
    {
      type: "command",
      label: "Command",
      description: "Run cleanup commands",
      icon: "Terminal",
      color: "gray",
      phase: "completion",
    },
    {
      type: "test",
      label: "Test",
      description: "Final tests",
      icon: "TestTube2",
      color: "green",
      phase: "completion",
    },
    {
      type: "ui_bridge",
      label: "UI Bridge",
      description: "Final UI interactions",
      icon: "Monitor",
      color: "emerald",
      phase: "completion",
    },
    {
      type: "prompt",
      label: "AI Completion",
      description: "Final AI actions",
      icon: "Bot",
      color: "violet",
      phase: "completion",
    },
  ],
};

export const PHASE_INFO: Record<
  WorkflowPhase,
  { label: string; description: string; color: string }
> = {
  setup: {
    label: "Setup",
    description: "Runs once at the beginning",
    color: "blue",
  },
  verification: {
    label: "Verification",
    description: "Checks success criteria, loops with agentic",
    color: "green",
  },
  agentic: {
    label: "Agentic",
    description: "AI work, iterates until verification passes",
    color: "amber",
  },
  completion: {
    label: "Completion",
    description: "Runs once after the loop exits",
    color: "purple",
  },
};

// =============================================================================
// Summary Step Constants and Helpers
// =============================================================================

export const DEFAULT_SUMMARY_PROMPT = `Write a one-paragraph summary of all the tasks completed in this workflow. Include what was accomplished, whether the stated goal was achieved, any issues encountered and how they were resolved, and remaining work if the goal was not fully achieved. Be concise but comprehensive.`;

export function createSummaryStep(): PromptStep {
  return {
    id: crypto.randomUUID(),
    type: "prompt",
    phase: "completion",
    name: "AI Summary",
    content: DEFAULT_SUMMARY_PROMPT,
    is_summary_step: true,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

export function generateStepId(): string {
  return crypto.randomUUID();
}

export function createDefaultStep(
  type: UnifiedStep["type"],
  phase: WorkflowPhase,
): UnifiedStep {
  const id = generateStepId();

  switch (type) {
    case "command":
      return {
        id,
        type: "command",
        phase: phase as "setup" | "verification" | "completion",
        name: "Command",
        command: "",
      };
    case "test":
      return {
        id,
        type: "test",
        phase: phase as "setup" | "verification" | "completion",
        name: "New Test",
        test_type: "custom_command",
      };
    case "ui_bridge":
      return {
        id,
        type: "ui_bridge",
        phase: phase as "setup" | "verification" | "completion",
        name: "UI Bridge",
        action: "snapshot",
      };
    case "prompt": {
      const promptNames: Record<WorkflowPhase, string> = {
        setup: "AI Setup Task",
        verification: "AI Verification",
        agentic: "Prompt",
        completion: "AI Completion Task",
      };
      return {
        id,
        type: "prompt",
        phase: phase as "setup" | "verification" | "agentic" | "completion",
        name: promptNames[phase] ?? "Prompt",
        content: "",
      };
    }
    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}

export function createDefaultWorkflow(
  includeSummaryStep: boolean = true,
): Omit<UnifiedWorkflow, "id" | "created_at" | "modified_at"> {
  return {
    name: "",
    description: "",
    setup_steps: [],
    verification_steps: [],
    agentic_steps: [],
    completion_steps: includeSummaryStep ? [createSummaryStep()] : [],
    category: "general",
    tags: [],
  };
}

export function isWorkflowEmpty(workflow: UnifiedWorkflow): boolean {
  const completionSteps = workflow.completion_steps ?? [];
  const firstStep = completionSteps[0];
  const hasOnlySummaryStep =
    completionSteps.length === 0 ||
    (completionSteps.length === 1 &&
      firstStep !== undefined &&
      firstStep.type === "prompt" &&
      (firstStep as PromptStep).is_summary_step === true);

  return (
    workflow.setup_steps.length === 0 &&
    workflow.verification_steps.length === 0 &&
    workflow.agentic_steps.length === 0 &&
    hasOnlySummaryStep
  );
}

export function getTotalStepCount(workflow: UnifiedWorkflow): number {
  return (
    workflow.setup_steps.length +
    workflow.verification_steps.length +
    workflow.agentic_steps.length +
    (workflow.completion_steps ?? []).length
  );
}

export function getStepPhase(step: UnifiedStep): WorkflowPhase {
  return step.phase;
}

export function canStepExistInPhase(
  stepType: UnifiedStep["type"],
  phase: WorkflowPhase,
): boolean {
  if (phase === "agentic") {
    return stepType === "prompt";
  }

  switch (stepType) {
    case "command":
    case "test":
    case "ui_bridge":
    case "prompt":
      return true;
    default:
      return false;
  }
}

// =============================================================================
// Export/Import Types
// =============================================================================

export interface WorkflowExportManifest {
  version: string;
  exported_at: string;
  app_version: string;
  content_type: "unified_workflow";
}

export interface WorkflowExport {
  manifest: WorkflowExportManifest;
  workflow: UnifiedWorkflow;
}

export interface WorkflowImportResult {
  workflow: UnifiedWorkflow;
  overwritten: boolean;
  original_id: string | null;
}
