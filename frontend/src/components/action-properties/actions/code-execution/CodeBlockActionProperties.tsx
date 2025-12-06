/**
 * CodeBlockActionProperties Component
 *
 * Configuration UI for CODE_BLOCK action type.
 * Allows users to configure Python code execution with inline code or external files.
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import { CodeBlockActionConfig } from "@/lib/action-schema/configs/code-actions";
import { PythonFileBrowser } from "@/components/code-execution/PythonFileBrowser";
import { useCodeExecutionFiles } from "@/hooks/useCodeExecutionFiles";
import { useAutomation } from "@/contexts/automation-context";
import {
  FileCode,
  Code,
  Info,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import Editor from "@monaco-editor/react";

/**
 * CodeBlockActionProperties - Main properties component for CODE_BLOCK action
 */
export function CodeBlockActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as CodeBlockActionConfig;
  const { projectId } = useAutomation();
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inputKey, setInputKey] = useState("");
  const [inputValue, setInputValue] = useState("");

  // Fetch Python files for file browser
  const { files, isLoading, error, refresh } = useCodeExecutionFiles({
    projectId: projectId ? parseInt(projectId, 10) : undefined,
    autoLoad: config.codeSource === "file",
  });

  // Handle code source change
  const handleCodeSourceChange = (value: "inline" | "file") => {
    updateConfig("codeSource", value);
    if (value === "file") {
      setShowFileBrowser(true);
    }
  };

  // Handle file selection
  const handleFileSelect = (path: string) => {
    updateConfig("filePath", path);
    setShowFileBrowser(false);
  };

  // Handle input mapping add
  const handleAddInput = () => {
    if (inputKey && inputValue) {
      updateConfig("inputs", {
        ...(config.inputs || {}),
        [inputKey]: inputValue,
      });
      setInputKey("");
      setInputValue("");
    }
  };

  // Handle input mapping remove
  const handleRemoveInput = (key: string) => {
    const newInputs = { ...(config.inputs || {}) };
    delete newInputs[key];
    updateConfig("inputs", newInputs);
  };

  // Handle output variable change
  const handleOutputVariableChange = (value: string) => {
    // Check if comma-separated (multiple outputs)
    if (value.includes(",")) {
      const outputs = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      updateConfig("outputVariable", outputs);
    } else {
      updateConfig("outputVariable", value || undefined);
    }
  };

  const codeSource = config.codeSource || "inline";

  return (
    <>
      {/* Code Source Selection */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400 flex items-center gap-2">
          Code Source
          <span title="Choose between inline code or external Python file">
            <Info className="w-3 h-3" />
          </span>
        </Label>
        <Select value={codeSource} onValueChange={handleCodeSourceChange}>
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="inline">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4" />
                <span>Inline Code</span>
              </div>
            </SelectItem>
            <SelectItem value="file">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4" />
                <span>External File</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Inline Code Editor */}
      {codeSource === "inline" && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Python Code</Label>
          <div className="border border-gray-700 rounded overflow-hidden">
            <Editor
              height="200px"
              defaultLanguage="python"
              value={config.code || ""}
              onChange={(value) => updateConfig("code", value || "")}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
              }}
            />
          </div>
          <p className="text-xs text-gray-500">
            Available variables: action_result, context, variables
          </p>
        </div>
      )}

      {/* File Path Selection */}
      {codeSource === "file" && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Python File</Label>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={config.filePath || ""}
              onChange={(e) => updateConfig("filePath", e.target.value)}
              placeholder="scripts/my_script.py"
              className="bg-transparent border-gray-700 flex-1"
              readOnly={showFileBrowser}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFileBrowser(!showFileBrowser)}
            >
              <FileCode className="w-4 h-4 mr-1" />
              Browse
            </Button>
          </div>

          {/* File Browser */}
          {showFileBrowser && (
            <div className="mt-3 p-3 border border-gray-700 rounded bg-[#1E1E1E]">
              <PythonFileBrowser
                selectedPath={config.filePath}
                onSelectFile={handleFileSelect}
                files={files}
                isLoading={isLoading}
                error={error}
                onRefresh={refresh}
                height="300px"
              />
            </div>
          )}

          {/* Function Name */}
          <div className="space-y-2 mt-3">
            <Label className="text-xs text-gray-400 flex items-center gap-2">
              Function Name (Optional)
              <span title="Leave empty to execute entire file">
                <Info className="w-3 h-3" />
              </span>
            </Label>
            <Input
              type="text"
              value={config.functionName || ""}
              onChange={(e) => updateConfig("functionName", e.target.value)}
              placeholder="my_function"
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              If specified, calls this function with inputs as kwargs
            </p>
          </div>
        </div>
      )}

      <Separator className="bg-gray-700" />

      {/* Input Mappings */}
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
          {/* Inputs */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Input Mappings</Label>
            <div className="space-y-2">
              {config.inputs &&
                Object.entries(config.inputs).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <Badge variant="secondary" className="flex-1">
                      {key} = {value}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveInput(key)}
                      className="h-6 w-6"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="Variable name"
                className="bg-transparent border-gray-700 flex-1"
              />
              <span className="text-gray-500">=</span>
              <Input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Workflow variable"
                className="bg-transparent border-gray-700 flex-1"
              />
              <Button variant="outline" size="icon" onClick={handleAddInput}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Map workflow variables to Python variable names
            </p>
          </div>

          {/* Output Variable */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Output Variable</Label>
            <Input
              type="text"
              value={
                Array.isArray(config.outputVariable)
                  ? config.outputVariable.join(", ")
                  : config.outputVariable || ""
              }
              onChange={(e) => handleOutputVariableChange(e.target.value)}
              placeholder="result (or: price, success, message)"
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              Single variable or comma-separated for multiple outputs
            </p>
          </div>

          {/* Include Previous Result */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">
              Include Previous Result
            </Label>
            <Switch
              checked={config.includePreviousResult !== false}
              onCheckedChange={(checked) =>
                updateConfig("includePreviousResult", checked)
              }
            />
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Timeout (seconds)</Label>
            <Input
              type="number"
              min="1"
              max="60"
              value={config.timeout || 30}
              onChange={(e) => updateConfig("timeout", Number(e.target.value))}
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">Max: 60 seconds</p>
          </div>

          {/* Debug Mode */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-gray-400">Debug Mode</Label>
            <Switch
              checked={config.debug || false}
              onCheckedChange={(checked) => updateConfig("debug", checked)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Description</Label>
            <Textarea
              value={config.description || ""}
              onChange={(e) => updateConfig("description", e.target.value)}
              placeholder="Describe what this code does..."
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
          <p className="font-medium mb-1">Code Execution</p>
          <p>
            Python code runs in a sandboxed environment with restricted imports
            and resource limits.
            {codeSource === "inline"
              ? " Use the Monaco editor for syntax highlighting."
              : " Select a .py file from your project directory."}
          </p>
        </div>
      </div>
    </>
  );
}
