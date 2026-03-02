import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import {
  ShellActionConfig,
  ShellScriptActionConfig,
} from "@/lib/action-schema/configs/shell-actions";
import { Terminal, FileTerminal } from "lucide-react";
import Editor from "@monaco-editor/react";
import type { ShellType } from "./types";
import { ShellTypeSelect } from "./_components/ShellTypeSelect";
import { OutputFormatSelect } from "./_components/OutputFormatSelect";
import { OutputVariableInput } from "./_components/OutputVariableInput";
import { AdvancedShellConfig } from "./_components/AdvancedShellConfig";
import { ShellHelpText } from "./_components/ShellHelpText";

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

export function ShellActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as ShellActionConfig;

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Command
        </Label>
        <Input
          type="text"
          value={config.command || ""}
          onChange={(e) => updateConfig("command", e.target.value)}
          placeholder="echo 'Hello World'"
          className="bg-transparent border-border-default font-mono text-sm"
        />
        <p className="text-xs text-text-muted">The shell command to execute</p>
      </div>

      <ShellTypeSelect value={config.shell} updateConfig={updateConfig} />
      <OutputFormatSelect
        value={config.outputFormat}
        updateConfig={updateConfig}
      />
      <OutputVariableInput
        value={config.outputVariable}
        updateConfig={updateConfig}
        placeholder="command_output"
        helpText="Store command output in this workflow variable"
      />

      <Separator className="bg-border-default" />

      <AdvancedShellConfig
        config={config}
        updateConfig={updateConfig}
        defaultTimeout={30000}
        stdinPlaceholder="Input to pass to command..."
      />

      <Separator className="bg-border-default" />

      <TimingProperties action={action} updateConfig={updateConfig} />

      <ShellHelpText
        title="Shell Command Execution"
        description="Execute shell commands and capture their output. Use JSON output format to automatically parse structured data from CLI tools."
      />
    </>
  );
}

export function ShellScriptActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as ShellScriptActionConfig;

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-text-muted flex items-center gap-2">
          <FileTerminal className="w-4 h-4" />
          Script
        </Label>
        <div className="border border-border-default rounded overflow-hidden">
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
        <p className="text-xs text-text-muted">
          Multi-line shell script to execute
        </p>
      </div>

      <ShellTypeSelect value={config.shell} updateConfig={updateConfig} />
      <OutputFormatSelect
        value={config.outputFormat}
        updateConfig={updateConfig}
      />
      <OutputVariableInput
        value={config.outputVariable}
        updateConfig={updateConfig}
        placeholder="script_output"
        helpText="Store script output in this workflow variable"
      />

      <Separator className="bg-border-default" />

      <AdvancedShellConfig
        config={config}
        updateConfig={updateConfig}
        defaultTimeout={60000}
        stdinPlaceholder="Input to pass to script..."
      />

      <Separator className="bg-border-default" />

      <TimingProperties action={action} updateConfig={updateConfig} />

      <ShellHelpText
        title="Shell Script Execution"
        description="Execute multi-line shell scripts. The script runs in the selected shell and can capture output in workflow variables. Use JSON output format to automatically parse structured data."
      />
    </>
  );
}
