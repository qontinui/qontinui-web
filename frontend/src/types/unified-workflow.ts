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

interface BaseStep {
  id: string;
  name: string;
}

// --- SETUP Phase Steps ---

export interface ScriptStep extends BaseStep {
  type: "script";
  phase: "setup" | "completion";
  code?: string;
  script_id?: string;
  target_url?: string;
  refinement_enabled: boolean;
}

export interface StateStep extends BaseStep {
  type: "state";
  phase: "setup" | "verification" | "completion";
  state_id: string;
  state_name?: string;
  timeout_seconds?: number;
  run_on_subsequent_iterations?: boolean;
}

export interface WorkflowRefStep extends BaseStep {
  type: "workflow_ref";
  phase: "setup" | "verification" | "completion";
  workflow_id: string;
  workflow_name?: string;
  run_on_subsequent_iterations?: boolean;
}

export interface MacroRefStep extends BaseStep {
  type: "macro";
  phase: "setup" | "verification" | "completion";
  macro_id: string;
  macro_name?: string;
  monitor_index?: number;
}

// --- GUI Action Steps ---

export type GuiActionType =
  | "click"
  | "double_click"
  | "right_click"
  | "type"
  | "hotkey"
  | "scroll";

export interface GuiActionStep extends BaseStep {
  type: "gui_action";
  phase: "setup" | "verification" | "completion";
  action: GuiActionType;
  target_image_ids?: string[];
  target_image_names?: string[];
  text_input?: string;
  hotkey?: string;
  scroll_direction?: "up" | "down";
  pause_after_ms?: number;
  monitor_index?: number;
  run_on_subsequent_iterations?: boolean;
}

// --- API Request Steps ---

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

export interface ApiRequestStep extends BaseStep {
  type: "api_request";
  phase: "setup" | "verification" | "completion";
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  content_type?: ApiContentType;
  timeout_ms?: number;
  follow_redirects?: boolean;
  extractions?: ApiVariableExtraction[];
  assertions?: ApiAssertion[];
  output_variable?: string;
  credential_id?: string;
  run_on_subsequent_iterations?: boolean;
}

// --- VERIFICATION Phase Steps ---

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

export interface ScreenshotStep extends BaseStep {
  type: "screenshot";
  phase: "setup" | "verification" | "completion";
  delay_ms?: number;
  monitor?: "all" | "primary" | "left" | "right" | number;
}

export type CheckType =
  | "lint"
  | "format"
  | "typecheck"
  | "analyze"
  | "security"
  | "custom_command";

export interface CheckStep extends BaseStep {
  type: "check";
  phase: "setup" | "verification" | "completion";
  check_type: CheckType;
  tool?: string;
  check_id?: string;
  command?: string;
  working_directory?: string;
  config_path?: string;
  auto_fix?: boolean;
  fail_on_warning?: boolean;
  timeout_seconds?: number;
}

export interface CheckGroupStep extends BaseStep {
  type: "check_group";
  phase: "setup" | "verification" | "completion";
  check_group_id: string;
}

// --- AGENTIC Phase Steps ---

export interface PromptStep extends BaseStep {
  type: "prompt";
  phase: "setup" | "verification" | "agentic" | "completion";
  content: string;
  prompt_id?: string;
  provider?: string;
  model?: string;
  is_summary_step?: boolean;
}

export interface ShellCommandStep extends BaseStep {
  type: "shell_command";
  phase: "setup" | "verification" | "completion";
  command: string;
  shell_command_id?: string;
  working_directory?: string;
  timeout_seconds?: number;
  fail_on_error?: boolean;
  run_on_subsequent_iterations?: boolean;
}

// --- MCP Call Steps ---

export interface McpCallStep extends BaseStep {
  type: "mcp_call";
  phase: "setup" | "verification" | "completion";
  server_id: string;
  server_name?: string;
  tool_name: string;
  tool_description?: string;
  arguments?: Record<string, unknown>;
  timeout_seconds?: number;
  extractions?: ApiVariableExtraction[];
  assertions?: ApiAssertion[];
  fail_on_error?: boolean;
  run_on_subsequent_iterations?: boolean;
}

// --- AWAS Steps ---

export interface AwasDiscoverStep extends BaseStep {
  type: "awas_discover";
  phase: "setup";
  url: string;
  timeout_seconds?: number;
}

export interface AwasExecuteStep extends BaseStep {
  type: "awas_execute";
  phase: "setup" | "verification";
  url: string;
  action_id: string;
  params?: Record<string, unknown>;
  timeout_seconds?: number;
}

export interface AwasCheckSupportStep extends BaseStep {
  type: "awas_check_support";
  phase: "setup";
  url: string;
  timeout_seconds?: number;
}

export interface AwasListActionsStep extends BaseStep {
  type: "awas_list_actions";
  phase: "setup" | "verification";
  url?: string;
  timeout_seconds?: number;
}

export interface AwasExtractElementsStep extends BaseStep {
  type: "awas_extract_elements";
  phase: "verification";
  html: string;
  base_url?: string;
}

// --- UI Bridge Spec Steps ---

export interface SpecStep extends BaseStep {
  type: "spec";
  phase: "verification";
  spec_group: unknown;
  element_source: "control" | "external";
  stop_on_failure?: boolean;
  description?: string;
}

// --- Gate Steps ---

export interface GateStep extends BaseStep {
  type: "gate";
  phase: "verification";
  required_steps: string[];
  stop_on_failure?: boolean;
  description?: string;
}

// =============================================================================
// Unified Step Type
// =============================================================================

export type UnifiedStep =
  | ScriptStep
  | StateStep
  | WorkflowRefStep
  | MacroRefStep
  | GuiActionStep
  | ApiRequestStep
  | McpCallStep
  | TestStep
  | CheckStep
  | CheckGroupStep
  | ScreenshotStep
  | PromptStep
  | ShellCommandStep
  | SpecStep
  | GateStep
  | AwasDiscoverStep
  | AwasExecuteStep
  | AwasCheckSupportStep
  | AwasListActionsStep
  | AwasExtractElementsStep;

export type AwasStep =
  | AwasDiscoverStep
  | AwasExecuteStep
  | AwasCheckSupportStep
  | AwasListActionsStep
  | AwasExtractElementsStep;

export type SetupStep =
  | ScriptStep
  | StateStep
  | WorkflowRefStep
  | MacroRefStep
  | GuiActionStep
  | ApiRequestStep
  | McpCallStep
  | PromptStep
  | ShellCommandStep
  | TestStep
  | CheckStep
  | CheckGroupStep
  | ScreenshotStep
  | AwasDiscoverStep
  | AwasExecuteStep
  | AwasCheckSupportStep
  | AwasListActionsStep;

export type VerificationStep =
  | ScriptStep
  | StateStep
  | WorkflowRefStep
  | MacroRefStep
  | GuiActionStep
  | ApiRequestStep
  | McpCallStep
  | PromptStep
  | ShellCommandStep
  | TestStep
  | CheckStep
  | CheckGroupStep
  | ScreenshotStep
  | SpecStep
  | GateStep
  | AwasDiscoverStep
  | AwasExecuteStep
  | AwasCheckSupportStep
  | AwasListActionsStep
  | AwasExtractElementsStep;

export type AgenticStep = PromptStep;

export type CompletionStep =
  | ScriptStep
  | StateStep
  | WorkflowRefStep
  | MacroRefStep
  | GuiActionStep
  | ApiRequestStep
  | McpCallStep
  | PromptStep
  | ShellCommandStep
  | TestStep
  | CheckStep
  | CheckGroupStep
  | ScreenshotStep;

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
  hasPlaywrightScripts: boolean;
  hasQontinuiAutomation: boolean;
  hasPlaywrightTests: boolean;
  requiresConfig: boolean;
  showIterationSettings: boolean;
  hasAiPrompts: boolean;
}

export function detectWorkflowFeatures(
  workflow: UnifiedWorkflow
): WorkflowFeatures {
  const hasSetup = workflow.setup_steps.length > 0;
  const hasVerification = workflow.verification_steps.length > 0;
  const hasAgentic = workflow.agentic_steps.length > 0;
  const hasCompletion = (workflow.completion_steps ?? []).length > 0;

  const hasPlaywrightScripts = workflow.setup_steps.some(
    (s) => s.type === "script"
  );
  const hasQontinuiAutomation =
    workflow.setup_steps.some(
      (s) =>
        s.type === "state" ||
        s.type === "workflow_ref" ||
        s.type === "gui_action"
    ) || workflow.verification_steps.some((s) => s.type === "gui_action");

  const hasPlaywrightTests = workflow.verification_steps.some(
    (s) => s.type === "test" && s.test_type === "playwright"
  );

  const hasAiPrompts =
    workflow.setup_steps.some((s) => s.type === "prompt") ||
    workflow.verification_steps.some((s) => s.type === "prompt") ||
    workflow.agentic_steps.some((s) => s.type === "prompt") ||
    (workflow.completion_steps ?? []).some((s) => s.type === "prompt");

  return {
    hasSetup,
    hasVerification,
    hasAgentic,
    hasCompletion,
    hasPlaywrightScripts,
    hasQontinuiAutomation,
    hasPlaywrightTests,
    requiresConfig: hasQontinuiAutomation,
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

export const STEP_TYPES: Record<WorkflowPhase, StepTypeInfo[]> = {
  setup: [
    {
      type: "script",
      label: "Playwright Script",
      description: "Browser automation with Playwright",
      icon: "FileCode",
      color: "emerald",
      phase: "setup",
    },
    {
      type: "state",
      label: "Navigate to State",
      description: "Go to a stored application state",
      icon: "Navigation",
      color: "blue",
      phase: "setup",
    },
    {
      type: "workflow_ref",
      label: "Run Workflow",
      description: "Execute another saved workflow",
      icon: "GitBranch",
      color: "purple",
      phase: "setup",
    },
    {
      type: "macro",
      label: "Run Macro",
      description: "Execute a saved macro (action sequence)",
      icon: "Layers",
      color: "pink",
      phase: "setup",
    },
    {
      type: "gui_action",
      label: "GUI Action",
      description: "Click, type, or press hotkeys",
      icon: "MousePointer2",
      color: "orange",
      phase: "setup",
    },
    {
      type: "api_request",
      label: "API Request",
      description: "Make HTTP requests to APIs",
      icon: "Globe",
      color: "cyan",
      phase: "setup",
    },
    {
      type: "prompt",
      label: "AI Setup Task",
      description: "AI-driven environment preparation",
      icon: "Bot",
      color: "violet",
      phase: "setup",
    },
    {
      type: "shell_command",
      label: "Shell Command",
      description: "Run shell commands (git, scripts, etc.)",
      icon: "Terminal",
      color: "gray",
      phase: "setup",
    },
    {
      type: "mcp_call",
      label: "MCP Call",
      description: "Call a tool on an MCP server",
      icon: "Plug",
      color: "indigo",
      phase: "setup",
    },
    {
      type: "test_playwright",
      label: "Playwright Test",
      description: "Browser assertions and checks",
      icon: "TestTube2",
      color: "green",
      phase: "setup",
    },
    {
      type: "test_vision",
      label: "Qontinui Vision Test",
      description: "Visual element detection",
      icon: "Eye",
      color: "cyan",
      phase: "setup",
    },
    {
      type: "test_python",
      label: "Python Test",
      description: "White-box unit tests",
      icon: "Code",
      color: "yellow",
      phase: "setup",
    },
    {
      type: "test_repository",
      label: "Repository Test",
      description: "Run tests from your repo (pytest, jest, cargo)",
      icon: "Package",
      color: "indigo",
      phase: "setup",
    },
    {
      type: "test_custom",
      label: "Custom Test Command",
      description: "Any shell command for testing",
      icon: "Terminal",
      color: "gray",
      phase: "setup",
    },
    {
      type: "check_lint",
      label: "Lint Check",
      description: "Run linting checks (ruff, eslint, clippy)",
      icon: "AlertTriangle",
      color: "cyan",
      phase: "setup",
    },
    {
      type: "check_format",
      label: "Format Check",
      description: "Run formatting checks (black, prettier, rustfmt)",
      icon: "AlignLeft",
      color: "cyan",
      phase: "setup",
    },
    {
      type: "check_typecheck",
      label: "Type Check",
      description: "Run type checking (mypy, tsc)",
      icon: "FileType",
      color: "cyan",
      phase: "setup",
    },
    {
      type: "check_analyze",
      label: "Code Analysis",
      description: "Run code analysis",
      icon: "Search",
      color: "indigo",
      phase: "setup",
    },
    {
      type: "check_security",
      label: "Security Check",
      description: "Run security scans",
      icon: "Shield",
      color: "red",
      phase: "setup",
    },
    {
      type: "check_custom",
      label: "Custom Check",
      description: "Run custom check command",
      icon: "Terminal",
      color: "cyan",
      phase: "setup",
    },
    {
      type: "screenshot",
      label: "Screenshot",
      description: "Capture current screen state",
      icon: "Camera",
      color: "pink",
      phase: "setup",
    },
    {
      type: "awas_discover",
      label: "AWAS Discover",
      description: "Discover AWAS manifest from a URL",
      icon: "Search",
      color: "teal",
      phase: "setup",
    },
    {
      type: "awas_check_support",
      label: "AWAS Check Support",
      description: "Check if URL supports AWAS",
      icon: "CheckCircle",
      color: "teal",
      phase: "setup",
    },
    {
      type: "awas_list_actions",
      label: "AWAS List Actions",
      description: "List available AWAS actions",
      icon: "List",
      color: "teal",
      phase: "setup",
    },
    {
      type: "awas_execute",
      label: "AWAS Execute",
      description: "Execute an AWAS action",
      icon: "Play",
      color: "teal",
      phase: "setup",
    },
  ],
  verification: [
    {
      type: "test_playwright",
      label: "Playwright Test",
      description: "Browser assertions and checks",
      icon: "TestTube2",
      color: "green",
      phase: "verification",
    },
    {
      type: "test_vision",
      label: "Qontinui Vision Test",
      description: "Visual element detection",
      icon: "Eye",
      color: "cyan",
      phase: "verification",
    },
    {
      type: "test_python",
      label: "Python Test",
      description: "White-box unit tests",
      icon: "Code",
      color: "yellow",
      phase: "verification",
    },
    {
      type: "test_repository",
      label: "Repository Test",
      description: "Run tests from your repo (pytest, jest, cargo)",
      icon: "Package",
      color: "indigo",
      phase: "verification",
    },
    {
      type: "test_custom",
      label: "Custom Test Command",
      description: "Any shell command for testing",
      icon: "Terminal",
      color: "gray",
      phase: "verification",
    },
    {
      type: "check_lint",
      label: "Lint Check",
      description: "Run linting checks (ruff, eslint, clippy)",
      icon: "AlertTriangle",
      color: "cyan",
      phase: "verification",
    },
    {
      type: "check_format",
      label: "Format Check",
      description: "Run formatting checks (black, prettier, rustfmt)",
      icon: "AlignLeft",
      color: "cyan",
      phase: "verification",
    },
    {
      type: "check_typecheck",
      label: "Type Check",
      description: "Run type checking (mypy, tsc)",
      icon: "FileType",
      color: "cyan",
      phase: "verification",
    },
    {
      type: "check_analyze",
      label: "Code Analysis",
      description: "Run code analysis",
      icon: "Search",
      color: "indigo",
      phase: "verification",
    },
    {
      type: "check_security",
      label: "Security Check",
      description: "Run security scans",
      icon: "Shield",
      color: "red",
      phase: "verification",
    },
    {
      type: "check_custom",
      label: "Custom Check",
      description: "Run custom check command",
      icon: "Terminal",
      color: "cyan",
      phase: "verification",
    },
    {
      type: "screenshot",
      label: "Screenshot",
      description: "Capture current screen state",
      icon: "Camera",
      color: "pink",
      phase: "verification",
    },
    {
      type: "state",
      label: "Navigate to State",
      description: "Go to a stored application state",
      icon: "Navigation",
      color: "blue",
      phase: "verification",
    },
    {
      type: "workflow_ref",
      label: "Run Workflow",
      description: "Execute another saved workflow",
      icon: "GitBranch",
      color: "purple",
      phase: "verification",
    },
    {
      type: "gui_action",
      label: "GUI Action",
      description: "Click, type, or press hotkeys",
      icon: "MousePointer2",
      color: "orange",
      phase: "verification",
    },
    {
      type: "macro",
      label: "Run Macro",
      description: "Execute a saved macro (action sequence)",
      icon: "Layers",
      color: "pink",
      phase: "verification",
    },
    {
      type: "script",
      label: "Playwright Script",
      description: "Browser automation with Playwright",
      icon: "FileCode",
      color: "emerald",
      phase: "verification",
    },
    {
      type: "api_request",
      label: "API Request",
      description: "Verify API responses with assertions",
      icon: "Globe",
      color: "cyan",
      phase: "verification",
    },
    {
      type: "shell_command",
      label: "Shell Command",
      description: "Run shell commands for verification",
      icon: "Terminal",
      color: "gray",
      phase: "verification",
    },
    {
      type: "prompt",
      label: "AI Verification",
      description: "AI-evaluated success criteria",
      icon: "Bot",
      color: "violet",
      phase: "verification",
    },
    {
      type: "mcp_call",
      label: "MCP Call",
      description: "Call an MCP tool for verification",
      icon: "Plug",
      color: "indigo",
      phase: "verification",
    },
    {
      type: "awas_execute",
      label: "AWAS Execute",
      description: "Execute an AWAS action for verification",
      icon: "Play",
      color: "teal",
      phase: "verification",
    },
    {
      type: "awas_list_actions",
      label: "AWAS List Actions",
      description: "List available AWAS actions",
      icon: "List",
      color: "teal",
      phase: "verification",
    },
    {
      type: "awas_extract_elements",
      label: "AWAS Extract Elements",
      description: "Extract AWAS elements from HTML",
      icon: "FileSearch",
      color: "teal",
      phase: "verification",
    },
    {
      type: "spec",
      label: "UI Bridge Spec",
      description: "Verify UI elements against spec assertions",
      icon: "ShieldCheck",
      color: "emerald",
      phase: "verification",
    },
    {
      type: "gate",
      label: "Gate",
      description: "Aggregate step results to control agentic loop",
      icon: "ShieldCheck",
      color: "red",
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
      type: "prompt",
      label: "AI Completion Task",
      description: "Final AI actions after loop exits",
      icon: "Bot",
      color: "violet",
      phase: "completion",
    },
    {
      type: "script",
      label: "Playwright Script",
      description: "Final browser automation",
      icon: "FileCode",
      color: "emerald",
      phase: "completion",
    },
    {
      type: "api_request",
      label: "API Request",
      description: "Final API calls (notifications, cleanup)",
      icon: "Globe",
      color: "cyan",
      phase: "completion",
    },
    {
      type: "shell_command",
      label: "Shell Command",
      description: "Run shell commands (git commit, cleanup, etc.)",
      icon: "Terminal",
      color: "gray",
      phase: "completion",
    },
    {
      type: "mcp_call",
      label: "MCP Call",
      description: "Call an MCP tool (notifications, cleanup)",
      icon: "Plug",
      color: "indigo",
      phase: "completion",
    },
    {
      type: "workflow_ref",
      label: "Run Workflow",
      description: "Execute another saved workflow",
      icon: "GitBranch",
      color: "purple",
      phase: "completion",
    },
    {
      type: "state",
      label: "Navigate to State",
      description: "Return to a specific application state",
      icon: "Navigation",
      color: "blue",
      phase: "completion",
    },
    {
      type: "macro",
      label: "Run Macro",
      description: "Execute a saved macro (action sequence)",
      icon: "Layers",
      color: "pink",
      phase: "completion",
    },
    {
      type: "gui_action",
      label: "GUI Action",
      description: "Click, type, or press hotkeys",
      icon: "MousePointer2",
      color: "orange",
      phase: "completion",
    },
    {
      type: "test_playwright",
      label: "Playwright Test",
      description: "Final browser assertions",
      icon: "TestTube2",
      color: "green",
      phase: "completion",
    },
    {
      type: "test_vision",
      label: "Qontinui Vision Test",
      description: "Final visual verification",
      icon: "Eye",
      color: "cyan",
      phase: "completion",
    },
    {
      type: "test_python",
      label: "Python Test",
      description: "Final unit tests",
      icon: "Code",
      color: "yellow",
      phase: "completion",
    },
    {
      type: "test_repository",
      label: "Repository Test",
      description: "Run final tests from repo",
      icon: "Package",
      color: "indigo",
      phase: "completion",
    },
    {
      type: "test_custom",
      label: "Custom Test Command",
      description: "Any shell command for final testing",
      icon: "Terminal",
      color: "gray",
      phase: "completion",
    },
    {
      type: "check_lint",
      label: "Lint Check",
      description: "Final linting (ruff, eslint, clippy)",
      icon: "AlertTriangle",
      color: "cyan",
      phase: "completion",
    },
    {
      type: "check_format",
      label: "Format Check",
      description: "Final formatting (black, prettier, rustfmt)",
      icon: "AlignLeft",
      color: "cyan",
      phase: "completion",
    },
    {
      type: "check_typecheck",
      label: "Type Check",
      description: "Final type checking (mypy, tsc)",
      icon: "FileType",
      color: "cyan",
      phase: "completion",
    },
    {
      type: "check_analyze",
      label: "Code Analysis",
      description: "Final code analysis",
      icon: "Search",
      color: "indigo",
      phase: "completion",
    },
    {
      type: "check_security",
      label: "Security Check",
      description: "Final security scans",
      icon: "Shield",
      color: "red",
      phase: "completion",
    },
    {
      type: "check_custom",
      label: "Custom Check",
      description: "Run custom check command",
      icon: "Terminal",
      color: "cyan",
      phase: "completion",
    },
    {
      type: "screenshot",
      label: "Screenshot",
      description: "Capture final screen state",
      icon: "Camera",
      color: "pink",
      phase: "completion",
    },
  ],
};

export const GUI_ACTION_TYPES: {
  type: GuiActionType;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    type: "click",
    label: "Click",
    icon: "MousePointer2",
    description: "Single click on target",
  },
  {
    type: "double_click",
    label: "Double-Click",
    icon: "MousePointerClick",
    description: "Double-click on target",
  },
  {
    type: "right_click",
    label: "Right-Click",
    icon: "MousePointer",
    description: "Context menu click",
  },
  {
    type: "type",
    label: "Type Text",
    icon: "Keyboard",
    description: "Type text at cursor",
  },
  {
    type: "hotkey",
    label: "Hotkey",
    icon: "Command",
    description: "Press key combination",
  },
  {
    type: "scroll",
    label: "Scroll",
    icon: "ArrowUpDown",
    description: "Scroll up or down",
  },
];

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
    case "script":
      return {
        id,
        type: "script",
        phase: "setup",
        name: "New Script",
        refinement_enabled: true,
      };
    case "state":
      return {
        id,
        type: "state",
        phase: "setup",
        name: "Navigate to State",
        state_id: "",
      };
    case "workflow_ref":
      return {
        id,
        type: "workflow_ref",
        phase: phase as "setup" | "verification" | "completion",
        name: "Run Workflow",
        workflow_id: "",
      };
    case "gui_action":
      return {
        id,
        type: "gui_action",
        phase: phase as "setup" | "verification" | "completion",
        name: "GUI Action",
        action: "click",
      };
    case "test":
      return {
        id,
        type: "test",
        phase: "verification",
        name: "New Test",
        test_type: "custom_command",
      };
    case "check":
      return {
        id,
        type: "check",
        phase: "verification",
        name: "New Check",
        check_type: "custom_command",
      };
    case "check_group":
      return {
        id,
        type: "check_group",
        phase: "verification",
        name: "Check Group",
        check_group_id: "",
      };
    case "screenshot":
      return {
        id,
        type: "screenshot",
        phase: "verification",
        name: "Screenshot",
      };
    case "api_request":
      return {
        id,
        type: "api_request",
        phase: phase as "setup" | "verification" | "completion",
        name: "API Request",
        method: "GET",
        url: "",
      };
    case "mcp_call":
      return {
        id,
        type: "mcp_call",
        phase: phase as "setup" | "verification" | "completion",
        name: "MCP Call",
        server_id: "",
        tool_name: "",
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
    case "shell_command":
      return {
        id,
        type: "shell_command",
        phase: phase as "setup" | "verification" | "completion",
        name: "Shell Command",
        command: "",
      };
    case "awas_discover":
      return {
        id,
        type: "awas_discover",
        phase: "setup",
        name: "AWAS Discover",
        url: "",
      };
    case "awas_execute":
      return {
        id,
        type: "awas_execute",
        phase: phase as "setup" | "verification",
        name: "AWAS Execute",
        url: "",
        action_id: "",
      };
    case "awas_check_support":
      return {
        id,
        type: "awas_check_support",
        phase: "setup",
        name: "AWAS Check Support",
        url: "",
      };
    case "awas_list_actions":
      return {
        id,
        type: "awas_list_actions",
        phase: phase as "setup" | "verification",
        name: "AWAS List Actions",
      };
    case "awas_extract_elements":
      return {
        id,
        type: "awas_extract_elements",
        phase: "verification",
        name: "AWAS Extract Elements",
        html: "",
      };
    case "spec":
      return {
        id,
        type: "spec",
        phase: "verification",
        name: "Spec Verification",
        spec_group: {},
        element_source: "control",
      };
    case "gate":
      return {
        id,
        type: "gate",
        phase: "verification",
        name: "Gate",
        required_steps: [],
      };
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
  phase: WorkflowPhase
): boolean {
  if (phase === "agentic") {
    return stepType === "prompt";
  }

  switch (stepType) {
    case "script":
    case "state":
    case "gui_action":
    case "workflow_ref":
    case "macro":
    case "api_request":
    case "mcp_call":
    case "test":
    case "check":
    case "check_group":
    case "screenshot":
    case "prompt":
    case "shell_command":
      return true;
    case "awas_discover":
    case "awas_check_support":
    case "awas_execute":
    case "awas_list_actions":
    case "awas_extract_elements":
      return true;
    case "spec":
    case "gate":
      return phase === "verification";
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
