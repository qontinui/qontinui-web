"use client";

import React, { useState } from "react";
import { Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ModelOverrides } from "@/types/unified-workflow";
import {
  PROVIDER_OPTIONS,
  MODELS_BY_PROVIDER,
  MODEL_OVERRIDE_PHASES,
  MODEL_PRESETS,
  detectPreset,
} from "@qontinui/workflow-utils";
import { useStagePhaseOverrides } from "../_hooks/useStagePhaseOverrides";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StageSettingsProps {
  // Accept the WorkflowStage shape (nullable provider/model/max_iterations)
  // directly so the caller doesn't need to re-map.
  stage: {
    description?: string;
    /** `null` = unlimited; a positive value caps the verification-agentic loop. */
    max_iterations?: number | null;
    provider?: string | null;
    model?: string | null;
    model_overrides?: ModelOverrides;
  };
  onUpdate: (updates: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Shared style
// ---------------------------------------------------------------------------

const selectClass =
  "h-7 w-full px-2 text-xs rounded bg-zinc-800/50 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600";

// ---------------------------------------------------------------------------
// StageSettings
// ---------------------------------------------------------------------------

export function StageSettings({ stage, onUpdate }: StageSettingsProps) {
  const [expanded, setExpanded] = useState(false);

  const { stageOverrides, hasPhaseOverrides } = useStagePhaseOverrides(
    stage.model_overrides,
    onUpdate
  );

  return (
    <div className="px-3 pb-1.5">
      <button
        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-400"
        onClick={() => setExpanded(!expanded)}
      >
        <Settings2 className="size-2.5" />
        Stage settings
        {hasPhaseOverrides && (
          <span className="px-1 py-0.5 text-[8px] font-medium bg-purple-500/20 text-purple-400 rounded">
            Overrides
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-2">
          <StageBasicFields stage={stage} onUpdate={onUpdate} />
          <StagePhaseOverridesPanel
            stageOverrides={stageOverrides}
            hasPhaseOverrides={hasPhaseOverrides}
            onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StageBasicFields — description, max iterations, provider, model
// ---------------------------------------------------------------------------

function StageBasicFields({
  stage,
  onUpdate,
}: {
  stage: StageSettingsProps["stage"];
  onUpdate: StageSettingsProps["onUpdate"];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <Input
          value={stage.description ?? ""}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Stage description"
          className="h-7 text-xs bg-zinc-800/50 border-zinc-700"
        />
      </div>
      <div>
        <label
          htmlFor="ss-max-iterations"
          className="text-[10px] text-zinc-500"
        >
          Max iterations
        </label>
        <Input
          id="ss-max-iterations"
          type="number"
          value={stage.max_iterations ?? 10}
          onChange={(e) =>
            onUpdate({ max_iterations: parseInt(e.target.value) || 10 })
          }
          className="h-7 text-xs bg-zinc-800/50 border-zinc-700"
          min={1}
          max={100}
        />
      </div>
      <div>
        <label htmlFor="ss-provider" className="text-[10px] text-zinc-500">
          Provider override
        </label>
        <select
          id="ss-provider"
          value={stage.provider ?? ""}
          onChange={(e) => onUpdate({ provider: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">Inherit from workflow</option>
          {PROVIDER_OPTIONS.filter((p) => p.value !== "").map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ss-model" className="text-[10px] text-zinc-500">
          Model override
        </label>
        {stage.provider && MODELS_BY_PROVIDER[stage.provider] ? (
          <select
            id="ss-model"
            value={stage.model ?? ""}
            onChange={(e) => onUpdate({ model: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">Inherit from workflow</option>
            {MODELS_BY_PROVIDER[stage.provider]!.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="ss-model"
            value={stage.model ?? ""}
            onChange={(e) => onUpdate({ model: e.target.value || undefined })}
            placeholder="(inherit)"
            className="h-7 text-xs bg-zinc-800/50 border-zinc-700"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StagePhaseOverridesPanel — per-phase model overrides section
// ---------------------------------------------------------------------------

function StagePhaseOverridesPanel({
  stageOverrides,
  hasPhaseOverrides,
  onUpdate,
}: {
  stageOverrides: ModelOverrides;
  hasPhaseOverrides: boolean;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  const [overridesExpanded, setOverridesExpanded] = useState(false);

  const { updatePhaseOverride } = useStagePhaseOverrides(
    stageOverrides,
    onUpdate
  );

  return (
    <div className="bg-zinc-800/30 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOverridesExpanded(!overridesExpanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-400"
      >
        <Settings2 className="size-2.5" />
        Stage Per-Phase Overrides
        {hasPhaseOverrides && (
          <span className="px-1 py-0.5 text-[8px] font-medium bg-purple-500/20 text-purple-400 rounded">
            Active
          </span>
        )}
      </button>
      {overridesExpanded && (
        <div className="px-2 pb-2 space-y-1.5">
          <p className="text-[9px] text-zinc-600">
            Override provider/model per phase within this stage. Empty = inherit
            from stage or workflow level.
          </p>
          <div className="flex items-center gap-1.5">
            <select
              value={detectPreset(stageOverrides)}
              onChange={(e) => {
                if (e.target.value === "custom") return;
                const preset = MODEL_PRESETS.find(
                  (p) => p.id === e.target.value
                );
                if (preset)
                  onUpdate({
                    model_overrides:
                      Object.keys(preset.overrides).length > 0
                        ? preset.overrides
                        : undefined,
                  });
              }}
              className="flex-1 h-6 px-1.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            >
              <option value="custom">Custom</option>
              {MODEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            {hasPhaseOverrides && (
              <button
                type="button"
                onClick={() => onUpdate({ model_overrides: undefined })}
                className="h-6 px-1.5 text-[10px] text-zinc-400 hover:text-red-400 border border-zinc-700 rounded"
              >
                Reset
              </button>
            )}
          </div>
          {MODEL_OVERRIDE_PHASES.filter((p) =>
            ["setup", "agentic", "completion", "verification"].includes(p.key)
          ).map((phase) => {
            const cfg = stageOverrides[phase.key as keyof ModelOverrides];
            const provider = cfg?.provider ?? "";
            const model = cfg?.model ?? "";
            return (
              <div key={phase.key} className="flex items-center gap-1.5">
                <span
                  className="text-[10px] text-zinc-500 w-20 flex-shrink-0 truncate"
                  title={phase.label}
                >
                  {phase.label}
                </span>
                <select
                  value={provider}
                  onChange={(e) => {
                    updatePhaseOverride(phase.key, "provider", e.target.value);
                    if (e.target.value !== provider) {
                      updatePhaseOverride(phase.key, "model", "");
                    }
                  }}
                  className="flex-1 h-6 px-1.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                >
                  <option value="">Inherit</option>
                  {PROVIDER_OPTIONS.filter((p) => p.value !== "").map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {provider && MODELS_BY_PROVIDER[provider] ? (
                  <select
                    value={model}
                    onChange={(e) =>
                      updatePhaseOverride(phase.key, "model", e.target.value)
                    }
                    className="flex-1 h-6 px-1.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  >
                    {MODELS_BY_PROVIDER[provider]!.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
