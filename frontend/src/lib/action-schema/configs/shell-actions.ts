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
