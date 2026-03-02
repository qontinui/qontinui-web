export type ShellType = "bash" | "sh" | "powershell" | "cmd" | "zsh";
export type OutputFormat = "text" | "json" | "lines" | "none";

export const SHELL_OPTIONS: { value: ShellType; label: string }[] = [
  { value: "bash", label: "Bash" },
  { value: "sh", label: "Shell (sh)" },
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt (cmd)" },
  { value: "zsh", label: "Zsh" },
];

export const OUTPUT_FORMAT_OPTIONS: {
  value: OutputFormat;
  label: string;
  description: string;
}[] = [
  { value: "text", label: "Text", description: "Capture as plain text" },
  { value: "json", label: "JSON", description: "Parse output as JSON" },
  {
    value: "lines",
    label: "Lines",
    description: "Split output into array of lines",
  },
  { value: "none", label: "None", description: "Don't capture output" },
];

export interface SharedShellConfig {
  shell?: ShellType;
  outputFormat?: OutputFormat;
  outputVariable?: string;
  workingDirectory?: string;
  exitCodeVariable?: string;
  captureStderr?: boolean;
  stderrVariable?: string;
  stdin?: string;
  timeout?: number;
  failOnError?: boolean;
  description?: string;
}

export type UpdateConfigFn = (
  key: string,
  value: unknown,
  additionalUpdates?: Record<string, unknown>
) => void;
