// components/integration-testing/ExecutionControls.tsx

"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Play,
  Square,
  Settings,
  Layers,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { useStartScreenshot } from "@/hooks/useStartScreenshot";
import { toast } from "sonner";
import type { SnapshotRun } from "@/types/snapshots";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ExecutionControlsProps {
  selectedSnapshots: SnapshotRun[]; // Support multiple snapshots
  onExecute?: (
    processId: string,
    initialStates: string[],
    snapshotRunIds: string[]
  ) => void;
  onStop?: () => void;
  isExecuting?: boolean;
  onProcessChange?: (processId: string) => void;
}

export function ExecutionControls({
  selectedSnapshots,
  onExecute,
  onStop,
  isExecuting = false,
  onProcessChange,
}: ExecutionControlsProps) {
  const { workflows = [], states = [], categories = [] } = useAutomation();
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedProcessId, setSelectedProcessId] = useState<string>("");
  const [customInitialStates, setCustomInitialStates] = useState<string[]>([]);
  const [useProcessDefaults, setUseProcessDefaults] = useState(true);
  const [useAutoDetectedStates, setUseAutoDetectedStates] = useState(true);

  // Fetch start screenshot from the first selected snapshot
  const firstSnapshotRunId =
    selectedSnapshots.length > 0 ? selectedSnapshots[0]?.run_id ?? null : null;
  const { startScreenshot, loading: loadingStartScreenshot } =
    useStartScreenshot(firstSnapshotRunId);

  // All workflows are now in graph format with actions array
  const processes = useMemo(() => {
    console.log(
      "[ExecutionControls] workflows from context:",
      workflows?.length,
      workflows
    );
    return workflows;
  }, [workflows]);

  // Group processes by category
  const processesByCategory = useMemo(() => {
    const grouped = new Map<string, typeof processes>();

    if (categories && categories.length > 0) {
      categories.forEach((categoryName) => {
        const categoryProcesses = processes.filter(
          (p) => p.category === categoryName
        );
        if (categoryProcesses.length > 0) {
          grouped.set(categoryName, categoryProcesses);
        }
      });
    }

    // Add uncategorized processes
    const uncategorized = processes.filter(
      (p) => !p.category || !categories || !categories.includes(p.category)
    );
    if (uncategorized.length > 0) {
      grouped.set("Uncategorized", uncategorized);
    }

    return grouped;
  }, [processes, categories]);

  // Get processes for selected category
  const categoryProcesses = useMemo(() => {
    const result = !selectedCategory
      ? processes
      : processesByCategory.get(selectedCategory) || [];
    console.log("[ExecutionControls] categoryProcesses:", {
      selectedCategory,
      processesCount: processes?.length,
      categoriesInMap: Array.from(processesByCategory.keys()),
      resultCount: result?.length,
      result,
    });
    return result;
  }, [selectedCategory, processesByCategory, processes]);

  // Get selected process details
  const selectedProcess = useMemo(
    () => processes.find((p) => p.id === selectedProcessId),
    [processes, selectedProcessId]
  );

  // Get effective initial states (priority: auto-detected > process defaults > custom)
  const effectiveInitialStates = useMemo(() => {
    if (!selectedProcess) return [];

    // Priority 1: Auto-detected from snapshot (if available and enabled)
    if (
      useAutoDetectedStates &&
      startScreenshot?.found &&
      startScreenshot.initialStates.length > 0
    ) {
      return startScreenshot.initialStates;
    }

    // Priority 2: Process defaults (if enabled)
    if (useProcessDefaults) {
      return selectedProcess.initialStateIds || [];
    }

    // Priority 3: Custom states
    return customInitialStates;
  }, [
    selectedProcess,
    useProcessDefaults,
    useAutoDetectedStates,
    customInitialStates,
    startScreenshot,
  ]);

  // Update custom states when process changes
  useEffect(() => {
    if (selectedProcess && selectedProcess.initialStateIds) {
      setCustomInitialStates(selectedProcess.initialStateIds);
    }
  }, [selectedProcess]);

  // Toggle state selection
  const toggleState = (stateId: string) => {
    setCustomInitialStates((prev) =>
      prev.includes(stateId)
        ? prev.filter((id) => id !== stateId)
        : [...prev, stateId]
    );
  };

  // Validate and execute
  const handleExecute = () => {
    if (!selectedProcess) {
      toast.error("No workflow selected", {
        description: "Please select a workflow to execute",
      });
      return;
    }

    if (!selectedSnapshots || selectedSnapshots.length === 0) {
      toast.error("No snapshots selected", {
        description:
          "Please select at least one snapshot run for integration testing",
      });
      return;
    }

    if (effectiveInitialStates.length === 0) {
      toast.error("No initial states", {
        description: "Please select at least one initial state",
      });
      return;
    }

    const snapshotRunIds = selectedSnapshots.map((s) => s.run_id);

    if (onExecute) {
      onExecute(selectedProcess.id, effectiveInitialStates, snapshotRunIds);
    }
  };

  return (
    <div className="space-y-4">
      {/* Process Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Process Selection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Category Filter */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-600">Category</Label>
            <Select
              value={selectedCategory || "all"}
              onValueChange={(value) => {
                setSelectedCategory(value === "all" ? "" : value);
                setSelectedProcessId("");
              }}
              disabled={isExecuting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Array.from(processesByCategory.keys()).map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Process Selection */}
          <div className="space-y-2">
            <Label className="text-xs text-gray-600">Process</Label>
            <Select
              value={selectedProcessId}
              onValueChange={(value) => {
                setSelectedProcessId(value);
                onProcessChange?.(value);
              }}
              disabled={isExecuting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a process" />
              </SelectTrigger>
              <SelectContent>
                {categoryProcesses.map((proc) => {
                  const actionCount = proc.actions ? proc.actions.length : 0;
                  return (
                    <SelectItem key={proc.id} value={proc.id}>
                      {proc.name} ({actionCount} actions)
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Process Info */}
          {selectedProcess && (
            <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
                <div className="text-xs text-blue-900">
                  <div className="font-medium">{selectedProcess.name}</div>
                  {selectedProcess.description && (
                    <div className="mt-1 text-blue-800">
                      {selectedProcess.description}
                    </div>
                  )}
                  <div className="mt-1">
                    {selectedProcess.actions?.length || 0} action(s) configured
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Initial States Configuration */}
      {selectedProcess && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Initial States
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Auto-detected states (from snapshot) */}
            {startScreenshot?.found &&
              startScreenshot.initialStates.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="use-auto-detected"
                      checked={useAutoDetectedStates}
                      onCheckedChange={(checked) => {
                        setUseAutoDetectedStates(checked as boolean);
                        if (!checked) {
                          setUseProcessDefaults(true);
                        }
                      }}
                      disabled={isExecuting}
                    />
                    <Label
                      htmlFor="use-auto-detected"
                      className="text-sm font-normal cursor-pointer flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3 text-purple-600" />
                      Use auto-detected states from snapshot
                    </Label>
                  </div>

                  {useAutoDetectedStates && (
                    <div className="p-2 bg-purple-50 rounded border border-purple-200 text-xs">
                      <div className="text-purple-900 font-medium mb-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        Auto-detected from snapshot start:
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {startScreenshot.initialStates.map((stateName) => (
                          <span
                            key={stateName}
                            className="px-2 py-0.5 bg-purple-100 text-purple-900 rounded font-mono"
                          >
                            {stateName}
                          </span>
                        ))}
                      </div>
                      {startScreenshot.screenshotUrl && (
                        <div className="mt-2 pt-2 border-t border-purple-200">
                          <img
                            src={startScreenshot.screenshotUrl}
                            alt="Start screenshot"
                            className="w-full rounded border border-purple-300"
                          />
                          <div className="text-purple-700 mt-1 text-center">
                            Start state from automation recording
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            {loadingStartScreenshot && (
              <div className="p-2 bg-gray-50 rounded border text-xs text-gray-600 text-center">
                Loading initial states from snapshot...
              </div>
            )}

            {/* Use defaults toggle */}
            {(!useAutoDetectedStates ||
              !startScreenshot?.found ||
              startScreenshot.initialStates.length === 0) && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="use-defaults"
                  checked={useProcessDefaults}
                  onCheckedChange={(checked) =>
                    setUseProcessDefaults(checked as boolean)
                  }
                  disabled={isExecuting || useAutoDetectedStates}
                />
                <Label
                  htmlFor="use-defaults"
                  className="text-sm font-normal cursor-pointer"
                >
                  Use process defaults
                </Label>
              </div>
            )}

            {/* Process default states info */}
            {useProcessDefaults && selectedProcess.initialStateIds && (
              <div className="p-2 bg-gray-50 rounded border text-xs">
                <div className="text-gray-600 mb-1">
                  Default states from process:
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedProcess.initialStateIds.map((stateId) => {
                    const state = states.find((s) => s.id === stateId);
                    return (
                      <span
                        key={stateId}
                        className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded"
                      >
                        {state?.name || stateId}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom state selection */}
            {!useProcessDefaults && (
              <div className="space-y-2">
                <Label className="text-xs text-gray-600">Select States</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
                  {states.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-4">
                      No states defined yet
                    </p>
                  ) : (
                    states.map((state) => (
                      <div
                        key={state.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`custom-state-${state.id}`}
                          checked={customInitialStates.includes(state.id)}
                          onCheckedChange={() => toggleState(state.id)}
                          disabled={isExecuting}
                        />
                        <Label
                          htmlFor={`custom-state-${state.id}`}
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {state.name}
                        </Label>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Effective states summary */}
            {effectiveInitialStates.length > 0 && (
              <div className="p-2 bg-green-50 rounded border border-green-200 text-xs">
                <div className="text-green-900 font-medium mb-1">
                  Will start with {effectiveInitialStates.length} state(s):
                </div>
                <div className="flex flex-wrap gap-1">
                  {effectiveInitialStates.map((stateId) => {
                    const state = states.find((s) => s.id === stateId);
                    return (
                      <span
                        key={stateId}
                        className="px-2 py-0.5 bg-green-200 text-green-900 rounded"
                      >
                        {state?.name || stateId}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Execution Controls */}
      <Card>
        <CardContent className="pt-6">
          {!isExecuting ? (
            <Button
              onClick={handleExecute}
              disabled={
                !selectedProcess ||
                selectedSnapshots.length === 0 ||
                effectiveInitialStates.length === 0
              }
              className="w-full"
            >
              <Play className="w-4 h-4 mr-2" />
              Execute Process
            </Button>
          ) : (
            <Button onClick={onStop} variant="destructive" className="w-full">
              <Square className="w-4 h-4 mr-2" />
              Stop Execution
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Snapshot Info */}
      {selectedSnapshots && selectedSnapshots.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              Selected Snapshots ({selectedSnapshots.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-2">
              {selectedSnapshots.map((snapshot, index) => (
                <div
                  key={snapshot.id}
                  className="p-2 bg-gray-50 rounded border"
                >
                  <div className="font-medium mb-1">Snapshot {index + 1}</div>
                  <div className="space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Run ID:</span>
                      <span className="font-mono text-xs">
                        {snapshot.run_id.slice(0, 8)}...
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Actions:</span>
                      <span>{snapshot.total_actions}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Screenshots:</span>
                      <span>{snapshot.total_screenshots}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t">
                <div className="flex justify-between font-medium">
                  <span>Total Pool Size:</span>
                  <span>
                    {selectedSnapshots.reduce(
                      (sum, s) => sum + s.total_actions,
                      0
                    )}{" "}
                    actions,{" "}
                    {selectedSnapshots.reduce(
                      (sum, s) => sum + s.total_screenshots,
                      0
                    )}{" "}
                    screenshots
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
