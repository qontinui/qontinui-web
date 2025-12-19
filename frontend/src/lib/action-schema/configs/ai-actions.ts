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
