import React from "react";
import type { UiBridgeStep } from "@/types/unified-workflow";
import type { StepUpdateHandler } from "./step-config-types";

export function UiBridgeStepConfig({
  step,
  onUpdate,
}: {
  step: UiBridgeStep;
  onUpdate: StepUpdateHandler;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">Action</p>
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
          <option value="compare">Compare Snapshots</option>
        </select>
      </div>

      {step.action === "navigate" && (
        <div>
          <p className="block text-xs font-medium text-zinc-400 mb-1">URL</p>
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
          <p className="block text-xs font-medium text-zinc-400 mb-1">
            Instruction
          </p>
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
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Target Element
            </p>
            <input
              type="text"
              value={step.target ?? ""}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder='[data-testid="submit-btn"]'
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm font-mono focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div>
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Assert Type
            </p>
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
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Expected Value
            </p>
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

      {step.action === "compare" && (
        <>
          <div>
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Target URL
            </p>
            <input
              type="url"
              value={step.url ?? ""}
              onChange={(e) => onUpdate({ url: e.target.value })}
              placeholder="http://localhost:3001"
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div>
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Comparison Mode
            </p>
            <select
              value={step.comparison_mode ?? "structural"}
              onChange={(e) =>
                onUpdate({
                  comparison_mode: e.target
                    .value as UiBridgeStep["comparison_mode"],
                })
              }
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="structural">Structural</option>
              <option value="visual">Visual</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div>
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Reference Snapshot ID
            </p>
            <input
              type="text"
              value={step.reference_snapshot_id ?? ""}
              onChange={(e) =>
                onUpdate({
                  reference_snapshot_id: e.target.value || undefined,
                })
              }
              placeholder="ID of a saved reference snapshot"
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm font-mono focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div>
            <p className="block text-xs font-medium text-zinc-400 mb-1">
              Severity Threshold
            </p>
            <select
              value={step.severity_threshold ?? "major"}
              onChange={(e) =>
                onUpdate({
                  severity_threshold: e.target
                    .value as UiBridgeStep["severity_threshold"],
                })
              }
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
            >
              <option value="critical">Critical only</option>
              <option value="major">Major and above</option>
              <option value="minor">Minor and above</option>
              <option value="info">All findings</option>
            </select>
            <p className="text-[10px] text-zinc-500 mt-1">
              Step fails if any findings at or above this severity are found
            </p>
          </div>
        </>
      )}

      <div>
        <p className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (ms)
        </p>
        <input
          type="number"
          className="w-32 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/50"
          value={step.timeout_ms ?? (step.action === "compare" ? 120000 : 5000)}
          onChange={(e) =>
            onUpdate({ timeout_ms: parseInt(e.target.value) || 5000 })
          }
          min={1000}
          max={300000}
          step={1000}
        />
      </div>
    </div>
  );
}
