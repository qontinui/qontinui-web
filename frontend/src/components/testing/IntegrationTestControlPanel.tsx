/**
 * IntegrationTestControlPanel Component
 *
 * Controls for running integration tests - workflow selector, initial states, and run button.
 * Similar to qontinui-runner's ExecutionControlPanel but without monitor selection (mock mode).
 */

"use client";

import { useState, useMemo } from "react";
import {
  Play,
  Loader2,
  ChevronDown,
  CircleDot,
  Check,
  RotateCcw,
  Info,
  FlaskConical,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { State } from "@/contexts/automation-context/types";

// ============================================================================
// Types
// ============================================================================

interface IntegrationTestControlPanelProps {
  /** Available workflows from the project */
  workflows: Workflow[];

  /** Available states from the project */
  states: State[];

  /** Currently selected workflow ID */
  selectedWorkflowId: string | null;

  /** Called when workflow selection changes */
  onWorkflowSelect: (workflowId: string) => void;

  /** Initial states override (null = use workflow defaults) */
  initialStatesOverride: string[] | null;

  /** Called when initial states override changes */
  onInitialStatesChange: (stateIds: string[] | null) => void;

  /** Whether a test is currently running */
  isRunning: boolean;

  /** Called when the Run Test button is clicked */
  onRunTest: () => void;

  /** Whether the API is connected */
  apiHealthy: boolean | null;

  /** Whether data is loading */
  isLoading?: boolean;
}

// ============================================================================
// Initial States Selector Subcomponent
// ============================================================================

interface InitialStatesSelectorProps {
  states: State[];
  resolvedStateIds: string[];
  overrideStateIds: string[] | null;
  onOverrideChange: (ids: string[] | null) => void;
  disabled?: boolean;
}

function InitialStatesSelector({
  states,
  resolvedStateIds,
  overrideStateIds,
  onOverrideChange,
  disabled = false,
}: InitialStatesSelectorProps) {
  const hasOverride = overrideStateIds !== null;
  const effectiveStateIds = hasOverride ? overrideStateIds : resolvedStateIds;

  // Build state name map
  const stateNameMap = useMemo(() => {
    const map = new Map<string, string>();
    states.forEach((state) => {
      map.set(state.id, state.name || state.id);
    });
    return map;
  }, [states]);

  const handleStateToggle = (stateId: string) => {
    if (disabled) return;

    if (hasOverride) {
      if (overrideStateIds.includes(stateId)) {
        onOverrideChange(overrideStateIds.filter((id) => id !== stateId));
      } else {
        onOverrideChange([...overrideStateIds, stateId]);
      }
    } else {
      if (effectiveStateIds.includes(stateId)) {
        onOverrideChange(effectiveStateIds.filter((id) => id !== stateId));
      } else {
        onOverrideChange([...effectiveStateIds, stateId]);
      }
    }
  };

  const handleClearOverride = () => {
    if (disabled) return;
    onOverrideChange(null);
  };

  if (states.length === 0) {
    return (
      <div className="text-sm text-text-muted">
        No states defined in project
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Source indicator */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CircleDot className="w-4 h-4 text-text-muted" />
          <span className="text-sm text-text-muted">Source:</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              hasOverride
                ? "text-amber-400 bg-amber-500/20"
                : "text-blue-400 bg-blue-500/20"
            }`}
          >
            {hasOverride ? "Session Override" : "Workflow Configuration"}
          </span>
        </div>

        {hasOverride && (
          <button
            onClick={handleClearOverride}
            disabled={disabled}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>

      {/* Override info */}
      {hasOverride && (
        <div className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs">
          <Info className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
          <div className="text-amber-400">
            Session override active. Changes reset when workflow changes.
          </div>
        </div>
      )}

      {/* State list */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {states.map((state) => {
          const isSelected = effectiveStateIds.includes(state.id);
          const stateName = stateNameMap.get(state.id) || state.id;

          return (
            <button
              key={state.id}
              onClick={() => handleStateToggle(state.id)}
              disabled={disabled}
              className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-all ${
                isSelected
                  ? "bg-[#FF6B6B]/10 border-[#FF6B6B]/50 text-white"
                  : "bg-surface-raised/50 border-border-default/50 hover:border-[#FF6B6B]/30 hover:bg-surface-raised text-text-muted"
              } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSelected
                    ? "bg-[#FF6B6B] border-[#FF6B6B]"
                    : "border-border-default bg-transparent"
                }`}
              >
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className="text-sm truncate flex-1">{stateName}</span>
              {hasOverride &&
                resolvedStateIds.includes(state.id) !== isSelected && (
                  <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">
                    {isSelected ? "added" : "removed"}
                  </span>
                )}
            </button>
          );
        })}
      </div>

      {/* Summary */}
      <div className="text-xs text-text-muted">
        {effectiveStateIds.length === 0 ? (
          <span>No initial states selected</span>
        ) : (
          <span>
            {effectiveStateIds.length} state
            {effectiveStateIds.length !== 1 ? "s" : ""} will be active at test
            start
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function IntegrationTestControlPanel({
  workflows,
  states,
  selectedWorkflowId,
  onWorkflowSelect,
  initialStatesOverride,
  onInitialStatesChange,
  isRunning,
  onRunTest,
  apiHealthy,
  isLoading = false,
}: IntegrationTestControlPanelProps) {
  const [showWorkflowDropdown, setShowWorkflowDropdown] = useState(false);
  const [initialStatesExpanded, setInitialStatesExpanded] = useState(false);

  // Get selected workflow
  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId]
  );

  // Resolve initial states from workflow
  const resolvedInitialStates = useMemo(() => {
    if (!selectedWorkflow) return [];
    return selectedWorkflow.initialStateIds ?? [];
  }, [selectedWorkflow]);

  // Filter to only "Main" category workflows (runnable workflows)
  const runnableWorkflows = useMemo(
    () => workflows.filter((w) => w.category === "Main"),
    [workflows]
  );

  const canRunTest =
    !isRunning &&
    selectedWorkflowId !== null &&
    apiHealthy === true &&
    !isLoading;

  return (
    <Card
      className="bg-[#1A1A1B]/80 border-border-subtle/50 backdrop-blur-sm"
      data-ui-id="testing-integration-control-panel"
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-medium text-white flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-[#FF6B6B]" />
          Test Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Workflow Selector */}
        <div className="space-y-2">
          <label className="text-sm text-text-muted">Workflow</label>
          <div className="relative">
            <button
              onClick={() => setShowWorkflowDropdown(!showWorkflowDropdown)}
              disabled={isLoading || runnableWorkflows.length === 0}
              className="w-full bg-surface-raised/50 border border-border-default/50 rounded-lg px-4 py-2.5 text-left flex items-center justify-between gap-2 hover:border-border-default transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-ui-id="testing-integration-workflow-select"
            >
              <span
                className={`truncate ${selectedWorkflow ? "text-white" : "text-text-muted"}`}
              >
                {isLoading
                  ? "Loading workflows..."
                  : selectedWorkflow
                    ? selectedWorkflow.name
                    : runnableWorkflows.length === 0
                      ? "No runnable workflows"
                      : "Select a workflow"}
              </span>
              <ChevronDown
                className={`w-4 h-4 flex-shrink-0 text-text-muted transition-transform ${showWorkflowDropdown ? "rotate-180" : ""}`}
              />
            </button>

            {showWorkflowDropdown && runnableWorkflows.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-[#1A1A1B] border border-border-default rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {runnableWorkflows.map((workflow) => (
                  <button
                    key={workflow.id}
                    onClick={() => {
                      onWorkflowSelect(workflow.id);
                      setShowWorkflowDropdown(false);
                      // Clear override when workflow changes
                      onInitialStatesChange(null);
                    }}
                    className={`w-full px-4 py-2.5 text-left hover:bg-surface-raised transition-colors ${
                      workflow.id === selectedWorkflowId
                        ? "bg-[#FF6B6B]/10 text-[#FF6B6B]"
                        : "text-text-secondary"
                    }`}
                  >
                    <div className="font-medium">{workflow.name}</div>
                    {workflow.description && (
                      <div className="text-xs text-text-muted mt-0.5 truncate">
                        {workflow.description}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {runnableWorkflows.length === 0 && !isLoading && (
            <p className="text-xs text-text-muted">
              No &quot;Main&quot; category workflows found. Create a workflow
              with category &quot;Main&quot; to run integration tests.
            </p>
          )}
        </div>

        {/* Initial States Section */}
        {selectedWorkflow && states.length > 0 && (
          <div className="border border-border-default/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setInitialStatesExpanded(!initialStatesExpanded)}
              className="w-full flex items-center justify-between p-3 bg-surface-raised/30 hover:bg-surface-raised/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <CircleDot className="w-4 h-4 text-text-muted" />
                <span className="text-sm font-medium text-white">
                  Initial States
                </span>
                {(initialStatesOverride ?? resolvedInitialStates).length >
                  0 && (
                  <Badge
                    variant="secondary"
                    className="bg-surface-raised/50 text-text-secondary"
                  >
                    {initialStatesOverride !== null
                      ? `${initialStatesOverride.length} (override)`
                      : `${resolvedInitialStates.length}`}
                  </Badge>
                )}
              </div>
              <ChevronDown
                className={`w-4 h-4 text-text-muted transition-transform ${
                  initialStatesExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
            {initialStatesExpanded && (
              <div className="p-3 border-t border-border-default/50">
                <InitialStatesSelector
                  states={states}
                  resolvedStateIds={resolvedInitialStates}
                  overrideStateIds={initialStatesOverride}
                  onOverrideChange={onInitialStatesChange}
                  disabled={isRunning}
                />
              </div>
            )}
          </div>
        )}

        {/* Run Test Button */}
        <Button
          onClick={onRunTest}
          disabled={!canRunTest}
          className="w-full bg-[#FF6B6B] hover:bg-[#FF6B6B]/80 text-white font-medium py-3"
          data-ui-id="testing-integration-run-btn"
          title={
            !selectedWorkflowId
              ? "Select a workflow to run"
              : apiHealthy === false
                ? "API is offline"
                : apiHealthy === null
                  ? "Checking API connection..."
                  : undefined
          }
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Running Test...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Run Integration Test
            </>
          )}
        </Button>

        {/* Status Info */}
        <div className="text-xs text-text-muted text-center">
          {apiHealthy === null
            ? "Checking API connection..."
            : apiHealthy === false
              ? "runner is offline"
              : "Tests run in mock mode using historical data"}
        </div>
      </CardContent>
    </Card>
  );
}
