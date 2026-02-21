/**
 * prompt-template-constants.ts
 *
 * Constants and utilities for prompt template customization in the Unified Workflow Builder.
 * Ported from qontinui-runner/src/components/workflow-builder/prompt-template-constants.ts.
 */

// Storage key for global custom prompt template
export const GLOBAL_PROMPT_TEMPLATE_KEY =
  "qontinui-unified-workflow-prompt-template";

/**
 * Default Developer Mode Prompt Template for Unified Workflows
 *
 * This template wraps the AI session when running unified workflows.
 * It provides instructions on how the AI should operate in the iterative feedback loop.
 *
 * Template variables:
 * - {{SESSION_ID}} - The unique session identifier
 * - {{ITERATION}} - Current iteration number
 * - {{MAX_ITERATIONS}} - Maximum allowed iterations
 * - {{GOAL}} - The workflow goal/task description
 * - {{EXECUTION_STEPS}} - Pre-executed step results
 * - {{WORKSPACE_ESCAPED}} - Escaped workspace path
 */
export const DEFAULT_UNIFIED_PROMPT_TEMPLATE = `# AI Developer Loop

This is an **iterative feedback loop**. The runner executes automation, you analyze results and fix issues, then the runner re-runs automation to verify your fixes work.

## Session Info

**Session ID:** {{SESSION_ID}}
**Iteration:** {{ITERATION}}/{{MAX_ITERATIONS}}
**Goal:** {{GOAL}}

## How This Loop Works

1. Runner executes automation steps BEFORE your session starts
2. You analyze the Pre-Execution Results (at the end of this prompt)
3. If steps failed → make fixes → let session end (NO [TASK_COMPLETE])
4. Runner spawns new session with automation re-run
5. In the new session, check if Pre-Execution Results now show SUCCESS
6. Only when automation SUCCEEDS → output \`[TASK_COMPLETE]\`

## Automation Steps (Already Executed)

The following steps were executed by the runner BEFORE this session started:

{{EXECUTION_STEPS}}

## Rules

- **Review Pre-Execution Results FIRST** - this is your primary data source
- Work AUTONOMOUSLY - never ask the user
- **Verify before completing** - always wait for next iteration to confirm fixes work
`;

/**
 * Get the global developer prompt template (custom or default)
 */
export const getGlobalPromptTemplate = (): string => {
  if (typeof window !== "undefined") {
    const customTemplate = localStorage.getItem(GLOBAL_PROMPT_TEMPLATE_KEY);
    if (customTemplate) {
      return customTemplate;
    }
  }
  return DEFAULT_UNIFIED_PROMPT_TEMPLATE;
};

/**
 * Save a global custom prompt template
 */
export const saveGlobalPromptTemplate = (template: string): void => {
  if (typeof window !== "undefined") {
    localStorage.setItem(GLOBAL_PROMPT_TEMPLATE_KEY, template);
  }
};

/**
 * Reset global prompt template to default
 */
export const resetGlobalPromptTemplate = (): void => {
  if (typeof window !== "undefined") {
    localStorage.removeItem(GLOBAL_PROMPT_TEMPLATE_KEY);
  }
};

/**
 * Check if using custom global template
 */
export const isUsingGlobalCustomTemplate = (): boolean => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(GLOBAL_PROMPT_TEMPLATE_KEY) !== null;
  }
  return false;
};

/**
 * Available template variables with descriptions
 */
export interface TemplateVariable {
  name: string;
  token: string;
  description: string;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  {
    name: "SESSION_ID",
    token: "{{SESSION_ID}}",
    description: "Unique session identifier",
  },
  {
    name: "ITERATION",
    token: "{{ITERATION}}",
    description: "Current iteration number (1, 2, 3, ...)",
  },
  {
    name: "MAX_ITERATIONS",
    token: "{{MAX_ITERATIONS}}",
    description: "Maximum allowed iterations",
  },
  {
    name: "GOAL",
    token: "{{GOAL}}",
    description: "The workflow goal/task description",
  },
  {
    name: "EXECUTION_STEPS",
    token: "{{EXECUTION_STEPS}}",
    description: "Pre-executed step results and instructions",
  },
  {
    name: "WORKSPACE_ESCAPED",
    token: "{{WORKSPACE_ESCAPED}}",
    description: "Escaped workspace root path",
  },
];
