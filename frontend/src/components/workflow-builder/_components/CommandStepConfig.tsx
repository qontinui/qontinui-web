import React from "react";
import type {
  CommandStep,
  TestType,
  PlaywrightExecutionMode,
} from "@/types/unified-workflow";
import type { StepUpdateHandler } from "./step-config-types";

type CommandMode = "shell" | "check" | "test";

function detectCommandMode(step: CommandStep): CommandMode {
  if (step.test_type || step.test_id) return "test";
  if (step.check_type || step.check_group_id) return "check";
  return "shell";
}

function CommandModeSelector({
  mode,
  onChange,
}: {
  mode: CommandMode;
  onChange: (mode: CommandMode) => void;
}) {
  const modes: { value: CommandMode; label: string }[] = [
    { value: "shell", label: "Shell Command" },
    { value: "check", label: "Check" },
    { value: "test", label: "Test" },
  ];

  return (
    <div className="flex rounded-md bg-zinc-800 p-0.5 mb-4">
      {modes.map(({ value, label }) => (
        <button
          key={value}
          className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
            mode === value
              ? "bg-blue-600 text-white"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
          }`}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ShellCommandFields({
  step,
  onUpdate,
}: {
  step: CommandStep;
  onUpdate: StepUpdateHandler;
}) {
  return (
    <>
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">Command</p>
        <textarea
          className="w-full min-h-[80px] px-3 py-1.5 font-mono bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          placeholder="e.g., git status"
          value={step.command ?? ""}
          onChange={(e) => onUpdate({ command: e.target.value })}
        />
      </div>
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">
          Working Directory
        </p>
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
          <p className="block text-xs font-medium text-zinc-400 mb-1">
            Timeout (seconds)
          </p>
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
    </>
  );
}

function CheckFieldsConfig({
  step,
  onUpdate,
}: {
  step: CommandStep;
  onUpdate: StepUpdateHandler;
}) {
  return (
    <>
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">
          Check Type
        </p>
        <select
          value={step.check_type ?? "custom_command"}
          onChange={(e) => onUpdate({ check_type: e.target.value })}
          className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="lint">Lint</option>
          <option value="format">Format</option>
          <option value="typecheck">Type Check</option>
          <option value="analyze">Analyze</option>
          <option value="security">Security</option>
          <option value="http_status">HTTP Status</option>
          <option value="ai_review">AI Review</option>
          <option value="ci_cd">CI/CD</option>
          <option value="custom_command">Custom Command</option>
        </select>
      </div>
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">Command</p>
        <input
          type="text"
          value={step.command ?? ""}
          onChange={(e) => onUpdate({ command: e.target.value })}
          placeholder="Check command to run"
          className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
        />
      </div>
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (seconds)
        </p>
        <input
          type="number"
          className="w-32 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500/50"
          value={step.timeout_seconds ?? 60}
          onChange={(e) =>
            onUpdate({ timeout_seconds: parseInt(e.target.value) || undefined })
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          className="rounded"
          checked={step.auto_fix ?? false}
          onChange={(e) => onUpdate({ auto_fix: e.target.checked })}
        />
        Auto-fix
      </label>
    </>
  );
}

function TestFieldsConfig({
  step,
  onUpdate,
}: {
  step: CommandStep;
  onUpdate: StepUpdateHandler;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">
          Test Type
        </p>
        <select
          value={step.test_type ?? "custom_command"}
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
          <p className="block text-xs font-medium text-zinc-400 mb-1">
            Command
          </p>
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
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Execution Mode
            </p>
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
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Target URL (optional)
            </p>
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
        <p className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (seconds)
        </p>
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

export function CommandStepConfig({
  step,
  onUpdate,
}: {
  step: CommandStep;
  onUpdate: StepUpdateHandler;
}) {
  const mode = detectCommandMode(step);

  const handleModeChange = (newMode: CommandMode) => {
    // Clear fields from the old mode
    const clearFields: Record<string, undefined> = {};
    if (mode === "test" && newMode !== "test") {
      clearFields.test_type = undefined;
      clearFields.test_id = undefined;
      clearFields.code = undefined;
      clearFields.script_id = undefined;
      clearFields.script_content = undefined;
      clearFields.target_url = undefined;
      clearFields.fused_script_id = undefined;
      clearFields.execution_mode = undefined;
    }
    if (mode === "check" && newMode !== "check") {
      clearFields.check_type = undefined;
      clearFields.check_id = undefined;
      clearFields.check_group_id = undefined;
      clearFields.tool = undefined;
      clearFields.config_path = undefined;
      clearFields.auto_fix = undefined;
      clearFields.fail_on_warning = undefined;
    }
    // Set defaults for the new mode
    const setFields: Record<string, unknown> = {};
    if (newMode === "test") {
      setFields.test_type = "custom_command";
    }
    if (newMode === "check") {
      setFields.check_type = "custom_command";
    }
    onUpdate({ ...clearFields, ...setFields });
  };

  return (
    <div className="space-y-4">
      <CommandModeSelector mode={mode} onChange={handleModeChange} />

      {mode === "test" && <TestFieldsConfig step={step} onUpdate={onUpdate} />}

      {mode === "check" && (
        <CheckFieldsConfig step={step} onUpdate={onUpdate} />
      )}

      {mode === "shell" && (
        <ShellCommandFields step={step} onUpdate={onUpdate} />
      )}
    </div>
  );
}
