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
 * Step Types (3 core types by execution mechanism):
 *   command   - Subprocess execution (shell commands, checks, check groups, tests)
 *   ui_bridge - UI Bridge SDK interactions (navigate, execute, assert, snapshot)
 *   prompt    - AI provider calls (task instructions, evaluation)
 *
 * Data types are imported from @qontinui/schemas (canonical source).
 * Utility functions, constants, and UI-specific types are defined locally.
 */

// =============================================================================
// Canonical Data Types (from @qontinui/schemas)
// =============================================================================

// Import types needed by local utility functions
import type {
  WorkflowPhase,
  UnifiedWorkflow,
  UnifiedStep,
  PromptStep,
} from "@qontinui/schemas/unified_workflow";

// Re-export all data types from the canonical schema package
export type {
  WorkflowPhase,
  LogSourceSelection,
  HealthCheckUrl,
  BaseStep,
  HttpMethod,
  ApiContentType,
  ApiVariableExtraction,
  ApiAssertion,
  TestType,
  PlaywrightExecutionMode,
  CheckType,
  CommandStep,
  PromptStep,
  UiBridgeStep,
  StepTypeName,
  UnifiedStep,
  SetupStep,
  VerificationStep,
  AgenticStep,
  CompletionStep,
  WorkflowStage,
  UnifiedWorkflow,
  WorkflowExportManifest,
  WorkflowExport,
  WorkflowImportResult,
} from "@qontinui/schemas/unified_workflow";

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
  workflow: UnifiedWorkflow
): WorkflowFeatures {
  const allSteps: UnifiedStep[] = [
    ...workflow.setup_steps,
    ...workflow.verification_steps,
    ...workflow.agentic_steps,
    ...(workflow.completion_steps ?? []),
    ...(workflow.stages ?? []).flatMap((s) => [
      ...s.setup_steps,
      ...s.verification_steps,
      ...s.agentic_steps,
      ...(s.completion_steps ?? []),
    ]),
  ];

  const hasSetup =
    workflow.setup_steps.length > 0 ||
    (workflow.stages ?? []).some((s) => s.setup_steps.length > 0);
  const hasVerification =
    workflow.verification_steps.length > 0 ||
    (workflow.stages ?? []).some((s) => s.verification_steps.length > 0);
  const hasAgentic =
    workflow.agentic_steps.length > 0 ||
    (workflow.stages ?? []).some((s) => s.agentic_steps.length > 0);
  const hasCompletion =
    (workflow.completion_steps ?? []).length > 0 ||
    (workflow.stages ?? []).some((s) => (s.completion_steps ?? []).length > 0);

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
      { credentials: "include" }
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
 * 3 core types available in setup, verification, and completion.
 * Agentic phase is restricted to AI Prompt only.
 */
export const STEP_TYPES: Record<WorkflowPhase, StepTypeInfo[]> = {
  setup: [
    {
      type: "command",
      label: "Command",
      description: "Run shell commands, checks, or tests",
      icon: "Terminal",
      color: "gray",
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
      description: "Run commands, checks, or tests for verification",
      icon: "Terminal",
      color: "gray",
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
      description: "Run cleanup commands or final tests",
      icon: "Terminal",
      color: "gray",
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
  phase: WorkflowPhase
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
  includeSummaryStep: boolean = true
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
  if ((workflow.stages ?? []).length > 0) {
    return false;
  }

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
  const topLevelCount =
    workflow.setup_steps.length +
    workflow.verification_steps.length +
    workflow.agentic_steps.length +
    (workflow.completion_steps ?? []).length;

  const stagesCount = (workflow.stages ?? []).reduce(
    (sum, s) =>
      sum +
      s.setup_steps.length +
      s.verification_steps.length +
      s.agentic_steps.length +
      (s.completion_steps ?? []).length,
    0
  );

  return topLevelCount + stagesCount;
}

export function getStepPhase(step: UnifiedStep): WorkflowPhase {
  return step.phase;
}

export function canStepExistInPhase(
  stepType: UnifiedStep["type"],
  phase: WorkflowPhase
): boolean {
  if (phase === "agentic") {
    return stepType === "prompt";
  }

  switch (stepType) {
    case "command":
    case "ui_bridge":
    case "prompt":
      return true;
    default:
      return false;
  }
}
