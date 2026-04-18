"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RUNNER_API_BASE } from "@/lib/runner-api";
import {
  GitBranch,
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  generateStepId,
  type PromptStep,
  type UnifiedStep,
  type UnifiedWorkflow,
} from "@/types/unified-workflow";

interface GenerateFromStatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWorkflowGenerated: (workflow: Partial<UnifiedWorkflow>) => void;
}

interface ConfigState {
  id: string;
  name: string;
  description?: string;
  is_initial?: boolean;
  is_final?: boolean;
}

export function GenerateFromStatesModal({
  isOpen,
  onClose,
  onWorkflowGenerated,
}: GenerateFromStatesModalProps) {
  const [workflowName, setWorkflowName] = useState(
    "State Machine Verification"
  );
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [maxIterations, setMaxIterations] = useState(10);
  const [stateTimeout, setStateTimeout] = useState(30);
  const [includeSetupNavigation, setIncludeSetupNavigation] = useState(true);
  const [includeContexts, setIncludeContexts] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load runner config and parse states when modal is open
  const { data: configData, isLoading: isCheckingConfig } = useQuery({
    queryKey: ["runnerConfigStates"],
    queryFn: async ({
      signal,
    }): Promise<{ hasConfig: boolean; states: ConfigState[] }> => {
      const res = await fetch(`${RUNNER_API_BASE}/status`, { signal });
      if (!res.ok) throw new Error("Runner not available");
      const status = await res.json();
      const configPath = status.data?.config_path ?? status.config_path;
      if (!configPath) {
        return { hasConfig: false, states: [] };
      }

      const parseRes = await fetch(`${RUNNER_API_BASE}/configs/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: configPath }),
        signal,
      });
      if (!parseRes.ok) throw new Error("Failed to parse config");
      const result = await parseRes.json();
      const data = result.data ?? result;
      const loadedStates: ConfigState[] = data.states ?? [];
      return { hasConfig: loadedStates.length > 0, states: loadedStates };
    },
    enabled: isOpen,
    staleTime: 30 * 1000,
    retry: false,
  });

  const hasConfig = configData?.hasConfig ?? false;
  const states = useMemo(() => configData?.states ?? [], [configData?.states]);

  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    setError(null);

    try {
      const setupSteps: UnifiedStep[] = [];
      const verificationSteps: UnifiedStep[] = [];
      const agenticSteps: PromptStep[] = [];
      const completionSteps: UnifiedStep[] = [];

      // Setup: navigate to initial state
      if (includeSetupNavigation) {
        const initialState = states.find((s) => s.is_initial) ?? states[0];
        if (initialState) {
          setupSteps.push({
            id: generateStepId(),
            type: "command",
            phase: "setup",
            name: `Navigate to initial state: ${initialState.name}`,
            command: `# Navigate to: ${initialState.name}\n# ${initialState.description || "Initial state"}`,
            check_type: "custom_command",
          } as UnifiedStep);
        }
      }

      // Verification: one step per state
      for (const state of states) {
        verificationSteps.push({
          id: generateStepId(),
          type: "command",
          phase: "verification",
          name: `Verify: ${state.name}`,
          command: `# Verify state: ${state.name}\n# ${state.description || "Check state is correctly displayed"}`,
          check_type: "custom_command",
          timeout_seconds: stateTimeout,
        } as UnifiedStep);
      }

      // Agentic: prompt for AI-driven exploration
      if (includeContexts) {
        agenticSteps.push({
          id: generateStepId(),
          type: "prompt",
          phase: "agentic",
          name: "AI State Verification",
          content: `Verify that each application state is correctly displayed and functional.\n\nStates to verify:\n${states.map((s) => `- ${s.name}: ${s.description || "No description"}`).join("\n")}\n\nFor each state, verify visual correctness and that all interactive elements are functional.`,
        });
      }

      // Completion: summary
      if (includeSummary) {
        completionSteps.push({
          id: generateStepId(),
          type: "prompt",
          phase: "completion",
          name: "Generate Verification Summary",
          content:
            "Summarize the results of the state machine verification. List which states passed, which failed, and any issues found.",
        } as UnifiedStep);
      }

      onWorkflowGenerated({
        name: workflowName,
        description: workflowDescription || undefined,
        maxIterations: maxIterations,
        setupSteps: setupSteps,
        verificationSteps: verificationSteps,
        agenticSteps: agenticSteps,
        completionSteps: completionSteps,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [
    states,
    workflowName,
    workflowDescription,
    maxIterations,
    stateTimeout,
    includeSetupNavigation,
    includeContexts,
    includeSummary,
    onWorkflowGenerated,
    onClose,
  ]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-emerald-400" />
            Generate from State Machine
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Config status */}
          {isCheckingConfig ? (
            <div className="flex items-center gap-3 p-4 bg-surface-raised/50 rounded-lg">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
              <span className="text-text-muted">
                Checking loaded configuration...
              </span>
            </div>
          ) : !hasConfig ? (
            <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 font-medium text-sm">
                  No Configuration Loaded
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Load a state machine configuration in the runner first.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-emerald-400 font-medium text-sm">
                  Configuration Ready
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Found{" "}
                  <span className="font-medium text-text-primary">
                    {states.length} states
                  </span>
                  . A verification step will be created for each state.
                </p>
              </div>
            </div>
          )}

          {hasConfig && !isCheckingConfig && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="gfsm-name" className="text-xs text-text-muted">
                  Workflow Name
                </Label>
                <Input
                  id="gfsm-name"
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  placeholder="Enter workflow name..."
                  className="bg-surface-raised/50 border-border-subtle h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="gfsm-description"
                  className="text-xs text-text-muted"
                >
                  Description
                </Label>
                <Textarea
                  id="gfsm-description"
                  value={workflowDescription}
                  onChange={(e) => setWorkflowDescription(e.target.value)}
                  placeholder="What does this workflow verify?"
                  rows={2}
                  className="bg-surface-raised/50 border-border-subtle text-sm resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="gfsm-max-iterations"
                    className="text-xs text-text-muted"
                  >
                    Max Iterations
                  </Label>
                  <Input
                    id="gfsm-max-iterations"
                    type="number"
                    value={maxIterations}
                    onChange={(e) =>
                      setMaxIterations(parseInt(e.target.value) || 10)
                    }
                    min={1}
                    max={100}
                    className="bg-surface-raised/50 border-border-subtle h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="gfsm-timeout"
                    className="text-xs text-text-muted"
                  >
                    State Timeout (sec)
                  </Label>
                  <Input
                    id="gfsm-timeout"
                    type="number"
                    value={stateTimeout}
                    onChange={(e) =>
                      setStateTimeout(parseInt(e.target.value) || 30)
                    }
                    min={5}
                    max={300}
                    className="bg-surface-raised/50 border-border-subtle h-8 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  aria-label="Include Setup Navigation"
                  htmlFor="include-setup-navigation-2"
                  className="flex items-center justify-between p-2.5 bg-surface-raised/50 rounded-lg border border-border-subtle cursor-pointer"
                >
                  <div>
                    <span className="text-sm text-text-secondary">
                      Include Setup Navigation
                    </span>
                    <p className="text-[10px] text-text-muted">
                      Navigate to initial state in setup phase
                    </p>
                  </div>
                  <input
                    id="include-setup-navigation-2"
                    type="checkbox"
                    checked={includeSetupNavigation}
                    onChange={(e) =>
                      setIncludeSetupNavigation(e.target.checked)
                    }
                    className="w-4 h-4"
                  />
                </label>

                <label
                  aria-label="Include AI Contexts"
                  htmlFor="include-ai-contexts-1"
                  className="flex items-center justify-between p-2.5 bg-surface-raised/50 rounded-lg border border-border-subtle cursor-pointer"
                >
                  <div>
                    <span className="text-sm text-text-secondary">
                      Include AI Contexts
                    </span>
                    <p className="text-[10px] text-text-muted">
                      Add context snippets to agentic prompt
                    </p>
                  </div>
                  <input
                    id="include-ai-contexts-1"
                    type="checkbox"
                    checked={includeContexts}
                    onChange={(e) => setIncludeContexts(e.target.checked)}
                    className="w-4 h-4"
                  />
                </label>

                <label
                  aria-label="Include AI Summary"
                  htmlFor="include-ai-summary-0"
                  className="flex items-center justify-between p-2.5 bg-surface-raised/50 rounded-lg border border-border-subtle cursor-pointer"
                >
                  <div>
                    <span className="text-sm text-text-secondary">
                      Include AI Summary
                    </span>
                    <p className="text-[10px] text-text-muted">
                      Generate summary in completion phase
                    </p>
                  </div>
                  <input
                    id="include-ai-summary-0"
                    type="checkbox"
                    checked={includeSummary}
                    onChange={(e) => setIncludeSummary(e.target.checked)}
                    className="w-4 h-4"
                  />
                </label>
              </div>

              {error && (
                <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!hasConfig || isGenerating || isCheckingConfig}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-1.5" />
                Generate Workflow
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
