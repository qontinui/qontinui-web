/**
 * Unified Workflow Types
 *
 * Re-exports canonical types from @qontinui/shared-types/workflow
 * and utility functions from @qontinui/workflow-utils.
 * Local web-specific functions (fetchStepTypes) are defined here.
 *
 * Execution Order:
 *   Setup (once) -> [Verification <-> Agentic]* -> Completion (once)
 */

// =============================================================================
// Re-exports from @qontinui/shared-types/workflow
// =============================================================================

// All data types
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
  WorkflowStep,
  StepTypeName,
  SetupStep,
  VerificationStep,
  AgenticStep,
  CompletionStep,
  WorkflowStage,
  UnifiedWorkflow,
  ModelOverrideConfig,
  ModelOverrides,
  WorkflowExportManifest,
  WorkflowExport,
  WorkflowImportResult,
  WorkflowFeatures,
  StepTypeInfo,
} from "@qontinui/shared-types/workflow";

// Constants
export {
  STEP_TYPES,
  PHASE_INFO,
  DEFAULT_SUMMARY_PROMPT,
} from "@qontinui/shared-types/workflow";

// Web UI treats workflow steps as strictly-canonical values — every
// consumer narrows by the `type` discriminator and reads typed fields. The
// wire contract's `UnifiedStep = CanonicalStep | { [k: string]: unknown }`
// preserves lossless round-trip of unknown step shapes, but that `Other`
// variant defeats field-level type inference at every consumer site. Alias
// the web's `UnifiedStep` to `CanonicalStep` so the UI keeps its strict
// view. The wire-typed variant from `@qontinui/shared-types/workflow`
// still exists for code that needs to round-trip unknown shapes.
export type { CanonicalStep as UnifiedStep } from "@qontinui/shared-types/workflow";

// =============================================================================
// Re-exports from @qontinui/workflow-utils
// =============================================================================

export {
  // Workflow factory functions
  createDefaultStep,
  createDefaultWorkflow,
  createSummaryStep,
  generateStepId,
  // Workflow query functions
  detectWorkflowFeatures,
  isWorkflowEmpty,
  getTotalStepCount,
  getStepPhase,
  canStepExistInPhase,
  normalizeToPhases,
  getPhaseCount,
} from "@qontinui/workflow-utils";

// =============================================================================
// Web-Specific: Fetch Step Types from Backend API
// =============================================================================

// Import types needed by fetchStepTypes
import type {
  WorkflowPhase,
  StepTypeInfo,
} from "@qontinui/shared-types/workflow";

/**
 * Fetch step types from the backend API, which in turn syncs from the runner.
 * Returns null on failure so callers can fall back to STEP_TYPES.
 */
export async function fetchStepTypes(): Promise<Record<
  WorkflowPhase,
  StepTypeInfo[]
> | null> {
  try {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";
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
