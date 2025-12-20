/**
 * RunPromptSequenceActionProperties Component
 *
 * Configuration UI for RUN_PROMPT_SEQUENCE action type.
 * Allows users to configure multi-step AI prompt sequences with context isolation.
 */

import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ActionPropertiesComponentProps } from "../../types";
import { TimingProperties } from "../../TimingProperties";
import { RunPromptSequenceActionConfig } from "@/lib/action-schema/configs/ai-actions";
import {
  ListOrdered,
  Sparkles,
  Info,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * RunPromptSequenceActionProperties - Properties component for RUN_PROMPT_SEQUENCE action
 */
export function RunPromptSequenceActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const config = action.config as unknown as RunPromptSequenceActionConfig;
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Check if using sequence ID or inline sequence
  const usingSequenceId = !!config.sequenceId;

  return (
    <>
      {/* Info Box */}
      <div className="flex items-start gap-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded">
        <ListOrdered className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-indigo-900 dark:text-indigo-100">
          <p className="font-medium mb-1">Multi-Step AI Sequence</p>
          <p>
            Execute a sequence of AI prompts with context isolation. Each step
            runs in a fresh AI session to prevent overflow. Ideal for complex
            workflows like code improvement pipelines.
          </p>
        </div>
      </div>

      {/* Sequence Source */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Sequence Source</Label>
        <div className="flex gap-2">
          <button
            type="button"
            className={`flex-1 px-3 py-2 text-sm rounded border ${
              usingSequenceId
                ? "bg-indigo-500 border-indigo-500 text-white"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-indigo-500"
            }`}
            onClick={() => {
              updateConfig("sequenceId", "");
              updateConfig("inlineSequence", undefined);
            }}
          >
            Sequence ID
          </button>
          <button
            type="button"
            className={`flex-1 px-3 py-2 text-sm rounded border ${
              !usingSequenceId
                ? "bg-indigo-500 border-indigo-500 text-white"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-indigo-500"
            }`}
            onClick={() => {
              updateConfig("sequenceId", undefined);
              updateConfig("inlineSequence", {
                id: "inline-sequence",
                name: "Inline Sequence",
                steps: [],
              });
            }}
          >
            Inline Sequence
          </button>
        </div>
      </div>

      {/* Sequence ID (if using sequence ID) */}
      {usingSequenceId && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Sequence ID
          </Label>
          <Input
            type="text"
            value={config.sequenceId || ""}
            onChange={(e) => updateConfig("sequenceId", e.target.value)}
            placeholder="full-code-improvement"
            className="bg-transparent border-gray-700"
          />
          <p className="text-xs text-gray-500">
            Reference to a prompt sequence from the library
          </p>
        </div>
      )}

      {/* Inline Sequence (if not using sequence ID) */}
      {!usingSequenceId && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-400 flex items-center gap-2">
            <ListOrdered className="w-4 h-4" />
            Inline Sequence Definition
          </Label>
          <Textarea
            value={
              config.inlineSequence
                ? JSON.stringify(config.inlineSequence, null, 2)
                : ""
            }
            onChange={(e) => {
              try {
                const sequence = e.target.value
                  ? JSON.parse(e.target.value)
                  : undefined;
                updateConfig("inlineSequence", sequence);
              } catch {
                // Invalid JSON, don't update
              }
            }}
            placeholder={`{
  "id": "quick-fix",
  "name": "Quick Fix",
  "steps": [
    {"id": "s1", "inlinePrompt": "Fix linting errors"},
    {"id": "s2", "inlinePrompt": "Run tests"}
  ]
}`}
            className="bg-transparent border-gray-700 min-h-[150px] font-mono text-sm"
          />
          <p className="text-xs text-gray-500">
            JSON object defining the sequence steps
          </p>
        </div>
      )}

      {/* Parameter Overrides */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Parameter Overrides</Label>
        <Textarea
          value={
            config.parameterOverrides
              ? JSON.stringify(config.parameterOverrides, null, 2)
              : ""
          }
          onChange={(e) => {
            try {
              const params = e.target.value
                ? JSON.parse(e.target.value)
                : undefined;
              updateConfig("parameterOverrides", params);
            } catch {
              // Invalid JSON, don't update
            }
          }}
          placeholder='{"module_path": "src/core"}'
          className="bg-transparent border-gray-700 min-h-[80px] font-mono text-sm"
        />
        <p className="text-xs text-gray-500">
          Parameter values to apply to all steps (JSON)
        </p>
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
          placeholder="sequence_results"
          className="bg-transparent border-gray-700"
        />
        <p className="text-xs text-gray-500">
          Store sequence results summary in this workflow variable
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
            <p className="text-xs text-gray-500">
              Working directory for all steps
            </p>
          </div>

          {/* Results Directory */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Results Directory</Label>
            <Input
              type="text"
              value={config.resultsDirectory || ""}
              onChange={(e) =>
                updateConfig("resultsDirectory", e.target.value || undefined)
              }
              placeholder=".automation-results/sequence"
              className="bg-transparent border-gray-700"
            />
            <p className="text-xs text-gray-500">
              Directory to store step results
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-400">Description</Label>
            <Textarea
              value={config.description || ""}
              onChange={(e) =>
                updateConfig("description", e.target.value || undefined)
              }
              placeholder="Describe what this sequence does..."
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
          <p className="font-medium mb-1">Sequence Execution</p>
          <p>
            Each step in the sequence runs in a fresh AI context to avoid
            overflow. Results are persisted between steps via files/variables.
            Perfect for complex multi-stage workflows like code quality
            pipelines.
          </p>
        </div>
      </div>

      {/* Context Isolation Warning */}
      <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-700 rounded">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 dark:text-amber-200">
          <p className="font-medium mb-1">Context Isolation</p>
          <p>
            Each step runs independently with no shared conversation history.
            Steps must communicate via variables and files. This prevents
            context overflow but requires careful output management.
          </p>
        </div>
      </div>
    </>
  );
}
