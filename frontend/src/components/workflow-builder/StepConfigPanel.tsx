"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  WorkflowPhase,
  CommandStep,
  TestStep,
  UiBridgeStep,
  PromptStep,
  TestType,
  PlaywrightExecutionMode,
} from "@/types/unified-workflow";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";

// =============================================================================
// Command Step Config
// =============================================================================

function CommandConfig({
  step,
  onUpdate,
}: {
  step: CommandStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Command
        </label>
        <textarea
          className="w-full min-h-[80px] px-3 py-1.5 font-mono bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          placeholder="e.g., git status"
          value={step.command ?? ""}
          onChange={(e) => onUpdate({ command: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Working Directory
        </label>
        <input
          type="text"
          className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          placeholder="Relative to project root"
          value={step.working_directory ?? ""}
          onChange={(e) =>
            onUpdate({ working_directory: e.target.value || undefined })
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Timeout (seconds)
          </label>
          <input
            type="number"
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
            value={step.timeout_seconds ?? 60}
            onChange={(e) =>
              onUpdate({
                timeout_seconds: parseInt(e.target.value) || undefined,
              })
            }
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              className="rounded"
              checked={step.fail_on_error !== false}
              onChange={(e) => onUpdate({ fail_on_error: e.target.checked })}
            />
            Fail on error
          </label>
        </div>
      </div>
      {step.phase === "setup" && (
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            className="rounded"
            checked={step.run_on_subsequent_iterations ?? false}
            onChange={(e) =>
              onUpdate({ run_on_subsequent_iterations: e.target.checked })
            }
          />
          Run on subsequent iterations
        </label>
      )}
    </div>
  );
}

// =============================================================================
// Test Step Config
// =============================================================================

function TestConfig({
  step,
  onUpdate,
}: {
  step: TestStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Test Type
        </label>
        <select
          value={step.test_type}
          onChange={(e) => onUpdate({ test_type: e.target.value as TestType })}
          className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="playwright">Playwright (Browser)</option>
          <option value="qontinui_vision">Qontinui Vision</option>
          <option value="python">Python Script</option>
          <option value="repository">Repository Test</option>
          <option value="custom_command">Custom Command</option>
        </select>
      </div>

      {(step.test_type === "custom_command" ||
        step.test_type === "python" ||
        step.test_type === "repository") && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Command
          </label>
          <input
            type="text"
            value={step.command ?? ""}
            onChange={(e) => onUpdate({ command: e.target.value })}
            placeholder={
              step.test_type === "python"
                ? "python test_script.py"
                : step.test_type === "repository"
                  ? "npm test"
                  : "command to run"
            }
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          />
        </div>
      )}

      {step.test_type === "playwright" && (
        <>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Execution Mode
            </label>
            <select
              value={step.execution_mode ?? "independent"}
              onChange={(e) =>
                onUpdate({
                  execution_mode: e.target.value as PlaywrightExecutionMode,
                })
              }
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="independent">Independent (fresh session)</option>
              <option value="chained">Chained (continue after previous)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Target URL (optional)
            </label>
            <input
              type="text"
              value={step.target_url ?? ""}
              onChange={(e) =>
                onUpdate({ target_url: e.target.value || undefined })
              }
              placeholder="http://localhost:3000"
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (seconds)
        </label>
        <input
          type="number"
          className="w-32 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          value={step.timeout_seconds ?? 60}
          onChange={(e) =>
            onUpdate({ timeout_seconds: parseInt(e.target.value) || undefined })
          }
        />
      </div>
    </div>
  );
}

// =============================================================================
// UI Bridge Step Config
// =============================================================================

function UiBridgeConfig({
  step,
  onUpdate,
}: {
  step: UiBridgeStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Action
        </label>
        <select
          value={step.action ?? "snapshot"}
          onChange={(e) =>
            onUpdate({ action: e.target.value as UiBridgeStep["action"] })
          }
          className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
        >
          <option value="navigate">Navigate</option>
          <option value="execute">Execute Instruction</option>
          <option value="assert">Assert Condition</option>
          <option value="snapshot">Take Snapshot</option>
        </select>
      </div>

      {step.action === "navigate" && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            URL
          </label>
          <input
            type="url"
            value={step.url ?? ""}
            onChange={(e) => onUpdate({ url: e.target.value })}
            placeholder="https://example.com"
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>
      )}

      {step.action === "execute" && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Instruction
          </label>
          <textarea
            value={step.instruction ?? ""}
            onChange={(e) => onUpdate({ instruction: e.target.value })}
            placeholder="Click the submit button, fill in the form..."
            rows={4}
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50 resize-y"
          />
        </div>
      )}

      {step.action === "assert" && (
        <>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Target Element
            </label>
            <input
              type="text"
              value={step.target ?? ""}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder='[data-ui-id="submit-btn"]'
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm font-mono focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Assert Type
            </label>
            <select
              value={step.assert_type ?? "exists"}
              onChange={(e) =>
                onUpdate({
                  assert_type: e.target.value as UiBridgeStep["assert_type"],
                })
              }
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="exists">Exists</option>
              <option value="text_equals">Text Equals</option>
              <option value="contains">Contains</option>
              <option value="visible">Visible</option>
              <option value="enabled">Enabled</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Expected Value
            </label>
            <input
              type="text"
              value={step.expected ?? ""}
              onChange={(e) => onUpdate({ expected: e.target.value })}
              placeholder="Expected text or value"
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (ms)
        </label>
        <input
          type="number"
          className="w-32 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
          value={step.timeout_ms ?? 5000}
          onChange={(e) =>
            onUpdate({ timeout_ms: parseInt(e.target.value) || 5000 })
          }
          min={1000}
          max={60000}
          step={1000}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Prompt Step Config
// =============================================================================

function PromptConfig({
  step,
  onUpdate,
}: {
  step: PromptStep;
  onUpdate: (updates: Record<string, unknown>) => void;
  phase: WorkflowPhase;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Prompt Content
        </label>
        <textarea
          value={step.content ?? ""}
          onChange={(e) => onUpdate({ content: e.target.value })}
          placeholder="Enter the prompt for the AI agent..."
          rows={12}
          className="w-full px-3 py-1.5 font-mono bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50 resize-y"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Provider (optional)
          </label>
          <select
            value={step.provider ?? ""}
            onChange={(e) =>
              onUpdate({ provider: e.target.value || undefined })
            }
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">Default</option>
            <option value="claude_cli">Claude CLI</option>
            <option value="gemini_api">Gemini API</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Model (optional)
          </label>
          <select
            value={step.model ?? ""}
            onChange={(e) => onUpdate({ model: e.target.value || undefined })}
            className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="">Default</option>
            <option value="claude-sonnet-4">Claude Sonnet 4</option>
            <option value="claude-opus-4">Claude Opus 4</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main StepConfigPanel
// =============================================================================

export function StepConfigPanel() {
  const { getSelectedStep, updateStep, selectStep } = useWorkflowBuilder();
  const selectedStep = getSelectedStep();

  if (!selectedStep) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Select a step to configure
      </div>
    );
  }

  const phase = selectedStep.phase as WorkflowPhase;

  const handleUpdate = (updates: Record<string, unknown>) => {
    updateStep({ ...selectedStep, ...updates } as typeof selectedStep, phase);
  };

  const renderConfig = () => {
    switch (selectedStep.type) {
      case "command":
        return <CommandConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "test":
        return <TestConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "ui_bridge":
        return <UiBridgeConfig step={selectedStep} onUpdate={handleUpdate} />;
      case "prompt":
        return (
          <PromptConfig
            step={selectedStep}
            onUpdate={handleUpdate}
            phase={phase}
          />
        );
      default:
        return (
          <div className="text-zinc-500 text-sm p-4">
            Unknown step type: {(selectedStep as { type: string }).type}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-200">
          Step Configuration
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => selectStep(null)}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Common: Step name */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Step Name
            </label>
            <input
              type="text"
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              value={selectedStep.name}
              onChange={(e) => handleUpdate({ name: e.target.value })}
            />
          </div>

          {/* Type-specific config */}
          {renderConfig()}
        </div>
      </ScrollArea>
    </div>
  );
}
