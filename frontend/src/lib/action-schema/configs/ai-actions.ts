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
   * Task name for the runner UI and logs
   * Default: "ai-analysis"
   */
  name?: string;

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
   * Maximum number of sessions to spawn.
   * 1 = one-shot (no auto-continuation)
   * null/undefined = unlimited auto-continuation until [TASK_COMPLETE]
   * Default: 1
   */
  maxSessions?: number | null;

  /**
   * URL of the qontinui-runner API
   * Default: "http://localhost:9876"
   */
  runnerUrl?: string;

  /**
   * Paths to images for the AI to analyze
   */
  imagePaths?: string[];

  /**
   * Paths to videos for frame extraction and analysis
   */
  videoPaths?: string[];

  /**
   * Path to Playwright trace file for analysis
   */
  tracePath?: string;

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
