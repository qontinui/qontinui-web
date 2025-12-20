/**
 * AI-powered action configurations
 *
 * Enables AI-assisted automation with context isolation for complex workflows.
 * Supports single prompts and multi-step sequences.
 */

/**
 * Prompt parameter definition for templates
 */
export interface PromptParameter {
  /** Parameter name (used in {name} placeholders) */
  name: string;

  /** Parameter value type */
  type: "string" | "number" | "boolean" | "path";

  /** What this parameter is for */
  description?: string;

  /** Whether this parameter must be provided */
  required?: boolean;

  /** Default value if not provided */
  default?: string;
}

/**
 * Reusable AI prompt template
 */
export interface AIPromptTemplate {
  /** Unique template identifier */
  id: string;

  /** Human-readable template name */
  name: string;

  /** What this template does */
  description?: string;

  /** Category for organization (e.g., 'code-quality', 'security', 'testing') */
  category?: string;

  /** Tags for filtering */
  tags?: string[];

  /** Prompt content with optional {param} placeholders */
  prompt: string;

  /** Parameters that can be filled into the prompt */
  parameters?: PromptParameter[];

  /** Default timeout in milliseconds (default: 10 minutes) */
  defaultTimeout?: number;

  /** Default working directory for execution */
  defaultWorkingDirectory?: string;
}

/**
 * AI_PROMPT - Execute an AI prompt
 *
 * Executes an AI prompt, optionally from a template. This is the atomic
 * operation for AI-powered automation.
 *
 * The action can:
 * 1. Run an inline prompt directly
 * 2. Reference a template from the prompt library
 * 3. Spawn a fresh AI session (context isolation) or continue existing
 *
 * Supported providers:
 *     - claude: Claude Code CLI (default)
 *
 * Use cases:
 * - Autonomous error detection and correction
 * - Code quality improvements
 * - Test generation and maintenance
 * - Documentation generation
 */
export interface AIPromptActionConfig {
  /**
   * AI provider to use (currently only 'claude' supported)
   * Default: "claude"
   */
  provider?: "claude";

  /**
   * The prompt to send to the AI. Can be:
   * - A natural language prompt
   * - A slash command (e.g., '/analyze-automation')
   * - Any text that will be passed to the AI
   *
   * Either 'prompt' or 'templateId' must be provided.
   */
  prompt?: string;

  /**
   * Reference to a prompt template from the library
   * Alternative to providing an inline prompt
   */
  templateId?: string;

  /**
   * Parameter values to fill into the template
   * Used when templateId is specified
   */
  templateParameters?: Record<string, unknown>;

  /**
   * Whether to start a fresh AI session (true) or continue existing (false).
   * Fresh context prevents overflow but loses conversation history.
   * Default: true
   */
  freshContext?: boolean;

  /**
   * Execution timeout in milliseconds
   * Default: 600000 (10 minutes)
   */
  timeout?: number;

  /**
   * Working directory for AI execution
   */
  workingDirectory?: string;

  /**
   * Path to automation results directory (for analysis prompts)
   */
  resultsDirectory?: string;

  /**
   * Variable name to store the AI output
   */
  outputVariable?: string;

  /**
   * File path to write the AI output
   */
  outputFile?: string;

  /**
   * Whether to fail the action if AI execution fails
   * Default: true
   */
  failOnError?: boolean;

  /**
   * Human-readable description of this prompt
   */
  description?: string;
}

/**
 * A step in a prompt sequence
 */
export interface PromptSequenceStep {
  /** Unique step identifier */
  id: string;

  /**
   * Template to execute
   * Mutually exclusive with inlinePrompt
   */
  templateId?: string;

  /**
   * Inline prompt (alternative to templateId)
   */
  inlinePrompt?: string;

  /**
   * Values for template parameters
   */
  parameterValues?: Record<string, unknown>;

  /**
   * Override default timeout (milliseconds)
   */
  timeout?: number;

  /**
   * Override working directory
   */
  workingDirectory?: string;

  /**
   * Optional condition expression for when to run this step.
   * Examples: 'previous.success', 'steps.step1.success'
   */
  condition?: string;

  /**
   * Continue sequence even if this step fails
   * Default: false
   */
  continueOnFailure?: boolean;

  /**
   * Number of times to retry this step on failure
   * Default: 0
   */
  maxRetries?: number;

  /**
   * Variable to store step output
   */
  outputVariable?: string;
}

/**
 * Ordered sequence of AI prompts executed with context isolation
 */
export interface PromptSequence {
  /** Unique sequence identifier */
  id: string;

  /** Human-readable sequence name */
  name: string;

  /** What this sequence does */
  description?: string;

  /** Category for organization */
  category?: string;

  /** Tags for filtering */
  tags?: string[];

  /** Ordered list of steps to execute (minimum 1) */
  steps: PromptSequenceStep[];

  /**
   * What to do when a step fails:
   * - stop: Abort sequence immediately
   * - continue: Skip failed step, continue with next
   * - retry: Retry failed step (up to maxRetries)
   *
   * Default: "stop"
   */
  onFailure?: "stop" | "continue" | "retry";

  /**
   * Max retries per step when onFailure='retry'
   * Default: 0
   */
  maxRetries?: number;

  /**
   * Directory to store step results
   */
  resultsDirectory?: string;

  /**
   * Default timeout per step (milliseconds)
   * Default: 600000 (10 minutes)
   */
  defaultTimeout?: number;
}

/**
 * RUN_PROMPT_SEQUENCE - Execute a sequence of AI prompts
 *
 * Executes a sequence of AI prompts, each in a fresh context.
 * This action orchestrates multi-step AI workflows.
 *
 * The sequence can be:
 * 1. Referenced by ID (from the prompt library)
 * 2. Defined inline in the action config
 *
 * Use cases:
 * - Complex code improvement pipelines
 * - Multi-stage analysis and fixing
 * - Workflows that would overflow single context
 */
export interface RunPromptSequenceActionConfig {
  /**
   * ID of the sequence to run (from prompt library)
   * Mutually exclusive with inlineSequence
   */
  sequenceId?: string;

  /**
   * Inline sequence definition (alternative to sequenceId)
   */
  inlineSequence?: PromptSequence;

  /**
   * Parameter values to apply to all steps
   */
  parameterOverrides?: Record<string, unknown>;

  /**
   * Working directory for all steps
   */
  workingDirectory?: string;

  /**
   * Directory to store results
   */
  resultsDirectory?: string;

  /**
   * Variable to store sequence results summary
   */
  outputVariable?: string;

  /**
   * Human-readable description of this sequence execution
   */
  description?: string;
}

// ============================================================================
// CHECKPOINT_WORKFLOW - Dynamic multi-session AI workflow
// ============================================================================

/**
 * A phase in a checkpoint workflow
 *
 * Phases are visual markers that help users understand the workflow structure.
 * The AI updates the checkpoint file as it completes each phase.
 */
export interface WorkflowPhase {
  /** Phase number (must match checkpoint value) */
  phase: number;

  /** Human-readable phase name */
  name: string;

  /** What this phase accomplishes */
  description?: string;

  /** Estimated duration hint (for UI display only) */
  estimatedMinutes?: number;
}

/**
 * Checkpoint configuration for tracking workflow progress
 */
export interface CheckpointConfig {
  /**
   * Path to the checkpoint JSON file
   * The AI will read/write this file to track progress
   * Example: "C:/project/.dev-logs/workflow-checkpoint.json"
   */
  path: string;

  /**
   * JSON field name that contains the current phase number
   * Default: "current_phase"
   */
  phaseField?: string;

  /**
   * Phase value that indicates workflow completion
   * When the checkpoint's phase field >= this value, the workflow is complete
   */
  completionValue: number;

  /**
   * Whether to delete the checkpoint file when starting a new run
   * This ensures a fresh start each time
   * Default: true
   */
  resetOnStart?: boolean;
}

/**
 * CHECKPOINT_WORKFLOW - Execute a dynamic multi-session AI workflow
 *
 * Unlike RUN_PROMPT_SEQUENCE which executes pre-defined steps, this action
 * runs AI sessions that dynamically progress through phases. The AI decides
 * when to update the checkpoint file, and the workflow automatically spawns
 * continuation sessions until the target phase is reached.
 *
 * How it works:
 * 1. First session runs with the initial prompt
 * 2. AI works on the task and updates the checkpoint file when ready
 * 3. When session ends, workflow checks checkpoint:
 *    - If phase >= completionValue: workflow complete
 *    - If phase < completionValue: spawn continuation with continuationPrompt
 * 4. Repeat until complete or max sessions reached
 *
 * Use cases:
 * - Large refactoring tasks that span multiple AI sessions
 * - Multi-phase improvement workflows (audit → fix → verify)
 * - Long-running tasks that would overflow a single context
 * - Tasks where the AI needs to decide when each phase is done
 *
 * Key difference from RUN_PROMPT_SEQUENCE:
 * - Sequence: "Do step 1, then step 2, then step 3" (deterministic)
 * - Checkpoint: "Work until phase X is done, then continue" (AI-driven)
 */
export interface CheckpointWorkflowActionConfig {
  /**
   * AI provider to use
   * Default: "claude"
   */
  provider?: "claude";

  /**
   * Prompt for the first session
   * Should include instructions about the checkpoint file and expected phases
   */
  initialPrompt: string;

  /**
   * Prompt for continuation sessions (after the first)
   * Typically instructs the AI to read the checkpoint and continue
   * If not provided, uses a default that references the checkpoint path
   */
  continuationPrompt?: string;

  /**
   * Checkpoint configuration for progress tracking
   */
  checkpoint: CheckpointConfig;

  /**
   * Visual phase definitions for the workflow builder UI
   * These help users understand the workflow structure
   * Optional - workflow will function without them
   */
  phases?: WorkflowPhase[];

  /**
   * Maximum number of sessions to spawn
   * Prevents infinite loops if the AI never reaches completion
   * Default: 10
   */
  maxSessions?: number;

  /**
   * Maximum iterations per session (passed to Claude CLI)
   * Default: 50
   */
  maxIterationsPerSession?: number;

  /**
   * Timeout per session in milliseconds
   * Default: 600000 (10 minutes)
   */
  sessionTimeout?: number;

  /**
   * Working directory for AI execution
   */
  workingDirectory?: string;

  /**
   * Variable name to store the final workflow results
   */
  outputVariable?: string;

  /**
   * Human-readable description of this workflow
   */
  description?: string;
}
