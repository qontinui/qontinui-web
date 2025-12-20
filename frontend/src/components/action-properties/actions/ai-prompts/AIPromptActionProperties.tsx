/**
 * AIPromptActionProperties Component
 *
 * Configuration UI for AI_PROMPT action type.
 * Allows users to configure AI prompt execution with templates and parameters.
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
import { AIPromptActionConfig } from "@/lib/action-schema/configs/ai-actions";
import {
  Brain,
  Sparkles,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type AiProvider = "claude";

const AI_PROVIDER_OPTIONS: {
  value: AiProvider;
  label: string;
  description: string;
}[] = [{ value: "claude", label: "Claude", description: "Claude Code CLI" }];

/**
 * AIPromptActionProperties - Properties component for AI_PROMPT action
 */
export function AIPromptActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as AIPromptActionConfig;
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Check if using template or inline prompt
  const usingTemplate = !!config.templateId;

  return (
    <>
      {/* Info Box */}
      <div className="flex items-start gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded">
        <Sparkles className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-purple-900 dark:text-purple-100">
          <p className="font-medium mb-1">AI-Powered Automation</p>
          <p>
            Execute AI prompts to analyze code, fix issues, generate tests, or
            perform other AI-assisted tasks. Runs in fresh context to prevent
            overflow.
          </p>
        </div>
      </div>

      {/* AI Provider */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400 flex items-center gap-2">
          <Brain className="w-4 h-4" />
          AI Provider
        </Label>
        <Select
          value={config.provider || "claude"}
          onValueChange={(value) => updateConfig("provider", value)}
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            {AI_PROVIDER_OPTIONS.map((opt) => (
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

      {/* Template ID or Inline Prompt */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Prompt Source</Label>
        <div className="flex gap-2">
          <button
            type="button"
            className={`flex-1 px-3 py-2 text-sm rounded border ${
              !usingTemplate
                ? "bg-purple-500 border-purple-500 text-white"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-purple-500"
            }`}
            onClick={() => {
              updateConfig("templateId", undefined);
              updateConfig("templateParameters", undefined);
            }}
          >
            Inline Prompt
          </button>
          <button
            type="button"
            className={`flex-1 px-3 py-2 text-sm rounded border ${
              usingTemplate
                ? "bg-purple-500 border-purple-500 text-white"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-purple-500"
            }`}
            onClick={() => {
              updateConfig("templateId", "");
              updateConfig("prompt", undefined);
            }}
          >
            Template
          </button>
        </div>
      </div>

      {/* Template ID (if using template) */}
      {usingTemplate && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Template ID</Label>
          <Input
            type="text"
            value={config.templateId || ""}
            onChange={(e) => updateConfig("templateId", e.target.value)}
            placeholder="fix-type-errors"
            className="bg-transparent border-gray-700"
          />
          <p className="text-xs text-gray-500">
            Reference to a prompt template from the library
          </p>
        </div>
      )}

      {/* Template Parameters (if using template) */}
      {usingTemplate && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">Template Parameters</Label>
          <Textarea
            value={
              config.templateParameters
                ? JSON.stringify(config.templateParameters, null, 2)
                : ""
            }
            onChange={(e) => {
              try {
                const params = e.target.value
                  ? JSON.parse(e.target.value)
                  : undefined;
                updateConfig("templateParameters", params);
              } catch {
                // Invalid JSON, don't update
              }
            }}
            placeholder='{"module_path": "src/core"}'
            className="bg-transparent border-gray-700 min-h-[80px] font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            JSON object with parameter values
          </p>
        </div>
      )}

      {/* Inline Prompt (if not using template) */}
      {!usingTemplate && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Prompt
          </Label>
          <Textarea
            value={config.prompt || ""}
            onChange={(e) => updateConfig("prompt", e.target.value)}
            placeholder="Fix all type errors in the current project"
            className="bg-transparent border-gray-700 min-h-[100px] font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            Enter a natural language prompt or slash command (e.g.,{" "}
            <code className="bg-gray-700 px-1 rounded">
              /analyze-automation
            </code>
            )
          </p>
        </div>
      )}

      {/* Fresh Context */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs text-gray-400">Fresh Context</Label>
          <p className="text-xs text-gray-500">
            Start new AI session (recommended)
          </p>
        </div>
        <Switch
          checked={config.freshContext !== false}
          onCheckedChange={(checked) => updateConfig("freshContext", checked)}
        />
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
          placeholder="ai_result"
          className="bg-transparent border-gray-700"
        />
        <p className="text-xs text-gray-500">
          Store AI output in this workflow variable
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
              placeholder="/path/to/project"
              className="bg-transparent border-gray-700"
            />
          </div>

          {/* Results Directory (legacy) */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">
              Results Directory <span className="text-gray-600">(legacy)</span>
            </Label>
            <Input
              type="text"
              value={config.resultsDirectory || ""}
              onChange={(e) =>
                updateConfig("resultsDirectory", e.target.value || undefined)
              }
              placeholder=".automation-results/latest"
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              For analysis prompts (backward compatibility)
            </p>
          </div>

          {/* Output File */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Output File</Label>
            <Input
              type="text"
              value={config.outputFile || ""}
              onChange={(e) =>
                updateConfig("outputFile", e.target.value || undefined)
              }
              placeholder="/path/to/output.txt"
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              File path to write AI output
            </p>
          </div>

          {/* Timeout */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Timeout (ms)</Label>
            <Input
              type="number"
              min="60000"
              max="1800000"
              value={config.timeout || 600000}
              onChange={(e) => updateConfig("timeout", Number(e.target.value))}
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              Max execution time in milliseconds (default: 10 minutes)
            </p>
          </div>

          {/* Fail on Error */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs text-gray-400">Fail on Error</Label>
              <p className="text-xs text-gray-500">
                Fail action if AI execution fails
              </p>
            </div>
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
              placeholder="Describe what this prompt does..."
              className="bg-transparent border-gray-700 min-h-[60px]"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator className="bg-gray-700" />

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />

      {/* Warning about context isolation */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
        <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 dark:text-blue-100">
          <p className="font-medium mb-1">Context Isolation</p>
          <p>
            When Fresh Context is enabled, each prompt runs in a new AI session
            to prevent context overflow. This is ideal for large operations but
            loses conversation history.
          </p>
        </div>
      </div>
    </>
  );
}
