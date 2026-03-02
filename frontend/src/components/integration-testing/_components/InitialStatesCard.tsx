"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Settings, Sparkles } from "lucide-react";
import type { StartScreenshot } from "@/hooks/useStartScreenshot";

interface State {
  id: string;
  name: string;
}

interface SelectedProcess {
  initialStateIds?: string[];
}

interface InitialStatesCardProps {
  selectedProcess: SelectedProcess;
  states: State[];
  customInitialStates: string[];
  useProcessDefaults: boolean;
  useAutoDetectedStates: boolean;
  effectiveInitialStates: string[];
  startScreenshot: StartScreenshot | null;
  loadingStartScreenshot: boolean;
  isExecuting: boolean;
  onToggleState: (stateId: string) => void;
  onAutoDetectedChange: (checked: boolean) => void;
  onProcessDefaultsChange: (checked: boolean) => void;
}

export function InitialStatesCard({
  selectedProcess,
  states,
  customInitialStates,
  useProcessDefaults,
  useAutoDetectedStates,
  effectiveInitialStates,
  startScreenshot,
  loadingStartScreenshot,
  isExecuting,
  onToggleState,
  onAutoDetectedChange,
  onProcessDefaultsChange,
}: InitialStatesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Initial States
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {startScreenshot?.found && startScreenshot.initialStates.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="use-auto-detected"
                checked={useAutoDetectedStates}
                onCheckedChange={(checked) =>
                  onAutoDetectedChange(checked as boolean)
                }
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
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
          <div className="p-2 bg-surface-canvas rounded border text-xs text-text-muted text-center">
            Loading initial states from snapshot...
          </div>
        )}

        {(!useAutoDetectedStates ||
          !startScreenshot?.found ||
          startScreenshot.initialStates.length === 0) && (
          <div className="flex items-center space-x-2">
            <Checkbox
              id="use-defaults"
              checked={useProcessDefaults}
              onCheckedChange={(checked) =>
                onProcessDefaultsChange(checked as boolean)
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

        {useProcessDefaults && selectedProcess.initialStateIds && (
          <div className="p-2 bg-surface-canvas rounded border text-xs">
            <div className="text-text-muted mb-1">
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

        {!useProcessDefaults && (
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Select States</Label>
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
              {states.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-4">
                  No states defined yet
                </p>
              ) : (
                states.map((state) => (
                  <div key={state.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`custom-state-${state.id}`}
                      checked={customInitialStates.includes(state.id)}
                      onCheckedChange={() => onToggleState(state.id)}
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
  );
}
