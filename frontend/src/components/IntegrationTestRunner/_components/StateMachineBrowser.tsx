import React from "react";
import type { TestingState } from "@/lib/runner-client";

interface StateMachineBrowserProps {
  states: TestingState[];
  activeStates: string[];
  loading: boolean;
  onRefresh: () => void;
  onTraverseToState: (stateName: string) => void;
}

export function StateMachineBrowser({
  states,
  activeStates,
  loading,
  onRefresh,
  onTraverseToState,
}: StateMachineBrowserProps) {
  return (
    <div className="border rounded-lg p-4 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">State Machine</h3>
        <button
          onClick={onRefresh}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
      </div>

      {activeStates.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Active States
          </h4>
          <div className="flex flex-wrap gap-2">
            {activeStates.map((state) => (
              <span
                key={state}
                className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded text-sm"
              >
                {state}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {states.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No states loaded. Load a configuration first.
          </p>
        ) : (
          states.map((state) => (
            <div
              key={String(state.id)}
              className="flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            >
              <div>
                <span className="font-medium">{state.name}</span>
                {state.is_initial && (
                  <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                    (initial)
                  </span>
                )}
                {state.is_terminal && (
                  <span className="ml-2 text-xs text-gray-500">(terminal)</span>
                )}
              </div>
              <button
                onClick={() => onTraverseToState(state.name)}
                disabled={loading}
                className="text-xs text-blue-600 hover:underline"
              >
                Go to
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
