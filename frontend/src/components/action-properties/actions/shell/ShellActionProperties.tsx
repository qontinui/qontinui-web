/**
 * ShellActionProperties Component
 *
 * Configuration UI for SHELL and SHELL_SCRIPT action types.
 * Allows users to configure shell command execution with various options.
 */

import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import {
  ShellActionConfig,
  ShellScriptActionConfig,
} from "@/lib/action-schema/configs/shell-actions";
import {
  Terminal,
  FileTerminal,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import Editor from "@monaco-editor/react";

type ShellType = "bash" | "sh" | "powershell" | "cmd" | "zsh";
type OutputFormat = "text" | "json" | "lines" | "none";

const SHELL_OPTIONS: { value: ShellType; label: string }[] = [
  { value: "bash", label: "Bash" },
  { value: "sh", label: "Shell (sh)" },
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt (cmd)" },
  { value: "zsh", label: "Zsh" },
];

const OUTPUT_FORMAT_OPTIONS: {
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

/**
 * ShellActionProperties - Properties component for SHELL action
 */
export function ShellActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as ShellActionConfig;
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <>
      {/* Command */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400 flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Command
        </Label>
        <Input
          type="text"
          value={config.command || ""}
          onChange={(e) => updateConfig("command", e.target.value)}
          placeholder="echo 'Hello World'"
          className="bg-transparent border-gray-700 font-mono text-sm"
        />
        <p className="text-xs text-gray-500">The shell command to execute</p>
      </div>

      {/* Shell Type */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Shell</Label>
        <Select
          value={config.shell || "bash"}
          onValueChange={(value) => updateConfig("shell", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            {SHELL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Output Format */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Output Format</Label>
        <Select
          value={config.outputFormat || "text"}
          onValueChange={(value) => updateConfig("outputFormat", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            {OUTPUT_FORMAT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div>
                  <span>{opt.label}</span>
                  <span className="text-gray-500 ml-2 text-xs">
                    - {opt.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Output Variable */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Output Variable</Label>
        <Input
          type="text"
          value={config.outputVariable || ""}
          onChange={(e) =>
            updateConfig("outputVariable", e.target.value || undefined)
          }
          placeholder="command_output"
          className="bg-transparent border-gray-700"
        />
        <p className="text-xs text-gray-500">
          Store command output in this workflow variable
        </p>
      </div>

      <Separator className="bg-gray-700" />

      {/* Advanced Configuration */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300">
          {showAdvanced ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Advanced Configuration
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-3">
          {/* Working Directory */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Working Directory</Label>
            <Input
              type="text"
              value={config.workingDirectory || ""}
              onChange={(e) =>
                updateConfig("workingDirectory", e.target.value || undefined)
              }
              placeholder="/path/to/directory"
              className="bg-transparent border-gray-700"
            />
          </div>

          {/* Exit Code Variable */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Exit Code Variable</Label>
            <Input
              type="text"
              value={config.exitCodeVariable || ""}
              onChange={(e) =>
                updateConfig("exitCodeVariable", e.target.value || undefined)
              }
              placeholder="exit_code"
              className="bg-transparent border-gray-700"
            />
          </div>

          {/* Capture Stderr */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">Capture Stderr</Label>
            <Switch
              checked={config.captureStderr || false}
              onCheckedChange={(checked) =>
                updateConfig("captureStderr", checked)
              }
            />
          </div>

          {/* Stderr Variable */}
          {config.captureStderr && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Stderr Variable</Label>
              <Input
                type="text"
                value={config.stderrVariable || ""}
                onChange={(e) =>
                  updateConfig("stderrVariable", e.target.value || undefined)
                }
                placeholder="stderr_output"
                className="bg-transparent border-gray-700"
              />
            </div>
          )}

          {/* Stdin */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Stdin Input</Label>
            <Textarea
              value={config.stdin || ""}
              onChange={(e) =>
                updateConfig("stdin", e.target.value || undefined)
              }
              placeholder="Input to pass to command..."
              className="bg-transparent border-gray-700 min-h-[60px] font-mono text-sm"
            />
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Timeout (ms)</Label>
            <Input
              type="number"
              min="1000"
              max="600000"
              value={config.timeout || 30000}
              onChange={(e) => updateConfig("timeout", Number(e.target.value))}
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              Max execution time in milliseconds
            </p>
          </div>

          {/* Fail on Error */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">
              Fail on Non-Zero Exit
            </Label>
            <Switch
              checked={config.failOnError !== false}
              onCheckedChange={(checked) =>
                updateConfig("failOnError", checked)
              }
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Description</Label>
            <Textarea
              value={config.description || ""}
              onChange={(e) =>
                updateConfig("description", e.target.value || undefined)
              }
              placeholder="Describe what this command does..."
              className="bg-transparent border-gray-700 min-h-[60px]"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator className="bg-gray-700" />

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />

      {/* Help Text */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 dark:text-blue-100">
          <p className="font-medium mb-1">Shell Command Execution</p>
          <p>
            Execute shell commands and capture their output. Use JSON output
            format to automatically parse structured data from CLI tools.
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * ShellScriptActionProperties - Properties component for SHELL_SCRIPT action
 */
export function ShellScriptActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as ShellScriptActionConfig;
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Determine language for Monaco editor based on shell type
  const getEditorLanguage = (shell: ShellType | undefined): string => {
    switch (shell) {
      case "powershell":
        return "powershell";
      case "cmd":
        return "bat";
      default:
        return "shell";
    }
  };

  return (
    <>
      {/* Script */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400 flex items-center gap-2">
          <FileTerminal className="w-4 h-4" />
          Script
        </Label>
        <div className="border border-gray-700 rounded overflow-hidden">
          <Editor
            height="200px"
            language={getEditorLanguage(config.shell)}
            value={config.script || ""}
            onChange={(value) => updateConfig("script", value || "")}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
            }}
          />
        </div>
        <p className="text-xs text-gray-500">
          Multi-line shell script to execute
        </p>
      </div>

      {/* Shell Type */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Shell</Label>
        <Select
          value={config.shell || "bash"}
          onValueChange={(value) => updateConfig("shell", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            {SHELL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Output Format */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Output Format</Label>
        <Select
          value={config.outputFormat || "text"}
          onValueChange={(value) => updateConfig("outputFormat", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            {OUTPUT_FORMAT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div>
                  <span>{opt.label}</span>
                  <span className="text-gray-500 ml-2 text-xs">
                    - {opt.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Output Variable */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Output Variable</Label>
        <Input
          type="text"
          value={config.outputVariable || ""}
          onChange={(e) =>
            updateConfig("outputVariable", e.target.value || undefined)
          }
          placeholder="script_output"
          className="bg-transparent border-gray-700"
        />
        <p className="text-xs text-gray-500">
          Store script output in this workflow variable
        </p>
      </div>

      <Separator className="bg-gray-700" />

      {/* Advanced Configuration */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300">
          {showAdvanced ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Advanced Configuration
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-3">
          {/* Working Directory */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Working Directory</Label>
            <Input
              type="text"
              value={config.workingDirectory || ""}
              onChange={(e) =>
                updateConfig("workingDirectory", e.target.value || undefined)
              }
              placeholder="/path/to/directory"
              className="bg-transparent border-gray-700"
            />
          </div>

          {/* Exit Code Variable */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Exit Code Variable</Label>
            <Input
              type="text"
              value={config.exitCodeVariable || ""}
              onChange={(e) =>
                updateConfig("exitCodeVariable", e.target.value || undefined)
              }
              placeholder="exit_code"
              className="bg-transparent border-gray-700"
            />
          </div>

          {/* Capture Stderr */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">Capture Stderr</Label>
            <Switch
              checked={config.captureStderr || false}
              onCheckedChange={(checked) =>
                updateConfig("captureStderr", checked)
              }
            />
          </div>

          {/* Stderr Variable */}
          {config.captureStderr && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Stderr Variable</Label>
              <Input
                type="text"
                value={config.stderrVariable || ""}
                onChange={(e) =>
                  updateConfig("stderrVariable", e.target.value || undefined)
                }
                placeholder="stderr_output"
                className="bg-transparent border-gray-700"
              />
            </div>
          )}

          {/* Stdin */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Stdin Input</Label>
            <Textarea
              value={config.stdin || ""}
              onChange={(e) =>
                updateConfig("stdin", e.target.value || undefined)
              }
              placeholder="Input to pass to script..."
              className="bg-transparent border-gray-700 min-h-[60px] font-mono text-sm"
            />
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Timeout (ms)</Label>
            <Input
              type="number"
              min="1000"
              max="600000"
              value={config.timeout || 60000}
              onChange={(e) => updateConfig("timeout", Number(e.target.value))}
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              Max execution time in milliseconds
            </p>
          </div>

          {/* Fail on Error */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">
              Fail on Non-Zero Exit
            </Label>
            <Switch
              checked={config.failOnError !== false}
              onCheckedChange={(checked) =>
                updateConfig("failOnError", checked)
              }
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Description</Label>
            <Textarea
              value={config.description || ""}
              onChange={(e) =>
                updateConfig("description", e.target.value || undefined)
              }
              placeholder="Describe what this script does..."
              className="bg-transparent border-gray-700 min-h-[60px]"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator className="bg-gray-700" />

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />

      {/* Help Text */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 dark:text-blue-100">
          <p className="font-medium mb-1">Shell Script Execution</p>
          <p>
            Execute multi-line shell scripts. The script runs in the selected
            shell and can capture output in workflow variables. Use JSON output
            format to automatically parse structured data.
          </p>
        </div>
      </div>
    </>
  );
}
