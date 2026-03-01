"use client";

import React, { useState, useCallback, useEffect } from "react";
import { RUNNER_API_BASE } from "@/lib/runner-api";
import {
  Layers,
  Loader2,
  ChevronDown,
  ChevronRight,
  MapPin,
  Image as ImageIcon,
  Type,
  Plus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createDefaultStep,
  generateStepId,
  type WorkflowPhase,
} from "@/types/unified-workflow";

// =============================================================================
// Types
// =============================================================================

interface ConfigState {
  id: string;
  name: string;
  description?: string;
  is_initial?: boolean;
  is_final?: boolean;
  state_images?: Array<{
    id: string;
    patterns?: Array<{ image_id?: string }>;
    ocr_text?: string;
  }>;
  regions?: Array<{ x: number; y: number; width: number; height: number }>;
  locations?: Array<{ x: number; y: number }>;
  strings?: Array<{
    value: string;
    identifier?: boolean;
    input_text?: boolean;
  }>;
}

interface ConfigTransition {
  id: string;
  name: string;
  from_state: string;
  to_state: string;
  description?: string;
}

interface StepGenerationOptions {
  includeVerificationStep: boolean;
  includeAgenticStep: boolean;
  targetPhase: WorkflowPhase;
}

interface AddStateStepsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSteps: (
    steps: Array<{
      step: ReturnType<typeof createDefaultStep>;
      phase: WorkflowPhase;
    }>
  ) => void;
}

// =============================================================================
// Component
// =============================================================================

export function AddStateStepsModal({
  isOpen,
  onClose,
  onAddSteps,
}: AddStateStepsModalProps) {
  const [states, setStates] = useState<ConfigState[]>([]);
  const [transitions, setTransitions] = useState<ConfigTransition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(
    new Set()
  );
  const [expandedStateIds, setExpandedStateIds] = useState<Set<string>>(
    new Set()
  );
  const [options, setOptions] = useState<StepGenerationOptions>({
    includeVerificationStep: true,
    includeAgenticStep: false,
    targetPhase: "verification",
  });

  const parseConfig = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${RUNNER_API_BASE}/configs/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(`Failed to parse config: ${res.statusText}`);
      const result = await res.json();
      const data = result.data ?? result;
      setStates(data.states ?? []);
      setTransitions(data.transitions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse config");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRunnerConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusRes = await fetch(`${RUNNER_API_BASE}/status`);
      if (statusRes.ok) {
        const status = await statusRes.json();
        const path = status.data?.config_path ?? status.config_path;
        if (path) {
          setConfigPath(path);
          await parseConfig(path);
          return;
        }
      }
      setError(
        "No configuration loaded in runner. Enter a config file path and click Load."
      );
    } catch {
      setError(
        "Failed to connect to runner. Make sure it's running on port 9876."
      );
    } finally {
      setLoading(false);
    }
  }, [parseConfig]);

  useEffect(() => {
    if (!isOpen) return;
    loadRunnerConfig();
  }, [isOpen, loadRunnerConfig]);

  const toggleState = (stateId: string) => {
    setSelectedStateIds((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  };

  const toggleExpanded = (stateId: string) => {
    setExpandedStateIds((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  };

  const handleAddSteps = () => {
    const steps: Array<{
      step: ReturnType<typeof createDefaultStep>;
      phase: WorkflowPhase;
    }> = [];

    for (const stateId of selectedStateIds) {
      const state = states.find((s) => s.id === stateId);
      if (!state) continue;

      if (options.includeVerificationStep) {
        const phase =
          options.targetPhase === "agentic"
            ? "verification"
            : options.targetPhase;
        steps.push({
          step: {
            id: generateStepId(),
            type: "command",
            phase: phase as "setup" | "verification" | "completion",
            name: `Verify: ${state.name}`,
            command: `# Verify state: ${state.name}${state.description ? `\n# ${state.description}` : ""}`,
            check_type: "custom_command",
          },
          phase: phase as WorkflowPhase,
        });
      }

      if (options.includeAgenticStep) {
        steps.push({
          step: {
            id: generateStepId(),
            type: "prompt",
            phase: "agentic",
            name: `AI: Navigate to ${state.name}`,
            content: `Navigate to the "${state.name}" state.${state.description ? `\n\nState description: ${state.description}` : ""}`,
          },
          phase: "agentic",
        });
      }
    }

    if (steps.length > 0) {
      onAddSteps(steps);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] flex flex-col gap-0 p-0">
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b border-zinc-800">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            Add State Steps
          </DialogTitle>
        </DialogHeader>

        {/* Config Path */}
        <div className="px-5 py-3 border-b border-zinc-800/50">
          <label
            htmlFor="assm-config-path"
            className="block text-xs font-medium text-zinc-400 mb-1.5"
          >
            Config File Path
          </label>
          <div className="flex gap-2">
            <Input
              id="assm-config-path"
              value={configPath}
              onChange={(e) => setConfigPath(e.target.value)}
              placeholder="Path to GUI automation config..."
              className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
            />
            <Button
              size="sm"
              className="h-8"
              onClick={() => parseConfig(configPath)}
              disabled={loading || !configPath.trim()}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Load"
              )}
            </Button>
          </div>
          {states.length > 0 && (
            <p className="mt-1.5 text-[10px] text-zinc-500">
              Loaded {states.length} states and {transitions.length} transitions
            </p>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && (
            <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {error}
            </div>
          )}

          {loading && states.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
            </div>
          )}

          {states.length > 0 && (
            <div className="space-y-1.5">
              {states.map((state) => (
                <div
                  key={state.id}
                  className={`rounded-lg border transition-colors ${
                    selectedStateIds.has(state.id)
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-800/30 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center gap-3 p-2.5">
                    <input
                      type="checkbox"
                      checked={selectedStateIds.has(state.id)}
                      onChange={() => toggleState(state.id)}
                      className="accent-emerald-500"
                    />
                    <button
                      onClick={() => toggleExpanded(state.id)}
                      className="p-0.5 text-zinc-500 hover:text-zinc-300"
                    >
                      {expandedStateIds.has(state.id) ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">
                        {state.name}
                      </div>
                      {state.description && (
                        <div className="text-xs text-zinc-500 truncate">
                          {state.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {state.is_initial && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-400 border-blue-500/30"
                        >
                          Initial
                        </Badge>
                      )}
                      {state.is_final && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 bg-purple-500/10 text-purple-400 border-purple-500/30"
                        >
                          Final
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedStateIds.has(state.id) && (
                    <div className="px-10 pb-2.5 space-y-1.5 text-xs">
                      {state.state_images && state.state_images.length > 0 && (
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <ImageIcon className="w-3 h-3" />
                          <span>{state.state_images.length} image(s)</span>
                          {state.state_images.some((img) => img.ocr_text) && (
                            <span className="text-zinc-600">
                              • OCR available
                            </span>
                          )}
                        </div>
                      )}
                      {state.regions && state.regions.length > 0 && (
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <MapPin className="w-3 h-3" />
                          <span>{state.regions.length} region(s)</span>
                        </div>
                      )}
                      {state.locations && state.locations.length > 0 && (
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <MapPin className="w-3 h-3" />
                          <span>{state.locations.length} location(s)</span>
                        </div>
                      )}
                      {state.strings && state.strings.length > 0 && (
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <Type className="w-3 h-3" />
                          <span>
                            {state.strings.length} string(s):{" "}
                            {state.strings.map((s) => s.value).join(", ")}
                          </span>
                        </div>
                      )}
                      {/* Show transitions from/to this state */}
                      {transitions.filter(
                        (t) =>
                          t.from_state === state.id || t.to_state === state.id
                      ).length > 0 && (
                        <div className="mt-1 text-zinc-600">
                          Transitions:{" "}
                          {transitions
                            .filter(
                              (t) =>
                                t.from_state === state.id ||
                                t.to_state === state.id
                            )
                            .map((t) => t.name)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Options & Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 space-y-3">
          {/* Generation Options */}
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeVerificationStep}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    includeVerificationStep: e.target.checked,
                  }))
                }
                className="accent-emerald-500"
              />
              Add verification step
            </label>
            <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeAgenticStep}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    includeAgenticStep: e.target.checked,
                  }))
                }
                className="accent-emerald-500"
              />
              Add agentic instruction
            </label>
            <select
              value={options.targetPhase}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  targetPhase: e.target.value as WorkflowPhase,
                }))
              }
              className="h-7 px-2 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300"
            >
              <option value="setup">Setup</option>
              <option value="verification">Verification</option>
              <option value="agentic">Agentic</option>
              <option value="completion">Completion</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {selectedStateIds.size} state
              {selectedStateIds.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={
                  selectedStateIds.size === 0 ||
                  (!options.includeVerificationStep &&
                    !options.includeAgenticStep)
                }
                onClick={handleAddSteps}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add{" "}
                {selectedStateIds.size > 0
                  ? `${selectedStateIds.size * ((options.includeVerificationStep ? 1 : 0) + (options.includeAgenticStep ? 1 : 0))} step(s)`
                  : "Steps"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
