/**
 * Shell/command execution action configurations
 *
 * Enables execution of shell commands and scripts within workflows for
 * system integration, CLI tool automation, and programmatic interactions.
 */

/**
 * SHELL - Execute a shell command
 *
 * Executes a single shell command and captures its output.
 * Supports various output formats including JSON parsing.
 *
 * Use cases:
 * - Execute CLI tools (e.g., `claude -p "prompt" --output-format json`)
 * - Run system commands
 * - Integrate with external APIs via curl
 * - Automate command-line applications
 */
export interface ShellActionConfig {
  /**
   * The shell command to execute
   *
   * Examples:
   * - "echo 'Hello World'"
   * - "claude -p 'Analyze this' --output-format json"
   * - "curl -s https://api.example.com/data"
   */
  command: string;

  /**
   * Shell to use for execution
   * - bash: Bash shell (default on Unix)
   * - sh: POSIX shell
   * - powershell: PowerShell
   * - cmd: Windows Command Prompt
   * - zsh: Z shell
   *
   * If not specified, uses system default (sh on Unix, cmd on Windows)
   */
  shell?: "bash" | "sh" | "powershell" | "cmd" | "zsh";

  /**
   * Working directory for command execution
   * If not specified, uses the current working directory
   */
  workingDirectory?: string;

  /**
   * Additional environment variables for the command
   * Merged with current environment variables
   */
  environment?: Record<string, string>;

  /**
   * How to parse the command output
   * - text: Return as plain string (default)
   * - json: Parse as JSON object
   * - lines: Split into list of lines
   * - none: Discard output
   */
  outputFormat?: "text" | "json" | "lines" | "none";

  /**
   * Variable name to store the command output
   * The output format determines the variable type
   */
  outputVariable?: string;

  /**
   * Variable name to store the exit code
   */
  exitCodeVariable?: string;

  /**
   * Whether to capture stderr separately from stdout
   * Default: false
   */
  captureStderr?: boolean;

  /**
   * Variable name to store stderr output
   * Only used if captureStderr is true
   */
  stderrVariable?: string;

  /**
   * Command timeout in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Whether to fail the action if command returns non-zero exit code
   * Default: true
   */
  failOnError?: boolean;

  /**
   * Input to send to the command's stdin
   */
  stdin?: string;

  /**
   * Human-readable description of what this command does
   */
  description?: string;
}

/**
 * SHELL_SCRIPT - Execute a multi-line shell script
 *
 * Executes a multi-line shell script. Similar to SHELL but optimized
 * for longer scripts with multiple commands.
 */
export interface ShellScriptActionConfig {
  /**
   * The shell script to execute (multi-line supported)
   *
   * Example:
   * ```
   * #!/bin/bash
   * echo "Starting process..."
   * result=$(some_command)
   * echo "Result: $result"
   * ```
   */
  script: string;

  /**
   * Shell to use for script execution
   * Default: bash
   */
  shell?: "bash" | "sh" | "powershell" | "cmd" | "zsh";

  /**
   * Working directory for script execution
   */
  workingDirectory?: string;

  /**
   * Additional environment variables for the script
   */
  environment?: Record<string, string>;

  /**
   * How to parse the script output
   */
  outputFormat?: "text" | "json" | "lines" | "none";

  /**
   * Variable name to store the script output
   */
  outputVariable?: string;

  /**
   * Variable name to store the exit code
   */
  exitCodeVariable?: string;

  /**
   * Whether to capture stderr separately
   */
  captureStderr?: boolean;

  /**
   * Variable name to store stderr output
   */
  stderrVariable?: string;

  /**
   * Script timeout in milliseconds
   * Default: 60000 (60 seconds)
   */
  timeout?: number;

  /**
   * Whether to fail the action if script returns non-zero exit code
   * Default: true
   */
  failOnError?: boolean;

  /**
   * Input to send to the script's stdin
   */
  stdin?: string;

  /**
   * Human-readable description of what this script does
   */
  description?: string;
}

/**
 * TRIGGER_AI_ANALYSIS - Trigger AI to analyze automation results
 *
 * Invokes an AI assistant to analyze automation results, identify issues,
 * and potentially fix them. Designed for autonomous debugging workflows.
 *
 * IMPORTANT: This action runs with bypassed permissions, allowing the AI
 * to make changes without interactive confirmation.
 *
 * Use cases:
 * - Autonomous error detection and correction
 * - Post-workflow analysis and reporting
 * - Self-healing automation workflows
 */
export interface TriggerAiAnalysisActionConfig {
  /**
   * AI provider to use for analysis
   * - claude: Claude Code CLI (default)
   *
   * Future providers may include other AI assistants.
   */
  provider?: "claude";

  /**
   * The prompt or command to send to the AI.
   *
   * This can be:
   * - A slash command (e.g., "/analyze-automation", "/qa")
   * - A natural language prompt
   * - Any text that will be passed to the AI
   *
   * Example slash commands:
   * - "/analyze-automation" - Analyze automation results and fix issues
   * - "/qa" - Run QA analysis on results
   *
   * IMPORTANT: The AI runs with bypassed permissions when executing this prompt.
   */
  prompt?: string;

  /**
   * Analysis timeout in milliseconds
   * Default: 600000 (10 minutes)
   */
  timeout?: number;

  /**
   * Path to automation results directory
   * Defaults to .automation-results/latest relative to project root
   */
  resultsDirectory?: string;

  /**
   * Working directory for AI execution
   */
  workingDirectory?: string;

  /**
   * Whether to fail the action if AI reports issues found
   * Default: false (analysis completing is success)
   */
  failOnIssues?: boolean;

  /**
   * Variable name to store the analysis output
   */
  outputVariable?: string;

  /**
   * Human-readable description of this analysis trigger
   */
  description?: string;
}
